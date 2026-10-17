import { getTheStatsDb } from "../lib/db/thestats-dataset";

const db = getTheStatsDb();

const m = db.prepare("SELECT match_id, utc_date, home_team_id, away_team_id FROM matches WHERE match_id = 'mt_206118866'").get() as any;
console.log("Match row:", m);

const logs = db.prepare("SELECT log_id, match_id, team_id, match_date FROM team_match_logs WHERE match_id = 'mt_206118866'").all();
console.log("Logs for this match:", logs);

console.log("Comparison:");
console.log("match_date:", logs[0].match_date);
console.log("utc_date:", m.utc_date);
console.log("Is match_date < utc_date?", (logs[0] as any).match_date < m.utc_date);
