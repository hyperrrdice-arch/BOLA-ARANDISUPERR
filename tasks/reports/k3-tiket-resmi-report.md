# Laporan K3 — Tiket Resmi & Perhitungan Gabungan

- **Kartu:** K3 (PRD Peningkatan Aplikasi Bola, bab Data D4 + bab QA D09, Q01, Q04)
- **Branch:** `prd/k3-tiket-resmi` (bertumpuk di atas K2, belum merge — merge menunggu K8)
- **SHA awal:** `4825877` (tip `prd/k2-publikasi-bukti`)
- **Tanggal:** 2026-11-20
- **Status:** SELESAI di branch. Migrasi produksi + deploy TIDAK dijalankan (menunggu gerbang rilis K8).

## Ringkasan hasil

Tiket resmi kini terpisah tegas dari slip susunan browser: hanya pilihan
resmi berkomitmen K2 yang boleh menjadi anggota, tiket + seluruh anggota
terbit dalam **satu transaksi ledger**, dan komposisinya beku sejak
terbit. Status tiket **diturunkan** dari hasil anggota mengikuti aturan
D4 yang sebenarnya — vonis akhir tertunda selama ada anggota belum
terminal. Peluang gabungan dihitung jujur: alias ganda dihitung satu
kali, dua predikat satu laga digabung persis dari **irisan matriks
skor**, laga berbeda memakai asumsi independensi, dan tim yang sama
bermain dua kali dalam ≤72 jam menghasilkan **rentang** skenario dengan
penanda ketergantungan. D09 lulus penuh; Q01/Q04 bagian tiket lulus
termasuk empat bukti minimum kartu (alias 80%, irisan 51%, dua laga
35,2%, matriks hilang → `joint_unavailable`).

## Yang dibangun

### `lib/picks/tickets.ts` (baru)

- **Skema D4 (aditif, idempoten)** di picks.db: `published_slips(slip_uid,
  edition_key, slot, series, published_utc, policy_version, combined_prob,
  combined_basis, state)` + `slip_legs(slip_uid, position, pick_uid,
  fixture_uid, package_ref, frozen_prob)`, unik `(series, edition_key,
  slot)` dan `(slip_uid, pick_uid)`. Kolom tambahan di luar usulan D4:
  `source` (D4 prose: "simpan sumber tiket"), `combined_low`,
  `combined_high`, `combined_reason`, `combined_detail` (JSON: kelompok
  ketergantungan, skenario, ketergantungan terkuat, duplikat yang
  dibuang) — diperlukan agar rentang gabungan tersimpan, bukan hanya
  tampil. Kolom `state` menyimpan keadaan saat terbit (`pending`);
  status yang dibaca publik selalu diturunkan ulang dari hasil anggota.
- **`publishSlip`** — satu transaksi `BEGIN IMMEDIATE` di picks.db:
  validasi setiap anggota = pilihan resmi (`pick_uid` terisi, bukan baris
  `duplicate_of`) dan `published_utc < kickoff` setiap leg pada momen
  terbit; slot yang sudah terisi anggota sama → `already_published`
  (idempoten), anggota berbeda → `slot_taken` (mengganti anggota =
  tiket baru, jejak lama utuh). Alasan penolakan: `leg_not_found`,
  `leg_not_official`, `leg_kickoff_reached`, `slot_taken`.
- **`computeCombined` (murni, teruji langsung)**:
  - Dedup alias per (laga, pasar, garis, pilihan) — duplikat dibuang dan
    dicatat sebagai `alias_duplicate` di detail, tidak menambah leg.
  - Satu laga multi-predikat: joint = irisan matriks skor paket asal leg
    (predikat dari `selectionPredicate` di `lib/web/parlay.ts` — sumber
    predikat yang sama dengan builder browser). Matriks hilang atau
    predikat tak dikenal → `combined_prob NULL`, basis/alasan
    `joint_unavailable`. Perkalian marginal di dalam satu laga TIDAK
    dipakai untuk tiket resmi.
  - Antar laga: produk (asumsi independensi dinyatakan eksplisit).
  - Tim sama ≤72 jam (graf keterhubungan atas `home_cid/away_cid` dari
    store identitas K1): skenario gabungan penuh kelompok = probabilitas
    anggota terlemahnya; gabungan tiket tampil sebagai rentang
    `[combined_low, combined_high]` atas dua skenario, basis
    `dependency_range`, kelompok tertanda `same_team_window` + tim
    bersamanya, ketergantungan terkuat (selisih skenario terbesar)
    disorot di `strongest_dependency`. Tiket tidak diblokir.
  - `combined_prob` yang tersimpan = nilai skenario independensi
    (dengan irisan matriks eksak di dalam laga) — konsisten dengan
    angka gabungan yang selama ini ditampilkan produk; rentang dan
    basisnya tersimpan di kolom pendamping dan selalu ikut terbaca.
  - Leg dengan `published_prob NULL` (basis `invalid_effective` K2)
    membuat gabungan tidak terbit angka dengan alasan
    `leg_prob_unrecorded` — tidak ditebak.
