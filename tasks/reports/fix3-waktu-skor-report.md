# Laporan Fix-3 — Waktu publikasi & skor 90 menit (Review K8 butir 3)

**Branch:** `fix/review-k8` (dari tip butir 2, `0b733b2`) · **Satu commit tersendiri** untuk butir ini (pesan `fix(waktu-skor): …`; hash di git log branch). **Tidak** merge, **tidak** menyentuh produksi/VPS/master. κ tetap 10. File read-only (`lib/agent/*`, `lib/coverage.ts`, `lib/syndicate-orchestrator.ts`, `lib/llm/*`) tidak disentuh.

Butir ini punya dua bagian independen: **A** waktu publikasi (cutoff dinilai dari jam aktual di dalam lock) dan **B** skor 90 menit (resolver menilai dari revisi skor regulasi terverifikasi).

---

## A. Waktu publikasi — jam dibaca ulang di dalam lock

### Cacat yang diperbaiki

`commitPublication` memvalidasi `now_utc` — nilai yang ditangkap pemanggil sebelum commit — di luar transaksi tulis. Uji sintetis review membuktikan pick resmi bisa terbit bercap 400 ms sebelum kickoff padahal commit selesai 100 ms sesudah kickoff: antara validasi dan pengambilan lock, waktu berjalan tetapi cap basi yang dipakai.

### Perubahan per file

- **`lib/picks/publication.ts`**
  - `CommitOptions` berubah bentuk: `now_utc: string` + `fixture_status: () => string|null` → **`now: () => string`** (fungsi jam yang bisa dibaca ulang) + **`fixture_state: () => { status, kickoff_utc } | null`** (keadaan fixture terkini: status DAN kickoff). Tipe baru diekspor: `FixtureStateNow`.
  - `commitPublication` direstrukturisasi menjadi **satu transaksi**: (1) pemeriksaan awal murah (intent tak ditemukan / sudah terminal / paket belum tertulis / verifikasi hash paket — baris paket immutable, aman dibaca di luar lock); (2) `BEGIN IMMEDIATE` — **lock writer diambil dulu**; (3) di dalam lock: intent dimuat ulang, keadaan fixture dibaca segar lewat `fixture_state()`, lalu **jam dibaca terakhir** — bacaan akhir itu (*nilai verifikasi akhir*, `verifiedNow`) memutuskan cutoff: `decision_at ≤ verifiedNow < kickoff-terkini` dan status masih `scheduled` (kickoff yang dipakai adalah kickoff terkini dari sumber otoritatif bila tersedia, bukan hanya kickoff intent); (4) penolakan (`rejected_cutoff` + alasan), kegagalan paket, penulisan pick beku, dan penandaan `committed` semuanya terjadi **di dalam transaksi yang sama**; cap `published_at_utc`/`created_utc` dan `updated_utc` intent memakai `verifiedNow` yang sama persis dengan nilai yang memutuskan cutoff.
  - `publishPicks` meneruskan `commitOpts.now()` (bacaan segar) ke `beginPublication`.
- **`scripts/pick-slate.ts`** — pemanggil produksi: `now: () => new Date().toISOString()` dan `fixture_state` membaca `status, utc_date` segar dari `upcoming_fixtures` untuk fixture itu (sebelumnya hanya status, dan `now_utc` ditangkap sekali per fixture).
- **`tests/helpers/publish-worker.ts`** — worker D05/D08 membungkus `spec.now`/`spec.fixture_status` ke bentuk opsi baru (kickoff dari input spec).
- **`tests/test-publication.ts`**, **`tests/test-tickets.ts`**, **`tests/test-model.ts`** — seluruh situs pemanggilan diperbarui ke bentuk baru lewat helper `optsAt(...)` (jam tetap + keadaan tetap). **Semantik pemanggil D05 tidak berubah**: terbit di T−1 ms diterima, di T dan T+1 ms ditolak, commit lewat T ditolak, `decision_after_publish` ditolak, status berubah ditolak — semua assertion D05 lama lulus apa adanya.
- **`tests/helpers/lock-holder.ts`** (baru) — proses terpisah yang menahan `BEGIN IMMEDIATE` pada picks.db selama N ms dan menulis file penanda begitu lock terpegang (dipakai uji 3A-5).

