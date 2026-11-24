/**
 * SUITE KANDIDAT Q1 (PR 4 — shadow).
 *
 * Cakupan:
 *  A. Identitas β=0 — kandidat dengan β nol mereproduksi champion persis.
 *  B. Fit Poisson terpenalti — memulihkan sinyal yang ditanam; α besar
 *     menyusutkan β ke nol; deterministik.
 *  C. Fitur point-in-time — jebakan injeksi masa depan (fitur laga lama
 *     identik sesudah penanaman laga masa depan ekstrem) + kepekaan
 *     (penanaman masa lalu yang sah mengubah fitur laga sesudahnya).
 *  D. Fitur satuan — rest, promoted, form_resid dihitung tangan.
 *  E. Paritas matriks — fullMatrixProbs vs matrixProbs evaluator PR 3.
 *  F. Gerbang — applyKappaDecision repo berperilaku sesuai aturan brief
 *     + pemetaan kosakata gateVocabulary.
 *  G. Penjaga isolasi shadow — hash manifest aktif + artefak saji di
 *     worktree TIDAK berubah oleh seluruh jalur kandidat (fitur → fit →
 *     aplikasi). Kandidat tidak boleh menyentuh jalur saji.
 *
 * Semua data sintetis; tanpa DB produksi.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { matrixProbs, type EvalMatchRow } from "../lib/eval/chronological-evaluator";
import {
  Q1FeatureExtractor,
  applyCandidate,
  featureVector,
  fitPoissonRidge,
  fullMatrixProbs,
  gateVocabulary,
  meanPoissonNll,
  type PoissonFitRow,
} from "../lib/eval/kandidat-q1-poisson";
import { applyKappaDecision } from "../lib/quant/experiment-stats";

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) pass++;
  else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function approx(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

const ZERO_BETA = [0, 0, 0, 0, 0, 0];

// ---------------------------------------------------------------------------
// A. Identitas β=0
// ---------------------------------------------------------------------------
{
  const ex = new Q1FeatureExtractor([], [], new Map());
  const feats = {
    home: { restAdv: 1.5, venueNeutral: 0, promoted: 1, formResid: 0.7, missRest: 0, missForm: 0 },
    away: { restAdv: -1.5, venueNeutral: 0, promoted: 0, formResid: -0.4, missRest: 0, missForm: 1 },
  };
  const out = applyCandidate(1.62, 0.94, feats, ZERO_BETA, ZERO_BETA);
  check("A1 β=0 → λ identik champion", out.lam === 1.62);
  check("A2 β=0 → μ identik champion", out.mu === 0.94);
  void ex;
}

// ---------------------------------------------------------------------------
// B. Fit Poisson terpenalti
// ---------------------------------------------------------------------------
{
  // Sinyal ditanam: gol home naik dengan rest_adv (β_rest asli = 0,30).
  const rows: PoissonFitRow[] = [];
  let seed = 42;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < 4000; i++) {
    const rest = Math.round((rnd() * 6 - 3) * 10) / 10;
    const lamTrue = 1.35 * Math.exp(0.3 * rest);
    // Poisson sampling sederhana (Knuth) — cukup untuk uji arah koefisien.
    let y = 0;
    let p = Math.exp(-lamTrue);
    let s = p;
    const u = rnd();
    while (u > s) {
      y++;
      p *= lamTrue / y;
      s += p;
    }
    rows.push({ offsetLog: Math.log(1.35), x: [rest, 0, 0, 0, 0, 0], y });
  }
  const fit = fitPoissonRidge(rows, 1);
  check("B1 fit konvergen", fit.converged, `grad=${fit.gradNormInf}`);
  check("B2 β_rest pulih positif (0,15..0,45)", fit.beta[0] > 0.15 && fit.beta[0] < 0.45, `β=${fit.beta[0]}`);
  check("B3 β venue_neutral tetap 0", fit.beta[1] === 0);
  const fitShrink = fitPoissonRidge(rows, 100000);
  check("B4 α raksasa → β ≈ 0", Math.abs(fitShrink.beta[0]) < 0.01, `β=${fitShrink.beta[0]}`);
  const fit2 = fitPoissonRidge(rows, 1);
  check("B5 deterministik (β identik byte)", JSON.stringify(fit2.beta) === JSON.stringify(fit.beta));
  check(
    "B6 NLL kandidat < NLL β=0 pada data bersinyal",
    meanPoissonNll(rows, fit.beta) < meanPoissonNll(rows, ZERO_BETA),
  );
}

// ---------------------------------------------------------------------------
// C/D. Fitur point-in-time + satuan
// ---------------------------------------------------------------------------
function mkMatch(id: string, comp: string, date: string, h: string, a: string, hs: number, as: number): EvalMatchRow {
  return { match_id: id, competition_id: comp, utc_date: `${date}T20:00:00Z`, home_team_id: h, away_team_id: a, home_score: hs, away_score: as };
}

{
  // Liga kecil: tim X main 2026-01-01, 2026-01-08; tim Y main 2026-01-05.
  // Laga uji: X (home) vs Y (away) 2026-01-11.
  const base: EvalMatchRow[] = [
    mkMatch("m1", "comp_t", "2026-01-01", "X", "Z", 2, 0),
    mkMatch("m2", "comp_t", "2026-01-03", "Z", "Y", 1, 1),
    mkMatch("m3", "comp_t", "2026-01-05", "Y", "Z", 0, 2),
    mkMatch("m4", "comp_t", "2026-01-08", "Z", "X", 1, 3),
    mkMatch("m5", "comp_t", "2026-01-11", "X", "Y", 1, 0),
  ];
  const seasons = new Map(base.map((m) => [m.match_id, "2026"]));
  const exBase = new Q1FeatureExtractor(base, base, seasons);
  const f = exBase.featuresFor(base[4]);
  // rest X = 11−8 = 3 hari; rest Y = 11−5 = 6 hari → (3−6)/7 = −3/7.
  check("D1 rest_adv home = −3/7", approx(f.home.restAdv, -3 / 7, 1e-12), `${f.home.restAdv}`);
  check("D2 rest_adv away = kebalikan", approx(f.away.restAdv, 3 / 7, 1e-12));
  check("D3 miss_rest = 0", f.home.missRest === 0 && f.away.missRest === 0);
  // form X: laga m1 (gf 2) + m4 (gf 3); compAvg as-of tanggal laga tsb:
  // sebelum 01-01 tidak ada laga → LEGACY tak ada utk comp_t → null → dilewati;
  // m4 pada 01-08: laga strictly-before = m1,m2,m3 → total gol 2+0+1+1+0+2=6, n=3 → 6/(2*3)=1 → resid 3−1=2.
  // Kontribusi valid hanya 1 (<3) → miss_form = 1 untuk X.
  check("D4 form X missing (kontribusi <3)", f.home.missForm === 1 && f.home.formResid === 0);

  // Jebakan masa depan: tanam laga ekstrem SESUDAH laga uji.
  const future = mkMatch("mF", "comp_t", "2026-02-01", "X", "Y", 15, 14);
  const withFuture = [...base, future];
  const seasonsF = new Map(withFuture.map((m) => [m.match_id, "2026"]));
  const exF = new Q1FeatureExtractor(withFuture, withFuture, seasonsF);
  const fAfter = exF.featuresFor(base[4]);
  check(
    "C1 injeksi masa depan: fitur laga lama identik",
    JSON.stringify(featureVector(fAfter.home)) === JSON.stringify(featureVector(f.home)) &&
      JSON.stringify(featureVector(fAfter.away)) === JSON.stringify(featureVector(f.away)),
  );

  // Kepekaan: tanam laga masa lalu yang sah SEBELUM laga uji → fitur berubah.
  const past = mkMatch("m0", "comp_t", "2026-01-10", "Y", "Z", 4, 0);
  const withPast = [base[0], base[1], base[2], base[3], past, base[4]];
  const seasonsP = new Map(withPast.map((m) => [m.match_id, "2026"]));
  const exP = new Q1FeatureExtractor(withPast, withPast, seasonsP);
  const fPast = exP.featuresFor(base[4]);
  check("C2 injeksi masa lalu sah: rest Y berubah (11−10=1)", approx(fPast.away.restAdv, -(3 - 1) / 7, 1e-12), `${fPast.away.restAdv}`);
}

{
  // Promoted: liga 2 musim; musim 1 = 60 laga di antara 6 tim lama;
  // musim 2 menambah tim BARU. Tim lama promoted=0, tim baru=1.
  const matches: EvalMatchRow[] = [];
  const seasons = new Map<string, string>();
  const old = ["T1", "T2", "T3", "T4", "T5", "T6"];
  let id = 0;
  const add = (comp: string, date: string, h: string, a: string, season: string) => {
    const m = mkMatch(`p${id++}`, comp, date, h, a, 1, 0);
    matches.push(m);
    seasons.set(m.match_id, season);
  };
  for (let i = 0; i < 60; i++) {
    add("comp_p", `2025-0${1 + (i % 6)}-${String(1 + (i % 27)).padStart(2, "0")}`, old[i % 6], old[(i + 1) % 6], "2025");
  }
  add("comp_p", "2026-01-10", "T1", "T2", "2026");
  add("comp_p", "2026-01-11", "NEW", "T3", "2026");
  add("comp_p", "2026-01-12", "T4", "NEW", "2026");
  const ex = new Q1FeatureExtractor(matches, matches, seasons);
  const fOld = ex.featuresFor(matches[60]);
  const fNew = ex.featuresFor(matches[61]);
  check("D5 tim lama promoted=0", fOld.home.promoted === 0 && fOld.away.promoted === 0);
  check("D6 tim baru promoted=1 (home)", fNew.home.promoted === 1);
  check("D7 tim baru promoted=1 (away)", ex.featuresFor(matches[62]).away.promoted === 1);
  check("D8 musim pertama: promoted selalu 0", ex.featuresFor(matches[0]).home.promoted === 0);
}

// ---------------------------------------------------------------------------
// E. Paritas matriks vs evaluator
// ---------------------------------------------------------------------------
{
  for (const [lam, mu] of [
    [1.6, 0.95],
    [0.7, 2.3],
    [2.8, 1.1],
    [1.0, 1.0],
  ] as const) {
    const a = matrixProbs(lam, mu, 0);
    const b = fullMatrixProbs(lam, mu, 0);
    check(
      `E paritas matriks λ=${lam} μ=${mu}`,
      approx(a.p[0], b.p[0], 1e-9) && approx(a.p[1], b.p[1], 1e-9) && approx(a.p[2], b.p[2], 1e-9) && approx(a.pOver25, b.pOver25, 1e-9),
    );
    check(`E BTTS valid λ=${lam} μ=${mu}`, b.pBtts > 0 && b.pBtts < 1);
  }
}

// ---------------------------------------------------------------------------
// F. Gerbang brief via mesin repo
// ---------------------------------------------------------------------------
{
  const base = {
    meanDelta: -0.01,
    bootstrapUpperOneSided95: -0.002,
    coverageChampion: 1,
    coverageChallenger: 1,
    brierChampion: 0.6,
    brierChallenger: 0.6,
    nMatches: 6708,
    nBlocks: 33,
  };
  check("F1 semua lolos → promote → eligible_for_shadow", gateVocabulary(applyKappaDecision(base).decision) === "eligible_for_shadow");
  check(
    "F2 Δ gagal → retain",
    gateVocabulary(applyKappaDecision({ ...base, meanDelta: -0.001 }).decision) === "retain",
  );
  check(
    "F3 UB CI ≥ 0 → retain",
    gateVocabulary(applyKappaDecision({ ...base, bootstrapUpperOneSided95: 0.001 }).decision) === "retain",
  );
  check(
    "F4 sampel kurang → inconclusive",
    gateVocabulary(applyKappaDecision({ ...base, nMatches: 500 }).decision) === "inconclusive",
  );
  check(
    "F5 Brier naik > 0,002 → retain",
    gateVocabulary(applyKappaDecision({ ...base, brierChallenger: 0.603 }).decision) === "retain",
  );
}

// ---------------------------------------------------------------------------
// G. Penjaga isolasi shadow — jalur kandidat tidak menyentuh artefak saji
// ---------------------------------------------------------------------------
{
  const dataDir = path.join(process.cwd(), "data");
  const guardFiles = [path.join(dataDir, "model-manifest.json"), ...fs.readdirSync(path.join(dataDir, "model-artifacts")).map((f) => path.join(dataDir, "model-artifacts", f))];
  const hashAll = () => guardFiles.map((f) => createHash("sha256").update(fs.readFileSync(f)).digest("hex")).join("|");
  const before = hashAll();
  // Jalankan seluruh jalur kandidat (fitur → fit → aplikasi) di sini.
  const matches: EvalMatchRow[] = [mkMatch("g1", "comp_g", "2026-01-01", "H", "A", 2, 1), mkMatch("g2", "comp_g", "2026-01-08", "A", "H", 0, 0)];
  const seasons = new Map(matches.map((m) => [m.match_id, "2026"]));
  const ex = new Q1FeatureExtractor(matches, matches, seasons);
  const feats = ex.featuresFor(matches[1]);
  const rows: PoissonFitRow[] = [{ offsetLog: Math.log(1.4), x: featureVector(feats.home), y: 2 }];
  const fit = fitPoissonRidge(rows, 3);
  applyCandidate(1.4, 1.0, feats, fit.beta, fit.beta);
  const after = hashAll();
  check("G1 hash manifest+artefak saji identik sebelum/sesudah jalur kandidat", before === after);
  check("G2 modelVersion aktif tetap champion", JSON.parse(fs.readFileSync(path.join(dataDir, "model-manifest.json"), "utf8")).modelVersion.includes("kfit10"));
}

// ---------------------------------------------------------------------------
console.log(`test-kandidat-q1: ${pass} lolos, ${fail} gagal`);
for (const f of failures) console.log(`  GAGAL: ${f}`);
process.exit(fail ? 1 : 0);
