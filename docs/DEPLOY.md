# Deployment guide (review before running)

No cloud deployment was executed by the implementation task. Start on a staging hostname and your own trusted orchestration repository. GitHub and Cloudflare credentials must be supplied manually using their secret stores.

## From a phone / GitHub web

1. Review the task changes/PR, including workflow boundaries. Add the implementation to your own repository after review. Do not copy publisher secrets into target repositories. Enable Actions and use Linux GitHub-hosted runners.
2. In GitHub Settings → Environments create **trusted-publisher**. Set only the environment secrets/variables listed in [SECRETS](SECRETS.md). Restrict environment deployment refs to your trusted orchestration release. Protect workflow/code changes. An approval rule is optional and can lengthen the pipeline beyond its budget.
3. In Cloudflare dashboard create a dedicated **R2 Standard private bucket** (`byga-previews` or update both configs). Disable r2.dev and public custom bucket domains. Create a bucket-scoped R2 Object Read & Write key pair for publisher. R2 key secret is CF_R2_PUBLISH_TOKEN and access ID is R2_ACCESS_KEY_ID.
4. Prepare the build/configuration using GitHub Codespaces or a trusted terminal opened from the browser. This project needs a Vite build and Wrangler bundle; merely pasting TypeScript into the Cloudflare dashboard editor does not provision its DO/service bindings correctly. A phone browser can use Codespaces terminal and provider Settings; no desktop-only app is required.
5. Follow commands below, review dry-run output, then execute the deploy commands yourself. Do not grant secrets to an arbitrary third-party build/deploy service. No deployment workflow with account-wide credentials is installed automatically.

## Build and local review

```sh
corepack enable
corepack prepare pnpm@10.28.2 --activate
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium
pnpm check
pnpm test:e2e
pnpm types:workers
```

If using restricted filesystem tooling, set XDG_DATA_HOME/XDG_CONFIG_HOME/XDG_CACHE_HOME to writable directories. If Chromium is already installed use PLAYWRIGHT_EXECUTABLE_PATH. These are local environment choices, not committed secrets.

## Configure Workers

Edit `apps/control-worker/wrangler.jsonc`:

