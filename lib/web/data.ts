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
  canonicalIdForTeamId,
  canonicalIdForTeamName,
  loadCanonicalTeams,
} from "../quant/team-identity";
import { MARKET_GRADE_THRESHOLDS } from "../picks/engine";
import {
  getSiblingIds,
  isFinishedStatus,
  linkSiblingsOf,
  loadFixtureLinkGroups,
  type FixtureLinkGroup,
} from "../identity/fixture-resolver";

type Db = DatabaseSync;
const g = globalThis as unknown as { __webDbs?: Map<string, Db> };
function db(file: string): Db {
  if (!g.__webDbs) g.__webDbs = new Map();
  let h = g.__webDbs.get(file);
  if (!h) {
    // Path dibuat statis per subfolder "data" agar tracing build tidak
    // menyapu seluruh proyek (peringatan NFT Turbopack).
    h = new DatabaseSync(path.join(process.cwd(), "data", file), { readOnly: true });
    g.__webDbs.set(file, h);
  }
  return h;
}
const packagesDb = () => db("analysis_snapshots.db");
const picksDb = () => db("picks.db");
const datasetDb = () => db("thestats_dataset.db");

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
  /** Koreksi lab terstruktur (kolom ledger, audit T3); null = tak ada koreksi. */
  effective_prob: number | null;
  effective_source: string | null;
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

/**
 * Normalisasi payload lintas generasi paket. Tabel packages menyimpan tiga
 * bentuk historis: (1) quant-package terkini dengan fixture bersarang;
 * (2) bentuk datar awal (fixture di level atas, hanya legs — tanpa
 * probabilitas/matriks); (3) paket manual e2e lama (bentuk bebas).
 * Semua konsumen web hanya melihat bentuk (1); bentuk lain dilengkapi
 * nilai kosong yang jujur, dan nama tim bentuk (3) dicari dari dataset.
 */
function normalizePayload(
  raw: Record<string, unknown>,
  rowMatchId: string,
  rowKickoff: string,
): QuantPayload {
  const base: QuantPayload = {
    fixture: {
      match_id: rowMatchId,
      competition_name: "",
      home: "?",
      away: "?",
      kickoff_utc: rowKickoff,
    },
    gate_status: (raw.gate_status as string) ?? "uncalibrated",
    population: (raw.population as string) ?? "unknown",
    lambda: (raw.lambda as number) ?? 0,
    mu: (raw.mu as number) ?? 0,
    rho: (raw.rho as number) ?? 0,
    probabilities: (raw.probabilities as Record<string, number>) ?? {},
    top_scores: (raw.top_scores as QuantPayload["top_scores"]) ?? [],
    score_matrix: (raw.score_matrix as number[][]) ?? [],
    market: (raw.market as QuantPayload["market"]) ?? null,
    sm_panel: (raw.sm_panel as QuantPayload["sm_panel"]) ?? null,
    legs: (raw.legs as Leg[]) ?? [],
    shrunk_metadata: raw.shrunk_metadata as QuantPayload["shrunk_metadata"],
  };
  if (raw.fixture) {
    return { ...base, ...(raw as unknown as QuantPayload) };
  }
  if (typeof raw.home === "string" && typeof raw.away === "string") {
    base.fixture = {
      match_id: (raw.match_id as string) ?? rowMatchId,
      competition_name: (raw.competition_name as string) ?? "",
      home: raw.home,
      away: raw.away,
      kickoff_utc: (raw.utc_date as string) ?? rowKickoff,
    };
    return base;
  }
  // Bentuk manual lama: nama tim dari selection.fixture bila ada…
  const sel = raw.selection as
    | { fixture?: { home_team_name?: string; away_team_name?: string; competition_name?: string; utc_date?: string } }
    | undefined;
  if (sel?.fixture?.home_team_name && sel?.fixture?.away_team_name) {
    base.fixture.home = sel.fixture.home_team_name;
    base.fixture.away = sel.fixture.away_team_name;
    base.fixture.competition_name = sel.fixture.competition_name ?? "";
    if (sel.fixture.utc_date) base.fixture.kickoff_utc = sel.fixture.utc_date;
    return base;
  }
  // …kalau tidak, dari baris dataset (id → nama kanonik).
  try {
    const m = datasetDb()
      .prepare(`SELECT home_team_id, away_team_id, competition_id FROM matches WHERE match_id = ?`)
      .get(rowMatchId) as
      | { home_team_id: string; away_team_id: string; competition_id: string }
      | undefined;
    if (m) {
      const nameOf = (tid: string) => {
        const cid = canonicalIdForTeamId(tid);
        return cid ? opponentName(cid) : tid;
      };
      base.fixture.home = nameOf(m.home_team_id);
      base.fixture.away = nameOf(m.away_team_id);
    }
  } catch {
    /* nama tetap "?" — halaman menampilkan apa adanya */
  }
  return base;
}

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
    payload: normalizePayload(
      JSON.parse(r.payload_json as string) as Record<string, unknown>,
      r.match_id as string,
      r.kickoff_utc as string,
    ),
  };
}

