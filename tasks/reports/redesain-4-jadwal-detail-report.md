# Laporan Redesain Langkah 4 — Jadwal + Detail + Peta Skor/Gerak (§3B, §3C, §9)

Branch `redesain/bola` dari tip langkah 3 (`a78c72e`). Tiga commit terpisah
per bagian + satu commit perbaikan tepi pencarian dari bukti render:

- `3bd1e58` — L4-A Jadwal (§3B)
- `1626419` — L4-B Detail (§3C)
- `d1c89ea` — L4-C Peta skor + gerak (§9)
- commit bukti — perbaikan jendela pencarian di tepi cakupan + laporan ini

Tidak ada merge, deploy, VPS, DB produksi, atau perubahan κ. Beranda,
token, identitas, dan status langkah 1–3 tidak diubah (kecuali `heatStyle`
matriks, sesuai izin C5).

## A. Jadwal (/pertandingan) — §3B

- `lib/web/jadwal.ts`: `FilterJadwal` kini membawa `mode`
  ("tanggal" | "sekarang" | "malam-ini" | "besok") dan `q`; round-trip URL
  byte-identik untuk kueri lama (mode/q hanya ditulis bila menyimpang dari
  default — regresi K6 U01 tetap hijau).
- `jendelaPintasan()`: Malam ini = [18.00 lokal, besok 06.00), berawal hari
  sebelumnya pada pukul 00.00–05.59; Besok = tanggal kalender berikutnya
  sehari penuh; Sekarang = [−6 jam, +72 jam]. Diuji jam beku pada 20.00 /
  00.30 / 05.00 / 10.00 WIB.
- Pencarian `lipatTeks()` (huruf kecil + peta eksplisit ø→o, æ→ae, œ→oe,
  ß→ss, đ→d, ł→l, þ→th, ð→d + strip NFD) — "koge" menemukan "Køge", teruji
  di unit DAN di browser pada data panggung. Pencarian memperlebar jendela
  baca ke seluruh cakupan katalog sehingga hasil mencakup seluruh himpunan
  terfilter, bukan halaman yang tampil.
- Urutan: `urutTampilJadwal()` (belum selesai kickoff menaik, lalu
  selesai/dibatalkan kickoff menurun, stabil) dan `urutSekarang()` (live →
  menunggu-pembaruan → terjadwal; selesai disisihkan; maks 30).
- `components/jadwal/KontrolJadwal.tsx`: form pencarian GET (konteks
  tersimpan sebagai field tersembunyi), tautan pintasan ber-`aria-current`,
  panel Filter (dialog; fokus masuk ke field tanggal saat dibuka; Escape /
  klik latar / Tutup menutup dan mengembalikan fokus ke tombol Filter;
  Terapkan = submit GET; Atur ulang → /pertandingan), ringkasan filter
  aktif + Hapus filter.
