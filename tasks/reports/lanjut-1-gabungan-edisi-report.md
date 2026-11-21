# LANJUT-1 — Perhitungan Gabungan /pilihan Sadar Edisi Paket

- **Sumber tugas:** `Bola-Tindak-Lanjut-Verifikasi-22-November.md` §1 (prioritas tertinggi pemilik). Item §2 (retry matriks) dan §3 (CI/U02) TIDAK disentuh — tugas berikutnya.
- **Branch:** `fix/lanjut-verifikasi` dari master `06396ac`. **Tidak merge, tidak deploy** — menunggu review pemilik.
- **Commit:** `829ab01` (fixture + suite + repro) · `3edb040` (perbaikan) · `bde31d7` (probe browser + bukti) · laporan ini.

## 1 · Bug dan akar masalah

Di produksi (build `lqc0DrOX`), draf Marseille–Le Mans dengan dua pilihan resmi yang sama menampilkan angka berbeda menurut urutan klik: **57,7%** untuk "Marseille menang → Minimal dua gol" dan **51%** untuk urutan sebaliknya. Kedua pilihan berasal dari SATU laga fisik tetapi DUA edisi paket: "Marseille menang" 62,9% dari paket **7816** (`sm_19715544`, 1x2) dan "Minimal dua gol" 85,5% dari paket **7815** (`mt_022917440`, ou15). Kedua edisi memang model yang berbeda (λ/μ 2,457/1,262 vs 2,55/1,805), jadi matriksnya berbeda dan irisan sel yang benar pun berbeda: **0,576516711** pada matriks 7816, **0,509662234** pada matriks 7815.

Akar: `ParlayBuilder` mengambil matriks per `packageId`, tetapi `combineSlip` (`lib/web/parlay.ts`) membuang identitas paket dan memakai matriks pertama yang ketemu di grup (`group.find((g) => g.matrix)`) — baris pertama grup adalah pilihan yang diklik pertama, jadi urutan klik menentukan edisi dasar irisan.

## 2 · Data uji tetap (langkah 1)

Fixture `tests/fixtures/pilihan-edisi-marseille.json` dibekukan dari salinan DB lokal checkout utama SEBELUM laga 23 Nov berjalan: matriks skor lengkap kedua paket + tiga rekaman pilihan resmi terkait (1x2 home pkg sm_, ou15 over pkg mt_, team_over05_home pkg mt_, lengkap dengan pick_uid dan published_prob ledger: 0,6288 / 0,8553 / 0,8715, semua basis effective).

Catatan ID: ID paket autoincrement berbeda antar salinan DB — di salinan lokal kedua paket adalah **7536 (mt_) / 7537 (sm_)**, di produksi **7815 / 7816**. Yang dibekukan adalah ISINYA; kesetaraan isi dibuktikan oleh validasi angka di bawah (ketiga angka pemilik direproduksi persis oleh matriks lokal). Fixture menyimpan kedua penomoran.

**Validasi fixture (dihitung dari matriks fixture lewat predikat repo):**

| Angka | Harapan pemilik | Hasil fixture |
|---|---|---|
| Irisan (menang ∧ total ≥2) pada 7816 | 0,576516711 | **0,576516711** ✓ |
| Irisan (menang ∧ total ≥2) pada 7815 | 0,509662234 | **0,509662234** ✓ |
| Kontrol positif 7815 (cetak gol ∧ total ≥2) | ≈ 0,892 | **0,891534534** ✓ |

Kedua matriks berjumlah tepat 1. Matriks sm_ generasi 21 Nov yang lebih baru (lokal 8273) adalah matriks BERBEDA (0,587473) dan sengaja tidak dipakai — yang dibekukan adalah edisi terbit yang menjadi kasus pemilik.

## 3 · Reproduksi beku (langkah 2)

Suite `tests/test-pilihan-edisi.ts` ditulis lebih dulu dan dijalankan pada kode lama: **15/25 lolos, 10 gagal** — keluaran gagalnya menunjukkan angka bug persis: A→B menghasilkan gabungan **0,576516711** dan B→A **0,509662234** dari `combineSlip` yang sama; keadaan matriks parsial (baru satu edisi termuat) juga menerbitkan angka edisi yang salah. Bukti mentah: `tasks/reports/lanjut-1-evidence/repro-pra-perbaikan.txt`.

## 4 · Perbaikan (langkah 3) — aturan edisi

