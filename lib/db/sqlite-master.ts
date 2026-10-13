import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

export interface MasterMatchRow {
  id?: number;
  div: string;
  season: string;
  date: string; // ISO format YYYY-MM-DD
  time?: string | null;
  home_team: string;
  away_team: string;
  fthg: number;
  ftag: number;
  ftr: "H" | "D" | "A";
  hthg?: number | null;
  htag?: number | null;
  htr?: string | null;
  referee?: string | null;
  hs?: number | null;
  as_shots?: number | null;
  hst?: number | null;
  ast?: number | null;
  psh?: number | null;
  psd?: number | null;
  psa?: number | null;
  b365h?: number | null;
  b365d?: number | null;
  b365a?: number | null;
  max_over_2_5?: number | null;
  max_under_2_5?: number | null;
  created_at?: string;
}

let dbInstance: DatabaseSync | null = null;

export function getMasterDbPath(): string {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return path.join(dataDir, "football_master.db");
}

export function getMasterDb(): DatabaseSync {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = getMasterDbPath();
  const db = new DatabaseSync(dbPath);

  // Optimasi performa SQLite (WAL mode, normal synchronous)
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  // Inisialisasi Skema Master
  db.exec(`
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      div TEXT NOT NULL,
      season TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT,
      home_team TEXT NOT NULL,
      away_team TEXT NOT NULL,
      fthg INTEGER NOT NULL,
      ftag INTEGER NOT NULL,
      ftr TEXT NOT NULL,
      hthg INTEGER,
      htag INTEGER,
      htr TEXT,
      referee TEXT,
      hs INTEGER,
      as_shots INTEGER,
      hst INTEGER,
      ast INTEGER,
      psh REAL,
      psd REAL,
      psa REAL,
      b365h REAL,
      b365d REAL,
      b365a REAL,
      max_over_2_5 REAL,
      max_under_2_5 REAL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(div, date, home_team, away_team)
    );

    CREATE INDEX IF NOT EXISTS idx_matches_div_date ON matches(div, date);
    CREATE INDEX IF NOT EXISTS idx_matches_home_away ON matches(home_team, away_team);
    CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(date);
    CREATE INDEX IF NOT EXISTS idx_matches_season ON matches(season);
  `);

  dbInstance = db;
  return dbInstance;
}

export function closeMasterDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * Menyisipkan satu record match secara idempoten (INSERT OR IGNORE)
 */
export function insertMatchRecord(db: DatabaseSync, m: MasterMatchRow): boolean {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO matches (
      div, season, date, time, home_team, away_team,
      fthg, ftag, ftr, hthg, htag, htr,
      referee, hs, as_shots, hst, ast,
      psh, psd, psa, b365h, b365d, b365a,
      max_over_2_5, max_under_2_5
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?
    )
  `);

  const result = stmt.run(
    m.div,
    m.season,
    m.date,
    m.time ?? null,
    m.home_team,
    m.away_team,
    m.fthg,
    m.ftag,
    m.ftr,
    m.hthg ?? null,
    m.htag ?? null,
    m.htr ?? null,
    m.referee ?? null,
    m.hs ?? null,
    m.as_shots ?? null,
    m.hst ?? null,
    m.ast ?? null,
    m.psh ?? null,
    m.psd ?? null,
    m.psa ?? null,
    m.b365h ?? null,
    m.b365d ?? null,
    m.b365a ?? null,
    m.max_over_2_5 ?? null,
    m.max_under_2_5 ?? null
  );

  return Number(result.changes) > 0;
}

/**
 * Menyisipkan banyak record match sekaligus dalam satu transaksi ACID
 */
export function insertBatchMatches(db: DatabaseSync, matches: MasterMatchRow[]): number {
  if (matches.length === 0) return 0;

  db.exec("BEGIN TRANSACTION;");
  let inserted = 0;
  try {
    for (const m of matches) {
      if (insertMatchRecord(db, m)) {
        inserted++;
      }
    }
    db.exec("COMMIT;");
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }
  return inserted;
}

/**
 * Mengambil histori laga suatu divisi sebelum batas waktu tertentu (Strict Anti-Lookahead)
 */
export function getHistoricalMatchesByDiv(
  db: DatabaseSync,
  div: string,
  maxDate?: string,
  limit?: number
): MasterMatchRow[] {
  let query = "SELECT * FROM matches WHERE div = ?";
  const params: (string | number)[] = [div];

  if (maxDate) {
    query += " AND date < ?";
    params.push(maxDate);
  }

  query += " ORDER BY date ASC";

  if (limit) {
    query += " LIMIT ?";
    params.push(limit);
  }

  const stmt = db.prepare(query);
  return stmt.all(...params) as unknown as MasterMatchRow[];
}

/**
 * Mengambil ringkasan data di dalam database SQLite Master
 */
export function getDatabaseSummary(db: DatabaseSync): {
  totalMatches: number;
  divStats: { div: string; count: number; earliestDate: string; latestDate: string }[];
} {
  const totalRow = db.prepare("SELECT COUNT(*) as count FROM matches").get() as { count: number };
  const divStats = db.prepare(`
    SELECT 
      div, 
      COUNT(*) as count, 
      MIN(date) as earliestDate, 
      MAX(date) as latestDate 
    FROM matches 
    GROUP BY div 
    ORDER BY count DESC
  `).all() as unknown as { div: string; count: number; earliestDate: string; latestDate: string }[];

  return {
    totalMatches: totalRow?.count || 0,
    divStats,
  };
}
