# Laporan Audit Database Penuh — 5 Nov 2026

> Branch `safe-bet-parlay`. Metode: query read-only (`mode=ro`)
> atas semua store + grep provenance atas `lib/ scripts/ app/`.
> **Setiap angka di laporan ini dihasilkan query selama audit**
> (log mentah: `tasks/db-audit-worklog.md`). Audit ini tidak
> mengubah satu baris pun di store mana pun — mutasi yang diusulkan
> ada di §6 sebagai proposal berisiko-terukur untuk keputusan owner.
> Konkurensi: koordinator telemetri bekerja di tree yang sama selama
> audit (commit 4674ba9 dst.) — audit tidak menyentuh kode jalur saji
> maupun isi store telemetri.

---

## 1. Vonis per store

| Store | Ukuran | Baris kunci | Integritas | Isu teratas |
|---|---|---|---|---|
| `football_master.db` | 9,8 MB | matches 28.922 | ✅ ok, FK 0 | statis by design; bukan isu |
| `upcoming_fixtures.db` | 1,7 MB | fixtures 3.770 · catalog 317 · sm_id_map 3.420 | ✅ ok | **62 kembaran mt_/sm_ tak terjembatani** (F-16, tanpa referensi hilir); 270 fixture lampau masih 'scheduled'; `competition_catalog` tulis-saja (P-06) |
| `thestats_dataset.db` | 1,53 GB | matches 70.114 · team_match_logs 85.521 · teams 6.450 · odds 4.071 · registry 125 | ✅ ok, FK 0 (integrity_check rampung via proses latar pasca-jendela utama — lihat F-02) | 50 baris hasil ganda (P-01); standings yatim → INV-13 FAIL (P-03); xg_for NULL 57,4% |
| `predictions.db` | 14,2 MB | sm_predictions 70.553 · value_bets 80 · predictability 5.590 | ✅ ok | isolasi terverifikasi (INV-14); skala persen probabilitas kini terdokumentasi |
| `picks.db` | 46,2 MB | picks 163.491 (lab 163.008 + live-run 483) · outcomes 163.008 | ✅ ok, FK 0 | sehat; resolver lag 0 |
| `analysis_snapshots.db` (paket) | 0,7 MB | packages 78 · meta 8 | ✅ ok | sehat; payload valid 78/78 |
| `thestats_raw_vault.db` | 18,8 MB | raw_api_vault 1.991 | ✅ ok | beku sejak 18 Okt 2026 (provider mati) — dokumentasi diperbaiki |
| `archive/analysis_snapshots-legacy-2026-10.db` | 0,9 MB | snapshots 21 · outcomes 81 | ✅ ok | beku sesuai kontrak (INV-16) |

JSON: `league-canonical.json` — 250 liga, 412 alias, 0 alias ganda
lintas liga, semua 88 id kompetisi katalog ter-resolve (INV-07 ✅).
`calibrated_ratings.json` — 72 liga / 1.842 tim, join status ke
registry: 39 calibrated / 33 partial, 0 kunci hilang.

## 2. Temuan per tingkat keparahan

### S1 — memengaruhi kebenaran/kepercayaan

**F-01 · INV-13 FAIL: standings merujuk tim yang tidak ada.**
225 baris `standings` merujuk 167 `team_id` yang tidak ada di
`teams`. Akar struktural (provenance): fungsi penulis `upsertTeam`
(`lib/db/thestats-dataset.ts:393`) **tidak punya satu pun pemanggil
di seluruh repo** — tabel `teams` tidak dirawat kode aktif, jadi
referensi baru tidak pernah termaterialisasi. Perbaikan = P-03.

**F-02 · Integritas dataset — TERTUTUP: ok (INV-18 PASS).**
Selama jendela utama audit, `PRAGMA integrity_check` atas store
1,5 GB tidak rampung di bawah beban tulis bersamaan (dua percobaan
timeout, termasuk `quick_check` berbatas 100 detik) dan statusnya
sempat dicatat UNVERIFIED apa adanya. Proses latar audit akhirnya
rampung: **integrity_check = ok, foreign_key_check = 0
pelanggaran** — kedelapan store kini terverifikasi. Catatan proses:
integrity_check store sebesar ini tidak kompatibel dengan penulis
bersamaan di VM ini; jadwalkan di jendela tenang pada audit
berikutnya.

