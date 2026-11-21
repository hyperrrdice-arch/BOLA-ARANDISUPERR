/**
 * Probe browser suite LANJUT-1 (gabungan /pilihan sadar edisi paket).
 * Dijalankan sebagai subproses oleh tests/test-pilihan-edisi-browser.ts
 * terhadap server `next start` panggung (data sandbox Marseille yang
 * sama dengan temuan #2 verifikasi: dua edisi paket, 16 pick beku).
 *
 * Yang dilakukan, persis alur pemilik di produksi:
 * 0. Prasyarat dari API umpan: packageId ketiga pilihan kunci —
 *    1x2 (edisi sm_) HARUS berbeda paket dari ou15 (edisi mt_), dan
 *    team_over05_home HARUS satu paket dengan ou15.
 * 1. Urutan A→B: tambah "menang" (1x2) lalu "Minimal dua gol" (ou15).
 * 2. Urutan B→A: kosongkan, tambah ou15 lalu "menang".
 *    Kedua urutan: panel Pilihanmu dibaca + screenshot; permintaan ke
 *    /api/pilihan/matriks selama fase dicatat (harapan: NOL — grup
 *    beda paket tidak perlu matriks sama sekali).
 * 3. Pasangan satu paket (team_over05_home + ou15, keduanya edisi
 *    mt_): gabungan ±89,2% tampil; tepat SATU permintaan matriks
 *    berisi tepat SATU id paket.
 * 4. Muat ulang halaman: draf pulih dan angka 89,2% tampil lagi
 *    identik.
 *
 * Puppeteer dimuat dari tumpukan pwshot (~/workspace/tools/pwshot),
 * sama seperti probe render lain. Override: env PWSHOT_DIR.
 *
 * Pakai: node lanjut1-probe.mjs <baseUrl> <dirKeluar>
 * Mencetak satu baris "PROBE_JSON <json>".
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PWSHOT =
  process.env.PWSHOT_DIR ??
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
    "tools",
    "pwshot",
  );
const req = createRequire(path.join(PWSHOT, "package.json"));
const puppeteer = req("puppeteer-core");
const chromiumMod = req("@sparticuz/chromium");
const chromium = chromiumMod.default ?? chromiumMod;

const BASE = process.argv[2];
const OUT = process.argv[3];
if (!BASE || !OUT) {
  console.error("pakai: lanjut1-probe.mjs <baseUrl> <dirKeluar>");
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

const hasil = { api: null, ab: null, ba: null, sama: null, pulih: null, errors: [] };

/* ------------------------------------------------------------ prasyarat */

{
  const res = await fetch(
    `${BASE}/api/pilihan?kelas=ALL&q=Marseille&tanggal=&offset=0&batas=20`,
  );
  const hal = await res.json();
  const cari = (market, selection) =>
    (hal.pilihan ?? []).find((p) => p.market === market && p.selection === selection) ??
    null;
  const ringkas = (p) =>
    p === null ? null : { key: p.key, packageId: p.packageId, prob: p.prob, konflik: !!p.konflik };
  hasil.api = {
    status: res.status,
    totalLaga: hal.totalLaga,
    menang: ringkas(cari("1x2", "1")),
    ou15: ringkas(cari("ou15", "over")),
    cetak: ringkas(cari("team_over05_home", "yes")),
  };
}

/* -------------------------------------------------------------- browser */

chromium.setGraphicsMode = false;
const exe = await chromium.executablePath();
const browser = await puppeteer.launch({
  executablePath: exe,
  args: [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const page = await browser.newPage();
await page.setViewport({ width: 378, height: 800 });
page.on("pageerror", (e) => hasil.errors.push(String(e)));

const reqMatriks = [];
page.on("request", (r) => {
  if (r.url().includes("/api/pilihan/matriks")) reqMatriks.push(r.url());
});

const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));

async function klikTambah(labelPasar) {
  const ok = await page.evaluate((label) => {
    const li = [...document.querySelectorAll("li")].find(
      (el) =>
        el.innerText &&
        el.innerText.includes(label) &&
        [...el.querySelectorAll("button")].some((b) => b.textContent.trim() === "Tambah"),
    );
    if (!li) return false;
    li.scrollIntoView({ block: "center" });
    [...li.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "Tambah")
      .click();
    return true;
  }, labelPasar);
  if (!ok) throw new Error(`baris pilihan tak ditemukan: ${labelPasar}`);
  await tunggu(350);
}

async function bukaPanel() {
  const ok = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /^Lihat \d+ pilihan$/.test(b.textContent.trim()),
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!ok) throw new Error("tombol panel Pilihanmu tak ditemukan");
  await page.waitForSelector('[role="dialog"]', { timeout: 10_000 });
  await tunggu(250);
  return page.evaluate(() => document.querySelector('[role="dialog"]').innerText);
}

async function kosongkanDariPanel() {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('[role="dialog"] button')].find(
      (b) => b.textContent.trim() === "Kosongkan pilihan",
    );
    btn?.click();
  });
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), {
    timeout: 10_000,
  });
  await tunggu(250);
}

await page.goto(`${BASE}/pilihan`, { waitUntil: "domcontentloaded", timeout: 60_000 });
// Cari Marseille (pencarian server atas seluruh umpan).
await page.waitForSelector('input[type="search"]', { timeout: 30_000 });
await page.type('input[type="search"]', "Marseille");
await page.waitForFunction(() => document.body.innerText.includes("Le Mans"), {
  timeout: 30_000,
});
await tunggu(500);
// Buka semua pilihan laga (baris 1x2 tidak termasuk 2 teratas).
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === "Lihat semua pilihan laga",
  );
  btn?.click();
});
await tunggu(400);

/* ------------------------------------------------------- fase A→B, B→A */

async function fase(urutan, namaFile) {
  const awalReq = reqMatriks.length;
  for (const label of urutan) await klikTambah(label);
  await tunggu(900); // beri kesempatan permintaan matriks (yang tak boleh ada) terkirim
  const teks = await bukaPanel();
  await page.screenshot({ path: path.join(OUT, namaFile) });
  const req = reqMatriks.slice(awalReq);
  await kosongkanDariPanel();
  return { teks, req };
}

hasil.ab = await fase(["Hasil pertandingan", "Total gol · garis 1,5"], "urutan-ab.png");
hasil.ba = await fase(["Total gol · garis 1,5", "Hasil pertandingan"], "urutan-ba.png");

/* ------------------------------------------------------ fase satu edisi */

{
  const awalReq = reqMatriks.length;
  await klikTambah("Tim kandang mencetak gol");
  await klikTambah("Total gol · garis 1,5");
  await page.waitForFunction(() => document.body.innerText.includes("89,2%"), {
    timeout: 20_000,
  });
  const teks = await bukaPanel();
  await page.screenshot({ path: path.join(OUT, "edisi-sama-892.png") });
  hasil.sama = { teks, req: reqMatriks.slice(awalReq) };
}

/* --------------------------------------------------------- fase pulih */

await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForFunction(
  () =>
    document.body.innerText.includes("Peluang semua tepat") &&
    document.body.innerText.includes("89,2%"),
  { timeout: 30_000 },
);
hasil.pulih = { teks: await bukaPanel() };
await page.screenshot({ path: path.join(OUT, "pulih-muat-ulang.png") });

await browser.close();
console.log(`PROBE_JSON ${JSON.stringify(hasil)}`);
