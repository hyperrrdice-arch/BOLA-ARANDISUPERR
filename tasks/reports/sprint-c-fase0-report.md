# Sprint C — Fase 0: Verifikasi Basis & Peta Kode

Basis: master `937ba92` (PR 1A–4 + Sprint A+B merged & live) · Branch:
**`sprint/c-data-fix4`** · Worktree: `~/workspace/coding/app-football-sprintc`
(.env.local disalin buta dari checkout utama, tidak pernah dibuka/dicetak).

## Verifikasi basis

- Checkout utama HEAD = `937ba92` ✓ (dirty hanya output refresh terjadwal —
  tidak disentuh).
- Worktree bersih di `937ba92`; node_modules salinan nyata dari checkout
  utama (pola Sprint A+B; symlink terbukti gagal di suite sandbox).
- **Hash live (checkout utama, jangkar isolasi Fase 0):**
  - `data/model-manifest.json` = `a6cf947a4f9f1ccfb80fcfccc739dca522bfc00dd042f2b6759530dca2b54315`
  - `data/calibrated_ratings.json` = `8630e4b2a3d97144ab905e149ec62e9ddf7ddc60f3412120b8fdddf95935bf8b`
- **Token (hanya nama yang dicek, nilai tidak pernah dibaca):**
  `APIFOOTBALL_API_KEY` = 0 kemunculan, `FOOTBALL_DATA_API_TOKEN` = 0
  kemunculan di `.env.local` → jalur brief §0.3 berlaku: semua kode/skema/
  adapter/rate-limiter/test dibangun dengan payload mock realistis;
  verifikasi fetch live ditandai `WAITING_OWNER_TOKEN`.

## Baseline suite (berurutan, di worktree)

| Suite | Exit | Catatan |
|---|---|---|
| `tsc --noEmit` | 0 | bersih |
| `lint:gate` | 0 | LOLOS — 91 error ≤ baseline 92 |
| `test:quant` | 0 | semua hijau (termasuk injeksi 22/22, L02 33/33, Q0 19/19, Q2 11/11) |
| `test:data` | 0 | semua hijau (termasuk L01-related slip-stats 12/12, ingest-freshness 12/12) |
| `test:api` | 0 | 42/42 |

2 assertion pra-ada `test-beranda-pr1b` berada di rantai `test:web`
(bukan bagian baseline Fase 0 brief) — diverifikasi di Fase 5.

## Tabel Peta Kode Fase 0

| Kebutuhan | Path exact |
|---|---|
| Kebijakan Fix-4 (BARU) | `lib/picks/fix4-policy.ts` |
| Generator + metrik tiket Fix-4 (BARU) | `lib/picks/fix4-tickets.ts` |
| Entry script generator (BARU) | `scripts/generate-fix4-ticket.ts` |
| Test Fix-4 (BARU) | `tests/test-fix4.ts` |
| Sumber pick resmi | `lib/picks/ledger.ts` (tabel `picks`/`pick_outcomes`/`pick_voids`), `lib/picks/publication.ts` (`published_prob` beku; `ensurePublicationSchema` :102; `publishPicks` :996) |
| Klasifikasi feed terverifikasi | `lib/picks/feed-coverage.ts` (`statusFeedKompetisi` :100 — "berfeed" = terpetakan ke 22 divisi aktif football-data.co.uk) |
| Konsistensi statistik tiket | `lib/picks/tickets.ts` (`ensureTicketSchema` :59, `publishSlip` :508, `slipRecordStats` :849) |
| Adapter odds API-Football (BARU) | `lib/feeds/api-football.ts` |
| Kontrak MarketSnapshot (BARU) | `lib/market/market-snapshot.ts` |
| Script capture odds API-Football (BARU) | `scripts/capture-odds-apifootball.ts` (brief: "scripts/capture-odds.ts atau job terkait" — file lama itu khusus Sportmonks, tidak ditimpa) |
| Capture odds lama (tidak diubah) | `scripts/capture-odds.ts` (Sportmonks → `match_odds_history`), `lib/1xbet.ts` (fallback sekunder berlabel) |
| Devig (PAKAI ULANG, tidak diduplikasi) | `lib/quant/vig-stripping.ts` (`stripVigShin` :78 untuk 1X2, `stripVigTwoWay` :167 untuk O/U, `stripVigProportional` :27) |
| Integrasi `decision_ts` producer | `scripts/pick-slate.ts` |
| Test T02 (BARU) | `tests/test-market-snapshot.ts` |
| Importer fdorg dorman yang ada | `scripts/import-fdorg-fixtures.ts` (env `FOOTBALL_DATA_ORG_TOKEN`, hanya SCHEDULED, jeda 6,5 dtk) |
| Adapter hasil fdorg (BARU) | `lib/feeds/fdorg-results.ts` + `scripts/import-fdorg-results.ts` — env mengikuti brief: **`FOOTBALL_DATA_API_TOKEN`** (nama lama `FOOTBALL_DATA_ORG_TOKEN` milik importer fixture tidak diganti; dicatat sebagai perbedaan yang disengaja sesuai brief §Fase 3 + checklist pemilik) |
| Instrumentasi Item 6 | `lib/feeds/ingest-freshness.ts` (`ensureIngestSchema`, `recordIngestAttempt`, `recordSuccessfulIngest`, `resultLagStats`) |
| Antrean identitas | `lib/identity/fixture-resolver.ts` (item tak terpetakan masuk antrean, tidak dibuat ID liar) |
| Registri kanonik | `data/team-canonical.json`, `data/league-canonical.json`; pemetaan liga fdorg: `lib/quant/league-identity.ts` (`getCanonicalBySourceId`), normalisasi nama: `lib/quant/team-normalizer.ts` |
| Env template | `.env.example` (tambah `APIFOOTBALL_API_KEY=` di Fase 2, `FOOTBALL_DATA_API_TOKEN=` di Fase 3) |
| Rantai test | `package.json` — suite baru dirantai ke `test:data` (pola Sprint A+B: slip-stats + ingest-freshness) |

## Catatan desain yang dikunci sebelum menulis kode

1. **Jendela harian Fix-4:** keputusan tanggal D diambil pada cutoff
   D 14:00 WIB; laga layak = kickoff di (D 14:00 WIB, D+1 14:00 WIB] —
   partisi 24 jam dari cutoff sehingga setiap laga masuk tepat satu
   keputusan harian (laga 00:00–14:00 tidak yatim). Parameter terkunci
   pemilik (4 pilihan, ≥0,72, abstain, 1/hari, 1/laga, ranking
   deterministik) tidak berubah.
2. **`fixture_id` di picks.db = `match_id`** (sm_/mt_/fd_); dedupe 1 leg
   per `match_id` (pick resmi sudah lolos guard anti-kembar Lanjut-4/5
   saat terbit).
3. **Devig tidak ditulis ulang:** MarketSnapshot memakai
   `stripVigShin`/`stripVigTwoWay` yang sudah teruji di `lib/quant`.
4. **Wilson 95% CI** belum ada helper di repo → diimplementasikan di
   modul metrik Fix-4 dengan rumus standar (z = 1,96).
