/**
 * Probe browser suite LANJUT-2 (permintaan matriks yang gagal bisa
 * diulang). Dijalankan sebagai subproses oleh
 * tests/test-pilihan-matriks-ulang.ts terhadap server `next start`
 * panggung (data sandbox Marseille yang sama dengan lanjut-1:
 * dua edisi paket, 16 pick beku).
 *
 * Semua permintaan halaman melewati intersepsi Puppeteer; permintaan
 * ke /api/pilihan/matriks dihitung dan dapat dimanipulasi per fase:
 *  - modeGagalSekali: permintaan matriks berikutnya di-abort
 *    (kegagalan jaringan), selebihnya diteruskan;
 *  - modeTahanMs: respons matriks ditahan N ms (permintaan in-flight);
 *  - modeNull: permintaan matriks dijawab 200 dengan null per id
 *    (kontrak server untuk paket tanpa matriks — keadaan kosong).
 *
 * Setiap fase mulai dari halaman SEGAR (draf dikosongkan lalu muat
 * ulang) supaya cache matriks komponen tidak terbawa antar fase;
 * hitungan permintaan dilaporkan sebagai delta per fase.
 *
 * Fase (alur pemilik §2 + syarat penerimaan lanjut-2):
 *  A. Gagalkan permintaan pertama → panel belum tersedia; hapus +
 *     tambah ulang pilihan kedua → permintaan KEDUA terkirim dan
 *     gabungan ±89,2% tampil (pemulihan tanpa muat ulang).
 *  B. Gagalkan lagi → tombol "Coba lagi" ada di panel gabungan;
 *     klik → permintaan baru → 89,2% tampil, tanpa muat ulang.
 *  C. Respons ditahan 1500 ms → hapus + tambah ulang SELAMA
 *     in-flight → tetap tepat SATU permintaan (deduplikasi).
 *  D. Jawaban null (kosong) → belum tersedia + alasan matriks dari
 *     combineSlip, TANPA tombol "Coba lagi"; hapus + tambah ulang
 *     TIDAK memicu permintaan baru (kosong = keadaan akhir).
 *
 * Puppeteer dari resolver bersama tests/helpers/browser-resolve.mjs
 * (LANJUT-3): devDependencies terkunci di checkout; env PWSHOT_DIR
 * hanya override eksplisit ke perkakas lokal.
 *
 * Pakai: node lanjut2-probe.mjs <baseUrl> <dirKeluar>
 * Mencetak satu baris "PROBE_JSON <json>".
 */
import { resolveBrowserStack } from "./browser-resolve.mjs";
import fs from "node:fs";
import path from "node:path";

// Tumpukan browser dari resolver bersama (LANJUT-3): devDependencies
// terkunci di checkout; PWSHOT_DIR hanya override eksplisit. Gagal
// keras bila tidak tersedia — tidak ada skip diam-diam.
const { puppeteer, chromium } = resolveBrowserStack();

const BASE = process.argv[2];
const OUT = process.argv[3];
if (!BASE || !OUT) {
  console.error("pakai: lanjut2-probe.mjs <baseUrl> <dirKeluar>");
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

const hasil = { api: null, a: null, b: null, c: null, d: null, errors: [] };

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

const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));

/* Intersepsi: hitung + manipulasi permintaan matriks per fase. */
let totalReqMatriks = 0;
let modeGagalSekali = false;
let modeTahanMs = 0;
let modeNull = false;
await page.setRequestInterception(true);
page.on("request", (r) => {
  const url = r.url();
  if (!url.includes("/api/pilihan/matriks")) {
    r.continue().catch(() => {});
    return;
  }
  totalReqMatriks++;
  if (modeGagalSekali) {
    modeGagalSekali = false;
    r.abort().catch(() => {});
    return;
  }
  if (modeNull) {
    const ids = (new URL(url).searchParams.get("paket") ?? "").split(",").filter(Boolean);
    const matriks = {};
    for (const id of ids) matriks[id] = null;
    r.respond({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ matriks }),
    }).catch(() => {});
    return;
  }
  if (modeTahanMs > 0) {
    const t = modeTahanMs;
    setTimeout(() => r.continue().catch(() => {}), t);
    return;
  }
  r.continue().catch(() => {});
});

