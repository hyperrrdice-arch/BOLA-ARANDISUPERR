/**
 * SUITE B0.2 (Brief Temuan Terakhir 26 Nov 2026) — CLI wal-checkpoint.
 *
 * scripts/wal-checkpoint.ts adalah langkah penutup rantai free-refresh.
 * Kontrak best-effort-nya: TIDAK PERNAH exit non-nol — DB hilang dicatat
 * DILEWATI, error dicatat GAGAL beserta penyebabnya, dan checkpoint yang
 * berjalan mencatat triplet (busy, log, checkpointed) + durasi.
 * (Regresi yang diperbaiki: `const dbPath = dbPath(...)` men-shadow impor
 * helper → ReferenceError TDZ sebelum try, exit 1 di refresh 04:21 WIB
 * 26 Nov 2026.)
 *
 * Kasus:
 *  A. DB mode WAL dengan writer fixture tetap terbuka + frame aktif
 *     (transaksi belum commit) → triplet tercatat, exit 0, data utuh.
 *  B. Direktori kosong → pesan DILEWATI, exit 0, file DB tetap absen.
 *  C. Path DB adalah direktori (error buka deterministik) → GAGAL
 *     tercatat dengan penyebab, exit tetap 0.
 *
 * Semua jalur memakai DB_DIR sementara via fixture-env; DB produksi
 * tidak pernah disentuh.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  Suite,
  createFixtureEnv,
  runScript,
  settleFixtureEnv,
} from "./helpers/fixture-env";

const suite = new Suite("wal-checkpoint CLI (B0.2)");
const TRIPLET = /busy=\d+ log=\d+ checkpointed=\d+/;

// ---------------------------------------------------------------- A. WAL aktif
console.log("\nA. DB WAL + writer terbuka (frame aktif)");
{
  const env = createFixtureEnv("walckpt-aktif");
  const dbFile = path.join(env.dataDir, "thestats_dataset.db");
  const writer = new DatabaseSync(dbFile);
  writer.exec("PRAGMA journal_mode=WAL");
  writer.exec("CREATE TABLE fixture_rows (id INTEGER PRIMARY KEY, val TEXT)");
  writer.exec("BEGIN");
  const ins = writer.prepare("INSERT INTO fixture_rows (val) VALUES (?)");
  for (let i = 0; i < 50; i++) ins.run(`baris-${i}`);
  // Transaksi SENGAJA dibiarkan terbuka: frame WAL aktif saat CLI jalan.

  const run = runScript(env, "scripts/wal-checkpoint.ts", [], {
    DB_DIR: env.dataDir,
  });
  suite.eq("WAL aktif: exit 0", run.code, 0);
  suite.check(
    "WAL aktif: triplet busy/log/checkpointed tercatat",
    TRIPLET.test(run.stdout),
    run.stdout,
  );
  suite.check(
    "WAL aktif: durasi tercatat",
    /durasi=\d+ms/.test(run.stdout),
    run.stdout,
  );

  writer.exec("COMMIT");
  writer.close();
  const ro = new DatabaseSync(dbFile, { readOnly: true });
  const cnt = ro.prepare("SELECT COUNT(*) AS c FROM fixture_rows").get() as {
    c: number;
  };
  ro.close();
  suite.eq("WAL aktif: data fixture utuh sesudah checkpoint", cnt.c, 50);
  settleFixtureEnv(env, suite.failedCount > 0);
}

// ---------------------------------------------------------------- B. File hilang
console.log("\nB. Direktori kosong (file DB tidak ada)");
{
  const env = createFixtureEnv("walckpt-hilang");
  const run = runScript(env, "scripts/wal-checkpoint.ts", [], {
    DB_DIR: env.dataDir,
  });
  suite.eq("File hilang: exit 0", run.code, 0);
  suite.check(
    "File hilang: pesan DILEWATI tercatat",
    run.stdout.includes("DILEWATI"),
    run.stdout,
  );
  suite.check(
    "File hilang: file DB tetap absen",
    !fs.existsSync(path.join(env.dataDir, "thestats_dataset.db")),
  );
  settleFixtureEnv(env, suite.failedCount > 0);
}

// ---------------------------------------------------------------- C. Error buka
console.log("\nC. Path DB adalah direktori (error buka deterministik)");
{
  const env = createFixtureEnv("walckpt-error");
  fs.mkdirSync(path.join(env.dataDir, "thestats_dataset.db"));
  const run = runScript(env, "scripts/wal-checkpoint.ts", [], {
    DB_DIR: env.dataDir,
  });
  suite.eq("Error buka: exit tetap 0 (best-effort)", run.code, 0);
  suite.check(
    "Error buka: GAGAL tercatat dengan penyebab",
    run.stdout.includes("GAGAL"),
    run.stdout,
  );
  settleFixtureEnv(env, suite.failedCount > 0);
}

suite.finish();
