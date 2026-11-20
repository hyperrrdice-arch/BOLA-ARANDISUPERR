# Laporan K1 — Identitas fixture + upsert hasil (D01–D04)

Format jawaban PR mengikuti `docs/plans/peningkatan-aplikasi-bola/05-kartu-muse.md`.

## 1. Tujuan kartu dan SHA awal

Kartu **K1 · Identitas & hasil** (bab data `01-data-api-ledger.md` D1/D2,
bab QA `04-qa-rilis.md` tabel D01–D04): satu resolver identitas untuk
impor dan baca; jadwal menjadi selesai dengan skor pada baris yang sudah
ada; histori koreksi utuh; D01–D04 lulus; migrasi ulang terbukti pada
salinan data produksi.

- SHA awal: `f1a91ea` (tip `prd/k0-ci-d01`, ter-push, belum merge).
- Branch: `prd/k1-identitas-hasil` (menumpuk di atas K0; `main` tidak
  disentuh; tidak ada deploy, tidak ada login server, tidak ada tulisan
  ke DB produksi).
- Konfirmasi pemilik: menjalankan git/npm/suite tsx/skrip migrasi sqlite
  di worktree ini disetujui eksplisit (branch baru = fallback aman).
- Lingkungan: Node v24.22.1 lokal, zona proses UTC untuk subprocess uji.

## 2. D01 sebelum → sesudah

Skenario `import_replay` acceptance.json, urutan penuh importer →
builder alias → resolver → adapter, dua kali (`tests/d01-scenario.ts`).

| Metrik | Harapan | Sebelum (K0, dari b9b3871) | Sesudah (K1) |
|---|---|---|---|
| pick ter-resolve | 2 | **0** | **2** |
| verdict | [hit, miss] | [] | [hit, miss] |
| laga fixture finished | 2 | 1 | 2 |
| log sisi tim | 4 | 2 | 4 |
| resolver run 1 examined/resolved | 2/2 | 2/0 | 2/2 |
| adapter sm_901 | 2–1 finished | null | {2, 1, finished: true} |
| adapter sm_902 | 0–1 finished | null | {0, 1, finished: true} |
| adapter fd_ Alpha | 2–1 finished | {2, 1, finished: **false**} | {2, 1, finished: true} |
| fixture kanonik (UID) | 2 | (tabel belum ada) | 2 |
| alias identitas | 4 | — | 4 |
| revisi hasil | 2 | — | 2 |
| keadaan run 2 | identik run 1 | identik | identik |

Lima titik putus terukur di K0 dan perbaikannya: (1) hasil Gamma/Delta
ditulis sebagai baris `fd_` baru → kini observasi hasil menulis skor+
status ke baris jangkar `sm_902` yang sudah `scheduled` lewat resolver;
(2) builder alias 0 tautan → grup kembar kini juga didaftarkan ke store
identitas persisten di dataset (file JSON tidak berubah formatnya);
(3) resolver examined=2/resolved=0 → 2/2 lewat jalur saudara identitas;
(4) adapter memeriksa `'FT'` → status dinormalisasi satu pintu
(`'FT'`/`'finished'`/dll. = final); (5) parser web mencari `groups` →
satu parser tervalidasi memahami bentuk sebenarnya `links[]` (dan
warisan `groups[]`), dipakai semua pembaca.

Baseline direkam ulang dari `76e9f36`; `d01-baseline.md` mempertahankan
log kegagalan K0 sebagai histori statis. `test:baseline:d01` kini
regresi wajib hijau: assertion harapan eksplisit + kesamaan persis
dengan baseline. Tanpa skip.

## 3. Status D02–D04 (suite `tests/test-identity.ts`, 58 assertion)

- **D02 LULUS (19 assertion).** Sandbox menyalin HANYA dua grup registry
  audit (`sm_19735411`, `sm_19735118` + alias fd_/mt_-nya); skor rekaan
  fixture 2–1 hanya di baris dataset fd_. Hasil: builder 3 tautan;
  store identitas tepat 2 UID / 5 alias; resolver examined 4, resolved
  **4/4**; semua outcome 2–1 hit (2 keputusan headline unik); probe web
  membaca {2, 1, finished: true} dari **kelima** id lama.
- **D03 LULUS (15 assertion).** Dua leg tim sama dalam dua hari tidak
  digabung (2 UID); babak berbeda di hari sama → ambigu
  `stage_or_leg_mismatch`; sisi tertukar → `sides_swapped`; dua kandidat
  tak terbedakan → `multiple_candidates`; tanggal tanpa jam →
  `date_only_kickoff`; keempatnya masuk antrean `identity_ambiguous`
  tanpa UID (settlement tertahan). Reschedule pada alias yang sama
  mempertahankan UID + ID lama dan memperbarui kickoff. Resolusi ulang
  dari koneksi DB baru: UID sama, tanpa fixture baru (idempoten).
