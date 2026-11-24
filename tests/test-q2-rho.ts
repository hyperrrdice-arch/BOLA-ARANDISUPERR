/**
 * SUITE Q2a (Item 2, Sprint A+B) — unit fit ρ Dixon–Coles terpool.
 *
 * Memverifikasi: tanda τ untuk ρ negatif (pola diagnostik), likelihood
 * ρ=0 = Poisson murni, ketidaklayakan τ ≤ 0, pemulihan ρ dari data
 * sintetis ber-ρ diketahui, penyusutan oleh penalti, determinisme.
 */
import { Suite } from "./helpers/fixture-env";
import { calculateDixonColes, poissonLogProb } from "../lib/quant/dixon-coles";
import {
  dcScoreLogLik,
  fitRho,
  tauRaw,
  type RhoRow,
} from "../lib/eval/kandidat-q2-rho";

const suite = new Suite("q2a-rho (Item 2)");
const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) < tol;

// --- τ: tanda sesuai diagnostik (ρ < 0 menaikkan 0-0 & 1-1, menurunkan 0-1 & 1-0)
{
  const rho = -0.1;
  const lam = 1.4;
  const mu = 1.2;
  suite.check("tau(1,1) > 1 untuk rho<0", tauRaw(1, 1, lam, mu, rho) > 1, `${tauRaw(1, 1, lam, mu, rho)}`);
  suite.check("tau(0,0) > 1 untuk rho<0", tauRaw(0, 0, lam, mu, rho) > 1, `${tauRaw(0, 0, lam, mu, rho)}`);
  suite.check("tau(0,1) < 1 untuk rho<0", tauRaw(0, 1, lam, mu, rho) < 1, `${tauRaw(0, 1, lam, mu, rho)}`);
  suite.check("tau(1,0) < 1 untuk rho<0", tauRaw(1, 0, lam, mu, rho) < 1, `${tauRaw(1, 0, lam, mu, rho)}`);
  suite.eq("tau sel lain = 1", tauRaw(2, 1, lam, mu, rho), 1);
}

// --- Likelihood ρ=0 = Poisson independen murni --------------------------------
{
  const rows: RhoRow[] = [
    { lam: 1.5, mu: 1.1, hs: 2, as: 0 },
    { lam: 0.9, mu: 1.8, hs: 1, as: 1 },
  ];
  const expect = rows.reduce((s, r) => s + poissonLogProb(r.lam, r.hs) + poissonLogProb(r.mu, r.as), 0);
  suite.check("LL(rho=0) = Poisson murni", near(dcScoreLogLik(rows, 0), expect, 1e-12));
}

// --- Ketidaklayakan: τ(0,0) ≤ 0 → −Infinity ------------------------------------
{
  const rows: RhoRow[] = [{ lam: 3, mu: 3, hs: 0, as: 0 }];
  suite.eq("tau(0,0)<=0 → LL -Infinity", dcScoreLogLik(rows, 0.3), -Infinity);
  suite.check("rho=0 tetap hingga", Number.isFinite(dcScoreLogLik(rows, 0)));
}

// --- Pemulihan ρ sintetis -------------------------------------------------------
// RNG deterministik (mulberry32) — bukan Math.random.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
{
  const rand = mulberry32(20261124);
  const dc = calculateDixonColes({
    homeAttack: 1,
    homeDefense: 1,
    awayAttack: 1,
    awayDefense: 1,
    homeAdvantage: 1.5 / 1.1,
    leagueAvgGoals: 1.1,
    rho: -0.12,
    maxGoals: 10,
  });
  const mx = dc.score_matrix;
  const cells: { x: number; y: number; p: number }[] = [];
  for (let x = 0; x < mx.length; x++) for (let y = 0; y < mx[x].length; y++) cells.push({ x, y, p: mx[x][y] });
  const rows: RhoRow[] = [];
  for (let i = 0; i < 20000; i++) {
    let u = rand();
    let picked = cells[cells.length - 1];
    for (const c of cells) {
      u -= c.p;
      if (u <= 0) {
        picked = c;
        break;
      }
    }
    rows.push({ lam: 1.5, mu: 1.1, hs: picked.x, as: picked.y });
  }
  const fit0 = fitRho(rows, 0);
  suite.check(
    "fit memulihkan rho sintetis -0,12 (±0,03)",
    Math.abs(fit0.rho - -0.12) <= 0.03,
    `rho=${fit0.rho}`,
  );
  const fit400 = fitRho(rows, 400);
  suite.check(
    "penalti 400 menyusutkan |rho| dibanding penalti 0",
    Math.abs(fit400.rho) <= Math.abs(fit0.rho) + 1e-12,
    `${fit400.rho} vs ${fit0.rho}`,
  );
  const fit0b = fitRho(rows, 0);
  suite.eq("fit deterministik byte-identik", fit0b.rho, fit0.rho);
}

suite.finish();
