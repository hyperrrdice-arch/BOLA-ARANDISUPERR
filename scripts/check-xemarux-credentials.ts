import fs from "fs";
import path from "path";

const appData = process.env.APPDATA || "C:\\Users\\ARS011\\AppData\\Roaming";
const dbPath = path.join(appData, "9router", "db", "data.sqlite");

async function checkId() {
  const buf = fs.readFileSync(dbPath);
  const str = buf.toString("utf-8");

  const target = "ccf767d6";
  let count = 0;
  let pos = 0;
  while ((pos = str.indexOf(target, pos)) !== -1) {
    count++;
    console.log(`\nMatch #${count} at pos ${pos}:`);
    const chunk = str.slice(Math.max(0, pos - 100), Math.min(str.length, pos + 300));
    console.log(chunk.replace(/[\x00-\x1F\x7F-\x9F]/g, " "));
    pos += target.length;
  }
  console.log(`Total occurrences: ${count}`);
}

checkId().catch(console.error);