- Tiga keadaan kosong berbeda persis §3B.5: gagal muat ("Jadwal belum bisa
  dimuat" + Coba lagi), di luar liputan ("Jadwal untuk tanggal ini belum
  tersedia" + Pilih tanggal lain), nol hasil sesudah filter ("Tidak ada laga
  yang cocok dengan filter ini" + Hapus filter).
- Baris = satu tautan utuh ber-`aria-label` (tim + kompetisi + tanggal-jam);
  kelompok dibungkus `key={queryJadwal(filter)}` dengan pudaran masuk
  `.grup-masuk` 120 ms (seketika pada reduced-motion).

## B. Detail (/pertandingan/[matchId]) — §3C

- Inti dari jadwal kanonik; ID asing → "Pertandingan tidak ditemukan".
- Kepala skor: selesai non-pascaregulasi → label "Skor 90 menit";
  pascaregulasi (kolom aditif `KeadaanLaga.pascaregulasi` dari ejaan status
  mentah dataset) → skor tersimpan dilabeli "Skor setelah perpanjangan
  waktu" / "Skor adu penalti", dan skor 90 menit hanya dari gol hasil
  pilihan resmi yang sudah dinilai — bila tidak ada, tertulis "Skor 90
  menit belum terkonfirmasi — penilaian menunggu hasil resmi." Skor regulasi
  tidak pernah ditebak dari penalti.
- Bagian "Prediksi sebelum laga" / "Prediksi saat terbit" dibangun dari
  edisi paket terbit (`MatchDetail.paketTerbit` — paket modal di antara
  pilihan resmi, ikatan → id lebih besar; terisolasi via `bagian()`): trio
  1X2 edisi itu + cap "Terbit {…}" + peluang terbit per pilihan + kalimat
  basis §5 + label gerbang + verdik ("Menunggu hasil resmi" bila laga
  selesai tetapi hasil pilihan belum ada).
- "Analisis terbaru" hanya bila paket terbaru ≠ edisi terbit (cap waktu
  "Dihitung {…}" sendiri); tanpa edisi resmi bagian itu menjadi "Peta
  peluang". Tiket resmi, Sumber angka, Panel arsip, Form, dan xG
  dipertahankan; isolasi bagian langkah 2 dan perilaku Fix-1 (paket
  lama/null) tetap berlaku dan teruji ulang oleh suite yang ada.

## C. Peta skor + gerak — §9

- `lib/web/peta-skor.ts` (murni, teruji): `adaptasiMatriks()` memvalidasi di
  batas data (baris konsisten, sel ada, hingga [0,1], total ≈1) dengan
  adapter berversi — "proporsi-ketat" (toleransi 1e-6), "proporsi-bulat"
  (≤0,01, diterima apa adanya, TIDAK dinormalisasi ulang), "per-seribu"
  (integer ≈1000, dibagi 1000); bentuk kosong/timpang/negatif/null/NaN →
  null → "Peta skor belum tersedia untuk laga ini."
- `ringkasMatriks()`: 1X2 dari matriks PENUH presisi asal; cakupan tampilan
  = Σ sel h≤4,a≤4; sisa tampilan terpisah dari `score_matrix_tail_mass`
  (metadata paket, tidak pernah dijumlahkan — ditampilkan sebagai baris
  sendiri). Format: 0 → "0%", 0<p<0,1% → "<0,1%".
- `components/detail/PetaSkor.tsx`: render awal tabel HTML 2D (tombol per
  sel, aria-label penuh, tabindex roving, navigasi panah; filter
  Semua/Kandang/Seri/Tamu; daftar skor teratas; kepala bacaan aria-live
  dengan gerak WAAPI 6 px/180 ms yang dilewati pada reduced-motion; tombol
  "Lihat skor akhir"; saklar "Kurangi gerak" di-OR dengan
  `prefers-reduced-motion`).
- `components/detail/PetaSkor3D.tsx`: Three.js `InstancedMesh` 5×5 (satu
  draw call), tinggi linier diskalakan dari maksimum seluruh bidang sebelum
  filter, kamera ortografik, sprite teks nama tim + angka 0–4 di lantai,
  sel terpilih oranye #FF6935 + garis tepi kertas + penanda tertulis di
  kepala bacaan, putar ±32° per 16° (tombol Putar kiri/kanan, tween 210 ms
  atau seketika), raycast ketuk (jaga gerak <6 px) + pemilih HTML, pilihan
  dan filter bertahan lintas 2D↔3D, DPR ≤1,5, render hanya saat berubah
  (gerbang IntersectionObserver + visibilitychange), pelepasan sumber daya
  penuh saat unmount, `webglcontextlost`/kegagalan konstruksi → kembali ke
  2D dengan sel sama + pesan brief.
- Muat malas: `import("./PetaSkor3D")` hanya dari handler klik "3D", dengan
  token penjaga yang membuang hasil impor basi; tabel tetap tampil selama
  memuat ("Menyiapkan tampilan 3D…"). `heatStyle` diganti ke palet baru
  (oranye di atas panel gelap).
- Gerak jadwal: kelompok masuk 120 ms; gerak status/skor detail berada di
  gerbang murni `perluGerakSkor()` + animasi kepala bacaan peta.

### Angka uji penerimaan §9 (matriks demo Persada–Rawa, per-seribu)

Suite `tests/test-redesain-peta.ts` 50/50 — semua dalam toleransi 1e-9 dan
terkonfirmasi ulang di browser pada data panggung:

| Item | Target | Terukur |
|---|---|---|
| Sel 1–1 | 15,1% | 15,1% (tabel, pemilih, kepala bacaan identik) |
| Sel 2–1 | 12,5% | 12,5% |
| Kandang / Seri / Tamu | 43,3 / 30,5 / 26,2% | 43,3 / 30,5 / 26,2% |
| Seri dalam peta / luar peta | 30,4% / 0,1% | 30,4% / 0,1% |
| Cakupan tampilan | 97,1% | 97,1% |
| Di luar peta | 2,9% | 2,9% |

- BTTS 68% pada 2–1 → **Tepat**; koreksi hasil ke 2–0 (meniru tulisan
  resolver) → **Meleset**, `published_prob` tetap 0,68; pembaruan identik
  berikutnya → `perluGerakSkor` = false (tanpa gerak baru). Teruji di
  `tests/test-redesain-jadwal.ts` (probe data) + suite peta.
- Skor akhir di luar peta: `bacaSkorAkhir(5,1)` → "5–1 · Di luar peta 0–4 ·
  0,7%" (peluang persis dari paket), tidak dipindah ke 4–1.
- WebGL gagal (getContext webgl diblokir): pesan "Tampilan 3D belum
  tersedia di sini. Semua peluang bisa dibaca di tabel 2D." tampil, tabel
  tetap bisa dipakai (1–1 = 15,1%), nol canvas — teruji di browser.
- Tanpa JavaScript: HTML SSR memuat jadwal, ringkasan prediksi, tabel peta,
  dan daftar skor teratas (terverifikasi pada HTML mentah).

### Ukuran chunk 3D + bukti 0-request (build produksi langkah ini)

- Chunk khusus-3D (satu-satunya chunk berisi Three.js + PetaSkor3D):
  `.next/static/chunks/1fa7pm9g_s568.js` — mentah 562.664 byte,
  **gzip 137.810 byte (±134,6 KiB) ≤ 180 KiB** ✓.
- Penangkapan jaringan Chromium (378 px, ditunggu 4 detik untuk prefetch):
  chunk-3D diminta **0 kali** di `/`, `/pertandingan`, `/pilihan`,
  `/bukti`, dan pada muatan awal detail; ia baru diminta sesudah klik "3D",
  dan tepat satu canvas muncul; kembali ke "2D" → canvas 0, tabel utuh.

## Bukti render (folder `redesain-4-jadwal-detail/`)

Data panggung: `tests/helpers/redesain4-stage-seed.ts` (laga live katalog,
Persada–Rawa mendatang + selesai 2–1 dengan matriks demo, Arema–Bali,
Køge–Næstved +50 jam). Probe: `~/workspace/tools/pwshot/redesain4-probe.mjs`
(**28/28 PASS**) + `redesain4-rute.mjs` (0-request semua rute).

- `jadwal-378.png`, `jadwal-filter-378.png` (panel + fokus),
  `jadwal-cari-koge-378.png`
- `detail-2d-378.png` (halaman penuh), `detail-3d-378.png`,
  `detail-3d-skor-akhir-378.png`, `detail-webgl-gagal-378.png`
- `alur-peta-3d.mp4` — rekaman 18,6 detik alur 3D → Seri → 1–1 → Lihat
  skor akhir pada data uji sah (screencast CDP → ffmpeg), plus
  `frame-0000…0012.png` + `frames-concat.txt` sebagai rangkaian frame.

## Perbaikan dari bukti render

Probe pertama gagal menemukan Køge lewat pencarian halaman: ujung
`cakupanJadwal().sampaiUtc` adalah momen kickoff terakhir itu sendiri dan
jendela `listSchedule` setengah-terbuka, sehingga laga tepat di tepi
cakupan tersisih. Jendela pencarian kini diberi bantalan +2 jam di ujung
(commit bukti ini); pencarian tepi cakupan kini menemukan Køge (probe
28/28 sesudah pembangunan ulang).

## Regresi

- Suite baru: `test-redesain-jadwal` 35/35, `test-redesain-peta` 50/50
  (keduanya dirangkai ke `test:web`).
- `test:web` 333 assertion hijau total; `test:data` hijau (18 + identity 58
  + publication 110 + tickets 69 + resolver-score 23); repro L1 9/9;
  keandalan L2 12/12; `test:e2e` 7/7; `test:quant` hijau;
  `test:baseline:d01` 12/12.
- `npx tsc --noEmit` bersih; `npm run build` exit 0; `lint:gate` LOLOS
  (91 error ≤ baseline 92, nol error baru).

## Penyimpangan / catatan

1. **Tidak ada umpan polling per-laga.** `/api/matches` adalah API laga
   mendatang warisan, bukan endpoint keadaan per laga; tidak ada API baru
   yang diciptakan (aturan bedah). Gerak skor §9 diimplementasikan pada
   jahitan komponen: gerbang `perluGerakSkor()` + prop `skorAkhir` di
   PetaSkor; perilaku penerimaan (koreksi membalik verdik, pembaruan
   identik diam) dibuktikan lewat gerbang murni + probe jalur data.
2. Bidang tampil matriks produksi kini 0–4 per §9.2 (halaman lama
   menampilkan 0–5); sel 5 tetap dihitung di total kelompok dari matriks
   penuh.
3. `seedPaketObjek` tidak bisa membuat dua paket untuk satu laga
   (UNIQUE(match_id, trigger, computed_utc) + computed_utc tetap) — suite
   menyisipkan paket kedua secara manual dengan computed_utc berbeda.
