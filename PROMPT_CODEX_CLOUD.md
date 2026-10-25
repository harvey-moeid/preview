# Prompt siap pakai — Codex Cloud: BYGA Universal Repo Preview

Saya ingin Anda bertindak sebagai **principal full-stack engineer, Cloudflare architect, GitHub Actions security engineer, dan QA lead**. Bangun aplikasi siap diuji bernama **BYGA Universal Repo Preview** sesuai file `PRD_BYGA_Universal_Repo_Preview_FINAL.md` yang saya lampirkan/commit ke repo ini. Jangan hanya membuat UI mockup atau menghasilkan rencana; **implementasikan source code, tests, dokumentasi deploy, dan workflows yang benar-benar terhubung**. Jangan deploy atau mengubah resource production tanpa izin dan kredensial yang tersedia.

## Kontrak produk (wajib)

- **Penggunaan pribadi; satu admin** dengan password yang di-hash, sesi HttpOnly Secure, logout, rate limiting login.
- Input URL **repository GitHub public dari siapa pun**; repo private ditolak. Tidak perlu login GitHub bagi pengunjung dashboard. Tidak perlu GitLab/Bitbucket/ZIP di v1.
- Auto-detect framework/package manager, branch/tag/commit, monorepo/apps subfolder; fingerprint SHA+root+config untuk cache. Build melalui **GitHub Actions**, bukan Worker. **Satu build aktif** + queue, cancel, timeout, dedupe, retry terbatas, riwayat.
- Opsi build environment otomatis/manual, tetapi jangan menjanjikan bahwa setiap repo bisa berjalan. Frontend static bekerja; full-stack adapter hanya untuk framework kompatibel yang aman diisolasi; fallback status unsupported apabila backend tidak dapat dijalankan dengan aman.
- Preview **interaktif** (bukan screenshot), URL unik, iframe desktop/tablet/mobile, refresh/fullscreen, status timeline dan log terstruktur. Masa aktif **1/7/30 hari/permanen**, hapus manual dengan server-side URL revocation; cache tidak menghapus artefak pinned secara sembarangan.
- **Manual Rebuild Only:** Jangan buat auto-update upstream, webhook GitHub ke repo target, scheduled repo sync, atau auto-rebuild ketika pemilik GitHub push. Rebuild hanya dari klik admin. Job monitoring dan cleanup TTL boleh berjalan otomatis.
- Playwright smoke test setelah deploy, screenshot desktop/mobile, tangkap blank screen, request failures, JS errors, kegagalan aset; status `Ready`, `Partially Working`, `Failed` didukung bukti tes.
- UI responsive mobile-first dark navy/cyan, sesuai Developer Dashboard (tidak perlu file explorer/studio premium).
- Hemat biaya; Cloudflare Workers Free + SQLite Durable Objects + R2 Standard bila cocok; jangan wajib D1 atau paid platform. Dokumentasikan keterbatasan dan angka kuota hasil pengecekan.

## Arsitektur baseline

Monorepo TypeScript dengan pnpm: `apps/dashboard` (React + Vite), `apps/control-worker` (Cloudflare Worker REST API + SQLite-backed Durable Object untuk queue/metadata/auth), `apps/preview-worker` (R2 static assets/TTL di origin terpisah), `packages/shared` (Zod/type contracts), `packages/repo-analyzer` (GitHub API/URL/ref/candidate detect), `packages/build-manifest` (validasi data-artifact), `.github/workflows` untuk `ci.yml`, `build-untrusted.yml`, `publish-trusted.yml`, `preview-validation.yml`, plus `docs/` dan `AGENTS.md`.

Gunakan `workflow_dispatch` pada repository orkestrasinya sendiri untuk memulai source build dengan immutable SHA. Token dispatch scoped minimal dan tersimpan hanya di Worker secret. Poll status Actions API dengan backoff menggunakan Durable Object alarm atau saat UI meminta status (tidak perlu global polling terus-menerus). Mapping immutable `job_id↔run_id↔SHA↔config hash` disimpan server-side. Publisher memberi callback HMAC untuk outcome dan URL.

**Boundary keamanan: paling penting**

