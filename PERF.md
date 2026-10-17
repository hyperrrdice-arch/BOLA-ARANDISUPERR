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
| Initial JS | 171KB | 194KB on-wire | lihat catatan bundle |
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
| Anggaran retry same-model (Task 5) | worst case 360s → ≤240s per model | kept | Belum teramati di run nyata (butuh kegagalan model untuk memicu). Terkait: run C menunjukkan J2 menyentuh 173s dari plafon 180s, jadi anggaran retry memang relevan |
| `/api/matches` 1 gelombang (Task 6) | 1.03s → 1.07s (n=1, dalam noise) | kept sebagai simplifikasi | Bukti langsung: 5 panggilan upstream terukur 0.85–1.23s masing-masing, jadi wave 2→1 semestinya menghemat ~0.9s. Sample cold end-to-end terlalu noisy (satu sampel lain 3.7s) untuk atribusi bersih. Diff-nya juga menghapus kode, bukan menambah |
| Negative caching + in-flight dedupe (Task 7) | 6 pemanggil bersamaan → 1 fetch; upstream rusak: 2 request → 1 fetch | kept | Diuji `scripts/test-stats-cache.ts` (11 assert) |
| Plafon token debat 16384 → 2048/1536 (plan-perf-2 Task 1) | straggler 52.6s → 110.9s (B) → 173.0s (C, plafon dikembalikan) | **REVERTED** | Nol gain latensi (waktu panggilan = latensi provider) **dan** regresi kualitas: dengan plafon 2048 persona Bull menghabiskan anggaran untuk reasoning lalu tidak pernah mengeluarkan JSON — `thesis` terisi reasoning mentah dan `key_drivers` jatuh ke template. Setelah revert, JSON normal kembali |
| Atribusi round-trip planner (plan-perf-2 Task 3) | "sisa tak terjelaskan" → 23.2s di 7 step (3.3s/step) | kept | Diukur dengan tool mock instan, jadi yang tersisa murni waktu model planner. Cukup jelas untuk ditutup sebagai bukan prioritas kode |

### Pelajaran yang dicatat supaya tidak diulang

- Jangan simpulkan latensi pipeline ini dari satu run: variansi provider ±40%. Butuh ≥2 run per konfigurasi, kalau tidak hasilnya cuma sampel.
- `stage = max(anggota)`: satu panggilan model yang lambat (110–173s) menggeser seluruh run. Optimasi yang menyasar "banyak panggilan" tidak menyentuh masalah; yang perlu ditangani adalah **ekor** panggilan tunggal.
- Perubahan kode tanpa gain terukur tapi dengan risiko kualitas = revert, bukan "biarkan saja".

## Catatan bundle

Initial JS naik 171KB → 194KB on-wire (+13%). **Tidak teratribusi** ke perubahan ronde 1: semua impor `lib/view/analysis-view` dan `lib/agent/schemas` di kode client bersifat `import type` (terhapus saat build); tambahan runtime di client hanya ~20 baris JSX durasi + satu `AbortController`. Angka 171KB diambil dari build lama yang chunk-split-nya berbeda, jadi perbandingannya tidak setara. Kalau ini penting, ukur ulang dengan build lama berdampingan.

## Anggaran (plan-perf-2, Task 8)

| Anggaran | Target | Status |
|---|---|---|
| `/api/agent` warm | < 50ms | ✅ 8ms |
| `/api/agent` cold | < 240s | ⚠️ 238.9–415.4s (digegerkan ekor 1 panggilan model; bukan target yang bisa dicapai lewat perubahan kode saja) |
| `/api/matches` p95 | < 200ms | ✅ 8ms |
| `/api/odds` p95 | < 200ms | ✅ 9ms |
| Initial JS | < 200KB on-wire | ⚠️ 194KB (mepet) |
| CSS | < 50KB | ✅ 4.1KB |
| LCP `/` | ≤ 2.5s | ❓ **belum terukur — terblokir tooling** |

**Task 8 (LCP) tidak bisa ditutup di environment ini**: tidak ada MCP browser / chrome-devtools, tidak ada Lighthouse, jadi tidak ada angka LCP yang bisa dikarang. Yang bisa dipastikan secara struktur: HTML `/` statis 15.9KB (TTFB 81ms) tapi katalog di-fetch **setelah hidrasi** (`app/page.tsx:87`), jadi paint pertama adalah skeleton. Keputusan SSR katalog **ditunda** sampai ada pengukuran LCP nyata (butuh chrome-devtools MCP atau satu kali run DevTools manual).

## Langkah berikutnya (butuh keputusan user, bukan eksekusi sepihak)

1. **Ronde 2 debat = 40–74% total run, dan tidak mengubah keputusan** di ketiga run (akhirnya tetap `SPLIT_DECISION` / `C_LEAN`). Ini lever terbesar yang tersisa. Gating-nya mengubah perilaku produk → diangkat sebagai pertanyaan di `tasks/plan-perf-2.md`, tidak dikerjakan.
2. **Ekor panggilan tunggal** (110–173s). Kandidat: plafon waktu per model yang lebih pendek + degradasi eksplisit, alih-alih menunggu 180s. Ini menyentuh kualitas keputusan, jadi perlu persetujuan.
3. **Round-trip planner 23.9–38.4s** (6 step). Sudah ada Task 3 di `tasks/todo-perf-2.md`, belum dikerjakan karena belum terbukti di mana biayanya (butuh hook `onStepFinish`).

## Catatan operasional

- `data/thestats_dataset.db` sengaja **tidak di-commit**: perubahannya adalah data runtime (tabel `analysis_runs` + baris cache). Skemanya dibuat idempotent oleh `getTheStatsDb()`, jadi tidak ada state yang hilang.
- Jalur cepat memaksa analisis ulang: `?debug=1` (melewati baca & tulis cache).
