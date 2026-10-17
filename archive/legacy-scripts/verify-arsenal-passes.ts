import { getTheStatsDb } from "../lib/db/thestats-dataset";
import { getRawPayload } from "../lib/db/thestats-vault";

function main() {
  const db = getTheStatsDb();
  const matchId = "mt_200199332"; // Arsenal vs Leeds United

  console.log("================================================================================");
  console.log(`🔍 VERIFIKASI DATA LOKAL (ARSENAL VS LEEDS UNITED - ${matchId})`);
  console.log("================================================================================");

  // 1. Ambil data dari Analytics DB (Structured 50+ Features)
  const logs = db.prepare(`
    SELECT tml.*, t.name as team_name, opp.name as opponent_name
    FROM team_match_logs tml
    JOIN teams t ON tml.team_id = t.team_id
    JOIN teams opp ON tml.opponent_id = opp.team_id
    WHERE tml.match_id = ?
  `).all(matchId) as any[];

  for (const row of logs) {
    console.log(`\n⚽ TIM: ${row.team_name} (${row.venue}) | Hasil: ${row.goals_for} - ${row.goals_against} (${row.result})`);
    console.log("--------------------------------------------------------------------------------");
    console.log(`📌 STATISTIK PASSING (Jawaban Langsung dari Database Lokal):`);
    console.log(`   * Total Passes: ${row.passes_total_for}`);
    console.log(`   * Accurate Passes (Passing Akurat): ${row.passes_accurate_for}`);
    console.log(`   * Pass Accuracy Rate: ${row.pass_accuracy_pct_for}%`);
    console.log(`   * Accurate Crosses (Umpan Silang Akurat): ${row.accurate_crosses_for}`);
    console.log(`   * Accurate Long Balls: ${row.accurate_long_balls_for}`);
    console.log(`   * Final Third Entries: ${row.final_third_entries_for}`);

    console.log(`\n📌 STATISTIK DUEL & PASAR SUNDULAN (HEADED GOAL FEATURES):`);
    console.log(`   * Aerial Duels Won %: ${row.aerial_duels_pct_for}%`);
    console.log(`   * Ground Duels Won %: ${row.ground_duels_pct_for}%`);
    console.log(`   * Total Duels Won %: ${row.duels_won_pct_for}%`);
    console.log(`   * Sentuhan di Kotak Penalti (Box Touches): ${row.touches_in_penalty_area_for}`);

    console.log(`\n📌 STATISTIK TEMBAKAN & PELUANG:`);
    console.log(`   * xG: ${row.xg_for} vs ${row.xg_against} (Non-Penalty xG: ${row.npxg_for})`);
    console.log(`   * Total Tembakan: ${row.shots_for} (On Target: ${row.shots_on_target_for}, Off Target: ${row.shots_off_target_for}, Blocked: ${row.blocked_shots_for})`);
    console.log(`   * Tembakan di Dalam Kotak Penalti: ${row.shots_inside_box_for}`);
    console.log(`   * Tembakan di Luar Kotak Penalti: ${row.shots_outside_box_for}`);
    console.log(`   * Big Chances: ${row.big_chances_for} (Missed: ${row.big_chances_missed_for})`);

    console.log(`\n📌 STATISTIK BERTAHAN & DISIPLIN:`);
    console.log(`   * Tekel (Tackles): ${row.tackles_for} (Tackles Won: ${row.tackles_won_pct_for})`);
    console.log(`   * Interceptions: ${row.interceptions_for} | Clearances: ${row.clearances_for} | Recoveries: ${row.ball_recoveries_for}`);
    console.log(`   * Fouls: ${row.fouls_committed} | Yellow Cards: ${row.yellow_cards} | Red Cards: ${row.red_cards}`);
    console.log(`   * Corners: ${row.corners_for} - ${row.corners_against}`);

    console.log(`\n📌 STATISTIK KIPER:`);
    console.log(`   * Saves: ${row.saves_for} | Goals Prevented: ${row.goals_prevented_for} | High Claims: ${row.high_claims_for}`);
  }

  // 2. Verifikasi Data Mentah di Raw Vault
  console.log("\n================================================================================");
  console.log("🔒 VERIFIKASI RAW VAULT (Local Data Lake)");
  console.log("================================================================================");
  const rawVault = getRawPayload(`stats_${matchId}`);
  console.log(`- Status Raw Vault Payload: ${rawVault ? "✅ TERSIMPAN UTUH (100% JSON Lengkap)" : "❌ Tidak Ditemukan"}`);
  if (rawVault) {
    const rawData = rawVault.data || rawVault;
    console.log(`- Overview Passes Raw Node:`, JSON.stringify(rawData.overview?.passes?.all, null, 2));
    console.log(`- Overview Accurate Passes Raw Node:`, JSON.stringify(rawData.overview?.accurate_passes?.all, null, 2));
  }
}

main();
