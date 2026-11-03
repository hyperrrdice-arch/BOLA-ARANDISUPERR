import { getTheStatsVaultDb, getRawPayload } from "../lib/db/thestats-vault";

function main() {
  const db = getTheStatsVaultDb();

  console.log("=== 1. AUDIT RAW VAULT PAYLOADS ===");
  const counts = db.prepare("SELECT endpoint, count(*) as count FROM raw_api_vault GROUP BY endpoint").all();
  console.table(counts);

  // Periksa sampel injury payload
  const injurySample = db.prepare("SELECT resource_id, payload_json FROM raw_api_vault WHERE endpoint = 'injuries' LIMIT 1").get() as any;
  if (injurySample) {
    console.log(`\n=== 2. SHAPE ASLI INJURY DI VAULT (${injurySample.resource_id}) ===`);
    const json = JSON.parse(injurySample.payload_json);
    console.log("Root keys:", Object.keys(json));
    console.log("Data keys:", json.data ? Object.keys(json.data) : null);
    if (json.data?.injuries && json.data.injuries.length > 0) {
      console.log("Sample injury entry [0]:", json.data.injuries[0]);
    }
    if (json.data?.suspensions && json.data.suspensions.length > 0) {
      console.log("Sample suspension entry [0]:", json.data.suspensions[0]);
    }
  }

  // Periksa 49 stats vs 60 matches
  const matchesPayload = getRawPayload("matches_comp_3039_finished") as any;
  const matches = matchesPayload?.data || [];
  console.log(`\n=== 3. AUDIT STATS COVERAGE (Matches: ${matches.length}) ===`);
  const missingStats: string[] = [];
  const existingStats: string[] = [];

  for (const m of matches) {
    const hasStats = db.prepare("SELECT 1 FROM raw_api_vault WHERE resource_id = ?").get(`stats_${m.id}`);
    if (hasStats) existingStats.push(m.id);
    else missingStats.push(`${m.id} (${m.utc_date?.slice(0, 10)} - ${m.home_team?.name} vs ${m.away_team?.name})`);
  }
  console.log(`- Stats ada di vault: ${existingStats.length}`);
  console.log(`- Stats BELUM ada di vault: ${missingStats.length}`);
  if (missingStats.length > 0) {
    console.log("Sampel laga yang belum punya stats di vault:", missingStats.slice(0, 5));
  }
}

main();