**F-03 · 50 baris hasil ganda di `dataset.matches`.**
50 grup duplikat (50 baris ekstra) atas (kompetisi, tanggal, home_id,
away_id) — **di dalam ruang id yang sama**; duplikat lintas ruang id
(mt_/sm_) terukur **0**. Inilah kelas bug yang sama dengan divergensi
telemetri saji yang diperbaiki koordinator telemetri di sisi baca;
di sisi store, baris gandanya masih ada. Telemetri menutup via
match_id (0 yatim), jadi dedupe harus mempertahankan id yang
dirujuk. Perbaikan = P-01.

### S2 — celah kualitas data (jujur, terukur, tidak mengarang)

- **F-04 · xg_for NULL di 57,4% team_match_logs** (49.076/85.521) —
  cakupan xG Sportmonks memang parsial; disiplin NULL-bukan-0
  dipatuhi (INV-15). Jalur saji sadar bobot (penanda
  `xg_weighted_toward` dari perbaikan telemetri).
- **F-05 · 270 fixture lampau masih berstatus 'scheduled'** di
  katalog (kickoff tertua 18 Okt 2026) — backlog rotasi; INV-03
  negatifnya terverifikasi bukan bug resolver (0 pick live-run
  yatim-waktu). Perbaikan = P-02.
- **F-06 · 308 baris odds `payload_json` NULL** dari 4.071 — baris
  tetap punya odds ternormalisasi; yang hilang hanya payload
  tampil/provenance. Perbaikan = P-04.
- **F-07 · Odds premium = 0 baris** padahal entitlement aktif —
  endpoint provider kosong (terverifikasi sprint); bukan bug lokal.
- **F-08 · `competition_catalog` tulis-saja**: 317 baris ditulis
  ulang tiap sync, nol pembaca produksi ditemukan. P-06.
- **F-09 · `team_squads` setengah yatim**: dibaca jalur telemetri
  (konteks skuad/cedera), penulis repo-nya tanpa pemanggil aktif —
  isinya membeku senyap. P-07.
- **F-10 · 225 tim `tm_` ber-country NULL** dan hanya mereka —
  tidak ada sumber jujur untuk mengisinya dari data lokal; tetap
  NULL adalah jawaban benar (lihat P-05 catatan).

### S3 — identitas & dokumentasi

- **F-11 · Tim belum punya registry kanonik** (liga sudah — ADR-001).
  Census di §3. Proposal = P-05.
- **F-12 · Drift dokumen** — dikoreksi audit ini (§5): hitungan
  usang di ARCHITECTURE.md (matches/log/odds/value-bets), kalimat
  label ratings yang mencampur dua basis, status snapshots
  append-only yang sudah dicabut owner masih tertulis sebagai
  aturan hidup di 3 dokumen, klaim retensi vault "90 hari bergulir",
  hitungan file di STRUCTURE.md (lib 42→46, scripts 15→23, store
  6→7), dan kontrak `docs/db-snapshot.md` tanpa penanda superseded.

## 3. Census identitas (terukur, metode dinyatakan)

Normalizer census: NFKD → lipat ASCII → huruf kecil → buang tanda
baca → buang token imbuhan {fc, afc, cf, sc, ac, as, us, cd, sd,
club, de, the}. Populasi: gabungan nama di `teams` (6.441 distinct),
nama fixture katalog (1.397), kunci ratings (1.457), nama master (403).

- **Kembaran fixture mt_/sm_ tak terjembatani: 62 terverifikasi**
  (F-16). Dari 378 fixture `mt_`, 123 terjembatani; 255 sisanya
  dicocokkan ulang melawan seluruh katalog `sm_`: **62 pasangan**
  pada timestamp kickoff identik + nama ternormalisasi identik
  (64–72 pada varian lebih longgar; metode pekerja census dengan
  normalizer kode menghasilkan 59 — semua metode berkumpul di
  kisaran yang sama). Contoh tak ambigu: Ipswich Town vs Bournemouth
  (comp_3039 ↔ sm:8, timestamp sama persis), Atlético Madrid vs
  Barcelona (comp_8814 ↔ sm:564). **Koreksi jujur: pengukuran census
  pertama audit ini menyatakan 0 — query-nya cacat (kriteria join
  terlalu sempit) dan angka itu sempat masuk draf dokumen; angka
  yang berdiri adalah hasil lari ulang di atas.** Dampak terukur
  hari ini terbatas: 0 pick dan 0 paket merujuk sisi `mt_` —
  duplikasi berhenti di katalog (proposal P-09).