/* ------------------------------------------------------------- pembantu */

/** Klik tombol baris pilihan ("Tambah"/"Terpilih") sesudah teksnya siap. */
async function klikBaris(labelPasar, teksTombol) {
  await page.waitForFunction(
    (label, teks) =>
      [...document.querySelectorAll("li")].some(
        (el) =>
          el.innerText &&
          el.innerText.includes(label) &&
          [...el.querySelectorAll("button")].some((b) => b.textContent.trim() === teks),
      ),
    { timeout: 10_000 },
    labelPasar,
    teksTombol,
  );
  const ok = await page.evaluate(
    (label, teks) => {
      const li = [...document.querySelectorAll("li")].find(
        (el) =>
          el.innerText &&
          el.innerText.includes(label) &&
          [...el.querySelectorAll("button")].some((b) => b.textContent.trim() === teks),
      );
      if (!li) return false;
      li.scrollIntoView({ block: "center" });
      [...li.querySelectorAll("button")]
        .find((b) => b.textContent.trim() === teks)
        .click();
      return true;
    },
    labelPasar,
    teksTombol,
  );
  if (!ok) throw new Error(`baris pilihan tak ditemukan: ${labelPasar} / ${teksTombol}`);
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

async function tutupPanel() {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('[role="dialog"] button')].find(
      (b) => b.textContent.trim() === "Tutup",
    );
    btn?.click();
  });
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), {
    timeout: 10_000,
  });
  await tunggu(200);
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

async function panelPunyaTombolCobaLagi() {
  return page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"] button')].some(
      (b) => b.textContent.trim() === "Coba lagi",
    ),
  );
}

/** Cari Marseille + buka semua pilihan laga (keadaan daftar awal fase). */
async function siapkanDaftar() {
  await page.waitForSelector('input[type="search"]', { timeout: 30_000 });
  await page.type('input[type="search"]', "Marseille");
  await page.waitForFunction(() => document.body.innerText.includes("Le Mans"), {
    timeout: 30_000,
  });
  await tunggu(500);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Lihat semua pilihan laga",
    );
    btn?.click();
  });
  await tunggu(400);
}

/**
 * Akhiri fase: kosongkan draf dari panel lalu muat ulang halaman —
 * fase berikutnya mulai dengan cache matriks komponen yang bersih.
 */
async function segarkanHalaman() {
  await kosongkanDariPanel();
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  await siapkanDaftar();
}

const CETAK = "Tim kandang mencetak gol";
const OU15 = "Total gol · garis 1,5";

