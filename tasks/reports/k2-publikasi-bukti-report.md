# Laporan K2 — Publikasi & Bukti (Peluang Beku Saat Terbit)

- **Kartu:** K2 (PRD Peningkatan Aplikasi Bola, bab Data D3/D4 + bab QA D05–D08)
- **Branch:** `prd/k2-publikasi-bukti` (bertumpuk di atas K1, belum merge — merge menunggu K8)
- **SHA awal:** `5bd1d17` (tip `prd/k1-identitas-hasil`)
- **Tanggal:** 2026-11-20
- **Status:** SELESAI di branch. Migrasi produksi + deploy TIDAK dijalankan (menunggu gerbang rilis K8).

## Ringkasan hasil

Prediksi kini **beku saat terbit**: jalur tulis slate → paket → ledger berjalan
sebagai publikasi dua fase (intent → paket → commit) dengan identitas operasi
stabil, validasi cutoff **saat commit**, dan angka terbit yang tidak bisa
diubah paket analisis yang lebih baru. Statistik cohort dihitung dari sampel
yang sama lewat fungsi teruji `cohortStats`. D05–D08 lulus semua, termasuk
crash parsial dan retry paralel.

## Yang dibangun

### Produser (jalur tulis)

- **`lib/picks/publication.ts` (baru)** — inti publikasi:
  - `publication_intents` (tabel baru di picks.db): operation key stabil =
    sha256(seri | fixture UID | cutoff terjadwal | fingerprint input);
    intent disimpan **sebelum** pekerjaan apa pun.
  - `beginPublication`: simpan/resume intent, lalu tulis paket lewat
    `writePackage` dengan unique computation key yang deterministik per
    operasi — retry menemukan paket yang sama persis.
  - `commitPublication`: **satu transaksi picks.db** — verifikasi identitas
    + hash isi paket terhadap intent, validasi ulang
    `decision_at ≤ published_at < kickoff` dan status fixture masih
    `scheduled` pada momen commit, tulis baris pilihan beku, tandai intent
    `committed`. Penolakan tercatat sebagai `rejected_cutoff` (paket tetap
    ada sebagai analisis internal, nol baris pilihan).
  - Pilihan resmi = keputusan pertama seri pada
    `(fixture_uid, market, line, selection, series)`; line dinormalisasi
    sekali (`canonicalLineFor`; pasar tanpa garis memakai `''`, bukan NULL)
    dan ditegakkan indeks unik parsial. Baris resmi berikutnya memakai id
    yang sudah ada, tidak pernah menimpa.
  - Kolom beku aditif di `picks`: `pick_uid`, `fixture_uid`, `line`,
    `series`, `package_key`, `package_hash`, `decision_at_utc`,
    `published_at_utc`, `kickoff_at_issue_utc`, `model_version`,
    `ratings_hash`, `grade_policy_version`
    (`market-grade-thresholds-2026-11`), `settlement_policy_version`
    (dari K1), `code_sha`, `input_snapshot_id`, `published_prob`,
    `probability_basis`, `published_error`, bukti (grade, gate_status,
    `evidence_quality`, `evidence_source`, `evidence_age_sec`), dan odds
    (`odds_bookmaker`, `odds_period`, `odds_line`, `odds_decimal`,
    `odds_captured_utc`, `odds_note`).
  - Angka terbit: `published_prob = effective_prob ?? model_prob` dari
    nilai valid saat terbit. Effective tersedia tapi invalid → baris terbit
    dengan `published_prob NULL`, basis `invalid_effective`, penanda
    `published_error` — tidak diganti diam-diam. **Nol adalah nilai sah**
    (teruji).
  - Odds yang ditawarkan: hanya snapshot `prematch` yang tersedia
    ≤ `decision_at`, harga desimal valid (> 1, finite); yang segar menang.
    Closing dan panel arsip ber-basis terpisah — panel masuk `sm_prob`,
    tidak pernah masuk `odds_decimal`. Harga invalid → odds NULL +
    `odds_note = 'invalid_price_rejected'`.
  - `listPendingIntents()` untuk rekonsiliasi read-only;
    `getPickPublication(pickId)` membaca baris beku apa adanya (label
    "Peluang terbit tidak tercatat" untuk basis `unknown_legacy`).
  - Transaksi memakai `BEGIN IMMEDIATE` + retry terbatas atas
    SQLITE_BUSY, sehingga dua worker identik terserialisasi, bukan saling
    menggagalkan.
