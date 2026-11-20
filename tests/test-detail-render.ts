/**
 * TEST:DETAIL-RENDER — regresi permanen butir review 1 (K8).
 *
 * Bug asal: halaman detail membaca `market.bookmakers.length` tanpa
 * penjaga; 3.650 paket produksi menyimpan market hadir-tapi-kosong
 * ({probs:{}, captured_utc:null, bookmakers:null}) → TypeError saat
 * render, layar galat global "This page couldn't load", HTTP tetap 200
 * (contoh publik: sm_19719152 Vissel Kobe–Mito Hollyhock).
 *
 * Kontrak yang dikunci suite ini (adapter baca lib/web/data.ts):
 *  - harga pasar TERSEDIA hanya bila probs benar-benar tertangkap;
 *    bentuk warisan kosong → market null (bagian pasar "belum
 *    tersedia", bukan sumber hantu, bukan crash);
 *  - bookmakers null/absen dengan harga valid → [] (nama hanya label);
 *    bookmakers valid & captured_utc yang sah TIDAK berubah;
 *  - peluang model tidak pernah ikut rusak oleh bentuk market;
 *  - segmen detail punya batas kegagalan lokal (error.tsx) dengan
 *    jalan kembali ke jadwal.
 *
 * Bukti render ujung-ke-ujung pada build produksi (keenam kasus × URL
 * langsung / Reload / klik dari daftar, isi render diperiksa) ada di
 * tasks/reports/fix1-detail-render-report.md; suite ini menjaga
 * kontrak adapternya tetap hijau di test:web.
 *
 * Pakai: npm run test:web (suite ini dirantai di akhir)
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  REPO_ROOT,
  Suite,
  buildCoreSchemas,
  createFixtureEnv,
  runScript,
  settleFixtureEnv,
  writeTeamRegistry,
  type FixtureEnv,
  type RunResult,
} from "./helpers/fixture-env";

/* ------------------------------------------------------------ probe types */

interface DetailCase {
  home?: string;
  away?: string;
  market?: {
    probs: Record<string, number>;
    captured_utc: string | null;
    bookmakers: string[];
  } | null;
  model121?: number | null;
  error?: string;
}

function runDetailProbe(env: FixtureEnv): Record<string, DetailCase | null> {
  const res: RunResult = runScript(env, "tests/helpers/detail-probe.ts");
  const line = res.stdout.split("\n").find((l) => l.startsWith("PROBE_JSON "));
  if (!line) {
    throw new Error(
      `detail-probe tidak menghasilkan PROBE_JSON (exit=${res.code}): ${res.stdout} ${res.stderr}`,
    );
  }
  return JSON.parse(line.slice("PROBE_JSON ".length)) as Record<string, DetailCase | null>;
}

/* ------------------------------------------------------------------ seed */

const KICK = "2026-11-21T04:00:00.000Z";
const CAPTURED = "2026-11-21T01:30:00.000Z";

function basePayload(home: string, away: string, matchId: string) {
  return {
    fixture: {
      match_id: matchId,
      competition_name: "Liga Prioritas",
      home,
      away,
      kickoff_utc: KICK,
    },
    gate_status: "partial",
    population: "domestic",
    lambda: 1.46,
    mu: 1.13,
    rho: -0.08,
    probabilities: { "1x2:1": 0.46, "1x2:x": 0.29, "1x2:2": 0.25, "dc:1x": 0.75 },
    top_scores: [{ home_goals: 2, away_goals: 1, prob: 0.16 }],
    score_matrix: [[0.12]],
    sm_panel: null,
    legs: [],
  };
}

const MARKET_VALID = {
  probs: { "1x2:1": 0.44, "1x2:x": 0.3, "1x2:2": 0.26 },
  captured_utc: CAPTURED,
  bookmakers: ["FixtureBook"],
};

