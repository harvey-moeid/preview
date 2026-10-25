# Cloudflare deployment — 25 October 2026

## Deployed resources

- Dashboard/control: https://byga-control.harveymoeid.workers.dev
- Preview serving: https://byga-preview.harveymoeid.workers.dev
- Cloudflare account: harvey (`07086b4d368d0a37ebcbbf186e51eecf`).
- Private R2 Standard bucket: `byga-previews` (APAC); r2.dev disabled.
- SQLite Durable Object: `Coordinator`, migration `v1`, binding `QUEUE`.
- Preview service binding: `ACCESS` → `byga-control`, entrypoint `PreviewAccess`.
- Workers.dev enabled; version preview URLs disabled.
- Dashboard assets built with Vite and deployed as native Worker static assets.
- Control deployment ID: `5379d2b31a914199bdb33fd77be3ec24`.
- Preview deployment ID: `7536111ba4db429f952105efd91f407c`.

## Activation pending

Infrastructure deployment does not complete production acceptance. No admin/GitHub/publisher credentials were supplied during this deployment.

1. Set control Worker secrets `ADMIN_PASSWORD_HASH`, `SESSION_SIGNING_KEY`, `GITHUB_DISPATCH_TOKEN`, and `PUBLISH_CALLBACK_SECRET`. Generate a password hash with `pnpm password:hash`; keep all secret values out of git and chat.
2. Create the GitHub `trusted-publisher` environment. Supply environment-only R2 credentials `R2_ACCESS_KEY_ID`, `CF_R2_PUBLISH_TOKEN` and the matching `PUBLISH_CALLBACK_SECRET`. Set environment variables `CONTROL_ORIGIN=https://byga-control.harveymoeid.workers.dev`, `CF_ACCOUNT_ID=07086b4d368d0a37ebcbbf186e51eecf`, `PREVIEW_R2_BUCKET=byga-previews`.
3. Protect a reviewed release tag and restrict the publisher environment to it. Configure `GITHUB_WORKFLOW_REF` to that tag and `GITHUB_TRUSTED_REF` to its exact 40-character source commit SHA.
4. Complete the deployed password-KDF CPU check and release acceptance steps in [DEPLOY.md](DEPLOY.md).
5. Set `AUTH_CPU_VERIFIED=true` and `BUILDS_ENABLED=true` only after their respective checks pass, then redeploy.

Both flags remain `false`. Login and builds are intentionally unavailable until activation is complete. Preview URLs use the documented fallback `/p/<id>/` path; no wildcard DNS is configured.

## Validation

- `pnpm check`: passed (TypeScript, ESLint, 40 JS tests, 8 Python tests, workflow checks, Vite build).
- Worker binding types regenerated; no type file changes.
- Wrangler dry runs: both passed.
- Cloudflare API confirmed both uploads, SQLite migration, static assets, service binding, and workers.dev activation.
- Local Playwright end-to-end run could not start because this execution environment rejected tsx's IPC socket with `EPERM`; Chromium download also failed. No end-to-end browser acceptance is claimed.
- No upstream repo-sync cron or webhooks were added. No secrets were committed.

Normal subsequent deployment remains `pnpm build`, then `pnpm exec wrangler deploy --config apps/control-worker/wrangler.jsonc`, then the equivalent preview config command. See [DEPLOY.md](DEPLOY.md) and [SECRETS.md](SECRETS.md).