- **`lib/picks/cohort.ts` (baru)** — `cohortStats({now_utc, filter,
  pending_reasons?})`: satu filter untuk semua ukuran. Akurasi =
  hit/(hit+miss); cakupan = dinilai/(dinilai + pending jatuh tempo),
  jatuh tempo = **6 jam sesudah kickoff** (final terverifikasi lebih awal
  langsung layak karena outcome sudah ada). Pending dibedakan belum
  mulai / menunggu jendela / jatuh tempo; void terpisah dan di luar
  penyebut. Irisan probabilitas: `AVG(published_prob)` vs `AVG(hit)` atas
  baris terselesaikan ber-`published_prob` + jumlah irisan + jumlah
  warisan hit/miss-saja. Tanpa penyebut → `hit_ratio NULL` (label
  "Belum ada hasil"); 0% hanya bila ≥ 1 observasi dinilai. Alasan jatuh
  tempo (sumber tak mencakup / konflik) tidak disimpan di ledger —
  pemanggil boleh menyerahkan peta `pick_id → alasan`; tanpa peta,
  alasannya `unspecified`.
- **`scripts/pick-slate.ts`** — jalur ledger live-run diganti dari
  `recordPicks` massal di akhir run menjadi `publishPicks` per fixture
  (intent → paket → commit beku). `MarketInfo` kini juga membawa harga
  desimal mentah per pasar (SM quotes + buku utama football-data) sebagai
  snapshot prematch. Status fixture dibaca segar dari
  `upcoming_fixtures` pada momen commit; fixture yang commit-nya lewat
  cutoff dihitung di statistik baru `ledger_cutoff_rejected_fixtures` dan
  tetap ter-rate sebagai analisis internal. Keluaran MD/JSON slate tidak
  berubah selain statistik itu. Jalur `--no-ledger` / sudah-tercatat tetap
  menulis paket langsung seperti sebelumnya.
- **`lib/picks/ledger.ts`** — satu-satunya perubahan: `computeAgreementSpread`
  kini diekspor agar dipakai ulang jalur publikasi (semantik pasar tetap
  satu sumber di `evaluatePick`, tidak diubah).

### Pembaca

- **`lib/web/data.ts`** — interface `PickRow` ditambah tiga kolom beku
  (`published_prob`, `probability_basis`, `published_at_utc`) secara
  aditif; query `SELECT *` yang ada membawanya otomatis. Penghitungan
  ulang statistik web dari `model_prob` adalah wilayah K7 dan tidak
  disentuh kartu ini.

### Migrasi bukti lama

- **`lib/picks/publication-migration.ts` (baru)** + CLI tipis
  **`scripts/migrate-published-prob.ts`**: hanya memproses baris dengan
  `probability_basis IS NULL` (idempoten). Aturan jujur:
  - Baris terikat paket yang payload-nya memuat leg persis sama
    (market, selection) dengan angka yang sama dengan baris →
    diselamatkan (basis `effective`, atau `model` bila leg dan baris
    sama-sama tanpa effective). "Sama" = identik, atau identik pada
    presisi simpan historis 4 desimal (satu generasi produser lama
    membulatkan `effective_prob` saat menulis baris; payload paket
    menyimpan presisi penuh). `published_prob` yang disimpan adalah
    **angka baris itu sendiri**, bukan presisi paket.
  - Selain itu → `probability_basis = 'unknown_legacy'`,
    `published_prob NULL`, `published_at_utc NULL` (tidak ada waktu
    terbit karangan); baris keluar dari perbandingan probabilitas, tetap
    bisa dinilai hit/miss.
  - UID fixture di-resolve lewat store identitas K1 bila tersedia; dalam
    grup `(fixture_uid, market, line, selection, series)` baris paling
    awal memegang `pick_uid`, sisanya ditandai `duplicate_of`.

