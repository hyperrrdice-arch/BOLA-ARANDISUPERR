/**
 * WAL CHECKPOINT — langkah penutup rantai free-refresh (Item 2, pasca
 * evaluasi A4 25 Nov 2026).
 *
 * Menjalankan `PRAGMA wal_checkpoint(PASSIVE)` atas
 * data/thestats_dataset.db (pemilik WAL besar: 1.444.121.832 byte pada
 * evaluasi A4, padahal frame aktif cuma 561 ≈ 2,3 MB — PASSIVE berkala
 * menjaga frame menggantung tetap kecil; PASSIVE tidak memotong berkas
 * WAL, reclaim ruang adalah operasi TRUNCATE satu kali terpisah).
 *
 * Kontrak rantai: langkah ini TIDAK PERNAH menggagalkan refresh —
 * semua kegagalan (DB hilang, terkunci, error) dicatat satu baris dan
 * proses tetap exit 0. Triplet hasil (busy, log, checkpointed) selalu
 * dicatat ke log rantai bila checkpoint berjalan.
 *
 * Pakai: npx tsx scripts/wal-checkpoint.ts
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dbPath } from "../lib/db/paths";

function main() {
  const startedAt = Date.now();
  let datasetPath: string;
  try {
    datasetPath = dbPath("thestats_dataset.db");
  } catch (err) {
    console.log(
      `[wal-checkpoint] GAGAL (diabaikan, refresh tetap sukses): resolusi path gagal: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
  if (!fs.existsSync(datasetPath)) {
    console.log(`[wal-checkpoint] DILEWATI: ${datasetPath} tidak ada.`);
    return;
  }
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(datasetPath);
    const row = db.prepare("PRAGMA wal_checkpoint(PASSIVE)").get() as
      | { busy: number; log: number; checkpointed: number }
      | undefined;
    const durasiMs = Date.now() - startedAt;
    if (row) {
      console.log(
        `[wal-checkpoint] thestats_dataset.db PASSIVE: busy=${row.busy} log=${row.log} checkpointed=${row.checkpointed} durasi=${durasiMs}ms`,
      );
    } else {
      console.log(
        `[wal-checkpoint] thestats_dataset.db PASSIVE: tanpa baris hasil (bukan mode WAL?) durasi=${durasiMs}ms.`,
      );
    }
  } catch (err) {
    console.log(
      `[wal-checkpoint] GAGAL (diabaikan, refresh tetap sukses): ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    try {
      db?.close();
    } catch {
      /* tutup gagal tidak mengubah hasil */
    }
  }
}

main();
