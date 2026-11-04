/**
 * VALIDATE TELEMETRY EQUIVALENCE — validasi fix divergensi telemetri saji
 * (commit 4674ba9 + 63da14c) terhadap standar harness.
 *
 * Standar harness (scripts/parlay-lab.ts::rollingTelem,
 * scripts/backtest-walkforward.ts): team_match_logs HANYA source=
 * 'sportmonks', 6 laga terakhir strictly sebelum cutoff, bobot xG per log
 * round3(targetAvg/logAvg) dengan rata-rata kompetisi TERUKUR dari matches
 * selesai, penyebut = COUNT sampel non-null per sisi, gol tanpa bobot.
 *
 * Dua level pemeriksaan per fixture (cutoff = tanggal fixture, 10 char):
 *  (a) Rolling: getTeamRollingTelemetry(servingTeamId, 6, cutoff, divCode)
 *      vs cerminan in-script rollingTelem harness atas team_match_logs
 *      dengan team_id yang SAMA dan target = competition_id fixture.
 *      servingTeamId direplikasi dari getTheStatsTeamId loader (fungsi itu
 *      TIDAK diekspor loader — logikanya dicerminkan persis di sini:
 *      kandidat nama ternormalisasi → log terbanyak di kompetisi divisi
 *      target, lalu terbanyak overall, lalu id pertama). divCode dari
 *      resolusi loader (resolveMatchLeague atas competition_id fixture).
 *      Ekspektasi: SAMA PERSIS (keduanya round2).
 *  (b) Parameter (bentuk planner): getShrunkMatchParameters dipanggil
 *      seperti planner (nama tim, leagueHint = nama kompetisi,
 *      telemetry = getTeamRollingTelemetry(nama, 6, cutoff) TANPA target —
 *      diteruskan hanya bila sample_size > 0, persis planner 🔒;
 *      matchDateCutoff = cutoff; argumen form intel tidak tersedia di
 *      jalur offline ini dan memang tidak masuk blend bila telemetri
 *      xG/gol tersedia) vs blend harness: fit produksi dari
 *      data/calibrated_ratings.json untuk liga yang melayani (div dari
 *      metadata hasil loader itu sendiri) + rollingTelem cerminan +
 *      blendInput/lamMuFromBlend parlay-lab pada κ×2 (κ efektif
 *      16/28/32 — sama dengan konstanta loader pasca-validasi).
 *      Ekspektasi: sama dalam 0.001–0.002 (pembulatan).
 *
 * Sampel: ≈30 fixture domestik sm:% (populasi yang dievaluasi harness;
 * kembaran mt_* TheStats adalah fixture fisik yang sama di bawah id lain
 * dengan competition_id comp_* — target pembobotannya bukan target divisi
 * saji sm:*, jadi tidak dihitung ganda di sini) pada jendela 72 jam ke
 * depan, gerbang calibrated/partial, kompetisi non-piala (cup_model
 * null), tersebar antar-liga (round-robin per kompetisi). Fixture
 * Leeds United / Espanyol / Coventry City / Eintracht Frankfurt
 * diprioritaskan bila ada di jendela; bila sebuah tim target tidak ada,
 * tim itu diperiksa di level tim saja (cutoff = hari ini) dan dicatat.
 *
 * Setiap mismatch diklasifikasi: identity conflation / team-resolution
 * difference / dedupe / same-date tie / form-fallback / genuine drift.
 * Output: tasks/telemetry-equivalence.json. Offline penuh, tanpa tulis DB.
 */
import fs from "node:fs";
import path from "node:path";
import { getTheStatsDb } from "../lib/db/thestats-dataset";
import { getUpcomingDb } from "../lib/db/upcoming-fixtures";
import {
  getTeamRollingTelemetry,
  resolveTeamId,
  competitionIdForDiv,
} from "../lib/db/team-telemetry";
import {
  loadCalibratedRatings,
  resolveMatchLeague,
  findTeamRating,
  getShrunkMatchParameters,
  type CalibratedRatingsFile,
} from "../lib/quant/ratings-loader";
import { normalizeTeamName } from "../lib/quant/team-normalizer";
import { getLeagueGate, competitionIdToDiv } from "../lib/quant/league-gate";
import {
  getCanonicalBySourceId,
  getCanonicalCupModel,
} from "../lib/quant/league-identity";

const TOL_B = 0.002;
const round2 = (v: number) => Number(v.toFixed(2));
const round3 = (v: number) => Number(v.toFixed(3));

