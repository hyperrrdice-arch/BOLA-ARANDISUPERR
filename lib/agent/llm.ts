import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { VOICE_GUIDE } from "@/lib/llm/voice-guide";
import type { VerifiedMatchIntelligence } from "@/lib/stats-validator";
import type { calculateDixonColes } from "@/lib/quant";
import { EDITORIAL } from "@/lib/llm/models";

/**
 * Infra LLM 9Router untuk jalur analisis editorial + planner.
 * Dipindahkan dari `app/api/agent/route.tsx` apa adanya supaya bisa dipakai
 * `lib/agent/planner.ts` tanpa duplikasi.
 */

// Injektor fetch untuk memastikan 9Router mengirimkan JSON murni non-streaming
const customFetch = async (url: RequestInfo | URL, init?: RequestInit) => {
  if (init?.body && typeof init.body === "string") {
    try {
      const parsed = JSON.parse(init.body);
      if (parsed.stream === undefined) {
        parsed.stream = false;
        init = { ...init, body: JSON.stringify(parsed) };
      }
    } catch {}
  }
  return fetch(url, init);
};

export const nineRouter = createOpenAI({
  baseURL: process.env.NINE_ROUTER_BASE_URL || "http://localhost:20128/v1",
  apiKey: process.env.NINE_ROUTER_API_KEY || "9router-local",
  fetch: customFetch,
});

export const MODEL_DEFAULT = EDITORIAL.MODEL_DEFAULT;

// Batas tunggu per percobaan model: editorial ikut tier judge 120s (R1). Tanpa ini,
// klien yang hold koneksi bisa menggantungkan run planner/editorial tanpa batas.
export const MODEL_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 120_000;

/** Gabungkan signal klien dengan timeout tunggu — dipakai SEMUA pemanggilan generateText. */
export function withModelTimeout(signal?: AbortSignal): AbortSignal {
  return signal
    ? AbortSignal.any([signal, AbortSignal.timeout(MODEL_TIMEOUT_MS)])
    : AbortSignal.timeout(MODEL_TIMEOUT_MS);
}

// Helper untuk memanggil model VPS dengan failover aman
export async function callModelWithFallback(
  targetModel: string,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal
) {
  try {
    if (process.env.PIPELINE_DEBUG) {
      console.log(`[9Router] Menjalankan target model: ${targetModel}...`);
    }
    const res = await generateText({
      model: nineRouter.chat(targetModel),
      system: systemPrompt,
      prompt: userPrompt,
      abortSignal: withModelTimeout(signal),
    });
    return { text: res.text, modelUsed: targetModel };
  } catch (primaryErr) {
    // Client sudah pergi → jangan bakar percobaan fallback.
    if (signal?.aborted) {
      throw primaryErr instanceof Error ? primaryErr : new Error(String(primaryErr));
    }
    console.warn(`[9Router] Model ${targetModel} gagal, beralih ke fallback ${MODEL_DEFAULT}:`, primaryErr);
    try {
      const res = await generateText({
        model: nineRouter.chat(MODEL_DEFAULT),
        system: systemPrompt,
        prompt: userPrompt,
        abortSignal: withModelTimeout(signal),
      });
      return { text: res.text, modelUsed: `${targetModel} (fallback: ${MODEL_DEFAULT})` };
    } catch (fallbackErr) {
      throw new Error(`Gagal memanggil model ${targetModel} & fallback ${MODEL_DEFAULT}: ${fallbackErr}`);
    }
  }
}

export function extractJSON(rawText: string) {
  try {
    const match = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const target = match ? match[1] : rawText;
    const start = target.indexOf("{");
    const end = target.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(target.slice(start, end + 1));
    }
    return JSON.parse(target);
  } catch {
    return {};
  }
}

export interface EditorialVigData {
  fair_prob: { home: number; draw: number; away: number };
}

/**
 * Prompt ketat anti-halusinasi (Strict Closed-World Grounding) + template JSON
 * output editorial. Kode dipindahkan verbatim dari route.tsx.
 */
