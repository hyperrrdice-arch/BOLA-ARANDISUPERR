# TODO — Master (lihat tasks/plan.md)

> Satu-satunya todo aktif. Prinsip: mesin hitung frozen, otak yang diganti job-desc.
> Target user = pemain mix parlay. Arsip: `tasks/archive/`.

## Track A — Keputusan (P0, berurutan)

### Task 1: Guard fallback-source ✅ SELESAI (21 Okt)
- Fallback (source==fallback ATAU 0 xG + bobot<0.25) → edge >50% atau SKIP.
- Bukti: test 55/55 + live re-run Sporting-LASK (prob identik, verdict LASK→SKIP).
- File: `lib/quant/fallback-guard.ts`, `scripts/test-fallback-guard.ts`.

### Task 2: Verdict gaya parlay (P0, BERIKUTNYA)
**Description:** Job-desc J1/J2: output = leg teraman + jebakan + skip (maks 3).
Tiap opsi wajib prob + status harga + 1 kalimat + kondisi batal.
**Acceptance criteria:**
- [ ] Sporting case: headline = leg aman, LASK maks label value-spekulatif/jebakan parlay
- [ ] Tiap opsi bawa prob + kondisi batal (assert test)
- [ ] Field additive (pick lama tetap)
**Verification:** test format opsi + cap + kondisi batal · regresi penuh + tsc + build
**Files:** `lib/llm/voice-guide.ts`, `lib/syndicate-orchestrator.ts`, `lib/view/analysis-view.ts`
**Scope:** M

### Task 3: Judge skenario semi-agentic (P2, sesudah Task 2)
- J1 susun 2–3 skenario berangka (termasuk "pantau harga"/"live-bet jika X");
  J2 uji tiap skenario; output ranking + sizing + invalidasi. Tetap 1 ronde.
- Acceptance: skenario tanpa angka ditolak test · tiap skenario ada kondisi batal ·
  latensi ≤2x baseline R1.

## Track B — Data harga (P1, paralel dengan A)

### Task 4: Odds totals/BTTS via OddsAPI
- Adapter read-only (key di env) → O2.5/BTTS masuk hitungan +EV. Tanpa key/mati =
  degradasi "pantau". Nol tulis DB.
- Acceptance: Inter replay O2.5 ber-harga + masuk `value_bets` bila +EV.

### Task 5: Web-search khusus lineup/cedera (usul, belum approved)
- 1 tool, output label `source:web, unverified` = konteks saja. Dilarang ubah
  prob/fair/EV. Gagal = fallback offline.

## Track C — Evaluasi & model (P3, track terpisah)

### Task 6: Kalibrasi & track record (dari depth 4–6, belum jalan)
- Panel kalibrasi model-vs-Bet365 read-only · profil HT (bridge ≥80% atau stop) ·
  laporan bulanan Brier/P-L per market. Nol auto-refit.

### Task 7: GBM challenger offline (belum jalan)
- LightGBM, time-split ketat, lawan Dixon-Coles (log-loss paired). Integrasi HANYA
  bila menang signifikan, via artifact SQLite.

## Track D — Operasi (parkir, tidak blokir apa pun)
- **Slip builder v2**: gabung 10 legs + survival (sesudah Task 2–3).
- **Hermes MCP**: expose MCP server read-only (quant/snapshot/fixture) → Hermes
  sebagai analis + kurir Telegram + cron briefing. Pilot kecil, bukan re-arsitektur.
- **Ablasi sqrt(Q)**: UNDECIDED n=50 — JANGAN re-run buta, trigger n≥100
  (`tasks/archive/ablate-*` bila ada; script `scripts/ablate-ucl-scaling.ts` tetap).

### Checkpoint: Verdict parlay
- [ ] Live 1 laga: headline leg aman + jebakan eksplisit · tsc+build hijau · review user

### Checkpoint: Final
- [ ] Semua acceptance hijau · live parlay-night 3 laga · siap slip-builder v2 · review user