const LATEST_PER_MATCH = `
  SELECT p.* FROM packages p
  JOIN (SELECT match_id, MAX(id) AS mid FROM packages GROUP BY match_id) t
    ON t.mid = p.id
`;

/**
 * Seluruh id satu laga fisik dengan `matchId` — untuk hasil laga.
 *
 * K1: dua sumber tautan lewat resolver identitas yang sama dengan
 * produser: (1) registry katalog data/fixture-links.json dibaca dengan
 * parser tervalidasi bersama (bentuk sebenarnya `links[]`, bukan
 * `groups` yang dicari versi lama — itulah sebabnya hasil kembar dulu
 * tidak pernah terbaca web); (2) store identitas persisten di dataset
 * (fixture_aliases), yang menjangkau kembar yang tidak berbagi baris
 * katalog. DB pra-migrasi tanpa tabel identitas degrade ke (1) saja.
 */
let linkGroupsCache: FixtureLinkGroup[] | null = null;
function siblingsOf(matchId: string): string[] {
  if (!linkGroupsCache) {
    linkGroupsCache = loadFixtureLinkGroups(path.join(process.cwd(), "data"));
  }
  const ids = new Set<string>([matchId]);
  for (const id of linkSiblingsOf(linkGroupsCache, matchId)) ids.add(id);
  try {
    for (const id of getSiblingIds(datasetDb(), matchId)) ids.add(id);
  } catch {
    /* dataset belum tersedia / belum bermigrasi: tautan file tetap jalan */
  }
  return [...ids];
}