// ===========================================================================
// CERMINAN getTheStatsTeamId (lib/quant/ratings-loader.ts — tidak diekspor)
// ===========================================================================
let teamIdsByName: Map<string, string[]> | null = null;
function getTheStatsTeamIds(teamName: string): string[] {
  if (!teamIdsByName) {
    teamIdsByName = new Map();
    const db = getTheStatsDb();
    const rows = db.prepare("SELECT team_id, name FROM teams").all() as unknown as {
      team_id: string;
      name: string;
    }[];
    for (const r of rows) {
      const key = normalizeTeamName(r.name).toLowerCase();
      const arr = teamIdsByName.get(key) ?? [];
      if (!arr.includes(r.team_id)) arr.push(r.team_id);
      teamIdsByName.set(key, arr);
    }
  }
  return teamIdsByName.get(normalizeTeamName(teamName).toLowerCase()) ?? [];
}
const teamIdPickCache = new Map<string, string | null>();
function getTheStatsTeamId(teamName: string, div?: string): string | null {
  const ids = getTheStatsTeamIds(teamName);
  if (ids.length === 0) return null;
  if (ids.length === 1) return ids[0];
  const cacheKey = `${normalizeTeamName(teamName).toLowerCase()}|${div ?? ""}`;
  if (teamIdPickCache.has(cacheKey)) return teamIdPickCache.get(cacheKey) ?? null;
  let picked: string | null = null;
  try {
    const db = getTheStatsDb();
    const compId = div ? competitionIdForDiv(div) : null;
    const placeholders = ids.map(() => "?").join(",");
    const pick = (restrictComp: boolean): string | null => {
      const sql = restrictComp
        ? `SELECT l.team_id AS tid, COUNT(*) AS c FROM team_match_logs l
           JOIN matches m ON l.match_id = m.match_id
           WHERE l.team_id IN (${placeholders}) AND m.competition_id = ?
           GROUP BY l.team_id ORDER BY c DESC LIMIT 1`
        : `SELECT team_id AS tid, COUNT(*) AS c FROM team_match_logs
           WHERE team_id IN (${placeholders})
           GROUP BY team_id ORDER BY c DESC LIMIT 1`;
      const row = (restrictComp
        ? db.prepare(sql).get(...ids, compId)
        : db.prepare(sql).get(...ids)) as { tid: string } | undefined;
      return row?.tid ?? null;
    };
    picked = (compId ? pick(true) : null) ?? pick(false) ?? ids[0];
  } catch {
    picked = ids[0];
  }
  teamIdPickCache.set(cacheKey, picked);
  return picked;
}

// ===========================================================================
// CERMINAN harness (parlay-lab): pemuatan data + rollingTelem + formGoals +
// blendInput/lamMuFromBlend. Query identik; handle DB memakai koneksi
// bersama getTheStatsDb (isi sama, menghindari dua koneksi ke satu file).
// ===========================================================================
interface MatchRow {
  match_id: string;
  competition_id: string;
  utc_date: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
}
interface LogRow {
  team_id: string;
  match_id: string;
  opponent_id: string;
  match_date: string;
  goals_for: number;
  goals_against: number;
  xg_for: number | null;
  xg_against: number | null;
  competition_id: string | null;
}
const ds = getTheStatsDb();
const allMatches = ds
  .prepare(
    `SELECT match_id, competition_id, utc_date, home_team_id, away_team_id, home_score, away_score
     FROM matches
     WHERE competition_id LIKE 'sm:%' AND status = 'finished'
       AND home_score IS NOT NULL AND away_score IS NOT NULL
     ORDER BY competition_id, utc_date`,
  )
  .all() as unknown as MatchRow[];
const compOfMatch = new Map<string, string>();
for (const r of ds.prepare("SELECT match_id, competition_id FROM matches").all() as unknown as {
  match_id: string;
  competition_id: string;
}[]) compOfMatch.set(r.match_id, r.competition_id);

const logsByTeam = new Map<string, LogRow[]>();
for (const r of ds
  .prepare(
    `SELECT team_id, match_id, opponent_id, match_date, goals_for, goals_against, xg_for, xg_against
     FROM team_match_logs WHERE source = 'sportmonks' ORDER BY team_id, match_date`,
  )
  .all() as unknown as LogRow[]) {
  const arr = logsByTeam.get(r.team_id) ?? [];
  arr.push({ ...r, competition_id: compOfMatch.get(r.match_id) ?? null });
  logsByTeam.set(r.team_id, arr);
}
// Semua log SM per tim (untuk diagnostik dedupe) — urutan saji DESC.
function smLogsDesc(teamId: string, cutoff: string): LogRow[] {
  const arr = (logsByTeam.get(teamId) ?? []).filter((l) => l.match_date < cutoff);
  return [...arr].reverse();
}
const matchesByTeam = new Map<string, MatchRow[]>();
for (const m of allMatches) {
  for (const t of [m.home_team_id, m.away_team_id]) {
    const arr = matchesByTeam.get(t) ?? [];
    arr.push(m);
    matchesByTeam.set(t, arr);
  }
}
for (const arr of matchesByTeam.values()) arr.sort((x, y) => x.utc_date.localeCompare(y.utc_date));

