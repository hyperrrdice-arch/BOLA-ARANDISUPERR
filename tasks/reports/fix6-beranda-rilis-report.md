# Laporan Fix-6 — Butir 6 Review K8 (Beranda Jujur, Lint/CI/Kontrak, Biaya Halaman, Backlog, Paritas)

- **Branch:** `fix/review-k8` (worktree `app-football-fix`), dari tip `df78c04`. Tanpa merge, tanpa menyentuh produksi/VPS/master. κ tetap 10. Berkas read-only (`lib/agent/*`, `lib/coverage.ts`, `lib/syndicate-orchestrator.ts`, `lib/llm/*`) tidak diubah kodenya.
- **Commit:** `20708f1` (§3 biaya halaman) · `96f4dd5` (§1 beranda) · `8c05d49` (§2 lint/CI/kontrak) · `d232ea0` (tes fix6) · `586c4d5` (perbaikan lint kode baru) · `e126153` (§5 paritas) · laporan ini.
- **Regresi penuh:** **713/713 asersi hijau** — permukaan lama 650 (persis angka brief) + 63 baru (42 kontrak API + 21 fix6). `tsc --noEmit` exit 0, `npm run build` exit 0, gerbang lint lolos. Rincian per suite di §6.

---

## §1 Beranda jujur + sorotan hari ini

**Cacat:** subline hero menyebut "diperiksa terhadap {lab_resolved} **laga** masa lalu" padahal `lab_resolved` menghitung **baris pilihan** lab yang teresolusi (angka publik 163.008 adalah baris, bukan laga).

**Perbaikan (satu pendekatan, konsisten):** penyebut kata "laga" diganti hitungan laga unik yang eksplisit; semua hitungan baris tetap disebut "pilihan" (StatsRow, AmberBand, HowItWorks, RecordTable memang sudah benar menyebut "pilihan" — hanya subline yang salah).

- `lib/web/data.ts`: `LandingStats.lab_resolved_matches` = `COUNT(DISTINCT p.match_id)` atas pilihan lab teresolusi; `HeroSubline` memakai angka itu. Bukti adapter (tes fix6 kelompok C): 3 pilihan lab teresolusi atas 2 laga → `lab_resolved = 3`, `lab_resolved_matches = 2`.

**Sorotan hari ini** (`todaySpotlight()` di `lib/web/data.ts` + pulau `SpotlightToday` di `app/page.tsx`):

- Memilih dari paket upcoming: laga yang tanggal WIB-nya (Asia/Jakarta) **hari ini** dan punya tiga peluang 1X2 model; prioritas: belum sepak mula → gerbang `calibrated` → kickoff terawal. Menampilkan nama laga, kompetisi, waktu kickoff WIB (`tanggalJamWib`), tiga peluang utama, waktu terbit paket (`computed_utc`), dan tombol **"Baca analisis"** menuju `/pertandingan/<match_id>`.
- Hierarki: di ponsel sorotan `order-1` (memimpin layar awal), bola 3D `order-2`; di desktop urutan lama dipertahankan (bola dulu, sorotan sesudahnya). **Bola 3D tidak dibongkar** — tetap objek tanda tangan (keputusan desain pemilik), hanya urutan hierarki yang disusun.
- Hari tanpa laga layak → sorotan tidak dirender (null), beranda kembali ke bentuk lama.

**Uji render 390 px** (build produksi + `next start` di sandbox terseed: laga hari ini 23:30 WIB vs kontrol laga besok; stack puppeteer yang sama dengan bukti K1–K8) — **14/14 cek lolos**, log + tangkapan layar di `tasks/reports/fix6-beranda-rilis/` (`beranda-390.png`, `detail-390.png`; log tidak ter-commit karena `.gitignore` repo mengecualikan `*.log`, isinya dikutip di sini):

