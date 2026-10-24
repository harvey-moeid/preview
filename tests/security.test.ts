import { describe, expect, it } from "vitest";
import { profileFor } from "../packages/repo-analyzer/src/profiles";
import { parseGitHubUrl, GitHub } from "../packages/repo-analyzer/src/index";
import {
  configSchema,
  expiry,
  fingerprint,
  isAccessible,
  sanitize,
  type Analysis,
  type Preview,
} from "../packages/shared/src/index";
import {
  manifestSchema,
  safeAssetPath,
} from "../packages/build-manifest/src/index";
import {
  hmac,
  requireOrigin,
  verifySignature,
} from "../packages/shared/src/auth";

describe("security feasibility gate", () => {
  it.each(["next", "nuxt", "@sveltejs/kit"])(
    "keeps %s gated even when Vite is present",
    (dependency) => {
      expect(profileFor({ [dependency]: "1", vite: "1" }, true).runtime).toBe(
        "disabled",
      );
    },
  );
  it.each([
    "https://github.com.evil.test/o/r",
    "https://github.com@evil.test/o/r",
    "http://github.com/o/r",
    "https://127.0.0.1/o/r",
    "https://github.com/o/r/../x",
    "https://github.com/o/r/tree/main/%2e%2e",
    "https://github.com/o/r?x=1",
    "https://github.com/o/r/tree/$(id)",
    "https://github.com/o/r\\evil",
    "https://github.com/o/r/tree/a%2fb",
    "https://github.com/o/r/issues",
  ])("rejects URL injection %s", (input) =>
    expect(() => parseGitHubUrl(input)).toThrow(),
  );
  it("canonicalizes repository and recognizes ref subfolder", () => {
    expect(parseGitHubUrl("https://github.com/Owner/repo.git/")).toEqual({
      owner: "Owner",
      repo: "repo",
    });
    expect(
      parseGitHubUrl("https://github.com/o/r/tree/feature/ui/apps/web"),
    ).toEqual({ owner: "o", repo: "r", tail: "feature/ui/apps/web" });
  });
  it("refuses private repos", async () => {
    const gh = new GitHub(async () => Response.json({ private: true }));
    await expect(gh.analyze("https://github.com/o/r")).rejects.toMatchObject({
      code: "PRIVATE_REPO",
    });
  });
  it.each([
    "../index.html",
    "/index.html",
    "x/../../a.js",
    "_worker.js",
    "functions/a.js",
    "a/functions/b.js",
    "x.sh",
    ".env",
    "index.html%00",
    "x\\a.html",
    "a//b.js",
  ])("blocks unsafe artifact %s", (path) =>
    expect(safeAssetPath(path)).toBe(false),
  );
  it("rejects duplicate manifest paths and missing index", () => {
    const file = { path: "index.html", size: 1, sha256: "a".repeat(64) };
    expect(
      manifestSchema.safeParse({
        version: 1,
        jobId: "a".repeat(32),
        sha: "b".repeat(40),
        configHash: "c".repeat(64),
        files: [file, file],
      }).success,
    ).toBe(false);
  });
  it("enforces retention and deletion independently of asset storage", () => {
    const p = {
      status: "ready",
      deletedAt: null,
      expiresAt: expiry("1", 1000),
    } as Preview;
    expect(isAccessible(p, 1001)).toBe(true);
    expect(isAccessible(p, 86401001)).toBe(false);
    expect(isAccessible({ ...p, expiresAt: null }, 1e15)).toBe(true);
    expect(isAccessible({ ...p, deletedAt: 2 }, 3)).toBe(false);
    for (const days of ["1", "7", "30"] as const)
      expect(expiry(days, 0)).toBe(Number(days) * 86400000);
  });
  it("binds cache to SHA, application and toolchain config", async () => {
    const a = {
        owner: "o",
        repo: "r",
        sha: "a".repeat(40),
        candidates: [{ root: ".", lockDigest: "lock" }],
      } as Analysis,
      c = configSchema.parse({});
    const key = await fingerprint(a, c);
    expect(await fingerprint(a, c)).toBe(key);
    expect(await fingerprint({ ...a, sha: "b".repeat(40) }, c)).not.toBe(key);
    expect(await fingerprint(a, { ...c, root: "apps/web" })).not.toBe(key);
  });
  it("blocks cross-origin mutations", () => {
    expect(() =>
      requireOrigin(
        new Request("https://app.test", {
          headers: { Origin: "https://preview.test" },
        }),
        "https://app.test",
      ),
    ).toThrow();
  });
  it("checks HMAC, timestamp and body integrity", async () => {
    const secret = "test-only-secret",
      body = "{}",
      time = String(Date.now()),
      nonce = "a".repeat(32);
    const req = new Request("https://app.test", {
      headers: {
        "X-BYGA-Time": time,
        "X-BYGA-Nonce": nonce,
        "X-BYGA-Signature": await hmac(secret, `${time}.${nonce}.${body}`),
      },
    });
    expect(await verifySignature(req, body, secret)).toBe(nonce);
    await expect(
      verifySignature(req, '{"tampered":true}', secret),
    ).rejects.toThrow();
    await expect(
      verifySignature(req, body, secret, Number(time) + 300001),
    ).rejects.toThrow();
  });
  it("redacts token-like diagnostics", () =>
    expect(sanitize("token=abc ghp_thisIsNotARealToken")).toBe(
      "token=[REDACTED] [REDACTED]",
    ));
});