- **D04 LULUS (24 assertion).** Urutan observasi acceptance: FT 1–0 →
  revisi 1, pick hit; `finished` 1–0 duplikat → tanpa revisi baru;
  koreksi FT 0–0 → revisi 2, pass koreksi resolver menilai ulang pick
  menjadi miss — histori pick kandang **[hit, miss]**, skor revisi 1
  (1–0) utuh di `result_revisions`; polling lama `scheduled`/null →
  `stale_ignored`, final tidak mundur. Piala: regulasi 1–1 + AET 2–1 →
  jangkar memakai 1–1 (1X2 `x` hit, `1` miss), skor AET tersimpan
  terpisah di revisi; observasi hanya-AET → `pending_score_basis`,
  jangkar tidak berskor. Cancelled → resolver menandai pick void:
  baris `pick_voids` berisi UID + alasan `provider_cancelled` + versi
  aturan `k1-2026-11` (SETTLEMENT_POLICY_VERSION), tanpa outcome, dan
  tidak diperiksa ulang pada run berikutnya.

Satu fungsi `evaluatePick` di `lib/picks/ledger.ts` tetap satu-satunya
sumber semantik pasar; tidak ada duplikasi penilaian di kode baru.

## 4. File produser/pembaca yang berubah

**Baru:**
- `lib/identity/fixture-resolver.ts` — resolver satu pintu: normalisasi
  status/skor, parser tautan tervalidasi, skema identitas aditif
  (`canonical_fixtures`, `fixture_aliases`, `fixture_identity_queue`,
  `result_revisions`), algoritme pencocokan D1, observasi hasil D2.
- `scripts/migrate-fixture-identity.ts` — backfill identitas dari data
  historis (aditif, idempoten, konflik skor → antrean, bukan ditebak).
- `tests/test-identity.ts` — suite D02–D04 (dirangkai ke `test:data`).

**Diubah (produser/pembaca):**
- `scripts/import-free-feed.ts` — hasil final di-upsert ke baris jangkar
  lewat resolver (bukan baris duplikat sumber lain); jembatan hasil dan
  fixture mendaftarkan alias; log telemetri ditulis per jangkar
  (tally `telemetry_rows` D01 run 1 kini 4: 2 insert + 2 jembatan).
- `scripts/build-fixture-links.ts` — output JSON byte-compatible;
  grup kembar ≥2 didaftarkan ke store identitas bila dataset ada.
- `scripts/resolve-pick-outcomes.ts` — parser bersama + saudara
  identitas; pass koreksi (`corrected: N`); void untuk fixture
  cancelled (`voided: N`); baris `examined:`/`resolved:` dipertahankan.
- `lib/web/data.ts` — `getResult` memakai saudara dari parser bersama ∪
  store identitas; flag `finished` dari normalisasi status.
- `lib/picks/ledger.ts` — aditif saja: tabel `pick_voids` +
  `markPickVoid`/`listVoidedPickIds`/`getPickVoid`.
- Tes/baseline: `tests/d01-scenario.ts` (metrik identitas),
  `tests/helpers/scenarios.ts` (builder sandbox D02),
  `tests/record-d01-baseline.ts` + `tests/test-baseline-d01.ts`
  (histori K0 + regresi hijau), `tests/baseline/d01-baseline.json/.md`
  (rekam ulang), `package.json` (`test:data` merangkai test-identity),
  `.github/workflows/ci.yml` (redaksi langkah baseline saja).

**Sengaja TIDAK disentuh:** `scripts/pick-slate.ts` — parser tautannya
khusus `mt_` dan sudah membaca bentuk `links[]` yang benar; bukan titik
putus terukur (aturan bedah: yang sehat tidak dibongkar). File read-only
(`lib/agent/*`, `lib/coverage.ts`, `lib/syndicate-orchestrator.ts`,
`lib/llm/*`) tidak disentuh; `.env.local` tidak dibuka.

## 5. Bukti migrasi (salinan konsisten, BUKAN produksi)

Salinan dibuat dengan `sqlite3 .backup` dari DB produksi VM ke
`~/workspace/coding/k1-migration-proof/data/` (+ `fixture-links.json`,
`team-canonical.json`). Produksi tidak pernah dibuka untuk ditulis —
sha256 ketiga DB identik sebelum dan sesudah seluruh pembuktian
(dataset `dcca3963…`, upcoming `566af8e5…`, picks `9eeb3018…`).

