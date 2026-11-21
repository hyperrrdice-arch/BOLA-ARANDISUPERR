# Verifikasi Produksi — Temuan #1: Gençlerbirliği–Gaziantep tampil ganda (fd_ ↔ sm_)

- **Branch:** `fix/verifikasi-produksi` dari master `a7bc8cb` (worktree `app-football-verifikasi`). **Tidak di-merge, tidak di-deploy, produksi/VPS tidak disentuh.**
- **Sumber temuan:** `Verifikasi-Produksi-Bola-untuk-Muse.md` bagian 1 (pemilik, produksi 21 Nov 2026 16.56–17.05 WIB, build `mb8qnWesaTQ9cIg5djR8j`).
- **Status: SELESAI di branch** — semua kriteria penerimaan pemilik terpenuhi di harness beku; menunggu keputusan pemilik untuk merge/deploy.

## 1. Reproduksi (langkah 1) — cocok persis dengan deskripsi pemilik

Suite baru `tests/test-verifikasi-genclerbirligi.ts` memakai ekstrak nyata beku
(`tests/fixtures/verifikasi/`: 4 baris katalog asli, 2 paket asli, 5 entri registry pra-gabung)
dan jam beku sebelum kickoff. Fase PRA (registry terbelah + store identitas apa adanya)
membuktikan keadaan salahnya pada harness yang sama seperti uji redesain:

- kejadian "tim kandang mencetak gol" tampil **2 kali**, berkunci dua laga fisik berbeda
  (fixture_uid tersimpan `fx_59ea…` untuk sisi fd_, `sm_19746551` untuk sisi sm_);
- tambah dari kedua baris → **2 kelompok laga, gabungan 0,5794 ≈ 57,9%** (= 0,7612²) — angka pemilik;
- total umpan 6 kejadian (3 pasar × 2 baris), tanpa konflik (kedua edisi sepakat di pasar ini).

Fase PASCA pada kode pra-perbaikan gagal 19 assertion — termasuk dua bukti diagnostik penting:
observasi resolver sisi fd_ berstatus **`ambiguous`** dan observasi sisi sm_ **`created`**
(membuat fixture kedua). Artinya penautan naif saja tidak akan cukup (lihat §2 butir 4).

## 2. Akar masalah (langkah 2) — empat mata rantai

1. **Registry klub terbelah** (`data/team-canonical.json`): Gaziantep punya DUA entri kanonik —
   `fd_gaziantep` (member football-data saja, nama "Gaziantep") dan `sm:4192`
   ("Gaziantep F.K.", member sportmonks saja). Gelombang 5 (redesain langkah 2) membuktikan
   gabung dari katalog saat itu; pasangan ini belum terbukti waktu itu. Hal yang sama pada
   lawan di fixture kembar kedua: Kasımpaşa terbelah `sm:1071` vs `tm_master_kasimpasa`.
   Gençlerbirliği sendiri sehat (satu entri `sm:286`).
2. **Pembangun tautan tidak bisa menautkan** (`scripts/build-fixture-links.ts`): grup kembar
   dikunci `utc_date|homeCid|awayCid` dari registry. Baris fd_ menyelesaikan Gaziantep ke
   `fd_gaziantep`, baris sm_ ke `sm:4192` → kunci grup berbeda → tidak ada grup kembar →
   `data/fixture-links.json` ter-commit (260 tautan) tidak memuat pasangan ini.
3. **Store identitas ikut terbelah**: importer fd_ (`scripts/import-free-feed.ts`) membuat
   fixture sendiri untuk baris fd_ (lokal `fx_59ea2a4b-…`; produksi `fx_a8e993ea-…` menurut
   berkas pemilik) karena jembatan gagal oleh sebab yang sama; sisi sm_ tidak pernah
   memperoleh alias/fixture.
4. **Kunci fisik penyajian mengikuti fixture_uid tersimpan** (`lib/web/rekam.ts`,
   `kunciFisik`: UID tersimpan → peta alias untuk baris NULL-UID → match_id). Pick fd_
   membawa UID tersimpan; pick sm_ tidak, dan tanpa alias ia jatuh ke match_id — dua kunci
   fisik untuk satu laga → `combineSlip` menghitung 2 kelompok → 0,7612² = 57,9%.
   Lapis kunci semantik sendiri sehat (terbukti: tambah dua kali dengan kunci yang sama
   tetap ter-dedupe bahkan dalam keadaan rusak). Mata rantai tambahan: cid tersimpan
   fixture fd_ (`fd_gaziantep`) sudah tidak dikenal registry gabung, sehingga validasi
   resolver menandainya konflik tim — hasil pertandingan tidak akan pernah menempel
   ke fixture itu tanpa pemulihan cid.

