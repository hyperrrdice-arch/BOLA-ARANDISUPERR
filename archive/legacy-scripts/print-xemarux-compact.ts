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
      if (s.includes("XEMARUX") || s.includes("xemarux")) {
        console.log(`\nFound in [${tableName}]:`);
        for (const [k, v] of Object.entries(r)) {
          const vStr = typeof v === "object" ? JSON.stringify(v) : String(v);
          if (vStr.length > 200) {
            console.log(`  ${k}: ${vStr.slice(0, 200)}...`);
          } else {
            console.log(`  ${k}: ${vStr}`);
          }
        }
      }
    }
  }
}

main().catch(console.error);
