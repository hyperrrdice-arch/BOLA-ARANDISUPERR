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
  getUidForMatchId,
  identityTablesExist,
  isFinishedStatus,
  linkSiblingsOf,
  loadFixtureLinkGroups,
  type FixtureLinkGroup,
} from "../identity/fixture-resolver";
import {
  displayStatus,
  skorTerlihat,
  type FixtureStatus,
} from "./status";

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
/** Katalog jadwal hidup di file terpisah dan boleh absen (degrade kosong). */
function upcomingDb(): Db | null {
  if (!fs.existsSync(path.join(process.cwd(), "data", "upcoming_fixtures.db"))) return null;
  try {
    return db("upcoming_fixtures.db");
  } catch {
    return null;
  }
}

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
  market?: { probs: Record<string, number>; captured_utc: string | null; bookmakers: string[] } | null;
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
  /* Bukti terbit beku (K2, kolom aditif — absen/null pada baris warisan
     yang belum dimigrasi; basis 'unknown_legacy' sesudah migrasi). */
  published_prob: number | null;
  probability_basis: string | null;
  published_at_utc: string | null;
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
 * Normalisasi field market satu paket (butir review 1). Tiga bentuk
 * terbukti ada di tabel packages produksi: (1) lengkap — probs terisi,
 * captured_utc string, bookmakers array; (2) warisan hadir-tapi-kosong —
 * probs {}, captured_utc null, bookmakers null (3.650 paket; bentuk ini
 * yang melempar TypeError di halaman detail karena komponen membaca
 * bookmakers.length dari null); (3) market null / field absen.
 *
 * Aturan adapter: harga pasar dianggap TERSEDIA hanya bila ada peluang
 * yang benar-benar tertangkap (probs tak kosong) — bentuk (2) menjadi
 * null, sehingga bagian pasar tampil "belum tersedia" dan tidak
 * menghitung sumber hantu. Bila harga memang ada, field pendamping yang
 * hilang terdegradasi sendiri-sendiri: bookmakers null/absen → []
 * (daftar nama hanyalah label), captured_utc non-string → null (waktu
 * tangkap memang tidak tercatat). Konsumen tidak pernah melihat bentuk
 * mentah — normalisasi hidup di sini, bukan penjaga tersebar di komponen.
 */
