import { getTheStatsDb } from "../lib/db/thestats-dataset";

function main() {
  const db = getTheStatsDb();
  const row = db.prepare(`
    SELECT 
      m.match_id,
      m.competition_id,
      m.season,
      m.utc_date,
      m.status,
      m.home_team_id,
      ht.name as home_team,
      m.away_team_id,
      at.name as away_team,
      m.home_score,
      m.away_score
    FROM matches m
    JOIN teams ht ON m.home_team_id = ht.team_id
    JOIN teams at ON m.away_team_id = at.team_id
    WHERE (ht.name LIKE '%Arsenal%' AND at.name LIKE '%Leeds%')
       OR (ht.name LIKE '%Leeds%' AND at.name LIKE '%Arsenal%')
  `).all() as any[];

  console.log("=== Match Details ===");
  console.log(JSON.stringify(row, null, 2));

  if (row.length > 0) {
    const matchId = row[0].match_id;
    const statsLog = db.prepare("SELECT * FROM team_match_logs WHERE match_id = ?").all(matchId);
    console.log("\n=== Team Match Logs in DB ===");
    console.log(JSON.stringify(statsLog, null, 2));
  }
}

main();