- **Duplikasi hasil selesai**: 50 grup / 50 baris ekstra intra-ruang;
  lintas ruang id = 0 (F-03).
- **Tim**: id telemetri (5.497 = 5.272 numerik SM + 225 `tm_`) adalah
  subset penuh `teams` (tml-only = 0); 953 id `teams` tanpa log
  telemetri (semua numerik SM). Tabrakan ejaan (lari ulang census,
  normalizer yang sama): **111 grup** (106 lintas sumber, 5 satu
  sumber — kelimanya di `teams`; di dalam `teams` saja 11 grup;
  maks 3 ejaan per grup; metode normalizer-kode pekerja census
  menghasilkan 130 pada korpusnya — angka ini sensitif metode dan
  dinyatakan apa adanya). Contoh: AFC Bournemouth/Bournemouth ·
  FC Porto/Porto · Red Star/Red Star FC · Atlético Madrid/Atletico
  Madrid · 1. FC Köln/1. FC Koln · FC Metz/Metz. Arah sebaliknya di
  `teams`: 9 grup nama persis dan 12 grup ternormalisasi dipakai >1
  team_id (River Plate ×2, Al Ahli ×2, …) — resolusi nama→id memang
  wajib sadar konteks liga.
- **Kunci ganda di dalam ratings (F-14)**: 26 grup kunci tim
  ternormalisasi ganda **di dalam satu liga yang sama** di
  `calibrated_ratings.json` — terverifikasi contohnya adalah salinan
  alias yang diperluas dengan statistik byte-identik (Bournemouth +
  AFC Bournemouth di E0 **dan** SM8). Pengecualian yang ditandai
  pekerja census dan masuk akal: pasangan mirip yang sebenarnya dua
  klub berbeda (Benfica vs CF Benfica, SM462) — penggabungan berbasis
  normalisasi saja akan salah di sana; P-05 wajib membawa daftar
  do-not-merge.
- **Ruang id hanya disjoint karena prefix**: 10 sufiks numerik `tm_`
  juga ada sebagai id numerik Sportmonks di `teams`, dan **0 dari 10
  itu klub yang sama** (terverifikasi nama) — kode apa pun yang
  menanggalkan prefix akan menggabungkan klub yang salah secara
  diam-diam.
- **Satu-satunya fits kanonik menggantung (F-15)**: liga kanonik
  sm:1085 membawa `fits[0].ratings_key = 'SM1085'`, tetapi
  `calibrated_ratings.json` tidak punya liga SM1085 (72 kunci) —
  tepat 1 dari seluruh entri fits kanonik. Baris registry sm:1085
  berstatus uncalibrated (cup-offset) sehingga gerbang memblokir
  sajiannya; dampak langsung nol, tetapi referensi lintas-artefaknya
  basi (INV-19 FAIL, proposal P-10).

## 4. Invarian — hasil lari

Kontrak penuh + SQL: `docs/DATA-INVARIANTS.md`.
**19 invarian: 15 PASS · 2 FAIL (INV-13 standings→teams, F-01;
INV-19 satu fits kanonik menggantung, F-15) · 2 catatan sesuai
desain/disiplin (INV-15 NULL jujur; INV-17 dua fixture predictions
di luar katalog = retensi permanen by design).** (INV-18 sempat
terbuka selama jendela utama, lalu tertutup PASS — lihat F-02.
INV-19 ditambahkan dari temuan census susulan dan langsung
dijalankan.)
Sorotan PASS yang menopang
kepercayaan: INV-01/02 (tautan pick↔paket persis), INV-04 (0 kaki
live-run dari liga uncalibrated), INV-09 (sm_id_map 0 basi),
INV-10/11/12 (penutupan referensial telemetri/odds/paket = 0 yatim),
INV-14 (isolasi predictions: store terpisah + diff payload odds
resmi vs payload predictions untuk 71 fixture tumpang-tindih =
0 irisan), INV-16 (arsip legacy utuh).

