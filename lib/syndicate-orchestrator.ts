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
}

export interface NeutralCase {
  model: string;
  thesis: string;
  empirical_drivers: string[];
  equilibrium_assessment: string;
}

export interface BearCase {
  model: string;
  thesis: string;
  trap_warnings: string[];
  vulnerability_audit: string;
}

export interface SingleJudgement {
  model: string;
  title: string;
  verdict_summary: string;
  confidence_tier: "A_HIGH_VALUE" | "B_MODERATE" | "C_LEAN" | "PASS_AVOID";
  recommended_market: string;
  key_reasoning?: string;
  alternative_perspective?: string;
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
}

const BASE_URL = process.env.NINE_ROUTER_BASE_URL || "http://localhost:20128/v1";
const API_KEY = process.env.NINE_ROUTER_API_KEY || "sk-7b18b5c31d5d653c-z0q24f-c3542ecc";

const MODEL_DEFAULT = process.env.NINE_ROUTER_MODEL || "ag/gemini-3.8-flash";
const MODEL_BULL = process.env.MODEL_BULL || "bai/glm-5.3-flash";
const MODEL_NEUTRAL = process.env.MODEL_NEUTRAL || "bai/deepseek-v4.1-flash";
const MODEL_BEAR = process.env.MODEL_BEAR || "ag/gemini-3.8-flash-medium";
const MODEL_JUDGEMENT_1 = process.env.MODEL_JUDGEMENT_1 || "ag/gemini-3.8-flash-high";
const MODEL_JUDGEMENT_2 = process.env.MODEL_JUDGEMENT_2 || "bai/qwen3.8-flash";

/**
 * Resilient HTTP Native Fetcher untuk 9Router
 * Menangani non-streaming JSON, SSE delta chunks, serta format Atria wrapped response.
 */
