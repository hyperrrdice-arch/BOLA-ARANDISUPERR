/**
 * TEST:EXPERIMENT-STATS — suite K5 untuk fungsi murni statistik
 * eksperimen model (lib/quant/experiment-stats.ts):
 *
 *  A. PRNG mulberry32 deterministik (seed sama → barisan sama).
 *  B. Bootstrap blok berpasangan: mean Δ teramati benar; blok tunggal
 *     → semua resample identik dengan mean teramati; Δ konstan →
 *     interval runtuh ke titik itu; deterministik per seed; hitungan
 *     laga/blok benar.
 *  C. Aturan keputusan bab Q4 (tabel kebenaran): semua lolos →
 *     promote; masing-masing cek manfaat/lindungan gagal → retain;
 *     lantai sampel gagal → inconclusive; nilai batas persis
 *     (Δ = −0,005 lolos; UB = 0 gagal karena harus < 0; penurunan
 *     cakupan 0,02 lolos; kenaikan Brier 0,002 lolos).
 *
 * Pakai: npm run test:quant (suite ini dirantai di dalamnya)
 */
import {
  applyKappaDecision,
  blockBootstrapDelta,
  mulberry32,
  type KappaDecisionInput,
  type PairedDeltaRow,
} from "../lib/quant/experiment-stats";
import { Suite } from "./helpers/fixture-env";

const suite = new Suite("experiment-stats K5");

function approx(a: number, b: number, tol = 1e-12): boolean {
  return Math.abs(a - b) <= tol;
}

// --- A. PRNG -----------------------------------------------------------------
{
  const r1 = mulberry32(20261120);
  const r2 = mulberry32(20261120);
  const s1 = [r1(), r1(), r1(), r1()];
  const s2 = [r2(), r2(), r2(), r2()];
  suite.eq("A1 mulberry32 seed sama → barisan identik", s1, s2);
  const r3 = mulberry32(1);
  suite.check("A2 mulberry32 seed beda → barisan beda", r3() !== s1[0]);
  suite.check("A3 mulberry32 keluaran di [0,1)", s1.every((v) => v >= 0 && v < 1));
}

// --- B. Bootstrap blok ---------------------------------------------------------
{
  // Δ konstan −0,01 di 30 blok × 10 laga.
  const rows: PairedDeltaRow[] = [];
  for (let b = 0; b < 30; b++) {
    for (let i = 0; i < 10; i++) rows.push({ block: `2026-W${String(b + 1).padStart(2, "0")}`, delta: -0.01 });
  }
  const res = blockBootstrapDelta(rows, { resamples: 500, seed: 20261120 });
  suite.check("B1 mean Δ teramati = −0,01", approx(res.meanDelta, -0.01), String(res.meanDelta));
  suite.check("B2 Δ konstan → UB95 = −0,01", approx(res.upperOneSided95, -0.01), String(res.upperOneSided95));
  suite.check("B3 Δ konstan → CI runtuh", approx(res.ci95Low, -0.01) && approx(res.ci95High, -0.01));
  suite.eq("B4 hitungan laga/blok", [res.nMatches, res.nBlocks], [300, 30]);

  // Satu blok berisi semua laga → setiap resample = mean teramati.
  const oneBlock: PairedDeltaRow[] = [
    { block: "W1", delta: -0.02 },
    { block: "W1", delta: 0.01 },
    { block: "W1", delta: -0.005 },
  ];
  const resOne = blockBootstrapDelta(oneBlock, { resamples: 200, seed: 7 });
  suite.check(
    "B5 satu blok → UB95 = mean teramati",
    approx(resOne.upperOneSided95, resOne.meanDelta) && approx(resOne.meanDelta, -0.005),
    `mean=${resOne.meanDelta} ub=${resOne.upperOneSided95}`,
  );

  // Determinisme per seed pada data bervariasi.
  const varied: PairedDeltaRow[] = [];
  for (let b = 0; b < 25; b++) {
    for (let i = 0; i < 8; i++) varied.push({ block: `B${b}`, delta: Math.sin(b * 3 + i) * 0.01 });
  }
  const d1 = blockBootstrapDelta(varied, { resamples: 1000, seed: 20261120 });
  const d2 = blockBootstrapDelta(varied, { resamples: 1000, seed: 20261120 });
  suite.eq("B6 bootstrap deterministik per seed", d1, d2);
  const expectedMean = varied.reduce((s, r) => s + r.delta, 0) / varied.length;
  suite.check("B7 mean Δ = rata-rata sampel", approx(d1.meanDelta, expectedMean, 1e-15));
  suite.check(
    "B8 urutan interval wajar (CI low ≤ UB95 ≤ CI high)",
    d1.ci95Low <= d1.upperOneSided95 && d1.upperOneSided95 <= d1.ci95High,
    JSON.stringify(d1),
  );
}

