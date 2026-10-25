# Secret and permissions inventory

Never place these secrets in `VITE_*`, target repository configuration, workflow inputs, git, screenshots or logs. `.env.example` contains names only.

| Name | Location | Minimum scope |
|---|---|---|
| ADMIN_PASSWORD_HASH | Control Worker secret | Salted PBKDF2 encoded string generated locally |
| SESSION_SIGNING_KEY | Control Worker secret | Random 32+ bytes, protects rate-limit IP pseudonyms |
| GITHUB_DISPATCH_TOKEN | Control Worker secret | Fine-grained PAT for own orchestrator repo only: Actions read/write; metadata read. No contents write |
| PUBLISH_CALLBACK_SECRET | Control Worker + GitHub **trusted-publisher environment** secret | Independent random 32+ bytes |
| R2_ACCESS_KEY_ID | GitHub trusted-publisher environment secret | Access key ID for bucket-scoped R2 Object Read & Write token |
| CF_R2_PUBLISH_TOKEN | GitHub trusted-publisher environment secret | R2 S3 **secret access key**, not a general Cloudflare API token |

Actual R2 S3 signing requires **two fields** (access key ID + secret access key). This is an explicit implementation correction to the PRD's single-token shorthand. The publisher does not need Workers deployment, DNS, account-wide admin or dashboard secret permissions. Object-only keys cannot manage bucket settings. Use one bucket dedicated to this app; a compromised trusted publisher can modify that bucket's objects.

Non-secret GitHub environment variables: `CONTROL_ORIGIN`, `CF_ACCOUNT_ID`, `PREVIEW_R2_BUCKET`. Worker vars: `APP_ORIGIN`, `PREVIEW_ORIGIN`, optional `PREVIEW_BASE_DOMAIN`, `GITHUB_OWNER`, `GITHUB_ORCHESTRATOR_REPO`, protected release tag `GITHUB_WORKFLOW_REF`, full expected trusted orchestration SHA `GITHUB_TRUSTED_REF`, `BUILDS_ENABLED`, `AUTH_CPU_VERIFIED`.

Do not create repository-wide R2/callback secrets. Put them only in the GitHub environment named `trusted-publisher`; untrusted build and smoke jobs do not reference it. Protect environment deployment branches/tags and the trusted workflow/code revision. For personal use a manual environment approval is optional; if enabled it delays the pipeline and may hit its timeout. Workflow GITHUB_TOKEN permissions are read-only: contents checkout, plus Actions read only on publisher/report. The secretless build's contents read is needed for a private orchestrator checkout and is never persisted in git config.

Set Cloudflare secrets via interactive `pnpm exec wrangler secret put NAME --config apps/control-worker/wrangler.jsonc`. Never pass secret values in CLI arguments. Rotate callback keys in Worker and trusted environment together. Revoke sessions by rotating/resetting the session registry via reviewed migration, not by printing cookie values.
