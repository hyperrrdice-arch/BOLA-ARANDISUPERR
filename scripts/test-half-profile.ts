/**
 * RUNNABLE CHECK — Task 2 todo-offline-depth.md: profil babak 1 vs 2.
 *
 * Memeriksa:
 *  1. 2 tim contoh (Barcelona, Aston Villa) cocok hitungan manual dari DB
 *     (SQL independen — bukan memanggil modul yang diuji).
 *  2. Tier INSUFFICIENT_DATA + null-jujur (bukan 0) saat <3 log berskor babak.
 *  3. Batas label SLOW_STARTER / SECOND_HALF_TEAM / FAST_STARTER / SEIMBANG.
 *  4. GUARD: prob/fair Dixon-Coles tak berubah (konteks only) —
 *     buildQuantPackage vs hitung-ulang langsung + mapper hanya tambah baris bukti.
 *
 * Jalankan: npx.cmd tsx scripts/test-half-profile.ts
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
  getTeamHalfProfile,
  labelHalfDiff,
  tierForHalfSamples,
  formatHalfEvidenceRow,
  formatHalfMatchupParagraph,
} from "../lib/quant/half-profile";

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
function manualHalfAvg(teamId: string) {
  const db = new DatabaseSync(path.join(process.cwd(), "data", "thestats_dataset.db"));
  const rows = db
    .prepare(
      `SELECT first_half_xg_for, second_half_xg_for, first_half_xg_against, second_half_xg_against
       FROM team_match_logs WHERE team_id = ? AND match_date < ? ORDER BY match_date DESC LIMIT 6`
    )
    .all(teamId, CUTOFF) as any[];
  const scored = rows.filter((r) => r.first_half_xg_for != null && r.second_half_xg_for != null);
  if (scored.length === 0) return { n: 0, total: rows.length, avgFh: null as number | null, avgSh: null as number | null, diff: null as number | null };
  const avgFh = r2(scored.reduce((a, r) => a + r.first_half_xg_for, 0) / scored.length);
  const avgSh = r2(scored.reduce((a, r) => a + r.second_half_xg_for, 0) / scored.length);
  return { n: scored.length, total: rows.length, avgFh, avgSh, diff: r2(avgSh - avgFh) };
}

async function main() {
  console.log("=== TEST HALF PROFILE (babak 1 vs 2) ===\n");

  // ---- 1. Dua tim contoh vs hitungan manual DB ----
  console.log("VERIFIKASI MANUAL DARI DB:");
  const barcaId = "tm_37445"; // Barcelona
  const villaId = "tm_1002"; // Aston Villa
  const mBarca = manualHalfAvg(barcaId);
  const mVilla = manualHalfAvg(villaId);
  console.log(`  manual Barcelona: n=${mBarca.n} fh=${mBarca.avgFh} sh=${mBarca.avgSh} diff=${mBarca.diff}`);
  console.log(`  manual Aston Villa: n=${mVilla.n} fh=${mVilla.avgFh} sh=${mVilla.avgSh} diff=${mVilla.diff}`);

  const barca = getTeamHalfProfile(barcaId, 6, CUTOFF);
  const villa = getTeamHalfProfile(villaId, 6, CUTOFF);

  assert(barca.observed_half_samples === mBarca.n, `Barcelona sampel = hitungan manual (${mBarca.n})`);
  assert(barca.avg_first_half_xg_for === mBarca.avgFh, `Barcelona B1 = ${mBarca.avgFh}`);
  assert(barca.avg_second_half_xg_for === mBarca.avgSh, `Barcelona B2 = ${mBarca.avgSh}`);
  assert(barca.diff_second_minus_first === mBarca.diff, `Barcelona selisih = ${mBarca.diff}`);
  assert(barca.avg_first_half_xg_for === 1.49, "Barcelona B1 tepat 1.49");
  assert(barca.avg_second_half_xg_for === 2.01, "Barcelona B2 tepat 2.01");
  assert(barca.diff_second_minus_first === 0.52, "Barcelona selisih tepat +0.52");
  assert(barca.label === "SECOND_HALF_TEAM", "Barcelona label SECOND_HALF_TEAM");
  assert(barca.confidence_tier === "MODERATE", "Barcelona tier MODERATE (5 sampel)");

  assert(villa.observed_half_samples === mVilla.n, `Villa sampel = hitungan manual (${mVilla.n})`);
  assert(villa.avg_first_half_xg_for === mVilla.avgFh, `Villa B1 = ${mVilla.avgFh}`);
  assert(villa.avg_second_half_xg_for === mVilla.avgSh, `Villa B2 = ${mVilla.avgSh}`);
  assert(villa.diff_second_minus_first === mVilla.diff, `Villa selisih = ${mVilla.diff}`);
  assert(villa.avg_first_half_xg_for === 1.28, "Villa B1 tepat 1.28");
  assert(villa.avg_second_half_xg_for === 0.84, "Villa B2 tepat 0.84");
  assert(villa.diff_second_minus_first === -0.44, "Villa selisih tepat -0.44");
  assert(villa.label === "FAST_STARTER", "Villa label FAST_STARTER");
  assert(villa.confidence_tier === "MODERATE", "Villa tier MODERATE (5 sampel)");

  // ---- 2. Tier tipis: INSUFFICIENT_DATA + null-jujur ----
  console.log("TIER TIPIS (null-jujur, bukan 0):");
  const thin = getTeamHalfProfile("FK Sutjeska Nikšić", 6, CUTOFF);
  assert(thin.observed_half_samples < 3, `tim tipis terpantau tipis (${thin.observed_half_samples} sampel)`);
  assert(thin.confidence_tier === "INSUFFICIENT_DATA", "tim tipis → tier INSUFFICIENT_DATA");
  assert(thin.label === "INSUFFICIENT_DATA", "tim tipis → label INSUFFICIENT_DATA");
  assert(
    thin.avg_first_half_xg_for === null &&
      thin.avg_second_half_xg_for === null &&
      thin.diff_second_minus_first === null,
    "tim tipis → angka null (DILARANG imputasi 0)"
  );
  assert(thin.is_estimated === true, "tim tipis → is_estimated true");
  const ghost = getTeamHalfProfile("Klub Fiktif ZZ Top", 6, CUTOFF);
  assert(
    ghost.confidence_tier === "INSUFFICIENT_DATA" && ghost.avg_first_half_xg_for === null && ghost.sample_size === 0,
    "tim tak dikenal → INSUFFICIENT_DATA tanpa throw, sample_size 0"
  );

  // ---- 3. Batas label + tier (unit murni) ----
  console.log("BATAS LABEL & TIER:");
  assert(labelHalfDiff(0.52) === "SECOND_HALF_TEAM", "diff +0.52 → SECOND_HALF_TEAM");
  assert(labelHalfDiff(0.35) === "SECOND_HALF_TEAM", "diff tepat +0.35 → SECOND_HALF_TEAM");
  assert(labelHalfDiff(0.21) === "SLOW_STARTER", "diff +0.21 → SLOW_STARTER");
  assert(labelHalfDiff(0.15) === "SLOW_STARTER", "diff tepat +0.15 → SLOW_STARTER");
  assert(labelHalfDiff(0.149) === "SEIMBANG", "diff +0.149 → SEIMBANG");
  assert(labelHalfDiff(0) === "SEIMBANG", "diff 0 → SEIMBANG");
  assert(labelHalfDiff(-0.11) === "SEIMBANG", "diff -0.11 → SEIMBANG");
  assert(labelHalfDiff(-0.15) === "FAST_STARTER", "diff tepat -0.15 → FAST_STARTER");
  assert(labelHalfDiff(-0.43) === "FAST_STARTER", "diff -0.43 → FAST_STARTER");
  assert(tierForHalfSamples(0).confidence_tier === "INSUFFICIENT_DATA", "tier n=0 → INSUFFICIENT_DATA");
  assert(tierForHalfSamples(2).confidence_tier === "INSUFFICIENT_DATA", "tier n=2 → INSUFFICIENT_DATA (<3)");
  assert(tierForHalfSamples(3).confidence_tier === "LOW", "tier n=3 → LOW");
  assert(tierForHalfSamples(5).confidence_tier === "MODERATE", "tier n=5 → MODERATE");
  assert(tierForHalfSamples(6).confidence_tier === "HIGH", "tier n=6 → HIGH");

  // ---- 4a. GUARD: buildQuantPackage vs hitung-ulang langsung ----
  console.log("GUARD PROB/FAIR TAK BERUBAH:");
  const { buildQuantPackage } = await import("../lib/agent/planner");
  const { getShrunkMatchParameters, calculateDixonColes } = await import("../lib/quant");
  const { getTeamRollingTelemetry } = await import("../lib/db/team-telemetry");
  const intel: any = {
    pertandingan: {
      id: "hp_test_1",
      tim_kandang: "Barcelona",
      tim_tamu: "Aston Villa",
      waktu: "2026-10-20T19:00:00Z",
      kompetisi: "UEFA Champions League",
      venue: "Camp Nou",
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
  const homeTelem = getTeamRollingTelemetry("Barcelona", 6, CUTOFF);
  const awayTelem = getTeamRollingTelemetry("Aston Villa", 6, CUTOFF);
  const shrunk = getShrunkMatchParameters({
    homeTeam: "Barcelona",
    awayTeam: "Aston Villa",
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
  assert(!("half_profile" in bundle.quantPackage.dixon_coles), "half_profile TIDAK bocor ke dixon_coles");
  assert(bundle.quantPackage.value_bets.length === 0, "tanpa odds → value_bets tetap kosong");
  assert(bundle.quantPackage.half_profile.home.label === "SECOND_HALF_TEAM", "bundle bawa half home (konteks)");
  assert(bundle.quantPackage.half_profile.away.label === "FAST_STARTER", "bundle bawa half away (konteks)");

  // ---- 4b. GUARD mapper: hanya tambah baris bukti, hero/prob utuh ----
  console.log("GUARD MAPPER (hanya tambah bukti):");
  const { mapPipelineToView } = await import("../lib/view/analysis-view");
  const baseAnalisis: any = {
    pertandingan: { id: "hp_map_1", tim_kandang: "Barcelona", tim_tamu: "Aston Villa", waktu: "2026-10-20T19:00:00Z", kompetisi: "UCL", venue: "Camp Nou", wasit: "" },
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
  const viewB = mapPipelineToView({
    analisis: { ...baseAnalisis, quant_engine: { ...baseAnalisis.quant_engine, half_profile: bundle.quantPackage.half_profile } },
    plannerTrace: null,
  });
  assert(viewA.kuantitatif.bukti.length === 5 && viewB.kuantitatif.bukti.length === 5, "bukti tetap ≤5 sebelum & sesudah");
  assert(
    JSON.stringify(viewA.kuantitatif.hero) === JSON.stringify(viewB.kuantitatif.hero),
    "hero prob/fair mapper identik (tak tersentuh half)"
  );
  assert(viewA.kuantitatif.bukti[3].label === "Ekspektasi Total Gol", "tanpa half → baris 4 tetap Ekspektasi Total Gol");
  assert(viewB.kuantitatif.bukti[3].label === "Profil Babak (xG B1 vs B2)", "dengan half → baris 4 jadi Profil Babak");
  assert(
    String(viewB.kuantitatif.bukti[3].value).includes("Barcelona") &&
      String(viewB.kuantitatif.bukti[3].value).includes("Aston Villa"),
    `isi baris menyebut kedua tim (${viewB.kuantitatif.bukti[3].value})`
  );
  for (const i of [0, 1, 2, 4]) {
    assert(
      JSON.stringify(viewA.kuantitatif.bukti[i]) === JSON.stringify(viewB.kuantitatif.bukti[i]),
      `baris bukti ${i} tak berubah`
    );
  }
  // Paragraf prompt: 1 paragraf (tanpa newline), null-jujur untuk tim tipis.
  const para = formatHalfMatchupParagraph(bundle.quantPackage.half_profile, "Barcelona", "Aston Villa");
  assert(!para.includes("\n") && para.includes("SECOND_HALF_TEAM") && para.includes("FAST_STARTER"), "paragraf prompt 1 baris + sebut kedua label");
  const thinPara = formatHalfMatchupParagraph({ home: thin, away: ghost }, "Sutjeska", "Klub Fiktif");
  assert(thinPara.includes("tak cukup") && !thinPara.includes("SECOND_HALF"), "paragraf tim tipis jujur tanpa label arah");
  const rowNull = formatHalfEvidenceRow({ home: thin, away: ghost });
  assert(rowNull === null, "kedua tim tipis → tanpa baris bukti (null, bukan karangan)");

  console.log(`\n=== ${passed} lulus, ${failed} gagal ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("TEST GAGAL:", err);
  process.exit(1);
});
