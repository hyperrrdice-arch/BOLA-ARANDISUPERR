# Implementation Plan: Integrity Fixes Pasca-Review Pipeline (18 Okt 2026)

## Overview

Review ulang diff `4e260ec..HEAD` (29 commit, 44 file, +4401 baris — snapshot store, upcoming fixtures, perf delivery, vault sync) menemukan **3 Critical, 11 Required, dan sejumlah Nit**. Mayoritas berkumpul di satu tema: **perubahan baru melanggar kembali kontrak honest-nulls** yang sebelumnya sudah ditegakkan (view fallback ter-cache tanpa marker, skor 0-karangan di mapper, skor NULL dihitung menang/kalah di view evaluasi, odds karangan terpersist sebagai `recommended_odds`). Rencana ini menutup blocker integritas dulu, lalu correctness pipeline, lalu hygiene.

## Temuan (severity, ringkas — bukti lengkap di commit review)

### 🔴 Critical (blocks)
1. **View fallback (template karangan) di-persist + diservis dari cache 10 menit tanpa marker** — `app/api/agent/route.tsx:474-485` persist `isFallback: true`, tapi `getFreshSnapshot` (`lib/db/analysis-snapshot.ts:548-557`) tidak filter `is_fallback`/`is_grounded`; view tidak membawa `is_strictly_grounded`. Konten template (prediksi/keyakinan/alasan/pemain fiktif) diterima client sebagai analisis model. *(Terverifikasi langsung.)*
2. **`v_snapshot_eval` mengarang hasil saat skor NULL** — `lib/db/analysis-snapshot.ts:283-306`: `hit_recommended`/`hit_panel` tanpa guard NULL (padahal `actual_result:269` punya); `COALESCE(goals,0)` membuat `BTTS_NO/O25/U25` dihitung MENANG saat skor hilang, `1X2` dihitung KALAH. Terbukti via probe SQL. Latent (writer menolak) tapi `upsertOutcome` publik; begitu masuk, angka evaluasi tercemar permanen (append-only).
3. **`data/thestats_dataset.db` (5.8MB, 434 match + 868 log) dihapus dari VCS** — fresh clone: H2H/form kosong senyap, ratings fallback diam-diam, special markets sample 0. Jalur rebuild tidak utuh (`sync-weekly-telemetry` default lookback 8 hari).

### Required (no prefix)
4. `lib/stats-log-mapper.ts:44,82` mengarang skor `0-0` + status `"finished"` — melanggar kontrak di header-nya sendiri; duplikat bug di `scripts/ingest-rich-telemetry-*.ts`. *(Dilaporkan 2 reviewer independen.)*
5. Race planner: tool call paralel per step, tapi `withCoverage` menstempel step TERAKHIR (`lib/agent/planner.ts:271-280`) → trace/timing salah + state race antar tool.
6. LLM call planner/editorial tanpa timeout (`lib/agent/llm.ts:46-65`) — jalur sindikat punya timeout 180s, jalur ini tidak.
7. Anti-leakage cutoff fail-open: `utc_date` absen → cutoff `null` → form/H2H pakai seluruh riwayat termasuk masa depan (`lib/stats-fetcher-agent.ts:242` + `thestats-dataset.ts:561,602`).
8. Odds karangan (`planner.ts:141,148`: `|| 1.95`, `1.88`) mengalir ke `recommended_odds`/`ev`/`stake` snapshot — kolom DB berisi angka buatan bandar mana pun.
9. `scripts/sync-match-outcomes.ts:54` — format-campur ISO vs `datetime('now')` → outcome sync tertunda sampai hari berikutnya.
10. `sync-match-outcomes.ts:165` — fallback online gagal membuang skor lokal yang valid (`matchRow = null`).
11. `promote-upcoming-to-telemetry.ts:74-117` — 4 upsert tanpa transaksi + cek `LIMIT 1` rapuh → `awayLog` bisa hilang permanen.
12. `migrate-analysis-runs.ts` — `DROP TABLE` tanpa backup/rename; rerun bisa duplikat baris `created_at` tak terparse.
13. `upsertOutcome` (`analysis-snapshot.ts:639-667`) — refresh menimpa kolom terisi dengan NULL.
14. `tsconfig.json:30` exclude `scripts` — test baru tidak pernah di-typecheck; sudah ada latent crash (`test-upcoming-guard.ts:68-71` de-reference `undefined`).
15. Test suite bergantung DB lokal yang baru di-gitignore → gagal di fresh clone karena environment, bukan regresi; `test-snapshot-db` assert corpus global.

### Nit / Consider
- Konvensi market key 3 sumber (VIEW SQL, `deriveMarketKey`, inline `sync-match-outcomes:93-100`) — sudah ada drift kecil.
- `analysis-snapshot.ts` 745 baris, 3 sumber kebenaran untuk aturan sama → pecah + materialisasi `market_key`.
- Negative cache mengembalikan error object sebagai data sukses (`stats-cache.ts:142-156`).
- Tidak ada single-flight untuk cache miss snapshot (N request = N pipeline LLM 200-400s) + `cache_key_hint` terfragmentasi.
- `panelMarketFrom` (`route.tsx:169-181`) & `backfill-panel-market.ts:36-46` — substring match tanpa word boundary.
- Boolean route `matches` `?? false` membiarkan `0/1` lolos (`matches/route.ts:51-53`).
- Komentar LCP `page.tsx:29-32` kontradiksi dengan hasil ukur `PERF.md` (code-split tidak menurunkan LCP).
- Mojibake `sync-weekly-telemetry.ts:152`; `http-json.ts` `payload.length` (UTF-16 vs byte), vary case-sensitive, `gzip;q=0` diabaikan.
- `syndicate-orchestrator:559` — `j2Substituted` tidak cek `recommended_market` → penandaan fallback tidak akurat.
- Output teks LLM belum divalidasi bentuk (cast `as string`).
- `snapshot-report.ts:71` — definisi `hit_rate` ganda, satu mati.
- `opencode.json` — `npx` (win32 butuh `npx.cmd`) + MCP `@latest` unpinned.

