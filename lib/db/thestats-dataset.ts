import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

export interface TeamRecord {
  team_id: string;
  name: string;
  short_name?: string | null;
  country?: string | null;
  stadium?: string | null;
  updated_at?: string;
}

export interface SquadPlayerRecord {
  player_id: string;
  team_id: string;
  name: string;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null; // 'G' | 'D' | 'M' | 'F'
  jersey_number?: number | null;
  age?: number | null;
  height_cm?: number | null;
  nationality?: string | null;
  market_value?: number | null;
  preferred_foot?: string | null;
  injury_status?: string | null; // e.g. "FIT", "INJURED: Hamstring", "SUSPENDED"
  is_active?: number; // 1 or 0
  updated_at?: string;
}

export interface MatchMetaRecord {
  match_id: string;
  competition_id: string;
  season: string;
  utc_date: string;
  status: string;
  home_team_id: string;
  away_team_id: string;
  home_score?: number | null;
  away_score?: number | null;
  referee_name?: string | null;
  updated_at?: string;
}

export interface TeamMatchLogRecord {
  log_id: string; // `${match_id}_${team_id}`
  match_id: string;
  team_id: string;
  opponent_id: string;
  venue: "HOME" | "AWAY";
  match_date: string;
  season: string;
  result: "W" | "D" | "L";
  goals_for: number;
  goals_against: number;

  // 1. Kualitas Peluang & xG
  xg_for?: number | null;
  xg_against?: number | null;
  npxg_for?: number | null;
  npxg_against?: number | null;
  first_half_xg_for?: number | null;
  second_half_xg_for?: number | null;
  first_half_xg_against?: number | null;
  second_half_xg_against?: number | null;

  // 2. Tembakan Granular
  shots_for?: number | null;
  shots_against?: number | null;
  shots_on_target_for?: number | null;
  shots_on_target_against?: number | null;
  shots_off_target_for?: number | null;
  shots_off_target_against?: number | null;
  blocked_shots_for?: number | null;
  blocked_shots_against?: number | null;
  shots_inside_box_for?: number | null;
  shots_inside_box_against?: number | null;
  shots_outside_box_for?: number | null;
  shots_outside_box_against?: number | null;
  hit_woodwork_for?: number | null;
  hit_woodwork_against?: number | null;

  // 3. Peluang Emas & Penetrasi Kotak Penalti
  big_chances_for?: number | null;
  big_chances_against?: number | null;
  big_chances_missed_for?: number | null;
  big_chances_missed_against?: number | null;
  touches_in_penalty_area_for?: number | null;
  touches_in_penalty_area_against?: number | null;
  offsides_for?: number | null;
  offsides_against?: number | null;

  // 4. Passing & Distribusi Bola
  possession_pct?: number | null;
  first_half_possession?: number | null;
  second_half_possession?: number | null;
  passes_total_for?: number | null;
  passes_total_against?: number | null;
  passes_accurate_for?: number | null;
  passes_accurate_against?: number | null;
  pass_accuracy_pct_for?: number | null;
  pass_accuracy_pct_against?: number | null;
  accurate_crosses_for?: number | null;
  accurate_crosses_against?: number | null;
  accurate_long_balls_for?: number | null;
  accurate_long_balls_against?: number | null;
  final_third_entries_for?: number | null;
  final_third_entries_against?: number | null;
  throw_ins_for?: number | null;
  throw_ins_against?: number | null;

  // 5. Duels & Fisik
  duels_won_pct_for?: number | null;
  duels_won_pct_against?: number | null;
  ground_duels_pct_for?: number | null;
  ground_duels_pct_against?: number | null;
  aerial_duels_pct_for?: number | null; // Kunci pasar Headed Goal
  aerial_duels_pct_against?: number | null;
  dispossessed_for?: number | null;
  dispossessed_against?: number | null;
  dribbles_pct_for?: number | null;
  dribbles_pct_against?: number | null;

  // 6. Defending & Pressing
  tackles_for?: number | null;
  tackles_against?: number | null;
  tackles_won_pct_for?: number | null;
  tackles_won_pct_against?: number | null;
  interceptions_for?: number | null;
  interceptions_against?: number | null;
  clearances_for?: number | null;
  clearances_against?: number | null;
  ball_recoveries_for?: number | null;
  ball_recoveries_against?: number | null;
  corners_for?: number | null;
  corners_against?: number | null;
  fouls_committed?: number | null;
  yellow_cards?: number | null;
  red_cards?: number | null;

