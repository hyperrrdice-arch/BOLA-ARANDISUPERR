/**
 * TEST:EVALUATOR-KRONOLOGIS — suite PR 3 untuk evaluator kronologis
 * tunggal (lib/eval/chronological-evaluator.ts):
 *
 *  A. JEBAKAN KEBOCORAN (future-injection): data masa depan yang
 *     ditanam (laga kompetisi lain 12 gol, laga liga sendiri, log xG
 *     ekstrem — semua SETELAH cutoff) TIDAK BOLEH mengubah fitur
 *     maupun prediksi mode "as-of" sedikit pun; mode "whole-store"
 *     (replika kebocoran parlay-lab) HARUS berubah — membuktikan
 *     jebakan ini benar-benar bisa menangkap kebocoran compAvg.
 *  B. DETERMINISME: masukan sama → keluaran identik byte-per-byte,
 *     termasuk lewat cache fit.
 *  C. BATAS: laga di tanggal yang sama dengan cutoff TIDAK masuk
 *     jendela form/telemetri (strictly-before); liga tanpa riwayat /
 *     terlalu kecil → fallback terlabel, bukan NaN; tim baru yang
 *     sama sekali di luar fit → jalur fixedLamMu tetap valid;
 *     fallback LEGACY_COMP_AVG utuh.
 *  D. ISOLASI MODE: tanpa log lintas kompetisi, kedua mode identik
 *     (mode hanya berbeda lewat jalur compAvg); dengan log lintas
 *     kompetisi + data masa depan, keduanya berbeda.
 *  E. VALIDITAS: probabilitas di (0,1), jumlah 1, tanpa NaN.
 *
 * Semua data sintetis di memori — suite ini tidak menyentuh DB.
 * Pakai: npm run test:evaluator (dirantai di test:quant)
 */
import {
  CHAMPION_CONFIG,
  ChronologicalEvaluator,
  EVAL_FOLDS,
  type ChronoEvalConfig,
  type EvalLogRow,
  type EvalMatchRow,
} from "../lib/eval/chronological-evaluator";
import { Suite } from "./helpers/fixture-env";

const suite = new Suite("evaluator-kronologis PR 3");

// ---------------------------------------------------------------------------
// Data sintetis
// ---------------------------------------------------------------------------

function match(id: string, comp: string, date: string, h: string, a: string, hs: number, as: number): EvalMatchRow {
  return { match_id: id, competition_id: comp, utc_date: `${date}T19:00:00.000Z`, home_team_id: h, away_team_id: a, home_score: hs, away_score: as };
}
function log(team: string, date: string, gf: number, ga: number, xf: number | null, xa: number | null, comp: string): EvalLogRow {
  return { team_id: team, match_date: date, goals_for: gf, goals_against: ga, xg_for: xf, xg_against: xa, competition_id: comp };
}

/** comp_a: 20 laga mingguan 2026-01-05..2026-05-18. H1..H4 sejak awal; N1,N2 baru muncul di 3 laga terakhir. */
function compA(): EvalMatchRow[] {
  const rows: EvalMatchRow[] = [];
  const dates = Array.from({ length: 20 }, (_, i) => new Date(Date.UTC(2026, 0, 5 + 7 * i)).toISOString().slice(0, 10));
  const pairs: [string, string, number, number][] = [
    ["H1", "H2", 2, 1], ["H3", "H4", 1, 1], ["H2", "H3", 0, 2], ["H4", "H1", 1, 3],
    ["H1", "H3", 2, 0], ["H2", "H4", 2, 2], ["H4", "H2", 0, 1], ["H3", "H1", 1, 1],
    ["H1", "H4", 3, 1], ["H2", "H1", 1, 0], ["H3", "H2", 2, 1], ["H4", "H3", 0, 0],
    ["H1", "H2", 1, 1], ["H3", "H4", 2, 0], ["H2", "H3", 1, 2], ["H4", "H1", 2, 1],
    ["H1", "H3", 2, 2], ["N1", "H1", 1, 0], ["H2", "N2", 3, 1], ["N1", "N2", 2, 2],
  ];
  pairs.forEach(([h, a, hs, as], i) => rows.push(match(`a${i}`, "comp_a", dates[i], h, a, hs, as)));
  return rows;
}

