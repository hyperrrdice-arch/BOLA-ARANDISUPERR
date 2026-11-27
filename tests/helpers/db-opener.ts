/**
 * HELPER TES D05-BUSY — buka koneksi writable produksi (getPicksDb /
 * getPackagesDb) dari proses TERPISAH dan laporkan hasilnya sebagai
 * satu baris JSON di stdout.
 *
 * Proses terpisah wajib: kedua getter adalah singleton per proses, jadi
 * perilaku "buka saat DB terkunci proses lain" hanya bisa diamati dari
 * proses yang belum pernah membukanya.
 *
 * argv: [which]  — "picks" | "packages"
 * Sukses: exit 0, {"ok":true,"journal_mode":"wal","rows":<n>}
 * Gagal:  exit 1, {"ok":false,"errcode":<n|null>,"message":"..."}
 */
export {};
async function main(): Promise<void> {
  const which = process.argv[2];
  try {
    let journalMode: unknown;
    let rows: unknown;
    if (which === "picks") {
      const { getPicksDb } = await import("../../lib/picks/ledger");
      const db = getPicksDb();
      journalMode = (db.prepare("PRAGMA journal_mode").get() as { journal_mode: string })
        .journal_mode;
      rows = (db.prepare("SELECT COUNT(*) AS n FROM picks").get() as { n: number }).n;
    } else if (which === "packages") {
      const { getPackagesDb } = await import("../../lib/picks/packages");
      const db = getPackagesDb();
      journalMode = (db.prepare("PRAGMA journal_mode").get() as { journal_mode: string })
        .journal_mode;
      rows = (db.prepare("SELECT COUNT(*) AS n FROM packages").get() as { n: number }).n;
    } else {
      throw new Error(`db-opener: argumen tidak dikenal: ${String(which)}`);
    }
    console.log(JSON.stringify({ ok: true, journal_mode: journalMode, rows }));
    process.exit(0);
  } catch (err) {
    const e = err as { errcode?: unknown; message?: unknown };
    console.log(
      JSON.stringify({
        ok: false,
        errcode: typeof e.errcode === "number" ? e.errcode : null,
        message: String(e.message ?? err),
      }),
    );
    process.exit(1);
  }
}

main();
