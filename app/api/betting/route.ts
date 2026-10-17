import { generateText } from "ai";
import { z } from "zod";
import { get1xBetMarketsV2, find1xBetMatch } from "@/lib/1xbet";
import { evaluateValueBet } from "@/lib/quant";
import { nineRouter } from "@/lib/agent/llm";

// Klien 9Router tunggal: lihat lib/agent/llm.ts (customFetch non-streaming).

const MODEL_DEFAULT = process.env.NINE_ROUTER_MODEL || "bai/glm-5.3-flash";
const MODEL_A = process.env.BETTING_MODEL_A || "bai/qwen3.8-27b";
const MODEL_B = process.env.BETTING_MODEL_B || "bai/deepseek-v4.1-flash";

// Helper regex to extract JSON
function extractJSON(text: string): any {
  try {
    return JSON.parse(text);
  } catch {}

  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match) {
    try {
      return JSON.parse(match[1]);
    } catch {}
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {}
  }

  return null;
}

const BettingAdviceSchema = z.object({
  rekomendasi_aman: z.object({
    pasar: z.string(),
    pilihan: z.string(),
    base: z.union([z.number(), z.string(), z.null()]).optional(),
    odds: z.number(),
    alasan: z.string(),
    expected_value: z.string().optional(),
    recommended_stake_kelly: z.string().optional(),
  }),
  rekomendasi_value: z.object({
    pasar: z.string(),
    pilihan: z.string(),
    base: z.union([z.number(), z.string(), z.null()]).optional(),
    odds: z.number(),
    alasan: z.string(),
    expected_value_rating: z.string(),
    expected_value: z.string().optional(),
    recommended_stake_kelly: z.string().optional(),
  }),
  pasar_niche: z.object({
    pasar: z.string(),
    pilihan: z.string(),
    base: z.union([z.number(), z.string(), z.null()]).optional(),
    odds: z.number(),
    alasan: z.string(),
    expected_value: z.string().optional(),
  }),
  pasar_hindari: z.object({
    pasar: z.string(),
    pilihan: z.string(),
    base: z.union([z.number(), z.string(), z.null()]).optional(),
    odds: z.number(),
    alasan: z.string(),
  }),
  skor_keyakinan: z.number().min(1).max(100),
  catatan_strategi: z.string(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      match_id_1xbet,
      league_1xbet_id,
      home_team,
      away_team,
      competition,
      match_context,
    } = body;

    let targetMatchId = match_id_1xbet;
    let matchMetaName = `${home_team || "Home"} vs ${away_team || "Away"}`;

    // 1. Resolve 1xBet Match ID
    if (!targetMatchId) {
      if (!home_team || !away_team) {
        return Response.json(
          { error: "Diperlukan parameter home_team & away_team atau match_id_1xbet." },
          { status: 400 }
        );
      }

      console.log(`[1xBet API] Mencari laga otomatis: ${home_team} vs ${away_team} (${competition}, leagueId: ${league_1xbet_id})...`);
      const found = await find1xBetMatch(home_team, away_team, competition, league_1xbet_id);
      if (!found) {
        return Response.json({
          status: "not_found",
          message: `Pertandingan ${home_team} vs ${away_team} belum ditemukan otomatis di 1xBet. Silakan masukkan 1xBet Match ID secara manual.`,
        });
      }
      targetMatchId = String(found.match.id);
      matchMetaName = `${found.match.home_team} vs ${found.match.away_team}`;
    }

    // 2. Fetch 1xBet Markets V2 (Cached 60 min to protect 500 req/month quota)
    console.log(`[1xBet API] Mengambil pasar v2 untuk Match ID: ${targetMatchId}...`);
    const markets = await get1xBetMarketsV2(targetMatchId);
    if (!markets || markets.length === 0) {
      return Response.json({
        status: "empty",
        message: `Tidak ada pasar taruhan aktif yang ditemukan untuk Match ID ${targetMatchId} di 1xBet.`,
      });
    }

    console.log(`[1xBet API] Berhasil mendapatkan ${markets.length} pasar taruhan.`);

    // 3. Compact representation of the 500+ lines for the LLM prompt
    const compactMarkets = markets.map((m) => ({
      market_id: m.market_id,
      name: m.name,
      base: m.base,
      odds: m.odds,
    }));

    const systemPrompt =
      "Anda adalah Senior Sports Quant & Professional Value Bettor di Sindikat Taruhan Enterprise. " +
      "Tugas Anda adalah membedah ratusan baris pasar taruhan dari 1xBet dan membandingkannya dengan probabilitas matematis Quant Engine (+EV) dari Fase 1. " +
      "Cari opsi taruhan dengan nilai (Expected Value / Edge) positif, identifikasi opsi teraman (Banker), opsi niche bernilai tinggi, " +
      "serta peringatkan pasar jebakan bandar (Trap Bet). Keluarkan respons HANYA DALAM FORMAT JSON VALID yang mematuhi skema.";

    const userPrompt =
      `Pertandingan: ${matchMetaName} (${competition || "Kompetisi"})\n\n` +
      `KONTEKS INTELIJEN & QUANT ENGINE DARI FASE 1:\n` +
      `${typeof match_context === "string" ? match_context : JSON.stringify(match_context || {}, null, 2)}\n\n` +
      `DATA LENGKAP PASAR 1XBET (${compactMarkets.length} PASAR AKTIF):\n` +
      `\`\`\`json\n` +
      JSON.stringify(compactMarkets) +
      `\n\`\`\`\n\n` +
      `Tentukan pilihan taruhan terbaik dan kembalikan JSON dengan struktur:\n` +
      `{\n` +
      `  "rekomendasi_aman": { "pasar": string, "pilihan": string, "base": number | string | null, "odds": number, "alasan": string, "expected_value": "+X.X%", "recommended_stake_kelly": "X.X% Bankroll" },\n` +
      `  "rekomendasi_value": { "pasar": string, "pilihan": string, "base": number | string | null, "odds": number, "alasan": string, "expected_value_rating": string, "expected_value": "+X.X%", "recommended_stake_kelly": "X.X% Bankroll" },\n` +
      `  "pasar_niche": { "pasar": string, "pilihan": string, "base": number | string | null, "odds": number, "alasan": string, "expected_value": "+X.X%" },\n` +
      `  "pasar_hindari": { "pasar": string, "pilihan": string, "base": number | string | null, "odds": number, "alasan": string },\n` +
      `  "skor_keyakinan": number (1-100),\n` +
      `  "catatan_strategi": string\n` +
      `}`;

    // 4. Dual Model Concurrent Execution via 9Router dengan Fallback
    console.log(`[9Router] Memulai analisis paralel: Model A (${MODEL_A}) & Model B (${MODEL_B})...`);

    const callModel = async (modelId: string) => {
      try {
        const { text } = await generateText({
          model: nineRouter.chat(modelId),
          system: systemPrompt,
          prompt: userPrompt,
        });
        const raw = extractJSON(text);
        const parsed = BettingAdviceSchema.safeParse(raw);
        if (parsed.success) {
          return { success: true, model: modelId, data: parsed.data };
        }
        return { success: true, model: modelId, data: raw };
      } catch (err) {
        console.warn(`[9Router] Model ${modelId} gagal, mencoba fallback ${MODEL_DEFAULT}:`, err);
        try {
          const { text } = await generateText({
            model: nineRouter.chat(MODEL_DEFAULT),
            system: systemPrompt,
            prompt: userPrompt,
          });
          const raw = extractJSON(text);
          return { success: true, model: `${modelId} (fallback: ${MODEL_DEFAULT})`, data: raw };
        } catch (fallbackErr) {
          return { success: false, model: modelId, error: String(fallbackErr) };
        }
      }
    };

    const [resultA, resultB] = await Promise.all([
      callModel(MODEL_A),
      callModel(MODEL_B),
    ]);

    // 5. Consensus Synthesis
    let consensusAgreed = false;
    let consensusSummary = "Kedua model memberikan sudut pandang pasar yang berbeda.";

    if (resultA.success && resultB.success && resultA.data && resultB.data) {
      const aPick = resultA.data.rekomendasi_aman?.pilihan || "";
      const bPick = resultB.data.rekomendasi_aman?.pilihan || "";
      const aVal = resultA.data.rekomendasi_value?.pilihan || "";
      const bVal = resultB.data.rekomendasi_value?.pilihan || "";

      if (aPick === bPick || aVal === bVal) {
        consensusAgreed = true;
        consensusSummary = `KONSENSUS KUAT: Kedua model (${MODEL_A} & ${MODEL_B}) sepakat merekomendasikan ${aPick === bPick ? aPick : aVal}.`;
      } else {
        consensusSummary = `DIVERGENSI PASAR: ${MODEL_A} condong ke "${aPick || aVal}", sedangkan ${MODEL_B} memilih "${bPick || bVal}".`;
      }
    }

    return Response.json({
      status: "success",
      match_id_1xbet: targetMatchId,
      match_name: matchMetaName,
      total_markets_scanned: markets.length,
      sample_markets: markets.slice(0, 12),
      markets: markets,
      all_markets: markets,
      model_a: {
        model_name: MODEL_A,
        result: resultA,
      },
      model_b: {
        model_name: MODEL_B,
        result: resultB,
      },
      consensus: {
        agreed: consensusAgreed,
        summary: consensusSummary,
      },
    });
  } catch (err) {
    console.error("[api/betting] Server error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const matchId = searchParams.get("match_id");
    const homeTeam = searchParams.get("home");
    const awayTeam = searchParams.get("away");
    const competition = searchParams.get("competition") || undefined;
    const leagueId = searchParams.get("league_id") ? Number(searchParams.get("league_id")) : undefined;

    let targetMatchId = matchId;
    let matchMetaName = `${homeTeam || "Home"} vs ${awayTeam || "Away"}`;

    if (!targetMatchId) {
      if (!homeTeam || !awayTeam) {
        return Response.json(
          { error: "Parameter match_id atau home & away wajib diisi." },
          { status: 400 }
        );
      }
      const found = await find1xBetMatch(homeTeam, awayTeam, competition, leagueId);
      if (!found) {
        return Response.json({
          status: "not_found",
          message: `Pertandingan ${homeTeam} vs ${awayTeam} belum ditemukan di 1xBet. Silakan masukkan 1xBet Match ID secara manual.`,
          markets: [],
        });
      }
      targetMatchId = String(found.match.id);
      matchMetaName = `${found.match.home_team} vs ${found.match.away_team}`;
    }

    const markets = await get1xBetMarketsV2(targetMatchId);
    return Response.json({
      status: "success",
      match_id_1xbet: targetMatchId,
      match_name: matchMetaName,
      total_markets_scanned: markets?.length || 0,
      markets: markets || [],
      all_markets: markets || [],
    });
  } catch (err) {
    console.error("[api/betting GET] Server error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

