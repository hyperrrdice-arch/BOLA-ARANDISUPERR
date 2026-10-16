import { getTheStatsDb, getTheStatsDbPath } from "../lib/db/thestats-dataset";
import fs from "node:fs";

/**
 * Non-Destructive Safe Migration Script
 * Sesuai Acceptance Criteria DATABASE_REVIEW_PREMIER_LEAGUE.md:
 * - Tidak ada DROP TABLE
 * - Backup SQLite otomatis sebelum migrasi (WAL checkpoint TRUNCATE)
 * - Menjaga baris data yang ada (Zero Data Loss)
 * - Verifikasi pragma quick_check & foreign_key_check
 */
function main() {
  console.log("================================================================================");
  console.log("🛡️ [NON-DESTRUCTIVE SAFE SCHEMA MIGRATION] thestats_dataset.db");
  console.log("================================================================================");

  const db = getTheStatsDb();
  const dbPath = getTheStatsDbPath();

  // 1. Checkpoint WAL & Buat Backup Sebelum Migrasi
  console.log("[Langkah 1/4] Melakukan WAL checkpoint & backup database...");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  const backupPath = `${dbPath}.bak_${Date.now()}`;
  fs.copyFileSync(dbPath, backupPath);
  console.log(`✅ Backup tersimpan aman di: ${backupPath}`);

  // 2. Hitung record sebelum migrasi
  const countBeforeSquads = (db.prepare("SELECT count(*) as c FROM team_squads").get() as any)?.c || 0;
  const countBeforeLogs = (db.prepare("SELECT count(*) as c FROM team_match_logs").get() as any)?.c || 0;
  console.log(`- Record Skuad Sebelum: ${countBeforeSquads}`);
  console.log(`- Record Logs Sebelum: ${countBeforeLogs}`);

  // 3. Pastikan tabel inti ada tanpa DROP
  console.log("\n[Langkah 2/4] Memastikan tabel dan indeks ada...");
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      team_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      short_name TEXT,
      country TEXT DEFAULT 'England',
      stadium TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (home_team_id) REFERENCES teams(team_id),
      FOREIGN KEY (away_team_id) REFERENCES teams(team_id)
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
      xg_for REAL,
      xg_against REAL,
      npxg_for REAL,
      npxg_against REAL,
      first_half_xg_for REAL,
      second_half_xg_for REAL,
      first_half_xg_against REAL,
      second_half_xg_against REAL,
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
      big_chances_for INTEGER,
      big_chances_against INTEGER,
      big_chances_missed_for INTEGER,
      big_chances_missed_against INTEGER,
      touches_in_penalty_area_for INTEGER,
      touches_in_penalty_area_against INTEGER,
      offsides_for INTEGER,
      offsides_against INTEGER,
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
      saves_for INTEGER,
      saves_against INTEGER,
      goal_kicks_for INTEGER,
      goal_kicks_against INTEGER,
      goals_prevented_for REAL,
      goals_prevented_against REAL,
      high_claims_for INTEGER,
      high_claims_against INTEGER,
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
  `);

  // 4. Verifikasi Integritas dan Record
  console.log("\n[Langkah 3/4] Memverifikasi integritas SQLite...");
  const quickCheck = (db.prepare("PRAGMA quick_check;").get() as any)?.quick_check;
  const fkErrors = db.prepare("PRAGMA foreign_key_check;").all();
  console.log(`- PRAGMA quick_check: ${quickCheck}`);
  console.log(`- PRAGMA foreign_key_check: ${fkErrors.length} pelanggaran`);

  const countAfterSquads = (db.prepare("SELECT count(*) as c FROM team_squads").get() as any)?.c || 0;
  const countAfterLogs = (db.prepare("SELECT count(*) as c FROM team_match_logs").get() as any)?.c || 0;
  console.log(`- Record Skuad Sesudah: ${countAfterSquads}`);
  console.log(`- Record Logs Sesudah: ${countAfterLogs}`);

  if (countBeforeSquads !== countAfterSquads || countBeforeLogs !== countAfterLogs) {
    console.error("❌ PERINGATAN: Terjadi perubahan jumlah baris selama migrasi!");
  } else {
    console.log("✅ Zero Data Loss: Semua baris data utuh terjaga!");
  }

  console.log("\n[Langkah 4/4] Migrasi non-destruktif selesai dengan sukses!");
}

main();
