/**
 * REPRODUKSI BRIEF REDESAIN — LANGKAH 1 (branch redesain/bola).
 *
 * Membuktikan keadaan SEKARANG (basis ef9b67c, fix/review-k8) untuk
 * empat kasus §8.1 brief, lewat jalur nyata pada data sandbox
 * terisolasi. Fixture data NYATA diekstrak read-only dari DB checkout
 * utama ke tests/fixtures/redesain-repro/ (nilai tidak diubah).
 *
 * Suite ini MENDOKUMENTASIKAN perilaku terukur apa adanya — termasuk
 * yang masih salah (Kasus 1, 3, dan penyajian Kasus 4). Assertion di
 * sini mengunci FAKTA hasil pengukuran; langkah 2 brief yang akan
 * mengubah perilaku dan memperbarui suite ini. Jangan dirantai ke
 * test:web — jalankan eksplisit: npx tsx tests/test-redesain-repro.ts
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  createFixtureEnv,
  buildCoreSchemas,
  runScript,
  settleFixtureEnv,
  Suite,
  type FixtureEnv,
} from "./helpers/fixture-env";
import {
  bacaFixture,
  seedKatalog,
  seedRegistry,
  seedPaket,
  seedPaketObjek,
  seedPicks,
  picksMarseille,
  picksArsip19Nov,
  paketArsip,
  type BarisKatalog,
} from "./helpers/redesain-seeds";

const suite = new Suite("redesain-repro");
let gagal = false;

function runProbe<T>(env: FixtureEnv, aksi: string): T {
  const res = runScript(env, "tests/helpers/redesain-probe.ts", [aksi]);
  const line = res.stdout.split("\n").find((l) => l.startsWith("PROBE_JSON "));
  if (!line) {
    throw new Error(`probe ${aksi} gagal (code ${res.code}): ${res.stderr.slice(-800)}`);
  }
  return JSON.parse(line.slice("PROBE_JSON ".length)) as T;
}

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
  ds.close();
  fs.writeFileSync(path.join(env.dataDir, "fixture-links.json"), JSON.stringify({ links: [] }));
}

const bulat4 = (x: number) => Math.round(x * 10_000) / 10_000;

/* ================================================= KASUS 1 — MARSEILLE */

interface ProbeMarseille {
  totalPicks: number;
  perMatch: Record<string, number>;
  fixtureKeys: string[];
  ou15: { match_id: string; prob: number; kunci: string }[];
  btts: { match_id: string; prob: number }[];
  gabungOu15: { kelompok: number; gabungan: number };
  uids: Record<string, string | null>;
}

