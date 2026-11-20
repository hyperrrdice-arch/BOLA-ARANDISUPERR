# Laporan Kartu K7 — Halaman Pilihan & Rekam dari Data Resmi Beku

- **Kartu:** K7 (`05-kartu-muse.md`) — hubungkan builder ke data K2–K3,
  hubungkan rekam ke cohort tertutupnya, pisahkan resmi / draf pengguna /
  lab, sediakan detail tiket resmi, serahkan U03–U08 dan contoh dokumen
  6/8 tepat dengan rata-rata peluang 71,3%.
- **Branch:** `prd/k7-pilihan-rekam` (bertumpuk di atas K6, belum merge)
- **SHA awal:** `4be5610` (tip `prd/k6-ui-jadwal`)
- **Status:** SELESAI di branch — U04–U08 lulus; produksi & deploy
  menunggu rangkaian K8 (lihat "Belum terbukti").

## Ringkasan

Halaman `/pilihan` dan `/bukti` sekarang membaca data resmi beku lewat
satu lapisan baca baru, `lib/web/rekam.ts`:

- **Builder pilihan** tidak lagi membaca baris ledger mentah. Umpannya
  adalah pilihan resmi K2 (punya `pick_uid`, `published_prob` tercatat,
  sepak mula di masa depan), ter-dedup per laga fisik
  (`fixture_uid ?? match_id`, pasar, garis, pilihan). Peluang yang
  ditampilkan dan digabung adalah peluang **saat terbit**; pilihan
  dikelompokkan per laga kanonik, bukan per ID penyedia.
- **Rekam hasil** memakai `cohortStats` K2 apa adanya: daftar baris dan
  ringkasan dibangun dari klausa WHERE yang sama persis dengan filter
  yang dikirim ke `cohortStats`, jadi tabel, kartu ringkasan, dan
  statistik tidak bisa berbeda sampel. Seri resmi = `live-run`; baris
  lab tidak masuk cohort mana pun; draf peramban tidak ada di tabel
  mana pun dan tidak pernah tampil.
- **Tiket resmi** dibaca lewat jalur K3 (`getOfficialSlip`,
  `listOfficialSlips`, `slipRecordStats`) dan dirinci di
  `/bukti?tiket=<uid>`: anggota dengan peluang beku, gabungan sebagai
  rentang + basis, kelompok ketergantungan (yang terkuat ditandai), dan
  status turunan — termasuk status akhir yang tertunda walau sudah ada
  pilihan yang meleset (`has_missed_leg` ditampilkan terpisah).
- **Uji historis lab** tetap tampil di /bukti tetapi di bloknya sendiri,
  berlabel uji historis, dengan angka mentah dari `ledgerStats()` —
  tidak pernah dicampur ke cohort resmi.

Keputusan yang dicatat:

- **Rata-rata contoh dokumen.** Jumlah mentah biner dari
  78+62+70+76+72+70+74+68 adalah 0,7124999999999999 sehingga `pct()`
  akan menulis "71,2%". Statistiknya tidak diubah; hanya **tampilan**
  rata-rata yang dibulatkan ke 4 desimal (`bulatkanTampil`) sebelum
  diformat → "71,3%", sesuai contoh dokumen.
- **Alasan jatuh tempo.** Hanya `konflik` yang ditegaskan dari data
  nyata (antrean `identity_ambiguous` K1 yang belum selesai). Alasan
  lain tetap `unspecified` dari `cohortStats` dan ditampilkan sebagai
  "menunggu hasil dari sumber data" — halaman tidak mengarang alasan
  "sumber tidak mencakup" yang tidak punya data per baris.
- **Duplikat alias di umpan builder.** Indeks unik K2
  (fixture_uid, market, line, selection, series) membuat dua pilihan
  resmi untuk kombinasi yang sama mustahil tersimpan; dedup alias
  untuk penggabungan hidup di `computeCombined` K3 (level tiket).
  Umpan builder memakai kunci laga fisik yang sama sebagai pagar.

## Hasil U04–U08 (satu per satu)