const LEGACY_COMP_AVG: Record<string, number> = {
  comp_3039: 1.48, comp_8814: 1.54, comp_5840: 1.43, comp_4643: 1.91,
  comp_0256: 1.45, comp_3809: 1.87, comp_3498: 2.04,
};
const measuredCompAvg = new Map<string, number>();
for (const r of ds
  .prepare(
    `SELECT competition_id, AVG((home_score + away_score) / 2.0) AS a FROM matches
     WHERE status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL
     GROUP BY competition_id`,
  )
  .all() as unknown as { competition_id: string; a: number }[]) {
  if (Number.isFinite(r.a) && r.a > 0) measuredCompAvg.set(r.competition_id, r.a);
}
function compAvgGoals(compId: string | null): number | null {
  if (!compId) return null;
  return measuredCompAvg.get(compId) ?? LEGACY_COMP_AVG[compId] ?? null;
}
function upperBoundDate(dates: string[], cutoff: string): number {
  let lo = 0, hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] < cutoff) lo = mid + 1; else hi = mid;
  }
  return lo;
}
const logDatesByTeam = new Map<string, string[]>();
for (const [t, arr] of logsByTeam) logDatesByTeam.set(t, arr.map((l) => l.match_date));
const matchDatesByTeam = new Map<string, string[]>();
for (const [t, arr] of matchesByTeam) matchDatesByTeam.set(t, arr.map((m) => m.utc_date.slice(0, 10)));

interface RollingTelem {
  sampleSize: number; xgSamples: number;
  rollingXgFor: number | null; rollingXgAgainst: number | null;
  rollingGoalsFor: number; rollingGoalsAgainst: number;
  window: LogRow[];
}
function rollingTelem(teamId: string, cutoff: string, targetCompId: string): RollingTelem {
  const empty: RollingTelem = { sampleSize: 0, xgSamples: 0, rollingXgFor: null, rollingXgAgainst: null, rollingGoalsFor: 0, rollingGoalsAgainst: 0, window: [] };
  const logs = logsByTeam.get(teamId);
  const dates = logDatesByTeam.get(teamId);
  if (!logs || !dates) return empty;
  const end = upperBoundDate(dates, cutoff);
  const win = logs.slice(Math.max(0, end - 6), end);
  if (!win.length) return empty;
  const targetAvg = compAvgGoals(targetCompId) ?? 1.48;
  let gf = 0, ga = 0, sxf = 0, cxf = 0, sxa = 0, cxa = 0;
  for (const log of win) {
    gf += log.goals_for; ga += log.goals_against;
    let wgt = 1.0;
    if (log.competition_id && log.competition_id !== targetCompId) {
      const logAvg = compAvgGoals(log.competition_id);
      if (logAvg && logAvg > 0) wgt = round3(targetAvg / logAvg);
    }
    if (log.xg_for !== null && log.xg_for !== undefined) { sxf += log.xg_for * wgt; cxf++; }
    if (log.xg_against !== null && log.xg_against !== undefined) { sxa += log.xg_against * wgt; cxa++; }
  }
  return {
    sampleSize: win.length, xgSamples: cxf,
    rollingXgFor: cxf > 0 ? round2(sxf / cxf) : null,
    rollingXgAgainst: cxa > 0 ? round2(sxa / cxa) : null,
    rollingGoalsFor: round2(gf / win.length),
    rollingGoalsAgainst: round2(ga / win.length),
    window: win,
  };
}
function formGoals(teamId: string, cutoff: string): { avg: number | null; n: number } {
  const ms = matchesByTeam.get(teamId);
  const dates = matchDatesByTeam.get(teamId);
  if (!ms || !dates) return { avg: null, n: 0 };
  const end = upperBoundDate(dates, cutoff);
  const win = ms.slice(Math.max(0, end - 6), end);
  if (!win.length) return { avg: null, n: 0 };
  let g = 0;
  for (const m of win) g += m.home_team_id === teamId ? m.home_score : m.away_score;
  return { avg: g / win.length, n: win.length };
}