  // 7. Goalkeeping
  saves_for?: number | null;
  saves_against?: number | null;
  goal_kicks_for?: number | null;
  goal_kicks_against?: number | null;
  goals_prevented_for?: number | null;
  goals_prevented_against?: number | null;
  high_claims_for?: number | null;
  high_claims_against?: number | null;

  // 8. Taktis & Raw Payload
  formation?: string | null;
  starting_xi_ids?: string | null; // JSON string array
  substitutes_ids?: string | null; // JSON string array
  raw_stats_json?: string | null; // 100% Raw stats payload backup
  created_at?: string;
}

let dbInstance: DatabaseSync | null = null;

export function getTheStatsDbPath(): string {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return path.join(dataDir, "thestats_dataset.db");
}

export function getTheStatsDb(): DatabaseSync {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = getTheStatsDbPath();
  const db = new DatabaseSync(dbPath);

  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  // Inisialisasi Skema Tabel Lengkap (ML Feature Matrix Ready)
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      team_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      short_name TEXT,
      country TEXT,
      stadium TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS team_squads (
      player_id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      name TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      position TEXT,
      jersey_number INTEGER,
      age INTEGER,
      height_cm REAL,
      nationality TEXT,
      market_value REAL,
      preferred_foot TEXT,
      injury_status TEXT DEFAULT 'FIT',
      is_active INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(team_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS matches (
      match_id TEXT PRIMARY KEY,
      competition_id TEXT NOT NULL,
      season TEXT NOT NULL,
      utc_date TEXT NOT NULL,
      status TEXT NOT NULL,
      home_team_id TEXT NOT NULL,
      away_team_id TEXT NOT NULL,
      home_score INTEGER,
      away_score INTEGER,
      referee_name TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (home_team_id) REFERENCES teams(team_id),
      FOREIGN KEY (away_team_id) REFERENCES teams(team_id)
    );

    CREATE TABLE IF NOT EXISTS team_match_logs (
      log_id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL,
      team_id TEXT NOT NULL,
      opponent_id TEXT NOT NULL,
      venue TEXT NOT NULL,
      match_date TEXT NOT NULL,
      season TEXT NOT NULL,
      result TEXT NOT NULL,
      goals_for INTEGER NOT NULL,
      goals_against INTEGER NOT NULL,

      -- Kualitas Peluang & xG
      xg_for REAL,
      xg_against REAL,
      npxg_for REAL,
      npxg_against REAL,
      first_half_xg_for REAL,
      second_half_xg_for REAL,
      first_half_xg_against REAL,
      second_half_xg_against REAL,

      -- Tembakan Granular
      shots_for INTEGER,
      shots_against INTEGER,
      shots_on_target_for INTEGER,
      shots_on_target_against INTEGER,
      shots_off_target_for INTEGER,
      shots_off_target_against INTEGER,
      blocked_shots_for INTEGER,
      blocked_shots_against INTEGER,
      shots_inside_box_for INTEGER,
      shots_inside_box_against INTEGER,
      shots_outside_box_for INTEGER,
      shots_outside_box_against INTEGER,
      hit_woodwork_for INTEGER,
      hit_woodwork_against INTEGER,

      -- Peluang Emas & Penetrasi Kotak Penalti
      big_chances_for INTEGER,
      big_chances_against INTEGER,
      big_chances_missed_for INTEGER,
      big_chances_missed_against INTEGER,
      touches_in_penalty_area_for INTEGER,
      touches_in_penalty_area_against INTEGER,
      offsides_for INTEGER,
      offsides_against INTEGER,

      -- Passing & Distribusi
      possession_pct REAL,
      first_half_possession REAL,
      second_half_possession REAL,
      passes_total_for INTEGER,
      passes_total_against INTEGER,
      passes_accurate_for INTEGER,
      passes_accurate_against INTEGER,
      pass_accuracy_pct_for REAL,
      pass_accuracy_pct_against REAL,
      accurate_crosses_for INTEGER,
      accurate_crosses_against INTEGER,
      accurate_long_balls_for INTEGER,
      accurate_long_balls_against INTEGER,
      final_third_entries_for INTEGER,
      final_third_entries_against INTEGER,
      throw_ins_for INTEGER,
      throw_ins_against INTEGER,

      -- Duels & Fisik
      duels_won_pct_for REAL,
      duels_won_pct_against REAL,
      ground_duels_pct_for REAL,
      ground_duels_pct_against REAL,
      aerial_duels_pct_for REAL,
      aerial_duels_pct_against REAL,
      dispossessed_for INTEGER,
      dispossessed_against INTEGER,
      dribbles_pct_for REAL,
      dribbles_pct_against REAL,

      -- Defending & Pressing
      tackles_for INTEGER,
      tackles_against INTEGER,
      tackles_won_pct_for REAL,
      tackles_won_pct_against REAL,
      interceptions_for INTEGER,
      interceptions_against INTEGER,
      clearances_for INTEGER,
      clearances_against INTEGER,
      ball_recoveries_for INTEGER,
      ball_recoveries_against INTEGER,
      corners_for INTEGER,
      corners_against INTEGER,
      fouls_committed INTEGER,
      yellow_cards INTEGER,
      red_cards INTEGER,

      -- Goalkeeping
      saves_for INTEGER,
      saves_against INTEGER,
      goal_kicks_for INTEGER,
      goal_kicks_against INTEGER,
      goals_prevented_for REAL,
      goals_prevented_against REAL,
      high_claims_for INTEGER,
      high_claims_against INTEGER,

      -- Taktis & Raw
      formation TEXT,
      starting_xi_ids TEXT,
      substitutes_ids TEXT,
      raw_stats_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (match_id) REFERENCES matches(match_id) ON DELETE CASCADE,
      FOREIGN KEY (team_id) REFERENCES teams(team_id),
      FOREIGN KEY (opponent_id) REFERENCES teams(team_id)
    );

    CREATE INDEX IF NOT EXISTS idx_tml_team_date ON team_match_logs(team_id, match_date DESC);
    CREATE INDEX IF NOT EXISTS idx_tml_opponent ON team_match_logs(opponent_id);
    CREATE INDEX IF NOT EXISTS idx_tml_season ON team_match_logs(season);
    CREATE INDEX IF NOT EXISTS idx_squad_team ON team_squads(team_id);
    CREATE INDEX IF NOT EXISTS idx_matches_comp_season ON matches(competition_id, season);
    CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(utc_date DESC);
  `);

  dbInstance = db;
  return dbInstance;
}

// ============================================================================
// REPOSITORIES & DATA ACCESS METHODS
// ============================================================================

export function upsertTeam(team: TeamRecord): void {
  const db = getTheStatsDb();
  const stmt = db.prepare(`
    INSERT INTO teams (team_id, name, short_name, country, stadium, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(team_id) DO UPDATE SET
      name = excluded.name,
      short_name = excluded.short_name,
      country = excluded.country,
      stadium = excluded.stadium,
      updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run(team.team_id, team.name, team.short_name || null, team.country || null, team.stadium || null);
}

export function upsertSquadPlayer(player: SquadPlayerRecord): void {
  const db = getTheStatsDb();
  const stmt = db.prepare(`
    INSERT INTO team_squads (
      player_id, team_id, name, first_name, last_name, position,
      jersey_number, age, height_cm, nationality, market_value, preferred_foot,
      injury_status, is_active, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(player_id) DO UPDATE SET
      team_id = excluded.team_id,
      name = excluded.name,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      position = excluded.position,
      jersey_number = excluded.jersey_number,
      age = excluded.age,
      height_cm = excluded.height_cm,
      nationality = excluded.nationality,
      market_value = excluded.market_value,
      preferred_foot = excluded.preferred_foot,
      injury_status = excluded.injury_status,
      is_active = excluded.is_active,
      updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run(
    player.player_id,
    player.team_id,
    player.name,
    player.first_name || null,
    player.last_name || null,
    player.position || null,
    player.jersey_number ?? null,
    player.age ?? null,
    player.height_cm ?? null,
    player.nationality || null,
    player.market_value ?? null,
    player.preferred_foot || null,
    player.injury_status || "FIT",
    player.is_active ?? 1
  );
}

export function upsertMatch(match: MatchMetaRecord): void {
  const db = getTheStatsDb();
  const stmt = db.prepare(`
    INSERT INTO matches (
      match_id, competition_id, season, utc_date, status,
      home_team_id, away_team_id, home_score, away_score, referee_name, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(match_id) DO UPDATE SET
      status = excluded.status,
      home_score = excluded.home_score,
      away_score = excluded.away_score,
      referee_name = excluded.referee_name,
      updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run(
    match.match_id,
    match.competition_id,
    match.season,
    match.utc_date,
    match.status,
    match.home_team_id,
    match.away_team_id,
    match.home_score ?? null,
    match.away_score ?? null,
    match.referee_name || null
  );
}

export function upsertTeamMatchLog(log: TeamMatchLogRecord): void {
  const db = getTheStatsDb();

  const keys = Object.keys(log);
  const placeholders = keys.map(() => "?").join(", ");
  const updateClauses = keys
    .filter((k) => k !== "log_id")
    .map((k) => `${k} = excluded.${k}`)
    .join(", ");

  const sql = `
    INSERT INTO team_match_logs (${keys.join(", ")})
    VALUES (${placeholders})
    ON CONFLICT(log_id) DO UPDATE SET ${updateClauses}
  `;

  const stmt = db.prepare(sql);
  const values = keys.map((k) => (log as any)[k] ?? null);
  stmt.run(...values);
}

export function getTeamRecentLogs(teamId: string, limit: number = 6): TeamMatchLogRecord[] {
  const db = getTheStatsDb();
  const stmt = db.prepare(`
    SELECT * FROM team_match_logs
    WHERE team_id = ?
    ORDER BY match_date DESC
    LIMIT ?
  `);
  return stmt.all(teamId, limit) as unknown as TeamMatchLogRecord[];
}

export function getTeamSquad(teamId: string): SquadPlayerRecord[] {
  const db = getTheStatsDb();
  const stmt = db.prepare(`
    SELECT * FROM team_squads
    WHERE team_id = ? AND is_active = 1
    ORDER BY 
      CASE position
        WHEN 'G' THEN 1
        WHEN 'D' THEN 2
        WHEN 'M' THEN 3
        WHEN 'F' THEN 4
        ELSE 5
      END,
      jersey_number ASC
  `);
  return stmt.all(teamId) as unknown as SquadPlayerRecord[];
}

export function getH2HLogs(teamAId: string, teamBId: string, limit: number = 6): TeamMatchLogRecord[] {
  const db = getTheStatsDb();
  const stmt = db.prepare(`
    SELECT * FROM team_match_logs
    WHERE team_id = ? AND opponent_id = ?
    ORDER BY match_date DESC
    LIMIT ?
  `);
  return stmt.all(teamAId, teamBId, limit) as unknown as TeamMatchLogRecord[];
}

export function getDatabaseMetrics() {
  const db = getTheStatsDb();
  const teamsCount = (db.prepare("SELECT count(*) as c FROM teams").get() as any)?.c || 0;
  const squadsCount = (db.prepare("SELECT count(*) as c FROM team_squads").get() as any)?.c || 0;
  const matchesCount = (db.prepare("SELECT count(*) as c FROM matches").get() as any)?.c || 0;
  const logsCount = (db.prepare("SELECT count(*) as c FROM team_match_logs").get() as any)?.c || 0;

  return {
    teamsCount,
    squadsCount,
    matchesCount,
    logsCount,
  };
}

// ============================================================================
// CATATAN: tabel `analysis_runs` (cache + riwayat analisis) PINDAH ke
// `data/analysis_snapshots.db` pada DB SNAPSHOT T2b. Riwayat analisis tidak
// boleh hidup di DB dataset yang boleh di-refresh/DELETE — lihat
// `lib/db/analysis-snapshot.ts` + `scripts/migrate-analysis-runs.ts`.
// ============================================================================

/**
 * Helper internal untuk me-resolve ID tim baik dari team_id maupun nama tim
 */export function resolveLocalTeamId(idOrName: string): string {
  const db = getTheStatsDb();
  const direct = db.prepare("SELECT team_id FROM teams WHERE team_id = ?").get(idOrName) as { team_id: string } | undefined;
  if (direct) return direct.team_id;

  const byName = db.prepare(`
    SELECT team_id FROM teams 
    WHERE LOWER(name) = LOWER(?) 
       OR LOWER(short_name) = LOWER(?) 
       OR LOWER(name) LIKE LOWER(?)
    LIMIT 1
  `).get(idOrName, idOrName, `%${idOrName}%`) as { team_id: string } | undefined;

  return byName ? byName.team_id : idOrName;
}

/**
 * Mengambil H2H lokal dari thestats_dataset.db (Tier-1 Offline SQLite)
 * Memformat output sesuai RawMatchSchema / stats-validator.ts
 */
export function getLocalH2HMatches(teamA: string, teamB: string, limit: number = 6, beforeDate?: string) {
  const db = getTheStatsDb();
  const teamAId = resolveLocalTeamId(teamA);
  const teamBId = resolveLocalTeamId(teamB);
  // HANYA match yang benar-benar selesai: baris `scheduled` (fixture 30 hari
  // ke depan) akan terbaca sebagai skor 0-0 palsu kalau lolos. Cutoff tanggal
  // opsional = anti-leakage waktu saat analisis match lama diulang.
  const cutoff = beforeDate ? beforeDate.slice(0, 10) : null;

  const rows = db.prepare(`
    SELECT m.match_id as id, m.utc_date, m.status, 
           m.home_team_id, ht.name as home_name,
           m.away_team_id, at.name as away_name,
           m.home_score, m.away_score
    FROM matches m
    JOIN teams ht ON m.home_team_id = ht.team_id
    JOIN teams at ON m.away_team_id = at.team_id
    WHERE m.status = 'finished'
      AND m.home_score IS NOT NULL
      AND m.away_score IS NOT NULL
      AND ((m.home_team_id = ? AND m.away_team_id = ?)
        OR (m.home_team_id = ? AND m.away_team_id = ?))
      AND (? IS NULL OR m.utc_date < ?)
    ORDER BY m.utc_date DESC LIMIT ?
  `).all(teamAId, teamBId, teamBId, teamAId, cutoff, cutoff, limit) as any[];

  return rows.map((m) => ({
    id: m.id,
    utc_date: m.utc_date,
    status: m.status,
    home_team: { id: m.home_team_id, name: m.home_name },
    away_team: { id: m.away_team_id, name: m.away_name },
    score: {
      regulation: { home: m.home_score ?? 0, away: m.away_score ?? 0 },
      home: m.home_score ?? 0,
      away: m.away_score ?? 0,
    },
  }));
}

/**
 * Mengambil 6 Match Form Lokal dari thestats_dataset.db (Tier-1 Offline SQLite)
 */
export function getLocalRecentMatches(team: string, limit: number = 6, beforeDate?: string) {
  const db = getTheStatsDb();
  const teamId = resolveLocalTeamId(team);
  // Sama seperti H2H: hanya match selesai + skor terisi, dan opsional cutoff
  // tanggal. Tanpa ini, form akan menghitung fixture yang belum main.
  const cutoff = beforeDate ? beforeDate.slice(0, 10) : null;

  const rows = db.prepare(`
    SELECT m.match_id as id, m.utc_date, m.status, 
           m.home_team_id, ht.name as home_name,
           m.away_team_id, at.name as away_name,
           m.home_score, m.away_score
    FROM matches m
    JOIN teams ht ON m.home_team_id = ht.team_id
    JOIN teams at ON m.away_team_id = at.team_id
    WHERE m.status = 'finished'
      AND m.home_score IS NOT NULL
      AND m.away_score IS NOT NULL
      AND (m.home_team_id = ? OR m.away_team_id = ?)
      AND (? IS NULL OR m.utc_date < ?)
    ORDER BY m.utc_date DESC LIMIT ?
  `).all(teamId, teamId, cutoff, cutoff, limit) as any[];

  return rows.map((m) => ({
    id: m.id,
    utc_date: m.utc_date,
    status: m.status,
    home_team: { id: m.home_team_id, name: m.home_name },
    away_team: { id: m.away_team_id, name: m.away_name },
    score: {
      regulation: { home: m.home_score ?? 0, away: m.away_score ?? 0 },
      home: m.home_score ?? 0,
      away: m.away_score ?? 0,
    },
  }));
}

/**
 * Mengambil Laporan Cedera dari SQLite team_squads (Tier-1 Offline SQLite)
 */
export function getLocalSquadInjuries(team: string) {
  const db = getTheStatsDb();
  const teamId = resolveLocalTeamId(team);

  const rows = db.prepare(`
    SELECT name, injury_status 
    FROM team_squads 
    WHERE team_id = ? 
      AND injury_status IS NOT NULL 
      AND injury_status != 'FIT'
      AND injury_status NOT LIKE 'UNKNOWN%'
  `).all(teamId) as { name: string; injury_status: string }[];

  return rows.map((r) => ({
    player_name: r.name,
    reason: r.injury_status,
  }));
}

