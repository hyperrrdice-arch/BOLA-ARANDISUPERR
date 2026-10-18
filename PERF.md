# Performance Ledger

Baseline diukur pada prod server lokal (`next start -p 3100`).
Metode: `curl -w %{time_total}` / `%{size_download}`, `--compressed` untuk ukuran on-wire, attribusi per stage dari `plannerTrace.steps[].durasi_ms`.

- **Baseline (pra-kerja, build `bm0Rsd9z`)**: 17 Okt 2026
- **Setelah ronde 1 (build `tZpZ4_99…`)**: 17 Okt 2026
- Rencana ronde 2: `tasks/plan-perf-2.md` · Ronde 1: `tasks/plan-perf.md`

## Baseline pra-kerja

| Pengukuran | Nilai |
|---|---|
| `/api/agent` cold (1 analisis, Ljungskile SK vs IK Brage) | **476s** |
| `/api/agent` warm | tidak ada — nol cache |
| `/api/matches` cold | 1.03s |
| `/api/odds` cold | 0.48s |
| `/` HTML statis | 12ms / 15.9KB |
| Initial JS | 171KB on-wire (8 chunk, build lama) |

## Hasil setelah ronde 1

| Pengukuran | Sebelum | Sesudah | Catatan |
|---|---|---|---|
| `/api/agent` cold (`mt_988366076` Brentford vs Liverpool) | (tidak ada match pembanding) | **238.9s** run A · 330.8s run B · 415.4s run C | variansi provider ±40%, lihat bagian di bawah |
| `/api/agent` warm | tidak ada | **8ms** (median 5 sampel, 6–9ms) | dari SQLite, payload **SHA256 identik** dengan run cold |
| Cache bertahan setelah restart proses | — | ✅ hit | `x-analysis-cache: hit`, `cached-at` dari run sebelumnya |
| Run yang ditinggalkan client | lanjut sampai selesai | **berhenti 1.0s** setelah client cut | umur request 9.1s, bukan 238s |
| Editorial hilang dari critical path | 34.9s di jalur | **1ms / 0ms** (run B & C) | di-warm-start saat debat mulai |
| Atribusi durasi (`plannerTrace`) | 0% (`durasi_ms` tidak ada) | **90.0%** (run A) | sisa = round-trip planner antar tool |
| `/api/matches` warm | 12ms (pengukuran lama) | med 7ms · p95 8ms | 35KB |
| `/api/matches` cold | 1.03s | 1.07s (n=1) | **dalam noise**, lihat ledger |
| `/api/odds` warm | 10ms | med 7ms · p95 9ms | |
| Initial JS | 171KB (angka tidak sah) | **194 KB on-wire** | A/B bersih vs `4e260ec`: +275 B on-wire. Lihat bagian Bundle |
| CSS | 4.0KB | 4.1KB on-wire | |
| `analysis_runs` (riwayat) | — | 1 baris, 27KB `view_json` | pertumbuhan ~27KB/analisis |

## Variansi antar-run mengalahkan efek perubahan kode

Tiga run match yang **sama** (`mt_988366076`), masing-masing dengan atribusi per stage:

| Run | Total | Debat ronde 1 | Debat ronde 2 | Panggilan terlambat | Catatan |
|---|---|---|---|---|---|
| A (sebelum overlap) | 238.9s | 81.9s | 95.4s | J2 52.6s | — |
| B (plafon token 2048, overlap on) | 330.8s | 156.1s | 116.7s | neutral 110.9s | persona Bull berhenti keluarkan JSON |
| C (plafon direvert, overlap on) | 415.4s | 79.5s | 295.7s | **J2 173.0s** (timeout 180s) | bull JSON normal lagi |

Bacaan:

1. Yang menentukan durasi total bukan perubahan kode, tapi **satu panggilan model yang kebetulan lambat**. `stage = max(anggota)`, jadi satu call 110–173s menggeser seluruh run. Variansi ±40% antar-run membuat klaim latensi dari satu sampel tidak sah — ini alasan klaim "lebih cepat" **tidak** dibuat di dokumen ini kecuali untuk yang deterministik (cache, cancellation, overlap).
2. **Hipotesis plafon token salah** (plan-perf-2 Task 1 → direvert): run B memotong `max_tokens` ke 2048/1536 tapi straggler-nya justru 110.9s; run C mengembalikannya ke 16384 dan straggler jadi 173s. Waktu panggilan digerakkan latensi provider, bukan panjang output.
3. **Overlap editorial aman.** Kekhawatiran awal: panggilan editorial tambahan bisa berebut dengan Stage 2 (sama-sama pakai `MODEL_JUDGEMENT_1`) dan bikin `neutral_ms` melambung. Run C membantahnya: `neutral_ms` normal 40.8s dengan overlap aktif, dan `judgement_1_ms` stabil di 18–20s di ketiga run. Editorial terabsorpsi penuh (1ms / 0ms).

## Breakdown `/api/agent` terinstrumentasi (238.5s)

| Step | Durasi | Porsi |
|---|---|---|
| check_data_integrity (fetch TheStatsAPI) | 2.3s | 1% |
| run_quant_package (kode murni) | 0.0s | 0% |
| **run_syndicate_debate ronde 1** (stage1 35.6s + stage2 46.3s) | **81.9s** | 34% |
| **run_syndicate_debate ronde 2** (stage1 42.8s + stage2 52.6s) | **95.4s** | 40% |
| run_editorial_analysis | 34.9s | 15% |
| stop_with_verdict | 0.0s | 0% |
| **Round-trip planner** (6–7 panggilan model planner, terbukti 23.2s dengan tool mock) | **23.9s** | 10% |

**Round-trip planner terjelaskan (plan-perf-2 Task 3).** Diukur pakai harness dengan **tool mock instan** (`scripts/test-planner-loop.ts`, model planner asli): 7 step = **23,243ms**, rata-rata **3.3s/step** (rentang 1.7–6.6s), dan step terakhir yang **tidak memanggil tool apa pun** tetap makan 4.4s. Artinya sisa yang dulu tidak teratribusi memang **waktu model planner** (`bai/mimo-v2.6-pro`), bukan eksekusi tool. Invariant `Σ toolCalls` = jumlah tool dieksekusi dicek di test, jadi model pengukurannya tervalidasi.

Konsekuensi: lever yang tersisa di situ cuma (a) memangkas jumlah step, atau (b) mengganti model planner — dua-duanya keputusan produk, bukan optimasi kode. Ditutup sebagai bukan prioritas kode.

**Konfirmasi di run nyata (8 step, `mt_644500856`)**: total 393.6s = **tool 337.3s + planner 56.3s**, nol sisa tak terjelaskan. Planner 56.3s / 8 step = **~7s per step** (vs 3.3s di harness mock) — lebih besar karena payload hasil tool yang asli jauh lebih besar, jadi input token per langkah planner ikut naik. Ini konsisten dengan kesimpulan di atas: biaya planner proporsional ukuran konteks, bukan kode.

Fakta dari `stage_timings`:
1. `stage_2_ms` == `judgement_2_ms` **persis** di kedua ronde (46.3s, 52.6s) → stage 2 sepenuhnya digerbangi satu model.
2. `stage_1_ms` = max(bull, neutral, bear) → Stage 1 memang paralel efektif.
3. Debat ronde 2 = **74% total run** dan dipicu otomatis oleh `CONSENSUS_LEMAH`.

## Ledger upaya

