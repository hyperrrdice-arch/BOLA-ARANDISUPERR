/**
 * Resolusi tumpukan browser untuk probe uji (LANJUT-3).
 *
 * Urutan resolusi:
 *  1. Env PWSHOT_DIR — override warisan untuk perkakas lokal di luar
 *     checkout (~/workspace/tools/pwshot). Hanya dipakai bila diset
 *     secara eksplisit.
 *  2. Checkout repo ini sendiri — puppeteer-core + @sparticuz/chromium
 *     adalah devDependencies BERVERSI TERKUNCI di package.json, jadi
 *     `npm ci` di checkout bersih (termasuk CI) menyediakan persis
 *     versi yang sama dengan tumpukan lokal yang terverifikasi
 *     (puppeteer-core 25.16.0, @sparticuz/chromium 153.0.0).
 *
 * GAGAL KERAS adalah kontraknya: bila kedua jalur tidak menyediakan
 * dependensinya, fungsi ini melempar — proses probe mati dengan error
 * yang terbaca dan suite gagal. Tidak ada jalur skip diam-diam.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

function muatDari(baseDir) {
  const req = createRequire(path.join(baseDir, "package.json"));
  const puppeteer = req("puppeteer-core");
  const chromiumMod = req("@sparticuz/chromium");
  return { puppeteer, chromium: chromiumMod.default ?? chromiumMod };
}

export function resolveBrowserStack() {
  if (process.env.PWSHOT_DIR) {
    return muatDari(process.env.PWSHOT_DIR);
  }
  try {
    return muatDari(REPO_ROOT);
  } catch (e) {
    throw new Error(
      "dependensi browser tidak tersedia di checkout ini " +
        `(puppeteer-core / @sparticuz/chromium): ${e instanceof Error ? e.message : String(e)}. ` +
        "Jalankan `npm ci` di checkout, atau set PWSHOT_DIR ke instalasi perkakas lokal.",
    );
  }
}
