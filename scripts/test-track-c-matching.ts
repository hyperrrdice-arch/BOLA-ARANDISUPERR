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

console.log("Total Track C matches:", cMatches.length);

let matchedCount = 0;
let withOddsCount = 0;
let notFound: any[] = [];

// Get all master matches with odds
const masterMatches = masterDb.prepare(`
  SELECT id, div, season, date, home_team, away_team, fthg, ftag, ftr, b365h, b365d, b365a
  FROM matches
  WHERE b365h IS NOT NULL AND b365d IS NOT NULL AND b365a IS NOT NULL
`).all() as any[];

console.log("Total master matches with B365 odds:", masterMatches.length);

// Index master matches by date + norm(home) + norm(away)
const masterIndex = new Map<string, any>();
for (const m of masterMatches) {
  const h = normalizeTeamName(m.home_team).toLowerCase();
  const a = normalizeTeamName(m.away_team).toLowerCase();
  // key: date_home_away
  const key = `${m.date}_${h}_${a}`;
  masterIndex.set(key, m);
  // Also try div_date_home
  masterIndex.set(`${m.div}_${m.date}_${h}`, m);
}

for (const cm of cMatches) {
  const hn = (teamNameStmt.get(cm.home_team_id) as any)?.name || "";
  const an = (teamNameStmt.get(cm.away_team_id) as any)?.name || "";
  const div = COMPETITION_TO_DIV[cm.competition_id] || "UNKNOWN";
  const dateStr = cm.utc_date.slice(0, 10);

  const hNorm = normalizeTeamName(hn).toLowerCase();
  const aNorm = normalizeTeamName(an).toLowerCase();

  const matchKey1 = `${dateStr}_${hNorm}_${aNorm}`;
  let m = masterIndex.get(matchKey1);

  if (!m) {
    // Try matching without date exact match (e.g. ± 1 day because of timezone UTC vs local)
    const prevDate = new Date(new Date(dateStr).getTime() - 86400000).toISOString().slice(0, 10);
    const nextDate = new Date(new Date(dateStr).getTime() + 86400000).toISOString().slice(0, 10);
    m = masterIndex.get(`${prevDate}_${hNorm}_${aNorm}`) || masterIndex.get(`${nextDate}_${hNorm}_${aNorm}`);
  }

  if (!m) {
    // Search master matches on that date or div
    const found = masterMatches.find(mm => {
      const mmH = normalizeTeamName(mm.home_team).toLowerCase();
      const mmA = normalizeTeamName(mm.away_team).toLowerCase();
      const sameDiv = mm.div === div;
      const dateDiff = Math.abs(new Date(mm.date).getTime() - new Date(dateStr).getTime()) <= 86400000 * 2;
      return dateDiff && (mmH.includes(hNorm) || hNorm.includes(mmH) || mmA.includes(aNorm) || aNorm.includes(mmA));
    });
    if (found) m = found;
  }

  if (m) {
    matchedCount++;
    if (m.b365h && m.b365d && m.b365a) {
      withOddsCount++;
    }
  } else {
    notFound.push({ hn, an, div, dateStr, cm_id: cm.match_id });
  }
}

console.log(`Matched: ${matchedCount} / ${cMatches.length}`);
console.log(`With B365 odds: ${withOddsCount} / ${cMatches.length}`);
console.log("Not found samples:", notFound.slice(0, 5));
