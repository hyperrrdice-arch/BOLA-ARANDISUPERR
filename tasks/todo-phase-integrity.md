# TODO — Integrity Fixes Pasca-Review Pipeline (lihat tasks/plan-phase-integrity.md)

## ✅ STATUS AKHIR (2026-10-18) — Phase 1 & 2 selesai (Task 1-8), Phase 3 menunggu

**Phase 1 (commit `a024d08`, `c57303b`, `6c14b4e`):** cache tolak view fallback + marker `is_strictly_grounded` ke client · `v_snapshot_eval` guard skor NULL + `upsertOutcome` COALESCE · mapper tolak skor/status absen (3 script ingest ikut) · dataset kosong berisik + jalur rebuild terdokumentasi (opsi (b), keputusan gitignore dihormati).

**Phase 2 (commit `44cdf96`, `acb0067`):** trace planner di-stamp per step (race paralel beres + error path `run_quant_package` ter-wrap) · semua LLM call ber-timeout (180s/call, plafon loop 30 menit) · anti-leakage fail-closed saat `utc_date` absen · `sync-match-outcomes` format tanggal ISO + skor lokal tidak dibuang · value bet HANYA dari odds pasar nyata (1.95/1.88/fair-odds-model dihapus; BTTS/AH-DNB skip sampai ada field odds) · promote transaksi + cek 2 log · migrate: backup + transaksi + fallback determinan + RENAME (bukan DROP).

**Verifikasi:** `tsc` bersih · `next build` ✓ · 46/46 snapshot-db · 53/53 view-mapper · 19/19 stats-mapper · 11/11 upcoming-guard · planner-loop semua lolos · quant-scale semua lolos · snapshot-report bersih · lint delta bersih.

**Sisa:** uji manual 1 run `/api/agent` penuh (butuh kredit LLM provider) → verifikasi snapshot terisi marker di live. Phase 3 (Task 9-11) + deferred menunggu perintah.

## ✅ PHASE 3 SELESAI (2026-10-18) — commit `cb293df`, `15a811e`

**Run verification Phase 2 (sebelum Phase 3):** test-planner-loop (LLM asli) ✓ · test-value-bets baru 7/7 ✓ · fix ISO terbukti live (probe: 1 kandidat vs 0 dengan query lama) · `sync-match-outcomes` run nyata (skip jujur saat scheduled) · promote `--dry-run` bersih · migrate `--dry-run` bersih · battery penuh hijau.

**Task 9:** test fresh-clone-safe (skip dengan pesan saat store/fixture absen — tidak ada lagi TypeError mid-run), assert corpus global → assert baris uji, dead code test dibersihkan (`earliest`, import `AnalysisViewSchema`), `asserts cond` signature.
**Task 10:** komentar LCP `page.tsx` dikoreksi ke fakta PERF.md (delivery −11KB, LCP tidak berubah) · mojibake `sync-weekly-telemetry` · kolom `hit_rate` mati dihapus · `Boolean()` flags `matches/route` (2 tier) · `http-json` byte-length + Vary case-insensitive · comment-end `thestats-dataset`.
**Task 11:** `sync-match-outcomes` benar-benar memanggil `deriveMarketKey` (komentarnya dulu bohong) + guard ekuivalensi JS↔SQL di `test-snapshot-db` (48/48).

**Verifikasi final Phase 3:** `tsc` bersih · `next build` ✓ · 48/48 snapshot-db · 53/53 view-mapper · 19/19 stats-mapper · 10/10 upcoming-guard · http-json 12/12 · lint delta nol.

**Deferred / butuh keputusan user:**
- `scripts/ingest-rich-telemetry-pl.ts` — hapus (kandidat mati) atau dipakai lagi?
- Nit gzip `q=0` diabaikan (browser jarang kirim) — belum diperbaiki.
- Typecheck `scripts/` di CI.

---

## Task 1: Cache snapshot menolak view fallback + marker grounded ke client

**Description:** View hasil jalur fallback (berisi template karangan) di-persist lalu diservis dari cache 10 menit tanpa marker. Fix: `getFreshSnapshot` hanya mengembalikan baris `is_fallback = 0 AND is_grounded = 1`; hasil fallback tetap tersimpan ke history tapi tidak jadi sumber cache; `is_strictly_grounded` dibawa ke root `AnalysisView`.

**Acceptance criteria:**
- [ ] `getFreshSnapshot` filter `is_fallback = 0 AND is_grounded = 1`
- [ ] `AnalysisView` root punya field `is_strictly_grounded` (diisi dari `data_integrity_audit`), mapper + schema + test-view-mapper diperbarui
- [ ] Run fallback TETAP tersimpan (history) tapi request berikutnya tidak menerimanya dari cache

