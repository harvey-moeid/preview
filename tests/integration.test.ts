import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createLocalRuntime } from "../scripts/local-runtime";
import { hmac } from "../packages/shared/src/auth";
import type { Analysis, Build, Preview } from "../packages/shared/src/index";
let r: Awaited<ReturnType<typeof createLocalRuntime>>;
const data = async <T>(response: {
  status: number;
  json(): Promise<unknown>;
}): Promise<T> => {
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBeLessThan(300);
  return (body as { data: T }).data;
};
beforeAll(async () => {
  r = await createLocalRuntime();
  await r.login();
});
afterAll(async () => {
  if (r) await r.dispose();
});
describe.sequential(
  "production API and SQLite coordinator in local workerd",
  () => {
    let analysis: Analysis, b: Build, p: Preview;
    it("requires sessions, strict origins and CSRF", async () => {
      expect(
        (await r.mf.dispatchFetch(`${r.appOrigin}/api/builds`)).status,
      ).toBe(401);
      expect(
        (
          await r.mf.dispatchFetch(`${r.appOrigin}/api/builds`, {
            method: "POST",
            headers: { Origin: r.previewOrigin },
            body: "{}",
          })
        ).status,
      ).toBe(403);
      const session = await data<{ csrf: string }>(await r.request("/auth/me"));
      expect(session.csrf.length).toBe(32);
      const cookie = await r.login();
      expect(cookie.Cookie).toContain("__Host-byga_session=");
      expect(
        (
          await r.mf.dispatchFetch(`${r.appOrigin}/api/builds`, {
            method: "POST",
            headers: { Origin: r.appOrigin, Cookie: cookie.Cookie },
            body: "{}",
          })
        ).status,
      ).toBe(403);
    });
    it("analyzes public HTML, Vite and monorepo fixture metadata; rejects private", async () => {
      analysis = await data<Analysis>(
        await r.request("/repo/analyze", "POST", {
          url: "https://github.com/fixture/html",
        }),
      );
      expect(analysis.sha).toHaveLength(40);
      expect(analysis.candidates[0].framework).toBe("HTML");
      const vite = await data<Analysis>(
        await r.request("/repo/analyze", "POST", {
          url: "https://github.com/fixture/vite",
        }),
      );
      expect(vite.candidates[0].framework).toBe("Vite");
      const mono = await data<Analysis>(
        await r.request("/repo/analyze", "POST", {
          url: "https://github.com/fixture/monorepo",
        }),
      );
      expect(mono.candidates.map((c) => c.root)).toContain("apps/web");
      expect(
        (
          await r.request("/repo/analyze", "POST", {
            url: "https://github.com/fixture/private",
          })
        ).status,
      ).toBe(403);
    });
    it("atomically deduplicates concurrent submissions, runs one slot and supports queue cancellation", async () => {
      const input = {
        analysisId: analysis.id,
        config: analysis.candidates[0].config,
        ttl: "7",
      };
      const results = await Promise.all(
        Array.from({ length: 4 }, async () =>
          data<{ build: Build }>(await r.request("/builds", "POST", input)),
        ),
      );
      expect(new Set(results.map((r) => r.build.id)).size).toBe(1);
      b = results[0].build;
      const second = await data<{ build: Build }>(
        await r.request("/builds", "POST", {
          ...input,
          config: { ...input.config, spa: true },
        }),
      );
      await r.tick();
      const builds = await data<Build[]>(await r.request("/builds"));
      expect(
        builds.filter((b) =>
          ["dispatching", "running", "publishing"].includes(b.status),
        ),
      ).toHaveLength(1);
      expect(
        (await data<Build>(await r.request(`/builds/${second.build.id}`)))
          .status,
      ).toBe("queued");
      expect(
        (
          await data<Build>(
            await r.request(`/builds/${second.build.id}/cancel`, "POST"),
          )
        ).status,
      ).toBe("cancelled");
    });
    it("scans actual fixture bytes before mock publish and serves isolated preview assets", async () => {
      for (let i = 0; i < 12; i++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        await r.tick();
        b = await data<Build>(await r.request(`/builds/${b.id}`));
        if (b.status === "validating") break;
      }
      expect(r.errors).toEqual([]);
      expect(b.status).toBe("validating");
      p = (await data<Preview[]>(await r.request("/previews"))).find(
        (p) => p.buildId === b.id,
      )!;
      expect(p).toBeDefined();
      const response = await r.preview(`/p/${p.id}/`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("Hello, possibility.");
      expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Content-Security-Policy")).toContain(
        "sandbox",
      );
      expect(response.headers.get("Set-Cookie")).toBeNull();
      expect((await r.preview(`/p/${p.id}/app.js`)).status).toBe(200);
    });
    it("blocks tampered and replayed HMAC callbacks and immutable mismatches", async () => {
      const value = {
        jobId: b.id,
        runId: b.runId,
        sha: "e".repeat(40),
        configHash: b.configHash,
        kind: "published",
        generation: 0,
      };
      const body = JSON.stringify(value),
        time = String(Date.now()),
        nonce = "f".repeat(32),
        signature = await hmac(r.callbackSecret, `${time}.${nonce}.${body}`);
      const headers = {
        "X-BYGA-Time": time,
        "X-BYGA-Nonce": nonce,
        "X-BYGA-Signature": signature,
      };
      expect(
        (
          await r.mf.dispatchFetch(
            `${r.appOrigin}/api/internal/publish-result`,
            { method: "POST", headers, body: body + " " },
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await r.mf.dispatchFetch(
            `${r.appOrigin}/api/internal/publish-result`,
            { method: "POST", headers, body },
          )
        ).status,
      ).toBe(409);
      const replay = await r.mf.dispatchFetch(
        `${r.appOrigin}/api/internal/publish-result`,
        { method: "POST", headers, body },
      );
      expect(
        ((await replay.json()) as { error: { code: string } }).error.code,
      ).toBe("REPLAY");
    });
    it("edits all TTL modes, enforces expiry on direct URL and revokes before storage cleanup", async () => {
      for (const ttl of ["1", "7", "30", "permanent"]) {
        const updated = await data<Preview>(
          await r.request(`/previews/${p.id}`, "PATCH", { ttl }),
        );
        expect(updated.expiresAt === null).toBe(ttl === "permanent");
      }
      await r.expire(p.id);
      expect((await r.preview(`/p/${p.id}/`)).status).toBe(410);
      await r.request(`/previews/${p.id}`, "PATCH", { ttl: "permanent" });
      expect((await r.preview(`/p/${p.id}/`)).status).toBe(200);
      await r.request(`/previews/${p.id}`, "DELETE");
      expect((await r.preview(`/p/${p.id}/app.js`)).status).toBe(410);
      const bucket = await r.mf.getR2Bucket("BUCKET", "control");
      expect(await bucket.get(`${p.prefix}/index.html`)).not.toBeNull();
      await r.tick();
      expect(await bucket.get(`${p.prefix}/index.html`)).toBeNull();
    });
    it("invalidates logout and rate-limits failed login", async () => {
      await r.request("/auth/logout", "POST");
      expect((await r.request("/auth/me")).status).toBe(401);
      for (let i = 0; i < 5; i++)
        expect(
          (
            await r.mf.dispatchFetch(`${r.appOrigin}/api/auth/login`, {
              method: "POST",
              headers: { Origin: r.appOrigin },
              body: JSON.stringify({ password: "wrong-password" }),
            })
          ).status,
        ).toBe(401);
      expect(
        (
          await r.mf.dispatchFetch(`${r.appOrigin}/api/auth/login`, {
            method: "POST",
            headers: { Origin: r.appOrigin },
            body: JSON.stringify({ password: "wrong-password" }),
          })
        ).status,
      ).toBe(429);
    });
  },
);
