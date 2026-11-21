# LANJUT-3 — Pulihkan CI & Masukkan Suite Verifikasi

**Berkas acuan:** `Bola-Tindak-Lanjut-Verifikasi-22-November.md` §3 (pemilik).
**Branch:** `fix/lanjut-verifikasi` · basis `60a6091` (LANJUT-2).
**Commit:** `4467b96` (U02) · `cbf4c50` (skrip/CI/browser terkunci) · laporan ini.
**Status:** selesai — CI hijau dari checkout bersih. Tidak di-merge, tidak di-deploy.

---

## 1 · U02 — jam uji dibekukan pada proses yang membaca jadwal

### Diagnosis (dibuktikan, bukan diasumsikan)

Suite `tests/test-ui.ts` pada kode lama, dijalankan pada jam dinding
22 Nov 2026 ±01.18 WIB: **73/74**, satu-satunya gagal
`U02: status asing tetap unknown`. Persis diagnosis pemilik: fixture
`sm_k6_unknown` berkickoff tetap 21 Nov 2026 19.00.00 WIB
(`2026-11-21T12:00:00.000Z`, status mentah asing `DIALIHOFF`), tetapi
`listSchedule` di `lib/web/data.ts` membaca `Date.now()` — sesudah
kickoff, dimensi waktu mengubah status terjadwal menjadi
`menunggu-pembaruan`.

### Jahitan jam

Pembacaan jadwal terjadi di **proses probe**
(`tests/helpers/ui-probe.ts`, subproses yang memanggil `listSchedule`,
`getMatchState`, `getMatchDetail`, `getFixtureInfo` terhadap sandbox).
Di proses itulah jam dibekukan:

- Suite meneruskan instant beku lewat env `UI_PROBE_NOW_MS`
  (`runScript(..., extraEnv)` yang sudah ada).
- Probe memasang `Date.now = () => <instant beku>` **sebelum**
  `lib/web/data` dimuat (impor diubah menjadi impor dinamis di dalam
  `main()` sesudah pembekuan). Semua fungsi yang dipanggil probe
  membaca jam hanya lewat `Date.now()` / `new Date(<argumen>)` —
  terverifikasi dari sumbernya; dua pemakaian `new Date()` tanpa
  argumen di `data.ts` berada di fungsi yang tidak dipanggil probe.
- Tanpa env, probe berperilaku lama (jam nyata). **Tidak ada satu pun
  perubahan di `lib/` atau kode produk** — perilaku produk dipertahankan
  persis; yang diperbaiki jam ujinya.

### Dua kasus eksplisit kedua sisi kickoff

| Probe | Jam beku | Kasus | Harapan | Hasil |
|---|---|---|---|---|
| utama | 18.59.59 WIB (`…T11:59:59Z`) | status asing **sebelum** kickoff | `unknown` | OK |
| kedua | 19.00.00 WIB tepat (`KICK.unknown`) | status asing **pada** kickoff | `menunggu-pembaruan` | OK |

Seluruh assertion lama (U01–U03) dinilai pada probe utama. Hasil:
**75/75** (74 lama + 1 kasus baru), lulus pada jam dinding sesudah
kickoff — kondisi yang sebelumnya menggagalkan suite — dan langkah
"Web adapter tests" di CI (yang memuat test-ui) kini hijau.

## 2 · Suite verifikasi + lanjut terhubung ke skrip & CI

### Skrip proyek (pola `test:*` yang ada)

| Skrip | Isi |
|---|---|
| `test:verifikasi` | genclerbirligi → marseille-detail → pilihan-payload → detail-ssr |
| `test:lanjut` | pilihan-edisi → pilihan-edisi-browser → pilihan-matriks-ulang |

Pengikutsertaan suite lanjut (edisi + probe browsernya +
matriks-ulang) adalah **perluasan §3 yang disengaja** — dilaporkan
sebagai itu: branch ini tidak boleh merge lagi dengan uji tak
terhubung.

### Dependensi browser terkunci di dalam checkout

- devDependencies **versi persis**: `puppeteer-core 25.16.0` +
  `@sparticuz/chromium 153.0.0` — versi yang sama dengan instalasi
  perkakas lokal terverifikasi (`~/workspace/tools/pwshot`);
  `package-lock.json` diperbarui, `npm ci` memasangnya di checkout
  bersih.
