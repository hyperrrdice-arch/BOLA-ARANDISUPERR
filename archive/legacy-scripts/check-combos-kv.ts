import { DatabaseSync } from "node:sqlite";
import path from "path";

const appData = process.env.APPDATA || "C:\\Users\\ARS011\\AppData\\Roaming";
const dbPath = path.join(appData, "9router", "db", "data.sqlite");

async function main() {
  const db = new DatabaseSync(dbPath, { readOnly: true });

  console.log("=== COMBOS TABLE ===");
  const combos: any[] = db.prepare("SELECT * FROM combos").all();
  for (const c of combos) {
    console.log(JSON.stringify(c, null, 2));
  }

  console.log("\n=== KV TABLE (XEMARUX / DEEPSEEK) ===");
  const kvRows: any[] = db.prepare("SELECT key, substr(value, 1, 150) as val FROM kv WHERE key LIKE '%ccf767d6%' OR key LIKE '%xemarux%' OR key LIKE '%deepseek%'").all();
  for (const r of kvRows) {
    console.log(`Key: ${r.key}`);
    console.log(`Val: ${r.val}\n`);
  }
}

main().catch(console.error);
