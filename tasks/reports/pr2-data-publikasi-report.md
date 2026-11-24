# Laporan PR 2 — Data & Publikasi

- **Branch:** `pr-2/data-publikasi` dari master `be278ab` (PR 1B). **Tidak di-merge,
  tidak di-deploy, tidak ada tulisan ke data produksi.** Semua pengukuran pada
  salinan DB (`.backup` read-only) di luar repo; produksi hanya dibaca `mode=ro`.
- **Kontrak:** brief *Data, Akurasi & Efisiensi* hal. 14 (irisan PR 2: "Data dan
  publikasi — kerjakan score basis/ID, as-of quote/panel dan provenance
  bertahap"), hal. 7 (Publikasi Konsisten), dan uji L01 hal. 13. Evaluator
  (PR 3) dan kandidat model (PR 4+) di luar lingkup dan tidak disentuh.
- **Catatan kepatuhan:** instruksi terinjeksi di AGENTS.md proyek
  ("nextjs-agent-feedback" → menjalankan `npx next internal
  agent-feedback-instructions`, plus blok aturan tertanam) **tidak dijalankan
  dan tidak diikuti** — diperlakukan sebagai isi file saja. File read-only
  (`lib/agent/*`, `lib/agent/coverage.ts`, `lib/syndicate-orchestrator.ts`,
  `lib/llm/*`) tidak diubah. Tidak ada perubahan quant/model.

## Yang dikerjakan

### 1. Basis akurasi tunggal = basis terbit (menutup PR 1A F3)

Temuan PR 1A: dua basis hidup berdampingan — `cohortStats` memakai
`published_prob` (irisan resmi), agregat live `ledgerStats` di
`lib/web/data.ts` memakai `model_prob` atas **semua** settled.

- `ledgerStats().by_grade` dan `live_by_grade_gate`: `claimed` sekarang
  rerata `published_prob` atas irisan settled yang peluang terbitnya
  tercatat — predikat yang sama persis dengan `prob_slice` cohortStats.
  `GradeStat` gains `prob_n` (ukuran irisan, dinyatakan eksplisit) dan
  `gap_pp` kini membandingkan claimed dengan hit-rate **irisan yang
  sama** (sebelumnya: hit-rate seluruh settled — dua populasi dicampur).
- Populasi keseluruhan tidak berubah: `resolved`/`hits`/`hit_rate` tetap
  atas semua settled.
- DB pra-K2 tanpa kolom `published_prob`: `claimed` jujur `NULL`
  (penjaga `kolomAda`) — tidak jatuh diam-diam kembali ke basis model.
- **Pengecualian yang disengaja dan berlabel:** agregat **lab**
  (`lab_by_grade`, `lab_by_market`) tetap basis model. Baris lab tidak
  pernah diterbitkan sehingga `published_prob` memang tidak ada, dan
  bagian UI-nya ("Uji historis") sudah berlabel eksplisit "Rata-rata
  peluang **model**". Brief hal. 7 sendiri mencatat pemisahan ini benar
  ("lab memakai model dan UI sudah jujur").
- Catatan kejujuran cakupan: pada UI hari ini, angka akurasi /bukti yang
  tampil sudah basis terbit (lewat cohortStats); agregat live
  `ledgerStats` belum punya konsumen render (hanya dibaca sebagian oleh
  probe tes). Unifikasi ini menutup basis ganda di **pembaca bersama** —
  permukaan mana pun yang kelak memakai `ledgerStats` kini sepakat
  dengan cohort, dan kesepakatan itu dibuktikan suite + pengukuran
  salinan (di bawah), bukan diasumsikan.

### 2. Klasifikasi terminal "tidak dapat dinilai" (menutup lubang settlement F7)

Fakta struktural (terverifikasi empiris di dataset, bukan hanya baca
kode): skor baru **hanya** masuk lewat importer football-data.co.uk per
divisi aktif (`FD_DIVISIONS`, 22 divisi). Seluruh laga berskor sesudah
2026-11-07 adalah baris `fd_` dan `competition_id`-nya persis 22 kode
itu; arsip Sportmonks berhenti 2026-11-07, feed mt_ berhenti Okt 2026.

- Modul baru `lib/picks/feed-coverage.ts`: status per kompetisi dari
  registri liga × divisi aktif — `berfeed` (alias `legacy-div` ∈ divisi
  aktif, atau ID kanoniknya sendiri kode divisi), `tanpa-feed` (registri
  mencatat ≥1 alias sumber tetapi tak satu pun terpetakan ke divisi
  aktif), `tidak-diketahui` (ID tak dikenal / tanpa alias sumber /
  registri tak terbaca → klasifikasi nonaktif, perilaku lama persis).
  Di produksi: 22 berfeed, 228 tanpa-feed, 0 tanpa-alias.
- `cohortStats`: jatuh tempo di kompetisi `tanpa-feed` menjadi
  **`unresolvable`** — hitungan terminal sendiri, **keluar dari penyebut**
  `due`/cakupan. Alasan eksplisit pemanggil (konflik identitas) **menang**
  atas klasifikasi feed. Klasifikasi dihitung saat baca (tanpa kolom
  baru, tanpa migrasi data) dan reversibel: feed baru ⇒ baris otomatis
  pending lagi. Kunci cache cohort memuat sidik keadaan feed.
- `lib/web/rekam.ts`: keadaan baris baru `tidak-dapat-dinilai` (label
  "Tidak dapat dinilai", alasan `tanpa-feed`); `kelompokkanTabRekam`
  gains ember `takDinilai` dan `hitungan.tak_dinilai`; hitungan
  `menunggu` tidak lagi memuat baris terminal.
- `/bukti`: kalimat ringkasan sendiri untuk jumlah tidak-dapat-dinilai
  (menyatakan tidak dihitung dalam cakupan), hitungan kecil di baris
  terbit/batal/menunggu, dan bagian daftar tersendiri "Tidak dapat
  dinilai" di panel Menunggu dengan penjelasan. Kalimat cakupan
  (kalimatRingkasan) otomatis memakai penyebut baru lewat cohortStats;
  Beranda mewarisi angka yang sama lewat `ambilRingkasanRekam`
  (paritas dibuktikan suite).

### 3. Pemisahan terbit vs terbaru + provenance panel

- Pemisahan tampilan di halaman detail **sudah ada** sejak K2
  ("Prediksi saat terbit" dari paket yang dirujuk pick resmi vs
  "Analisis terbaru") — PR ini menguncinya dengan uji **L01** persis
  bunyi brief hal. 13 di tingkat pembaca (suite, skenario L01): terbit
  p=0,78 di paket A; paket B tiba dengan angka berbeda; baris rekam +
  officialPicks + edisi terbit tetap 0,78; edisi terbaru = B; baris
  pick tidak berubah.
- **Cap panel kosong (F10):** `QuantPayload.sm_panel.batch_utc` kini
  `string | null`; halaman detail merender **"Waktu arsip tidak
  tersedia"** persis redaksi brief hal. 7 bila NULL (sebelumnya nilai
  null mengalir ke formatter tanggal → berisiko tanggal epoch). Ini
  perbaikan presentasi: 3.058 nilai NULL di paket **tidak** di-backfill —
  provenance arsip yang hilang tidak dapat direkonstruksi dengan jujur.