export function getResult(matchId: string): MatchResult | null {
  const d = datasetDb();
  for (const id of siblingsOf(matchId)) {
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
        // Kosakata status dinormalisasi: dataset memakai 'finished',
        // sumber lain 'FT' — keduanya final (dulu flag ini selalu false
        // untuk baris dataset karena perbandingannya literal 'FT').
        finished: isFinishedStatus(row.status),
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
/** GradeStat live yang dipotong menurut gate_status pick (segmentasi R-01). */
export interface GradeGateStat extends GradeStat {
  gate_status: string;
}
export interface MarketStat {
  market: string;
  n: number;
  claimed: number | null;
  hits: number;
  hit_rate: number | null;
}
export interface LedgerStats {
  lab_total: number;
  live_total: number;
  live_resolved: number;
  by_grade: GradeStat[];
  /** Segmen by_grade menurut gate_status (calibrated/partial/uncalibrated). */
  live_by_grade_gate: GradeGateStat[];
  by_market: { market: string; n: number; hits: number; hit_rate: number | null }[];
  lab_by_grade: GradeStat[];
  lab_by_market: MarketStat[];
  recent_resolved: (PickRow & { home: string; away: string })[];
}

/**
 * Cache fixture (nama home/away) per package_id untuk ledgerStats().recent:
 * 40 baris terakhir biasanya hanya milik belasan paket — tanpa cache, paket
 * yang sama di-query + di-parse payload-nya berulang per pick. Payload paket
 * immutable per id, jadi cache proses ini aman.
 */
const fixtureNameCache = new Map<number, { home: string; away: string } | null>();
function packageFixtureNames(
  packageId: number,
  matchId: string,
  kickoffUtc: string,
): { home: string; away: string } | null {
  const hit = fixtureNameCache.get(packageId);
  if (hit !== undefined) return hit;
  const prow = packagesDb()
    .prepare(`SELECT payload_json FROM packages WHERE id = ?`)
    .get(packageId) as { payload_json: string } | undefined;
  const fx = prow
    ? normalizePayload(
        JSON.parse(prow.payload_json) as Record<string, unknown>,
        matchId,
        kickoffUtc,
      ).fixture
    : null;
  const val = fx ? { home: fx.home, away: fx.away } : null;
  fixtureNameCache.set(packageId, val);
  return val;
}

export function ledgerStats(): LedgerStats {
  const d = picksDb();
  const one = (sql: string) => (d.prepare(sql).get() as { n: number }).n;
  const lab_total = one(`SELECT COUNT(*) n FROM picks WHERE source='lab'`);
  const live_total = one(`SELECT COUNT(*) n FROM picks WHERE source='live-run'`);
  const live_resolved = one(
    `SELECT COUNT(*) n FROM picks p JOIN pick_outcomes o ON o.pick_id=p.id WHERE p.source='live-run'`,
  );
  const toGradeStat = (r: Record<string, unknown>): GradeStat => {
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
    };
  };
  const by_grade = (d
    .prepare(
      `SELECT p.grade AS grade, COUNT(*) AS n,
              SUM(CASE WHEN o.pick_id IS NOT NULL THEN 1 ELSE 0 END) AS resolved,
              SUM(COALESCE(o.hit,0)) AS hits,
              AVG(CASE WHEN o.pick_id IS NOT NULL THEN p.model_prob END) AS claimed
       FROM picks p LEFT JOIN pick_outcomes o ON o.pick_id = p.id
       WHERE p.source='live-run' GROUP BY p.grade ORDER BY p.grade`,
    )
    .all() as Record<string, unknown>[]).map(toGradeStat);
  // Segmentasi gate (R-01): potongan yang sama persis dengan by_grade,
  // hanya dikelompokkan juga menurut gate_status yang tersimpan di baris
  // pick itu sendiri — bukan klasifikasi baru. Urutan gate tetap:
  // calibrated, partial, uncalibrated.
  const live_by_grade_gate = (d
    .prepare(
      `SELECT p.grade AS grade, p.gate_status AS gate_status, COUNT(*) AS n,
              SUM(CASE WHEN o.pick_id IS NOT NULL THEN 1 ELSE 0 END) AS resolved,
              SUM(COALESCE(o.hit,0)) AS hits,
              AVG(CASE WHEN o.pick_id IS NOT NULL THEN p.model_prob END) AS claimed
       FROM picks p LEFT JOIN pick_outcomes o ON o.pick_id = p.id
       WHERE p.source='live-run' GROUP BY p.grade, p.gate_status
       ORDER BY p.grade,
                CASE p.gate_status WHEN 'calibrated' THEN 0
                                   WHEN 'partial' THEN 1
                                   WHEN 'uncalibrated' THEN 2 ELSE 3 END`,
    )
    .all() as Record<string, unknown>[]).map((r) => ({
      ...toGradeStat(r),
      gate_status: (r.gate_status as string | null) ?? "unknown",
    }));
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
  // Populasi lab tidak menyimpan kolom grade (baris lab grade-nya NULL);
  // grade diturunkan ulang dari tabel ambang per-pasar milik engine
  // (MARKET_GRADE_THRESHOLDS — sumber kebenaran tunggal, sama dengan yang
  // memberi grade pick live). CASE SQL dibangun dari konstanta itu supaya
  // kalibrasi ulang ambang otomatis mengalir ke sini. Kandidat di bawah
  // lantai grade terendah memang tidak pernah diterbitkan sebagai pick,
  // jadi tidak masuk tabel per-grade.
  const gradeCase = Object.entries(MARKET_GRADE_THRESHOLDS)
    .map(([market, t]) => {
      const arms: string[] = [];
      if (t.A !== null) arms.push(`WHEN p.model_prob >= ${t.A} THEN 'A'`);
      if (t.B !== null) arms.push(`WHEN p.model_prob >= ${t.B} THEN 'B'`);
      if (t.C !== null) arms.push(`WHEN p.model_prob >= ${t.C} THEN 'C'`);
      return `WHEN p.market = '${market}' THEN CASE ${arms.join(" ")} END`;
    })
    .join(" ");
  const lab_by_grade = (d
    .prepare(
      `SELECT g AS grade, COUNT(*) AS n, AVG(model_prob) AS claimed, SUM(hit) AS hits
       FROM (
         SELECT p.model_prob AS model_prob, o.hit AS hit,
                CASE ${gradeCase} END AS g
         FROM picks p JOIN pick_outcomes o ON o.pick_id = p.id
         WHERE p.source='lab'
       )
       WHERE g IS NOT NULL GROUP BY g ORDER BY g`,
    )
    .all() as Record<string, unknown>[]).map((r) => {
      const n = r.n as number;
      const hits = r.hits as number;
      const claimed = (r.claimed as number | null) ?? null;
      const hit_rate = n > 0 ? hits / n : null;
      return {
        grade: r.grade as string,
        n,
        resolved: n,
        hits,
        hit_rate,
        claimed,
        gap_pp:
          hit_rate !== null && claimed !== null
            ? Math.round((hit_rate - claimed) * 1000) / 10
            : null,
      } satisfies GradeStat;
    });
  // Populasi sama persis dengan lab_by_grade: hanya kandidat ber-grade
  // (gradeCase yang sama, satu definisi). Tanpa filter ini, lab menyimpan
  // kandidat di KEDUA sisi tiap pasar (over+under, yes+no, ketiga hasil
  // 1X2) sehingga rata-rata mentahnya datar dan tidak bermakna.
  const lab_by_market = (d
    .prepare(
      `SELECT market, COUNT(*) AS n, AVG(model_prob) AS claimed, SUM(hit) AS hits
       FROM (
         SELECT p.market AS market, p.model_prob AS model_prob, o.hit AS hit,
                CASE ${gradeCase} END AS g
         FROM picks p JOIN pick_outcomes o ON o.pick_id = p.id
         WHERE p.source='lab'
       )
       WHERE g IS NOT NULL GROUP BY market ORDER BY n DESC`,
    )
    .all() as Record<string, unknown>[]).map((r) => {
      const n = r.n as number;
      const hits = r.hits as number;
      return {
        market: r.market as string,
        n,
        claimed: (r.claimed as number | null) ?? null,
        hits,
        hit_rate: n > 0 ? hits / n : null,
      } satisfies MarketStat;
    });
  const recent = (d
    .prepare(
      `SELECT p.*, o.hit, o.home_goals, o.away_goals FROM picks p
       JOIN pick_outcomes o ON o.pick_id = p.id
       WHERE p.source='live-run' ORDER BY p.kickoff_utc DESC LIMIT 40`,
    )
    .all() as Record<string, unknown>[])
    .map((r) => {
      const fx = r.package_id
        ? packageFixtureNames(
            r.package_id as number,
            r.match_id as string,
            r.kickoff_utc as string,
          )
        : null;
      return {
        ...(r as unknown as PickRow),
        home: fx?.home ?? "?",
        away: fx?.away ?? "?",
      };
    });
  return {
    lab_total,
    live_total,
    live_resolved,
    by_grade,
    live_by_grade_gate,
    by_market,
    lab_by_grade,
    lab_by_market,
    recent_resolved: recent,
  };
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

/** Tanda tangan file (mtime+ukuran) untuk kunci cache statistik landing. */
function fileSig(p: string): string {
  try {
    const s = fs.statSync(p);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return "absen";
  }
}

let landingCache: { sig: string; stats: LandingStats } | null = null;

/**
 * Statistik landing di-cache per tanda tangan file sumber (ratings + ketiga
 * DB beserta WAL-nya): tanpa cache, setiap request membayar parse JSON
 * ratings 545 KB + ±6 agregat picks. Bucket waktu 5 menit ikut di kunci
 * karena hitungan `upcoming` bergantung jendela jam dinding — angka bisa
 * basi paling lama 5 menit, imbalan yang wajar untuk halaman depan.
 */
export function landingStats(): LandingStats {
  const dataDir = path.join(process.cwd(), "data");
  const sig = [
    fileSig(path.join(dataDir, "calibrated_ratings.json")),
    fileSig(path.join(dataDir, "picks.db")),
    fileSig(path.join(dataDir, "picks.db-wal")),
    fileSig(path.join(dataDir, "analysis_snapshots.db")),
    fileSig(path.join(dataDir, "analysis_snapshots.db-wal")),
    fileSig(path.join(dataDir, "thestats_dataset.db")),
    fileSig(path.join(dataDir, "thestats_dataset.db-wal")),
    String(Math.floor(Date.now() / 300_000)),
  ].join("|");
  if (landingCache && landingCache.sig === sig) return landingCache.stats;

  const d = picksDb();
  const one = (sql: string) => (d.prepare(sql).get() as { n: number }).n;
  let leagues_fitted = 0;
  let leagues_calibrated = 0;
  try {
    const ratings = JSON.parse(
      fs.readFileSync(path.join(dataDir, "calibrated_ratings.json"), "utf8"),
    ) as { leagues: Record<string, unknown> };
    leagues_fitted = Object.keys(ratings.leagues).length;
  } catch { /* angka tampil — bila file tidak ada */ }
  try {
    leagues_calibrated = (datasetDb()
      .prepare(`SELECT COUNT(*) n FROM league_calibration WHERE status = 'calibrated'`)
      .get() as { n: number }).n;
  } catch { /* tabel registry opsional */ }
  // Jumlah laga mendatang via COUNT — semantik sama dengan
  // listUpcoming(72).length (paket terbaru per laga, jendela sama) tapi
  // tanpa mengambil & mem-parse satu pun payload paket.
  const now = Date.now();
  const upcoming = (packagesDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM packages p
       JOIN (SELECT match_id, MAX(id) AS mid FROM packages GROUP BY match_id) t
         ON t.mid = p.id
       WHERE p.kickoff_utc >= ? AND p.kickoff_utc <= ?`,
    )
    .get(
      new Date(now - 3 * 3_600_000).toISOString(),
      new Date(now + 72 * 3_600_000).toISOString(),
    ) as { n: number }).n;
  const stats: LandingStats = {
    lab_picks: one(`SELECT COUNT(*) n FROM picks WHERE source='lab'`),
    lab_resolved: one(
      `SELECT COUNT(*) n FROM picks p JOIN pick_outcomes o ON o.pick_id=p.id WHERE p.source='lab'`,
    ),
    live_picks: one(`SELECT COUNT(*) n FROM picks WHERE source='live-run'`),
    leagues_fitted,
    leagues_calibrated,
    packages: (packagesDb().prepare(`SELECT COUNT(*) n FROM packages`).get() as { n: number }).n,
    upcoming,
  };
  landingCache = { sig, stats };
  return stats;
}

/** Pick ledger milik satu paket beserta hasil resolusinya (untuk daftar selesai). */
export function getPackagePicks(packageId: number): PickRow[] {
  return picksDb()
    .prepare(
      `SELECT pk.*, po.hit, po.home_goals, po.away_goals
       FROM picks pk LEFT JOIN pick_outcomes po ON po.pick_id = pk.id
       WHERE pk.package_id = ? ORDER BY pk.grade ASC, pk.model_prob DESC`,
    )
    .all(packageId) as unknown as PickRow[];
}

/** Matriks skor paket untuk halaman analisis + pembangun parlay (client-safe data). */
export function getPackageMatrix(packageId: number): number[][] | null {
  const row = packagesDb()
    .prepare(`SELECT payload_json FROM packages WHERE id = ?`)
    .get(packageId) as { payload_json: string } | undefined;
  if (!row) return null;
  return (JSON.parse(row.payload_json) as QuantPayload).score_matrix ?? null;
}
