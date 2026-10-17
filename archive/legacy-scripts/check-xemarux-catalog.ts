import fs from "fs";
import path from "path";

const appData = process.env.APPDATA || "C:\\Users\\ARS011\\AppData\\Roaming";
const catalogPath = path.join(appData, "9router", "model-catalog.json");

async function checkCatalog() {
  const raw = fs.readFileSync(catalogPath, "utf-8");
  const data = JSON.parse(raw);

  console.log("Top-level keys of model-catalog.json:", Object.keys(data));
  const rawStr = JSON.stringify(data);
  console.log("Includes xemarux:", rawStr.includes("xemarux"));
  console.log("Includes XEMARUX:", rawStr.includes("XEMARUX"));
  console.log("Includes ccf767d6:", rawStr.includes("ccf767d6"));

  // Cari di mana ccf767d6 muncul
  for (const [k, v] of Object.entries(data)) {
    const s = JSON.stringify(v);
    if (s.includes("ccf767d6") || s.includes("XEMARUX") || s.includes("xemarux")) {
      console.log(`Key [${k}] contains XEMARUX / ccf767d6!`);
      if (Array.isArray(v)) {
        console.log(`Array length: ${v.length}`);
        const found = v.filter((item: any) => JSON.stringify(item).includes("ccf767d6"));
        console.log("Found items:", found.slice(0, 3));
      } else if (typeof v === "object" && v !== null) {
        console.log(`Object keys:`, Object.keys(v));
      }
    }
  }
}

checkCatalog().catch(console.error);
