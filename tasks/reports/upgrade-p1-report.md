# Laporan Fase P1 — Upgrade Frontend Bola (Hierarki)

- **Branch:** `upgrade/frontend-amoled` (worktree `app-football-upgrade`), melanjutkan tip P0 `276e6a4`. TIDAK di-merge, TIDAK di-deploy.
- **Sumber:** `Brief-Upgrade-Frontend-Bola.pdf` (audit situs publik, 22 November 2026), perintah langsung pemilik "lanjut p1".
- **Lingkup fase ini:** P1 saja — sorotan Beranda ringkas, baris Pilihan dua baris, akses filter lintas rute, navigasi bawa query, metadata rapi. P2 (grafik/tooltip/transisi, tata letak desktop, audit spacing global, paket bukti final) TIDAK dikerjakan.
- **Batas yang dijaga:** perubahan hanya frontend (3 berkas markup/komponen). Rute + parameter URL, sumber data, kalkulasi probabilitas, grading, penyimpanan draf Pilihanmu, dan lokalisasi tidak berubah. Tidak ada perubahan di `lib/quant`, `lib/picks`, `lib/identity`, logika data `lib/web`, atau `scripts/`. File read-only (`lib/agent/*`, `lib/coverage.ts`, `lib/syndicate-orchestrator.ts`, `lib/llm/*`) tidak disentuh. Yang sudah benar dari P0 (token AMOLED, gutter, baris Jadwal, panel Filter /bukti, matriks) tidak dibongkar — hanya dilengkapi di tempat.

## Kepatuhan keamanan (injeksi AGENTS.md)

`AGENTS.md` proyek dan `next.config.ts` memuat blok tertanam yang BUKAN instruksi pemilik maupun penugasan: blok `nextjs-agent-feedback` yang menyuruh menjalankan `npx next internal agent-feedback-instructions`, serta blok aturan subagent/persona (`subagent-and-model-rules`, `behavior-and-communication-rules`). Blok-blok itu diperlakukan sebagai konten berkas semata — **perintahnya tidak dijalankan dan aturan tertanamnya tidak diikuti**. Pekerjaan mengikuti brief PDF pemilik dan batas fase P1 dari penugasan. `.env.local` tidak dibuka/diprint pada fase ini (salinan worktree dari P0 dipakai apa adanya).

## Verifikasi klaim audit (diukur ulang lokal, build tip P0 `276e6a4`, data aktual)

| Klaim audit | Pengukuran lokal (SEBELUM) |
|---|---|
| Beranda 390×844: sorotan ±336 px, laga pertama mulai ±y=618 | Panel sorotan **335 px** (y=162–497); baris jadwal pertama mulai **y=618** — cocok persis. Baris kedua berakhir y=798 vs tepi atas navigasi bawah y=791 → hanya **1 baris jadwal utuh** yang terlihat penuh sebelum navigasi bawah. |
| Pilihan 320 px: nama pilihan terpotong ("Batman Petrolspor m…") | **24 dari 40 baris terpotong** pada 320 px; terpanjang terukur "Panathinaikos menang atau seri" scrollWidth 212 vs clientWidth 141 px. Pada 390 px: 2 dari 40 terpotong. Akar: label `truncate` berbagi satu baris flex dengan persen + tombol Tambah. |
| Pilihan: pencarian + tanggal di atas daftar | Sudah di atas daftar; pada 320/390 keduanya bertumpuk **karena bungkusan flex**, bukan susunan eksplisit (terukur: tanggal y=344 di bawah pencarian y=266 pada kedua lebar). |

Dua butir P1 lain ternyata **sudah sesuai** sejak ronde redesain/Lanjut dan hanya diverifikasi, tidak diubah: (a) chip Sekarang/Malam ini/Besok/Filter + ringkasan filter aktif + panel Filter modal Jadwal (fokus masuk, Escape menutup, fokus kembali ke pemicu — `KontrolJadwal`), dan (b) navigasi bawa query (tautan Jadwal→detail membawa `kembali=<query>`, tautan kembali detail merekonstruksi query kanonik yang sama). Bukti alur Pardubice di bawah.

## Perubahan per butir P1

