import fs from "fs";
import path from "path";

// Load .env.local
const envPath = path.join(process.cwd(), ".env.local");
let apiKey = "sk-7b18b5c31d5d653c-z0q24f-c3542ecc";
let baseUrl = "http://localhost:20128/v1";

const configuredModels = {
  MODEL_DEFAULT: "bai/glm-5.3-flash",
  MODEL_FETCHER_DISPATCHER: "bai/qwen3.8-27b",
  MODEL_BULL: "bai/glm-5.3-flash",
  MODEL_NEUTRAL: "bai/qwen3.8-flash",
  MODEL_BEAR: "bai/deepseek-v4.1-flash",
  MODEL_JUDGEMENT_1: "ag/gemini-3.8-flash-high",
  MODEL_JUDGEMENT_2: "kr/deepseek-3.2-thinking",
  BETTING_MODEL_A: "bai/qwen3.8-27b",
  BETTING_MODEL_B: "bai/deepseek-v4.1-flash",
};

if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const match = line.trim().match(/^([^=]+)=(.*)$/);
    if (match) {
      const k = match[1].trim();
      const v = match[2].trim();
      if (k === "NINE_ROUTER_API_KEY") apiKey = v;
      if (k === "NINE_ROUTER_BASE_URL") baseUrl = v;
      if (k in configuredModels) (configuredModels as any)[k] = v;
    }
  }
}

async function testModel(role: string, model: string) {
  const start = Date.now();
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Halo, tes respon singkat 1 kata." }],
        max_tokens: 15,
        stream: false,
      }),
    });

    const elapsed = Date.now() - start;
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, role, model, elapsed, error: `HTTP ${res.status}: ${txt.slice(0, 100)}` };
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "(no content)";
    return { ok: true, role, model, elapsed, content: content.trim().replace(/\n/g, " ") };
  } catch (err: any) {
    return { ok: false, role, model, elapsed: Date.now() - start, error: err.message };
  }
}

async function main() {
  console.log("=== CHECK CONFIGURED MODELS IN 9ROUTER ===");
  console.log(`Base URL: ${baseUrl}\n`);

  for (const [role, model] of Object.entries(configuredModels)) {
    const res = await testModel(role, model);
    if (res.ok) {
      console.log(`✅ [${res.role}] ${res.model} (${res.elapsed}ms) -> "${res.content}"`);
    } else {
      console.log(`❌ [${res.role}] ${res.model} (${res.elapsed}ms) -> ERROR: ${res.error}`);
    }
  }
}

main().catch(console.error);
