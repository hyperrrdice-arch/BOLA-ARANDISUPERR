// ============================================================================
// BACKUP SQLITE AMAN (Sprint Portable VPS & Docker V2, Fase 4)
// ----------------------------------------------------------------------------
// Tujuan: kejadian hilangnya ledger (VPS US, 23 Nov 2026) tidak terulang.
//
// Mekanisme:
//  1. Pindai SELURUH file *.db di DB_DIR secara dinamis (lib/db/paths.ts) —
//     DB baru otomatis ikut ter-backup tanpa hardcode daftar.
//  2. Snapshot konsisten per DB memakai `VACUUM INTO` (aman terhadap WAL &
//     penulisan bersamaan: hasil snapshot adalah file DB mandiri yang
//     mencerminkan state committed terakhir).
//  3. `PRAGMA integrity_check` pada SETIAP file snapshot — satu saja tidak
//     "ok" => GAGAL KERAS (exit 1, arsip tidak dibuat).
//  4. Arsipkan direktori snapshot bertimestamp menjadi .tar.gz + file
//     .sha256 pendamping, lalu hapus direktori snapshot mentahnya.
//  5. Retensi lokal: arsip berumur > RETENTION_DAYS (default 7) dihapus.
//  6. Bila env RCLONE_REMOTE diset (mis. "r2:bola-backups"), arsip + .sha256
//     diunggah via rclone (bila biner rclone tidak ada: peringatan keras di
//     log, backup lokal tetap dianggap selesai).
//
// Env:
//  DB_DIR         sumber DB (default: data/ — lihat lib/db/paths.ts)
//  BACKUP_DIR     direktori arsip (default: <DB_DIR>/backups)
//  RETENTION_DAYS retensi lokal dalam hari (default: 7)
//  RCLONE_REMOTE  target off-host opsional (mis. "gdrive:bola-backups")
// ============================================================================
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dbDir } from "../lib/db/paths";

function log(msg: string): void {
  console.log(`[backup-sqlite-safe] ${msg}`);
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
  const backupRoot = process.env.BACKUP_DIR?.trim()
    ? path.resolve(process.env.BACKUP_DIR)
    : path.join(sourceDir, "backups");
  const retentionDays = Number(process.env.RETENTION_DAYS ?? "7");
  fs.mkdirSync(backupRoot, { recursive: true });

  const dbFiles = fs
    .readdirSync(sourceDir)
    .filter((f) => f.endsWith(".db"))
    .sort();
  if (dbFiles.length === 0) {
    throw new Error(`Tidak ada file .db di DB_DIR (${sourceDir}) — backup dibatalkan.`);
  }
  log(`DB_DIR=${sourceDir}`);
  log(`BACKUP_DIR=${backupRoot}`);
  log(`Memindai ${dbFiles.length} DB: ${dbFiles.join(", ")}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapDirName = `bola-backup-${stamp}`;
  const snapDir = path.join(backupRoot, snapDirName);
  fs.mkdirSync(snapDir, { recursive: true });

  // 1) Snapshot konsisten per DB.
  for (const file of dbFiles) {
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
  for (const file of dbFiles) {
    const dst = path.join(snapDir, file);
    if (!integrityOk(dst)) {
      throw new Error(
        `PRAGMA integrity_check GAGAL untuk snapshot ${file}. ` +
          `Arsip TIDAK dibuat; direktori snapshot dipertahankan untuk forensik: ${snapDir}`,
      );
    }
  }
  log(`integrity_check: ok untuk ${dbFiles.length}/${dbFiles.length} snapshot`);

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

  // 4) Retensi lokal (arsip + .sha256 yang lebih tua dari RETENTION_DAYS).
  if (Number.isFinite(retentionDays) && retentionDays > 0) {
    const cutoff = Date.now() - retentionDays * 86_400_000;
    let removed = 0;
    for (const entry of fs.readdirSync(backupRoot)) {
      if (!entry.startsWith("bola-backup-")) continue;
      const p = path.join(backupRoot, entry);
      if (fs.statSync(p).mtimeMs < cutoff) {
        fs.rmSync(p, { recursive: true, force: true });
        removed++;
      }
    }
    if (removed > 0) log(`retensi ${retentionDays} hari: ${removed} entri lama dihapus`);
  }

  // 5) Unggah off-host bila RCLONE_REMOTE diset.
  const remote = process.env.RCLONE_REMOTE?.trim();
  if (remote) {
    const probe = spawnSync("rclone", ["version"], { stdio: "ignore" });
    if (probe.error) {
      log(
        `PERINGATAN: RCLONE_REMOTE diset (${remote}) tetapi biner rclone tidak ditemukan — unggahan off-host DILEWATI. Backup lokal tetap tersimpan.`,
      );
    } else {
      for (const f of [archivePath, `${archivePath}.sha256`]) {
        const up = spawnSync("rclone", ["copy", f, remote], { stdio: "inherit" });
        if (up.status !== 0) {
          throw new Error(`rclone copy gagal (exit ${up.status}) untuk ${f} -> ${remote}`);
        }
      }
      log(`off-host: arsip + .sha256 terunggah ke ${remote}`);
    }
  }

  log("SELESAI");
}

try {
  main();
} catch (err) {
  console.error(`[backup-sqlite-safe] GAGAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
