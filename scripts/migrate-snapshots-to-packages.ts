/**
 * scripts/migrate-snapshots-to-packages.ts — PENGGANTIAN store snapshot
 * warisan menjadi store paket kuant (satu kali jalan, berpenjaga).
 *
 * Keputusan owner (Arandi, 2026-11-05): status terkunci
 * `data/analysis_snapshots.db` DICABUT ("hapus atau ganti aja gapapa, itu
 * hasil app lama") dan hasil run kuant wajib tinggal di store DB sebagai
 * paket berversi. Skema baru hidup di lib/picks/packages.ts.
 *
 * Langkah script ini (urut, fail-fast):
 *   1. Verifikasi keadaan lama PERSIS seperti yang diharapkan: tabel
 *      `analysis_snapshots` ada dengan 21 baris, `match_outcomes` ada,
 *      tabel `packages` BELUM ada, file arsip BELUM ada. Keadaan lain =
 *      ABORT — script tidak menebak-nebak data yang tidak dikenal.
 *   2. Checkpoint WAL (TRUNCATE) lalu salin file apa adanya (byte-copy)
 *      ke `archive/analysis_snapshots-legacy-2026-10.db`; verifikasi
 *      sha256 salinan == sumber dan hitungan baris di salinan (21 + 81).
 *   3. Bangun file baru (skema packages + meta terdokumentasi) di path
 *      temporer, verifikasi isinya, lalu rename menggantikan file lama.
 *
 * Korpus lama setelah ini HANYA hidup di file arsip. Tabel `match_outcomes`
 * (81 baris) sengaja TIDAK dibawa: tidak ada pembaca/penulis aktifnya di
 * codebase di luar modul warisan lib/db/analysis-snapshot.ts yang dorman.
 *
 * Pakai: npx tsx scripts/migrate-snapshots-to-packages.ts
 */

import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensurePackagesSchema } from "../lib/picks/packages";
import { dbPath } from "../lib/db/paths";

const DB_PATH = dbPath("analysis_snapshots.db");
const NEW_PATH = `${DB_PATH}.new`;
const ARCHIVE_PATH = path.join(
  process.cwd(),
  "archive",
  "analysis_snapshots-legacy-2026-10.db",
);
const EXPECTED_SNAPSHOT_ROWS = 21;

function sha256File(p: string): string {
  return createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function tableNames(db: DatabaseSync): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as unknown as { name: string }[]
  ).map((r) => r.name);
}

function count(db: DatabaseSync, table: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }
  ).n;
}

function abort(msg: string): never {
  console.error(`ABORT: ${msg}`);
  process.exit(1);
}

function main() {
  if (!fs.existsSync(DB_PATH)) abort(`file lama tidak ditemukan: ${DB_PATH}`);
  if (fs.existsSync(ARCHIVE_PATH)) {
    abort(`file arsip sudah ada (${ARCHIVE_PATH}) — migrasi tampaknya sudah pernah jalan`);
  }
  if (fs.existsSync(NEW_PATH)) abort(`file temporer sudah ada: ${NEW_PATH} — periksa manual`);

  // --- 1 · Verifikasi keadaan lama.
  const legacy = new DatabaseSync(DB_PATH);
  legacy.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  const tables = tableNames(legacy);
  if (!tables.includes("analysis_snapshots")) {
    legacy.close();
    abort("tabel analysis_snapshots tidak ada — keadaan tidak dikenal");
  }
  if (tables.includes("packages")) {
    legacy.close();
    abort("tabel packages sudah ada — store baru tampaknya sudah dibangun");
  }
  const snapshotRows = count(legacy, "analysis_snapshots");
  const outcomeRows = tables.includes("match_outcomes")
    ? count(legacy, "match_outcomes")
    : 0;
  if (snapshotRows !== EXPECTED_SNAPSHOT_ROWS) {
    legacy.close();
    abort(
      `baris analysis_snapshots = ${snapshotRows}, diharapkan ${EXPECTED_SNAPSHOT_ROWS} — keadaan tidak dikenal, tidak diganti`,
    );
  }
  legacy.close();
  console.log(
    `Keadaan lama terverifikasi: analysis_snapshots=${snapshotRows} baris, match_outcomes=${outcomeRows} baris.`,
  );

  // --- 2 · Arsip byte-copy + verifikasi hash & baris.
  fs.copyFileSync(DB_PATH, ARCHIVE_PATH);
  const srcHash = sha256File(DB_PATH);
  const arcHash = sha256File(ARCHIVE_PATH);
  if (srcHash !== arcHash) {
    abort(`sha256 salinan (${arcHash}) != sumber (${srcHash})`);
  }
  const arc = new DatabaseSync(ARCHIVE_PATH, { readOnly: true });
  const arcSnapshots = count(arc, "analysis_snapshots");
  const arcOutcomes = count(arc, "match_outcomes");
  arc.close();
  if (arcSnapshots !== snapshotRows || arcOutcomes !== outcomeRows) {
    abort(
      `hitungan arsip tidak cocok: snapshots=${arcSnapshots}, outcomes=${arcOutcomes}`,
    );
  }
  const arcBytes = fs.statSync(ARCHIVE_PATH).size;
  console.log(
    `Arsip OK: ${ARCHIVE_PATH} (${arcBytes} bytes, sha256 ${arcHash.slice(0, 16)}…, snapshots=${arcSnapshots}, outcomes=${arcOutcomes}).`,
  );

  // --- 3 · Bangun store baru di path temporer, verifikasi, rename.
  const now = new Date().toISOString();
  const fresh = new DatabaseSync(NEW_PATH);
  fresh.exec("PRAGMA journal_mode = WAL;");
  fresh.exec("PRAGMA synchronous = NORMAL;");
  ensurePackagesSchema(fresh);
  const meta: Record<string, string> = {
    schema_version: "1",
    store: "quant-packages",
    created_utc: now,
    replaced_utc: now,
    legacy_archive: "archive/analysis_snapshots-legacy-2026-10.db",
    legacy_archive_sha256: arcHash,
    legacy_rows: `analysis_snapshots=${snapshotRows}; match_outcomes=${outcomeRows}`,
    description:
      "Store paket hasil run model kuant (satu baris per fixture per versi komputasi). " +
      "Menggantikan store snapshot warisan app lama di path yang sama atas keputusan owner " +
      "2026-11-05 (kunci analysis_snapshots dicabut). Korpus lama (21 snapshot + 81 outcome, " +
      "era Okt 2026) hanya hidup di file arsip legacy_archive di atas. Modul warisan " +
      "lib/db/analysis-snapshot.ts TIDAK dipakai store ini; bila dipanggil lagi ia akan " +
      "membuat ulang tabel lamanya dalam keadaan kosong di file ini.",
  };
  const ins = fresh.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries(meta)) ins.run(k, v);
  const newTables = tableNames(fresh).sort();
  fresh.close();
  const expected = ["meta", "packages", "sqlite_sequence"];
  if (JSON.stringify(newTables) !== JSON.stringify(expected)) {
    fs.rmSync(NEW_PATH, { force: true });
    abort(`tabel store baru tidak sesuai: ${newTables.join(", ")}`);
  }

  for (const suffix of ["-wal", "-shm"]) {
    fs.rmSync(`${DB_PATH}${suffix}`, { force: true });
  }
  fs.renameSync(NEW_PATH, DB_PATH);
  console.log(
    `Store baru aktif di ${DB_PATH} (tabel: ${newTables.join(", ")}; meta ${Object.keys(meta).length} entri).`,
  );
}

main();
