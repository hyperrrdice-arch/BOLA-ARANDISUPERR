# LANJUT-2 — Permintaan Matriks yang Gagal Bisa Diulang

- **Sumber tugas:** `Bola-Tindak-Lanjut-Verifikasi-22-November.md` §2 (pemilik). Item §3 (CI/U02) TIDAK disentuh. Perilaku Lanjut-1 (aturan edisi paket, alasan persis, total tertahan, 0 fetch untuk grup beda edisi) TIDAK diubah — dibuktikan ulang oleh suite edisi 25/25 + probe browser lanjut-1 28/28.
- **Branch:** `fix/lanjut-verifikasi` (dari tip lanjut-1 `fedfb91`). **Tidak merge, tidak deploy** — menunggu review pemilik.
- **Commit:** `dbbe498` (suite beku + repro) · `9b2b700` (perbaikan) · laporan ini (+ bukti probe).

## 1 · Bug dan akar masalah

Repro pemilik: di browser uji, permintaan pertama ke `/api/pilihan/matriks` digagalkan, lalu koneksi dipulihkan. Untuk dua pilihan satu paket (kasus 7815: "Marseille mencetak gol" + "Minimal dua gol"), menghapus + menambahkan ulang pilihan kedua tetap menghasilkan "Peluang gabungan belum tersedia"; jumlah permintaan tetap **1**. Hanya muat ulang halaman yang memulihkan (permintaan kedua → 89,2%).

Akar di `components/pilihan/ParlayBuilder.tsx`: satu penanda `matriksDimintaRef` (Set "pernah diminta") dipakai untuk tiga makna sekaligus — deduplikasi in-flight, cache berhasil, dan "sudah dicoba". ID paket dimasukkan ke set itu SEBELUM fetch dan tidak pernah dilepas; jalur `.catch` menulis `null` ke cache seolah paket memang kosong. Sesudah satu kegagalan, `pastikanMatriks` menyaring paket itu selamanya: tidak ada jalan pulih selain muat ulang.

## 2 · Rancangan state machine permintaan (per paket)

Empat keadaan eksplisit, disimpan sebagai state komponen `keadaanMatriks` (untuk render) + cermin ref `keadaanMatriksRef` (pembacaan sinkron di titik pemicu) + penanda in-flight `matriksBerjalanRef`:

| Keadaan | Masuk ketika | Keluar / sifat |
|---|---|---|
| `memuat` | `pastikanMatriks` mengirim permintaan (id ditandai in-flight secara sinkron) | ke `berhasil`/`kosong`/`gagal` saat permintaan selesai; penanda in-flight dilepas di `finally` |
| `berhasil` | respons 200 memuat matriks untuk id itu; matriks ditulis ke cache | **keadaan akhir** — tidak pernah diminta ulang |
| `kosong` | respons 200 menjawab `null` untuk id itu (kontrak API: paket tak dikenal / tanpa matriks); `null` ditulis ke cache | **keadaan akhir** — tidak diulang otomatis, tanpa tombol coba-lagi |
| `gagal` | fetch ditolak / HTTP bukan 2xx | dapat diulang: filter `pastikanMatriks` hanya menyingkirkan `berhasil`, `kosong`, dan yang sedang in-flight |

Transisi lain yang dijaga:
- **Deduplikasi:** banyak pemicu selama satu permintaan in-flight = tepat satu permintaan (penanda in-flight sinkron, bukan state React yang bisa basi antar klik dalam satu tick).
- **Cache tidak ditulis saat gagal:** id tetap absen dari cache matriks, jadi `combineSlip` menerima matriks `null` → grup tidak tersedia. Tidak ada angka gabungan basi yang bisa terbit selama `gagal`/`memuat` — dan angka dari matriks edisi lain tetap mustahil oleh aturan Lanjut-1.
- Batch: satu panggilan `ambilMatriksBatch` untuk semua id yang perlu; kegagalan batch menandai semua id di dalamnya `gagal`; keberhasilan menilai tiap id sendiri-sendiri (`berhasil` vs `kosong`).