- sorotan tampil, memuat laga hari ini (Persija Jakarta vs Persib Bandung), **bukan** laga besok; tiga peluang tampil (52% / 27% / 21% — format `pct()` kanonik situs); waktu terbit tampil; tombol menunjuk `/pertandingan/sm_fix6_today`.
- sorotan di atas bola pada ponsel (y=220 vs y=553), canvas bola tetap hadir.
- **satu ketukan** dari sorotan tiba di detail laga yang benar; **tanpa overflow horizontal** di beranda maupun detail (`scrollWidth = 390 = innerWidth`).
- subline ter-render membaca "2 laga masa lalu" (laga unik dari seed 3 pilihan / 2 laga) dan statistik "3 pilihan tercatat".

## §2 Lint + CI + kontrak API

**Keadaan awal (terukur di kandidat):** 92 error + 6 warning, 17 berkas. (Review menyebut 5 warning; keadaan aktual saat kartu dikerjakan adalah 6 — baseline merekam keadaan aktual.) Terbesar: `lib/stats-validator.ts` 24× `no-explicit-any`, `lib/stats-fetcher-agent.ts` 14, `lib/agent/planner.ts` 13 (read-only), `lib/db/thestats-dataset.ts` 9, `lib/syndicate-orchestrator.ts` 8 (read-only), `lib/view/analysis-view.ts` 6, `lib/stats-cache.ts` 5, `app/api/odds/route.ts` 4.

**Jalur baseline eksplisit (sesuai izin review):**

- `lint-baseline.json` (ter-commit): hitungan error **dan** warning per (berkas, aturan) dari kandidat — dapat diaudit, dapat di-diff.
- `scripts/lint-gate.mjs` (`npm run lint:gate`): menjalankan eslint JSON, lalu **gagal hanya bila** hitungan error suatu (berkas, aturan) melebihi baseline atau muncul di berkas/aturan baru. Baseline menyusut selalu lolos dan dilaporkan (supaya pembayaran utang terlihat). Warning dicatat di baseline untuk audit, tidak menggerbangi. Mode `--update` menulis ulang baseline — hanya untuk pembayaran utang yang disengaja dan ditinjau lewat diff.
- **Bukti dua arah:** gerbang lolos di pohon kandidat (exit 0); dengan satu error `any` disuntikkan ke berkas uji, gerbang gagal (exit 1) menyebut berkas + aturan + selisihnya. Gerbang juga **menangkap kode baru kartu ini sendiri** (1 `any` + 2 warning di berkas tes baru) — diperbaiki di kodenya (commit `586c4d5`), baseline **tidak** dinaikkan; berkas baru Fix-6 kini 0 error 0 warning.
- **CI** (`.github/workflows/ci.yml`, satu job, tahap berurutan ketat — langkah gagal menghentikan tahap berikutnya): checkout → Node 24 → `npm ci` → **lint-gate** → typecheck → test:quant → test:data → test:web → **test:api** → test:e2e → baseline D01 → build. Urutan persis ini disimulasikan lokal di VM (GitHub Actions tidak bisa dijalankan dari sini): semua tahap hijau (lihat §6).

**Uji kontrak HTTP** (`tests/test-api-contract.ts` + `tests/helpers/api-probe.ts`, script `test:api`, masuk CI) — **42/42 asersi**. Handler asli dipanggil di sandbox fixture, upstream diganti stub `fetch` per skenario (satu proses per skenario):

