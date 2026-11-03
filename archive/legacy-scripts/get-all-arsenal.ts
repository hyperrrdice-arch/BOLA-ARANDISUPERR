import { getTheStatsDb } from "../lib/db/thestats-dataset";

function main() {
  const db = getTheStatsDb();

  const arsenalLogs = db.prepare(`
    SELECT 
      tml.match_date,
      opp.name as opponent,
      tml.venue,
      tml.result,
      tml.goals_for || '-' || tml.goals_against as score,
      tml.xg_for,
      tml.xg_against,
      tml.shots_for || ' (' || tml.shots_inside_box_for || ' di kotak)' as shots,
      tml.shots_on_target_for as s_target,
      tml.passes_accurate_for || '/' || tml.passes_total_for as passes,
      tml.pass_accuracy_pct_for || '%' as pass_pct,
      tml.accurate_crosses_for as crosses,
      tml.touches_in_penalty_area_for as box_touches,
      tml.aerial_duels_pct_for || '%' as aerial_pct,
      tml.tackles_for as tackles,
      tml.yellow_cards as yellows
    FROM team_match_logs tml
    JOIN teams t ON tml.team_id = t.team_id
    JOIN teams opp ON tml.opponent_id = opp.team_id
    WHERE t.name LIKE '%Arsenal%'
    ORDER BY tml.match_date ASC
  `).all();

  console.log("=== ENTIRE ARSENAL MATCHES THIS SEASON (2026/2027) ===");
  console.table(arsenalLogs);
}

main();
