const apiKey = "sk-7b18b5c31d5d653c-z0q24f-c3542ecc";
const baseUrl = "http://localhost:20128/v1";

const formats = [
  "XEMARUX/glm-5.3-flash",
  "xemarux/glm-5.3-flash",
  "openai-compatible-responses-ccf767d6-352f-4817-a8b4-bf4b877f7b3b/glm-5.3-flash",
  "deepseek/glm-5.3-flash",
  "XEMARUX/deepseek-v4.1-flash",
  "xemarux/deepseek-v4.1-flash",
];

async function test(model: string) {
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Halo, tes 1 kata." }],
        max_tokens: 15,
        stream: false,
      }),
    });
    const txt = await res.text();
    console.log(`[${model}] -> HTTP ${res.status}: ${txt.slice(0, 150)}`);
  } catch (e: any) {
    console.log(`[${model}] -> Error: ${e.message}`);
  }
}

async function main() {
  for (const m of formats) {
    await test(m);
  }
}

main().catch(console.error);
