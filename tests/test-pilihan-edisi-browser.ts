/**
 * LANJUT-1 — probe browser: gabungan /pilihan sadar edisi paket.
 *
 * Panggung: server `next start` dari build repo di atas data sandbox
 * Marseille yang sama dengan temuan #2 verifikasi produksi (registry
 * gabung + tautan builder repo + dua paket nyata + 16 pick beku;
 * sepak mula digeser ke masa depan relatif terhadap jam berjalan
 * supaya umpan pra-laga stabil kapan pun suite dijalankan — matriks
 * dan angka terbit tidak berubah).
 *
 * Alur pemilik dibekukan oleh tests/helpers/lanjut1-probe.mjs pada
 * lebar 378px: urutan A→B dan B→A untuk pasangan lintas edisi
 * (1x2 paket sm_ vs ou15 paket mt_) harus sama-sama berakhir
 * "Peluang gabungan belum tersedia" + alasan edisi berbeda, TANPA
 * satu pun permintaan matriks; pasangan satu edisi (mt_) tampil
 * ±89,2% dengan tepat satu permintaan matriks berisi satu id paket;
 * muat ulang memulihkan draf dengan hasil identik. Screenshot kedua
 * urutan pada build yang sama disimpan di
 * tasks/reports/lanjut-1-evidence/.
 *
 * Build dijalankan suite ini sendiri; set LANJUT1_SKIP_BUILD=1 hanya
 * untuk iterasi lokal bila .next sudah mutakhir dengan kode teruji.
 *
 * Jalankan: npx tsx tests/test-pilihan-edisi-browser.ts
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

const suite = new Suite("pilihan-edisi-browser");
let gagal = false;

const MT = "mt_022917440";
const SM = "sm_19715544";
const ALASAN_EDISI = "Dua pilihan ini berasal dari edisi prediksi yang berbeda";
const DIR_BUKTI = path.join(REPO_ROOT, "tasks", "reports", "lanjut-1-evidence");

interface RingkasApi {
  key: string;
  packageId: number | null;
  prob: number;
  konflik: boolean;
}
interface Fase {
  teks: string;
  req: string[];
}
interface HasilProbe {
  api: {
    status: number;
    totalLaga: number;
    menang: RingkasApi | null;
    ou15: RingkasApi | null;
    cetak: RingkasApi | null;
  };
  ab: Fase;
  ba: Fase;
  sama: Fase;
  pulih: { teks: string };
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
  if (process.env.LANJUT1_SKIP_BUILD === "1") {
    console.log("[build] dilewati (LANJUT1_SKIP_BUILD=1) — memakai .next yang ada");
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
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "bola-lanjut1-stage-"));
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
  const probe = path.join(REPO_ROOT, "tests", "helpers", "lanjut1-probe.mjs");
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
  const env = createFixtureEnv("lanjut1");
  let server: ReturnType<typeof spawn> | null = null;
  let stage = "";
  try {
    await siapkanSkema(env);
    seedRegistry(env, bacaFixture<unknown[]>("registry-tim-gabung.json"));
    // Sepak mula digeser +3 hari dari jam berjalan (matriks/angka
    // terbit tidak berubah) supaya umpan pra-laga stabil.
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
    const port = 3330 + (process.pid % 200);
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
      "prasyarat: 1x2 dan ou15 dari paket BERBEDA (lintas edisi, seperti produksi)",
      h.api.menang !== null &&
        h.api.ou15 !== null &&
        h.api.menang.packageId !== null &&
        h.api.ou15.packageId !== null &&
        h.api.menang.packageId !== h.api.ou15.packageId,
      JSON.stringify(h.api),
    );
    suite.check(
      "prasyarat: team_over05_home SATU paket dengan ou15 (edisi mt_)",
      h.api.cetak !== null &&
        h.api.ou15 !== null &&
        h.api.cetak.packageId !== null &&
        h.api.cetak.packageId === h.api.ou15.packageId,
      JSON.stringify(h.api),
    );
    suite.check(
      "prasyarat: ketiga pilihan tanpa konflik",
      [h.api.menang, h.api.ou15, h.api.cetak].every((p) => p !== null && !p.konflik),
    );

    /* ------------------------------------------- urutan A→B dan B→A */
    for (const [label, fase] of [["A→B", h.ab], ["B→A", h.ba]] as const) {
      suite.check(
        `${label}: panel menyatakan gabungan belum tersedia`,
        fase.teks.includes("Peluang gabungan belum tersedia"),
        fase.teks.slice(0, 300),
      );
      suite.check(`${label}: alasan persis pemilik tampil`, fase.teks.includes(ALASAN_EDISI));
      suite.check(
        `${label}: kedua pilihan dipertahankan dengan angka masing-masing (62,9% + 85,5%)`,
        fase.teks.includes("2 pilihan dari 1 laga") &&
          fase.teks.includes("62,9%") &&
          fase.teks.includes("85,5%"),
      );
      suite.eq(`${label}: NOL permintaan matriks untuk grup beda paket`, fase.req.length, 0);
    }
    suite.check(
      "kedua urutan berakhir pada status gabungan yang sama",
      h.ab.teks.includes(ALASAN_EDISI) && h.ba.teks.includes(ALASAN_EDISI),
    );

    /* ---------------------------------------------- pasangan satu edisi */
    suite.check(
      "satu edisi: gabungan ±89,2% tampil dari matriks mentah",
      h.sama.teks.includes("89,2%"),
      h.sama.teks.slice(0, 300),
    );
    suite.check(
      "satu edisi: keterangan irisan persis dari matriks tampil",
      h.sama.teks.includes("digabung persis dari matriks skor"),
    );
    suite.eq("satu edisi: tepat SATU permintaan matriks", h.sama.req.length, 1);
    const idDiminta = (h.sama.req[0] ?? "").split("paket=")[1]?.split("&")[0] ?? "";
    suite.check(
      "satu edisi: permintaan berisi tepat SATU id paket (edisi bersama)",
      idDiminta.length > 0 && !idDiminta.includes(","),
      h.sama.req[0] ?? "",
    );
    suite.eq(
      "satu edisi: id yang diminta = paket ou15/team_over05_home",
      Number(idDiminta),
      h.api.ou15?.packageId ?? -1,
    );

    /* ------------------------------------------------------------ pulih */
    suite.check(
      "muat ulang: draf pulih dengan gabungan 89,2% yang IDENTIK",
      h.pulih.teks.includes("89,2%") && h.pulih.teks.includes("2 pilihan dari 1 laga"),
      h.pulih.teks.slice(0, 300),
    );
    suite.eq("tanpa pageerror di seluruh probe", h.errors.length, 0);

    /* ------------------------------------------------------------ bukti */
    for (const f of ["urutan-ab.png", "urutan-ba.png", "edisi-sama-892.png", "pulih-muat-ulang.png"]) {
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
