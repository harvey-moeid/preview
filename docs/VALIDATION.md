# Validation record

Run in the supplied workspace on 2026-10-24 UTC. No GitHub Actions workflows or Cloudflare production deployments were executed. Fixture repository names are mocks, not live public repositories.

| Check | Coverage |
|---|---|
| TypeScript strict | Dashboard, shared contracts/analyzer, Workers, scripts, tests; generated binding types |
| ESLint | Source and workflow checker; generated build outputs excluded |
| Vitest | 33 unit/security cases + 7 real workerd integration scenarios |
| Python unittest | 8 archive/publisher cases, with negative subcases for traversal, symlinks, special Worker files, wrong run/SHA/event/attempt, checksum, oversize and ZIP paths |
| Workflow policy checker | Four workflows parsed as YAML, pinned action SHAs, bounded disposable runner, no secret/environment reference in untrusted build/browser, no input shell interpolation |
| actionlint v1.7.7 | Real workflow syntax/expression validation, downloaded release checksum verified |
| Vite | Dashboard production build and real Vite/monorepo fixture bundles |
| Playwright | HTML interaction + cache/manual rebuild + desktop/mobile dashboard screenshots; Vite; selected apps/web monorepo; delete direct URL 410; failed build diagnostics; actual partial/blank browser classification |
| Wrangler | Generated types and deploy **dry-run** for both Workers; no upload/provisioning |

Workerd integration calls the production API and actual SQLite Durable Object implementation with a test-only subclass. It verifies session/CSRF/origin/logout/rate limits; fixture public/private analysis; concurrent dedupe and one active pipeline; queue cancellation; passive tar scan before local R2 publication; CSP/noindex/no-store; HMAC body integrity/replay/mapping; 1/7/30/permanent; direct expiry/delete while bytes still exist and eventual cleanup. Local Actions mock exercises both response-with-run-ID and legacy 204 discovery.

Screenshots/reports are generated in `test-results/dashboard-desktop.png`, `dashboard-mobile.png`, `local-validation/<job>/`, `qa-partial/`, `qa-blank/`. Each successful fixture gets real 1440×900 and 390×844 browser screenshots; reports contain errors and actual classification. Generated evidence is gitignored and uploaded as CI artifact when tests run there.

**Final result:** 40 TypeScript tests, 8 Python tests and 5 Playwright tests passed. Strict typecheck, lint, four workflow policy checks, actionlint, production dashboard build, pinned-pnpm frozen install and both Worker dry-runs passed.

## Reproduce

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium
pnpm check
pnpm test:e2e
pnpm types:workers
pnpm exec wrangler deploy --config apps/control-worker/wrangler.jsonc --dry-run --outdir .local/control
pnpm exec wrangler deploy --config apps/preview-worker/wrangler.jsonc --dry-run --outdir .local/preview
```

In this restricted workspace npm networking required the configured session proxy/network capability. Browser CDN download was denied by network policy; preinstalled `/usr/bin/chromium` was used via PLAYWRIGHT_EXECUTABLE_PATH. This is an environment-specific fallback, not a test skip. KDF login passed real local workerd, but deployed Worker Free CPU remains unverified. pnpm 10.28.2 (the project pin) and the lockfile are checked separately from the environment's default pnpm 11.

## Outstanding live acceptance / known limitations

- Deploy-time credentials, environment scopes, protected orchestration release tag, private bucket, actual Actions run upload/download, wildcard DNS/TLS, public repo demos and provider billing were not exercised live.
- No isolated full-stack runtime is approved; dynamic source deployment remains disabled.
- Production login remains disabled until deployed CPU benchmarking; builds remain disabled until security/account configuration is verified.
- Framework coverage beyond HTML/Vite/selected monorepo fixtures is conservative; no universal compatibility promise. Missing env/backend and fallback base-path limitations remain visible.
- Resource settings are read-only; full runner output uses Actions links; orphan prefixes from a crash before successful publication need manual operator cleanup. No automatic retries of ambiguous dispatches/source/security failures.
