import { getTeamRollingTelemetry, getTeamSquadTelemetry } from "../lib/db/team-telemetry";
import { getTheStatsDb } from "../lib/db/thestats-dataset";

function main() {
  const db = getTheStatsDb();

  console.log("================================================================================");
  console.log("🧪 [PENGUJIAN REFACTOR TELEMETRY: ZERO SILENT IMPUTATION & PRE-MATCH CUTOFF]");
  console.log("================================================================================");

  const testClubs = ["Arsenal", "Chelsea", "Manchester City", "Coventry City"];

  for (const clubName of testClubs) {
    const team = db.prepare("SELECT * FROM teams WHERE name LIKE ?").get(`%${clubName}%`) as any;
    if (!team) continue;

    console.log(`\n⚽ KLUB: ${team.name} (${team.team_id})`);

    // 1. Full season telemetry
    const fullTel = getTeamRollingTelemetry(team.team_id, 6);
    console.log(`  [Full Telemetry - ${fullTel.sample_size} Laga]`);
    console.log(`  - Observed xG Samples: ${fullTel.observed_xg_samples} dari ${fullTel.sample_size} laga`);
    console.log(`  - Rolling xG For: ${fullTel.rolling_xg_for ?? "NULL (Tidak ada data observed)"}`);
    console.log(`  - Rolling xG Against: ${fullTel.rolling_xg_against ?? "NULL (Tidak ada data observed)"}`);
    console.log(`  - Gol Aktual: ${fullTel.rolling_goals_for} - ${fullTel.rolling_goals_against} (Form: ${fullTel.form_sequence})`);
    console.log(`  - Observed Passing: ${fullTel.avg_passes_accurate_for ? `${fullTel.avg_passes_accurate_for} pass (${fullTel.avg_pass_accuracy_pct}%)` : "NULL"}`);
    console.log(`  - Observed Crosses: ${fullTel.avg_crosses_accurate_for ?? "NULL"} | Aerial: ${fullTel.avg_aerial_duels_pct_for ? `${fullTel.avg_aerial_duels_pct_for}%` : "NULL"}`);

    // 2. Pre-match cutoff test (Anti-Leakage)
    // Coba ambil sebelum 15 September 2026 (harus hanya mengembalikan laga di Agustus & awal September)
    const preMatchTel = getTeamRollingTelemetry(team.team_id, 6, "2026-09-15");
    console.log(`  [Pre-Match Cutoff (before 2026-09-15) - Anti Data Leakage]`);
    console.log(`  - Laga yang Dihitung: ${preMatchTel.sample_size} laga`);
    console.log(`  - Form Pra-Laga: ${preMatchTel.form_sequence}`);
    if (preMatchTel.recent_logs.length > 0) {
      console.log(`  - Tanggal Laga Termasuk: ${preMatchTel.recent_logs.map(l => l.match_date).join(", ")}`);
    }

    // 3. Skuad Telemetry & Health Audit
    const squadTel = getTeamSquadTelemetry(team.team_id);
    console.log(`  [Status Kesehatan Skuad]`);
    console.log(`  - Total Skuad: ${squadTel.total_players} | Fit: ${squadTel.active_players.length} | Cedera: ${squadTel.injured_players.length} | Unknown: ${squadTel.unknown_status_players.length}`);
    if (squadTel.injured_players.length > 0) {
      console.log(`  - Pemain Cedera: ${squadTel.injured_players.map(p => `${p.name} (${p.position})`).join(", ")}`);
    }
  }
}

main();