async function kasus1(): Promise<void> {
  console.log("\n== Kasus 1 — alias Marseille (sm_19715544 × mt_022917440) ==");
  const env = createFixtureEnv("rdmarseille");
  try {
    await siapkanSkema(env);
    seedRegistry(env, bacaFixture<unknown[]>("registry-tim.json"));
    const kasus = bacaFixture<BarisKatalog[]>("katalog-kasus.json");
    const pembanding = bacaFixture<BarisKatalog[]>("katalog-pembanding.json");
    const marseille = kasus.filter((r) =>
      ["sm_19715544", "mt_022917440"].includes(r.match_id),
    );
    // Pasangan kontrol sintetis: dua baris katalog, tim KANONIK sama
    // (Le Mans sm:7758 + Toulouse FC sm:289 lewat kedua sistem id) —
    // membuktikan mesin tautan bekerja bila registry tidak terbelah.
    const dasar = marseille[0];
    const kontrol: BarisKatalog[] = [
      {
        ...dasar, match_id: "sm_900001", competition_id: "sm:301",
        utc_date: "2026-11-25T20:00:00.000Z",
        home_team_id: "7758", home_team_name: "Le Mans",
        away_team_id: "289", away_team_name: "Toulouse FC",
      },
      {
        ...dasar, match_id: "mt_900001", competition_id: "comp_0256",
        utc_date: "2026-11-25T20:00:00.000Z",
        home_team_id: "tm_97723", home_team_name: "Le Mans",
        away_team_id: "tm_25581", away_team_name: "Toulouse",
      },
    ];
    seedKatalog(env, [...marseille, ...pembanding, ...kontrol]);

    const run = runScript(env, "scripts/build-fixture-links.ts");
    suite.check("K1 builder fixture-links berjalan", run.code === 0, run.stderr.slice(-300));
    const linksFile = JSON.parse(
      fs.readFileSync(path.join(env.dataDir, "fixture-links.json"), "utf8"),
    ) as { links: { twin_id: string; canonical_id: string }[]; stats: { duplicate_groups: number } };
    const twinDari = (id: string) => linksFile.links.find((l) => l.twin_id === id);
    suite.check(
      "K1 mt_022917440 TIDAK tertaut ke sm_19715544 (defek ter-reproduksi)",
      twinDari("mt_022917440") === undefined,
    );
    suite.check(
      "K1 pasangan Toulouse mt_377265875 juga tidak tertaut (defek sistemik utk klub ini)",
      twinDari("mt_377265875") === undefined,
    );
    suite.eq(
      "K1 pasangan kontrol TERAUT (mesin sehat bila registry menyatu)",
      twinDari("mt_900001")?.canonical_id,
      "sm_900001",
    );
    suite.eq("K1 grup kembar terdeteksi hanya kontrol", linksFile.stats.duplicate_groups, 1);

    const pkgIds = seedPaket(env, ["paket-sm_19715544.json", "paket-mt_022917440.json"]);
    seedPicks(env, picksMarseille(pkgIds));

    const p = runProbe<ProbeMarseille>(env, "marseille");
    suite.eq("K1 daftar pra-laga memuat 16 pilihan (8 per alias)", p.totalPicks, 16);
    suite.eq("K1 per alias 8 pilihan", [p.perMatch["sm_19715544"], p.perMatch["mt_022917440"]], [8, 8]);
    suite.eq(
      "K1 kunci laga jatuh ke match_id masing-masing (fixture_uid ledger NULL)",
      [...p.fixtureKeys].sort(),
      ["mt_022917440", "sm_19715544"],
    );
    suite.eq("K1 'Minimal dua gol' muncul DUA kali @85,5%", p.ou15.map((o) => bulat4(o.prob)), [0.8553, 0.8553]);
    suite.eq("K1 gabungan builder = 2 kelompok (laga)", p.gabungOu15.kelompok, 2);
    suite.check(
      "K1 gabungan 0,8553² = 73,2% (klaim brief ter-reproduksi persis)",
      Math.abs(p.gabungOu15.gabungan - 0.8553 * 0.8553) < 0.001 &&
        bulat4(p.gabungOu15.gabungan) === 0.7315,
      `gabungan=${p.gabungOu15.gabungan}`,
    );
    suite.eq(
      "K1 konflik BTTS tampil sebagai dua angka tanpa rekonsiliasi",
      p.btts.map((b) => bulat4(b.prob)).sort(),
      [0.6276, 0.7727],
    );
    suite.eq(
      "K1 store identitas K1: kedua alias Marseille uid NULL",
      [p.uids["sm_19715544"], p.uids["mt_022917440"]],
      [null, null],
    );
    suite.check(
      "K1 kontrol: alias kembar terdaftar satu uid di store identitas",
      typeof p.uids["mt_900001"] === "string" && p.uids["mt_900001"]!.length > 0,
      `uid kontrol=${p.uids["mt_900001"]}`,
    );
    suite.eq(
      "K1 negatif: Lyon (nama mirip, laga beda) tidak menyatu ke Marseille",
      [p.uids["mt_155794033"], p.uids["sm_19715561"]],
      [null, null],
    );
  } catch (e) {
    gagal = true;
    suite.check("K1 sandbox berjalan", false, e instanceof Error ? e.message : String(e));
  } finally {
    settleFixtureEnv(env, gagal || suite.failedCount > 0);
  }
}

/* ====================================== KASUS 2 + 3 — DETAIL & STATUS */

interface ProbeDetail {
  [id: string]: {
    ok: boolean;
    alasan?: string;
    home?: string;
    away?: string;
    status?: string | null;
    market?: unknown;
    p1x2home?: number | null;
  };
}
interface ProbeStatus {
  state: { status: string; home_goals: number | null; away_goals: number | null } | null;
  statusDariScheduled: string;
  label: string;
  labelMenungguAda: boolean;
}

async function kasus23(): Promise<void> {
  console.log("\n== Kasus 2 — detail parsial Rostov == Kasus 3 — status Barcelona W ==");
  const env = createFixtureEnv("rddetail");
  try {
    await siapkanSkema(env);
    const kasus = bacaFixture<BarisKatalog[]>("katalog-kasus.json");
    seedKatalog(
      env,
      kasus.filter((r) => ["sm_19726740", "sm_19719152", "sm_19879501"].includes(r.match_id)),
    );
    seedPaket(env, ["paket-sm_19726740.json", "paket-sm_19719152.json"]);

    const d = runProbe<ProbeDetail>(env, "detail");
    const rostovPayload = bacaFixture<{ probabilities: Record<string, number> }>(
      "paket-sm_19726740.json",
    );
    suite.check("K2 Rostov: getMatchDetail TIDAK melempar (crash Fix-1 tertutup)",
      d["sm_19726740"].ok === true, d["sm_19726740"].alasan ?? "");
    suite.eq("K2 Rostov: market warisan kosong ternormalisasi null",
      d["sm_19726740"].market, null);
    suite.check(
      "K2 Rostov: peluang model utuh (1x2 kandang = payload)",
      Math.abs((d["sm_19726740"].p1x2home ?? 0) - rostovPayload.probabilities["1x2:1"]) < 1e-12,
      `aktual=${d["sm_19726740"].p1x2home}`,
    );
    suite.check("K2 Vissel (kasus crash asli Fix-1): tidak melempar, market null",
      d["sm_19719152"].ok === true && d["sm_19719152"].market === null,
      d["sm_19719152"].alasan ?? "");

    const s = runProbe<ProbeStatus>(env, "status");
    suite.eq("K3 keadaan laga dari sumber 'scheduled' = scheduled", s.state?.status, "scheduled");
    suite.eq("K3 label tampil = 'Akan datang' walau kickoff 19 Nov 20:00Z sudah lewat",
      s.label, "Akan datang");
    suite.eq("K3 label 'Menunggu pembaruan pertandingan' BELUM ADA di STATUS_LABEL_ID",
      s.labelMenungguAda, false);
  } catch (e) {
    gagal = true;
    suite.check("K2/K3 sandbox berjalan", false, e instanceof Error ? e.message : String(e));
  } finally {
    settleFixtureEnv(env, gagal || suite.failedCount > 0);
  }
}