| Ide | Baseline → Hasil | Putusan | Kenapa |
|---|---|---|---|
| Atribusi durasi per stage (Task 1) | 0% → 90.0% teratribusi | kept | Tanpa ini semua optimasi berikutnya cuma tebakan |
| Cache + riwayat `/api/agent` di SQLite (Task 2) | 238.9s → 8ms warm | kept | Win terbesar; baris juga jadi korpus backtest |
| Cancellation `req.signal` (Task 3) | 238s → berhenti 1.0s setelah cut | kept | Hemat LLM; run yang di-abort tidak masuk cache |
| Editorial warm-start saat debat (Task 4) | 34.9s di jalur → **1ms / 0ms** | kept | Terabsorpsi penuh di 2 run; `judgement_1_ms` tidak ikut melambat (18–20s) jadi tidak ada rebutan provider |
| Anggaran retry same-model (Task 5) | worst case 360s → **240s teramati** | kept | **Terbukti di run nyata**: `judgement_2_ms` = 240.069 ms = 180s timeout + 60s retry (sebelum perubahan: 180+180 = 360s) → hemat 120s nyata. Retry tetap model sama, independensi vendor terjaga. Konsekuensi jujur: karena retry juga kehabisan waktu, `judgement_2` turun ke `[Template fallback]` — degradasi terlihat, bukan diam-diam |
| `/api/matches` 1 gelombang (Task 6) | 1.03s → 1.07s (n=1, dalam noise) | kept sebagai simplifikasi | Bukti langsung: 5 panggilan upstream terukur 0.85–1.23s masing-masing, jadi wave 2→1 semestinya menghemat ~0.9s. Sample cold end-to-end terlalu noisy (satu sampel lain 3.7s) untuk atribusi bersih. Diff-nya juga menghapus kode, bukan menambah |
| Negative caching + in-flight dedupe (Task 7) | 6 pemanggil bersamaan → 1 fetch; upstream rusak: 2 request → 1 fetch | kept | Diuji `scripts/test-stats-cache.ts` (11 assert) |
| Plafon token debat 16384 → 2048/1536 (plan-perf-2 Task 1) | straggler 52.6s → 110.9s (B) → 173.0s (C, plafon dikembalikan) | **REVERTED** | Nol gain latensi (waktu panggilan = latensi provider) **dan** regresi kualitas: dengan plafon 2048 persona Bull menghabiskan anggaran untuk reasoning lalu tidak pernah mengeluarkan JSON — `thesis` terisi reasoning mentah dan `key_drivers` jatuh ke template. Setelah revert, JSON normal kembali |
| Atribusi round-trip planner (plan-perf-2 Task 3) | "sisa tak terjelaskan" → 23.2s di 7 step (3.3s/step) | kept | Diukur dengan tool mock instan, jadi yang tersisa murni waktu model planner. Cukup jelas untuk ditutup sebagai bukan prioritas kode |
| Kompresi JSON API (`lib/http-json.ts`) | `/api/matches` 36.954 B → 5.989 B · `/api/odds` 2.712 → 699 B | kept | Audit `uses-text-compression` 0.5 → 1; LCP 681→600ms, SI 1416→600ms. Diuji `scripts/test-http-json.ts` (12 assert) termasuk penghormatan `Accept-Encoding` |
| Code-split 9 kartu analisis (next/dynamic) | initial JS 194 KB → 183 KB on-wire | kept, tapi **ekspektasinya salah** | Kartu analisis memang tidak terjangkau pada paint pertama, jadi memindahkannya benar secara delivery (−11 KB JS jalan-pertama). TAPI tujuan yang diklaim (menurunkan render delay / LCP mobile) **tidak tercapai**: LCP mobile 2459 → 2487 ms (noise). Biayanya 6 request tambahan saat analisis dibuka. Sisa flag `unused-javascript` (49 KB) ternyata di chunk vendor React, bukan kode app |

### Pelajaran yang dicatat supaya tidak diulang

- Jangan simpulkan latensi pipeline ini dari satu run: variansi provider ±40%. Butuh ≥2 run per konfigurasi, kalau tidak hasilnya cuma sampel.
- `stage = max(anggota)`: satu panggilan model yang lambat (110–173s) menggeser seluruh run. Optimasi yang menyasar "banyak panggilan" tidak menyentuh masalah; yang perlu ditangani adalah **ekor** panggilan tunggal.
- Perubahan kode tanpa gain terukur tapi dengan risiko kualitas = revert, bukan "biarkan saja".

## Bundle — A/B bersih (worktree terpisah, build + node_modules + metode sama)

Dijalankan di worktree terisolasi: `4e260ec` (sebelum kerjaan perf) vs `121e30d` (commit perf terakhir). Cara ukur: ambil 8 `<script src>` dari HTML `/`, `curl --compressed` per chunk.

