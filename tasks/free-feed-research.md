# Riset Feed Gratis — Mode Tanpa Sportmonks

Tanggal akses: **2026-11-05** (semua URL diakses sesi ini). Konteks:
Arandi membatalkan langganan Sportmonks **9 Nov 2026** (trial resmi
berakhir 10 Nov). Mesin kuant sudah 100% offline — yang diganti hanya
pipa datanya. Dokumen ini adalah bukti risetnya; implementasinya di
`tasks/free-mode-report.md`.

---

## A · football-data.co.uk — workhorse (tanpa kunci)

### A1. CSV hasil per liga per musim — TERBUKTI
- Pola URL: `https://www.football-data.co.uk/mmz4281/<kodeMusim>/<DIV>.csv`
  — kode musim `2627` = 2026/27, `2526` = 2025/26, dst. Pola ini
  terkonfirmasi ganda: (1) script unduh historis milik proyek sendiri
  (`archive/legacy-scripts/download-historical-data.mjs`, lihat §C),
  (2) header file E0 musim 2627 yang sudah ada di disk
  (`data/historical/raw/E0_2627.csv`, 60 laga berjalan saat diunduh).
- Kolom (header E0 2627 terverifikasi, 120+ kolom):
  `Div, Date, Time, HomeTeam, AwayTeam, FTHG, FTAG, FTR, HTHG, HTAG,
  HTR, Referee, HxG, AxG, HS, AS, HST, AST, HF, AF, HC, AC, HY, AY,
  HR, AR`, lalu blok odds.
  - `Date` di file musim berjalan berformat **dd/mm/yyyy**; dokumentasi
    situs (`notes.txt`, §A4) menulis dd/mm/yy — parser wajib menerima
    keduanya.
  - **xG (`HxG`/`AxG`) ADA** untuk divisi top (terverifikasi di E0);
    cakupan per divisi/musim bervariasi — audit eksternal atas header
    live (pedrovidigal.com, diakses via pencarian sesi ini) mencatat
    file 2026/27 membawa ±113 kolom dan tidak semua divisi membawa
    semua blok statistik. Parser membaca kolom **berdasarkan nama
    header**, absen = NULL, tidak dikarang.
  - Statistik laga lain: tembakan (HS/AS), on-target (HST/AST), foul,
    corner, kartu — bervariasi per divisi.
- Blok odds di file hasil = harga **penutup (closing)** untuk blok
  ber-sufiks `C`, dan harga pra-laga (saat file masih berjalan) untuk
  blok polos:
  - 1X2: `B365H/D/A` (Bet365), `BFDH…` (Betfred), `BVH…` (BetVictor),
    `BWH…` (Bet&Win/bwin), **`PPH/PPD/PPA` = Pinnacle**, `SKBH…`
    (SkyBet), `MaxH/D/A`, `AvgH/D/A`, `BFEH…` (Betfair Exchange).
  - Closing 1X2: pola sama + `C` → **`PPCH/PPCD/PPCA` = Pinnacle
    closing**, `B365CH…`, dst.
  - OU 2.5: `B365>2.5`, `B365<2.5`, `Max>2.5`, `Avg>2.5`, `BFE>2.5` (+
    versi closing `…C>2.5`).
  - Asian handicap: `AHh`, `B365AHH/AHA`, dst.
  - **Aturan label jujur proyek:** Pinnacle dipakai bila kolom PP ada;
    selain itu buku yang benar-benar tertulis di kolomnya (Bet365).
    Tidak pernah me-relabel buku lain sebagai Pinnacle.

### A2. File fixtures semua liga — TERBUKTI ADA
- `https://www.football-data.co.uk/fixtures.csv` — diakses langsung
  sesi ini (crawl 2026-11-04 18:59 UTC): SATU file CSV berisi fixture
  mendatang **semua divisi** (terlihat B1, E1, E2, E3, …), skema kolom
  identik dengan file hasil (blok odds pra-laga terisi — termasuk
  Pinnacle `PPH/PPD/PPA`; blok closing kosong).
