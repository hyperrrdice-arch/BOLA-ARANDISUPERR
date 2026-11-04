/**
 * DATA WEB — lapis baca-saja untuk frontend.
 *
 * Semua angka yang tampil di web berasal dari artefak pipeline yang sudah
 * tersimpan (paket analisis, ledger pick, dataset hasil, telemetri kanonik).
 * File ini TIDAK menghitung model baru dan TIDAK menulis apa pun:
 * koneksi dibuka readOnly, query hanya SELECT.
 *
 * Dipakai hanya dari Server Component / route handler.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  canonicalIdForTeamName,
  loadCanonicalTeams,
} from "../quant/team-identity";

const ROOT = process.cwd();

type Db = DatabaseSync;
const g = globalThis as unknown as { __webDbs?: Map<string, Db> };
function db(rel: string): Db {
  if (!g.__webDbs) g.__webDbs = new Map();
  let h = g.__webDbs.get(rel);
  if (!h) {
    h = new DatabaseSync(path.join(ROOT, rel), { readOnly: true });
    g.__webDbs.set(rel, h);
  }
  return h;
}
const packagesDb = () => db("data/analysis_snapshots.db");
const picksDb = () => db("data/picks.db");
const datasetDb = () => db("data/thestats_dataset.db");

/* ------------------------------------------------------------------ types */

export interface PayloadFixture {
  match_id: string;
  competition_name: string;
  home: string;
  away: string;
  kickoff_utc: string;
}
export interface QuantPayload {
  fixture: PayloadFixture;
  gate_status: string;
  population: string;
  lambda: number;
  mu: number;
  rho: number;
  probabilities: Record<string, number>;
  top_scores: { home_goals: number; away_goals: number; prob: number }[];
  score_matrix: number[][];
  market?: { probs: Record<string, number>; captured_utc: string; bookmakers: string[] } | null;
  sm_panel?: { probs: Record<string, number>; batch_utc: string } | null;
  legs?: Leg[];
  shrunk_metadata?: {
    calibrationGate?: string;
    luckMetrics?: unknown;
    leagueResolution?: { note?: string; fitSystem?: string };
    [k: string]: unknown;
  };
}
export interface Leg {
  market: string;
  selection: string;
  model_prob: number;
  effective_prob: number;
  effective_source: string;
  band: string | null;
  band_n: number | null;
  grade: string;
  market_prob: number | null;
  sm_prob: number | null;
  agreement_spread: number | null;
}
export interface PackageRow {
  id: number;
  match_id: string;
  competition_canonical_id: string;
  kickoff_utc: string;
  computed_utc: string;
  fit_source: string;
  gate_status: string;
  cup_delta: number | null;
  odds_captured_utc: string | null;
  payload: QuantPayload;
}
export interface PickRow {
  id: number;
  match_id: string;
  kickoff_utc: string;
  market: string;
  selection: string;
  model_prob: number;
  market_prob: number | null;
  sm_prob: number | null;
  agreement_spread: number | null;
  gate_status: string;
  grade: string;
  source: string;
  package_id: number | null;
  hit: number | null;
  home_goals: number | null;
  away_goals: number | null;
}
export interface MatchResult {
  home_goals: number;
  away_goals: number;
  finished: boolean;
}
export interface FormEntry {
  date: string;
  opponent: string;
  venue: string;
  goals_for: number;
  goals_against: number;
  result: "W" | "D" | "L";
  xg_for: number | null;
  xg_against: number | null;
}

/* ---------------------------------------------------------------- helpers */

function parsePackage(r: Record<string, unknown>): PackageRow {
  return {
    id: r.id as number,
    match_id: r.match_id as string,
    competition_canonical_id: r.competition_canonical_id as string,
    kickoff_utc: r.kickoff_utc as string,
    computed_utc: r.computed_utc as string,
    fit_source: r.fit_source as string,
    gate_status: r.gate_status as string,
    cup_delta: (r.cup_delta as number | null) ?? null,
    odds_captured_utc: (r.odds_captured_utc as string | null) ?? null,
    payload: JSON.parse(r.payload_json as string) as QuantPayload,
  };
}

const LATEST_PER_MATCH = `
  SELECT p.* FROM packages p
  JOIN (SELECT match_id, MAX(id) AS mid FROM packages GROUP BY match_id) t
    ON t.mid = p.id
`;