| | chunk app | total on-wire | total raw |
|---|---|---|---|
| **BEFORE** `4e260ec` | `1rt17a5snc2qj.js` — 21,726 B / 95,005 B | **194 KB** | 656 KB |
| **AFTER** `121e30d` | `3ha6r8ir9o98k.js` — 22,001 B / 96,067 B | **194 KB** | 657 KB |
| **Selisih** | **+275 B on-wire / +1,062 B raw** | 0 | +1 KB |

Tujuh chunk lain **byte-identik**. Jadi biaya client-side dari seluruh kerjaan perf = **~1 KB raw** (tampilan durasi per step + `stage_timings` + `AbortController`) — 0,14% dari total, tidak signifikan.

Koreksi catatan sebelumnya: angka "171 KB" adalah **pembanding yang tidak sah** (build lama dengan chunk-split berbeda), bukan baseline. Baseline sah untuk `4e260ec` adalah 194 KB — sama dengan hasil akhir. Checklist "bundle size hasn't increased significantly" **terpenuhi**.

## Anggaran (plan-perf-2, Task 8)

| Anggaran | Target | Status |
|---|---|---|
| `/api/agent` warm | < 50ms | ✅ 8ms |
| `/api/agent` cold | < 240s | ⚠️ 238.9–415.4s (digegerkan ekor 1 panggilan model; bukan target yang bisa dicapai lewat perubahan kode saja) |
| `/api/matches` p95 | < 200ms | ✅ 8ms |
| `/api/odds` p95 | < 200ms | ✅ 9ms |
| Initial JS | < 200KB on-wire | ✅ **183 KB** (setelah code-split; dari 194 KB) |
| `/api/matches` transfer | < 10 KB | ✅ **5,9 KB** (gzip manual; dari 36,9 KB) |
| Kompresi respons JSON API | `Content-Encoding: gzip` | ✅ matches/odds/agent |
| CSS | < 50KB | ✅ 4.1KB |
| LCP `/` | ≤ 2.5s | ⚠️ desktop **502 ms** ✅ · mobile+4×CPU **2487 ms** — lolos tipis, **tidak membaik** oleh kompresi/code-split. SSR katalog tidak dikerjakan (belum terbukti jadi penyebabnya) |

## LCP & Core Web Vitals (Chrome DevTools MCP — trace nyata, bukan simulasi)

Diukur 18 Okt 2026 terhadap prod lokal `next start -p 3100`, build perf terakhir. Dua kondisi: desktop tanpa throttle, dan kasus terburuk (mobile 390×844 + Fast 3G + CPU 4×).

| Metrik | Desktop 1440×900 | Mobile 390×844 · Fast 3G · CPU 4× | Target |
|---|---|---|---|
| **LCP pra-fix** | 483 ms ✅ | 2459 ms ⚠️ (lolos 41 ms) | ≤ 2.5s |
| **LCP pasca-fix** | **502 ms** | **2487 ms — TIDAK berubah (noise)** | ≤ 2.5s |
| LCP breakdown — TTFB (pra-fix) | 33 ms | 22 ms | — |
| LCP breakdown — render delay (pra-fix) | 450 ms | 2437 ms (99.1% LCP) | — |
| CLS | 0.01 ✅ | 0.00 ✅ | ≤ 0.1 |

**Mobile LCP tidak membaik setelah kompresi + code-split (2459 → 2487 ms, selisih dalam noise).** Ini menggugurkan klaim awal di dokumen ini bahwa lever-nya adalah 49 KB JS tak terpakai yang bisa dipotong code-split: ternyata menendang kartu analisis keluar dari bundle awal **tidak** mengurangi render delay. Penyebab render delay 99% itu ada di main thread saat hidrasi — baseline React yang tetap harus di-parse/di-eksekusi + CSS render-blocking yang harus tiba dulu di Fast 3G — bukan di kode kartu analisis.

Lever yang benar-benar tersisa untuk metrik ini (SSR/streaming, critical CSS, atau memangkas baseline framework) berada di luar scope "delivery ringan" dan butuh keputusan produk. Dicatat sebagai batas, bukan diklaim beres.

### Temuan dari trace & inspeksi

