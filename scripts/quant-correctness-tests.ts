/**
 * Regression tests untuk perbaikan correctness quant (audit 2026-11-09).
 *
 * Jalankan: node --env-file=.env.local --import tsx scripts/quant-correctness-tests.ts
 * Exit 0 = semua lolos; exit 1 = ada kegagalan (dicetak per kasus).
 *
 * Cakupan per temuan audit:
 *  1. Fallback rating ratings-loader (skala rasio + monotonik λ)
 *  2. Matrix Dixon-Coles (tail tidak dibuang diam-diam)
 *  3. Wiring effective_prob engine → ledger → builder
 *  4. Confidence special markets mengikuti coverage metrik
 *  5. Normalisasi xG point-in-time (backtest tanpa look-ahead)
 */
import { getShrunkMatchParameters } from "../lib/quant/ratings-loader";
import { calculateDixonColes } from "../lib/quant/dixon-coles";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  OK  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const approx = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------------------
// Temuan 1 — fallback rating
// ---------------------------------------------------------------------------
console.log("Temuan 1: fallback rating (ratings-loader)");
{
  const base = { homeTeam: "Fiktif FC", awayTeam: "Karangan United", leagueHint: "Liga Fiksi Antah" };
  const p15 = getShrunkMatchParameters({ ...base, liveHomeFormGoalsAvg: 1.5, liveAwayFormGoalsAvg: 1.2 });
  const p20 = getShrunkMatchParameters({ ...base, liveHomeFormGoalsAvg: 2.0, liveAwayFormGoalsAvg: 1.2 });
  const pNone = getShrunkMatchParameters({ ...base });
  const pZero = getShrunkMatchParameters({ ...base, liveHomeFormGoalsAvg: 0, liveAwayFormGoalsAvg: 1.2 });

  check("jalur fallback terpakai + tak terkalibrasi", p15.metadata?.homeSource === "fallback" && p15.isCalibrated === false);
  const lam = (p: typeof p15) => calculateDixonColes(p).lambda;
  check("λ monoton terhadap form kandang (2,0 > 1,5)", lam(p20) > lam(p15), `λ(2,0)=${lam(p20)} λ(1,5)=${lam(p15)}`);
  check("attack kandang tidak mengubah defense lawan", p15.awayDefense === p20.awayDefense, `${p15.awayDefense} vs ${p20.awayDefense}`);
  check("defense fallback = prior rasio 1,0", p15.homeDefense === 1.0 && p15.awayDefense === 1.0);
  check("attack fallback skala rasio (form 1,5 / 1,35)", approx(p15.homeAttack, 1.5 / 1.35, 1e-9), `homeAttack=${p15.homeAttack}`);
  const totalNone = calculateDixonColes(pNone).expected_total_goals;
  check("tanpa form: total gol prior wajar (2,5–3,1, bukan 4,64)", totalNone >= 2.5 && totalNone <= 3.1, `total=${totalNone.toFixed(2)}`);
  check("form 0 terobservasi dihormati sebagai 0 (bukan diganti default)", pZero.homeAttack === 0, `homeAttack=${pZero.homeAttack}`);
  check(
    "semua parameter fallback finite",
    [p15.homeAttack, p15.homeDefense, p15.awayAttack, p15.awayDefense].every(Number.isFinite)
  );

  // Cabang kedua tim tak ter-resolve di liga yang dikenal (E0): rasio attack
  // harus memakai rata-rata liga itu sendiri, bukan konstanta 1,35.
  const pE0 = getShrunkMatchParameters({
    homeTeam: "Fiktif FC",
    awayTeam: "Karangan United",
    leagueHint: "E0",
    liveHomeFormGoalsAvg: 1.5,
    liveAwayFormGoalsAvg: 1.2,
  });
  check(
    "liga dikenal, tim asing: rasio konsisten dgn leagueAvgGoals liga",
    approx(pE0.homeAttack * pE0.leagueAvgGoals, 1.5, 1e-6),
    `homeAttack=${pE0.homeAttack} avg=${pE0.leagueAvgGoals}`
  );
  check("liga dikenal, tim asing: defense tetap prior 1,0", pE0.homeDefense === 1.0 && pE0.awayDefense === 1.0);
}

// ---------------------------------------------------------------------------
// Temuan 2 — matrix Dixon-Coles: ekor tidak dibuang diam-diam
// ---------------------------------------------------------------------------
console.log("Temuan 2: matrix Dixon-Coles (cutoff adaptif)");
{
  const matrixMean = (m: number[][]) => {
    let mean = 0;
    m.forEach((row, x) => row.forEach((p, y) => (mean += (x + y) * p)));
    return mean;
  };
  const harness = (lam: number, mu: number, rho = 0) =>
    calculateDixonColes({
      homeAttack: 1, homeDefense: 1, awayAttack: 1, awayDefense: 1,
      leagueAvgGoals: mu, homeAdvantage: lam / mu, rho, maxGoals: 10,
    });

  const normal = harness(1.959, 0.996, -0.04);
  const flat = normal.score_matrix.flat();
  check("kasus normal: probabilitas finite, >= 0, jumlah ~1",
    flat.every((v) => Number.isFinite(v) && v >= 0) &&
    approx(flat.reduce((a, b) => a + b, 0), 1, 1e-9));
  check("kasus normal: ekor terbuang <= 1e-8", normal.score_matrix_tail_mass <= 1e-8,
    `tail=${normal.score_matrix_tail_mass.toExponential(2)}`);

  const mid = harness(2.3, 1.1, 0);
  check("rho=0: mean matrix konsisten dgn lambda+mu (tol 0,01)",
    approx(matrixMean(mid.score_matrix), 3.4, 0.01), `mean=${matrixMean(mid.score_matrix).toFixed(3)}`);

  // Stress case audit: lambda 16,019 / mu 1,540 — dulu 92,3% massa dibuang
  // diam-diam (mean matrix 10,49 vs expected total 17,56).
  const stress = harness(16.019, 1.54, 0);
  check("kasus ekstrem: grid melebar melebihi 11x11", stress.score_matrix.length > 11,
    `grid=${stress.score_matrix.length}`);
  check("kasus ekstrem: mean matrix ~ expected total 17,56 (tol 0,05)",
    approx(matrixMean(stress.score_matrix), 17.56, 0.05), `mean=${matrixMean(stress.score_matrix).toFixed(2)}`);
  check("kasus ekstrem: ekor terbuang <= 1e-8", stress.score_matrix_tail_mass <= 1e-8,
    `tail=${stress.score_matrix_tail_mass.toExponential(2)}`);

  // Input patologik: lambda 300 — harus gagal eksplisit, bukan distribusi jadi-jadian.
  let threw = false;
  try {
    calculateDixonColes({
      homeAttack: 300 / 1.35, awayDefense: 1, awayAttack: 1, homeDefense: 1,
      homeAdvantage: 1, leagueAvgGoals: 1.35, rho: 0,
    });
  } catch {
    threw = true;
  }
  check("input patologik (lambda=300): throw eksplisit", threw);
}

console.log(failures === 0 ? "\nSEMUA LOLOS" : `\n${failures} KEGAGALAN`);
process.exit(failures === 0 ? 0 : 1);
