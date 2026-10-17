/**
 * Phase 0 — GATE probe: apakah 9Router nge-forward field `tools` ke model planner
 * (default: bai/mimo-v2.6-pro) sehingga native tool-calling jalan?
 *
 * Hasil:
 *   NATIVE_OK          -> lanjut jalur native (lib/agent/planner.ts pakai generateText + tools)
 *   CONVENTION_NEEDED  -> gateway nge-strip/abaikan tools tapi model "memanggil" via teks
 *                         -> pakai jalur fallback konvensi generateObject
 *   NO_TOOL_SUPPORT    -> model tidak paham tool sama sekali -> ganti model planner
 *
 * Jalankan: npx tsx scripts/test-planner-tool-calling.ts
 * Exit code 0 hanya kalau NATIVE_OK.
 */

import fs from "fs";
import path from "path";

// Load .env.local tanpa dependency (pola sama dengan scripts/test-candidate-models.ts)
const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.trim().match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2].trim();
    }
  }
}

const API_KEY = process.env.NINE_ROUTER_API_KEY?.trim();
const BASE_URL = process.env.NINE_ROUTER_BASE_URL?.trim();
const MODEL = process.env.MODEL_PLANNER?.trim() || "bai/mimo-v2.6-pro";

if (!API_KEY || !BASE_URL) {
  console.error("[Konfigurasi] NINE_ROUTER_API_KEY / NINE_ROUTER_BASE_URL belum terisi di .env.local");
  process.exit(1);
}

const TOOL = {
  type: "function",
  function: {
    name: "check_data_integrity",
    description: "Cek kelengkapan data match. Balikin field yang kosong.",
    parameters: {
      type: "object",
      properties: {
        matchId: { type: "string", description: "ID pertandingan, misal ARS-CHE" },
      },
      required: ["matchId"],
    },
  },
};

/** Gateway kadang tetap ngebalikin SSE walau stream=false — ekstrak JSON payload-nya. */
function extractResponseJson(rawText: string): any {
  const clean = rawText.replace(/data:\s*\[DONE\]\s*$/, "").trim();
  try {
    return JSON.parse(clean);
  } catch {}
  for (const line of clean.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("data: ") && !trimmed.includes("[DONE]")) {
      try {
        return JSON.parse(trimmed.slice(6));
      } catch {}
    }
  }
  return null;
}

async function main() {
  console.log(`=== PROBE NATIVE TOOL-CALLING ===`);
  console.log(`Model: ${MODEL} | Base URL: ${BASE_URL}\n`);

  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "Kamu planner analisis pra-laga. WAJIB gunakan tool yang tersedia dulu sebelum menjawab.",
          },
          { role: "user", content: 'Cek integritas data match "ARS-CHE", lalu berhenti.' },
        ],
        tools: [TOOL],
        tool_choice: "auto",
        temperature: 0,
        max_tokens: 400,
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err: any) {
    console.error(`❌ FETCH_FAILED (${Date.now() - t0}ms): ${err.message}`);
    process.exit(1);
  }

  const duration = Date.now() - t0;
  const rawText = await res.text();

  if (!res.ok) {
    let msg = rawText.slice(0, 200);
    try {
      msg = JSON.parse(rawText).error?.message || msg;
    } catch {}
    console.error(`❌ HTTP_${res.status} (${duration}ms): ${msg}`);
    process.exit(1);
  }

  const json = extractResponseJson(rawText);
  const message = json?.choices?.[0]?.message;
  if (!message) {
    console.error(`❌ RESPONSE_INVALID (${duration}ms): choices[0].message tidak ada`);
    console.error(rawText.slice(0, 300));
    process.exit(1);
  }

  const toolCalls = message.tool_calls;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    const call = toolCalls[0];
    const name = call.function?.name;
    let args: any = null;
    let argsError = "";
    try {
      args = JSON.parse(call.function?.arguments || "{}");
    } catch (e: any) {
      argsError = e.message;
    }

    const nameOk = name === "check_data_integrity";
    const argsOk = args && typeof args.matchId === "string" && args.matchId.length > 0;

    console.log(`tool_calls terdeteksi (${duration}ms):`);
    console.log(`  name     : ${name} ${nameOk ? "✅" : "❌ (tidak sesuai permintaan)"}`);
    console.log(`  arguments: ${call.function?.arguments} ${argsOk ? "✅" : `❌ (args invalid: ${argsError})`}`);

    if (nameOk && argsOk) {
      console.log(`\n=== VERDICT: NATIVE_OK ===`);
      process.exit(0);
    }
    console.log(`\n=== VERDICT: NO_TOOL_SUPPORT (tool_calls ada tapi rusak) ===`);
    process.exit(1);
  }

  // Tidak ada tool_calls — cek apakah model "memanggil tool" lewat teks
  const content: string = message.content || message.reasoning_content || "";
  const looksLikeConvention =
    content.includes("check_data_integrity") || /"tool"\s*:|"matchId"\s*:/.test(content);

  console.log(`tool_calls TIDAK ada (${duration}ms). Reply model:`);
  console.log(`  "${content.slice(0, 200).replace(/\n/g, " ")}"`);

  if (looksLikeConvention) {
    console.log(`\n=== VERDICT: CONVENTION_NEEDED ===`);
    console.log(`Gateway kemungkinan nge-strip field \`tools\`. Pakai jalur fallback konvensi (PLAN-C §5).`);
  } else {
    console.log(`\n=== VERDICT: NO_TOOL_SUPPORT ===`);
    console.log(`Model menjawab biasa tanpa memanggil tool. Pertimbangkan model planner lain.`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error("❌ UNCAUGHT:", err);
  process.exit(1);
});
