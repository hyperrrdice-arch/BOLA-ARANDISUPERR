/**
 * SHOT PROBE B2.2 — screenshot Beranda (footer waktu penyegaran),
 * Detail laga (Sumber angka + label pilihan resmi), dan Pilihan
 * (model-saja + pembanding valid) pada lebar 320/390/1440 CSS px,
 * plus pengukuran overflow dokumen dan ekstraksi teks bukti.
 *
 * Pakai: node tasks/b2-2/shot-probe.mjs <baseUrl> <dir-output>
 * Menghasilkan <dir-output>/{beranda,detail,pilihan}-{320,390,1440}.png
 * dan mencetak satu baris "SHOT_JSON " per halaman×lebar.
 */
import { resolveBrowserStack } from "../../tests/helpers/browser-resolve.mjs";

const baseUrl = process.argv[2];
const outDir = process.argv[3];
if (!baseUrl || !outDir) {
  console.error("usage: shot-probe.mjs <baseUrl> <dir-output>");
  process.exit(2);
}

const HALAMAN = [
  {
    nama: "beranda",
    path: "/",
    tunggu: "footer",
    cari: ["Penyegaran data terakhir", "Jadwal refresh", "Waktu pembaruan belum tersedia"],
  },
  {
    nama: "detail",
    path: "/pertandingan/b22_derby",
    tunggu: "Sumber angka",
    cari: [
      "Pembanding pasar · Bet365 · Tercatat",
      "Model saja",
      "Perbandingan dari analisis terbaru",
      "Peluang tersirat pasar",
      "Panel arsip",
      "Disesuaikan dari uji historis",
    ],
  },
  {
    nama: "pilihan",
    path: "/pilihan",
    tunggu: "Pembanding pasar",
    cari: [
      "Pembanding pasar · Bet365 · Tercatat",
      "Model saja",
      "Peluang model saat terbit",
      "Disesuaikan dari uji historis",
    ],
  },
];

const { puppeteer, chromium } = resolveBrowserStack();
const executablePath = await chromium.executablePath();
const browser = await puppeteer.launch({
  executablePath,
  args: [...chromium.args, "--no-sandbox", "--hide-scrollbars"],
  headless: true,
});
try {
  for (const h of HALAMAN) {
    for (const width of [320, 390, 1440]) {
      const page = await browser.newPage();
      await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
      const resp = await page.goto(`${baseUrl}${h.path}`, {
        waitUntil: "networkidle0",
        timeout: 120_000,
      });
      try {
        await page.waitForFunction(
          (t) => document.body && document.body.innerText.includes(t),
          { timeout: 30_000 },
          h.tunggu,
        );
      } catch {
        /* teks tunggu tidak muncul — tetap ukur + laporkan apa adanya */
      }
      const ukur = await page.evaluate((cari) => {
        const teks = (document.body?.innerText ?? "").replace(/\s+/g, " ");
        return {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          ditemukan: Object.fromEntries(
            cari.map((c) => [c, teks.includes(c)]),
          ),
          cuplikan: teks.slice(0, 300),
        };
      }, h.cari);
      const file = `${outDir}/${h.nama}-${width}.png`;
      await page.screenshot({ path: file, fullPage: true });
      console.log(
        `SHOT_JSON ${JSON.stringify({
          halaman: h.nama,
          width,
          http: resp?.status() ?? null,
          overflow: ukur.scrollWidth > ukur.clientWidth + 1,
          scrollWidth: ukur.scrollWidth,
          clientWidth: ukur.clientWidth,
          ditemukan: ukur.ditemukan,
          file,
        })}`,
      );
      await page.close();
    }
  }
} finally {
  await browser.close();
}