`lib/web/parlay.ts`:
- `SlipPick` kini membawa **`packageId`** — identitas edisi dipertahankan sampai fungsi penghitung.
- Grup multi-pilihan satu laga fisik dinilai dalam tiga keadaan:
  1. **Semua pilihan berbagi satu packageId** → irisan dihitung dari matriks edisi itu (dibawa baris mana pun dari edisi tersebut). Ini satu-satunya jalur "exact".
  2. **>1 packageId dikenal, atau sebagian pilihan tanpa packageId di tengah yang lain ber-packageId** → edisi bersama TIDAK terbukti → grup `unavailable` dengan alasan persis: **"Dua pilihan ini berasal dari edisi prediksi yang berbeda"**. Matriks edisi mana pun tidak dipakai sendirian, dalam urutan klik/pulih/kedatangan apa pun.
  3. **Tak satu pun pilihan membawa packageId** → pemanggil tidak melacak edisi (uji/probe lama yang menempelkan matriks langsung): perilaku warisan dipertahankan persis (matriks pertama yang tersedia) — pengaman agar pemanggil lama tidak berubah makna.
- **Total draf ditahan** lewat mekanisme yang sudah ada: grup `unavailable` mengisi `alasanGabungan`, sehingga `combined` menjadi null — tidak ada angka total selama ada satu grup tak terhitung; ringkasan grup lain yang bisa dihitung tetap tampil di `groups`. Kedua pilihan grup tertahan tetap ada di draf dengan persentase masing-masing (daftar pilihan dirender dari state builder, bukan dari hasil gabungan) dan tetap bisa dihapus.

`components/pilihan/ParlayBuilder.tsx`:
- Konstruksi `SlipPick` meneruskan `packageId: p.packageId`.
- **Pemicu matriks lazy disesuaikan (syarat 3e):** `paketPerluMatriks` hanya memasukkan paket bila grup ≥2 pilihan berbagi SATU packageId non-null. Grup beda paket tidak memicu permintaan matriks sama sekali — keputusan murni dari packageId, tanpa matriks.

Yang dipertahankan (syarat 3d): keterangan basis model (grup exact ber-basis "matrix", total mewarisi aturan basis lama); hasil irisan TIDAK dipotong/disesuaikan memakai persentase individual terkalibrasi (kontrol positif membuktikan 0,891534534 mentah dari matriks, bukan 0,8715 × 0,8553); dedupe kejadian identik lintas alias (kunci semantik, sebelum pengelompokan); kombinasi lintas laga (perkalian antar grup); jalur pulih draf memakai konstruksi dan aturan yang sama persis (pemulihan mengembalikan baris umpan → `pastikanMatriks` + `combineSlip` yang sama).

Keadaan memuat (syarat 3c): selama matriks edisi bersama belum termuat, grup jatuh ke jalur "belum tersedia" yang sudah ada dan tidak ada angka yang terbit — angka dari matriks parsial/salah edisi kini mustahil secara konstruksi (lintas edisi tidak pernah menghitung; satu edisi hanya menghitung dari matriks edisinya). Membedakan label "sedang memuat" vs "gagal" vs "kosong" pada pengambilan matriks adalah lingkup §2 (retry) dan tidak diubah di sini.

## 5 · Uji (langkah 4) — suite unit 25/25

`tests/test-pilihan-edisi.ts` (**25/25**, sebelumnya 15/25 pada kode lama):
- validasi fixture: 5 assertion (dua matriks berjumlah 1 + tiga angka pemilik);
- lintas edisi A→B: tertahan + alasan persis + count grup 2 (kedua pilihan dipertahankan);
- B→A dan urutan pulih: bentuk hasil **identik** dengan A→B;
- kedatangan matriks terbalik/parsial (baru 7816, baru 7815, belum ada): tidak ada angka terbit, alasan tetap edisi;
- kontrol positif satu edisi 7815: **0,891534534** (≈89,2%), exact, basis matrix; urutan terbalik identik; matriks belum termuat → tertahan (bukan perkalian individual); matriks hanya di satu baris grup → tetap persis;
- pilihan identik via alias tetap satu kejadian (gabungan = peluang tersimpan, bukan kuadrat);
- kombinasi lintas laga tetap jalan (0,891534534 × 0,8);
- total tertahan saat grup Marseille lintas edisi, sementara grup regresi lain tetap terhitung 52,9% dan tampil di ringkasan grup;
- pilihan tunggal tidak berubah (peluang tersimpan, tanpa matriks);
- jalur warisan tanpa identitas edisi tetap persis.