| Ukuran | Sebelum | Sesudah migrasi |
|---|---|---|
| integrity_check dataset / picks | ok / ok | ok / ok |
| baris `matches` | 71.503 | **71.503 (tidak berubah)** |
| `matches` finished | 71.503 | 71.503 |
| log telemetri | 88.299 | 88.299 |
| katalog upcoming | 3.924 | 3.924 |
| picks / outcomes | 170.782 / 164.329 | tidak disentuh migrasi |
| `canonical_fixtures` | — | **70.420** |
| `fixture_aliases` | — | **71.832** |
| `result_revisions` (backfill rev 1) | — | **70.279** |
| antrean `identity_ambiguous` | — | **32** (konflik skor antar baris satu komponen) |

Migrasi run 1 (34,4 dtk): 71.503 baris laga → 70.420 komponen/fixtures
(1.083 penggabungan lintas id), 71.832 alias tertaut, 70.279 revisi
backfill, 32 konflik skor masuk antrean untuk tinjauan manusia (jangkar
fd_ didahulukan sebagai otoritas era bebas; tidak dipilih diam-diam).
Run 2: `already_registered = 70.420`, 0 dibuat/tertaut/backfill/antre —
**idempoten penuh**. Baris historis tidak diubah: migrasi hanya menambah
tabel baru; 141 komponen tanpa jangkar finished berskor tidak mendapat
revisi (keadaan tidak diketahui tidak dikarang).

Perbandingan baca lama-vs-baru pada data nyata (probe adapter,
`tests/helpers/web-probe.ts`, cwd = salinan):

| ID | Kode lama (K0) | Kode K1 + store termigrasi |
|---|---|---|
| `sm_19735411` | null | {2, 0, finished: true} |
| `fd_D2_20261107_1-fc-nurnberg_sv-darmstadt-98` | {2, 0, finished: **false**} | {2, 0, finished: true} |
| `sm_19735118` | null | {1, 2, finished: true} |
| `fd_D1_20261108_1-fc-koln_bayer-leverkusen` | {1, 2, finished: **false**} | {1, 2, finished: true} |
| `mt_466402698` | null | {1, 2, finished: true} |

(Skor produksi nyata grup D2 = 2–0 dan D1 = 1–2; skor 2–1 di acceptance
adalah rekaan fixture.) Kedua grup berbagi satu UID per grup sesudah
migrasi: grup 1 `fx_1a788bd6-6c23-40ff-8b2a-018aa0e8d84e`, grup 2
`fx_69ec001c-1a81-417b-8c7f-faf92b89db73`. `ledgerStats` tidak berubah
(live 7.774, ter-resolve 1.321) — migrasi tidak menyentuh ledger.

## 6. Verifikasi (semua di worktree K1)

| Perintah | Exit | Hasil |
|---|---|---|
| `npx --no-install tsc --noEmit` | 0 | bersih |
| `npm run test:quant` | 0 | 22/22 assertion |
| `npm run test:data` | 0 | test-data 18/18 + test-identity 58/58 |
| `npm run test:web` | 0 | 12/12 assertion |
| `npm run test:e2e` | 0 | 7/7 assertion |
| `npm run test:baseline:d01` | 0 | 12/12 assertion |
| `npm run build` (env placeholder CI) | 0 | route table terbit penuh |
| eslint pada file yang diubah K1 | 0 | 0 error (lint repo utuh tetap merah oleh utang lama pra-K0 — tidak bertambah) |

Suite `test:data` dan `test:e2e` dijalankan **2×** dengan hasil identik
(18/18 + 58/58 dan 7/7 pada kedua run).

## 7. Cara kembali & yang belum terbukti

- **Cara kembali:** jangan merge branch ini. K0 tetap di
  `prd/k0-ci-d01` (`f1a91ea`); produksi tidak berubah sama sekali oleh
  K1. Skema migrasi bersifat aditif (4 tabel identitas + `pick_voids`);
  membuang kelima tabel itu mengembalikan skema lama persis.
- **Belum terbukti (menunggu review pemilik):** menjalankan
  `migrate-fixture-identity.ts` pada DB produksi dan deploy branch ini;
  peninjauan 32 komponen konflik skor dari bukti migrasi; perilaku
  rantai refresh langsung (12 jam) dengan kode K1 di VPS — tidak
  dijalankan di kartu ini sesuai batas tugas (tanpa login server).
