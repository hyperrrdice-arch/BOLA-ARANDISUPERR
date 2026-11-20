/**
 * Penyemai PANGGUNG RENDER Langkah 3 redesain (visual + beranda) —
 * membangun direktori data sandbox untuk `next start` build produksi.
 *
 * Skenario "beranda": relatif terhadap jam seed berjalan —
 *   - satu laga +3 jam dengan dua pilihan RESMI terbit (utama:
 *     "Persija Jakarta mencetak gol" 76,1%, meniru contoh brief §3A.3);
 *   - lima laga berikutnya (+5 s.d. +30 jam, satu melewati tengah
 *     malam untuk pemisah tanggal) tanpa pilihan resmi;
 *   - rekam: 5 pilihan dinilai (3 tepat) di 2 laga + 2 pilihan jatuh
 *     tempo belum dinilai → cakupan 5 dari 7.
 *
 * Pakai: npx tsx tests/helpers/redesain3-stage-seed.ts <dirTarget>
 * Target TIDAK boleh di dalam checkout.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildCoreSchemas, type FixtureEnv } from "./fixture-env";
import { seedPaketObjek, seedPicks, type PickSeed } from "./redesain-seeds";

const [target] = process.argv.slice(2);
if (!target) {
  console.error("pakai: redesain3-stage-seed.ts <dirTarget>");
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
  label: "stage-beranda",
  root,
  dataDir: path.join(root, "data"),
  tasksDir: path.join(root, "tasks"),
  csvDir: path.join(root, "fd-csv"),
};

const JAM = 3_600_000;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

function paket(
  matchId: string,
  home: string,
  away: string,
  kickoffMs: number,
  competition = "Liga 1",
): Record<string, unknown> {
  return {
    fixture: {
      match_id: matchId,
      competition_id: "sm:999",
      competition_name: competition,
      home,
      away,
      kickoff_utc: iso(kickoffMs),
    },
    gate_status: "calibrated",
    population: "league",
    lambda: 1.6,
    mu: 1.1,
    rho: 0,
    probabilities: { "1x2:1": 0.52, "1x2:x": 0.27, "1x2:2": 0.21 },
    top_scores: [{ home_goals: 1, away_goals: 0, prob: 0.14 }],
    score_matrix: Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 0.03)),
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
  const ds = new DatabaseSync(path.join(env.dataDir, "thestats_dataset.db"));
  identity.ensureIdentitySchema(ds);
  ds.close();
  fs.writeFileSync(path.join(env.dataDir, "fixture-links.json"), JSON.stringify({ links: [] }));
  fs.writeFileSync(
    path.join(env.dataDir, "league-canonical.json"),
    JSON.stringify({ version: 1, leagues: [] }),
  );
  fs.writeFileSync(path.join(env.dataDir, "team-canonical.json"), JSON.stringify({ teams: [] }));

  /* ------------------------------------------------------ laga mendatang */
  const sorotanKo = now + 3 * JAM;
  const daftar: [string, string, string, number][] = [
    ["sm_r3_spot", "Persija Jakarta", "Persib Bandung", sorotanKo],
    ["sm_r3_b1", "Arema FC", "Bali United", now + 5 * JAM],
    ["sm_r3_b2", "PSM Makassar", "Borneo FC", now + 7.5 * JAM],
    ["sm_r3_b3", "PSIS Semarang", "Persita Tangerang", now + 9 * JAM],
    ["sm_r3_b4", "Persebaya Surabaya", "Dewa United", now + 26 * JAM],
    ["sm_r3_b5", "Madura United", "Persik Kediri", now + 30 * JAM],
  ];
  const pkgIds = seedPaketObjek(
    env,
    daftar.map(([id, h, a, ko]) => paket(id, h, a, ko)),
  );

  /* ------------------------------------------------------- rekam lampau */
  const lampau: [string, string, string, number][] = [
    ["sm_r3_l1", "Persib Bandung", "Arema FC", now - 26 * JAM],
    ["sm_r3_l2", "Bali United", "PSM Makassar", now - 30 * JAM],
    ["sm_r3_l3", "Borneo FC", "Persija Jakarta", now - 10 * JAM],
  ];
  const pkgLampau = seedPaketObjek(
    env,
    lampau.map(([id, h, a, ko]) => paket(id, h, a, ko)),
  );

  const terbit = iso(now - 2 * JAM);
  const buatPick = (
    matchId: string,
    kickoffMs: number,
    market: string,
    selection: string,
    prob: number,
    uid: string,
    packageId: number | null,
  ): PickSeed => ({
    match_id: matchId,
    market,
    selection,
    line: "",
    model_prob: prob,
    market_prob: null,
    sm_prob: null,
    published_prob: prob,
    probability_basis: "effective",
    published_at_utc: terbit,
    grade: "A",
    gate_status: "calibrated",
    pick_uid: uid,
    competition_canonical_id: "sm:999",
    kickoff_utc: iso(kickoffMs),
    package_id: packageId,
    fixture_uid: null,
  });

  seedPicks(env, [
    // Sorotan: dua pilihan resmi; utama = peluang terbit tertinggi.
    buatPick("sm_r3_spot", sorotanKo, "team_over05_home", "over", 0.761, "uid-r3-spot-1", pkgIds.get("sm_r3_spot") ?? null),
    buatPick("sm_r3_spot", sorotanKo, "ou35", "under", 0.749, "uid-r3-spot-2", pkgIds.get("sm_r3_spot") ?? null),
    // Rekam dinilai: l1 → 2 tepat 1 meleset; l2 → 1 tepat 1 meleset.
    buatPick("sm_r3_l1", now - 26 * JAM, "1x2", "1", 0.62, "uid-r3-l1-1", pkgLampau.get("sm_r3_l1") ?? null),
    buatPick("sm_r3_l1", now - 26 * JAM, "ou25", "over", 0.58, "uid-r3-l1-2", pkgLampau.get("sm_r3_l1") ?? null),
    buatPick("sm_r3_l1", now - 26 * JAM, "btts", "yes", 0.55, "uid-r3-l1-3", pkgLampau.get("sm_r3_l1") ?? null),
    buatPick("sm_r3_l2", now - 30 * JAM, "dc", "1x", 0.81, "uid-r3-l2-1", pkgLampau.get("sm_r3_l2") ?? null),
    buatPick("sm_r3_l2", now - 30 * JAM, "ou15", "over", 0.77, "uid-r3-l2-2", pkgLampau.get("sm_r3_l2") ?? null),
    // Jatuh tempo belum dinilai (kickoff 10 jam lalu, lewat tenggang 6 jam).
    buatPick("sm_r3_l3", now - 10 * JAM, "1x2", "1", 0.6, "uid-r3-l3-1", pkgLampau.get("sm_r3_l3") ?? null),
    buatPick("sm_r3_l3", now - 10 * JAM, "ou25", "under", 0.57, "uid-r3-l3-2", pkgLampau.get("sm_r3_l3") ?? null),
  ]);

  // Hasil untuk 5 pilihan dinilai: tepat, tepat, meleset | tepat, meleset.
  const db = new DatabaseSync(path.join(env.dataDir, "picks.db"));
  const byUid = db
    .prepare("SELECT id, pick_uid FROM picks WHERE pick_uid LIKE 'uid-r3-l%'")
    .all() as unknown as { id: number; pick_uid: string }[];
  const hasil: Record<string, [number, number, number]> = {
    "uid-r3-l1-1": [2, 1, 1],
    "uid-r3-l1-2": [2, 1, 1],
    "uid-r3-l1-3": [2, 1, 0],
    "uid-r3-l2-1": [1, 1, 1],
    "uid-r3-l2-2": [1, 1, 0],
  };
  const insOut = db.prepare(
    `INSERT INTO pick_outcomes (pick_id, resolved_utc, home_goals, away_goals, hit)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const r of byUid) {
    const h = hasil[r.pick_uid];
    if (h) insOut.run(r.id, iso(now - 2 * JAM), h[0], h[1], h[2]);
  }
  db.close();
  console.log(`stage seed beranda selesai → ${env.dataDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
