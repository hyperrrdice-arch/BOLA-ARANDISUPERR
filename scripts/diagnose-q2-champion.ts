/**
 * DIAGNOSTIK CHAMPION untuk Q2 (Item 2, Sprint A+B, langkah pertama Fase 4).
 *
 * Mengukur pada baris holdout H yang sama dengan PR 3/PR 4 (jangkar
 * log-loss champion harus mereproduksi 1,0134022623271062):
 *  - seri: probabilitas prediksi (rerata) vs frekuensi aktual;
 *  - sel skor rendah (0-0, 0-1, 1-0, 1-1): massa prediksi vs aktual;
 *  - BTTS: prediksi vs aktual;
 *  - distribusi total gol + ekor tinggi (>=5, >=6): prediksi vs aktual;
 *  - overdispersi: statistik Pearson gol kandang/tandang/total terhadap
 *    rerata Poisson terpasang (lambda, mu champion) — nilai > 1 berarti
 *    varians aktual melebihi Poisson (syarat perlu Q2b Negative Binomial).
 *
 * Read-only terhadap data produksi; menulis JSON diagnostik ke
 * tasks/sprint-ab/evidence/q2-diagnostic/diagnostic.json.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import {
  CHAMPION_CONFIG,
  ChronologicalEvaluator,
  summarizePredictions,
  type EvalLogRow,
  type EvalMatchRow,
  type ScoredRow,
} from "../lib/eval/chronological-evaluator";
import { calculateDixonColes } from "../lib/quant/dixon-coles";

const args = process.argv.slice(2);
const argVal = (name: string, dflt: string): string => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const DATA_DIR = argVal("data-dir", "data");
const OUT_PATH = argVal("out", "tasks/sprint-ab/evidence/q2-diagnostic/diagnostic.json");
const LOCKED_CHAMPION_H_LL = 1.0134022623271062;

function main(): void {
  const ds = new DatabaseSync(path.join(DATA_DIR, "thestats_dataset.db"), { readOnly: true });
  const universe = ds
    .prepare(
      `SELECT match_id, competition_id, utc_date, home_team_id, away_team_id, home_score, away_score
       FROM matches WHERE competition_id LIKE 'sm:%' AND status = 'finished'
         AND home_score IS NOT NULL AND away_score IS NOT NULL
       ORDER BY competition_id, utc_date`,
    )
    .all() as unknown as EvalMatchRow[];
  const compAvg = ds
    .prepare(
      `SELECT match_id, competition_id, utc_date, home_team_id, away_team_id, home_score, away_score
       FROM matches WHERE status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL
       ORDER BY competition_id, utc_date`,
    )
    .all() as unknown as EvalMatchRow[];
  const compOfMatch = new Map<string, string>();
  for (const r of ds.prepare("SELECT match_id, competition_id FROM matches").all() as unknown as { match_id: string; competition_id: string }[]) {
    compOfMatch.set(r.match_id, r.competition_id);
  }
  const logs = (
    ds
      .prepare(
        `SELECT team_id, match_date, goals_for, goals_against, xg_for, xg_against, match_id
         FROM team_match_logs WHERE source = 'sportmonks' ORDER BY team_id, match_date`,
      )
      .all() as unknown as (EvalLogRow & { match_id: string })[]
  ).map((r) => ({ ...r, competition_id: compOfMatch.get(r.match_id) ?? null }));
  const registryStatus = new Map<string, string>();
  for (const r of ds.prepare("SELECT league_id, status FROM league_calibration").all() as unknown as { league_id: string; status: string }[]) {
    registryStatus.set(r.league_id, r.status);
  }
  ds.close();

  const ev = new ChronologicalEvaluator(universe, compAvg, logs, { ...CHAMPION_CONFIG, compAvgMode: "as-of" });
  const leagueIds = ev
    .leagueIds()
    .filter((id) => {
      const st = registryStatus.get(id);
      return (st === "calibrated" || st === "partial") && ev.leagueMatches(id).length >= 120;
    })
    .sort((a, b) => a.localeCompare(b));

  const scored: ScoredRow[] = [];
  let n = 0;
  let predDraw = 0;
  let actDraw = 0;
  const cells = ["0-0", "0-1", "1-0", "1-1"] as const;
  const predCell: Record<string, number> = { "0-0": 0, "0-1": 0, "1-0": 0, "1-1": 0 };
  const actCell: Record<string, number> = { "0-0": 0, "0-1": 0, "1-0": 0, "1-1": 0 };
  let predBtts = 0;
  let actBtts = 0;
  let predTail5 = 0;
  let predTail6 = 0;
  let actTail5 = 0;
  let actTail6 = 0;
  let predTotalMean = 0;
  let actTotalSum = 0;
  let actTotalSq = 0;
  let pearsonHome = 0;
  let pearsonAway = 0;
  let pearsonTotal = 0;
  const actTotalHist: Record<string, number> = {};
  const predTotalHist: Record<string, number> = {};

  for (const leagueId of leagueIds) {
    const fold = { name: "H" as const, trainEnd: 0.85, testStart: 0.85, testEnd: 1.0 };
    const { fit, test } = ev.foldFit(leagueId, fold, 10);
    const fit20 = ev.foldFit(leagueId, fold, 20);
    if (!fit || !fit20.fit) continue;
    for (const m of test) {
      const pred = ev.predictLevelB(fit, m);
      scored.push({ p: pred.p, y: m.home_score > m.away_score ? 0 : m.home_score === m.away_score ? 1 : 2, fallback: pred.fallback });
      const dc = calculateDixonColes({
        homeAttack: 1,
        homeDefense: 1,
        awayAttack: 1,
        awayDefense: 1,
        homeAdvantage: pred.lam / pred.mu,
        leagueAvgGoals: pred.mu,
        rho: 0,
        maxGoals: 10,
      });
      const mx = dc.score_matrix;
      n++;
      predDraw += pred.p[1];
      if (m.home_score === m.away_score) actDraw++;
      for (const c of cells) {
        const [x, y] = c.split("-").map(Number);
        predCell[c] += mx[x]?.[y] ?? 0;
      }
      const key = `${m.home_score}-${m.away_score}`;
      if (key in actCell) actCell[key]++;
      let btts = 0;
      let tail5 = 0;
      let tail6 = 0;
      for (let x = 0; x < mx.length; x++) {
        for (let y = 0; y < mx[x].length; y++) {
          const p = mx[x][y];
          if (x >= 1 && y >= 1) btts += p;
          if (x + y >= 5) tail5 += p;
          if (x + y >= 6) tail6 += p;
          const tk = String(Math.min(x + y, 10));
          predTotalHist[tk] = (predTotalHist[tk] ?? 0) + p;
        }
      }
      predBtts += btts;
      if (m.home_score >= 1 && m.away_score >= 1) actBtts++;
      predTail5 += tail5;
      predTail6 += tail6;
      const total = m.home_score + m.away_score;
      if (total >= 5) actTail5++;
      if (total >= 6) actTail6++;
      predTotalMean += pred.lam + pred.mu;
      actTotalSum += total;
      actTotalSq += total * total;
      const tk = String(Math.min(total, 10));
      actTotalHist[tk] = (actTotalHist[tk] ?? 0) + 1;
      pearsonHome += ((m.home_score - pred.lam) ** 2) / Math.max(pred.lam, 1e-9);
      pearsonAway += ((m.away_score - pred.mu) ** 2) / Math.max(pred.mu, 1e-9);
      pearsonTotal += ((total - (pred.lam + pred.mu)) ** 2) / Math.max(pred.lam + pred.mu, 1e-9);
    }
  }

  const champ = summarizePredictions(scored);
  const actTotalMean = actTotalSum / n;
  const actTotalVar = actTotalSq / n - actTotalMean * actTotalMean;
  const diag = {
    n,
    anchor_champion_h_logloss: champ.logloss,
    anchor_locked: LOCKED_CHAMPION_H_LL,
    anchor_ok: Math.abs(champ.logloss - LOCKED_CHAMPION_H_LL) < 1e-9,
    draws: {
      predicted_share: predDraw / n,
      actual_share: actDraw / n,
      gap_pp: (actDraw / n - predDraw / n) * 100,
    },
    low_cells: Object.fromEntries(
      cells.map((c) => [
        c,
        { predicted_share: predCell[c] / n, actual_share: actCell[c] / n, gap_pp: (actCell[c] / n - predCell[c] / n) * 100 },
      ]),
    ),
    btts: { predicted_share: predBtts / n, actual_share: actBtts / n, gap_pp: (actBtts / n - predBtts / n) * 100 },
    total_goals: {
      predicted_mean: predTotalMean / n,
      actual_mean: actTotalMean,
      actual_variance: actTotalVar,
      actual_var_over_mean: actTotalVar / actTotalMean,
      predicted_hist_share: Object.fromEntries(Object.entries(predTotalHist).map(([k, v]) => [k, v / n])),
      actual_hist_share: Object.fromEntries(Object.entries(actTotalHist).map(([k, v]) => [k, v / n])),
    },
    tails: {
      ge5: { predicted_share: predTail5 / n, actual_share: actTail5 / n },
      ge6: { predicted_share: predTail6 / n, actual_share: actTail6 / n },
    },
    pearson_dispersion: {
      home_goals: pearsonHome / n,
      away_goals: pearsonAway / n,
      total_goals: pearsonTotal / n,
      note: "1,0 = persis Poisson terhadap rerata terpasang; >1 = overdispersi; <1 = underdispersi.",
    },
  };
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(diag, null, 2));
  console.log(JSON.stringify(diag, null, 2));
  if (!diag.anchor_ok) {
    console.error("JANGKAR GAGAL — diagnostik tidak sah.");
    process.exitCode = 2;
  }
}

main();
