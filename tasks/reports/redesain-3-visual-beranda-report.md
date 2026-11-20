# Laporan Langkah 3 Redesain — Bahasa Visual + Beranda

**Branch** `redesain/bola` · **Basis** `c8db7a6` (tip Langkah 2) · **Acuan** brief §2, §3A, §5, §6, §8 baris 3; PDF lembar 1–2.
**Commit:** `f3684fd` (token + navigasi) dan commit beranda yang menyertai laporan ini.
**Bukti visual:** `tasks/reports/redesain-3-visual-beranda/` — `beranda-378.png`, `beranda-378-full.png`, `beranda-1440.png`, `detail-378.png` (hasil satu ketukan dari sorotan).

Ruang lingkup dipatuhi: logika Langkah 1–2 (identitas/status/render) tidak diubah; halaman jadwal/detail/pilihan/bukti tidak disusun ulang — hanya token global, navigasi bersama, dan wadah layout bersama yang berubah di langkah ini.

---

## 1. Token + global (§2)

- **Palet persis brief** diterapkan sebagai token bernama baru (`--color-kertas #F8F7F2`, `tinta #162723`, `sekunder #4E5B56`, `garis #CCD1C8`, `gelap #142C25`, `gelap-sekunder #C8D6C9`, `jingga #FF6935`, `jingga-teks #A63416`, `tepat #246241`, `meleset #9B3736`, `fokus #2855A4`) di `design-system/theme.css` + cermin `:root` di `app/globals.css`.
- **Nama token lama dipetakan ulang** ke palet baru (canvas→kertas, ink→tinta, mid-gray→sekunder, hairline→garis, accent→jingga, accent-deep→jingga-teks, accent-ink→tinta, sage→tepat, brick/ember→meleset) sehingga seluruh rute yang belum disusun ulang ikut terang tanpa perubahan markup.
- **Nada turunan** (dihitung dari palet, kontras terukur terhadap kertas): `ink-soft #33423B` 9,9:1; `faint #5F6F66` 4,9:1; `hairline-strong #7E8C84` 3,3:1 (memenuhi syarat batas kontrol ≥3:1 dari brief); permukaan `paper #FFFFFF`, `surface-alt #EFEDE3`, `well #E9E7DB`. Semua warna teks palet lulus ≥4,5:1 di atas kertas (tinta 14,5; sekunder 6,6; jingga-teks 6,3; tepat 6,8; meleset 6,5); teks tinta di atas tombol jingga 5,4:1; jam jingga di panel gelap 5,2:1.
- **Tipografi:** Barlow Condensed 700 (normal + miring) untuk judul, nama tim sorotan, wordmark — token `font-display` kini menunjuknya. Archivo 400/500/600/700 untuk isi, kontrol, daftar, dan angka; kelas `.tabular-nums` dan token `font-mono` kini memakai Archivo tabular (IBM Plex Mono dilepas dari layout). Keduanya self-host lewat `next/font/google` (pola yang sama seperti kandidat) dengan `display: "swap"`.
- **Fokus:** `:focus-visible` = outline 3 px `#2855A4`, offset 2 px; di dalam `.panel-gelap` outline memakai warna kertas.
- **Grid wadah:** isi maks 1240 px, margin 16 px (320–599), 24 px (600–1023), 32 px (≥1024) pada kepala, layout terminal, dan beranda.

## 2. Navigasi (`components/Nav.tsx`, `NavClient.tsx`)

- **Desktop:** wordmark **"Bola."** — Barlow Condensed tebal miring, titik jingga — di kiri; empat tautan (Beranda, Jadwal, Pilihan, Rekam hasil) di sebelahnya, aktif = teks tinta semibold + garis bawah jingga 3 px + `aria-current`; aksi **Cari tim** (ikon kaca pembesar SVG + teks) di kanan menuju `/pertandingan`. Semua target ≥44 px.
- **Ponsel:** wordmark + Cari tim di kepala; **navigasi bawah tetap**: 4 tujuan masing-masing ¼ lebar, tinggi ≥52 px + `env(safe-area-inset-bottom)`, aktif ditandai garis jingga di tepi atas sel + `aria-current` (persis lembar 2). Ruang bawah ditambahkan pada layout terminal dan footer beranda supaya konten terakhir tidak tertutup nav.
- Varian statis (fallback Suspense) dipertahankan untuk kedua permukaan.

## 3. Beranda (`app/page.tsx`, `lib/web/data.ts`, `lib/web/format.ts`)

Urutan sesuai §3A.1: kepala → **tanggal+zona** ("Sabtu, 21 November 2026 · WIB") → **judul dinamis** → panel sorotan + jadwal berikutnya (ponsel bertumpuk, desktop grid 7:5) → **rekam hasil ringkas** → footer.

- **Judul dinamis** — `judulBeranda(now, tz)` murni di `lib/web/format.ts`: jam lokal 18.00–05.59 → **"Malam ini"**, jam lain → **"Pertandingan hari ini"**. Diuji jam beku (lihat §5).
- **Pemilihan sorotan diganti** (§6 brief) — `todaySpotlight` (laga hari ini + tiga peluang payload) dihapus; penggantinya `sorotanBeranda(now)`:
  - Kandidat = laga mendatang terdekat pada jendela 72 jam (urut kickoff; seri → identitas kanonik) yang punya **pilihan RESMI terbit sebelum kickoff** (jalur K2: `pick_uid`, `published_at_utc < kickoff_utc`) lewat `getOfficialPicks` yang sama dengan detail.
  - Prediksi utama = **peluang terbit tertinggi** laga itu (seri: kelas, lalu pick_uid), dilabeli `labelPilihan` ("Persija Jakarta mencetak gol · 76,1% · Terbit 01.39 WIB" pada data uji — meniru contoh §3A.3). Peluang 1X2 lengkap tetap di detail.
  - **Tangga fallback persis brief:** tanpa prediksi resmi → laga terdekat + aksi "Lihat jadwal laga"; jendela kosong → laga pertama sesudah jendela dengan tanggal eksplisit, atau hasil terakhir yang benar-benar tersedia (skor 90 menit + "Lihat rekam hasil"); keduanya kosong → keadaan kosong yang jujur.
- **Jadwal berikutnya** — `jadwalBerikutnya(sorotan, now, 5)`: baris jam-kiri (±56 px), dua nama klub, kompetisi, chevron; seluruh baris satu tautan ber-`aria-label` lengkap; **pemisah tanggal muncul saat melewati tengah malam**; laga sorotan **dikeluarkan memakai identitas fisik** (fixture_uid K1 / kelompok sibling) supaya kembar lintas providernya tidak tampil lagi.
- **Rekam ringkas** memakai sumber yang sama persis dengan /bukti (`ambilRekam` filter baku → `cohortStats`): "3 dari 5 pilihan tepat — 60% dari pilihan yang sudah dinilai, mencakup 2 laga" + "Cakupan penilaian: 5 dari 7 pilihan yang jatuh tempo sudah dinilai · 71,4%" + batang cakupan + tautan "Lihat rekam hasil". Satu sampel, satu penyebut.
- **Scene 3D/animasi keluar dari beranda:** `HeroScene`, `DataBall3D`, `Reveal` dihapus — pemanggil satu-satunya adalah beranda (d
...[truncated 2705 chars]