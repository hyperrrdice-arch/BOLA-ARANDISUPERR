/**
 * VERIFIKASI PRODUKSI — TEMUAN #4 (branch fix/verifikasi-produksi).
 *
 * Pemilik membuktikan di produksi (21 Nov 2026): URL detail Marseille
 * (/pertandingan/mt_022917440) pada Chromium dengan JavaScript
 * DIMATIKAN mengembalikan HTTP 200, tetapi isi utama yang TERLIHAT
 * hanya fallback "Memuat analisis laga…" — nama tim, kickoff,
 * ringkasan prediksi, dan tabel skor 2D tidak terbaca, padahal
 * potongannya ada di HTML mentah (tersembunyi di segmen streaming
 * yang hanya bisa ditukar masuk oleh skrip). Dengan JS aktif semua
 * tampil.
 *
 * Akarnya: halaman membungkus SELURUH isi di satu batas <Suspense>
 * yang isinya menangguhkan (params/searchParams/connection()) —
 * di bawah cacheComponents, isi itu lahir sebagai lubang dinamis:
 * shell membawa fallback, isi dikirim belakangan di segmen
 * tersembunyi + skrip penukar. Tanpa skrip, penukaran tidak pernah
 * terjadi dan pembaca hanya melihat fallback selamanya.
 *
 * Suite ini membekukan CARA UJI PEMILIK, bukan pendekatan string:
 * server `next start` dari build repo di atas data sandbox Marseille
 * yang sama dengan temuan #2, lalu Chromium sungguhan:
 * - JS MATI → teks yang dinilai adalah simpul teks yang punya kotak
 *   layout (DOMSnapshot) sesudah respons selesai — segmen `hidden`
 *   tidak terhitung terlihat;
 * - JS AKTIF → innerText + transisi canvas 0→1→0 saat memilih 3D
 *   dan kembali, nol permintaan chunk 3D sebelum dipilih (§9), dan
 *   konsistensi temuan #2 ("9 pilihan resmi", "Dua sumber berbeda
 *   angka") tetap utuh di permukaan ter-render.
 *
 * Build dijalankan suite ini sendiri (uji ini menilai keluaran
 * build); set VERIFIKASI4_SKIP_BUILD=1 hanya untuk iterasi lokal
 * bila .next sudah mutakhir dengan kode yang diuji.
 *
 * Jalankan: npx tsx tests/test-verifikasi-detail-ssr.ts
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  createFixtureEnv,
  buildCoreSchemas,
  runScript,
  settleFixtureEnv,
  Suite,
  REPO_ROOT,
  type FixtureEnv,
} from "./helpers/fixture-env";
import {
  bacaFixture,
  seedKatalog,
  seedRegistry,
  seedPaket,
  seedPicks,
  picksMarseille,
  type BarisKatalog,
} from "./helpers/redesain-seeds";

const suite = new Suite("verifikasi-detail-ssr");
let gagal = false;

const MT = "mt_022917440";
const SM = "sm_19715544";
const FALLBACK = "Memuat analisis laga…";

interface HasilJsMati {
  status: number | null;
  teks: string;
  fallbackTerlihat: boolean;
}
interface HasilProbe {
  jsMati: Record<string, HasilJsMati>;
  jsAktif: {
    status: number | null;
    teks: string;
    canvasAwal: number;
    canvas3d: number;
    canvasAkhir: number;
    pesanGlGagal: boolean;
    reqTigaSebelum: string[];
    reqBaruSesudah3d: string[];
    errors: string[];
  };
}

/* ------------------------------------------------------------ penyiapan */

async function siapkanSkema(env: FixtureEnv): Promise<void> {
  process.chdir(env.root);
  const { ledger } = await buildCoreSchemas();
  const publication = await import("../lib/picks/publication");
  const tickets = await import("../lib/picks/tickets");
  publication.ensurePublicationSchema(ledger.getPicksDb());
  tickets.ensureTicketSchema(ledger.getPicksDb());
  const identity = await import("../lib/identity/fixture-resolver");
  const ds = new DatabaseSync(path.join(env.dataDir, "thestats_dataset.db"));
  identity.ensureIdentitySchema(ds);
  ds.exec(
    `CREATE TABLE IF NOT EXISTS team_match_logs_canonical (
       log_id INTEGER, match_id TEXT, team_id TEXT, opponent_id TEXT,
       venue TEXT, match_date TEXT, season TEXT, result TEXT,
       goals_for INTEGER, goals_against INTEGER,
       xg_for REAL, xg_against REAL,
       canonical_team_id TEXT, canonical_opponent_id TEXT,
       canonical_match_key TEXT
     )`,
  );
  ds.close();
  fs.writeFileSync(path.join(env.dataDir, "fixture-links.json"), JSON.stringify({ links: [] }));
}

