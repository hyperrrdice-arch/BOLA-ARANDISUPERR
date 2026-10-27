# Implementation Plan: Offline Survival + 1xBet 500/mo (TheStatsAPI mati)

## Overview

TheStatsAPI mati permanen (`403 KEY_REVOKED`, 18 Okt 2026). App hidup dari stok lokal: `upcoming_fixtures.db` 378 fixture s/d **2026-11-29** + `competition_catalog` 208, `match_odds_history` 378 baris (112 terisi), telemetri 1.174 match / 2.348 log, vault 1.991 payload. Satu-satunya API berbayar tersisa: 1xBet via RapidAPI, **500 req/bulan (~16/hari)**. Plan ini bikin app (1) 100% offline-first di jalur render, (2) 1xBet hemat kuota + degradasi jujur, (3) tetap jujur setelah katalog kedaluwarsa 29 Nov. Plan dashboard lama (Tasks 6-13) digantikan atas persetujuan user 19 Okt 2026 — file lama sudah di-archive di git history.

## Architecture Decisions

- **Jalur render dilarang sentuh TheStatsAPI.** `/api/matches`, `/api/odds`, `/api/agent` serve dari SQLite/vault. 403 = serve local, bukan retry. Alasan: API mati, retry = sia-sia + latency.
- **Odds anchor lokal adalah sumber odds.** `/api/odds` baca `match_odds_history` dulu (kolom `has_odds`, `captured_utc`), upstream hanya fallback yang saat ini selalu gagal. Kartu kosong padahal data ada = bug P1.
- **1xBet on-demand, tanpa cache persisten.** API kemungkinan diganti — jangan investasi SQLite/disk cache + counter. Cukup: lazy env (tanpa key → degradasi jujur, bukan crash) + markets hanya via klik user (larang preload/polling). `lib/1xbet.ts` in-memory apa adanya, tidak diutak-atik.
- **Angka jujur tetap berlaku offline.** P0 integrity (`topEv` minus-EV, `vig 1.055` karangan) tidak hilang karena API mati — pipeline offline tetap bisa sajikan pick minus-EV / margin fiksi. Fix bareng di plan ini.
- **Kedaluwarsa katalog eksplisit.** Setelah 2026-11-29 katalog menipis → kosong. Bukan crash, bukan data karangan: banner tanggal-batas + empty state + jalur alternatif (spike, bukan implementasi).

## Task List

### Phase 1: Freeze offline (0 req keluar)
- [ ] Task 1: Inventaris + tanggal kedaluwarsa
- [ ] Task 2: Wire /api/odds ke match_odds_history

### Checkpoint: Offline dasar
- [ ] Katalog + odds tersaji tanpa 1 pun call TheStatsAPI (matikan key / mock 403, assert 200)

### Phase 2: 1xBet hemat (≤16/hari)
- [ ] Task 3: 1xBet degradasi ringan (lazy env + on-demand only, tanpa cache persisten)
- [ ] Task 4: Matches anti-API + empty-after-expiry UX

### Checkpoint: Kuota aman
- [ ] Restart server = 0 re-spend 1xBet · klik markets 2× = 1 spend · tanpa key = degradasi jujur, bukan crash

### Phase 3: Integritas + lifecycle
- [ ] Task 5: P0 integrity offline (topEv null + vig model_only)
- [ ] Task 6: Lifecycle promote + spike API alternatif (read-only)
- [ ] Task 7: Offline intel minimal (/api/agent hidup tanpa API)

### Checkpoint: Final
- [ ] tsc + build hijau · semua runnable check hijau · banner 29 Nov tampil · spend 1xBet tercatat
- [ ] Live /api/agent 200 untuk fixture ber-odds (bukti angka→analisis end-to-end)

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Katalog kosong setelah 2026-11-29 | Tinggi | Task 4: banner + empty state jujur; Task 6: spike alternatif, bukan janji |
| 500/mo jebol oleh scan otomatis | Tinggi | Task 3: persistent cache + manual-trigger only + counter; larang preload/polling |
| `requireEnv` 1xBet crash saat key absen | Med | Task 3: lazy load + degradasi jujur |
| Odds anchor dikira closing | Med | Selalu tampilkan `captured_utc` + label "anchor, bukan closing" |
| Fix integrity ubah tampilan rekomendasi | Rendah | `recommended_*` NULL saat nol +EV = by design; user sudah setuju |