## Hasil tes D05–D08 (acceptance.json)

Suite baru `tests/test-publication.ts` (89 assertion) + worker subprocess
`tests/helpers/publish-worker.ts`, tersambung ke `npm run test:data`
sehingga CI memanggilnya lewat script yang sudah ada. Semua skenario
lewat jalur produksi sebenarnya dengan jam terinjeksi.

| Kasus | Masukan | Hasil | Harapan |
|---|---|---|---|
| D05 | kickoff T = 2026-11-20T13:00Z; terbit T−1ms / T / T+1ms | diterima / ditolak / ditolak | sama |
| D05 | begin sebelum T, commit T+1ms | `rejected_cutoff`, 0 pick, paket tetap ada | sama |
| D05 | `decision_at` (12:30) > `published_at` (12:00) | ditolak, alasan `decision_after_publish` | sama |
| D05 | status fixture berubah ke `finished` sebelum commit | ditolak, alasan `fixture_not_scheduled:finished` | sama |
| D05 | 2 worker, kombinasi identik, dilepas bersamaan (barrier) | tepat 1 intent, 1 pick resmi, pick ids kedua worker sama | sama |
| D06 | paket A (model 0,79 → terbit 0,74), lalu paket B (0,85 → 0,76) ditulis | `getPickPublication` tetap 0,74 dari A; `latestPackageFor` = B | sama |
| D06 | leg `effective_prob = 0` | `published_prob = 0` (bukan null), basis `effective` | sama |
| D06 | baris warisan tanpa bukti terbit | label "Peluang terbit tidak tercatat"; sesudah migrasi basis `unknown_legacy`, keluar dari irisan probabilitas | sama |
| D06 | baris warisan terikat paket, leg presisi penuh vs baris 4-dp (0,74830398… vs 0,7483) | basis `effective`, `published_prob = 0,7483` (angka baris) | sama |
| D07 | 2 masa depan, 3 tepat, 1 meleset, 2 jatuh tempo, 1 void (now tetap) | terbit 9, dinilai 4, tepat 3/4 = 75%, cakupan 4/6 = 66,7%, void 1, alasan jatuh tempo {no_source 1, konflik 1}, irisan prob n=4 AVG 0,75 vs 0,75 | sama persis |
| D07 | koreksi skor satu pick tepat → meleset | tepat 3→2, rasio 75%→50% (statistik lama terbatalkan) | sama |
| D07 | cohort tanpa hasil; lima meleset | `hit_ratio NULL` + label "Belum ada hasil"; 0/5 = 0 persis | sama |
| D08 | prematch test-book 2,10 (09:00) sebelum keputusan 10:30; closing 1,80 (12:59); panel arsip prob 0,44 | `odds_decimal = 2,10` prematch; panel → `sm_prob 0,44`; closing tidak masuk odds | sama |
| D08 | harga prematch invalid (0,95) | odds NULL + `odds_note = 'invalid_price_rejected'` | sama |
| D08 | crash sesudah package commit (worker exit 3) | intent `package_written` terlihat di rekonsiliasi; retry: paket yang sama, tepat 1 paket + 1 pick | sama |
| D08 | crash sesudah ledger commit (worker exit 4, tanpa lapor hasil) | retry → `already_committed`, pick ids sama, tetap 1 pick | sama |
| D08 | retry paralel sesudah crash paket | kedua worker exit 0, pick ids sama, tepat 1 paket + 1 pick per operation key | sama |

## Migrasi pada salinan konsisten (BUKAN produksi)

Salinan dibuat dengan `sqlite3 .backup` dari DB checkout utama VM ke
`~/workspace/coding/k2-migration-proof/data/` (dataset salinan lebih dulu
dimigrasi identitas K1: 70.420 fixture, 32 konflik terantre — sama persis
dengan bukti K1). Sha256 ketiga DB produksi identik sebelum dan sesudah
seluruh pembuktian — produksi tidak disentuh.

