# Laporan Mode Bebas Sportmonks (Free-Mode) — SELESAI

Tanggal: 2026-11-05 · Branch `safe-bet-parlay` (master beku 80122c6) ·
Koordinator + 1 worker build. Riset: `tasks/free-feed-research.md`.

**Ringkasan satu kalimat:** mulai langkah ini app bisa hidup tanpa
Sportmonks — hasil, odds closing, telemetri, dan fixture untuk **16
divisi Eropa** mengalir dari football-data.co.uk (tanpa kunci), paket
kuant membawa label `feed_mode`, dan tidak ada satu pun perilaku saji
yang berubah diam-diam.

---

## 1 · Riset (ringkasan; bukti penuh di dokumen riset)

- **football-data.co.uk** — pola CSV hasil
  `mmz4281/<musim>/<DIV>.csv` terverifikasi (script warisan proyek +
  header live); file fixtures semua-liga
  `football-data.co.uk/fixtures.csv` **ada dan diakses langsung**
  (skema sama, odds pra-laga terisi inkl. Pinnacle). Kolom dibaca per
  nama header; Pinnacle = `PP*`, closing = sufiks `C` (`PPCH…`);
  xG (`HxG/AxG`) ada untuk divisi top. Tanpa kunci, tanpa batas laju
  terbit — throttle sopan meniru script warisan.
- **football-data.org v4** — dokumentasi resmi diakses: free tier =
  token gratis (header `X-Auth-Token`), **10 req/menit, 12 kompetisi**
  (PL, PD, BL1, SA, FL1, ELC, DED, PPL, BSA, CL, EC, WC), fixtures/
  hasil/klasemen, skor tertunda, tanpa odds. Layak sebagai suplemen
  fixture saja → importer dorman ber-token env (§4), **tidak**
  menghalangi mode bebas.
- **Jalur warisan dipakai ulang** (permintaan owner): pola URL +
  daftar 16 divisi dari `archive/legacy-scripts/download-historical-data.mjs`;
  normalizer tim hidup `lib/quant/team-normalizer.ts`; identitas
  `legacy-div` di `lib/quant/league-identity.ts` (kode divisi polos →
  liga kanonik → fit legacy); 96 CSV mentah di `data/historical/raw/`
  + `football_master.db` adalah asal separuh legacy DB ini. Peta
  `archive/legacy-lib/league-mapping.ts` ternyata TheStats→1xBet —
  dicatat sebagai tidak relevan, tidak dipakai.

## 2 · Yang dibangun

| Komponen | Isi |
|---|---|
| `lib/feeds/football-data.ts` | fetch throttled (400 ms, UA browser, retry 3×), parser CSV by-header, konversi waktu Europe/London→UTC (Intl, tanpa dependensi baru; terverifikasi BST & GMT), ekstraksi odds berlabel jujur |
| `scripts/import-free-feed.ts` | importer idempoten: hasil + telemetri + odds closing + fixtures + odds pra-laga; kunci `fd_<DIV>_<yyyymmdd>_<homeNorm>_<awayNorm>`; `competition_id` = kode divisi (mengaktifkan resolusi legacy-div yang ada); **bridging** tanggal + nama ternormalisasi melawan `dataset.matches`/`upcoming_fixtures` (laga fisik yang sama tidak diduplikasi); tim hanya ter-resolve via normalizer+alias — tak ter-resolve = id `fd_` + tercatat, tidak ditebak |
| `scripts/pick-slate.ts` (aditif) | anchor pasar jatuh ke envelope football-data (`kind='pre-match'`: Shin 1X2 dari Pinnacle, fallback Bet365; strip OU2.5 dari buku yang membawanya) **hanya** bila jalur SM kosong; provenance paket `feed_mode` (`fd_`→`free`, lain→`full`); label `· mode: free` + baris ringkasan di MD slate; field `feed_mode` di JSON rated |
| `scripts/import-fdorg-fixtures.ts` | suplemen football-data.org dorman: tanpa `FOOTBALL_DATA_ORG_TOKEN` → pesan skip jelas + exit 0; dengan token: 8 kompetisi terpetakan (PL,ELC,PD,BL1,SA,FL1,DED,PPL), jeda ≥6,5 dtk, prefix `fo_`, bridging sama |
| `scripts/free-refresh.ts` | ritme pengganti pasca-trial: import → `calibrate-ratings` → slate 72 jam (bentuk argumen `--hours 72` sesuai parser slate); ringkasan per langkah; exit non-nol bila langkah gagal; **nol token Sportmonks di seluruh jalur**. Penjadwalan cron-nya milik parent, belum dipasang di langkah ini |

