# Catatan Rilis — Peningkatan Aplikasi Bola (K1–K7)

- **Kandidat:** rangkaian branch bertumpuk di atas basis `b9b3871`,
  tip kandidat `5d94d4c` (`prd/k7-pilihan-rekam`) + artefak penerimaan K8.
- **Status penerimaan:** SIAP RILIS (daftar periksa:
  `tasks/reports/k8-release-checklist.md`; laporan: `k8-penerimaan-rilis-report.md`).
- **Yang TIDAK termasuk rilis ini:** merge ke master, migrasi database
  produksi, dan deploy — ketiganya menunggu peninjauan pemilik atas hasil
  yang ter-deploy di domainnya (urutan pemilik: deploy → dilihat → merge).

## Isi rilis per kartu

- **K0 · CI & data contoh** (`prd/k0-ci-d01`, `f1a91ea`) — CI Node 24
  (lint terlihat, tsc, 4 suite + baseline D01, build); perintah tes stabil
  `test:quant|data|web|e2e`; baseline kegagalan D01 terekam jujur (0/2).
- **K1 · Identitas & hasil** (`prd/k1-identitas-hasil`, `5bd1d17`) —
  resolver identitas satu pintu (`lib/identity/fixture-resolver.ts`) untuk
  importer, builder alias, resolver hasil, dan adapter web; hasil menulis
  ke baris jangkar; koreksi berversi; piala dinilai dari 90 menit;
  cancelled → void. D01 menjadi regresi hijau wajib (2/2); D02–D04 lulus.
- **K2 · Publikasi & bukti** (`prd/k2-publikasi-bukti`, `4825877`) —
  publikasi dua fase (intent → paket → commit satu transaksi) dengan
  operation key stabil dan validasi cutoff **saat commit**; pilihan resmi
  beku (`published_prob` + basis + versi paket/model/kebijakan); odds hanya
  prematch ≤ keputusan; `cohortStats` — statistik dari sampel yang sama.
  D05–D08 lulus termasuk crash parsial dan retry paralel.
- **K3 · Tiket resmi** (`prd/k3-tiket-resmi`, `96f8baa`) — skema D4
  (`published_slips` + `slip_legs`); member hanya pilihan resmi yang belum
  kickoff; status final **ditahan sampai semua pilihan terminal**;
  peluang gabungan dari matriks skor (alias dihitung sekali; tanpa matriks
  → NULL beralasan); tumpang tindih tim ≤ 72 jam → rentang jujur. D09 lulus.
- **K4 · Model sama lab = produksi** (`prd/k4-model-paritas`, `4d6400a`) —
  manifest model berversi `data/model-manifest.json`
  (`2.0-dixon-coles-mle+kfit10+hl365+rho:zero+js2`, κ/kfit 10/10, latih
  73.412 laga / 84 liga / 2.088 tim, jendela 2024-01-01…2026-11-16) dibaca
  kedua jalur; fit bersama verbatim di `lib/quant/fit.ts` (selisih
  parameter 0,0); gerbang promosi menolak kandidat latih lebih kecil;
  refresh terbukti tidak mempromosikan diam-diam. Q01–Q04 lulus; paritas
  20 laga sampel Σ|Δp| = 0.
- **K5 · Eksperimen κ tersegel** (`prd/k5-eksperimen-kappa`, `15d47fa`) —
  desain dibekukan di commit `14dfff5` **sebelum** run. **Keputusan:
  RETAIN — κ-fit 10 dipertahankan.** Held-out H (n = 6.708 berpasangan,
  33 blok pekan): log-loss Level B kfit:10 = **1,0134** vs kfit:20 =
  **1,0142**; bootstrap Δ = **+0,00082** (UB satu sisi 95% **+0,00159**) →
  syarat manfaat aturan beku (Δ ≤ −0,005 dan UB < 0) gagal. Margin historis
  +0,0026 untuk kfit:20 **tidak tereproduksi** (dataset bertumbuh). Manifest
  aktif tidak berubah; tidak ada promosi.