/** Kembar katalog (mt_ ↔ sm_) dari data/fixture-links.json — untuk hasil laga. */
let twinMap: Map<string, string[]> | null = null;
function twinsOf(matchId: string): string[] {
  if (!twinMap) {
    twinMap = new Map();
    try {
      const links = JSON.parse(
        fs.readFileSync(path.join(ROOT, "data/fixture-links.json"), "utf8"),
      ) as { groups?: { match_ids: string[] }[] };
      for (const grp of links.groups ?? []) {
        for (const id of grp.match_ids) twinMap.set(id, grp.match_ids);
      }
    } catch {
      /* tanpa tautan: hanya id sendiri */
    }
  }
  return twinMap.get(matchId) ?? [matchId];
}

export function getResult(matchId: string): MatchResult | null {
  const d = datasetDb();
  for (const id of twinsOf(matchId)) {
    const row = d
      .prepare(
        `SELECT home_score, away_score, status FROM matches WHERE match_id = ?`,
      )
      .get(id) as
      | { home_score: number | null; away_score: number | null; status: string }
      | undefined;
    if (row && row.home_score !== null && row.away_score !== null) {
      return {
        home_goals: row.home_score,
        away_goals: row.away_score,
        finished: row.status === "FT",
      };
    }
  }
  return null;
}

let teamNameByCanonical: Map<string, string> | null = null;
function opponentName(canonicalId: string): string {
  if (!teamNameByCanonical) {
    teamNameByCanonical = new Map(loadCanonicalTeams().map((t) => [t.canonical_id, t.name]));
  }
  return teamNameByCanonical.get(canonicalId) ?? canonicalId;
}

/** Form 6 laga terakhir dari telemetri KANONIK (satu baris per laga fisik). */
export function getForm(teamName: string, beforeUtc: string, limit = 6): FormEntry[] {
  const cid = canonicalIdForTeamName(teamName);
  if (!cid) return [];
  const rows = datasetDb()
    .prepare(
      `SELECT match_date, canonical_opponent_id, venue, goals_for, goals_against,
              xg_for, xg_against
       FROM team_match_logs_canonical
       WHERE canonical_team_id = ? AND substr(match_date, 1, 10) < ?
       ORDER BY match_date DESC LIMIT ?`,
    )
    .all(cid, beforeUtc.slice(0, 10), limit) as Record<string, unknown>[];
  return rows.map((r) => {
    const gf = r.goals_for as number;
    const ga = r.goals_against as number;
    return {
      date: r.match_date as string,
      opponent: opponentName(r.canonical_opponent_id as string),
      venue: r.venue as string,
      goals_for: gf,
      goals_against: ga,
      result: gf > ga ? "W" : gf < ga ? "L" : "D",
      xg_for: (r.xg_for as number | null) ?? null,
      xg_against: (r.xg_against as number | null) ?? null,
    } satisfies FormEntry;
  });
}

/* ------------------------------------------------------------- public API */

export interface FixtureListItem {
  pkg: PackageRow;
  pickCounts: { A: number; B: number; C: number };
  topLeg: Leg | null;
  result: MatchResult | null;
}

function enrich(pkg: PackageRow): FixtureListItem {
  const counts = { A: 0, B: 0, C: 0 };
  for (const leg of pkg.payload.legs ?? []) {
    if (leg.grade === "A") counts.A += 1;
    else if (leg.grade === "B") counts.B += 1;
    else if (leg.grade === "C") counts.C += 1;
  }
  const legs = [...(pkg.payload.legs ?? [])].sort((a, b) => {
    const rank = (gr: string) => (gr === "A" ? 0 : gr === "B" ? 1 : 2);
    return rank(a.grade) - rank(b.grade) || b.effective_prob - a.effective_prob;
  });
  return { pkg, pickCounts: counts, topLeg: legs[0] ?? null, result: getResult(pkg.match_id) };
}

/** Pertandingan mendatang (jendela jam) dari paket versi terbaru per laga. */
export function listUpcoming(hours = 72): FixtureListItem[] {
  const now = Date.now();
  const rows = packagesDb()
    .prepare(`${LATEST_PER_MATCH} WHERE p.kickoff_utc >= ? AND p.kickoff_utc <= ? ORDER BY p.kickoff_utc ASC`)
    .all(
      new Date(now - 3 * 3_600_000).toISOString(),
      new Date(now + hours * 3_600_000).toISOString(),
    ) as Record<string, unknown>[];
  return rows.map((r) => enrich(parsePackage(r)));
}