await page.goto(`${BASE}/pilihan`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await siapkanDaftar();

/* ------------------------------------------- fase A: gagal → tambah ulang */

{
  const reqAwal = totalReqMatriks;
  modeGagalSekali = true;
  await klikBaris(CETAK, "Tambah");
  await tunggu(300);
  await klikBaris(OU15, "Tambah"); // permintaan matriks pertama → abort
  await tunggu(900);
  const reqSesudahGagal = totalReqMatriks - reqAwal;
  const teksGagal = await bukaPanel();
  await page.screenshot({ path: path.join(OUT, "gagal-awal.png") });
  await tutupPanel();
  // Hapus pilihan kedua (permintaan tidak boleh bertambah), lalu
  // tambah ulang — interaksi inilah yang wajib memicu permintaan kedua.
  await klikBaris(OU15, "Terpilih");
  await tunggu(500);
  const reqSesudahHapus = totalReqMatriks - reqAwal;
  await klikBaris(OU15, "Tambah");
  await page
    .waitForFunction(() => document.body.innerText.includes("89,2%"), { timeout: 20_000 })
    .catch(() => {});
  await tunggu(400);
  const reqAkhir = totalReqMatriks - reqAwal;
  const teksPulih = await bukaPanel();
  await page.screenshot({ path: path.join(OUT, "pulih-tambah-ulang.png") });
  hasil.a = { reqSesudahGagal, teksGagal, reqSesudahHapus, reqAkhir, teksPulih };
  await segarkanHalaman();
}

/* --------------------------------------------- fase B: tombol "Coba lagi" */

{
  const reqAwal = totalReqMatriks;
  modeGagalSekali = true;
  await klikBaris(CETAK, "Tambah");
  await tunggu(300);
  await klikBaris(OU15, "Tambah"); // permintaan matriks → abort
  await tunggu(900);
  const reqSesudahGagal = totalReqMatriks - reqAwal;
  await bukaPanel();
  const tombolAda = await panelPunyaTombolCobaLagi();
  await page.screenshot({ path: path.join(OUT, "coba-lagi.png") });
  if (tombolAda) {
    await page.evaluate(() => {
      [...document.querySelectorAll('[role="dialog"] button')]
        .find((b) => b.textContent.trim() === "Coba lagi")
        ?.click();
    });
    await page
      .waitForFunction(
        () => document.querySelector('[role="dialog"]')?.innerText.includes("89,2%"),
        { timeout: 20_000 },
      )
      .catch(() => {});
    await tunggu(300);
  }
  const reqAkhir = totalReqMatriks - reqAwal;
  const teks = await page.evaluate(
    () => document.querySelector('[role="dialog"]')?.innerText ?? "",
  );
  hasil.b = { reqSesudahGagal, tombolAda, reqAkhir, teks };
  await segarkanHalaman();
}

/* -------------------------------------- fase C: dedupe selama in-flight */

{
  const reqAwal = totalReqMatriks;
  await klikBaris(CETAK, "Tambah");
  await tunggu(300);
  modeTahanMs = 1500;
  await klikBaris(OU15, "Tambah"); // permintaan terkirim, respons ditahan
  await tunggu(250); // permintaan pasti sudah in-flight
  await klikBaris(OU15, "Terpilih"); // hapus selama in-flight
  await klikBaris(OU15, "Tambah"); // tambah ulang selama in-flight
  await tunggu(300);
  const reqSelamaTerbang = totalReqMatriks - reqAwal;
  modeTahanMs = 0;
  await page
    .waitForFunction(() => document.body.innerText.includes("89,2%"), { timeout: 25_000 })
    .catch(() => {});
  await tunggu(300);
  const teks = await bukaPanel();
  hasil.c = { reqSelamaTerbang, teks };
  await segarkanHalaman();
}

/* -------------------------------------------- fase D: null = kosong akhir */

{
  const reqAwal = totalReqMatriks;
  modeNull = true;
  await klikBaris(CETAK, "Tambah");
  await tunggu(300);
  await klikBaris(OU15, "Tambah"); // dijawab null per id (paket tanpa matriks)
  await tunggu(900);
  const reqSesudahNull = totalReqMatriks - reqAwal;
  const teks = await bukaPanel();
  const tombolAda = await panelPunyaTombolCobaLagi();
  await page.screenshot({ path: path.join(OUT, "null-kosong.png") });
  await tutupPanel();
  // Interaksi ulang TIDAK boleh memicu permintaan baru untuk keadaan kosong.
  await klikBaris(OU15, "Terpilih");
  await tunggu(400);
  await klikBaris(OU15, "Tambah");
  await tunggu(900);
  const reqSesudahInteraksi = totalReqMatriks - reqAwal;
  const teks2 = await bukaPanel();
  modeNull = false;
  hasil.d = { reqSesudahNull, teks, tombolAda, reqSesudahInteraksi, teks2 };
  await kosongkanDariPanel();
}

await browser.close();
console.log(`PROBE_JSON ${JSON.stringify(hasil)}`);