/** comp_b: 8 laga gol tinggi (rata-rata 3,5 gol) untuk rata-rata kompetisi + log lintas kompetisi. */
function compB(): EvalMatchRow[] {
  const rows: EvalMatchRow[] = [];
  const dates = ["2026-01-19", "2026-02-02", "2026-02-16", "2026-03-02", "2026-03-16", "2026-03-30", "2026-04-06", "2026-04-20"];
  const pairs: [string, string, number, number][] = [
    ["B1", "B2", 3, 1], ["B3", "B4", 2, 2], ["B2", "B3", 4, 0], ["B4", "B1", 1, 2],
    ["B1", "B3", 3, 2], ["B2", "B4", 2, 1], ["B4", "B2", 0, 3], ["B3", "B1", 2, 2],
  ];
  pairs.forEach(([h, a, hs, as], i) => rows.push(match(`b${i}`, "comp_b", dates[i], h, a, hs, as)));
  return rows;
}

/** comp_tiny: hanya 3 tim — fitIPF harus null (T < 4). */
function compTiny(): EvalMatchRow[] {
  return [
    match("t0", "comp_tiny", "2026-01-05", "T1", "T2", 1, 0),
    match("t1", "comp_tiny", "2026-01-12", "T2", "T3", 2, 1),
    match("t2", "comp_tiny", "2026-01-19", "T3", "T1", 0, 0),
    match("t3", "comp_tiny", "2026-01-26", "T1", "T3", 3, 1),
    match("t4", "comp_tiny", "2026-02-02", "T2", "T1", 1, 1),
    match("t5", "comp_tiny", "2026-02-09", "T3", "T2", 2, 0),
  ];
}

/**
 * Log telemetri. H1 SENGAJA jarang di comp_a (2 log awal) dan punya
 * 4 log xG di comp_b sebelum 2026-04-13 → jendela bergulir H1 pada
 * cutoff itu berisi 6 log dengan 4 lintas kompetisi (cabang xG aktif,
 * bobot compAvg benar-benar dipakai). Tim lain: log comp_a biasa.
 */
function baseLogs(): EvalLogRow[] {
  const rows: EvalLogRow[] = [
    log("H1", "2026-01-05", 2, 1, 1.9, 1.1, "comp_a"),
    log("H1", "2026-01-12", 1, 1, 1.2, 1.0, "comp_a"),
    log("H1", "2026-02-02", 3, 0, 2.4, 0.8, "comp_b"),
    log("H1", "2026-03-02", 2, 1, 2.4, 0.8, "comp_b"),
    log("H1", "2026-03-16", 1, 1, 2.4, 0.8, "comp_b"),
    log("H1", "2026-04-06", 2, 0, 2.4, 0.8, "comp_b"),
    log("H2", "2026-01-05", 1, 2, 1.0, 1.8, "comp_a"),
    log("H2", "2026-01-19", 0, 2, 0.7, 1.9, "comp_a"),
    log("H2", "2026-02-09", 2, 2, 2.1, 2.0, "comp_a"),
    log("H2", "2026-03-23", 1, 2, 1.3, 1.7, "comp_a"),
    log("H3", "2026-01-12", 1, 1, 1.1, 1.2, "comp_a"),
    log("H3", "2026-02-02", 2, 0, 1.8, 0.6, "comp_a"),
    log("H3", "2026-03-09", 2, 1, 1.9, 1.1, "comp_a"),
    log("H4", "2026-01-19", 1, 3, 0.9, 2.6, "comp_a"),
    log("H4", "2026-02-16", 1, 1, 1.0, 1.0, "comp_a"),
  ];
  return rows.sort((x, y) => (x.team_id === y.team_id ? (x.match_date < y.match_date ? -1 : 1) : x.team_id < y.team_id ? -1 : 1));
}

/** Data masa depan yang ditanam: semua SETELAH cutoff uji 2026-04-13. */
function futureMatches(): EvalMatchRow[] {
  return [
    match("bFUT", "comp_b", "2026-06-01", "B1", "B2", 9, 3), // 12 gol — mengerek rata-rata whole-store comp_b
    match("aFUT", "comp_a", "2026-06-01", "H3", "H4", 8, 0), // laga liga sendiri di masa depan
  ];
}
function futureLogs(): EvalLogRow[] {
  return [log("H1", "2026-06-01", 9, 0, 9.9, 0.1, "comp_b")];
}

function buildUniverse(extraMatches: EvalMatchRow[]): EvalMatchRow[] {
  const all = [...compA(), ...compB(), ...compTiny(), ...extraMatches];
  return all.sort((x, y) => (x.competition_id === y.competition_id ? (x.utc_date < y.utc_date ? -1 : 1) : x.competition_id < y.competition_id ? -1 : 1));
}
function makeEv(extraMatches: EvalMatchRow[], extraLogs: EvalLogRow[], mode: ChronoEvalConfig["compAvgMode"]): ChronologicalEvaluator {
  const universe = buildUniverse(extraMatches);
  return new ChronologicalEvaluator(universe, universe, [...baseLogs(), ...extraLogs], { ...CHAMPION_CONFIG, compAvgMode: mode });
}