/** Pertandingan yang baru selesai (untuk panel paket vs kenyataan). */
export function listFinished(hoursBack = 72, limit = 60): FixtureListItem[] {
  const now = Date.now();
  const rows = packagesDb()
    .prepare(`${LATEST_PER_MATCH} WHERE p.kickoff_utc < ? AND p.kickoff_utc >= ? ORDER BY p.kickoff_utc DESC LIMIT ?`)
    .all(
      new Date(now - 3 * 3_600_000).toISOString(),
      new Date(now - hoursBack * 3_600_000).toISOString(),
      limit,
    ) as Record<string, unknown>[];
  return rows.map((r) => enrich(parsePackage(r))).filter((f) => f.result?.finished);
}

export interface MatchDetail {
  pkg: PackageRow;
  picks: PickRow[];
  result: MatchResult | null;
  formHome: FormEntry[];
  formAway: FormEntry[];
}

export function getMatchDetail(matchId: string): MatchDetail | null {
  const row = packagesDb()
    .prepare(`SELECT * FROM packages WHERE match_id = ? ORDER BY id DESC LIMIT 1`)
    .get(matchId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const pkg = parsePackage(row);
  const picks = picksDb()
    .prepare(
      `SELECT pk.*, po.hit, po.home_goals, po.away_goals
       FROM picks pk LEFT JOIN pick_outcomes po ON po.pick_id = pk.id
       WHERE pk.package_id = ? ORDER BY pk.grade ASC, pk.model_prob DESC`,
    )
    .all(pkg.id) as unknown as PickRow[];
  const f = pkg.payload.fixture;
  return {
    pkg,
    picks,
    result: getResult(matchId),
    formHome: getForm(f.home, f.kickoff_utc),
    formAway: getForm(f.away, f.kickoff_utc),
  };
}

export interface SafePick extends PickRow {
  home: string;
  away: string;
  competition_name: string;
  sources_agree: number;
}

/** Pilihan live-run yang belum kickoff, grade A/B/C, dari ledger. */
export function listSafePicks(limit = 400): SafePick[] {
  const rows = picksDb()
    .prepare(
      `SELECT * FROM picks WHERE source = 'live-run' AND kickoff_utc >= ?
       ORDER BY kickoff_utc ASC, grade ASC, model_prob DESC LIMIT ?`,
    )
    .all(new Date(Date.now() - 3 * 3_600_000).toISOString(), limit) as Record<string, unknown>[];
  const out: SafePick[] = [];
  const pkgCache = new Map<number, PackageRow | null>();
  for (const r of rows) {
    const pid = (r.package_id as number | null) ?? null;
    let pkg = pid !== null ? pkgCache.get(pid) : null;
    if (pid !== null && pkg === undefined) {
      const prow = packagesDb()
        .prepare(`SELECT * FROM packages WHERE id = ?`)
        .get(pid) as Record<string, unknown> | undefined;
      pkg = prow ? parsePackage(prow) : null;
      pkgCache.set(pid, pkg);
    }
    const p = r as unknown as PickRow;
    const sources = [p.model_prob, p.market_prob, p.sm_prob].filter(
      (v) => v !== null && v !== undefined,
    ).length;
    out.push({
      ...p,
      home: pkg?.payload.fixture.home ?? "?",
      away: pkg?.payload.fixture.away ?? "?",
      competition_name: pkg?.payload.fixture.competition_name ?? "",
      sources_agree: sources,
    });
  }
  return out;
}

export interface GradeStat {
  grade: string;
  n: number;
  resolved: number;
  hits: number;
  hit_rate: number | null;
  claimed: number | null;
  gap_pp: number | null;
}
export interface LedgerStats {
  lab_total: number;
  live_total: number;
  live_resolved: number;
  by_grade: GradeStat[];
  by_market: { market: string; n: number; hits: number; hit_rate: number | null }[];
  recent_resolved: (PickRow & { home: string; away: string })[];
}

export function ledgerStats(): LedgerStats {
  const d = picksDb();
  const one = (sql: string) => (d.prepare(sql).get() as { n: number }).n;
  const lab_total = one(`SELECT COUNT(*) n FROM picks WHERE source='lab'`);
  const live_total = one(`SELECT COUNT(*) n FROM picks WHERE source='live-run'`);
  const live_resolved = one(
    `SELECT COUNT(*) n FROM picks p JOIN pick_outcomes o ON o.pick_id=p.id WHERE p.source='live-run'`,
  );
  const by_grade = (d
    .prepare(
      `SELECT p.grade AS grade, COUNT(*) AS n,
              SUM(CASE WHEN o.pick_id IS NOT NULL THEN 1 ELSE 0 END) AS resolved,
              SUM(COALESCE(o.hit,0)) AS hits,
              AVG(CASE WHEN o.pick_id IS NOT NULL THEN p.model_prob END) AS claimed
       FROM picks p LEFT JOIN pick_outcomes o ON o.pick_id = p.id
       WHERE p.source='live-run' GROUP BY p.grade ORDER BY p.grade`,
    )
    .all() as Record<string, unknown>[]).map((r) => {
      const resolved = r.resolved as number;
      const hits = r.hits as number;
      const claimed = (r.claimed as number | null) ?? null;
      const hit_rate = resolved > 0 ? hits / resolved : null;
      return {
        grade: r.grade as string,
        n: r.n as number,
        resolved,
        hits,
        hit_rate,
        claimed,
        gap_pp:
          hit_rate !== null && claimed !== null
            ? Math.round((hit_rate - claimed) * 1000) / 10
            : null,
      } satisfies GradeStat;
    });
  const by_market = (d
    .prepare(
      `SELECT p.market AS market, COUNT(*) AS n, SUM(o.hit) AS hits
       FROM picks p JOIN pick_outcomes o ON o.pick_id = p.id
       WHERE p.source='live-run' GROUP BY p.market ORDER BY n DESC`,
    )
    .all() as Record<string, unknown>[]).map((r) => ({
      market: r.market as string,
      n: r.n as number,
      hits: r.hits as number,
      hit_rate: (r.n as number) > 0 ? (r.hits as number) / (r.n as number) : null,
    }));
  const recent = (d
    .prepare(
      `SELECT p.*, o.hit, o.home_goals, o.away_goals FROM picks p
       JOIN pick_outcomes o ON o.pick_id = p.id
       WHERE p.source='live-run' ORDER BY p.kickoff_utc DESC LIMIT 40`,
    )
    .all() as Record<string, unknown>[])
    .map((r) => {
      const prow = r.package_id
        ? (packagesDb().prepare(`SELECT payload_json FROM packages WHERE id = ?`).get(r.package_id as number) as { payload_json: string } | undefined)
        : undefined;
      const fx = prow ? (JSON.parse(prow.payload_json) as QuantPayload).fixture : null;
      return {
        ...(r as unknown as PickRow),
        home: fx?.home ?? "?",
        away: fx?.away ?? "?",
      };
    });
  return { lab_total, live_total, live_resolved, by_grade, by_market, recent_resolved: recent };
}

export interface LandingStats {
  lab_picks: number;
  lab_resolved: number;
  live_picks: number;
  leagues_fitted: number;
  leagues_calibrated: number;
  packages: number;
  upcoming: number;
}

export function landingStats(): LandingStats {
  const d = picksDb();
  const one = (sql: string) => (d.prepare(sql).get() as { n: number }).n;
  let leagues_fitted = 0;
  let leagues_calibrated = 0;
  try {
    const ratings = JSON.parse(
      fs.readFileSync(path.join(ROOT, "data/calibrated_ratings.json"), "utf8"),
    ) as { leagues: Record<string, unknown> };
    leagues_fitted = Object.keys(ratings.leagues).length;
  } catch { /* angka tampil — bila file tidak ada */ }
  try {
    leagues_calibrated = (datasetDb()
      .prepare(`SELECT COUNT(*) n FROM league_calibration WHERE status = 'calibrated'`)
      .get() as { n: number }).n;
  } catch { /* tabel registry opsional */ }
  return {
    lab_picks: one(`SELECT COUNT(*) n FROM picks WHERE source='lab'`),
    lab_resolved: one(
      `SELECT COUNT(*) n FROM picks p JOIN pick_outcomes o ON o.pick_id=p.id WHERE p.source='lab'`,
    ),
    live_picks: one(`SELECT COUNT(*) n FROM picks WHERE source='live-run'`),
    leagues_fitted,
    leagues_calibrated,
    packages: (packagesDb().prepare(`SELECT COUNT(*) n FROM packages`).get() as { n: number }).n,
    upcoming: listUpcoming(72).length,
  };
}

/** Matriks skor paket untuk halaman analisis + pembangun parlay (client-safe data). */
export function getPackageMatrix(packageId: number): number[][] | null {
  const row = packagesDb()
    .prepare(`SELECT payload_json FROM packages WHERE id = ?`)
    .get(packageId) as { payload_json: string } | undefined;
  if (!row) return null;
  return (JSON.parse(row.payload_json) as QuantPayload).score_matrix ?? null;
}