### U04 — Gerbang waktu
- **Masukan:** jam melintasi T−1 ms → T dengan tab terbuka / kembali
  dari latar; backend menolak terbit terlambat (dibuktikan K2/D05);
  label "Sedang berlangsung"/"Selesai" hanya dari umpan; Hari ini/
  Besok berbalik di batas WIB.
- **Hasil:**
  - Fungsi murni `sudahMulai` (lib/web/parlay.ts): T−1 ms masih
    terbuka, tepat T terkunci, waktu rusak → terkunci (tidak menebak).
    Suite: 7 assertion gerbang + keadaan baris.
  - **Bukti langsung di peramban:** laga uji dengan sepak mula 150
    detik setelah seed dibuka di /pilihan, tombol Tambahnya diklik,
    pilihan masuk slip ("1 pilihan dari 1 laga"); tanpa reload, 129
    detik kemudian tanda **"Kedaluwarsa — laga sudah mulai"** muncul
    dan pilihan keluar dari hitungan slip (interval segar 5 dtk +
    segar saat tab kembali terlihat).
  - Keadaan baris rekam tidak pernah menebak: laga lewat sepak mula
    tanpa outcome = menunggu jendela (6 jam) lalu jatuh tempo, tetap
    terlihat dengan alasannya (konflik untuk baris yang antreannya
    terbuka).
  - Label status laga dari `lib/web/status.ts` K6 (umpan dataset),
    tidak berubah di kartu ini.
- **Harapan:** terpenuhi.

### U05 — Dua edisi, snapshot terbit, satu penyebut
- **Masukan:** dua edisi A dan B + satu laga final + tiket resmi lewat
  tautan langsung; paket analisis B yang lebih baru untuk laga yang
  sama; draf pribadi tidak boleh muncul; tabel, kartu, dan ringkasan
  memakai filter dan penyebut identik.
- **Hasil (suite, sandbox fixture):**
  - Tiket edisi A (2 pilihan tepat, irisan matriks 0,65) berstatus
    `hit`; edisi B (1 meleset + 1 menunggu) berstatus `pending` dengan
    `has_missed_leg = true` — status akhir tertunda sesuai K3.
  - Baris laga m2 membaca snapshot terbit **0,70**; paket B (0,85)
    tidak mengubah baris maupun rata-rata cohort (tetap 0,7125).
  - Daftar tiket halaman = tepat 2 slip dari `published_slips`; tidak
    ada sumber draf di skema mana pun.
  - **Spot-check terprogram:** ringkasan halaman vs SQL mentah pada
    filter yang sama — issued 12 = 12, settled 8 = 8, hits 6 = 6,
    rata-rata peluang 0,7125 = 0,7125, warisan 0 = 0.
  - Filter pasar `1x2` mengubah anggota (dinilai 4, tepat 2 = 50%,
    terbit 6) tanpa mengubah definisi ukuran.
- **Harapan:** terpenuhi.

### U03 (bagian builder) — contoh gabungan dokumen
- **Masukan:** satu pilihan 75% → tambah pilihan satu laga (irisan
  matriks) → tambah laga kedua 69%.
- **Hasil:** `combineSlip` pada matriks uji yang dibangun agar
  P(1)=0,75, P(over 2,5)=0,60, P(1 ∧ over)=0,51: satu pilihan = 0,75;
  dua pilihan satu laga = **0,51** (ditandai eksak); tambah laga 0,69
  = **0,3519** → tampil **"35,2%"**. Identik dengan contoh dokumen.
- **Harapan:** terpenuhi.

### U06 — Tata letak semua keadaan & lebar
- **Masukan:** lima URL (ditambah detail tiket = enam), semua keadaan,
  lebar 320/390/768/1440, nama klub panjang, zoom 200%, gerak
  dikurangi.