- **Status turunan** — `slipStateOf` + pembaca: leg `void` dari
  `pick_voids` (K1), `hit/miss` dari `pick_outcomes` (sumber yang sama
  dengan resolver; koreksi skor otomatis mengubah vonis), sisanya
  `pending`. Aturan D4 persis: ada leg pending → status akhir
  `pending` (info `has_missed_leg` tetap tersedia untuk tampilan
  "Sudah ada pilihan yang meleset"); semua terminal: ada miss →
  `miss`, semua hit → `hit`, ada void tanpa miss → `void`. Nama state
  mengikuti vektor D09 di acceptance.json (`hit/miss/void/pending`),
  bukan skema ringkasan lama (active/won/lost/partially_void).
  `policy_version` tersimpan di tiket: `slip-status-2026-11`.
- **Jalur baca (level lib, untuk K7)** — `getOfficialSlip(slipUid)`
  mengembalikan tiket + setiap leg beserta hasil dan skornya, gabungan
  + rentang + detail ketergantungan, dan status terkini;
  `listOfficialSlips(filter)`; `slipRecordStats(filter)` = ukuran
  "Tepat per tiket" D4: `hit / (hit + miss)` atas tiket resmi selesai
  (NULL tanpa penyebut), plus void, pending, jumlah pertandingan unik,
  dan panjang tiket. Slip browser tidak pernah masuk tabel ini.

### Keputusan implementasi (dicatat sesuai kartu)

1. **Jendela tim-sama = ≤ 72 jam** — dokumen tidak menyebut angka;
   dipilih 72 jam (dua laga dalam tiga hari kalender) dan diekspos
   sebagai konstanta `SAME_TEAM_WINDOW_MS`.
2. **Aturan status mengikuti dokumen D4 + vektor D09**, bukan ringkasan
   brief awal: status final ditahan sampai semua anggota terminal
   (ditemukan pekerja sebelumnya, dikonfirmasi dari teks D4 dan
   vektor `ticket_settlement`).
