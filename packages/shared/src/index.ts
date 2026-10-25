import { z } from "zod";

export const idSchema = z.string().regex(/^[a-f0-9]{32}$/);
export const shaSchema = z.string().regex(/^[a-f0-9]{40}$/);
export const ttlSchema = z.enum(["1", "7", "30", "permanent"]);
export const relativePath = z
  .string()
  .max(240)
  .refine(
    (p) =>
      p === "." ||
      (/^[\w./@+-]+$/.test(p) &&
        !p.startsWith("/") &&
        p.split("/").every((s) => s !== ".." && s !== "" && s !== ".")),
    "Invalid relative path",
  );
export const configSchema = z
  .object({
    root: relativePath.default("."),
    output: relativePath.default("dist"),
    command: z.string().max(500).default("npm run build"),
    packageManager: z
      .enum(["none", "npm", "pnpm", "yarn", "bun"])
      .default("npm"),
    node: z.enum(["22", "24"]).default("22"),
    spa: z.boolean().default(true),
    adapter: z.literal("static-v1").default("static-v1"),
  })
  .strict();
export type BuildConfig = z.infer<typeof configSchema>;
export const submitSchema = z
  .object({
    analysisId: idSchema,
    config: configSchema,
    ttl: ttlSchema.default("7"),
  })
  .strict();
export const statuses = [
  "queued",
  "dispatching",
  "running",
  "publishing",
  "validating",
  "ready",
  "partial",
  "failed",
  "cancelling",
  "cancelled",
  "expired",
] as const;
export type Status = (typeof statuses)[number];
export type TTL = z.infer<typeof ttlSchema>;
export interface Candidate {
  root: string;
  framework: string;
  supported: boolean;
  reason?: string;
  config: BuildConfig;
  lockDigest: string;
}
export interface Analysis {
  id: string;
  owner: string;
  repo: string;
  url: string;
  ref: string;
  sha: string;
  defaultBranch: string;
  candidates: Candidate[];
  warnings: string[];
}
export interface Log {
  at: number;
  phase: string;
  message: string;
}
export interface Build {
  id: string;
  analysis: Analysis;
  config: BuildConfig;
  configHash: string;
  cacheKey: string;
  status: Status;
  ttl: TTL;
  previewId: string;
  runId?: number;
  publishRunId?: number;
  validationRunId?: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  error?: string;
  attempt: number;
  logs: Log[];
  validationGeneration: number;
}
export interface Preview {
  id: string;
  buildId: string;
  prefix: string;
  url: string;
  ttl: TTL;
  expiresAt: number | null;
  deletedAt: number | null;
  cleaned?: boolean;
  cleanupPending?: boolean;
  status: Status;
  spa: boolean;
  createdAt: number;
  report?: ValidationReport;
  bytes: number;
}
export interface ValidationReport {
  status: "ready" | "partial" | "failed";
  errors: string[];
  desktop: "desktop.png";
  mobile: "mobile.png";
  checkedAt: number;
}
export const reportSchema = z
  .object({
    status: z.enum(["ready", "partial", "failed"]),
    errors: z.array(z.string().max(500)).max(100),
    desktop: z.literal("desktop.png"),
    mobile: z.literal("mobile.png"),
    checkedAt: z.number(),
  })
  .strict();
export const callbackSchema = z
  .object({
    jobId: idSchema,
    runId: z.number().int().positive(),
    sha: shaSchema,
    configHash: z.string().regex(/^[a-f0-9]{64}$/),
    kind: z.enum(["published", "validated"]),
    generation: z.number().int().min(0),
    bytes: z.number().int().min(0).max(104857600).optional(),
    report: reportSchema.optional(),
  })
  .strict();
export type Callback = z.infer<typeof callbackSchema>;
export const activeStates: Status[] = [
  "dispatching",
  "running",
  "publishing",
  "validating",
  "cancelling",
];
export const terminalStates: Status[] = [
  "ready",
  "partial",
  "failed",
  "cancelled",
  "expired",
];
export function opaqueId() {
  return crypto.randomUUID().replaceAll("-", "");
}
export function expiry(ttl: TTL, now = Date.now()) {
  return ttl === "permanent" ? null : now + Number(ttl) * 86400000;
}
export function isAccessible(p: Preview, now = Date.now()) {
  return (
    !p.deletedAt &&
    (p.expiresAt === null || p.expiresAt > now) &&
    ["validating", "ready", "partial", "failed"].includes(p.status)
  );
}
export async function digest(value: string | ArrayBuffer) {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function fingerprint(a: Analysis, config: BuildConfig) {
  const candidate = a.candidates.find((c) => c.root === config.root);
  return digest(
    JSON.stringify([
      a.owner.toLowerCase(),
      a.repo.toLowerCase(),
      a.sha,
      candidate?.lockDigest,
      Object.entries(config).sort(([a], [b]) => a.localeCompare(b)),
      "toolchain-1",
    ]),
  );
}
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function sanitize(value: string) {
  return value
    .replace(/\b(?:gh[pousr]_[\w]+|github_pat_[\w]+)\b/g, "[REDACTED]")
    .replace(
      /(authorization|password|token|secret|api[_-]?key)\s*[:=]\s*\S+/gi,
      "$1=[REDACTED]",
    )
    .replace(/\x1b\[[0-9;]*m/g, "")
    .slice(0, 10000);
}
export function result(data: unknown, status = 200) {
  return Response.json(
    { success: true, data, requestId: crypto.randomUUID() },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
export function isAppError(e: unknown): e is AppError {
  return (
    e instanceof AppError ||
    (e instanceof Error &&
      "code" in e &&
      typeof e.code === "string" &&
      /^[A-Z_]+$/.test(e.code) &&
      "status" in e &&
      typeof e.status === "number" &&
      e.status >= 400 &&
      e.status <= 599)
  );
}
export function failure(e: unknown) {
  const known = isAppError(e);
  return Response.json(
    {
      success: false,
      error: {
        code: known ? e.code : "INTERNAL_ERROR",
        message: known ? sanitize(e.message) : "Unexpected server error",
      },
      requestId: crypto.randomUUID(),
    },
    {
      status: known ? e.status : 500,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
export async function boundedText(response: Response, max = 1048576) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max)
        throw new AppError("SIZE_LIMIT", "Response exceeds limit", 413);
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(bytes);
}
export async function readJson(
  request: Request,
  max = 32768,
): Promise<unknown> {
  try {
    return JSON.parse(await boundedText(new Response(request.body), max));
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("INVALID_JSON", "Invalid JSON");
  }
}
