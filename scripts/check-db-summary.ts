import { getTheStatsDb, getDatabaseMetrics } from "../lib/db/thestats-dataset";

function main() {
  const db = getTheStatsDb();
  console.log("=== Database Metrics ===");
  console.log(getDatabaseMetrics());

  console.log("\n=== Daftar Tim & Jumlah Skuad ===");
  const list = db.prepare(`
    SELECT teams.team_id, teams.name, count(team_squads.player_id) as squad_count
    FROM teams
    LEFT JOIN team_squads ON teams.team_id = team_squads.team_id
    GROUP BY teams.team_id
    ORDER BY squad_count DESC, teams.name ASC
  `).all();
  console.table(list);
}

main();
