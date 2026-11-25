/**
 * CLI EVALUASI SHADOW ML1 (Fase 2/3).
 *
 * Membaca berkas fitur (scripts/ml1-extract-features.ts) + prediksi
 * LightGBM (scripts/ml1-train.py), memetakan lambda/mu kandidat ke
 * probabilitas lewat matriks evaluator yang sama persis dengan champion,
 * lalu menilai holdout H SATU KALI lewat mesin gate PR 4 repo
 * (applyKappaDecision + blockBootstrapDelta). Menulis artefak format
 * PR 3/PR 4: design.md, run-manifest.json, predictions.jsonl,
 * metrics.json, decision.json, candidate-artifact.json.
 *
 * Jangkar sanity: probabilitas champion pada irisan baris H yang sama
 * dengan artefak beku PR 4 (tasks/pr4/evidence/q1-shadow/predictions.jsonl)
 * WAJIB cocok ±1e-9 dan log-loss irisan itu = 1,0134022623271062 (terkunci
 * PR 3). Bila tidak, exit code 2 — jangan percaya hasil kandidat.
 *
 * SHADOW MURNI: DB tidak disentuh sama sekali oleh skrip ini (hanya
 * membaca berkas di tasks/); penjaga isolasi sha256 berkas saji dicatat
 * sebelum/sesudah di run-manifest.
 *
 * Pakai:
 *   npx tsx scripts/ml1-evaluate.ts --model=a \
 *     --features=tasks/ml1/evidence/features.jsonl \
 *     --pred-dir=tasks/ml1/evidence/ml1-a \
 *     --out=tasks/ml1/evidence/ml1-a
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  isoWeekKey,
  logLossClamped,
  matrixProbs,
  outcomeIndex,
  summarizePredictions,
  type ScoredRow,
} from "../lib/eval/chronological-evaluator";
import { ML1_A_FEATURE_NAMES, ML1_B_FEATURE_NAMES } from "../lib/eval/ml1-features";
import { poissonNll } from "../lib/eval/kandidat-q1-poisson";
import { applyKappaDecision, blockBootstrapDelta, type PairedDeltaRow } from "../lib/quant/experiment-stats";
import { dbDir } from "../lib/db/paths";

const args = process.argv.slice(2);
const argVal = (name: string, dflt: string): string => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const MODEL = argVal("model", "");
const FEATURES = argVal("features", "tasks/ml1/evidence/features.jsonl");
const PRED_DIR = argVal("pred-dir", "");
const OUT_DIR = argVal("out", "");
const DATA_DIR = argVal("data-dir", "data");
const EVAL_DB_DIR = argVal("data-dir", dbDir());
const Q1_PREDICTIONS = "tasks/pr4/evidence/q1-shadow/predictions.jsonl";
const BOOTSTRAP_SEED = 20261124;
const LOCKED_CHAMPION_H_LL = 1.0134022623271062;

const sha256File = (p: string): string => createHash("sha256").update(fs.readFileSync(p)).digest("hex");

function guardSnapshot(): Record<string, unknown> {
  const snap: Record<string, unknown> = {};
  for (const f of ["model-manifest.json", "calibrated_ratings.json"]) {
    const p = path.join(DATA_DIR, f);
    if (fs.existsSync(p)) snap[f] = { sha256: sha256File(p) };
  }
  for (const db of ["picks.db", "analysis_snapshots.db", "thestats_dataset.db"]) {
    const p = path.join(EVAL_DB_DIR, db);
    if (fs.existsSync(p)) {
      const st = fs.statSync(p);
      snap[db] = { size_bytes: st.size, mtime: st.mtime.toISOString() };
    }
  }
  return snap;
}

interface FeatureRow {
  match: string;
  league: string;
  fold: string;
  date: string;
  week: string;
  hs: number;
  as: number;
  status: string | null;
  champLam: number;
  champMu: number;
  champP: [number, number, number];
  champOver: number;
  champFallback: boolean;
  featA: number[];
  featB: number[];
}

function readJsonl<T>(p: string): T[] {
  return fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
}

function main(): void {
  if (MODEL !== "a" && MODEL !== "b") throw new Error("--model=a|b wajib");
  if (!PRED_DIR || !OUT_DIR) throw new Error("--pred-dir dan --out wajib");
  const label = MODEL === "a" ? "ML1-A" : "ML1-B";
  const featureNames = MODEL === "a" ? ML1_A_FEATURE_NAMES : ML1_B_FEATURE_NAMES;

  const guardBefore = guardSnapshot();
  const rows = readJsonl<FeatureRow>(FEATURES);
  const predH = new Map(readJsonl<{ match: string; lam: number; mu: number }>(path.join(PRED_DIR, "pred-h.jsonl")).map((r) => [r.match, r]));
  const predV2 = new Map(readJsonl<{ match: string; lam: number; mu: number }>(path.join(PRED_DIR, "pred-v2.jsonl")).map((r) => [r.match, r]));
  const trainSummary = JSON.parse(fs.readFileSync(path.join(PRED_DIR, "train-summary.json"), "utf8")) as Record<string, unknown>;

  const namedFeatures = (r: FeatureRow): Record<string, number> => {
    const vec = MODEL === "a" ? r.featA : r.featB;
    const out: Record<string, number> = {};
    featureNames.forEach((n, i) => {
      out[n] = vec[i];
    });
    return out;
  };

  interface OutRow {
    match: string;
    league: string;
    date: string;
    week: string;
    hs: number;
    as: number;
    champ: { lam: number; mu: number; p: [number, number, number]; pOver25: number };
    cand: { lam: number; mu: number; p: [number, number, number]; pOver25: number; abstain: boolean };
    features: Record<string, number>;
    fallback: boolean;
  }
  const buildOut = (r: FeatureRow, pred: { lam: number; mu: number } | undefined): OutRow => {
    const champ = { lam: r.champLam, mu: r.champMu, p: r.champP, pOver25: r.champOver };
    if (r.champFallback || !pred) {
      return {
        match: r.match, league: r.league, date: r.date, week: r.week, hs: r.hs, as: r.as,
        champ, cand: { ...champ, abstain: true }, features: namedFeatures(r), fallback: r.champFallback,
      };
    }
    const mp = matrixProbs(pred.lam, pred.mu, 0);
    return {
      match: r.match, league: r.league, date: r.date, week: r.week, hs: r.hs, as: r.as,
      champ,
      cand: { lam: pred.lam, mu: pred.mu, p: mp.p, pOver25: mp.pOver25, abstain: false },
      features: namedFeatures(r),
      fallback: mp.fallback,
    };
  };

  // --- Holdout H (dinilai satu kali) ---------------------------------------
  const hRows = rows.filter((r) => r.fold === "H");
  const hOut = hRows.map((r) => buildOut(r, predH.get(r.match)));
  hOut.sort((a, b) => (a.match < b.match ? -1 : a.match > b.match ? 1 : 0));

  const champScored: ScoredRow[] = hOut.map((r) => ({ p: r.champ.p, y: outcomeIndex(r.hs, r.as), fallback: hRows.find((x) => x.match === r.match)?.champFallback ?? false }));
  const candScored: ScoredRow[] = hOut.map((r) => ({ p: r.cand.p, y: outcomeIndex(r.hs, r.as), fallback: r.fallback }));
  const champMetrics = summarizePredictions(champScored);
  const candMetrics = summarizePredictions(candScored);

  const paired: PairedDeltaRow[] = hOut.map((r) => {
    const y = outcomeIndex(r.hs, r.as);
    return { block: r.week, delta: logLossClamped(r.cand.p, y) - logLossClamped(r.champ.p, y) };
  });
  const boot = blockBootstrapDelta(paired, { resamples: 5000, seed: BOOTSTRAP_SEED });
  const gate = applyKappaDecision({
    meanDelta: boot.meanDelta,
    bootstrapUpperOneSided95: boot.upperOneSided95,
    coverageChampion: champMetrics.coverage,
    coverageChallenger: candMetrics.coverage,
    brierChampion: champMetrics.brier,
    brierChallenger: candMetrics.brier,
    nMatches: boot.nMatches,
    nBlocks: boot.nBlocks,
  });
  const briefStatus = gate.decision === "promote" ? "READY_FOR_PROSPECTIVE_CONFIRMATION" : "RETAIN_CHAMPION";

  // --- Jangkar champion vs artefak beku PR 4 --------------------------------
  const q1Rows = readJsonl<{ match: string; champ: { p: [number, number, number] }; hs: number; as: number }>(Q1_PREDICTIONS);
  const myChampByMatch = new Map(hOut.map((r) => [r.match, r]));
  let anchorMatched = 0;
  let anchorMaxDiff = 0;
  let anchorLlSum = 0;
  for (const q of q1Rows) {
    const mine = myChampByMatch.get(q.match);
    if (!mine) continue;
    anchorMatched++;
    for (let k = 0; k < 3; k++) anchorMaxDiff = Math.max(anchorMaxDiff, Math.abs(mine.champ.p[k] - q.champ.p[k]));
    anchorLlSum += logLossClamped(mine.champ.p, outcomeIndex(q.hs, q.as));
  }
  const anchorLl = anchorMatched ? anchorLlSum / anchorMatched : NaN;
  const anchorOk = anchorMatched === q1Rows.length && anchorMaxDiff <= 1e-9 && Math.abs(anchorLl - LOCKED_CHAMPION_H_LL) < 1e-9;

  // --- Validasi V2 (diagnostik protokol; bukan gate) -------------------------
  const v2Rows = rows.filter((r) => r.fold === "V2");
  const v2Out = v2Rows.map((r) => buildOut(r, predV2.get(r.match)));
  const v2Champ = summarizePredictions(v2Out.map((r) => ({ p: r.champ.p, y: outcomeIndex(r.hs, r.as), fallback: v2Rows.find((x) => x.match === r.match)?.champFallback ?? false })));
  const v2Cand = summarizePredictions(v2Out.map((r) => ({ p: r.cand.p, y: outcomeIndex(r.hs, r.as), fallback: r.fallback })));

  // --- Sekunder H: NLL gol Poisson + OU2.5 -----------------------------------
  const binLl = (p: number, y: boolean): number => -Math.log(y ? p : 1 - p);
  let nllChamp = 0, nllCand = 0, ouChamp = 0, ouCand = 0;
  for (const r of hOut) {
    nllChamp += poissonNll(r.hs, r.champ.lam) + poissonNll(r.as, r.champ.mu);
    nllCand += poissonNll(r.hs, r.cand.lam) + poissonNll(r.as, r.cand.mu);
    const over = r.hs + r.as > 2.5;
    ouChamp += binLl(r.champ.pOver25, over);
    ouCand += binLl(r.cand.pOver25, over);
  }
  const nH = hOut.length;
  const secondaryH = {
    poisson_nll_goals: { n: nH, champion: nllChamp / nH, candidate: nllCand / nH, delta: nllCand / nH - nllChamp / nH },
    ou25_binary_logloss: { n: nH, champion: ouChamp / nH, candidate: ouCand / nH, delta: ouCand / nH - ouChamp / nH },
  };

  // --- Tulis artefak ----------------------------------------------------------
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.copyFileSync("tasks/ml1/design.md", path.join(OUT_DIR, "design.md"));
  fs.writeFileSync(path.join(OUT_DIR, "predictions.jsonl"), hOut.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const candidateArtifact = {
    candidate_id: MODEL === "a" ? "ml1-a-gbdt-poisson-form-elo-v1" : "ml1-b-gbdt-poisson-form-elo-shots-v1",
    hypothesis: MODEL === "a"
      ? "ML1-A — GBDT Poisson dangkal di atas base_margin champion, fitur form/Elo point-in-time (brief ML1 Tahap A)"
      : "ML1-B — ML1-A + proxy shots/SoT as-of dari log kanonik (brief ML1 Tahap B)",
    champion: "2.0-dixon-coles-mle+kfit10+hl365+rho:zero+js2 (Level B, evaluator PR 3, as-of)",
    backend: trainSummary.backend,
    chosen_config: trainSummary.chosen,
    base_params: trainSummary.base_params,
    feature_names: featureNames,
    trained_on: trainSummary.rows,
    intensity_bounds: [0.05, 6.0],
    abstain_policy: "identik dengan fallback champion (matriks)",
    offset_composition: "lambda = clamp(exp(log lambda_champion + raw_score), 0.05, 6.0) — init_score TIDAK termasuk di predict() LightGBM (terverifikasi Fase 0)",
  };
  const artifactSha = createHash("sha256").update(JSON.stringify(candidateArtifact)).digest("hex");
  fs.writeFileSync(path.join(OUT_DIR, "candidate-artifact.json"), JSON.stringify({ ...candidateArtifact, artifact_sha256: artifactSha }, null, 2));

  const metrics = {
    universe: {
      leagues_in_scope: new Set(rows.map((r) => r.league)).size,
      rows_v1: rows.filter((r) => r.fold === "V1").length,
      rows_v2: v2Rows.length,
      rows_h: nH,
    },
    selection: { grid: trainSummary.grid, chosen: trainSummary.chosen, nll_v2_chosen: trainSummary.nll_v2_chosen },
    validation_v2: {
      champion: v2Champ,
      candidate: v2Cand,
      delta_candidate_minus_champion: v2Cand.logloss - v2Champ.logloss,
    },
    holdout_h: {
      window: [hOut.map((r) => r.date).sort()[0], hOut.map((r) => r.date).sort()[nH - 1]],
      champion: champMetrics,
      candidate: candMetrics,
      delta_candidate_minus_champion: candMetrics.logloss - champMetrics.logloss,
      bootstrap: boot,
      anchor_vs_pr4: {
        q1_rows: q1Rows.length,
        matched: anchorMatched,
        max_abs_prob_diff: anchorMaxDiff,
        champion_ll_on_intersection: anchorLl,
        champion_ll_locked: LOCKED_CHAMPION_H_LL,
        ok: anchorOk,
      },
    },
    secondary_h: secondaryH,
    gate: { machine_decision: gate.decision, brief_status: briefStatus, checks: gate.checks },
  };
  fs.writeFileSync(path.join(OUT_DIR, "metrics.json"), JSON.stringify(metrics, null, 2));
  fs.writeFileSync(
    path.join(OUT_DIR, "decision.json"),
    JSON.stringify(
      {
        decision: briefStatus,
        machine_decision: gate.decision,
        meaning:
          briefStatus === "READY_FOR_PROSPECTIVE_CONFIRMATION"
            ? "Gate PR 4 LOLOS pada holdout H lama — kandidat HANYA layak konfirmasi periode prospektif baru (Item 19) + persetujuan pemilik via promote-model.ts. TIDAK ada promosi di sprint ini."
            : "Gate PR 4 GAGAL pada holdout H — champion dipertahankan (RETAIN_CHAMPION).",
        gate_checks: gate.checks,
        headline: {
          n: boot.nMatches,
          blocks: boot.nBlocks,
          champion_logloss: champMetrics.logloss,
          candidate_logloss: candMetrics.logloss,
          mean_delta: boot.meanDelta,
          bootstrap_upper_one_sided_95: boot.upperOneSided95,
          ci95: [boot.ci95Low, boot.ci95High],
          coverage_champion: champMetrics.coverage,
          coverage_candidate: candMetrics.coverage,
          brier_champion: champMetrics.brier,
          brier_candidate: candMetrics.brier,
        },
        promotion_performed: false,
      },
      null,
      2,
    ),
  );

  const guardAfter = guardSnapshot();
  const guardOk = JSON.stringify(guardBefore) === JSON.stringify(guardAfter);
  let gitHead: string | null = null;
  try {
    gitHead = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    gitHead = null;
  }
  const manifest = {
    tool: "scripts/ml1-evaluate.ts",
    candidate: candidateArtifact.candidate_id,
    git_head: gitHead,
    generated_at: new Date().toISOString(),
    inputs: {
      features_file: FEATURES,
      features_sha256: sha256File(FEATURES),
      pred_h_sha256: sha256File(path.join(PRED_DIR, "pred-h.jsonl")),
      pred_v2_sha256: sha256File(path.join(PRED_DIR, "pred-v2.jsonl")),
      train_summary_sha256: sha256File(path.join(PRED_DIR, "train-summary.json")),
      design_sha256: sha256File("tasks/ml1/design.md"),
      q1_predictions_sha256: sha256File(Q1_PREDICTIONS),
    },
    config: { bootstrap: { resamples: 5000, seed: BOOTSTRAP_SEED }, gate: "applyKappaDecision (ambang beku repo)" },
    anchors: { champion_vs_pr4_ok: anchorOk },
    guard: { before: guardBefore, after: guardAfter, identical: guardOk },
  };
  fs.writeFileSync(path.join(OUT_DIR, "run-manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(
    JSON.stringify(
      {
        model: label,
        rows_h: nH,
        holdout: {
          champion_ll: champMetrics.logloss,
          candidate_ll: candMetrics.logloss,
          delta: boot.meanDelta,
          upper_one_sided_95: boot.upperOneSided95,
          ci95: [boot.ci95Low, boot.ci95High],
        },
        validation_v2_delta: v2Cand.logloss - v2Champ.logloss,
        anchor_ok: anchorOk,
        gate_machine: gate.decision,
        brief_status: briefStatus,
        guard_identical: guardOk,
      },
      null,
      2,
    ),
  );
  if (!anchorOk) {
    console.error("PERINGATAN JANGKAR: probabilitas champion tidak mereproduksi artefak beku PR 4 — selidiki sebelum memercayai hasil kandidat.");
    process.exitCode = 2;
  }
  if (!guardOk) {
    console.error("PERINGATAN PENJAGA: berkas saji/DB berubah selama evaluasi — isolasi shadow GAGAL.");
    process.exitCode = 3;
  }
}

main();
