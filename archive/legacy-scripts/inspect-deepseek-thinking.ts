import fs from "fs";
import path from "path";

const apiKey = "sk-7b18b5c31d5d653c-z0q24f-c3542ecc";
const baseUrl = "http://localhost:20128/v1";

async function main() {
  console.log("=== INSPECTING DEEPSEEK & THINKING MODELS IN 9ROUTER ===");
  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const data = await res.json();
  const models: string[] = (data.data || []).map((m: any) => m.id);

  const matched = models.filter(
    (m) =>
      m.toLowerCase().includes("deepseek") ||
      m.toLowerCase().includes("thinking") ||
      m.toLowerCase().includes("ultra") ||
      m.toLowerCase().includes("reason")
  );

  console.log("\nModels matching deepseek/thinking/ultra/reason:");
  for (const m of matched) {
    console.log(`- ${m}`);
  }

  // Cek respon untuk beberapa model deepseek / thinking
  console.log("\nTesting prompt testing with thinking parameters on kr/deepseek-3.2-thinking...");
  
  // Test 1: standard
  await testPayload("kr/deepseek-3.2-thinking", {
    messages: [{ role: "user", content: "Jelaskan strategi low-block vs high-press dalam 2 kalimat." }],
    max_tokens: 200,
  });

  // Test 2: reasoning_effort: "high"
  await testPayload("kr/deepseek-3.2-thinking (with reasoning_effort=high)", {
    reasoning_effort: "high",
    messages: [{ role: "user", content: "Jelaskan strategi low-block vs high-press dalam 2 kalimat." }],
    max_tokens: 200,
  });

  // Test 3: thinking: { type: "enabled", budget_tokens: 32000 }
  await testPayload("kr/deepseek-3.2-thinking (with thinking budget)", {
    thinking: { type: "enabled", budget_tokens: 32000 },
    messages: [{ role: "user", content: "Jelaskan strategi low-block vs high-press dalam 2 kalimat." }],
    max_tokens: 200,
  });

  // Test 4: bai/deepseek-v4.1-flash with reasoning_effort
  await testPayload("bai/deepseek-v4.1-flash (with reasoning_effort=high)", {
    reasoning_effort: "high",
    messages: [{ role: "user", content: "Jelaskan strategi low-block vs high-press dalam 2 kalimat." }],
    max_tokens: 200,
  });
}

async function testPayload(label: string, payload: any) {
  const modelName = label.split(" ")[0];
  const body = { model: modelName, ...payload };
  const start = Date.now();
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const elapsed = Date.now() - start;
    if (!res.ok) {
      const err = await res.text();
      console.log(`❌ [${label}] (${elapsed}ms) HTTP ${res.status}: ${err.slice(0, 100)}`);
      return;
    }
    const json = await res.json();
    const msg = json.choices?.[0]?.message;
    const reasoning = msg?.reasoning_content || msg?.thought || json.choices?.[0]?.thinking;
    console.log(`✅ [${label}] (${elapsed}ms) Content: "${(msg?.content || "").slice(0, 80)}..."`);
    if (reasoning) {
      console.log(`   🧠 Thinking/Reasoning Detected (${reasoning.length} chars): "${reasoning.slice(0, 100)}..."`);
    } else {
      console.log(`   (No separate reasoning field, content has length ${msg?.content?.length})`);
    }
  } catch (e: any) {
    console.log(`❌ [${label}] Error: ${e.message}`);
  }
}

main().catch(console.error);