- **K6 · Jadwal, beranda, detail** (`prd/k6-ui-jadwal`, `4be5610`) —
  pengelompokan per **tanggal lokal zona terpilih**; urutan kickoff →
  prioritas liga → nama → id; filter pulih dari query URL; 7 status
  berlabel Indonesia (cancelled tidak pernah menampilkan skor); detail
  memisahkan data langsung vs "Panel arsip"; copy glosarium PRD; desain
  Amber Panas tidak berubah. U01–U03 lulus; bukti overflow Chromium
  headless 9/9 bersih (320/390/768).
- **K7 · Pilihan & rekam** (`prd/k7-pilihan-rekam`, `5d94d4c`) — lapisan
  baca `lib/web/rekam.ts`: /pilihan dari pilihan resmi beku K2; /bukti dari
  `cohortStats` dengan klausa WHERE yang sama untuk daftar dan ringkasan
  (spot-check halaman vs SQL mentah identik); tiket resmi dirinci di
  `/bukti?tiket=<uid>`; blok lab historis terpisah tegas; keadaan kosong
  jujur ("Belum ada hasil", tanpa "0%" palsu). U04–U08 lulus; bukti
  peramban 88 OK / 0 gagal.

## Cakupan data saat rilis

- Sumber bebas: **22 divisi** football-data.co.uk; katalog 3.924 fixture
  (cakrawala s.d. 5 Jan 2027).
- Rehearsal migrasi pada salinan segar checkout VM (K8, angka deploy
  sebenarnya akan bergeser mengikuti data live saat deploy):
  - Identitas: 71.503 baris laga → **70.420 fixture**, 71.832 alias,
    70.279 revisi backfill.
  - Bukti terbit: 170.813 baris pilihan → **7.805** basis `effective`
    (baris live-run yang buktinya terselamatkan), **163.008**
    `unknown_legacy` (baris lab — tidak pernah terikat paket; tetap bisa
    dinilai tepat/meleset, keluar dari perbandingan probabilitas),
    468 baris tertanda duplikat.
- **32 konflik identitas terbuka** — semua `conflicting_scores`,
  `resolved_at` kosong, menunggu peninjauan pemilik. Sistem tidak menebak:
  baris terkait menunggu di antrean, bukan dipilih diam-diam.

## Utang & catatan yang diketahui

1. **Lint lama:** 92 error + 5 warning repo-wide, identik dengan basis
   `b9b3871`; nol di file K1–K7. Langkah lint CI sengaja terlihat (K0).
2. **Refresh-sync telemetri:** perbaikan di VPS belum masuk repo
   (`build-canonical-telemetry.ts` masih memuat seluruh tabel form
   sekaligus); menunggu patch/SHA tersanitasi dari pemilik;
   `ARCHITECTURE.md` §8/§10 belum disinkronkan. Catatan mandiri — bukan
   blokir rilis fitur.
3. **Anggaran performa (usulan bab QA) belum terpenuhi** pada VM
   pengukuran: jadwal 387–620 eksekusi SQL per request (usulan ≤ 8);
   `cohortStats` tanpa filter median 342,9 ms (usulan ≤ 100 ms). Baca
   statistik terfilter yang dipakai halaman berada di dalam usulan
   (live-run 28,8/39,5 ms; grade A 78,2/87,7 ms). Wajib: ukur ulang di
   hardware produksi sesudah deploy + kartu optimasi lanjutan (cache
   statement / gabung kueri per item).
4. **Uji kontrak HTTP 4 endpoint** (`app/api/*`) belum ada; cakupan
   adapter `lib/web/data.ts` ada di `test:web`. Route warisan, tidak
   diubah rangkaian ini.
5. **Pembaca form di DB telanjang:** tanpa langkah telemetri refresh,
   `team_match_logs_canonical` belum ada dan pembaca form lama melempar
   error — perilaku pra-rilis yang sama, dicatat di K6.
6. **Migrasi produksi + deploy belum dijalankan** — rehearsal membuktikan
   prosedur di salinan; angka produksi mengikuti data live saat deploy.

## Pemantauan pasca-rilis