3. **Irisan matriks untuk satu laga** mengikuti prompt kartu K3
   ("gunakan irisan score matrix untuk dua predikat dari laga yang
   sama") dan doktrin `lib/web/parlay.ts`; fallback produk-dalam-laga
   milik builder browser TIDAK diwarisi tiket resmi karena Q04
   menuntut `joint_unavailable` saat matriks hilang.
4. Penulis slate (`scripts/pick-slate.ts`) **tidak** diubah: slot/edisi
   tiket resmi adalah keputusan produk (edisi apa, slot apa), dan
   kartu K3 menuntut jalur terbit server + baca yang teruji — keduanya
   tersedia sebagai API lib yang dipakai suite lewat jalur produksi
   sebenarnya. Penerbitan otomatis dari slate menyusul keputusan
   produk itu, bukan ditebak di kartu ini.

## Hasil tes D09 / Q01 / Q04 (acceptance.json)

Suite baru `tests/test-tickets.ts` (**69 assertion**), tersambung ke
`npm run test:data` mengikuti pola K0–K2. Semua skenario lewat
publishPicks K2 → publishSlip → recordOutcome/markPickVoid ledger.

| Kasus | Masukan | Hasil | Harapan |
|---|---|---|---|
| Q04 alias | pilihan resmi 80% yang sama dimasukkan 2× | 1 leg efektif, gabungan **0,8**, duplikat tercatat `alias_duplicate`, frozen_prob tersimpan 0,8 apa adanya | sama (expected_unique 1, expected_prob 0,8) |
| Q04 distinct | dua laga berbeda 0,8 dan 0,7 | gabungan **0,56**, basis `independence`, low=high=0,56 | sama |
| Q01 irisan | matriks Q01, leg 1 (0,47) + leg 1X (0,87) satu laga | gabungan **0,47** (home ∩ 1X), basis `matrix_intersection` | sama persis |
| Q01 eksklusif | leg 1 + leg 2 satu laga, matriks Q01 | gabungan **0** (irisan kosong, bukan null) | sama (home_and_away = 0) |
| U03/K3 irisan | matriks demo interface_demo, 1X (0,75) + O1.5 (0,68) | gabungan **0,51** | sama (expected_joint 0,51) |
| U03/K3 dua laga | irisan 0,51 + laga lain 1X 0,69 | gabungan **0,3519** | sama (0,51 × 0,69) |
| Q04 matriks hilang | dua predikat satu laga, paket tanpa score_matrix | tiket terbit, `combined_prob NULL`, basis+alasan `joint_unavailable`, 2 leg tersimpan | sama |
| Dependensi | teamX main di dua laga berjarak 24 jam (0,8; 0,7) | basis `dependency_range`; skenario independensi 0,56, gabungan penuh 0,7; rentang [0,56; 0,7]; kelompok `same_team_window` teams=[teamX]; terkuat disorot | sesuai desain kartu |
| Dependensi kontrol | teamX lagi tapi berjarak 5 hari (0,8; 0,6) | basis `independence`, gabungan 0,48, tanpa rentang | sama |
| D09 terbit | tiket A dua laga; slip browser isi sama tidak disimpan server | tepat 1 tiket resmi per slot/edisi | sama |
| D09 ulang edisi | terbit ulang slot sama + anggota sama | `already_published`, slip_uid sama, tetap 1 tiket | sama |
| D09 ganti anggota | slot sama, anggota berbeda | `rejected: slot_taken`, tetap 1 tiket | sama |
| D09 anggota lab | baris lab tanpa pick_uid | `rejected: leg_not_official` | sama |
| D09 anggota telat | terbit tiket sesudah kickoff leg | `rejected: leg_kickoff_reached` | sama |
| D09 vektor status | lima vektor acceptance.json via slipStateOf | hit, miss, void, miss, pending | sama persis |
| D09 status nyata | lima tiket dua leg diselesaikan via recordOutcome/markPickVoid | berturut **hit, miss, void, miss, pending**; miss/pending tetap `pending` dengan `has_missed_leg=true` | sama |
| D09 tepat per tiket | edisi vektor (5 tiket, 10 laga unik) | selesai 4, hit 1, miss 2, void 1, pending 1, rasio **1/3** | sesuai D4 |
| D09 koreksi | skor leg tiket hit dibalik 2–0 → 0–3 | status → `miss`; komposisi leg, frozen_prob, combined_prob **tidak berubah**; stats hit 1→0, rasio 0/3 | sama |
| D09 isolasi stats | cohort dihitung, lalu tiket diterbitkan atas pick yang sama | `cohortStats` **identik** sebelum/sesudah — hasil tiket tidak masuk statistik pilihan | sama |

Q04 yang TIDAK dibuktikan di kartu ini (wilayah K4, dicatat eksplisit):
assertion regenerasi dua evaluasi dengan manifest yang sama dan
keputusan promosi model — itu identitas model/prediktor, bukan tiket.
Q01 selebihnya (turunan 1X2/DC dari matriks di jalur quant) sudah
menjadi wilayah suite quant dan tidak diubah kartu ini.

## Perintah verifikasi + hasil

Semua dari worktree `app-football-k3` (sesudah `npm ci`):

| Perintah | Exit | Hasil |
|---|---|---|
| `npx --no-install tsc --noEmit` | 0 | bersih |
| `npm run test:quant` | 0 | 22/22 assertion |
| `npm run test:data` | 0 | data 18/18 + identity 58/58 + publication 89/89 + tickets **69/69** |
| `npm run test:web` | 0 | 12/12 assertion |
| `npm run test:e2e` | 0 | 7/7 assertion |
| `npm run test:baseline:d01` | 0 | 12/12 assertion (D01 tetap hijau) |
| `npm run build` (env placeholder CI) | 0 | build bersih |
| `test:data` + `test:e2e` jalan kedua | 0 | hasil identik (deterministik) |
| `eslint` pada 2 file berubah | 0 | 0 error, 0 warning |

## File berubah

- Baru: `lib/picks/tickets.ts`, `tests/test-tickets.ts`
- Diubah: `package.json` (`test:data` menyambung suite tiket)
- Tidak diubah dengan sengaja: `scripts/pick-slate.ts` (lihat keputusan
  implementasi 4), `lib/picks/{ledger,publication,cohort,packages}.ts`
  (hanya dibaca/dipakai), `lib/web/parlay.ts` (predikat dipakai ulang,
  perilaku builder browser tidak berubah).
- File read-only tidak disentuh: `lib/agent/*`, `lib/coverage.ts`,
  `lib/syndicate-orchestrator.ts`, `lib/llm/*`. `.env.local` tidak dibuka.
- Tidak ada migrasi data historis: tabel tiket mulai kosong; slip
  browser tidak pernah tersimpan di server sehingga tidak ada backfill
  yang jujur untuk dibuat.

## Cara kembali (rollback)

- Kode: branch ini belum merge; tinggal tidak memakai
  `prd/k3-tiket-resmi`. Tidak ada penulis/ pembaca lama yang diubah
  perilakunya.
- Skema: dua tabel baru aditif di picks.db; mengabaikannya
  mengembalikan perilaku lama persis. Tidak ada baris picks yang
  diubah kartu ini.

## Belum terbukti / terbuka

- **Migrasi produksi + deploy menunggu K8** (keputusan pemilik: merge
  sekali di kartu terakhir). Semua bukti di atas berasal dari sandbox
  fixture.
- **Q04 inti (identitas model, regenerasi manifest, promosi) → K4.**
- Halaman `/bukti?tiket=<slip_uid>` dan builder resmi di UI adalah
  wilayah K7; kartu ini menyediakan jalur baca lib-nya.
- Penerbitan tiket otomatis dari penulis slate menunggu keputusan
  produk soal edisi/slot (lihat keputusan implementasi 4).
- **32 konflik skor antrean identitas K1 masih terbuka** — perlu
  peninjauan pemilik; tidak disentuh kartu ini.
