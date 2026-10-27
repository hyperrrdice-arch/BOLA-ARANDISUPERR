# TODO — Parlay Pivot (lihat tasks/plan-parlay-pivot.md)

> Prinsip: mesin hitung frozen, otak (judge) yang diganti job-desc-nya.
> Target user = pemain mix parlay. File baru — plan lama tidak disentuh.

## Task 1: Guard fallback-source (P0)

**Description:** Jika salah satu tim sumber rating-nya `fallback` (atau xG sampel
0 + bobot <0.25), value play butuh edge >50% atau verdict = SKIP dengan alasan
kualitas data. Menjawab 2/9 run aneh (LASK, Shakhtar).

**Acceptance criteria:**
- [x] Sporting-LASK (#123) SKIP + pick lama tercatat; Inter-Shakhtar (#128, EV 72% ≥50%) lolos + warning 1 kalimat (deviasi sadar worker: ikut aturan threshold, bukan SKIP buta — disetujui head)
- [x] 7 run bersih tidak berubah pick-nya (guard tidak over-blocking — #125/#127 identik)
- [x] Prob/fair tidak berubah (guard hitung-ulang identik)

**Verification:**
- [x] `scripts/test-fallback-guard.ts` 55/55 (head re-run hijau, replay DB read-only)
- [x] Regresi: debate-r1 38/38, view 53/53 · tsc exit 0
- [x] Live Stuttgart-M'gladbach: guard nembak end-to-end (away fallback, edge +1.9%), verdict SKIP + field `data_quality`/`fallback_guard` hadir di view root, 68s, grounded
- [x] Live re-run Sporting-LASK (match UCL user): prob identik 73/14/13 (quant utuh) + verdict berubah LASK-headline → SKIP beralasan, 109s, grounded

**Catatan head:** guard over-block buat user parlay — Stuttgart 73.8% leg bagus ikut ke-SKIP karena value play-nya <50%. SKIP benar untuk value, salah sasaran untuk leg. Alasan Task 2 (pisahkan value vs leg) naik prioritas.

**Dependencies:** None

**Files likely touched:**
- `lib/view/analysis-view.ts` (tambah flag kualitas data)
- `lib/agent/planner.ts` atau `lib/syndicate-orchestrator.ts` (aturan guard)
- `scripts/test-fallback-guard.ts` (baru)

**Estimated scope:** S (2-3 files)

### Checkpoint: Guard
- [ ] Guard aktif + 7 run bersih utuh · tsc+build hijau · review user

## Task 2: Verdict gaya parlay (P0)

**Description:** Ubah job-desc J1/J2: output = leg teraman + jebakan + skip
(maks 3 opsi). Tiap opsi wajib: prob model + status harga (ada/+EV, ada/-EV,
belum ada) + 1 kalimat + kondisi batal. Aturan "no number, no scenario".

**Acceptance criteria:**
- [ ] Sporting case: headline = leg aman (bukan LASK), LASK maks label value-spekulatif/jebakan parlay
- [ ] Tiap opsi bawa prob + kondisi batal (assert test)
- [ ] Field baru additive (pick lama tetap ada)

**Verification:**
- [ ] Extend `scripts/test-debate-r1.ts` atau test baru: format opsi + cap 3 + kondisi batal hadir
- [ ] Regresi penuh + tsc + build hijau

**Dependencies:** Task 1 (guard dipakai di dalam ranking opsi)

**Files likely touched:**
- `lib/llm/voice-guide.ts` (format opsi parlay)
- `lib/syndicate-orchestrator.ts` (prompt J1/J2 + resolver)
- `lib/view/analysis-view.ts` (field additive)

**Estimated scope:** M (3-4 files)

## Task 3: Odds totals/BTTS via OddsAPI (P1)

**Description:** Adapter read-only OddsAPI (key sudah di `.env.local`) untuk
odds Over 2.5 / BTTS → masuk hitungan +EV. Menjawab "O2.5 83% tapi tidak ada
harganya". Tanpa cache persisten (keputusan lama: API bisa diganti).

**Acceptance criteria:**
- [ ] Inter-Shakhtar replay: O2.5/BTTS ada harga + masuk `value_bets` bila +EV
- [ ] Tanpa key / API mati = degradasi jujur ("pantau"), tidak crash
- [ ] Nol tulis ke DB produksi (read-only + memory saja)

**Verification:**
- [ ] Test adapter: harga masuk + degradasi tanpa key
- [ ] tsc + build hijau

**Dependencies:** None (paralel dengan Task 1-2)

**Files likely touched:**
- `lib/odds/oddspapi-adapter.ts` (baru)
- `lib/agent/planner.ts` (injeksikan harga ke value_bets)
- `scripts/test-oddspapi-adapter.ts` (baru)

**Estimated scope:** M (2-3 files)

### Checkpoint: Verdict + Odds
- [ ] Live 1 laga: headline leg aman + O2.5 ber-harga · review user

## Task 4: Judge skenario semi-agentic (P2)

**Description:** J1 susun 2-3 skenario berangka dari data suapan (termasuk opsi
"pantau harga" / "live-bet jika X"); J2 uji tiap skenario ("apa yang bikin ini
salah?"); output ranking + sizing + invalidasi. Tetap 1 ronde (latensi aman).

**Acceptance criteria:**
- [ ] Skenario tanpa prob/status harga ditolak test
- [ ] Tiap skenario ada kondisi batal eksplisit
- [ ] Latensi run tidak >2x baseline R1 (±70-110s)

**Verification:**
- [ ] Test skenario: format + cap + invalidasi + budget latensi
- [ ] Regresi penuh + live 1 laga + review user

**Dependencies:** Task 2 (format opsi adalah fondasinya)

**Files likely touched:**
- `lib/syndicate-orchestrator.ts`, `lib/llm/voice-guide.ts`
- `lib/view/analysis-view.ts` (kartu "opsi lain")

**Estimated scope:** L → pecah saat eksekusi (prompt dulu, view sesudah)

## Task 5: GBM challenger offline (P3, track terpisah)

**Description:** Eksperimen Python (LightGBM), time-split CV ketat, lawan baseline
Dixon-Coles (log-loss paired). Integrasi HANYA bila menang signifikan, via
artifact SQLite (runtime tetap offline). Tidak pernah ganti DC sekaligus.

**Acceptance criteria:**
- [ ] Report: log-loss GBM vs DC + n + SE (paired, anti-leakage)
- [ ] Keputusan KEEP/DROP/UNDECIDED tercatat (preseden ablasi sqrt-Q)

**Verification:**
- [ ] Script repro exit 0, angka repro oleh head

**Dependencies:** None (tidak sentuh pipeline sampai KEEP)

**Files likely touched:**
- `scripts/gbm/` (baru, terpisah dari TS pipeline)

**Estimated scope:** M (track sendiri, boleh paralel)

### Checkpoint: Final
- [ ] Semua acceptance hijau · live parlay-night 3 laga · siap slip-builder v2 · review user
