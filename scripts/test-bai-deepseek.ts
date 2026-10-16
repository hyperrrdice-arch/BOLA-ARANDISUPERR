const apiKey = "sk-7b18b5c31d5d653c-z0q24f-c3542ecc";
const baseUrl = "http://localhost:20128/v1";

async function main() {
  console.log("Testing bai/deepseek-v4.1-flash with Thinking Ultra prompt...");
  const start = Date.now();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "bai/deepseek-v4.1-flash",
      messages: [
        {
          role: "system",
          content:
            "Lo adalah Bear Auditor di sindikat taruhan bola (DeepSeek Thinking Ultra). Pake gaya santai analis bola pro (gw/lo). Jalankan penalaran internal mendalam (ultra thinking): bedah skenario terburuk, kelemahan lini belakang, dan jebakan bandar (trap line). Dilarang kaku dan dilarang lebay. Format output WAJIB JSON VALID murni: { \"thesis\": string, \"trap_warnings\": [ string, string ], \"vulnerability_audit\": string }",
        },
        {
          role: "user",
          content:
            "Pertandingan: Arsenal vs Chelsea (Premier League). Bursa Live: Home=1.95 | Draw=3.60 | Away=3.90. Dixon-Coles xG: Home=1.95 vs Away=0.85.",
        },
      ],
      max_tokens: 16384,
      temperature: 0.2,
      stream: false,
    }),
  });

  const raw = await res.text();
  console.log(`Latency: ${Date.now() - start}ms`);
  console.log("RAW OUTPUT:\n", raw.slice(0, 500));
}

main().catch(console.error);
