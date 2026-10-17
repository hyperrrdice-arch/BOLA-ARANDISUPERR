import { DatabaseSync } from "node:sqlite";
import path from "path";

const appData = process.env.APPDATA || "C:\\Users\\ARS011\\AppData\\Roaming";
const dbPath = path.join(appData, "9router", "db", "data.sqlite");

async function main() {
  const db = new DatabaseSync(dbPath, { readOnly: true });

  const rows: any[] = db.prepare("SELECT * FROM customModels WHERE providerAlias LIKE '%ccf767d6%'").all();
  console.log(`Daftar model custom untuk XEMARUX (${rows.length} models):`);
  for (const r of rows) {
    console.log(`- ID: ${r.id} | Name: ${r.name} | Type: ${r.type}`);
  }
}

main().catch(console.error);
