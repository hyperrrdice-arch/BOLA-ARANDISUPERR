import { getTeamRollingTelemetry, getTeamSquadTelemetry } from "../lib/db/team-telemetry";
import { getTheStatsDb } from "../lib/db/thestats-dataset";

function main() {
  const db = getTheStatsDb();

  const clubs = ["Manchester City", "Arsenal", "Chelsea", "Everton"];
  for (const name of clubs) {
    const team = db.prepare("SELECT * FROM teams WHERE name LIKE ?").get(`%${name}%`) as any;
    if (!team) continue;
    const tel = getTeamRollingTelemetry(team.team_id, 6);
    const squad = getTeamSquadTelemetry(team.team_id);
    console.log(`\n🔵 [${team.name}] (${tel.sample_size} Laga Terakhir)`);
    console.log(`  - Form: ${tel.form_sequence} (Win Rate: ${(tel.win_rate * 100).toFixed(0)}%)`);
    console.log(`  - xG For: ${tel.rolling_xg_for} | xG Against: ${tel.rolling_xg_against}`);
    console.log(`  - Avg Possession: ${tel.avg_possession_pct}% | Avg Shots On Target: ${tel.avg_shots_on_target_for}`);
    console.log(`  - Skuad: ${squad.total_players} Pemain (Injured/Suspended: ${squad.injured_players.length})`);
    if (squad.injured_players.length > 0) {
      console.log(`    Injured: ${squad.injured_players.map(p => `${p.name} (${p.position})`).join(", ")}`);
    }
  }
}

main();