## 5. Perbaikan yang diterapkan audit ini (dokumen & aditif saja)

1. `docs/DATABASE.md` — kamus data lengkap (323 baris): skema
   terukur per store, kunci, provenance §12, retensi, penunjuk
   invarian.
2. `docs/DATA-INVARIANTS.md` — kontrak 18 invarian dengan query
   pemeriksa + hasil lari apa adanya (termasuk FAIL INV-13, dan
   INV-18 yang sempat terbuka lalu tertutup PASS).
3. `docs/AGENT-HANDOVER.md` — brief cold-start: produk, disiplin
   branch/commit, daftar 🔒, **peringatan blok injeksi
   `nextjs-agent-feedback` di AGENTS.md proyek**, inventaris cron,
   status provider + rencana feed gratis, cara verifikasi.
4. `docs/decisions/ADR-001…005` — identitas liga kanonik; split DB
   per fungsi; paket di file snapshots yang diganti; isolasi
   predictions; ledger pick sebagai catatan validasi. Semua
   Accepted, bertanggal, dengan konteks + konsekuensi.
5. Koreksi drift F-12 di `ARCHITECTURE.md`, `STRUCTURE.md`, dan
   banner SUPERSEDED di `docs/db-snapshot.md` (sejarah tidak
   ditulis ulang — diberi penanda).
6. **Tidak ada indeks yang ditambah**: jalur akses panas (ledger
   per paket/match/pita, paket per match/kickoff) sudah terindeks;
   menambah indeks tanpa kebutuhan query-plan terukur = spekulasi.
   Ditimbang dan ditolak secara eksplisit.

## 6. Proposal (mutasi — menunggu keputusan owner)

- **P-01 · Dedupe 50 baris ganda `dataset.matches`.** Perubahan
  persis: untuk tiap grup duplikat, pertahankan match_id yang
  dirujuk `team_match_logs` (atau salah satu bila tak dirujuk),
  hapus kembarannya; verifikasi sesudahnya: grup duplikat = 0,
  counts tml tidak berubah, INV-10 tetap PASS. Risiko: sedang —
  salah pilih id memutus referensi telemetri; mitigasi = transaski
  tunggal + cek referensi per grup dulu. Menyentuh store telemetri
  → koordinasikan dengan koordinator telemetri.
- **P-02 · Higiene status katalog.** 270 fixture lampau 'scheduled'
  → tandai selesai/batal dari data hasil, atau hapus setelah masa
  tenggang. Risiko rendah; domain rantai refresh (pemilik cron).
- **P-03 · Sembuhkan INV-13 + rawat `teams`.** Backfill 167 baris
  tim yang hilang dari payload Sportmonks (nama/negara resmi), lalu
  sambungkan `upsertTeam` ke jalur sync konteks agar tidak kambuh.
  Risiko: rendah-sedang (fidelitas nama dari provider); verifikasi =
  INV-13 PASS.
- **P-04 · 308 payload odds NULL**: tangkap ulang selagi fixture
  belum kickoff (jendela menyempit harian), sisanya terima sebagai
  NULL permanen berlabel. Risiko: nol ke angka (payload bukan input
  kuant).
- **P-05 · Bangun `data/team-canonical.json`** (aditif murni — file
  + generator `scripts/build-team-canonical.ts`, nol perubahan
  jalur saji): kunci stabil dari id sumber kanonik, `aliases[]`
  (system/id/name_as_stored), display_name, country, confidence +
  provenance per alias; nama telanjang ambigu (River Plate,
  Al Ahli) **fail-closed** — tidak pernah ter-resolve tanpa konteks
  liga/negara. Konsumen bermigrasi belakangan, masing-masing dengan
  validasi OOS/cek konsumsi sendiri. 225 country `tm_` tetap NULL
  sampai ada sumber jujur.
