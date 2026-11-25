// ============================================================================
// BACKUP HARIAN LEDGER KRITIS (Item 13 — keputusan pemilik 26 Nov 2026)
// ----------------------------------------------------------------------------
// Keputusan pemilik: RPO off-site ≤ 24 jam untuk LEDGER KRITIS saja.
//
// Mekanisme (pola sama dengan scripts/backup-sqlite-safe.ts, versi kecil
// khusus dua DB — backup penuh 7 DB tetap wilayah cron mingguan
// football-backup-gdrive dan TIDAK diubah oleh script ini):
//  1. Snapshot konsisten HANYA picks.db + market_snapshots.db memakai
//     `VACUUM INTO` (aman terhadap WAL & penulisan bersamaan).
//     thestats_dataset.db (2,9 GB) SENGAJA tidak ikut — larian selesai
//     dalam hitungan menit, bukan ±30 menit seperti backup penuh.
//  2. `PRAGMA integrity_check` pada SETIAP snapshot — satu saja tidak
//     "ok" => GAGAL KERAS (exit 1, arsip tidak dibuat).
//  3. Arsip `bola-ledger-<timestamp UTC>.tar.gz` + file `.sha256`
//     pendamping, lalu direktori snapshot mentah dibuang.
//  4. Retensi lokal: simpan 14 arsip bola-ledger-* terbaru (+ pasangan
//     .sha256); yang lebih lama dihapus. Arsip mingguan bola-backup-*
//     TIDAK disentuh (beda pola nama, beda direktori induk).
//
// Unggah ke Google Drive + verifikasi size/md5 + rotasi Drive (14 arsip,
// sisanya trash — bukan delete permanen) dilakukan pemanggil (cron
// football-backup-ledger-daily), mengikuti pola verifikasi cron mingguan.
//
// Env:
//  DB_DIR            sumber DB (default: data/ — lihat lib/db/paths.ts)
//  LEDGER_BACKUP_DIR direktori arsip (default:
//                    $HOME/workspace/backups/db-snapshots/ledger)
//  LEDGER_KEEP       jumlah arsip lokal dipertahankan (default: 14)
// ============================================================================
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { dbDir } from "../lib/db/paths";

/** Dua DB ledger kritis — daftar TETAP, bukan pindai dinamis. */
const LEDGER_DBS = ["picks.db", "market_snapshots.db"] as const;

function log(msg: string): void {
  console.log(`[backup-ledger-daily] ${msg}`);
}

function sha256File(file: string): string {
  const hash = createHash("sha256");
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(1 << 20);
  let n: number;
  while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
    hash.update(buf.subarray(0, n));
  }
  fs.closeSync(fd);
  return hash.digest("hex");
}

function integrityOk(file: string): boolean {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare("PRAGMA integrity_check").all() as Array<
      Record<string, unknown>
    >;
    const values = rows.map((r) => String(Object.values(r)[0]));
    return values.length === 1 && values[0] === "ok";
  } finally {
    db.close();
  }
}

function main(): void {
  const sourceDir = dbDir();
  const backupRoot = process.env.LEDGER_BACKUP_DIR?.trim()
    ? path.resolve(process.env.LEDGER_BACKUP_DIR)
    : path.join(os.homedir(), "workspace", "backups", "db-snapshots", "ledger");
  const keep = Number(process.env.LEDGER_KEEP ?? "14");
  fs.mkdirSync(backupRoot, { recursive: true });

  for (const file of LEDGER_DBS) {
    if (!fs.existsSync(path.join(sourceDir, file))) {
      throw new Error(
        `DB ledger ${file} tidak ditemukan di DB_DIR (${sourceDir}) — backup dibatalkan.`,
      );
    }
  }
  log(`DB_DIR=${sourceDir}`);
  log(`LEDGER_BACKUP_DIR=${backupRoot}`);
  log(`DB ledger: ${LEDGER_DBS.join(", ")}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapDirName = `bola-ledger-${stamp}`;
  const snapDir = path.join(backupRoot, snapDirName);
  fs.mkdirSync(snapDir, { recursive: true });

  // 1) Snapshot konsisten per DB.
  for (const file of LEDGER_DBS) {
    const src = path.join(sourceDir, file);
    const dst = path.join(snapDir, file);
    const db = new DatabaseSync(src);
    try {
      db.prepare("VACUUM INTO ?").run(dst);
    } finally {
      db.close();
    }
    log(`snapshot ${file} (${fs.statSync(dst).size} byte)`);
  }

  // 2) Verifikasi integritas SETIAP snapshot — gagal keras bila satu pun rusak.
  for (const file of LEDGER_DBS) {
    const dst = path.join(snapDir, file);
    if (!integrityOk(dst)) {
      throw new Error(
        `PRAGMA integrity_check GAGAL untuk snapshot ${file}. ` +
          `Arsip TIDAK dibuat; direktori snapshot dipertahankan untuk forensik: ${snapDir}`,
      );
    }
  }
  log(`integrity_check: ok untuk ${LEDGER_DBS.length}/${LEDGER_DBS.length} snapshot`);

  // 3) Arsip .tar.gz + .sha256, lalu buang snapshot mentah.
  const archivePath = path.join(backupRoot, `${snapDirName}.tar.gz`);
  const tar = spawnSync("tar", ["-czf", archivePath, "-C", backupRoot, snapDirName], {
    stdio: "inherit",
  });
  if (tar.status !== 0) {
    throw new Error(`tar gagal (exit ${tar.status}) saat membuat ${archivePath}`);
  }
  const digest = sha256File(archivePath);
  fs.writeFileSync(`${archivePath}.sha256`, `${digest}  ${path.basename(archivePath)}\n`);
  fs.rmSync(snapDir, { recursive: true, force: true });
  log(`arsip: ${archivePath} (${fs.statSync(archivePath).size} byte)`);
  log(`sha256: ${digest}`);

  // 4) Retensi lokal: simpan `keep` arsip bola-ledger-*.tar.gz terbaru
  //    (+ pasangan .sha256). Nama berkas memuat timestamp ISO sehingga
  //    urutan leksikografis = urutan waktu.
  if (Number.isFinite(keep) && keep > 0) {
    const archives = fs
      .readdirSync(backupRoot)
      .filter((f) => f.startsWith("bola-ledger-") && f.endsWith(".tar.gz"))
      .sort()
      .reverse();
    let removed = 0;
    for (const old of archives.slice(keep)) {
      fs.rmSync(path.join(backupRoot, old), { force: true });
      fs.rmSync(path.join(backupRoot, `${old}.sha256`), { force: true });
      removed++;
    }
    if (removed > 0) log(`retensi lokal ${keep} arsip: ${removed} arsip lama dihapus`);
  }

  log("SELESAI");
}

try {
  main();
} catch (err) {
  console.error(`[backup-ledger-daily] GAGAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
