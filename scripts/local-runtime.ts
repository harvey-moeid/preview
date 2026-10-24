import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { hmac } from "../packages/shared/src/auth";
import type { Build, Callback } from "../packages/shared/src/index";
import type { Run } from "../apps/control-worker/src/github-actions";
import { smoke } from "./smoke";
const execute = promisify(execFile);
export const trustedSha = "a".repeat(40);
export const fixtureSha = "b".repeat(40);
export async function createLocalRuntime({
  appOrigin = "http://127.0.0.1:5173",
  previewOrigin = "http://127.0.0.1:8788",
  validate = false,
} = {}) {
  // Ephemeral local-only credentials are generated in memory, never written to the repository.
  const password = process.env.BYGA_LOCAL_PASSWORD || "byga-local-fixture-only";
  const salt = randomBytes(16).toString("hex");
  const passwordHash = `pbkdf2-sha256$600000$${salt}$${pbkdf2Sync(password, salt, 600000, 32, "sha256").toString("hex")}`;
  const callbackSecret = randomBytes(32).toString("hex");
  const [control, preview] = await Promise.all(
    ["tests/harness-worker.ts", "apps/preview-worker/src/index.ts"].map(
      (entry) =>
        build({
          entryPoints: [entry],
          bundle: true,
          write: false,
          format: "esm",
          target: "es2022",
          external: ["cloudflare:workers"],
          platform: "browser",
        }),
    ),
  );
  const runs = new Map<number, Run>(),
    files = new Map<string, Record<string, string>>();
  const pending = new Set<Promise<void>>();
  const errors: string[] = [];
  let nextRun = 100;
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  function later(fn: () => Promise<void>) {
    const p = new Promise<void>((r) => setTimeout(r, 150))
      .then(fn)
      .catch((e) => {
        errors.push(String(e));
        console.error("LOCAL FIXTURE PROVIDER:", e);
      })
      .finally(() => pending.delete(p));
    pending.add(p);
  }
  async function callback(value: Callback) {
    const body = JSON.stringify(value),
      time = String(Date.now()),
      nonce = randomBytes(16).toString("hex");
    const response = await mf.dispatchFetch(
      `${appOrigin}/api/internal/publish-result`,
      {
        method: "POST",
        headers: {
          "X-BYGA-Time": time,
          "X-BYGA-Nonce": nonce,
          "X-BYGA-Signature": await hmac(
            callbackSecret,
            `${time}.${nonce}.${body}`,
          ),
        },
        body,
      },
    );
    if (!response.ok) throw new Error(await response.text());
  }
  const outbound = async (request: Request) => {
    const u = new URL(request.url),
      path = u.pathname;
    if (u.hostname !== "api.github.com")
      return reply({ message: "Local mock blocks external requests" }, 403);
    const source = path.match(
      /^\/repos\/fixture\/(html|vite|monorepo|broken|private)(.*)$/,
    );
    if (source) {
      const repo = source[1],
        rest = decodeURIComponent(source[2]);
      if (!rest)
        return reply({
          private: repo === "private",
          default_branch: "main",
          size: 100,
          full_name: `fixture/${repo}`,
        });
      if (rest.startsWith("/commits/")) return reply({ sha: fixtureSha });
      const sourceRoot = resolve(
        "fixtures",
        repo === "monorepo" ? "monorepo" : repo === "vite" ? "vite" : "html",
      );
      if (rest.startsWith("/git/trees/")) {
        const walk = async (dir: string, prefix = ""): Promise<string[]> =>
          (
            await Promise.all(
              (await readdir(dir, { withFileTypes: true }))
                .filter((e) => !["node_modules", "dist"].includes(e.name))
                .map((e) =>
                  e.isDirectory()
                    ? walk(resolve(dir, e.name), prefix + e.name + "/")
                    : Promise.resolve([prefix + e.name]),
                ),
            )
          ).flat();
        const paths = await walk(sourceRoot);
        if (repo === "vite" || repo === "monorepo")
          paths.push("package-lock.json");
        return reply({
          truncated: false,
          tree: paths.map((path) => ({ path, type: "blob", mode: "100644" })),
        });
      }
      if (rest.startsWith("/contents/")) {
        const path = rest.slice("/contents/".length);
        try {
          const data =
            path === "package-lock.json"
              ? Buffer.from('{"lockfileVersion":3}')
              : await readFile(resolve(sourceRoot, path));
          return reply({
            content: data.toString("base64"),
            encoding: "base64",
            size: data.length,
          });
        } catch {
          return reply({}, 404);
        }
      }
      if (rest === "/branches")
        return reply([{ name: "main", commit: { sha: fixtureSha } }]);
      if (rest === "/tags") return reply([]);
      return reply({}, 404);
    }
    const workflow = path.match(
      /\/actions\/workflows\/([^/]+)\.yml\/(dispatches|runs)$/,
    );
    if (workflow) {
      const kind = workflow[1];
      if (workflow[2] === "runs")
        return reply({
          workflow_runs: [...runs.values()]
            .filter((r) => r.path.endsWith(`/${kind}.yml`))
            .reverse(),
        });
      const { inputs } = (await request.json()) as {
        inputs: Record<string, string>;
      };
      const id = ++nextRun,
        generation = Number(inputs.generation || 0);
      const run: Run = {
        id,
        display_title: `byga-${kind === "build-untrusted" ? "build" : kind === "publish-trusted" ? "publish" : "validate"}:${inputs.job_id}:${kind === "preview-validation" ? generation : 0}`,
        head_sha: trustedSha,
        path: `.github/workflows/${kind}.yml`,
        event: "workflow_dispatch",
        status: "in_progress",
        conclusion: null,
        run_attempt: 1,
      };
      runs.set(id, run);
      later(async () => {
        if (kind === "build-untrusted") {
          const b = JSON.parse(
            await (
              await mf.dispatchFetch(
                `${appOrigin}/api/builds/${inputs.job_id}`,
                { headers: authHeaders },
              )
            ).text(),
          ).data as Build;
          if (!b) throw new Error("Cannot load local fixture job");
          if (b.analysis.repo === "broken") {
            run.status = "completed";
            run.conclusion = "failure";
            return;
          }
          const fixture =
            b.analysis.repo === "vite"
              ? "fixtures/vite/dist"
              : b.analysis.repo === "monorepo"
                ? `fixtures/monorepo/${b.config.root}/dist`
                : "fixtures/html";
          const { stdout } = await execute(
            "python3",
            [
              "scripts/fixture_artifact.py",
              fixture,
              b.id,
              b.analysis.sha,
              b.configHash,
            ],
            { maxBuffer: 10 * 1024 * 1024 },
          );
          files.set(b.id, JSON.parse(stdout));
          run.status = "completed";
          run.conclusion = "success";
        } else {
          const queue = (
            await mf.getDurableObjectNamespace("QUEUE", "control")
          ).getByName("personal-v1");
          // plan() stays behind HMAC even in the local provider.
          const body = JSON.stringify({
              jobId: inputs.job_id,
              kind: kind === "publish-trusted" ? "publish" : "validate",
              generation,
            }),
            time = String(Date.now()),
            nonce = randomBytes(16).toString("hex");
          const response = await mf.dispatchFetch(
            `${appOrigin}/api/internal/plan`,
            {
              method: "POST",
              headers: {
                "X-BYGA-Time": time,
                "X-BYGA-Nonce": nonce,
                "X-BYGA-Signature": await hmac(
                  callbackSecret,
                  `${time}.${nonce}.${body}`,
                ),
              },
              body,
            },
          );
          const plan = (await response.json()) as {
            data: { build: Build; prefix: string; previewUrl: string };
          };
          if (!response.ok) throw new Error(JSON.stringify(plan));
          const b = plan.data.build,
            bucket = await mf.getR2Bucket("BUCKET", "control");
          if (kind === "publish-trusted") {
            let bytes = 0;
            for (const [path, encoded] of Object.entries(
              files.get(b.id) || {},
            )) {
              const content = Buffer.from(encoded, "base64");
              bytes += content.length;
              await bucket.put(`${plan.data.prefix}/${path}`, content);
            }
            await callback({
              jobId: b.id,
              runId: id,
              sha: b.analysis.sha,
              configHash: b.configHash,
              generation,
              kind: "published",
              bytes,
            });
          } else if (validate) {
            const output = resolve("test-results/local-validation", b.id);
            const report = await smoke(plan.data.previewUrl, output);
            for (const file of ["desktop.png", "mobile.png"])
              await bucket.put(
                `evidence/${b.id}/${generation}/${file}`,
                await readFile(resolve(output, file)),
              );
            await callback({
              jobId: b.id,
              runId: id,
              sha: b.analysis.sha,
              configHash: b.configHash,
              generation,
              kind: "validated",
              report,
            });
          } else {
            run.status = "in_progress";
            return;
          }
          await queue.fetch("https://test/tick");
          run.status = "completed";
          run.conclusion = "success";
        }
      });
      // Exercise both current dispatch responses and legacy 204 reconciliation.
      return id % 2 === 0
        ? reply({ workflow_run_id: id })
        : new Response(null, { status: 204 });
    }
    const runMatch = path.match(/\/actions\/runs\/(\d+)(\/cancel)?$/);
    if (runMatch) {
      const run = runs.get(Number(runMatch[1]));
      if (!run) return reply({}, 404);
      if (runMatch[2]) {
        run.status = "completed";
        run.conclusion = "cancelled";
        return new Response(null, { status: 204 });
      }
      return reply(run);
    }
    return reply({}, 404);
  };
  const mf = new Miniflare({
    workers: [
      {
        name: "control",
        modules: true,
        script: control.outputFiles[0].text,
        compatibilityDate: "2026-07-30",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: {
          QUEUE: { className: "TestCoordinator", useSQLite: true },
        },
        r2Buckets: { BUCKET: "byga-fixture-bucket" },
        bindings: {
          APP_ORIGIN: appOrigin,
          PREVIEW_ORIGIN: previewOrigin,
          PREVIEW_BASE_DOMAIN: "",
          GITHUB_OWNER: "fixture",
          GITHUB_ORCHESTRATOR_REPO: "orchestrator",
          GITHUB_TRUSTED_REF: trustedSha,
          GITHUB_WORKFLOW_REF: "byga-v1",
          GITHUB_DISPATCH_TOKEN: randomBytes(20).toString("hex"),
          ADMIN_PASSWORD_HASH: passwordHash,
          SESSION_SIGNING_KEY: randomBytes(32).toString("hex"),
          PUBLISH_CALLBACK_SECRET: callbackSecret,
          AUTH_CPU_VERIFIED: "true",
          BUILDS_ENABLED: "true",
        },
        outboundService: outbound,
      },
      {
        name: "preview",
        modules: true,
        script: preview.outputFiles[0].text,
        compatibilityDate: "2026-07-30",
        compatibilityFlags: ["nodejs_compat"],
        r2Buckets: { BUCKET: "byga-fixture-bucket" },
        bindings: {
          APP_ORIGIN: appOrigin,
          PREVIEW_ORIGIN: previewOrigin,
          PREVIEW_BASE_DOMAIN: "",
        },
        serviceBindings: {
          ACCESS: { name: "control", entrypoint: "PreviewAccess" },
        },
      },
    ],
  });
  await mf.ready;
  let authHeaders: Record<string, string> = {};
  async function login() {
    const r = await mf.dispatchFetch(`${appOrigin}/api/auth/login`, {
      method: "POST",
      headers: { Origin: appOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = (await r.json()) as { data?: { csrf: string } };
    if (!r.ok || !data.data)
      throw new Error(`Local login failed: ${JSON.stringify(data)}`);
    authHeaders = {
      Cookie: r.headers.get("set-cookie")!.split(";")[0],
      Origin: appOrigin,
      "X-CSRF-Token": data.data.csrf,
      "Content-Type": "application/json",
    };
    return authHeaders;
  }
  const queue = (
    await mf.getDurableObjectNamespace("QUEUE", "control")
  ).getByName("personal-v1");
  return {
    mf,
    password,
    runs,
    errors,
    callbackSecret,
    appOrigin,
    previewOrigin,
    login,
    tick: () => queue.fetch("https://test/tick"),
    expire: (id: string) => queue.fetch(`https://test/expire?id=${id}`),
    request: (path: string, method = "GET", body?: unknown) =>
      mf.dispatchFetch(`${appOrigin}/api${path}`, {
        method,
        headers: authHeaders,
        body: body ? JSON.stringify(body) : undefined,
      }),
    async preview(path: string) {
      return (await mf.getWorker("preview")).fetch(previewOrigin + path);
    },
    async dispose() {
      await Promise.all([...pending]);
      await mf.dispose();
    },
  };
}