export function buildEditorialPrompts(params: {
  intel: VerifiedMatchIntelligence;
  quantPackage: any;
  dcOutput: ReturnType<typeof calculateDixonColes>;
  vigOutput: EditorialVigData | null;
  hLast: number | null | undefined;
  dLast: number | null | undefined;
  aLast: number | null | undefined;
  today: string;
}): { systemPrompt: string; userPrompt: string } {
  const { intel, quantPackage, dcOutput, vigOutput, hLast, dLast, aLast, today } = params;

  // Voice guide di-PREPEND; kontrak JSON tetap PALING AKHIR (baris terakhir builder).
  const systemPrompt =
    VOICE_GUIDE + "\n\n" +
    `Kamu adalah CHIEF RISK OFFICER (ARBITER KEPALA) Sindikat Olahraga Enterprise Tier-1.\n` +
    `Hari analisis: ${today}.\n\n` +
    `ATURAN MUTLAK CLOSED-WORLD GROUNDING (ZERO HALLUCINATION DIRECTIVE):\n` +
    `1. DILARANG KERAS MENGARANG NAMA PEMAIN: Kamu HANYA boleh menyebut nama pemain yang tercantum di payload JSON 'lineups.home_starting_xi' atau 'lineups.away_starting_xi'. Jika lineups.is_available bernilai false, nyatakan secara eksplisit bahwa lineup belum diumumkan resmi dan analisis berbasis karakter tim secara kolektif.\n` +
    `2. DILARANG MENGARANG LAPORAN CEDERA: Hanya kutip cedera yang tercatat di 'injuries'. Jika kosong, tulis 'Tidak ada laporan cedera resmi'.\n` +
    `3. DILARANG MENGARANG SKOR MASA LALU: Hanya kutip rekor H2H dari 'h2h_history.recent_meetings'. Jika kosong, sebut 'Data H2H resmi belum tersedia'.\n` +
    `4. WAJIB SELARAS DENGAN QUANT ENGINE: Nilai xG (${dcOutput.lambda} vs ${dcOutput.mu}) dan probabilitas murni telah dihitung secara matematis. Dilarang bertentangan dengan angka ini.\n` +
    `5. KONSISTENSI DATA HILANG: Setiap poin dalam 'missing_data_registry' wajib dimasukkan ke array 'data_tidak_tersedia'.\n` +
    `6. PASAR KHUSUS BUKAN REKOMENDASI VALUE: Jika ada 'special_markets' di payload (headed goal/corners/cards), itu HANYA fair odds model. Odds bandar untuk pasar tersebut TIDAK tersedia, jadi EV tidak dapat dihitung. Dilarang mengklaim pasar khusus punya "+EV", "edge", atau "value". Yang boleh dinilai +EV hanya pasar di 'value_bets'.\n` +
    `7. STATUS ESTIMASI WAJIB DIHORMATI: Jika sebuah pasar bertanda is_estimated=true atau confidence_tier INSUFFICIENT_DATA/LOW, jangan sajikan sebagai angka terukur. Sebutkan sebagai estimasi berbasis rata-rata liga.\n\n` +
    `Tugas kamu adalah menyusun analisis taktis, ulasan wasit, evaluasi pasar, dan prediksi editorial yang objektif dan berpijak penuh pada data intelijen di atas.\n` +
    `KEMBALIKAN OUTPUT HANYA DALAM FORMAT JSON VALID.`;

  const userPayload = {
    intelligence: intel,
    quant: quantPackage,
    data_audit: {
      is_strictly_grounded: true,
      missing_data_registry: intel.missing_data_registry,
    },
  };

  const userPrompt =
    `Berikut adalah data intelijen terverifikasi (Zod-Validated) untuk laga ${intel.pertandingan.tim_kandang} vs ${intel.pertandingan.tim_tamu}:\n\n` +
    `\`\`\`json\n` +
    JSON.stringify(userPayload, null, 2) +
    `\n\`\`\`\n\n` +
    `Keluarkan analisis komite sindikat dalam FORMAT JSON VALID:\n` +
    `{\n` +
    `  "pertandingan": {\n` +
    `    "id": "${intel.pertandingan.id}",\n` +
    `    "tim_kandang": "${intel.pertandingan.tim_kandang}",\n` +
    `    "tim_tamu": "${intel.pertandingan.tim_tamu}",\n` +
    `    "waktu": "${intel.pertandingan.waktu}",\n` +
    `    "kompetisi": "${intel.pertandingan.kompetisi}",\n` +
    `    "venue": "${intel.pertandingan.venue}",\n` +
    `    "wasit": "${intel.pertandingan.wasit}"\n` +
    `  },\n` +
    `  "wasit_analisis": {\n` +
    `    "nama": "${intel.wasit_detail.name}",\n` +
    `    "rata_rata_kartu": ${intel.wasit_detail.avg_yellow_per_game ?? "null"},\n` +
    `    "total_kartu_kuning": ${intel.wasit_detail.yellow_cards},\n` +
    `    "total_kartu_merah": ${intel.wasit_detail.red_cards},\n` +
    `    "level_ketegasan": "${intel.wasit_detail.strictness_level}",\n` +
    `    "catatan": string (ulasan ketegasan wasit berdasarkan data faktual di atas)\n` +
    `  },\n` +
    `  "taktik_dan_lineup": {\n` +
    `    "formasi_kandang": "${intel.lineups.home_formation}",\n` +
    `    "formasi_tamu": "${intel.lineups.away_formation}",\n` +
    `    "status_lineup": "${intel.lineups.status_label}",\n` +
    `    "starting_xi_kandang": ${JSON.stringify(intel.lineups.home_starting_xi)},\n` +
    `    "starting_xi_tamu": ${JSON.stringify(intel.lineups.away_starting_xi)},\n` +
    `    "ulasan_benturan_taktik": string (ulasan benturan formasi & ruang transisi)\n` +
    `  },\n` +
    `  "coverage_liga": { "has_xg": true, "has_odds": ${intel.market_odds.is_available}, "has_shotmap": false, "has_player_stats": ${intel.lineups.is_available} },\n` +
    `  "form_dan_split": {\n` +
    `    "form_kandang": "${intel.form_split.home_form_summary}",\n` +
    `    "form_tamu": "${intel.form_split.away_form_summary}",\n` +
    `    "rekor_kandang_spesifik": "${intel.form_split.home_form_summary}",\n` +
    `    "rekor_tandang_spesifik": "${intel.form_split.away_form_summary}"\n` +
    `  },\n` +
    `  "klasemen": "Posisi klasemen kompetisi reguler",\n` +
    `  "bursa_pasar": {\n` +
    `    "ringkasan_1x2": "${hLast ? `Pasar 1X2: ${hLast} / ${dLast} / ${aLast}` : "Pasar 1X2 belum dibuka secara resmi"}",\n` +
    `    "asian_handicap": "Pasar handicap seimbang",\n` +
    `    "over_under": "Line Total Gol 2.5",\n` +
    `    "btts": "Pasar Kedua Tim Mencetak Gol",\n` +
    `    "pergerakan_smart_money": "Aliran dana pasar stabil"\n` +
    `  },\n` +
    `  "probabilitas_pasar": ${
      hLast && dLast && aLast && vigOutput
        ? JSON.stringify({
            kandang: Math.round(vigOutput.fair_prob.home * 100),
            seri: Math.round(vigOutput.fair_prob.draw * 100),
            tandang: Math.round(vigOutput.fair_prob.away * 100),
          })
        : "null"
    },\n` +
    `  "statistik_mendalam": {\n` +
    `    "shot_quality": {\n` +
    `      "npxg_kandang": ${dcOutput.lambda},\n` +
    `      "npxg_tamu": ${dcOutput.mu},\n` +
    `      "catatan": "xG Dixon-Coles terkalibrasi"\n` +
    `    },\n` +
    `    "pemain_kunci": [\n` +
    (intel.lineups.home_starting_xi[0]
      ? `      { "nama": "${intel.lineups.home_starting_xi[0].name}", "tim": "${intel.pertandingan.tim_kandang}", "peran": "Pemain Kunci", "catatan": "Tercatat di starting XI resmi" }\n`
      : `      { "nama": "Kolektif Tim", "tim": "${intel.pertandingan.tim_kandang}", "peran": "Unit Taktis", "catatan": "Lineup belum dirilis" }\n`) +
    `    ]\n` +
    `  },\n` +
    `  "faktor_kunci": [ "Dixon-Coles xG", "Efisiensi Konversi", "Disiplin Taktis" ],\n` +
    `  "prediksi": {\n` +
    `    "hasil": string,\n` +
    `    "keyakinan": "rendah" | "sedang" | "tinggi",\n` +
    `    "alasan": string,\n` +
    `    "konsensus_panel": string\n` +
    `  },\n` +
    `  "data_tidak_tersedia": ${JSON.stringify(intel.missing_data_registry)}\n` +
    `}`;

  return { systemPrompt, userPrompt };
}