| Endpoint | Skenario teruji (status + bentuk) |
|---|---|
| `/api/matches` | store lokal → 200 `offline:true`, total/id benar; `hours=999` → di-clamp 48; upstream mati-auth (401 `KEY_REVOKED`) → **200 kosong** `offline:true` (degradasi jujur); upstream 500 → **500 `{error}`**; upstream ok → 200 `offline:false` + pemetaan tim; upstream kosong → 200 total 0 |
| `/api/odds` | tanpa `match_id` → **400** `{error}` menyebut match_id; anchor lokal `has_odds=0` → 200 `source:"local_anchor_empty"`, `is_available:false`, `bookmakers:[]`; provider gagal → 200 `source:"upstream_error"`; upstream kosong → `source:"upstream_empty"`; upstream ok → `is_available:true`, bookmaker terurai (Pinnacle), `best_odds.home.price` = 2.1 |
| `/api/agent` | tanpa `match_id` → **400 `{error}`**; snapshot cache segar → 200, header `x-analysis-cache: hit`, view tersimpan disajikan persis; provider mati (router tak terjangkau) → **500 `{error: "Pipeline Enterprise Gagal: …"}`** |
| `/api/betting` | belum terkonfigurasi → GET & POST **503 `{status:"unavailable"}`**; tanpa parameter → GET & POST **400 `{error}`**; laga tak ditemukan di 1xBet → 200 `not_found`; pasar kosong → 200 `empty`; provider gagal → **500 `{error}`**; pasar ada + LLM mati → **200 `success`** dengan kedua model `result.success:false` (degradasi internal, bukan 500) |

## §3 Biaya halaman

Pengukuran: penghitung eksekusi pada prototipe `DatabaseSync` (prepare/exec) atas salinan data mirip produksi; statistik cohort dibenchmark 15× panggilan hangat, median/p95.

| Sasaran | Sebelum | Sesudah | Cara |
|---|---|---|---|
| Jadwal, 7 item (1 hari) | **51 SQL** | **6 SQL** (halaman + cakupan = **8**) | konteks batch di `listSchedule`: alias self-join massal, dataset/katalog massal per potongan 900 id, nama tim via JOIN — N+1 per item hilang |
| Jadwal, 45 item | **293 SQL** | **6 SQL** (halaman = **8**) | sama — biaya tak lagi tumbuh per item |
| Feed pilihan, 75 laga (dingin) | **77 SQL** | **3 SQL** (hangat 2) | `muatNamaPaketBatch` di `daftarPilihanPraLaga`/`ambilRekam` — satu `IN(...)` per 900 paket menggantikan satu kueri per pilihan |
| Feed pilihan, 10 laga (dingin) | 12 SQL | **3 SQL** | sama |
| Cohort hangat, median | **339 ms** | **29 ms** | agregasi dipindah ke SQL terpisah (settled dari sisi outcomes; klasifikasi jam hanya atas baris pending) + indeks covering `idx_pick_outcomes_agg` + cache per filter |
| Cohort hangat, p95 | **493 ms** | **30 ms** | sama |

Sasaran PRD ≤ 8 SQL per halaman **tercapai** di kedua halaman; sasaran cohort median ≤ 100 ms / p95 ≤ 150 ms **tercapai** dengan cache.

**Invalidasi cache (syarat review):** kunci cache dilengkapi *tanda tangan keadaan* dari satu kueri agregat `(n_picks, MAX(id), n_voids, n_outcomes, SUM(hit), SUM(home_goals), SUM(away_goals))` — **koreksi skor di tempat (baris outcome yang sama ditulis ulang, tanpa baris baru) mengubah tanda tangan → cache gugur**. Selain itu cache punya kedaluwarsa eksak di transisi klasifikasi jam terdekat (kickoff / kickoff+6 jam), sehingga hasil yang disajikan dari cache **persis** sama dengan hitung ulang selama jendelanya. Bukti terprogram (`tests/test-fix6.ts` kelompok A, 10 asersi): koreksi 0-2 miss → 3-2 hit tanpa perubahan jumlah baris mengubah hits 1→2 dan hit_ratio 0,5→1; panggilan di dalam jendela transisi identik dari cache; sesudah kickoff dihitung ulang (not_started 1→0, awaiting 0→1). Kelompok B mengunci kontrak ≤ 8 SQL pada fixture 10 laga (jadwal terukur 8 termasuk cakupan; feed 2 hangat).

