# Implementation plan

The repository initially contained only a README. The attached PRD and prompt are the product contract.

1. Security gate: strict GitHub URL/SHA parsing; authenticated API with server-side sessions and CSRF; data-only artifact scanner; immutable run mapping; separate preview Worker; request-time revocation. Dynamic third-party runtimes remain disabled.
2. Static path: shared Zod contracts → public GitHub analyzer → SQLite DO FIFO → manual Actions dispatch → secretless build → separately dispatched trusted publisher → R2 → preview Worker → secretless Playwright validation → signed callback.
3. Dashboard: responsive React/Vite developer dashboard, analysis, candidate/ref/config controls, logs, timeline, device previews, TTL, cancellation, manual rebuild/retry, validation evidence.
4. Verification: unit and security tests, real local workerd integration with mock GitHub provider, Playwright fixtures and screenshots, workflow validation, typecheck/lint/build and Wrangler dry runs.
5. Operations: deploy guide, least privilege inventory, compatibility/cost matrix, threat model and runbook. No deployment, push or commit in this task.

## Modules

`packages/shared`: contracts/security helpers; `repo-analyzer`: SSRF-safe public metadata and static adapters; `build-manifest`: passive artifact format. `control-worker`: auth/API and one SQLite coordinator for this single-admin product; `preview-worker`: public read-only delivery with a narrowly scoped service entrypoint to control metadata. `scripts`: source acquisition/build, passive publisher, validation and local setup.

## Risks and release gates

- Disposable Actions runners are not a strong network sandbox. No secret or privileged token may enter source execution. Artifact transport tokens remain a platform limitation, documented explicitly.
- Separate workflows/fresh runners, trusted immutable checkout and strict archive scanning are mandatory. Unknown/ambiguous dispatches are reconciled, never blindly retried.
- Separate origins, no public R2 access, and no CDN/browser caching of preview responses are required for immediate server-side revocation.
- Worker Free password-KDF CPU feasibility must be measured on the deployed account; local benchmarks are not proof of production CPU compliance.
- Without cloud credentials, use clearly marked local provider fixtures. Cloud deployment and live public-repo acceptance remain unverified until configured.

## Implementation review decisions

- GitHub's official REST API (retrieved 2026-10-24) dispatches by branch/tag; production uses a protected release tag plus an independently configured expected 40-character orchestration SHA. Run identity is checked against that SHA, workflow/event/title/attempt and job ID. New API response run IDs are persisted; legacy 204 responses are reconciled without redispatch. Target source always uses immutable SHA.
- Publisher uses Python stdlib archive scanning and R2 S3 SigV4, no target extraction or package execution. S3 requires a bucket-scoped access key ID + secret access key, documented explicitly.
- Preview delivery uses no-store even for fingerprinted assets. Two access checks around R2 I/O prioritize revocation over CDN savings.
- Production defaults fail closed for builds and KDF CPU approval. Local fixture/test entrypoints and generated credentials are excluded from Wrangler bundles.
- Static registry supports HTML/Vite plus conservative custom profiles; dynamic frameworks and Bun execution are gated. Settings resource limits are read-only; runner logs are linked rather than mirrored into storage. No automatic dependency/source retry, only explicit pinned retry.
- Partial-publish orphan uploads require operator reconciliation; valid previews use automatic TTL cleanup. Live cloud/DNS/permissions/CPU validation is an outstanding deployment gate, not claimed by local tests.
