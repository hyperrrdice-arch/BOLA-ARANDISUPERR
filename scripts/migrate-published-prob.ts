/**
 * MIGRASI BUKTI PELUANG TERBIT (K2) — CLI tipis di atas
 * lib/picks/publication-migration.ts.
 *
 * Membuka data/picks.db dari CWD untuk DITULIS, serta
 * data/analysis_snapshots.db dan data/thestats_dataset.db read-only.
 * Jalankan dari direktori sandbox berisi SALINAN konsisten (sqlite3
 * .backup) — JANGAN dari checkout produksi sebelum gerbang rilis K8.
 *
 *   npx tsx scripts/migrate-published-prob.ts
 *
 * Keluaran: satu baris JSON laporan migrasi. Idempoten: jalan kedua
 * melaporkan semua baris sebagai already_migrated.
 */
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migratePublishedProb } from "../lib/picks/publication-migration";
import { dbPath } from "../lib/db/paths";

function openRo(file: string): DatabaseSync | null {
  try {
    return new DatabaseSync(dbPath(file), {
      readOnly: true,
    });
  } catch {
    return null;
  }
}

function main(): void {
  const picksDb = new DatabaseSync(dbPath("picks.db"));
  const packagesDb = openRo("analysis_snapshots.db");
  const datasetDb = openRo("thestats_dataset.db");
  const report = migratePublishedProb({ picksDb, packagesDb, datasetDb });
  const integrity = (
    picksDb.prepare("PRAGMA integrity_check").get() as Record<string, unknown>
  )["integrity_check"];
  console.log(JSON.stringify({ ...report, integrity_check: integrity }));
}

main();