Catatan kejujuran angka: VM berbagi CPU — angka absolut berfluktuasi ±40% antar-run (baseline K8 membaca median 342,9 ms untuk kode lama; pengukuran kartu ini 339 ms). Angka sesudah diukur pada salinan data yang sama dan metode yang sama.

## §4 Backlog 3.821 — READ-ONLY (nol perubahan data)

Metode: Python `sqlite3` mode `ro` atas DB checkout utama VM + salinan bukti migrasi K1 untuk antrean identitas; `now = 2026-11-20T14:30:00Z`. **Tidak ada satu pun baris data yang diubah.**

**Rekonsiliasi persis:** pilihan live-run jatuh tempo = 5.142 = 1.321 ternilai + **3.821 pending** (angka review cocok persis); 2.663 pending lain belum jatuh tempo. Rentang kickoff backlog 5–20 Nov 2026. Campuran sumber id: sm_ 3.444 · mt_ 362 · fd_ 15.

**Kelompok menurut alasan:**

| Alasan | Jumlah | Rincian |
|---|---:|---|
| Hasil belum masuk | **3.496** | sm 3.156 · mt 325 · fd 15 — kompetisi terbukti mengalir hasilnya, tetapi skor final laga ini (dan kembar tertautnya) belum ada di dataset |
| Di luar cakupan sumber hasil | **252** | hanya 3 kompetisi, semua sm_: Pro League sm:944 = 130, UAE Pro League sm:959 = 64, Super League sm:989 = 58 — 0 pick ternilai, 0 baris dataset Nov-2026, tanpa alias divisi fd |
| Identitas ambigu | **73** | sm 36 · mt 37 — skor final ADA di dataset tetapi di bawah id kembar fd_; id pick sendiri tak punya baris hasil (Eredivisie 47, Bundesliga 26) |
| Konflik skor | **0** | lihat sampel terverifikasi di bawah |

**Menurut umur:** hasil belum masuk — 0–3 hari 114 · 4–7 hari 583 · 8–14 hari 2.799. Identitas ambigu — semua 8–14 hari (73). Di luar cakupan — 0–3 hari 77 · 8–14 hari 167 · >14 hari 8.

**Liga terbanyak (semua alasan, 61 liga):** FA Cup sm:24 = 182 · La Liga 2 sm:567 = 139 · Pro League sm:944 = 130 · La Liga sm:564 = 128 · Premier League sm:8 = 126 · Bundesliga sm:82 = 123 · Serie B sm:651 = 119 · Serie A sm:384 = 116 · Eredivisie sm:72 = 116 · Liga BetPlay sm:672 = 115.

**Sampel terverifikasi manual (satu per alasan):**

- *Hasil belum masuk* — pick 326692 (sm_19744997, Castellón vs SD Eibar, La Liga 2, 6 Nov): tidak ada baris dataset pada tanggal itu dengan nama tim mirip (79 kandidat diperiksa); kompetisinya punya 40 pick live ternilai → tercakup, hasilnya memang belum masuk.
- *Di luar cakupan* — pick 326197 (sm_19778776, Pro League sm:944, 5 Nov): 0 pick ternilai, 0 baris dataset Nov-2026, 715 baris historis, tanpa alias `legacy-div` → di luar cakupan sumber hasil.
- *Identitas ambigu* — pick 328808 (mt_733047969, Eredivisie): kembar fd_ `fd_N1_20261108_heerenveen_feyenoord` berstatus finished 5–3 pada kickoff yang persis sama; grup tautan ada di `fixture-links.json`, tetapi pick tak teresolusi. Sampel kedua: pick 329799 — kembar fd_ Hoffenheim–Schalke 2–1 finished.
- *Konflik skor* — antrean K1 memuat 32 fixture, semuanya beralasan `identity_ambiguous` (bukan konflik antar-sumber yang menahan pick). Sampel sm_19480366: skor bertentangan 4–1 vs 3–2 (sm_19516251). **Nol pick** (semua sumber/keadaan) merujuk ke-32 fixture itu — lewat id, alias, maupun saudara tautan — dan nol pick backlog punya ≥2 skor saudara yang berbeda. Jadi konflik skor menjelaskan **0** dari 3.821; ke-32-nya fixture historis tanpa pick (konsisten temuan K1).

