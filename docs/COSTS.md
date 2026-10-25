# Costs and constraints

Official Cloudflare documentation retrieved via Cloudflare Docs on **2026-10-24 UTC**. Recheck at deployment; limits and plan eligibility can change.

| Service | Documented free allowance/limit | Product implication |
|---|---|---|
| Workers Free | 100,000 requests/day, 10 ms CPU/request, 128 MB memory, 50 subrequests/request | Preview requests execute Worker and access DO; static dashboard asset allowance is separate. KDF CPU must be measured |
| SQLite Durable Objects Free | 100,000 requests/day, 13,000 GB-s duration/day | One personal coordinator sleeps when idle; active-job alarm every ~10 seconds |
| SQLite DO storage | 5 million rows read/day, 100,000 written/day, 5 GB total | Indexed metadata, bounded response history; alarms count as writes |
| R2 Standard | 10 GB-month storage, 1M Class A and 10M Class B operations/month free allowance | Asset/object counts, screenshots, reads and cleanup cost operations |
| R2 Standard beyond allowance | $0.015/GB-month; $4.50/M Class A; $0.36/M Class B; no Internet egress charge | Permanent previews still occupy storage; not unlimited |
| GitHub Actions | Plan/repo-specific minutes and artifact storage | Public target does not make private orchestration runners free |

Sources:

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/r2/pricing/
- https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions

GitHub's exact included minutes/storage depend on the owner's current plan and repo visibility; verify in Settings → Billing rather than assuming a number. No plan-specific GitHub allowance was verified for this account. A fresh build/publisher/browser/reporter pipeline consumes multiple runner jobs plus dependency/browser install time. Build timeout 10 minutes, browser job 3 minutes, pipeline 20 minutes; initial browser install can exceed validation budget on a cold runner and should fail honestly. Artifact retention is one day (CI evidence three). Linux hosted runners only; no quota evasion.

Code budgets: one active pipeline, ten queued, ≤100 MiB source/uncompressed output, ≤25 MiB asset, ≤5k output files, ≤20k source/tree entries, 12 app candidates, ≤120 browser requests per viewport. API analysis uses unauthenticated public GitHub metadata (typically a much lower hourly API allowance than authenticated access); errors display rate-budget guidance. Monitoring only queries active orchestration runs, never upstream commits on a schedule. The dashboard polls local metadata every five seconds while visible. Cleanup uses DO alarms and batches, not upstream rebuilds.

No D1, paid queue or paid hosting dependency is required by the static design. R2 activation may require billing setup. Custom domain/certificate costs and isolated future dynamic runtime costs are separate. Local KDF wall time and dry-run size do not prove all invocations fit Free CPU.
