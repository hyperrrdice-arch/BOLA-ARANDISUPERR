/**
 * Probe browser suite jadwal-akses (brief tindak lanjut §2.2–§2.4).
 * Dijalankan sebagai subproses oleh tests/test-jadwal-akses-browser.ts
 * terhadap server `next start` panggung (seed jadwal-akses-seed.ts).
 *
 * Diperiksa di browser nyata:
 *  - Beranda: CTA hero → /analisa; aset hero terambil byte-identik
 *    (ukuran + sha256 dihitung di sini, dibandingkan suite).
 *  - Jadwal: nama aksesibel baris selesai 0–0 dan live 2–1 memuat
 *    tim + status + skor; baris terjadwal tanpa skor; footer cap
 *    refresh B2.2; logo grup dari logo-assets panggung termuat.
 *  - Analisa: baris resmi menampilkan angka ledger 68% + label basis
 *    B2.2 (bukan 45% paket terbaru); baris paket-saja 77% berlabel
 *    "Paket terbaru · Belum terbit resmi".
 *  - Detail: tautan kembali SSR dari asal=analisa; 404 dengan konteks
 *    asal yang sama (tautan klien TautanKembali404) dan 404 polos.
 *  - Tab aktif: tepat satu per nav yang terlihat, per rute.
 *  - Screenshot kandidat 320/390 untuk Beranda/Analisa/Jadwal.
 *
 * Pakai: node jadwal-akses-probe.mjs <baseUrl> <dirKeluar> <tglHariIni> <tglBesok>
 * Mencetak satu baris "PROBE_JSON <json>".
 */
import { resolveBrowserStack } from "./browser-resolve.mjs";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const { puppeteer, chromium } = resolveBrowserStack();

