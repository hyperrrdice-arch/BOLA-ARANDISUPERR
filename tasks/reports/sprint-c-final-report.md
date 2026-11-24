# Laporan Final Sprint C — Data, Fix-4 & Sumber Kedua

- **Brief:** `Agent_Brief_Sprint_C_Data_Fix4.md` (sign-off pemilik 25 Nov 2026)
- **Basis:** master `937ba92` (PR 1A–4 + Sprint A+B merged & live)
- **Branch:** `sprint/c-data-fix4` · **Worktree:** `app-football-sprintc`
- **Status sprint:** SELESAI Fase 0–3 + Fase 5; Fase 4 DEFERRED_WAITING_25NOV_DATA.
  **Belum merge, belum deploy, tidak ada promosi model, tidak ada tulisan ke
  produksi** — merge/deploy menunggu review pemilik atas laporan ini.

## Tabel wajib (per fase & item)

| Fase & Item | Status | Commit & file utama | Bukti verifikasi | Catatan / blocker |
|---|---|---|---|---|
| Fase 0 — basis, peta kode, cek token | SELESAI | `c241e17` · `tasks/reports/sprint-c-fase0-report.md` | Baseline worktree segar: tsc 0 · lint:gate PASS (91 ≤ 92) · test:quant 0 · test:data 0 · test:api 42/42. Token dicek per NAMA saja (`grep -c`): `APIFOOTBALL_API_KEY` = 0, `FOOTBALL_DATA_API_TOKEN` = 0 → ABSENT | Jalur §0.3 brief berlaku: semua dibangun dengan mock realistis; verifikasi live-fetch = WAITING_OWNER_TOKEN |
| Fase 1 — Item 23 (Fix-4: tiket resmi harian) | SELESAI (kode) | `6715dfc` · `lib/picks/fix4-policy.ts`, `lib/picks/fix4-tickets.ts`, `scripts/generate-fix4-ticket.ts`, `tests/test-fix4.ts` | Suite Fix-4 **35/35** · L01 **47/47** · tsc 0 · lint PASS · test:api 42/42 | Kebijakan beku sesuai keputusan pemilik: tepat 4 pilihan, maks 1 tiket/hari, cutoff 14:00 WIB, published_prob ≥ 0,72, ABSTAIN wajib bila kandidat < 4, maks 1 pilihan/laga, hanya kompetisi berfeed terverifikasi, ranking deterministik (published_prob desc, fixture_id asc). Jendela harian = (D 14:00 WIB, D+1 14:00 WIB]; filter as-of-cutoff `created_utc <= decision_ts`. Metrik bukti tiket utuh: WIN/LOSS/VOID_OR_UNRESOLVABLE, ticket_hit_rate, expected_hit_rate (Π published_prob dibekukan saat publikasi), abstain_days, cakupan, Wilson 95% CI. **Generator TIDAK di-hook ke free-refresh dan TIDAK dijalankan ke data produksi** — aktivasi = langkah pasca-merge pemilik. Smoke test hanya di DB kosong /tmp → ABSTAIN jujur, exit 0 |
| Fase 2 — Item 20 + Item 3 (MarketSnapshot + T02) | SELESAI (kode) · live-fetch WAITING_OWNER_TOKEN | `a740733` · `lib/feeds/api-football.ts`, `lib/market/market-snapshot.ts`, `scripts/capture-odds-apifootball.ts`, integrasi report-only di `scripts/pick-slate.ts`, `tests/test-market-snapshot.ts` | Suite T02 **39/39** · test:data 0 · test:quant 0 (injeksi masa depan 22/22, promote-gate 21/21, Q0 19/19, Q2 11/11) · tsc 0 · lint PASS | Store append-only di DB khusus `data/market_snapshots.db`; revisi = hitungan prior + 1; `first_observed` dipertahankan bila odds identik, baru bila odds berubah. Devig memakai `stripVigShin`/`stripVigTwoWay` repo + renormalisasi eksak (jumlah = 1,0 dalam 1e-9; fungsi repo membulatkan 4 desimal untuk tampilan). Selector ketat: `first_observed <= decision_ts < kickoff_ts` DAN umur ≤ 12 jam, alasan abstain eksplisit (`no_snapshot`/`future_quote`/`in_play_quote`/`stale_quote`). Di pick-slate hasilnya **report-only** (blok `market_snapshot` di JSON hasil) — nol efek ke probabilitas/paket/pick. Rate limiter API-Football: ≤ 9 req/menit, ≤ 80 req/hari per proses, berhenti bila header sisa ≤ 20. Jendela 09:00/18:00 WIB disiapkan di script; **cron TIDAK didaftarkan** (aktivasi di checklist pemilik). Deviasi tercatat: brief menamai `scripts/capture-odds.ts`, tetapi file itu khusus Sportmonks — tidak ditimpa; script baru dibuat. 1xbet: `lib/1xbet.ts` adalah klien UI per-laga (kuota bulanan) — jalur fallback batch tidak dibangun; kontrak MarketSnapshot menjaga `1xbet` sebagai label sumber terpisah kelas-satu dan selector bisa menyaring per sumber (kewajiban pelabelan brief terpenuhi) |
| Fase 3 — Item 7 (adapter hasil football-data.org v4) | SELESAI (kode) · live-fetch WAITING_OWNER_TOKEN | `727c37f` · `lib/feeds/fdorg-results.ts`, `scripts/import-fdorg-results.ts`, `tests/test-fdorg-results.ts`, `.env.example` (+`FOOTBALL_DATA_API_TOKEN`), rantai `test:data` | Suite fdorg **29/29** · test:data exit 0 · tsc 0 · lint PASS · script dorman tanpa token mencetak WAITING_OWNER_TOKEN, exit 0 (terverifikasi) | Basis skor 90 menit: `regularTime` bila ada; `fullTime` hanya bila duration REGULAR; laga ET tanpa regularTime dilewati (tidak ditebak). Guard ≤ 9 req/menit + HTTP 429 dihormati (Retry-After, 1× ulang, lalu berhenti). Pemetaan kanonik via registry; tak terpetakan → `fixture_identity_queue` (source `football-data-org`), ID tidak pernah dikarang. Baris namespace `fo_…`; precedence: jangkar primer finished berskor selalu menang (konflik → `fdorg_result_revisions`, jangkar utuh); pengisian/revisi lewat mesin D2 repo (`resolveFixtureIdentity` + `applyResultObservation` → `result_revisions`). `available_at` terisi saat ingest pertama, tidak ditimpa; `last_successful_ingest` tercatat (Item 6). Env dikunci ke nama brief `FOOTBALL_DATA_API_TOKEN`; importer fixture lama (`FOOTBALL_DATA_ORG_TOKEN`) tidak diubah |
| Fase 4 — Item 11 (evaluasi WAL PASSIVE) | DEFERRED_WAITING_25NOV_DATA | — (tanpa perubahan kode) | Pemeriksaan 25 Nov 2026 01:14 WIB: cron observasi `bola-stabilisasi-observasi` terjadwal Wed 25 Nov 2026 07:00 WIB — **belum berjalan**, tidak ada pengukuran yang bisa ditemukan (tidak ada entri observasi di `~/memory/2026-11-25.md`, tidak ada laporan observasi di `tasks/reports/`) | Sesuai brief: angka tidak direka. Evaluasi PASSIVE checkpoint menunggu laporan observasi 07:00 WIB terbit |
| Fase 5 — validasi penuh + laporan | SELESAI | Commit penyerta laporan ini · `tasks/reports/sprint-c-final-report.md` | Lihat bagian Validasi di bawah | Branch di-push; merge/deploy = keputusan pemilik |