const H_FOLD = EVAL_FOLDS.find((f) => f.name === "H")!;
const TARGET_DATE = "2026-04-27"; // laga comp_a indeks 16 (H1 vs H3) — dinilai dengan fit eksplisit
const targetMatch = (): EvalMatchRow => compA()[16];

// --- A. Jebakan kebocoran ------------------------------------------------------
{
  const base = makeEv([], [], "as-of");
  const future = makeEv(futureMatches(), futureLogs(), "as-of");

  const avgBase = base.compAvgGoalsAt("comp_b", TARGET_DATE);
  const avgFuture = future.compAvgGoalsAt("comp_b", TARGET_DATE);
  suite.check("A1 compAvg as-of invariant terhadap laga masa depan", avgBase !== null && avgBase === avgFuture, `${avgBase} vs ${avgFuture}`);

  const telemBase = base.rollingTelem("H1", TARGET_DATE, "comp_a");
  const telemFuture = future.rollingTelem("H1", TARGET_DATE, "comp_a");
  suite.eq("A2 telemetri bergulir as-of invariant terhadap masa depan", telemFuture, telemBase);
  suite.check("A3 cabang xG lintas kompetisi aktif pada jebakan (xgSamples ≥ 3)", telemBase.xgSamples >= 3, `xgSamples=${telemBase.xgSamples}`);

  const fitBase = base.foldFit("comp_a", H_FOLD).fit;
  suite.check("A4 fit lipatan H tersedia", fitBase !== null);
  const pBase = base.predictLevelB(fitBase!, targetMatch());
  const pFuture = future.predictLevelB(fitBase!, targetMatch());
  suite.eq("A5 prediksi Level B as-of identik byte-per-byte walau masa depan ditanam", JSON.stringify(pFuture), JSON.stringify(pBase));

  // Mode bocor HARUS tertangkap jebakan yang sama.
  const leakyBase = makeEv([], [], "whole-store");
  const leakyFuture = makeEv(futureMatches(), futureLogs(), "whole-store");
  suite.check(
    "A6 compAvg whole-store BERUBAH oleh laga masa depan (jebakan peka)",
    leakyBase.compAvgGoalsWholeStore("comp_b") !== leakyFuture.compAvgGoalsWholeStore("comp_b"),
  );
  const telemLeakyBase = leakyBase.rollingTelem("H1", TARGET_DATE, "comp_a");
  const telemLeakyFuture = leakyFuture.rollingTelem("H1", TARGET_DATE, "comp_a");
  suite.check(
    "A7 telemetri whole-store BERUBAH oleh masa depan (fitur bocor terdeteksi)",
    JSON.stringify(telemLeakyFuture) !== JSON.stringify(telemLeakyBase),
    `${JSON.stringify(telemLeakyBase)} vs ${JSON.stringify(telemLeakyFuture)}`,
  );
  const fitLeaky = leakyBase.foldFit("comp_a", H_FOLD).fit!;
  const pLeakyBase = leakyBase.predictLevelB(fitLeaky, targetMatch());
  const pLeakyFuture = leakyFuture.predictLevelB(fitLeaky, targetMatch());
  suite.check(
    "A8 prediksi whole-store BERUBAH oleh masa depan (kebocoran menjalar ke probabilitas)",
    JSON.stringify(pLeakyFuture) !== JSON.stringify(pLeakyBase),
  );
}

// --- B. Determinisme -------------------------------------------------------------
{
  const e1 = makeEv([], [], "as-of");
  const e2 = makeEv([], [], "as-of");
  const run = (ev: ChronologicalEvaluator): string =>
    JSON.stringify(compA().map((m) => ev.predictMatchLevelB(m)));
  suite.eq("B1 dua instans dari masukan sama → keluaran identik", run(e2), run(e1));
  suite.eq("B2 panggilan ulang pada instans sama (cache fit) → identik", run(e1), run(e1));
}

