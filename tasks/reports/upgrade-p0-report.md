# Laporan Fase P0 — Upgrade Frontend Bola (AMOLED)

- **Branch:** `upgrade/frontend-amoled` dari master `cb979eb` (worktree `app-football-upgrade`)
- **Sumber:** `Brief-Upgrade-Frontend-Bola.pdf` (audit situs publik, 22 November 2026), perintah langsung pemilik "kerjain der"
- **Lingkup fase ini:** P0 saja — fondasi token gelap + shell/gutter, Jadwal, Rekam hasil, matriks detail. P1 (hierarki: ringkas sorotan Beranda, judul Pilihan, akses filter Jadwal) dan P2 (penyetaraan grafik/tooltip/transisi, tata letak desktop) TIDAK dikerjakan.
- **Batas yang dijaga:** perubahan hanya frontend. Rute + parameter URL, sumber data, kalkulasi probabilitas, grading, penyimpanan draf Pilihanmu, dan lokalisasi tidak berubah. Tidak ada perubahan di `lib/quant`, `lib/picks`, `lib/identity`, logika data `lib/web`, atau `scripts/`. File read-only (`lib/agent/*`, `lib/coverage.ts`, `lib/syndicate-orchestrator.ts`, `lib/llm/*`) tidak disentuh.

## Kepatuhan keamanan (injeksi AGENTS.md)

`AGENTS.md` proyek dan `next.config.ts` memuat blok tertanam yang BUKAN instruksi pemilik maupun penugasan: blok `nextjs-agent-feedback` yang menyuruh menjalankan `npx next internal agent-feedback-instructions`, serta blok aturan subagent/persona (`subagent-and-model-rules`, `behavior-and-communication-rules`). Sesuai peringatan penugasan: blok-blok itu diperlakukan sebagai konten berkas semata — **perintahnya tidak dijalankan dan aturan tertanamnya tidak diikuti**. Pekerjaan mengikuti brief PDF pemilik dan batas fase P0 dari penugasan. `.env.local` disalin antar-worktree tanpa dibuka/diprint.

## Verifikasi klaim audit (diukur ulang lokal, build master `cb979eb`, data aktual)

Semua angka viewport/kontras di brief adalah klaim audit; keempatnya **terkonfirmasi** pada build lokal master sebelum perubahan:

| Klaim audit | Pengukuran lokal (SEBELUM) |
|---|---|
| Gutter konten 4 px (`px-4` → `--spacing-4:4px`) | `getComputedStyle(main).paddingLeft = "4px"`; `--spacing-4: 4px` terbaca di `design-system/theme.css`. Mekanisme terukur: utilitas bernomor yang ada di peta `--spacing-*` (4/8/12/16/20/24/48) bernilai N px — `w-12` = 12 px, `mt-12` = 12 px, `gap-4` = 4 px, `p-4` = 4 px; nomor di luar peta jatuh ke `calc(var(--spacing) * N)` (`h-11` = 44 px). |
| Jadwal 320 px: status mendesak nama tim; baris Bohemians 1905 vs Viktoria Plzeň ±351 px | Baris **350,5 px**; kolom nama terdesak sampai **35 px**; label status "Menunggu pembaruan pertandingan" selebar **213 px duduk sejajar nama** (kolom `shrink-0`); nama pecah nyaris per suku kata (tangkapan layar `sebelum-jadwal-plzen-320.png`). |
| Rekam hasil 320 px: tab "Batal" berakhir x=333, lebar dokumen 333 px; enam kontrol memenuhi layar | `scrollWidth = 333` vs `clientWidth = 320`; tepi kanan tab Batal tepat **x=333**, tidak terlihat penuh; form filter permanen setinggi **336 px**, ringkasan periode baru mulai di y=680. |
| Detail: sel 2D ±12×44 px; teks sel 7,6% kontras ±2,5:1 | Sel tepat **12×44 px** (akar: `w-12` terpetakan ke `--spacing-12:12px`); teks persen **meluap di 25/25 sel** (scrollWidth teks 28–36 px vs clientWidth 12 px); kontras minimum terukur **2,34:1**, 6 dari 25 sel di bawah 4,5:1. |

## Perubahan per butir P0