/* ==================================================== KASUS 4 — ARSIP */

interface ProbeArsip {
  f19: {
    issued: number; settled: number; hitRatio: number | null; empty: boolean;
    overdue: number; notStarted: number; coverage: [number, number] | null;
    baris: number; keadaanUnik: string[];
  };
  semua: {
    barisPertama: { kickoff: string; keadaan: string } | null;
    belumMulaiDi200Awal: number;
  };
}

async function kasus4(): Promise<void> {
  console.log("\n== Kasus 4 — arsip 19 Nov (0/74) ==");
  const env = createFixtureEnv("rdarsip");
  try {
    await siapkanSkema(env);
    const picks = picksArsip19Nov();
    const paketIds = new Map<string, number>();
    {
      const perMatch = new Map<string, string>();
      for (const p of picks) perMatch.set(p.match_id, p.kickoff_utc);
      const ids = seedPaketObjek(
        env,
        [...perMatch.entries()].map(([m, ko]) => paketArsip(m, ko)),
      );
      for (const [m, id] of ids) paketIds.set(m, id);
    }
    seedPicks(env, picks.map((p) => ({ ...p, package_id: paketIds.get(p.match_id) ?? null })));

    const a = runProbe<ProbeArsip>(env, "arsip");
    suite.eq("K4 filter 19 Nov WIB: 74 terbit", a.f19.issued, 74);
    suite.eq("K4 0 dinilai", a.f19.settled, 0);
    suite.eq("K4 hit_ratio null (akurasi 0% TIDAK dicetak — jujur)", a.f19.hitRatio, null);
    suite.eq("K4 stats.empty = true", a.f19.empty, true);
    suite.eq("K4 74 jatuh tempo menunggu", a.f19.overdue, 74);
    suite.eq("K4 cakupan [0, 74]", a.f19.coverage, [0, 74]);
    suite.eq("K4 semua baris berkeadaan 'jatuh-tempo'", a.f19.keadaanUnik, ["jatuh-tempo"]);
    suite.eq(
      "K4 tampilan default (tanpa filter): baris pertama = laga masa depan 'belum-mulai'",
      a.semua.barisPertama?.keadaan,
      "belum-mulai",
    );
    suite.eq("K4 6 pilihan masa depan memimpin daftar default", a.semua.belumMulaiDi200Awal, 6);
  } catch (e) {
    gagal = true;
    suite.check("K4 sandbox berjalan", false, e instanceof Error ? e.message : String(e));
  } finally {
    settleFixtureEnv(env, gagal || suite.failedCount > 0);
  }
}

/**
 * Tiap kasus berjalan sebagai PROSES TERPISAH (suite memanggil dirinya
 * sendiri): getter DB repo meng-cache koneksi per proses, jadi tiga
 * sandbox dalam satu proses akan saling mengotori. Tanpa argumen =
 * jalankan semua kasus sebagai subproses dan gabungkan exit code.
 */
async function main(): Promise<void> {
  const pilihan = process.argv[2];
  if (!pilihan) {
    const { spawnSync } = await import("node:child_process");
    const { REPO_ROOT } = await import("./helpers/fixture-env");
    const pathMod = await import("node:path");
    let kode = 0;
    for (const k of ["kasus1", "kasus23", "kasus4"]) {
      const res = spawnSync(
        pathMod.join(REPO_ROOT, "node_modules", ".bin", "tsx"),
        [pathMod.join(REPO_ROOT, "tests/test-redesain-repro.ts"), k],
        { cwd: REPO_ROOT, stdio: "inherit", env: { ...process.env } },
      );
      if ((res.status ?? 1) !== 0) kode = 1;
    }
    process.exit(kode);
  }
  if (pilihan === "kasus1") await kasus1();
  else if (pilihan === "kasus23") await kasus23();
  else if (pilihan === "kasus4") await kasus4();
  else {
    console.error(`kasus tidak dikenal: ${pilihan}`);
    process.exit(2);
  }
  suite.finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
