# TODO — Perbaikan ESLint Config Resolution (lihat tasks/plan-lint-fix.md)

> STATUS: Task 1 & 2 SELESAI (lint gate hidup). Tersisa: keputusan user soal 231 errors
> kode aktif + 495 errors di `archive/` + ignore patterns.

## Task 1: Align `eslint-config-next` ke Next 16 ✅ DONE
**Description:** `npm run lint` mati karena `eslint-config-next@14.2.35` ekspor format eslintrc lama
(`{extends:[...]}`, object) sehingga `...nextVitals` gagal `not iterable`. Docs Next 16
(`dist/docs/.../eslint.md` l.46) butuh flat-config array; 16.4.2 ekspor `module.exports = config`
(Linter.Config[]).
**Acceptance criteria:**
- [x] `eslint-config-next` → `16.4.2` (exact, align `next@16.4.0`)
- [x] `@next/eslint-plugin-next` auto-align ke 16.4.2
- [x] `npm run lint` resolve (tanpa `ERR_MODULE_NOT_FOUND` / `not iterable`)
- [x] `next build` + `tsc --noEmit` tetap hijau (nol regresi)
**Verification:** `& npm.cmd run lint` (jalan) · `& npm.cmd run build` (hijau) · tsc exit 0
**Dependencies:** None · **Files:** package.json, package-lock.json · **Size:** S

## Task 2: Lint gate hidup + katalog temuan ✅ DONE
**Description:** 956 problems (744 err / 212 warn). Breakdown setelah exclude non-aktif:
**kode aktif** (lib/app/components/scripts/types) = 231 err / 78 warn · **archive/** = 495 err (legacy)
**agents/** = 18 err (vendored skills) · **scripts** = 116 err.
**Acceptance criteria:**
- [x] Rule dominan: `@typescript-eslint/no-explicit-any` (217 di aktif, 553 total)
- [x] 495 dari `archive/` — legacy, bukan kode aktif, harus di-ignore
- [x] 18 dari `.agents/skills/**` — vendored, harus di-ignore
**Verification:** output `npm run lint` + breakdown per-dir
**Dependencies:** Task 1 · **Files:** none (read-only) · **Size:** XS

### ✅ Checkpoint: lint gate hidup · build + tsc hijau

## Task 3 (BARU, perlu keputusan user): Scoping + strategi 231 errors
**Description:** 231 errors kode aktif mayoritas `no-explicit-any` (217) di lib/scripts yang menangani
payload API eksternal + legacy telemetry (tidak di-scope plan Dashboard Overhaul).
**Open Questions:**
1. Tambah `archive/**` + `.agents/**` ke `globalIgnores`? (rekomendasi: ya — buang 513 noise)
2. 231 errors kode aktif: fix satu-satu (besar, 100+ file) ATAU tiered (blok `app/`+`components/` = 25+18, lalu lib, scripts belakangan)?
**Verification:** `npm run lint` target-scoped bersih
**Dependencies:** Task 2 · **Files:** eslint.config.mjs + src · **Size:** L (fix) / XS (ignore-only)
