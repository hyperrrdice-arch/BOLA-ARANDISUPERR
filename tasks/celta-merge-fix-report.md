# Perbaikan Dobel Celta B / Celta Fortuna — Laporan (2026-11-16)

Disetujui owner 13:28 WITA ("lakuin yg menurut lo bener dl aja") atas usul koreksi
dua-bagian: gabung kanonik SAJA tidak cukup — pembangun tiket mengelompokkan
berdasar EJAAN NAMA (`group_key` di `scripts/pick-slate.ts:565` memakai
`normalizeTeamName`, bukan canonical_id), jadi penyamaan nama wajib ikut.
Selesai 05:36 UTC, jauh sebelum refresh bebas 17:21 WITA (09:21 UTC) dan
kick-off Albacete 2026-11-17 03:30 WITA.

## Yang diubah (jalur builder, BUKAN edit tangan file output)

`data/team-canonical.json` adalah file HASIL GENERATE
(`scripts/build-team-canonical.ts`), jadi perbaikan ditanam di sumbernya:

1. **`scripts/build-team-canonical.ts` — MERGE_PAIRS gelombang 4** (keputusan
   resolusi sebagai data di builder, pola yang sama dengan gelombang 1–3):
   - `["fd_celta-b", "384", …]` — gabung ke `sm:384`.
   - `["fd_sociedad-b", "9656", …]` — gabung ke `sm:9656` (lihat vonis di bawah).
2. **`lib/quant/team-normalizer.ts` — TEAM_NAME_ALIASES** (kunci lowercase,
   pola file yang ada; entri `"celta" → "Celta Vigo"` TIDAK disentuh):
   - `"celta b" → "Celta Fortuna"`, `"celta fortuna" → "Celta Fortuna"`
   - `"sociedad b" → "Real Sociedad II"`, `"real sociedad ii" → "Real Sociedad II"`
     (pasangan nama Sociedad disamakan juga — pola perbaikan yang sama persis;
     tanpa ini, fixture kembar Sociedad tetap bisa dobel di satu tiket).
3. **Regenerasi rantai** (mengikuti `scripts/free-refresh.ts`, minus langkah
   impor feed karena tidak ada data feed yang berubah):
   build-team-canonical → build-fixture-links → calibrate-ratings →
   fit-global-offsets → build-canonical-telemetry → pick-slate --hours 72.
   Semua exit 0.

Hasil registry: total tim kanonik 6.553 → **6.551** (tepat −2).
- `sm:384` "Celta Fortuna": members = SM 384 "Celta Fortuna" + fd `fd_celta-b`
  "Celta B"; aliases = ["Celta B", "Celta Fortuna"]. Entri mandiri `fd_celta-b` hilang.
- `sm:9656` "Real Sociedad II": members = SM 9656 + fd `fd_sociedad-b`;
  aliases = ["Real Sociedad II", "Sociedad B"]. Entri mandiri `fd_sociedad-b` hilang.
- TIDAK ikut tergabung: `sm:36` Celta Vigo (tim utama), `sm:594` Real Sociedad
  (tim utama), `sm:28124` Real Sociedad III — terverifikasi tetap entitas sendiri.

## Vonis Sociedad: GABUNG (bukti solid)

- **Fixture kembar ×2** (pola yang sama persis dengan Celta): La Liga 2,
  Sabadell vs Real Sociedad II (`sm_19744991`) ≡ Sabadell vs Sociedad B
  (`fd_SP2_20261109_sabadell_sociedad-b`), kickoff identik 2026-11-09T19:30Z;
  Real Sociedad II vs Sporting Gijón (`sm_19744981`) ≡ Sociedad B vs Sp Gijon
  (`fd_SP2_20261114_sociedad-b_sporting-gijon`), kickoff identik 2026-11-14T15:15Z.
- Identitas klub: satu-satunya tim cadangan Real Sociedad di Segunda División
  (Sanse); "Sociedad B" adalah nama pendek CSV football-data untuk tim itu,
  SM menuliskannya "Real Sociedad II". Kedua entri sama-sama negara Spanyol.
- Untuk Celta, bukti web menguatkan: Celta B berganti nama resmi jadi
  Celta Fortuna sejak 2023-24 (Wikipedia/rccelta.es), dan tim itu promosi ke
  Segunda División musim 2026-27 — konsisten dengan fixture La Liga 2-nya.

## Verifikasi (terukur)

