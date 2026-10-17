# Implementation Plan: Perbaikan ESLint Config Resolution (lint gate rusak)

> Catatan: plan ini work terpisah dari Dashboard Overhaul di `tasks/plan.md` / `tasks/todo.md`
> (masih 8 task unchecked, mid-build — sengaja TIDAK disentuh). Tasks work ini tercatat di
> `tasks/todo-lint-fix.md`.

## Overview

`npm run lint` gagal total sejak `ERR_MODULE_NOT_FOUND: Cannot find module
'eslint-config-next/core-web-vitals'`. Efeknya: quality gate ke-3 (build, tsc, lint) mati —
bukan cuma warning resolusi, tapi eslint sama sekali tak bisa jalan sehingga nol inspeksi kode.
Build dan `tsc --noEmit` hijau, git tree clean di `e74ce5d`.

## Root Cause (terverifikasi)

- `eslint.config.mjs` import bare specifier: `eslint-config-next/core-web-vitals` dan
  `eslint-config-next/typescript`.
- `eslint-config-next@14.2.35` tak punya `exports` map (`"exports": undefined`), jadi ESM
  resolver wajib eksplisit extension. File target tersedia (`core-web-vitals.js`,
  `typescript.js`); keduanya resolve via `import()` saat ditambah `.js` — sudah diuji langsung.
- Bukan regresi kode: config identik sejak commit awal `7b01b48`. Pemicu: `eslint-config-next`
  di-pin `^14.2.35` sementara runtime Next 16.4.0, lalu install/rebuild `node_modules` terakhir
  membuat bunyi resolver berubah.

## Architecture Decisions

1. **Fix minimal (2 baris), bukan upgrade dependency.** Menambah extension menyelesaikan akar
   masalah tanpa install paket baru (sesuai AGENTS.md: no new deps without permission).
2. **Jangan bump `eslint-config-next` ke Next 16** di task ini. Itu keputusan terpisah (bisa
   memunculkan aturan lint baru yang bikin daftar violation panjang) — dicatat sebagai Open
   Question, bukan dikerjakan diam-diam.
3. **Surgical:** hanya `eslint.config.mjs`. Tidak ada refactor, tidak ada file helper baru —
   KISS/YAGNI sesuai AGENTS.md.

## Task List

- [ ] Task 1: Tambah extension `.js` pada kedua import di `eslint.config.mjs`
- [ ] Task 2: Verifikasi `npm run lint` resolve & catat violation kode (bila ada)

### ✅ Checkpoint: `npm run lint` jalan (tanpa ERR_MODULE_NOT_FOUND) · build + tsc tetap hijau

## Risks & Mitigations

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Setelah resolve, muncul violation kode baru | Sedang | Catat jumlah & kategori; perbaikan violation = scope terpisah, tidak dicampur ke diff ini |
| Fix regress saat `node_modules` di-rebuild | Rendah | Package memang ekspos `.js` file sejak 14.x; eksplisit extension = resolusi paling stabil |

## Open Questions

1. Align `eslint-config-next` ke major Next 16 (biar aturan core-web-vitals sesuai runtime)? —
   rekomendasi: task terpisah setelah Task 1, biar violation baru bisa dinilai terpisah.
2. PowerShell ExecutionPolicy nge-block `npm.ps1`/`npx.ps1` (pakai `& npm.cmd` sebagai workaround).
   Mau di-set permanen (`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`)?
