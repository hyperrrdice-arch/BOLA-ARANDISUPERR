import { getTheStatsDb } from "../lib/db/thestats-dataset";
import { getMasterDb } from "../lib/db/sqlite-master";
import { normalizeTeamName } from "../lib/quant/team-normalizer";

const theStatsDb = getTheStatsDb();
const masterDb = getMasterDb();

const COMPETITION_TO_DIV: Record<string, string> = {
  comp_3039: "E0",
  comp_8814: "SP1",
  comp_5840: "I1",
  comp_4643: "D1",
  comp_0256: "F1",
  comp_3809: "N1",
  comp_3498: "UCL",
};

const cMatches = theStatsDb.prepare(`
  SELECT match_id, competition_id, season, utc_date, home_team_id, away_team_id, home_score, away_score
  FROM matches
  WHERE home_score IS NOT NULL AND away_score IS NOT NULL
  ORDER BY utc_date ASC
`).all() as any[];

const teamNameStmt = theStatsDb.prepare("SELECT name FROM teams WHERE team_id = ?");

const master2627 = masterDb.prepare(`
  SELECT id, div, season, date, home_team, away_team, fthg, ftag, ftr, b365h, b365d, b365a
  FROM matches
  WHERE season = '2026/2027' AND b365h IS NOT NULL
`).all() as any[];

console.log("Master 26/27 matches with odds:", master2627.length);

// Let's test matching for each non-UCL match
const nonUcl = cMatches.filter(m => m.competition_id !== "comp_3498");
console.log("Non-UCL Track C matches:", nonUcl.length);

let matched = 0;
const unmatched: any[] = [];

for (const cm of nonUcl) {
  const hn = (teamNameStmt.get(cm.home_team_id) as any)?.name;
  const an = (teamNameStmt.get(cm.away_team_id) as any)?.name;
  const div = COMPETITION_TO_DIV[cm.competition_id];
  const d = cm.utc_date.slice(0, 10);

  // Match in master2627 where div is same, date is within 3 days, and home/away team matches
  const found = master2627.find(mm => {
    if (mm.div !== div) return false;
    const dateDiff = Math.abs(new Date(mm.date).getTime() - new Date(d).getTime());
    if (dateDiff > 86400000 * 3) return false;

    const mmH = normalizeTeamName(mm.home_team).toLowerCase();
    const mmA = normalizeTeamName(mm.away_team).toLowerCase();
    const cnH = normalizeTeamName(hn).toLowerCase();
    const cnA = normalizeTeamName(an).toLowerCase();

    // Check equality or substring
    const hMatch = mmH === cnH || mmH.includes(cnH) || cnH.includes(mmH);
    const aMatch = mmA === cnA || mmA.includes(cnA) || cnA.includes(mmA);
    return hMatch && aMatch;
  });

  if (found) {
    matched++;
  } else {
    unmatched.push({ hn, an, div, d, id: cm.match_id });
  }
}

console.log(`Matched non-UCL: ${matched} / ${nonUcl.length}`);
console.log("Unmatched non-UCL:", unmatched);