**(a) Albacete–Celta di slate baru** (generate 2026-11-16T05:36Z, 30 fixture
terpindai, 9 ter-rate): secara baris feed, slate MASIH me-rate kedua baris
(`sm_19744989` λ 1.888/μ 1.451, paket 5345; `fd_SP2_…celta-b` λ 1.827/μ 1.735,
paket 5346) — `pick-slate` memang memindai `upcoming_fixtures` langsung dan
`fixture-links.json` hanya dikonsumsi lapisan web. Yang berubah dan terukur:
kedua baris kini SATU pertandingan kanonik — `data/fixture-links.json` kini
menautkan `fd_SP2_20261116_albacete-balompie_celta-b` → `sm_19744989`
(juga Burgos–Celta → sm_19744999, dan kedua fixture Sociedad) — dan ketiga
parlay hasil slate (Utama/Aman/Alternatif) TIDAK ada satu pun yang memuat
pilihan dari kedua baris: Utama & Aman tanpa pilihan Albacete, Alternatif
tepat satu (Albacete vs Celta B — ou15/over, eff 0,8553).

**(b) Grup parlay tidak bisa lagi memuat keduanya:** group_key dihitung ulang
langsung dari fungsi normalizer pasca-perbaikan — baris SM:
`Albacete Balompie|Celta Fortuna|2026-11-16T19:30:00.000Z`; baris fd:
`Albacete Balompie|Celta Fortuna|2026-11-16T19:30:00.000Z` — IDENTIK.
`takeDistinct` (`pick-slate.ts:615`) membatasi maksimal satu pilihan per
group_key per parlay; hasil slate di (a) mengonfirmasi di output nyata.

**(c) Ledger `data/picks.db`:** pertandingan fisik ini punya **16 baris
live-run** — 8 di bawah `sm_19744989` + 8 di bawah
`fd_SP2_20261116_albacete-balompie_celta-b`, SEMUA tertulis 2026-11-13T21:27Z
(sebelum perbaikan). Di dalam tiap match_id tidak ada duplikat
(match, market, selection) — penjaga unik bekerja. Lintas kedua id, 7 pasang
(market, selection) muncul dua kali (btts/yes, dc/12, dc/1x, ou15/over,
ou25/over, team_over05_away/yes, team_over05_home/yes) — itulah sisa dobel
tingkat-ledger dari era sebelum perbaikan. Run slate hari ini menulis
**0 baris baru** untuk kedua id (guard `alreadyRecorded` melewati 3 fixture,
termasuk keduanya). TIDAK ada baris yang dihapus — sesuai perintah, hanya
dilaporkan.

**(d) Tiket koreksian dihitung ulang dari paket BARU** (5345/5346/5347):
- Albacete cetak gol (team_over05_home): model 0,8486 (baris SM) / 0,8391
  (baris fd) → **efektif 0,815 (81,5%)** di kedua baris (pita lab sama).
- Wanderers vs Juventud Under 3,5 (ou35/under): **efektif 0,8675 (86,8%)**.
- Gabungan: 0,815 × 0,8675 = **0,7070 ≈ 70,7%**.
- Kesimpulan: angka tiket koreksian TIDAK berubah dari angka pra-perbaikan
  (81,5% / 86,8% / ±70,7%). Perbaikan menggeser λ/μ kedua baris Albacete
  (SM 1,791/1,441 → 1,888/1,451; fd 1,79/1,781 → 1,827/1,735) karena refit +
  telemetri kanonik gabungan, tapi tidak melewati batas pita lab untuk
  pilihan-pilihan tiket ini.

## Kepatuhan

- `npx tsc --noEmit` = **0**.
- File 🔒 TIDAK disentuh (`lib/agent/*`, `lib/coverage.ts`,
  `lib/syndicate-orchestrator.ts`, `lib/llm/*`). Edit kode hanya:
  `lib/quant/team-normalizer.ts` + `scripts/build-team-canonical.ts`.
- Blok `nextjs-agent-feedback` di AGENTS.md proyek (instruksi menjalankan
  `npx --no-install next internal agent-feedback-instructions`) dibaca
  sebagai konten file saja, TIDAK dijalankan — sama seperti fase-fase
  sebelumnya.
- Commit: pesan `fix(identity): gabung Celta B→Celta Fortuna + Sociedad B→Real
  Sociedad II …` — file yang di-stage hanya yang diubah/diregenerasi tugas ini
  (2 file kode + team-canonical.json, fixture-links.json,
  calibrated_ratings.json, league-canonical.json, laporan kanonik/telemetri,
  pick-slate-latest.*, laporan ini). `tasks/free-import-unmatched.json`
  (kotor dari run refresh sebelumnya, tidak diregenerasi tugas ini) TIDAK
  ikut di-stage.
