/**
 * RUNNABLE CHECK — Task 3 todo-offline-depth.md: momentum last-3 vs matches 4-6.
 *
 * Memeriksa:
 *  1. 3 tim contoh (Liverpool naik, Dortmund turun, Palace datar) cocok
 *     hitungan manual dari DB (SQL independen — bukan memanggil modul yang diuji).
 *  2. Tier INSUFFICIENT_DATA + null-jujur (bukan 0) saat <4 log (tanpa baseline).
 *  3. Batas label NAIK / TURUN / DATAR + batas tier (unit murni).
 *  4. GUARD: prob/fair Dixon-Coles tak berubah (konteks only) —
 *     buildQuantPackage vs hitung-ulang langsung + mapper hanya tukar 1 baris
 *     bukti paling redundan (tetap ≤5), hero/prob utuh.
 *
 * Jalankan: npx.cmd tsx scripts/test-momentum.ts
 */
import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

// Load .env.local sebelum module lib yang butuh env di-import (pola test-value-bets)
const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.trim().match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2].trim();
    }
  }
}

import {
  getTeamMomentum,
  labelMomentumDelta,
  tierForMomentumSamples,
  formatMomentumEvidenceRow,
  formatMomentumMatchupParagraph,
} from "../lib/quant/momentum";

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

// Cutoff tetap supaya deterministik terhadap snapshot DB (bukan tanggal hari ini).
const CUTOFF = "2026-10-18";
const r2 = (x: number) => Number(x.toFixed(2));

/** Hitungan manual independen: SQL mentah + rata-rata tangan, tanpa modul yang diuji. */
function manualMomentum(teamId: string) {
  const db = new DatabaseSync(path.join(process.cwd(), "data", "thestats_dataset.db"));
  const rows = db
    .prepare(
      `SELECT goals_for, xg_for FROM team_match_logs
       WHERE team_id = ? AND match_date < ? ORDER BY match_date DESC LIMIT 6`
    )
    .all(teamId, CUTOFF) as any[];
  const recent = rows.slice(0, 3);
  const older = rows.slice(3);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const gR = r2(avg(recent.map((r) => r.goals_for)));
  const gO = r2(avg(older.map((r) => r.goals_for)));
  const dG = r2(avg(recent.map((r) => r.goals_for)) - avg(older.map((r) => r.goals_for)));
  const xR = recent.filter((r) => r.xg_for != null);
  const xO = older.filter((r) => r.xg_for != null);
  const xgR = xR.length > 0 ? r2(avg(xR.map((r) => r.xg_for))) : null;
  const xgO = xO.length > 0 ? r2(avg(xO.map((r) => r.xg_for))) : null;
  const dX = xR.length > 0 && xO.length > 0 ? r2(avg(xR.map((r) => r.xg_for)) - avg(xO.map((r) => r.xg_for))) : null;
  return { n: rows.length, gR, gO, dG, xgR, xgO, dX, xgN: `${xR.length}:${xO.length}` };
}

