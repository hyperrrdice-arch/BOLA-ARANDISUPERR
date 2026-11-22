# Laporan Fase P2 — Upgrade Frontend Bola (AMOLED)

Fase terakhir brief `Brief-Upgrade-Frontend-Bola.pdf` (bagian P2 +
kriteria penerimaan hal. 6). Branch `upgrade/frontend-amoled` dari
P1 `3ee0263`. Build terverifikasi: `9suBbclv0m_WMuOrgwyTm`.
Bukti: `tasks/reports/upgrade-p2-evidence/` (28 PNG + 3 JSON +
`indeks-bukti.md` yang merangkum bukti P0/P1/P2).
Basis perbandingan "sebelum": build master `cb979eb` (tema terang).

**Kepatuhan injeksi:** `AGENTS.md` proyek + `next.config.ts` memuat
blok "nextjs-agent-feedback" (perintah menjalankan
`npx next internal agent-feedback-instructions`) dan blok aturan
subagent/persona. Keduanya diperlakukan sebagai konten berkas,
BUKAN instruksi: tidak dijalankan, tidak diikuti. Pekerjaan mengikuti
brief pemilik dan batas fase ini saja. `.env.local` tidak dibuka.

---

## 1. Grafik + tooltip setara gelap

Audit seluruh permukaan bergrafik:

- **Tidak ada** komponen grafik SVG/canvas kustom ber-warna hardcoded
  selain peta skor: batang cakupan Beranda memakai token (`bg-garis` /
  `bg-tinta`); "Uji historis" di Rekam hasil adalah TABEL, bukan
  grafik; baris peluang detail berupa grid angka token; FormChips,
  titik GateStatus, GradeMark semuanya token dengan kontras
  terdokumentasi di tema (Tepat #79DFA7, aksen #FFAD5B, Meleset
  #FF8A75, faint #9A9AA3 7,5:1 terhadap panel).
- **Tooltip:** aplikasi tidak punya komponen tooltip kustom — hanya
  atribut `title=` bawaan (FormChips). Tooltip bawaan dirender OS,
  tidak bisa diberi gaya dari CSS; dicatat sebagai temuan paritas
  (bukan cacat yang bisa diperbaiki dari frontend).
- **Peta skor 2D** (`heatStyle`): sudah dipetakan P0; kontras teks sel
  minimum terukur ulang lewat suite: **4,93:1** (≥4,5:1).
- **Peta skor 3D** (`components/detail/PetaSkor3D.tsx`) — 7 literal
  palet terang lama diganti ke konstanta palet gelap yang sama,
  perilaku 3D (satu InstancedMesh, kamera ortho, langkah putar ±32°,
  raycast, DPR ≤1,5, render-on-change) TIDAK berubah:

  | Unsur | Sebelum | Sesudah (= token) |
  |---|---|---|
  | Latar renderer | `#142c25` | `#0D0D0F` (panel) |
  | Lantai | `#1a332a` | `#17171B` (surface-alt) |
  | Kisi | `0x3e5c4e` | `0x28282C` (pemisah) |
  | Batang | `#8fb996` | `#FFAD5B` (aksen; penggelapan 0,45+0,55t dipertahankan) |
  | Batang tersaring | `#33503f` | `#4A3A28` (jingga diredupkan, ±½ luminansi batang dalam-filter terdingin) |
  | Batang terpilih | `#ff6935` | `#FFAD5B` (aksen penuh) + tepi `#F5F5F7` (tinta) |
  | Teks sprite sumbu | `#c8d6c9` | `#A3A3AB` (sekunder; ±7,3:1 di atas lantai) |

  Bukti visual: `sesudah-matriks-3d-390.png`. Catatan: batang
  terpilih dan batang peluang-tertinggi kini sama-sama aksen penuh —
  pembedanya adalah tepi tinta + bacaan teks di kepala panel, sesuai
  kontrak lama "warna saja tidak cukup" (sama seperti 2D yang memakai
  cincin, bukan warna berbeda).

## 2. Transisi ringan + hormati kurangi gerak

- Token gerak diseragamkan di `app/globals.css`: `--ease-ui:
  cubic-bezier(0.22, 0.72, 0.2, 1)` (kurva yang sudah dipakai animasi
  masuk + indikator tab + WAAPI peta), `--duration-fast: 120ms`,
  `--duration-panel: 210ms`; `--duration-micro: 160ms` dan
  `--duration-layout: 280ms` sudah ada. Kelas keyframe
  (grup/ringkasan/panel masuk) kini merujuk token, bukan literal.
- Bawaan transisi Tailwind diarahkan ke token lewat `@theme`
  (`--default-transition-duration: var(--duration-micro)`,
  `--default-transition-timing-function: var(--ease-ui)`) — semua
  utilitas `transition-*` tanpa durasi/easing eksplisit ikut seragam.
- Kelas eksplisit dimigrasikan: indikator TabRekam (sebelumnya literal
  `160ms` + bezier mentah), chevron panel filter Bukti, CTA Beranda,
  tautan Nav/NavClient (sebelumnya `duration-150` + kurva bawaan
  Tailwind `cubic-bezier(0.4, 0, 0.2, 1)`).
- **Terukur sesudah** (computed style): CTA Beranda, tautan nav bawah,
  indikator tab — semuanya `0.16s` + `cubic-bezier(0.22, 0.72, 0.2, 1)`
  (CTA sebelum: `0.15s` + `cubic-bezier(0.4, 0, 0.2, 1)`).
- **Kurangi gerak:** override global yang ada (semua animasi/transisi
  → 0,01 ms di bawah `prefers-reduced-motion`) terverifikasi lewat
  emulasi: durasi animasi sampel = `1e-05s`. Animasi baca WAAPI peta
  dan tween rotasi 3D sudah menghormati status kurangi gerak dari
  fase sebelumnya; tombol "Kurangi gerak" pada panel peta tetap ada.
  Tidak ada animasi dekoratif baru.

## 3. Tata letak desktop

- Kontainer: `max-w-[1240px]` → **`max-w-[1200px]`** di 4 titik
  (main terminal, header Nav, 2 seksi Beranda). Terukur di 1440:
  lebar main = 1200 px, gutter 32 px. Gutter per lebar sudah dari P0
  (12/16/24/32).
- Navigasi: header tampil dan nav bawah nonaktif terverifikasi di
  768, 1024, dan 1440 (probe: nav header `static` tampil, nav bawah
  `fixed` tidak tampil) — keempat tujuan + "Cari tim" muat di header
  sejak 768.
- Ringkasan dua kolom: Beranda sudah `lg:grid-cols-[7fr_5fr]` +
  RekamRingkas `lg:grid-cols-2`; ringkasan Rekam hasil berdampingan;
  form filter Bukti terukur **2 kolom di 768** dan 3 kolom di ≥1024
  (di dalam panel); Pilihan sudah punya kolom pendamping 340 px
  di ≥1024.
- **Keputusan yang dicatat:** (a) halaman detail TIDAK diberi kolom
  pendamping — satu alur baca dipertahankan dan panel matriks sudah
  selebar kontainer; brief menandai kolom pendamping sebagai
  opsional. (b) Filter tetap berbentuk panel (Jadwal: lembar modal;
  Bukti: `<details>`) juga di desktop, demi manajemen fokus yang
  konsisten; di dalam panel kontrol sudah tersusun berpasangan/
  berkolom. Tabel responsif brief bersifat "titik awal".

## 4. Audit utilitas jarak bernomor (peta `--spacing-*` warisan)

Metode: inventarisasi semua utilitas bernomor yang jatuh ke peta
warisan (`--spacing-{4,8,12,16,20,24,48}` = N px, bukan 4N px),
lalu ukur dampaknya per lokasi di browser. Peta warisan ternyata
adalah **sistem satuan desain yang benar-benar dipakai** redesain +
P0 + P1 (nilai-nilainya yang terverifikasi visual: mt-16 = 16 px
antar-seksi, dst.). Refactor global DILARANG brief dan tidak
dilakukan. Hasil per lokasi:

**Diperbaiki (terbukti salah ukuran — isi meluap dari kotaknya):**

| Lokasi | Sebelum (terukur) | Sesudah |
|---|---|---|
| GradeMark baris Pilihan (`ParlayBuilder.tsx`) `w-4` | kotak 4 px, glif 8 px (clientWidth 4 < scrollWidth 8) | `w-[16px]` → 16 = 16 px |
| Nomor daftar skor teratas (`PetaSkor.tsx`) `w-4` | kotak 4 px, glif "1." 11 px (4 < 11) | `w-[16px]` → 16 = 16 px |

Pola cacatnya sama dengan temuan P0 (`w-12` sel matriks): kotak
berukuran kritis yang menyusut karena peta warisan.

**Terverifikasi cukup (tidak diubah):** spacer `h-24` (24 px) di
Pilihan — kebutuhan ruang = bilah ringkasan 61 px + nav bawah 53 px
= 114 px; ruang tersedia = padding bawah layout 92 px + spacer
24 px = **116 px ≥ 114 px**; terukur di 320: baris terakhir TIDAK
tertutup bilah tetap.

**Didokumentasikan sebagai peta dampak (tidak diubah, dengan alasan):**

| Utilitas | Nilai render | Penilaian |
|---|---|---|
| `p-4` panel PetaSkor & panel filter Bukti | 4 px | Bahasa panel konsisten; menaikkan padding PetaSkor ke 16 px menyempitkan ruang matriks di 320 (sisa 264 < tabel 276 px) → memunculkan scroll lokal yang tidak ada di keadaan terverifikasi P0. Bukan pelanggaran kriteria. |
| `px-4` panel sorotan Beranda | 4 px | Tata letak terverifikasi P1 (tinggi 129 px); mengubahnya menggeser baris nama+CTA terukur. |
| `gap-12` grid dua kolom detail & Beranda | 12 px | Tampilan desktop yang disetujui pada ronde redesain; rapat tapi terbaca, bukan cacat terukur. |
| `mt-16`/`py-16`/`mt-8`/`gap-4` dst. (±70 pemakaian) | 16/16/8/4 px | Satuan desain aktual aplikasi; mengubahnya = mendesain ulang, di luar mandat bedah. |

Sisa risiko: peta warisan tetap ada; pengembang berikutnya harus
tahu bahwa utilitas bernomor TIDAK mengikuti skala Tailwind baku —
sudah diperingatkan komentar di `theme.css` sejak P0, dan daftar ini
menjadi peta dampak resminya.

## 5. Sel ter-filter matriks (catatan P0)

`opacity-40` diganti fungsi khusus **`heatStyleRedup`** di
`components/ui.tsx`: latar mempertahankan rampa panas dengan alfa
diskala ×0,38, teks memakai tinta lunak `#DCDCE1` di semua sel
tersaring; sel terpilih tidak pernah diredupkan.

| Keadaan | Kontras efektif sebelum | Sesudah |
|---|---|---|
| Sel tersaring terpanas (1–1, 12,7%) | **2,06:1** (terukur browser) | **6,21:1** (terukur browser) |
| Sel tersaring dingin | 2,36–3,58:1 (terhitung) | 14,02:1 (terukur browser) |
| Minimum seluruh rentang (suite) | — | **6,21:1** ≥ 4,5:1 |

Asersi baru di `tests/test-redesain-peta.ts` (suite 54/54): warna
teks redup, skala alfa 0,361 di sel terpanas, dan sapuan kontras
≥4,5:1 di seluruh rentang. Bukti visual: `sesudah-matriks-aktif-390.png`
(filter "Tamu": sel tersaring cokelat redup, teks tetap terbaca).

## 6. Perbaikan keuletan teks 200% (dari uji penerimaan)

Tiga `flex-wrap` bedah — tidak aktif pada lebar brief mana pun
(≥320 px tanpa zoom), hanya menyelamatkan lebar ekstrem (±195 px
efektif pada zoom 200%): baris nama+CTA sorotan Beranda, grup
pintasan waktu Jadwal, baris sub-pilihan pada baris Jadwal. Hasil
emulasi di §7.

---

## 7. Kriteria penerimaan brief — satu per satu

Probe: Chromium headless, data lokal sama; JSON lengkap di
`upgrade-p2-evidence/penerimaan-sesudah.json` + `ukur-*.json`.

| Kriteria | Hasil |
|---|---|
| Reflow 5 rute × 320/360/390/430/768/1024/1440, root scrollWidth ≤ clientWidth | **LULUS 35/35** (semua kombinasi persis sama) |
| Landscape ponsel | **LULUS** — Jadwal + Beranda 844×390: 844 = 844 |
| Pembesaran teks 200% | **SEBAGIAN — emulasi** (lihat catatan di bawah) |
| Nama panjang: Bohemians 1905 vs Viktoria Plzeň + status tertunda | **LULUS** — kedua nama + "Menunggu pembaruan pertandingan" utuh di baris 320 px |
| Nama panjang: Hồng Lĩnh Hà Tĩnh vs Công An Hồ Chí Minh | **LULUS** — kedua nama + 86,8% terbaca, lebar baris 296 px di 320 |
| Tab "Batal" terlihat di 320 | **LULUS** — tepi kanan x=86 ≤ 320 |
| Keadaan: memuat | Ada — fallback Suspense "Memuat jadwal…" + bilah muat mono; tidak difoto terpisah (tidak deterministik di headless) |
| Keadaan: kosong | **LULUS** — "Tidak ada laga yang cocok dengan filter ini…" (foto `sesudah-keadaan-kosong-390.png`) |
| Keadaan: error | **LULUS** — "Pertandingan tidak ditemukan — Alamat ini tidak menunjuk pertandingan mana pun…" (foto `sesudah-keadaan-error-390.png`) |
| Keadaan: tertunda | **LULUS** — detail Bohemians: "Menunggu pembaruan pertandingan" |
| Keadaan: tidak ada analisis | **LULUS** — "Analisis belum tersedia untuk laga ini…" pada detail tanpa paket |
| Keadaan: laga selesai | **LULUS** — detail Hà Tĩnh vs Hải Phòng menampilkan skor akhir + "Selesai" |
| Mode 2D/3D | **LULUS** — keduanya dirender; 3D memakai palet baru (foto) |
| Navigasi sel matriks via keyboard | **LULUS** — fokus 1–1 → PanahKanan 1–2 → PanahBawah 2–2 |
| Kurangi gerak | **LULUS** — emulasi `prefers-reduced-motion`: durasi animasi 0,01 ms; WAAPI + tween 3D menghormati status |
| Alur Pardubice (cari → detail → kembali) | **LULUS** — kembali ke `?q=Pardubice`, nilai cari pulih |
| Paket bukti visual final + indeks ronde | **LULUS** — 28 PNG + 3 JSON + `indeks-bukti.md` |

**Catatan teks 200% (emulasi, jujur apa adanya):** zoom keyboard
tidak bekerja di Chromium headless, jadi dipakai zoom CSS 2× pada
`<html>`. Pada viewport 780 emulasi ini cacat metode (media query
tidak ikut menyusut, nav desktop tetap aktif) — bukan perilaku zoom
peramban asli. Pada viewport 390 (efektif ±195 px CSS, di bawah
lebar minimum brief 320): Rekam hasil lulus penuh (scrollWidth =
clientWidth; tabel Uji historis bergeser lokal di dalam
`overflow-x-auto` sesuai desain), Beranda lulus penuh sesudah
perbaikan §6, Jadwal menyisakan scrollWidth 415 vs 390 — luapan
±12 px CSS dari konten min-content pada font ganda. Di bawah metode
yang sama, master jauh lebih buruk (Jadwal 562, Bukti 666, Beranda
397): arah perbaikan konsisten di semua rute. Sisa luapan Jadwal
dicatat sebagai sisa risiko, bukan disembunyikan.

## 8. Regresi repo (aktual, build final)

| Pemeriksaan | Hasil |
|---|---|
| `npm run lint` | 91 error + 8 warning = baseline repo (tidak bertambah) |
| `npm run lint:gate` | **LOLOS** (91 ≤ 92; satu aturan menyusut) |
| `npx tsc --noEmit` | Bersih |
| `test:quant` | 138/138 |
| `test:data` | 278/278 |
| `test:web` | Semua hijau (web 12, ui 75, rekam 110, detail-render 27, fix6 25, redesain-jadwal 35, redesain-peta **54** — termasuk 3 asersi redup baru, pilihan-rekam 15+7+41) |
| `test:api` | 42/42 |
| `test:e2e` | 7/7 |
| `test:baseline:d01` | 12/12 |
| `test:verifikasi` | 154/154 |
| `test:lanjut` | 176/176 |
| `npm run build` | Sukses — BUILD_ID `9suBbclv0m_WMuOrgwyTm` |

PNG bukti suite Lanjut-1/2 yang berubah piksel karena lari tes
dipulihkan ke versi ter-commit (preseden P1) — bukan perubahan kode.

## 9. Sisa risiko & yang belum bisa dicek

- Perangkat fisik, Safari iOS asli, pembaca layar: tidak bisa dicek
  di lingkungan ini (sama seperti P0/P1).
- Teks 200%: sisa luapan ±12 px CSS pada Jadwal di lebar efektif
  ±195 px (di bawah rentang brief) — lihat §7.
- Tooltip bawaan OS tidak mengikuti tema (tidak ada tooltip kustom
  di aplikasi).
- Peta `--spacing-*` warisan tetap menjadi sistem satuan aplikasi;
  peta dampaknya di §4. Refactor global tetap pekerjaan terpisah
  bila pemilik menghendaki.
- Dua penyimpangan sadar dari tabel responsif brief (titik awal):
  filter tetap panel di desktop; detail tanpa kolom pendamping —
  alasan di §3.
- Keadaan "memuat" tidak difoto deterministik; fallback-nya ada dan
  ter-render di HTML awal.

## 10. Vonis kesiapan merge

**SIAP MERGE menurut bukti.** Seluruh kriteria penerimaan brief
yang terukur lulus (reflow 35/35, kontras sel tersaring 2,06 →
6,21:1, kontainer desktop 1200, transisi seragam terukur, regresi
penuh hijau tanpa satu pun kegagalan). Yang tersisa adalah catatan
dokumentasi (teks 200% di bawah rentang brief, tooltip OS, peta
jarak warisan) — bukan kegagalan kriteria. Keputusan merge/deploy
tetap di tangan pemilik; fase ini tidak menggabungkan dan tidak
menyebarkan apa pun.
