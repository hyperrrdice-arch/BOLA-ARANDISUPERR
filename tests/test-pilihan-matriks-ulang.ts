/**
 * LANJUT-2 — probe browser: permintaan matriks yang gagal bisa diulang.
 *
 * Panggung sama dengan lanjut-1 (server `next start` dari build repo
 * di atas data sandbox Marseille temuan #2: dua edisi paket, 16 pick
 * beku; sepak mula digeser ke masa depan relatif terhadap jam
 * berjalan). Alur pemilik §2 dibekukan oleh
 * tests/helpers/lanjut2-probe.mjs pada lebar 378px dengan intersepsi
 * permintaan:
 *  A. permintaan matriks pertama digagalkan → hapus + tambah ulang
 *     pilihan kedua memicu permintaan KEDUA dan gabungan ±89,2%
 *     tampil (kasus satu edisi paket 7815 versi sandbox);
 *  B. kegagalan berikutnya → tombol "Coba lagi" di panel gabungan
 *     memulihkan tanpa muat ulang;
 *  C. respons ditahan → hapus + tambah ulang selama in-flight tetap
 *     tepat SATU permintaan (deduplikasi);
 *  D. jawaban null (paket tanpa matriks) = keadaan kosong akhir:
 *     belum tersedia + alasan matriks combineSlip, tanpa tombol
 *     coba-lagi, dan interaksi ulang tidak menambah permintaan.
 *
 * Build dijalankan suite ini sendiri; set LANJUT2_SKIP_BUILD=1 hanya
 * untuk iterasi lokal bila .next sudah mutakhir dengan kode teruji.
 *
 * Jalankan: npx tsx tests/test-pilihan-matriks-ulang.ts
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
  seedPaketObjek,
  seedPicks,
  picksMarseille,
  type BarisKatalog,
} from "./helpers/redesain-seeds";

const suite = new Suite("pilihan-matriks-ulang");
let gagal = false;

const MT = "mt_022917440";
const SM = "sm_19715544";
const DIR_BUKTI = path.join(REPO_ROOT, "tasks", "reports", "lanjut-2-evidence");

interface RingkasApi {
  key: string;
  packageId: number | null;
  prob: number;
  konflik: boolean;
}
interface HasilProbe {
  api: {
    status: number;
    totalLaga: number;
    menang: RingkasApi | null;
    ou15: RingkasApi | null;
    cetak: RingkasApi | null;
  };
  a: {
    reqSesudahGagal: number;
    teksGagal: string;
    reqSesudahHapus: number;
    reqAkhir: number;
    teksPulih: string;
  };
  b: { reqSesudahGagal: number; tombolAda: boolean; reqAkhir: number; teks: string };
  c: { reqSelamaTerbang: number; teks: string };
  d: {
    reqSesudahNull: number;
    teks: string;
    tombolAda: boolean;
    reqSesudahInteraksi: number;
    teks2: string;
  };
  errors: string[];
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
  fs.writeFileSync(
    path.join(env.dataDir, "league-canonical.json"),
    JSON.stringify({ version: 1, leagues: [] }),
  );
}

function bangunBuild(): void {
  if (process.env.LANJUT2_SKIP_BUILD === "1") {
    console.log("[build] dilewati (LANJUT2_SKIP_BUILD=1) — memakai .next yang ada");
    return;
  }
  const res = spawnSync("npm", ["run", "build"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 900_000,
  });
  suite.check(
    "npm run build berhasil di dalam suite",
    res.status === 0,
    (res.stderr || res.stdout || "").slice(-500),
  );
}

/** Direktori panggung: app dari build repo (symlink) + data sandbox. */
function rakitPanggung(env: FixtureEnv): string {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "bola-lanjut2-stage-"));
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
      const r = await fetch(`http://127.0.0.1:${port}/pilihan`);
      if (r.status === 200) return;
    } catch {
      /* belum siap */
    }
    if (Date.now() > batas) throw new Error(`server panggung tidak siap: ${log().slice(-600)}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

function jalankanProbe(base: string): HasilProbe {
  const probe = path.join(REPO_ROOT, "tests", "helpers", "lanjut2-probe.mjs");
  const res = spawnSync(process.execPath, [probe, base, DIR_BUKTI], {
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
  const env = createFixtureEnv("lanjut2");
  let server: ReturnType<typeof spawn> | null = null;
  let stage = "";
  try {
    await siapkanSkema(env);
    seedRegistry(env, bacaFixture<unknown[]>("registry-tim-gabung.json"));
    const koDate = new Date(Date.now() + 3 * 86_400_000);
    koDate.setUTCHours(19, 45, 0, 0);
    const KO = koDate.toISOString();
    const kasus = bacaFixture<BarisKatalog[]>("katalog-kasus.json");
    seedKatalog(
      env,
      kasus
        .filter((r) => [SM, MT].includes(r.match_id))
        .map((r) => ({ ...r, utc_date: KO })),
    );
    const run = runScript(env, "scripts/build-fixture-links.ts");
    suite.check("builder fixture-links berjalan", run.code === 0, run.stderr.slice(-300));
    const muatPayload = (nama: string): Record<string, unknown> => {
      const berkas = bacaFixture<{ payload?: unknown }>(nama);
      const payload = (berkas.payload ?? berkas) as Record<string, unknown>;
      const fixture = payload.fixture as Record<string, unknown>;
      fixture.kickoff_utc = KO;
      return payload;
    };
    const pkgIds = seedPaketObjek(env, [
      muatPayload("paket-sm_19715544.json"),
      muatPayload("paket-mt_022917440.json"),
    ]);
    seedPicks(env, picksMarseille(pkgIds).map((p) => ({ ...p, kickoff_utc: KO })));

    bangunBuild();
    stage = rakitPanggung(env);
    const port = 3530 + (process.pid % 200);
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
    suite.check("server panggung menjawab 200 untuk /pilihan", true);

    fs.mkdirSync(DIR_BUKTI, { recursive: true });
    const h = jalankanProbe(base);

    /* ------------------------------------------------ prasyarat umpan */
    suite.eq("API umpan: status 200", h.api.status, 200);
    suite.eq("API umpan: Marseille = 1 laga fisik", h.api.totalLaga, 1);
    suite.check(
      "prasyarat: team_over05_home SATU paket dengan ou15 (edisi mt_, kasus 7815)",
      h.api.cetak !== null &&
        h.api.ou15 !== null &&
        h.api.cetak.packageId !== null &&
        h.api.cetak.packageId === h.api.ou15.packageId,
      JSON.stringify(h.api),
    );

    /* --------------------------- A: gagal → hapus + tambah ulang pulih */
    suite.eq("A: tepat 1 permintaan terkirim sebelum digagalkan", h.a.reqSesudahGagal, 1);
    suite.check(
      "A: sesudah gagal, panel belum tersedia (tanpa angka gabungan)",
      h.a.teksGagal.includes("Peluang gabungan belum tersedia") &&
        !h.a.teksGagal.includes("89,2%"),
      h.a.teksGagal.slice(0, 300),
    );
    suite.eq("A: menghapus pilihan tidak memicu permintaan baru", h.a.reqSesudahHapus, 1);
    suite.eq(
      "A: tambah ulang memicu permintaan KEDUA (penanda gagal dilepas)",
      h.a.reqAkhir,
      2,
    );
    suite.check(
      "A: gabungan ±89,2% tampil sesudah permintaan kedua — tanpa muat ulang",
      h.a.teksPulih.includes("89,2%") && h.a.teksPulih.includes("2 pilihan dari 1 laga"),
      h.a.teksPulih.slice(0, 300),
    );

    /* --------------------------------- B: tombol "Coba lagi" memulihkan */
    suite.eq("B: permintaan fase ini juga tepat 1 sebelum gagal", h.b.reqSesudahGagal, 1);
    suite.check(
      "B: tombol “Coba lagi” tampil di panel gabungan saat keadaan gagal",
      h.b.tombolAda,
    );
    suite.eq("B: klik Coba lagi mengirim tepat 1 permintaan baru", h.b.reqAkhir, 2);
    suite.check(
      "B: gabungan ±89,2% tampil sesudah Coba lagi — tanpa muat ulang",
      h.b.teks.includes("89,2%"),
      h.b.teks.slice(0, 300),
    );

    /* -------------------------------- C: dedupe selama permintaan terbang */
    suite.eq(
      "C: hapus + tambah ulang selama in-flight = tetap tepat 1 permintaan",
      h.c.reqSelamaTerbang,
      1,
    );
    suite.check(
      "C: gabungan ±89,2% tampil sesudah respons yang ditahan tiba",
      h.c.teks.includes("89,2%"),
      h.c.teks.slice(0, 300),
    );

    /* --------------------------- D: null = kosong, keadaan akhir, tak diulang */
    suite.eq("D: tepat 1 permintaan untuk jawaban null", h.d.reqSesudahNull, 1);
    suite.check(
      "D: panel belum tersedia dengan alasan matriks combineSlip",
      h.d.teks.includes("Peluang gabungan belum tersedia") &&
        h.d.teks.includes("matriks skor tidak tersedia untuk irisan satu laga"),
      h.d.teks.slice(0, 300),
    );
    suite.check(
      "D: TANPA tombol “Coba lagi” untuk keadaan kosong (bukan kegagalan)",
      !h.d.tombolAda,
    );
    suite.eq(
      "D: hapus + tambah ulang TIDAK memicu permintaan baru (kosong = akhir)",
      h.d.reqSesudahInteraksi,
      1,
    );
    suite.check(
      "D: panel tetap belum tersedia sesudah interaksi ulang",
      h.d.teks2.includes("Peluang gabungan belum tersedia") && !h.d.teks2.includes("89,2%"),
      h.d.teks2.slice(0, 300),
    );

    /* ------------------------------------------------------------ bukti */
    suite.eq("tanpa pageerror di seluruh probe", h.errors.length, 0);
    for (const f of ["gagal-awal.png", "pulih-tambah-ulang.png", "coba-lagi.png", "null-kosong.png"]) {
      suite.check(`bukti tersimpan: ${f}`, fs.existsSync(path.join(DIR_BUKTI, f)));
    }
  } catch (e) {
    gagal = true;
    suite.check("panggung berjalan", false, e instanceof Error ? e.message : String(e));
  } finally {
    if (server) server.kill("SIGTERM");
    if (stage) fs.rmSync(stage, { recursive: true, force: true });
    settleFixtureEnv(env, gagal || suite.failedCount > 0);
  }
  suite.finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