| Ukuran | Sebelum | Sesudah (jalan 1) |
|---|---|---|
| Total baris picks | 170.782 | 170.782 |
| basis `effective` (terselamatkan) | — | **7.774** (100% baris live-run) |
| basis `model` | — | 0 |
| basis `unknown_legacy` | — | **163.008** (100% baris lab — memang tak pernah terikat paket) |
| duplikat ditandai | — | 0 |
| UID ter-resolve / tak ter-resolve | — | 164.202 / 6.580 |
| `PRAGMA integrity_check` | ok | ok |

Catatan bukti: dengan aturan identik-ketat saja, 184 baris live-run gagal
diselamatkan; pemeriksaan menunjukkan **184/184** cocok persis dengan leg
paketnya pada pembulatan 4 desimal (0 pengecualian, 0 leg hilang) — bukti
deterministik perbedaan presisi simpan antar-generasi produser, sehingga
aturan diterima pada presisi 4-dp dengan angka baris sebagai yang
disimpan. Jalan 2: `processed 0, already_migrated 170.782` — idempoten.

## Perintah verifikasi + hasil

Semua dari worktree `app-football-k2` (sesudah `npm ci`):

| Perintah | Exit | Hasil |
|---|---|---|
| `npx --no-install tsc --noEmit` | 0 | bersih |
| `npm run test:quant` | 0 | 22/22 assertion |
| `npm run test:data` | 0 | data 18/18 + identity 58/58 + publication **89/89** |
| `npm run test:web` | 0 | 12/12 assertion |
| `npm run test:e2e` | 0 | 7/7 assertion |
| `npm run test:baseline:d01` | 0 | 12/12 assertion (D01 tetap hijau) |
| `npm run build` (env placeholder CI) | 0 | build bersih |
| `test:data` + `test:e2e` jalan kedua | 0 | hasil identik (deterministik) |
| `eslint` pada 9 file berubah | 0 | 0 error, 0 warning |

## File berubah

- Baru: `lib/picks/publication.ts`, `lib/picks/cohort.ts`,
  `lib/picks/publication-migration.ts`, `scripts/migrate-published-prob.ts`,
  `tests/test-publication.ts`, `tests/helpers/publish-worker.ts`
- Diubah: `lib/picks/ledger.ts` (ekspor `computeAgreementSpread` saja),
  `scripts/pick-slate.ts` (jalur publikasi + snapshot desimal),
  `lib/web/data.ts` (3 kolom aditif di `PickRow`), `package.json`
  (`test:data` menyambung suite publikasi)
- File read-only tidak disentuh: `lib/agent/*`, `lib/coverage.ts`,
  `lib/syndicate-orchestrator.ts`, `lib/llm/*`. `.env.local` tidak dibuka.

## Cara kembali (rollback)

- Kode: branch ini belum merge; tinggal tidak memakai `prd/k2-publikasi-bukti`.
  Jalur lama `recordPicks` masih utuh di ledger untuk pemanggil lain.
- Skema: semua perubahan aditif (kolom + tabel `publication_intents` +
  indeks parsial) dan tidak mengubah baris yang ada; mengabaikannya saja
  sudah mengembalikan perilaku lama. Migrasi bukti hanya pernah berjalan
  di salinan sandbox.

## Belum terbukti / terbuka

- **Migrasi produksi + deploy menunggu K8** (keputusan pemilik: merge
  sekali di kartu terakhir). Angka di atas berasal dari salinan konsisten.
- **32 konflik skor antrean identitas K1 masih terbuka** — perlu
  peninjauan pemilik; migrasi K2 tidak menyentuhnya.
- Alasan pending jatuh tempo (sumber tak mencakup / konflik) belum
  persisted di ledger; `cohortStats` menerimanya dari pemanggil. Bila K7
  membutuhkannya sebagai data tetap, itu penambahan skema tersendiri.
- Statistik web (`/bukti`) masih menghitung dari `model_prob` — penyatuan
  ke angka terbit beku adalah wilayah K7, bukan kartu ini.