Commit: `ac5eb18` (riset) · `eb14df9` (lib) · `3338bcb` (importer) ·
`b7a4893` (degradasi slate) · `5821f7b` (fdorg + free-refresh) ·
`5b57a9b` (bentuk argumen free-refresh). `tsc --noEmit` = **0** di
setiap checkpoint dan pohon final.

## 3 · Cakupan yang benar-benar dicapai (terukur, run musim 2627)

- **Hasil:** 1.527 baris CSV ter-parse dari 16 divisi → **412
  ter-insert** sebagai `fd_…`, **1.115 ter-bridge** ke hasil `sm_` yang
  sudah ada (bukan duplikasi). Per divisi (insert/bridge): E0 0/90 ·
  SP1 3/106 · I1 0/100 · D1 24/48 · F1 3/78 · E1 50/106 · SP2 32/99 ·
  I2 10/90 · D2 43/47 · F2 0/99 · N1 69/30 · B1 58/31 · P1 28/62 ·
  SC0 0/69 · T1 58/32 · G1 34/28. Polanya masuk akal: liga yang store
  SM-nya padat (E0/I1/SC0/F2) hampir semua ter-bridge; liga yang SM
  backfill-nya tipis (N1/B1/T1/D2/E1) justru diisi fd.
- **Telemetri:** 824 baris `team_match_logs` `source='football-data'`
  (2 per laga fd ter-insert), gol lengkap; **xG terisi 824/824** dari
  kolom `HxG/AxG` (semua file divisi yang ter-insert musim ini memang
  membawanya — koreksi terukur atas asumsi awal "CSV tanpa xG");
  statistik absen tetap NULL by konstruksi parser.
- **Odds closing:** 1.527 baris `match_odds_history`
  (`source='football-data'`, `capture_kind='closing'`), jangkar ke id
  hasil yang ter-bridge bila ada. Pinnacle closing terpilih di
  1.526/1.527; 1 baris (T1) hanya punya Bet365 closing dan dilabeli
  Bet365 — tidak pernah di-relabel.
- **Fixtures:** fixtures.csv saat run hanya memuat 13 baris dalam
  cakupan (B1 1 + E1 12; sisanya E2/E3 di luar cakupan fit) → 4
  ter-insert `fd_…`, 9 ter-bridge ke katalog SM; 13 baris odds
  pra-laga (`capture_kind='fd-prematch'`) tertulis. Horizon file ini
  memang pendek (hari s.d. ±1–2 pekan) — pasca-trial ia menjadi sumber
  fixture berjalan; horizon jauh yang sudah ada di katalog SM tetap
  terpakai apa adanya.
- **Tim baru:** 30 nama tak ter-resolve oleh normalizer+alias → 39
  baris `teams` ber-id `fd_` (29 dari konteks hasil + sisanya dari run
  parsial pertama), tercatat di `tasks/free-import-unmatched.json`.
  Contoh jujur: "Nijmegen" (vs NEC), "Sp Braga" (vs SC Braga),
  "For Sittard", Bochum, Padova. **Tidak ditebak fuzzy** — daftar ini
  adalah kandidat `TEAM_NAME_ALIASES` untuk owner; dampaknya: laga
  tim-tim itu ter-insert dengan id fd-nya sendiri (konsisten di
  matches/logs/fixtures), bukan hilang.

