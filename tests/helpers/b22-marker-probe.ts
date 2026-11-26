/**
 * MARKER REFRESH PROBE (B2.2a) — dijalankan sebagai subprocess dengan
 * cwd = sandbox fixture.
 *
 * Memanggil penulis marker yang sebenarnya (`catatRefreshSukses` di
 * lib/picks/packages.ts — fungsi yang sama dengan yang dipanggil
 * scripts/free-refresh.ts sesudah resolver sukses) dengan cap dari
 * argumen pertama, lalu mencetak nilai tersimpan. Probe tidak menilai
 * apa pun; suite yang menilai.
 */
import {
  FREE_REFRESH_LAST_SUCCESS_KEY,
  catatRefreshSukses,
  getPackageStoreMeta,
} from "../../lib/picks/packages";

const cap = process.argv[2];
if (!cap) {
  console.error("argumen capUtc wajib");
  process.exit(2);
}
const bergerak = catatRefreshSukses(cap);
console.log(
  `PROBE_JSON ${JSON.stringify({
    bergerak,
    tersimpan: getPackageStoreMeta(FREE_REFRESH_LAST_SUCCESS_KEY),
  })}`,
);
