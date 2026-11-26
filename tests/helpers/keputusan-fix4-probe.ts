/**
 * KEPUTUSAN FIX-4 PROBE (B2.1) — dijalankan sebagai subprocess dengan
 * cwd = sandbox fixture.
 *
 * Memanggil pembaca kartu "Keputusan tiket hari ini" yang sebenarnya
 * (lib/web/rekam.ts → ambilKeputusanFix4HariIni) pada jam beku dari
 * argumen pertama dan mencetak satu baris "PROBE_JSON ". Probe tidak
 * menilai apa pun; suite yang menilai. Karena probe adalah proses
 * terpisah, cache handle read-only `dbRo` selalu mulai dari keadaan
 * bersih untuk setiap skenario.
 */
import { ambilKeputusanFix4HariIni } from "../../lib/web/rekam";

const nowUtc = process.argv[2];
if (!nowUtc) {
  console.error("argumen nowUtc wajib");
  process.exit(2);
}
const hasil = ambilKeputusanFix4HariIni(nowUtc);
console.log(`PROBE_JSON ${JSON.stringify(hasil)}`);
