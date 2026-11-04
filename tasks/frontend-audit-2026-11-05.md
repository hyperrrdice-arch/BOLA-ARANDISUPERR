# Audit Frontend — Pilihan Aman (5 Nov 2026, ~05:00–06:00 WIB)

Metode: review multi-sumbu (code_review_and_quality) + performance_optimization atas
seluruh kode frontend baru (~2.931 baris), DITAMBAH verifikasi jalan nyata:
`next build` produksi bersih, server produksi lokal, kelima rute HTTP 200 dengan
konten data asli, dan nol TypeError di log server setelah perbaikan.

## Yang dibangun

- **Fondasi**: token Editorial Terminal "Amber Panas" (design-system/theme.css +
  tokens.json + globals.css), font Archivo Narrow/Geist/Geist Mono, lapis data
  baca-saja `lib/web/data.ts` (readOnly, SELECT saja), atom `components/ui.tsx`.
- **Landing** (`/`): hero 3D matriks skor (three vanilla), ticker pilihan A/B,
  cara kerja, tabel bukti per grade, blok kejujuran, footer ritme data.
- **Dashboard**: `/pertandingan` (daftar 72 jam + seksi selesai), 
  `/pertandingan/[matchId]` (probabilitas 3 sumber, matriks 6×6, asal angka,
  form kanonik, keberuntungan, pick + hasil), `/pilihan` (pembangun parlay),
  `/bukti` (ledger: kejujuran per grade/pasar, daftar dinilai).

## Performa (terukur, bukan klaim)

- Build: kelima rute **Partial Prerender** (kerangka statis + pulau data
  ber-Suspense dengan `connection()`), sesuai Cache Components Next 16.
- HTML terkompresi di kabel: `/` 15,7 KB · `/pertandingan` 50,2 KB · `/pilihan` 35,3 KB.
- three.js terisolasi: chunk 548 KB mentah / **134 KB gzip**, dimuat malas
  (dynamic ssr:false) HANYA di landing; halaman terminal mereferensikan 0 byte WebGL.
- Objek 3D: DPR ≤ 2 (seluler 1,5), loop berhenti di luar viewport & tab
  tersembunyi, reduced-motion = satu frame statis, dispose penuh saat unmount.
- Dashboard murni Server Component (nol JS client selain Nav); GSAP hanya di landing.
- Data matriks ke client /pilihan: hanya paket yang tampil (~134 KB JSON total).

## Bug yang DITEMUKAN audit/verifikasi dan sudah diperbaiki

1. **Crash semua halaman** (`fixture.home` of undefined): tabel packages menyimpan
   3 generasi payload (613 terkini, 70 datar awal tanpa fixture bersarang, 4 manual
   e2e bentuk bebas). Diperbaiki di satu titik: normalisasi di `parsePackage`
   (fixture dijamin; nama paket manual dari `selection.fixture`/dataset; isian
   kosong yang jujur untuk probabilitas/matriks paket lama). Pasca-perbaikan:
   TypeError log server = 0, analisis Fenerbahçe–Liverpool & laga datar tampil benar.
2. **Tautan mati** di nav landing: `/pilihan-aman` → rute sebenarnya `/pilihan`.
3. **`export const dynamic` tidak kompatibel** dengan `cacheComponents: true` —
   diganti pola PPR/Suspense + `connection()` di semua halaman (termasuk params
   [matchId] yang wajib di-await di dalam Suspense).
4. **Peringatan tracing NFT Turbopack**: path `process.cwd()` bebas menelusur
   seluruh proyek → dibuat statis per subfolder `data/`.

## Temuan yang dicatat, tidak diubah (dengan alasan)

- **Ketegangan metode parlay**: pilihan tunggal memakai probabilitas efektif
  (terkoreksi lab); gabungan multi-pilihan satu laga memakai probabilitas
  gabungan mentah dari matriks. Mengoreksi yang kedua butuh metodologi baru —
  tidak diada-adakan; metode dilabeli terbuka di UI & header `lib/web/parlay.ts`.
- **N+1 ringan** di daftar selesai: `getPackagePicks` per laga (≤60 query SQLite
  lokal per request server). Terukur cepat; optimasi (satu query gabungan)
  hanya bila daftar tumbuh jauh.
- **`/bukti` masih menampilkan EmptyState** untuk tabel kejujuran live:
  live_resolved = 0 memang keadaan sebenarnya (slate live-run pertama belum
  selesai dinilai). Tabel aktif otomatis saat resolusi pertama masuk.
- **Route API lama** (`/api/matches` dll.) dan komponen dashboard lama tidak
  disentuh — tidak dirujuk halaman baru; penghapusan = keputusan terpisah.
- Halaman analisis paket manual e2e (4 paket) menampilkan probabilitas kosong
  "—": payload bentuk bebas itu memang tidak menyimpan probabilitas standar.

## Kualitas kode (sumbu review)

- **Kebenaran**: predikat parlay terverifikasi mereproduksi probabilitas paket
  sampai 6 desimal untuk 1X2/DC/OU2.5/BTTS/team_over05; kasus tumpang-tindih
  1 ∧ 1X: persis 0,5143 vs naif 0,4008.
- **Keamanan**: lapis data readOnly penuh; tidak ada input pengguna yang
  mencapai SQL tanpa parameter binding (`?` di semua query); tidak ada
  kredensial di kode frontend; tidak ada `dangerouslySetInnerHTML`.
- **Aksesibilitas**: tautan lewati-ke-konten, `aria-current` pada nav aktif,
  label pada cap grade & canvas 3D (role img + aria-label), fallback 2D untuk
  WebGL, override reduced-motion global + per komponen, fokus terlihat amber.
- **Konsistensi gaya**: nol kata "kaki" di seluruh frontend (grep bersih);
  semua angka lewat `lib/web/format.ts` (koma desimal, WIB); warna hanya
  dari token — tidak ada hex liar di komponen baru selain material three
  (0xffa02e dsb. di ScoreMatrix3D, setara token amber) dan heatStyle.
- **Kompleksitas**: file terbesar 578 baris (data.ts, satu tanggung jawab);
  halaman analisis 483 baris (padat tapi satu halaman-satu laga, terstruktur
  per seksi). Duplikasi yang disengaja: nol — atom bersama dipakai semua trek.

## Sisa pekerjaan di luar audit ini

- **Deploy ke VPS Arandi** (`hermes.mhmdarandi.biz.id`) — menunggu akses;
  di server itu ritme 12 jam cukup satu baris crontab menjalankan
  `scripts/free-refresh.ts` dan `next start` di belakang reverse proxy.
