/**
 * HELPER TES D05-BUSY — tahan lock writer sebuah DB dari proses TERPISAH
 * sampai file pelepas muncul (barrier berkas, BUKAN tebakan waktu).
 *
 * Saudara lock-holder.ts (yang menahan selama N ms tetap): varian ini
 * melepas lock tepat saat pemanggil menulis releaseFile, supaya suite
 * bisa membuktikan pembuka koneksi benar-benar MENUNGGU lock — bukan
 * sekadar lolos karena timing kebetulan.
 *
 * argv: [dbPath, readyFile, releaseFile, maxHoldMs]
 *   - readyFile ditulis begitu BEGIN IMMEDIATE benar-benar dipegang.
 *   - releaseFile ditunggu (poll 25 ms) sampai maxHoldMs; sesudah itu
 *     lock tetap dilepas (COMMIT) tetapi proses keluar dengan kode 2
 *     supaya pemanggil tahu pelepas tidak pernah datang.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";

function main(): void {
  const [, , dbPath, readyFile, releaseFile, maxHoldRaw] = process.argv;
  const maxHoldMs = Number(maxHoldRaw);
  if (!dbPath || !readyFile || !releaseFile || !Number.isFinite(maxHoldMs) || maxHoldMs <= 0) {
    throw new Error("lock-holder-signal: argumen tidak valid");
  }
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 10000");
  db.exec("BEGIN IMMEDIATE");
  fs.writeFileSync(readyFile, "locked");
  const t0 = Date.now();
  let released = false;
  while (Date.now() - t0 < maxHoldMs) {
    if (fs.existsSync(releaseFile)) {
      released = true;
      break;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  db.exec("COMMIT");
  db.close();
  process.exit(released ? 0 : 2);
}

main();
