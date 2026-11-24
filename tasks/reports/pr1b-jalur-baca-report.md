# PR 1B — Jalur Baca Web (Beranda): Laporan

**Cabang:** `pr-1b/jalur-baca-web` dari master `e648404` · **Status:** selesai,
BELUM merge, BELUM deploy (keputusan pemilik) · **Lingkup:** brief
`Brief-Data-Akurasi-dan-Efisiensi-Bola.pdf` hal. 8 (butir 1–3) + uji P01
hal. 13 + urutan PR hal. 14 (irisan 2). Tanpa perubahan semantik: snapshot
respons lama vs baru pada dataset tetap setara (bukti di bawah).

---

## 1. Masukan

### Baseline PR 1A (audit, untuk rujukan)
- Beranda hangat p50 1.073 ms / p95 1.205 ms; dingin total 6,85 dtk.
- `ambilRekam` median 1.025 ms ≈ 97% biaya Beranda; dua pembaca 72 jam
  gabungan ±100 ms; pola LATEST_PER_MATCH menggrup 8.981 paket sebelum
  filter jendela; bentuk kickoff-first terbukti identik (127 baris).

### Baseline terukur ulang di branch ini (staging, kode master)
Data staging = salinan konsisten produksi (sqlite `.backup`) di worktree
ini: 8.981 paket, 172.375 pick. Instance terpisah port 3199.

- Per pembaca: listUpcoming(72) hangat 50,5 ms · sorotanBeranda 44,0 ms ·
  jadwalBerikutnya 37,2 ms · ambilRekam 1.066,7 ms (dingin 7.574,3 ms) ·
  total tiga pembaca Beranda 1.061,1 ms.
- HTTP Beranda: dingin 10,95 dtk · hangat p50 1,072 / p95 1,147 dtk ·
  dokumen 48.505 byte. Kontrol: Jadwal p95 0,066 · detail p95 0,056.

## 2. Perubahan per file

### `lib/web/rekam.ts` — pembaca ringkasan kohor (brief butir 1)
- Baru: `ambilRingkasanRekam(f, nowUtc)` + tipe `RingkasanRekam`.
  Mengembalikan HANYA `{ stats, laga_dinilai_unik }` — yang ditampilkan
  Beranda — tanpa memuat seluruh baris kohor, tanpa decode nama dari
  payload paket (±1,7 rb paket), tanpa opsi filter, tanpa tiket.
- Paritas menurut konstruksi: statistik dari `cohortStats` yang sama
  dengan filter `cohortFilterOf` yang sama dan peta alasan pending yang
  sama (dibangun dari kueri sempit atas baris pending saja: tanpa
  outcome, tidak void, laga di antrean konflik K1 — kondisi persis yang
  dipakai `ambilRekam`); `laga_dinilai_unik` menghitung `kunciFisik` +
  `petaUidFisik` yang sama atas baris settled saja.
- Jebakan terukur: kueri settled bentuk LEFT JOIN polos digerakkan
  perencana dari `idx_pick_outcomes_agg` atas SEMUA seri (±160 rb baris,
  195 ms). Bentuk final memakai EXISTS/NOT EXISTS dari sisi `picks`
  (sapuan indeks source + probe kunci primer): 13 ms, himpunan baris
  sama untuk keperluan Set kunci.
- Basis probabilitas TIDAK disentuh: statistik tetap basis
  `published_prob` lewat `cohortStats`, sama seperti jalur lama.
  Temuan basis ganda PR 1A (data.ts `model_prob` vs cohort.ts
  `published_prob`) dicatat untuk PR 2 — tidak "diperbaiki" di sini.
- `ambilRekam` sendiri tidak diubah — /bukti memakai jalur yang sama
  persis seperti sebelum PR ini.

### `lib/web/data.ts` — satu pembaca Beranda + kickoff-first (butir 2–3)
- Baru: konstanta `LATEST_PER_MATCH_KICKOFF_FIRST` — jendela disaring
  lewat `idx_packages_kickoff`, latest-per-match dipilih via subquery
  korelasi id GLOBAL maksimum per match_id (tanpa filter jendela di
  dalamnya), jadi semantiknya persis bentuk lama: edisi terbaru yang
  kickoff-nya pindah keluar jendela tetap menyingkirkan laga itu.
  Dipakai `listUpcomingPada` (satu-satunya pembaca jendela 72 jam).
  Indeks baru TIDAK dibuat — plan membuktikan indeks yang ada cukup.
