/**
 * CLI IRISAN ML1 (Fase 4 — diagnostik, BUKAN dasar gate).
 *
 * Menghitung tabel Champion vs ML1-A vs ML1-B pada holdout H untuk tiga
 * irisan design tasks/ml1/design.md §6:
 *   1. pooled        — universe PR 3 penuh (dasar resmi gate ada di
 *                      decision.json per model; di sini direproduksi).
 *   2. kompetitif    — status registry calibrated|partial.
 *   3. friendlies    — status uncalibrated atau tanpa baris registry
 *                      (termasuk Club Friendlies 3/4 sm:2451/sm:2452).
 *
 * Per irisan per model: n, log-loss (konvensi harness, jepit 1e-12),
 * Δ vs champion, UB bootstrap satu-sisi 95% (blok pekan ISO, 5.000
 * resample, seed 20261124 — mesin yang sama dengan gate), Brier.
 * Ablasi bersih ML1-B − ML1-A dihitung dari baris berpasangan yang sama.
 *
 * Hanya membaca berkas artefak di tasks/ml1/ — tidak menyentuh DB.
 *
 * Pakai: npx tsx scripts/ml1-slices.ts
 */
import fs from "node:fs";
import path from "node:path";
import {
  brierScore,
  logLossClamped,
  outcomeIndex,
} from "../lib/eval/chronological-evaluator";
import { blockBootstrapDelta, type PairedDeltaRow } from "../lib/quant/experiment-stats";

const FEATURES = "tasks/ml1/evidence/features.jsonl";
const PRED_A = "tasks/ml1/evidence/ml1-a/predictions.jsonl";
const PRED_B = "tasks/ml1/evidence/ml1-b/predictions.jsonl";
const OUT = "tasks/ml1/evidence/slices.json";
const BOOTSTRAP_SEED = 20261124;

interface FeatureRow {
  match: string;
  week: string;
  hs: number;
  as: number;
  status: string | null;
  champP: [number, number, number];
}
interface PredRow {
  match: string;
  cand: { p: [number, number, number] };
}

function readJsonl<T>(p: string): T[] {
  return fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
}

interface SliceStat {
  n: number;
  logloss: number;
  brier: number;
  delta_vs_champion: number | null;
  ub_ci_95: number | null;
  blocks: number | null;
}

function sliceStats(
  rows: FeatureRow[],
  candByMatch: Map<string, [number, number, number]> | null,
): { champion: SliceStat; candidate: SliceStat | null } {
  const stat = (getP: (r: FeatureRow) => [number, number, number]): SliceStat => {
    let ll = 0;
    let br = 0;
    for (const r of rows) {
      const y = outcomeIndex(r.hs, r.as);
      ll += logLossClamped(getP(r), y);
      br += brierScore(getP(r), y);
    }
    return { n: rows.length, logloss: ll / rows.length, brier: br / rows.length, delta_vs_champion: null, ub_ci_95: null, blocks: null };
  };
  const champion = stat((r) => r.champP);
  if (!candByMatch) return { champion, candidate: null };
  const candidate = stat((r) => candByMatch.get(r.match)!);
  const paired: PairedDeltaRow[] = rows.map((r) => {
    const y = outcomeIndex(r.hs, r.as);
    return { block: r.week, delta: logLossClamped(candByMatch.get(r.match)!, y) - logLossClamped(r.champP, y) };
  });
  const boot = blockBootstrapDelta(paired, { resamples: 5000, seed: BOOTSTRAP_SEED });
  candidate.delta_vs_champion = boot.meanDelta;
  candidate.ub_ci_95 = boot.upperOneSided95;
  candidate.blocks = boot.nBlocks;
  return { champion, candidate };
}

function main(): void {
  const features = readJsonl<FeatureRow & { fold: string }>(FEATURES).filter((r) => r.fold === "H");
  const predA = new Map(readJsonl<PredRow>(PRED_A).map((r) => [r.match, r.cand.p]));
  const predB = new Map(readJsonl<PredRow>(PRED_B).map((r) => [r.match, r.cand.p]));
  for (const r of features) {
    if (!predA.has(r.match) || !predB.has(r.match)) throw new Error(`prediksi hilang untuk ${r.match}`);
  }

  const slicesDef: { id: string; label: string; test: (s: string | null) => boolean }[] = [
    { id: "pooled", label: "Pooled (Universe PR 3 penuh)", test: () => true },
    { id: "kompetitif", label: "Liga Kompetitif / Terkalibrasi", test: (s) => s === "calibrated" || s === "partial" },
    { id: "friendlies", label: "Friendlies / Uncalibrated", test: (s) => s === "uncalibrated" || s === null },
  ];

  const out: Record<string, unknown> = { generated_from: { features: FEATURES, pred_a: PRED_A, pred_b: PRED_B }, slices: {} };
  const slices: Record<string, unknown> = {};
  for (const def of slicesDef) {
    const rows = features.filter((r) => def.test(r.status));
    const a = sliceStats(rows, predA);
    const b = sliceStats(rows, predB);
    // Ablasi bersih B − A pada baris berpasangan irisan ini.
    const pairedBA: PairedDeltaRow[] = rows.map((r) => {
      const y = outcomeIndex(r.hs, r.as);
      return { block: r.week, delta: logLossClamped(predB.get(r.match)!, y) - logLossClamped(predA.get(r.match)!, y) };
    });
    const bootBA = blockBootstrapDelta(pairedBA, { resamples: 5000, seed: BOOTSTRAP_SEED });
    slices[def.id] = {
      label: def.label,
      champion: a.champion,
      ml1_a: a.candidate,
      ml1_b: b.candidate,
      ablation_b_minus_a: { mean_delta: bootBA.meanDelta, ub_ci_95: bootBA.upperOneSided95, ci95: [bootBA.ci95Low, bootBA.ci95High], blocks: bootBA.nBlocks },
    };
  }
  out.slices = slices;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(slices, null, 2));
}

main();