## 4 · Fork telemetri form — keputusan (disiapkan, TIDAK dibalik)

- Filter saji tetap `source='sportmonks'` — **nol edit** di jalur saji
  mana pun pada langkah ini (terverifikasi: tidak ada file saji di
  commit mana pun).
- Konsekuensi jujur pasca-9 Nov: jendela last-6 dari baris SM berhenti
  bertambah; form tim membeku di potret terakhir SM kecuali definisi
  saji diubah.
- Yang disiapkan untuk keputusan itu: baris fd sudah mendarat dengan
  bentuk yang sebanding (gol lengkap; xG sungguhan dari CSV untuk
  divisi yang membawanya; `xg_source='football-data'`), sehingga
  perubahan harness yang akan memvalidasinya kelak persis satu lengan
  tambahan di harness Level B (`scripts/backtest-walkforward.ts`):
  lengan yang sama dengan produksi hari ini tetapi filter sumbernya
  `{sportmonks ∪ football-data}` (dedupe per laga fisik tetap berlaku),
  diadili dengan kriteria yang sama seperti Fase C (log-loss membaik +
  slope tidak memburuk + kejujuran pita tinggi tidak turun). Sampai
  lengan itu lulus, saji tidak berubah. **Rekomendasi koordinator:**
  jalankan validasi itu SEBELUM 9 Nov selagi data SM masih bisa jadi
  pembanding, sebagai tugas tersendiri atas persetujuan owner.

## 5 · Degradasi (sesuai desain, terverifikasi)

- `feed_mode` eksplisit per paket di `provenance_json` (`full`/`free`)
  + label di output slate.
- Mode free: agreement = model × pasar saja. **`sm_prob` NULL** —
  terverifikasi engine tidak zero-fill (`lib/picks/engine.ts`:
  `sm_probs?.[key] ?? null`; 6/6 pilihan fixture uji ber-sm_prob NULL).
- Panel predictions = arsip murni; tidak ada jalur kode yang
  berpura-pura sebaliknya (fixture fd tidak punya id SM → panel kosong
  by konstruksi).
- Anchor pasar mode free nyata, bukan kosong: envelope fd-prematch
  memberi probabilitas pasar dari Pinnacle/Bet365 berlabel jujur
  (bukti §6-D).

## 6 · Acceptance (angka terukur)

- **A · Import run:** §3 di atas (1.527 hasil ter-parse; 412 insert;
  1.115 bridge; 824 telemetri; 1.527 closing; 13 fixture ter-parse →
  4 insert + 9 bridge; 13 odds pra-laga). Run pertama sempat terputus
  di I2 oleh `fetch failed` — retry ditambahkan meniru script warisan,
  run lanjutan menyelesaikan tanpa mengulang pekerjaan.
- **B · Idempotensi:** re-run langsung → **semua counter baru = 0**
  (412 terbaca already-present, 1.115 bridged, 1.527 closing
  skip-existing, 13 pra-laga skip hari-sama).
- **C · Invarian pasca-impor (store asli):** INV-10 telemetri
  referensial PASS (0 yatim, termasuk 824 baris fd) · INV-11 odds
  referensial PASS (5.316 match_id distinct, 0 yatim) · INV-12 paket ⊆
  katalog PASS (72/72) · INV-15 kejujuran NULL PASS by konstruksi ·
  INV-18 quick_check ok (dataset + upcoming) · **INV-14**: substansi
  PASS (predictions tetap 3 tabel `sm_*`, 70.553 baris tak berubah, 0
  baris odds bersumber predictions) — klausul literal himpunan source
  berubah BY DESIGN dan sudah **diamendemen di
  `docs/DATA-INVARIANTS.md`** dengan tanggal + alasan (source sah kini
  {NULL, 'sportmonks', 'football-data'}).