- Refaktor tanpa perubahan perilaku: inti `sorotanDariDaftar` dan
  `jadwalDariDaftar` dipisah dari pembacaannya; ekspor lama
  `sorotanBeranda`/`jadwalBerikutnya` mempertahankannya persis.
- Baru: `berandaSorotanDanJadwal(now)` — SATU nilai nowUtc, SATU
  lintasan baca jendela untuk sorotan + jadwal (sebelumnya dua kali
  query + decode + pengayaan yang sama).
- Dua query fallback LIMIT (laga pertama sesudah jendela; `listFinished`)
  SENGAJA dipertahankan dalam bentuk `LATEST_PER_MATCH` lama — lihat
  deviasi §5.

### `app/page.tsx` — pemakaian
- `SorotanDanJadwal` memakai `berandaSorotanDanJadwal(now)`.
- `RekamRingkas` memakai `ambilRingkasanRekam(...)`; bidang yang dibaca
  (`stats.*`, `laga_dinilai_unik`) identik. Impor disesuaikan. Tidak ada
  perubahan markup.

### Tes (baru)
- `tests/test-beranda-pr1b.ts` (36 assertion) dirantai ke `test:web`
  lewat `package.json`; helper `tests/helpers/beranda-seed.ts` +
  `tests/helpers/beranda-probe.ts` (pola probe K7: subprocess, cwd =
  sandbox, jam beku).

### Diagnostik (baru, di `tasks/pr1b/`)
- `snapshot-parity.ts` (dump snapshot jalur lama pada jam beku +
  mode banding lama-vs-baru dalam satu proses), `profile-readers.ts`,
  `diag-ringkasan.ts`, `ukur-http.sh`; bukti di `tasks/pr1b/evidence/`
  (`snapshot-sebelum.json`, `snapshot-sesudah.json`, `pengukuran.md`).

## 3. Bukti parity

Dataset tetap = salinan staging di atas; jam beku 2026-11-24T02:00:00Z.

1. **Diff snapshot kosong.** Dump jalur lama SEBELUM perubahan vs dump
   jalur lama SESUDAH perubahan (dengan query baru di bawahnya):
   berkas JSON identik byte-per-byte — sorotan (prediksi, Newcastle
   Jets vs Kashiwa Reysol), 5 baris jadwal, statistik rekam (settled
   3.021, hits 2.251, due 8.499, laga unik 333).
2. **Banding dalam proses:** pembaca gabungan + ringkasan baru vs
   pasangan lama — `PARITY OK` (serialisasi kanonik, deep-equal).
3. **Perbandingan SQL penuh** jendela mendatang: 129 baris, urutan
   identik, termasuk 17 grup kickoff yang seri.
4. **Suite P01 36/36:** parity ringkasan pada filter baku/pasar/liga/
   tanggal-UTC/tanggal-Asia/Jakarta (jendela lokal berbeda, angka
   spot-check terhitung tangan: UTC settled 3 vs Jakarta settled 4);
   kasus kickoff direvisi keluar jendela (laga hilang) dan masuk
   jendela (edisi baru tampil); laga tanpa pick resmi; tangga fallback
   tanpa-prediksi/berikutnya/hasil-terakhir; nol data.
5. **Byte dokumen HTTP identik** di Beranda (48.505) dan kedua kontrol
   sebelum vs sesudah — render tidak berubah.

## 4. Angka sebelum → sesudah (staging)

Per pembaca (median hangat): total Beranda 1.061,1 ms → ±92 ms (−91%);
`ambilRekam` 1.066,7 → `ambilRingkasanRekam` 60,8 ms; sorotan+jadwal
81,2 → 29,0 ms; listUpcoming(72) 50,5 → 29,7 ms.

HTTP (dokumen penuh, ≥20 request hangat untuk Beranda):

| Rute | p50 sebelum | p95 sebelum | p50 sesudah | p95 sesudah |
|---|---|---|---|---|
| `/` Beranda | 1,072 dtk | 1,147 dtk | 0,117 dtk | **0,134 dtk (−88,3%)** |
| `/pertandingan` (kontrol) | 0,052 | 0,066 | 0,053 | 0,080* |
| `/pertandingan/<id>` (kontrol) | 0,040 | 0,056 | 0,036 | 0,044 |

