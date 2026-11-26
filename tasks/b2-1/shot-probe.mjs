/**
 * SHOT PROBE B2.1 — screenshot /bukti pada lebar 320/390/1440 CSS px
 * + pengukuran overflow halaman, memakai tumpukan browser repo
 * (tests/helpers/browser-resolve.mjs).
 *
 * Pakai: node tasks/b2-1/shot-probe.mjs <baseUrl> <prefix-output>
 * Menghasilkan <prefix>-320.png, <prefix>-390.png, <prefix>-1440.png
 * dan mencetak satu baris "SHOT_JSON " per lebar.
 */
import { resolveBrowserStack } from "../../tests/helpers/browser-resolve.mjs";

const baseUrl = process.argv[2];
const prefix = process.argv[3];
if (!baseUrl || !prefix) {
  console.error("usage: shot-probe.mjs <baseUrl> <prefix-output>");
  process.exit(2);
}

const { puppeteer, chromium } = resolveBrowserStack();
const executablePath = await chromium.executablePath();
const browser = await puppeteer.launch({
  executablePath,
  args: [...chromium.args, "--no-sandbox", "--hide-scrollbars"],
  headless: true,
});
try {
  for (const width of [320, 390, 1440]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
    const resp = await page.goto(`${baseUrl}/bukti`, {
      waitUntil: "networkidle0",
      timeout: 120_000,
    });
    await page.waitForSelector('section[aria-label="Keputusan tiket hari ini"]', {
      timeout: 30_000,
    });
    const ukur = await page.evaluate(() => {
      const kartu = document.querySelector(
        'section[aria-label="Keputusan tiket hari ini"]',
      );
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        teksKartu: (kartu?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
      };
    });
    const file = `${prefix}-${width}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log(
      `SHOT_JSON ${JSON.stringify({
        width,
        http: resp?.status() ?? null,
        overflow: ukur.scrollWidth > ukur.clientWidth + 1,
        scrollWidth: ukur.scrollWidth,
        clientWidth: ukur.clientWidth,
        file,
        teksKartu: ukur.teksKartu,
      })}`,
    );
    await page.close();
  }
} finally {
  await browser.close();
}
