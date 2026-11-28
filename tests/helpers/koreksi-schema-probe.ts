/**
 * KOREKSI-SCHEMA PROBE — subprocess pembangun skema sandbox untuk suite
 * koreksi kickoff. Dijalankan dengan cwd = root env fixture (runScript),
 * supaya suite bisa memakai BANYAK env dalam satu proses tanpa cache
 * getter lib/db proses utama tercemar: skema dibangun oleh kode repo
 * sebenarnya (buildCoreSchemas) + skema aditif publikasi & Fix-4 pada
 * picks.db, persis seperti yang disentuh jalur produksi.
 *
 * Pakai: tsx tests/helpers/koreksi-schema-probe.ts
 */
import { buildCoreSchemas } from "./fixture-env";
import { ensurePublicationSchema } from "../../lib/picks/publication";
import { ensureFix4Schema } from "../../lib/picks/fix4-tickets";
import { getTheStatsDb } from "../../lib/db/thestats-dataset";
import { ensureIdentitySchema } from "../../lib/identity/fixture-resolver";

async function main(): Promise<void> {
  const { ledger } = await buildCoreSchemas();
  const db = ledger.getPicksDb();
  ensurePublicationSchema(db);
  ensureFix4Schema(db);
  // Tabel identitas biasanya dibuat malas oleh importer; suite menanam
  // baris kanonik/alias sebelum impor pertama, jadi skema dibuat di muka.
  ensureIdentitySchema(getTheStatsDb());
  console.log("SCHEMA_OK");
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
