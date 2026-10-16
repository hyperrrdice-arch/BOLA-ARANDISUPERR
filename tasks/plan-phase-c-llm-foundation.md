# Implementation Plan: Fase C — Fondasi LLM Layer

## Overview
Fondasi LLM sekarang terduplikasi di 4 file consumer: `createOpenAI` (4x), `customFetch`
(4x), dan 3 varian `extractJSON`. Nilai `MODEL_DEFAULT` juga tidak konsisten.
Fase ini menyatukan *plumbing*-nya tanpa mengubah perilaku model yang sudah bekerja.

Lingkup Fase C adalah **plumbing + konsistensi model**, bukan perubahan strategi
pemilihan model. Lihat "Keputusan Sadar" di bawah untuk alasan kenapa kebijakan
fallback TIDAK disatukan.

## Architecture Decisions

### 1. Kebijakan fallback sengaja TIDAK disatukan

Tiga call-site punya tiga kebijakan berbeda, dan masing-masing punya alasan benar.
Menyeragamkannya akan merusak jaminan independensi debat sindikat.

| Call-site | Kebijakan | Alasan (dari kode) |
|---|---|---|
| `lib/syndicate-orchestrator.ts` | Retry model **yang sama** 2x. Tidak ada substitusi. Kalau tetap gagal, kembalikan *teks error* (bukan throw). | Baris 176: *"Upaya pemanggilan model tanpa substitusi Gemini (Anti-Bias Jaminan Independensi Model)"*. Sindikat memakai 5 agent beda model; kalau Bull gagal lalu diganti ke model Neutral/Judgement, semua "sudut pandang beda" datang dari otak yang sama dan debat jadi palsu. |
| `app/api/agent/route.tsx` | Substitusi ke `MODEL_DEFAULT`. Throw kalau dua-duanya gagal. | Endpoint single-judgement, satu panggilan, tidak ada isu anti-bias. Gagal total lebih buruk daripada jawaban turun kualitas. |
| `app/api/betting/route.ts` | Substitusi ke `MODEL_DEFAULT`. Return `{success:false}` kalau dua-duanya gagal. | Menjalankan model A & B paralel lalu agregasi; satu kegagalan tidak boleh membunuh seluruh endpoint, dan tidak ada error path lain. |

Konsekuensi: helper bersama menyediakan **plumbing** (panggilan + retries + ekstraksi),
sedangkan **kebijakan** (retry-sama vs substitusi, throw vs teks-error) tetap eksplisit
di masing-masing call-site lewat parameter bernama.

### 2. `call9RouterDirect` tidak dihapus, hanya direlokasi
Fungsi ini menangani hal yang tidak dimiliki helper lain: `maxTokens` 16384, timeout
180 detik, payload native thinking (`reasoning_effort`, `thinking`), parsing SSE
manual, pemulihan `reasoning_content`, dan parsing respons ter-wrap Atria.
Menghapusnya berarti membuang semuanya. Fase ini memindahkannya ke `lib/llm/`
apa adanya, lalu membagikan `extractJSON` yang sama.

### 3. Secret tidak boleh punya fallback hardcode
`syndicate-orchestrator.ts:69` dan `stats-fetcher-agent.ts:34` masih memuat kunci sebagai
nilai cadangan. Karena kunci sudah ada di riwayat git remote, **pemutusan kredensial
adalah tanggung jawab pemilik repo**. Tugas kode di sini hanya menghapus fallback
supaya kegagalan env terlihat jelas, bukan diam-diam pakai kunci bocor.
Catatan operasional (rotasi) dicatat di plan ini, bukan dieksekusi agent.

### 4. Env var mati dibuang
`MODEL_ARBITER` dan `ODDSPAPI_*` dideklarasikan di `.env.example` tapi nol referensi di
kode. `MODEL_ARBITER` di-hardcode sebagai `MODEL_JUDGEMENT_1` di `agent/route.tsx:62`,
jadi variabel env-nya memang tidak pernah dipakai.

## Scope
- **Termasuk**: `lib/llm/` baru, migrasi 4 consumer, penghapusan fallback secret,
  pembuangan env var mati, parameter `--ref-date` untuk kalibrasi walk-forward.
- **Tidak termasuk**: Fase D data lintas liga (dikerjakan pemilik repo), rotasi
  kredensial, perubahan bobot musim/time-decay (perlu keputusan pemilik).

## Verifikasi
- `node_modules\.bin\tsc.cmd --noEmit` lolos.
- `scripts/verify-pl-pipeline.ts` tetap 100% PASS.
- `scripts/verify-foundation-phase-a.ts` tetap 46 PASS.
- `scripts/verify-foundation-phase-b.ts` tetap 20 PASS.
- Baru: `scripts/verify-foundation-phase-c.ts` (lihat Task C7).
