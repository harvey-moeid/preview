import { z } from "zod";
import { idSchema, shaSchema } from "../../shared/src/index";
export const mimeTypes: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  txt: "text/plain; charset=utf-8",
  webmanifest: "application/manifest+json",
  wasm: "application/wasm",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  avif: "image/avif",
};
export function canonicalStaticPath(path: string) {
  const parts = path.split("/");
  return (
    path.length <= 240 &&
    /^[a-zA-Z0-9_./@+ -]+$/.test(path) &&
    !path.startsWith("/") &&
    parts.every(
      (p) =>
        !!p &&
        p !== "." &&
        p !== ".." &&
        !p.startsWith(".") &&
        ![
          "_worker.js",
          "functions",
          "_headers",
          "_redirects",
          "node_modules",
        ].includes(p.toLowerCase()),
    )
  );
}
export function safeAssetPath(path: string) {
  return (
    canonicalStaticPath(path) &&
    !!mimeTypes[path.split(".").pop()?.toLowerCase() || ""]
  );
}
export const manifestSchema = z
  .object({
    version: z.literal(1),
    jobId: idSchema,
    sha: shaSchema,
    configHash: z.string().regex(/^[a-f0-9]{64}$/),
    files: z
      .array(
        z
          .object({
            path: z.string().refine(safeAssetPath),
            size: z.number().int().min(0).max(26214400),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .min(1)
      .max(5000),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (
      m.files.reduce((n, f) => n + f.size, 0) > 104857600 ||
      new Set(m.files.map((f) => f.path)).size !== m.files.length ||
      !m.files.some((f) => f.path === "index.html")
    )
      ctx.addIssue({
        code: "custom",
        message: "Artifact size, uniqueness or index.html invalid",
      });
  });