### 1. Sistem token gelap AMOLED + shell
- `design-system/theme.css`: seluruh token warna diganti ke palet brief — kanvas/kertas `#000000`, panel (`paper`/`gelap`) `#0D0D0F`, teks utama (`tinta`/`ink`) `#F5F5F7`, sekunder `#A3A3AB`, aksen (`jingga`/`accent`) `#FFAD5B`, `accent-ink` `#000000` (CTA jingga berteks hitam), pemisah (`garis`/`hairline`) `#28282C`, batas kontrol (`hairline-strong`) `#74747B`, Tepat (`tepat`/`sage`) `#79DFA7`, Meleset (`meleset`/`brick`/`ember`) `#FF8A75`, fokus `#FFAD5B`. Nama token lama dipertahankan dan dipetakan ulang (strategi redesain), jadi seluruh rute ikut gelap tanpa menulis ulang markup. Nada turunan dihitung dan terukur terhadap kanvas: `ink-soft #DCDCE1` (13,4:1), `faint #9A9AA3` (7,5:1 — metadata 12–13 px tetap ≥4,5:1), `surface-alt #17171B`, `well #1D1D22`.
- Radius panel mengikuti brief: `--radius-md 10px`, `--radius-lg/--radius-xl 12px`.
- `app/globals.css`: cermin variabel diperbarui; `color-scheme: dark` sejak render awal; `html { background: #000 }` (kanvas hitam sejak frame pertama, termasuk fallback Suspense/`PageLoading` yang memakai variabel yang sama); garis fokus menjadi **2 px** warna aksi di semua permukaan; warna scrollbar digelapkan.
- Peran ganda token warisan diselesaikan di markup, bukan dengan toggle: `kertas` dulu berarti latar terang sekaligus teks terang di atas panel gelap. Sekarang `bg-kertas` = kanvas hitam (badan, navigasi bawah, lembar ParlayBuilder), dan teks terang di atas panel memakai `text-tinta` — dimigrasikan di `PetaSkor`, `PetaSkor3D`, `ParlayBuilder`, panel sorotan Beranda; CTA `bg-jingga` yang dulu berpasangan `text-tinta` (dulu = tinta gelap) kini `text-accent-ink` (hitam) di Beranda + `PetaSkor`; status aktif pil di `PetaSkor` menjadi `bg-tinta text-accent-ink`.
- Navigasi bawah: tidak diubah strukturnya — 4 tujuan, label, `aria-current`, garis aktif jingga + tebal (state selain warna), safe-area, dan ruang bawah konten `calc(52px + safe-area + 2.5rem)` dipertahankan; warnanya mengikuti token baru.
- Tipografi tidak berubah (Barlow Condensed 700 wordmark/judul, Archivo isi, `tabular-nums`) — sudah sesuai brief.

### 2. Gutter shell khusus
- Token `--gutter` baru di `app/globals.css` + kelas `.shell-x`: **12 px** (320–359), **16 px** (360–767), **24 px** (768–1023), **32 px** (≥1024). Diterapkan pada `main` layout terminal, wadah kepala (`Nav`), dan dua wadah shell Beranda (seksi utama + footer), menggantikan `px-4 min-[600px]:px-6 lg:px-8`.
- Peta `--spacing-*` warisan **sengaja tidak diubah nilainya** di P0: peta itu sudah menjadi asumsi visual banyak komponen (mengubahnya membalik ratusan utilitas sekaligus). Brief sendiri memerintahkan token gutter khusus + audit utilitas bernomor sebagai langkah tersendiri; peringatan mekanisme ini sekarang tertulis di `theme.css` agar tidak menjebak pekerjaan berikutnya. Kontainer desktop `max-w-[1240px]` dipertahankan (kontainer 1200 px penuh = P2).

### 3. Jadwal `/pertandingan`
- `BarisJadwal` disusun ulang: baris pertama = jam/skor + nama tim (kolom `min-w-0 flex-1`) + peluang% & kelas di kanan; **status dan ringkasan model turun ke baris kedua** yang berdiri sendiri (indent sejajar kolom nama, 72/80 px). Label status ("Menunggu pembaruan pertandingan", "Selesai", "Sedang berlangsung") tampil sebagai baris sendiri; teks meta lama (Ditunda/Dibatalkan/Dihentikan/leg terkuat/"Belum ada analisis") dipertahankan sebagai baris berikutnya. Label ganda lama (status muncul dua kali untuk live/finished) dirapikan: satu label status per baris.
- Keterangan "Pilihan terkuat · Kelas X" dipindah dari bawah persen ke baris kedua: sebagai keterangan ia melebar kolom kanan ±130 px dan memangkas kolom nama di 320 px sampai kata terpanjang tidak muat utuh.
- Hasil terukur (Bohemians 1905 vs Viktoria Plzeň, status tertunda): tinggi baris 320 px **350,5 → 165 px**; 390 px **164,5 → 114 px**; status tidak lagi sejajar nama di semua lebar; **kata pecah di tengah = 0** pada 320/360/390 (deteksi Range per kata: kata yang terbelah menghasilkan >1 rect — tidak ada), pembungkusan murni di batas kata ("Bohemians / 1905 vs / Viktoria / Plzeň" pada 320). Nama tetap `break-words` + `min-w-0` — dengan kolom yang tidak lagi terdesak, kata terpanjang lokal (Bohemians = 87,7 px) muat utuh pada kolom 104 px.