**Verification:**
- [ ] `npx.cmd tsx scripts/test-view-mapper.ts` hijau (assert baru untuk marker)
- [ ] `npx.cmd tsx scripts/test-snapshot-db.ts` hijau
- [ ] `npx.cmd tsc --noEmit` bersih

**Dependencies:** None
**Files:** `lib/db/analysis-snapshot.ts`, `app/api/agent/route.tsx`, `lib/view/analysis-view.ts`, `scripts/test-view-mapper.ts`
**Scope:** M

---

## Task 2: Guard NULL `v_snapshot_eval` + `upsertOutcome` jangan menimpa dengan NULL

**Description:** `hit_recommended`/`hit_panel` mengarang hasil saat skor NULL (BTTS_NO/O25/U25 dihitung menang, 1X2 kalah). Tambah guard `home_goals IS NULL OR away_goals IS NULL THEN NULL` sebagai branch pertama keempat CASE (hapus `COALESCE(...,0)`). Sekalian: `upsertOutcome` refresh tidak boleh menimpa kolom statistik terisi dengan NULL (`COALESCE(excluded.x, x)`).

**Acceptance criteria:**
- [ ] Skor NULL → `hit_recommended`/`hit_panel` NULL di SEMUA market key
- [ ] Konsisten dengan `v_snapshot_eval_market` (guard yang sudah benar)
- [ ] `upsertOutcome` mempertahankan `xg_home`/`stats_json` dst. saat fetch ulang lebih miskin
- [ ] Test baru di `test-snapshot-db.ts`: fixture finished + skor NULL → hit NULL (bukan 0/1)

**Verification:**
- [ ] `npx.cmd tsx scripts/test-snapshot-db.ts` hijau
- [ ] Probe SQL manual: baris outcome skor NULL → `hit_recommended IS NULL`

**Dependencies:** None
**Files:** `lib/db/analysis-snapshot.ts`, `scripts/test-snapshot-db.ts`
**Scope:** S

---

## Task 3: `stats-log-mapper` menolak skor/status absen + bereskan duplikasi ingest

**Description:** Mapper mengarang skor `0-0` + status `"finished"` saat payload kosong (melanggar kontrak header-nya sendiri). Skor/status wajib ada atau `return null`. Bug sama disalin di `scripts/ingest-rich-telemetry-pl.ts:271` dan `ingest-rich-telemetry-multileague.ts:325` — perbaiki keduanya (atau delegasikan ke mapper).

**Acceptance criteria:**
- [ ] Payload tanpa skor → mapper return null (skip), TIDAK menulis 0-0
- [ ] Payload tanpa status → return null (jangan default "finished")
- [ ] Test fixture skor-hilang ditambahkan di `test-stats-mapper.ts`
- [ ] Duplikasi di 2 script ingest memakai perilaku yang sama

**Verification:**
- [ ] `npx.cmd tsx scripts/test-stats-mapper.ts` hijau (termasuk fixture baru)
- [ ] `npx.cmd tsc --noEmit` bersih

**Dependencies:** None
**Files:** `lib/stats-log-mapper.ts`, `scripts/ingest-rich-telemetry-pl.ts`, `scripts/ingest-rich-telemetry-multileague.ts`, `scripts/test-stats-mapper.ts`
**Scope:** M

---

## Task 4: Pulihkan `thestats_dataset.db` + guard silent-empty

**Description:** DB telemetri 5.8MB dihapus dari VCS → fresh clone degradasi diam-diam (H2H/form kosong senyap, ratings fallback tanpa suara). Pilih salah satu: (a) commit ulang snapshot dari git history (`git show 4e260ec:data/thestats_dataset.db`), atau (b) dokumentasikan perintah rebuild persis + perbaiki lookback default. Apa pun pilihannya: tambah `console.warn` di `getLocalH2HMatches`/`getLocalRecentMatches` saat tabel kosong.

**Acceptance criteria:**
- [ ] Keputusan (a) atau (b) dieksekusi + didokumentasikan di ARCHITECTURE.md
- [ ] Query lokal kosong → warning eksplisit, bukan `return []` senyap
- [ ] Rebuild path teruji minimal sekali (kalau opsi b)

**Verification:**
- [ ] Fresh-state check: rename DB lokal sementara → consumer memberi suara
- [ ] `npx.cmd tsc --noEmit` bersih

