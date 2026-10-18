/**
 * UPCOMING FIXTURES — store terpisah dari dataset utama.
 *
 * Kenapa file DB sendiri: upcoming itu berumur pendek dan disposable (laga
 * selesai → dibuang (sudah jadi telemetry di dataset utama), sedangkan `thestats_dataset.db`
 * itu akumulatif dan boleh jadi rujukan historis. Mencampur keduanya bikin satu
 * operasi DELETE/VACUUM dataset menyapu katalog. Pola yang sama dengan
 * `analysis_snapshots.db`: lifecycle berbeda → file berbeda.
 *
 * Siklus hidup:
 *   1. `scripts/sync-upcoming-fixtures.ts` mengisi store ini (hanya yang jalan 30 hari).
 *   2. Katalog `/api/matches` membaca dari sini; kalau kosong → API (fallback).
 *   3. `scripts/promote-upcoming-to-telemetry.ts` menarik match yang sudah selesai
 *      ke `thestats_dataset.db` (matches + team_match_logs), lalu MENGHAPUS barisnya di sini.
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

let dbInstance: DatabaseSync | null = null;

export function getUpcomingDbPath(): string {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return path.join(dataDir, "upcoming_fixtures.db");
}

export function getUpcomingDb(): DatabaseSync {
  if (dbInstance) return dbInstance;

  const db = new DatabaseSync(getUpcomingDbPath());
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS upcoming_fixtures (
      match_id TEXT PRIMARY KEY,
      competition_id TEXT,
      competition_name TEXT,
      competition_country TEXT,
      utc_date TEXT NOT NULL,
      status TEXT,
      stage_name TEXT,
      home_team_id TEXT,
      home_team_name TEXT,
      away_team_id TEXT,
      away_team_name TEXT,
      venue TEXT,
      is_neutral INTEGER,
      odds_available INTEGER,
      xg_available INTEGER,
      fetched_utc TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_upcoming_kickoff ON upcoming_fixtures(utc_date);
    CREATE INDEX IF NOT EXISTS idx_upcoming_comp ON upcoming_fixtures(competition_id, utc_date);
  `);

  dbInstance = db;
  return dbInstance;
}

export interface UpcomingFixture {
  match_id: string;
  competition_id?: string | null;
  competition_name?: string | null;
  competition_country?: string | null;
  utc_date: string;
  status?: string | null;
  stage_name?: string | null;
  home_team_id?: string | null;
  home_team_name?: string | null;
  away_team_id?: string | null;
  away_team_name?: string | null;
  venue?: string | null;
  is_neutral?: number | null;
  odds_available?: number | null;
  xg_available?: number | null;
}

/** Upsert idempotent — kunci fight-nya match_id. */
export function upsertUpcomingFixtures(rows: UpcomingFixture[]): number {
  if (rows.length === 0) return 0;
  const db = getUpcomingDb();
  const stmt = db.prepare(`
    INSERT INTO upcoming_fixtures (
      match_id, competition_id, competition_name, competition_country,
      utc_date, status, stage_name,
      home_team_id, home_team_name, away_team_id, away_team_name,
      venue, is_neutral, odds_available, xg_available, fetched_utc
    ) VALUES (
      :match_id, :competition_id, :competition_name, :competition_country,
      :utc_date, :status, :stage_name,
      :home_team_id, :home_team_name, :away_team_id, :away_team_name,
      :venue, :is_neutral, :odds_available, :xg_available, :fetched_utc
    )
    ON CONFLICT(match_id) DO UPDATE SET
      competition_id = excluded.competition_id,
      competition_name = excluded.competition_name,
      competition_country = excluded.competition_country,
      utc_date = excluded.utc_date,
      status = excluded.status,
      stage_name = excluded.stage_name,
      home_team_id = excluded.home_team_id,
      home_team_name = excluded.home_team_name,
      away_team_id = excluded.away_team_id,
      away_team_name = excluded.away_team_name,
      venue = excluded.venue,
      is_neutral = excluded.is_neutral,
      odds_available = excluded.odds_available,
      xg_available = excluded.xg_available,
      fetched_utc = excluded.fetched_utc
  `);
  const now = new Date().toISOString();
  const tx = db.prepare("BEGIN");
  tx.run();
  try {
    for (const r of rows) stmt.run({ ...r, fetched_utc: now });
    db.prepare("COMMIT").run();
  } catch (err) {
    db.prepare("ROLLBACK").run();
    throw err;
  }
  return rows.length;
}

export interface UpcomingRow {
  match_id: string;
  competition_id: string | null;
  competition_name: string | null;
  competition_country: string | null;
  utc_date: string;
  status: string | null;
  stage_name: string | null;
  home_team_id: string | null;
  home_team_name: string | null;
  away_team_id: string | null;
  away_team_name: string | null;
  venue: string | null;
  is_neutral: number | null;
  odds_available: number | null;
  xg_available: number | null;
}

/** Jendela katalog: kickoff di [fromMs, fromMs + hours]. */
export function getUpcomingInWindow(fromMs: number, hours: number, competitionId?: string): UpcomingRow[] {
  const db = getUpcomingDb();
  const toMs = fromMs + hours * 60 * 60 * 1000;
  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();
  const rows = db
    .prepare(`
      SELECT * FROM upcoming_fixtures
      WHERE utc_date >= ? AND utc_date <= ?
        AND (? IS NULL OR competition_id = ?)
      ORDER BY utc_date ASC
    `)
    .all(fromIso, toIso, competitionId ?? null, competitionId ?? null) as UpcomingRow[];
  return rows;
}

/** Baris yang kickoff-nya sudah lewat — kandidat promosi ke dataset utama. */
export function getDueFixtures(nowMs: number = Date.now()): UpcomingRow[] {
  const db = getUpcomingDb();
  return db
    .prepare("SELECT * FROM upcoming_fixtures WHERE utc_date <= ? ORDER BY utc_date ASC")
    .all(new Date(nowMs).toISOString()) as UpcomingRow[];
}

/** Hapus baris yang sudah dipromosikan (atau kadaluarsa). */
export function deleteUpcoming(matchIds: string[]): number {
  if (matchIds.length === 0) return 0;
  const db = getUpcomingDb();
  const stmt = db.prepare("DELETE FROM upcoming_fixtures WHERE match_id = ?");
  let n = 0;
  for (const id of matchIds) n += Number(stmt.run(id).changes);
  return n;
}

/** Bersihkan baris yang sudah lewat jauh tanpa pernah dipromosikan. */
export function deleteStale(olderThanMs: number): number {
  const db = getUpcomingDb();
  return Number(
    db.prepare("DELETE FROM upcoming_fixtures WHERE utc_date < ?").run(new Date(olderThanMs).toISOString()).changes
  );
}

export function countUpcoming(): number {
  const db = getUpcomingDb();
  return (db.prepare("SELECT count(*) AS c FROM upcoming_fixtures").get() as { c: number }).c;
}