### 4. Rekam hasil `/bukti`
- Form filter permanen dipindah ke **panel Filter**: elemen `<details>` server-render (tanpa JS baru) dengan tombol "Filter" (target 44 px, batas kontrol `#74747B`, penanda jumlah filter aktif, panah berputar). Isi panel = enam kontrol yang sama persis (pasar, kelas, liga, rentang tanggal, zona waktu) sebagai form GET `action="/bukti"` dengan nama parameter identik — perilaku kirim/URL tidak berubah; kontrol ditumpuk 1 kolom pada 320, 2 kolom sm, 3 kolom lg, semua `w-full min-w-0` agar panel terbuka pun tidak meluap. Batas kontrol diganti ke token batas kontrol brief (`border-hairline-strong`). Urutan halaman menjadi: periode → tombol Filter → Ringkasan periode → tab → daftar (ringkasan naik dari y=680 ke **y=388** pada 320).
- `TabRekam`: tablist kini `flex-wrap` — tab "Batal" terlihat penuh di 320 (tepi kanan **x=333 → 86**, terbungkus ke baris kedua bersama hitungannya); penanda aktif diukur dari `offsetTop + offsetHeight` tombol aktif sehingga mengikuti baris tab yang aktif saat terbungkus, bukan selalu dasar wadah.
- Overflow hilang di sumbernya: `scrollWidth = clientWidth` pada 320/360/390 (sebelumnya 333/320 pada 320).

### 5. Detail laga — matriks skor 2D
- Grid diukur ulang di `PetaSkor`: sel tombol **44×44 px eksplisit** (`h-[44px] w-[44px]`, kolom kepala disamakan) — kelas `w-12` ditinggalkan karena terpetakan ke 12 px oleh peta spacing warisan. Pada data aktual (Erzurumspor FK vs Göztepe, matriks 5×5) seluruh grid muat tanpa scroll lokal pada 320 maupun 390; wadah `overflow-x-auto` tetap ada untuk matriks yang lebih lebar. Teks persen tidak lagi meluap (0/25 sel).
- `heatStyle` ditulis ulang untuk panel `#0D0D0F` + jingga `#FFAD5B`: rampa alfa kontinu punya zona mati terukur (pada alfa ±0,58 teks terang maupun gelap hanya ±4,4:1), jadi alfa dua segmen — u≤0,5: alfa 0→0,53 teks `#F5F5F7`; u>0,5: alfa 0,62→0,95 teks `#000000` (u = (p/maks)^0,72, kurva persepsi lama). Kontras minimum desain di seluruh rentang **4,92:1** (dihitung), dan terukur pada 25 sel aktual: **minimum 5,21:1, 0 sel di bawah 4,5:1** (sebelumnya minimum 2,34:1, 6 sel di bawah).
- Cincin sel terpilih kini memakai warna teks sel itu sendiri (dari `heatStyle`) sebagai `boxShadow inset` — penanda pilihan mewarisi kontras ≥4,5:1 yang sama di sel gelap maupun terang (sebelumnya cincin `#F8F7F2` tetap, ±1,9:1 di atas sel terpanas).
- Legenda ikut diukur: teks sumbu/keterangan `gelap-sekunder #A3A3AB` di atas panel `#0D0D0F` = **7,75:1**; teks sekunder yang sama di atas kanvas = 8,38:1.

#### Tabel kontras per sel (SETUDAH, Erzurumspor FK vs Göztepe, 390 px; komposit di atas panel #0D0D0F)