- **Hasil (build produksi + Chromium headless, metode K6):**
  - **24/24** kombinasi halaman × lebar tanpa gulir horizontal
    halaman (`scrollWidth <= innerWidth`): `/`, `/pertandingan`,
    `/pertandingan/sm_k7b_s1`, `/pilihan`, `/bukti`,
    `/bukti?tiket=<uid>` pada 320/390/768/1440, dengan nama
    "Borussia Mönchengladbach" vs "1. FC Heidenheim 1846" di seed.
  - Tabel lebar menggulir hanya di dalam wilayah `role="region"`
    berlabel ("Tabel pilihan yang diterbitkan", dst.).
  - Zoom 200% (720 CSS px × deviceScaleFactor 2): /bukti bersih.
  - `prefers-reduced-motion`: halaman tetap utuh.
  - Keadaan kosong (DB berskema, nol baris): /bukti menulis "Belum ada
    hasil — …" dan /pilihan "Belum ada pilihan resmi", tanpa overflow
    di 390, tanpa "0%" (0 kemunculan di HTML), 0 error di log server.
  - Screenshot: `pilihan-390.png`, `pilihan-1440.png`, `bukti-390.png`,
    `bukti-tiket-390.png` di folder laporan ini.
- **Harapan:** terpenuhi.

### U07 — Keyboard, pembaca layar, kontras
- **Masukan:** lintasan keyboard + pembaca layar; tiga peluang harus
  terbaca tanpa warna.