**Dependencies:** None (tapi minta keputusan user dulu — lihat Open Questions)
**Files:** `data/thestats_dataset.db`, `lib/db/thestats-dataset.ts`, `ARCHITECTURE.md`, `scripts/sync-weekly-telemetry.ts`
**Scope:** S

---

## Checkpoint: Integritas

- [ ] `npx.cmd tsc --noEmit` bersih
- [ ] `test-snapshot-db` / `test-stats-mapper` / `test-view-mapper` hijau
- [ ] Probe: view evaluasi memberi NULL saat skor hilang
- [ ] Review dengan user sebelum Phase 2

---

## Task 5: Fix race stamping trace planner + timeout semua LLM call

**Description:** (a) `withCoverage` menstempel `traceSteps[last]` padahal tool call per step dieksekusi paralel → stamp berdasarkan `action` (atau enforce 1 tool/step). (b) `callModelWithFallback` + loop planner/editorial tidak punya timeout → gabung `AbortSignal.any([signal, AbortSignal.timeout(...)])`, samakan disiplin dengan jalur sindikat (180s + retry budget).

**Acceptance criteria:**
- [ ] Setiap trace step punya coverage/durasi miliknya sendiri walau 2 tool call dalam 1 step
- [ ] Semua LLM call punya timeout eksplisit (planner, editorial, dispatcher)
- [ ] Error path `run_quant_package` di-wrap `withCoverage` konsisten (Nit N2)

**Verification:**
- [ ] `npx.cmd tsx scripts/test-planner-loop.ts` hijau (tambah case 2 tool/step)
- [ ] `npx.cmd tsc --noEmit` bersih

**Dependencies:** None
**Files:** `lib/agent/planner.ts`, `lib/agent/llm.ts`, `scripts/test-planner-loop.ts`
**Scope:** M

---

## Task 6: Anti-leakage fail-closed + 2 fix `sync-match-outcomes`

**Description:** (a) `utc_date` absen → jangan pakai sumber lokal (fail-closed, jangan seluruh riwayat). (b) `sync-match-outcomes.ts:54` bandingkan sesama ISO (`new Date().toISOString()`). (c) `:165` jangan buang `matchRow` lokal saat fallback online gagal — cukup `statsJson = null`.

**Acceptance criteria:**
- [ ] `utc_date` kosong → form/H2H lokal dilewati + gap ditandai eksplisit
- [ ] Outcome kandidat dievaluasi di hari yang sama (bukan nunggu hari berikutnya)
- [ ] Skor lokal tetap terpakai saat online throw

**Verification:**
- [ ] `npx.cmd tsx scripts/test-upcoming-guard.ts` hijau
- [ ] Uji manual `--match` pada 1 match dengan skor lokal + offline

**Dependencies:** None
**Files:** `lib/stats-fetcher-agent.ts`, `lib/db/thestats-dataset.ts`, `scripts/sync-match-outcomes.ts`
**Scope:** S

---

## Task 7: Odds karangan tidak boleh jadi `recommended_odds`

**Description:** `planner.ts:141,148` (`|| 1.95`, `1.88`) menghasilkan EV/stake dari odds karangan yang terpersist ke snapshot. Market odds absen → `bookmaker_odds` null + exclude dari pick `recommended_*`, ATAU tambah kolom `odds_source: "market" | "proxy"`. Kunci kontraknya di DB SNAPSHOT.md (Open Questions).

**Acceptance criteria:**
- [ ] `recommended_odds` hanya terisi dari odds pasar nyata
- [ ] Odds proxy jelas ditandai (null atau `odds_source`)
- [ ] Backtest/outcome matching tidak memakai odds karangan sebagai closing

**Verification:**
- [ ] `npx.cmd tsx scripts/test-snapshot-db.ts` hijau (assert baru)
- [ ] Snapshot tanpa market odds → `recommended_odds IS NULL`

**Dependencies:** Task 2 (file yang sama)
**Files:** `lib/agent/planner.ts`, `lib/db/analysis-snapshot.ts`, `DB SNAPSHOT.md`
**Scope:** S

---

## Task 8: Transaksi `promote-upcoming` + jaring pengaman `migrate-analysis-runs`

**Description:** (a) `promote-upcoming-to-telemetry.ts` — bungkus 4 upsert dalam `BEGIN…COMMIT` per match + syarat `count(*) = 2` (cek `awayLog`) sebelum hapus baris upcoming. (b) `migrate-analysis-runs.ts` — backup file DB di awal, `RENAME` alih-alih `DROP`, fix duplikat rerun (baris `created_at` tak terparse jangan pakai timestamp baru).