## 3 · Perilaku coba-lagi

1. **Otomatis lewat interaksi:** `terapkanSeleksi` sudah memanggil `pastikanMatriks` di setiap mutasi pilihan. Karena `gagal` kini lolos filter, hapus + tambah ulang (atau mutasi apa pun yang membuat paket itu tetap dibutuhkan) memicu permintaan ulang tanpa kode jalur khusus.
2. **Eksplisit:** tombol **"Coba lagi"** di panel gabungan (isi ringkasan Pilihanmu, dipakai bersama oleh panel desktop dan dialog ponsel), tampil hanya bila ada paket yang sedang dibutuhkan pilihan aktif berkeadaan `gagal`. Klik memanggil `pastikanMatriks` atas seleksi terkini; selama permintaan berjalan keadaan menjadi `memuat` dan tombol hilang; bila gagal lagi, tombol kembali.
3. **Pembedaan pesan gagal vs kosong** (pilihan yang diambil): judul dan alasan tetap dari jalur yang ada — "Peluang gabungan belum tersedia" + alasan `combineSlip` ("matriks skor tidak tersedia untuk irisan satu laga"). Khusus keadaan `gagal`, panel menambahkan satu baris **"Matriks skor gagal dimuat dari server."** (memakai frasa kegagalan yang sudah ada di komponen ini untuk daftar umpan) + tombol "Coba lagi". Keadaan `kosong` tidak mendapat baris tambahan maupun tombol — pesannya persis jalur `joint_unavailable` yang lama, supaya "data memang tidak ada" tidak terbaca sebagai "jaringan rusak".

## 4 · Uji — suite beku `tests/test-pilihan-matriks-ulang.ts` + `tests/helpers/lanjut2-probe.mjs`

