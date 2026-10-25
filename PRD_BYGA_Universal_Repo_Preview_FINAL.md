# PRD FINAL — BYGA Universal Repo Preview

**Versi:** 1.0 Final (keputusan #1–#15)  
**Tanggal:** 25 Oktober 2026 (WIB)  
**Status:** Spesifikasi final untuk implementasi; kode belum dibuat/deploy  
**Pemilik/pengguna:** pribadi, satu administrator  
**Tujuan:** Masukkan URL repository GitHub publik milik siapa pun → pilih ref/subproyek → build otomatis di GitHub Actions → validasi → tampilkan preview web interaktif di browser melalui Cloudflare. Rebuild hanya saat diminta.

## 1. Ringkasan eksekutif

BYGA Universal Repo Preview adalah alat pribadi, mobile-first, untuk menguji tampilan situs dari repository publik tanpa mengubah source repository asli atau melakukan deploy manual per repo. Satu dashboard dilindungi satu password admin. Preview boleh diakses publik oleh pemegang URL. Sistem membedakan situs statis yang dapat dipreview, full-stack/SSR yang kompatibel dan **memenuhi gerbang keamanan**, serta repository yang hanya dapat dianalisis.

**Prinsip yang tidak bisa dinegosiasikan:** (a) tidak menjanjikan bahwa setiap repo GitHub bisa berjalan sebagai website; (b) tidak pernah menjalankan source tak tepercaya dalam job yang memiliki credentials GitHub/Cloudflare; (c) tidak menganggap status `build success` berarti halaman benar-benar dapat digunakan; (d) masa kedaluwarsa preview wajib diterapkan di server, bukan hanya disembunyikan di UI; (e) tidak ada update otomatis dari GitHub.

## 2. Catatan keputusan resmi

| # | Keputusan final | Perilaku yang harus dipenuhi |
|---|---|---|
| 1 | D — Universal Repository Engine | Desain modular lintas struktur/framework; bukan jaminan dukungan semua repo. |
| 2 | A — GitHub Public Only | v1 menerima repository publik GitHub saja, dari akun mana pun; tidak memakai OAuth user, repo private, GitLab, Bitbucket, ataupun upload ZIP. |
| 3 | D — Smart Universal Build Engine | Deteksi bahasa/framework/runtime/package manager, jenis output dan adapter, dengan pesan inkompatibilitas jujur. |
| 4 | A — GitHub Actions Build Engine | Build hanya pada runner GitHub Actions yang disposable, bukan Cloudflare Worker. |
| 5 | D — Smart Zero-Trust Build Engine | Source asing diperlakukan berbahaya; secretless build, kuota, scan, validasi manifest, pemisahan privilege. |
| 6 | D — Smart Adaptive Preview Engine | URL unik; desktop/tablet/mobile, refresh/fullscreen; runtime yang kompatibel boleh melalui adapter terkontrol. |
| 7 | B — Developer Dashboard | Input URL, deteksi stack, progress, status, log/error, mode perangkat. Tidak wajib file explorer / studio premium. |
| 8 | D — Smart Repository Structure Engine | Branch, tag, commit/SHA, monorepo, pemilihan app subfolder, konfigurasi per aplikasi. |
| 9 | D — Smart Adaptive Build & Environment Engine | Preset otomatis, pengaturan manual, pengecekan environment, retry terbatas yang aman. |
| 10 | C — Smart Personal Build & Cache | Satu build aktif, antrean, cancel, timeout, dedupe, cache commit+config, riwayat, retry terbatas. |
| 11 | A — Simple Admin Password | Satu password admin, cookie aman, pembatasan login; link preview tidak perlu login. |
| 12 | C — Configurable Preview Storage | TTL 1, 7, 30 hari atau permanen; hapus manual; cleanup otomatis. |
| 13 | C — Cloudflare Full-Stack Adapter | SSR/API hanya untuk adapter yang benar-benar kompatibel dan lulus keamanan; database eksternal tidak otomatis disediakan. |
| 14 | D — Smart End-to-End Preview Validation | Playwright, screenshot desktop/mobile, HTTP/assets/JS error, smoke navigation, laporan dan tiga status. |
| 15 | A — Manual Rebuild Only | Tidak ada webhook updater, polling commit berkala, auto sync atau auto rebuild. Aksi eksplisit admin saja yang memulai rebuild. |

**Pembatas eksplisit:** Keputusan #1 tentang desain universal tidak memperluas cakupan provider #2: rilis ini tetap *hanya GitHub public*. Penggunaan sistem juga tetap pribadi, meski hasil preview dapat dibagikan.

## 3. Persona, masalah dan non-goals

**Persona:** satu developer yang terutama menggunakan HP dan terkadang desktop untuk menguji source website dari GitHub.  
**Masalah:** harus clone/install/deploy manual, sulit mengetahui root app pada monorepo, build gagal tanpa alasan jelas, sulit membandingkan render HP vs desktop.  
**Hasil yang diinginkan:** input satu URL → penilaian kompatibilitas → preview jika valid, beserta pesan kegagalan yang dapat ditindaklanjuti.

Di luar scope v1: hosting produksi pelanggan, multiuser/billing, repo private, fork/commit ke repo orang lain, edit source dari UI, interactive shell/terminal arbitrary untuk user, provisioning database eksternal, menjalankan layanan stateful berkelanjutan, branch auto-sync, scheduler repo change, dukungan universal seluruh bahasa sebagai aplikasi web.

## 4. UX / user journey

1. Buka dashboard pada HP/desktop, masukkan password admin.
2. Paste URL `https://github.com/owner/repo` atau URL ke branch/tag/commit/subfolder GitHub yang valid. Server canonicalize ke `owner/repo`; fetch metadata dan pastikan `private=false`, repo ada, bukan URL GitHub API arbitraris.
3. Sistem menampilkan repo, default branch, pilihan branch/tag/ref, SHA resolved, kandidat app (root, `apps/web`, `frontend`, `client`, dll.), paket/framework dan kemungkinan preview.
4. Pilih kandidat aplikasi; lihat preset build yang terdeteksi; opsional ubah runtime, package manager, command, output directory. Input perintah manual diberi peringatan: akan dijalankan tanpa secrets pada build runner tidak tepercaya.
5. Tekan **Build & Preview**. Tampilkan status `queued`, `detecting`, `installing`, `building`, `validating`, `publishing`, `ready`, `partial`, `failed`, `cancelled`, `expired` serta timeline dan log berkala.
6. Setelah validasi, tampilkan preview pada iframe lintas-origin yang dibatasi, tombol buka tab baru, refresh, fullscreen, ukuran desktop (1440), tablet (768), mobile (390) dalam tampilan yang dapat diskalakan; pada HP prioritaskan satu viewport dan tombol mode.
7. Admin dapat melihat daftar preview terdahulu; gunakan cache bila SHA + konfigurasi + toolchain cocok; pilih TTL 1/7/30/permanen, hapus, atau tekan **Rebuild** secara manual untuk mengambil SHA terbaru dari ref yang dipilih.
8. Jika gagal, tunjukkan fase yang gagal, error ringkas yang dibersihkan dari secrets, petunjuk tindakan, log rinci, dan pilihan retry manual.

**Wireframe tekstual**: Header BYGA Preview + tombol keluar; Input URL + Analyze; panel Ref & Application; panel Build Config; Build button; progress/status/log; iframe preview + device modes; recent builds + TTL/delete/rebuild. Gaya: dark navy/cyan profesional, kontras aksesibel, mobile-first; tidak perlu elemen 3D atau animasi berat.

## 5. Arsitektur target

```text
[Browser admin]
   │ password session cookie (same-site)
   ▼
[Cloudflare Workers: dashboard/API] ── [Durable Object SQLite: metadata, queue, sessions]
   │                                          │ single active + alarms
   │ (API GitHub only / dispatch)              │ TTL cleanup
   ▼                                          ▼
[GitHub REST API] ─▶ [GitHub Actions UNTRUSTED BUILD job: NO SECRETS]
                           │ SHA-pinned source, timeout, budget
                           ▼
                    [Build artifact + manifest]
                           │ verified, DATA ONLY
                           ▼
[GitHub Actions TRUSTED PUBLISH job: trusted code ONLY]
                           │ Cloudflare publish credential never enters build job
                           ▼
                    [Cloudflare R2: static build assets, logs, screenshots]
                           │
                           ▼
[Cloudflare Preview Worker on separate origin] ── [Admin iframe / share URL]
                           │
[Isolated, approved full-stack adapter (optional conditional capability)]
```

**Cloudflare components:**
- Workers: API/dashboard, auth and preview content server; deploy dashboard static assets via Workers static assets or Pages.
- SQLite-backed Durable Object: satu instance koordinator untuk antrean FIFO, metadata, session registry, job state dan TTL cleanup. Gunakan SQL indeks; tidak perlu D1. DO mendukung Workers Free, tetapi batas harian tetap berlaku.
- R2 Standard: file asset per `preview_id`, manifest, logs dan screenshot serta cache berulang; lifecycle diatur oleh aplikasi (TTL pilihan pengguna). Hindari membuat jutaan objek kecil; simpan arsip untuk cache apabila layak.
- Domain terpisah: `app.example.com` (dashboard) dan `p-<id>.preview.example.com` (tiap preview) melalui DNS wildcard + Workers Route **jika Anda memiliki domain di Cloudflare**. Pastikan TLS wildcard dan route benar-benar berfungsi sebelum menjadikannya default. Jangan gunakan wildcard *Custom Domain* Worker karena tidak mendukung wildcard. Preview Worker membaca host, menemukan id terdaftar, memvalidasi expiry, lalu melayani `/<path>` dari prefix R2 sehingga asset root-absolute dan SPA routes lebih kompatibel.
- Tanpa custom domain: sediakan fallback `https://<preview-worker>.workers.dev/p/<id>/`, dengan penyesuaian base path framework; tandai aplikasi yang butuh origin-root tersendiri sebagai **partial/unsupported**. Jangan menyatakan kompatibilitas penuh bila absolute asset URLs gagal. Alternatif Pages Direct Upload optional, **tidak** boleh digunakan sebagai jaminan TTL/hapus jika deployment unik tetap bisa diakses di URL langsung.

**GitHub Actions:** own trusted orchestrator repository (private disarankan), workflow dispatch melalui fine-grained GitHub token berizin `Actions: write` pada repo itu saja. Hanya **satu build** aktif. Runner GitHub-hosted disposable (bukan self-hosted persisten). Workflow `build-untrusted.yml` tanpa secrets, minimal permissions, tanpa publish access, dengan batas durasi dan output. Workflow publisher lain berisi kode trusted yang tidak pernah mengeksekusi file dari repo target dan hanya mengunggah output statis yang telah divalidasi. Gunakan manifest/hash/checksum; pastikan `job_id`, `repo`, `sha`, `config_hash` dan ukuran konsisten sebelum publish.

**Koneksi job:** Backend memanggil `workflow_dispatch` dengan ID job + SHA + konfigurasi whitelist; status dilacak via Actions REST API (prefer run ID yang dikembalikan bila tersedia); callback dari publisher harus memakai HMAC bertimestamp + nonce, diverifikasi server. Polling hanya job yang sedang berlangsung, bukan polling repo untuk auto-update. Gunakan DO alarm/backoff atau status query saat dashboard terbuka, bukan cron 5-menitan global.

## 6. Repo analyzer & build engine

- Parse URL, batasi hanya `https://github.com/<owner>/<repo>` dan pola tree/commit yang dikenali; normalisasi `.git`, trailing slash dan encoding; tolak redirect host lain, local address, userinfo dalam URL, SSRF dan path traversal. Ambil metadata via API GitHub, resolve ref menjadi immutable 40-char SHA di server; gunakan SHA untuk fetch build source. Batasi ukuran repo checkout (mis. 100 MB ukuran source awal, configurable), jumlah file, LFS/submodules secara konservatif (default submodule/LFS off).
- Deteksi file: `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock*`, `vite.config.*`, `next.config.*`, `astro.config.*`, `angular.json`, `nuxt.config.*`, `svelte.config.*`, `wrangler.*`, HTML static.
- Monorepo: `pnpm-workspace.yaml`, npm/yarn workspaces, `turbo.json`, `nx.json`; tampilkan app candidate dengan confidence. Jika lebih dari satu, admin memilih.
- Framework profile: HTML/static, Vite/React, Vue, Svelte, Angular, Astro static, Next export, Nuxt static, SvelteKit static; full-stack profiles terpisah dan dinyatakan **conditional**.
- Deteksi Node runtime dari engines, `.nvmrc` dan package metadata. Pin versi runner yang supported dan install dependency dengan lockfile (npm ci / pnpm --frozen-lockfile / yarn immutable / bun frozen lockfile). Jangan disable integrity checking dan jangan menginstal dependency secara diam-diam untuk melewati proteksi.
- Auto output dir (`dist`, `build`, `out`, dll.) dengan konfirmasi bila ambigu. Untuk opsi command manual, encode args secara aman dan hindari interpolasi string ke shell dalam trusted context; eksekusi hanya di secretless job.
- Fallback tanpa backend hanya bila build output benar-benar mandiri. Tidak membuat mock API palsu secara default. Jika env dibutuhkan, tampilkan nama saja, tidak meminta secrets produksi. Variable demo non-rahasia hanya melalui konfigurasi berperingatan dan dapat masuk ke bundle publik; tidak menerima API key sensitif untuk kode asing.
- Retry maksimal 1 kali untuk error sementara yang dibuktikan (timeout download package/network glitch), tidak untuk error syntax/source, dependency compromise, atau gate keamanan. Rebuild manual #15 tetap berlaku: retry dalam job build yang sama bukan auto-sync source.

## 7. Isolasi keamanan / threat model (blocker sebelum production)

Repo publik dapat mengeksekusi postinstall scripts, mencuri env, mengunduh malware, membuat crypto miner, memanfaatkan network, dan menghasilkan JavaScript yang menyerang pengunjung preview. GitHub-hosted runner ephemeral bukan sandbox dengan jaminan sempurna. **Default deny**, fail closed.

1. **Secretless code execution:** `permissions: {}` atau minimal read-only bila dibutuhkan, job tidak mengikat Cloudflare/GitHub publish secrets, `persist-credentials:false`, tidak memakai cache lintas build tak tepercaya, hindari `pull_request_target` dan workflow privileged saat checkout source asing, runner disposable, resource/time budget. Tidak menggunakan `workflow_run` secara ceroboh untuk memproses artifact dan source tidak tepercaya.
2. **Trusted publisher terpisah:** tidak `npm install`, `source`, `eval`, `wrangler` atau shell command dari artefak target. Hanya file pasif; validasi manifest, MIME, checksum, path relatif, no symlink, no zip-slip, no oversize, no unexpected files. **Blokir** `_worker.js`, `functions/`, symlink dan executable/server config dari jalur static; jangan mengunggah Worker code tak tepercaya sebagai Cloudflare Worker otomatis.
3. **Browser isolation:** admin dan preview beda origin/host, cookie admin host-only `HttpOnly; Secure; SameSite=Lax/Strict`, CORS tertutup antara preview dan API admin; iframe sandbox dan Permissions-Policy tanpa kamera/mic/geolocation; `X-Robots-Tag: noindex`; link eksternal `noopener,noreferrer`. Preview tetap dapat menjalankan JS milik repo, beri label 'untrusted preview'. Hindari menerima login admin dari preview. Anda tetap harus berhati-hati saat menggunakan hasil repo asing.
4. **Authentication:** single admin password hash bersalt (algoritme KDF yang feasible dengan CPU Worker Free; benchmark Argon2id/PBKDF2 secara aman), session opaque random hash disimpan server side, CSRF defenses, rate limit login, session expiry/logout, tidak ada bypass dev di prod. Set admin hash melalui secret; hindari menaruh password plaintext di code/env contoh.
5. **Controls:** allowlist API GitHub host, pin commit SHA, quota filesize/dependency/time, dedupe, audit log, concurrency=1, egress limitation jika runner mendukung; dokumentasikan bahwa GitHub-hosted runner tidak memberi kontrol jaringan penuh. `cancel` mengirim cancel ke GitHub API bila job sudah aktif. Default timeout 10 menit build + 3 menit validation, configurable dengan batas keras.
6. **Full-stack safety gate:** kode Worker hasil repo asing berpotensi mengakses jaringan saat runtime. Hanya adapter framework yang telah diuji dan target runtime terisolasi tanpa Cloudflare bindings/secrets milik dashboard; butuh approval admin eksplisit untuk deployment dinamis dan idealnya Cloudflare account terpisah. Jika isolasi aman tidak bisa dibuktikan pada paket Free, **jangan deploy backend**. Tampilkan `unsupported-runtime` dan tetap layani build statis jika tersedia; tidak boleh diam-diam menjalankan backend asing di kontrol plane.
7. **Publisher callbacks:** HMAC request body + timestamp window + nonce replay defense; token dipisah antara `API orchestration`, `publisher to R2`, `callback` dan semua disimpan secrets server/Actions terbatas. Hindari mencetak credentials di log.

**Security acceptance hard-fail:** injeksi command di repo URL/ref; repo berisi `_worker.js` tidak boleh dijalankan dalam publisher; public preview tidak boleh memanggil admin API dengan cookie; expire/delete harus mengembalikan `410 Gone`/`404` di preview origin; malware candidate membuat job terhenti/ditandai, bukan memaksa publish.

## 8. Preview delivery & expiry

- `preview_id` random, opaque, tidak mengandung nama repo. Host per preview jika domain tersedia. Files disimpan R2 di `previews/<id>/<build_hash>/...` beserta `manifest.json` (terkontrol). Worker melakukan lookup preview id + expiry melalui DO (dengan cache pendek yang tidak melampaui revocation guarantee). Untuk penghapusan instan, jangan cache keputusan akses terlalu lama; pada `delete`, invalidasi cache/route sesuai strategi.
- HTTP headers: cache immutable untuk asset fingerprint; HTML `no-store` atau TTL pendek; `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `Content-Security-Policy` sesuai compatibility/security (tidak menjamin CSP seragam untuk semua app), MIME eksplisit; fallback `index.html` untuk SPA routes hanya jika framework profile meminta.
- Retensi: 1, 7, 30 hari atau permanen; berlaku untuk TTL server, link langsung dan artefak. Soft mark expired lalu cleanup objek R2. Admin bisa memperpanjang TTL, menghapus, menyimpan permanen; default 7 hari. `permanent` berarti tidak kedaluwarsa otomatis, tetap tunduk pada batas storage.
- Cache key = hash(canonical repo + SHA + subdir + package manager lock digest + runtime profile + build config + adapter version). Cache reuse bukan pengambilan kode terbaru; **rebuild** resolve branch/tag ke SHA terbaru bila dipilih, atau mempertahankan SHA bila ref immutable.
- Layanan preview hasil deploy tidak boleh otomatis menjalankan endpoint yang memiliki biaya/akses produksi; preview bisa memanggil API eksternal yang tertanam di source, tampilkan peringatan.

## 9. Validasi browser

Jalankan pemeriksaan pasca-publish dengan Playwright dari *secretless* runner: GET HTTP, `DOMContentLoaded`, render desktop 1440×900 dan mobile 390×844, screenshot, console `error`, uncaught JS error, missing CSS/JS/asset, simple click navigation non-destruktif bila aman; timeout dan request cap. Jangan mengikuti otomatis tombol pembayaran, login, pembelian atau aksi destruktif. Perhatikan CSP/CORS dan halaman autentikasi eksternal.

Tiga hasil UX:
- **Preview Ready**: URL valid, HTML termuat, aset inti tersedia, tidak ada fatal blank screen.
- **Partially Working**: halaman tampil tetapi endpoint/API tertentu gagal, image tidak termuat, atau fitur memerlukan env/backend.
- **Preview Failed**: tidak ada halaman render usable atau deployment invalid.

Sediakan log build dengan fase, screenshot, error yang sudah disanitasi, ringkasan kemungkinan akar masalah, tombol `Test again` (validasi ulang tanpa build ulang). Tidak mengubah sumber original atau memalsukan gambar render saat gagal.

## 10. Data model

Durable Object SQLite tables (skema indikatif; implementasi boleh menambah kolom):

- `repositories(id, owner, name, default_branch, repo_url, created_at, updated_at)`
- `applications(id, repo_id, root_path, framework, package_manager, config_json, created_at)`
- `builds(id, repo_id, app_id, ref_input, commit_sha, config_hash, cache_key, status, github_run_id, attempt_count, error_code, log_key, created_at, updated_at, finished_at)`
- `previews(id, build_id, origin_host, r2_prefix, ttl_mode, expires_at, deleted_at, validation_status, screenshot_desktop_key, screenshot_mobile_key, created_at)`
- `queue(job_id, seq, state, enqueued_at, started_at)`
- `admin_sessions(id_hash, created_at, expires_at, last_used_at)`
- `audit_events(id, event, target_id, outcome, timestamp)`
- `settings(key, value_json, updated_at)`

Indexes for builds by cache_key and created_at; preview expiry and deletion; queue status; sessions expiry. JSON contract typed and versioned. Opaque ids via crypto random; never expose GitHub/Cloudflare token in API.

## 11. Backend API (dashboard authenticated unless noted)

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/login` / `POST /api/auth/logout` / `GET /api/auth/me` | Single-admin login & session lifecycle |
| `POST /api/repo/analyze` | Validate Github public URL, resolve ref, list app candidates |
| `GET /api/repo/:id/refs` | Paginated branch/tag metadata if needed |
| `POST /api/builds` | Submit build request, dedupe and queue |
| `GET /api/builds` / `GET /api/builds/:id` | List/detail status, inputs and canonical SHA |
| `GET /api/builds/:id/logs` | Sanitized logs with cursor/polling |
| `POST /api/builds/:id/cancel` | Cancel queued/active build, idempotent |
| `POST /api/builds/:id/retry` | Explicit repeat of failed build; no source auto-update |
| `POST /api/previews/:id/rebuild` | Manual rebuild; resolve selected mutable ref to latest SHA |
| `GET /api/previews` / `PATCH /api/previews/:id` | List, edit expiration or permanent status |
| `DELETE /api/previews/:id` | Immediate server-side revocation then async cleanup |
| `POST /api/previews/:id/validate` | Trigger post-deploy validation again |
| `GET /api/settings` / `PATCH /api/settings` | Limits and defaults |
| `POST /api/internal/publish-result` | HMAC-only callback from trusted publisher |
| Preview Worker `GET https://p-<id>.preview.example.com/*` | Public, no auth, but TTL and deletion enforced |

API responses follow `{success, data, error:{code,message,details?}, requestId}`. HTTP status proper (400 bad URL, 401 admin, 404 absent, 409 conflicts, 410 expired, 429 limits, 502 provider error). CSRF and origin validation on state changing endpoints. Never trust a client-provided `github_run_id`, SHA, URL host, artifact R2 prefix, or callback without verifying server records.

## 12. Workflow state, queue, error handling

- States: `draft/analyzed` → `queued` → `running` (detect/install/build) → `artifact_ready` → `publishing` → `validating` → `ready/partial`; exits `failed/cancelled/expired`.
- One running build at a time. Duplicate requests matching SHA+config within pending/running should reference existing job. Existing valid cache returns existing preview where TTL permits.
- On worker crash, DO alarm recovers queue; reconcile against real GitHub status; impose heartbeat and stale timeouts. Retry dispatch **once** only if provably safe, idempotency keys prevent duplicate runs. Total failure should not block following queued builds.
- GitHub API rate/permission errors, repo 404/renamed/disabled, install errors, module resolution issues, exceeded limit, publish rejection, invalid callback, validation timeout are distinct error codes with actionable UI.
- Manual rebuild only: do not listen to upstream repo webhooks and do not poll target refs outside an admin action. Do not install cron/scheduler to auto-build upstream changes.

## 13. Performance and observability

Targets for personal use (non-guaranteed): UI interactive on mobile within ~3 seconds on typical network; analyze repo metadata within ~10 seconds for simple repos; status changes visible within ~10 seconds during build; cache-hit response without starting new job; 1 active job, default queue max 10, max source 100 MB, static build output max 100 MB (configurable). Log retention should not contain secrets. Display total storage estimate, build count, GitHub API budget and last build; no expensive continuous telemetry.

Simple event logging: login succeeded/failed, analyze, build queued/running/done, publisher accepted/rejected, TTL changed, deleted, forced cancel; do not log password/tokens, raw env or full HTTP payloads.

## 14. Acceptance criteria / test plan

**Functional**
1. Analyze public HTML repo, select SHA, static preview loads CSS/JS correctly; desktop/mobile screenshots pass.
2. Analyze Vite+React repo with lockfile and auto-detect `dist`, preview can navigate an SPA route.
3. Analyze monorepo with 2 apps; admin selects `apps/web`, build command/root changes accordingly.
4. Choose branch vs commit hash; displayed immutable SHA matches source built.
5. Same SHA+config causes cache reuse; changed config causes new build.
6. Rebuild button updates mutable branch only when manually clicked, never on repository upstream push.
7. One active build; second queued; duplicate deduped; cancel queued and active safely; stale job recovered.
8. TTL 1/7/30/permanent, delete manually; expired/deleted direct preview URL returns 410/404 and object cleanup eventually executes.
9. Full-stack-compatible test fixture: adapter deploys only if isolated security gate passes; otherwise clear `unsupported-runtime` rather than false success.
10. Broken website displays partial/failed with diagnostics and Playwright screenshots, not `Ready` just because bundler exit 0.

**Security**
11. GitHub Actions build job never receives GitHub dispatch/Cloudflare keys. Publisher cannot execute untrusted source or `.sh` from artifact.
12. Malicious tar paths, symlinks, `_worker.js`/`functions/`, oversized output, bad checksum are blocked.
13. Preview JS cannot read dashboard cookie or access authenticated API via cross-origin request.
14. Login rate limits, CSRF defenses, hashed password, invalidation/logout verified.
15. GitHub URL parser rejects SSRF host tricks and path traversal; private repos refused cleanly.

**Operations**
16. Tests (`unit`, integration with mocks, Playwright smoke) pass; TypeScript strict builds; lint passes.
17. `wrangler dev` local mock works without production credentials; GH Actions workflow syntax linted; separate deploy command docs and Cloudflare config documented.
18. README shows secrets without values, CLI setup from scratch, CI permissions, costs/quotas, rollback, TTL/domain caveats and known compatibility limits.

## 15. Delivery strategy / release gates

**Phase 0 Security feasibility gate (mandatory, before shipping external arbitrary builds):** Prove two-workflow untrusted vs privileged separation, no leakage of secrets to build, artifact scan/publish, expired URL enforcement, separate preview origin, and no unsafe Worker code execution. If any fails, only allow list of manually approved repos or disable build until fixed; do not mark production-ready.

**Phase 1 Useful static MVP:** Single-admin UI, public repo analyze and SHA, root/monorepo select, React/Vite/static build, GitHub Actions dispatch, secure publisher, R2 preview delivery, TTL/delete, cache/queue, diagnostics.

**Phase 2 Complete selected features:** Framework profiles + custom config, mobile QA/Playwright, screenshot, advanced logs, branch/tag/commit UX, status recovery, controlled full-stack adapters where security verified. Framework not compatible yields explicit report.

**Phase 3 Hardening:** Strict threat tests, failure recovery, documented cost/limit dashboard, cleanup automation *for expired files only*, operational runbook.

**Definition of Done:** All acceptance tests pass; demo builds two different public GitHub repos; threat-model/security gates pass; no secrets published; no claim of blanket full-stack compatibility; documentation contains deploy guide and clear supported/unsupported matrix.

## 16. Required repository files for Codex implementation

Proposed monorepo:

```text
byga-universal-preview/
  apps/dashboard/             # responsive React/Vite dashboard
  apps/control-worker/        # authenticated Cloudflare Worker API + DO
  apps/preview-worker/        # isolated R2 asset serving/TTL
  packages/shared/            # zod schemas, contracts, types
  packages/repo-analyzer/     # GitHub URL parsing, detection, preset rules
  packages/build-manifest/    # strict artifact manifest & validation
  .github/workflows/
    ci.yml
    build-untrusted.yml       # source checkout/install/build, no secrets
    publish-trusted.yml      # static data-only artifact publisher
    preview-validation.yml   # secretless Playwright QA
  scripts/
  docs/SECURITY.md
  docs/DEPLOY.md
  docs/COMPATIBILITY.md
  docs/COSTS.md
  docs/RUNBOOK.md
  AGENTS.md
  README.md
  package.json
  pnpm-workspace.yaml
```

## 17. Environment/secrets deployment inventory

| Name | Purpose | Where stored |
|---|---|---|
| `ADMIN_PASSWORD_HASH` + password hash parameters | password hash, not plaintext | Worker secret |
| `SESSION_SIGNING_KEY` | session or CSRF cryptographic signing | Worker secret |
| `GITHUB_DISPATCH_TOKEN` | fine-grained GitHub PAT or GitHub App token scoped to trusted orchestration repo | Worker secret |
| `GITHUB_OWNER`, `GITHUB_ORCHESTRATOR_REPO` | workflow target | Worker vars |
| `PUBLISH_CALLBACK_SECRET` | HMAC publisher callback | Worker + trusted publisher secret |
| `CF_ACCOUNT_ID` | Cloudflare account | trusted publisher vars/secrets as appropriate |
| `CF_R2_PUBLISH_TOKEN` | least privilege R2 publish only; no dashboard secret | trusted publisher secret |
| `PREVIEW_BASE_DOMAIN` | preview site hostname/domain | Worker var |
| `PREVIEW_R2_BUCKET` | target output bucket | Worker binding/trusted publisher var |
| `QUEUE` | SQLite Durable Object binding | Wrangler configuration |

Avoid variable names becoming public in frontend Vite `VITE_*` except non-secret public configs. In setup use safe placeholders, never write actual values to git.

## 18. Costs and provider constraints

- **Cloudflare Workers Free:** finite requests, CPU per invocation, memory and subrequests. **R2 Standard** has its own monthly free allowance; not equivalent to unlimited storage. **SQLite Durable Objects** have free usage with caps. Refer to current official docs at deploy time.
- **GitHub Actions:** runs in the *owner's orchestrator repo*. Public target repo status does **not** make Actions usage in a private orchestrator repo free. Private orchestration repo has plan-specific minute/storage allowance; using public orchestrator repo may have different costs but exposes workflow metadata/source and may create abuse/privacy considerations. Check billing and Terms. No bypass quota.
- **Cloudflare full-stack:** SSR adapters may need separate isolated Worker deployments and compatibility limits. Do not promise identical operation to native Node server. No automatic DB creation/provisioning. Separate account may be needed for safe untrusted runtime.
- **Custom domain:** recommended for origin-per-preview and working absolute paths. Without one, show degradation warning as above.

## 19. External references (official, verified 25 Oct 2026)

- GitHub REST Workflow Dispatch: https://docs.github.com/en/rest/actions/workflows
- GitHub Actions secure use: https://docs.github.com/en/actions/reference/security/secure-use
- GitHub Actions billing: https://docs.github.com/en/actions/concepts/billing-and-usage
- Cloudflare Workers routes/wildcard: https://developers.cloudflare.com/workers/configuration/routing/routes/
- Cloudflare Workers custom domain wildcard restriction: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare SQLite Durable Objects: https://developers.cloudflare.com/durable-objects/platform/limits/
- Cloudflare Pages Direct Upload optional: https://developers.cloudflare.com/pages/get-started/direct-upload/
- Cloudflare Pages delete preview limitations: https://developers.cloudflare.com/pages/configuration/preview-deployments/
- Codex Cloud setup: https://learn.chatgpt.com/docs/cloud

---

**Approval note:** This PRD captures all user choices #1–#15. Choices not covered through Q&A (file layout, API naming, defaults, example limits and build orchestration details) are **implementation defaults** proposed to make the product buildable; Codex may adjust them when documented, without weakening user decisions or security constraints. No guarantee of absolute free, universal compatibility, or zero security risk.