- **P-06 · `competition_catalog`**: sambungkan pembaca atau berhenti
  menulisnya (edit skrip sync). Risiko: konsumen eksternal tak
  terlihat dari repo — grep menyatakan tidak ada.
- **P-07 · `team_squads`**: putuskan — sambungkan penulisnya ke sync
  konteks, atau drop tabel di pass skema berikutnya (3.893 baris).
  Keputusan bersama pemilik telemetri karena pembacanya di jalur itu.
- **P-08 · Tutup INV-18 — SELESAI** (proses latar audit rampung:
  integrity ok, FK 0; lihat F-02). Tidak ada tindakan lanjutan;
  untuk audit berikutnya, jadwalkan integrity_check dataset di
  jendela tenang sejak awal.

## 7. Review lima sumbu atas lapisan data (code_review_and_quality)

- **Kebenaran (correctness)**: penutupan referensial terukur nyaris
  sempurna — satu lubang nyata (INV-13) dengan akar teridentifikasi;
  duplikasi store 50 baris (F-03); integritas dataset belum tuntas
  diverifikasi (F-02). Sisanya: 7/8 store integrity ok.
- **Keterbacaan (readability)**: konvensi id per sumber konsisten
  dan kini terdokumentasi; utang keterbacaan terbesar adalah
  ketiadaan registry tim (111 grup ejaan + 26 grup kunci ganda
  intra-liga ratings) — terkuantifikasi, bukan kesan.
- **Arsitektur**: split per fungsi terbukti sehat (isolasi
  predictions dapat dibuktikan mekanis, INV-14); satu definisi
  semantik pick (`evaluatePick`) dipakai lab + engine + resolver;
  koneksi dataset tunggal bersama. Kelemahan: dua tabel yatim/tulis-
  saja (F-08/F-09) dan penulis `teams` yatim (F-01).
- **Keamanan**: token hanya via env/konfigurasi cron berpersetujuan;
  `.env.local` tidak pernah dibuka audit ini; tidak ada rahasia di
  store mana pun yang teramati; file 🔒 hanya di-grep read-only.
- **Performa**: tidak ada bloat — freelist dataset 2 halaman pada
  1,5 GB; indeks sekunder menutup jalur akses terukur; ukuran per
  store proporsional terhadap isinya. Satu-satunya catatan:
  integrity_check store besar tidak kompatibel dengan beban tulis
  bersamaan di VM ini (F-02) — masalah penjadwalan, bukan skema.

## 8. Catatan metode — draf pekerja diverifikasi ulang

Dua pekerja recon menghasilkan draf seksi; tiga angka draf terbukti
salah dan dikoreksi query langsung sebelum masuk dokumen mana pun:
(i) "28 sm_fixture_id menggantung" → sebenarnya 28 menunjuk laga
selesai di dataset, **0 menggantung**; (ii) "447 duplikat lintas
ruang id" → terukur **0** lintas ruang (50 grup intra-ruang);
(iii) klaim id `tm_` di telemetri + baris team_id NULL → populasi
terukur 5.272 numerik + 225 `tm_`, team_id NULL = 0. Dua kelalaian
draf provenance juga dikoreksi grep langsung: pembaca
`dataset.matches` (resolver outcome, `scripts/resolve-pick-outcomes.ts:43`)
dan keberadaan `upsertTeam` (ada, tanpa pemanggil). Draf mentah
tidak di-commit; angka terverifikasi hidup di worklog + laporan ini.

## 9. Keterampilan yang diterapkan

- **documentation_and_adrs**: 5 ADR untuk keputusan struktural yang
  sudah berlaku (konvensi penamaan skill karena repo belum punya);
  dokumen usang diberi banner SUPERSEDED, bukan ditulis ulang
  sejarahnya; kamus data + brief handover ditulis untuk pembaca
  cold-start.
- **constraint_driven_development**: kontrak invarian tertulis,
  bernomor, dan dapat dicek mesin (`docs/DATA-INVARIANTS.md`) —
  setiap invarian punya query pemeriksanya dan hasil larinya
  dicatat apa adanya — FAIL (INV-13) dicatat sebagai FAIL, dan
  INV-18 dicatat terbuka selama memang terbuka lalu diperbarui
  begitu hasil penutupnya tiba. Kontrak berhenti menjadi slogan;
  ia jadi gerbang.
