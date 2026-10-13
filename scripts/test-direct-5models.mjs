const apiKey = process.env.NINE_ROUTER_API_KEY || "";
const baseUrl = "http://localhost:20128/v1";

async function call9RouterDirect(model, system, prompt, maxTokens = 250) {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);

  try {
    const messages = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: prompt });

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.2
      }),
      signal: controller.signal
    });

    clearTimeout(timer);
    const elapsed = Date.now() - start;

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `HTTP ${res.status}: ${errText.slice(0, 100)}`, elapsed, model };
    }

    const text = await res.text();
    let content = "";
    if (text.startsWith("data:")) {
      const lines = text.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ") && !line.includes("[DONE]")) {
          try {
            const p = JSON.parse(line.slice(6));
            content += p.choices?.[0]?.delta?.content || "";
          } catch {}
        }
      }
    } else {
      try {
        const json = JSON.parse(text);
        content = json.choices?.[0]?.message?.content || "";
      } catch {
        content = text;
      }
    }

    return { success: true, text: content.trim(), elapsed, model };
  } catch (err) {
    clearTimeout(timer);
    return { success: false, error: err.message, elapsed: Date.now() - start, model };
  }
}

async function runDirectTest() {
  console.log("=== NATIVE FETCH BENCHMARK: 5 SYNDICATE MODELS ===");
  const sample = "Pohang Steelers vs JDT | xG 1.63 vs 1.56 | Odds: 2.10 / 3.40 / 3.20";

  console.log("\n[1] Running Bull, Neutral, Bear PARALLEL...");
  const t0 = Date.now();
  const [bull, neutral, bear] = await Promise.all([
    call9RouterDirect("bai/glm-5.3-flash", "Kamu Bull Analyst. Tesis serang 2 kalimat.", sample),
    call9RouterDirect("bai/deepseek-v4.1-flash", "Kamu Neutral Analyst. Data empiris 2 kalimat.", sample),
    call9RouterDirect("ag/gemini-3.8-flash-medium", "Kamu Bear Auditor. Risiko trap 2 kalimat.", sample)
  ]);
  console.log(`Finished in ${Date.now() - t0}ms:`);
  console.log(`- Bull (${bull.model}): ${bull.success ? "✅ " + bull.elapsed + "ms" : "❌ " + bull.error}`);
  console.log(`- Neutral (${neutral.model}): ${neutral.success ? "✅ " + neutral.elapsed + "ms" : "❌ " + neutral.error}`);
  console.log(`- Bear (${bear.model}): ${bear.success ? "✅ " + bear.elapsed + "ms" : "❌ " + bear.error}`);

  console.log("\n[2] Running Dual Judgement PARALLEL...");
  const debate = `Bull: ${bull.text}\nNeutral: ${neutral.text}\nBear: ${bear.text}`;
  const t1 = Date.now();
  const [j1, j2] = await Promise.all([
    call9RouterDirect("ag/gemini-3.8-flash-high", "Kamu Hakim 1. Vonis kuantitatif 2 kalimat.", debate),
    call9RouterDirect("atria/Atria-Dawn-Preview", "Kamu Hakim 2. Vonis independen 2 kalimat.", debate)
  ]);
  console.log(`Finished in ${Date.now() - t1}ms:`);
  console.log(`- Judgement 1 (${j1.model}): ${j1.success ? "✅ " + j1.elapsed + "ms" : "❌ " + j1.error}`);
  console.log(`- Judgement 2 (${j2.model}): ${j2.success ? "✅ " + j2.elapsed + "ms" : "❌ " + j2.error}`);

  console.log("\n--- HASIL KONTEN ---");
  console.log("Hakim 1 (Gemini High):\n", j1.text);
  console.log("\nHakim 2 (Atria Dawn):\n", j2.text);
}

runDirectTest();