// Blend harness atas fit produksi: prior per tim dari file ratings (jalur
// loader findTeamRating), avg/ha dari entri liga file yang sama.
interface HarnessBlend {
  attH: number; defH: number; attA: number; defA: number;
  ha: number; avg: number; wH: number; wA: number; lam: number; mu: number;
  priorSourceH: string | null; priorSourceA: string | null;
  telemH: RollingTelem; telemA: RollingTelem;
}
function harnessBlend(
  ratings: CalibratedRatingsFile, div: string,
  homeName: string, awayName: string,
  homeId: string, awayId: string,
  cutoff: string, targetCompId: string,
): HarnessBlend | null {
  const league = ratings.leagues[div];
  if (!league) return null;
  const avg = league.leagueAvgGoals;
  const ha = league.homeAdvantage;
  const priorH = findTeamRating(ratings, div, normalizeTeamName(homeName));
  const priorA = findTeamRating(ratings, div, normalizeTeamName(awayName));
  const formH = formGoals(homeId, cutoff);
  const formA = formGoals(awayId, cutoff);
  const telemH = rollingTelem(homeId, cutoff, targetCompId);
  const telemA = rollingTelem(awayId, cutoff, targetCompId);
  if (!priorH && !priorA) {
    // Jalur fixedLamMu blendInput (kedua tim absen dari fit).
    const attH = formH.avg || 1.35;
    const attA = formA.avg || 1.15;
    const defH = Math.max(0.6, 2.5 - (formA.avg || 1.2));
    const defA = Math.max(0.7, 2.6 - (formH.avg || 1.35));
    return {
      attH, defH, attA, defA, ha, avg, wH: 0, wA: 0,
      lam: avg * attH * defA * ha, mu: avg * attA * defH,
      priorSourceH: null, priorSourceA: null, telemH, telemA,
    };
  }
  let liveAttH = (formH.avg && formH.avg > 0 ? formH.avg : 1.35) / avg;
  let liveAttA = (formA.avg && formA.avg > 0 ? formA.avg : 1.15) / avg;
  let liveDefH = Math.max(0.6, 2.0 - liveAttA);
  let liveDefA = Math.max(0.7, 2.0 - liveAttH);
  let nH = formH.n > 0 ? formH.n : 5;
  let nA = formA.n > 0 ? formA.n : 5;
  let kapH = 16, kapA = 16;
  if (telemH.xgSamples >= 3 && telemH.rollingXgFor !== null) {
    liveAttH = telemH.rollingXgFor / avg;
    if (telemH.rollingXgAgainst !== null) liveDefH = telemH.rollingXgAgainst / avg;
    nH = telemH.xgSamples; kapH = 8;
  } else if (telemH.sampleSize >= 1) {
    liveAttH = telemH.rollingGoalsFor / avg;
    liveDefH = telemH.rollingGoalsAgainst / avg;
    nH = telemH.sampleSize; kapH = 14;
  }
  if (telemA.xgSamples >= 3 && telemA.rollingXgFor !== null) {
    liveAttA = telemA.rollingXgFor / avg;
    if (telemA.rollingXgAgainst !== null) liveDefA = telemA.rollingXgAgainst / avg;
    nA = telemA.xgSamples; kapA = 8;
  } else if (telemA.sampleSize >= 1) {
    liveAttA = telemA.rollingGoalsFor / avg;
    liveDefA = telemA.rollingGoalsAgainst / avg;
    nA = telemA.sampleSize; kapA = 14;
  }
  const KAPPA_SCALE = 2;
  const wH = nH / (nH + kapH * KAPPA_SCALE);
  const wA = nA / (nA + kapA * KAPPA_SCALE);
  const pAttH = priorH?.rating.attack ?? 1, pDefH = priorH?.rating.defense ?? 1;
  const pAttA = priorA?.rating.attack ?? 1, pDefA = priorA?.rating.defense ?? 1;
  const attH = Math.max(0.5, round3(wH * liveAttH + (1 - wH) * pAttH));
  const defH = Math.max(0.5, round3(wH * liveDefH + (1 - wH) * pDefH));
  const attA = Math.max(0.4, round3(wA * liveAttA + (1 - wA) * pAttA));
  const defA = Math.max(0.5, round3(wA * liveDefA + (1 - wA) * pDefA));
  return {
    attH, defH, attA, defA, ha, avg, wH, wA,
    lam: avg * attH * defA * ha, mu: avg * attA * defH,
    priorSourceH: priorH?.source ?? null, priorSourceA: priorA?.source ?? null,
    telemH, telemA,
  };
}

