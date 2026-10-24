import { DurableObject } from "cloudflare:workers";
import {
  activeStates,
  AppError,
  digest,
  expiry,
  fingerprint,
  isAccessible,
  opaqueId,
  sanitize,
  type Analysis,
  type Build,
  type BuildConfig,
  type Callback,
  type Preview,
  type Status,
  type TTL,
} from "../../../packages/shared/src/index";
import { Actions } from "./github-actions";
import { verifyPassword } from "../../../packages/shared/src/auth";
import type { ControlEnv } from "./env";

export class Coordinator extends DurableObject<ControlEnv> {
  constructor(ctx: DurableObjectState, env: ControlEnv) {
    super(ctx, env);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,status TEXT,cache_key TEXT,created INTEGER NOT NULL,expires INTEGER,PRIMARY KEY(kind,id)); CREATE INDEX IF NOT EXISTS record_queue ON records(kind,status,created); CREATE INDEX IF NOT EXISTS record_cache ON records(kind,cache_key); CREATE INDEX IF NOT EXISTS record_expiry ON records(kind,expires); CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS login_limits(key TEXT PRIMARY KEY,attempts INTEGER NOT NULL,reset INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS nonces(id TEXT PRIMARY KEY,expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,event TEXT NOT NULL,target TEXT,at INTEGER NOT NULL);`,
    );
  }
  private rows<T>(kind: string): T[] {
    return this.ctx.storage.sql
      .exec<{ json: string }>(
        "SELECT json FROM records WHERE kind=? ORDER BY created DESC LIMIT 200",
        kind,
      )
      .toArray()
      .map((r) => JSON.parse(r.json) as T);
  }
  private get<T>(kind: string, id: string): T | undefined {
    const row = this.ctx.storage.sql
      .exec<{ json: string }>(
        "SELECT json FROM records WHERE kind=? AND id=?",
        kind,
        id,
      )
      .toArray()[0];
    return row ? (JSON.parse(row.json) as T) : undefined;
  }
  private cleanupCandidate(): Preview | undefined {
    const row = this.ctx.storage.sql
      .exec<{ json: string }>(
        "SELECT json FROM records WHERE kind='preview' AND (json_extract(json,'$.cleanupPending')=1 OR (COALESCE(json_extract(json,'$.cleaned'),0)=0 AND (expires<=? OR json_extract(json,'$.deletedAt') IS NOT NULL))) ORDER BY created LIMIT 1",
        Date.now(),
      )
      .toArray()[0];
    return row ? (JSON.parse(row.json) as Preview) : undefined;
  }
  private save(
    kind: string,
    value: {
      id: string;
      status?: string;
      cacheKey?: string;
      createdAt?: number;
      expiresAt?: number | null;
    },
  ) {
    this.ctx.storage.sql.exec(
      "INSERT INTO records(kind,id,json,status,cache_key,created,expires) VALUES(?,?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json,status=excluded.status,cache_key=excluded.cache_key,expires=excluded.expires",
      kind,
      value.id,
      JSON.stringify(value),
      value.status ?? null,
      value.cacheKey ?? null,
      value.createdAt ?? Date.now(),
      value.expiresAt ?? null,
    );
  }
  private audit(event: string, target: string) {
    this.ctx.storage.sql.exec(
      "INSERT INTO audit(event,target,at) VALUES(?,?,?)",
      event,
      target,
      Date.now(),
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM audit WHERE id < (SELECT COALESCE(MAX(id),0)-1000 FROM audit)",
    );
  }
  private log(b: Build, status: Status, message: string) {
    b.status = status;
    b.updatedAt = Date.now();
    b.logs = [
      ...b.logs.slice(-199),
      { at: b.updatedAt, phase: status, message: sanitize(message) },
    ];
    this.save("build", b);
    this.audit(status, b.id);
  }
  private async schedule(delay = 1000) {
    const alarm = await this.ctx.storage.getAlarm();
    const next = Date.now() + delay;
    if (!alarm || alarm > next) await this.ctx.storage.setAlarm(next);
  }
  async login(key: string, password: string) {
    const now = Date.now();
    this.ctx.storage.sql.exec("DELETE FROM login_limits WHERE reset < ?", now);
    for (const k of [key, "global"]) {
      const row = this.ctx.storage.sql
        .exec<{ attempts: number; reset: number }>(
          "SELECT attempts,reset FROM login_limits WHERE key=?",
          k,
        )
        .toArray()[0];
      if (row && row.attempts >= (k === "global" ? 20 : 5))
        throw new AppError(
          "LOGIN_RATE_LIMIT",
          "Too many attempts; wait 15 minutes",
          429,
        );
    }
    // Reserve attempts before the asynchronous KDF so concurrent requests cannot bypass limits.
    for (const k of [key, "global"])
      this.ctx.storage.sql.exec(
        "INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1",
        k,
        now + 900000,
      );
    if (this.env.AUTH_CPU_VERIFIED !== "true")
      throw new AppError(
        "AUTH_CPU_GATE",
        "Password KDF CPU benchmark must be verified before login is enabled",
        503,
      );
    if (!(await verifyPassword(password, this.env.ADMIN_PASSWORD_HASH || ""))) {
      this.audit("login_failed", key);
      throw new AppError("INVALID_PASSWORD", "Invalid password", 401);
    }
    this.ctx.storage.sql.exec("DELETE FROM login_limits WHERE key=?", key);
    const token = opaqueId() + opaqueId(),
      csrf = opaqueId();
    this.ctx.storage.sql.exec(
      "INSERT INTO sessions VALUES(?,?,?)",
      await digest(token),
      csrf,
      now + 43200000,
    );
    this.audit("login_success", "admin");
    await this.schedule(3600000);
    return { token, csrf };
  }
  async session(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    return (
      this.ctx.storage.sql
        .exec<{ csrf: string }>(
          "SELECT csrf FROM sessions WHERE hash=? AND expires>?",
          await digest(token),
          Date.now(),
        )
        .toArray()[0] ?? null
    );
  }
  async logout(token: string) {
    this.ctx.storage.sql.exec(
      "DELETE FROM sessions WHERE hash=?",
      await digest(token),
    );
    this.audit("logout", "admin");
  }
  storeAnalysis(a: Analysis) {
    this.save("analysis", a);
    this.ctx.storage.sql.exec(
      "DELETE FROM records WHERE kind='analysis' AND created<?",
      Date.now() - 86400000,
    );
    return a;
  }
  analysis(id: string) {
    const a = this.get<Analysis>("analysis", id);
    if (!a)
      throw new AppError(
        "ANALYSIS_NOT_FOUND",
        "Analyze this repository again",
        404,
      );
    return a;
  }
  listBuilds() {
    return this.rows<Build>("build");
  }
  build(id: string) {
    const b = this.get<Build>("build", id);
    if (!b) throw new AppError("BUILD_NOT_FOUND", "Build not found", 404);
    return b;
  }
  listPreviews() {
    return this.rows<Preview>("preview").map((p) => ({
      ...p,
      status: !isAccessible(p) ? ("expired" as const) : p.status,
    }));
  }
  preview(id: string) {
    return this.get<Preview>("preview", id) ?? null;
  }
  access(id: string) {
    const p = this.preview(id);
    if (!p || !isAccessible(p)) return null;
    return { id: p.id, prefix: p.prefix, spa: p.spa, expiresAt: p.expiresAt };
  }
  async enqueue(
    analysisId: string,
    config: BuildConfig,
    ttl: TTL,
    attempt = 0,
  ) {
    if (this.env.BUILDS_ENABLED !== "true")
      throw new AppError(
        "BUILDS_DISABLED",
        "Complete security/setup gates before enabling external builds",
        503,
      );
    const a = this.analysis(analysisId),
      candidate = a.candidates.find((c) => c.root === config.root);
    if (!candidate || !candidate.supported)
      throw new AppError(
        "UNSUPPORTED_RUNTIME",
        candidate?.reason || "Select an analyzed static application",
        422,
      );
    if (config.packageManager === "none" && config.command)
      throw new AppError(
        "LOCK_REQUIRED",
        "A lockfile-backed package manager is required for commands",
      );
    if (config.packageManager === "bun")
      throw new AppError(
        "UNSUPPORTED_TOOLCHAIN",
        "Bun is detected but not enabled on this runner",
        422,
      );
    const key = await fingerprint(a, config);
    // Re-read after hashing: DO requests may interleave at awaits.
    const builds = this.listBuilds();
    const duplicate = builds.find(
      (b) =>
        b.cacheKey === key && [...activeStates, "queued"].includes(b.status),
    );
    if (duplicate) return { build: duplicate, deduped: true, cacheHit: false };
    const cached = builds.find(
      (b) =>
        b.cacheKey === key &&
        ["ready", "partial"].includes(b.status) &&
        this.access(b.previewId),
    );
    if (cached) {
      await this.updatePreview(cached.previewId, ttl);
      return { build: cached, cacheHit: true, deduped: false };
    }
    if (builds.filter((b) => b.status === "queued").length >= 10)
      throw new AppError("QUEUE_FULL", "Queue limit is 10", 429);
    const now = Date.now(),
      configHash = await digest(
        JSON.stringify(
          Object.entries(config).sort(([a], [b]) => a.localeCompare(b)),
        ),
      );
    // Hashing can yield; a synchronous final reservation prevents duplicate active/queued records.
    const concurrent = this.listBuilds().find(
      (b) =>
        b.cacheKey === key && [...activeStates, "queued"].includes(b.status),
    );
    if (concurrent)
      return { build: concurrent, deduped: true, cacheHit: false };
    if (this.listBuilds().filter((b) => b.status === "queued").length >= 10)
      throw new AppError("QUEUE_FULL", "Queue limit is 10", 429);
    const b: Build = {
      id: opaqueId(),
      analysis: a,
      config,
      configHash,
      cacheKey: key,
      status: "queued",
      ttl,
      previewId: opaqueId(),
      createdAt: now,
      updatedAt: now,
      attempt,
      logs: [],
      validationGeneration: 0,
    };
    this.log(b, "queued", "Pinned source SHA; waiting for a free build slot");
    await this.schedule();
    return { build: b, cacheHit: false, deduped: false };
  }
  async cancel(id: string) {
    const b = this.build(id);
    if (
      ["cancelled", "failed", "ready", "partial", "expired"].includes(b.status)
    )
      return b;
    this.log(
      b,
      b.status === "queued" ? "cancelled" : "cancelling",
      "Admin requested cancellation",
    );
    await this.schedule();
    return b;
  }
  async retry(id: string) {
    const b = this.build(id);
    if (!["failed", "cancelled"].includes(b.status) || b.attempt >= 1)
      throw new AppError(
        "RETRY_LIMIT",
        "Retry once for failed/cancelled jobs; otherwise analyze and start a new manual build",
        409,
      );
    return this.enqueue(b.analysis.id, b.config, b.ttl, b.attempt + 1);
  }
  async updatePreview(id: string, ttl?: TTL, remove = false) {
    const p = this.preview(id);
    if (!p) throw new AppError("PREVIEW_NOT_FOUND", "Preview not found", 404);
    if (p.deletedAt || p.cleaned)
      throw new AppError(
        "PREVIEW_DELETED",
        "Deleted/cleaned previews cannot be restored",
        410,
      );
    if (remove) p.deletedAt = Date.now();
    else {
      p.ttl = ttl!;
      p.expiresAt = expiry(ttl!);
    }
    this.save("preview", p);
    this.audit(remove ? "preview_deleted" : "ttl_changed", id);
    await this.schedule();
    return p;
  }
  async validateAgain(id: string) {
    const p = this.preview(id);
    if (!p || !this.access(id))
      throw new AppError("PREVIEW_EXPIRED", "Preview is unavailable", 410);
    if (this.listBuilds().some((b) => activeStates.includes(b.status)))
      throw new AppError(
        "BUILD_ACTIVE",
        "Wait for the active pipeline to finish",
        409,
      );
    const b = this.build(p.buildId);
    b.validationGeneration++;
    b.validationRunId = undefined;
    b.startedAt = Date.now();
    p.report = undefined;
    p.status = "validating";
    this.save("preview", p);
    this.log(b, "validating", "Admin requested browser validation only");
    await this.schedule();
    return b;
  }
  consumeNonce(nonce: string) {
    this.ctx.storage.sql.exec("DELETE FROM nonces WHERE expires<?", Date.now());
    if (
      this.ctx.storage.sql
        .exec("SELECT id FROM nonces WHERE id=?", nonce)
        .toArray().length
    )
      throw new AppError("REPLAY", "Callback already used", 409);
    this.ctx.storage.sql.exec(
      "INSERT INTO nonces VALUES(?,?)",
      nonce,
      Date.now() + 300000,
    );
  }
  plan(id: string, kind: string, generation: number) {
    const b = this.build(id);
    if (
      (kind === "publish" && b.status !== "publishing") ||
      (kind === "validate" && b.status !== "validating") ||
      b.validationGeneration !== generation
    )
      throw new AppError("STALE_JOB", "Job phase/generation mismatch", 409);
    return {
      build: b,
      preview: this.preview(b.previewId),
      previewUrl: this.url(b.previewId),
      prefix: `previews/${b.previewId}/${b.cacheKey}`,
      trustedSha: this.env.GITHUB_TRUSTED_REF,
      orchestrator: `${this.env.GITHUB_OWNER}/${this.env.GITHUB_ORCHESTRATOR_REPO}`,
    };
  }
  private url(id: string) {
    return this.env.PREVIEW_BASE_DOMAIN
      ? `https://p-${id}.${this.env.PREVIEW_BASE_DOMAIN}/`
      : `${this.env.PREVIEW_ORIGIN}/p/${id}/`;
  }
  async callback(c: Callback) {
    const b = this.build(c.jobId);
    if (
      c.sha !== b.analysis.sha ||
      c.configHash !== b.configHash ||
      c.generation !== b.validationGeneration
    )
      throw new AppError(
        "CALLBACK_BINDING",
        "Callback does not match immutable job",
        409,
      );
    const actions = new Actions(this.env);
    if (c.kind === "published") {
      if (b.status !== "publishing")
        throw new AppError("STALE_CALLBACK", "Build is not publishing", 409);
      const run = await actions.find("publish-trusted", b, c.runId);
      if (
        !run ||
        (b.publishRunId && b.publishRunId > 0 && b.publishRunId !== run.id) ||
        this.build(b.id).status !== "publishing"
      )
        throw new AppError("RUN_BINDING", "Publisher run mismatch", 409);
      b.publishRunId = run.id;
      const p: Preview = {
        id: b.previewId,
        buildId: b.id,
        prefix: `previews/${b.previewId}/${b.cacheKey}`,
        url: this.url(b.previewId),
        ttl: b.ttl,
        expiresAt: expiry(b.ttl),
        deletedAt: null,
        status: "validating",
        spa: b.config.spa,
        createdAt: Date.now(),
        bytes: c.bytes || 0,
      };
      this.save("preview", p);
      this.log(
        b,
        "validating",
        "Validated static artifact uploaded; browser validation pending",
      );
      await this.schedule();
    } else {
      if (b.status !== "validating" || !c.report)
        throw new AppError("STALE_CALLBACK", "Build is not validating", 409);
      const run = await actions.find("preview-validation", b, c.runId);
      if (
        !run ||
        (b.validationRunId &&
          b.validationRunId > 0 &&
          b.validationRunId !== run.id) ||
        this.build(b.id).status !== "validating"
      )
        throw new AppError("RUN_BINDING", "Validation run mismatch", 409);
      const p = this.preview(b.previewId);
      if (!p || !isAccessible(p))
        throw new AppError("PREVIEW_EXPIRED", "Preview revoked", 410);
      b.validationRunId = run.id;
      p.report = { ...c.report, errors: c.report.errors.map(sanitize) };
      p.status = c.report.status;
      this.save("preview", p);
      this.log(
        b,
        p.status,
        p.report.errors.join("; ") || "Desktop and mobile smoke checks passed",
      );
      await this.schedule();
    }
    return this.build(b.id);
  }
  async alarm() {
    try {
      await this.tick();
    } finally {
      const active = this.listBuilds().some((b) =>
        [...activeStates, "queued"].includes(b.status),
      );
      const expiryRow = this.ctx.storage.sql
        .exec<{ next: number | null }>(
          "SELECT MIN(expires) AS next FROM records WHERE kind='preview' AND expires>?",
          Date.now(),
        )
        .one();
      const dirty = !!this.cleanupCandidate();
      const sessions = this.ctx.storage.sql
        .exec<{ n: number }>("SELECT COUNT(*) AS n FROM sessions")
        .one().n;
      if (active || dirty) await this.schedule(active ? 10000 : 60000);
      else if (expiryRow.next || sessions)
        await this.schedule(
          Math.min(
            expiryRow.next
              ? Math.max(1000, expiryRow.next - Date.now())
              : 3600000,
            3600000,
          ),
        );
    }
  }
  private async tick() {
    this.ctx.storage.sql.exec(
      "DELETE FROM sessions WHERE expires<?",
      Date.now(),
    );
    const dirty = this.cleanupCandidate();
    if (dirty) {
      dirty.cleaned = true;
      dirty.cleanupPending = true;
      dirty.status = "expired";
      this.save("preview", dirty);
      let truncated = false;
      for (const prefix of [dirty.prefix + "/", `evidence/${dirty.buildId}/`]) {
        const batch = await this.env.BUCKET.list({ prefix, limit: 500 });
        if (batch.objects.length)
          await this.env.BUCKET.delete(batch.objects.map((o) => o.key));
        truncated ||= batch.truncated;
      }
      if (!truncated) {
        dirty.cleanupPending = false;
        this.save("preview", dirty);
      }
    }
    let b = this.listBuilds().find((b) => activeStates.includes(b.status));
    if (!b) {
      b = this.listBuilds()
        .filter((b) => b.status === "queued")
        .sort((a, b) => a.createdAt - b.createdAt)[0];
      if (!b) return;
      b.startedAt = Date.now();
      this.log(
        b,
        "dispatching",
        "Dispatching immutable source to a disposable runner",
      );
      try {
        const runId = await new Actions(this.env).dispatch(
          "build-untrusted",
          b,
        );
        if (runId) {
          const latest = this.build(b.id);
          latest.runId = runId;
          this.save("build", latest);
        }
      } catch {
        const latest = this.build(b.id);
        latest.error = "DISPATCH_UNKNOWN";
        this.log(
          latest,
          latest.status,
          "Dispatch result unknown; reconciling without redispatch",
        );
      }
      return;
    }
    const actions = new Actions(this.env);
    try {
      const workflow =
        b.status === "publishing"
          ? "publish-trusted"
          : b.status === "validating"
            ? "preview-validation"
            : "build-untrusted";
      const id =
        workflow === "publish-trusted"
          ? b.publishRunId
          : workflow === "preview-validation"
            ? b.validationRunId
            : b.runId;
      const run = await actions.find(workflow, b, id);
      const latest = this.build(b.id);
      if (latest.status !== b.status) return;
      b = latest;
      if (b.status === "cancelling") {
        for (const wf of [
          "build-untrusted",
          "publish-trusted",
          "preview-validation",
        ]) {
          const r = await actions.find(wf, b);
          if (r && r.status !== "completed") {
            await actions.cancel(r.id);
            return;
          }
        }
        this.log(b, "cancelled", "Remote runs completed or cancelled");
        return;
      }
      if (!run) {
        const field =
          workflow === "publish-trusted" ? "publishRunId" : "validationRunId";
        if (["publishing", "validating"].includes(b.status) && !b[field]) {
          b[field] = -1;
          this.save("build", b);
          const runId = await actions.dispatch(workflow, b);
          if (runId) {
            const latest = this.build(b.id);
            latest[field] = runId;
            this.save("build", latest);
          }
          return;
        }
        if (Date.now() - b.updatedAt > 180000) {
          b.error = "RUN_NOT_FOUND";
          this.log(
            b,
            "failed",
            "No matching immutable run found; no unsafe dispatch retry",
          );
        }
        return;
      }
      if (workflow === "build-untrusted") b.runId = run.id;
      else if (workflow === "publish-trusted") b.publishRunId = run.id;
      else b.validationRunId = run.id;
      this.save("build", b);
      if (Date.now() - (b.startedAt || b.createdAt) > 1200000) {
        await actions.cancel(run.id);
        b.error = "PIPELINE_TIMEOUT";
        this.log(b, "cancelling", "Pipeline exceeded 20 minute hard limit");
        return;
      }
      if (run.status === "completed") {
        if (run.conclusion === "success" && workflow === "build-untrusted")
          this.log(
            b,
            "publishing",
            "Build complete; data-only trusted publisher queued",
          );
        else {
          b.error =
            run.conclusion === "success"
              ? "MISSING_CALLBACK"
              : "WORKFLOW_FAILED";
          this.log(
            b,
            "failed",
            `Workflow ${workflow}: ${run.conclusion}; inspect Actions logs for run ${run.id}`,
          );
        }
      } else if (workflow === "build-untrusted" && b.status !== "running")
        this.log(
          b,
          "running",
          "Source installation and build running without deployment credentials",
        );
    } catch (e) {
      const latest = this.build(b.id);
      if (Date.now() - (latest.startedAt || latest.createdAt) > 1200000) {
        latest.error = "PROVIDER_UNAVAILABLE";
        this.log(
          latest,
          "cancelling",
          "Provider unavailable; holding slot until remote cancellation can be confirmed",
        );
      }
      this.audit(
        "provider_monitor_error",
        e instanceof AppError ? e.code : "NETWORK",
      );
    }
  }
}