// --- C. Aturan keputusan -------------------------------------------------------
{
  const base: KappaDecisionInput = {
    meanDelta: -0.008,
    bootstrapUpperOneSided95: -0.002,
    coverageChampion: 0.99,
    coverageChallenger: 0.985,
    brierChampion: 0.6,
    brierChallenger: 0.599,
    nMatches: 6000,
    nBlocks: 60,
  };
  suite.eq("C1 semua lolos → promote", applyKappaDecision(base).decision, "promote");
  suite.eq(
    "C2 margin Δ kurang (−0,004) → retain",
    applyKappaDecision({ ...base, meanDelta: -0.004 }).decision,
    "retain",
  );
  suite.eq(
    "C3 UB bootstrap ≥ 0 → retain",
    applyKappaDecision({ ...base, bootstrapUpperOneSided95: 0.001 }).decision,
    "retain",
  );
  suite.eq(
    "C4 cakupan turun 3pp → retain",
    applyKappaDecision({ ...base, coverageChallenger: 0.96 }).decision,
    "retain",
  );
  suite.eq(
    "C5 Brier naik 0,003 → retain",
    applyKappaDecision({ ...base, brierChallenger: 0.603 }).decision,
    "retain",
  );
  suite.eq(
    "C6 N laga 999 → inconclusive",
    applyKappaDecision({ ...base, nMatches: 999 }).decision,
    "inconclusive",
  );
  suite.eq(
    "C7 blok pekan 19 → inconclusive",
    applyKappaDecision({ ...base, nBlocks: 19 }).decision,
    "inconclusive",
  );
  // Nilai batas persis.
  suite.eq(
    "C8 Δ tepat −0,005 → cek mean lolos",
    applyKappaDecision({ ...base, meanDelta: -0.005 }).checks.find((c) => c.id === "mean_delta")?.pass,
    true,
  );
  suite.eq(
    "C9 UB tepat 0 → cek bootstrap GAGAL (harus < 0)",
    applyKappaDecision({ ...base, bootstrapUpperOneSided95: 0 }).checks.find((c) => c.id === "bootstrap_upper")?.pass,
    false,
  );
  suite.eq(
    "C10 cakupan turun tepat 0,02 → lolos",
    applyKappaDecision({ ...base, coverageChampion: 1, coverageChallenger: 0.98 }).checks.find(
      (c) => c.id === "coverage_drop",
    )?.pass,
    true,
  );
  suite.eq(
    "C11 Brier naik tepat 0,002 → lolos",
    applyKappaDecision({ ...base, brierChampion: 0.6, brierChallenger: 0.602 }).checks.find(
      (c) => c.id === "brier_increase",
    )?.pass,
    true,
  );
  const checks = applyKappaDecision(base).checks;
  suite.eq(
    "C12 lima cek tercatat berurutan",
    checks.map((c) => c.id),
    ["sample_floor", "mean_delta", "bootstrap_upper", "coverage_drop", "brier_increase"],
  );
}

suite.finish();
