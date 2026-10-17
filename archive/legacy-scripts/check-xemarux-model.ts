import fs from "fs";

const apiKey = "sk-7b18b5c31d5d653c-z0q24f-c3542ecc";
const baseUrl = "http://localhost:20128/v1";

async function main() {
  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const data = await res.json();
  const allModels: string[] = (data.data || []).map((m: any) => m.id);

  console.log(`Total: ${allModels.length} models`);

  // Cari yang mengandung xema atau rux atau uppercase/lowercase
  const matched = allModels.filter(m => /xem|arux|marux|x-e-m/i.test(m));
  console.log("Matched regex xem/arux/marux:", matched);

  // Group by prefix
  const prefixes: Record<string, string[]> = {};
  for (const m of allModels) {
    const p = m.includes("/") ? m.split("/")[0] : "direct";
    if (!prefixes[p]) prefixes[p] = [];
    prefixes[p].push(m);
  }

  console.log("\nProviders in 9Router:");
  for (const [p, list] of Object.entries(prefixes)) {
    console.log(`- [${p}] (${list.length} models)`);
    // jika jumlahnya sedikit atau mencurigakan, cetak
    if (p !== "cx" && p !== "ag" && p !== "nvidia" && p !== "kr") {
      console.log("   ", list);
    }
  }

  // Tampilkan juga semua direct models
  console.log("\nDirect models (without slash):", prefixes["direct"]);
}

main().catch(console.error);