async function main() {
  console.log("=== TEST MOMENTUM (last-3 vs matches 4-6) ===\n");

  // ---- 1. Tiga arah contoh vs hitungan manual DB ----
  console.log("VERIFIKASI MANUAL DARI DB:");
  const livId = "tm_0406"; // Liverpool (naik)
  const dorId = "tm_51366"; // Borussia Dortmund (turun)
  const cryId = "tm_3498"; // Crystal Palace (datar)
  const mLiv = manualMomentum(livId);
  const mDor = manualMomentum(dorId);
  const mCry = manualMomentum(cryId);
  console.log(`  manual Liverpool: n=${mLiv.n} gol ${mLiv.gR} vs ${mLiv.gO} d=${mLiv.dG} xg d=${mLiv.dX}`);
  console.log(`  manual Dortmund: n=${mDor.n} gol ${mDor.gR} vs ${mDor.gO} d=${mDor.dG} xg d=${mDor.dX}`);
  console.log(`  manual Palace: n=${mCry.n} gol ${mCry.gR} vs ${mCry.gO} d=${mCry.dG} xg d=${mCry.dX}`);

  const liv = getTeamMomentum(livId, 6, CUTOFF);
  const dor = getTeamMomentum(dorId, 6, CUTOFF);
  const cry = getTeamMomentum(cryId, 6, CUTOFF);

  assert(liv.sample_size === mLiv.n && liv.recent_sample === 3 && liv.older_sample === 3, `Liverpool window 3v3 (${mLiv.n} log)`);
  assert(liv.avg_goals_recent === mLiv.gR && liv.avg_goals_older === mLiv.gO, `Liverpool gol ${mLiv.gR} vs ${mLiv.gO}`);
  assert(liv.delta_goals === mLiv.dG, `Liverpool delta = hitungan manual (${mLiv.dG})`);
  assert(liv.avg_goals_recent === 2.67, "Liverpool recent tepat 2.67");
  assert(liv.avg_goals_older === 1.0, "Liverpool older tepat 1.00");
  assert(liv.delta_goals === 1.67, "Liverpool delta tepat +1.67");
  assert(liv.delta_xg === mLiv.dX && liv.delta_xg === 0.38, "Liverpool xG delta tepat +0.38 (konfirmasi)");
  assert(liv.direction === "NAIK", "Liverpool arah NAIK");
  assert(liv.magnitude === 1.67, "Liverpool magnitude 1.67");
  assert(liv.confidence_tier === "HIGH", "Liverpool tier HIGH (3v3)");

  assert(dor.delta_goals === mDor.dG, `Dortmund delta = hitungan manual (${mDor.dG})`);
  assert(dor.avg_goals_recent === 0.67, "Dortmund recent tepat 0.67");
  assert(dor.avg_goals_older === 2.33, "Dortmund older tepat 2.33");
  assert(dor.delta_goals === -1.67, "Dortmund delta tepat -1.67");
  assert(dor.delta_xg === mDor.dX && dor.delta_xg === -0.49, "Dortmund xG delta tepat -0.49 (konfirmasi)");
  assert(dor.direction === "TURUN", "Dortmund arah TURUN");
  assert(dor.magnitude === 1.67, "Dortmund magnitude 1.67");
  assert(dor.confidence_tier === "HIGH", "Dortmund tier HIGH (3v3)");

  assert(cry.delta_goals === mCry.dG, `Palace delta = hitungan manual (${mCry.dG})`);
  assert(cry.avg_goals_recent === 1.67, "Palace recent tepat 1.67");
  assert(cry.avg_goals_older === 1.33, "Palace older tepat 1.33");
  assert(cry.delta_goals === 0.33, "Palace delta tepat +0.33 (mentah 1/3, bukan artefak tampil 1.67-1.33)");
  assert(cry.direction === "DATAR", "Palace arah DATAR (|+0.33| < 0.34)");
  assert(cry.magnitude === 0.33, "Palace magnitude 0.33");
  assert(cry.confidence_tier === "HIGH", "Palace tier HIGH (3v3)");

  // ---- 2. Tier tipis: INSUFFICIENT_DATA + null-jujur ----
  console.log("TIER TIPIS (null-jujur, bukan 0):");
  const thin = getTeamMomentum("tm_00453", 6, CUTOFF);
  console.log(`  tim tipis tm_00453: sample=${thin.sample_size}`);
  assert(thin.sample_size < 4, `tim tipis terpantau tipis (${thin.sample_size} log)`);
  assert(thin.confidence_tier === "INSUFFICIENT_DATA", "tim tipis → tier INSUFFICIENT_DATA");
  assert(thin.direction === "INSUFFICIENT_DATA", "tim tipis → direction INSUFFICIENT_DATA");
  assert(
    thin.avg_goals_recent === null && thin.avg_goals_older === null &&
      thin.delta_goals === null && thin.delta_xg === null && thin.magnitude === null,
    "tim tipis → angka null (DILARANG imputasi 0)"
  );
  assert(thin.is_estimated === true, "tim tipis → is_estimated true");
  const ghost = getTeamMomentum("Klub Fiktif ZZ Top", 6, CUTOFF);
  assert(
    ghost.confidence_tier === "INSUFFICIENT_DATA" && ghost.delta_goals === null && ghost.sample_size === 0,
    "tim tak dikenal → INSUFFICIENT_DATA tanpa throw, sample_size 0"
  );

  // ---- 3. Batas label + tier (unit murni) ----
  console.log("BATAS LABEL & TIER:");
  assert(labelMomentumDelta(1.67) === "NAIK", "delta +1.67 → NAIK");
  assert(labelMomentumDelta(0.34) === "NAIK", "delta tepat +0.34 → NAIK");
  assert(labelMomentumDelta(0.33) === "DATAR", "delta +0.33 → DATAR");
  assert(labelMomentumDelta(0) === "DATAR", "delta 0 → DATAR");
  assert(labelMomentumDelta(-0.33) === "DATAR", "delta -0.33 → DATAR");
  assert(labelMomentumDelta(-0.34) === "TURUN", "delta tepat -0.34 → TURUN");
  assert(labelMomentumDelta(-1.67) === "TURUN", "delta -1.67 → TURUN");
  assert(labelMomentumDelta(NaN) === "DATAR", "delta NaN → DATAR (bukan throw)");
  assert(tierForMomentumSamples(0).confidence_tier === "INSUFFICIENT_DATA", "tier n=0 → INSUFFICIENT_DATA");
  assert(tierForMomentumSamples(3).confidence_tier === "INSUFFICIENT_DATA", "tier n=3 → INSUFFICIENT_DATA (tanpa baseline)");
  assert(tierForMomentumSamples(4).confidence_tier === "LOW", "tier n=4 (3v1) → LOW");
  assert(tierForMomentumSamples(5).confidence_tier === "MODERATE", "tier n=5 (3v2) → MODERATE");
  assert(tierForMomentumSamples(6).confidence_tier === "HIGH", "tier n=6 (3v3) → HIGH");

  // ---- 4a. GUARD: buildQuantPackage vs hitung-ulang langsung ----
  console.log("GUARD PROB/FAIR TAK BERUBAH:");
  const { buildQuantPackage } = await import("../lib/agent/planner");
  const { getShrunkMatchParameters, calculateDixonColes } = await import("../lib/quant");
  const { getTeamRollingTelemetry } = await import("../lib/db/team-telemetry");
  const intel: any = {
    pertandingan: {
      id: "mo_test_1",
      tim_kandang: "Liverpool",
      tim_tamu: "Borussia Dortmund",
      waktu: "2026-10-20T19:00:00Z",
      kompetisi: "UEFA Champions League",
      venue: "Anfield",
      wasit: "",
      kickoff_jam_menuju: 48,
    },
    wasit_detail: { is_available: false, name: "", country: "", games: 0, yellow_cards: 0, red_cards: 0, avg_yellow_per_game: null, strictness_level: "tidak diketahui" },
    lineups: { is_available: false, confirmed: false, status_label: "belum_tersedia", home_formation: "", away_formation: "", home_starting_xi: [], away_starting_xi: [] },
    h2h_history: { is_available: false, sample_size: 0, summary: "", recent_meetings: [] },
    form_split: { home_form_summary: "", away_form_summary: "", home_goals_avg: 2.1, away_goals_avg: 1.1, home_form_sample_size: 0, away_form_sample_size: 0 },
    injuries: { is_available: false, home_injuries: [], away_injuries: [] },
    market_odds: { is_available: false, home_last: null, draw_last: null, away_last: null, total_goals_over_2_5: null },
    missing_data_registry: ["lineups", "h2h", "injuries"],
    is_strictly_grounded: true,
  };
  const bundle = buildQuantPackage(intel, CUTOFF);
  const homeTelem = getTeamRollingTelemetry("Liverpool", 6, CUTOFF);
  const awayTelem = getTeamRollingTelemetry("Borussia Dortmund", 6, CUTOFF);
  const shrunk = getShrunkMatchParameters({
    homeTeam: "Liverpool",
    awayTeam: "Borussia Dortmund",
    leagueHint: "UEFA Champions League",
    liveHomeFormGoalsAvg: 2.1,
    liveAwayFormGoalsAvg: 1.1,
    homeSampleN: 0,
    awaySampleN: 0,
    homeTelemetry: homeTelem.sample_size > 0 ? homeTelem : undefined,
    awayTelemetry: awayTelem.sample_size > 0 ? awayTelem : undefined,
    matchDateCutoff: CUTOFF,
  });
  const dc = calculateDixonColes({
    homeAttack: shrunk.homeAttack,
    homeDefense: shrunk.homeDefense,
    awayAttack: shrunk.awayAttack,
    awayDefense: shrunk.awayDefense,
    homeAdvantage: shrunk.homeAdvantage,
    leagueAvgGoals: shrunk.leagueAvgGoals,
    rho: shrunk.rho,
  });
  assert(bundle.dcOutput.prob_home_win === dc.prob_home_win, "prob_home_win identik hitung-ulang");
  assert(bundle.dcOutput.prob_draw === dc.prob_draw, "prob_draw identik hitung-ulang");
  assert(bundle.dcOutput.prob_away_win === dc.prob_away_win, "prob_away_win identik hitung-ulang");
  assert(
    JSON.stringify(bundle.dcOutput.fair_odds) === JSON.stringify(dc.fair_odds),
    "fair_odds identik hitung-ulang"
  );
  assert(
    bundle.quantPackage.dixon_coles.over_2_5_prob === dc.over_under.line_2_5.over &&
      bundle.quantPackage.dixon_coles.btts_yes_prob === dc.btts.yes,
    "over_2_5 / btts identik hitung-ulang"
  );
  assert(!("momentum" in bundle.quantPackage.dixon_coles), "momentum TIDAK bocor ke dixon_coles");
  assert(!("half_profile" in bundle.quantPackage.dixon_coles), "half_profile TIDAK bocor ke dixon_coles");
  assert(bundle.quantPackage.value_bets.length === 0, "tanpa odds → value_bets tetap kosong");
  assert(bundle.quantPackage.momentum.home.direction === "NAIK", "bundle bawa momentum home NAIK (konteks)");
  assert(bundle.quantPackage.momentum.away.direction === "TURUN", "bundle bawa momentum away TURUN (konteks)");

  // ---- 4b. GUARD mapper: hanya tukar 1 baris redundan, hero/prob utuh ----
  console.log("GUARD MAPPER (tukar 1 baris, tetap ≤5):");
  const { mapPipelineToView } = await import("../lib/view/analysis-view");
  const baseAnalisis: any = {
    pertandingan: { id: "mo_map_1", tim_kandang: "Liverpool", tim_tamu: "Borussia Dortmund", waktu: "2026-10-20T19:00:00Z", kompetisi: "UCL", venue: "Anfield", wasit: "" },
    prediksi: { hasil: "2-1", keyakinan: "sedang", alasan: "Uji mapper.", konsensus_panel: "CONCURRING" },
    faktor_kunci: ["Uji"],
    quant_engine: {
      dixon_coles: {
        lambda_home_xg: 1.8,
        mu_away_xg: 1.1,
        prob_home_win: 0.5,
        prob_draw: 0.26,
        prob_away_win: 0.24,
        fair_odds: { home: 2.0, draw: 3.85, away: 4.17 },
        over_2_5_prob: 0.55,
        btts_yes_prob: 0.52,
        expected_total_goals: 2.9,
        top_scorelines: [{ homeGoals: 2, awayGoals: 1, prob: 9.8 }],
      },
      vig_stripping: null,
      value_bets: [],
    },
    form_dan_split: {},
    data_integrity_audit: { is_strictly_grounded: true },
  };
  const viewA = mapPipelineToView({ analisis: baseAnalisis, plannerTrace: null });
  const viewM = mapPipelineToView({
    analisis: { ...baseAnalisis, quant_engine: { ...baseAnalisis.quant_engine, momentum: bundle.quantPackage.momentum } },
    plannerTrace: null,
  });
  assert(viewA.kuantitatif.bukti.length === 5 && viewM.kuantitatif.bukti.length === 5, "bukti tetap ≤5 sebelum & sesudah");
  assert(
    JSON.stringify(viewA.kuantitatif.hero) === JSON.stringify(viewM.kuantitatif.hero),
    "hero prob/fair mapper identik (tak tersentuh momentum)"
  );
  assert(viewA.kuantitatif.bukti[3].label === "Ekspektasi Total Gol", "tanpa momentum → baris 4 tetap Ekspektasi Total Gol");
  assert(viewM.kuantitatif.bukti[3].label === "Momentum (3 vs 3 Laga)", "momentum saja → tukar baris 4 (Ekspektasi Total Gol, redundan vs xG)");
  assert(
    String(viewM.kuantitatif.bukti[3].value).includes("Liverpool") &&
      String(viewM.kuantitatif.bukti[3].value).includes("Borussia Dortmund"),
    `isi baris menyebut kedua tim (${viewM.kuantitatif.bukti[3].value})`
  );
  for (const i of [0, 1, 2, 4]) {
    assert(
      JSON.stringify(viewA.kuantitatif.bukti[i]) === JSON.stringify(viewM.kuantitatif.bukti[i]),
      `baris bukti ${i} tak berubah`
    );
  }
  // Half + momentum bersamaan: half tetap di slot 4, momentum tukar slot 5.
  const viewHM = mapPipelineToView({
    analisis: {
      ...baseAnalisis,
      quant_engine: {
        ...baseAnalisis.quant_engine,
        half_profile: bundle.quantPackage.half_profile,
        momentum: bundle.quantPackage.momentum,
      },
    },
    plannerTrace: null,
  });
  assert(viewHM.kuantitatif.bukti.length === 5, "half+momentum → bukti tetap 5");
  assert(viewHM.kuantitatif.bukti[3].label === "Profil Babak (xG B1 vs B2)", "half+momentum → baris 4 tetap Profil Babak");
  assert(viewHM.kuantitatif.bukti[4].label === "Momentum (3 vs 3 Laga)", "half+momentum → baris 5 jadi Momentum (tukar Skor Paling Mungkin)");
  assert(
    JSON.stringify(viewA.kuantitatif.hero) === JSON.stringify(viewHM.kuantitatif.hero),
    "hero prob/fair identik walau 2 konteks tampil"
  );
  for (const i of [0, 1, 2]) {
    assert(
      JSON.stringify(viewA.kuantitatif.bukti[i]) === JSON.stringify(viewHM.kuantitatif.bukti[i]),
      `baris bukti ${i} tak berubah (half+momentum)`
    );
  }
  // Paragraf prompt: 1 paragraf (tanpa newline), null-jujur untuk tim tipis.
  const para = formatMomentumMatchupParagraph(bundle.quantPackage.momentum, "Liverpool", "Borussia Dortmund");
  assert(!para.includes("\n") && para.includes("NAIK") && para.includes("TURUN"), "paragraf prompt 1 baris + sebut kedua arah");
  const thinPara = formatMomentumMatchupParagraph({ home: thin, away: ghost }, "Tim Tipis", "Klub Fiktif");
  assert(thinPara.includes("tak cukup") && !thinPara.includes("↗") && !thinPara.includes("↘"), "paragraf tim tipis jujur tanpa panah arah");
  const rowNull = formatMomentumEvidenceRow({ home: thin, away: ghost });
  assert(rowNull === null, "kedua tim tipis → tanpa baris bukti (null, bukan karangan)");

  console.log(`\n=== ${passed} lulus, ${failed} gagal ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("TEST GAGAL:", err);
  process.exit(1);
});