function normalizeMarket(raw: unknown): QuantPayload["market"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const m = raw as { probs?: unknown; captured_utc?: unknown; bookmakers?: unknown };
  const probs =
    m.probs && typeof m.probs === "object" && !Array.isArray(m.probs)
      ? (m.probs as Record<string, number>)
      : {};
  if (Object.keys(probs).length === 0) return null;
  return {
    probs,
    captured_utc:
      typeof m.captured_utc === "string" && m.captured_utc ? m.captured_utc : null,
    bookmakers: Array.isArray(m.bookmakers)
      ? m.bookmakers.filter((b): b is string => typeof b === "string")
      : [],
  };
}

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
    market: normalizeMarket(raw.market),
    sm_panel: (raw.sm_panel as QuantPayload["sm_panel"]) ?? null,
    legs: (raw.legs as Leg[]) ?? [],
    shrunk_metadata: raw.shrunk_metadata as QuantPayload["shrunk_metadata"],
  };
  if (raw.fixture) {
    const merged = { ...base, ...(raw as unknown as QuantPayload) };
    // Spread membawa market mentah apa adanya — normalisasi ulang di
    // adapter (satu-satunya pintu) sebelum payload dilihat konsumen.
    merged.market = normalizeMarket(raw.market);
    return merged;
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
  /** Identitas kanonik lintas provider (K1); null bila store identitas tak mengenal laga ini. */
  fixtureUid: string | null;
  /** Keadaan tampil laga (status + skor yang lolos gerbang visibilitas). */
  keadaan: KeadaanLaga | null;
  /** Pilihan RESMI terbit untuk laga ini (K2) — satu-satunya yang boleh ditautkan sebagai pilihan. */
  officialPicks: OfficialPick[];
  /** Tiket RESMI (K3) yang memuat pilihan resmi laga ini. */
  officialTickets: TiketResmiRef[];
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
  const fixtureUid = fixtureUidOf(matchId);
  const officialPicks = getOfficialPicks(matchId, fixtureUid);
  return {
    pkg,
    picks,
    result: getResult(matchId),
    formHome: getForm(f.home, f.kickoff_utc),
    formAway: getForm(f.away, f.kickoff_utc),
    fixtureUid,
    keadaan: getMatchState(matchId),
    officialPicks,
    officialTickets: getOfficialTickets(officialPicks.map((p) => p.pick_uid)),
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

/* ============================ K6 · keadaan, jadwal, tautan resmi ====== */

/** UID kanonik laga dari store identitas K1; null bila tak dikenal/degrade. */
function fixtureUidOf(matchId: string): string | null {
  try {
    const d = datasetDb();
    if (!identityTablesExist(d)) return null;
    return getUidForMatchId(d, matchId);
  } catch {
    return null;
  }
}

export interface KeadaanLaga {
  status: FixtureStatus;
  /** Skor yang LOLOS gerbang visibilitas status (cancelled selalu null). */
  home_goals: number | null;
  away_goals: number | null;
}

/**
 * Keadaan tampil satu laga dari baris dataset + katalog (via sibling K1).
 * Dataset adalah otoritas skor/status final; katalog memberi status
 * penundaan/pembatalan untuk laga yang belum punya baris hasil. Skor
 * digerbang `skorTerlihat`: batal → tidak pernah tampil, dihentikan →
 * parsial, selesai → penuh.
 */
export function getMatchState(matchId: string): KeadaanLaga | null {
  const ids = siblingsOf(matchId);
  let datasetRow: { statusRaw: string | null; home: number | null; away: number | null } | null =
    null;
  try {
    const d = datasetDb();
    for (const id of ids) {
      const r = d
        .prepare(`SELECT status, home_score, away_score FROM matches WHERE match_id = ?`)
        .get(id) as
        | { status: string; home_score: number | null; away_score: number | null }
        | undefined;
      if (!r) continue;
      const cand = { statusRaw: r.status, home: r.home_score, away: r.away_score };
      if (!datasetRow) datasetRow = cand;
      const st = displayStatus(r.status);
      if (st === "finished" || st === "abandoned") {
        datasetRow = cand;
        break;
      }
    }
  } catch {
    /* dataset tak tersedia */
  }
  let catalogStatus: string | null = null;
  let catalogAda = false;
  const up = upcomingDb();
  if (up) {
    try {
      for (const id of ids) {
        const r = up
          .prepare(`SELECT status FROM upcoming_fixtures WHERE match_id = ?`)
          .get(id) as { status: string | null } | undefined;
        if (r) {
          catalogAda = true;
          catalogStatus = r.status;
          break;
        }
      }
    } catch {
      /* tabel katalog tak ada */
    }
  }
  if (!datasetRow && !catalogAda) return null;
  let status = displayStatus(datasetRow?.statusRaw ?? catalogStatus);
  if (datasetRow && catalogAda) {
    const cs = displayStatus(catalogStatus);
    // Baris dataset "terjadwal" polos kalah oleh status katalog yang lebih
    // informatif (ditunda/dibatalkan/berlangsung); final dataset selalu menang.
    if (
      status === "scheduled" &&
      (cs === "postponed" || cs === "cancelled" || cs === "live" || cs === "abandoned")
    ) {
      status = cs;
    }
  }
  const vis = skorTerlihat(status);
  return {
    status,
    home_goals: vis === "tidak" ? null : (datasetRow?.home ?? null),
    away_goals: vis === "tidak" ? null : (datasetRow?.away ?? null),
  };
}

function kolomAda(d: Db, table: string, kolom: string): boolean {
  try {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return cols.some((c) => c.name === kolom);
  } catch {
    return false;
  }
}

export interface OfficialPick extends PickRow {
  pick_uid: string;
  /** Waktu hitung paket penerbit — pembanding "analisis terbaru" di detail. */
  package_computed_utc: string | null;
}

/**
 * Pilihan RESMI laga ini: hanya baris ledger yang diterbitkan jalur
 * publikasi K2 (pick_uid terisi). Baris lab/warisan tanpa pick_uid tidak
 * pernah ditautkan sebagai pilihan (U03). DB pra-K2 tanpa kolom pick_uid
 * degrade ke daftar kosong.
 */
export function getOfficialPicks(matchId: string, fixtureUid: string | null): OfficialPick[] {
  const d = picksDb();
  if (!kolomAda(d, "picks", "pick_uid")) return [];
  const ids = siblingsOf(matchId);
  const marks = ids.map(() => "?").join(",");
  const rows = d
    .prepare(
      `SELECT pk.*, po.hit, po.home_goals, po.away_goals
       FROM picks pk LEFT JOIN pick_outcomes po ON po.pick_id = pk.id
       WHERE pk.pick_uid IS NOT NULL
         AND (pk.match_id IN (${marks})${fixtureUid ? " OR pk.fixture_uid = ?" : ""})
       ORDER BY pk.grade ASC, pk.published_prob DESC`,
    )
    .all(...(fixtureUid ? [...ids, fixtureUid] : ids)) as unknown as (PickRow & {
    pick_uid: string;
  })[];
  const computedCache = new Map<number, string | null>();
  return rows.map((r) => {
    let computed: string | null = null;
    if (r.package_id !== null && r.package_id !== undefined) {
      const cached = computedCache.get(r.package_id);
      if (cached !== undefined) {
        computed = cached;
      } else {
        try {
          const prow = packagesDb()
            .prepare(`SELECT computed_utc FROM packages WHERE id = ?`)
            .get(r.package_id) as { computed_utc: string } | undefined;
          computed = prow?.computed_utc ?? null;
        } catch {
          computed = null;
        }
        computedCache.set(r.package_id, computed);
      }
    }
    return { ...r, package_computed_utc: computed };
  });
}

export interface TiketResmiRef {
  slip_uid: string;
  state: string;
  combined_prob: number | null;
  combined_low: number | null;
  combined_high: number | null;
  combined_basis: string | null;
  combined_reason: string | null;
  published_utc: string;
  pick_uids: string[];
}

/**
 * Tiket RESMI (K3) yang memuat salah satu pick_uid resmi yang diberikan.
 * Slip draf browser tidak hidup di tabel ini, jadi tidak akan pernah
 * tertaut dari sini.
 */
export function getOfficialTickets(pickUids: string[]): TiketResmiRef[] {
  if (pickUids.length === 0) return [];
  const d = picksDb();
  try {
    const ada = d
      .prepare(
        `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'
         AND name IN ('published_slips', 'slip_legs')`,
      )
      .get() as { n: number };
    if (ada.n < 2) return [];
  } catch {
    return [];
  }
  const marks = pickUids.map(() => "?").join(",");
  const rows = d
    .prepare(
      `SELECT s.slip_uid, s.state, s.combined_prob, s.combined_low, s.combined_high,
              s.combined_basis, s.combined_reason, s.published_utc,
              GROUP_CONCAT(l.pick_uid) AS uids
       FROM published_slips s JOIN slip_legs l ON l.slip_uid = s.slip_uid
       WHERE l.pick_uid IN (${marks})
       GROUP BY s.slip_uid ORDER BY s.published_utc DESC`,
    )
    .all(...pickUids) as Record<string, unknown>[];
  return rows.map((r) => ({
    slip_uid: r.slip_uid as string,
    state: r.state as string,
    combined_prob: (r.combined_prob as number | null) ?? null,
    combined_low: (r.combined_low as number | null) ?? null,
    combined_high: (r.combined_high as number | null) ?? null,
    combined_basis: (r.combined_basis as string | null) ?? null,
    combined_reason: (r.combined_reason as string | null) ?? null,
    published_utc: r.published_utc as string,
    pick_uids: String(r.uids ?? "")
      .split(",")
      .filter(Boolean),
  }));
}

/* ------------------------------------------------------- peta liga kanonik */

interface LigaKanonikFile {
  leagues: {
    canonical_id: string;
    name: string;
    fits?: unknown[];
    aliases?: { id?: string; name_as_stored?: string }[];
  }[];
}

let petaLigaCache: { prioritas: Map<string, number>; nama: Map<string, string> } | null = null;
function petaLiga(): { prioritas: Map<string, number>; nama: Map<string, string> } {
  if (petaLigaCache) return petaLigaCache;
  const prioritas = new Map<string, number>();
  const nama = new Map<string, string>();
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "data", "league-canonical.json"), "utf8"),
    ) as LigaKanonikFile;
    for (const lg of raw.leagues ?? []) {
      const p = (lg.fits?.length ?? 0) > 0 ? 0 : 1;
      prioritas.set(lg.canonical_id, p);
      nama.set(lg.canonical_id, lg.name);
      if (lg.name) prioritas.set(`nama:${lg.name.toLowerCase()}`, p);
      for (const a of lg.aliases ?? []) {
        if (a.id) {
          prioritas.set(a.id, p);
          nama.set(a.id, lg.name);
        }
        if (a.name_as_stored) prioritas.set(`nama:${a.name_as_stored.toLowerCase()}`, p);
      }
    }
  } catch {
    /* tanpa registry: prioritas seragam, nama apa adanya */
  }
  petaLigaCache = { prioritas, nama };
  return petaLigaCache;
}

