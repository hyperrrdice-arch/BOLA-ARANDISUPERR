import fs from "fs";

const apiKey = "sk-7b18b5c31d5d653c-z0q24f-c3542ecc";
const baseUrl = "http://localhost:20128/v1";

const candidates = [
  "XEMARUX",
  "deepseek/deepseek-v4.1-flash",
  "deepseek/claude-sonnet-5",
  "deepseek/gemini-3.8-flash-high",
  "deepseek/glm-5.3-flash",
  "deepseek/gpt-6-sol",
  "deepseek/grok-4.7",
];

async function testModel(model: string) {
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
        messages: [{ role: "user", content: "Halo! Tes respon singkat 1 kata." }],
        max_tokens: 30,
        stream: false,
      }),
    });

    const elapsed = Date.now() - start;
    const raw = await res.text();
    if (!res.ok) {
      return { ok: false, model, elapsed, error: `HTTP ${res.status}: ${raw.slice(0, 120)}` };
    }

    let text = "";
    try {
      const j = JSON.parse(raw);
      text = j.choices?.[0]?.message?.content || "";
    } catch {
      for (const line of raw.split("\n")) {
        if (line.startsWith("data: ") && !line.includes("[DONE]")) {
          try {
            const p = JSON.parse(line.slice(6));
            text += p.choices?.[0]?.delta?.content || "";
          } catch {}
        }
      }
    }
    return { ok: true, model, elapsed, content: text.trim().replace(/\n/g, " ") };
  } catch (e: any) {
    return { ok: false, model, elapsed: Date.now() - start, error: e.message };
  }
}

async function main() {
  console.log("=== PENGUJIAN MODEL XEMARUX (ai.xemarux.com) ===");
  for (const m of candidates) {
    const res = await testModel(m);
    if (res.ok) {
      console.log(`✅ [${res.model}] (${res.elapsed}ms) -> "${res.content}"`);
    } else {
      console.log(`❌ [${res.model}] (${res.elapsed}ms) -> ${res.error}`);
    }
  }
}

main().catch(console.error);
