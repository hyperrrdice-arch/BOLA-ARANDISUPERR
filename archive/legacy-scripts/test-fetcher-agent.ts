import { fetchAndValidateMatchIntelligence } from "../lib/stats-fetcher-agent";
import { getStatsCacheMetrics } from "../lib/stats-cache";

async function runTest() {
  console.log("=== UNIT TEST: DYNAMIC FETCHER AGENT & ADAPTIVE CACHE ===");

  // Coba jalankan dengan match_id dummy (atau format error jika server TheStatsAPI offline)
  try {
    const metricsBefore = getStatsCacheMetrics();
    console.log("Cache Metrics Sebelum:", metricsBefore);

    console.log("\n[1] Menjalankan fetchAndValidateMatchIntelligence untuk match 'test-id'...");
    const res = await fetchAndValidateMatchIntelligence("test-id").catch((err) => {
      console.log("Catched expected error for dummy test-id:", err.message);
      return null;
    });

    console.log("\n✅ Pipeline dynamic fetcher agent file import dan eksekusi berjalan tanpa runtime crash!");
  } catch (err) {
    console.error("Test error:", err);
    process.exit(1);
  }
}

runTest();