/**
 * Prioritas liga untuk urutan jadwal: 0 = liga yang punya fit rating
 * (universe yang benar-benar dinilai aplikasi), 1 = lainnya. Deterministik
 * dari registry kanonik, bukan tebakan nama.
 */
export function prioritasLiga(
  competitionCanonicalId: string | null,
  competitionName: string | null,
): number {
  const { prioritas } = petaLiga();
  if (competitionCanonicalId && prioritas.has(competitionCanonicalId)) {
    return prioritas.get(competitionCanonicalId)!;
  }
  if (competitionName) {
    const p = prioritas.get(`nama:${competitionName.toLowerCase()}`);
    if (p !== undefined) return p;
  }
  return 1;
}

/* ------------------------------------------------------------- jadwal */

export interface JadwalItem {
  match_id: string;
  fixture_uid: string | null;
  home: string;
  away: string;
  competition_name: string;
  competition_country: string | null;
  competition_canonical_id: string | null;
  kickoff_utc: string;
  status: FixtureStatus;
  home_goals: number | null;
  away_goals: number | null;
  /** Untuk laga ditunda: jadwal asal (tanggal baris katalognya sendiri). */
  jadwal_asal_utc: string | null;
  /** Untuk laga ditunda: kickoff jadwal ulang bila baris sibling terjadwal ada. */
  jadwal_ulang_utc: string | null;
  package_id: number | null;
  gate_status: string | null;
  pickCounts: { A: number; B: number; C: number };
  topLeg: Leg | null;
}