### Uji penerimaan A (blok "D05-R" di `tests/test-publication.ts`, 21 assertion, semua lulus)

| # | Kasus | Hasil |
|---|--------|-------|
| 3A-1 | Pembacaan status tertunda sampai sesudah kickoff (jam mulai T−400 ms; callback status menggeser jam ke T+100 ms, status tetap mengaku `scheduled`) | `rejected_cutoff` (`kickoff_reached`), **0 pick resmi** — persis skenario bukti review |
| 3A-2 | Kickoff dimajukan sesudah scan (intent: T; sumber otoritatif: T−1 jam, jam commit T−30 mnt) | `rejected_cutoff` (`kickoff_reached`), **0 pick** |
| 3A-3 | Retry intent lama sesudah T — commit langsung maupun `publishPicks` ulang | keduanya `rejected_cutoff`, **0 pick** |
| 3A-4 | Kasus sah T−1 ms | `published`, **tepat 1** pick; `published_at_utc` = nilai verifikasi akhir (T−1 ms); retry → `already_committed`, id sama, tetap 1 pick |
| 3A-5 | Penulis kedua tertahan lock proses lain (900 ms) sampai melewati T (jam palsu berbasis waktu nyata, mulai T−400 ms) | commit terbukti menunggu lock (≥400 ms terukur), lalu `rejected_cutoff`, **0 pick** |

Suite publikasi: **110/110** (89 lama + 21 baru).

---

## B. Skor 90 menit — resolver membaca revisi regulasi terverifikasi

### Cacat yang diperbaiki

`finishedScore` di resolver menerima status `AET`/`PEN` sebagai final (karena `normalizeMatchStatus` melipatnya ke `finished`) lalu mengembalikan `home_score/away_score` pertama yang tersedia — skor sesudah 90 menit dinilai sebagai skor final pasar 90 menit (bukti review: baris AET 2–1 dan PEN 5–4 lolos sebagai skor final).

### Sumber skor regulasi yang dipakai

Lapisan identitas K1: **`result_revisions`** pada fixture kanonik — revisi ber-`score_basis = 'regulation'` terakhir yang `finished` dan berskor (ditulis oleh `applyResultObservation`, yang memisahkan skor regulasi dari `home_score_et/away_score_et` dan `home_score_pen/away_score_pen`). Bila fixture selesai tetapi basisnya **`pending_score_basis`**, keadaan itu otoritatif: tidak ada baris mentah mana pun yang boleh menimpanya.

### Perubahan per file

- **`lib/identity/fixture-resolver.ts`** — dua tambahan murni-baca:
  - `isPostRegulationStatus(raw)` — ejaan mentah `aet`/`pen`/`pens` yang skor barisnya adalah skor sesudah 90 menit.
  - `getRegulationScore(db, fixtureUid)` — revisi regulasi terverifikasi terkini (`{ home, away, revision }` atau null).
- **`scripts/resolve-pick-outcomes.ts`** — pencarian skor ditulis ulang menjadi `findRegulationScore` bertingkat:
  1. **Identitas dulu**: UID pick (atau saudaranya) → fixture kanonik `finished`: basis `pending_score_basis` → hasil `pending_score_basis` (otoritatif, berhenti di sini); selain itu revisi regulasi via `getRegulationScore` → skor penilaian.
  2. **Baris mentah** (urutan kandidat lama dipertahankan: id pick, saudara identitas, bridge `sm_id_map`, registry tautan): hanya status full-time **polos** yang diterima; baris AET/PEN selalu dilewati dan keberadaannya dicatat.
  3. Hanya baris pasca-regulasi yang ditemukan → `pending_score_basis`; tidak ada apa pun → tetap unresolved biasa.
  - Pick berstatus `pending_score_basis`: **tetap pending** (tidak `recordOutcome`, tidak divoid; jalur void cancelled tetap berlaku lewat keadaan fixture), dihitung terpisah dan dilaporkan sebagai baris keluaran baru **`pending-score-basis: N`**. Penanda persistennya sendiri tersimpan di lapisan identitas (`canonical_fixtures.score_basis`, ditulis `applyResultObservation` saat observasi ET/penalti tiba) — resolver tetap read-only terhadap dataset, sesuai desain lamanya.
  - Jalur koreksi memakai pencarian yang sama: koreksi skor regulasi resmi (revisi baru) menilai ulang pick ter-resolve; riwayat revisi tidak pernah ditulis ulang oleh resolver.
