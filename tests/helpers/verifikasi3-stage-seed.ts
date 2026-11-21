/**
 * Penyemai PANGGUNG SKALA temuan #3 verifikasi produksi (beban awal
 * /pilihan) — membangun direktori data sandbox SKALA PRODUKSI untuk
 * `next start`: ±390 laga, ±2.700 pilihan resmi, ±370 paket bermatriks
 * 15×15 (±83 ribu nilai) — meniru sampel produksi pemilik (2.718
 * pilihan, 388 matriks, 84.081 nilai) supaya pengukuran dokumen awal
 * sebelum/sesudah perubahan pengiriman data bermakna.
 *
 * Isi khusus untuk probe:
 * - Laga pertama: Bengaluru FC vs Mumbai City dengan MATRIKS REGRESI
 *   langkah 5 (irisan dua pilihan = 52,9%) + Shabab Al Ahli Dubai
 *   (87,2%, tanpa matriks) → gabungan tiga pilihan 46,1%.
 * - Laga ke-300: Køge BK vs Næstved BK — target pencarian "koge" jauh
 *   di luar 20 kelompok pertama.
 * - Sisanya laga buatan deterministik (PRNG ber-seed tetap): nama,
 *   kompetisi, kelas A/B/C, dan matriks acak ternormalisasi.
 *
 * Semua kickoff relatif terhadap jam seed berjalan (+6 s.d. +70 jam)
 * supaya umpan pra-laga stabil selama sesi pengukuran.
 *
 * Pakai: npx tsx tests/helpers/verifikasi3-stage-seed.ts <dirTarget>
 * Target TIDAK boleh di dalam checkout.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildCoreSchemas, type FixtureEnv } from "./fixture-env";
import { seedPaketObjek, seedPicks, type PickSeed } from "./redesain-seeds";

const [target] = process.argv.slice(2);
if (!target) {
  console.error("pakai: verifikasi3-stage-seed.ts <dirTarget>");
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
  label: "stage-verifikasi3-skala",
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

/** PRNG deterministik (mulberry32) — fixture sama di setiap seed ulang. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const acak = mulberry32(20261121);

/** Matriks 15×15 acak ternormalisasi (jumlah = 1) — 225 nilai per paket. */
function matriksBesar(): number[][] {
  const m: number[][] = [];
  let total = 0;
  for (let h = 0; h < 15; h++) {
    const row: number[] = [];
    for (let a = 0; a < 15; a++) {
      const w = Math.pow(acak(), 2) * Math.exp(-(h + a) / 6) + 1e-6;
      row.push(w);
      total += w;
    }
    m.push(row);
  }
  return m.map((r) => r.map((v) => v / total));
}

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

const KOMPETISI = [
  "Premier League",
  "Championship",
  "La Liga",
  "Serie A",
  "Bundesliga",
  "Ligue 1",
  "Eredivisie",
  "Primeira Liga",
  "Süper Lig",
  "J1 League",
];
const KOTA = [
  "Aldgate", "Bromley", "Cardiff", "Derby", "Exeter", "Falkirk", "Grimsby",
  "Harlow", "Ipswich", "Jarrow", "Kendal", "Luton", "Mansfield", "Newport",
  "Oldham", "Preston", "Quorn", "Rochdale", "Scunthorpe", "Tamworth",
  "Uxbridge", "Vauxhall", "Walsall", "York", "Zetland", "Ashford", "Barnet",
  "Crewe", "Dover", "Ebbsfleet",
];
const AKHIRAN = ["United", "City", "Wanderers", "Rovers", "Athletic", "Town", "FC", "Albion"];

