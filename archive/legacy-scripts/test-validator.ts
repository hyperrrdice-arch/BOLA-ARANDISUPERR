import { validateAndSanitizeMatchData } from "../lib/stats-validator";

function runTests() {
  console.log("=== UNIT TEST: THESTATSAPI DATA VALIDATOR & SANITIZER ===");

  // Kasus 1: Payload minimalis (misal laga masih H-3 hari, tidak ada lineup dan wasit belum rilis)
  const minimalRaw = {
    matchRes: {
      data: {
        id: 99901,
        utc_date: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
        status: "scheduled",
        competition_name: "Premier League",
        home_team: { id: 101, name: "Arsenal" },
        away_team: { id: 102, name: "Chelsea" },
      },
    },
    refRes: null,
    lineupsRes: null,
    h2hRes: { data: [] },
    oddsRes: null,
  };

  const sanitized = validateAndSanitizeMatchData(minimalRaw);

  console.log("\n[Test 1] Hasil Sanitasi Match Minimalis:");
  console.log(`- Pertandingan: ${sanitized.pertandingan.tim_kandang} vs ${sanitized.pertandingan.tim_tamu}`);
  console.log(`- Kickoff jam menuju: ${sanitized.pertandingan.kickoff_jam_menuju}h`);
  console.log(`- Wasit is_available: ${sanitized.wasit_detail.is_available} (${sanitized.wasit_detail.name})`);
  console.log(`- Lineup is_available: ${sanitized.lineups.is_available} (${sanitized.lineups.status_label})`);
  console.log(`- Missing Data Registri (${sanitized.missing_data_registry.length} item):`);
  sanitized.missing_data_registry.forEach((m) => console.log(`  * ${m}`));

  if (!sanitized.is_strictly_grounded) {
    throw new Error("Validation flag is_strictly_grounded harus true");
  }
  if (sanitized.lineups.is_available !== false) {
    throw new Error("Lineup pada laga H-3 hari seharusnya is_available: false");
  }
  if (sanitized.wasit_detail.is_available !== false) {
    throw new Error("Wasit tanpa data seharusnya is_available: false");
  }

  // Kasus 2: Payload lengkap dengan lineups resmi dan wasit
  const fullRaw = {
    matchRes: {
      data: {
        id: 99902,
        utc_date: new Date(Date.now() + 1.5 * 3600 * 1000).toISOString(),
        status: "scheduled",
        competition_name: "La Liga",
        venue: "Santiago Bernabeu",
        home_team: { id: 201, name: "Real Madrid" },
        away_team: { id: 202, name: "Barcelona" },
      },
    },
    refRes: {
      data: {
        referee: {
          name: "Gil Manzano",
          country: "Spain",
          career: { games: 40, yellow_cards: 180, red_cards: 8, yellow_red_cards: 2 },
        },
      },
    },
    lineupsRes: {
      data: {
        confirmed: true,
        home: {
          formation: "4-3-3",
          starting_xi: [
            { name: "Courtois", position: "G", jersey_number: 1 },
            { name: "Carvajal", position: "D", jersey_number: 2 },
            { name: "Militao", position: "D", jersey_number: 3 },
            { name: "Rudiger", position: "D", jersey_number: 22 },
            { name: "Mendy", position: "D", jersey_number: 23 },
            { name: "Valverde", position: "M", jersey_number: 8 },
            { name: "Tchouameni", position: "M", jersey_number: 14 },
            { name: "Bellingham", position: "M", jersey_number: 5 },
            { name: "Rodrygo", position: "F", jersey_number: 11 },
            { name: "Mbappe", position: "F", jersey_number: 9 },
            { name: "Vinicius Jr", position: "F", jersey_number: 7 },
          ],
        },
        away: {
          formation: "4-2-3-1",
          starting_xi: [
            { name: "Ter Stegen", position: "G", jersey_number: 1 },
            { name: "Kounde", position: "D", jersey_number: 23 },
            { name: "Cubarsi", position: "D", jersey_number: 2 },
            { name: "Inigo Martinez", position: "D", jersey_number: 5 },
            { name: "Balde", position: "D", jersey_number: 3 },
            { name: "Casado", position: "M", jersey_number: 17 },
            { name: "Pedri", position: "M", jersey_number: 8 },
            { name: "Yamal", position: "F", jersey_number: 19 },
            { name: "Dani Olmo", position: "M", jersey_number: 20 },
            { name: "Raphinha", position: "F", jersey_number: 11 },
            { name: "Lewandowski", position: "F", jersey_number: 9 },
          ],
        },
      },
    },
    h2hRes: {
      data: [
        {
          utc_date: "2024-04-21",
          home_team: { id: 201, name: "Real Madrid" },
          away_team: { id: 202, name: "Barcelona" },
          score: { regulation: { home: 3, away: 2 } },
        },
      ],
    },
    oddsRes: {
      data: {
        bookmakers: [
          {
            name: "bet365",
            markets: {
              match_odds: {
                home: { last_seen: 2.1 },
                draw: { last_seen: 3.6 },
                away: { last_seen: 3.3 },
              },
            },
          },
        ],
      },
    },
  };

  const fullSanitized = validateAndSanitizeMatchData(fullRaw);

  console.log("\n[Test 2] Hasil Sanitasi Match Lengkap:");
  console.log(`- Wasit: ${fullSanitized.wasit_detail.name} (Avg Yellow: ${fullSanitized.wasit_detail.avg_yellow_per_game}, Level: ${fullSanitized.wasit_detail.strictness_level})`);
  console.log(`- Lineup: ${fullSanitized.lineups.status_label} (Home: ${fullSanitized.lineups.home_starting_xi.length} pemain, Away: ${fullSanitized.lineups.away_starting_xi.length} pemain)`);
  console.log(`- Odds: 1=${fullSanitized.market_odds.home_last}, X=${fullSanitized.market_odds.draw_last}, 2=${fullSanitized.market_odds.away_last}`);

  if (fullSanitized.wasit_detail.avg_yellow_per_game !== 4.5) {
    throw new Error(`Kalkulasi kartu wasit salah, diharapkan 4.5 tetapi dapat ${fullSanitized.wasit_detail.avg_yellow_per_game}`);
  }
  if (fullSanitized.lineups.status_label !== "resmi") {
    throw new Error("Lineup terkonfirmasi seharusnya status_label: resmi");
  }

  // Kasus 3: Payload dengan venue sebagai Object (seperti yang dikirim TheStatsAPI)
  const venueObjectRaw = {
    matchRes: {
      data: {
        id: 99903,
        utc_date: new Date().toISOString(),
        status: "scheduled",
        competition_name: "Premier League",
        venue: { id: 45, name: "Emirates Stadium", city: "London" },
        home_team: { id: 101, name: "Arsenal" },
        away_team: { id: 102, name: "Chelsea" },
      },
    },
  };
  const venueSanitized = validateAndSanitizeMatchData(venueObjectRaw);
  console.log("\n[Test 3] Hasil Sanitasi Match dengan Venue Object:");
  console.log(`- Venue terformat: ${venueSanitized.pertandingan.venue}`);
  if (venueSanitized.pertandingan.venue !== "Emirates Stadium, London") {
    throw new Error(`Venue diharapkan 'Emirates Stadium, London', didapat: ${venueSanitized.pertandingan.venue}`);
  }

  console.log("\n✅ ALL DATA VALIDATOR TESTS PASSED 100%!");
}

runTests();