- **`tests/test-resolver-score.ts`** (baru, dirangkai ke `test:data` lewat `package.json`) — 23 assertion lewat resolver normal sebagai subprocess.
- **`package.json`** — `test:data` menambahkan `tests/test-resolver-score.ts` di urutan terakhir.

### Uji penerimaan B (semua lulus, lewat resolver normal)

| # | Kasus | Hasil |
|---|--------|-------|
| 3B-1 | Piala: seri 1–1 di 90 menit lalu 2–1 sesudah ET; pick seri (`1x2/x`) menunjuk baris saudara mentah `mt_` yang selamanya berstatus AET 2–1 | outcome **1–1, HIT** — dinilai dari revisi regulasi, bukan skor AET |
| 3B-2 | Adu penalti 5–4 tanpa skor regulasi (fixture terdaftar identitas; baris jangkar tetap PEN 5–4) | **tanpa outcome, tidak divoid**; keluaran resolver `pending-score-basis` menghitungnya; `canonical_fixtures.score_basis = 'pending_score_basis'` |
| 3B-2b | Baris PEN 5–4 mentah **tanpa identitas sama sekali** | **tanpa outcome, tidak divoid** — penjaga ejaan pasca-regulasi di jalur baris mentah bekerja |
| 3B-3 | Koreksi regulasi resmi 2–1 → 1–1 sesudah pick seri ter-resolve `miss` dan masuk tiket resmi | observasi → `corrected` (revisi 2); resolver run 2 → `corrected: 1`; outcome menjadi **1–1 HIT**; **tiket berubah `miss` → `hit`** (status tiket turunan dari outcome anggota); riwayat revisi utuh (2 revisi: 2–1 lalu 1–1); outcome laga piala lain tidak ikut berubah |

Suite baru: **23/23**.

---

## Dampak historis (READ-ONLY — tidak ada riwayat yang ditulis ulang)

Diukur pada DB checkout utama VM (`~/workspace/coding/app-football/data/`, semua koneksi `readOnly`), **sebelum** perubahan kode dijalankan terhadap data apa pun:

**Metode.**
1. Inventaris ejaan status + kolom di `thestats_dataset.db.matches`: seluruh **71.503** baris berstatus `finished`; **0** baris berstatus AET/PEN; tabel tidak punya kolom skor ET/PEN sama sekali.
2. Seluruh pick ter-resolve (`pick_outcomes` ⋈ `picks`): **164.329** (lab 163.008 + live-run 1.321). Setiap outcome dibandingkan dengan (a) baris `matches` milik match_id-nya sendiri dan (b) seluruh baris satu kelompok fisik (union-find atas `fixture-links.json` + bridge `sm_id_map`): mencari skor yang diperselisihkan antar-sumber.
3. Populasi risiko dibatasi pada kompetisi **piala** (satu-satunya format yang bisa melewati 90 menit): kompetisi diidentifikasi dari `league-canonical.json` — nama mengandung `cup/copa/pokal/coupe/coppa/trophy` → 59 id kompetisi (canonical + alias); pick ter-resolve yang match-nya berada di kompetisi itu dihitung, dipilah menurut skor tersimpan seri vs tidak seri, dan menurut sumber (lab/live-run).

