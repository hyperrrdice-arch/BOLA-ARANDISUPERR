import fs from "fs";

const apiKey = "sk-7b18b5c31d5d653c-z0q24f-c3542ecc";
const baseUrl = "http://localhost:20128/v1";

function parse9RouterResponse(raw: string): string {
  try {
    const json = JSON.parse(raw);
    if (json.choices?.[0]?.message?.content) {
      return json.choices[0].message.content;
    }
  } catch {}

  let fullText = "";
  const lines = raw.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const jsonStr = trimmed.replace(/^data:\s*/, "");
    if (jsonStr === "[DONE]") continue;
    try {
      const parsed = JSON.parse(jsonStr);
      const delta =
        parsed.choices?.[0]?.delta?.content ||
        parsed.choices?.[0]?.message?.content ||
        "";
      fullText += delta;
    } catch {}
  }
  return fullText;
}

async function test(model: string, extra: any = {}) {
  console.log(`\nTesting ${model} with extra:`, JSON.stringify(extra));
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Hitung xG match jika tim A 15 tembakan 6 on target vs tim B 3 tembakan. Analisis ultra mendalam." }],
      max_tokens: 500,
      stream: false,
      ...extra,
    }),
  });

  const raw = await res.text();
  const parsed = parse9RouterResponse(raw);
  console.log(`Length: ${parsed.length} chars`);
  console.log(`Preview: ${parsed.slice(0, 200)}...`);
}

async function run() {
  await test("kr/deepseek-3.2-thinking", { reasoning_effort: "high" });
  await test("kr/deepseek-3.2-thinking-agentic", { reasoning_effort: "high" });
  await test("kr/deepseek-3.2-thinking", { thinking: { type: "enabled", budget_tokens: 32768 } });
  await test("bai/deepseek-v4.1-flash", { reasoning_effort: "high" });
}

run().catch(console.error);