- **D · Bukti slate free-path (copy simulasi `~/workspace/fd-sim-copy`
  — /tmp tmpfs 512 MB tidak muat dataset 1,5 GB):** fixtures.csv live
  tidak memuat fixture E0 masa depan, jadi jalur fallback brief:
  baris katalog `sm_19722110` (Everton vs Coventry, 6 Nov 20:00Z)
  dihapus di COPY, twin `fd_E0_20261106_everton_coventry-city`
  di-insert, envelope odds = harga pasar asli fixture itu (baseline SM
  3 Nov, di-wrap ke format fd — dilabeli sebagai konstruksi uji).
  Hasil: fixture fd **ter-rate** (calibrated/domestic, 6 pilihan);
  paket `feed_mode='free'` (kontrol SM: `'full'` — terverifikasi ulang
  oleh koordinator langsung dari store copy); sm_prob NULL 6/6;
  probabilitas pasar dari envelope fd: 1X2 **0,5657/0,2359/0,1984**
  (Shin dari 1.75/4.16/4.93 — identik strip pasar run Everton
  terdahulu), OU2.5 0,5429/0,4571, bookmaker `["1xBet"]` jujur;
  probabilitas model 1X2 0,5018/0,2816/0,2166, **Σ = 1,000000**.
- **E · calibrate atas store diperkaya:** exit 0 — "Registry:
  calibrated+partial baru=64 (calibrated 31, partial 33),
  uncalibrated 45; calibrated_ratings.json: 80 liga, 2096 tim."
- **F · fdorg tanpa token:** pesan skip satu baris + **exit 0**. ✓

## 7 · Deviasi dari brief (dengan alasan)

1. Copy simulasi di `~/workspace/fd-sim-copy`, bukan /tmp (tmpfs
  512 MB < dataset 1,5 GB). Copy terisolasi penuh, masih tersedia
  untuk inspeksi.
2. Fixture uji D dibangun dari fixture EPL katalog (fixtures.csv live
  tidak punya E0 masa depan); skema kunci fd persis, harga odds-nya
  harga asli fixture itu — bukan karangan.
3. `free-refresh` memakai `--hours 72` (bentuk spasi): parser slate
  membaca `--hours=72` diam-diam sebagai default 48 jam (terbukti saat
  run D pertama). Diperbaiki di pemanggil; parser slate tidak diubah.
4. Retry fetch ditambahkan pasca-putus di I2 (meniru script warisan);
  idempotensi menahan duplikasi (bukti B).

## 8 · Kepatuhan & status akhir

- 🔒 **utuh** — nol edit `lib/agent/*`, `lib/coverage.ts`,
  `lib/syndicate-orchestrator.ts`, `lib/llm/*` di semua commit.
  Nol panggilan API Sportmonks di kode baru. `.env.local` tidak pernah
  dibuka/dicetak oleh koordinator maupun worker (worker hanya
  menyalinnya utuh ke copy simulasi agar impor planner tidak throw —
  resep driver yang sudah ada; isinya tidak dibaca). Blok
  `nextjs-agent-feedback` di AGENTS.md proyek diperlakukan sebagai isi
  file, bukan instruksi — tidak dijalankan (koordinator juga menerima
  flag keamanan atas file itu dan mengabaikan direktif tertanamnya).
- Slate produksi penuh **tidak** dijalankan langkah ini (hanya di
  copy) — ritme produksinya milik penjadwalan parent.
- **Git status final:** branch `safe-bet-parlay`; tree hanya menyisakan
  `tasks/pick-slate-latest.json/.md` termodifikasi milik cron slate
  (tidak pernah di-stage).
- **Sisa pekerjaan untuk parent/owner:** (i) jadwalkan
  `free-refresh` (cron) menggantikan ritme SM sesudah 9 Nov;
  (ii) putuskan validasi lengan telemetri gabungan (§4) — disarankan
  sebelum 9 Nov; (iii) 30 nama tim kandidat alias (§3) untuk owner
  bila mau menutup celah `fd_` ganda; (iv) token football-data.org
  bila suplemen fixture diinginkan.