## Spike API alternatif (Task 6, 19 Okt 2026 — read-only, terverifikasi docs resmi)

| Aspek | The Odds API ⭐ pilihan 1 | API-Football (pelengkap) | football-data.co.uk CSV (sudah di DB!) |
|---|---|---|---|
| Fixture/katalog | `/events` per liga = GRATIS 0 kuota (id, home/away, commence_time) | `/fixtures` free 100 req/hari | Terverifikasi isi `football_master.db` 19 Okt: **28.922 match**, 16 div, musim 21/22–26/27 |
| Odds 1X2 | `/odds` h2h region `eu` = 1 kredit (cover **1xBet + Pinnacle**, terverifikasi halaman bookmaker resmi) | Odds = API terpisah BERBAYAR | Musim 26/27: **Bet365 1.078/1.078 penuh**, Pinnacle 0 (kolom ada, kosong musim ini) |
| Skor/outcome | `/scores?daysFrom=3` = 2 kredit → ganti `promote` + `sync:outcomes` | `/fixtures?status=FT` (free) | 1.078/1.078 finished + skor + xG, max date **2026-10-14** (5 hari basi, CSV free bisa di-refresh ulang kapan saja) |
| Lineup/cedera | TIDAK ADA | ADA (lineups, injuries — free) | TIDAK ADA (tapi ada shots, wasit, HT, max O/U 2.5) |
| Kuota gratis | ±500 kredit/bln (**verifikasi saat daftar**, header `x-requests-remaining` konfirmasi runtime) | 100 req/hari (**verifikasi**, halaman pricing block bot 19 Okt) | 10 req/mnt, tanpa odds |
| Estimasi spend | Katalog 7 liga 0 + odds h2h 7/hari (~210/bln) + scores tiap 3 hari (~140/bln) ≈ 350/bln < 500 ✓ | Lineup/cedera laga H-1 saja, <20/hari ✓ | — |
| Adapter (nanti) | Mapper: events→upcoming_fixtures, odds h2h→match_odds_history, scores→match_outcomes | Mapper: fixtures/lines/injuries → Tier-1 | Mapper fixtures saja |

Rekomendasi: daftar The Odds API (gratis) → Task adapter M (1 mapper + sync script, pola vault+budget `lib/stats-fetch.ts` yang sudah ada). API-Football free daftar juga sebagai sumber lineup/cedera (100/hari cukup untuk laga H-1). football-data.org hanya bila butuh fixture Eropa top cepat tanpa odds.

Lifecycle (perintah + jadwal): `npm run sync:upcoming` (isi) → `npx tsx scripts/promote-upcoming-to-telemetry.ts --dry-run` (cek) → tanpa flag (eksekusi) → `npm run sync:outcomes` (hasil). Dry-run 19 Okt: 24 fixture lewat jadwal, 0 terpromote — telemetry finished tidak ada di lokal dan API mati, jadi lifecycle TERBLOKIR API sampai kandidat di atas aktif. Jadwal usulan: promote tiap pagi (laga semalam), outcomes tiap 6 jam matchday.

## Open Questions

- Budget 1xBet 500/mo dibagi berapa untuk markets vs pencarian liga? (usulan: 80% markets on-demand, 20% league/match resolve)
- Setelah 29 Nov: terima katalog kosong sementara, atau langsung eksekusi salah satu kandidat API alternatif dari Task 6?
- `analysis_snapshots.db` tetap append-only selama fase ini? (usulan: ya)

## Catatan

- Tasks di `tasks/todo.md` (overwrite atas persetujuan user; plan dashboard lama ada di git history).
- Dilarang mengarang data: skor absen → skip, odds absen → `is_available:false`, bukan 0/0.00.
- Jangan jalankan `next build` bareng `next dev` (bug Next.js, ARCH §10).