### Dead code (konfirmasi sebelum hapus)
- `scripts/test-view-mapper.ts:16` import `AnalysisViewSchema` mati; `test-upcoming-guard.ts:79` var `earliest` mati.
- `scripts/ingest-rich-telemetry-pl.ts` full file — kandidat mati (tidak di-wire di package.json), salin bug `?? 0`; `ingest-rich-telemetry-multileague.ts` masih aktif (duplikat mapper).

## Architecture Decisions

- **Kontrak honest-nulls = hukum tertinggi.** Setiap temuan yang mengarang angka/status diperlakukan Required ke atas, bukan nit. Angka yang tidak diketahui = `null` + render "—".
- **Cache tidak boleh menyervis degradasi.** Hasil fallback boleh masuk history (audit trail) tapi tidak jadi sumber cache; marker `is_fallback`/`is_strictly_grounded` wajib sampai ke client.
- **Eval append-only butuh guard di VIEW, bukan hanya di writer.** Writer bisa berganti; view adalah sumber laporan.
- **Test harus hijau di fresh clone** — skip-with-message untuk fixture absen, jangan assert corpus personal.

## Task List

### Phase 1: Blocker Integritas (Critical)
- [ ] Task 1: Cache snapshot menolak view fallback + marker grounded ke client
- [ ] Task 2: Guard NULL `v_snapshot_eval` + `upsertOutcome` tidak menimpa data dengan NULL
- [ ] Task 3: `stats-log-mapper` menolak skor/status absen (return null) + bereskan duplikasi ingest
- [ ] Task 4: Pulihkan `thestats_dataset.db` (commit ulang snapshot) + guard silent-empty

### Checkpoint: Integritas
- [ ] `tsc --noEmit` bersih · `test-snapshot-db` / `test-stats-mapper` / `test-view-mapper` hijau
- [ ] Probe: view evaluasi memberi NULL (bukan menang/kalah) saat skor hilang
- [ ] Review dengan user sebelum Phase 2

### Phase 2: Correctness Pipeline (Required)
- [ ] Task 5: Fix race stamping trace planner + timeout semua LLM call
- [ ] Task 6: Anti-leakage fail-closed + 2 fix `sync-match-outcomes` (format tanggal, skor lokal)
- [ ] Task 7: Odds karangan tidak boleh jadi `recommended_odds` (null atau tag `odds_source`)
- [ ] Task 8: Transaksi `promote-upcoming` + jaring pengaman `migrate-analysis-runs`

### Checkpoint: Pipeline
- [ ] `test-planner-loop` hijau · `snapshot-report` jalan tanpa error
- [ ] Uji manual: 1 run `/api/agent` penuh → snapshot tersimpan dengan marker benar

### Phase 3: Test & Hygiene
- [ ] Task 9: Robustness test (assert signature, skip saat fixture absen, tanpa assert corpus global)
- [ ] Task 10: Dead code + koreksi komentar (LCP, mojibake, `hit_rate`, `Boolean()` route matches)
- [ ] Task 11: Sumber tunggal market key (pakai `deriveMarketKey` di `sync-match-outcomes`)

### Deferred (buka lagi saat perlu)
- [ ] Pecah `analysis-snapshot.ts` (745 baris) + materialisasi `market_key` per value-bet
- [ ] Single-flight cache snapshot + normalisasi `cache_key_hint`
- [ ] Zod validasi output teks LLM; `j2Substituted` cek `recommended_market`
- [ ] Typecheck `scripts/` di CI

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Perubahan `v_snapshot_eval` mengubah angka evaluasi historis | Med | Perubahan = koreksi jujur; laporkan delta sebelum/sesudah apa adanya |
| Snapshot DB pribadi (append-only, tak bisa rebuild) tersentuh test/sync | High | Backup file sebelum run tulis apa pun; test pakai prefix + cleanup |
| Subagent lain masih menyentuh file yang sama | Med | Koordinasi dulu sebelum Phase 2; commit per task |
| Restore dataset.db menambah 5.8MB ke repo | Rendah | Itu harga reproducibility; alternatif: dokumentasi rebuild + guard (Task 4 pilih satu) |

## Open Questions
- [ ] Task 4: commit ulang snapshot DB (reproducible) vs dokumentasi perintah rebuild (repo ramping)? — butuh keputusan user
- [ ] `ingest-rich-telemetry-pl.ts` — hapus (kandidat mati) atau dipakai lagi? — konfirmasi user sebelum hapus
- [ ] Kontrak DB SNAPSHOT.md T2a soal `topEv` fallback ke EV negatif — key tetap terisi atau null? Perlu dikunci.
