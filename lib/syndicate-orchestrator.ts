/**
 * Enterprise 5-Agent Multi-Model Syndicate Orchestrator
 *
 * Mengkoordinasikan 5 Model AI Berbeda via 9Router:
 * - Bull Analyst: bai/glm-5.3-flash (Offensive momentum, xG upside)
 * - Neutral Analyst: bai/deepseek-v4.1-flash (Empirical equilibrium, market consensus)
 * - Bear Auditor: ag/gemini-3.8-flash-medium (Defensive fragility, trap lines, downside risk)
 * - Judgement 1: ag/gemini-3.8-flash-high (Chief Quantitative & Risk Arbiter)
 * - Judgement 2: atria/Atria-Dawn-Preview (Independent Synthesizer & Cross-Arbiter)
 * - Supreme Consensus Engine (Unanimous, Concurring, Split Decision)
 */

export interface BullCase {
  model: string;
  thesis: string;
  key_drivers: string[];
  tactical_edge: string;
  /** "fallback_template" = konten template hasil degradasi, BUKAN output model. */
  source?: "model" | "fallback_template";
}

export interface NeutralCase {
  model: string;
  thesis: string;
  empirical_drivers: string[];
  equilibrium_assessment: string;
  /** "fallback_template" = konten template hasil degradasi, BUKAN output model. */
  source?: "model" | "fallback_template";
}

export interface BearCase {
  model: string;
  thesis: string;
  trap_warnings: string[];
  vulnerability_audit: string;
  /** "fallback_template" = konten template hasil degradasi, BUKAN output model. */
  source?: "model" | "fallback_template";
}

export interface SingleJudgement {
  model: string;
  title: string;
  verdict_summary: string;
  confidence_tier: "A_HIGH_VALUE" | "B_MODERATE" | "C_LEAN" | "PASS_AVOID";
  recommended_market: string;
  key_reasoning?: string;
  alternative_perspective?: string;
  /** "fallback_template" = konten template hasil degradasi, BUKAN output model. */
  source?: "model" | "fallback_template";
}

export interface DualJudgement {
  judgement_1: SingleJudgement;
  judgement_2: SingleJudgement;
  consensus_level: "UNANIMOUS" | "CONCURRING" | "SPLIT_DECISION" | "DISSENT";
  supreme_verdict: string;
  final_recommended_market: string;
  final_confidence_tier: "A_HIGH_VALUE" | "B_MODERATE" | "C_LEAN" | "PASS_AVOID";
  final_stake_fraction: string;
}

export interface SyndicateDebateResult {
  bull_case: BullCase;
  neutral_case: NeutralCase;
  bear_case: BearCase;
  dual_judgement: DualJudgement;
  arbiter_verdict: {
    model: string;
    chief_risk_officer_synthesis: string;
    confidence_tier: "A_HIGH_VALUE" | "B_MODERATE" | "C_LEAN" | "PASS_AVOID";
    recommended_market: string;
    recommended_stake_fraction: string;
  };
  /** true = ada bagian yang diisi template fallback, bukan output model asli. */
  is_fabricated_fallback?: boolean;
}

import { getNineRouterApiKey, getNineRouterBaseUrl, SYNDICATE } from "./llm/models";

const BASE_URL = getNineRouterBaseUrl();
const API_KEY = getNineRouterApiKey();

const MODEL_DEFAULT = SYNDICATE.MODEL_DEFAULT;
const MODEL_BULL = SYNDICATE.MODEL_BULL;
const MODEL_NEUTRAL = SYNDICATE.MODEL_NEUTRAL;
const MODEL_BEAR = SYNDICATE.MODEL_BEAR;
const MODEL_JUDGEMENT_1 = SYNDICATE.MODEL_JUDGEMENT_1;
const MODEL_JUDGEMENT_2 = SYNDICATE.MODEL_JUDGEMENT_2;

/**
 * Resilient HTTP Native Fetcher untuk 9Router
 * Menangani non-streaming JSON, SSE delta chunks, serta format Atria wrapped response.
 * Unrestricted limits: 16384 max tokens, 180s timeout untuk extended thinking models.
 */
