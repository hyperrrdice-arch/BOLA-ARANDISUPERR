/**
 * HELPER TES 3A (review K8 butir 3A) — tahan lock writer sebuah DB
 * selama N milidetik dari proses TERPISAH, lalu lepas.
 *
 * Dipakai suite publikasi untuk membuktikan commitPublication mengambil
 * lock DULU dan membaca jam aktual SESUDAH lock didapat: commit yang
 * mulai sebelum kickoff tetapi tertahan lock sampai melewati kickoff
 * harus ditolak, bukan terbit dengan cap basi.
 *
 * argv: [dbPath, holdMs, readyFile] — readyFile ditulis begitu lock
 * benar-benar dipegang, supaya pemanggil tidak menebak waktu boot tsx.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";

function main(): void {
  const [, , dbPath, holdMsRaw, readyFile] = process.argv;
  const holdMs = Number(holdMsRaw);
  if (!dbPath || !Number.isFinite(holdMs) || holdMs <= 0) {
    throw new Error("lock-holder: argumen tidak valid");
  }
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 10000");
  db.exec("BEGIN IMMEDIATE");
  if (readyFile) fs.writeFileSync(readyFile, "locked");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, holdMs);
  db.exec("COMMIT");
  db.close();
}

main();