| Sel | Teks | Warna teks | Kontras |
|---|---|---|---|
| 0-0 | 11,1% | rgb(0, 0, 0) | 8.29:1 |
| 0-1 | 14,3% | rgb(0, 0, 0) | 10.33:1 |
| 0-2 | 11,7% | rgb(0, 0, 0) | 8.65:1 |
| 0-3 | 5,9% | rgb(0, 0, 0) | 5.21:1 |
| 0-4 | 2,3% | rgb(245, 245, 247) | 9.71:1 |
| 1-0 | 6,7% | rgb(0, 0, 0) | 5.67:1 |
| 1-1 | 12,9% | rgb(0, 0, 0) | 9.46:1 |
| 1-2 | 9% | rgb(0, 0, 0) | 6.99:1 |
| 1-3 | 4,6% | rgb(245, 245, 247) | 5.81:1 |
| 1-4 | 1,7% | rgb(245, 245, 247) | 11.18:1 |
| 2-0 | 3% | rgb(245, 245, 247) | 8.15:1 |
| 2-1 | 4,6% | rgb(245, 245, 247) | 5.81:1 |
| 2-2 | 3,5% | rgb(245, 245, 247) | 7.31:1 |
| 2-3 | 1,8% | rgb(245, 245, 247) | 11.03:1 |
| 2-4 | 0,7% | rgb(245, 245, 247) | 14.67:1 |
| 3-0 | 0,8% | rgb(245, 245, 247) | 14.29:1 |
| 3-1 | 1,2% | rgb(245, 245, 247) | 12.84:1 |
| 3-2 | 0,9% | rgb(245, 245, 247) | 13.82:1 |
| 3-3 | 0,5% | rgb(245, 245, 247) | 15.52:1 |
| 3-4 | 0,2% | rgb(245, 245, 247) | 16.84:1 |
| 4-0 | 0,1% | rgb(245, 245, 247) | 16.91:1 |
| 4-1 | 0,2% | rgb(245, 245, 247) | 16.52:1 |
| 4-2 | 0,2% | rgb(245, 245, 247) | 16.84:1 |
| 4-3 | <0,1% | rgb(245, 245, 247) | 17.23:1 |
| 4-4 | <0,1% | rgb(245, 245, 247) | 17.49:1 |

## Hasil verifikasi terukur (SEBELUM → SETUDAH)

