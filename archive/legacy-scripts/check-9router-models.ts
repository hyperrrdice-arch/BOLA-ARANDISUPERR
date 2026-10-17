import fs from "fs";
import path from "path";

// Load .env.local
const envPath = path.join(process.cwd(), ".env.local");
let apiKey = "sk-7b18b5c31d5d653c-z0q24f-c3542ecc";
let baseUrl = "http://localhost:20128/v1";

if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const match = line.trim().match(/^([^=]+)=(.*)$/);
    if (match) {
      if (match[1].trim() === "NINE_ROUTER_API_KEY") apiKey = match[2].trim();
      if (match[1].trim() === "NINE_ROUTER_BASE_URL") baseUrl = match[2].trim();
    }
  }
}

async function main() {
  console.log(`Connecting to 9Router at: ${baseUrl}`);
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    const data = await res.json();
    const models: string[] = Array.isArray(data.data)
      ? data.data.map((m: any) => m.id)
      : Array.isArray(data)
      ? data.map((m: any) => m.id || m)
      : [];

    console.log(`Total Models Available in 9Router: ${models.length}`);

    // Group models by prefix / provider
    const providers: Record<string, string[]> = {};
    for (const m of models) {
      const prefix = m.includes("/") ? m.split("/")[0] : "direct";
      if (!providers[prefix]) providers[prefix] = [];
      providers[prefix].push(m);
    }

    console.log("\n--- PROVIDERS & MODELS BREAKDOWN ---");
    for (const [p, list] of Object.entries(providers)) {
      console.log(`[${p}] (${list.length} models):`);
      for (const modelId of list) {
        console.log(`   - ${modelId}`);
      }
    }
  } catch (err: any) {
    console.error("Error querying 9Router models:", err.message);
  }
}

main().catch(console.error);