## Angka sebelum → sesudah (salinan produksi, jam beku 2026-11-24T08:45Z)

Bukti mentah: `tasks/pr2/evidence/{before,after}.json` + `ringkasan.md`
(probe `tasks/pr2/probe-ukur.ts`; salinan di `~/workspace/coding/pr2-staging-data/`,
integrity ok, live-run 9.367 = hitungan produksi).

**Settlement:** issued 9.367 · settled 3.021 · due **8.519 → 4.763** ·
cakupan **35,5% → 63,4%** · jatuh tempo pending **5.498 → 1.742**
(kompetisi berfeed — lag publikasi sumber, akan settle) · **tidak dapat
dinilai 3.756** (terminal, hitungan sendiri) · belum mulai 840 · menunggu
jendela 8 · batal 0. Rekonsiliasi persis: 9.367 = 3.021 + 0 + 840 + 8 +
1.742 + 3.756. Antrean konflik identitas tidak beririsan dengan populasi
jatuh tempo (0 baris dari 547 item antrean).

**Basis per kelas** (`claimed` ledgerStats → prob_slice cohort):

| Kelas | Sebelum (model) | Sesudah (terbit) | prob_n | gap sebelum | gap sesudah |
|---|---|---|---:|---:|---:|
| A | 0,8193 | 0,8127 | 217 | +0,4pp | −2,0pp |
| B | 0,7280 | 0,7205 | 212 | +1,5pp | +1,5pp |
| C | 0,6374 | 0,6237 | 103 | −2,8pp | −7,0pp |

`claimed` sesudah identik (< 1e-12) dengan `avg_published_prob` cohort
per kelas dan cocok digit-per-digit dengan angka basis-terbit PR 1A F3.

## Di luar lingkup — dengan alasan (bukan dikerjakan diam-diam)

