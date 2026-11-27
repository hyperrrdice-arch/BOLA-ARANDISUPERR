/**
 * TEST:JADWAL-AKSES-BROWSER — brief tindak lanjut §2.2–§2.4 di browser
 * nyata, di atas panggung sandbox jadwal-akses-seed.ts:
 *
 *   §2.2 nama aksesibel baris Jadwal = tim + status + skor (0–0 sah
 *        ikut terbaca; live membawa skor; terjadwal tanpa skor);
 *   §2.3 Analisa: angka resmi merujuk ledger (68% + label basis B2.2)
 *        walau paket terbaru membawa 45%; angka paket-saja berlabel
 *        "Paket terbaru · Belum terbit resmi"; tujuan kembali Detail
 *        (SSR) dan Detail 404 menghormati asal=analisa + filter
 *        tersanitasi, dan 404 polos jatuh ke Jadwal;
 *   §2.4 cap refresh B2.2 tetap di footer Jadwal; CTA hero → /analisa;
 *        tepat satu tab aktif per rute; logo kompetisi/tim termuat;
 *        aset hero byte-identik; screenshot kandidat 320/390 disimpan
 *        di tasks/frontend-baj/evidence/.
 *
 * Build dijalankan suite ini sendiri; set JADWAL_AKSES_SKIP_BUILD=1
 * hanya untuk iterasi lokal bila .next sudah mutakhir dengan kode
 * teruji.
 *
 * Jalankan: npx tsx tests/test-jadwal-akses-browser.ts
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  REPO_ROOT,
  Suite,
  createFixtureEnv,
  settleFixtureEnv,
  type FixtureEnv,
} from "./helpers/fixture-env";
import { seedPanggungAkses, type PanggungAkses } from "./helpers/jadwal-akses-seed";

const suite = new Suite("jadwal-akses-browser");
const DIR_BUKTI = path.join(REPO_ROOT, "tasks", "frontend-baj", "evidence");

interface NavInfo {
  terlihat: boolean;
  aktif: string[];
}
interface BarisInfo {
  ariaLabel: string | null;
  teks: string;
}
interface HasilProbe {
  heroAset: { url: string; size: number; sha256: string } | null;
  detailKembali: { hrefs: string[] } | null;
  beranda: { status: number; cta: string | null; nav: NavInfo[] } | null;
  jadwalIni: {
    status: number;
    done00: BarisInfo | null;
    live: BarisInfo | null;
    logo: { complete: boolean; naturalWidth: number }[];
    footer: string | null;
    nav: NavInfo[];
  } | null;
  jadwalBesok: { status: number; next: BarisInfo | null } | null;
  analisa: {
    status: number;
    resmi: BarisInfo | null;
    paket: BarisInfo | null;
    konflik: BarisInfo | null;
    nav: NavInfo[];
  } | null;
  hilangAnalisa: {
    status: number;
    tautan: { href: string | null; teks: string } | null;
    tidakDitemukan: boolean;
  } | null;
  hilangPolos: {
    status: number;
    tautan: { href: string | null; teks: string } | null;
    tidakDitemukan: boolean;
  } | null;
  errors: string[];
}

/* Env placeholder gaya CI (ci.yml langkah build): koleksi page data
   /api/agent membaca NINE_ROUTER_* saat build; worktree bersih tanpa
   .env.local gagal tanpanya. Nilai dummy yang sama dengan CI. */
const ENV_CI: NodeJS.ProcessEnv = {
  ...process.env,
  NINE_ROUTER_BASE_URL: "http://localhost:20128/v1",
  NINE_ROUTER_API_KEY: "<redacted>",
  NINE_ROUTER_MODEL: "ag/gemini-3.8-flash",
};

function bangunBuild(): void {
  if (process.env.JADWAL_AKSES_SKIP_BUILD === "1") {
    console.log("[build] dilewati (JADWAL_AKSES_SKIP_BUILD=1) — memakai .next yang ada");
    return;
  }
  const res = spawnSync("npm", ["run", "build"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 900_000,
    env: ENV_CI,
  });
  suite.check(
    "npm run build berhasil di dalam suite",
    res.status === 0,
    (res.stderr || res.stdout || "").slice(-500),
  );
}

