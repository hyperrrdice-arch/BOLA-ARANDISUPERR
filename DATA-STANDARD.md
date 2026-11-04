# Standar Data (Acuan Pakem) — football-agent

Ditetapkan 2026-11-05 atas perintah owner: seluruh database app ini punya
SATU acuan identitas permanen, supaya data dari sumber mana pun (lama,
sekarang, masa depan) tidak pernah campur lagi. Dokumen ini adalah
aturannya; file-file di bawah adalah wujudnya.

## 1. Registry resmi (sumber kebenaran identitas)

| Identitas | File | Dibangun oleh | Resolver runtime |
|---|---|---|---|
| Liga | `data/league-canonical.json` | `scripts/build-league-canonical.ts` | `lib/quant/league-identity.ts` |
| Tim | `data/team-canonical.json` | `scripts/build-team-canonical.ts` | `lib/quant/team-identity.ts` |
| Pertandingan katalog | `data/fixture-links.json` | `scripts/build-fixture-links.ts` | (tautan eksplisit twin → kanonik) |
| Form/telemetri | tabel `team_match_logs_canonical` di `thestats_dataset.db` | `scripts/build-canonical-telemetry.ts` | dibaca `lib/db/team-telemetry.ts` |

Aturan bentuk:
- Satu tim nyata = satu `canonical_id`. Semua id sumber (Sportmonks
  numerik, TheStats `tm_*`, football-data `fd_*`, baris sintetis
  standings/fixture, `legacy-name:*`) tercatat sebagai `members`; semua
  bentuk nama tersimpan + alias yang diputuskan tercatat di `aliases`.
- Id kanonik tim = id anggota Sportmonks pembawa data utama
  (`sm:<id>`); tanpa anggota SM: id TheStats, lalu id sumber lain.
- Nama kanonik = nama tersimpan anggota SM, dinormalisasi kamus alias
  proyek (`lib/quant/team-normalizer.ts` — satu-satunya normalizer);
  pengecualian tercatat sebagai override bernama di builder.
- Label benua dari Sportmonks ("World", "Europe", "Asia", …) BUKAN
  negara dan tidak boleh dipakai untuk logika pengelompokan/sengketa.

## 2. Keputusan identitas = data, bukan kode diam-diam

Penggabungan hanya dari bukti kuat: nama ternormalisasi sama + negara
tidak bertentangan, atau keputusan eksplisit yang tercatat di
`scripts/build-team-canonical.ts` (`MERGE_PAIRS` / `DISTINCT_PAIRS` /
`EXTRA_ALIASES` / `LEGACY_ONLY_TEAMS`, masing-masing dengan alasan
tertulis dan, untuk identitas klub yang ambigu, verifikasi web).

- Pasangan yang terbukti klub BERBEDA dicatat `distinct_from` — tidak
  akan pernah digabung otomatis (mis. River Plate Argentina vs Uruguay,
  Coria CF vs CD Coria, Qatar timnas vs Qatar SC).
- TANPA gabung fuzzy/jarak-edit di jalur otomatis. Pasangan mirip yang
  belum diputuskan muncul sebagai kandidat di
  `tasks/team-canonical-report.md` untuk diputuskan manusia/Spark
  dengan bukti.
- Nama yang tidak ditemukan di permukaan mana pun didaftarkan jujur:
  entri `name_unknown` (id-only) atau entri legacy-only — tidak ada
  nama karangan.

## 3. Lapisan data

- Lapisan MENTAH (`team_match_logs`, `matches`, tabel `teams`, katalog)
  adalah tempat importir menulis apa adanya dari sumbernya.
  Baris mentah tidak dihapus oleh proses pakem.
- Lapisan RESMI (`team_match_logs_canonical` + registry) dibangun ulang
  reproduksibel dari lapisan mentah + registry. Saji membaca lapisan
  resmi; harness ukur (backtest/parlay-lab) membaca definisinya sendiri
  dan tidak diubah oleh standar ini.
- Peleburan telemetri: kunci (tanggal, tim kanonik, lawan kanonik,
  venue); prioritas sumber **sportmonks > football-data > thestats
  (NULL) > master**; seri dalam satu sumber: xG terisi dulu, lalu kolom
  terlengkap. Skor yang bertentangan antar sumber ditandai
  `goals_conflict=1` (dipilih per prioritas, tidak disembunyikan);
  xG yang diisi dari kembaran ditandai `xg_filled_from`.

## 4. Kewajiban importir (semua sumber, selamanya)

1. Resolusi tim WAJIB lewat, berurutan: normalizer proyek → registry
   pakem (`canonicalIdForTeamName`) → baru buat id sumber baru
   (`fd_<slug>` dsb.) dan laporkan ke file unmatched. Tidak ada
   pencocokan nama ad-hoc di luar dua langkah itu.
2. Resolusi liga WAJIB lewat `lib/quant/league-identity.ts` (nama polos
   sendirian tidak pernah cukup — selalu nama + negara / id sumber).
3. Telemetri hanya ditulis untuk pertandingan yang benar-benar baru
   di-insert importir itu (pertandingan ter-bridge ke sumber lain
   TIDAK dapat baris telemetri kedua) — aturan anti-dobel yang sudah
   berlaku di `import-free-feed.ts`.
4. Setelah impor, rantai refresh WAJIB membangun ulang secara berurutan:
   registry tim → tautan fixture → (kalibrasi + offset piala) →
   telemetri kanonik. Kedua rantai (`scripts/daily-refresh.ts`,
   `scripts/free-refresh.ts`) sudah memuat urutan ini; importir baru
   harus masuk ke rantai yang sama, bukan jalan sendiri.

## 5. Keadaan terukur saat penetapan (2026-11-05)

- Tim kanonik: 6.557 dari 6.764 identitas sumber; grup tergabung 204.
- Cakupan: standings 1.129/1.129 id; nama fit rating 1.980/1.980;
  tim fixture tak ter-resolusi 0; referensi match/telemetri menggantung 0.
- Telemetri kanonik: 84.072 baris resmi dari 86.345 mentah (2.273
  kembar dilebur; 48 konflik skor tertandai).
- Pertandingan kembar katalog: 168 grup / 174 baris tertaut eksplisit.
- Bukti peralihan saji: `tasks/pakem-phase5-report.md`.