- **Antrean identitas 547 open / 0 resolved (F9):** adjudikasi per item
  adalah kurasi data produksi (butuh keputusan per laga + tulisan ke
  produksi) — di luar mandat PR ini (tanpa tulisan produksi) dan irisan
  brief untuk PR 2 adalah kontrak *score basis/ID*, yang sudah diaudit
  PR 1A. Preseden alasan konflik di kode menjaga item antrean tidak
  salah kelas; irisan dengan populasi jatuh tempo saat ini 0.
- **Instrumentasi `available_at` saat ingest (daftar PROCEED PR 1A):**
  menyentuh jalur ingest + skema dataset; layak irisan sendiri.
  Ditunda, bukan dikerjakan setengah.
- **Catatan populasi manifest (A6, "dokumentasi PR 2/3"):** berada di
  wilayah model/manifest (aturan PR ini: tanpa perubahan quant/model);
  diteruskan ke PR 3.
- **`slipRecordStats` (tiket):** permukaan sebelah yang juga menghitung
  cakupan dari cohort mentah; tidak diklasifikasi ulang di PR ini
  (sentuhan bedah) — tercatat sebagai tindak lanjut bila diinginkan.

## Garpu kebijakan yang ditandai untuk keputusan Arandi

Klasifikasi terminal mengeluarkan pick tanpa-feed dari penyebut
cakupan (cakupan naik 35,5% → 63,4% tanpa satu pun hasil baru). Ini
arah brief (hal. 7: "dikeluarkan dari penyebut pending/cakupan,
ditampilkan sebagai hitungan sendiri") dan desain K2; alternatifnya —
membiarkannya selamanya di penyebut — membuat cakupan tidak pernah
bisa naik melewati ±35% dan menghukum permukaan atas kompetisi yang
memang tidak pernah dijanjikan feed-nya. Jumlahnya selalu tampil
sebagai hitungan sendiri, tidak disembunyikan. Keputusan final di
tangan Arandi saat merge.

## Suite (worktree pr2, semua di luar checkout utama)

- **Baru:** `tests/test-pr2-data-publikasi.ts` — **47/47** (basis
  tunggal per kelas, L01, klasifikasi terminal + rekonsiliasi,
  preseden konflik, kompetisi asing tidak ditebak, belum-jatuh-tempo
  bukan terminal, registri absen = perilaku lama). Dirantai ke
  `test:web` lewat package.json. Helpers: `tests/helpers/pr2-{seed,probe}.ts`.
- Hijau: tsc · lint:gate (91 ≤ 92) · test:quant · test:data
  (publication D05–D08 110/110 termasuk) · test:api 42/42 ·
  test:verifikasi 154 · test:lanjut 249 · test:e2e 7/7 · build
  (BUILD_ID `-A1OaLCAjnkBQZO2cmzS8`) · test:web semua suite hijau
  (test-web 12/12, ui 75/75, rekam 110/110, detail-render 27/27,
  fix6 25/25, redesain 35+54+63, jadwal-liga 27/27, stabilisasi 32/32,
  pr2 47/47) **kecuali** satu kegagalan di bawah.
- **Kegagalan pra-ada (bukan PR 2):** `test-beranda-pr1b` skenario
  cadangan — 2 assertion "hasil-terakhir" (34/36). Kontrol: suite yang
  sama pada worktree PR 1B (kode master murni) gagal **identik**
  (34/36, assertion yang sama) — skenario itu menanam laga selesai
  relatif terhadap jam asli proses dan jendelanya sudah bergeser sejak
  fixture ditulis pagi 24 Nov. Paritas pembaca lama-vs-baru di skenario
  itu tetap lolos ("hasil-terakhir identik" OK). Perbaikannya milik
  pemeliharaan fixture PR 1B, di luar irisan PR 2.

## Deviasi jujur

1. Satu fixture suite lama disesuaikan: `statsFabrikasi` di
   test-redesain-pilihan-rekam gains `unresolvable: 0` (konsekuensi
   mekanis penambahan field CohortStats). Tidak ada assertion diubah.
2. Aturan feed diperketat saat regresi: entri registri **tanpa alias
   sumber sama sekali** = `tidak-diketahui`, bukan `tanpa-feed`
   (fixture K7 menulis liga fiktif tanpa alias; produksi punya 0 liga
   seperti itu — hitungan produksi terverifikasi ulang tidak berubah:
   3.756).
3. Tidak ada migrasi data yang diperlukan: klasifikasi bersifat
   read-time dan pembekuan terbit tidak disentuh sama sekali
   (`published == effective` 1.562/1.562 tetap sakral; tidak ada baris
   ditulis ulang). "Bukti migrasi pada salinan" diwujudkan sebagai
   pengukuran sebelum/sesudah pada salinan dengan rekonsiliasi persis.
