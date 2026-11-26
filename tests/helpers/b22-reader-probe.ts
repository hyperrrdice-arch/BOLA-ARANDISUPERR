/**
 * READER MARKER PROBE (B2.2a) — dijalankan sebagai subprocess dengan
 * cwd = sandbox fixture.
 *
 * Memanggil pembaca marker Beranda yang sebenarnya
 * (`ambilWaktuRefreshTerakhir` di lib/web/rekam.ts) pada jam beku dari
 * argumen pertama dan mencetak hasilnya sebagai "PROBE_JSON ".
 * Proses terpisah → cache handle read-only `dbRo` selalu bersih.
 */
import { ambilWaktuRefreshTerakhir } from "../../lib/web/rekam";

const nowUtc = process.argv[2];
if (!nowUtc) {
  console.error("argumen nowUtc wajib");
  process.exit(2);
}
console.log(
  `PROBE_JSON ${JSON.stringify({ marker: ambilWaktuRefreshTerakhir(nowUtc) })}`,
);