| Ukuran | Sebelum | Sesudah |
|---|---|---|
| Gutter konten 320 / 390 px | 4 px / 4 px | 12 px / 16 px |
| Jadwal: scrollWidth vs clientWidth (320/360/390) | 320/320 · 360/360 · 390/390 | sama (tetap ≤) |
| Baris Bohemians–Plzeň 320 px | 350,5 px, nama 35 px, status sejajar | 165 px, nama 104 px, status baris sendiri |
| Baris Bohemians–Plzeň 390 px | 164,5 px | 114 px |
| Kata pecah di tengah (320/360/390) | ya (kolom 35 px) | 0 kata |
| Bukti: scrollWidth 320 px | 333 (> clientWidth 320) | 320 (= clientWidth) |
| Bukti: tab Batal terlihat penuh 320 px | tidak (kanan x=333) | ya (kanan x=86, terbungkus) |
| Bukti: ringkasan mulai (320 px) | y=680 (form permanen 336 px) | y=388 (panel Filter tertutup) |
| Detail: ukuran sel matriks | 12×44 px | 44×44 px |
| Detail: teks sel meluap | 25/25 sel | 0/25 sel |
| Detail: kontras teks sel minimum | 2,34:1 (6 sel <4,5) | 5,21:1 (0 sel <4,5) |
| Detail: panel matriks | `rgb(20, 44, 37)` (#142C25) | `rgb(13, 13, 15)` (#0D0D0F) |

Bukti visual di `tasks/reports/upgrade-p0-evidence/`: `sebelum-*` dan `sesudah-*` untuk Jadwal (320/360/390 + klip baris Plzeň), Rekam hasil (320/360/390), Detail + matriks (320/390), plus `sebelum-ukuran.json`, `sesudah-ukuran.json`, `sebelum-jadwal-plzen.json`, `sesudah-jadwal-plzen.json` (angka mentah pengukuran).

## Regresi repo (hasil aktual)

- `npx tsc --noEmit` — bersih, tanpa error.
- `npm run build` — sukses (rute statis/PPR/dinamis ter-generate normal).
- `npm run lint` — 91 error + 8 warning; ini baseline lama repo (bukan nol). `npm run lint:gate` — **LOLOS**: 91 error saat ini ≤ baseline 92, tidak ada error lint baru dari perubahan fase ini (berkas yang diubah: 0 error).
- `npm run test:web` — **hijau penuh**: test-web 12/12 · test-ui 75/75 · test-rekam 110/110 · test-detail-render 27/27 · test-fix6 25/25 · redesain-jadwal 35/35 · redesain-peta 51/51 · redesain-pilihan-rekam 15/15 + 7/7 + 41/41.
  - Catatan migrasi uji: 3 asersi palet di `tests/test-redesain-peta.ts` mengikat palet redesain lama (`#FF6935`/`#162723`/`#F8F7F2`) dan gagal pada lari pertama — ketiganya diperbarui ke kontrak palet AMOLED brief upgrade (`#FFAD5B`/hitam/`#F5F5F7`), ditambah 1 asersi baru yang menghitung kontras `heatStyle` di seluruh rentang dan menuntut ≥4,5:1 (terukur 4,92:1). Ini migrasi kontrak desain mengikuti brief pemilik baru, bukan pelonggaran gerbang.
- `npm run test:verifikasi` — **hijau penuh 154/154**: genclerbirligi 39/39 · marseille-detail 36/36 · pilihan-payload 41/41 · detail-ssr 38/38.
- `npm run test:lanjut` — **hijau penuh 176/176**: pilihan-edisi 25/25 · pilihan-edisi-browser 28/28 · pilihan-matriks-ulang 27/27 · slate-kembar 96/96.

## File utama yang diubah

- `design-system/theme.css` — token warna AMOLED, radius panel, peringatan peta spacing warisan.
- `app/globals.css` — cermin variabel, `color-scheme: dark`, token `--gutter` + `.shell-x`, fokus 2 px, scrollbar gelap.
- `app/(terminal)/layout.tsx`, `components/Nav.tsx`, `app/page.tsx` — gutter shell; migrasi CTA/panel Beranda.
- `app/(terminal)/pertandingan/page.tsx` — susunan baris Jadwal (status ke baris sendiri).
- `app/(terminal)/bukti/page.tsx` — panel Filter `<details>` + batas kontrol.
- `components/bukti/TabRekam.tsx` — tab membungkus + penanda mengikuti baris aktif.
- `components/ui.tsx` — `heatStyle` dua segmen terukur.
- `components/detail/PetaSkor.tsx` — sel 44×44, cincin terpilih dari warna teks sel, migrasi token teks/CTA.
- `components/detail/PetaSkor3D.tsx`, `components/pilihan/ParlayBuilder.tsx` — migrasi `text-kertas` → `text-tinta` di atas permukaan gelap.
- `tests/test-redesain-peta.ts` — asersi palet dimigrasikan + asersi kontras baru.

## Temuan di luar lingkup (dicatat, tidak diperbaiki — sesuai batas fase)

1. **Peta `--spacing-*` warisan** adalah akar dua dari tiga temuan P0 (gutter 4 px dan sel matriks 12 px) dan masih memengaruhi utilitas bernomor 4/8/12/16/20/24/48 di seluruh app (`gap-4` = 4 px, `mt-12` = 12 px, dst.). Menyelaraskannya ke skala standar Tailwind adalah perubahan global berisiko yang brief pisahkan sebagai langkah audit tersendiri — kandidat pekerjaan P2, bukan P0.
2. **Warna grafik 3D** di `PetaSkor3D.tsx` masih memakai warna literal lama (`#ff6935`, `#f8f7f2` untuk tepi sel terpilih) — penyetaraan grafik adalah butir P2; pada P0 hanya teks tombol fallback-nya yang dimigrasikan.
3. **Sel di luar kelompok filter** pada matriks dirender `opacity-40` (perilaku lama dipertahankan): teksnya ikut memudar terhadap panel, jadi kontras efektifnya di bawah angka tabel (yang mengukur filter "semua"). Kandidat peninjauan pada penyetaraan grafik P2.
4. Tab Rekam hasil kini juga terbungkus pada 390 px (hitungan empat digit membuat total lebar tab ±390 px) — sesuai syarat brief (tab harus BISA membungkus dan tidak meluap), tetapi bila pemilik ingin satu baris pada 390, itu keputusan rancangan P1.

## Belum bisa dicek

- Perangkat fisik Android/iOS nyata, Safari iOS, keyboard virtual terbuka, dan pembaca layar — hanya Chromium headless terotomasi (harness repo) yang tersedia di lingkungan ini.
- Uji landscape ponsel dan pembesaran teks 200% dari kriteria penerimaan brief belum dijalankan pada fase ini.
- Alur interaktif panel Filter versi modal penuh (fokus terkelola, Escape, kembalikan fokus) adalah perilaku P1; panel P0 memakai `<details>` natif (fokus dan Escape mengikuti perilaku bawaan browser).
- Mode 3D matriks (WebGL) tidak diuji ulang di fase ini selain build; penyetaraan visualnya P2.

## Status

Branch `upgrade/frontend-amoled` — TIDAK di-merge ke master, TIDAK di-deploy. Menunggu tinjauan pemilik untuk lanjut ke fase P1.
