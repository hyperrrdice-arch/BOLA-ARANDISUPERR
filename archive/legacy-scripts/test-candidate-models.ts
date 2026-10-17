import fs from "fs";
import path from "path";

// Load .env.local
const envPath = path.join(process.cwd(), ".env.local");
let apiKey = "sk-7b18b5c31d5d653c-z0q24f-c3542ecc";
let baseUrl = "http://localhost:20128/v1";

if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const match = line.trim().match(/^([^=]+)=(.*)$/);
    if (match) {
      if (match[1].trim() === "NINE_ROUTER_API_KEY") apiKey = match[2].trim();
      if (match[1].trim() === "NINE_ROUTER_BASE_URL") baseUrl = match[2].trim();
    }
  }
}

// Resilient text extractor identical to syndicate-orchestrator
function parse9RouterResponse(rawText: string): string {
  let extracted = "";
  let cleanRaw = rawText.replace(/data:\s*\[DONE\]\s*$/, "").trim();

  // 1. SSE lines
  if (cleanRaw.startsWith("data:") || cleanRaw.includes("data: {")) {
    const lines = cleanRaw.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data: ") && !trimmed.includes("[DONE]")) {
        try {
          const p = JSON.parse(trimmed.slice(6));
          const delta = p.choices?.[0]?.delta?.content || p.choices?.[0]?.message?.content;
          if (delta) extracted += delta;
        } catch {}
      }
    }
  }

  // 2. Standard JSON
  if (!extracted) {
    try {
      const json = JSON.parse(cleanRaw);
      extracted = json.choices?.[0]?.message?.content || json.choices?.[0]?.delta?.content || "";
      if (!extracted && json.choices?.[0]?.message?.reasoning_content) {
        extracted = json.choices[0].message.reasoning_content;
      }
    } catch {
      // Regex fallback
      const match = cleanRaw.match(/"content"\s*:\s*"([^"]+)"/);
      if (match && match[1]) {
        extracted = match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
      } else {
        extracted = cleanRaw;
      }
    }
  }

  return extracted.trim();
}

const CANDIDATES = [
  // BAI models (Chinese open-weights & flagship APIs)
  "bai/glm-5.3-flash",
  "bai/glm-5.3-flashx",
  "bai/qwen3.8-flash",
  "bai/qwen3.8-27b",
  "bai/deepseek-v4.1-flash",
  "bai/mimo-v2.6-flash",
  "bai/kimi-k2.8-preview",

  // NVIDIA models
  "nvidia/deepseek-ai/deepseek-v4-flash",
  "nvidia/deepseek-ai/deepseek-v4-pro",
  "nvidia/z-ai/glm-5.2",
  "nvidia/minimaxai/minimax-m2.7",

  // CX models (GPT series)
  "cx/gpt-5.6-sol",
  "cx/gpt-6.1-sol",
  "cx/gpt-daybreak-blue-latest",

  // KR models
  "kr/auto",
  "kr/deepseek-3.2-thinking",
  "kr/qwen3-coder-next-thinking",
  "kr/glm-5",
  "kr/claude-sonnet-4.5-thinking",

  // Ollama local
  "ollama/gpt-oss:120b",

  // AG models (Claude)
  "ag/claude-sonnet-5-5-medium",
  "ag/claude-sonnet-4-6",
];

async function testModel(modelId: string) {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: "Kamu adalah analis sepak bola kuantitatif. Jawab 1 kalimat santai:" },
          { role: "user", content: "Siapa tim terkuat di UCL saat ini?" },
        ],
        max_tokens: 150,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const duration = Date.now() - t0;
    const rawText = await res.text();

    if (!res.ok) {
      let msg = rawText.slice(0, 80);
      try {
        const j = JSON.parse(rawText);
        msg = j.error?.message || msg;
      } catch {}
      return { model: modelId, status: "ERROR", duration, error: msg };
    }

    const content = parse9RouterResponse(rawText);
    if (!content) {
      return { model: modelId, status: "EMPTY", duration, error: "Empty response text" };
    }

    return { model: modelId, status: "OK", duration, reply: content.slice(0, 70).replace(/\n/g, " ") };
  } catch (err: any) {
    clearTimeout(timer);
    return { model: modelId, status: "TIMEOUT/FAILED", duration: Date.now() - t0, error: err.message };
  }
}

async function main() {
  console.log("=== BENCHMARK RESILIENT CANDIDATE NON-GEMINI (9ROUTER) ===");
  console.log(`Base URL: ${baseUrl}\n`);

  const results: any[] = [];
  for (const m of CANDIDATES) {
    process.stdout.write(`Testing [${m}]... `);
    const result = await testModel(m);
    results.push(result);
    if (result.status === "OK") {
      console.log(`✅ OK (${result.duration}ms) -> "${result.reply}"`);
    } else {
      console.log(`❌ ${result.status} (${result.duration}ms): ${result.error}`);
    }
  }

  console.log("\n=== RINGKASAN MODEL YANG AKTIF DAN BISA DIPAKAI ===");
  const okModels = results.filter(r => r.status === "OK");
  for (const r of okModels) {
    console.log(`⭐ [${r.model}] - Speed: ${r.duration}ms | Output: "${r.reply}"`);
  }
}

main().catch(console.error);