## 3. Perbaikan (langkah 3) — jalur yang sama dengan kasus Marseille

- **Gelombang 6 di `scripts/build-team-canonical.ts`** (`MERGE_PAIRS`, bukti fixture kembar,
  bukan kemiripan nama): `fd_gaziantep → 4192` (fixture kembar Süper Lig vs Gençlerbirliği
  2026-11-21T10:30Z dan vs Kasımpaşa 2026-11-06T17:00Z — kickoff identik, sisi lain kanonik
  sama, peluang terbit kejadian yang sama identik 0,7612) dan `tm_master_kasimpasa → 1071`
  (fixture kembar 2026-11-06T17:00Z yang sama). Registry dibangun ulang oleh builder:
  **6.543 → 6.541 tim**, diff adopsi tepat dua gabung itu (entri `fd_gaziantep` dan
  `tm_master_kasimpasa` hilang; member+alias menyatu ke `sm:4192`/`sm:1071`), nol perubahan lain.
- **Konvergensi di `scripts/build-fixture-links.ts`**: grup kembar yang sudah punya tepat
  satu fixture fisik (dari member mana pun) kini menautkan SEMUA alias grup ke UID yang
  sudah ada itu — builder tidak lagi membuat fixture kedua untuk baris kanonik, karena
  pick terbit membawa fixture_uid tersimpan sebagai kunci fisik. Ditambah **pemulihan cid**:
  cid tersimpan yang menurut registry saat ini adalah member dari cid grup ditulis ulang
  ke cid grup (klub yang sama, terbukti oleh registry); cid yang menunjuk klub lain tidak
  disentuh. Jalur resolver lama tetap dipakai untuk grup tanpa fixture / milik kanonik.
- **Tautan dibangun ulang**: `data/fixture-links.json` 260 → **308 baris kembar**
  (+45 pertumbuhan katalog 21 Nov, +3 dari gabung gelombang 6, 0 hilang). Yang +3:
  `fd_T1_20261121_genclerbirligi_gaziantep → sm_19746551`,
  `fd_T1_20261106_gaziantep_kasimpasa → sm_19746564`, dan bonus sah
  `fd_T1_20261122_kasimpasa_alanyaspor → sm_19746554` (kickoff identik 2026-11-22T13:00Z,
  Alanyaspor id 347 sama di kedua baris — terverifikasi manual di katalog).
- **Riwayat edisi + tautan lama terpelihara**: UID fixture fd_ yang sudah ada menjadi
  kunci bersama; kedua URL detail lama menyelesaikan ke laga yang sama
  (`getSiblingIds` dua arah ter-assertion). Kompetisi fixture tetap catatan importer
  (`T1`) — tidak ditulis ulang. Pasar lain dengan angka resmi berbeda mengikuti kebijakan
  konflik yang sudah ada: DC 1X fd_ 0,6855 vs sm_ 0,7271 **ditahan sebagai konflik berjejak**
  (kedua alias disebut), tidak dipilih diam-diam.

## 4. Bukti regresi (langkah 5)

Suite verifikasi (39 assertion): Fase PRA 10/10 membuktikan defek; Fase PASCA 39/39 hijau:

- umpan pra-laga: 6 → **3 kejadian**; "tim kandang mencetak gol" **1 kali, 0,7612 (76,1%)**,
  berkunci fixture yang sudah ada; tambah lewat dua alias / dua kali → **1 kelompok, 76,1%**,
  termasuk logika muat-ulang draf (draf hanya menyimpan id + kunci semantik);
- slip semua kejadian bersih: 2 pilihan dalam **1 kelompok laga fisik** (joint ≤ marginal);
- dua laga fisik yang benar-benar berbeda tetap terhitung dua (pasangan balikan 2027
  berbagi UID-nya sendiri, berbeda dari laga 21 Nov);
- kontrol negatif tetap terpisah: klub senama beda negara (Everton 13 vs 15064),
  senior vs tim II (594 vs 9656), tanggal berbeda — tidak tertaut, tidak berbagi fixture;
- store identitas: kedua alias 21 Nov → `fx_59ea…`, kedua alias 6 Nov → `fx_9cf0…`;
  cid terpulihkan (`fd_gaziantep → sm:4192`; `tm_master_kasimpasa → sm:1071`);
  observasi resolver kedua sumber + 6 Nov semuanya `known` ke fixture yang sama.