- APP_ORIGIN: exact HTTPS dashboard origin, no trailing slash (e.g. https://app.example.com).
- PREVIEW_ORIGIN: exact HTTPS separate preview Worker origin, no trailing slash; match preview config.
- PREVIEW_BASE_DOMAIN: empty for fallback, or a reviewed isolated preview zone.
- GITHUB_OWNER / GITHUB_ORCHESTRATOR_REPO: your orchestration repository.
- GITHUB_WORKFLOW_REF: protected release **tag name** pointing to reviewed orchestration source. GitHub dispatch officially accepts a branch/tag reference, not an arbitrary commit SHA. Protect this tag against update/deletion and restrict the trusted environment to it.
- GITHUB_TRUSTED_REF: full 40-character commit SHA containing reviewed workflows/scripts. Every discovered/returned run must match this SHA; trusted checkouts use that run’s immutable github.sha. The source build independently uses its own immutable target SHA. Copy the SHA from GitHub commit details after your reviewed source is committed; do not put a placeholder branch name here.
- R2 bucket_name: same dedicated private bucket in both Worker configs.
- Keep BUILDS_ENABLED=false and AUTH_CPU_VERIFIED=false initially.

Preview config ACCESS service binding names the control Worker and entrypoint PreviewAccess. QUEUE binding/new_sqlite_classes migration creates one SQLite DO class, no D1 migrations needed. Generate types with `pnpm types:workers` after config changes.

Create an admin hash with `pnpm password:hash`. Use a unique 16+ character password; the terminal input is hidden. The output is an encoded salt/hash, never a plaintext password. Store it as a Worker secret. Create independent high-entropy session and callback keys in your password manager.

```sh
pnpm exec wrangler login
pnpm exec wrangler secret put ADMIN_PASSWORD_HASH --config apps/control-worker/wrangler.jsonc
pnpm exec wrangler secret put SESSION_SIGNING_KEY --config apps/control-worker/wrangler.jsonc
pnpm exec wrangler secret put GITHUB_DISPATCH_TOKEN --config apps/control-worker/wrangler.jsonc
pnpm exec wrangler secret put PUBLISH_CALLBACK_SECRET --config apps/control-worker/wrangler.jsonc
pnpm build
pnpm exec wrangler deploy --config apps/control-worker/wrangler.jsonc --dry-run --outdir .local/control
pnpm exec wrangler deploy --config apps/preview-worker/wrangler.jsonc --dry-run --outdir .local/preview
```

Review account identity, config and permissions. The following commands **actually deploy**, and are deliberately not run by this task:

```sh
pnpm exec wrangler deploy --config apps/control-worker/wrangler.jsonc
pnpm exec wrangler deploy --config apps/preview-worker/wrangler.jsonc
```

First deploy control so PreviewAccess service exists, then preview. Configure dashboard origin route/custom domain or use its workers.dev origin and update APP_ORIGIN. Avoid serving control under an unconfigured alternate hostname: API rejects origin mismatch. Set Worker secrets only on control; preview has no GitHub/password/callback secret bindings.

## Local Wrangler check

For pure platform binding inspection, after `pnpm build`, run:

```sh
pnpm exec wrangler dev --config apps/control-worker/wrangler.jsonc --port 8787
```

Default fail-closed gates reject unconfigured login/build. For credential-free complete flow use `pnpm dev`: it runs the real Workers in Miniflare with a test-only coordinator subclass and outbound GitHub fixture provider. The test-only entrypoint is absent from production bundles. Do not set production gates true to work around fixture setup.

## Domain modes

Fallback needs no wildcard: PREVIEW_BASE_DOMAIN empty, PREVIEW_ORIGIN points at separate preview workers.dev host. Assets are served at `/p/<id>/`. The UI warns that root-absolute/deep SPA base paths and sibling-origin isolation are limited.

Recommended isolated origins: create **proxied wildcard DNS** `*.preview.example.com` and a **Workers Route** `*.preview.example.com/*` to preview Worker. Set PREVIEW_BASE_DOMAIN=preview.example.com in both configs. Verify TLS certificate coverage for `p-id.preview.example.com`; a basic zone wildcard certificate for `*.example.com` does not automatically cover this extra label. Use a suitable zone/subdomain/certificate. Do not attempt a wildcard Workers Custom Domain, which Cloudflare does not support. Keep dashboard on another host. Test root-absolute CSS/JS and SPA deep route reloads before switching from fallback.

## Enable only after release checks

1. Verify source build workflow cannot reference the trusted environment secrets; R2/callback secrets are environment-scoped, not repo-wide. Confirm checkout credentials are not persisted, no self-hosted runner, source fetched by SHA and no shared cache.
2. Measure actual KDF CPU under your Cloudflare plan using a trusted staging setup/observability. Local wall time is not evidence. Leave AUTH_CPU_VERIFIED false if it exceeds plan budget; do not lower hash work factor silently. Set true only after this verification and redeploy reviewed config.
3. Set BUILDS_ENABLED=true only after boundary tests. Analyze/build two public repositories you own or trust (one HTML, one locked Vite), then a monorepo. Confirm Actions job/run/SHA mapping, R2 uploads, browser screenshots, failure state and manual-only rebuild. Record their exact SHAs in your deployment acceptance notes.
4. Test TTL 1/7/30/permanent, delete then GET actual preview URL (must be 410), logout, invalid Origin/CSRF, publisher replay and rejected `_worker.js` artefact. Ensure cache hit creates no new run. Verify billing/quotas in provider dashboards.

No upstream webhooks/schedulers are configured. DO alarms only monitor initiated jobs and clean expired data.