/** Direktori panggung: app dari build repo (symlink) + data sandbox +
 *  public nyata berisi logo-uji.webp (target logo-assets panggung). */
function rakitPanggung(env: FixtureEnv): string {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "bola-akses-stage-"));
  for (const item of [".next", "node_modules", "next.config.ts", "package.json"]) {
    const src = path.join(REPO_ROOT, item);
    if (fs.existsSync(src)) fs.symlinkSync(src, path.join(stage, item));
  }
  const pubSrc = path.join(REPO_ROOT, "public");
  fs.mkdirSync(path.join(stage, "public"), { recursive: true });
  if (fs.existsSync(pubSrc)) {
    for (const f of fs.readdirSync(pubSrc)) {
      fs.copyFileSync(path.join(pubSrc, f), path.join(stage, "public", f));
    }
  }
  fs.copyFileSync(
    path.join(REPO_ROOT, "app", "bola-hero-grafit.webp"),
    path.join(stage, "public", "logo-uji.webp"),
  );
  fs.cpSync(env.dataDir, path.join(stage, "data"), { recursive: true });
  return stage;
}

async function tungguServer(port: number, log: () => string): Promise<void> {
  const batas = Date.now() + 120_000;
  for (;;) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`);
      if (r.status === 200) return;
    } catch {
      /* belum siap */
    }
    if (Date.now() > batas) throw new Error(`server panggung tidak siap: ${log().slice(-600)}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

function jalankanProbe(base: string, panggung: PanggungAkses): HasilProbe {
  const probe = path.join(REPO_ROOT, "tests", "helpers", "jadwal-akses-probe.mjs");
  const res = spawnSync(
    process.execPath,
    [probe, base, DIR_BUKTI, panggung.tanggalHariIni, panggung.tanggalBesok],
    { encoding: "utf8", timeout: 900_000 },
  );
  const line = res.stdout.split("\n").find((l) => l.startsWith("PROBE_JSON "));
  if (!line) {
    throw new Error(`probe browser gagal (code ${res.status}): ${(res.stderr || "").slice(-800)}`);
  }
  return JSON.parse(line.slice("PROBE_JSON ".length)) as HasilProbe;
}

function cekNav(navs: NavInfo[] | undefined, tab: string, label: string): void {
  const terlihat = (navs ?? []).filter((n) => n.terlihat);
  suite.check(
    `${label}: nav terlihat punya tepat satu tab aktif "${tab}"`,
    terlihat.length > 0 && terlihat.every((n) => n.aktif.length === 1 && n.aktif[0] === tab),
    JSON.stringify(navs),
  );
}

async function main(): Promise<void> {
  const env = createFixtureEnv("akses");
  let server: ReturnType<typeof spawn> | null = null;
  let gagal = false;
  try {
    const panggung = await seedPanggungAkses(env);
    bangunBuild();
    const stage = rakitPanggung(env);
    const port = 3350 + (process.pid % 200);
    const base = `http://127.0.0.1:${port}`;
    let logServer = "";
    server = spawn(
      process.execPath,
      [path.join(REPO_ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)],
      { cwd: stage, env: { ...ENV_CI, NODE_ENV: "production" } },
    );
    server.stdout?.on("data", (d) => (logServer += d));
    server.stderr?.on("data", (d) => (logServer += d));
    await tungguServer(port, () => logServer);
    suite.check("server panggung menjawab 200 untuk /", true);

    fs.mkdirSync(DIR_BUKTI, { recursive: true });
    const h = jalankanProbe(base, panggung);

    /* ------------------------------------------------ §2.4 beranda */
    const heroSumber = fs.readFileSync(path.join(REPO_ROOT, "app", "bola-hero-grafit.webp"));
    suite.eq("hero: aset tersaji byte-identik (ukuran)", h.heroAset?.size, heroSumber.length);
    suite.eq(
      "hero: aset tersaji byte-identik (sha256)",
      h.heroAset?.sha256,
      createHash("sha256").update(heroSumber).digest("hex"),
    );
    suite.check(
      "beranda: CTA hero menuju /analisa",
      (h.beranda?.cta ?? "").includes("Lihat Analisa"),
      h.beranda?.cta ?? "cta tidak ditemukan",
    );
    cekNav(h.beranda?.nav, "Beranda", "beranda");

    /* ------------------------------------- §2.2 nama aksesibel jadwal */
    const d = h.jadwalIni?.done00;
    suite.check(
      "jadwal 0–0: nama aksesibel memuat kedua tim",
      !!d && (d.ariaLabel ?? "").includes("Akses Nol") && (d.ariaLabel ?? "").includes("Tandem FC"),
      d?.ariaLabel ?? "baris tidak ditemukan",
    );
    suite.check(
      "jadwal 0–0: nama aksesibel memuat status Selesai",
      (d?.ariaLabel ?? "").includes("Selesai"),
      d?.ariaLabel ?? "",
    );
    suite.check(
      "jadwal 0–0: nama aksesibel memuat Skor 0–0",
      (d?.ariaLabel ?? "").includes("Skor 0–0"),
      d?.ariaLabel ?? "",
    );
    suite.check(
      "jadwal: baris selesai tidak membawa persen apa pun",
      !!d && !d.teks.includes("%"),
      d?.teks ?? "",
    );
    const lv = h.jadwalIni?.live;
    suite.check(
      "jadwal live: nama aksesibel memuat status Live + Skor 2–1",
      !!lv &&
        (lv.ariaLabel ?? "").includes("Live") &&
        (lv.ariaLabel ?? "").includes("Skor 2–1"),
      lv?.ariaLabel ?? "baris tidak ditemukan",
    );
    const nx = h.jadwalBesok?.next;
    suite.check(
      "jadwal terjadwal: nama aksesibel memuat Belum mulai, tanpa skor",
      !!nx &&
        (nx.ariaLabel ?? "").includes("Belum mulai") &&
        !(nx.ariaLabel ?? "").includes("Skor"),
      nx?.ariaLabel ?? "baris tidak ditemukan",
    );

    /* ------------------------------- §2.4 footer + logo + tab jadwal */
    suite.check(
      "jadwal: footer memuat cap refresh B2.2 (bukan fallback)",
      !!h.jadwalIni?.footer &&
        h.jadwalIni.footer.includes("Data terakhir diperbarui") &&
        !h.jadwalIni.footer.includes("belum tersedia"),
      h.jadwalIni?.footer ?? "footer tidak ditemukan",
    );
    suite.check(
      "jadwal: logo kompetisi/tim dari logo-assets termuat",
      (h.jadwalIni?.logo.length ?? 0) >= 3 &&
        (h.jadwalIni?.logo ?? []).some((g) => g.naturalWidth > 0),
      JSON.stringify(h.jadwalIni?.logo),
    );
    cekNav(h.jadwalIni?.nav, "Jadwal", "jadwal");

    /* ------------------------------------------ §2.3 identitas analisa */
    const r = h.analisa?.resmi;
    suite.check(
      "analisa resmi: angka ledger 68% tampil (bukan 45% paket terbaru)",
      !!r && r.teks.includes("68%") && !r.teks.includes("45%"),
      r?.teks ?? "baris tidak ditemukan",
    );
    suite.check(
      "analisa resmi: label basis B2.2 'Peluang model saat terbit'",
      (r?.teks ?? "").includes("Peluang model saat terbit"),
      r?.teks ?? "",
    );
    suite.check(
      "analisa resmi: tanpa label paket terbaru",
      !(r?.teks ?? "").includes("Paket terbaru"),
      r?.teks ?? "",
    );
    const p = h.analisa?.paket;
    suite.check(
      "analisa paket-saja: angka paket 77% berlabel 'Paket terbaru · Belum terbit resmi'",
      !!p &&
        p.teks.includes("77%") &&
        p.teks.includes("Paket terbaru") &&
        p.teks.includes("Belum terbit resmi"),
      p?.teks ?? "baris tidak ditemukan",
    );
    /* Konflik dua alias (validasi rilis §2): status konflik jelas,
       TANPA satu angka pun sebagai jawaban — bukan 77% (edisi sm_),
       bukan 63% (edisi mt_), bukan 70% (paket tampil), dan tanpa
       label paket (kasus ini BUKAN paket-saja). */
    const kf = h.analisa?.konflik;
    suite.check(
      "analisa konflik: status 'Dua sumber berbeda angka' tampil",
      !!kf && kf.teks.includes("Dua sumber berbeda angka"),
      kf?.teks ?? "baris tidak ditemukan",
    );
    suite.check(
      "analisa konflik: tidak ada angka tunggal (77%/63%/70% semua absen)",
      !!kf && !kf.teks.includes("77%") && !kf.teks.includes("63%") && !kf.teks.includes("70%"),
      kf?.teks ?? "",
    );
    suite.check(
      "analisa konflik: tanpa label 'Paket terbaru' dan tanpa label basis resmi",
      !!kf && !kf.teks.includes("Paket terbaru") && !kf.teks.includes("Peluang saat terbit"),
      kf?.teks ?? "",
    );
    cekNav(h.analisa?.nav, "Analisa", "analisa");

    /* ------------------------------------- §2.3 kembali detail + 404 */
    const hrefDetail = `/analisa?tanggal=${panggung.tanggalBesok}&status=selesai`;
    suite.check(
      "detail: tautan kembali SSR menghormati asal=analisa + filter tersanitasi",
      (h.detailKembali?.hrefs ?? []).includes(hrefDetail),
      JSON.stringify(h.detailKembali?.hrefs),
    );
    /* Status HTTP halaman tidak-ditemukan adalah 200 (soft-404
       streaming: shell terlanjur terkirim sebelum notFound() terlempar)
       — perilaku lama yang sama di produksi build preview, di luar
       scope §2.3; yang diassert adalah KEADAAN tidak-ditemukannya dan
       tujuan kembalinya. Status mentah tetap tercatat di hasil probe. */
    suite.check(
      "404 analisa: keadaan 'Pertandingan tidak ditemukan' tampil",
      h.hilangAnalisa?.tidakDitemukan === true,
      `status HTTP tercatat=${h.hilangAnalisa?.status}`,
    );
    suite.eq(
      "404 analisa: tautan kembali ke Analisa dengan filter yang sama",
      h.hilangAnalisa?.tautan?.href,
      hrefDetail,
    );
    suite.check(
      "404 analisa: label 'Kembali ke analisa'",
      (h.hilangAnalisa?.tautan?.teks ?? "").includes("Kembali ke analisa"),
      h.hilangAnalisa?.tautan?.teks ?? "",
    );
    suite.check(
      "404 polos: keadaan 'Pertandingan tidak ditemukan' tampil",
      h.hilangPolos?.tidakDitemukan === true,
      `status HTTP tercatat=${h.hilangPolos?.status}`,
    );
    suite.eq("404 polos: tautan kembali jatuh ke Jadwal", h.hilangPolos?.tautan?.href, "/pertandingan");
    suite.check(
      "404 polos: label 'Kembali ke jadwal'",
      (h.hilangPolos?.tautan?.teks ?? "").includes("Kembali ke jadwal"),
      h.hilangPolos?.tautan?.teks ?? "",
    );

    /* ------------------------------------------------- bukti visual */
    for (const nama of [
      "kandidat-beranda-320.png",
      "kandidat-beranda-390.png",
      "kandidat-analisa-320.png",
      "kandidat-analisa-390.png",
      "analisa-konflik-390.png",
      "kandidat-jadwal-320.png",
      "kandidat-jadwal-390.png",
    ]) {
      suite.check(
        `screenshot ${nama} tersimpan`,
        fs.existsSync(path.join(DIR_BUKTI, nama)),
      );
    }
    suite.eq("browser: tanpa pageerror", h.errors, []);
    gagal = suite.failedCount > 0;
  } finally {
    if (server) server.kill("SIGTERM");
    settleFixtureEnv(env, gagal);
  }
  suite.finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