- Isi saat akses: fixture 03–04 Nov 2026 dan hari-hari sesudahnya —
  jendela bergulir jangka pendek (hari s.d. ±1–2 pekan), diperbarui
  berkala oleh situs (praktik lamanya: file hasil diperbarui sesudah
  tiap hari pertandingan; file fixtures menyegarkan jadwal + odds
  pra-laga). Konsekuensi desain: fixtures.csv adalah sumber fixture
  **dekat**; horizon jauh tetap dari katalog yang sudah ada.

### A3. Cakupan divisi
- File hasil tersedia untuk ±21 divisi Eropa. Yang relevan bagi proyek
  = **16 divisi warisan** (§C): E0, E1, SP1, SP2, I1, I2, D1, D2, F1,
  F2, N1, B1, P1, SC0, T1, G1 — persis 16 liga berstatus
  `legacy-csv-fit` di registry. Divisi lain di fixtures.csv (E2, E3,
  …) **tidak** punya rumah fit/registry di proyek → di luar cakupan
  importer v1 (dicatat, tidak diimpor diam-diam).

### A4. Dokumentasi & ketentuan
- Dokumentasi kolom resmi situs = `notes.txt` ("Key to results data",
  "Key to 1X2 betting odds data"; salinan terverifikasi di Zenodo
  record 12600173, diakses via pencarian sesi ini) + halaman
  `matches.php` untuk daftar bookmaker berjalan.
- Ketentuan pakai: **tanpa API key, tanpa batas laju yang diterbitkan,
  unduh gratis.** Tidak ditemukan halaman ToS formal di halaman yang
  diakses — perlakuan proyek: unduh sopan (throttle antar-file seperti
  script warisan: jeda ±400 ms + User-Agent browser), atribusi sumber
  di provenance tiap baris (`source='football-data'`).

## B · football-data.org v4 — suplemen fixture (perlu token gratis)

Sumber primer diakses sesi ini: dokumentasi resmi
`https://docs.football-data.org/general/v4/policies.html`.

- **Autentikasi wajib:** token gratis via registrasi
  (football-data.org/client/register), dikirim sebagai header
  `X-Auth-Token`. Tanpa token: hanya daftar area/kompetisi, 100
  req/24 jam.
- **Batas free tier (resmi): 10 request/menit.** (Standard 30/menit.)
- **Kompetisi free (12):** Premier League (PL), La Liga (PD),
  Bundesliga (BL1), Serie A (SA), Ligue 1 (FL1), Championship (ELC),
  Eredivisie (DED), Primeira Liga (PPL), Série A Brasil (BSA),
  Champions League (CL), Euro (EC), Piala Dunia (WC) — konsisten di
  dokumentasi + halaman pricing resmi dan beberapa pembanding semasa
  yang dicek sesi ini.
- **Isi:** fixtures, hasil, klasemen, pencetak gol per kompetisi
  (`GET /v4/competitions/{code}/matches`, `/v4/matches`, …). Skor di
  free tier **tertunda** (bukan real-time); **tidak ada odds**; riwayat
  free terbatas (orientasi musim berjalan).
- **Vonis:** layak sebagai suplemen fixture SAJA (8 dari 12 kompetisi
  free-nya memetakan ke divisi proyek: PL→E0, ELC→E1, PD→SP1, BL1→D1,
  SA→I1, FL1→F1, DED→N1, PPL→P1). **Tidak menghalangi mode bebas:**
  fixtures.csv (§A2) menutup kebutuhan yang sama tanpa kunci. Importer
  dibangun di belakang env `FOOTBALL_DATA_ORG_TOKEN` (absen = skip
  dengan pesan jelas); Arandi mendaftar nanti bila mau.

## C · Jalur warisan football-data di repo ini (temuan owner — dipakai ulang)

