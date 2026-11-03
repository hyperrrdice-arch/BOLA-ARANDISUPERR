import { getTheStatsDb } from "../lib/db/thestats-dataset";
import { getTeamRollingTelemetry, getTeamSquadTelemetry } from "../lib/db/team-telemetry";

function main() {
  const db = getTheStatsDb();

  // 1. Ambil data profil tim Arsenal
  const arsenal = db.prepare("SELECT * FROM teams WHERE name LIKE '%Arsenal%'").get() as any;
  if (!arsenal) {
    console.error("Tim Arsenal tidak ditemukan di database!");
    return;
  }

  console.log("================================================================================");
  console.log(`🔴 PROFIL TIM: ${arsenal.name.toUpperCase()} (ID: ${arsenal.team_id})`);
  console.log("================================================================================");
  console.log(`- Negara: ${arsenal.country || "England"}`);
  console.log(`- Stadion / Venue: ${arsenal.stadium || "Emirates Stadium"}`);
  console.log(`- Last Database Update: ${arsenal.updated_at}`);

  // 2. Telemetry Rolling Performance (Musim Berjalan 2026/2027)
  const tel = getTeamRollingTelemetry(arsenal.team_id, 10);
  console.log("\n================================================================================");
  console.log(`📊 METRIK TELEMETRY ROLLING (Musim 2026/2027 - ${tel.sample_size} Pertandingan)`);
  console.log("================================================================================");
  console.log(`- Formasi Rekor (Form): ${tel.form_sequence} (Win Rate: ${(tel.win_rate * 100).toFixed(1)}%)`);
  console.log(`- Rolling xG Produksi (xG For): ${tel.rolling_xg_for} per laga`);
  console.log(`- Rolling xG Kebobolan (xG Against): ${tel.rolling_xg_against} per laga`);
  console.log(`- Non-Penalty xG: ${tel.rolling_npxg_for} (For) vs ${tel.rolling_npxg_against} (Against)`);
  console.log(`- Rata-rata Gol Aktual: ${tel.rolling_goals_for} gol vs ${tel.rolling_goals_against} kebobolan`);
  console.log(`- Rata-rata Penguasaan Bola: ${tel.avg_possession_pct}%`);
  console.log(`- Shots On Target (Efisiensi): ${tel.avg_shots_on_target_for} per laga (Total Shots: ${tel.avg_shots_for})`);
  console.log(`- Peluang Emas (Big Chances): ${tel.avg_big_chances_for} per laga`);
  console.log(`- Corners: ${tel.avg_corners_for} | Fouls: ${tel.avg_fouls_committed} per laga`);
  console.log(`- Clean Sheet Rate: ${(tel.clean_sheet_rate * 100).toFixed(1)}%`);

  // 3. Log Tiap Pertandingan Match-by-Match
  console.log("\n================================================================================");
  console.log(`📅 REKAMAN GRANULAR MATCH-BY-MATCH (TIAP PERTANDINGAN ARSENAL)`);
  console.log("================================================================================");
  
  const matchLogs = db.prepare(`
    SELECT tml.*, opp.name as opponent_name
    FROM team_match_logs tml
    LEFT JOIN teams opp ON tml.opponent_id = opp.team_id
    WHERE tml.team_id = ?
    ORDER BY tml.match_date DESC
  `).all(arsenal.team_id) as any[];

  matchLogs.forEach((m, idx) => {
    const venueLabel = m.venue === "HOME" ? "🏠 KANDANG" : "✈️ TANDANG";
    const resultEmoji = m.result === "W" ? "🟢 MENANG" : m.result === "D" ? "🟡 SERI" : "🔴 KALAH";
    console.log(`\n[Pekan ${matchLogs.length - idx}] ${m.match_date} | ${venueLabel} vs ${m.opponent_name || m.opponent_id}`);
    console.log(`  * Hasil Akhir: Skor ${m.goals_for} - ${m.goals_against} (${resultEmoji})`);
    console.log(`  * Kualitas Peluang (xG): ${m.xg_for} (Arsenal) vs ${m.xg_against} (Lawan)`);
    console.log(`  * Kontrol Laga: Ball Possession ${m.possession_pct}% | Corners: ${m.corners_for || 0} - ${m.corners_against || 0}`);
    console.log(`  * Tembakan: Total ${m.shots_for || "-"} (On Target: ${m.shots_on_target_for || "-"})`);
    console.log(`  * Formasi Taktik Digunakan: ${m.formation || "4-3-3"}`);
    
    // Tampilkan starting XI jika ada
    if (m.starting_xi_ids) {
      try {
        const playerIds = JSON.parse(m.starting_xi_ids);
        const placeholders = playerIds.map(() => "?").join(",");
        const starters = db.prepare(`SELECT name, position, jersey_number FROM team_squads WHERE player_id IN (${placeholders})`).all(...playerIds) as any[];
        if (starters.length > 0) {
          const starterNames = starters.map(p => `${p.name} (#${p.jersey_number || "?"})`).join(", ");
          console.log(`  * Starting XI: ${starterNames}`);
        }
      } catch {}
    }
  });

  // 4. Katalog Skuad Terupdate (team_squads)
  console.log("\n================================================================================");
  console.log(`👥 SKUAD RESMI ARSENAL TERUPDATE (Musim 2026/2027)`);
  console.log("================================================================================");
  
  const squad = db.prepare(`
    SELECT * FROM team_squads
    WHERE team_id = ? AND is_active = 1
    ORDER BY 
      CASE position
        WHEN 'G' THEN 1
        WHEN 'D' THEN 2
        WHEN 'M' THEN 3
        WHEN 'F' THEN 4
        ELSE 5
      END,
      jersey_number ASC
  `).all(arsenal.team_id) as any[];

  console.log(`Total Pemain Terdaftar: ${squad.length} Pemain\n`);

  const posMap: Record<string, string> = { G: "Penjaga Gawang (GK)", D: "Pemain Bertahan (DEF)", M: "Gelandang (MID)", F: "Penyerang (FWD)" };
  let curPos = "";

  squad.forEach((p) => {
    const posHeader = posMap[p.position] || p.position || "Lainnya";
    if (posHeader !== curPos) {
      curPos = posHeader;
      console.log(`\n--- ${curPos} ---`);
    }
    const valFormatted = p.market_value ? `€${(p.market_value / 1000000).toFixed(1)}M` : "-";
    const statusLabel = p.injury_status && p.injury_status !== "FIT" ? `⚠️ ${p.injury_status}` : "✅ FIT";
    console.log(`  #${String(p.jersey_number || "-").padEnd(2)} | ${p.name.padEnd(25)} | Usia: ${String(p.age || "-").padEnd(2)} | Negara: ${String(p.nationality || "-").padEnd(14)} | Valuasi: ${valFormatted.padEnd(7)} | Status: ${statusLabel}`);
  });
}

main();