Caveat klasifikasi: "hasil belum masuk" berarti tidak ditemukan skor final untuk fixture maupun kembar **tertautnya** di kompetisi yang hasilnya terbukti mengalir (bukti-aliran: divisi fd alias punya baris Nov-2026, atau kompetisi punya baris dataset Nov-2026, atau ≥1 pick live ternilai).

## §5 Paritas ARCHITECTURE

Hanya §8 dan §10 yang diubah (diff: 2 hunk, +24/−4):

- **§8** — blok baru "**Status paritas refresh (per 20 Nov 2026)**": perbaikan telemetri **sudah berjalan di VPS** menurut konfirmasi pemilik (rantai VPS US menyelesaikan ke-8 langkah; langkah telemetri ±30 detik saat migrasi 19 Nov 2026); **repo BELUM memuat commit perbaikan itu** — terverifikasi: `scripts/build-canonical-telemetry.ts` baris 61 masih `SELECT * FROM team_match_logs` … `.all()` (satu-satunya commit yang menyentuh berkas itu adalah commit fase-4 lama); status resmi = **menunggu patch/SHA tersanitasi dari pemilik**; sampai tiba, langkah telemetri repo ↔ VPS dinyatakan tidak paritas.
- **§10 butir 11** — ditulis ulang dari teks basi ("pick beku sejak 9 Nov; ledger VM acuan") menjadi status paritas yang sama: perbaikan berjalan di VPS atas konfirmasi pemilik, repo belum memuat commit-nya, status resmi menunggu patch/SHA tersanitasi dari pemilik.
- **Tidak ada referensi commit/patch yang dikarang** — satu-satunya rujukan berkas adalah keadaan repo yang terverifikasi di atas.

## §6 Regresi

| Suite | Hasil |
|---|---:|
| test:quant (quant + model + model-artifacts + experiment-stats) | 22 + 61 + 32 + 23 = 138/138 |
| test:data (data + identity + publication + tickets + resolver-score) | 18 + 58 + 110 + 69 + 23 = 278/278 |
| test:web (web + ui + rekam + detail-render + **fix6 baru**) | 12 + 66 + 110 + 27 + 21 = 236/236 |
| **test:api (baru)** | 42/42 |
| test:e2e | 7/7 |
| test:baseline:d01 | 12/12 |
| **Total** | **713/713** |
| lint:gate | lolos (92 error = baseline, 0 baru) |
| tsc --noEmit | exit 0 |
| npm run build | exit 0 |

## Penyimpangan eksplisit

1. **Warning baseline 6, bukan 5** seperti tertulis di review — baseline merekam keadaan aktual kandidat saat kartu dikerjakan (satu warning bertambah sejak review ditulis, dari berkas lama). Error tetap 92, cocok dengan review.
2. **CI GitHub tidak dijalankan dari VM ini** — yang dibuktikan adalah urutan tahap persis CI dijalankan lokal satu per satu dan semuanya hijau, plus workflow-nya sendiri diubah minimal (langkah lint diganti gerbang, langkah test:api disisipkan). Run PR pertama akan menjadi bukti di GitHub.
3. **Cek render**: ekspektasi awal skrip uji ("52,0%") salah terhadap format `pct()` kanonik situs ("52%") — yang diperbaiki adalah ekspektasi skrip, bukan tampilan; bukti final 14/14 dengan format situs apa adanya.
4. Angka cohort "sebelum" diukur ulang di VM ini (339 ms) vs catatan K8 (342,9 ms) — selisih fluktuasi VM berbagi; metode dan data salinan yang sama dipakai untuk sebelum/sesudah di kartu ini.
