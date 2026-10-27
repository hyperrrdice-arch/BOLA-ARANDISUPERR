/**
 * TEST FALLBACK GUARD (Task 1 parlay-pivot) — deterministik, tanpa LLM/network.
 *
 * Replay READ-ONLY dari data/analysis_snapshots.db (SELECT saja, JANGAN tulis):
 *  - #123 Sporting vs LASK      (away fallback, 0 xG, bobot 0.222, +EV 39.5%) → guard SKIP
 *  - #128 Inter vs Shakhtar     (away fallback, 0 xG, bobot 0.125, +EV 72.1%) → lolos + peringatan
 *    (edge 0.7212 ≥ FALLBACK_MIN_EDGE 0.50 — aturan owner; bukan headline diam-diam)
 *  - #125 Bayern vs Arsenal     (kalibrasi penuh dua sisi) → pick tidak berubah
 *  - #127 Brugge vs Lens        (kalibrasi penuh dua sisi) → pick tidak berubah
 *  - Guard prob/fair identik: guard tidak menghitung ulang quant (purity + determinisme).
 *
 * Jalankan: npx.cmd tsx scripts/test-fallback-guard.ts
 */
import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

// Load .env.local dulu, fallback dummy (test ini murni lokal, tanpa network).
const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.trim().match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2].trim();
    }
  }
}
if (!process.env.NINE_ROUTER_API_KEY) process.env.NINE_ROUTER_API_KEY = "test-tanpa-network";
if (!process.env.NINE_ROUTER_BASE_URL) process.env.NINE_ROUTER_BASE_URL = "http://localhost:20128/v1";

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

