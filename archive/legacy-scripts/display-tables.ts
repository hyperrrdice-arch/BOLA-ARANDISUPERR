import { getTheStatsVaultDb } from "../lib/db/thestats-vault";
import { getTheStatsDb } from "../lib/db/thestats-dataset";

function main() {
  const vaultDb = getTheStatsVaultDb();
  const datasetDb = getTheStatsDb();

  console.log("=== 1. TABEL raw_api_vault (thestats_raw_vault.db) ===");
  const rawRows = vaultDb.prepare(`
    SELECT resource_id, endpoint, length(payload_json) as bytes, substr(payload_json, 1, 60) as snippet, created_at
    FROM raw_api_vault
    ORDER BY created_at DESC
    LIMIT 6
  `).all();
  console.table(rawRows);

  console.log("\n=== 2. TABEL team_match_logs (thestats_dataset.db) ===");
  const logRows = datasetDb.prepare(`
    SELECT 
      tml.match_date,
      COALESCE(t.short_name, t.name) || ' (' || tml.venue || ')' as team,
      COALESCE(opp.short_name, opp.name) as opponent,
      tml.result as res,
      tml.goals_for || '-' || tml.goals_against as score,
      tml.xg_for as xg,
      tml.shots_inside_box_for as in_box,
      tml.passes_accurate_for || '/' || tml.passes_total_for as passes,
      tml.pass_accuracy_pct_for || '%' as pass_pct,
      tml.accurate_crosses_for as crosses,
      tml.aerial_duels_pct_for || '%' as aerial,
      tml.touches_in_penalty_area_for as box_tch,
      tml.tackles_for as tkl,
      tml.yellow_cards as yel
    FROM team_match_logs tml
    JOIN teams t ON tml.team_id = t.team_id
    JOIN teams opp ON tml.opponent_id = opp.team_id
    WHERE tml.xg_for IS NOT NULL
    ORDER BY tml.match_date DESC
    LIMIT 8
  `).all();
  console.table(logRows);
}

main();
