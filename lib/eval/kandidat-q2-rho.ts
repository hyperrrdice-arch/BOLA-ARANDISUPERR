/**
 * Q2a — ρ DIXON–COLES TERPOOL (Item 2, Sprint A+B; design beku di
 * tasks/sprint-ab/q2-design.md).
 *
 * Satu ρ global di-fit dengan likelihood skor eksak Dixon–Coles pada
 * λ/μ champion (baris out-of-sample lipatan sebelumnya — disiplin
 * walk-forward PR 4), dengan penalti L2 ρ². τ mengikuti konvensi kanonis
 * lib/quant/dixon-coles.ts; di sini τ dihitung TANPA jepit Math.max(0,·)
 * agar kelayakan (τ > 0) bisa dideteksi sebagai −∞ pada likelihood.
 */
import { poissonLogProb } from "../quant/dixon-coles";

export interface RhoRow {
  lam: number;
  mu: number;
  hs: number;
  as: number;
}

export const RHO_MIN = -0.3;
export const RHO_MAX = 0.3;
export const RHO_PENALTY_GRID: readonly number[] = [0, 25, 100, 400];

/** τ Dixon–Coles mentah (tanpa jepit) untuk empat sel skor rendah. */
export function tauRaw(x: number, y: number, lambda: number, mu: number, rho: number): number {
  if (x === 0 && y === 0) return 1 - lambda * mu * rho;
  if (x === 0 && y === 1) return 1 + lambda * rho;
  if (x === 1 && y === 0) return 1 + mu * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

/**
 * Log-likelihood skor eksak Σ [logPois(λ,hs) + logPois(μ,as) + log τ].
 * −Infinity bila ada τ ≤ 0 (ρ tidak layak untuk λ/μ baris itu).
 */
export function dcScoreLogLik(rows: readonly RhoRow[], rho: number): number {
  let sum = 0;
  for (const r of rows) {
    const t = tauRaw(r.hs, r.as, r.lam, r.mu, rho);
    if (!(t > 0)) return -Infinity;
    sum += poissonLogProb(r.lam, r.hs) + poissonLogProb(r.mu, r.as) + Math.log(t);
  }
  return sum;
}

export function penalizedObjective(rows: readonly RhoRow[], rho: number, penalty: number): number {
  const ll = dcScoreLogLik(rows, rho);
  if (!Number.isFinite(ll)) return -Infinity;
  return ll - penalty * rho * rho;
}

export interface RhoFit {
  rho: number;
  objective: number;
  loglik: number;
}

/**
 * Fit ρ: pindai grid 0,001 pada [RHO_MIN, RHO_MAX], lalu perhalus
 * ±0,001 dengan langkah 0,0001. Deterministik (tanpa RNG, urutan tetap).
 */
export function fitRho(rows: readonly RhoRow[], penalty: number): RhoFit {
  let bestRho = 0;
  let bestObj = penalizedObjective(rows, 0, penalty);
  for (let i = 0; i <= 600; i++) {
    const rho = RHO_MIN + i * 0.001;
    const obj = penalizedObjective(rows, rho, penalty);
    if (obj > bestObj) {
      bestObj = obj;
      bestRho = rho;
    }
  }
  for (let i = -10; i <= 10; i++) {
    const rho = Math.min(RHO_MAX, Math.max(RHO_MIN, bestRho + i * 0.0001));
    const obj = penalizedObjective(rows, rho, penalty);
    if (obj > bestObj) {
      bestObj = obj;
      bestRho = rho;
    }
  }
  return { rho: bestRho, objective: bestObj, loglik: dcScoreLogLik(rows, bestRho) };
}
