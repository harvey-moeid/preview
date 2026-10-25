import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowRight,
  Box,
  Check,
  ChevronRight,
  Clock3,
  Code2,
  ExternalLink,
  Github,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Maximize2,
  Monitor,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  Tablet,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import type {
  Analysis,
  Build,
  BuildConfig,
  Preview,
  TTL,
} from "../../../packages/shared/src/index";
import "./style.css";

type Envelope<T> = {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
};
let csrf = "";
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result: Envelope<T> = await response.json();
  if (!result.success)
    throw new Error(
      result.error?.message || `Request failed (${response.status})`,
    );
  return result.data;
}
function PreviewFrame({
  url,
  device,
  refresh,
}: {
  url: string;
  device: "desktop" | "tablet" | "mobile";
  refresh: number;
}) {
  const host = useRef<HTMLDivElement>(null),
    [size, setSize] = useState({ width: 600, height: 354 });
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0].contentRect;
      setSize({ width: box.width, height: box.height });
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const width = device === "desktop" ? 1440 : device === "tablet" ? 768 : 390,
    height = device === "desktop" ? 900 : device === "tablet" ? 1024 : 844;
  const scale = Math.min(1, size.width / width, size.height / height);
  return (
    <div className="iframe-wrap" ref={host}>
      <div
        className="iframe-canvas"
        style={{ width: width * scale, height: height * scale }}
      >
        <iframe
          key={`${url}-${refresh}-${device}`}
          title="Untrusted repository preview"
          src={url}
          width={width}
          height={height}
          style={{ transform: `scale(${scale})` }}
          sandbox="allow-scripts allow-forms allow-same-origin"
          referrerPolicy="no-referrer"
          allow="camera 'none'; microphone 'none'; geolocation 'none'"
        />
      </div>
    </div>
  );
}
function App() {
  const [auth, setAuth] = useState<"loading" | "login" | "ready">("loading"),
    [password, setPassword] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [url, setUrl] = useState(""),
    [ref, setRef] = useState("");
  const [analysis, setAnalysis] = useState<Analysis>(),
    [config, setConfig] = useState<BuildConfig>(),
    [ttl, setTTL] = useState<TTL>("7");
  const [builds, setBuilds] = useState<Build[]>([]),
    [previews, setPreviews] = useState<Preview[]>([]),
    [selected, setSelected] = useState("");
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">(
      "desktop",
    ),
    [refresh, setRefresh] = useState(0),
    [tab, setTab] = useState("preview");
  const [localFixture, setLocalFixture] = useState(false);
  const [cached, setCached] = useState(false),
    [fallback, setFallback] = useState(false),
    [buildsEnabled, setBuildsEnabled] = useState(false);
  const frameContainer = useRef<HTMLDivElement>(null);
  const poll = useCallback(async () => {
    const [b, p] = await Promise.all([
      api<Build[]>("/builds"),
      api<Preview[]>("/previews"),
    ]);
    setBuilds(b);
    setPreviews(p);
  }, []);
  useEffect(() => {
    api<{ csrf: string }>("/auth/me")
      .then((s) => {
        csrf = s.csrf;
        setAuth("ready");
      })
      .catch(() => setAuth("login"));
  }, []);
  useEffect(() => {
    if (auth !== "ready") return;
    void poll().catch((e) => setError(String(e)));
    void api<{
      fallbackOrigin: boolean;
      buildsEnabled: boolean;
      localFixture?: boolean;
    }>("/settings").then((s) => {
      setFallback(s.fallbackOrigin);
      setBuildsEnabled(s.buildsEnabled);
      setLocalFixture(!!s.localFixture);
    });
    const timer = setInterval(() => {
      if (!document.hidden) void poll().catch((e) => setError(String(e)));
    }, 5000);
    return () => clearInterval(timer);
  }, [auth, poll]);
  async function action(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy("");
    }
  }
  const build = builds.find((b) => b.id === selected) || builds[0],
    preview = previews.find((p) => p.buildId === build?.id);
  const active = builds.filter((b) =>
    [
      "dispatching",
      "running",
      "publishing",
      "validating",
      "cancelling",
    ].includes(b.status),
  ).length;
  const ready = previews.filter((p) =>
    ["ready", "partial"].includes(p.status),
  ).length;
  async function analyze() {
    await action("analyze", async () => {
      const a = await api<Analysis>("/repo/analyze", "POST", {
        url,
        ...(ref ? { ref } : {}),
      });
      setAnalysis(a);
      setConfig(a.candidates[0]?.config);
      setCached(false);
    });
  }
  async function submit() {
    if (!analysis || !config) return;
    await action("build", async () => {
      const r = await api<{ build: Build; cacheHit: boolean }>(
        "/builds",
        "POST",
        { analysisId: analysis.id, config, ttl },
      );
      setSelected(r.build.id);
      setCached(r.cacheHit);
      await poll();
    });
  }
  const mutate = (path: string, method = "POST", body?: unknown) =>
    action(path, async () => {
      const r = await api<{ build?: Build }>(path, method, body);
      if (r?.build) setSelected(r.build.id);
      await poll();
    });
  if (auth === "loading")
    return (
      <div className="loading">
        <LoaderCircle className="spin" /> Connecting to your workspace…
      </div>
    );
  if (auth === "login")
    return (
      <main className="login">
        <div className="brand">
          <span className="brand-mark">
            <Layers3 size={24} />
          </span>{" "}
          BYGA<span className="brand-label">PREVIEW</span>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action("login", async () => {
              const s = await api<{ csrf: string }>("/auth/login", "POST", {
                password,
              });
              csrf = s.csrf;
              setPassword("");
              setAuth("ready");
            });
          }}
        >
          <span className="eyebrow">
            <LockKeyhole size={14} /> PRIVATE WORKSPACE
          </span>
          <h1>
            Your next idea,
            <br />
            <em>one preview away.</em>
          </h1>
          <p>
            Sign in to build and explore public GitHub repositories in an
            isolated preview.
          </p>
          <label htmlFor="password">Admin password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button className="primary" disabled={!!busy}>
            Unlock workspace <ArrowRight size={17} />
          </button>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <small>
            <ShieldCheck size={14} /> Secure session · Single administrator
          </small>
        </form>
        <span className="login-footer">BYGA UNIVERSAL REPO PREVIEW</span>
      </main>
    );
  return (
    <div className="shell">
      <aside className="sidebar">
        <a href="/" className="brand">
          <span className="brand-mark">
            <Layers3 size={22} />
          </span>{" "}
          BYGA<span className="brand-label">PREVIEW</span>
        </a>
        <div className="workspace-label">PERSONAL WORKSPACE</div>
        <nav>
          <a className="nav-active" href="#workspace">
            <Box size={18} />
            Overview<span className="nav-count">{builds.length}</span>
          </a>
          <a href="#recent">
            <Clock3 size={18} />
            Build history
          </a>
          <a href="#security">
            <ShieldCheck size={18} />
            Security & limits
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="manual">
            <span className="status-dot" /> Manual rebuilds only
            <p>You decide when source changes become a new preview.</p>
          </div>
          <div className="profile">
            <span className="avatar">A</span>
            <div>
              Administrator<small>Personal workspace</small>
            </div>
            <button
              aria-label="Sign out"
              title="Sign out"
              onClick={() =>
                void action("logout", async () => {
                  await api("/auth/logout", "POST");
                  csrf = "";
                  setBuilds([]);
                  setPreviews([]);
                  setAuth("login");
                })
              }
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-area">
        <header>
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <strong>Overview</strong>
          </div>
          <div className="header-right">
            <span className="connection">
              <span className="status-dot" /> Control plane connected
            </span>
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
            >
              <Github size={19} />
            </a>
            <span className="avatar small">A</span>
          </div>
        </header>
        <main id="workspace">
          <div className="page-title">
            <div>
              <span className="eyebrow">YOUR BUILD PLAYGROUND</span>
              <h1>
                From repository to reality<span>.</span>
              </h1>
              <p>Drop a GitHub link. Build it. See what’s possible.</p>
            </div>
            <a href="#new-preview" className="secondary">
              <Plus size={16} /> New preview
            </a>
          </div>
          {localFixture && (
            <div className="notice local-mode">
              <Box size={15} />
              Local fixture mode — GitHub and Actions are mocked. Preview files
              and browser screenshots are real local test output.
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <X size={17} />
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          <section className="stats" aria-label="Workspace statistics">
            <div>
              <span className="stat-icon cyan">
                <Layers3 size={19} />
              </span>
              <div>
                <p>Total previews</p>
                <strong>
                  {previews.length}
                  <small>in your workspace</small>
                </strong>
              </div>
            </div>
            <div>
              <span className="stat-icon green">
                <Check size={19} />
              </span>
              <div>
                <p>Available previews</p>
                <strong>
                  {ready}
                  <small>ready or partial</small>
                </strong>
              </div>
            </div>
            <div>
              <span className="stat-icon purple">
                <Activity size={19} />
              </span>
              <div>
                <p>Build queue</p>
                <strong>
                  {builds.filter((b) => b.status === "queued").length}
                  <small>{active}/1 pipeline active</small>
                </strong>
              </div>
            </div>
            <div>
              <span className="stat-icon amber">
                <Clock3 size={19} />
              </span>
              <div>
                <p>Storage used</p>
                <strong>
                  {(
                    previews
                      .filter((p) => !p.cleaned)
                      .reduce((n, p) => n + p.bytes, 0) / 1048576
                  ).toFixed(1)}
                  <small>MB of static assets</small>
                </strong>
              </div>
            </div>
          </section>
          <div className="content-grid">
            <section id="new-preview" className="panel create-panel">
              <div className="panel-heading">
                <span className="panel-icon">
                  <Code2 size={18} />
                </span>
                <div>
                  <h2>Create a preview</h2>
                  <p>Start with a public GitHub repository</p>
                </div>
                <span className="step-tag">01 — SOURCE</span>
              </div>
              <label htmlFor="repo">Repository URL</label>
              <div className="repo-input">
                <Github size={18} />
                <input
                  id="repo"
                  placeholder="https://github.com/owner/repository"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setAnalysis(undefined);
                  }}
                />
              </div>
              <div className="input-hint">
                <LockKeyhole size={12} /> Public repositories only. Your source
                stays untouched.
              </div>
              <label htmlFor="ref">
                Branch, tag or commit <span className="optional">optional</span>
              </label>
              <input
                id="ref"
                placeholder="Default branch"
                value={ref}
                onChange={(e) => {
                  setRef(e.target.value);
                  setAnalysis(undefined);
                }}
              />
              <button
                className="secondary analyze"
                disabled={!!busy || !url}
                onClick={() => void analyze()}
              >
                {busy === "analyze" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Search size={16} />
                )}{" "}
                Analyze repository <ArrowRight size={15} />
              </button>
              {analysis && config && (
                <div className="analysis">
                  <div className="detected">
                    <span className="status-dot" /> Source resolved{" "}
                    <code>{analysis.sha.slice(0, 8)}</code>
                  </div>
                  <label htmlFor="app">Application</label>
                  <select
                    id="app"
                    value={config.root}
                    onChange={(e) =>
                      setConfig(
                        analysis.candidates.find(
                          (c) => c.root === e.target.value,
                        )?.config,
                      )
                    }
                  >
                    {analysis.candidates.map((c) => (
                      <option key={c.root} value={c.root}>
                        {c.root} · {c.framework}
                        {!c.supported ? " · unsupported-runtime" : ""}
                      </option>
                    ))}
                  </select>
                  {!analysis.candidates.find((c) => c.root === config.root)
                    ?.supported && (
                    <p className="error">
                      Runtime adapter disabled by security gate.
                    </p>
                  )}
                  <details>
                    <summary>Build configuration</summary>
                    <label htmlFor="command">Build command</label>
                    <input
                      id="command"
                      value={config.command}
                      onChange={(e) =>
                        setConfig({ ...config, command: e.target.value })
                      }
                    />
                    <label htmlFor="output">Output directory</label>
                    <input
                      id="output"
                      value={config.output}
                      onChange={(e) =>
                        setConfig({ ...config, output: e.target.value })
                      }
                    />
                    <label htmlFor="pm">Package manager</label>
                    <select
                      id="pm"
                      value={config.packageManager}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          packageManager: e.target
                            .value as BuildConfig["packageManager"],
                        })
                      }
                    >
                      {["none", "npm", "pnpm", "yarn", "bun"].map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                    <label htmlFor="node">Node runtime</label>
                    <select
                      id="node"
                      value={config.node}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          node: e.target.value as "22" | "24",
                        })
                      }
                    >
                      <option>22</option>
                      <option>24</option>
                    </select>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={config.spa}
                        onChange={(e) =>
                          setConfig({ ...config, spa: e.target.checked })
                        }
                      />{" "}
                      SPA route fallback
                    </label>
                    <p className="input-hint">
                      Commands run on a disposable runner without deployment
                      secrets.
                    </p>
                  </details>
                </div>
              )}
              <div className="retention">
                <label htmlFor="ttl">
                  <Clock3 size={14} /> Preview lifetime
                </label>
                <select
                  id="ttl"
                  value={ttl}
                  onChange={(e) => setTTL(e.target.value as TTL)}
                >
                  <option value="1">1 day</option>
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                  <option value="permanent">Permanent</option>
                </select>
              </div>
              <button
                className="primary build-button"
                disabled={
                  !!busy ||
                  !analysis ||
                  !config ||
                  !buildsEnabled ||
                  !analysis.candidates.find((c) => c.root === config.root)
                    ?.supported
                }
                onClick={() => void submit()}
              >
                {busy === "build" ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <Plus size={17} />
                )}{" "}
                Build & Preview <ArrowRight size={17} />
              </button>
              {cached && (
                <div className="cache-note">
                  <Check size={14} /> Reused cached SHA + build configuration.
                </div>
              )}
              <div className="build-note">
                <ShieldCheck size={13} /> Isolated builds. No automatic upstream
                updates.
              </div>
            </section>
            <section className="panel preview-panel">
              <div className="preview-toolbar">
                <div className="preview-tabs">
                  <button
                    className={tab === "preview" ? "active" : ""}
                    onClick={() => setTab("preview")}
                  >
                    <Monitor size={15} /> Preview
                  </button>
                  <button
                    className={tab === "logs" ? "active" : ""}
                    onClick={() => setTab("logs")}
                  >
                    <Terminal size={15} /> Build logs{" "}
                    {build && (
                      <span className={`badge ${build.status}`}>
                        {build.status}
                      </span>
                    )}
                  </button>
                </div>
                <div className="frame-actions">
                  <button
                    aria-label="Refresh preview"
                    disabled={!preview}
                    onClick={() => setRefresh((n) => n + 1)}
                  >
                    <RefreshCw size={15} />
                  </button>
                  <button
                    aria-label="Fullscreen preview"
                    onClick={() =>
                      void frameContainer.current?.requestFullscreen()
                    }
                  >
                    <Maximize2 size={15} />
                  </button>
                  {preview && (
                    <a
                      href={preview.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open preview"
                    >
                      <ExternalLink size={15} />
                    </a>
                  )}
                </div>
              </div>
              <div className="device-toolbar">
                <div className="devices">
                  {(
                    [
                      ["desktop", Monitor],
                      ["tablet", Tablet],
                      ["mobile", Smartphone],
                    ] as const
                  ).map(([name, Icon]) => (
                    <button
                      key={name}
                      aria-label={`${name} viewport`}
                      className={device === name ? "active" : ""}
                      onClick={() => setDevice(name)}
                    >
                      <Icon size={15} />
                      <span>{name}</span>
                    </button>
                  ))}
                </div>
                <span>
                  {device === "desktop"
                    ? "1440 × 900"
                    : device === "tablet"
                      ? "768 × 1024"
                      : "390 × 844"}
                </span>
              </div>
              <div className={`preview-stage ${device}`} ref={frameContainer}>
                {tab === "logs" ? (
                  <div className="logs">
                    <div className="log-heading">
                      PIPELINE OUTPUT{" "}
                      <span>SHA {build?.analysis.sha.slice(0, 8) || "—"}</span>
                    </div>
                    {build?.logs.map((l, i) => (
                      <div key={i}>
                        <time>{new Date(l.at).toLocaleTimeString()}</time>
                        <span>{l.phase}</span>
                        <p>{l.message}</p>
                      </div>
                    ))}
                    {!build && <p>No builds yet.</p>}
                    {build?.runId && (
                      <a
                        href={`https://github.com/${build.analysis.owner}/${build.analysis.repo}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Source repository <ExternalLink size={12} />
                      </a>
                    )}
                    <p className="input-hint">
                      Detailed runner logs are available from the authenticated
                      logs API’s Actions link.
                    </p>
                  </div>
                ) : preview &&
                  !preview.deletedAt &&
                  preview.status !== "expired" ? (
                  <PreviewFrame
                    url={preview.url}
                    device={device}
                    refresh={refresh}
                  />
                ) : (
                  <div className="preview-empty">
                    <div className="empty-graphic">
                      <div className="graphic-window">
                        <span />
                        <span />
                        <span />
                        <Code2 size={35} />
                      </div>
                      <span className="graphic-orbit orbit-one" />
                      <span className="graphic-orbit orbit-two" />
                      <span className="graphic-plus">+</span>
                    </div>
                    <span className="eyebrow">
                      A LITTLE CODE. A LOT OF POSSIBILITY.
                    </span>
                    <h3>
                      {build &&
                      !["failed", "cancelled", "expired"].includes(build.status)
                        ? "Your preview is on its way"
                        : "Your next preview starts here"}
                    </h3>
                    <p>
                      {build
                        ? `Pipeline status: ${build.status}. Open build logs for progress.`
                        : "Analyze a repository and launch a build to see your website come to life."}
                    </p>
                    <div className="empty-steps">
                      <span>
                        01 <b>Connect repo</b>
                      </span>
                      <ChevronRight size={13} />
                      <span>
                        02 <b>Build safely</b>
                      </span>
                      <ChevronRight size={13} />
                      <span>
                        03 <b>Explore</b>
                      </span>
                    </div>
                  </div>
                )}
              </div>
              <div className="preview-footer">
                <span>
                  <ShieldCheck size={13} /> Untrusted preview · separate origin
                </span>
                <span>{preview?.status || "Waiting for a build"}</span>
              </div>
            </section>
          </div>
          {fallback && (
            <div className="notice">
              <Activity size={15} />
              <span>
                Path-based preview mode: root-absolute assets may need a base
                path. Each preview shares the fallback origin; avoid entering
                sensitive data.
              </span>
            </div>
          )}
          {preview?.report && (
            <section className="panel evidence">
              <div>
                <h2>
                  Browser validation{" "}
                  <span className={`badge ${preview.report.status}`}>
                    {preview.report.status}
                  </span>
                </h2>
                <p>
                  Desktop and mobile ·{" "}
                  {new Date(preview.report.checkedAt).toLocaleString()}
                </p>
                {preview.report.errors.map((e, i) => (
                  <p key={i} className="error">
                    {e}
                  </p>
                ))}
              </div>
              <div className="screenshots">
                {["desktop.png", "mobile.png"].map((file) => (
                  <a
                    key={file}
                    href={`/api/previews/${preview.id}/evidence?file=${file}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      alt={`${file.split(".")[0]} validation screenshot`}
                      src={`/api/previews/${preview.id}/evidence?file=${file}`}
                    />
                  </a>
                ))}
              </div>
            </section>
          )}
          <section id="recent" className="panel history">
            <div className="section-title">
              <div>
                <h2>
                  Recent builds <span>{builds.length}</span>
                </h2>
                <p>Your previews, all in one place.</p>
              </div>
              <span className="subtle">Updated every 5 seconds</span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>REPOSITORY</th>
                    <th>STATUS</th>
                    <th>COMMIT</th>
                    <th>LIFETIME</th>
                    <th>CREATED</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {builds.map((b) => {
                    const p = previews.find((p) => p.buildId === b.id);
                    return (
                      <tr
                        key={b.id}
                        className={build?.id === b.id ? "selected-row" : ""}
                      >
                        <td>
                          <button
                            className="repo-cell"
                            onClick={() => {
                              setSelected(b.id);
                              setTab("preview");
                            }}
                          >
                            <span className="repo-icon">
                              <Github size={17} />
                            </span>
                            <span>
                              {b.analysis.owner}/
                              <strong>{b.analysis.repo}</strong>
                              <small>
                                {b.config.root} · {b.analysis.ref}
                              </small>
                            </span>
                          </button>
                        </td>
                        <td>
                          <span
                            className={`badge ${p?.status === "expired" ? "expired" : b.status}`}
                          >
                            <i />
                            {p?.status === "expired" ? "expired" : b.status}
                          </span>
                        </td>
                        <td>
                          <code>{b.analysis.sha.slice(0, 7)}</code>
                        </td>
                        <td>
                          {p && !p.deletedAt && !p.cleaned ? (
                            <select
                              aria-label={`Lifetime for ${b.analysis.repo}`}
                              value={p.ttl}
                              onChange={(e) =>
                                void mutate(`/previews/${p.id}`, "PATCH", {
                                  ttl: e.target.value,
                                })
                              }
                            >
                              {["1", "7", "30", "permanent"].map((t) => (
                                <option key={t} value={t}>
                                  {t === "permanent"
                                    ? "Permanent"
                                    : `${t} days`}
                                </option>
                              ))}
                            </select>
                          ) : b.ttl === "permanent" ? (
                            "Permanent"
                          ) : (
                            `${b.ttl} days`
                          )}
                        </td>
                        <td className="subtle">
                          {new Date(b.createdAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                        </td>
                        <td>
                          <div className="row-actions">
                            {p && (
                              <>
                                <button
                                  title="Manual rebuild"
                                  aria-label={`Rebuild ${b.analysis.repo}`}
                                  disabled={!!busy}
                                  onClick={() =>
                                    void mutate(`/previews/${p.id}/rebuild`)
                                  }
                                >
                                  <RefreshCw size={15} />
                                </button>
                                <button
                                  title="Test again without rebuilding"
                                  aria-label={`Validate ${b.analysis.repo}`}
                                  disabled={!!busy || p.status === "expired"}
                                  onClick={() =>
                                    void mutate(`/previews/${p.id}/validate`)
                                  }
                                >
                                  <ShieldCheck size={15} />
                                </button>
                                <button
                                  title="Delete preview"
                                  aria-label={`Delete ${b.analysis.repo}`}
                                  disabled={!!busy || !!p.deletedAt}
                                  onClick={() =>
                                    void mutate(`/previews/${p.id}`, "DELETE")
                                  }
                                >
                                  <Trash2 size={15} />
                                </button>
                              </>
                            )}
                            {[
                              "queued",
                              "dispatching",
                              "running",
                              "publishing",
                              "validating",
                            ].includes(b.status) && (
                              <button
                                aria-label={`Cancel ${b.analysis.repo}`}
                                onClick={() =>
                                  void mutate(`/builds/${b.id}/cancel`)
                                }
                              >
                                <X size={16} />
                              </button>
                            )}
                            {["failed", "cancelled"].includes(b.status) &&
                              b.attempt < 1 && (
                                <button
                                  aria-label={`Retry ${b.analysis.repo}`}
                                  onClick={() =>
                                    void mutate(`/builds/${b.id}/retry`)
                                  }
                                >
                                  <RefreshCw size={15} />
                                </button>
                              )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!builds.length && (
              <div className="history-empty">
                <Box size={21} />
                <p>
                  No builds yet. Your first repository is a good place to start.
                </p>
              </div>
            )}
          </section>
          <footer id="security">
            <span>
              <ShieldCheck size={14} /> Static artifacts only · One active build
              · Server-enforced expiration
            </span>
            <span>
              BYGA Preview <b>v1.0</b>
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