async function main() {
  console.log("=== TEST FALLBACK GUARD ===\n");

  const {
    FALLBACK_MIN_EDGE,
    isFallbackSide,
    detectFallbackSource,
    topPositiveEvPick,
    guardEdgeOf,
    applyFallbackGuard,
  } = await import("../lib/quant/fallback-guard");
  const { mapPipelineToView } = await import("../lib/view/analysis-view");
  const { AnalysisSchema } = await import("../lib/agent/schemas");
  const { buildQuantPackage } = await import("../lib/agent/planner");

  // ---- 1. Konstanta + deteksi unit ----
  console.log("KONSTANTA & DETEKSI:");
  assert(FALLBACK_MIN_EDGE === 0.5, `FALLBACK_MIN_EDGE = 0.50 (${FALLBACK_MIN_EDGE})`);
  assert(isFallbackSide("fallback", 5, 0.9) === true, 'source "fallback" → true walau sampel/bobot bagus');
  assert(isFallbackSide("primary_league", 0, 0.222) === true, "0 xG + bobot 0.222<0.25 → true");
  assert(isFallbackSide("primary_league", 0, 0.429) === false, "0 xG + bobot 0.429 → false");
  assert(isFallbackSide("primary_league", 6, 0.429) === false, "6 xG + bobot 0.429 → false");
  assert(isFallbackSide(undefined, undefined, undefined) === false, "metadata absen → false (tidak over-block)");
  assert(isFallbackSide("second_division_promoted", 0, 0.1) === true, "promosi + 0 xG + bobot 0.1 → true");
  assert(Math.abs((guardEdgeOf({ expected_value: null, ev_percentage: "+39.5%", is_positive_ev: true }) ?? 0) - 0.395) < 1e-9, "edge parse dari ev_percentage '+39.5%' → 0.395");
  assert(guardEdgeOf({ expected_value: 0.7212, ev_percentage: "+72.1%", is_positive_ev: true }) === 0.7212, "edge utamakan expected_value angka (0.7212)");

  // ---- 2. Replay DB read-only ----
  console.log("REPLAY DB (read-only):");
  const dbPath = path.join(process.cwd(), "data", "analysis_snapshots.db");
  assert(fs.existsSync(dbPath), `DB snapshot ada (${dbPath})`);
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true } as any);
  } catch {
    db = new DatabaseSync(dbPath);
  }
  const load = (id: number) => {
    const row = db.prepare(
      "SELECT snapshot_id, home_team, away_team, value_bets_json, view_json FROM analysis_snapshots WHERE snapshot_id = ?"
    ).get(id) as any;
    const vb = JSON.parse(row.value_bets_json || "[]");
    const view = JSON.parse(row.view_json);
    return {
      id, home: row.home_team, away: row.away_team,
      valueBets: vb,
      calibration: view?.kuantitatif?.detail?.metode?.calibration_metadata ?? null,
      verdict: String(view?.ringkasan?.verdict ?? ""),
      hero: view?.kuantitatif?.hero ?? null,
    };
  };
  const s123 = load(123);
  const s128 = load(128);
  const s125 = load(125);
  const s127 = load(127);
  assert(s123.home === "Sporting" && s123.away === "LASK", "#123 Sporting vs LASK ketemu");
  assert(s128.home === "Inter" && s128.away === "Shakhtar Donetsk", "#128 Inter vs Shakhtar ketemu");
  assert(s125.home === "FC Bayern München" && s125.away === "Arsenal", "#125 Bayern vs Arsenal ketemu");
  assert(s127.home === "Club Brugge KV" && s127.away === "RC Lens", "#127 Brugge vs Lens ketemu");

  // Bentuk data sesuai konteks 9 run: away fallback + 0 xG + bobot<0.25.
  assert(
    s123.calibration?.away_source === "fallback" &&
      s123.calibration?.observed_xg_samples?.away === 0 &&
      (s123.calibration?.shrinkage_weights?.away ?? 1) < 0.25,
    `#123 away fallback/0xG/bobot ${s123.calibration?.shrinkage_weights?.away}`
  );
  assert(
    s128.calibration?.away_source === "fallback" &&
      s128.calibration?.observed_xg_samples?.away === 0 &&
      (s128.calibration?.shrinkage_weights?.away ?? 1) < 0.25,
    `#128 away fallback/0xG/bobot ${s128.calibration?.shrinkage_weights?.away}`
  );

  // #123: edge +39.5% < 50% → SKIP, pick lama tercatat.
  const g123 = applyFallbackGuard({
    calibration: s123.calibration, valueBets: s123.valueBets,
    verdict: s123.verdict, homeTeam: s123.home, awayTeam: s123.away,
  });
  const top123 = topPositiveEvPick(s123.valueBets);
  assert(Math.abs((guardEdgeOf(top123) ?? 0) - 0.3948) < 1e-4, `#123 top EV 0.3948 (<0.50)`);
  assert(g123.data_quality.is_fallback_involved === true, "#123 fallback terdeteksi (away)");
  assert(applyFallbackGuard && g123.fallback_guard.fallback_side === "away", "#123 sisi fallback = away");
  assert(g123.fallback_guard.skipped === true, "#123 guard SKIP");
  assert(g123.verdict.startsWith("SKIP"), "#123 verdict diawali SKIP");
  assert(
    String(g123.fallback_guard.original_pick?.selection ?? "").includes("LASK"),
    "#123 pick lama (LASK) tercatat di fallback_guard.original_pick"
  );
  assert(g123.fallback_guard.original_verdict === s123.verdict, "#123 verdict asli tersimpan di original_verdict");
  assert(g123.data_quality.home_source === "primary_league" && g123.data_quality.away_source === "fallback", "#123 data_quality {primary_league, fallback}");

  // #128: edge +72.1% ≥ 50% → LOLOS tapi wajib peringatan 1 kalimat, bukan headline diam-diam.
  const g128 = applyFallbackGuard({
    calibration: s128.calibration, valueBets: s128.valueBets,
    verdict: s128.verdict, homeTeam: s128.home, awayTeam: s128.away,
  });
  const top128 = topPositiveEvPick(s128.valueBets);
  assert(Math.abs((guardEdgeOf(top128) ?? 0) - 0.7212) < 1e-4, `#128 top EV 0.7212 (≥0.50 → lolos + warning)`);
  assert(g128.data_quality.is_fallback_involved === true, "#128 fallback terdeteksi (away)");
  assert(g128.fallback_guard.skipped === false, "#128 tidak di-SKIP (edge ≥ ambang)");
  assert(g128.verdict.includes("Peringatan kualitas data"), "#128 verdict cantumkan peringatan kualitas data");
  assert(g128.verdict.includes("Shakhtar"), "#128 pick asli tidak dihapus diam-diam");
  const warning = g128.verdict.slice(g128.verdict.indexOf("Peringatan kualitas data"));
  const warningNoNums = warning.replace(/\d+\.\d+/g, "");
  assert((warningNoNums.match(/\./g) || []).length === 1, "#128 peringatan tepat 1 kalimat");
  assert(g128.verdict.startsWith(s128.verdict), "#128 verdict asli utuh di depan + warning ditempel");

  // #125/#127: dua sisi terkalibrasi → guard tidak mengubah apa pun.
  for (const [s, label] of [[s125, "#125"], [s127, "#127"]] as const) {
    const det = detectFallbackSource(s.calibration);
    const g = applyFallbackGuard({
      calibration: s.calibration, valueBets: s.valueBets,
      verdict: s.verdict, homeTeam: s.home, awayTeam: s.away,
    });
    assert(det.involved === false, `${label} bersih (dua sisi primary, 6 xG)`);
    assert(g.fallback_guard.skipped === false && g.data_quality.is_fallback_involved === false, `${label} guard tidak menembak`);
    assert(g.verdict === s.verdict, `${label} verdict & pick tidak berubah`);
  }

  // Guard purity: input tidak dimutasi + tidak ada angka prob/fair di output guard.
  const frozen = JSON.stringify({ c: s123.calibration, v: s123.valueBets });
  applyFallbackGuard({ calibration: s123.calibration, valueBets: s123.valueBets, verdict: s123.verdict });
  assert(JSON.stringify({ c: s123.calibration, v: s123.valueBets }) === frozen, "guard tidak memutasi calibration/value_bets");
  assert(!("prob_home_win" in g123.fallback_guard) && !("fair_odds" in g123.fallback_guard), "output guard tak bawa prob/fair (display/verdict only)");

  // ---- 3. Integrasi mapper (AnalysisView additive) ----
  console.log("INTEGRASI MAPPER:");
  const buildFixture = (o: {
    home: string; away: string; verdict: string; market: string;
    probHome: number; probDraw: number; probAway: number;
    fairHome: number; fairDraw: number; fairAway: number;
    calibration: Record<string, unknown>; valueBets: any[];
  }) => ({
    pertandingan: { id: "mt_guard", tim_kandang: o.home, tim_tamu: o.away, waktu: "2026-10-21T19:00:00Z", kompetisi: "UEFA Champions League", venue: "Stadion", wasit: null },
    wasit_analisis: { nama: null, rata_rata_kartu: null, total_kartu_kuning: null, total_kartu_merah: null, level_ketegasan: "tidak diketahui" as const, catatan: "-" },
    taktik_dan_lineup: { formasi_kandang: null, formasi_tamu: null, status_lineup: "belum_tersedia" as const, starting_xi_kandang: [], starting_xi_tamu: [], ulasan_benturan_taktik: "-" },
    coverage_liga: { has_xg: true, has_odds: true, has_shotmap: false, has_player_stats: false },
    form_dan_split: { form_kandang: "-", form_tamu: "-", rekor_kandang_spesifik: "-", rekor_tandang_spesifik: "-" },
    klasemen: "-",
    bursa_pasar: { ringkasan_1x2: "-", asian_handicap: null, over_under: null, btts: null, pergerakan_smart_money: "-" },
    probabilitas_pasar: null,
    statistik_mendalam: { shot_quality: { npxg_kandang: null, npxg_tamu: null, catatan: "-" }, pemain_kunci: [] },
    faktor_kunci: [],
    prediksi: { hasil: "X", keyakinan: "sedang" as const, alasan: "-", konsensus_panel: "-" },
    quant_engine: {
      dixon_coles: {
        lambda_home_xg: 2.0, mu_away_xg: 0.8,
        prob_home_win: o.probHome, prob_draw: o.probDraw, prob_away_win: o.probAway,
        fair_odds: { home: o.fairHome, draw: o.fairDraw, away: o.fairAway },
        over_2_5_prob: 0.5, btts_yes_prob: 0.5, expected_total_goals: 2.8, top_scorelines: [],
      },
      vig_stripping: null,
      value_bets: o.valueBets,
      calibration_metadata: o.calibration,
    },
    syndicate_debate: {
      bull_case: { model: "m", thesis: "t", key_drivers: ["d"], tactical_edge: "e" },
      bear_case: { model: "m", thesis: "t", trap_warnings: ["w"], vulnerability_audit: "a" },
      dual_judgement: {
        judgement_1: { model: "m", title: "J1", verdict_summary: "v", confidence_tier: "B_MODERATE" as const, recommended_market: o.market, key_reasoning: "k" },
        judgement_2: { model: "m", title: "J2", verdict_summary: "v", confidence_tier: "B_MODERATE" as const, recommended_market: o.market, alternative_perspective: "a" },
        consensus_level: "CONCURRING" as const,
        supreme_verdict: o.verdict,
        final_recommended_market: o.market,
        final_confidence_tier: "B_MODERATE" as const,
        final_stake_fraction: "1.5%",
      },
      arbiter_verdict: { model: "m", chief_risk_officer_synthesis: "s", confidence_tier: "B_MODERATE" as const, recommended_market: o.market, recommended_stake_fraction: "1.5%" },
    },
    data_tidak_tersedia: [],
    data_integrity_audit: { is_strictly_grounded: true, dispatcher_model: "t", cache_quota_saved: 0, endpoints_called: [], endpoints_skipped: [] },
  });

  const mkBets = (sel: string, ev: number, odds: number, fair: number) => ([
    { market_name: "1X2", selection: sel, bookmaker_odds: odds, fair_odds: fair, expected_value: ev, ev_percentage: `+${Math.round(ev * 1000) / 10}%`, is_positive_ev: ev > 0, edge_rating: "EXCELLENT", recommended_stake_percentage: 1, rationale: "r" },
  ]);
  const calFallback = (w: number) => ({
    is_calibrated: true, div: "UCL", league_name: "UEFA Champions League",
    home_source: "primary_league", away_source: "fallback",
    shrinkage_weights: { home: 0.429, away: w },
    telemetry_source: { home: "thestats_observed_xg", away: "thestats_observed_goals" },
    observed_xg_samples: { home: 6, away: 0 },
  });
  const calClean = {
    is_calibrated: true, div: "UCL", league_name: "UEFA Champions League",
    home_source: "primary_league", away_source: "primary_league",
    shrinkage_weights: { home: 0.429, away: 0.429 },
    telemetry_source: { home: "thestats_observed_xg", away: "thestats_observed_xg" },
    observed_xg_samples: { home: 6, away: 6 },
  };

  const fx123 = buildFixture({
    home: "Sporting", away: "LASK", verdict: "HEADLINE: 1X2 Away (LASK)", market: "1X2 Away (LASK)",
    probHome: 0.7311, probDraw: 0.1422, probAway: 0.1268, fairHome: 1.37, fairDraw: 7.03, fairAway: 7.89,
    calibration: calFallback(0.222), valueBets: mkBets("LASK Menang", 0.3948, 11, 7.89),
  });
  assert(AnalysisSchema.safeParse(fx123).success, "fixture #123-like valid AnalysisSchema");
  const v123 = mapPipelineToView({ analisis: fx123 as any });
  assert(v123.ringkasan.verdict.startsWith("SKIP"), "mapper #123-like → verdict SKIP");
  assert(v123.fallback_guard?.skipped === true, "mapper #123-like → fallback_guard.skipped");
  assert(v123.fallback_guard?.original_pick?.selection === "LASK Menang", "mapper #123-like → pick lama tercatat");
  assert(v123.data_quality?.is_fallback_involved === true, "mapper #123-like → data_quality flag");
  assert(v123.kuantitatif.hero.prob.away === 0.1268 && v123.kuantitatif.hero.fair_odds.away === 7.89, "mapper #123-like → prob/fair copy 1:1 (tak tersentuh guard)");
  assert(v123.kuantitatif.detail.kelly.tabel[0]?.ev_percentage === "+39.5%", "mapper #123-like → tabel Kelly utuh");

  const fx128 = buildFixture({
    home: "Inter", away: "Shakhtar Donetsk", verdict: "HEADLINE: 1X2 Shakhtar Donetsk Menang", market: "1X2 Shakhtar",
    probHome: 0.7404, probDraw: 0.1272, probAway: 0.1324, fairHome: 1.35, fairDraw: 7.86, fairAway: 7.55,
    calibration: calFallback(0.125), valueBets: mkBets("Shakhtar Donetsk Menang", 0.7212, 13, 7.55),
  });
  const v128 = mapPipelineToView({ analisis: fx128 as any });
  assert(v128.fallback_guard?.skipped === false, "mapper #128-like → tidak SKIP");
  assert(v128.ringkasan.verdict.includes("Peringatan kualitas data"), "mapper #128-like → warning 1 kalimat");
  assert(v128.kuantitatif.hero.prob.away === 0.1324, "mapper #128-like → prob tak tersentuh");

  const fxClean = buildFixture({
    home: "FC Bayern München", away: "Arsenal", verdict: "HEADLINE: 1X2 Bayern Menang", market: "1X2 Bayern",
    probHome: 0.5408, probDraw: 0.2098, probAway: 0.2494, fairHome: 1.85, fairDraw: 4.77, fairAway: 4.01,
    calibration: calClean, valueBets: mkBets("FC Bayern München Menang", 0.1627, 2.15, 1.85),
  });
  const vClean = mapPipelineToView({ analisis: fxClean as any });
  assert(vClean.ringkasan.verdict === "HEADLINE: 1X2 Bayern Menang", "mapper bersih → verdict utuh");
  assert(vClean.fallback_guard?.skipped === false && vClean.data_quality?.is_fallback_involved === false, "mapper bersih → flag false");

  // ---- 4. Guard angka: quant deterministik, guard tak mengubah hitungan ----
  console.log("GUARD ANGKA:");
  const intelQ: any = {
    pertandingan: { id: "mo_guard", tim_kandang: "Liverpool", tim_tamu: "Borussia Dortmund", waktu: "2026-10-20T19:00:00Z", kompetisi: "UEFA Champions League", venue: "Anfield", wasit: "", kickoff_jam_menuju: 48 },
    wasit_detail: { is_available: false, name: "", country: "", games: 0, yellow_cards: 0, red_cards: 0, avg_yellow_per_game: null, strictness_level: "tidak diketahui" },
    lineups: { is_available: false, confirmed: false, status_label: "belum_tersedia", home_formation: "", away_formation: "", home_starting_xi: [], away_starting_xi: [] },
    h2h_history: { is_available: false, sample_size: 0, summary: "", recent_meetings: [] },
    form_split: { home_form_summary: "", away_form_summary: "", home_goals_avg: 2.1, away_goals_avg: 1.1, home_form_sample_size: 0, away_form_sample_size: 0 },
    injuries: { is_available: false, home_injuries: [], away_injuries: [] },
    market_odds: { is_available: true, home_last: 2.1, draw_last: 3.5, away_last: 3.4, total_goals_over_2_5: 1.9 },
    missing_data_registry: [],
    is_strictly_grounded: true,
  };
  const q1 = buildQuantPackage(intelQ, "2026-10-18");
  const q2 = buildQuantPackage(intelQ, "2026-10-18");
  assert(q1.dcOutput.prob_home_win === q2.dcOutput.prob_home_win, "quant deterministik (prob_home_win identik 2x run)");
  assert(JSON.stringify(q1.dcOutput.fair_odds) === JSON.stringify(q2.dcOutput.fair_odds), "quant deterministik (fair_odds identik 2x run)");
  assert(JSON.stringify(q1.quantPackage.value_bets) === JSON.stringify(q2.quantPackage.value_bets), "quant deterministik (value_bets identik 2x run)");
  // Guard di atas hasil quant tidak mengubah angka: hero view == angka engine.
  const fxQ = buildFixture({
    home: "Liverpool", away: "Borussia Dortmund", verdict: "HEADLINE: X", market: "X",
    probHome: q1.dcOutput.prob_home_win, probDraw: q1.dcOutput.prob_draw, probAway: q1.dcOutput.prob_away_win,
    fairHome: q1.dcOutput.fair_odds.home, fairDraw: q1.dcOutput.fair_odds.draw, fairAway: q1.dcOutput.fair_odds.away,
    calibration: q1.quantPackage.calibration_metadata as Record<string, unknown>,
    valueBets: q1.quantPackage.value_bets as any[],
  });
  const vQ = mapPipelineToView({ analisis: fxQ as any });
  assert(
    vQ.kuantitatif.hero.prob.home === q1.dcOutput.prob_home_win &&
      vQ.kuantitatif.hero.fair_odds.away === q1.dcOutput.fair_odds.away,
    "hero view == angka engine (guard tak hitung ulang)"
  );

  try { db.close(); } catch {}

  console.log(`\n=== ${passed} lulus, ${failed} gagal ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("TEST GAGAL:", err);
  process.exit(1);
});
