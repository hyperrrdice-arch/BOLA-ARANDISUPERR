import fs from "fs";
import path from "path";

const appData = process.env.APPDATA || "C:\\Users\\ARS011\\AppData\\Roaming";
const dbPath = path.join(appData, "9router", "db", "data.sqlite");

async function checkSqlite() {
  console.log("Checking DB at:", dbPath);
  if (!fs.existsSync(dbPath)) {
    console.log("DB not found!");
    return;
  }

  // Coba cari string XEMARUX di binary/text file sqlite
  const buf = fs.readFileSync(dbPath);
  const str = buf.toString("utf-8");

  const matches = str.match(/.{0,50}xemarux.{0,50}/gi);
  console.log("Regex matches in data.sqlite for xemarux:", matches);

  // Cari juga kata "BOLA" yang tadi muncul sebagai direct model
  const bolaMatches = str.match(/.{0,50}BOLA.{0,50}/g);
  console.log("Sample BOLA occurrences:", bolaMatches?.slice(0, 3));
}

checkSqlite().catch(console.error);