**Target brief (p95 Beranda turun ≥30% di staging): TERCAPAI (−88,3%).**
Dingin Beranda: 10,95 → 1,76 dtk. Query plan sebelum/sesudah + rincian
ada di `tasks/pr1b/evidence/pengukuran.md`.
*p95 Jadwal pada dua run sesudah = 0,062 dan 0,080 — pita noise baseline
di skala puluhan ms; tidak ada kode jalur Jadwal/detail yang diubah.

Sisa biaya terbesar berikutnya (di luar lingkup PR ini): di dalam
ringkasan, `cohortStats` ±34 ms (tanda-tangan keadaan + agregat kohor,
dipakai bersama /bukti); lalu dua kueri sempit ±25 ms. Langkah lanjutan
brief (cache/read-model) adalah PR terpisah bila pemilik menghendaki.

## 5. Deviasi jujur

1. **Fallback LIMIT tidak diubah ke kickoff-first.** Pada jendela
   selesai staging, himpunan baris kedua bentuk query identik tetapi
   urutan di antara kickoff yang SERI berbeda (59 grup seri) — dengan
   LIMIT, laga terpilih pada seri bisa berubah. Kedua query itu jalur
   dingin (hanya saat jendela kosong / fallback hasil-terakhir), jadi
   bentuk lama dipertahankan persis dan diberi komentar alasan di kode.
   Konsekuensi: klaim kickoff-first berlaku untuk pembaca jendela
   (jalur panas) — di sana identik terurut terbukti pada data staging.
2. **`enrich` tidak diringankan.** Baris daftar Beranda masih membawa
   decode payload penuh + lookup skor per laga lewat tipe bersama
   `FixtureListItem` (dipakai Jadwal/detail juga). Sesudah butir 1–2,
   sisa biaya sorotan+jadwal hanya ±30 ms sehingga bukan lagi dominan;
   memisahkan tipe ringan khusus Beranda dicatat sebagai sisa, bukan
   dikerjakan diam-diam di PR ini.
3. **Jumlah SQL per render tidak diinstrumentasi** — celah yang sama
   seperti PR 1A (butuh perubahan kode di luar mandat baca-saja ukur).
4. Angka dingin HTTP berisik mengikuti IO host (VM bersama); kontrak
   target dinilai dari angka hangat, sesuai metodologi PR 1A.

## 6. Hasil uji (worktree ini, perintah + exit code)

| Perintah | Exit |
|---|---|
| `npx tsc --noEmit` | 0 |
| `npm run lint:gate` | 0 |
| `npm run test:quant` | 0 |
| `npm run test:data` | 0 |
| `npm run test:web` (termasuk test-beranda-pr1b 36/36, test-rekam 110/110) | 0 |
| `npm run test:api` | 0 |
| `npm run test:verifikasi` | 0 |
| `npm run test:lanjut` | 0 |
| `npm run test:e2e` | 0 |
| `npm run build` | 0 |

Tidak ada kegagalan lingkungan: `.env.local` disalin buta dari checkout
utama sejak awal (pelajaran runbook PR 1A), jadi kegagalan koleksi
konfigurasi /api/agent tidak muncul. Semua build/tes hanya di worktree
ini; produksi 3101 tidak diganggu (staging 3199 dimatikan sesudah ukur,
/healthz produksi 200 terverifikasi di akhir).

## 7. Sisa risiko

- Urutan di antara kickoff yang persis sama pada `listUpcomingPada`:
  kedua bentuk query (lama dan baru) sama-sama tanpa kunci urut kedua;
  pada dataset staging urutannya terbukti identik, tetapi spesifikasinya
  sama-sama tidak menjamin urutan seri. Bila suatu saat terbukti
  menyimpang, perbaikannya adalah kunci urut kedua yang eksplisit —
  perubahan perilaku yang harus diputuskan terpisah, bukan di PR ini.
- Beranda dingin tetap ±1,8–2,4 dtk di staging (hitung penuh cohortStats
  pertama + pemanasan cache halaman DB 3 GB) — di produksi bergantung
  pada IO host (konteks hang yang sudah dikenal); /healthz dan liveness
  tidak terpengaruh.
- `listFinished` membaca jam asli proses (bukan jam yang diteruskan) —
  perilaku lama, dipertahankan; tercatat agar tidak mengejutkan PR
  berikutnya.
