// ============================================================================
// PATH DATABASE TERPUSAT (Sprint Portable VPS & Docker V2, Fase 1)
// ----------------------------------------------------------------------------
// Satu-satunya sumber kebenaran lokasi file SQLite runtime:
//
// - `DB_DIR` TIDAK diset  -> `path.join(process.cwd(), "data")`
//   (kompatibilitas mundur penuh: checkout host lama berperilaku persis
//   seperti sebelum modul ini ada — semua .db tetap di `data/`).
// - `DB_DIR` diset (mis. `/app/storage` di Docker) -> direktori itu dibuat
//   otomatis (`mkdirSync` recursive) dan SELURUH file .db diarahkan ke sana,
//   terpisah dari `data/` yang hanya memuat JSON statis ter-track Git.
//
// File JSON statis (`model-manifest.json`, `calibrated_ratings.json`,
// `fixture-links.json`, `*-canonical.json`, `logo-assets.json`) TIDAK PERNAH
// ikut `DB_DIR` — gunakan `dataDir()` / `dataFilePath()` untuk mereka.
// ============================================================================
import fs from "node:fs";
import path from "node:path";

/** Direktori JSON statis ter-track Git — selalu `data/`, tak pernah `DB_DIR`. */
export function dataDir(): string {
  return path.join(process.cwd(), "data");
}

/** Path file statis di dalam `data/` (JSON dsb.), kebal `DB_DIR`. */
export function dataFilePath(fileName: string): string {
  return path.join(dataDir(), fileName);
}

/**
 * Direktori database SQLite runtime.
 * Menghormati `process.env.DB_DIR`; default kompatibilitas-mundur `data/`.
 * Bila `DB_DIR` diset, direktori dibuat (recursive) sebelum dikembalikan.
 */
export function dbDir(): string {
  const raw = process.env.DB_DIR?.trim();
  const dir = raw
    ? path.isAbsolute(raw)
      ? raw
      : path.join(process.cwd(), raw)
    : path.join(process.cwd(), "data");
  // Sama seperti perilaku lama para pemanggil: direktori dipastikan ada.
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Path lengkap satu file database di direktori DB runtime (`DB_DIR`/`data/`). */
export function dbPath(fileName: string): string {
  return path.join(dbDir(), fileName);
}
