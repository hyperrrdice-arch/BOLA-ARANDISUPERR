import { getTheStatsDb } from "../lib/db/thestats-dataset";
import { getTheStatsVaultDb } from "../lib/db/thestats-vault";

interface InjuryEntry {
  player_id: string;
  status: string;
  reason?: string;
  expected_return?: string;
  start_date?: string;
  active?: boolean;
}

interface SuspensionEntry {
  player_id: string;
  reason?: string;
}

function main() {
  const vaultDb = getTheStatsVaultDb();
  const datasetDb = getTheStatsDb();

  console.log("================================================================================");
  console.log("🏥 [RE-MAPPING INJURY & SUSPENSION STATUS DARI RAW VAULT (OFFLINE)]");
  console.log("================================================================================");

  // 1. Ambil seluruh payload injury yang ada di Raw Vault
  const injuryPayloads = vaultDb.prepare(`
    SELECT resource_id, payload_json
    FROM raw_api_vault
    WHERE endpoint = 'injuries'
  `).all() as { resource_id: string; payload_json: string }[];

  console.log(`Ditemukan ${injuryPayloads.length} payload injury di Raw Vault.`);

  const teamWithInjuryPayload = new Set<string>();
  const injuryMap = new Map<string, string>(); // player_id -> status description
  let totalRawInjuries = 0;
  let totalRawSuspensions = 0;

  for (const row of injuryPayloads) {
    const teamId = row.resource_id.replace("injuries_", "");
    teamWithInjuryPayload.add(teamId);

    const json = JSON.parse(row.payload_json);
    const injuries: InjuryEntry[] = json.data?.injuries || [];
    const suspensions: SuspensionEntry[] = json.data?.suspensions || [];

    for (const inj of injuries) {
      if (!inj.player_id) continue;
      totalRawInjuries++;
      const reasonClean = (inj.reason || "injury").replace(/_/g, " ").toUpperCase();
      const statusClean = inj.status || "out";
      const retDate = inj.expected_return ? inj.expected_return.slice(0, 10) : "TBD";
      injuryMap.set(inj.player_id, `INJURED: ${reasonClean} (${statusClean}, ret: ${retDate})`);
    }

    for (const susp of suspensions) {
      if (!susp.player_id) continue;
      totalRawSuspensions++;
      const reasonClean = (susp.reason || "cards").replace(/_/g, " ").toUpperCase();
      injuryMap.set(susp.player_id, `SUSPENDED: ${reasonClean}`);
    }
  }

  console.log(`- Total Raw Injuries: ${totalRawInjuries} entri`);
  console.log(`- Total Raw Suspensions: ${totalRawSuspensions} entri`);
  console.log(`- Total Pemain Unik Terdampak Cedera/Skorsing: ${injuryMap.size} pemain`);

  // 2. Ambil seluruh skuad dari database lokal
  const allSquadPlayers = datasetDb.prepare("SELECT player_id, team_id, name, position FROM team_squads").all() as {
    player_id: string;
    team_id: string;
    name: string;
    position: string;
  }[];

  console.log(`- Total Pemain Terdaftar di Skuad: ${allSquadPlayers.length} pemain`);

  // 3. Update status skuad dengan transaksi aman
  let matchedInjured = 0;
  let markedFit = 0;
  let markedUnknown = 0;
  const unmatchedPlayerIds: string[] = [];

  const updateStmt = datasetDb.prepare(`
    UPDATE team_squads
    SET injury_status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE player_id = ?
  `);

  datasetDb.exec("BEGIN TRANSACTION;");
  try {
    for (const p of allSquadPlayers) {
      if (injuryMap.has(p.player_id)) {
        const statusStr = injuryMap.get(p.player_id)!;
        updateStmt.run(statusStr, p.player_id);
        matchedInjured++;
      } else if (teamWithInjuryPayload.has(p.team_id)) {
        // Tim memiliki data cedera resmi dan pemain tidak ada di daftar cedera -> Terbukti FIT
        updateStmt.run("FIT", p.player_id);
        markedFit++;
      } else {
        // Tim belum memiliki payload cedera di vault -> Status UNKNOWN (bukan klaim FIT palsu)
        updateStmt.run("UNKNOWN (Data Belum Tersedia)", p.player_id);
        markedUnknown++;
      }
    }
    datasetDb.exec("COMMIT;");
  } catch (e) {
    datasetDb.exec("ROLLBACK;");
    throw e;
  }

  // Cek apakah ada injury yang tidak match ke tabel skuad
  const squadPlayerIdSet = new Set(allSquadPlayers.map((p) => p.player_id));
  for (const [pId, desc] of injuryMap.entries()) {
    if (!squadPlayerIdSet.has(pId)) {
      unmatchedPlayerIds.push(`${pId} (${desc})`);
    }
  }

  console.log("\n================================================================================");
  console.log("📊 [HASIL RE-MAPPING STATUS SKUAD]");
  console.log("================================================================================");
  console.log(`✅ Pemain Teridentifikasi Cedera/Skorsing (MATCH KE SKUAD): ${matchedInjured} pemain`);
  console.log(`✅ Pemain Terverifikasi Bugar (FIT): ${markedFit} pemain`);
  console.log(`⚠️ Pemain Status UNKNOWN (Tim Tanpa Payload): ${markedUnknown} pemain`);
  console.log(`ℹ️ Entri Cedera di Vault tapi Tidak Ada di Roster Skuad Utama: ${unmatchedPlayerIds.length} entri (pemain akademi/reserves)`);

  // Tampilkan sampel pemain yang sekarang cedera
  console.log("\n=== DAFTAR SAMPEL PEMAIN CEDERA YANG SEKARANG TEREKAM DI DB ===");
  const injuredSample = datasetDb.prepare(`
    SELECT t.name as team_name, s.name as player_name, s.position, s.injury_status
    FROM team_squads s
    JOIN teams t ON s.team_id = t.team_id
    WHERE s.injury_status LIKE 'INJURED%' OR s.injury_status LIKE 'SUSPENDED%'
    ORDER BY t.name ASC, s.name ASC
    LIMIT 15
  `).all() as any[];
  console.table(injuredSample);
}

main();
