/**
 * RUNNABLE CHECK — value bet HANYA dari odds pasar nyata (Task 7, audit 2026-10-18).
 *
 * Kontrak: tanpa odds pasar → tidak ada value bet (TIDAK boleh ada odds karangan
 * 1.95 / 1.88 / fair-odds model yang dulu menghasilkan EV/Kelly/recommended_odds palsu).
 *
 * Jalankan: npx tsx scripts/test-value-bets.ts
 */
import fs from "fs";
import path from "path";
import type { VerifiedMatchIntelligence } from "../lib/stats-validator";

// Load .env.local sebelum module lib yang butuh env di-import (pola test-planner-loop)
const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.trim().match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2].trim();
    }
  }
}

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
  }
}

function makeIntel(marketOdds: {
  home_last: number | null;
  draw_last: number | null;
  away_last: number | null;
  total_goals_over_2_5: number | null;
}): VerifiedMatchIntelligence {
  return {
    pertandingan: {
      id: "vb_test_1",
      tim_kandang: "VB Kandang FC",
      tim_tamu: "VB Tamu FC",
      waktu: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      kompetisi: "Liga Uji Value Bet",
      venue: "Stadion Uji",
      wasit: "",
      kickoff_jam_menuju: 24,
    },
    wasit_detail: {
      is_available: false,
      name: "",
      country: "",
      games: 0,
      yellow_cards: 0,
      red_cards: 0,
      avg_yellow_per_game: null,
      strictness_level: "tidak diketahui",
    },
    lineups: {
      is_available: false,
      confirmed: false,
      status_label: "belum_tersedia",
      home_formation: "",
      away_formation: "",
      home_starting_xi: [],
      away_starting_xi: [],
    },
    h2h_history: { is_available: false, sample_size: 0, summary: "", recent_meetings: [] },
    form_split: {
      home_form_summary: "",
      away_form_summary: "",
      home_goals_avg: 1.4,
      away_goals_avg: 1.2,
      home_form_sample_size: 0,
      away_form_sample_size: 0,
    },
    injuries: { is_available: false, home_injuries: [], away_injuries: [] },
    market_odds: { is_available: marketOdds.home_last != null, ...marketOdds },
    missing_data_registry: ["lineups", "h2h", "injuries"],
    is_strictly_grounded: true,
  };
}

async function main() {
console.log("=== TEST VALUE BETS (odds pasar nyata saja) ===\n");
const { buildQuantPackage } = await import("../lib/agent/planner");

// 1. Tanpa odds pasar sama sekali → value_bets kosong (jujur), bukan diisi karangan.
const tanpaOdds = buildQuantPackage(
  makeIntel({ home_last: null, draw_last: null, away_last: null, total_goals_over_2_5: null }),
  new Date().toISOString().slice(0, 10)
);
assert(tanpaOdds.quantPackage.value_bets.length === 0, `tanpa odds pasar → value_bets kosong (dapat ${tanpaOdds.quantPackage.value_bets.length})`);
const mangled = JSON.stringify(tanpaOdds.quantPackage.value_bets);
assert(!mangled.includes("1.88") && !mangled.includes("1.95"), "tidak ada odds karangan 1.88/1.95 di output");

// 2. Dengan odds pasar nyata → hanya market yang ber-odds yang dinilai.
const oddsNyata = { home_last: 2.1, draw_last: 3.4, away_last: 3.6, total_goals_over_2_5: 1.9 };
const denganOdds = buildQuantPackage(makeIntel(oddsNyata), new Date().toISOString().slice(0, 10));
const vbs = denganOdds.quantPackage.value_bets;
assert(vbs.length > 0, `odds pasar ada → value_bets terisi (${vbs.length})`);

const allowedOdds = new Set([2.1, 3.4, 3.6, 1.9]);
const semuaOddsAsli = vbs.every((vb) => allowedOdds.has(vb.bookmaker_odds));
assert(semuaOddsAsli, "semua bookmaker_odds berasal dari odds pasar yang diberikan");
const adaBTTS = vbs.some((vb) => vb.market_name.includes("Both Teams"));
const adaAH = vbs.some((vb) => vb.market_name.includes("Asian Handicap"));
assert(!adaBTTS && !adaAH, "BTTS/AH DNB TIDAK muncul (tidak ada odds pasar untuk keduanya)");
const adaO25 = vbs.some((vb) => vb.market_name === "Over/Under 2.5" && vb.bookmaker_odds === 1.9);
assert(adaO25, "Over/Under 2.5 dinilai dengan odds pasar 1.9");

// 3. Odds pasar parsial (cuma 1X2 home) → cuma home yang dinilai.
const parsial = buildQuantPackage(
  makeIntel({ home_last: 2.5, draw_last: null, away_last: null, total_goals_over_2_5: null }),
  new Date().toISOString().slice(0, 10)
);
assert(
  parsial.quantPackage.value_bets.every((vb) => vb.bookmaker_odds === 2.5),
  "odds parsial → hanya pasar ber-odds yang dinilai"
);

console.log(`\n=== ${passed} lulus, ${failed} gagal ===`);
process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("TEST GAGAL:", err);
  process.exit(1);
});
