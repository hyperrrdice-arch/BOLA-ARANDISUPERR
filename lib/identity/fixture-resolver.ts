/**
 * FIXTURE RESOLVER — SATU PINTU identitas pertandingan (PRD Bola, bab Data
 * D1–D2, kartu K1).
 *
 * Sebelum modul ini, identitas laga fisik tersebar: importer menjembatani
 * hasil lewat kunci (tanggal + nama) di memorinya sendiri, builder alias
 * menulis registry katalog `links`, resolver hasil membaca registry itu
 * dengan parsernya sendiri, dan adapter web membaca registry yang sama
 * dengan parser LAIN yang mengharapkan bentuk `groups` (tidak pernah
 * ditulis builder) plus memeriksa status 'FT' sementara dataset memakai
 * 'finished'. Akibat terukurnya (baseline D01): 0/2 pick ter-resolve.
 *
 * Modul ini menyediakan, untuk semua produser dan pembaca:
 *  1. Normalisasi status (`normalizeMatchStatus`) — satu kosakata internal
 *     untuk writer dan reader: 'FT'/'finished'/… → 'finished', dst.
 *  2. Parser registry tautan yang tervalidasi (`parseFixtureLinks`) —
 *     memahami bentuk file sebenarnya (`links[].{twin_id, canonical_id}`)
 *     dan bentuk warisan `groups[]`; entri tidak valid dilewati terhitung,
 *     bukan ditebak.
 *  3. Store identitas persisten di dataset: `canonical_fixtures`
 *     (fixture_uid opak, stabil walau kickoff/nama/sumber berubah) +
 *     `fixture_aliases` (pasangan (source, source_match_id) unik, indeks
 *     balik UID → seluruh alias) + `fixture_identity_queue` (kasus ambigu
 *     dengan alasan `identity_ambiguous`) + `result_revisions` (histori
 *     hasil: duplikat tidak menambah revisi, koreksi menambah revisi dan
 *     skor lama tetap tersimpan).
 *  4. Algoritme pencocokan D1 (`resolveFixtureIdentity`) dan aturan hasil
 *     D2 (`applyResultObservation`).
 *
 * Semua fungsi menerima handle DatabaseSync dataset secara eksplisit —
 * tidak ada path cwd yang diasumsikan di sini, jadi modul yang sama bisa
 * dipakai skrip (cwd = data/), adapter web (read-only; hanya fungsi baca),
 * dan pengujian (cwd = sandbox fixture).
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizeTeamName } from "../quant/team-normalizer";

type Db = DatabaseSync;

/** Versi aturan settlement yang dicatat pada revisi hasil + void (D2). */
export const SETTLEMENT_POLICY_VERSION = "k1-2026-11";

// ============================================================================
// 1. NORMALISASI STATUS
// ============================================================================

export type MatchState =
  | "finished"
  | "scheduled"
  | "cancelled"
  | "postponed"
  | "live"
  | "unknown";

const FINISHED_SPELLINGS = new Set([
  "finished",
  "ft",
  "full_time",
  "fulltime",
  "full-time",
  "aet",
  "pen",
  "pens",
  "completed",
  "played",
]);
const CANCELLED_SPELLINGS = new Set(["cancelled", "canceled", "abandoned", "void"]);
const POSTPONED_SPELLINGS = new Set(["postponed", "delayed"]);
const SCHEDULED_SPELLINGS = new Set([
  "scheduled",
  "ns",
  "not_started",
  "notstarted",
  "upcoming",
  "tbd",
  "fixture",
]);
const LIVE_SPELLINGS = new Set(["live", "inplay", "in_play", "playing", "1h", "2h", "ht"]);

/** Status mentah sumber mana pun → kosakata internal. null/kosong → 'unknown'. */
export function normalizeMatchStatus(raw: string | null | undefined): MatchState {
  if (raw === null || raw === undefined) return "unknown";
  const key = raw.trim().toLowerCase();
  if (key === "") return "unknown";
  if (FINISHED_SPELLINGS.has(key)) return "finished";
  if (CANCELLED_SPELLINGS.has(key)) return "cancelled";
  if (POSTPONED_SPELLINGS.has(key)) return "postponed";
  if (SCHEDULED_SPELLINGS.has(key)) return "scheduled";
  if (LIVE_SPELLINGS.has(key)) return "live";
  return "unknown";
}

export function isFinishedStatus(raw: string | null | undefined): boolean {
  return normalizeMatchStatus(raw) === "finished";
}