async function buildSandbox(): Promise<FixtureEnv> {
  const env = createFixtureEnv("fix1detail");
  process.chdir(env.root);
  const { ledger } = await buildCoreSchemas();
  const publication = await import("../lib/picks/publication");
  const tickets = await import("../lib/picks/tickets");
  const pdb = ledger.getPicksDb();
  publication.ensurePublicationSchema(pdb);
  tickets.ensureTicketSchema(pdb);

  fs.writeFileSync(path.join(env.dataDir, "fixture-links.json"), JSON.stringify({ links: [] }));
  writeTeamRegistry(env, [
    { team_id: "tm_persada", name: "Persada FC" },
    { team_id: "tm_rawa", name: "Rawa United" },
    { team_id: "tm_kencana", name: "Kencana FC" },
    { team_id: "tm_samudra", name: "Samudra United" },
    { team_id: "tm_vissel", name: "Vissel Kobe" },
    { team_id: "tm_mito", name: "Mito Hollyhock" },
    { team_id: "tm_banteng", name: "Banteng FC" },
    { team_id: "tm_elang", name: "Elang United" },
    { team_id: "tm_cakra", name: "Cakra FC" },
    { team_id: "tm_garuda", name: "Garuda United" },
    { team_id: "tm_delta", name: "Delta FC" },
    { team_id: "tm_fajar", name: "Fajar United" },
  ]);
  // Tabel telemetri kanonik selalu ada di produksi (dibangun refresh);
  // tanpa tabelnya getForm melempar untuk nama tim terdaftar — fixture
  // meniru keadaan produksi: tabel ada, kosong.
  const ds = new DatabaseSync(path.join(env.dataDir, "thestats_dataset.db"));
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

  const cases: { id: string; payload: unknown }[] = [
    { id: "sm_fx_valid", payload: { ...basePayload("Persada FC", "Rawa United", "sm_fx_valid"), market: MARKET_VALID } },
    { id: "sm_fx_bmnull", payload: { ...basePayload("Kencana FC", "Samudra United", "sm_fx_bmnull"), market: { ...MARKET_VALID, bookmakers: null } } },
    {
      id: "sm_fx_legacy",
      payload: {
        ...basePayload("Vissel Kobe", "Mito Hollyhock", "sm_fx_legacy"),
        probabilities: { "1x2:1": 0.7042, "1x2:x": 0.1831, "1x2:2": 0.1127 },
        // Bentuk warisan produksi persis (3.650 paket): market hadir
        // tetapi kosong di ketiga fieldnya.
        market: { probs: {}, captured_utc: null, bookmakers: null },
      },
    },
    { id: "sm_fx_marketnull", payload: { ...basePayload("Banteng FC", "Elang United", "sm_fx_marketnull"), market: null } },
    { id: "sm_fx_bmempty", payload: { ...basePayload("Cakra FC", "Garuda United", "sm_fx_bmempty"), market: { ...MARKET_VALID, bookmakers: [] } } },
    { id: "sm_fx_nomarket", payload: basePayload("Delta FC", "Fajar United", "sm_fx_nomarket") },
  ];

  const snap = new DatabaseSync(path.join(env.dataDir, "analysis_snapshots.db"));
  const ins = snap.prepare(
    `INSERT INTO packages (match_id, competition_canonical_id, kickoff_utc,
       computed_utc, trigger, fit_source, gate_status, payload_json)
     VALUES (?, 'comp_fx', ?, '2026-11-21T01:00:00.000Z', 'manual', 'fixture', 'partial', ?)`,
  );
  for (const c of cases) ins.run(c.id, KICK, JSON.stringify(c.payload));
  snap.close();
  return env;
}

/* ------------------------------------------------------------------ main */

async function main(): Promise<void> {
  const suite = new Suite("test:detail-render (fix review 1)");
  const env = await buildSandbox();
  let out: Record<string, DetailCase | null> | null = null;
  try {
    out = runDetailProbe(env);
  } catch (e) {
    suite.check("detail-probe berjalan", false, e instanceof Error ? e.message : String(e));
  }

  if (out) {
    const NAMES: Record<string, [string, string]> = {
      sm_fx_valid: ["Persada FC", "Rawa United"],
      sm_fx_bmnull: ["Kencana FC", "Samudra United"],
      sm_fx_legacy: ["Vissel Kobe", "Mito Hollyhock"],
      sm_fx_marketnull: ["Banteng FC", "Elang United"],
      sm_fx_bmempty: ["Cakra FC", "Garuda United"],
      sm_fx_nomarket: ["Delta FC", "Fajar United"],
    };
    for (const [id, [home, away]] of Object.entries(NAMES)) {
      const c = out[id];
      suite.check(`${id}: adapter tidak melempar & detail ada`, !!c && !c.error, c?.error ?? "");
      suite.eq(`${id}: nama tim utuh`, [c?.home, c?.away], [home, away]);
    }

    const valid = out.sm_fx_valid;
    suite.eq("valid: bookmakers dipertahankan", valid?.market?.bookmakers, ["FixtureBook"]);
    suite.eq("valid: captured_utc dipertahankan", valid?.market?.captured_utc, CAPTURED);
    suite.eq("valid: probs pasar dipertahankan", valid?.market?.probs["1x2:1"], 0.44);

    const bmnull = out.sm_fx_bmnull;
    suite.check("bookmakers null: market tetap tersedia (harga ada)", bmnull?.market != null);
    suite.eq("bookmakers null: dinormalisasi []", bmnull?.market?.bookmakers, []);
    suite.eq("bookmakers null: probs tidak ikut rusak", bmnull?.market?.probs["1x2:1"], 0.44);
    suite.eq("bookmakers null: captured tidak ikut rusak", bmnull?.market?.captured_utc, CAPTURED);

    const legacy = out.sm_fx_legacy;
    suite.eq("warisan kosong: market menjadi null (belum tersedia)", legacy?.market, null);
    suite.eq("warisan kosong: peluang model utuh", legacy?.model121, 0.7042);

    suite.eq("market null: tetap null", out.sm_fx_marketnull?.market, null);
    suite.eq("tanpa field market: menjadi null", out.sm_fx_nomarket?.market, null);

    const bmempty = out.sm_fx_bmempty;
    suite.check("bookmakers []: market tetap tersedia", bmempty?.market != null);
    suite.eq("bookmakers []: tetap []", bmempty?.market?.bookmakers, []);
  }

  // Batas kegagalan lokal segmen detail: file ada, klien, dan memuat
  // jalan kembali ke jadwal.
  const errFile = path.join(
    REPO_ROOT,
    "app",
    "(terminal)",
    "pertandingan",
    "[matchId]",
    "error.tsx",
  );
  const errSrc = fs.existsSync(errFile) ? fs.readFileSync(errFile, "utf8") : "";
  suite.check("segmen detail punya error.tsx lokal", errSrc.length > 0);
  suite.check(
    "error.tsx memuat jalan kembali ke /pertandingan",
    errSrc.includes('href="/pertandingan"'),
  );

  settleFixtureEnv(env, suite.failedCount > 0);
  suite.finish();
}

main();