function ringkasPaket(pkg: PackageRow): { pickCounts: { A: number; B: number; C: number }; topLeg: Leg | null } {
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
  return { pickCounts: counts, topLeg: legs[0] ?? null };
}

function jadwalUlangOf(matchId: string, kickoffUtc: string): string | null {
  const up = upcomingDb();
  if (!up) return null;
  try {
    for (const id of siblingsOf(matchId)) {
      const r = up
        .prepare(`SELECT utc_date, status FROM upcoming_fixtures WHERE match_id = ?`)
        .get(id) as { utc_date: string; status: string | null } | undefined;
      if (r && r.utc_date !== kickoffUtc && displayStatus(r.status) === "scheduled") {
        return r.utc_date;
      }
    }
  } catch {
    /* katalog tak terbaca */
  }
  return null;
}

/**
 * Daftar jadwal kanonik untuk jendela UTC [dariUtc, sampaiUtc): sumbernya
 * katalog upcoming_fixtures (termasuk laga TANPA paket), diperkaya paket
 * analisis terbaru per laga dan keadaan hasil dari dataset. Urutan stabil:
 * kickoff, lalu prioritas liga, lalu nama kompetisi, lalu id pertandingan.
 */
export function listSchedule(dariUtc: string, sampaiUtc: string): JadwalItem[] {
  interface Mentah {
    match_id: string;
    home: string;
    away: string;
    competition_name: string;
    competition_country: string | null;
    competition_canonical_id: string | null;
    kickoff_utc: string;
    statusRaw: string | null;
    dariKatalog: boolean;
  }
  const byId = new Map<string, Mentah>();
  const up = upcomingDb();
  if (up) {
    try {
      const rows = up
        .prepare(
          `SELECT * FROM upcoming_fixtures WHERE utc_date >= ? AND utc_date < ?`,
        )
        .all(dariUtc, sampaiUtc) as Record<string, unknown>[];
      for (const r of rows) {
        byId.set(r.match_id as string, {
          match_id: r.match_id as string,
          home: (r.home_team_name as string | null) ?? "?",
          away: (r.away_team_name as string | null) ?? "?",
          competition_name: (r.competition_name as string | null) ?? "",
          competition_country: (r.competition_country as string | null) ?? null,
          competition_canonical_id: null,
          kickoff_utc: r.utc_date as string,
          statusRaw: (r.status as string | null) ?? null,
          dariKatalog: true,
        });
      }
    } catch {
      /* tabel katalog belum ada di DB ini */
    }
  }
  const pkgById = new Map<string, PackageRow>();
  const pkgRows = packagesDb()
    .prepare(`${LATEST_PER_MATCH} WHERE p.kickoff_utc >= ? AND p.kickoff_utc < ?`)
    .all(dariUtc, sampaiUtc) as Record<string, unknown>[];
  for (const r of pkgRows) {
    const pkg = parsePackage(r);
    pkgById.set(pkg.match_id, pkg);
    if (!byId.has(pkg.match_id)) {
      const f = pkg.payload.fixture;
      byId.set(pkg.match_id, {
        match_id: pkg.match_id,
        home: f.home,
        away: f.away,
        competition_name: f.competition_name,
        competition_country: null,
        competition_canonical_id: pkg.competition_canonical_id,
        kickoff_utc: pkg.kickoff_utc,
        statusRaw: null,
        dariKatalog: false,
      });
    } else {
      const m = byId.get(pkg.match_id)!;
      m.competition_canonical_id = pkg.competition_canonical_id;
      if (m.home === "?") m.home = pkg.payload.fixture.home;
      if (m.away === "?") m.away = pkg.payload.fixture.away;
      if (!m.competition_name) m.competition_name = pkg.payload.fixture.competition_name;
    }
  }
  // Sumber ketiga: baris dataset — laga selesai/tanpa paket yang sudah
  // tidak ada di katalog (katalog dibersihkan sesudah promosi telemetri)
  // tetap terdaftar di jadwal tanggal lampau.
  try {
    const d = datasetDb();
    const rows = d
      .prepare(
        `SELECT match_id, competition_id, utc_date, status, home_team_id, away_team_id
         FROM matches WHERE utc_date >= ? AND utc_date < ?`,
      )
      .all(dariUtc, sampaiUtc) as Record<string, unknown>[];
    const namaTim = (tid: string) => {
      const t = d
        .prepare(`SELECT name FROM teams WHERE team_id = ?`)
        .get(tid) as { name: string } | undefined;
      if (t?.name) return t.name;
      const cid = canonicalIdForTeamId(tid);
      return cid ? opponentName(cid) : tid;
    };
    for (const r of rows) {
      const mid = r.match_id as string;
      if (!byId.has(mid)) {
        byId.set(mid, {
          match_id: mid,
          home: namaTim(r.home_team_id as string),
          away: namaTim(r.away_team_id as string),
          competition_name:
            petaLiga().nama.get(r.competition_id as string) ?? (r.competition_id as string),
          competition_country: null,
          competition_canonical_id: r.competition_id as string,
          kickoff_utc: r.utc_date as string,
          statusRaw: r.status as string,
          dariKatalog: false,
        });
      }
    }
  } catch {
    /* dataset tak tersedia */
  }

  const items: JadwalItem[] = [];
  for (const m of byId.values()) {
    const pkg = pkgById.get(m.match_id) ?? null;
    const keadaan = getMatchState(m.match_id);
    let status: FixtureStatus;
    if (keadaan) {
      status = keadaan.status;
    } else if (m.dariKatalog) {
      const ds = displayStatus(m.statusRaw);
      status = ds !== "unknown" ? ds : "scheduled";
    } else {
      status = "scheduled";
    }
    const ringkas = pkg ? ringkasPaket(pkg) : { pickCounts: { A: 0, B: 0, C: 0 }, topLeg: null };
    items.push({
      match_id: m.match_id,
      fixture_uid: fixtureUidOf(m.match_id),
      home: m.home,
      away: m.away,
      competition_name: m.competition_name,
      competition_country: m.competition_country,
      competition_canonical_id: m.competition_canonical_id,
      kickoff_utc: m.kickoff_utc,
      status,
      home_goals: keadaan?.home_goals ?? null,
      away_goals: keadaan?.away_goals ?? null,
      jadwal_asal_utc: status === "postponed" ? m.kickoff_utc : null,
      jadwal_ulang_utc: status === "postponed" ? jadwalUlangOf(m.match_id, m.kickoff_utc) : null,
      package_id: pkg?.id ?? null,
      gate_status: pkg?.gate_status ?? null,
      pickCounts: ringkas.pickCounts,
      topLeg: ringkas.topLeg,
    });
  }
  // Dedup per UID kanonik: alias provider untuk laga fisik yang sama
  // hanya menghasilkan satu baris — yang berpaket menang, lalu yang
  // berkatalog.
  const perUid = new Map<string, JadwalItem>();
  const tanpaUid: JadwalItem[] = [];
  for (const it of items) {
    if (!it.fixture_uid) {
      tanpaUid.push(it);
      continue;
    }
    const cur = perUid.get(it.fixture_uid);
    if (!cur || (it.package_id !== null && cur.package_id === null)) {
      perUid.set(it.fixture_uid, it);
    }
  }
  const dedup = [...tanpaUid, ...perUid.values()];
  dedup.sort(
    (a, b) =>
      a.kickoff_utc.localeCompare(b.kickoff_utc) ||
      prioritasLiga(a.competition_canonical_id, a.competition_name) -
        prioritasLiga(b.competition_canonical_id, b.competition_name) ||
      a.competition_name.localeCompare(b.competition_name) ||
      a.match_id.localeCompare(b.match_id),
  );
  return dedup;
}

