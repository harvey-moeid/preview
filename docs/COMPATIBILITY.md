# Compatibility

“Universal” describes URL/structure analysis and adapter boundaries, not a promise that all repositories become websites.

| Source | Detection / execution | Result |
|---|---|---|
| Plain HTML/CSS/JS | index.html candidate, output root | Fixture tested, passive static files only |
| Vite React/Vue/Svelte | Vite dependency, lockfile, dist | Vite fixture tested; React/Vue/Svelte inferred via Vite tooling |
| Monorepo | up to 12 package/index candidates, root selection, workspace install at repo root | apps/web Vite + apps/docs HTML fixture |
| Astro | static default, dist | Profile available; SSR mode needs manual compatible static output |
| Angular | detected, manual browser output directory | Needs per-repo review; often dist/app/browser |
| Custom static | build script, configurable command/output/Node | Must produce only allowed static asset types |
| Next.js, Nuxt, SvelteKit | detected as runtime-gated | unsupported-runtime in this release, even if a repo could be manually converted to static export |
| API/server/DB/Docker/Python/Go | no approved runtime | Analyze only / no static candidate |
| Private/GitLab/Bitbucket/ZIP | outside v1 | Rejected |
| LFS/submodules/symlink source | disabled | Reject unsafe archive or explain unsupported |

Node 22/24. npm uses `ci`, pnpm 10.28.2 uses frozen lockfile, Yarn 4.6.0 uses immutable lockfile. Bun and Yarn classic are not automatically installed/supported; detection is diagnostic. Missing lockfile is not bypassed by a silent unlocked dependency install. Runtime/env secrets are not accepted for untrusted builds. Manual build command can run arbitrary code only in the secretless runner. No auto-retry of source/lock/security errors. Manual retry is limited to one and keeps SHA/config; new analysis/build is an explicit admin action.

Artifacts must have root index.html, ≤100 MiB total, ≤25 MiB/file, ≤5,000 files, MIME extension allowlist. Raw HTML output directories containing Markdown, startup scripts or framework source files may be rejected: choose a clean static output directory. The passive scanner never turns server files into executable Cloudflare code.

Recommended host mode: `p-<random-id>.preview.example.com` via **proxied wildcard DNS + Workers Route**. Wildcard Workers Custom Domains are not supported. Ensure certificate covers that subdomain depth (often requires dedicated zone or appropriate certificate); wildcard DNS alone does not ensure TLS coverage.

Fallback: `workers.dev/p/<id>/`. Relative base assets work for provided fixtures; root-absolute assets and deep SPA reload asset paths may fail. No unsafe HTML rewriting. A successful root smoke test does not prove every route works. The UI displays this limitation; use per-preview origins for normal SPA behavior. Preview responses intentionally have no cache so deletion/expiry takes effect on the next request. Service workers are blocked.

QA restricts external requests. Sites requiring external APIs, login, production tokens or dynamic backend may report partial/failed. The renderer records actual page/asset/JS/HTTP/blank-screen evidence, not a bundler-success promise. Desktop 1440×900 and mobile 390×844 screenshots; iframe desktop/tablet/mobile can be scaled to available space.
