import { getTheStatsDb, getTheStatsDbPath } from "../lib/db/thestats-dataset";
import fs from "node:fs";

function main() {
  const db = getTheStatsDb();
  console.log("Menjalankan WAL checkpoint untuk flushing database ke disk...");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE);");

  const dbPath = getTheStatsDbPath();
  const backupPath = dbPath + ".bak";
  fs.copyFileSync(dbPath, backupPath);

  console.log(`✅ Backup database berhasil dibuat di: ${backupPath}`);
  console.log(`   Ukuran file: ${(fs.statSync(backupPath).size / 1024).toFixed(1)} KB`);
}

main();