- `tests/helpers/browser-resolve.mjs` — resolver bersama: checkout
  dulu; `PWSHOT_DIR` hanya override eksplisit; **gagal keras** bila
  dependensi tidak tersedia (proses probe mati dengan error terbaca,
  suite gagal — tidak ada skip diam-diam). Ketiga probe
  (`lanjut1`, `lanjut2`, `verifikasi4`) kini memakai resolver ini;
  logika peluncuran per probe tidak berubah.
- Bukti tiga jalur resolver: tanpa `PWSHOT_DIR` → Chromium 153 dari
  node_modules checkout meluncur; `PWSHOT_DIR` valid → meluncur;
  `PWSHOT_DIR` rusak → exit 1 (gagal keras).
- Bukti ujung-ke-ujung lokal tanpa `PWSHOT_DIR`:
  `test:verifikasi` 39+36+41+38 lolos; `test:lanjut` 25+28+27 lolos —
  semua probe browser berjalan dari tumpukan dalam checkout.

### Workflow CI

Dua langkah baru sesudah D01 baseline dan sebelum Build:
"Verification suites" dan "Lanjut suites". Keduanya membawa env
placeholder yang sama dengan langkah Build, karena suite-suit itu
menjalankan `npm run build` internal di checkout (tanpa `.env.local`
di checkout bersih, build butuh variabel terisi — nilai placeholder
persis contoh `.env.example`, bukan kredensial).

## 3 · Bukti run bersih

### Regresi lokal penuh (branch ini, sebelum push)

| Suite | Hasil |
|---|---|
| lint:gate | exit 0 |
| tsc --noEmit | exit 0 |
| test:quant | 22+61+32+23 = 138/138 |
| test:data | 18+58+110+69+23 = 278/278 |
| test:web | 12 + **75 (test-ui)** + 110 + 27 + 25 + 35 + 50 + 63 = semua lolos |
| test:api | 42/42 |
| test:e2e | 7/7 |
| test:baseline:d01 | 12/12 |
| test:verifikasi | 39+36+41+38 = 154/154 |
| test:lanjut | 25+28+27 = 80/80 |
| redesain-keandalan | 67/67 |
| redesain-repro | 32/32 |
| npm run build (lokal) | exit 0 |

### Run GitHub Actions (checkout bersih)

**https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR/actions/runs/44935581558**
— commit `cbf4c50`, kesimpulan **success**. Status per langkah:

| Langkah | Status |
|---|---|
| Checkout / Setup Node / Install dependencies (`npm ci`) | success |
| Lint gate | success |
| TypeScript typecheck | success |
| Quant tests | success |
| Data tests | success |
| **Web adapter tests** (memuat U02) | **success** |
| API contract tests | success |
| E2E mini-pipe tests | success |
| D01 baseline | success |
| **Verification suites (verifikasi produksi #1–#4)** | **success** |
| **Lanjut suites (edisi paket + retry matriks)** | **success** |
| Build | success |

Run dipicu lewat **PR #1** (`fix/lanjut-verifikasi` → `main`) karena
workflow hanya berjalan pada push ke `main` / PR ke `main`; PR dibuka
sebagai pemicu bukti dan **tidak di-merge**. Run pada commit rilis
yang gagal sebelumnya (44921136237) berhenti di Web adapter tests
dengan langkah-langkah sesudahnya dilewati; run baru ini melewati
seluruh rantai dalam satu run yang sama.

## Penyimpangan & catatan

- Tidak ada perubahan kode produk sama sekali di tugas ini
  (`lib/`, `app/`, `components/` tidak disentuh).
- Screenshot bukti di `tasks/reports/lanjut-*-evidence/` yang
  ter-regenerasi saat suite dijalankan ulang dipulihkan ke versi
  commit — churn piksel bukan bagian perubahan ini.
- `npm install` lokal memakai `--ignore-scripts`; kedua paket baru
  tidak membutuhkan skrip pasang, dan `npm ci` standar di CI
  terbukti memasang + menjalankan seluruhnya (run di atas).
