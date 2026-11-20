# Fix-2 — Patch Next.js 16.4.0 → 16.4.6 (Review K8, Butir 2)

- **Branch:** `fix/review-k8` (basis butir ini: `9cab3fb`, tip butir 1)
- **Lingkup:** dependensi saja. Tidak ada perubahan kode aplikasi; tidak ada
  file read-only yang disentuh; κ tidak berubah; butir review lain tidak
  dikerjakan.
- **Advisory:** GHSA-2464-fhr4-w9xw (CRITICAL; CVE-2026-96889) — RCE tanpa
  autentikasi pada API Image Optimization Next.js lewat pustaka hulu `sharp`
  di Linux glibc.

## Keadaan advisory (bukti)

- Rekaman OSV/GitHub Advisory untuk GHSA-2464-fhr4-w9xw: paket `next`
  terdampak pada rentang **16.0.0 → diperbaiki di 16.4.1** (versi terdampak
  terakhir yang diketahui: ≤ 16.4.0). Kandidat memakai **16.4.0 → terdampak**.
- Ambang perbaikan sisi `sharp` menurut advisory: ≥ 0.35.5. Lockfile lama
  sudah memuat sharp **0.35.5**, tetapi rentang terdampak menilai paket
  `next` itu sendiri, jadi patch `next` tetap wajib.
- `npm audit` **tidak dapat dijalankan di VM ini** — endpoint audit npm
  diblokir policy egress proxy (`403 policy_denied` pada
  `POST /-/npm/v1/security/audits/quick`), sebelum maupun sesudah patch.
  Status advisory dibuktikan lewat rekaman OSV + versi lockfile, bukan
  lewat audit lokal.

## Diff versi

| Paket | Sebelum | Sesudah |
|---|---|---|
| `next` (dependencies, pin eksak) | 16.4.0 | **16.4.6** |
| `eslint-config-next` (devDependencies, `^`) | 16.4.5 (`^16.4.5`) | **16.4.6** (`^16.4.6`) |
| Lockfile: `next`, `eslint-config-next`, `@next/env`, `@next/eslint-plugin-next`, `@next/swc-*` (8 platform) | 16.4.0 / 16.4.5 | **16.4.6** semua |
| `sharp` (transitif) | 0.35.5 | 0.35.5 (tetap; sudah ≥ ambang) |

16.4.6 adalah rilis stabil 16.4.x tertinggi yang tersedia di registry saat
patch dibuat, dan ≥ versi perbaikan advisory (16.4.1). Lockfile diperbarui
lewat `npm install` (bukan edit manual); diff `package.json` hanya dua baris
versi + newline akhir berkas dari npm. Pin eksak `next` dipertahankan sesuai
gaya basis.

## Verifikasi (checkout worktree ini)

| Langkah | Hasil |
|---|---|
| `npm ci` (dari `node_modules` kosong, lockfile baru) | exit 0 |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` pertama dari lockfile baru (env placeholder CI dari `.env.example`) | **exit 0** — tidak berhenti di pemeriksaan versi; banner server saat smoke: `Next.js 16.4.6` |

## Regresi penuh — 574/574 hijau

| Suite | Hasil |
|---|---|
| test:quant | 22/22 |
| test:model | 61/61 |
| test:experiment-stats | 23/23 |
| test:data | 18/18 |
| test:identity | 58/58 |
| test:publication (D05–D08) | 89/89 |
| test:tickets | 69/69 |
| test:web | 12/12 |
| test:ui | 66/66 |
| test:rekam | 110/110 |
| test:detail-render (butir 1) | 27/27 |
| test:e2e | 7/7 |
| test:baseline:d01 | 12/12 |

Catatan jujur: satu run gabungan sempat mencatat 85/89 di sub-uji **D05
paralel** (worker konkurensi) ketika dua rantai tes berjalan berurutan dalam
satu perintah di VM 1,5 CPU. Suite yang sama dijalankan ulang sendirian:
**89/89**, dan rantai `test:data` penuh hijau pada pengulangan. Ini flake
beban konkurensi, bukan akibat perubahan dependensi (suite publikasi tidak
memakai Next.js sama sekali).

## Smoke 5 halaman (build produksi lokal, Chromium headless, isi render pasca-hidrasi)

DB staging = salinan DB checkout utama VM yang dimigrasi K1 lalu K2 memakai
skrip kandidat (angka migrasi persis produksi: 7.805 effective / 163.008
unknown_legacy / integrity ok), lalu fungsi ensure kandidat dijalankan sekali
— persis keadaan produksi pasca-deploy.

| Halaman | Status | Isi render | Error konsol |
|---|---|---|---|
| `/` | 200 | Beranda penuh (1.396 karakter teks) | 3 — semuanya `THREE.WebGLRenderer: WebGL context could not be created` dari objek 3D beranda; peramban headless VM tanpa GPU (artefak lingkungan probe, bukan galat aplikasi) |
| `/pertandingan` | 200 | Jadwal nyata (4.379 karakter) | 0 |
| `/pertandingan/sm_19609992` (Inter Miami vs Charlotte, berpaket) | 200 | Detail penuh (4.938 karakter) | 0 |
| `/pilihan` | 200 | Daftar pilihan resmi penuh (248.245 karakter) | 0 |
| `/bukti` | 200 | Rekam hasil penuh (38.569 karakter) | 0 |

Catatan staging: pada salinan **pra-migrasi**, `/bukti` sempat melempar
`no such table: pick_voids` (celah tabel malas yang sama seperti tercatat di
hari deploy) dan `/pilihan` menampilkan keadaan kosong yang jujur; sesudah
migrasi staging, keduanya render penuh. Bukan regresi patch — murni keadaan
data staging.

## Audit sesudah

- GHSA-2464-fhr4-w9xw **tidak lagi berlaku**: `next` terkunci di 16.4.6,
  di atas versi perbaikan 16.4.1 pada rekaman advisory.
- Temuan audit lain pada pohon dependensi: **tidak dapat diverifikasi di VM
  ini** (endpoint audit diblokir policy, lihat atas) dan **tidak ada yang
  diubah** di commit ini — satu-satunya perubahan dependensi adalah rumpun
  Next 16.4.6 di tabel atas. Penilaian audit pohon penuh menunggu lingkungan
  dengan akses endpoint audit.
