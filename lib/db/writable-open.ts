import { DatabaseSync } from "node:sqlite";

// ============================================================================
// PEMBUKA DB WRITABLE YANG TAHAN LOCK SESAAT (D05, brief validasi rilis
// 2026-11-27 §3)
// ----------------------------------------------------------------------------
// Dipakai getPicksDb (lib/picks/ledger.ts) dan getPackagesDb
// (lib/picks/packages.ts) — dua koneksi writable yang skemanya dibuat
// saat pertama dibuka. Koneksi READ-ONLY (lib/web/*, scripts pembaca)
// TIDAK lewat sini dan tidak berubah.
//
// Dua lapis pertahanan, karena satu lapis terbukti tidak cukup:
//
// 1. `PRAGMA busy_timeout = 10000` sebagai pernyataan PERTAMA sesudah
//    konstruktor. Ini membuat pernyataan init yang butuh lock tulis —
//    CREATE skema pada file baru, migrasi aditif, backfill — MENUNGGU
//    sampai 10 detik bila proses lain memegang BEGIN IMMEDIATE, bukan
//    gagal seketika dengan "database is locked" (errcode 5). Nilai
//    10000 sama dengan yang sudah dipakai publication.ts / tickets.ts
//    pada file yang sama.
//
// 2. Retry terbatas pada SELURUH urutan buka+init. Terbukti pada DB
//    temporer: konversi `PRAGMA journal_mode = WAL` pada file yang
//    belum WAL (mis. hasil restore) mengabaikan busy_timeout dan gagal
//    seketika saat ada lock — jadi tanpa retry, busy_timeout saja tidak
//    menutup celahnya. Percobaan diulang tiap 250 ms sampai tenggat
//    total 20 detik; sesudah itu error terakhir DILEMPAR apa adanya
//    (jelas, terbatas — tidak menggantung, tidak dilewati diam-diam).
//
// Init yang di-retry wajib idempoten: kedua pemanggil hanya menjalankan
// PRAGMA + CREATE IF NOT EXISTS + migrasi aditif terjaga + backfill
// deterministik, dan koneksi percobaan yang gagal selalu ditutup
// sebelum percobaan berikutnya, jadi mengulang init dari awal aman.
// ============================================================================

const BUSY_TIMEOUT_MS = 10_000;
const RETRY_DEADLINE_MS = 20_000;
const RETRY_INTERVAL_MS = 250;

function isBusyError(err: unknown): boolean {
  const e = err as { errcode?: unknown; message?: unknown };
  return e.errcode === 5 || String(e.message ?? "").includes("database is locked");
}

function sleepSync(ms: number): void {
  // Getter di repo ini sinkron (DatabaseSync), jadi jeda retry juga
  // harus sinkron. Pola Atomics.wait yang sama dipakai
  // tests/helpers/lock-holder.ts.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Buka DatabaseSync writable di `filePath`, jalankan `init` (PRAGMA +
 * skema) di dalamnya, dan kembalikan koneksi yang sudah terinisialisasi.
 * Melempar error non-busy apa adanya; error busy di-retry sampai
 * tenggat, lalu error terakhir dilempar.
 */
export function openWritableDb(
  filePath: string,
  init: (db: DatabaseSync) => void,
): DatabaseSync {
  const deadline = Date.now() + RETRY_DEADLINE_MS;
  for (;;) {
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(filePath);
      db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
      init(db);
      return db;
    } catch (err) {
      if (db) {
        try {
          db.close();
        } catch {
          // Koneksi percobaan gagal memang dibuang; abaikan error tutup.
        }
      }
      if (!isBusyError(err) || Date.now() >= deadline) {
        throw err;
      }
      sleepSync(RETRY_INTERVAL_MS);
    }
  }
}
