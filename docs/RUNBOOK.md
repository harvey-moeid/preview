# Operations runbook

## Stuck or unknown dispatch

The coordinator reserves the slot before dispatch. If network outcome is ambiguous, it searches exact workflow/event/title/trusted SHA/attempt rather than redispatching. After three minutes without a bound run it fails with RUN_NOT_FOUND. Investigate the orchestrator Actions UI before a manual retry. Workflow-level concurrency also limits secretless builds to one. Never manually rerun an old Actions run: run_attempt>1 is rejected; use the app's explicit retry/new build.

Alarm monitoring uses a ten-second cadence only while jobs exist. Network failures hold the slot; a 20-minute exceeded pipeline requests cancellation and retains it until provider terminal state is confirmed. Cancel queued work is immediate. Active cancel reconciles each workflow and calls GitHub cancel; a callback racing cancellation is rejected by a state re-read. If an alarm repeatedly fails, inspect Worker logs/audit and provider API permissions; restore connectivity, do not clear the active marker and risk overlapping work.

## Build/publisher/validation failure

Read sanitized timeline, then the authenticated Actions URL from `GET /api/builds/:id/logs` for full runner logs. Common failures: lockfile absent, Node mismatch, wrong output root, runtime unsupported, output contains special files, size/checksum/manifest mismatch, PAT lacks Actions permission, wrong trusted SHA/workflow revision, R2 S3 key scope, or callback origin/HMAC mismatch. No credentials are passed to target build code. Do not fix install failures by injecting production secrets or disabling integrity/security checks.

A failed publisher cannot mark a preview accessible. Partial uploads remain private and are orphan candidates; periodically inspect bucket prefixes using a trusted operator inventory before removing orphan objects. Never apply a bucket-wide expiration lifecycle: permanent previews and pinned artifacts must survive. Pipeline-provisioned valid expired/deleted prefixes are cleaned automatically in batches. Unregistered objects from a crashed partial publish currently need manual reconciliation (known limitation).

Browser validation has a three-minute secretless job budget, two viewport screenshots, same-origin GET-only routing and a request cap. Ready means this smoke passed, not comprehensive app correctness. Partial means recoverable HTTP/assets/JS/external API failures; failed includes blank/unavailable documents. `Test again` dispatches validation only, increments generation, leaves source SHA unchanged; it requires a free pipeline slot. Evidence is private and retrieved through authenticated API.

## TTL/delete

1/7/30 days are measured from publication or a later explicit TTL change. Permanent has no automatic expiry. Request-time DO access is authoritative, so direct URL returns 410 while R2 cleanup is pending. Cleanup locks a prefix before I/O; a cleaned/deleted preview cannot be restored with PATCH. Build a new preview after cleanup. No-store applies to every asset/HTML response. Disable proxy/CDN rules that bypass Worker or force-cache responses. Bytes already saved by a visitor cannot be revoked retroactively.

## Rollback / incidents

Set BUILDS_ENABLED=false immediately to stop new jobs; cancel active runs in app/GitHub. Revoke compromised PAT/R2 key and rotate callback secret on both sides. Investigate logs without dumping secrets. R2 public access must remain disabled. Roll Worker code back using `pnpm exec wrangler rollback --config ...` after review; do not delete/mutate the SQLite class migration to roll back schema. Preserve records while reconciling in-flight runs. SQLite Point-in-Time Recovery is account/plan dependent; confirm provider capabilities before relying on it. Store deployment config/revision and a reviewed inventory outside untrusted repos.

## Manual changes

Updating an upstream repo does nothing automatically. Rebuild resolves that preview's selected mutable ref only on an explicit admin action. SHA refs stay immutable; identical inputs return cache. Changing the trusted orchestration commit is a control-plane release: drain/cancel in-flight jobs, review workflows/scripts, then update GITHUB_TRUSTED_REF. Do not follow a mutable branch silently for privileged publisher code.
