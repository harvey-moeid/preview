import { WorkerEntrypoint } from "cloudflare:workers";
import { z } from "zod";
import {
  AppError,
  boundedText,
  callbackSchema,
  failure,
  idSchema,
  readJson,
  result,
  submitSchema,
  ttlSchema,
} from "../../../packages/shared/src/index";
import {
  equal,
  hmac,
  requireOrigin,
  verifySignature,
} from "../../../packages/shared/src/auth";
import { GitHub } from "../../../packages/repo-analyzer/src/index";
import type { ControlEnv } from "./env";
export { Coordinator } from "./coordinator";
const cookieName = "__Host-byga_session";
function token(request: Request) {
  return (
    request.headers
      .get("Cookie")
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1) || ""
  );
}
const coordinator = (env: ControlEnv) => env.QUEUE.getByName("personal-v1");

export class PreviewAccess extends WorkerEntrypoint<ControlEnv> {
  async fetch(request: Request) {
    const id = new URL(request.url).pathname.slice(1);
    if (!idSchema.safeParse(id).success)
      return new Response(null, { status: 404 });
    const access = await coordinator(this.env).access(id);
    return Response.json(access, {
      status: access ? 200 : 410,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
export default {
  async fetch(request: Request, env: ControlEnv): Promise<Response> {
    const url = new URL(request.url),
      path = url.pathname,
      method = request.method;
    try {
      if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);
      if (url.origin !== env.APP_ORIGIN)
        throw new AppError("INVALID_HOST", "Dashboard origin mismatch", 403);
      const queue = coordinator(env);
      if (path.startsWith("/api/internal/")) {
        if (method !== "POST")
          throw new AppError("METHOD", "POST required", 405);
        const body = await boundedText(new Response(request.body), 32768);
        const nonce = await verifySignature(
          request,
          body,
          env.PUBLISH_CALLBACK_SECRET || "",
        );
        await queue.consumeNonce(nonce);
        let json: unknown;
        try {
          json = JSON.parse(body);
        } catch {
          throw new AppError("INVALID_JSON", "Invalid callback JSON");
        }
        if (path === "/api/internal/plan") {
          const p = z
            .object({
              jobId: idSchema,
              kind: z.enum(["publish", "validate"]),
              generation: z.number().int().min(0),
            })
            .strict()
            .parse(json);
          return result(await queue.plan(p.jobId, p.kind, p.generation));
        }
        if (path === "/api/internal/publish-result")
          return result(await queue.callback(callbackSchema.parse(json)));
        throw new AppError("NOT_FOUND", "Not found", 404);
      }
      if (!["GET", "HEAD"].includes(method))
        requireOrigin(request, env.APP_ORIGIN);
      if (path === "/api/auth/login" && method === "POST") {
        if (!env.SESSION_SIGNING_KEY)
          throw new AppError(
            "AUTH_NOT_CONFIGURED",
            "Configure session signing key",
            503,
          );
        const input = z
          .object({ password: z.string().min(1).max(256) })
          .strict()
          .parse(await readJson(request, 1024));
        const key = await hmac(
          env.SESSION_SIGNING_KEY,
          request.headers.get("CF-Connecting-IP") || "unknown",
        );
        const session = await queue.login(key, input.password);
        const response = result({ csrf: session.csrf });
        response.headers.set(
          "Set-Cookie",
          `${cookieName}=${session.token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=43200`,
        );
        return response;
      }
      const session = await queue.session(token(request));
      if (!session)
        throw new AppError("UNAUTHENTICATED", "Sign in to continue", 401);
      if (
        !["GET", "HEAD"].includes(method) &&
        !(await equal(request.headers.get("X-CSRF-Token") || "", session.csrf))
      )
        throw new AppError("CSRF_TOKEN", "Invalid CSRF token", 403);
      if (path === "/api/auth/me" && method === "GET")
        return result({ csrf: session.csrf });
      if (path === "/api/auth/logout" && method === "POST") {
        await queue.logout(token(request));
        const response = result({ loggedOut: true });
        response.headers.set(
          "Set-Cookie",
          `${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`,
        );
        return response;
      }
      if (path === "/api/repo/analyze" && method === "POST") {
        const input = z
          .object({
            url: z.string().max(1000),
            ref: z.string().max(200).optional(),
          })
          .strict()
          .parse(await readJson(request));
        return result(
          await queue.storeAnalysis(
            await new GitHub().analyze(input.url, input.ref),
          ),
        );
      }
      const refs = path.match(/^\/api\/repo\/([a-f0-9]{32})\/refs$/);
      if (refs && method === "GET") {
        const a = await queue.analysis(refs[1]);
        const page = Math.min(
          20,
          Math.max(1, Number(url.searchParams.get("page")) || 1),
        );
        const gh = new GitHub();
        const [branches, tags] = await Promise.all([
          gh.get(
            `/repos/${a.owner}/${a.repo}/branches?per_page=30&page=${page}`,
          ),
          gh.get(`/repos/${a.owner}/${a.repo}/tags?per_page=30&page=${page}`),
        ]);
        return result({ branches, tags, page });
      }
      if (path === "/api/builds" && method === "POST") {
        const input = submitSchema.parse(await readJson(request));
        return result(
          await queue.enqueue(input.analysisId, input.config, input.ttl),
          202,
        );
      }
      if (path === "/api/builds" && method === "GET")
        return result(await queue.listBuilds());
      const build = path.match(
        /^\/api\/builds\/([a-f0-9]{32})(?:\/(logs|cancel|retry))?$/,
      );
      if (build) {
        const id = build[1];
        if (method === "GET" && !build[2]) return result(await queue.build(id));
        if (method === "GET" && build[2] === "logs") {
          const b = await queue.build(id);
          const cursor = Math.max(
            0,
            Number(url.searchParams.get("cursor")) || 0,
          );
          return result({
            logs: b.logs.slice(cursor),
            cursor: b.logs.length,
            actionsUrl: b.runId
              ? `https://github.com/${env.GITHUB_OWNER}/${env.GITHUB_ORCHESTRATOR_REPO}/actions/runs/${b.runId}`
              : null,
          });
        }
        if (method === "POST" && build[2] === "cancel")
          return result(await queue.cancel(id));
        if (method === "POST" && build[2] === "retry")
          return result(await queue.retry(id), 202);
      }
      if (path === "/api/previews" && method === "GET")
        return result(await queue.listPreviews());
      const preview = path.match(
        /^\/api\/previews\/([a-f0-9]{32})(?:\/(rebuild|validate|evidence))?$/,
      );
      if (preview) {
        const id = preview[1],
          p = await queue.preview(id);
        if (!p)
          throw new AppError("PREVIEW_NOT_FOUND", "Preview not found", 404);
        if (method === "PATCH" && !preview[2]) {
          const input = z
            .object({ ttl: ttlSchema })
            .strict()
            .parse(await readJson(request));
          return result(await queue.updatePreview(id, input.ttl));
        }
        if (method === "DELETE" && !preview[2])
          return result(await queue.updatePreview(id, undefined, true));
        if (method === "POST" && preview[2] === "validate")
          return result(await queue.validateAgain(id), 202);
        if (method === "POST" && preview[2] === "rebuild") {
          const b = await queue.build(p.buildId);
          const fresh = await new GitHub().analyze(
            b.analysis.url,
            b.analysis.ref,
          );
          await queue.storeAnalysis(fresh);
          return result(await queue.enqueue(fresh.id, b.config, p.ttl), 202);
        }
        if (method === "GET" && preview[2] === "evidence") {
          const file = url.searchParams.get("file");
          if (!["desktop.png", "mobile.png"].includes(file || ""))
            throw new AppError("INVALID_FILE", "Unknown evidence");
          const b = await queue.build(p.buildId);
          const object = await env.BUCKET.get(
            `evidence/${b.id}/${b.validationGeneration}/${file}`,
          );
          if (!object)
            throw new AppError(
              "EVIDENCE_PENDING",
              "Evidence is not uploaded yet",
              404,
            );
          return new Response(object.body, {
            headers: {
              "Content-Type": "image/png",
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
            },
          });
        }
      }
      if (path === "/api/settings" && method === "GET")
        return result({
          activeLimit: 1,
          queueLimit: 10,
          buildMinutes: 10,
          validationMinutes: 3,
          sourceBytes: 104857600,
          outputBytes: 104857600,
          defaultTTL: "7",
          manualRebuildOnly: true,
          dynamicAdapters: false,
          buildsEnabled: env.BUILDS_ENABLED === "true",
          fallbackOrigin: !env.PREVIEW_BASE_DOMAIN,
        });
      throw new AppError("NOT_FOUND", "Endpoint not found", 404);
    } catch (e) {
      return e instanceof z.ZodError
        ? failure(
            new AppError(
              "INVALID_INPUT",
              e.issues
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .join("; "),
            ),
          )
        : failure(e);
    }
  },
} satisfies ExportedHandler<ControlEnv>;
