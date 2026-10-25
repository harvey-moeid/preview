# Repository instructions

Preserve the PRD's manual-rebuild-only and secretless-build boundaries. Never deploy arbitrary backend code. Treat artifacts as hostile data; do not execute or install anything from them in privileged jobs. Never add `pull_request_target`, upstream webhooks, source-sync cron or shared untrusted dependency caches. Keep R2 private and check preview access on every request. Run `pnpm check` and `pnpm test:e2e` for changes spanning the pipeline. No credentials in fixtures, screenshots or logs. Document limitations honestly.