const PASAR: { market: string; selection: string; line: string }[] = [
  { market: "1x2", selection: "1", line: "" },
  { market: "dc", selection: "1x", line: "" },
  { market: "ou15", selection: "over", line: "1.5" },
  { market: "ou25", selection: "over", line: "2.5" },
  { market: "ou35", selection: "under", line: "3.5" },
  { market: "btts", selection: "yes", line: "" },
  { market: "team_over05_home", selection: "yes", line: "" },
  { market: "team_over05_away", selection: "yes", line: "" },
];
const KELAS = ["A", "A", "B", "B", "C", "A", "B", "A", "B", "C"];

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
  ): PickSeed => ({ ...dasar, line: "", fixture_uid: null, ...over });

  const paketSemua: Record<string, unknown>[] = [];
  const picksSemua: PickSeed[] = [];

  /* Laga 1–2: pasangan regresi matematika langkah 5. */
  const koBeng = now + 6 * JAM;
  const koSha = now + 7 * JAM;
  paketSemua.push(paket("v3_beng", "Bengaluru FC", "Mumbai City", koBeng, "Indian Super League", MATRIKS_REGRESI));
  paketSemua.push(paket("v3_sha", "Shabab Al Ahli Dubai", "Ajman", koSha, "UAE Pro League", null));
  picksSemua.push(
    pick({ match_id: "v3_beng", market: "team_over05_home", selection: "yes", published_prob: 0.761, pick_uid: "pk_v3_b1", kickoff_utc: iso(koBeng), fixture_uid: "uid-v3-beng" }),
    pick({ match_id: "v3_beng", market: "ou35", selection: "under", line: "3.5", published_prob: 0.749, pick_uid: "pk_v3_b2", kickoff_utc: iso(koBeng), fixture_uid: "uid-v3-beng" }),
    pick({ match_id: "v3_beng", market: "dc", selection: "1x", published_prob: 0.71, pick_uid: "pk_v3_b3", kickoff_utc: iso(koBeng), fixture_uid: "uid-v3-beng", grade: "B" }),
    pick({ match_id: "v3_beng", market: "btts", selection: "yes", published_prob: 0.68, pick_uid: "pk_v3_b4", kickoff_utc: iso(koBeng), fixture_uid: "uid-v3-beng", grade: "B" }),
    pick({ match_id: "v3_beng", market: "1x2", selection: "1", published_prob: 0.52, pick_uid: "pk_v3_b5", kickoff_utc: iso(koBeng), fixture_uid: "uid-v3-beng" }),
    pick({ match_id: "v3_sha", market: "team_over05_home", selection: "yes", published_prob: 0.872, pick_uid: "pk_v3_s1", kickoff_utc: iso(koSha), fixture_uid: "uid-v3-sha" }),
    pick({ match_id: "v3_sha", market: "1x2", selection: "1", published_prob: 0.66, pick_uid: "pk_v3_s2", kickoff_utc: iso(koSha), fixture_uid: "uid-v3-sha", grade: "B" }),
  );

  /* Laga 3..390: buatan deterministik skala produksi. */
  const TOTAL = 390;
  for (let i = 3; i <= TOTAL; i++) {
    const ko = now + 6 * JAM + ((i - 1) / TOTAL) * 64 * JAM;
    const id = `v3_g${String(i).padStart(3, "0")}`;
    let home = `${KOTA[Math.floor(acak() * KOTA.length)]} ${AKHIRAN[Math.floor(acak() * AKHIRAN.length)]}`;
    let away = `${KOTA[Math.floor(acak() * KOTA.length)]} ${AKHIRAN[Math.floor(acak() * AKHIRAN.length)]}`;
    let kompetisi = KOMPETISI[Math.floor(acak() * KOMPETISI.length)];
    if (i === 300) {
      home = "Køge BK";
      away = "Næstved BK";
      kompetisi = "1st Division · Denmark";
    }
    const bermatriks = i % 20 !== 19;
    paketSemua.push(paket(id, home, away, ko, kompetisi, bermatriks ? matriksBesar() : null));
    const nPick = 6 + Math.floor(acak() * 3); // 6–8 pilihan per laga
    for (let j = 0; j < nPick; j++) {
      const pasar = PASAR[(i + j) % PASAR.length];
      picksSemua.push(
        pick({
          match_id: id,
          market: pasar.market,
          selection: pasar.selection,
          line: pasar.line,
          published_prob: Math.round((0.52 + acak() * 0.41) * 10000) / 10000,
          pick_uid: `pk_v3_g${i}_${j}`,
          kickoff_utc: iso(ko),
          fixture_uid: `uid-v3-g${i}`,
          grade: KELAS[Math.floor(acak() * KELAS.length)],
        }),
      );
    }
  }

  const ids = seedPaketObjek(env, paketSemua);
  seedPicks(env, picksSemua.map((p) => ({ ...p, package_id: ids.get(p.match_id) ?? null })));

  const nMatriks = paketSemua.filter((p) => p.score_matrix).length;
  const nNilai = paketSemua.reduce(
    (s, p) => s + (p.score_matrix ? (p.score_matrix as number[][]).flat().length : 0),
    0,
  );
  console.log(
    `stage skala verifikasi-3 selesai → ${env.dataDir}: ${paketSemua.length} laga, ` +
      `${picksSemua.length} pick, ${nMatriks} paket bermatriks, ${nNilai} nilai matriks`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