/** Jendela liputan jadwal yang benar-benar diketahui (katalog ∪ paket). */
export function cakupanJadwal(): { dariUtc: string; sampaiUtc: string } | null {
  const bounds: { a: string; b: string }[] = [];
  const up = upcomingDb();
  if (up) {
    try {
      const r = up
        .prepare(`SELECT MIN(utc_date) AS a, MAX(utc_date) AS b FROM upcoming_fixtures`)
        .get() as { a: string | null; b: string | null };
      if (r.a && r.b) bounds.push({ a: r.a, b: r.b });
    } catch {
      /* abaikan */
    }
  }
  try {
    const r = packagesDb()
      .prepare(`SELECT MIN(kickoff_utc) AS a, MAX(kickoff_utc) AS b FROM packages`)
      .get() as { a: string | null; b: string | null };
    if (r.a && r.b) bounds.push({ a: r.a, b: r.b });
  } catch {
    /* abaikan */
  }
  if (bounds.length === 0) return null;
  return {
    dariUtc: bounds.map((x) => x.a).sort()[0],
    sampaiUtc: bounds.map((x) => x.b).sort()[bounds.length - 1],
  };
}

export interface InfoFixture {
  match_id: string;
  fixture_uid: string | null;
  home: string;
  away: string;
  competition_name: string;
  competition_country: string | null;
  kickoff_utc: string;
  status: FixtureStatus;
}

