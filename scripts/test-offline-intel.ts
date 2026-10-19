/**
 * RUNNABLE CHECK — Task 7 offline-survival: intel per-match tanpa TheStatsAPI.
 *
 *   - Fixture ber-odds (Parma vs Torino) → intel offline: tim + odds anchor +
 *     form/H2H lokal, lineup/wasit kosong jujur, endpoint match-detail live
 *     TIDAK pernah dipanggil.
 *   - Match tak dikenal → throw jujur (bukan karangan).
 *
 * Jalankan: npx tsx scripts/test-offline-intel.ts
 */
import { fetchAndValidateMatchIntelligence } from "../lib/stats-fetcher-agent";

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string, extra?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`, extra ?? "");
  }
}

async function main() {
  console.log("=== TEST OFFLINE INTEL (Task 7) ===\n");

  const hitUrls: string[] = [];
  const origFetch = globalThis.fetch;
  (globalThis as any).fetch = (...a: any[]) => {
    hitUrls.push(String(a[0]));
    return origFetch(...a);
  };

  // 1. Fixture ber-odds → intel offline lengkap-jujur
  const r = await fetchAndValidateMatchIntelligence("mt_988230396");
  const intel: any = r.intelligence;
  assert(intel.pertandingan.tim_kandang === "Parma", "tim kandang Parma", intel.pertandingan.tim_kandang);
  assert(intel.pertandingan.tim_tamu === "Torino", "tim tamu Torino", intel.pertandingan.tim_tamu);
  assert(intel.market_odds.is_available === true, "odds anchor tersedia", JSON.stringify(intel.market_odds));
  assert(
    (intel.market_odds.home_last ?? 0) > 1 && (intel.market_odds.draw_last ?? 0) > 1 && (intel.market_odds.away_last ?? 0) > 1,
    "odds 1X2 valid (>1.0)",
    JSON.stringify(intel.market_odds)
  );
  assert(intel.lineups.is_available === false, "lineup kosong jujur (offline)", intel.lineups.is_available);
  assert(intel.wasit_detail.is_available === false, "wasit kosong jujur (offline)", intel.wasit_detail.is_available);
  assert(
    (r.audit.endpoints_called as string[]).some((e) => e.includes("offline SQLite")),
    "audit mencatat sumber offline",
    JSON.stringify(r.audit.endpoints_called)
  );
  const liveDetailHits = hitUrls.filter((u) => u.includes("/football/matches/mt_988230396") && !u.includes("/odds") && !u.includes("/referee") && !u.includes("/lineups"));
  assert(liveDetailHits.length === 0, "endpoint match-detail live tidak dipanggil", liveDetailHits.slice(0, 3));

  // 2. Match tak dikenal → throw, bukan karangan
  let threw = false;
  try {
    await fetchAndValidateMatchIntelligence("mt_tidak_ada_123");
  } catch (e) {
    threw = true;
    assert(/tidak ditemukan/i.test((e as Error).message), "pesan throw jujur", (e as Error).message);
  }
  assert(threw, "match tak dikenal: throw");

  (globalThis as any).fetch = origFetch;
  console.log(`\n=== ${passed} lulus, ${failed} gagal ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
