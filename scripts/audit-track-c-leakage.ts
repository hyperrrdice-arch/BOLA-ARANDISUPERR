import { getTheStatsDb } from "../lib/db/thestats-dataset";
import { getPreMatchLogs } from "../lib/db/team-telemetry";

const db = getTheStatsDb();

// Let's inspect team_match_logs sample
const sampleLog = db.prepare("SELECT * FROM team_match_logs LIMIT 5").all();
console.log("sampleLog dates:", sampleLog.map((l: any) => ({ match_id: l.match_id, match_date: l.match_date })));

// Let's test all matches in Track C to see if ANY match T enters getPreMatchLogs!
const cMatches = db.prepare(`
  SELECT match_id, competition_id, utc_date, home_team_id, away_team_id
  FROM matches
  WHERE home_score IS NOT NULL AND away_score IS NOT NULL
`).all() as any[];

let matchTFoundInLogs = 0;
let totalChecked = 0;

for (const m of cMatches) {
  totalChecked++;
  const homeLogs = getPreMatchLogs(m.home_team_id, 6, m.utc_date);
  const awayLogs = getPreMatchLogs(m.away_team_id, 6, m.utc_date);

  for (const l of homeLogs) {
    if (l.match_id === m.match_id) {
      matchTFoundInLogs++;
      console.log(`LEAKAGE DETECTED: homeLogs contains match ${m.match_id}!`);
    }
    // Also check date strictly < m.utc_date
    if (new Date(l.match_date).getTime() >= new Date(m.utc_date).getTime()) {
      console.log(`DATE LEAKAGE DETECTED: log date ${l.match_date} >= match date ${m.utc_date}`);
    }
  }

  for (const l of awayLogs) {
    if (l.match_id === m.match_id) {
      matchTFoundInLogs++;
      console.log(`LEAKAGE DETECTED: awayLogs contains match ${m.match_id}!`);
    }
    if (new Date(l.match_date).getTime() >= new Date(m.utc_date).getTime()) {
      console.log(`DATE LEAKAGE DETECTED: log date ${l.match_date} >= match date ${m.utc_date}`);
    }
  }
}

console.log(`Checked ${totalChecked} matches.`);
console.log(`Match T found in logs: ${matchTFoundInLogs}`);