const BASE = process.argv[2];
const OUT = process.argv[3];
const TGL_INI = process.argv[4];
const TGL_BESOK = process.argv[5];
if (!BASE || !OUT || !TGL_INI || !TGL_BESOK) {
  console.error("pakai: jadwal-akses-probe.mjs <baseUrl> <dirKeluar> <tglHariIni> <tglBesok>");
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

const hasil = {
  heroAset: null,
  detailKembali: null,
  beranda: null,
  jadwalIni: null,
  jadwalBesok: null,
  analisa: null,
  hilangAnalisa: null,
  hilangPolos: null,
  errors: [],
};

/* ------------------------------------------------- aset hero (fetch) */
{
  const html = await (await fetch(`${BASE}/`)).text();
  const m = html.match(/\/_next\/static\/media\/bola-hero-grafit\.[^"\\]+\.webp/);
  if (m) {
    const buf = Buffer.from(await (await fetch(`${BASE}${m[0]}`)).arrayBuffer());
    hasil.heroAset = {
      url: m[0],
      size: buf.length,
      sha256: createHash("sha256").update(buf).digest("hex"),
    };
  }
}

/* ------------------------------------------- detail: kembali SSR */
{
  const kembali = encodeURIComponent(`tanggal=${TGL_BESOK}&status=selesai`);
  const html = await (
    await fetch(`${BASE}/pertandingan/sm_aks_resmi?asal=analisa&kembali=${kembali}`)
  ).text();
  const hrefs = [...html.matchAll(/href="(\/(?:analisa|pertandingan)[^"]*)"/g)].map((x) =>
    x[1].replace(/&amp;/g, "&"),
  );
  hasil.detailKembali = { hrefs };
}

/* ------------------------------------------------------------ browser */
chromium.setGraphicsMode = false;
const exe = await chromium.executablePath();
const browser = await puppeteer.launch({
  executablePath: exe,
  args: [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.on("pageerror", (e) => hasil.errors.push(String(e)));

const navAktif = () =>
  page.evaluate(() => {
    const out = [];
    for (const nav of document.querySelectorAll("nav")) {
      const aktif = [...nav.querySelectorAll('a[aria-current="page"]')].map((a) =>
        (a.textContent ?? "").trim(),
      );
      if (aktif.length > 0) {
        const cs = getComputedStyle(nav);
        out.push({ terlihat: cs.display !== "none" && cs.visibility !== "hidden", aktif });
      }
    }
    return out;
  });

const baris = (id) =>
  page.evaluate((mid) => {
    const a = document.querySelector(`a[href*="${mid}"]`);
    if (!a) return null;
    return {
      ariaLabel: a.getAttribute("aria-label"),
      teks: (a.innerText ?? "").replace(/\s+/g, " ").trim(),
    };
  }, id);

async function ke(url) {
  const res = await page.goto(`${BASE}${url}`, { waitUntil: "networkidle0", timeout: 90_000 });
  return res?.status() ?? 0;
}

/* Beranda */
{
  const status = await ke("/");
  const cta = await page.evaluate(() => {
    const a = [...document.querySelectorAll("a")].find(
      (x) =>
        x.getAttribute("href") === "/analisa" &&
        (x.textContent ?? "").includes("Lihat Analisa"),
    );
    return a ? (a.textContent ?? "").replace(/\s+/g, " ").trim() : null;
  });
  hasil.beranda = { status, cta, nav: await navAktif() };
}

/* Jadwal hari ini: selesai 0–0 + live 2–1 + footer + logo */
{
  const status = await ke(`/pertandingan?tanggal=${TGL_INI}`);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await new Promise((r) => setTimeout(r, 900));
  const logo = await page.evaluate(() =>
    [...document.querySelectorAll('img[src="/logo-uji.webp"]')].map((img) => ({
      complete: img.complete,
      naturalWidth: img.naturalWidth,
    })),
  );
  const footer = await page.evaluate(() => {
    const f = document.querySelector("footer");
    return f ? (f.innerText ?? "").replace(/\s+/g, " ").trim() : null;
  });
  hasil.jadwalIni = {
    status,
    done00: await baris("sm_aks_done00"),
    live: await baris("sm_aks_live"),
    logo,
    footer,
    nav: await navAktif(),
  };
}

/* Jadwal besok: baris terjadwal */
{
  const status = await ke(`/pertandingan?tanggal=${TGL_BESOK}`);
  hasil.jadwalBesok = { status, next: await baris("sm_aks_next") };
}

/* Analisa besok: identitas angka resmi vs paket + konflik dua alias */
{
  const status = await ke(`/analisa?tanggal=${TGL_BESOK}`);
  hasil.analisa = {
    status,
    resmi: await baris("sm_aks_resmi"),
    paket: await baris("sm_aks_paket"),
    konflik: await baris("sm_aks_konflik"),
    nav: await navAktif(),
  };
}

/* 404 dengan konteks asal analisa */
{
  const kembali = encodeURIComponent(`tanggal=${TGL_BESOK}&status=selesai`);
  const status = await ke(`/pertandingan/sm_aks_hilang?asal=analisa&kembali=${kembali}`);
  await new Promise((r) => setTimeout(r, 700));
  const tautan = await page.evaluate(() => {
    const a = [...document.querySelectorAll("a")].find((x) =>
      (x.textContent ?? "").includes("Kembali"),
    );
    return a
      ? { href: a.getAttribute("href"), teks: (a.textContent ?? "").replace(/\s+/g, " ").trim() }
      : null;
  });
  const tidakDitemukan = await page.evaluate(() =>
    (document.body.innerText ?? "").includes("Pertandingan tidak ditemukan"),
  );
  hasil.hilangAnalisa = { status, tautan, tidakDitemukan };
}

/* 404 polos */
{
  const status = await ke(`/pertandingan/sm_aks_hilang`);
  await new Promise((r) => setTimeout(r, 700));
  const tautan = await page.evaluate(() => {
    const a = [...document.querySelectorAll("a")].find((x) =>
      (x.textContent ?? "").includes("Kembali"),
    );
    return a
      ? { href: a.getAttribute("href"), teks: (a.textContent ?? "").replace(/\s+/g, " ").trim() }
      : null;
  });
  const tidakDitemukan = await page.evaluate(() =>
    (document.body.innerText ?? "").includes("Pertandingan tidak ditemukan"),
  );
  hasil.hilangPolos = { status, tautan, tidakDitemukan };
}

/* Screenshot kandidat 320/390 */
for (const lebar of [320, 390]) {
  await page.setViewport({ width: lebar, height: lebar === 320 ? 700 : 844 });
  await ke("/");
  await page.screenshot({ path: path.join(OUT, `kandidat-beranda-${lebar}.png`) });
  await ke(`/analisa?tanggal=${TGL_BESOK}`);
  await page.screenshot({ path: path.join(OUT, `kandidat-analisa-${lebar}.png`) });
  if (lebar === 390) {
    /* Smoke khusus keadaan konflik: gulir baris sm_aks_konflik ke
       dalam viewport lalu simpan sebagai bukti smoke 390px. */
    await page.evaluate(() => {
      const a = document.querySelector('a[href*="sm_aks_konflik"]');
      if (a) a.scrollIntoView({ block: "center" });
    });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: path.join(OUT, "analisa-konflik-390.png") });
  }
  await ke(`/pertandingan?tanggal=${TGL_INI}`);
  await page.screenshot({ path: path.join(OUT, `kandidat-jadwal-${lebar}.png`) });
}

await browser.close();
console.log(`PROBE_JSON ${JSON.stringify(hasil)}`);