1. **`/api/matches` dikirim TANPA kompresi — SUDAH DIPERBAIKI.** Terkonfirmasi dua sumber independen:
   - Lighthouse: 36 KB transfer / 36 KB resource (rasio 1.01), **30 KB terbuang**.
   - Chrome DevTools (`get_network_request`): response header cuma `content-type: application/json` + `transfer-encoding: chunked` — nol `content-encoding`. Chunk JS di navigasi yang sama: `content-encoding: gzip`.
   Perbaikan: `lib/http-json.ts` (`gzipSync`, hormati `Accept-Encoding`, ambang 1 KB, `Vary: Accept-Encoding`), dipakai `/api/matches`, `/api/odds`, `/api/agent`. Hasil terukur: `/api/matches` **36.954 B → 5.989 B (hemat 30 KB, 84%)**, `/api/odds` 2.712 → 699 B, audit `uses-text-compression` **0.5 → 1**.
2. **49 KB JS tidak terpakai di layar katalog — SUDAH DIKURANGI, tapi sumbernya bukan kode app.** Kartu analisis di-`next/dynamic` (9 komponen): initial JS **194 → 183 KB on-wire**. Sisa flag `unused-javascript` 49 KB ternyata ada di **chunk vendor React/React-DOM** (224 KB & 177 KB raw) — internal framework, bukan komponen aplikasi, jadi tidak bisa dihapus lewat code-split komponen. Dicatat sebagai batas, bukan target.
3. Font: 4 file woff2 = **83 KB** transfer (29+23+16+15). Prioritas rendah.
4. **Console tidak bersih — 1 issue a11y** (bukan perf): "A form field element should have an id or name attribute" (input pencarian di `FilterToolbar`). Dicatat, belum diperbaiki.

Catatan metode: trace mentah (`chrome-trace-*.json.gz`, ~5.7 MB) dan screenshot DevTools dihapus setelah angkanya dicatat di dokumen ini — bukan artefak yang disimpan di repo.

### Lighthouse sebelum vs sesudah fix (desktop preset, throttling `simulate`)

| Audit | Sebelum | Sesudah |
|---|---|---|
| `uses-text-compression` | 0.5 (30 KB terbuang) | **1** ✅ |
| `unused-javascript` | 49 KB | 49 KB (vendor React) |
| Initial JS on-wire | 194 KB | **183 KB** |
| LCP | 681 ms | **600 ms** |
| FCP | 350 ms | **300 ms** |
| Speed Index | 1416 ms | **600 ms** |
| TBT | 213 ms | **180 ms** |
| CLS | 0.015 | 0.015 |

## Langkah berikutnya (butuh keputusan user, bukan eksekusi sepihak)

1. **Kompresi JSON API (baru, temuan Lighthouse).** `/api/matches` 36 KB tanpa `Content-Encoding` → ~30 KB terbuang; `/api/agent` & `/api/odds` jalur sama. Perbaikan: helper kompresi di sisi route (`node:zlib` gzip, hormati `Accept-Encoding`), lalu verifikasi header + delta Lighthouse. Tidak menyentuh produk, hanya delivery.
2. **Code-split kartu analisis (baru, temuan Lighthouse).** 49 KB JS tidak terpakai di layar katalog karena kartu analisis diimpor eager. Kandidat `next/dynamic`. Tidak menyentuh produk (perilaku sama), tapi ada risiko regresi UI ringan.
3. **Ronde 2 debat = 40–74% total run**, dan di 4 run hasilnya tetap tidak berubah keputusan. Ini lever terbesar yang tersisa. Gating-nya mengubah perilaku produk → butuh keputusan user.
4. **Ekor panggilan tunggal** (110–173s dari plafon 180s). Kandidat: plafon waktu lebih pendek + degradasi eksplisit. Menyentuh kualitas keputusan.
5. **Round-trip planner 23.2s (3.3s/step)** — sudah diatribusi; lever = pangkas step atau ganti model planner (keduanya keputusan produk).

## Catatan operasional

- `data/thestats_dataset.db` sengaja **tidak di-commit**: perubahannya adalah data runtime (tabel `analysis_runs` + baris cache). Skemanya dibuat idempotent oleh `getTheStatsDb()`, jadi tidak ada state yang hilang.
- Jalur cepat memaksa analisis ulang: `?debug=1` (melewati baca & tulis cache).