function bangunBuild(): void {
  if (process.env.VERIFIKASI4_SKIP_BUILD === "1") {
    console.log("[build] dilewati (VERIFIKASI4_SKIP_BUILD=1) — memakai .next yang ada");
    return;
  }
  const res = spawnSync("npm", ["run", "build"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 900_000,
  });
  suite.check("npm run build berhasil di dalam suite", res.status === 0,
    (res.stderr || res.stdout || "").slice(-500));
}

/** Direktori panggung: app dari build repo (symlink) + data sandbox. */
function rakitPanggung(env: FixtureEnv): string {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "bola-v4-stage-"));
  for (const item of [".next", "node_modules", "next.config.ts", "package.json", "public"]) {
    const src = path.join(REPO_ROOT, item);
    if (fs.existsSync(src)) fs.symlinkSync(src, path.join(stage, item));
  }
  fs.cpSync(env.dataDir, path.join(stage, "data"), { recursive: true });
  return stage;
}

async function tungguServer(port: number, log: () => string): Promise<void> {
  const batas = Date.now() + 120_000;
  for (;;) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/pertandingan/${MT}`);
      if (r.status === 200) return;
    } catch {
      /* belum siap */
    }
    if (Date.now() > batas) throw new Error(`server panggung tidak siap: ${log().slice(-600)}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

function jalankanProbe(base: string, outDir: string): HasilProbe {
  const probe = path.join(REPO_ROOT, "tests", "helpers", "verifikasi4-probe.mjs");
  const res = spawnSync(process.execPath, [probe, base, outDir], {
    encoding: "utf8",
    timeout: 600_000,
  });
  const line = res.stdout.split("\n").find((l) => l.startsWith("PROBE_JSON "));
  if (!line) {
    throw new Error(`probe browser gagal (code ${res.status}): ${(res.stderr || "").slice(-800)}`);
  }
  return JSON.parse(line.slice("PROBE_JSON ".length)) as HasilProbe;
}

/* ----------------------------------------------------------------- main */

async function main(): Promise<void> {
  const env = createFixtureEnv("verifikasi4");
  let server: ReturnType<typeof spawn> | null = null;
  let stage = "";
  try {
    await siapkanSkema(env);
    // Data yang sama persis dengan temuan #2 (registry gabung + tautan
    // dari builder repo + dua paket + 16 pick beku).
    seedRegistry(env, bacaFixture<unknown[]>("registry-tim-gabung.json"));
    const kasus = bacaFixture<BarisKatalog[]>("katalog-kasus.json");
    seedKatalog(env, kasus.filter((r) => [SM, MT].includes(r.match_id)));
    const run = runScript(env, "scripts/build-fixture-links.ts");
    suite.check("builder fixture-links berjalan", run.code === 0, run.stderr.slice(-300));
    const pkgIds = seedPaket(env, ["paket-sm_19715544.json", "paket-mt_022917440.json"]);
    seedPicks(env, picksMarseille(pkgIds));

    /* Ekspektasi diturunkan dari fixture beku + formatter repo. */
    const berkasPaket = bacaFixture<{ payload?: unknown }>("paket-mt_022917440.json");
    const payload = (berkasPaket.payload ?? berkasPaket) as {
      fixture: { home: string; away: string; kickoff_utc: string };
      score_matrix: number[][];
    };
    const { home, away, kickoff_utc: kickoff } = payload.fixture;
    const { tanggalJamWib } = await import("../lib/web/format");
    const { adaptasiMatriks, ringkasMatriks, formatPeluangSel } = await import(
      "../lib/web/peta-skor"
    );
    const labelKickoff = tanggalJamWib(kickoff);
    const peta = adaptasiMatriks(payload.score_matrix);
    if (!peta) throw new Error("matriks fixture tidak lolos adaptasi §9");
    const top = ringkasMatriks(peta.matrix).top[0];
    if (!top) throw new Error("matriks fixture tidak punya skor teratas");
    const labelTop = `${top.h}–${top.a}`;
    const labelTopPeluang = formatPeluangSel(top.p);

    bangunBuild();
    stage = rakitPanggung(env);
    const port = 3230 + (process.pid % 200);
    const base = `http://127.0.0.1:${port}`;
    let logServer = "";
    server = spawn(
      process.execPath,
      [path.join(REPO_ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)],
      { cwd: stage, env: { ...process.env, NODE_ENV: "production" } },
    );
    server.stdout?.on("data", (d) => (logServer += d));
    server.stderr?.on("data", (d) => (logServer += d));
    await tungguServer(port, () => logServer);
    suite.check("server panggung menjawab 200 untuk detail Marseille", true);

    const outDir = path.join(env.root, "probe-out");
    const hasil = jalankanProbe(base, outDir);

    /* ---------------------------------------------------- JS MATI */
    for (const id of [MT, SM]) {
      const h = hasil.jsMati[id];
      const awalan = `JS mati ${id}:`;
      suite.eq(`${awalan} HTTP 200`, h?.status, 200);
      suite.check(`${awalan} fallback TIDAK terlihat sesudah respons selesai`,
        h?.fallbackTerlihat === false, `teks terlihat: ${(h?.teks ?? "").slice(0, 200)}`);
      suite.check(`${awalan} nama tim terbaca (${home} vs ${away})`,
        (h?.teks ?? "").includes(home) && (h?.teks ?? "").includes(away));
      suite.check(`${awalan} kickoff terbaca (${labelKickoff})`,
        (h?.teks ?? "").includes(labelKickoff));
      suite.check(`${awalan} ringkasan prediksi terbaca (Prediksi sebelum laga)`,
        (h?.teks ?? "").includes("Prediksi sebelum laga"));
      suite.check(`${awalan} hitungan kejadian unik terbaca (9 pilihan resmi)`,
        (h?.teks ?? "").includes("9 pilihan resmi"));
      suite.check(`${awalan} label konflik temuan #2 terbaca (Dua sumber berbeda angka)`,
        (h?.teks ?? "").includes("Dua sumber berbeda angka"));
      suite.check(`${awalan} angka terbit OU1.5 terbaca (85,5%)`,
        (h?.teks ?? "").includes("85,5%"));
      suite.check(`${awalan} bagian peta terbaca (Kemungkinan skor)`,
        (h?.teks ?? "").includes("Kemungkinan skor"));
      suite.check(`${awalan} keterangan tabel 2D terbaca (Baris: gol ${home})`,
        (h?.teks ?? "").includes(`Baris: gol ${home}`));
      suite.check(`${awalan} cakupan peta terbaca (Peta menampilkan skor 0–4)`,
        (h?.teks ?? "").includes("Peta menampilkan skor 0–4"));
      suite.check(`${awalan} skor teratas 2D terbaca (${labelTop} · ${labelTopPeluang})`,
        (h?.teks ?? "").includes(labelTop) && (h?.teks ?? "").includes(labelTopPeluang));
    }

    /* --------------------------------------------------- JS AKTIF */
    const a = hasil.jsAktif;
    suite.eq("JS aktif: HTTP 200", a.status, 200);
    suite.check("JS aktif: 9 pilihan resmi tetap tampil (konsistensi #2)",
      a.teks.includes("9 pilihan resmi"));
    suite.check("JS aktif: label konflik tetap tampil (konsistensi #2)",
      a.teks.includes("Dua sumber berbeda angka"));
    suite.check("JS aktif: tabel 2D tampil sejak awal (Kemungkinan skor)",
      a.teks.includes("Kemungkinan skor"));
    suite.eq("JS aktif: canvas 0 sebelum 3D dipilih", a.canvasAwal, 0);
    suite.eq("JS aktif: nol permintaan chunk 3D sebelum dipilih (§9)",
      a.reqTigaSebelum.length, 0);
    suite.eq("JS aktif: canvas 0→1 sesudah memilih 3D (chunk lazy termuat)",
      a.canvas3d, 1);
    suite.check("JS aktif: memilih 3D memicu permintaan chunk baru",
      a.reqBaruSesudah3d.length > 0, JSON.stringify(a.reqBaruSesudah3d));
    suite.eq("JS aktif: canvas kembali 0 sesudah kembali ke 2D", a.canvasAkhir, 0);
    suite.eq("JS aktif: tanpa pageerror", a.errors.length, 0);

    /* ------------------------------------------- penjaga sumber */
    const sumberHalaman = fs.readFileSync(
      path.join(REPO_ROOT, "app", "(terminal)", "pertandingan", "[matchId]", "page.tsx"),
      "utf8",
    );
    suite.check("penjaga sumber: fallback 'Memuat analisis laga…' tidak lagi membungkus isi",
      !sumberHalaman.includes(FALLBACK));
  } catch (e) {
    gagal = true;
    console.error(e);
    suite.check("suite berjalan tanpa pengecualian", false, String(e).slice(0, 400));
  } finally {
    if (server) {
      server.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 500));
      server.kill("SIGKILL");
    }
    if (stage) fs.rmSync(stage, { recursive: true, force: true });
    settleFixtureEnv(env, gagal || suite.failedCount > 0);
  }
  suite.finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
