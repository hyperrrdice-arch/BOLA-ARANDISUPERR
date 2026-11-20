/**
 * Penyemai PANGGUNG RENDER Langkah 4 redesain (jadwal + detail + peta
 * skor §9) — membangun direktori data sandbox untuk `next start` build
 * produksi.
 *
 * Skenario (relatif terhadap jam seed berjalan):
 *   - Jadwal "hari ini": satu laga live (−30 mnt, status katalog live),
 *     dua laga terjadwal (+2 j, +5 j), satu laga selesai (−3 j);
 *   - Køge vs Næstved di +50 j (di luar tanggal tampil — target
 *     pencarian lintas himpunan);
 *   - Detail selesai: Persada FC 2–1 Rawa United, paket terbit membawa
 *     matriks DEMO brief §9 (per-seribu → proporsi) + tail_mass, dan
 *     pilihan resmi "Kedua tim mencetak gol" 68% yang dinilai Tepat
 *     dari skor regulasi 2–1;
 *   - Detail pra-laga: Persada FC vs Rawa United +3 j dengan paket
 *     matriks demo (untuk alur 3D sebelum laga).
 *
 * Pakai: npx tsx tests/helpers/redesain4-stage-seed.ts <dirTarget>
 * Target TIDAK boleh di dalam checkout.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildCoreSchemas, seedDatasetTeams, type FixtureEnv } from "./fixture-env";
import { seedKatalog, seedPaketObjek, seedPicks, type BarisKatalog } from "./redesain-seeds";

const [target] = process.argv.slice(2);
if (!target) {
  console.error("pakai: redesain4-stage-seed.ts <dirTarget>");
  process.exit(2);
}
const root = path.resolve(target);
if (fs.existsSync(path.join(root, ".git"))) {
  console.error(`menolak target yang tampak seperti checkout: ${root}`);
  process.exit(2);
}
fs.mkdirSync(path.join(root, "data"), { recursive: true });
fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
fs.mkdirSync(path.join(root, "fd-csv"), { recursive: true });

const env: FixtureEnv = {
  label: "stage-jadwal-detail",
  root,
  dataDir: path.join(root, "data"),
  tasksDir: path.join(root, "tasks"),
  csvDir: path.join(root, "fd-csv"),
};

const JAM = 3_600_000;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

const MATRIKS_DEMO = [
  [56, 60, 33, 11, 3, 1],
  [82, 151, 73, 24, 7, 2],
  [48, 125, 73, 29, 9, 2],
  [18, 53, 42, 21, 6, 1],
  [6, 18, 12, 8, 3, 1],
  [2, 7, 6, 4, 2, 1],
].map((r) => r.map((v) => v / 1000));

function paket(
  matchId: string,
  home: string,
  away: string,
  kickoffMs: number,
  competition = "Liga Contoh",
): Record<string, unknown> {
  return {
    fixture: {
      match_id: matchId,
      competition_id: "sm:1",
      competition_name: competition,
      home,
      away,
      kickoff_utc: iso(kickoffMs),
    },
    gate_status: "calibrated",
    population: "league",
    lambda: 1.7,
    mu: 1.2,
    rho: 0,
    probabilities: {
      "1x2:1": 0.433,
      "1x2:x": 0.305,
      "1x2:2": 0.262,
      "btts:yes": 0.68,
      "ou25:over": 0.55,
      "ou25:under": 0.45,
    },
    top_scores: [
      { home_goals: 1, away_goals: 1, prob: 0.151 },
      { home_goals: 2, away_goals: 1, prob: 0.125 },
    ],
    score_matrix: MATRIKS_DEMO,
    score_matrix_tail_mass: 0.000001,
    legs: [],
  };
}

async function main(): Promise<void> {
  process.chdir(root);
  const { ledger } = await buildCoreSchemas();
  const publication = await import("../../lib/picks/publication");
  const tickets = await import("../../lib/picks/tickets");
  publication.ensurePublicationSchema(ledger.getPicksDb());
  tickets.ensureTicketSchema(ledger.getPicksDb());
  const identity = await import("../../lib/identity/fixture-resolver");
  const ds0 = new DatabaseSync(path.join(env.dataDir, "thestats_dataset.db"));
  identity.ensureIdentitySchema(ds0);
  ds0.close();
  fs.writeFileSync(path.join(env.dataDir, "fixture-links.json"), JSON.stringify({ links: [] }));
  fs.writeFileSync(path.join(env.dataDir, "league-canonical.json"), JSON.stringify({ version: 1, leagues: [] }));
  fs.writeFileSync(path.join(env.dataDir, "team-canonical.json"), JSON.stringify({ teams: [] }));

  const katalog = (r: Partial<BarisKatalog> & { match_id: string }): BarisKatalog => ({
    competition_id: "sm:1",
    competition_name: "Liga Contoh",
    competition_country: "Indonesia",
    utc_date: iso(now + 2 * JAM),
    status: "scheduled",
    stage_name: null,
    home_team_id: null,
    home_team_name: "?",
    away_team_id: null,
    away_team_name: "?",
    venue: null,
    is_neutral: null,
    odds_available: null,
    xg_available: null,
    fetched_utc: iso(now),
    ...r,
  });
  seedKatalog(env, [
    katalog({
      match_id: "sm_r4s_live",
      utc_date: iso(now - 0.5 * JAM),
      status: "live",
      home_team_name: "Live FC",
      away_team_name: "United Live",
    }),
    katalog({
      match_id: "sm_r4s_next",
      utc_date: iso(now + 2 * JAM),
      home_team_name: "Persada FC",
      away_team_name: "Rawa United",
    }),
    katalog({
      match_id: "sm_r4s_later",
      utc_date: iso(now + 5 * JAM),
      home_team_name: "Arema FC",
      away_team_name: "Bali United",
    }),
    katalog({
      match_id: "sm_r4s_koge",
      competition_name: "1. Division",
      competition_country: "Denmark",
      utc_date: iso(now + 50 * JAM),
      home_team_name: "Køge",
      away_team_name: "Næstved",
    }),
  ]);

  const koSelesai = now - 3 * JAM;
  const ids = seedPaketObjek(env, [
    paket("sm_r4s_done", "Persada FC", "Rawa United", koSelesai),
    paket("sm_r4s_next", "Persada FC", "Rawa United", now + 2 * JAM),
  ]);

  seedPicks(env, [
    {
      match_id: "sm_r4s_done",
      market: "btts",
      selection: "yes",
      line: "",
      model_prob: 0.68,
      market_prob: null,
      sm_prob: null,
      published_prob: 0.68,
      probability_basis: "effective",
      published_at_utc: iso(koSelesai - 2 * JAM),
      grade: "A",
      gate_status: "calibrated",
      pick_uid: "uid-r4s-btts",
      competition_canonical_id: "sm:1",
      kickoff_utc: iso(koSelesai),
      package_id: ids.get("sm_r4s_done") ?? null,
      fixture_uid: null,
    },
    {
      match_id: "sm_r4s_done",
      market: "ou25",
      selection: "under",
      line: "",
      model_prob: 0.59,
      market_prob: null,
      sm_prob: null,
      published_prob: 0.59,
      probability_basis: "effective",
      published_at_utc: iso(koSelesai - 2 * JAM),
      grade: "B",
      gate_status: "calibrated",
      pick_uid: "uid-r4s-ou25",
      competition_canonical_id: "sm:1",
      kickoff_utc: iso(koSelesai),
      package_id: ids.get("sm_r4s_done") ?? null,
      fixture_uid: null,
    },
  ]);

  seedDatasetTeams(env, [
    { team_id: "tm_h", name: "Persada FC" },
    { team_id: "tm_a", name: "Rawa United" },
  ]);
  const ds = new DatabaseSync(path.join(env.dataDir, "thestats_dataset.db"));
  ds.prepare(
    `INSERT INTO matches (match_id, competition_id, season, utc_date, status,
       home_team_id, away_team_id, home_score, away_score, referee_name, updated_at)
     VALUES (?, 'sm:1', '2026-2027', ?, 'finished', 'tm_h', 'tm_a', 2, 1, NULL, ?)`,
  ).run("sm_r4s_done", iso(koSelesai), iso(now));
  ds.close();

  const db = new DatabaseSync(path.join(env.dataDir, "picks.db"));
  const rows = db
    .prepare("SELECT id, pick_uid FROM picks WHERE pick_uid LIKE 'uid-r4s-%'")
    .all() as unknown as { id: number; pick_uid: string }[];
  const insOut = db.prepare(
    `INSERT INTO pick_outcomes (pick_id, resolved_utc, home_goals, away_goals, hit)
     VALUES (?, ?, 2, 1, ?)`,
  );
  for (const r of rows) {
    insOut.run(r.id, iso(now - JAM), r.pick_uid === "uid-r4s-btts" ? 1 : 0);
  }
  db.close();
  console.log(`stage seed jadwal+detail selesai → ${env.dataDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
