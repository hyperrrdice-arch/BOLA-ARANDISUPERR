import fs from "fs";
import path from "path";

const appData = process.env.APPDATA || "C:\\Users\\ARS011\\AppData\\Roaming";
const dbPath = path.join(appData, "9router", "db", "data.sqlite");

async function checkDetails() {
  const buf = fs.readFileSync(dbPath);
  const str = buf.toString("utf-8");

  // Cari potongan teks di sekitar XEMARUX
  const idx = str.indexOf("XEMARUX");
  if (idx !== -1) {
    const chunk = str.slice(Math.max(0, idx - 300), Math.min(str.length, idx + 700));
    console.log("=== CHUNK AROUND XEMARUX ===");
    console.log(chunk.replace(/[\x00-\x1F\x7F-\x9F]/g, " "));
  } else {
    console.log("XEMARUX not found in string");
  }
}

checkDetails().catch(console.error);
