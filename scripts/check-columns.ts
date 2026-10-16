import { getTheStatsDb } from "../lib/db/thestats-dataset";

function main() {
  const db = getTheStatsDb();
  const cols = db.prepare("PRAGMA table_info(team_match_logs)").all() as any[];
  console.log("Current columns in team_match_logs:");
  console.log(cols.map(c => `${c.name} (${c.type})`).join(", "));
}

main();
