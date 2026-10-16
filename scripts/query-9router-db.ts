import { DatabaseSync } from "node:sqlite";
import path from "path";

const appData = process.env.APPDATA || "C:\\Users\\ARS011\\AppData\\Roaming";
const dbPath = path.join(appData, "9router", "db", "data.sqlite");

async function main() {
  console.log("=== INSPEKSI DB 9ROUTER DENGAN NODE:SQLITE ===");
  const db = new DatabaseSync(dbPath, { readOnly: true });

  // 1. Ambil list tabel
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log("Tabel yang ada di data.sqlite:", tables.map((t: any) => t.name));

  for (const t of tables as any[]) {
    const tableName = t.name;
    const countRow: any = db.prepare(`SELECT count(*) as count FROM "${tableName}"`).get();
    console.log(`\nTabel [${tableName}] -> ${countRow.count} baris`);

    // Cek sample baris
    const rows: any[] = db.prepare(`SELECT * FROM "${tableName}" LIMIT 5`).all();
    if (rows.length > 0) {
      console.log(`Kolom:`, Object.keys(rows[0]));
    }

    // Cari baris yang mengandung XEMARUX
    try {
      const allRows: any[] = db.prepare(`SELECT * FROM "${tableName}"`).all();
      for (const r of allRows) {
        const s = JSON.stringify(r);
        if (s.includes("XEMARUX") || s.includes("xemarux") || s.includes("ccf767d6")) {
          console.log(`🎯 DITEMUKAN RECORD XEMARUX di tabel [${tableName}]:`);
          console.log(JSON.stringify(r, null, 2));
        }
      }
    } catch (e: any) {
      console.log(`Error scanning ${tableName}:`, e.message);
    }
  }
}

main().catch(console.error);
