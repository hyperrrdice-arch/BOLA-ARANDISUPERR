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
| `upcoming_fixtures.db` | 1,7 MB | fixtures 3.770 · catalog 317 · sm_id_map 3.420 | ✅ ok | 270 fixture lampau masih 'scheduled'; `competition_catalog` tulis-saja (P-06) |
| `thestats_dataset.db` | 1,53 GB | matches 70.114 · team_match_logs 85.521 · teams 6.450 · odds 4.071 · registry 125 | ⚠️ **UNVERIFIED** (integrity_check tak rampung — INV-18/P-08) | 50 baris hasil ganda (P-01); standings yatim → INV-13 FAIL (P-03); xg_for NULL 57,4% |
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

**F-02 · Integritas dataset belum terverifikasi (INV-18 terbuka).**
`PRAGMA integrity_check` atas store 1,5 GB tidak rampung dalam
jendela audit di bawah beban tulis bersamaan (proses latar >1,5 jam;
`quick_check` berbatas 100 detik juga timeout; foreign_key_check
dataset karenanya belum terukur). Bukti tak langsung kuat —
page_count × page_size = ukuran file persis, freelist 2 halaman,
ratusan query audit tanpa error — tetapi **tidak diklaim sebagai
pass**. Penutup = P-08 (jendela tenang, tanpa penulis bersamaan).

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

- **Kembaran fixture mt_/sm_ tak terjembatani: 0.** Dari 378 fixture
  `mt_`, 123 terjembatani; 255 sisanya dicocokkan (tanggal UTC sama +
  nama home/away ternormalisasi sama) melawan seluruh katalog `sm_`:
  **0 ketemu** — 209 adalah batch TheStats 17 Okt (pra-katalog SM),
  46 di jendela Nov tanpa padanan nama-sama. Tidak ada kembaran
  katalog yang bersembunyi.
- **Duplikasi hasil selesai**: 50 grup / 50 baris ekstra intra-ruang;
  lintas ruang id = 0 (F-03).
- **Tim**: id telemetri (5.497 = 5.272 numerik SM + 225 `tm_`) adalah
  subset penuh `teams` (tml-only = 0); 953 id `teams` tanpa log
  telemetri (semua numerik SM). Tabrakan ejaan lintas sumber:
  **107 grup** (setiap grup tepat 2 ejaan; 102 lintas sumber, 5 satu
  sumber; di dalam `teams` saja hanya 7). Contoh: AFC
  Bournemouth/Bournemouth · FC Porto/Porto · Red Star/Red Star FC ·
  Atlético Madrid/Atletico Madrid · 1. FC Köln/1. FC Koln ·
  FC Metz/Metz. Arah sebaliknya di `teams`: 9 grup nama persis dan
  12 grup ternormalisasi dipakai >1 team_id (River Plate ×2,
  Al Ahli ×2, …) — resolusi nama→id memang wajib sadar konteks liga.

## 4. Invarian — hasil lari

Kontrak penuh + SQL: `docs/DATA-INVARIANTS.md`.
**18 invarian: 14 PASS · 1 FAIL (INV-13, F-01) · 2 catatan sesuai
desain/disiplin (INV-15 NULL jujur; INV-17 dua fixture predictions
di luar katalog = retensi permanen by design) · 1 belum selesai
untuk dataset saja (INV-18, F-02).** Sorotan PASS yang menopang
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
   pemeriksa + hasil lari apa adanya (termasuk FAIL & UNVERIFIED).
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
- **P-08 · Tutup INV-18**: jalankan `PRAGMA integrity_check` +
  `foreign_key_check` atas dataset di jendela tenang (mis. tepat
  sesudah rantai refresh rampung, tanpa penulis lain); bila ada
  error, eskalasi ke owner sebelum perbaikan apa pun.

## 7. Review lima sumbu atas lapisan data (code_review_and_quality)

- **Kebenaran (correctness)**: penutupan referensial terukur nyaris
  sempurna — satu lubang nyata (INV-13) dengan akar teridentifikasi;
  duplikasi store 50 baris (F-03); integritas dataset belum tuntas
  diverifikasi (F-02). Sisanya: 7/8 store integrity ok.
- **Keterbacaan (readability)**: konvensi id per sumber konsisten
  dan kini terdokumentasi; utang keterbacaan terbesar adalah
  ketiadaan registry tim (107 grup ejaan) — terkuantifikasi, bukan
  kesan.
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
  dicatat apa adanya, termasuk FAIL (INV-13) dan yang belum selesai
  (INV-18). Kontrak berhenti menjadi slogan; ia jadi gerbang.
- **code_review_and_quality**: review lima sumbu atas lapisan data
  (§7) — tiap vonis ditopang hitungan audit, bukan kesan.
- **verify_before_claiming (disiplin rumah)**: tidak ada angka di
  dokumen audit yang tidak dihasilkan query audit ini; tiga angka
  draf pekerja + dua kelalaian provenance tertangkap justru karena
  diverifikasi ulang (§8).