**Acceptance criteria:**
- [ ] Crash di tengah promote tidak pernah meninggalkan log setengah jadi
- [ ] Migrasi punya backup + rollback path (rename table lama)
- [ ] Rerun migrasi idempotent (nol duplikat)

**Verification:**
- [ ] `npx.cmd tsx scripts/test-upcoming-guard.ts` hijau
- [ ] Uji migrasi di salinan DB, bukan DB asli

**Dependencies:** None
**Files:** `scripts/promote-upcoming-to-telemetry.ts`, `scripts/migrate-analysis-runs.ts`
**Scope:** S

---

## Checkpoint: Pipeline

- [ ] `npx.cmd tsx scripts/test-planner-loop.ts` hijau · `snapshot-report` jalan
- [ ] Uji manual 1 run `/api/agent` penuh → snapshot dengan marker benar

---

## Task 9: Robustness test suite

**Description:** `test-upcoming-guard.ts:68-71` de-reference `undefined` (assert tanpa assertion signature) → crash tanpa ringkasan. Test butuh DB lokal yang di-gitignore → gagal di fresh clone. Fix: `assert(cond): asserts cond` / early-return, skip-with-message saat fixture absen, jangan assert corpus global (`snapshotsCount >= 4`).

**Acceptance criteria:**
- [ ] Tidak ada test yang crash TypeError saat DB kosong (skip dengan pesan jelas)
- [ ] Assert tidak pernah mengandalkan jumlah corpus personal
- [ ] Dead code di test dibersihkan (`earliest`, import `AnalysisViewSchema`)

**Verification:**
- [ ] Jalankan semua `scripts/test-*.ts` dengan DB direname → semua skip bersih, exit 0/1 benar
- [ ] `npx.cmd eslint scripts/test-*.ts` tanpa warning baru

**Dependencies:** None
**Files:** `scripts/test-upcoming-guard.ts`, `scripts/test-snapshot-db.ts`, `scripts/test-view-mapper.ts`, `scripts/test-stats-mapper.ts`
**Scope:** M

---

## Task 10: Dead code + koreksi komentar

**Description:** Bersihkan yang sudah terverifikasi mati/menyesatkan: komentar LCP `page.tsx:29-32` (sesuaikan dengan PERF.md: delivery −11 KB, LCP tidak berubah), mojibake `sync-weekly-telemetry.ts:152`, kolom `hit_rate` mati `snapshot-report.ts:71`, `Boolean()` di `matches/route.ts:51-53`, `http-json.ts` `Buffer.byteLength` + vary case-insensitive, comment-end menempel `thestats-dataset.ts:534`.

**Acceptance criteria:**
- [ ] Semua item di daftar diperbaiki/dihapus
- [ ] Tidak ada perubahan perilaku selain yang terdaftar

**Verification:**
- [ ] `npx.cmd tsc --noEmit` bersih · `npx.cmd tsx scripts/test-http-json.ts` hijau
- [ ] `npx.cmd eslint <file tersentuh>` tanpa penambahan masalah

**Dependencies:** None
**Files:** `app/page.tsx`, `scripts/sync-weekly-telemetry.ts`, `scripts/snapshot-report.ts`, `app/api/matches/route.ts`, `lib/http-json.ts`, `lib/db/thestats-dataset.ts`
**Scope:** S

---

## Task 11: Sumber tunggal market key

**Description:** Konvensi market matching ada 3 salinan (VIEW SQL, `deriveMarketKey`, inline `sync-match-outcomes.ts:93-100`) dengan drift nyata (trim/regex vs LIKE). Pindahkan `sync-match-outcomes` ke pemakaian `deriveMarketKey` sungguhan; tambah test ekuivalensi JS↔SQL untuk satu fixture.

**Acceptance criteria:**
- [ ] `sync-match-outcomes` memanggil `deriveMarketKey`, tidak menyalin logika
- [ ] Test assert ekuivalensi JS↔SQL (minimal 1 fixture per market key)

**Verification:**
- [ ] `npx.cmd tsx scripts/test-snapshot-db.ts` hijau (assert ekuivalensi baru)

**Dependencies:** Task 2 (struktur VIEW yang sama)
**Files:** `scripts/sync-match-outcomes.ts`, `lib/db/analysis-snapshot.ts`, `scripts/test-snapshot-db.ts`
**Scope:** S

---

## Checkpoint: Final

- [ ] Semua test suite hijau di kondisi DB lengkap DAN kondisi DB kosong (skip bersih)
- [ ] Lint repo tidak lebih buruk dari baseline
- [ ] Commit terpisah per task dengan pesan yang menjelaskan "mengapa"