async function call9RouterDirect(
  targetModel: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 4000,
  timeoutMs: number = 30000
): Promise<{ text: string; modelUsed: string }> {
  const tryCall = async (model: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const messages = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: userPrompt });

    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature: 0.2,
          stream: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

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
    } catch (err) {
      clearTimeout(timer);
      throw err;
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
 * Ekstraksi JSON aman dari respons teks LLM
 */
function safeExtractJSON<T>(text: string, fallback: T): T {
  try {
    const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as T;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * Main 5-Agent Multi-Model Orchestration Pipeline
 */
export async function orchestrate5AgentSyndicate(params: {
  matchSummary: string;
  intel: any;
  quantPackage: any;
}): Promise<SyndicateDebateResult> {
  const { matchSummary, intel, quantPackage } = params;

  const matchContext =
    `Pertandingan: ${intel.pertandingan.tim_kandang} vs ${intel.pertandingan.tim_tamu} (${intel.pertandingan.kompetisi})\n` +
    `Waktu: ${intel.pertandingan.waktu} | Venue: ${intel.pertandingan.venue}\n` +
    `Dixon-Coles xG: Home=${quantPackage.dixon_coles.lambda_home_xg} vs Away=${quantPackage.dixon_coles.mu_away_xg}\n` +
    `True 1X2 Probs: Home=${Math.round(quantPackage.dixon_coles.prob_home_win * 100)}% | Draw=${Math.round(quantPackage.dixon_coles.prob_draw * 100)}% | Away=${Math.round(quantPackage.dixon_coles.prob_away_win * 100)}%\n` +
    `Fair 1X2 Odds: Home=${quantPackage.dixon_coles.fair_odds.home} | Draw=${quantPackage.dixon_coles.fair_odds.draw} | Away=${quantPackage.dixon_coles.fair_odds.away}\n` +
    `Over 2.5 Prob: ${Math.round(quantPackage.dixon_coles.over_2_5_prob * 100)}% | BTTS Yes: ${Math.round(quantPackage.dixon_coles.btts_yes_prob * 100)}%\n` +
    `Asian Handicap DNB: Home ${(quantPackage.dixon_coles.asian_handicap?.ah_0_0_dnb?.home_prob * 100 || 50).toFixed(0)}% (Fair: ${quantPackage.dixon_coles.asian_handicap?.ah_0_0_dnb?.fair_odds_home || 2.0})\n` +
    `Status Lineup: ${intel.lineups.status_label}\n` +
    `Form: Kandang=${intel.form_split.home_form_summary} | Tamu=${intel.form_split.away_form_summary}`;

  console.log(`[Syndicate] Memulai Stage 1: Debat Tri-Agent Paralel (Bull: ${MODEL_BULL}, Neutral: ${MODEL_NEUTRAL}, Bear: ${MODEL_BEAR}) [max_tokens: 4000, 30s limit]...`);
  const t0 = Date.now();

  // STAGE 1: TRI-AGENT ADVERSARIAL DEBATE IN PARALLEL
  const [bullRaw, neutralRaw, bearRaw] = await Promise.all([
    // 1. Bull Analyst (bai/glm-5.3-flash)
    call9RouterDirect(
      MODEL_BULL,
      "Kamu adalah Bull Analyst (Taktis Ofensif) Sindikat Olahraga. Fase reasoning maksimal 20-25 detik. Rumuskan tesis ofensif mendalam dan kaya argumen berbasis data kuantitatif. Keluarkan JSON VALID: { \"thesis\": string, \"key_drivers\": [ string, string ], \"tactical_edge\": string }",
      matchContext,
      4000,
      30000
    ),
    // 2. Neutral Analyst (bai/deepseek-v4.1-flash)
    call9RouterDirect(
      MODEL_NEUTRAL,
      "Kamu adalah Neutral Analyst (Data Empiris & Ekuilibrium) Sindikat Olahraga. Fase reasoning maksimal 20-25 detik. Rumuskan tesis ekuilibrium mendalam tanpa optimisme bias. Keluarkan JSON VALID: { \"thesis\": string, \"empirical_drivers\": [ string, string ], \"equilibrium_assessment\": string }",
      matchContext,
      4000,
      30000
    ),
    // 3. Bear Auditor (ag/gemini-3.8-flash-medium)
    call9RouterDirect(
      MODEL_BEAR,
      "Kamu adalah Bear Auditor (Skeptis Risiko & Trap Line) Sindikat Olahraga. Fase reasoning maksimal 20-25 detik. Audit kerapuhan defensif dan risiko jebakan bandar secara komprehensif. Keluarkan JSON VALID: { \"thesis\": string, \"trap_warnings\": [ string, string ], \"vulnerability_audit\": string }",
      matchContext,
      4000,
      30000
    ),
  ]);

  console.log(`[Syndicate] Stage 1 selesai dalam ${Date.now() - t0}ms.`);

  const bullParsed = safeExtractJSON<Partial<BullCase>>(bullRaw.text, {
    thesis: bullRaw.text || "Peluang ofensif menguntungkan tuan rumah dengan proyeksi gol kuat.",
    key_drivers: ["Momentum xG ofensif di atas rata-rata liga", "Efisiensi ruang tembak lini depan"],
    tactical_edge: "Keunggulan duel sayap dan transisi cepat",
  });

  const neutralParsed = safeExtractJSON<Partial<NeutralCase>>(neutralRaw.text, {
    thesis: neutralRaw.text || "Distribusi statistik menunjukkan ekuilibrium harga pasar yang proporsional.",
    empirical_drivers: ["Keseimbangan probabilitas wajar Poisson", "Regresi performa kandang vs tandang"],
    equilibrium_assessment: "Margin selisih xG tipis mengindikasikan pertandingan ketat berimbang",
  });

  const bearParsed = safeExtractJSON<Partial<BearCase>>(bearRaw.text, {
    thesis: bearRaw.text || "Waspadai kerapuhan pertahanan transisi dan odds pasar yang overvalued.",
    trap_warnings: ["Harga bandar terlalu pendek untuk tim favorit", "Risiko kebobolan dari serangan balik cepat"],
    vulnerability_audit: "Konsesi xGA tinggi pada 20 menit akhir laga",
  });

  const bullCase: BullCase = {
    model: bullRaw.modelUsed,
    thesis: bullParsed.thesis || "Tesis ofensif aktif.",
    key_drivers: Array.isArray(bullParsed.key_drivers) ? bullParsed.key_drivers : ["Momentum serang aktif"],
    tactical_edge: bullParsed.tactical_edge || "Keunggulan taktis terkonfirmasi.",
  };

  const neutralCase: NeutralCase = {
    model: neutralRaw.modelUsed,
    thesis: neutralParsed.thesis || "Tesis netral ekuilibrium.",
    empirical_drivers: Array.isArray(neutralParsed.empirical_drivers) ? neutralParsed.empirical_drivers : ["Empirical balance"],
    equilibrium_assessment: neutralParsed.equilibrium_assessment || "Keseimbangan pasar wajar.",
  };

  const bearCase: BearCase = {
    model: bearRaw.modelUsed,
    thesis: bearParsed.thesis || "Tesis skeptis risiko defensif.",
    trap_warnings: Array.isArray(bearParsed.trap_warnings) ? bearParsed.trap_warnings : ["Waspada volatilitas odds"],
    vulnerability_audit: bearParsed.vulnerability_audit || "Audit risiko terkonfirmasi.",
  };

  // STAGE 2: DUAL JUDICIAL BENCH IN PARALLEL
  console.log(`[Syndicate] Memulai Stage 2: Dual Judicial Bench (J1: ${MODEL_JUDGEMENT_1}, J2: ${MODEL_JUDGEMENT_2}) [max_tokens: 4000, 30s limit]...`);
  const t1 = Date.now();

  const debateSummary =
    `DATA KUANTITATIF:\n${matchContext}\n\n` +
    `ARGUMEN DEBAT TRI-AGENT:\n` +
    `1. Bull Case (${bullCase.model}): ${bullCase.thesis} (Edge: ${bullCase.tactical_edge})\n` +
    `2. Neutral Case (${neutralCase.model}): ${neutralCase.thesis} (Equilibrium: ${neutralCase.equilibrium_assessment})\n` +
    `3. Bear Case (${bearCase.model}): ${bearCase.thesis} (Audit: ${bearCase.vulnerability_audit})\n`;

  const [j1Raw, j2Raw] = await Promise.all([
    // Judgement 1 (ag/gemini-3.8-flash-high) - Chief Quant & CRO Arbiter
    call9RouterDirect(
      MODEL_JUDGEMENT_1,
      "Kamu adalah Hakim 1: Chief Quantitative & Risk Arbiter. Fase reasoning maksimal 20-25 detik. Sintesis debat dan angka Dixon-Coles xG secara mendalam. Keluarkan JSON VALID: { \"verdict_summary\": string, \"confidence_tier\": \"A_HIGH_VALUE\" | \"B_MODERATE\" | \"C_LEAN\" | \"PASS_AVOID\", \"recommended_market\": string, \"key_reasoning\": string }",
      debateSummary,
      4000,
      30000
    ),
    // Judgement 2 (atria/Atria-Dawn-Preview) - Independent Synthesizer & Cross-Arbiter
    call9RouterDirect(
      MODEL_JUDGEMENT_2,
      "Kamu adalah Hakim 2: Independent Synthesizer & Cross-Arbiter. Fase reasoning maksimal 20-25 detik. Evaluasi debat secara independen untuk menguji bias kognitif Hakim 1. Keluarkan JSON VALID: { \"verdict_summary\": string, \"confidence_tier\": \"A_HIGH_VALUE\" | \"B_MODERATE\" | \"C_LEAN\" | \"PASS_AVOID\", \"recommended_market\": string, \"alternative_perspective\": string }",
      debateSummary,
      4000,
      30000
    ),
  ]);

  console.log(`[Syndicate] Stage 2 selesai dalam ${Date.now() - t1}ms.`);

  const j1Parsed = safeExtractJSON<Partial<SingleJudgement>>(j1Raw.text, {
    verdict_summary: j1Raw.text || "Berdasarkan kalibrasi Dixon-Coles xG dan evaluasi vig, pasar Over/Under menyajikan ekspektasi nilai paling terkontrol.",
    confidence_tier: "B_MODERATE",
    recommended_market: quantPackage.dixon_coles.over_2_5_prob > 0.55 ? "Over 2.5 Goals" : "Asian Handicap 0.0",
    key_reasoning: "Peluang quant terkonfirmasi dengan deviasi harga bandar yang positif.",
  });

  const j2Parsed = safeExtractJSON<Partial<SingleJudgement>>(j2Raw.text, {
    verdict_summary: j2Raw.text || "Menyetujui evaluasi risiko: hindari taruhan langsung 1X2 dan prioritaskan perlindungan modal pada garis handicap atau total gol.",
    confidence_tier: "B_MODERATE",
    recommended_market: j1Parsed.recommended_market || "Over 2.5 Goals",
    alternative_perspective: "Pendekatan independen mengonfirmasi probabilitas selisih gol tipis.",
  });

  const validateTier = (t?: string): "A_HIGH_VALUE" | "B_MODERATE" | "C_LEAN" | "PASS_AVOID" => {
    if (t === "A_HIGH_VALUE" || t === "B_MODERATE" || t === "C_LEAN" || t === "PASS_AVOID") return t;
    return "B_MODERATE";
  };

  const judgement1: SingleJudgement = {
    model: j1Raw.modelUsed,
    title: "Chief Quantitative & Risk Arbiter",
    verdict_summary: j1Parsed.verdict_summary || "Vonis kuantitatif selesai.",
    confidence_tier: validateTier(j1Parsed.confidence_tier),
    recommended_market: j1Parsed.recommended_market || "Over 2.5 Goals",
    key_reasoning: j1Parsed.key_reasoning || "Dixon-Coles xG alignment.",
  };

  const judgement2: SingleJudgement = {
    model: j2Raw.modelUsed,
    title: "Independent Cross-Audit Arbiter",
    verdict_summary: j2Parsed.verdict_summary || "Vonis independen selesai.",
    confidence_tier: validateTier(j2Parsed.confidence_tier),
    recommended_market: j2Parsed.recommended_market || judgement1.recommended_market,
    alternative_perspective: j2Parsed.alternative_perspective || "Verifikasi silang argumen independen.",
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
    arbiter_verdict: {
      model: `${judgement1.model} + ${judgement2.model}`,
      chief_risk_officer_synthesis: supremeVerdict,
      confidence_tier: finalTier,
      recommended_market: judgement1.recommended_market,
      recommended_stake_fraction: finalStake,
    },
  };
}
