/**
 * RUNNABLE CHECK — Paket R1-only debate + voice-guide prompt upgrade.
 *
 * Memeriksa (tanpa network — tidak memanggil model/APi):
 *  1. Cap 1 ronde: pemanggilan debat ke-2 ditolak dengan pesan "sudah 1 ronde".
 *  2. J2 SEQUENTIAL: prompt J2 mengandung output J1 (verdict+market+tier+reasoning),
 *     J2 wajib eksplisit SETUJU/BANTAH + alasan + risiko yang dilewat J1.
 *  3. Tie-break SPLIT/DISSENT deterministik (resolver, logika verbatim Stage 3).
 *  4. Voice guide ter-inject di SEMUA prompt persona + editorial (prepend),
 *     kontrak JSON tetap PALING AKHIR.
 *  5. GUARD: prob/fair tak tersentuh (voice + R1 = prompt/display only).
 *
 * Jalankan: npx.cmd tsx scripts/test-debate-r1.ts
 */
import fs from "fs";
import path from "path";

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
// Kunci timeout dihapus supaya assert default deterministik walau .env.local mengesetnya.
delete process.env.SYNDICATE_PERSONA_TIMEOUT_MS;
delete process.env.SYNDICATE_JUDGE_TIMEOUT_MS;
delete process.env.SYNDICATE_RETRY_TIMEOUT_MS;
delete process.env.LLM_TIMEOUT_MS;

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

const VOICE_MARK = "SUARA ANALIS TONGKRONGAN";