Indikator dari bab QA (penghitung per tahap/provider) + usulan operasional
(ditandai †) yang dibaca dari artefak yang sudah ada:

- **Setiap siklus refresh (12 jam):** jumlah parsed / invalid / cocok /
  ambigu / final / pending jatuh tempo **beserta umur + alasan** per
  provider; pisahkan "nol yang memenuhi syarat" dari "provider gagal /
  input kedaluwarsa". Kegagalan satu langkah refresh = alarm.
- **Publikasi:** jumlah paket, pilihan resmi, tiket resmi per siklus; cap
  publikasi terakhir yang bisa dibaca UI tidak boleh lebih tua dari satu
  siklus refresh.†
- **Cakupan penilaian cohort:** dinilai / (dinilai + pending jatuh tempo)
  per grade dari `cohortStats`; penurunan tajam antar-siklus = alarm.†
  Garis dasar rehearsal: live-run dinilai 1.321 dari 7.805 terbit.
- **Antrean identitas:** jumlah terbuka (garis dasar **32**); pertumbuhan
  di luar konflik skor baru yang sah = periksa importer/registry.†
- **Kesehatan halaman:** /jadwal, /pilihan, /bukti, satu detail — respons
  200 + waktu respons; latensi statistik terfilter (garis dasar VM:
  live-run p95 39,5 ms — ukur ulang di VPS pada minggu pertama).†

**Bila memburuk** (mengikuti bab QA §Migrasi butir 5): hentikan promosi
penulis/model baru di konfigurasi rilis; kembalikan pembaca ke versi
kompatibel; pertahankan baris baru + histori terbit; rekonsiliasi operasi
tertunda (intent publikasi K2), bandingkan total, jalankan ulang smoke;
restore backup hanya lewat prosedur Rollback di bawah.

## Rollback (rencana deploy, dari rehearsal terukur K8)

Urutan rilis nanti: **backup pra-deploy di VPS US** (sqlite `.backup`
semua DB + snapshot kode) → verifikasi backup (integrity + jumlah) →
deploy kode kandidat (build sebelumnya dipertahankan) → migrasi K1 →
verifikasi angka → migrasi K2 → verifikasi angka → nyalakan app → smoke
5 rute → pantau dua siklus publikasi.

Titik keputusan: selisih angka verifikasi yang tidak bisa dijelaskan oleh
delta data live → **berhenti, jangan lanjut tahap berikutnya**.

Rollback: matikan app → pulihkan DB dari backup pra-deploy → deploy ulang
build sebelumnya → nyalakan → smoke. Baris yang terbit sah sesudah backup
akan hilang bila restore dilakukan — karena itu restore adalah langkah
terakhir sesudah opsi pembaca-kompatibel habis (sesuai bab QA).

Durasi (terukur di VM Hikari 1,5 CPU bersama; di VPS US 6 vCPU/16 GB
komponen CPU-bound diperkirakan lebih cepat — angka VPS adalah **perkiraan**,
bukan terukur):

| Langkah | Terukur (VM) | Catatan |
|---|---|---|
| Backup konsisten 4 DB (±3,2 GB) | ±31 dtk | dataset 29 dtk darinya |
| Migrasi K1 | 49 dtk | jalan 2 idempoten 16 dtk |
| Migrasi K2 | **762 dtk** | tiang terpanjang; diukur di bawah beban pemindaian integrity paralel → batas atas; rencanakan jendela ≥ 30 menit |
| Verifikasi integrity picks | ±100 dtk | full `integrity_check` dataset 3 GB: 810 dtk (jalankan di latar / terima quick_check + hitungan untuk gerbang waktu) |
| Restore DB + checkout rilis sebelumnya | ±3 dtk (cache hangat) – ±35 dtk | verifikasi sesudahnya mendominasi |
| Rollback ujung-ke-ujung (latihan K8) | **103 dtk** | di tingkat salinan, termasuk verifikasi picks |
| Build ulang app (bila perlu) | npm ci 28 dtk + build 59 dtk | terukur sesi K8 untuk kandidat |
