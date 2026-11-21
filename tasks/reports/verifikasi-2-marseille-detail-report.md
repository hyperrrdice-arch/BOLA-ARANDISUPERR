# Verifikasi Produksi — Temuan #2: Detail Marseille menampilkan dua angka resmi yang bertentangan

- **Branch:** `fix/verifikasi-produksi` (lanjutan temuan #1, tip dasar `e3b3ae7`). **Tidak di-merge, tidak di-deploy, produksi/VPS tidak disentuh.**
- **Sumber temuan:** `Verifikasi-Produksi-Bola-untuk-Muse.md` bagian 2 (pemilik, produksi 21 Nov 2026, build `mb8qnWesaTQ9cIg5djR8j`).
- **Status: SELESAI di branch** — semua instruksi implementasi pemilik terpenuhi di harness beku + render panggung; menunggu keputusan pemilik untuk merge/deploy.

## 1. Akar masalah

Ledger menyimpan SATU baris per edisi sumber. Untuk Marseille–Le Mans ada dua edisi
resmi (paket `mt_022917440` dan `sm_19715544`) → 16 baris untuk 9 kejadian semantik,
empat di antaranya berbeda angka terbit (BTTS 0,7727 vs 0,6276; DC 1X 0,7271 vs 0,8288;
OU2.5 0,8094 vs 0,6789; tim tamu mencetak gol 0,8136 vs 0,7014).

- **Pilihan** membaca ledger lewat `daftarPilihanPraLaga` (`lib/web/rekam.ts`), yang
  mengelompokkan baris per kunci semantik (identitas laga fisik + pasar + garis +
  pilihan), menunjuk edisi terbit pertama sebagai perwakilan, dan menahan kejadian
  berbeda-angka sebagai konflik berjejak → tampil 9 kejadian, BTTS tidak bisa ditambah.
- **Detail** membaca lewat `getOfficialPicks` (`lib/web/data.ts`), yang mengembalikan
  baris mentah apa adanya, dan halaman detail mencetak array itu satu-satu
  (`officialPicks.map`) dengan label jumlah = panjang array mentah → 16 baris,
  BTTS tampil dua kali dengan dua angka yang sama-sama berlabel "peluang saat terbit".

Jadi bukan datanya yang salah — dua permukaan menghitung ledger yang sama dengan
aturan berbeda. Perbaikannya menyamakan aturan, bukan mengubah data.

## 2. Perbaikan (sesuai instruksi pemilik, bedah terbatas)

1. **Satu fungsi pengelompokan bersama** (`36bd2ec`, `lib/web/rekam.ts`): inti
   pengelompokan `daftarPilihanPraLaga` diekstrak menjadi `kelompokkanKejadianResmi`
   yang diekspor — kunci semantik, perwakilan terbit pertama (keputusan-pertama K2),
   dan jejak konflik (semua nilai + asal + waktu terbit) kini hidup di SATU tempat.
   Umpan Pilihan memakai fungsi yang sama; perilakunya tidak berubah (dibuktikan
   suite rekam + pilihan-rekam + verifikasi #1 di bawah). Satu penajaman yang
   disengaja: edisi tanpa angka terbit (null) tidak ikut menentukan konflik angka
   (di umpan Pilihan baris seperti itu memang tersaring oleh WHERE, jadi perilaku
   Pilihan identik), tetapi tetap tercatat sebagai edisi.
2. **Detail memakai fungsi yang sama** (`e8543d5`, `lib/web/data.ts`):
   `kelompokkanPilihanResmi` menjalankan fungsi bersama itu atas `OfficialPick[]`
   (resolusi UID fisik baris NULL memakai `petaUidFisik` yang sama dengan Pilihan)
   dan `getMatchDetail` kini mengembalikan `kejadianResmi`. Vonis kejadian diambil
   dari edisi mana pun yang sudah dinilai bila perwakilan belum (satu kejadian =
   satu pasar+pilihan = satu hasil). `officialPicks` mentah TIDAK berubah — tetap
   sumber tautan tiket resmi dan penentuan paket edisi terbit. `OfficialPick` kini
   mengetik kolom `line` + `fixture_uid` yang memang selalu dikembalikan query.
3. **Render detail** (`4ef8b74`, `app/(terminal)/pertandingan/[matchId]/page.tsx`):
   bagian "Prediksi sebelum laga"/"Prediksi saat terbit" merender `kejadianResmi`:
   - kejadian unik tampil **satu kali** lewat perwakilannya;
   - kejadian berkonflik berlabel **"Dua sumber berbeda angka"** (persis label
     saran pemilik) dan **tidak menampilkan satu angka pun sebagai angka resmi**;
     kalimat penjelas menyebut tidak ada angka yang dipilih diam-diam;
   - di bawah baris kejadian multi-edisi ada rincian **"Edisi sumber · N"**
     (`<details>` bawaan, terbaca tanpa JavaScript) berisi tiap edisi: nilai,
     asal (`match_id` sumber), dan waktu terbitnya — lapis audit terpisah dari
     bacaan utama, tidak ada edisi yang hilang;
   - label jumlah di bagian itu dan kalimat penilaian di header memakai
     **hitungan kejadian unik**; hitungan tepat/meleset juga per kejadian unik
     (dua edisi satu kejadian tidak terhitung dua kali).

Yang TIDAK diubah: skema/ledger, jalur publikasi K2, pustaka tiket K3, umpan
Pilihan, dan permukaan lain. Temuan #3 (beban awal Pilihan) dan #4 (detail tanpa
JavaScript) di luar lingkup tugas ini.

## 3. Bukti regresi

Suite baru `tests/test-verifikasi-marseille-detail.ts` (+ probe
`tests/helpers/verifikasi2-probe.ts`) — **36/36 hijau**. Fixture beku data nyata
yang sama dengan kasus redesain (`picks-marseille.json`: 16 pick ledger migrasi
K1/K2, `fixture_uid` 16/16 NULL persis produksi; registry gabung + tautan dibangun
builder repo). Yang dikunci:

- kedua URL (`mt_` dan `sm_`) membaca 16 pick mentah, tetapi `kejadianResmi` = **9**
  dan hasil pengelompokan kedua URL **identik**;
- BTTS tampil **satu kali**, berkonflik, jejak = **[0,6276 · 0,7727]** dengan kedua
  asal dan kedua waktu terbit; set konflik = 4 (btts, dc 1x, ou25, team_over05_away);
- OU1.5 satu kejadian **0,8553** tanpa konflik, kedua `pick_uid` edisi tertelusur;
  kejadian satu-edisi (OU3.5, 1X2) tetap satu; semua edisi per kejadian tertelusur;
- konsistensi antar-permukaan: kunci kejadian, kunci konflik, nilai konflik BTTS,
  dan angka perwakilan kejadian sepakat **sama persis** dengan `daftarPilihanPraLaga`
  pada jam beku yang sama;
- penjaga sumber halaman: label "Dua sumber berbeda angka" ada, hitungan memakai
  `kejadianResmi.length`, daftar memetakan `kejadianResmi` (bukan `officialPicks`).

Suite penuh proyek di branch ini:

| Suite | Hasil |
|---|---|
| test:quant | 138/138 |
| test:data | 278/278 |
| test:web | 395/396 — lihat catatan U02 di bawah |
| test:api | 42/42 |
| test:e2e | 7/7 |
| test:baseline:d01 | 12/12 |
| redesain-keandalan | 67/67 |
| redesain-repro | 32/32 |
| verifikasi-genclerbirligi (temuan #1) | 39/39 |
| verifikasi-marseille-detail (baru) | 36/36 |
| `tsc --noEmit` | bersih |
| `npm run build` | berhasil (BUILD_ID `6ZJ_qzwuwGXNCt5w8BkpJ77M`) |
| `npm run lint:gate` | LOLOS — 91 error ≤ baseline 92, tanpa error baru |

**Render panggung (di luar suite):** server `next start` dari build di atas dengan
data sandbox suite yang sama — kedua URL HTTP 200; DOM ter-render memuat label
**"9 pilihan resmi"** (dan tidak ada "16 pilihan resmi"), label konflik **4×**,
rincian **"Edisi sumber" 7×** (7 kejadian dua-edisi), label BTTS **tepat 1×** di
daftar prediksi, dan aritmetika baris daftar tertutup: 9 baris kejadian + 14 baris
edisi = 23 `<li>`. Kedua nilai konflik (77,3% dan 62,8%) hadir di rincian edisi.

**Catatan U02 (bukan dari branch ini):** satu-satunya kegagalan test:web adalah
`test-ui` "U02: status asing tetap unknown" (aktual `menunggu-pembaruan`) — gagal
**identik di master murni `a7bc8cb`** dan di branch temuan #1; kegagalan bawaan
master, tidak diperbaiki di sini (di luar lingkup), dan terkonfirmasi **tidak
bertambah buruk** (tetap tepat satu itu).

## 4. Sisa risiko & catatan

- **Produksi belum berubah** sampai pemilik memutuskan merge + deploy. Sesudah
  deploy, perbaikan berlaku untuk semua laga multi-edisi, bukan hanya Marseille:
  permukaan detail dan Pilihan kini membaca aturan yang sama, jadi kelas
  ketidakkonsistenan ini tertutup di sumbernya.
- **Urutan kejadian** di detail mengikuti urutan baris mentah `getOfficialPicks`
  (grade, lalu peluang terbit) pada kemunculan pertama tiap kejadian — sama
  seperti sebelum perbaikan; yang berubah hanya peleburan per kejadiannya.
- **Vonis header** kini per kejadian unik; untuk laga yang edisi-edisinya sudah
  dinilai, angka "X dari Y pilihan resmi tepat" tidak lagi menghitung edisi
  ganda dua kali — konsisten dengan label jumlah yang diminta pemilik.

## 5. Commit di branch ini (temuan #2)

1. `36bd2ec` — refactor(rekam): ekstrak `kelompokkanKejadianResmi`.
2. `e8543d5` — feat(data): `MatchDetail.kejadianResmi`.
3. `4ef8b74` — feat(detail): render kejadian unik + label konflik + rincian edisi.
4. `b54e27b` — test(verifikasi): suite beku temuan #2 (36/36).
5. Commit laporan ini.