1. Job `build-untrusted` checkout repository GitHub pihak ketiga pada GitHub-hosted disposable runner **tanpa credentials/secrets/deploy token** (`permissions` minimum, no `pull_request_target`, `persist-credentials:false`, tidak menggunakan shared sensitive cache); atur timeout, size limits, dan source SHA. `npm install` dapat menjalankan kode asing; jangan pernah menjalankannya di Worker control atau privileged publisher.
2. `publish-trusted` terpisah dan hanya menjalankan trusted code milik repository BYGA. Proses build artifact sebagai **data**, verifikasi ukuran, checksum, manifest, path traversal, symlink, HTML/JS/static asset types; tolak special code deployment (`_worker.js`, `functions/`, script startup) dan jangan mengeksekusi file target. Kredensial Cloudflare hanya di job trusted publisher. Batasi permissions token dan artifacts retention.
3. Preview dari origin/domain terpisah dengan tidak ada cookie admin, CORS API admin tertutup, iframe sandbox, headers yang layak, `noindex`. Jangan menjadikan preview yang mengandung JavaScript dari GitHub target dipercaya. Domain `p-<id>.preview.example.com` melalui proxied wildcard DNS + Workers Route jika zone tersedia; **custom domains wildcard tidak didukung**, jangan mencoba konfigurasi itu. Buat mode fallback `workers.dev/p/<id>/` yang transparan tentang keterbatasan absolute root asset.
4. SSR/API Cloudflare Workers **tidak boleh auto-deploy source third-party** yang tidak ditinjau ke account yang menyimpan secrets/bindings. Buat extensible adapter registry dengan security gate; hanya implementasikan adapter runtime yang benar-benar dapat dibatasi, dan untuk yang lain tampilkan unsupported/partial. Jangan klaim semuanya berhasil.
5. Password hash/KDF aman dengan benchmarking CPU Worker Free, secure cookie, CSRF defense, login rate limiting, server-side sessions, HMAC callback replay protection, path canonicalization dan SSRF prevention.
6. TTL 1/7/30/permanent diverifikasi pada direct URL request. Delete dan expire mengembalikan 410/404 walau file R2 masih menunggu cleanup. Jangan andalkan UI hide atau Pages alias untuk revocation.

## Langkah kerja yang saya minta

1. Audit isi repository yang sudah ada. Jika kosong, scaffold monorepo baru. Buat `IMPLEMENTATION_PLAN.md` dengan peta modul, risiko, dan fase, lalu lanjutkan implementasi dalam task ini sejauh memungkinkan.
2. Kerjakan terlebih dahulu **security feasibility gate**: proof of isolation build/publish, manifest scanner, authenticated API, preview separated origin dan expiry enforcement. Bila gate gagal, jangan diam-diam bypass; nyatakan blocker dan buat fitur berisiko disabled.
3. Implementasikan end-to-end **static happy path**: URL public → metadata/ref SHA + app candidate → queue → GitHub Actions build → artifact → safe publisher → R2 → Preview Worker → UI preview → Playwright screenshots/status. Sertakan mocks agar unit/integration test bisa berjalan di Codex tanpa kredensial cloud.
4. Tambahkan monorepo support, framework profiles, cache, retry/cancel, TTL, screenshot, diagnostics, konfigurasi build dan UX mobile secara bertahap. Jangan menambahkan fitur di luar PRD yang membuat scope membengkak.
5. Pastikan unit/integration tests, TypeScript typecheck, lint, Playwright (minimal test fixture HTML + Vite + monorepo), security negative tests (malicious path, artifact symlink, noindex, expired URL, privileged job isolation) dan workflow YAML validation lulus.
6. Buat `.env.example` **tanpa nilai secret**, `wrangler.jsonc` contoh yang benar, migrasi/DO bindings, `README.md` detail, `docs/DEPLOY.md` dari HP/web GitHub + Cloudflare, `docs/SECURITY.md`, `docs/COMPATIBILITY.md`, `docs/COSTS.md`, `docs/RUNBOOK.md` dan template secrets/permissions minimal.
7. Lakukan review sendiri terhadap hasil build dan test. Di akhir tuliskan: file yang dibuat, keputusan arsitektur, cara menjalankan lokal, langkah setup Cloudflare/GitHub, daftar secrets yang harus saya isi manual, pengujian yang dijalankan beserta hasil, batasan yang belum selesai dan **jika ada, blocker nyata**.

## Kriteria selesai

Minimal demo dua repository GitHub public (fixture repo mock jika network unavailable; jangan mengaku live deploy) dan satu monorepo, artifact cache hit, 1 build aktif + queue, manual rebuild, 1/7/30/permanen dan delete, screenshot Playwright desktop/mobile, failed build logs, tidak ada token yang terekspos, dan direct URL expired benar-benar diblok. Jika credentials tidak tersedia, jangan mengarang status sukses deployment; sediakan dokumentasi teruji dan local mock.

**Instruksi tambahan penting:** jangan minta saya memilih ulang 15 keputusan PRD. Jangan gunakan `GitHub Actions` sebagai backend website yang berjalan terus-menerus. Jangan mengklaim gratis 100% atau kompatibilitas 100%. Jangan melakukan commit/push/deploy ke production tanpa instruksi; kerja di branch/task Codex dan siapkan perubahan yang dapat saya review. Buat hasil praktis dan bisa dikembangkan, bukan demo palsu.
