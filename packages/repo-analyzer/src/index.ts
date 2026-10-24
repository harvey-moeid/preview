import { profileFor } from "./profiles";
import {
  AppError,
  boundedText,
  configSchema,
  digest,
  opaqueId,
  type Analysis,
  type Candidate,
} from "../../shared/src/index";
export interface ParsedRepo {
  owner: string;
  repo: string;
  tail?: string;
  commit?: string;
}
export function parseGitHubUrl(input: string): ParsedRepo {
  if (
    input.length > 1000 ||
    /[\\\s\u0000-\u001f]/.test(input) ||
    /%(?:2e|2f|5c|00)/i.test(input) ||
    input.split("/").includes("..")
  )
    throw new AppError("INVALID_URL", "Invalid GitHub URL");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError("INVALID_URL", "Use https://github.com/owner/repo");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new AppError(
      "INVALID_URL",
      "Only public github.com repository URLs are supported",
    );
  const p = url.pathname
    .replace(/\/$/, "")
    .split("/")
    .slice(1)
    .map((x) => decodeURIComponent(x));
  const owner = p[0],
    repo = p[1]?.replace(/\.git$/, "");
  if (
    !owner ||
    !repo ||
    !/^[a-zA-Z0-9-]{1,39}$/.test(owner) ||
    !/^[\w.-]{1,100}$/.test(repo) ||
    [".", ".."].includes(repo)
  )
    throw new AppError("INVALID_URL", "Invalid repository");
  if (p.length === 2) return { owner, repo };
  if (p[2] === "commit" && p.length === 4 && /^[a-f0-9]{40}$/i.test(p[3]))
    return { owner, repo, commit: p[3] };
  if (
    p[2] === "tree" &&
    p.length >= 4 &&
    p.slice(3).every((s) => /^[\w.@+-]+$/.test(s) && ![".", ".."].includes(s))
  )
    return { owner, repo, tail: p.slice(3).join("/") };
  throw new AppError("INVALID_URL", "Use a repository, tree/ref or commit URL");
}
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
export class GitHub {
  private calls = 0;
  constructor(
    private fetcher: Fetcher = (input, init) => fetch(input, init),
    private token?: string,
  ) {}
  async get<T>(path: string): Promise<T> {
    if (++this.calls > 40)
      throw new AppError(
        "ANALYSIS_BUDGET",
        "Analysis exceeded its API request budget; select a shorter explicit ref or a smaller repository",
        422,
      );
    if (!path.startsWith("/repos/") || path.includes("://"))
      throw new AppError("GITHUB_PATH", "Invalid API path");
    const r = await this.fetcher(`https://api.github.com${path}`, {
      redirect: "manual",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "BYGA-Preview",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok)
      throw new AppError(
        r.status === 404 ? "REPO_NOT_FOUND" : "GITHUB_ERROR",
        `GitHub returned ${r.status}; check public visibility or API budget`,
        r.status === 404 ? 404 : 502,
      );
    return JSON.parse(await boundedText(r, 4 * 1024 * 1024)) as T;
  }
  async analyze(input: string, selectedRef?: string): Promise<Analysis> {
    const parsed = parseGitHubUrl(input),
      base = `/repos/${parsed.owner}/${parsed.repo}`;
    const repo = await this.get<{
      private: boolean;
      default_branch: string;
      size: number;
      full_name: string;
    }>(base);
    if (repo.private)
      throw new AppError(
        "PRIVATE_REPO",
        "Private repositories are unsupported",
        403,
      );
    if (repo.size > 102400)
      throw new AppError(
        "SOURCE_TOO_LARGE",
        "Source exceeds the 100 MB budget",
      );
    let ref = selectedRef || parsed.commit || repo.default_branch,
      rootHint = "";
    if (
      selectedRef &&
      (selectedRef.length > 200 ||
        !/^[\w./@+-]+$/.test(selectedRef) ||
        selectedRef.includes(".."))
    )
      throw new AppError("INVALID_REF", "Invalid ref");
    let commit: { sha: string } | undefined;
    if (parsed.tail && !selectedRef) {
      const parts = parsed.tail.split("/");
      for (let n = parts.length; n >= 1; n--) {
        try {
          ref = parts.slice(0, n).join("/");
          commit = await this.get<{ sha: string }>(
            `${base}/commits/${encodeURIComponent(ref)}`,
          );
          rootHint = parts.slice(n).join("/");
          break;
        } catch (e) {
          if (!(e instanceof AppError) || e.status !== 404) throw e;
        }
      }
      if (!commit)
        throw new AppError("REF_NOT_FOUND", "Branch or tag was not found", 404);
    }
    commit ??= await this.get<{ sha: string }>(
      `${base}/commits/${encodeURIComponent(ref)}`,
    );
    if (!/^[a-f0-9]{40}$/.test(commit.sha))
      throw new AppError("INVALID_SHA", "GitHub returned invalid SHA", 502);
    const tree = await this.get<{
      truncated: boolean;
      tree: { path: string; type: string; size?: number; mode?: string }[];
    }>(`${base}/git/trees/${commit.sha}?recursive=1`);
    if (tree.truncated || tree.tree.length > 20000)
      throw new AppError(
        "TREE_TOO_LARGE",
        "Repository tree exceeds analysis budget",
      );
    const files = tree.tree.filter((f) => f.type === "blob").map((f) => f.path);
    const roots = new Set(
      files
        .filter(
          (f) =>
            /(^|\/)package.json$/.test(f) && !/(node_modules|vendor)\//.test(f),
        )
        .map((f) => (f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : ".")),
    );
    for (const f of files.filter(
      (f) => /(^|\/)index.html$/.test(f) && f.split("/").length <= 4,
    ))
      roots.add(f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : ".");
    if (roots.size > 12)
      throw new AppError(
        "TOO_MANY_APPS",
        "At most 12 application candidates supported",
      );
    const candidates: Candidate[] = [];
    for (const root of roots) {
      const prefix = root === "." ? "" : root + "/";
      const read = async (path: string) => {
        const item = await this.get<{
          content: string;
          encoding: string;
          size: number;
        }>(`${base}/contents/${path}?ref=${commit.sha}`);
        if (item.size > 262144 || item.encoding !== "base64")
          throw new AppError("METADATA_LIMIT", "Metadata file too large");
        return atob(item.content.replace(/\s/g, ""));
      };
      let pkg: {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        scripts?: Record<string, string>;
        engines?: { node?: string };
      } = {};
      if (files.includes(prefix + "package.json")) {
        try {
          pkg = JSON.parse(await read(prefix + "package.json"));
        } catch {
          throw new AppError(
            "INVALID_PACKAGE",
            `Cannot parse ${prefix}package.json`,
          );
        }
      }
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const profile = profileFor(deps, !!pkg.scripts?.build);
      const framework = profile.framework;
      const supported = profile.runtime === "static";
      const lock = [
        "pnpm-lock.yaml",
        "package-lock.json",
        "yarn.lock",
        "bun.lock",
        "bun.lockb",
      ]
        .map((n) =>
          files.includes(prefix + n) ? prefix + n : files.includes(n) ? n : "",
        )
        .find(Boolean);
      const pm = lock?.endsWith("pnpm-lock.yaml")
        ? "pnpm"
        : lock?.endsWith("yarn.lock")
          ? "yarn"
          : lock?.includes("bun.lock")
            ? "bun"
            : lock
              ? "npm"
              : "none";
      const versionFile = [prefix + ".nvmrc", ".nvmrc"].find((p) =>
        files.includes(p),
      );
      const nodeHint = versionFile
        ? (await read(versionFile)).trim()
        : pkg.engines?.node || "22";
      const node = /(?:^|[^\d])24(?:[^\d]|$)/.test(nodeHint) ? "24" : "22";
      candidates.push({
        root,
        framework,
        supported: supported && pm !== "bun",
        reason: supported
          ? pm === "bun"
            ? "unsupported-toolchain: Bun is detected but not enabled on this runner"
            : undefined
          : "unsupported-runtime: dynamic adapters are disabled; select a reviewed static export manually in a future adapter",
        lockDigest: lock ? await digest(await read(lock)) : "none",
        config: configSchema.parse({
          root,
          node,
          packageManager: pm,
          command: pm === "none" ? "" : `${pm} run build`,
          output: profile.output,
          spa: profile.spa,
        }),
      });
    }
    if (rootHint)
      candidates.sort(
        (a, b) => Number(b.root === rootHint) - Number(a.root === rootHint),
      );
    return {
      id: opaqueId(),
      owner: parsed.owner,
      repo: parsed.repo,
      url: `https://github.com/${parsed.owner}/${parsed.repo}`,
      ref,
      sha: commit.sha,
      defaultBranch: repo.default_branch,
      candidates,
      warnings: [
        ...(candidates.length ? [] : ["No static application found"]),
        ...(tree.tree.some((f) => f.mode === "160000")
          ? ["Submodules are disabled"]
          : []),
        "Manual rebuild only. Demo variables must never contain secrets.",
      ],
    };
  }
}
