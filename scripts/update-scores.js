const { getTheStatsDb } = require("../lib/db/thestats-dataset");
const API_BASE = "https://api.thestatsapi.com/api";
const apiKey = process.env.STATS_API_KEY;

async function main() {
  const db = getTheStatsDb();
  console.log("Fetching matches list for scores...");
  const res = await fetch(`${API_BASE}/football/matches?competition_id=comp_3039&status=finished&per_page=100`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  const data = await res.json();
  const matches = data.data || [];

  let updatedCount = 0;
  for (const m of matches) {
    const homeScore = Number(m.score?.home ?? 0);
    const awayScore = Number(m.score?.away ?? 0);
    const homeId = m.home_team?.id;
    const awayId = m.away_team?.id;

    // Update matches table
    db.prepare(`
      UPDATE matches 
      SET home_score = ?, away_score = ?
      WHERE match_id = ?
    `).run(homeScore, awayScore, m.id);

    const homeResult = homeScore > awayScore ? "W" : homeScore === awayScore ? "D" : "L";
    const awayResult = awayScore > homeScore ? "W" : homeScore === awayScore ? "D" : "L";

    // Update team_match_logs home side
    db.prepare(`
      UPDATE team_match_logs
      SET goals_for = ?, goals_against = ?, result = ?
      WHERE match_id = ? AND team_id = ?
    `).run(homeScore, awayScore, homeResult, m.id, homeId);

    // Update team_match_logs away side
    db.prepare(`
      UPDATE team_match_logs
      SET goals_for = ?, goals_against = ?, result = ?
      WHERE match_id = ? AND team_id = ?
    `).run(awayScore, homeScore, awayResult, m.id, awayId);

    updatedCount++;
  }

  console.log(`Berhasil update skor & status W/D/L untuk ${updatedCount} laga!`);
}

main().catch(console.error);