// ============================================================================
// 2. PARSER REGISTRY TAUTAN (data/fixture-links.json)
// ============================================================================

export interface FixtureLinkGroup {
  canonical_id: string;
  /** Seluruh id satu laga fisik, termasuk canonical_id. */
  ids: string[];
  kickoff_utc: string | null;
}

export interface FixtureLinksParse {
  groups: FixtureLinkGroup[];
  /** Jumlah tautan valid yang terbaca (sebelum penggabungan grup). */
  link_count: number;
  /** Entri yang dilewati karena tidak valid (bukan ditebak isinya). */
  skipped: number;
}

/**
 * Parser tervalidasi untuk fixture-links.json. Bentuk sebenarnya yang
 * ditulis scripts/build-fixture-links.ts adalah
 * `{ links: [{ twin_id, canonical_id, kickoff_utc }] }`; bentuk warisan
 * `{ groups: [{ match_ids: [...] }] }` (yang dulu dicari adapter web) juga
 * dipahami supaya file lama tetap terbaca. Grup yang tumpang tindih
 * digabung (union-find) — satu laga fisik = satu grup.
 */
export function parseFixtureLinks(text: string): FixtureLinksParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { groups: [], link_count: 0, skipped: 0 };
  }
  const root = (parsed ?? {}) as {
    links?: unknown;
    groups?: unknown;
  };

  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) as string;
    parent.set(x, r);
    return r;
  };
  const ensure = (x: string) => {
    if (!parent.has(x)) parent.set(x, x);
  };
  const union = (a: string, b: string) => {
    ensure(a);
    ensure(b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const canonicalOf = new Map<string, string>();
  const kickoffOf = new Map<string, string>();
  let linkCount = 0;
  let skipped = 0;

  const rawLinks = Array.isArray(root.links) ? root.links : [];
  for (const entry of rawLinks) {
    const e = entry as { twin_id?: unknown; canonical_id?: unknown; kickoff_utc?: unknown };
    const twin = typeof e?.twin_id === "string" ? e.twin_id : null;
    const canonical = typeof e?.canonical_id === "string" ? e.canonical_id : null;
    if (!twin || !canonical || twin === canonical) {
      skipped++;
      continue;
    }
    union(twin, canonical);
    canonicalOf.set(twin, canonical);
    if (typeof e.kickoff_utc === "string" && !kickoffOf.has(canonical)) {
      kickoffOf.set(canonical, e.kickoff_utc);
    }
    linkCount++;
  }

  const rawGroups = Array.isArray(root.groups) ? root.groups : [];
  for (const entry of rawGroups) {
    const g = entry as { match_ids?: unknown };
    const ids = Array.isArray(g?.match_ids)
      ? g.match_ids.filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];
    if (ids.length < 2) {
      skipped++;
      continue;
    }
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
    linkCount += ids.length - 1;
  }

  const byRoot = new Map<string, string[]>();
  for (const id of parent.keys()) {
    const r = find(id);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r)!.push(id);
  }
  const groups: FixtureLinkGroup[] = [];
  for (const ids of byRoot.values()) {
    if (ids.length < 2) continue;
    ids.sort();
    // Kanonik grup: id yang disebut sebagai canonical_id oleh tautan grup
    // ini; kalau tidak ada (grup warisan), didahulukan id berawalan sm_
    // (konvensi builder), lalu id pertama menurut urutan leksikal.
    const canonicalValues = new Set(canonicalOf.values());
    const canonical =
      ids.find((id) => canonicalValues.has(id)) ??
      ids.find((id) => id.startsWith("sm_")) ??
      ids[0];
    groups.push({
      canonical_id: canonical,
      ids,
      kickoff_utc: kickoffOf.get(canonical) ?? null,
    });
  }
  groups.sort((a, b) => a.canonical_id.localeCompare(b.canonical_id));
  return { groups, link_count: linkCount, skipped };
}

/** Muat + parse data/fixture-links.json dari direktori data (boleh tidak ada). */
export function loadFixtureLinkGroups(dataDir: string): FixtureLinkGroup[] {
  const p = path.join(dataDir, "fixture-links.json");
  if (!fs.existsSync(p)) return [];
  try {
    return parseFixtureLinks(fs.readFileSync(p, "utf8")).groups;
  } catch {
    return [];
  }
}