async function call9RouterDirect(
  targetModel: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 16384,
  timeoutMs: number = 180000
): Promise<{ text: string; modelUsed: string }> {
  const tryCall = async (model: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const messages = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: userPrompt });

    const isNativeThinkingModel = model.includes("thinking") && !model.startsWith("bai/");
    const requestPayload: any = {
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.2,
      stream: false,
    };

    // Mode Thinking Ultra untuk model penalaran native
    if (isNativeThinkingModel) {
      requestPayload.reasoning_effort = "high";
      requestPayload.thinking = { type: "enabled", budget_tokens: 32768 };
    }

    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 150)}`);
      }

      const raw = await res.text();
      let extracted = "";

      // Bersihkan trailing data: [DONE] jika ada
      let cleanRaw = raw.replace(/data:\s*\[DONE\]\s*$/, "").trim();

      // 1. Cek Server-Sent Events (SSE) murni
      if (cleanRaw.startsWith("data:")) {
        const lines = cleanRaw.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ") && !line.includes("[DONE]")) {
            try {
              const p = JSON.parse(line.slice(6));
              const delta = p.choices?.[0]?.delta?.content;
              if (delta) extracted += delta;
            } catch {}
          }
        }
      }

      // 2. Cek JSON standar OpenAI/9Router
      if (!extracted) {
        try {
          const json = JSON.parse(cleanRaw);
          extracted = json.choices?.[0]?.message?.content || "";
          
          // Jika content kosong tetapi ada reasoning_content, gunakan cuplikan reasoning sebagai fallback cerdas
          if (!extracted && json.choices?.[0]?.message?.reasoning_content) {
            extracted = json.choices[0].message.reasoning_content;
          }
        } catch {
          // Format Atria / nested JSON regex
          const match = cleanRaw.match(/"content"\s*:\s*"([^"]+)"/);
          if (match && match[1]) {
            extracted = match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
          } else {
            extracted = cleanRaw;
          }
        }
      }

      return extracted.trim();
    } finally {
      clearTimeout(timer);
    }
  };

  // Upaya pemanggilan model tanpa substitusi Gemini (Anti-Bias Garansi Independensi Model)
  try {
    const text = await tryCall(targetModel);
    return { text, modelUsed: targetModel };
  } catch (primaryErr) {
    console.warn(`[9Router] Percobaan 1 model ${targetModel} gagal (${(primaryErr as Error).message}), mencoba ulang model yang sama untuk menjaga independensi...`);
    try {
      const retryText = await tryCall(targetModel);
      return { text: retryText, modelUsed: targetModel };
    } catch (retryErr) {
      console.error(`[9Router] Model ${targetModel} tetap gagal setelah retry: ${(retryErr as Error).message}`);
      return {
        text: `Analisis model ${targetModel} mengalami kendala respon: ${(retryErr as Error).message}`,
        modelUsed: targetModel,
      };
    }
  }
}

/**
 * Ekstraksi JSON aman dari respons teks LLM.
 * `usedFallback: true` = konten hasil parse gagal → objek fallback (berisi template).
 */
function safeExtractJSON<T>(text: string, fallback: T): { data: T; usedFallback: boolean } {
  try {
    const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return { data: JSON.parse(jsonMatch[0]) as T, usedFallback: false };
    }
    return { data: fallback, usedFallback: true };
  } catch {
    return { data: fallback, usedFallback: true };
  }
}

// Penanda jujur untuk konten template degradasi, agar UI bisa membedakan dari output model asli.
const FALLBACK_PREFIX = "[Template fallback — bukan output model asli] ";

/**
 * Main 5-Agent Multi-Model Orchestration Pipeline
 */
export async function orchestrate5AgentSyndicate(params: {
  matchSummary: string;
  intel: any;
  quantPackage: any;
  luckSignal?: any;
}): Promise<SyndicateDebateResult> {
  const { matchSummary, intel, quantPackage } = params;

  // Format evaluasi Value Bet (+EV) & Kelly untuk diinjeksi ke prompt LLM
  const valueBetsSummary = Array.isArray(quantPackage?.value_bets)
    ? quantPackage.value_bets
        .map(
          (b: any) =>
            `- [${b.market_name}] ${b.selection}: Odds Pasar=${b.bookmaker_odds} vs Fair Model=${b.fair_odds} | EV=${b.ev_percentage} | Sizing Kelly=${b.recommended_stake_percentage}%`
        )
        .join("\n")
    : "Evaluasi value bet belum terkompilasi";

  const marketOddsStr = intel.market_odds?.is_available || intel.market_odds?.home_last
    ? `Bursa Live (${intel.market_odds.bookmaker || "Pasar"}): Home=${intel.market_odds.home_last} | Draw=${intel.market_odds.draw_last} | Away=${intel.market_odds.away_last} | O2.5=${intel.market_odds.total_goals_over_2_5 || "N/A"}`
    : "Bursa odds pasar belum tersedia";

  // CATATAN: key di quantPackage adalah `vig_stripping` (lihat route.tsx).
  const vigData = quantPackage?.vig_stripping ?? quantPackage?.shin_vig;
  const shinStr = vigData
    ? `Shin Vig-Stripping: Fair Home=${vigData.fair_odds?.home} | Draw=${vigData.fair_odds?.draw} | Away=${vigData.fair_odds?.away} (Margin Bandar: ${(vigData.margin_percentage ?? 0).toFixed(1)}%)`
    : "";

  const dc = quantPackage?.dixon_coles;
  const homeXG = dc?.lambda_home_xg ?? 1.35;
  const awayXG = dc?.mu_away_xg ?? 1.15;
  const homeProb = Math.round((dc?.prob_home_win ?? 0.45) * 100);
  const drawProb = Math.round((dc?.prob_draw ?? 0.27) * 100);
  const awayProb = Math.round((dc?.prob_away_win ?? 0.28) * 100);
  const fairHome = dc?.fair_odds?.home ?? 2.2;
  const fairDraw = dc?.fair_odds?.draw ?? 3.4;
  const fairAway = dc?.fair_odds?.away ?? 3.5;
  const over25Prob = Math.round((dc?.over_2_5_prob ?? 0.52) * 100);
  const bttsProb = Math.round((dc?.btts_yes_prob ?? 0.50) * 100);
  const dnbHomeProb = Math.round((dc?.asian_handicap?.ah_0_0_dnb?.home_prob ?? 0.5) * 100);
  const dnbFair = dc?.asian_handicap?.ah_0_0_dnb?.fair_odds_home ?? 2.0;

  const sm = quantPackage?.special_markets;
  const specialMarketsStr = sm ? (
    `\nDATA PASAR KHUSUS (SPECIAL MARKETS THESTATSAPI DATASET):\n` +
    `- Pasar Headed Goal: P(Gol Sundulan >= 1)=${Math.round(sm.headed_goal.prob_at_least_one_header * 100)}% (Fair Odds Yes=${sm.headed_goal.fair_odds_yes} vs No=${sm.headed_goal.fair_odds_no}) | Status: ${sm.headed_goal.confidence_tier} (Sampel: ${sm.headed_goal.observed_aerial_samples.home} kandang, ${sm.headed_goal.observed_aerial_samples.away} tamu)\n` +
    `- Pasar Corners: Total Ekspektasi=${sm.corners.expected_total_corners} | Over 9.5=${Math.round(sm.corners.over_9_5_prob * 100)}% (Fair: ${sm.corners.fair_odds_over_9_5}) | Over 10.5=${Math.round(sm.corners.over_10_5_prob * 100)}% (Fair: ${sm.corners.fair_odds_over_10_5}) | Status: ${sm.corners.confidence_tier}${sm.corners.is_estimated ? " (ESTIMASI: pakai rata-rata liga, bukan data terukur)" : ""}\n` +
    `- Pasar Kartu: Total Ekspektasi=${sm.cards.expected_total_cards} | Over 3.5 Cards=${Math.round(sm.cards.over_3_5_prob * 100)}% (Fair: ${sm.cards.fair_odds_over_3_5}) | Over 4.5 Cards=${Math.round(sm.cards.over_4_5_prob * 100)}% (Fair: ${sm.cards.fair_odds_over_4_5}) | Status: ${sm.cards.confidence_tier}${sm.cards.is_estimated ? " (ESTIMASI: pakai rata-rata liga, bukan data terukur)" : ""}\n` +
    (sm.passing_dominance?.home_expected_passes ? `- Distribusi Passing: Kandang=${sm.passing_dominance.home_expected_passes} vs Tamu=${sm.passing_dominance.away_expected_passes} akurat/laga\n` : "") +
    `PERINGATAN PASAR KHUSUS: Angka di atas HANYA fair odds model, BUKAN rekomendasi value. ` +
    `Odds pasar 1xBet untuk pasar ini TIDAK tersedia di payload ini, jadi Expected Value (EV) tidak dapat dihitung. ` +
    `DILARANG mengklaim pasar khusus ini punya "+EV", "edge", atau "value". ` +
    `Sebut sebagai konteks probabilitas saja, dan prioritaskan rekomendasi hanya pada pasar yang memang tercantum di daftar EV di bawah.\n`
  ) : "";

  // Detail Faktual Skuad & Pertemuan (Anti-Halusinasi)
  const homeXI = intel.lineups?.is_available && Array.isArray(intel.lineups.home_starting_xi) && intel.lineups.home_starting_xi.length > 0
    ? intel.lineups.home_starting_xi.map((p: any) => `${p.name} (${p.pos || "P"})`).join(", ")
    : "Lineup belum resmi diumumkan (analisis berbasis unit taktis kolektif)";

  const awayXI = intel.lineups?.is_available && Array.isArray(intel.lineups.away_starting_xi) && intel.lineups.away_starting_xi.length > 0
    ? intel.lineups.away_starting_xi.map((p: any) => `${p.name} (${p.pos || "P"})`).join(", ")
    : "Lineup belum resmi diumumkan (analisis berbasis unit taktis kolektif)";

  const homeInjuries = Array.isArray(intel.injuries?.home_injuries) && intel.injuries.home_injuries.length > 0
    ? intel.injuries.home_injuries.join("; ")
    : "Tidak ada laporan cedera resmi";

  const awayInjuries = Array.isArray(intel.injuries?.away_injuries) && intel.injuries.away_injuries.length > 0
    ? intel.injuries.away_injuries.join("; ")
    : "Tidak ada laporan cedera resmi";

  const h2hMeetings = Array.isArray(intel.h2h_history?.recent_meetings) && intel.h2h_history.recent_meetings.length > 0
    ? intel.h2h_history.recent_meetings.map((m: any) => `${m.date}: ${m.home} ${m.score} ${m.away}`).join(" | ")
    : "Tidak ada catatan pertemuan langsung baru";

  // Injeksi Sinyal Keberuntungan xG (Luck Regression)
  const lm = quantPackage?.calibration_metadata?.luckMetrics || quantPackage?.luck_metrics || params.luckSignal;
  const luckStr = lm ? (
    `\nMETRIK REGRESI xG & KEBERUNTUNGAN TIM (LUCK SIGNAL):\n` +
    `- Disparitas Keberuntungan: ${lm.luck_disparity > 0 ? "+" : ""}${Number(lm.luck_disparity).toFixed(2)}\n` +
    `- Kandang (${lm.home?.team_id || "Home"}): Status=${lm.home?.status || "NEUTRAL"} | Finishing Luck=${(lm.home?.finishing_luck_per_match ?? 0) > 0 ? "+" : ""}${Number(lm.home?.finishing_luck_per_match ?? 0).toFixed(2)} gol/laga | Def Luck=${(lm.home?.defensive_luck_per_match ?? 0) > 0 ? "+" : ""}${Number(lm.home?.defensive_luck_per_match ?? 0).toFixed(2)}\n` +
    `- Tamu (${lm.away?.team_id || "Away"}): Status=${lm.away?.status || "NEUTRAL"} | Finishing Luck=${(lm.away?.finishing_luck_per_match ?? 0) > 0 ? "+" : ""}${Number(lm.away?.finishing_luck_per_match ?? 0).toFixed(2)} gol/laga | Def Luck=${(lm.away?.defensive_luck_per_match ?? 0) > 0 ? "+" : ""}${Number(lm.away?.defensive_luck_per_match ?? 0).toFixed(2)}\n` +
    (lm.market_bias_warning ? `- PERINGATAN BIAS PASAR: ${lm.market_bias_warning}\n` : "") +
    `- Sudut Pandang Bull: ${lm.agentic_tactical_thesis?.bull_angle || "N/A"}\n` +
    `- Sudut Pandang Bear: ${lm.agentic_tactical_thesis?.bear_angle || "N/A"}\n`
  ) : "";

  const matchContext =
    `Pertandingan: ${intel.pertandingan.tim_kandang} vs ${intel.pertandingan.tim_tamu} (${intel.pertandingan.kompetisi})\n` +
    `Waktu: ${intel.pertandingan.waktu} | Venue: ${intel.pertandingan.venue}\n` +
    `${marketOddsStr}\n` +
    (shinStr ? `${shinStr}\n` : "") +
    `Dixon-Coles xG: Home=${homeXG} vs Away=${awayXG}\n` +
    `True 1X2 Probs: Home=${homeProb}% | Draw=${drawProb}% | Away=${awayProb}%\n` +
    `Fair 1X2 Odds: Home=${fairHome} | Draw=${fairDraw} | Away=${fairAway}\n` +
    `Over 2.5 Prob: ${over25Prob}% | BTTS Yes: ${bttsProb}%\n` +
    `Asian Handicap DNB: Home ${dnbHomeProb}% (Fair: ${dnbFair})\n` +
    `Lineup Status: ${intel.lineups?.status_label || "belum_tersedia"}\n` +
    `- Starting XI Kandang: ${homeXI}\n` +
    `- Starting XI Tamu: ${awayXI}\n` +
    `Laporan Cedera/Absen:\n` +
    `- Kandang: ${homeInjuries}\n` +
    `- Tamu: ${awayInjuries}\n` +
    `Histori H2H: ${h2hMeetings}\n` +
    `Form: Kandang=${intel.form_split.home_form_summary} | Tamu=${intel.form_split.away_form_summary}\n` +
    specialMarketsStr + "\n" +
    luckStr + "\n" +
    `ANALISIS NILAI PASAR (+EV) & KELLY SIZING DARI ENGINE KUANTITATIF:\n${valueBetsSummary}`;

  if (process.env.PIPELINE_DEBUG) {
    console.log(`[Syndicate] Memulai Stage 1: Debat Tri-Agent Paralel (Bull: ${MODEL_BULL}, Neutral: ${MODEL_NEUTRAL}, Bear: ${MODEL_BEAR}) [unrestricted tokens: 16384, 180s limit]...`);
  }
  const t0 = Date.now();

  // STAGE 1: TRI-AGENT ADVERSARIAL DEBATE IN PARALLEL
  const [bullRaw, neutralRaw, bearRaw] = await Promise.all([
    // 1. Bull Analyst (MODEL_BULL)
    call9RouterDirect(
      MODEL_BULL,
      "Lo adalah Bull Analyst di sindikat taruhan bola. Gaya bahasa lo santai, tajam, pake bahasa tongkrongan/analis bola pro (gw/lo). Dilarang kaku kayak robot, dilarang lebay/hiperbola ('luar biasa', 'spektakuler', 'patut dicatat'), dan jangan pake template klise AI ('Berikut adalah...'). Fokus bangun tesis ofensif tajam: kenapa tim ini punya peluang jebol gawang atau ngunci kemenangan. Sisipkan fakta/data (selisih xG, efisiensi tembakan, rekor gol kandang, starting XI resmi) secara natural dan mengalir di narasi, BUKAN list poin kering. ATURAN GROUNDING: Wajib hanya rujuk data konteks nyata (Starting XI, cedera, H2H, xG). Dilarang mengarang pemain cedera/lineup yang tidak tertulis di konteks. Format output WAJIB JSON VALID murni: { \"thesis\": string, \"key_drivers\": [ string, string ], \"tactical_edge\": string }",
      matchContext,
      16384,
      180000
    ),
    // 2. Neutral Analyst (MODEL_NEUTRAL)
    call9RouterDirect(
      MODEL_NEUTRAL,
      "Lo adalah Neutral Analyst di sindikat taruhan bola. Gaya bahasa lo santai, realistis, objektif (gw/lo). Buang semua bumbu promosi atau hiperbola lebay. Tugas lo ngebedah ekuilibrium pasar dan angka probabilitas wajar tanpa bias tim mana pun. Sisipkan fakta empiris (keseimbangan Poisson, tren regresi kandang-tandang, gap xG tipis) secara natural di obrolan lo. ATURAN GROUNDING: Wajib hanya rujuk data konteks nyata (Starting XI, cedera, H2H, xG). Dilarang mengarang fakta skuad di luar konteks. Format output WAJIB JSON VALID murni: { \"thesis\": string, \"empirical_drivers\": [ string, string ], \"equilibrium_assessment\": string }",
      matchContext,
      16384,
      180000
    ),
    // 3. Bear Auditor (MODEL_BEAR)
    call9RouterDirect(
      MODEL_BEAR,
      "Lo adalah Bear Auditor di sindikat taruhan bola. Jalankan penalaran internal mendalam secara komprehensif sebelum mengambil kesimpulan. Lo sosok yang sangat skeptis, jeli ngeliat skenario terburuk, celah bahaya lini belakang, dan jebakan bandar (trap line). Pake gaya santai tongkrongan analis pro (gw/lo), dilarang kaku dan dilarang lebay. Bongkar kerapuhan pertahanan, potensi kebobolan transisi, atau odds bandar yang kemurahan/overvalued. Sisipkan data xGA, tren kebobolan menit akhir, faktor kelelahan, atau regresi xG luck secara mengalir di narasi. ATURAN GROUNDING: Wajib hanya rujuk data konteks nyata (Starting XI, cedera, H2H, xG). Dilarang mengarang pemain cedera/lineup fiktif. Format output WAJIB JSON VALID murni: { \"thesis\": string, \"trap_warnings\": [ string, string ], \"vulnerability_audit\": string }",
      matchContext,
      16384,
      180000
    ),
  ]);

  console.log(`[Syndicate] Stage 1 selesai dalam ${Date.now() - t0}ms.`);

  const isErrText = (t?: string) => !t || t.includes("mengalami kendala respon") || t.length < 20;

  const defaultBullThesis = "Peluang ofensif menguntungkan tuan rumah dengan momentum xG yang solid.";
  const { data: bullParsed, usedFallback: bullParseFailed } = safeExtractJSON<Partial<BullCase>>(bullRaw.text, {
    thesis: isErrText(bullRaw.text) ? defaultBullThesis : bullRaw.text,
    key_drivers: ["Momentum xG ofensif di atas rata-rata liga", "Efisiensi ruang tembak lini depan"],
    tactical_edge: "Keunggulan duel sayap dan transisi cepat",
  });

  const defaultNeutralThesis = "Distribusi statistik menunjukkan ekuilibrium harga pasar yang proporsional.";
  const { data: neutralParsed, usedFallback: neutralParseFailed } = safeExtractJSON<Partial<NeutralCase>>(neutralRaw.text, {
    thesis: isErrText(neutralRaw.text) ? defaultNeutralThesis : neutralRaw.text,
    empirical_drivers: ["Keseimbangan probabilitas wajar Poisson", "Regresi performa kandang vs tandang"],
    equilibrium_assessment: "Margin selisih xG tipis mengindikasikan pertandingan ketat berimbang",
  });

  const defaultBearThesis = "Waspadai kerapuhan pertahanan transisi dan odds pasar yang overvalued.";
  const { data: bearParsed, usedFallback: bearParseFailed } = safeExtractJSON<Partial<BearCase>>(bearRaw.text, {
    thesis: isErrText(bearRaw.text) ? defaultBearThesis : bearRaw.text,
    trap_warnings: ["Harga bandar terlalu pendek untuk tim favorit", "Risiko kebobolan dari serangan balik cepat"],
    vulnerability_audit: "Konsesi xGA tinggi pada 20 menit akhir laga",
  });

  // Konten template hanya boleh tampil dengan penanda jujur, tidak pernah menyamar jadi output model
  const bullThesisIsTemplate = bullParseFailed ? isErrText(bullRaw.text) : isErrText(bullParsed.thesis);
  const bullSubstituted =
    bullParseFailed || bullThesisIsTemplate || !bullParsed.tactical_edge ||
    !Array.isArray(bullParsed.key_drivers) || bullParsed.key_drivers.length === 0;

  const bullCase: BullCase = {
    model: bullRaw.modelUsed,
    thesis: bullThesisIsTemplate ? FALLBACK_PREFIX + defaultBullThesis : (bullParsed.thesis as string),
    key_drivers: Array.isArray(bullParsed.key_drivers) && bullParsed.key_drivers.length > 0 ? bullParsed.key_drivers : ["Momentum serang aktif"],
    tactical_edge: bullParsed.tactical_edge || "Keunggulan taktis terkonfirmasi.",
    source: bullSubstituted ? "fallback_template" : "model",
  };

  const neutralThesisIsTemplate = neutralParseFailed ? isErrText(neutralRaw.text) : isErrText(neutralParsed.thesis);
  const neutralSubstituted =
    neutralParseFailed || neutralThesisIsTemplate || !neutralParsed.equilibrium_assessment ||
    !Array.isArray(neutralParsed.empirical_drivers) || neutralParsed.empirical_drivers.length === 0;

  const neutralCase: NeutralCase = {
    model: neutralRaw.modelUsed,
    thesis: neutralThesisIsTemplate ? FALLBACK_PREFIX + defaultNeutralThesis : (neutralParsed.thesis as string),
    empirical_drivers: Array.isArray(neutralParsed.empirical_drivers) && neutralParsed.empirical_drivers.length > 0 ? neutralParsed.empirical_drivers : ["Empirical balance"],
    equilibrium_assessment: neutralParsed.equilibrium_assessment || "Keseimbangan pasar wajar.",
    source: neutralSubstituted ? "fallback_template" : "model",
  };

  const bearThesisIsTemplate = bearParseFailed ? isErrText(bearRaw.text) : isErrText(bearParsed.thesis);
  const bearSubstituted =
    bearParseFailed || bearThesisIsTemplate || !bearParsed.vulnerability_audit ||
    !Array.isArray(bearParsed.trap_warnings) || bearParsed.trap_warnings.length === 0;

  const bearCase: BearCase = {
    model: bearRaw.modelUsed,
    thesis: bearThesisIsTemplate ? FALLBACK_PREFIX + defaultBearThesis : (bearParsed.thesis as string),
    trap_warnings: Array.isArray(bearParsed.trap_warnings) && bearParsed.trap_warnings.length > 0 ? bearParsed.trap_warnings : ["Waspada volatilitas odds"],
    vulnerability_audit: bearParsed.vulnerability_audit || "Audit risiko terkonfirmasi.",
    source: bearSubstituted ? "fallback_template" : "model",
  };

  // STAGE 2: DUAL JUDICIAL BENCH IN PARALLEL
  if (process.env.PIPELINE_DEBUG) {
    console.log(`[Syndicate] Memulai Stage 2: Dual Judicial Bench (J1: ${MODEL_JUDGEMENT_1}, J2: ${MODEL_JUDGEMENT_2}) [unrestricted tokens: 16384, 180s limit]...`);
  }
  const t1 = Date.now();

  const debateSummary =
    `DATA KUANTITATIF:\n${matchContext}\n\n` +
    `ARGUMEN DEBAT TRI-AGENT:\n` +
    `1. Bull Case (${bullCase.model}): ${bullCase.thesis} (Edge: ${bullCase.tactical_edge})\n` +
    `2. Neutral Case (${neutralCase.model}): ${neutralCase.thesis} (Equilibrium: ${neutralCase.equilibrium_assessment})\n` +
    `3. Bear Case (${bearCase.model}): ${bearCase.thesis} (Audit: ${bearCase.vulnerability_audit})\n`;

  const [j1Raw, j2Raw] = await Promise.all([
    // Judgement 1 (MODEL_JUDGEMENT_1) - Chief Quant & CRO Arbiter
    call9RouterDirect(
      MODEL_JUDGEMENT_1,
      "Lo adalah Hakim 1: Chief Quantitative & Risk Arbiter di sindikat taruhan. Gaya bahasa santai, tegas, to-the-point khas kepala analis sindikat (gw/lo). Dilarang lebay dan dilarang basa-basi klise. Sintesis perdebatan Bull vs Neutral vs Bear dengan angka Dixon-Coles xG dan evaluasi nilai pasar (+EV). Selipkan bukti angka secara implisit di narasi vonis lo. Putuskan pasar paling masuk akal dengan proteksi modal ketat. ATURAN GROUNDING: Putusan wajib berpijak pada data konteks nyata, lineup terkonfirmasi, dan angka quant valid. Format output WAJIB JSON VALID murni: { \"verdict_summary\": string, \"confidence_tier\": \"A_HIGH_VALUE\" | \"B_MODERATE\" | \"C_LEAN\" | \"PASS_AVOID\", \"recommended_market\": string, \"key_reasoning\": string }",
      debateSummary,
      16384,
      180000
    ),
    // Judgement 2 (MODEL_JUDGEMENT_2) - Cross-Arbiter
    call9RouterDirect(
      MODEL_JUDGEMENT_2,
      "Lo adalah Hakim 2: Independent Synthesizer & Cross-Arbiter di sindikat taruhan. Jalankan penalaran internal mendalam sebelum menyimpulkan. Gaya bahasa santai, independen, kritis (gw/lo). Tugas lo nguji balik kesimpulan Hakim 1 dan nimbang apakah ada bias konfirmasi atau risiko laten yang terlewat. Nyatakan apakah lo sepakat bulat, sepakat konkuren, atau beda pandangan, sambil nyelipin pertimbangan data handicapping secara natural di narasi. ATURAN GROUNDING: Putusan wajib berpijak pada data konteks nyata, lineup terkonfirmasi, dan angka quant valid. Format output WAJIB JSON VALID murni: { \"verdict_summary\": string, \"confidence_tier\": \"A_HIGH_VALUE\" | \"B_MODERATE\" | \"C_LEAN\" | \"PASS_AVOID\", \"recommended_market\": string, \"alternative_perspective\": string }",
      debateSummary,
      16384,
      180000
    ),
  ]);

  console.log(`[Syndicate] Stage 2 selesai dalam ${Date.now() - t1}ms.`);

  const defaultRecommendedMarket = (dc?.over_2_5_prob ?? 0) > 0.55 ? "Over 2.5 Goals" : "Asian Handicap 0.0";

  const j1DefaultVerdict = "Berdasarkan kalibrasi Dixon-Coles xG dan evaluasi vig, pasar Over/Under menyajikan ekspektasi nilai paling terkontrol.";
  const { data: j1Parsed, usedFallback: j1ParseFailed } = safeExtractJSON<Partial<SingleJudgement>>(j1Raw.text, {
    verdict_summary: isErrText(j1Raw.text) ? j1DefaultVerdict : j1Raw.text,
    confidence_tier: "B_MODERATE",
    recommended_market: defaultRecommendedMarket,
    key_reasoning: "Peluang quant terkonfirmasi dengan deviasi harga bandar yang positif.",
  });

  const j2DefaultVerdict = "Menyetujui evaluasi risiko: hindari taruhan langsung 1X2 dan prioritaskan perlindungan modal pada garis handicap atau total gol.";
  const { data: j2Parsed, usedFallback: j2ParseFailed } = safeExtractJSON<Partial<SingleJudgement>>(j2Raw.text, {
    verdict_summary: isErrText(j2Raw.text) ? j2DefaultVerdict : j2Raw.text,
    confidence_tier: "B_MODERATE",
    recommended_market: j1Parsed.recommended_market || defaultRecommendedMarket,
    alternative_perspective: "Pendekatan independen mengonfirmasi probabilitas selisih gol tipis.",
  });

  const validateTier = (t?: string): "A_HIGH_VALUE" | "B_MODERATE" | "C_LEAN" | "PASS_AVOID" | undefined => {
    if (t === "A_HIGH_VALUE" || t === "B_MODERATE" || t === "C_LEAN" || t === "PASS_AVOID") return t;
    return undefined;
  };

  const j1VerdictIsTemplate = j1ParseFailed ? isErrText(j1Raw.text) : isErrText(j1Parsed.verdict_summary);
  const j1Substituted =
    j1ParseFailed || j1VerdictIsTemplate || !validateTier(j1Parsed.confidence_tier) ||
    !j1Parsed.key_reasoning || !j1Parsed.recommended_market;

  const judgement1: SingleJudgement = {
    model: j1Raw.modelUsed,
    title: "Chief Quantitative & Risk Arbiter",
    verdict_summary: j1VerdictIsTemplate ? FALLBACK_PREFIX + j1DefaultVerdict : (j1Parsed.verdict_summary as string),
    confidence_tier: validateTier(j1Parsed.confidence_tier) ?? "B_MODERATE",
    recommended_market: j1Parsed.recommended_market || "Over 2.5 Goals",
    key_reasoning: j1Parsed.key_reasoning || "Dixon-Coles xG alignment.",
    source: j1Substituted ? "fallback_template" : "model",
  };

  const j2VerdictIsTemplate = j2ParseFailed ? isErrText(j2Raw.text) : isErrText(j2Parsed.verdict_summary);
  const j2Substituted =
    j2ParseFailed || j2VerdictIsTemplate || !validateTier(j2Parsed.confidence_tier) ||
    !j2Parsed.alternative_perspective;

  const judgement2: SingleJudgement = {
    model: j2Raw.modelUsed,
    title: "Independent Cross-Audit Arbiter",
    verdict_summary: j2VerdictIsTemplate ? FALLBACK_PREFIX + j2DefaultVerdict : (j2Parsed.verdict_summary as string),
    confidence_tier: validateTier(j2Parsed.confidence_tier) ?? "B_MODERATE",
    recommended_market: j2Parsed.recommended_market || judgement1.recommended_market,
    alternative_perspective: j2Parsed.alternative_perspective || "Verifikasi silang argumen independen.",
    source: j2Substituted ? "fallback_template" : "model",
  };

  // STAGE 3: SUPREME CONSENSUS SYNTHESIS
  let consensusLevel: "UNANIMOUS" | "CONCURRING" | "SPLIT_DECISION" | "DISSENT" = "CONCURRING";
  const market1Clean = judgement1.recommended_market.toLowerCase().trim();
  const market2Clean = judgement2.recommended_market.toLowerCase().trim();

  if (judgement1.confidence_tier === "PASS_AVOID" || judgement2.confidence_tier === "PASS_AVOID") {
    consensusLevel = "DISSENT";
  } else if (market1Clean === market2Clean) {
    if (judgement1.confidence_tier === judgement2.confidence_tier) {
      consensusLevel = "UNANIMOUS";
    } else {
      consensusLevel = "CONCURRING";
    }
  } else {
    consensusLevel = "SPLIT_DECISION";
  }

  // Kelly stake fraction based on consensus
  let finalStake = "1.5% Bankroll (Quarter Kelly)";
  let finalTier = judgement1.confidence_tier;

  if (consensusLevel === "UNANIMOUS") {
    finalTier = judgement1.confidence_tier === "A_HIGH_VALUE" ? "A_HIGH_VALUE" : "B_MODERATE";
    finalStake = finalTier === "A_HIGH_VALUE" ? "2.5% Bankroll (Quarter Kelly High Edge)" : "1.75% Bankroll";
  } else if (consensusLevel === "DISSENT") {
    finalTier = "PASS_AVOID";
    finalStake = "0.0% (PASS / No Bet)";
  } else if (consensusLevel === "SPLIT_DECISION") {
    finalTier = "C_LEAN";
    finalStake = "0.75% Bankroll (Reduced Allocation)";
  }

  const supremeVerdict =
    consensusLevel === "UNANIMOUS"
      ? `KONSENSUS BULAT (UNANIMOUS): Kedua hakim (${judgement1.model} & ${judgement2.model}) sepakat penuh pada pasar ${judgement1.recommended_market} dengan keyakinan ${finalTier.replace("_", " ")}.`
      : consensusLevel === "CONCURRING"
      ? `KONSENSUS KONKUREN: Kedua hakim mendukung arah yang sama pada ${judgement1.recommended_market} dengan penekanan risiko yang saling melengkapi.`
      : consensusLevel === "SPLIT_DECISION"
      ? `SPLIT DECISION: Hakim 1 memilih ${judgement1.recommended_market} sementara Hakim 2 condong ke ${judgement2.recommended_market}. Alokasi stake dipotong separuh demi manajemen risiko.`
      : `DISSENT / DISAGREEMENT: Terdapat pertentangan risiko signifikan antar hakim. Rekomendasi: PASS (Hindari taruhan).`;

  const dualJudgement: DualJudgement = {
    judgement_1: judgement1,
    judgement_2: judgement2,
    consensus_level: consensusLevel,
    supreme_verdict: supremeVerdict,
    final_recommended_market: judgement1.recommended_market,
    final_confidence_tier: finalTier,
    final_stake_fraction: finalStake,
  };

  return {
    bull_case: bullCase,
    neutral_case: neutralCase,
    bear_case: bearCase,
    dual_judgement: dualJudgement,
    is_fabricated_fallback: bullSubstituted || neutralSubstituted || bearSubstituted || j1Substituted || j2Substituted,
    arbiter_verdict: {
      model: `${judgement1.model} + ${judgement2.model}`,
      chief_risk_officer_synthesis: supremeVerdict,
      confidence_tier: finalTier,
      recommended_market: judgement1.recommended_market,
      recommended_stake_fraction: finalStake,
    },
  };
}