async function main() {
  console.log("=== TEST DEBATE R1 + VOICE GUIDE ===\n");

  const orch = await import("../lib/syndicate-orchestrator");
  const { MODEL_TIMEOUT_MS, buildEditorialPrompts } = await import("../lib/agent/llm");
  const { VOICE_GUIDE } = await import("../lib/llm/voice-guide");
  const { createRunState, createPlannerTools, buildQuantPackage } = await import("../lib/agent/planner");

  // ---- 1. Timeout per-tier (default) ----
  console.log("TIMEOUT PER-TIER:");
  assert(orch.PERSONA_TIMEOUT_MS === 90_000, `persona 90s (${orch.PERSONA_TIMEOUT_MS})`);
  assert(orch.JUDGE_TIMEOUT_MS === 120_000, `judge 120s (${orch.JUDGE_TIMEOUT_MS})`);
  assert(orch.RETRY_TIMEOUT_MS === 60_000, `retry tetap 60s (${orch.RETRY_TIMEOUT_MS})`);
  assert(MODEL_TIMEOUT_MS === 120_000, `editorial ikut 120s via LLM_TIMEOUT_MS (${MODEL_TIMEOUT_MS})`);

  // ---- 2. Cap 1 ronde (fungsional: call ke-2 ditolak) ----
  console.log("CAP 1 RONDE:");
  const state = createRunState("mt_r1_cap");
  const tools = createPlannerTools(state) as any;
  state.fetchResult = { intelligence: { missing_data_registry: [] } } as any;
  state.quant = { quantPackage: { value_bets: [] } } as any;
  state.debateRounds = 1;
  const capped = await tools.run_syndicate_debate.execute({ alasan: "uji ronde-2" }, {});
  assert(
    typeof capped?.error === "string" &&
      capped.error.includes("sudah 1 ronde") &&
      capped.error.includes("stop_with_verdict"),
    `call ke-2 ditolak: "${capped?.error}"`
  );
  assert(state.debateRounds === 1, "ronde tak increment saat ditolak (tetap 1)");

  // ---- 3. J2 sequential: prompt J2 mengandung output J1 ----
  console.log("J2 SEQUENTIAL:");
  const j1snap = {
    verdict_summary: "MARKER verdict J1 unik 7x7",
    recommended_market: "MARKER Over 2.5",
    confidence_tier: "B_MODERATE",
    key_reasoning: "MARKER reasoning xG 2.9",
  };
  const j2user = orch.buildJudge2UserPrompt("CTX debat", j1snap);
  assert(
    j2user.includes("MARKER verdict J1 unik 7x7") &&
      j2user.includes("MARKER Over 2.5") &&
      j2user.includes("B_MODERATE") &&
      j2user.includes("MARKER reasoning xG 2.9"),
    "prompt J2 mengandung output J1 (verdict+market+tier+reasoning)"
  );
  const j2sys = orch.buildJudge2SystemPrompt();
  assert(j2sys.includes("SETUJU") && j2sys.includes("BANTAH"), "J2 wajib eksplisit SETUJU/BANTAH");
  assert(
    j2sys.toLowerCase().includes("risiko") && j2sys.includes("Hakim 1"),
    "J2 wajib sebut risiko yang dilewatkan Hakim 1"
  );
  const orchSrc = fs.readFileSync(path.join(process.cwd(), "lib", "syndicate-orchestrator.ts"), "utf-8");
  assert(
    !orchSrc.includes("const [j1Timed, j2Timed] = await Promise.all"),
    "J1/J2 tak lagi paralel (Promise.all dual-judge dihapus)"
  );
  assert(
    orchSrc.includes("buildJudge2UserPrompt(debateSummary"),
    "J2 dipanggil sequential setelah J1 (pakai snapshot J1)"
  );

  // ---- 4. Tie-break deterministik ----
  console.log("TIE-BREAK DETERMINISTIK:");
  const j = (market: string, tier: any, model = "m") => ({ model, recommended_market: market, confidence_tier: tier });
  let r = orch.resolveSupremeConsensus(j("Over 2.5 Goals", "A_HIGH_VALUE", "J1"), j("Over 2.5 Goals", "A_HIGH_VALUE", "J2"));
  assert(
    r.consensusLevel === "UNANIMOUS" && r.finalTier === "A_HIGH_VALUE" &&
      r.finalStake === "2.5% Bankroll (Quarter Kelly High Edge)",
    "UNANIMOUS A/A → A_HIGH_VALUE 2.5%"
  );
  r = orch.resolveSupremeConsensus(j("Over 2.5 Goals", "B_MODERATE"), j("Over 2.5 Goals", "B_MODERATE"));
  assert(
    r.consensusLevel === "UNANIMOUS" && r.finalTier === "B_MODERATE" && r.finalStake === "1.75% Bankroll",
    "UNANIMOUS B/B → B_MODERATE 1.75%"
  );
  r = orch.resolveSupremeConsensus(j("Over 2.5 Goals", "B_MODERATE"), j("over 2.5 goals ", "C_LEAN"));
  assert(
    r.consensusLevel === "CONCURRING" && r.finalTier === "B_MODERATE" &&
      r.finalStake === "1.5% Bankroll (Quarter Kelly)",
    "CONCURRING (match case-insensitive) → tier ikut J1, stake default"
  );
  r = orch.resolveSupremeConsensus(j("Over 2.5 Goals", "B_MODERATE"), j("Asian Handicap 0.0", "B_MODERATE"));
  assert(
    r.consensusLevel === "SPLIT_DECISION" && r.finalTier === "C_LEAN" &&
      r.finalStake === "0.75% Bankroll (Reduced Allocation)",
    "SPLIT_DECISION → C_LEAN 0.75%"
  );
  r = orch.resolveSupremeConsensus(j("Over 2.5 Goals", "B_MODERATE"), j("PASS", "PASS_AVOID"));
  assert(
    r.consensusLevel === "DISSENT" && r.finalTier === "PASS_AVOID" &&
      r.finalStake === "0.0% (PASS / No Bet)" && r.supremeVerdict.startsWith("DISSENT"),
    "DISSENT (J2 PASS_AVOID) → PASS 0.0%"
  );
  const rUlang = orch.resolveSupremeConsensus(j("Over 2.5 Goals", "B_MODERATE"), j("Asian Handicap 0.0", "B_MODERATE"));
  const rUlang2 = orch.resolveSupremeConsensus(j("Over 2.5 Goals", "B_MODERATE"), j("Asian Handicap 0.0", "B_MODERATE"));
  assert(JSON.stringify(rUlang) === JSON.stringify(rUlang2), "resolver deterministik (2x run identik)");
  assert(!("prob_home_win" in rUlang) && !("fair_odds" in rUlang), "output konsensus tak bawa prob/fair (display only)");

  // ---- 5. Voice guide ter-inject di semua prompt, kontrak JSON paling akhir ----
  console.log("VOICE GUIDE:");
  assert(VOICE_GUIDE.includes(VOICE_MARK), "VOICE_GUIDE ada");
  assert(
    VOICE_GUIDE.includes("Berikut adalah") &&
      VOICE_GUIDE.includes("patut dicatat") &&
      VOICE_GUIDE.includes("SPLIT DECISION: Hakim 1..."),
    "larangan frasa kaku tercantum"
  );
  assert(VOICE_GUIDE.includes("Contoh BENAR") && VOICE_GUIDE.includes("Contoh SALAH"), "contoh verdict benar vs salah ada");
  const guideLines = VOICE_GUIDE.split("\n").filter((l: string) => l.trim().length > 0);
  assert(guideLines.length >= 8 && guideLines.length <= 20, `VOICE_GUIDE ~10-15 baris (${guideLines.length})`);
  const personaPrompts: Array<[string, string]> = [
    ["bull", orch.buildBullSystemPrompt()],
    ["neutral", orch.buildNeutralSystemPrompt()],
    ["bear", orch.buildBearSystemPrompt()],
    ["judge1", orch.buildJudge1SystemPrompt()],
    ["judge2", orch.buildJudge2SystemPrompt()],
  ];
  for (const [nama, p] of personaPrompts) {
    assert(p.includes(VOICE_MARK), `voice ter-inject di prompt ${nama}`);
    assert(
      p.indexOf("WAJIB JSON VALID") > p.indexOf(VOICE_MARK),
      `kontrak JSON ${nama} tetap di akhir (setelah voice)`
    );
  }
  const intelEd: any = {
    pertandingan: { id: "mt_r1", tim_kandang: "Liverpool", tim_tamu: "Chelsea", waktu: "2026-10-20T19:00:00Z", kompetisi: "EPL", venue: "Anfield", wasit: "" },
    wasit_detail: { name: "", avg_yellow_per_game: null, yellow_cards: 0, red_cards: 0, strictness_level: "tidak diketahui" },
    lineups: { is_available: false, status_label: "belum_tersedia", home_formation: "", away_formation: "", home_starting_xi: [], away_starting_xi: [] },
    form_split: { home_form_summary: "", away_form_summary: "" },
    market_odds: { is_available: false },
    missing_data_registry: [],
  };
  const ed = buildEditorialPrompts({
    intel: intelEd,
    quantPackage: {},
    dcOutput: { lambda: 1.8, mu: 1.1 } as any,
    vigOutput: null,
    hLast: null,
    dLast: null,
    aLast: null,
    today: "2026-10-18",
  });
  assert(ed.systemPrompt.includes(VOICE_MARK), "voice ter-inject di prompt editorial");
  assert(
    ed.systemPrompt.indexOf("KEMBALIKAN OUTPUT HANYA DALAM FORMAT JSON VALID") > ed.systemPrompt.indexOf(VOICE_MARK),
    "editorial: kontrak JSON tetap paling akhir (setelah voice)"
  );

  // ---- 6. GUARD: prob/fair tak tersentuh ----
  console.log("GUARD PROB/FAIR:");
  assert(!/fair_odds|prob_|kelly|expected_value/i.test(VOICE_GUIDE), "voice guide tak bawa direktif angka (display-only)");
  const intelQ: any = {
    pertandingan: { id: "mo_r1", tim_kandang: "Liverpool", tim_tamu: "Borussia Dortmund", waktu: "2026-10-20T19:00:00Z", kompetisi: "UEFA Champions League", venue: "Anfield", wasit: "", kickoff_jam_menuju: 48 },
    wasit_detail: { is_available: false, name: "", country: "", games: 0, yellow_cards: 0, red_cards: 0, avg_yellow_per_game: null, strictness_level: "tidak diketahui" },
    lineups: { is_available: false, confirmed: false, status_label: "belum_tersedia", home_formation: "", away_formation: "", home_starting_xi: [], away_starting_xi: [] },
    h2h_history: { is_available: false, sample_size: 0, summary: "", recent_meetings: [] },
    form_split: { home_form_summary: "", away_form_summary: "", home_goals_avg: 2.1, away_goals_avg: 1.1, home_form_sample_size: 0, away_form_sample_size: 0 },
    injuries: { is_available: false, home_injuries: [], away_injuries: [] },
    market_odds: { is_available: false, home_last: null, draw_last: null, away_last: null, total_goals_over_2_5: null },
    missing_data_registry: ["lineups", "h2h", "injuries"],
    is_strictly_grounded: true,
  };
  const b1 = buildQuantPackage(intelQ, "2026-10-18");
  const b2 = buildQuantPackage(intelQ, "2026-10-18");
  assert(b1.dcOutput.prob_home_win === b2.dcOutput.prob_home_win, "prob_home_win deterministik (tak tersentuh paket ini)");
  assert(b1.dcOutput.prob_draw === b2.dcOutput.prob_draw, "prob_draw deterministik (tak tersentuh paket ini)");
  assert(
    JSON.stringify(b1.dcOutput.fair_odds) === JSON.stringify(b2.dcOutput.fair_odds),
    "fair_odds deterministik (tak tersentuh paket ini)"
  );

  console.log(`\n=== ${passed} lulus, ${failed} gagal ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("TEST GAGAL:", err);
  process.exit(1);
});