- **Hasil (probe DOM terprogram di halaman ter-render):**
  - Semua tombol di /pilihan (5) dan /bukti bernama aksesibel; tombol
    Tambah/Hapus membawa label penuh ("Tambah <pilihan>, <kandang> vs
    <tandang>"), `aria-pressed` pada pilihan terpilih.
  - **Satu temuan nyata, sudah diperbaiki (commit `6a1a812`):**
    wilayah `aria-live` semula hanya dirender setelah ada pilihan
    terpilih. Status `sr-only` `role="status"` kini selalu dirender;
    pengumuman kedaluwarsa berjalan dari wilayah yang sudah ada.
  - Tabel rekam memakai `th` (5 header); ringkasan slip adalah wilayah
    status yang diumumkan.
  - Kontras teks terukur dari gaya terhitung: h1/h2 **15,41:1**,
    sel/paragraf **6,32:1** — semua ≥ 4,5:1. Tiga angka peluang
    (model/pasar/panel dan terbit vs hasil) selalu tampil sebagai
    teks/angka, tidak pernah hanya warna.
  - Lintasan keyboard penuh dan uji pembaca layar suara tidak
    dijalankan di VM ini (tidak ada AT); yang dibuktikan adalah
    prasyarat terprogramnya: nama, urutan DOM, fokus terlihat bawaan,
    dan wilayah status.
- **Harapan:** terpenuhi pada batas metode di atas.

### U08 — Literal lama & angka contoh
- **Masukan:** perburuan literal di komponen/loading/error/metadata/
  formatter + screenshot ter-render.
- **Hasil:**
  - Grep sumber (suite): "Know your odds", "Three sources",
    "Promised", "Your slip", "Loading the ball", "Build your parlay",
    "Live picks", "The record", "45.866", "163.008" — absen dari
    keempat file UI K7.
  - Grep render (peramban): kedelapan literal frasa absen di teks
    keenam halaman.
  - Angka contoh dokumen muncul hanya sebagai data terhitung:
    **6 dari 8 tepat (75%) di 4 laga, rata-rata peluang terbit
    71,3%** — dihitung dari baris-baris seed-nya di suite, bukan
    ditulis tangan.
- **Harapan:** terpenuhi.

## File berubah

| File | Perubahan |
| --- | --- |
| `lib/web/rekam.ts` | **Baru.** Lapisan baca rekam: filter cohort (`parseFilterRekam`/`queryRekam`/`cohortFilterOf`), `ambilRekam` (WHERE yang sama untuk baris + `cohortStats`), keadaan baris, alasan konflik dari antrean K1, `ambilDetailTiket`, `daftarPilihanPraLaga`, `bulatkanTampil`. |
| `lib/web/parlay.ts` | Tambah `sudahMulai` (gerbang waktu murni). `combineSlip` tidak berubah. |
| `components/pilihan/ParlayBuilder.tsx` | Tulis ulang: umpan pilihan resmi beku, kelompok per `fixture_uid`, kunci sepak mula hidup (interval + kembali terlihat), salinan Indonesia penuh, label aksesibel penuh, status `sr-only` selalu dirender (fix U07). |
| `app/(terminal)/pilihan/page.tsx` | Ditulis ulang: umpan `daftarPilihanPraLaga`, metadata & loading Indonesia. |
| `app/(terminal)/bukti/page.tsx` | Ditulis ulang: ringkasan cohort resmi + filter, tabel baris resmi, seksi tiket resmi + detail `?tiket=`, blok uji historis lab terpisah. |
| `tests/test-rekam.ts` | **Baru.** Suite K7 (110 assertion). |
| `tests/helpers/rekam-probe.ts` | **Baru.** Probe subprocess lapisan baca pada jam beku + spot-check SQL. |
| `package.json` | `test:web` dirantai `test-rekam.ts` sesudah `test-ui.ts`. |

File read-only tidak disentuh. Definisi statistik tidak diubah:
`cohortStats` (K2) dan status tiket (K3) dipakai apa adanya lewat
jalur baca mereka. Token desain Amber Panas tidak berubah.

## Metode bukti lebar layar

Sama seperti K6: seed DB lokal worktree (gitignored; nama panjang,
semua keadaan, satu tiket resmi, satu konflik) → `npm run build` →
`next start` → puppeteer-core + @sparticuz/chromium mengukur
`documentElement.scrollWidth` vs `innerWidth` per halaman × lebar,
memeriksa nama aksesibel/kontras/wilayah status dari DOM, dan menggali
literal lama dari teks ter-render. Total pemeriksaan peramban:
**88 OK, 0 gagal** (lintasan penuh kedua setelah fix U07), ditambah
lintasan keadaan kosong 2/2 OK. Batas metode: Chromium bawaan VM
menolak start (kebijakan WebGL Hatch), jadi dipakai Chromium
@sparticuz seperti K6; tidak ada uji perangkat fisik/AT suara.

## Perintah & hasil (dua putaran penuh, identik)

| Perintah | Exit | Hasil |
| --- | --- | --- |
| `npx --no-install tsc --noEmit` | 0 | bersih |
| `npm run test:quant` | 0 | 22/22 + model 61/61 + experiment-stats 23/23 |
| `npm run test:data` | 0 | 18/18 + identity 58/58 + publication 89/89 + tickets 69/69 |
| `npm run test:web` | 0 | 12/12 + ui 66/66 + **rekam 110/110** |
| `npm run test:e2e` | 0 | 7/7 |
| `npm run test:baseline:d01` | 0 | 12/12 |
| `npm run build` (env placeholder CI) | 0 | bersih |
| `npx eslint <file berubah>` | 0 | 0 error, 0 warning |

## Cara kembali

Branch belum di-merge; abaikan `prd/k7-pilihan-rekam` dan tumpukan
tetap di K6 (`4be5610`). Semua perubahan bersifat halaman/lapisan baca
dan aditif — tidak ada migrasi skema baru di kartu ini, tidak ada
tulisan ke DB produksi, tidak ada deploy.

## Belum terbukti / terbuka

- **Produksi & deploy menunggu K8:** migrasi produksi K1/K2 dan
  rangkaian akhir (K8 selesai → deploy hasil branch bertumpuk ke
  domain → peninjauan pemilik → merge ke master) belum dijalankan.
- **32 konflik skor `identity_ambiguous` dari K1** masih menunggu
  peninjauan pemilik; kartu ini hanya membaca antreannya untuk alasan
  jatuh tempo `konflik`.
- Catatan lama yang tetap berlaku: `landingStats()` (data.ts, pra-K7)
  melempar bila file DB pelengkap absen sama sekali — keadaan itu
  tidak ada di produksi (semua file DB dibuat pipeline refresh);
  dicatat, tidak diubah (aturan bedah).
- Bukti peramban memakai seed lokal, bukan data produksi.