// ===========================================================================
// Diagnostik klasifikasi
// ===========================================================================
function dedupeDuplicates(teamId: string, cutoff: string): string[] {
  // Tiruan kunci dedupe saji atas fetch headroom (18 baris SM terbaru).
  const rows = smLogsDesc(teamId, cutoff).slice(0, 18);
  const seen = new Map<string, number>();
  const dups: string[] = [];
  for (const r of rows) {
    const key = `${r.match_date.slice(0, 10)}|${r.opponent_id}|${r.goals_for}|${r.goals_against}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [k, c] of seen) if (c > 1) dups.push(`${k} ×${c}`);
  return dups;
}
function foreignDomesticComps(win: LogRow[], fixtureCountry: string | null): string[] {
  const out = new Set<string>();
  for (const l of win) {
    if (!l.competition_id) continue;
    const can = getCanonicalBySourceId(l.competition_id);
    if (!can) continue;
    if (getCanonicalCupModel(can.canonical_id)) continue; // piala/kontinental bukan conflation
    if (fixtureCountry && can.country && can.country.toLowerCase() !== fixtureCountry.toLowerCase()) {
      out.add(`${l.competition_id} (${can.name}, ${can.country})`);
    }
  }
  return [...out];
}

// ===========================================================================
// Pemilihan sampel
// ===========================================================================
interface FixtureRow {
  match_id: string; competition_id: string; competition_name: string;
  competition_country: string | null; utc_date: string;
  home_team_name: string; away_team_name: string;
}
const TARGET_TEAMS = ["Leeds United", "Espanyol", "Coventry City", "Eintracht Frankfurt"];
const SAMPLE_N = 30;

function selectSample(ratings: CalibratedRatingsFile): { fixtures: FixtureRow[]; notes: string[] } {
  const notes: string[] = [];
  const now = new Date();
  const end = new Date(now.getTime() + 72 * 3600_000);
  const upDb = getUpcomingDb();
  const rows = upDb
    .prepare(
      `SELECT match_id, competition_id, competition_name, competition_country, utc_date, home_team_name, away_team_name
       FROM upcoming_fixtures
       WHERE utc_date >= ? AND utc_date < ? AND status = 'scheduled' AND competition_id LIKE 'sm:%'
       ORDER BY utc_date ASC`,
    )
    .all(now.toISOString(), end.toISOString()) as unknown as FixtureRow[];
  const eligible: (FixtureRow & { gate: string })[] = [];
  for (const fx of rows) {
    const can = getCanonicalBySourceId(fx.competition_id);
    if (can && getCanonicalCupModel(can.canonical_id)) continue; // piala ≠ domestik
    const div = competitionIdToDiv(fx.competition_id);
    const gate = div ? getLeagueGate(div) : null;
    if (!gate || (gate.status !== "calibrated" && gate.status !== "partial")) continue;
    eligible.push({ ...fx, gate: gate.status });
  }
  notes.push(`jendela ${now.toISOString()} → ${end.toISOString()}: ${rows.length} fixture sm terjadwal, ${eligible.length} lolos saringan domestik + gerbang calibrated/partial`);
  const picked: (FixtureRow & { gate: string })[] = [];
  const used = new Set<string>();
  const push = (fx: (FixtureRow & { gate: string }) | undefined) => {
    if (fx && !used.has(fx.match_id)) { used.add(fx.match_id); picked.push(fx); }
  };
  // Prioritas: fixture yang memuat tim target.
  for (const team of TARGET_TEAMS) {
    push(eligible.find((f) => f.home_team_name === team || f.away_team_name === team));
  }
  // Round-robin antar kompetisi agar tersebar antar liga.
  const byComp = new Map<string, (FixtureRow & { gate: string })[]>();
  for (const fx of eligible) {
    const arr = byComp.get(fx.competition_id) ?? [];
    arr.push(fx); byComp.set(fx.competition_id, arr);
  }
  const comps = [...byComp.keys()].sort();
  let round = 0;
  while (picked.length < SAMPLE_N) {
    let added = false;
    for (const c of comps) {
      const fx = byComp.get(c)![round];
      if (fx && !used.has(fx.match_id)) { push(fx); added = true; if (picked.length >= SAMPLE_N) break; }
    }
    round++;
    if (!added && round > 20) break;
  }
  void ratings;
  return { fixtures: picked, notes };
}

// ===========================================================================
// MAIN
// ===========================================================================
function main(): void {
  const t0 = performance.now();
  const ratings = loadCalibratedRatings();
  if (!ratings) throw new Error("calibrated_ratings.json tidak terbaca");
  const { fixtures, notes } = selectSample(ratings);
  const today = new Date().toISOString().slice(0, 10);

  const results: Record<string, unknown>[] = [];
  let aTeams = 0, aPass = 0, bFixtures = 0, bPass = 0;
  let maxDiffA = 0, maxDiffB = 0;
  const classifications = new Map<string, number>();
  const classify = (c: string) => classifications.set(c, (classifications.get(c) ?? 0) + 1);

  const checkTeamLevelOnly: Record<string, unknown>[] = [];
  const teamsInSample = new Set<string>();
  for (const fx of fixtures) { teamsInSample.add(fx.home_team_name); teamsInSample.add(fx.away_team_name); }
  for (const team of TARGET_TEAMS) {
    if (teamsInSample.has(team)) continue;
    // Fallback level-tim (cutoff = hari ini): (a) saja, tanpa fixture.
    const sid = getTheStatsTeamId(team, undefined);
    const entry: Record<string, unknown> = { team, cutoff: today, serving_team_id: sid, note: "tim target tidak ada di jendela sampel — pemeriksaan level tim" };
    if (sid) {
      // target kompetisi: kompetisi domestik tim dari log terakhirnya.
      const last = smLogsDesc(sid, today)[0];
      const target = last?.competition_id ?? "sm:8";
      const serv = getTeamRollingTelemetry(sid, 6, today, competitionIdForDiv(target) ?? undefined);
      const harn = rollingTelem(sid, today, target);
      entry.target_competition_id = target;
      entry.serving = { rolling_xg_for: serv.rolling_xg_for, rolling_xg_against: serv.rolling_xg_against, rolling_goals_for: serv.rolling_goals_for, rolling_goals_against: serv.rolling_goals_against, sample_size: serv.sample_size, observed_xg_samples: serv.observed_xg_samples };
      entry.harness = { rolling_xg_for: harn.rollingXgFor, rolling_xg_against: harn.rollingXgAgainst, rolling_goals_for: harn.rollingGoalsFor, rolling_goals_against: harn.rollingGoalsAgainst, sample_size: harn.sampleSize, observed_xg_samples: harn.xgSamples };
      entry.pass = JSON.stringify(entry.serving) === JSON.stringify(entry.harness);
    }
    checkTeamLevelOnly.push(entry);
  }

  for (const fx of fixtures) {
    const cutoff = fx.utc_date.slice(0, 10);
    const resolution = resolveMatchLeague(ratings, fx.competition_id, fx.home_team_name, fx.away_team_name, cutoff);
    const divCode = resolution.div;
    const gate = divCode ? getLeagueGate(divCode) : null;
    const rec: Record<string, unknown> = {
      match_id: fx.match_id, competition_id: fx.competition_id,
      competition_name: fx.competition_name, competition_country: fx.competition_country,
      utc_date: fx.utc_date, cutoff, home: fx.home_team_name, away: fx.away_team_name,
      resolved_div: divCode, gate_status: gate?.status ?? null,
      league_resolution_via: resolution.via,
    };
    if (!divCode) {
      rec.error = "divCode tidak ter-resolve loader";
      rec.classification = ["team-resolution difference (div tidak ter-resolve)"];
      classify("team-resolution difference");
      results.push(rec);
      continue;
    }
    // ---- (a) rolling per tim
    const aChecks: Record<string, unknown>[] = [];
    let fixtureA = true;
    for (const side of ["home", "away"] as const) {
      const name = side === "home" ? fx.home_team_name : fx.away_team_name;
      const sid = getTheStatsTeamId(name, divCode);
      aTeams++;
      if (!sid) {
        fixtureA = false;
        // Diagnostik: kandidat nama yang sama setelah tanda baca dibuang
        // (mis. fixture "St. Johnstone" vs tabel teams "St Johnstone").
        const strip = (s: string) => normalizeTeamName(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
        const near = (ds.prepare("SELECT team_id, name FROM teams").all() as unknown as { team_id: string; name: string }[])
          .filter((r) => strip(r.name) === strip(name))
          .map((r) => `${r.team_id} ("${r.name}")`);
        aChecks.push({ side, team: name, serving_team_id: null, pass: false, classification: "team-resolution difference (nama tidak ter-resolve ke team_id)", near_match_candidates_in_teams_table: near });
        classify("team-resolution difference");
        continue;
      }
      const serv = getTeamRollingTelemetry(sid, 6, cutoff, divCode);
      const harn = rollingTelem(sid, cutoff, fx.competition_id);
      const fields = {
        rolling_xg_for: [serv.rolling_xg_for, harn.rollingXgFor],
        rolling_xg_against: [serv.rolling_xg_against, harn.rollingXgAgainst],
        rolling_goals_for: [serv.rolling_goals_for, harn.rollingGoalsFor],
        rolling_goals_against: [serv.rolling_goals_against, harn.rollingGoalsAgainst],
        sample_size: [serv.sample_size, harn.sampleSize],
        observed_xg_samples: [serv.observed_xg_samples, harn.xgSamples],
      } as Record<string, [unknown, unknown]>;
      const diffs: Record<string, number> = {};
      let pass = true;
      for (const [k, [s, h]] of Object.entries(fields)) {
        if (typeof s === "number" && typeof h === "number") {
          diffs[k] = Math.abs(s - h);
          maxDiffA = Math.max(maxDiffA, diffs[k]);
          if (diffs[k] !== 0) pass = false;
        } else if (s !== h) pass = false;
      }
      let classification: string | null = null;
      if (!pass) {
        const dups = dedupeDuplicates(sid, cutoff);
        const foreign = foreignDomesticComps(harn.window, fx.competition_country);
        const winDates = harn.window.map((l) => l.match_date.slice(0, 10));
        const sameDateTie = new Set(winDates).size < winDates.length;
        if (dups.length > 0 && serv.sample_size !== harn.sampleSize) classification = "dedupe (saji membuang kembaran fixture; harness tidak)";
        else if (foreign.length > 0) classification = "identity conflation (team_id dipakai liga domestik negara lain)";
        else if (sameDateTie) classification = "same-date tie / identity conflation (beberapa laga se-tim pada tanggal sama di jendela)";
        else classification = "genuine definition drift";
        classify(classification.split(" (")[0]);
      } else aPass++;
      if (!pass) fixtureA = false;
      aChecks.push({
        side, team: name, serving_team_id: sid, pass, classification,
        serving: { rolling_xg_for: serv.rolling_xg_for, rolling_xg_against: serv.rolling_xg_against, rolling_goals_for: serv.rolling_goals_for, rolling_goals_against: serv.rolling_goals_against, sample_size: serv.sample_size, observed_xg_samples: serv.observed_xg_samples, xg_weighted_toward: serv.xg_weighted_toward ?? null, window: serv.recent_logs.map((l) => `${l.match_date}:${l.match_id}`) },
        harness: { rolling_xg_for: harn.rollingXgFor, rolling_xg_against: harn.rollingXgAgainst, rolling_goals_for: harn.rollingGoalsFor, rolling_goals_against: harn.rollingGoalsAgainst, sample_size: harn.sampleSize, observed_xg_samples: harn.xgSamples, window: harn.window.map((l) => `${l.match_date}:${l.match_id}:${l.competition_id}`) },
        diffs,
        foreign_domestic_competitions_in_window: foreignDomesticComps(harn.window, fx.competition_country),
      });
    }
    rec.rolling_checks = aChecks;
    rec.rolling_pass = fixtureA;

    // ---- (b) parameter bentuk planner
    bFixtures++;
    const homeTelemPlanner = getTeamRollingTelemetry(fx.home_team_name, 6, cutoff);
    const awayTelemPlanner = getTeamRollingTelemetry(fx.away_team_name, 6, cutoff);
    const serving = getShrunkMatchParameters({
      homeTeam: fx.home_team_name,
      awayTeam: fx.away_team_name,
      leagueHint: fx.competition_name,
      homeTelemetry: homeTelemPlanner.sample_size > 0 ? homeTelemPlanner : undefined,
      awayTelemetry: awayTelemPlanner.sample_size > 0 ? awayTelemPlanner : undefined,
      matchDateCutoff: cutoff,
    });
    const servingDiv = serving.metadata?.div ?? divCode;
    const homeId = getTheStatsTeamId(fx.home_team_name, servingDiv);
    const awayId = getTheStatsTeamId(fx.away_team_name, servingDiv);
    const hb = homeId && awayId ? harnessBlend(ratings, servingDiv, fx.home_team_name, fx.away_team_name, homeId, awayId, cutoff, fx.competition_id) : null;
    if (!hb) {
      rec.parameter_check = { pass: false, classification: "team-resolution difference (fit produksi / team_id tidak tersedia untuk div saji)", serving_div: servingDiv };
      classify("team-resolution difference");
      rec.parameter_pass = false;
      results.push(rec);
      continue;
    }
    const servingLam = serving.leagueAvgGoals * serving.homeAttack * serving.awayDefense * serving.homeAdvantage;
    const servingMu = serving.leagueAvgGoals * serving.awayAttack * serving.homeDefense;
    const cmp = {
      homeAttack: [serving.homeAttack, hb.attH],
      homeDefense: [serving.homeDefense, hb.defH],
      awayAttack: [serving.awayAttack, hb.attA],
      awayDefense: [serving.awayDefense, hb.defA],
      homeAdvantage: [serving.homeAdvantage, hb.ha],
      leagueAvgGoals: [serving.leagueAvgGoals, hb.avg],
      shrinkage_weight_home: [serving.shrinkageWeights.home, round3(hb.wH)],
      shrinkage_weight_away: [serving.shrinkageWeights.away, round3(hb.wA)],
      lambda_implied: [Number(servingLam.toFixed(4)), Number(hb.lam.toFixed(4))],
      mu_implied: [Number(servingMu.toFixed(4)), Number(hb.mu.toFixed(4))],
    } as Record<string, [number, number]>;
    const diffs: Record<string, number> = {};
    let passB = true;
    for (const [k, [s, h]] of Object.entries(cmp)) {
      diffs[k] = Math.abs(s - h);
      if (k !== "lambda_implied" && k !== "mu_implied") maxDiffB = Math.max(maxDiffB, diffs[k]);
      const tol = k === "lambda_implied" || k === "mu_implied" ? 0.01 : TOL_B;
      if (diffs[k] > tol) passB = false;
    }
    let classificationB: string | null = null;
    if (!passB) {
      const nameIdH = resolveTeamId(fx.home_team_name);
      const nameIdA = resolveTeamId(fx.away_team_name);
      const foreign = [
        ...foreignDomesticComps(hb.telemH.window, fx.competition_country),
        ...foreignDomesticComps(hb.telemA.window, fx.competition_country),
      ];
      if (nameIdH !== homeId || nameIdA !== awayId) classificationB = "team-resolution difference (resolveTeamId nama ≠ getTheStatsTeamId divisi)";
      else if (hb.priorSourceH !== "primary_league" || hb.priorSourceA !== "primary_league") classificationB = "team-resolution difference (prior bukan primary_league: promosi/lintas-liga/tidak ditemukan)";
      else if (foreign.length > 0) classificationB = "identity conflation (jendela telemetri memuat liga domestik negara lain)";
      else if (homeTelemPlanner.sample_size === 0 || awayTelemPlanner.sample_size === 0) classificationB = "form-fallback definition drift (telemetri kosong: harness formGoals vs default loader)";
      else classificationB = "genuine definition drift";
      classify(classificationB.split(" (")[0]);
    } else bPass++;
    rec.parameter_check = {
      pass: passB, classification: classificationB, serving_div: servingDiv,
      serving: { homeAttack: serving.homeAttack, homeDefense: serving.homeDefense, awayAttack: serving.awayAttack, awayDefense: serving.awayDefense, homeAdvantage: serving.homeAdvantage, leagueAvgGoals: serving.leagueAvgGoals, shrinkageWeights: serving.shrinkageWeights, telemetry_source: serving.metadata?.telemetrySource ?? null, home_source: serving.metadata?.homeSource ?? null, away_source: serving.metadata?.awaySource ?? null },
      harness: { homeAttack: hb.attH, homeDefense: hb.defH, awayAttack: hb.attA, awayDefense: hb.defA, homeAdvantage: hb.ha, leagueAvgGoals: hb.avg, shrinkageWeights: { home: round3(hb.wH), away: round3(hb.wA) }, prior_source_home: hb.priorSourceH, prior_source_away: hb.priorSourceA },
      diffs,
    };
    rec.parameter_pass = passB;
    results.push(rec);
  }

  const out = {
    generated_at: new Date().toISOString(),
    runtime_seconds: Number(((performance.now() - t0) / 1000).toFixed(1)),
    window_hours: 72,
    selection_notes: notes,
    target_teams: TARGET_TEAMS,
    team_level_only_checks: checkTeamLevelOnly,
    summary: {
      fixtures_sampled: fixtures.length,
      rolling_team_checks: aTeams,
      rolling_team_pass: aPass,
      rolling_fixtures_pass: results.filter((r) => r.rolling_pass).length,
      parameter_fixtures_checked: bFixtures,
      parameter_fixtures_pass: bPass,
      max_abs_diff_rolling: maxDiffA,
      max_abs_diff_parameter: maxDiffB,
      tolerance_parameter: TOL_B,
      mismatch_classifications: Object.fromEntries(classifications),
    },
    fixtures: results,
  };
  fs.writeFileSync(path.join(process.cwd(), "tasks", "telemetry-equivalence.json"), JSON.stringify(out, null, 2));
  console.log(`[equivalence] sampel ${fixtures.length} fixture; rolling tim ${aPass}/${aTeams} pass; parameter ${bPass}/${bFixtures} pass; maxDiff rolling=${maxDiffA} parameter=${maxDiffB}`);
  console.log(`[equivalence] klasifikasi mismatch: ${JSON.stringify(Object.fromEntries(classifications))}`);
  for (const r of results) {
    const rr = r as Record<string, unknown>;
    console.log(`  ${rr.home} vs ${rr.away} (${rr.competition_id}, ${rr.resolved_div}, ${rr.gate_status}) rolling=${rr.rolling_pass} param=${rr.parameter_pass}`);
  }
  console.log(`[equivalence] tertulis tasks/telemetry-equivalence.json (${out.runtime_seconds}s)`);
}

main();