- **code_review_and_quality**: review lima sumbu atas lapisan data
  (§7) — tiap vonis ditopang hitungan audit, bukan kesan.
- **verify_before_claiming (disiplin rumah)**: tidak ada angka di
  dokumen audit yang tidak dihasilkan query audit ini; tiga angka
  draf pekerja + dua kelalaian provenance tertangkap justru karena
  diverifikasi ulang (§8).

---

## Addendum — koreksi provenance terlambat (terverifikasi koordinator)

Draf provenance pekerja tiba setelah laporan utama; distribusi
sumbernya mengonfirmasi angka audit (tml sportmonks 83.098 ·
matches sm_ 68.901/mt_ 1.174/mas* 39 · odds SM 3.571 · katalog
sm_ 3.392/mt_ 378 · vault 1.991 · trigger paket 70/4/4). Dua hal
layak dicatat permanen:

- **F-13 (S3, informasional — bukan cacat)**: registry
  `league_calibration` saat ini berisi source sportmonks-fit 92 /
  legacy-csv-fit 16 / cup-offset 17 dan **nol baris source
  'canonical'**, padahal `calibrate-ratings.ts` punya langkah
  membangun-ulang baris itu. Terverifikasi dari kode (baris 651–703):
  baris 'canonical' hanya disisipkan untuk liga kanonik yang **belum**
  punya baris utama berkunci canonical_id — saat ini semua target
  sudah punya, jadi langkah itu menyisipkan 0 dan DELETE-nya no-op
  **by design**. Konsekuensi dokumenter: kalimat provenance awal
  audit ("menulis ulang seluruh baris") terlalu longgar — mekanisme
  sebenarnya INSERT OR REPLACE berkunci; sudah diperbaiki di
  `docs/DATABASE.md` §12. Jalur saji tidak terpengaruh (gerbang
  membaca baris utama via canonical_id).
- Baris telemetri source NULL (2.348) terukur **seluruhnya**
  match_id `mt_*` — konsisten dengan label "era TheStats"; dicatat
  di `docs/DATABASE.md` §3.

### Addendum 2 — proposal dari temuan census susulan

- **P-09 · Jembatani atau dedupe 62 kembaran katalog (F-16).**
  Perbaikan tahan lama ada di pencocokan skrip sync katalog
  (celah normalizer: normalizer kode tidak menanggalkan 'AFC' dan
  kawanannya — kasus Bournemouth), bukan tambalan baris sekali.
  Untuk 62 pasangan terverifikasi: tulis baris jembatan `sm_id_map`
  atau pensiunkan baris `mt_`-nya. Risiko: sedang-rendah — terukur
  0 pick/paket merujuk sisi `mt_`, tetapi konsumen masa depan yang
  memindai katalog mentah akan menggandakan laga ini; verifikasi
  sesudahnya = lari ulang pencocokan census (target 0) + INV-09
  tetap PASS.
- **P-10 · Validasi fits kanonik terhadap berkas ratings (F-15).**
  Tambahkan cek di generator kanonik: setiap `fits[].ratings_key`
  harus ada sebagai kunci liga di `calibrated_ratings.json`; entri
  basi SM1085 gugur pada pembangunan ulang berikutnya. Risiko:
  nol ke sajian (liga itu sudah terblokir gerbang); verifikasi =
  INV-19 PASS.

Catatan koreksi census (mengikat §3 & §8): angka kembaran "0" pada
pengukuran census pertama audit ini adalah kesalahan metode
koordinator sendiri — bukan hanya draf pekerja yang perlu
diverifikasi ulang. Lari ulang dengan kolom dan kriteria yang benar
menghasilkan 62 (lihat §3), dan dokumen-dokumen yang sempat membawa
angka lama (DATABASE.md §2, laporan ini) sudah dikoreksi dalam
commit koreksi census yang sama. Pelajarannya dicatat apa adanya:
klaim negatif ("tidak ada X") menuntut verifikasi metode seketat
klaim positif.
