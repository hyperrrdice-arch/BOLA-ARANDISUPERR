/**
 * Probe browser suite temuan #4 verifikasi produksi (detail laga saat
 * JavaScript mati). Dijalankan sebagai subproses oleh
 * tests/test-verifikasi-detail-ssr.ts terhadap server `next start`
 * panggung (data sandbox Marseille yang sama dengan temuan #2).
 *
 * Cara pemilik menguji, dibekukan apa adanya:
 * - JS MATI: halaman detail dibuka di Chromium dengan eksekusi skrip
 *   dimatikan, ditunggu sampai respons selesai (network idle), lalu
 *   yang dinilai adalah TEKS YANG TERLIHAT — diambil dari pohon
 *   layout browser (DOMSnapshot): simpul teks yang punya kotak
 *   layout. Konten hasil streaming yang tertinggal di segmen
 *   tersembunyi (atribut `hidden`, tanpa kotak layout) TIDAK
 *   terhitung terlihat, persis seperti yang dialami pembaca.
 *   Pencarian string di HTML mentah sengaja TIDAK dipakai.
 * - JS AKTIF: teks ter-render (innerText), jumlah canvas sebelum/
 *   sesudah memilih 3D dan kembali ke 2D, serta daftar permintaan
 *   jaringan — kontrak §9: nol permintaan chunk 3D sebelum dipilih.
 *
 * Puppeteer dimuat dari tumpukan pwshot yang sama dengan semua probe
 * render sebelumnya (~/workspace/tools/pwshot), dijangkar createRequire
 * supaya probe bisa hidup di repo. Override: env PWSHOT_DIR.
 *
 * Pakai: node verifikasi4-probe.mjs <baseUrl> <dirKeluar>
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
  console.error("pakai: verifikasi4-probe.mjs <baseUrl> <dirKeluar>");
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

const MT = "mt_022917440";
const SM = "sm_19715544";
const FALLBACK = "Memuat analisis laga…";

/** Teks yang TERLIHAT menurut pohon layout (bukan HTML mentah). */
async function teksTerlihat(page) {
  const session = await page.createCDPSession();
  try {
    const snap = await session.send("DOMSnapshot.captureSnapshot", {
      computedStyles: [],
      includeDOMRects: true,
    });
    const doc = snap.documents[0];
    const strings = snap.strings;
    const terlayout = new Set(doc.layout?.nodeIndex ?? []);
    const teks = [];
    const nodeType = doc.nodes.nodeType;
    const nodeValue = doc.nodes.nodeValue;
    for (let i = 0; i < nodeValue.length; i++) {
      if (nodeType[i] === 3 && nodeValue[i] >= 0 && terlayout.has(i)) {
        const s = strings[nodeValue[i]];
        if (s && s.trim()) teks.push(s.trim());
      }
    }
    return teks.join("\n");
  } finally {
    await session.detach().catch(() => {});
  }
}

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});

const hasil = { jsMati: {}, jsAktif: {} };

try {
  /* ---------------------------------------------------------- JS MATI */
  for (const id of [MT, SM]) {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setViewport({ width: 378, height: 800 });
    const resp = await page.goto(`${BASE}/pertandingan/${id}`, {
      waitUntil: "networkidle0",
      timeout: 60_000,
    });
    // Beri waktu sisa aliran dokumen menutup sebelum snapshot layout.
    await new Promise((r) => setTimeout(r, 500));
    const teks = await teksTerlihat(page);
    hasil.jsMati[id] = {
      status: resp?.status() ?? null,
      teks,
      fallbackTerlihat: teks.includes(FALLBACK),
    };
    if (id === MT) {
      await page.screenshot({ path: path.join(OUT, "detail-js-mati.png"), fullPage: true });
    }
    await page.close();
  }

  /* --------------------------------------------------------- JS AKTIF */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 378, height: 800 });
    const permintaan = [];
    const errors = [];
    page.on("request", (r) => permintaan.push(r.url()));
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
    const resp = await page.goto(`${BASE}/pertandingan/${MT}`, {
      waitUntil: "networkidle0",
      timeout: 60_000,
    });
    const teksAwal = await page.evaluate(() => document.body.innerText);
    const canvasAwal = await page.evaluate(() => document.querySelectorAll("canvas").length);
    const reqSebelum3d = [...permintaan];
    const polaTiga = /three|petaskor3d/i;

    let canvas3d = -1;
    let pesanGl = null;
    await page.click('button[aria-label="Tampilan tiga dimensi"]');
    try {
      await page.waitForFunction(() => document.querySelectorAll("canvas").length >= 1, {
        timeout: 25_000,
      });
      canvas3d = 1;
    } catch {
      canvas3d = await page.evaluate(() => document.querySelectorAll("canvas").length);
      pesanGl = await page.evaluate(() => document.body.innerText.includes("belum tersedia di sini"));
    }
    const reqSesudah3d = [...permintaan];
    await page.click('button[aria-label="Tampilan tabel dua dimensi"]');
    await page.waitForFunction(() => document.querySelectorAll("canvas").length === 0, {
      timeout: 15_000,
    }).catch(() => {});
    const canvasAkhir = await page.evaluate(() => document.querySelectorAll("canvas").length);

    hasil.jsAktif = {
      status: resp?.status() ?? null,
      teks: teksAwal,
      canvasAwal,
      canvas3d,
      canvasAkhir,
      pesanGlGagal: pesanGl === true,
      reqTigaSebelum: reqSebelum3d.filter((u) => polaTiga.test(u)),
      reqBaruSesudah3d: reqSesudah3d.filter((u) => !reqSebelum3d.includes(u)),
      errors,
    };
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(`PROBE_JSON ${JSON.stringify(hasil)}`);