Separuh legacy database ini BERASAL dari football-data.co.uk:

1. `archive/legacy-scripts/download-historical-data.mjs` — pengunduh
   aslinya: pola URL §A1, daftar **16 divisi** (E0, SP1, I1, D1, F1,
   E1, SP2, I2, D2, F2, N1, B1, P1, SC0, T1, G1), 6 musim (2122–2627),
   throttle 400 ms + UA browser. → daftar divisi + pola URL importer
   baru **menyalin dari sini**, bukan karangan baru.
2. `data/historical/raw/` — 96 CSV mentah (16 divisi × 6 musim) hasil
   unduhan itu, termasuk musim berjalan 2627.
3. `football_master.db` (28.922 baris, `docs/DATABASE.md` §1) = CSV-CSV
   itu ter-ingest: `div` + nama tim apa adanya dari CSV, odds legacy
   (PSH/PSD/PSA = Pinnacle, B365, Max OU) — skema payload odds warisan.
4. Registry kalibrasi: **16 liga `source='legacy-csv-fit'`** (audit
   F-13) = persis 16 divisi di atas; fit mereka hidup di
   `calibrated_ratings.json` dan **dipertahankan** (tidak di-refit)
   oleh `scripts/calibrate-ratings.ts`.
5. Identitas kanonik sudah meng-encode jalur ini: di
   `lib/quant/league-identity.ts`, kode divisi polos (`E0`) ter-parse
   sebagai sistem `legacy-div` → jembatan `ratings-key:master_E0` →
   liga kanonik; fixture dari sumber legacy/theStats dilayani **fit
   legacy-div** (`FitSystem = "sportmonks" | "legacy-div"`). Jadi
   fixture football-data cukup membawa `competition_id = <kode divisi>`
   untuk dilayani fit yang benar oleh mesin yang ada.
6. Nama tim: `lib/quant/team-normalizer.ts` (`TEAM_NAME_ALIASES`,
   `normalizeTeamName`, `sanitizeString`) adalah normalizer hidup yang
   dipakai calibrate/loader — importer baru memakainya, tidak menulis
   normalizer kedua. (`archive/legacy-lib/league-mapping.ts` ternyata
   peta TheStats→1xBet — tidak relevan untuk feed ini, dicatat agar
   tidak disalahpakai.)
7. `data/backfill-master-manifest.json` (19 Okt 2026) — artefak gerbang
   cakupan saat tim master dijembatani ke dataset (per liga ±23 tim,
   hit-rate terukur) — preseden metode pencocokan nama tim
   master↔dataset yang importer baru ikuti (resolve-or-report, bukan
   tebak).

## D · Keputusan desain yang mengalir dari riset

1. **Importer football-data.co.uk = satu-satunya workhorse v1**
   (hasil + odds closing + telemetri gol/tembakan + fixtures + odds
   pra-laga), 16 divisi, tanpa kunci.
2. **Identitas:** match fixture `fd_<DIV>_<yyyymmdd>_<homeNorm>_<awayNorm>`;
   `competition_id` = kode divisi (mengaktifkan resolusi legacy-div
   yang sudah ada); hasil di `dataset.matches` memakai id yang sama;
   laga yang sudah ada sebagai `sm_`/`mt_` **dijembatani** (tanggal +
   nama ternormalisasi, metode audit), tidak diduplikasi.
3. **football-data.org** = importer fixture dorman ber-token env.
4. **Fork telemetri** (detail di laporan implementasi): hasil fd masuk
   `team_match_logs` ber-`source='football-data'`, gol lengkap, xG dari
   `HxG/AxG` bila kolomnya ada (jujur: itu xG sungguhan dari CSV, bukan
   karangan — koreksi atas asumsi awal brief yang mengira CSV tanpa
   xG; yang benar: xG ada untuk sebagian divisi), selain itu NULL.
   Filter saji `source='sportmonks'` **tidak diubah** di langkah ini.
