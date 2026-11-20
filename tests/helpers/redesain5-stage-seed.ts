/**
 * Penyemai PANGGUNG RENDER Langkah 5 redesain (Pilihan §3D + Rekam
 * hasil §3E) — membangun direktori data sandbox untuk `next start`
 * build produksi.
 *
 * Skenario (relatif terhadap jam seed berjalan, kecuali arsip):
 *   /pilihan — Bengaluru vs Mumbai City (+3 j) membawa MATRIKS
 *     REGRESI suite langkah 5 (marginal 76,1% / 74,9%, irisan 52,9%);
 *     Shabab Al Ahli Dubai vs Ajman (+5 j, 87,2%); Persada FC vs Rawa
 *     United (+8 j, 8 pilihan, matriks demo §9); 20 laga pengisi;
 *     Kadaluwarsa FC vs Lewat United (+28 j — target uji kedaluwarsa
 *     dengan jam klien dimajukan); Køge BK vs Næstved BK (+29 j —
 *     target pencarian "koge" di luar 20 laga pertama). Total 25 laga.
 *   /bukti — Persada 2–1 Rawa selesai (BTTS 68% Tepat, Maksimal dua
 *     gol versi OU2.5 under 59% Meleset — pola lembar 4), Arema 1–0
 *     Bali (DC 1X Tepat), satu pilihan batal, dan jendela arsip
 *     19 Nov 2026 berisi 74 pilihan jatuh tempo tanpa hasil (0/74).
 *     Satu tiket resmi diterbitkan lewat jalur K3 dari dua pilihan
 *     Persada yang sudah dinilai.
 *
 * Pakai: npx tsx tests/helpers/redesain5-stage-seed.ts <dirTarget>
 * Target TIDAK boleh di dalam checkout.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildCoreSchemas, type FixtureEnv } from "./fixture-env";
import { seedPaketObjek, seedPicks, picksArsip19Nov, paketArsip, type PickSeed } from "./redesain-seeds";

const [target] = process.argv.slice(2);
if (!target) {
  console.error("pakai: redesain5-stage-seed.ts <dirTarget>");
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
  label: "stage-pilihan-rekam",
  root,
  dataDir: path.join(root, "data"),
  tasksDir: path.join(root, "tasks"),
  csvDir: path.join(root, "fd-csv"),
};

const JAM = 3_600_000;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

/** Matriks regresi suite langkah 5 — marginal/irisan persis §3D.5. */
const MATRIKS_REGRESI: number[][] = [
  [0.06, 0.07, 0.055, 0.035, 0.012, 0.007],
  [0.15, 0.14, 0.07, 0.045, 0.02, 0.008],
  [0.09, 0.05, 0.048, 0.026, 0.011, 0.004],
  [0.029, 0.028, 0.016, 0.009, 0.004, 0.001],
  [0.006, 0.003, 0.0015, 0.0005, 0.0003, 0.0002],
  [0.0003, 0.0001, 0.00005, 0.00003, 0.00001, 0.00001],
];

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
  competition: string,
  matrix: number[][] | null,
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
    probabilities: {},
    top_scores: [],
    score_matrix: matrix,
    market: null,
    sm_panel: null,
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

  const TERBIT = iso(now - 2 * JAM);
  const dasar: Omit<PickSeed, "match_id" | "market" | "selection" | "line" | "published_prob" | "pick_uid" | "kickoff_utc" | "fixture_uid"> = {
    model_prob: 0.8, market_prob: null, sm_prob: null, probability_basis: "effective",
    published_at_utc: TERBIT, grade: "A", gate_status: "calibrated",
    competition_canonical_id: "sm:1", package_id: null,
  };
  const pick = (
    over: Partial<PickSeed> & Pick<PickSeed, "match_id" | "market" | "selection" | "published_prob" | "pick_uid" | "kickoff_utc">,
  ): PickSeed => ({
    ...dasar,
    line: "",
    fixture_uid: null,
    ...over,
  });

  /* ------------------------------------------------ /pilihan (pra-laga) */
  const koBeng = now + 3 * JAM;
  const koSha = now + 5 * JAM;
  const koPer = now + 8 * JAM;
  const koKad = now + 28 * JAM;
  const koKoge = now + 29 * JAM;

  const paketPra: Record<string, unknown>[] = [
    paket("rd5_beng", "Bengaluru FC", "Mumbai City", koBeng, "Indian Super League", MATRIKS_REGRESI),
    paket("rd5_sha", "Shabab Al Ahli Dubai", "Ajman", koSha, "UAE Pro League", null),
    paket("rd5_per", "Persada FC", "Rawa United", koPer, "Liga Contoh", MATRIKS_DEMO),
    paket("rd5_kad", "Kadaluwarsa FC", "Lewat United", koKad, "Liga Contoh", null),
    paket("rd5_koge", "Køge BK", "Næstved BK", koKoge, "1st Division · Denmark", null),
  ];
  const picksPra: PickSeed[] = [
    pick({ match_id: "rd5_beng", market: "team_over05_home", selection: "yes", published_prob: 0.761, pick_uid: "pk_rd5_b1", kickoff_utc: iso(koBeng), fixture_uid: "uid-rd5-beng" }),
    pick({ match_id: "rd5_beng", market: "ou35", selection: "under", line: "3.5", published_prob: 0.749, pick_uid: "pk_rd5_b2", kickoff_utc: iso(koBeng), fixture_uid: "uid-rd5-beng" }),
    pick({ match_id: "rd5_beng", market: "dc", selection: "1x", published_prob: 0.71, pick_uid: "pk_rd5_b3", kickoff_utc: iso(koBeng), fixture_uid: "uid-rd5-beng", grade: "B" }),
    pick({ match_id: "rd5_beng", market: "btts", selection: "yes", published_prob: 0.68, pick_uid: "pk_rd5_b4", kickoff_utc: iso(koBeng), fixture_uid: "uid-rd5-beng", grade: "B" }),
    pick({ match_id: "rd5_beng", market: "1x2", selection: "1", published_prob: 0.52, pick_uid: "pk_rd5_b5", kickoff_utc: iso(koBeng), fixture_uid: "uid-rd5-beng" }),
    pick({ match_id: "rd5_sha", market: "team_over05_home", selection: "yes", published_prob: 0.872, pick_uid: "pk_rd5_s1", kickoff_utc: iso(koSha), fixture_uid: "uid-rd5-sha" }),
    pick({ match_id: "rd5_sha", market: "1x2", selection: "1", published_prob: 0.66, pick_uid: "pk_rd5_s2", kickoff_utc: iso(koSha), fixture_uid: "uid-rd5-sha", grade: "B" }),
    pick({ match_id: "rd5_per", market: "1x2", selection: "1", published_prob: 0.55, pick_uid: "pk_rd5_p1", kickoff_utc: iso(koPer), fixture_uid: "uid-rd5-per" }),
    pick({ match_id: "rd5_per", market: "dc", selection: "1x", published_prob: 0.83, pick_uid: "pk_rd5_p2", kickoff_utc: iso(koPer), fixture_uid: "uid-rd5-per" }),
    pick({ match_id: "rd5_per", market: "ou15", selection: "over", line: "1.5", published_prob: 0.88, pick_uid: "pk_rd5_p3", kickoff_utc: iso(koPer), fixture_uid: "uid-rd5-per" }),
    pick({ match_id: "rd5_per", market: "ou25", selection: "over", line: "2.5", published_prob: 0.62, pick_uid: "pk_rd5_p4", kickoff_utc: iso(koPer), fixture_uid: "uid-rd5-per", grade: "B" }),
    pick({ match_id: "rd5_per", market: "ou25", selection: "under", line: "2.5", published_prob: 0.57, pick_uid: "pk_rd5_p5", kickoff_utc: iso(koPer), fixture_uid: "uid-rd5-per", grade: "B" }),
    pick({ match_id: "rd5_per", market: "btts", selection: "yes", published_prob: 0.68, pick_uid: "pk_rd5_p6", kickoff_utc: iso(koPer), fixture_uid: "uid-rd5-per" }),
    pick({ match_id: "rd5_per", market: "team_over05_home", selection: "yes", published_prob: 0.79, pick_uid: "pk_rd5_p7", kickoff_utc: iso(koPer), fixture_uid: "uid-rd5-per" }),
    pick({ match_id: "rd5_per", market: "team_over05_away", selection: "yes", published_prob: 0.64, pick_uid: "pk_rd5_p8", kickoff_utc: iso(koPer), fixture_uid: "uid-rd5-per", grade: "B" }),
    pick({ match_id: "rd5_kad", market: "team_over05_home", selection: "yes", published_prob: 0.77, pick_uid: "pk_rd5_kad1", kickoff_utc: iso(koKad), fixture_uid: "uid-rd5-kad" }),
    pick({ match_id: "rd5_koge", market: "ou15", selection: "over", line: "1.5", published_prob: 0.8, pick_uid: "pk_rd5_koge1", kickoff_utc: iso(koKoge), fixture_uid: "uid-rd5-koge" }),
  ];
  // 20 laga pengisi (satu pilihan masing-masing) — paginasi 20 + 5.
  for (let i = 0; i < 20; i++) {
    const ko = now + (10 + i * 0.9) * JAM;
    const id = `rd5_f${String(i + 1).padStart(2, "0")}`;
    paketPra.push(
      paket(id, `Pengisi ${String(i + 1).padStart(2, "0")} FC`, `Lawan ${String(i + 1).padStart(2, "0")} FC`, ko, "Liga Pengisi", null),
    );
    picksPra.push(
      pick({ match_id: id, market: "ou15", selection: "over", line: "1.5", published_prob: 0.8, pick_uid: `pk_rd5_f${i + 1}`, kickoff_utc: iso(ko), fixture_uid: `uid-rd5-f${i + 1}` }),
    );
  }

  /* ------------------------------------------------- /bukti (selesai) */
  const koSelesai = now - 60 * JAM;
  const koArema = now - 58 * JAM;
  const koVoid = now - 56 * JAM;
  const paketSelesai: Record<string, unknown>[] = [
    paket("rd5_done", "Persada FC", "Rawa United", koSelesai, "Liga Contoh", MATRIKS_DEMO),
    paket("rd5_arema", "Arema FC", "Bali United", koArema, "Liga Contoh", null),
    paket("rd5_void", "Batal FC", "Urung United", koVoid, "Liga Contoh", null),
  ];
  const picksSelesai: PickSeed[] = [
    pick({ match_id: "rd5_done", market: "btts", selection: "yes", published_prob: 0.68, pick_uid: "pk_rd5_d1", kickoff_utc: iso(koSelesai), fixture_uid: "uid-rd5-done", published_at_utc: iso(now - 65 * JAM) }),
    pick({ match_id: "rd5_done", market: "ou25", selection: "under", line: "2.5", published_prob: 0.59, pick_uid: "pk_rd5_d2", kickoff_utc: iso(koSelesai), fixture_uid: "uid-rd5-done", published_at_utc: iso(now - 65 * JAM) }),
    pick({ match_id: "rd5_arema", market: "dc", selection: "1x", published_prob: 0.81, pick_uid: "pk_rd5_a1", kickoff_utc: iso(koArema), fixture_uid: "uid-rd5-arema", published_at_utc: iso(now - 65 * JAM) }),
    pick({ match_id: "rd5_void", market: "1x2", selection: "1", published_prob: 0.7, pick_uid: "pk_rd5_v1", kickoff_utc: iso(koVoid), fixture_uid: "uid-rd5-void", published_at_utc: iso(now - 65 * JAM) }),
  ];

  /* ------------------------------------------------------- arsip 0/74 */
  const arsip = picksArsip19Nov().filter((p) => p.match_id.startsWith("rd_arsip_"));
  const paketArsipIds = seedPaketObjek(
    env,
    [...new Map(arsip.map((p) => [p.match_id, p.kickoff_utc])).entries()].map(([m, ko]) =>
      paketArsip(m, ko),
    ),
  );

  const idsPra = seedPaketObjek(env, paketPra);
  const idsSelesai = seedPaketObjek(env, paketSelesai);
  const semuaIds = new Map([...idsPra, ...idsSelesai]);
  seedPicks(env, [
    ...picksPra.map((p) => ({ ...p, package_id: semuaIds.get(p.match_id) ?? null })),
    ...picksSelesai.map((p) => ({ ...p, package_id: semuaIds.get(p.match_id) ?? null })),
    ...arsip.map((p) => ({ ...p, package_id: paketArsipIds.get(p.match_id) ?? null })),
  ]);

  /* Hasil + batal + tiket resmi lewat jalur K3. */
  const db = new DatabaseSync(path.join(env.dataDir, "picks.db"));
  const idDari = (uid: string) =>
    (db.prepare("SELECT id FROM picks WHERE pick_uid = ?").get(uid) as { id: number }).id;
  const ins = db.prepare(
    "INSERT INTO pick_outcomes (pick_id, resolved_utc, home_goals, away_goals, hit) VALUES (?, ?, ?, ?, ?)",
  );
  ins.run(idDari("pk_rd5_d1"), iso(now - 5 * JAM), 2, 1, 1); // BTTS 68% → Tepat
  ins.run(idDari("pk_rd5_d2"), iso(now - 5 * JAM), 2, 1, 0); // OU2.5 under 59% → Meleset
  ins.run(idDari("pk_rd5_a1"), iso(now - 5 * JAM), 1, 0, 1); // DC 1X → Tepat
  db.prepare(
    "INSERT INTO pick_voids (pick_id, fixture_uid, voided_utc, reason, policy_version) VALUES (?, ?, ?, ?, ?)",
  ).run(idDari("pk_rd5_v1"), "uid-rd5-void", iso(now - 49 * JAM), "laga dibatalkan", "v1");
  const idTiket: [number, number] = [idDari("pk_rd5_d1"), idDari("pk_rd5_d2")];
  db.close();

  const slip = tickets.publishSlip({
    edition_key: "l5-edisi-1",
    slot: "utama",
    series: "live-run",
    published_utc: iso(now - 65 * JAM),
    pick_ids: idTiket,
  });
  console.log(`tiket resmi panggung: ${slip.status}`);
  console.log(`stage seed pilihan+rekam selesai → ${env.dataDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
