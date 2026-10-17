import { getTheStatsDb } from "../lib/db/thestats-dataset";
import { getMasterDb } from "../lib/db/sqlite-master";
import { normalizeTeamName } from "../lib/quant/team-normalizer";

const theStatsDb = getTheStatsDb();
const masterDb = getMasterDb();

const cMatches = theStatsDb.prepare(`
  SELECT match_id, competition_id, season, utc_date, home_team_id, away_team_id, home_score, away_score
  FROM matches
  WHERE home_score IS NOT NULL AND away_score IS NOT NULL
  ORDER BY utc_date ASC
`).all() as any[];

const teamNameStmt = theStatsDb.prepare("SELECT name FROM teams WHERE team_id = ?");

const compCounts: Record<string, number> = {};
for (const m of cMatches) {
  compCounts[m.competition_id] = (compCounts[m.competition_id] || 0) + 1;
}
console.log("Track C competition distribution:", compCounts);

// Check if UCL matches have odds in masterDb
const uclInMaster = masterDb.prepare("SELECT count(*) as count FROM matches WHERE div = 'UCL'").get() as any;
console.log("UCL matches in masterDb:", uclInMaster.count);

// Check dates range of Track C
const minDate = cMatches[0].utc_date;
const maxDate = cMatches[cMatches.length - 1].utc_date;
console.log("Track C date range:", minDate, "to", maxDate);

// Check masterDb date range for season 2026/2027
const masterRange = masterDb.prepare("SELECT min(date) as minD, max(date) as maxD, count(*) as count FROM matches WHERE season = '2026/2027'").get() as any;
console.log("MasterDb 2026/2027 date range:", masterRange);