/** Seluruh id satu grup dengan `matchId` dari grup tautan (termasuk dirinya). */
export function linkSiblingsOf(groups: FixtureLinkGroup[], matchId: string): string[] {
  for (const g of groups) {
    if (g.ids.includes(matchId)) return g.ids;
  }
  return [matchId];
}

// ============================================================================
// 3. STORE IDENTITAS PERSISTEN (dataset)
// ============================================================================

export function ensureIdentitySchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS canonical_fixtures (
      fixture_uid TEXT PRIMARY KEY,
      competition_id TEXT,
      season TEXT,
      home_cid TEXT,
      away_cid TEXT,
      home_name TEXT,
      away_name TEXT,
      stage_or_leg TEXT,
      kickoff_utc TEXT,
      kickoff_precision TEXT NOT NULL DEFAULT 'exact',
      state TEXT NOT NULL DEFAULT 'scheduled',
      neutral INTEGER,
      score_basis TEXT NOT NULL DEFAULT 'regulation',
      current_revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cf_match_key
      ON canonical_fixtures(competition_id, home_cid, away_cid, kickoff_utc);
    CREATE TABLE IF NOT EXISTS fixture_aliases (
      source TEXT NOT NULL,
      source_match_id TEXT NOT NULL,
      fixture_uid TEXT NOT NULL,
      match_basis TEXT,
      first_seen_utc TEXT NOT NULL,
      last_seen_utc TEXT NOT NULL,
      PRIMARY KEY (source, source_match_id)
    );
    CREATE INDEX IF NOT EXISTS idx_fa_uid ON fixture_aliases(fixture_uid);
    CREATE INDEX IF NOT EXISTS idx_fa_match ON fixture_aliases(source_match_id);
    CREATE TABLE IF NOT EXISTS fixture_identity_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_match_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      detail_json TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_fiq_open
      ON fixture_identity_queue(source, source_match_id, reason, resolved_at);
    CREATE TABLE IF NOT EXISTS result_revisions (
      revision_id INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_uid TEXT NOT NULL,
      match_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      status TEXT NOT NULL,
      home_score INTEGER,
      away_score INTEGER,
      home_score_et INTEGER,
      away_score_et INTEGER,
      home_score_pen INTEGER,
      away_score_pen INTEGER,
      score_basis TEXT NOT NULL DEFAULT 'regulation',
      source TEXT,
      observed_at TEXT NOT NULL,
      checksum TEXT,
      settlement_policy_version TEXT NOT NULL,
      UNIQUE (fixture_uid, revision)
    );
    CREATE INDEX IF NOT EXISTS idx_rr_uid ON result_revisions(fixture_uid);
  `);
}

/** Tabel identitas ada? (Pembaca read-only di DB pra-migrasi harus degrade.) */
export function identityTablesExist(db: Db): boolean {
  try {
    const row = db
      .prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('canonical_fixtures', 'fixture_aliases')",
      )
      .get() as { n: number };
    return row.n === 2;
  } catch {
    return false;
  }
}

/** Sistem sumber dari awalan id laga (konvensi namespace repo). */
export function sourceOfMatchId(matchId: string): string {
  if (matchId.startsWith("sm_")) return "sportmonks";
  if (matchId.startsWith("fd_")) return "football-data";
  if (matchId.startsWith("mt_")) return "thestats";
  return "unknown";
}

export interface CanonicalFixtureRow {
  fixture_uid: string;
  competition_id: string | null;
  season: string | null;
  home_cid: string | null;
  away_cid: string | null;
  home_name: string | null;
  away_name: string | null;
  stage_or_leg: string | null;
  kickoff_utc: string | null;
  kickoff_precision: string;
  state: string;
  neutral: number | null;
  score_basis: string;
  current_revision: number;
}

export function getFixtureByUid(db: Db, fixtureUid: string): CanonicalFixtureRow | null {
  const row = db
    .prepare("SELECT * FROM canonical_fixtures WHERE fixture_uid = ?")
    .get(fixtureUid) as CanonicalFixtureRow | undefined;
  return row ?? null;
}

export function getUidForAlias(db: Db, source: string, sourceMatchId: string): string | null {
  const row = db
    .prepare("SELECT fixture_uid FROM fixture_aliases WHERE source = ? AND source_match_id = ?")
    .get(source, sourceMatchId) as { fixture_uid: string } | undefined;
  return row?.fixture_uid ?? null;
}

/** UID untuk id laga mana pun (id unik lintas sumber karena awalan namespace). */
export function getUidForMatchId(db: Db, matchId: string): string | null {
  const row = db
    .prepare("SELECT fixture_uid FROM fixture_aliases WHERE source_match_id = ? LIMIT 1")
    .get(matchId) as { fixture_uid: string } | undefined;
  return row?.fixture_uid ?? null;
}

export function getAliasesForUid(db: Db, fixtureUid: string): { source: string; source_match_id: string }[] {
  return db
    .prepare(
      "SELECT source, source_match_id FROM fixture_aliases WHERE fixture_uid = ? ORDER BY source_match_id",
    )
    .all(fixtureUid) as unknown as { source: string; source_match_id: string }[];
}

/** Seluruh id saudara satu laga fisik menurut store identitas (termasuk id itu sendiri). */
export function getSiblingIds(db: Db, matchId: string): string[] {
  if (!identityTablesExist(db)) return [matchId];
  const uid = getUidForMatchId(db, matchId);
  if (!uid) return [matchId];
  const ids = getAliasesForUid(db, uid).map((a) => a.source_match_id);
  return ids.includes(matchId) ? ids : [matchId, ...ids];
}

/** Tautkan satu alias ke UID (idempoten; last_seen diperbarui). */
export function linkAlias(
  db: Db,
  fixtureUid: string,
  source: string,
  sourceMatchId: string,
  matchBasis: string,
  nowUtc: string,
): void {
  db.prepare(
    `INSERT INTO fixture_aliases (source, source_match_id, fixture_uid, match_basis, first_seen_utc, last_seen_utc)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(source, source_match_id) DO UPDATE SET
       fixture_uid = excluded.fixture_uid,
       match_basis = excluded.match_basis,
       last_seen_utc = excluded.last_seen_utc`,
  ).run(source, sourceMatchId, fixtureUid, matchBasis, nowUtc, nowUtc);
}

function enqueueAmbiguous(
  db: Db,
  source: string,
  sourceMatchId: string,
  reason: string,
  detail: unknown,
  nowUtc: string,
): void {
  const existing = db
    .prepare(
      "SELECT id FROM fixture_identity_queue WHERE source = ? AND source_match_id = ? AND reason = ? AND resolved_at IS NULL LIMIT 1",
    )
    .get(source, sourceMatchId, reason) as { id: number } | undefined;
  if (existing) return;
  db.prepare(
    "INSERT INTO fixture_identity_queue (source, source_match_id, reason, detail_json, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(source, sourceMatchId, reason, detail === undefined ? null : JSON.stringify(detail), nowUtc);
}

function newFixtureUid(): string {
  return `fx_${randomUUID()}`;
}

// ============================================================================
// 4. ALGORITME PENCOCOKAN IDENTITAS (D1)
// ============================================================================

export interface FixtureObservation {
  source: string;
  sourceMatchId: string;
  competitionId: string | null;
  season?: string | null;
  /** Id tim kanonik (registry) — BUKAN id baris sumber. */
  homeCid: string | null;
  awayCid: string | null;
  homeName?: string | null;
  awayName?: string | null;
  kickoffUtc: string;
  /** 'date_only' = tanggal tanpa jam tepercaya (00:00 hasil imputasi). */
  kickoffPrecision: "exact" | "date_only";
  stageOrLeg?: string | null;
  neutral?: boolean | null;
}

export type ResolveOutcome =
  | { kind: "known" | "matched" | "created"; fixtureUid: string }
  | { kind: "ambiguous"; fixtureUid: null; reason: string };

const AMBIGUOUS = "identity_ambiguous";

function date10(iso: string): string {
  return iso.slice(0, 10);
}

function findCandidates(db: Db, obs: FixtureObservation): CanonicalFixtureRow[] {
  return db
    .prepare(
      `SELECT * FROM canonical_fixtures
       WHERE competition_id IS ? AND home_cid IS ? AND away_cid IS ?
         AND kickoff_utc IS NOT NULL AND substr(kickoff_utc, 1, 10) = ?`,
    )
    .all(obs.competitionId, obs.homeCid, obs.awayCid, date10(obs.kickoffUtc)) as unknown as CanonicalFixtureRow[];
}

/**
 * Resolusi satu observasi fixture ke UID persisten.
 *
 * 1. Alias dikenal → UID-nya, dengan validasi sisi tim; perubahan jadwal
 *    pada alias yang sama mempertahankan UID (kickoff diperbarui).
 * 2. Kandidat baru: kompetisi kanonik + musim + tim kandang/tamu BERURUTAN
 *    + tanggal kickoff. Gabung otomatis hanya bila tepat satu kandidat
 *    memenuhi bukti (dan, bila keduanya punya label babak/leg, labelnya
 *    sama; label yang bertabrakan mengeluarkan kandidat dan — bila itu
 *    satu-satunya penjelasan — masuk antrean).
 * 3. Ambigu → antrean peninjauan dengan alasan `identity_ambiguous`:
 *    dua kandidat, tanggal tanpa jam, sisi tertukar (venue netral), atau
 *    nama tim sama tetapi id kanonik berbeda (senior vs cadangan/putri).
 *    Publikasi/settlement yang mengandalkannya ditangguhkan oleh pemanggil
 *    (outcome 'ambiguous' tidak menghasilkan UID).
 */
export function resolveFixtureIdentity(
  db: Db,
  obs: FixtureObservation,
  nowUtc: string,
): ResolveOutcome {
  ensureIdentitySchema(db);

  // --- 1. Alias dikenal.
  const knownUid = getUidForAlias(db, obs.source, obs.sourceMatchId);
  if (knownUid) {
    const fx = getFixtureByUid(db, knownUid);
    if (fx) {
      // Validasi sisi tim bila kedua pihak punya id kanonik.
      if (obs.homeCid && obs.awayCid && fx.home_cid && fx.away_cid) {
        if (obs.homeCid === fx.away_cid && obs.awayCid === fx.home_cid && obs.homeCid !== fx.home_cid) {
          enqueueAmbiguous(db, obs.source, obs.sourceMatchId, AMBIGUOUS, {
            cause: "sides_swapped_on_known_alias",
            fixture_uid: knownUid,
          }, nowUtc);
          return { kind: "ambiguous", fixtureUid: null, reason: "sides_swapped_on_known_alias" };
        }
        if (obs.homeCid !== fx.home_cid || obs.awayCid !== fx.away_cid) {
          enqueueAmbiguous(db, obs.source, obs.sourceMatchId, AMBIGUOUS, {
            cause: "alias_team_conflict",
            fixture_uid: knownUid,
            stored: [fx.home_cid, fx.away_cid],
            observed: [obs.homeCid, obs.awayCid],
          }, nowUtc);
          return { kind: "ambiguous", fixtureUid: null, reason: "alias_team_conflict" };
        }
      }
      // Jadwal bergeser pada alias yang sama → UID bertahan, kickoff direvisi.
      if (fx.kickoff_utc !== obs.kickoffUtc) {
        db.prepare(
          "UPDATE canonical_fixtures SET kickoff_utc = ?, kickoff_precision = ?, season = COALESCE(season, ?), stage_or_leg = COALESCE(stage_or_leg, ?), updated_at = ? WHERE fixture_uid = ?",
        ).run(obs.kickoffUtc, obs.kickoffPrecision, obs.season ?? null, obs.stageOrLeg ?? null, nowUtc, knownUid);
      }
      linkAlias(db, knownUid, obs.source, obs.sourceMatchId, "known_alias", nowUtc);
      return { kind: "known", fixtureUid: knownUid };
    }
  }

  // --- 2./3. Kandidat baru.
  const allCandidates = findCandidates(db, obs);
  let stageExcluded: CanonicalFixtureRow[] = [];
  let candidates = allCandidates;
  if (obs.stageOrLeg) {
    stageExcluded = allCandidates.filter(
      (c) => c.stage_or_leg !== null && c.stage_or_leg !== obs.stageOrLeg,
    );
    candidates = allCandidates.filter(
      (c) => c.stage_or_leg === null || c.stage_or_leg === obs.stageOrLeg,
    );
  }

  if (candidates.length === 0 && stageExcluded.length > 0) {
    enqueueAmbiguous(db, obs.source, obs.sourceMatchId, AMBIGUOUS, {
      cause: "stage_or_leg_mismatch",
      candidates: stageExcluded.map((c) => c.fixture_uid),
    }, nowUtc);
    return { kind: "ambiguous", fixtureUid: null, reason: "stage_or_leg_mismatch" };
  }

  // Sisi tertukar terhadap kandidat yang ada (venue netral) → ambigu.
  if (candidates.length === 0 && obs.homeCid && obs.awayCid && obs.homeCid !== obs.awayCid) {
    const swapped = db
      .prepare(
        `SELECT * FROM canonical_fixtures
         WHERE competition_id IS ? AND home_cid IS ? AND away_cid IS ?
           AND kickoff_utc IS NOT NULL AND substr(kickoff_utc, 1, 10) = ?`,
      )
      .all(obs.competitionId, obs.awayCid, obs.homeCid, date10(obs.kickoffUtc)) as unknown as CanonicalFixtureRow[];
    if (swapped.length > 0) {
      enqueueAmbiguous(db, obs.source, obs.sourceMatchId, AMBIGUOUS, {
        cause: "sides_swapped",
        candidates: swapped.map((c) => c.fixture_uid),
      }, nowUtc);
      return { kind: "ambiguous", fixtureUid: null, reason: "sides_swapped" };
    }
  }

  // Nama sama persis tetapi id kanonik berbeda (senior vs cadangan/putri,
  // atau tim berbeda bernama sama) → ambigu, jangan gabung diam-diam.
  if (candidates.length === 0 && obs.homeName && obs.awayName) {
    const homeNorm = normalizeTeamName(obs.homeName);
    const awayNorm = normalizeTeamName(obs.awayName);
    const sameDay = db
      .prepare(
        `SELECT * FROM canonical_fixtures
         WHERE competition_id IS ? AND kickoff_utc IS NOT NULL AND substr(kickoff_utc, 1, 10) = ?`,
      )
      .all(obs.competitionId, date10(obs.kickoffUtc)) as unknown as CanonicalFixtureRow[];
    const nameClash = sameDay.filter(
      (c) =>
        c.home_name !== null &&
        c.away_name !== null &&
        normalizeTeamName(c.home_name) === homeNorm &&
        normalizeTeamName(c.away_name) === awayNorm,
    );
    if (nameClash.length > 0) {
      enqueueAmbiguous(db, obs.source, obs.sourceMatchId, AMBIGUOUS, {
        cause: "team_identity_conflict",
        candidates: nameClash.map((c) => c.fixture_uid),
      }, nowUtc);
      return { kind: "ambiguous", fixtureUid: null, reason: "team_identity_conflict" };
    }
  }

  if (obs.kickoffPrecision === "date_only" && candidates.length >= 1) {
    enqueueAmbiguous(db, obs.source, obs.sourceMatchId, AMBIGUOUS, {
      cause: "date_only_kickoff",
      candidates: candidates.map((c) => c.fixture_uid),
    }, nowUtc);
    return { kind: "ambiguous", fixtureUid: null, reason: "date_only_kickoff" };
  }

  if (candidates.length > 1) {
    enqueueAmbiguous(db, obs.source, obs.sourceMatchId, AMBIGUOUS, {
      cause: "multiple_candidates",
      candidates: candidates.map((c) => c.fixture_uid),
    }, nowUtc);
    return { kind: "ambiguous", fixtureUid: null, reason: "multiple_candidates" };
  }

  if (candidates.length === 1) {
    const uid = candidates[0].fixture_uid;
    linkAlias(db, uid, obs.source, obs.sourceMatchId, "candidate_match", nowUtc);
    return { kind: "matched", fixtureUid: uid };
  }

  // --- Tidak ada kandidat: fixture baru.
  const uid = newFixtureUid();
  db.prepare(
    `INSERT INTO canonical_fixtures (
       fixture_uid, competition_id, season, home_cid, away_cid, home_name, away_name,
       stage_or_leg, kickoff_utc, kickoff_precision, state, neutral, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)`,
  ).run(
    uid,
    obs.competitionId,
    obs.season ?? null,
    obs.homeCid,
    obs.awayCid,
    obs.homeName ?? null,
    obs.awayName ?? null,
    obs.stageOrLeg ?? null,
    obs.kickoffUtc,
    obs.kickoffPrecision,
    obs.neutral === null || obs.neutral === undefined ? null : obs.neutral ? 1 : 0,
    nowUtc,
    nowUtc,
  );
  linkAlias(db, uid, obs.source, obs.sourceMatchId, "created", nowUtc);
  return { kind: "created", fixtureUid: uid };
}

// ============================================================================
// 5. OBSERVASI HASIL + REVISI (D2)
// ============================================================================

export interface ResultObservation {
  fixtureUid: string;
  /** Baris dataset jangkar yang skornya hidup (matches.match_id). */
  anchorMatchId: string;
  statusRaw: string | null;
  homeScore: number | null;
  awayScore: number | null;
  homeScoreEt?: number | null;
  awayScoreEt?: number | null;
  homeScorePen?: number | null;
  awayScorePen?: number | null;
  source: string;
  observedAt: string;
}

export type ObservationAction =
  | "applied"
  | "corrected"
  | "duplicate"
  | "stale_ignored"
  | "cancelled"
  | "postponed"
  | "pending_score_basis"
  | "noted"
  | "no_anchor";

export interface ObservationOutcome {
  action: ObservationAction;
  /** Nomor revisi sesudah observasi ini (0 = belum ada revisi hasil). */
  revision: number;
  previousScore: { home: number; away: number } | null;
}

function validScore(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function observationChecksum(obs: ResultObservation, state: MatchState): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        obs.fixtureUid,
        state,
        obs.homeScore,
        obs.awayScore,
        obs.homeScoreEt ?? null,
        obs.awayScoreEt ?? null,
        obs.homeScorePen ?? null,
        obs.awayScorePen ?? null,
        obs.source,
      ]),
    )
    .digest("hex")
    .slice(0, 32);
}

/**
 * Terapkan satu observasi hasil ke fixture. Menulis revisi + memperbarui
 * baris jangkar `matches` dan state `canonical_fixtures` secara konsisten:
 *
 * - Final pertama → revisi baru, jangkar menjadi finished berskor.
 * - Final sama persis dengan yang tersimpan → 'duplicate', TANPA revisi.
 * - Final berbeda → 'corrected': revisi baru, jangkar diperbarui, skor
 *   lama tetap hidup di result_revisions (jejak koreksi utuh) dan
 *   dikembalikan sebagai previousScore agar pemanggil menilai ulang
 *   pilihan/tiket terkait.
 * - Poll lama scheduled/null sesudah final → 'stale_ignored' (status
 *   final tidak pernah mundur).
 * - Piala: pasar standar diselesaikan dari skor 90 menit. Skor ekstra/
 *   penalti disimpan terpisah di revisi. Bila hanya skor pasca-90 yang
 *   tersedia → 'pending_score_basis', jangkar TIDAK diberi skor.
 * - Cancelled → state cancelled (revisi tercatat); void pilihan adalah
 *   tindak lanjut pemanggil sesuai SETTLEMENT_POLICY_VERSION.
 */
export function applyResultObservation(db: Db, obs: ResultObservation): ObservationOutcome {
  ensureIdentitySchema(db);
  const fx = getFixtureByUid(db, obs.fixtureUid);
  if (!fx) throw new Error(`applyResultObservation: fixture_uid tidak dikenal: ${obs.fixtureUid}`);
  const anchor = db
    .prepare("SELECT status, home_score, away_score FROM matches WHERE match_id = ?")
    .get(obs.anchorMatchId) as
    | { status: string; home_score: number | null; away_score: number | null }
    | undefined;
  if (!anchor) return { action: "no_anchor", revision: fx.current_revision, previousScore: null };

  const state = normalizeMatchStatus(obs.statusRaw);
  const currentRevision = fx.current_revision;
  const anchorFinished = isFinishedStatus(anchor.status);
  const previousScore =
    anchor.home_score !== null && anchor.away_score !== null
      ? { home: anchor.home_score, away: anchor.away_score }
      : null;

  const writeRevision = (
    status: MatchState,
    scoreBasis: "regulation" | "pending_score_basis",
  ): number => {
    const revision = currentRevision + 1;
    db.prepare(
      `INSERT INTO result_revisions (
         fixture_uid, match_id, revision, status, home_score, away_score,
         home_score_et, away_score_et, home_score_pen, away_score_pen,
         score_basis, source, observed_at, checksum, settlement_policy_version
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      obs.fixtureUid,
      obs.anchorMatchId,
      revision,
      status,
      obs.homeScore,
      obs.awayScore,
      obs.homeScoreEt ?? null,
      obs.awayScoreEt ?? null,
      obs.homeScorePen ?? null,
      obs.awayScorePen ?? null,
      scoreBasis,
      obs.source,
      obs.observedAt,
      observationChecksum(obs, status),
      SETTLEMENT_POLICY_VERSION,
    );
    return revision;
  };

  if (state === "finished") {
    if (!validScore(obs.homeScore) || !validScore(obs.awayScore)) {
      // Hanya skor pasca-90 (ET/penalti) yang tersedia → basis 90 menit
      // belum diketahui; jangan beri skor ke jangkar.
      if (validScore(obs.homeScoreEt) || validScore(obs.homeScorePen)) {
        if (fx.score_basis === "pending_score_basis" && fx.state === "finished") {
          return { action: "duplicate", revision: currentRevision, previousScore };
        }
        const revision = writeRevision("finished", "pending_score_basis");
        db.prepare(
          "UPDATE canonical_fixtures SET state = 'finished', score_basis = 'pending_score_basis', current_revision = ?, updated_at = ? WHERE fixture_uid = ?",
        ).run(revision, obs.observedAt, obs.fixtureUid);
        return { action: "pending_score_basis", revision, previousScore };
      }
      return { action: "noted", revision: currentRevision, previousScore };
    }
    if (anchorFinished && previousScore && previousScore.home === obs.homeScore && previousScore.away === obs.awayScore) {
      if (currentRevision === 0) {
        // Jangkar sudah finished berskor (mis. baris ditulis langsung oleh
        // importer, atau warisan pra-K1) tetapi fixture ini belum punya
        // SATU pun observasi tercatat — observasi ini adalah yang pertama
        // untuk fixture-nya, jadi ia dicatat sebagai revisi 1, bukan
        // duplikat. Duplikat sejati mensyaratkan revisi yang sudah ada.
        const revision = writeRevision("finished", "regulation");
        db.prepare(
          "UPDATE canonical_fixtures SET state = 'finished', score_basis = 'regulation', current_revision = ?, updated_at = ? WHERE fixture_uid = ?",
        ).run(revision, obs.observedAt, obs.fixtureUid);
        return { action: "applied", revision, previousScore: null };
      }
      return { action: "duplicate", revision: currentRevision, previousScore };
    }
    const wasFinished = anchorFinished && previousScore !== null;
    const revision = writeRevision("finished", "regulation");
    db.prepare(
      "UPDATE matches SET status = 'finished', home_score = ?, away_score = ?, updated_at = ? WHERE match_id = ?",
    ).run(obs.homeScore, obs.awayScore, obs.observedAt, obs.anchorMatchId);
    db.prepare(
      "UPDATE canonical_fixtures SET state = 'finished', score_basis = 'regulation', current_revision = ?, updated_at = ? WHERE fixture_uid = ?",
    ).run(revision, obs.observedAt, obs.fixtureUid);
    return {
      action: wasFinished ? "corrected" : "applied",
      revision,
      previousScore: wasFinished ? previousScore : null,
    };
  }

  if (state === "cancelled") {
    if (fx.state === "cancelled") {
      return { action: "duplicate", revision: currentRevision, previousScore };
    }
    const revision = writeRevision("cancelled", "regulation");
    db.prepare("UPDATE matches SET status = 'cancelled', updated_at = ? WHERE match_id = ?").run(
      obs.observedAt,
      obs.anchorMatchId,
    );
    db.prepare(
      "UPDATE canonical_fixtures SET state = 'cancelled', current_revision = ?, updated_at = ? WHERE fixture_uid = ?",
    ).run(revision, obs.observedAt, obs.fixtureUid);
    return { action: "cancelled", revision, previousScore };
  }

  if (state === "postponed") {
    if (fx.state === "finished" || fx.state === "cancelled") {
      return { action: "stale_ignored", revision: currentRevision, previousScore };
    }
    db.prepare(
      "UPDATE canonical_fixtures SET state = 'postponed', updated_at = ? WHERE fixture_uid = ?",
    ).run(obs.observedAt, obs.fixtureUid);
    return { action: "postponed", revision: currentRevision, previousScore };
  }

  // scheduled / live / unknown: tidak pernah menurunkan final.
  if (fx.state === "finished" || fx.state === "cancelled" || anchorFinished) {
    return { action: "stale_ignored", revision: currentRevision, previousScore };
  }
  return { action: "noted", revision: currentRevision, previousScore };
}

export interface ResultRevisionRow {
  revision: number;
  status: string;
  home_score: number | null;
  away_score: number | null;
  home_score_et: number | null;
  away_score_et: number | null;
  score_basis: string;
  source: string | null;
  observed_at: string;
}

/** Seluruh revisi hasil satu fixture, urut revisi menaik (jejak koreksi). */
export function getResultRevisions(db: Db, fixtureUid: string): ResultRevisionRow[] {
  return db
    .prepare(
      `SELECT revision, status, home_score, away_score, home_score_et, away_score_et,
              score_basis, source, observed_at
       FROM result_revisions WHERE fixture_uid = ? ORDER BY revision ASC`,
    )
    .all(fixtureUid) as unknown as ResultRevisionRow[];
}
