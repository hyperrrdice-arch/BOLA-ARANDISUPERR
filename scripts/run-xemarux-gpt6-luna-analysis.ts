import fs from "fs";

const apiKey = "sk-7b18b5c31d5d653c-z0q24f-c3542ecc";
const baseUrl = "http://localhost:20128/v1";
const providerId = "openai-compatible-responses-ccf767d6-352f-4817-a8b4-bf4b877f7b3b";
const targetModel = `${providerId}/gpt-6-luna`;

const matchContext = `
=== KONTEKS PERTANDINGAN SINDIKAT FOOTBALL ===
Laga: Chelsea vs Everton (Premier League)
Venue: Stamford Bridge, London | Waktu: Laga Pekan Ini
Wasit: Anthony Taylor (Rata-rata 4.1 Kartu Kuning, 0.28 Penalti per laga)

BURSA PASAR & ODDS (Pinnacle / Bet365 Benchmark):
- 1X2 Pasar Live: Home (Chelsea)=1.62 | Draw=4.20 | Away (Everton)=5.25
- Over/Under 2.5 Goals: Over 2.5=1.70 | Under 2.5=2.15
- Asian Handicap: Chelsea -1.0 @ 2.05 | Everton +1.0 @ 1.85
- Asian Handicap -0.75: Chelsea -0.75 @ 1.80 | Everton +0.75 @ 2.10
- Overround Bandar Implisit: 104.66% (Margin: 4.66%)
- Shin Vig-Stripping Fair Price: Home=1.57 | Draw=4.42 | Away=5.68

MODEL MATEMATIS KUANTITATIF (Dixon-Coles Bivariate Poisson):
- Lambda Home xG: 2.10 vs Mu Away xG: 0.95 (Total Expected Goals: 3.05)
- Probabilitas Murni Model:
  * Chelsea Win (Home): 64.2% (Fair Odds: 1.56)
  * Draw: 21.3% (Fair Odds: 4.69)
  * Everton Win (Away): 14.5% (Fair Odds: 6.90)
- Total Gol & BTTS:
  * Over 2.5 Goals: 61.2% (Fair Odds: 1.63)
  * Both Teams to Score (BTTS Yes): 52.8% (Fair Odds: 1.89)
- Asian Handicap Projections:
  * Chelsea -0.75 Prob: 57.5% (Fair Odds: 1.74)
  * Chelsea -1.0 Prob: 44.8% win full, 19.4% push

VALUE BET & RISK AUDIT:
- [1X2 Chelsea Win @ 1.62]: Model 64.2% vs Implied 61.73% -> Edge tipis (+3.8% EV)
- [Over 2.5 Goals @ 1.70]: Model 61.2% vs Implied 58.82% -> Edge (+4.0% EV)
- [Asian Handicap Chelsea -0.75 @ 1.80]: Fair 1.74 -> Edge (+3.4% EV)

FAKTOR TAKTIS & INTEGRITAS SKUAD:
- Chelsea: Dominan ball possession (61%), kreasi peluang sayap tajam, produktivitas kandang stabil (avg 2.2 gol/match). Namun lini belakang rentan terhadap set-piece dan transisi serangan balik cepat.
- Everton: Form tandang rapuh (0W-2D-3L), sistem low-block 4-5-1 sangat pasif. Sangat mengandalkan sundulan set-piece fisik, tapi sering kehabisan bensin di 25 menit terakhir saat ditekan intensitas tinggi.
`;

const systemPrompt = `
Lo adalah Chief Risk & Quantitative Arbiter di sindikat taruhan bola profesional (Flagship Model Tier).
Gaya bahasa lo santai, tajam, objektif, pake bahasa tongkrongan analis bola pro (gw/lo).
Dilarang kaku kayak robot, buang semua basa-basi klise ("Berikut adalah...", "Tentu saya..."), dan hindari hiperbola lebay.

Tugas lo:
1. Bedah keaslian nilai pasar (Value vs Trap): Apakah Chelsea @ 1.62 layak disentuh dengan margin tipis (+3.8% EV), atau ada bursa alternatif yang jauh lebih efisien secara matematis (Over/Under, Asian Handicap)?
2. Audit celah bahaya defensif: Faktor set-piece Everton vs kerapuhan transisi Chelsea.
3. Vonis final & alokasi Kelly Bankroll yang disiplin (gunakan fractional Kelly konservatif untuk melindungi modal).
`;

async function runAnalysis() {
  console.log(`=== RUNNING ANALYSIS CHELSEA VS EVERTON DENGAN MODEL [gpt-6-luna] ===`);
  const startTime = Date.now();

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: targetModel,
        messages: [
          { role: "system", content: systemPrompt.trim() },
          { role: "user", content: matchContext.trim() },
        ],
        max_tokens: 4096,
        temperature: 0.25,
        stream: false,
      }),
    });

    const latencyMs = Date.now() - startTime;
    const raw = await res.text();

    if (!res.ok) {
      console.error(`❌ HTTP Error ${res.status}: ${raw}`);
      return;
    }

    let json: any = null;
    let content = "";
    let usage: any = null;

    try {
      json = JSON.parse(raw);
      content = json.choices?.[0]?.message?.content || "";
      usage = json.usage;
    } catch {
      const lines = raw.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ") && !line.includes("[DONE]")) {
          try {
            const p = JSON.parse(line.slice(6));
            content += p.choices?.[0]?.delta?.content || "";
            if (p.usage) usage = p.usage;
          } catch {}
        }
      }
    }

    console.log(`\n======================================================`);
    console.log(`📊 RINCIAN TOKEN USAGE (gpt-6-luna @ XEMARUX)`);
    console.log(`======================================================`);
    console.log(`• Prompt Tokens (Input)     : ${usage?.prompt_tokens ?? "N/A"} tokens`);
    console.log(`• Completion Tokens (Output): ${usage?.completion_tokens ?? "N/A"} tokens`);
    console.log(`• Total Tokens Sekali Jalan : ${usage?.total_tokens ?? "N/A"} tokens`);
    console.log(`• Waktu Eksekusi / Latensi  : ${(latencyMs / 1000).toFixed(2)} detik (${latencyMs} ms)`);
    console.log(`======================================================\n`);

    console.log(`📝 HASIL ANALISIS GPT-6-LUNA:\n`);
    console.log(content.trim());

  } catch (err: any) {
    console.error("Error executing analysis:", err.message);
  }
}

runAnalysis().catch(console.error);
