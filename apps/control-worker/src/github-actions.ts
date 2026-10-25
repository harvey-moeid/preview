import {
  AppError,
  boundedText,
  type Build,
} from "../../../packages/shared/src/index";
import type { ControlEnv } from "./env";
export interface Run {
  id: number;
  display_title: string;
  head_sha: string;
  path: string;
  event: string;
  status: string;
  conclusion: string | null;
  run_attempt: number;
}
export class Actions {
  constructor(private env: ControlEnv) {}
  private async request(path: string, method = "GET", body?: unknown) {
    if (
      !this.env.GITHUB_DISPATCH_TOKEN ||
      !/^[\w-]+$/.test(this.env.GITHUB_OWNER) ||
      !/^[\w.-]+$/.test(this.env.GITHUB_ORCHESTRATOR_REPO) ||
      !/^[a-f0-9]{40}$/.test(this.env.GITHUB_TRUSTED_REF) ||
      !/^[\w./-]{1,200}$/.test(this.env.GITHUB_WORKFLOW_REF) ||
      this.env.GITHUB_WORKFLOW_REF.includes("..")
    )
      throw new AppError(
        "ACTIONS_NOT_CONFIGURED",
        "Set scoped Actions token, protected workflow tag and immutable trusted orchestration SHA",
        503,
      );
    const r = await fetch(
      `https://api.github.com/repos/${this.env.GITHUB_OWNER}/${this.env.GITHUB_ORCHESTRATOR_REPO}/actions/${path}`,
      {
        method,
        redirect: "manual",
        headers: {
          Authorization: `Bearer ${this.env.GITHUB_DISPATCH_TOKEN}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "BYGA-Preview",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!r.ok)
      throw new AppError(
        "ACTIONS_API",
        `Actions API returned ${r.status}`,
        502,
      );
    return r.status === 204 ? {} : JSON.parse(await boundedText(r, 1048576));
  }
  async dispatch(workflow: string, b: Build) {
    const response = await this.request(
      `workflows/${workflow}.yml/dispatches`,
      "POST",
      {
        ref: this.env.GITHUB_WORKFLOW_REF,
        inputs:
          workflow === "build-untrusted"
            ? {
                job_id: b.id,
                owner: b.analysis.owner,
                repo: b.analysis.repo,
                sha: b.analysis.sha,
                config_hash: b.configHash,
                config: JSON.stringify(b.config),
              }
            : { job_id: b.id, generation: String(b.validationGeneration) },
      },
    );
    return Number.isSafeInteger(response.workflow_run_id) &&
      response.workflow_run_id > 0
      ? (response.workflow_run_id as number)
      : undefined;
  }
  async find(
    workflow: string,
    b: Build,
    runId?: number,
  ): Promise<Run | undefined> {
    const expected = `byga-${workflow === "build-untrusted" ? "build" : workflow === "publish-trusted" ? "publish" : "validate"}:${b.id}:${workflow === "preview-validation" ? b.validationGeneration : 0}`;
    const runs: Run[] =
      runId && runId > 0
        ? [(await this.request(`runs/${runId}`)) as Run]
        : (
            (await this.request(
              `workflows/${workflow}.yml/runs?event=workflow_dispatch&per_page=100`,
            )) as { workflow_runs: Run[] }
          ).workflow_runs;
    const matches = runs.filter(
      (r) =>
        r.display_title === expected &&
        r.head_sha === this.env.GITHUB_TRUSTED_REF &&
        r.event === "workflow_dispatch" &&
        r.path === `.github/workflows/${workflow}.yml` &&
        r.run_attempt === 1,
    );
    if (matches.length > 1)
      throw new AppError(
        "AMBIGUOUS_RUN",
        "Multiple matching runs; cancel and investigate",
        409,
      );
    return matches[0];
  }
  async cancel(id: number) {
    try {
      await this.request(`runs/${id}/cancel`, "POST");
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      const run = (await this.request(`runs/${id}`)) as Run;
      if (run.status !== "completed") throw e;
    }
  }
}
