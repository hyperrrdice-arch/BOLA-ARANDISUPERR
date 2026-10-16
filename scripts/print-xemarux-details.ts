import { DatabaseSync } from "node:sqlite";
import path from "path";

const appData = process.env.APPDATA || "C:\\Users\\ARS011\\AppData\\Roaming";
const dbPath = path.join(appData, "9router", "db", "data.sqlite");

async function main() {
  const db = new DatabaseSync(dbPath, { readOnly: true });

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  for (const t of tables as any[]) {
    const tableName = t.name;
    const allRows: any[] = db.prepare(`SELECT * FROM "${tableName}"`).all();
    for (const r of allRows) {
      const s = JSON.stringify(r);
      if (s.includes("XEMARUX") || s.includes("xemarux") || s.includes("ccf767d6")) {
        console.log(`\n=== TABEL: ${tableName} ===`);
        console.log("ID / Key:", r.id || r.key || "(no key)");
        console.log("Value:", JSON.stringify(r, null, 2));
      }
    }
  }
}

main().catch(console.error);