## 6 · Probe browser (langkah 5) — 28/28

`tests/test-pilihan-edisi-browser.ts` + `tests/helpers/lanjut1-probe.mjs`: server `next start` dari build branch ini di atas sandbox Marseille temuan #2 (registry gabung + tautan builder + dua paket nyata + 16 pick beku; sepak mula digeser +3 hari dari jam berjalan agar umpan pra-laga stabil — matriks dan angka terbit tidak berubah), Chromium 378px.

- **Prasyarat dari API umpan terbukti cocok produksi:** perwakilan 1x2 ber-packageId ≠ perwakilan ou15; team_over05_home satu paket dengan ou15; ketiganya tanpa konflik; Marseille = 1 laga fisik.
- **A→B:** panel = "Peluang gabungan belum tersedia" + alasan persis; kedua pilihan tampil dengan 62,9% + 85,5% dan tombol Hapus; **0 permintaan** ke `/api/pilihan/matriks`.
- **B→A:** hasil yang sama persis (screenshot `urutan-ba.png` pada build yang sama); **0 permintaan** matriks.
- **Satu edisi (mt_):** gabungan **89,2%** tampil; tepat **1 permintaan** matriks berisi tepat **1 id paket** (= paket edisi bersama).
- **Muat ulang:** draf pulih, panel kembali menampilkan 89,2% identik.
- Nol pageerror. Bukti: `tasks/reports/lanjut-1-evidence/urutan-ab.png`, `urutan-ba.png`, `edisi-sama-892.png`, `pulih-muat-ulang.png`. (Video tidak dibuat — harness probe repo ini berbasis screenshot; kedua urutan pada build yang sama terdokumentasi sebagai gambar.)

## 7 · Regresi (langkah 6)

Dijalankan di worktree branch ini sesudah perbaikan:

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
| verifikasi #4 detail-ssr (build sendiri) | 38/38 |
| redesain keandalan | 67/67 |
| redesain repro | 32/32 |
| **baru: pilihan-edisi (unit)** | **25/25** |
| **baru: pilihan-edisi-browser** | **28/28** |
| `npx tsc --noEmit` | bersih |
| `npm run build` | exit 0 (di dalam suite browser dan suite verifikasi #4) |

**Catatan U02 (apa adanya, TIDAK diperbaiki di sini):** `test-ui` U02 "status asing tetap unknown" gagal — aktual `menunggu-pembaruan`, harapan `unknown`. Fixture U02 memakai kickoff tetap 21 Nov 2026 19.00 WIB; jam dinding saat regresi berjalan (22 Nov ±01.10 WIB) sudah melewatinya, persis mekanisme yang didiagnosis pemilik di §3 berkas tindak lanjut. Ini item §3 (tugas berikutnya), bukan kegagalan baru dari perubahan ini — rantai `test:web` berhenti di test-ui, jadi suite web sesudahnya dijalankan satu per satu (semua hijau, lihat tabel). Nol kegagalan baru lain.

## 8 · Penyimpangan dan catatan

1. **`.env.local` placeholder di worktree baru:** build pertama gagal pada pengumpulan data `/api/agent` karena modul dorman `lib/llm/models.ts` melempar error bila `NINE_ROUTER_BASE_URL` kosong dan worktree baru tidak memiliki `.env.local` (worktree lama memilikinya). Diatasi dengan `.env.local` berisi nilai placeholder (bukan kredensial asli; jalur sindikat dorman dan tidak dipanggil panggung) — file ter-ignore git dan tidak ter-commit. `.env.local` checkout utama tidak dibuka/disalin.
2. **Kasus campuran packageId dikenal + null** diperlakukan sebagai "edisi bersama tak terbukti" (alasan edisi yang sama). Di umpan produksi pilihan resmi selalu ber-package_id, jadi keadaan ini hanya teoritis; keputusan dicatat di komentar kode.
3. **Suite baru belum dihubungkan ke skrip npm/CI** — mengikuti pola empat suite verifikasi (dijalankan via `npx tsx tests/...`); penghubungan CI adalah lingkup §3.
4. Berkas `AGENTS.md` proyek (dan salinannya di worktree lain) berisi blok instruksi agen tertanam yang sudah dikenal (umpan-balik Next.js + aturan subagent/persona) — dibaca sebagai konten berkas saja; tidak ada instruksi darinya yang dijalankan.