Suite penuh proyek di branch ini:

| Suite | Hasil |
|---|---|
| test:quant | 138/138 |
| test:data | 278/278 |
| test:web | 395/396 — lihat catatan U02 di bawah |
| test:api | 42/42 |
| test:e2e | 7/7 |
| test:baseline:d01 | 12/12 |
| redesain-keandalan (Kasus R diperbarui: 6.541 + assertion baru) | 67/67 |
| redesain-repro | 32/32 |
| verifikasi-genclerbirligi (baru) | 39/39 |
| `tsc --noEmit` | bersih |
| `npm run build` | berhasil (BUILD_ID `KPgS-YhnCjjceTb2kqJwk`) |
| `npm run lint:gate` | LOLOS — 91 error ≤ baseline 92, tanpa error baru |

**Catatan U02 (bukan dari branch ini):** `test-ui` assertion "U02: status asing tetap
unknown" gagal (aktual `menunggu-pembaruan`) — dan gagal **identik di master murni
`a7bc8cb`**. Kegagalan bawaan master, di luar cakupan temuan #1; tidak diperbaiki di sini
(aturan bedah: hanya yang terukur rusak dalam lingkup tugas), dilaporkan untuk keputusan pemilik.

## 5. Dampak arsip — BACA-SAJA (langkah 4), tanpa koreksi/migrasi apa pun

Basis: salinan dev VM (produksi dapat berbeda — pemilik mengamati kedua sisi terbit di
produksi; UID fd_ produksi `fx_a8e993ea-…`). Dihitung 2026-11-21 dari `data/picks.db`
dan store identitas dataset, mode read-only:

| Pasangan | Sisi | Pick | Terbit (pick_uid) | Sudah dinilai |
|---|---|---|---|---|
| 21 Nov (temuan #1) | fd_ | 6 | **6** | 0 |
| 21 Nov | sm_ | 6 | 0 (lokal) | 0 |
| 6 Nov | fd_ | 0 | 0 | 0 |
| 6 Nov | sm_ | 7 | 0 | **7 (5 hit)** — tercatat atas id sm_ |
| 22 Nov | fd_ | 6 | **6** | 0 |
| 22 Nov | sm_ | 6 | 0 | 0 |

Store identitas: tepat 1 fixture + 1 alias per pasangan, semuanya sisi fd_
(basis `created`, pertama terlihat 2026-11-21T09:21:52Z); sisi sm_ tidak punya alias.
Sesudah branch ini di-deploy, satu putaran refresh menjalankan builder tautan yang akan
menautkan alias sm_ ke fixture fd_ yang sudah ada dan memulihkan cid-nya secara otomatis.
Catatan historis (termasuk 7 outcome 6 Nov) tetap apa adanya — perubahan apa pun atasnya
adalah keputusan pemilik; branch ini tidak mengusulkan koreksi.

## 6. Sisa risiko

- **Kedua sisi sudah punya fixture:** bila suatu pasangan kembar kelak ditemukan dengan
  fixture tersimpan di KEDUA sisi (≥2 UID berbeda), konvergensi tidak memindahkan pick
  yang membawa UID tersimpan di sisi yang kalah — alias tertaut ulang, tetapi kunci fisik
  pick lama tetap UID-nya. Kasus temuan ini tidak mengalaminya (sisi sm_ tanpa fixture
  di lokal maupun produksi), namun pasangan masa depan dengan pola itu butuh keputusan
  migrasi tersendiri dari pemilik.
- **SK Beveren tetap ditahan:** pemindaian kelas yang sama menemukan kembali satu-satunya
  kandidat lain, SK Beveren (`sm:1272` vs `sm:6723`) — kasus yang oleh redesain langkah 2
  dinyatakan belum terbukti. Tidak digabung di branch ini.
- **Produksi belum berubah** sampai pemilik memutuskan merge + deploy; sesudah deploy,
  konvergensi store identitas produksi terjadi pada putaran builder berikutnya
  (rantai refresh), bukan seketika.

## 7. Commit di branch ini

1. `6c2e7e7` — test(verifikasi): reproduksi beku temuan #1.
2. `7099289` — fix(registry): gelombang 6 gabung Gaziantep + Kasımpaşa.
3. `6a8f079` — fix(links): konvergensi builder + tautan dibangun ulang.
4. `46bf0fc` — test(keandalan): Kasus R mengikuti gelombang 6.
5. Commit laporan ini.
