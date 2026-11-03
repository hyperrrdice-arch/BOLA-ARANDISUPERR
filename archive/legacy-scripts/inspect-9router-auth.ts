import fs from "fs";
import path from "path";

const appData = process.env.APPDATA || "C:\\Users\\ARS011\\AppData\\Roaming";
const routerDir = path.join(appData, "9router");

async function checkDir() {
  console.log("=== CHECKING 9ROUTER DIRECTORY ===");
  console.log("Router Dir:", routerDir);

  const authDir = path.join(routerDir, "auth");
  if (fs.existsSync(authDir)) {
    console.log("\nAuth Directory Contents:");
    const authFiles = fs.readdirSync(authDir);
    console.log(authFiles);
    for (const f of authFiles) {
      const p = path.join(authDir, f);
      const stat = fs.statSync(p);
      if (stat.isFile()) {
        console.log(`\n--- File: ${f} (${stat.size} bytes) ---`);
        try {
          const content = fs.readFileSync(p, "utf-8");
          // Sembunyikan bagian tengah kunci jika sensitif, tapi perlihatkan provider & struktur kuota
          console.log(content.slice(0, 1000));
        } catch (e: any) {
          console.log(`Cannot read: ${e.message}`);
        }
      }
    }
  }

  const dbDir = path.join(routerDir, "db");
  if (fs.existsSync(dbDir)) {
    console.log("\nDB Directory Contents:");
    const dbFiles = fs.readdirSync(dbDir);
    console.log(dbFiles);
  }
}

checkDir().catch(console.error);