**Angka.**
- Pick yang **terbukti** dinilai dari baris AET/PEN: **0**. (Tidak ada baris seperti itu di data; 0 outcome berbeda dari baris sumbernya sendiri; 0 kelompok fisik yang skor antar-sumbernya berselisih.)
- Batas atas populasi yang **tidak bisa dibedakan** dari data yang ada: **11.239 pick** ter-resolve pada **703 laga piala** (lab 11.232 pick / 702 laga; live-run 7 pick / 1 laga). Dari jumlah itu, **1.552** berskor tersimpan seri — konsisten dengan skor regulasi (skor adu penalti tidak mungkin seri, skor ET menghasilkan pemenang); **9.687** berskor tidak seri yang *secara prinsip* bisa menyembunyikan hasil ET, **tanpa satu pun bukti positif** bahwa ada yang benar-benar begitu. Dataset tidak menyimpan penanda basis, jadi angka jujurnya adalah: terbukti 0, berisiko-tak-terbedakan ≤9.687, dan peninjauan manual per laga adalah satu-satunya cara mempersempitnya — di luar lingkup kartu ini, sesuai arahan review ("hitung dampak historis secara read-only dahulu agar perubahan riwayat bisa direview terpisah").

---

## Regresi penuh

Seluruh permukaan tes hijau (dijalankan dari worktree `app-football-fix`):

| Suite | Hasil |
|---|---|
| test:quant (quant 22 + model 61 + experiment-stats 23) | 106/106 |
| test:data (data 18 + identity 58 + publication 110 + tickets 69 + resolver-score 23) | 278/278 |
| test:web (web 12 + ui 66 + rekam 110 + detail-render 27) | 215/215 |
| test:e2e | 7/7 |
| test:baseline:d01 | 12/12 |
| **Total** | **618/618** (574 permukaan lama + 44 assertion baru butir ini: 21 di publikasi, 23 di resolver-score) |

`npx tsc --noEmit` exit 0. `npm run build` exit 0 dengan env placeholder persis CI (`.github/workflows/ci.yml`; tanpa placeholder build gugur di `/api/agent` — perilaku lama sejak K0, bukan temuan baru).

## Penyimpangan dari arahan review — dinyatakan eksplisit

1. **Bentuk API `CommitOptions` berubah** (bukan hanya perilaku): `now_utc`/`fixture_status` diganti `now`/`fixture_state`. Ini memang yang diminta review ("injeksi fungsi jam yang bisa dibaca kembali"), dan seluruh pemanggil (pick-slate, worker tes, tiga suite) diperbarui dalam commit yang sama; semantik dari sisi pemanggil — termasuk seluruh assertion D05 lama — dipertahankan persis dan terbukti hijau. Tidak ada pemanggil lain di repo (ditelusuri dengan grep menyeluruh).
2. **Penanda `pending_score_basis` untuk baris mentah tanpa identitas** tidak ditulis ke DB oleh resolver: resolver memang read-only terhadap dataset sejak desain K1, dan mengubahnya menjadi penulis adalah perubahan perilaku yang lebih besar daripada yang diminta butir ini. Untuk kasus itu penanda hidup di (a) penolakan jalur skornya di kode dan (b) hitungan `pending-score-basis: N` pada keluaran run resolver. Untuk fixture terdaftar identitas, penanda persistennya adalah `canonical_fixtures.score_basis` seperti dirancang K1. Bila pemilik ingin resolver ikut menulis penanda untuk baris yatim, itu kartu tersendiri.
3. **Uji lock 3A-5** memakai proses penahan lock terpisah + jam palsu yang ditambatkan ke waktu nyata (bukan dua commit paralel dengan jam suntik yang sama), karena dua penulis dalam satu proses tidak bisa berbagi satu jam suntik. Marginnya lebar (lock 900 ms, ambang tunggu terukur ≥400 ms, jam bergeser 400 ms sebelum kickoff) sehingga tidak bergantung pada ketepatan milidetik mesin.