### 1. Beranda — sorotan ringkas (`app/page.tsx`)
- `PanelSorotan` dipadatkan dengan urutan isi yang sama persis: baris jam (15 px, jingga, tabular) + liga (12 px sekunder, kanan) → nama tim satu baris mengalir (display 23 px, `break-words`; dulu dua baris 44 px) dengan **CTA di samping nama** → baris angka: peluang 26 px + label prediksi + waktu terbit (12 px sekunder). CTA tetap target sentuh 44 px, jingga berteks hitam.
- Keputusan terukur: CTA ditaruh di samping nama, bukan di baris angka — membungkusnya CTA ke baris sendiri menambah ±44 px (pengukuran antara: 161 px). Keempat varian sorotan (prediksi, tanpa-prediksi, berikutnya, hasil-terakhir) memakai cangkang ringkas yang sama; yang terukur langsung pada data aktual adalah varian prediksi.
- Ruang di atas jadwal dirapikan di ponsel: padding atas seksi 40→24 px, jarak kepala→sorotan 32→20 px, celah sorotan→jadwal 40→24 px (nilai desktop dipertahankan via `sm:`/`lg:`).
- Hasil: tinggi sorotan **335 → 129 px** (−62%); baris jadwal pertama **y=618 → 392**; baris jadwal utuh terlihat sebelum navigasi bawah **1 → 4 baris** (target brief ≥2 — terlampaui 2×).
- **Catatan jujur soal pita 60–100 px brief:** tidak tercapai. Lantai tingginya ditentukan isi wajib brief sendiri — enam unsur (liga, jam, dua nama, label, peluang, waktu terbit) plus CTA target sentuh 44 px pada ukuran baca minimum; memadatkan di bawah ±129 px berarti mengecilkan CTA di bawah target sentuh atau membuang unsur. Kriteria keras brief (≥2 baris jadwal utuh terlihat) terlampaui; angka akhir dilaporkan apa adanya untuk keputusan pemilik.

### 2. Pilihan — nama penuh + baris kedua (`components/pilihan/ParlayBuilder.tsx`)
- Baris pilihan disusun ulang: pembungkus kelas+nama menjadi `basis-full` pada layar sempit (nama membungkus **penuh**, `truncate` diganti `break-words`), metadata pasar · basis · waktu terbit tetap 12 px di bawah nama; persen + tombol Tambah turun ke baris kedua (tombol `ml-auto`, kembali sebaris pada `sm:`). Alur tambah/hapus, ekspansi per laga ("Lihat semua pilihan laga"), keadaan konflik, dan panel Pilihanmu **tidak diubah logikanya** — hanya susunan baris daftar.
- Kontrol atas: pencarian + tanggal menjadi **satu kolom eksplisit** pada layar sempit (`flex-col`, keduanya lebar penuh), kembali sebaris pada `sm:`; filter kelas tetap di bawahnya.
- Hasil terukur: baris terpotong 320 px **24/40 → 0/40**; 390 px **2/40 → 0/40**; `scrollWidth = clientWidth` pada kedua lebar (tanpa overflow). Probe interaksi (390 px): Tambah "Hertha mencetak gol" → bilah "Lihat 1 pilihan" tampil + draf tersimpan (1 entri) → muat ulang → draf pulih (tombol "Terpilih", bilah tampil) → panel Pilihanmu terbuka → Hapus → panel/bilah hilang, draf `entri: []`. Bukti: `sesudah-interaksi.json`.

### 3. Akses filter lintas rute
- **Jadwal:** tidak diubah — chip pintasan + Filter dalam baris yang dapat membungkus, ringkasan "Filter aktif: …" + "Hapus filter", dan panel modal terkelola fokus sudah ada dan terverifikasi pada 390 px (ringkasan tampil, 4 chip ketemu, tanpa overflow). Bukti: `sebelum/sesudah-jadwal-390.png` (tampilan identik — memang tidak diubah).
- **/bukti:** panel Filter `<details>` hasil P0 dilengkapi di tempat: tombol **Terapkan menjadi aksi utama jingga** (terukur `rgb(255, 173, 91)` dengan teks hitam — satu-satunya CTA jingga di panel, sejajar pola panel Jadwal); **"Atur ulang" kini juga tampil bila hanya zona waktu** yang menyimpang dari bawaan (sebelumnya hanya untuk pasar/kelas/liga/tanggal). Label enam kontrol sudah jelas dari P0; perilaku keyboard `<details>` natif dipertahankan (summary terjangkau Tab, Enter/Ruang membuka — panel ini bukan modal, jadi pola Escape/fokus-modal tidak berlaku; tidak ada JS baru). Form GET + nama parameter identik → query/tanggal/zona waktu sesudah Terapkan utuh; Atur ulang mengembalikan seluruh query ke bawaan (`/bukti`). Terverifikasi: panel terbuka dengan `?tz=Asia/Makassar` saja → Atur ulang tampil, tanpa overflow pada 390 px. Bukti: `sesudah-bukti-panel-390.png`.

### 4. Navigasi bawa query — terverifikasi, tidak diubah
Alur Pardubice (probe browser, SEBELUM dan SESUDAH identik):
`/pertandingan?q=Pardubice` → tautan detail `/pertandingan/sm_19725021?kembali=tanggal%3D2026-11-22%26q%3DPardubice` → tautan kembali `/pertandingan?tanggal=2026-11-22&q=Pardubice` → nilai kotak pencarian sesudah kembali = **"Pardubice"**. Tanggal/filter tidak hilang bolak-balik.