// --- C. Batas ---------------------------------------------------------------------
{
  const ev = makeEv([], [], "as-of");
  // H1 mencetak 2 gol pada 2026-01-05 dan 1 gol pada 2026-01-26 (laga a3 tandang di H4? cek: a3 = H4 vs H1, H1 mencetak 3).
  // Pakai formGoals atas daftar laga comp_a H1: laga H1 strictly sebelum 2026-01-26: a0 (2 gol), a3 belum (tanggal sama 2026-01-26).
  const before = ev.formGoals("H1", "2026-01-26");
  suite.eq("C1 laga di tanggal cutoff TIDAK masuk jendela form (strictly-before)", before, { avg: 2, n: 1 });
  const after = ev.formGoals("H1", "2026-01-27");
  suite.eq("C2 laga kemarin masuk jendela form", after, { avg: 2.5, n: 2 });

  suite.eq("C3 compAvg kompetisi tak dikenal → null", ev.compAvgGoalsAt("comp_unknown", "2026-04-13"), null);
  suite.eq("C4 compAvg fallback LEGACY utuh", ev.compAvgGoalsAt("comp_3039", "2020-01-01"), 1.48);
  suite.eq("C5 telemetri tim tanpa log → kosong terlabel", ev.rollingTelem("NOPE", "2026-04-13", "comp_a"), {
    sampleSize: 0, xgSamples: 0, rollingXgFor: null, rollingXgAgainst: null, rollingGoalsFor: 0, rollingGoalsAgainst: 0,
  });
  suite.eq("C6 form tim tanpa riwayat → {avg:null,n:0}", ev.formGoals("NOPE", "2026-04-13"), { avg: null, n: 0 });

  const tiny = ev.predictMatchLevelB(compTiny()[5]);
  suite.check("C7 liga 3 tim → fit null → fallback uniform terlabel", tiny.fitFallback === true && JSON.stringify(tiny.p) === JSON.stringify([1 / 3, 1 / 3, 1 / 3]), JSON.stringify(tiny));

  const first = ev.predictMatchLevelB(compA()[0]);
  suite.check("C8 laga pertama liga (wilayah latih murni) → fold null + fallback terlabel", first.fold === null && first.fitFallback === true);

  // N1 vs N2 (indeks 19): kedua tim di luar fit lipatan H → jalur fixedLamMu.
  const newTeams = ev.predictMatchLevelB(compA()[19]);
  const sum = newTeams.p.reduce((s, v) => s + v, 0);
  suite.check(
    "C9 dua tim baru di luar fit → prediksi valid (bukan NaN, jumlah ≈ 1)",
    newTeams.fold === "H" && !newTeams.fitFallback && newTeams.p.every((v) => Number.isFinite(v) && v > 0) && Math.abs(sum - 1) < 1e-9,
    JSON.stringify(newTeams),
  );
}

// --- D. Isolasi mode ---------------------------------------------------------------
{
  // Tanpa log lintas kompetisi: log semua tim hanya di comp_a.
  const sameCompLogs = baseLogs().filter((l) => l.competition_id === "comp_a");
  const universe = buildUniverse([]);
  const evA = new ChronologicalEvaluator(universe, universe, sameCompLogs, { ...CHAMPION_CONFIG, compAvgMode: "as-of" });
  const evW = new ChronologicalEvaluator(universe, universe, sameCompLogs, { ...CHAMPION_CONFIG, compAvgMode: "whole-store" });
  const pa = JSON.stringify(compA().map((m) => evA.predictMatchLevelB(m)));
  const pw = JSON.stringify(compA().map((m) => evW.predictMatchLevelB(m)));
  suite.eq("D1 tanpa log lintas kompetisi kedua mode identik (selisih hanya lewat compAvg)", pw, pa);

  // Dengan log lintas kompetisi: minimal satu laga berbeda antar mode.
  const evA2 = makeEv([], [], "as-of");
  const evW2 = makeEv([], [], "whole-store");
  const diffs = compA().filter((m) => JSON.stringify(evA2.predictMatchLevelB(m).p) !== JSON.stringify(evW2.predictMatchLevelB(m).p)).length;
  suite.check("D2 dengan log lintas kompetisi mode berbeda pada ≥1 laga", diffs >= 1, `diffs=${diffs}`);
}

// --- E. Validitas probabilitas -------------------------------------------------------
{
  const ev = makeEv([], [], "as-of");
  let ok = true;
  let detail = "";
  for (const m of compA()) {
    const pr = ev.predictMatchLevelB(m);
    if (pr.fitFallback) continue;
    const sum = pr.p.reduce((s, v) => s + v, 0);
    if (!pr.p.every((v) => v > 0 && v < 1) || Math.abs(sum - 1) >= 1e-9 || !(pr.pOver25 > 0 && pr.pOver25 < 1) || !Number.isFinite(pr.lam) || !Number.isFinite(pr.mu)) {
      ok = false;
      detail = `${m.match_id}: ${JSON.stringify(pr)}`;
      break;
    }
  }
  suite.check("E1 semua probabilitas valid: (0,1), jumlah 1±1e-9, λ/μ hingga", ok, detail);
}

suite.finish();
