import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

const customFetch = async (url, init) => {
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

const nineRouter = createOpenAI({
  baseURL: "http://localhost:20128/v1",
  apiKey: process.env.NINE_ROUTER_API_KEY || "",
  fetch: customFetch
});

async function testSdk() {
  const models = [
    "bai/glm-5.3-flash",          // Bull Agent
    "bai/deepseek-v4.1-flash",     // Neutral Agent
    "ag/gemini-3.8-flash-medium",  // Bear Agent
    "ag/gemini-3.8-flash-high",    // Judgement 1
    "atria/Atria-Dawn-Preview"     // Judgement 2
  ];

  console.log("=== TESTING @ai-sdk/openai DENGAN 5 MODEL SYNDICATE ===");
  for (const m of models) {
    const start = Date.now();
    try {
      const res = await generateText({
        model: nineRouter.chat(m),
        prompt: "Jawab dengan satu kata: OKE",
        maxTokens: 20
      });
      console.log(`✅ [${m}] (${Date.now() - start}ms):`, res.text.trim().slice(0, 80));
    } catch (err) {
      console.error(`❌ [${m}] (${Date.now() - start}ms) ERROR:`, err.message);
    }
  }
}

testSdk();
