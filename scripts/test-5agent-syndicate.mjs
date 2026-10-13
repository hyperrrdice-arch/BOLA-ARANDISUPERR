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

async function callSafe(model, system, prompt, timeoutMs = 25000) {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await generateText({
      model: nineRouter.chat(model),
      system,
      prompt,
      abortSignal: controller.signal
    });
    clearTimeout(timer);
    return { success: true, text: res.text, elapsed: Date.now() - start, model };
  } catch (err) {
    return { success: false, error: err.message, elapsed: Date.now() - start, model };
  }
}

async function test5AgentPipeline() {
  console.log("=== TEST PIPELINE 5-AGENT SYNDICATE ===");
  const sampleMatch = "Pohang Steelers vs Johor Darul Ta'zim | xG: 1.63 vs 1.56 | Odds: Home 2.10, Draw 3.40, Away 3.20";

  // Stage 1: Bull, Neutral, Bear in parallel
  console.log("\n[Stage 1] Memanggil Bull (GLM-5.3), Neutral (DeepSeek-v4.1), Bear (Gemini Medium) secara PARALEL...");
  const t0 = Date.now();

  const [bullRes, neutralRes, bearRes] = await Promise.all([
    callSafe(
      "bai/glm-5.3-flash",
      "Kamu adalah Bull Analyst (Taktis Ofensif). Berikan tesis ofensif singkat, 2 pemicu gol, dan edge dalam 2-3 kalimat.",
      `Analisis laga ini: ${sampleMatch}`
    ),
    callSafe(
      "bai/deepseek-v4.1-flash",
      "Kamu adalah Neutral Analyst (Data Empiris & Ekuilibrium). Berikan ulasan netral, probabilitas wajar, dan balance pertandingan dalam 2-3 kalimat.",
      `Analisis laga ini: ${sampleMatch}`
    ),
    callSafe(
      "ag/gemini-3.8-flash-medium",
      "Kamu adalah Bear Auditor (Skeptis Risiko & Trap Line). Berikan peringatan risiko, potensi trap bandar, dan kelemahan dalam 2-3 kalimat.",
      `Analisis laga ini: ${sampleMatch}`
    )
  ]);

  console.log(`Stage 1 selesai dalam ${Date.now() - t0}ms:`);
  console.log(`- Bull (${bullRes.model}): ${bullRes.success ? "✅ " + bullRes.elapsed + "ms" : "❌ " + bullRes.error}`);
  console.log(`- Neutral (${neutralRes.model}): ${neutralRes.success ? "✅ " + neutralRes.elapsed + "ms" : "❌ " + neutralRes.error}`);
  console.log(`- Bear (${bearRes.model}): ${bearRes.success ? "✅ " + bearRes.elapsed + "ms" : "❌ " + bearRes.error}`);

  // Stage 2: Dual Judgement (Gemini High & Atria Dawn)
  console.log("\n[Stage 2] Memanggil Dual Judgement: J1 (Gemini High) & J2 (Atria Dawn)...");
  const t1 = Date.now();

  const debateContext = `
Debat Panel:
- Bull Case (${bullRes.model}): ${bullRes.text?.slice(0, 200)}
- Neutral Case (${neutralRes.model}): ${neutralRes.text?.slice(0, 200)}
- Bear Case (${bearRes.model}): ${bearRes.text?.slice(0, 200)}
Data Kuantitatif: ${sampleMatch}
`;

  const [j1Res, j2Res] = await Promise.all([
    callSafe(
      "ag/gemini-3.8-flash-high",
      "Kamu adalah Hakim 1 (Chief Quantitative Arbiter). Sintesis debat di atas, tetapkan pasar terbaik dan confidence tier (A/B/C/PASS) secara objektif dalam 2-3 kalimat.",
      debateContext
    ),
    callSafe(
      "atria/Atria-Dawn-Preview",
      "Kamu adalah Hakim 2 (Independent Synthesizer & Cross-Arbiter). Evaluasi debat di atas secara independen, berikan vonis pasar terbaik dan perbandingan dalam 2-3 kalimat.",
      debateContext
    )
  ]);

  console.log(`Stage 2 selesai dalam ${Date.now() - t1}ms:`);
  console.log(`- Judgement 1 (${j1Res.model}): ${j1Res.success ? "✅ " + j1Res.elapsed + "ms" : "❌ " + j1Res.error}`);
  console.log(`- Judgement 2 (${j2Res.model}): ${j2Res.success ? "✅ " + j2Res.elapsed + "ms" : "❌ " + j2Res.error}`);

  console.log("\n=== HASIL VONIS KEDUA HAKIM ===");
  console.log("Hakim 1 (Gemini High):\n", j1Res.text?.trim());
  console.log("\nHakim 2 (Atria Dawn):\n", j2Res.text?.trim());
}

test5AgentPipeline();