## Validasi Fase 5 (berurutan, di worktree, tree final `727c37f` + laporan)

| Pemeriksaan | Hasil |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run lint:gate` | PASS — 91 error ≤ baseline 92, tidak ada error baru |
| `npm run test:quant` | exit 0 — quant 22/22 · model 62/62 · artifacts 32/32 · experiment-stats 23/23 · evaluator 22/22 · **L02 kandidat-q1 33/33** · promote-gate 21/21 · Q0 19/19 · Q2 11/11 |
| `npm run test:data` | exit 0 — data 18/18 · identity 58/58 · publication 110/110 · tickets 69/69 · resolver-score 23/23 · slip-stats 12/12 · ingest-freshness 12/12 · **Fix-4 35/35** · **T02 39/39** · **fdorg 29/29** |
| `npm run test:web` | exit 1 **hanya** dari 2 assertion pra-ada `test-beranda-pr1b`: `cadangan: jenis hasil-terakhir` dan `cadangan: hasil-terakhir menunjuk laga F` (identik di master murni; clock-dependent; paritas reader lolos). Semua suite web lain hijau (web 12/12, ui 75/75, rekam 110/110, jadwal-liga 27/27, stabilisasi 32/32, dll.) |
| L01 `tests/test-pr2-data-publikasi.ts` (dijalankan terpisah karena rantai test:web berhenti di pr1b) | **47/47, exit 0** |
| `npm run test:api` | 42/42, exit 0 |
| `npm run build` | exit 0 (BUILD_ID worktree `mqy3ccVRvZ9twboGeT17-` — **tidak di-deploy**) |

## Konfirmasi isolasi live (Fase 0 vs Fase 5, checkout UTAMA)

| File (checkout utama `~/workspace/coding/app-football`) | sha256 Fase 0 | sha256 Fase 5 | Sama? |
|---|---|---|---|
| `data/model-manifest.json` | `a6cf947a4f9f1ccfb80fcfccc739dca522bfc00dd042f2b6759530dca2b54315` | `a6cf947a4f9f1ccfb80fcfccc739dca522bfc00dd042f2b6759530dca2b54315` | ✅ identik |
| `data/calibrated_ratings.json` | `8630e4b2a3d97144ab905e149ec62e9ddf7ddc60f3412120b8fdddf95935bf8b` | `8630e4b2a3d97144ab905e149ec62e9ddf7ddc60f3412120b8fdddf95935bf8b` | ✅ identik |

HEAD checkout utama tetap `937ba92`; seluruh pekerjaan sprint terjadi di
worktree `app-football-sprintc`. Manifest champion tidak berubah
(modelVersion `2.0-dixon-coles-mle+kfit10+hl365+rho:zero+js2`). Tidak ada
backfill fabrikasi untuk MarketSnapshot / first_observed / available_at.
Item non-goal tidak disentuh: Q3 (Item 4), ML1 (Item 5), Item 8, 13, 27;
gerbang L01/L02, suite injeksi 22/22, dan promotion gate fail-closed utuh.

## Checklist aktivasi pemilik (pasca-merge)

1. Pasang dua env var di `.env.local` (lewat Secure Vault, jangan di chat):
   - `APIFOOTBALL_API_KEY` — API-Football (API-Sports v3), free plan.
   - `FOOTBALL_DATA_API_TOKEN` — football-data.org API v4.
2. Uji fetch live pertama (dari root repo, sesudah env terpasang):
   - `npx tsx scripts/capture-odds-apifootball.ts`
   - `npx tsx scripts/import-fdorg-results.ts`
3. Langkah aktivasi lanjutan (keputusan pemilik, di luar sprint ini):
   daftarkan jadwal capture odds 09:00 + 18:00 WIB; hook generator Fix-4
   (`npx tsx scripts/generate-fix4-ticket.ts`) ke alur harian; jalankan
   generasi tiket resmi pertama.
4. Item 11 (WAL): evaluasi PASSIVE checkpoint dikerjakan setelah laporan
   observasi stabilisasi 25 Nov 07:00 WIB terbit.