/**
 * Info dasar satu laga TANPA syarat paket — detail laga terjadwal tanpa
 * paket tetap bisa dibuka (U3.6). Urutan sumber: katalog, dataset, paket.
 * Null hanya untuk ID yang benar-benar asing.
 */
export function getFixtureInfo(matchId: string): InfoFixture | null {
  const ids = siblingsOf(matchId);
  const fixtureUid = fixtureUidOf(matchId);
  const up = upcomingDb();
  if (up) {
    try {
      for (const id of ids) {
        const r = up
          .prepare(`SELECT * FROM upcoming_fixtures WHERE match_id = ?`)
          .get(id) as Record<string, unknown> | undefined;
        if (r) {
          const keadaan = getMatchState(matchId);
          return {
            match_id: matchId,
            fixture_uid: fixtureUid,
            home: (r.home_team_name as string | null) ?? "?",
            away: (r.away_team_name as string | null) ?? "?",
            competition_name: (r.competition_name as string | null) ?? "",
            competition_country: (r.competition_country as string | null) ?? null,
            kickoff_utc: r.utc_date as string,
            status: keadaan?.status ?? displayStatus(r.status as string | null),
          };
        }
      }
    } catch {
      /* lanjut ke sumber berikutnya */
    }
  }
  try {
    const d = datasetDb();
    for (const id of ids) {
      const r = d
        .prepare(`SELECT * FROM matches WHERE match_id = ?`)
        .get(id) as Record<string, unknown> | undefined;
      if (r) {
        const namaTim = (tid: string) => {
          const t = d
            .prepare(`SELECT name FROM teams WHERE team_id = ?`)
            .get(tid) as { name: string } | undefined;
          if (t?.name) return t.name;
          const cid = canonicalIdForTeamId(tid);
          return cid ? opponentName(cid) : tid;
        };
        const keadaan = getMatchState(matchId);
        return {
          match_id: matchId,
          fixture_uid: fixtureUid,
          home: namaTim(r.home_team_id as string),
          away: namaTim(r.away_team_id as string),
          competition_name:
            petaLiga().nama.get(r.competition_id as string) ?? (r.competition_id as string),
          competition_country: null,
          kickoff_utc: r.utc_date as string,
          status: keadaan?.status ?? displayStatus(r.status as string),
        };
      }
    }
  } catch {
    /* lanjut */
  }
  try {
    for (const id of ids) {
      const row = packagesDb()
        .prepare(`SELECT * FROM packages WHERE match_id = ? ORDER BY id DESC LIMIT 1`)
        .get(id) as Record<string, unknown> | undefined;
      if (row) {
        const pkg = parsePackage(row);
        const f = pkg.payload.fixture;
        return {
          match_id: matchId,
          fixture_uid: fixtureUid,
          home: f.home,
          away: f.away,
          competition_name: f.competition_name,
          competition_country: null,
          kickoff_utc: pkg.kickoff_utc,
          status: getMatchState(matchId)?.status ?? "scheduled",
        };
      }
    }
  } catch {
    /* tak ada sumber yang mengenal id ini */
  }
  return null;
}

/** Matriks skor paket untuk halaman analisis + pembangun parlay (client-safe data). */
export function getPackageMatrix(packageId: number): number[][] | null {
  const row = packagesDb()
    .prepare(`SELECT payload_json FROM packages WHERE id = ?`)
    .get(packageId) as { payload_json: string } | undefined;
  if (!row) return null;
  return (JSON.parse(row.payload_json) as QuantPayload).score_matrix ?? null;
}