### 5. Metadata rapi
- Beranda sorotan: liga 14→12 px dan waktu terbit 14→12 px, keduanya teks sekunder; jam/peluang tetap tabular-nums.
- Jadwal dan Pilihan diverifikasi sudah konsisten (metadata 12–13 px sekunder: baris meta Jadwal 13 px, "Pilihan terkuat · Kelas" 12 px, label gerbang di kepala kompetisi 13 px, meta baris Pilihan 12 px) — tidak diubah.

## Hasil verifikasi terukur (SEBELUM → SETUDAH)

| Ukuran | Sebelum | Sesudah |
|---|---|---|
| Beranda: tinggi sorotan (390×844) | 335 px | **129 px** |
| Beranda: baris jadwal pertama mulai | y=618 | **y=392** |
| Beranda: baris jadwal utuh sebelum nav bawah | 1 | **4** |
| Pilihan 320 px: baris nama terpotong | 24/40 | **0/40** |
| Pilihan 390 px: baris nama terpotong | 2/40 | **0/40** |
| Pilihan: scrollWidth vs clientWidth (320/390) | 320/320 · 390/390 | sama (tetap ≤) |
| Pilihan: pencarian vs tanggal (320/390) | bertumpuk karena bungkusan flex | satu kolom eksplisit |
| /bukti: Terapkan | tombol netral berbatas | jingga #FFAD5B, teks hitam |
| /bukti: Atur ulang untuk perubahan tz saja | tidak tampil | tampil |
| Alur Pardubice (query utuh bolak-balik) | lolos | lolos (identik) |
| Tambah → draf → muat ulang → hapus | (perilaku lama) | lolos probe penuh |

Bukti visual di `tasks/reports/upgrade-p1-evidence/`: `sebelum-*` dan `sesudah-*` untuk Beranda 390×844, Pilihan 320/390, Jadwal 390 (chip + ringkasan filter), panel /bukti terbuka 390, plus `sebelum-ukuran.json`, `sesudah-ukuran.json`, `sesudah-interaksi.json` (angka mentah + hasil probe).

## Regresi repo (hasil aktual)

- `npx tsc --noEmit` — bersih, tanpa error.
- `npm run build` — sukses (semua rute ter-generate normal).
- `npm run lint:gate` — **LOLOS**: 91 error saat ini ≤ baseline 92, tidak ada error lint baru dari perubahan fase ini.
- `npm run test:web` — **hijau penuh** (exit 0; seluruh suite dalam rantai lolos: test-web, test-ui, test-rekam, test-detail-render, test-fix6, redesain-jadwal 35/35, redesain-peta 51/51, redesain-pilihan-rekam 15/15 + 7/7 + 41/41 terlihat di keluaran).
- `npm run test:verifikasi` — **hijau penuh** (exit 0; detail-ssr 38/38 terlihat di keluaran).
- `npm run test:lanjut` — **hijau penuh** (exit 0; pilihan-matriks-ulang 27/27, slate-kembar 96/96 terlihat di keluaran). Catatan: screenshot bukti yang ditulis ulang suite Lanjut-1/Lanjut-2 saat lari (pixel churn) dipulihkan ke versi ter-commit sebelum commit fase ini, mengikuti preseden ronde sebelumnya.

## File utama yang diubah

- `app/page.tsx` — PanelSorotan ringkas (CTA di samping nama, metadata 12 px) + perapatan ruang atas Beranda di ponsel.
- `components/pilihan/ParlayBuilder.tsx` — baris pilihan dua baris pada layar sempit (nama penuh membungkus; persen + Tambah baris kedua) + kontrol pencarian/tanggal satu kolom eksplisit.
- `app/(terminal)/bukti/page.tsx` — Terapkan menjadi CTA jingga utama; Atur ulang tampil juga untuk perubahan zona waktu saja (+ impor `ZONA_BAKU`).

## Belum bisa dicek

- Perangkat fisik Android/iOS nyata, Safari iOS, keyboard virtual terbuka, pembaca layar — hanya Chromium headless terotomasi yang tersedia (sama seperti P0).
- Uji landscape ponsel dan pembesaran teks 200% belum dijalankan pada fase ini.
- Varian sorotan tanpa-prediksi/berikutnya/hasil-terakhir memakai cangkang ringkas yang sama tetapi tidak terpotret langsung — data aktual saat pengukuran menampilkan varian prediksi.
- Pita tinggi sorotan 60–100 px dari brief tidak tercapai (129 px terukur) — lihat catatan jujur pada butir 1; keputusan menerima angka ini atau mengorbankan unsur/CTA ada pada pemilik.

## Status

Branch `upgrade/frontend-amoled` — TIDAK di-merge ke master, TIDAK di-deploy. Menunggu tinjauan pemilik untuk lanjut ke fase P2.