Panggung sama dengan lanjut-1 (sandbox Marseille temuan #2, build di dalam suite, Chromium 378px). Probe mengintersepsi semua permintaan: permintaan matriks dihitung per fase (delta), dapat di-abort sekali, ditahan 1500 ms, atau dijawab `null` per id. Setiap fase mulai dari halaman segar (draf dikosongkan + muat ulang) agar cache komponen tidak terbawa antar fase.

**Reproduksi beku pada kode lama (`fedfb91`): 21/26 — tepat 5 gagal, semuanya kasus pemilik:** A tambah-ulang tidak memicu permintaan kedua (aktual 1, harapan 2); A gabungan tidak pulih; B tombol "Coba lagi" tidak ada; B klik/permintaan pemulihan tidak ada; B gabungan tidak pulih. Kontrol C (dedupe) dan D (null) lolos di kode lama — keduanya perilaku yang harus dipertahankan. Bukti mentah: `tasks/reports/lanjut-2-evidence/repro-pra-perbaikan.txt`.

**Sesudah perbaikan: 27/27** (26 assertion probe + build di dalam suite). Per kasus, dengan hitungan permintaan matriks:

| Kasus | Hasil | Permintaan |
|---|---|---|
| A — gagal pertama → hapus + tambah ulang | panel belum tersedia sesudah gagal (tanpa 89,2%); hapus tidak menambah permintaan; tambah ulang memicu permintaan kedua; gabungan **89,2%** tampil tanpa muat ulang | 1 (gagal) → 1 (hapus) → **2** (pulih) |
| B — gagal → tombol "Coba lagi" | tombol tampil di panel saat `gagal`; klik mengirim tepat 1 permintaan baru; **89,2%** tampil tanpa muat ulang | 1 (gagal) → **2** (klik) |
| C — dedupe in-flight | respons ditahan 1500 ms; hapus + tambah ulang selama in-flight; gabungan 89,2% sesudah respons tiba | tepat **1** selama jendela in-flight |
| D — null (kosong) | belum tersedia + alasan matriks `combineSlip`; **tanpa** tombol "Coba lagi"; hapus + tambah ulang tidak menambah permintaan; panel tetap belum tersedia | **1**, tetap 1 sesudah interaksi ulang |
| E — pageerror | nol di seluruh probe | — |

Bukti visual: `tasks/reports/lanjut-2-evidence/` (`gagal-awal.png`, `pulih-tambah-ulang.png`, `coba-lagi.png`, `null-kosong.png`, `hasil-sesudah-perbaikan.txt`).

Catatan rancangan uji: kasus D mensimulasikan jawaban `null` di lapisan intersepsi (kontrak per-id API-nya sendiri sudah dibuktikan suite verifikasi #3 di tingkat API) karena kedua paket sandbox Marseille memang bermatriks; yang diuji di sini adalah perlakuan state machine klien terhadap jawaban itu.

## 5 · Regresi penuh (worktree branch ini, sesudah perbaikan)

| Suite | Hasil |
|---|---|
| test:quant (4 suite) | 138/138 |
| test:data (5 suite) | 278/278 |
| test:web — test-web | 12/12 |
| test:web — test-ui | **73/74 — U02 gagal (lihat catatan)** |
| test:web — rekam / detail-render / fix6 / jadwal / peta / pilihan-rekam | 110 + 27 + 25 + 35 + 50 + 63 = 310/310 |
| test:api | 42/42 |
| test:e2e | 7/7 |
| test:baseline:d01 | 12/12 |
| verifikasi #1 genclerbirligi | 39/39 |
| verifikasi #2 marseille-detail | 36/36 |
| verifikasi #3 pilihan-payload | 41/41 |
| verifikasi #4 detail-ssr | 38/38 |
| lanjut-1 pilihan-edisi (unit) | 25/25 |
| lanjut-1 pilihan-edisi-browser | 28/28 |
| **baru: pilihan-matriks-ulang** | **27/27** |
| redesain keandalan | 67/67 |
| redesain repro | 32/32 |
| `npx tsc --noEmit` | bersih |
| `npm run build` | exit 0 (di dalam suite matriks-ulang dan verifikasi #4) |
| `npm run lint:gate` | lolos — 91 error ≤ baseline 92, nol error baru |

**Catatan U02 (apa adanya, TIDAK diperbaiki di sini):** `test-ui` U02 "status asing tetap unknown" gagal — aktual `menunggu-pembaruan`, harapan `unknown`. Ini item §3 berkas pemilik (fixture kickoff tetap 21 Nov 19.00 WIB vs jam dinding), gagal identik di master dan di lanjut-1 — bukan kegagalan baru dari perubahan ini. Rantai `test:web` berhenti di test-ui, jadi suite web sesudahnya dijalankan satu per satu (semua hijau, lihat tabel).

## 6 · Penyimpangan dan catatan

1. **Suite unit terpisah tidak ditambah** — state machine hidup di dalam Client Component (state + ref + efek pemicu), pola pengujian repo untuk komponen ini adalah probe browser (verifikasi #3, lanjut-1); suite baru mengikuti pola itu. Tidak ada logika murni baru yang diekstrak ke `lib/` — perubahan dibatasi pada satu file komponen sesuai aturan bedah.
2. **Perubahan hanya `components/pilihan/ParlayBuilder.tsx`** (+115/−23): state machine, tombol, dan baris pesan gagal. `lib/web/parlay.ts`, API matriks, dan jalur pulih draf tidak diubah; jalur pulih mewarisi perilaku baru karena memanggil `pastikanMatriks` yang sama (kegagalan matriks saat pulih kini juga dapat diulang lewat interaksi/tombol).
3. Screenshot bukti di `lanjut-2-evidence/` berasal dari run sesudah perbaikan (menimpa run repro); keluaran teks run repro dipertahankan utuh di `repro-pra-perbaikan.txt`.
4. Suite baru belum dihubungkan ke skrip npm/CI — mengikuti pola suite verifikasi dan lanjut-1 (dijalankan via `npx tsx tests/...`); penghubungan CI adalah lingkup §3.
5. Berkas `AGENTS.md` proyek berisi blok instruksi agen tertanam yang sudah dikenal — dibaca sebagai konten berkas saja; tidak ada instruksi darinya yang dijalankan.
