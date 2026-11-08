/**
 * Regression tests untuk perbaikan correctness quant (audit 2026-11-09).
 *
 * Jalankan: node --env-file=.env.local --import tsx scripts/quant-correctness-tests.ts
 * Exit 0 = semua lolos; exit 1 = ada kegagalan (dicetak per kasus).
 *
 * Cakupan per temuan audit:
 *  1. Fallback rating ratings-loader (skala rasio + monotonik λ)
 *  2. Matrix Dixon-Coles (tail tidak dibuang diam-diam)
 *  3. Wiring effective_prob engine → ledger → builder
 *  4. Confidence special markets mengikuti coverage metrik
 *  5. Normalisasi xG point-in-time (backtest tanpa look-ahead)
 */
import { getShrunkMatchParameters } from "../lib/quant/ratings-loader";
import { calculateDixonColes } from "../lib/quant/dixon-coles";
import { combineSlip, type SlipPick } from "../lib/web/parlay";
import {
  calculateHeadedGoalMarket,
  calculateCornersMarket,
  calculateCardsMarket,
} from "../lib/quant/special-markets-engine";
import type { TeamRollingTelemetry } from "../lib/db/team-telemetry";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  OK  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const approx = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------------------
// Temuan 1 — fallback rating
// ---------------------------------------------------------------------------
console.log("Temuan 1: fallback rating (ratings-loader)");
{
  const base = { homeTeam: "Fiktif FC", awayTeam: "Karangan United", leagueHint: "Liga Fiksi Antah" };
  const p15 = getShrunkMatchParameters({ ...base, liveHomeFormGoalsAvg: 1.5, liveAwayFormGoalsAvg: 1.2 });
  const p20 = getShrunkMatchParameters({ ...base, liveHomeFormGoalsAvg: 2.0, liveAwayFormGoalsAvg: 1.2 });
  const pNone = getShrunkMatchParameters({ ...base });
  const pZero = getShrunkMatchParameters({ ...base, liveHomeFormGoalsAvg: 0, liveAwayFormGoalsAvg: 1.2 });

  check("jalur fallback terpakai + tak terkalibrasi", p15.metadata?.homeSource === "fallback" && p15.isCalibrated === false);
  const lam = (p: typeof p15) => calculateDixonColes(p).lambda;
  check("λ monoton terhadap form kandang (2,0 > 1,5)", lam(p20) > lam(p15), `λ(2,0)=${lam(p20)} λ(1,5)=${lam(p15)}`);
  check("attack kandang tidak mengubah defense lawan", p15.awayDefense === p20.awayDefense, `${p15.awayDefense} vs ${p20.awayDefense}`);
  check("defense fallback = prior rasio 1,0", p15.homeDefense === 1.0 && p15.awayDefense === 1.0);
  check("attack fallback skala rasio (form 1,5 / 1,35)", approx(p15.homeAttack, 1.5 / 1.35, 1e-9), `homeAttack=${p15.homeAttack}`);
  const totalNone = calculateDixonColes(pNone).expected_total_goals;
  check("tanpa form: total gol prior wajar (2,5–3,1, bukan 4,64)", totalNone >= 2.5 && totalNone <= 3.1, `total=${totalNone.toFixed(2)}`);
  check("form 0 terobservasi dihormati sebagai 0 (bukan diganti default)", pZero.homeAttack === 0, `homeAttack=${pZero.homeAttack}`);
  check(
    "semua parameter fallback finite",
    [p15.homeAttack, p15.homeDefense, p15.awayAttack, p15.awayDefense].every(Number.isFinite)
  );

  // Cabang kedua tim tak ter-resolve di liga yang dikenal (E0): rasio attack
  // harus memakai rata-rata liga itu sendiri, bukan konstanta 1,35.
  const pE0 = getShrunkMatchParameters({
    homeTeam: "Fiktif FC",
    awayTeam: "Karangan United",
    leagueHint: "E0",
    liveHomeFormGoalsAvg: 1.5,
    liveAwayFormGoalsAvg: 1.2,
  });
  check(
    "liga dikenal, tim asing: rasio konsisten dgn leagueAvgGoals liga",
    approx(pE0.homeAttack * pE0.leagueAvgGoals, 1.5, 1e-6),
    `homeAttack=${pE0.homeAttack} avg=${pE0.leagueAvgGoals}`
  );
  check("liga dikenal, tim asing: defense tetap prior 1,0", pE0.homeDefense === 1.0 && pE0.awayDefense === 1.0);
}

// ---------------------------------------------------------------------------
// Temuan 2 — matrix Dixon-Coles: ekor tidak dibuang diam-diam
// ---------------------------------------------------------------------------
console.log("Temuan 2: matrix Dixon-Coles (cutoff adaptif)");
{
  const matrixMean = (m: number[][]) => {
    let mean = 0;
    m.forEach((row, x) => row.forEach((p, y) => (mean += (x + y) * p)));
    return mean;
  };
  const harness = (lam: number, mu: number, rho = 0) =>
    calculateDixonColes({
      homeAttack: 1, homeDefense: 1, awayAttack: 1, awayDefense: 1,
      leagueAvgGoals: mu, homeAdvantage: lam / mu, rho, maxGoals: 10,
    });

  const normal = harness(1.959, 0.996, -0.04);
  const flat = normal.score_matrix.flat();
  check("kasus normal: probabilitas finite, >= 0, jumlah ~1",
    flat.every((v) => Number.isFinite(v) && v >= 0) &&
    approx(flat.reduce((a, b) => a + b, 0), 1, 1e-9));
  check("kasus normal: ekor terbuang <= 1e-8", normal.score_matrix_tail_mass <= 1e-8,
    `tail=${normal.score_matrix_tail_mass.toExponential(2)}`);

  const mid = harness(2.3, 1.1, 0);
  check("rho=0: mean matrix konsisten dgn lambda+mu (tol 0,01)",
    approx(matrixMean(mid.score_matrix), 3.4, 0.01), `mean=${matrixMean(mid.score_matrix).toFixed(3)}`);

  // Stress case audit: lambda 16,019 / mu 1,540 — dulu 92,3% massa dibuang
  // diam-diam (mean matrix 10,49 vs expected total 17,56).
  const stress = harness(16.019, 1.54, 0);
  check("kasus ekstrem: grid melebar melebihi 11x11", stress.score_matrix.length > 11,
    `grid=${stress.score_matrix.length}`);
  check("kasus ekstrem: mean matrix ~ expected total 17,56 (tol 0,05)",
    approx(matrixMean(stress.score_matrix), 17.56, 0.05), `mean=${matrixMean(stress.score_matrix).toFixed(2)}`);
  check("kasus ekstrem: ekor terbuang <= 1e-8", stress.score_matrix_tail_mass <= 1e-8,
    `tail=${stress.score_matrix_tail_mass.toExponential(2)}`);

  // Input patologik: lambda 300 — harus gagal eksplisit, bukan distribusi jadi-jadian.
  let threw = false;
  try {
    calculateDixonColes({
      homeAttack: 300 / 1.35, awayDefense: 1, awayAttack: 1, homeDefense: 1,
      homeAdvantage: 1, leagueAvgGoals: 1.35, rho: 0,
    });
  } catch {
    threw = true;
  }
  check("input patologik (lambda=300): throw eksplisit", threw);
}

// ---------------------------------------------------------------------------
// Temuan 3 — wiring effective_prob: basis eksplisit di combineSlip
// ---------------------------------------------------------------------------
console.log("Temuan 3: wiring effective_prob (parlay basis)");
{
  const M: number[][] = [
    [0.1, 0.08, 0.02],
    [0.12, 0.1, 0.03],
    [0.2, 0.15, 0.2],
  ]; // jumlah = 1,00
  const pick = (over: Partial<SlipPick>): SlipPick => ({
    key: "k", matchId: "m1", market: "dc", selection: "1x",
    prob: 0.8, probBasis: "lab", matrix: null, ...over,
  });

  const single = combineSlip([pick({})]);
  check("pilihan tunggal lab: combined = prob efektif, basis lab",
    approx(single.combined, 0.8, 1e-12) && single.basis === "lab");

  const twoModel = combineSlip([
    pick({}),
    pick({ key: "k2", matchId: "m2", prob: 0.7, probBasis: "model" }),
  ]);
  check("campuran lab + model antar laga: basis mixed", twoModel.basis === "mixed",
    `basis=${twoModel.basis}`);

  const allModel = combineSlip([
    pick({ probBasis: "model" }),
    pick({ key: "k2", matchId: "m2", prob: 0.7, probBasis: "model" }),
  ]);
  check("semua model: basis model", allModel.basis === "model");

  // Satu laga, dua pilihan + matriks: joint EKSAK dari matriks (basis
  // "matrix"), bukan produk marginal. dc 1x marginal = 0,87; 1x2 "1"
  // marginal = 0,47; joint (1x AND 1) = sel h>a = 0,47; produk = 0,4089.
  const sameMatch = combineSlip([
    pick({ key: "a", market: "dc", selection: "1x", prob: 0.87, probBasis: "lab", matrix: M }),
    pick({ key: "b", market: "1x2", selection: "1", prob: 0.47, probBasis: "lab", matrix: M }),
  ]);
  check("satu laga multi: joint eksak matriks (0,47), bukan produk (0,4089)",
    approx(sameMatch.combined, 0.47, 1e-9), `combined=${sameMatch.combined}`);
  check("satu laga multi: grup berlabel exact + basis matrix",
    sameMatch.groups[0].exact === true && sameMatch.groups[0].basis === "matrix");
  check("hasil berisi grup matrix saja: basis hasil = model (bukan lab)",
    sameMatch.basis === "model", `basis=${sameMatch.basis}`);

  // Monotonisitas: menambah pilihan tak pernah menaikkan peluang gabungan.
  const grown = combineSlip([
    pick({}),
    pick({ key: "k2", matchId: "m2", prob: 0.7 }),
  ]);
  check("monoton: slip 2 pilihan <= slip 1 pilihan (basis sama)",
    grown.combined <= single.combined && approx(grown.combined, 0.56, 1e-12));
}

// ---------------------------------------------------------------------------
// Temuan 4 — confidence pasar khusus mengikuti coverage metrik
// ---------------------------------------------------------------------------
console.log("Temuan 4: confidence special markets (coverage metrik)");
{
  const team = (over: Partial<TeamRollingTelemetry>): TeamRollingTelemetry => ({
    team_id: "tm_test",
    sample_size: 6,
    observed_xg_samples: 6, observed_shots_samples: 6, observed_passes_samples: 6,
    observed_aerial_samples: 6, observed_crosses_samples: 6,
    observed_corners_samples: 6, observed_yellows_samples: 6,
    observed_box_touches_samples: 6,
    rolling_xg_for: 1.5, rolling_xg_against: 1.2,
    rolling_npxg_for: 1.4, rolling_npxg_against: 1.1,
    rolling_goals_for: 1.5, rolling_goals_against: 1.2,
    win_rate: 0.5, clean_sheet_rate: 0.3, form_sequence: "W-D-W",
    avg_possession_pct: 52, avg_shots_for: 13, avg_shots_on_target_for: 4.5,
    avg_shots_inside_box_for: 8, avg_big_chances_for: 1.8, avg_box_touches_for: 25,
    avg_passes_accurate_for: 380, avg_pass_accuracy_pct: 82,
    avg_crosses_accurate_for: 4.13, avg_aerial_duels_pct_for: 31.1,
    avg_duels_won_pct_for: 100, avg_ground_duels_pct_for: 68.9,
    avg_tackles_for: 16, avg_corners_for: 5.2, avg_fouls_committed: 11,
    avg_yellow_cards: 1.9,
    recent_logs: [],
    ...over,
  });

  // Reproduksi brief: aerial 6/6 tapi crosses 0 — dulu HIGH + tidak
  // terestimasi; sekarang cakupan terlemah yang bicara.
  const noCross = calculateHeadedGoalMarket(
    team({ observed_crosses_samples: 0, avg_crosses_accurate_for: null }),
    team({ observed_crosses_samples: 0, avg_crosses_accurate_for: null }),
    "E0"
  );
  check("headed: crosses kosong -> bukan HIGH, terestimasi",
    noCross.confidence_tier !== "HIGH" && noCross.is_estimated === true,
    `tier=${noCross.confidence_tier} est=${noCross.is_estimated}`);
  check("headed: crosses kosong -> INSUFFICIENT_DATA",
    noCross.confidence_tier === "INSUFFICIENT_DATA");

  // Semua metrik ter-cover penuh -> HIGH tetap bisa dicapai.
  const full = calculateHeadedGoalMarket(team({}), team({}), "E0");
  check("headed: coverage penuh -> HIGH + tidak terestimasi",
    full.confidence_tier === "HIGH" && full.is_estimated === false,
    `tier=${full.confidence_tier} est=${full.is_estimated}`);

  // Counter penuh tapi satu metrik terimputasi (share aerial tak terhitung
  // karena duels_won null) -> HIGH tertutup, jatuh ke MODERATE + estimated.
  const imputed = calculateHeadedGoalMarket(
    team({ avg_duels_won_pct_for: null }),
    team({}),
    "E0"
  );
  check("headed: satu metrik terimputasi -> MODERATE + terestimasi (bukan HIGH)",
    imputed.confidence_tier === "MODERATE" && imputed.is_estimated === true,
    `tier=${imputed.confidence_tier} est=${imputed.is_estimated}`);

  // Corners: 6 laga tapi data corner tak pernah terobservasi.
  const cornersNone = calculateCornersMarket(
    team({ observed_corners_samples: 0, avg_corners_for: null }),
    team({ observed_corners_samples: 0, avg_corners_for: null }),
    "E0"
  );
  check("corners: counter corner 0 -> INSUFFICIENT_DATA + observed {0,0}",
    cornersNone.confidence_tier === "INSUFFICIENT_DATA" &&
      cornersNone.observed_samples.home === 0 && cornersNone.observed_samples.away === 0,
    `tier=${cornersNone.confidence_tier} obs=${JSON.stringify(cornersNone.observed_samples)}`);

  const cornersFull = calculateCornersMarket(
    team({ observed_corners_samples: 5 }),
    team({ observed_corners_samples: 6 }),
    "E0"
  );
  check("corners: observed_samples = counter metrik {5,6}, tier HIGH",
    cornersFull.observed_samples.home === 5 && cornersFull.observed_samples.away === 6 &&
      cornersFull.confidence_tier === "HIGH",
    `obs=${JSON.stringify(cornersFull.observed_samples)} tier=${cornersFull.confidence_tier}`);

  // Cards: cakupan kartu cuma 1 laga walau sample_size 6.
  const cardsThin = calculateCardsMarket(
    team({ observed_yellows_samples: 1 }),
    team({ observed_yellows_samples: 1 }),
    "E0"
  );
  check("cards: counter kartu 1 -> LOW + terestimasi (bukan dari sample_size)",
    cardsThin.confidence_tier === "LOW" && cardsThin.is_estimated === true,
    `tier=${cardsThin.confidence_tier}`);
}

// ---------------------------------------------------------------------------
// Temuan 3 (lanjutan, async) — migrasi + backfill + roundtrip ledger.
// Ledger dibuka di direktori sementara: DB produksi tidak disentuh.
// ---------------------------------------------------------------------------
void (async () => {
  console.log("Temuan 3b: ledger effective_prob (migrasi + backfill + roundtrip)");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { DatabaseSync } = await import("node:sqlite");
  const origCwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "picks-ledger-test-"));
  try {
    fs.mkdirSync(path.join(tmp, "data"), { recursive: true });
    const raw = new DatabaseSync(path.join(tmp, "data", "picks.db"));
    raw.exec(`
      CREATE TABLE picks (
        id INTEGER PRIMARY KEY AUTOINCREMENT, created_utc TEXT NOT NULL,
        match_id TEXT NOT NULL, competition_canonical_id TEXT, kickoff_utc TEXT,
        market TEXT NOT NULL, selection TEXT NOT NULL, model_prob REAL NOT NULL,
        market_prob REAL, sm_prob REAL, agreement_spread REAL, gate_status TEXT,
        grade TEXT, source TEXT NOT NULL DEFAULT 'lab', notes TEXT, package_id INTEGER
      );
      INSERT INTO picks (created_utc, match_id, market, selection, model_prob, source, notes)
        VALUES ('2026-11-08T00:00:00Z', 'm-backfill', 'dc', '1x', 0.75, 'live-run',
                'pick-slate fase B; eff=0.7271 lab-band pita 70–75 n=4621');
      INSERT INTO picks (created_utc, match_id, market, selection, model_prob, source, notes)
        VALUES ('2026-11-08T00:00:00Z', 'm-noeff', 'dc', '1x', 0.75, 'live-run', NULL);
    `);
    raw.close();

    process.chdir(tmp);
    const ledger = await import("../lib/picks/ledger");
    const db = ledger.getPicksDb();
    const cols = (db.prepare("PRAGMA table_info(picks)").all() as { name: string }[]).map((c) => c.name);
    check("migrasi: kolom effective_prob + effective_source dibuat",
      cols.includes("effective_prob") && cols.includes("effective_source"));

    const bf = db.prepare("SELECT effective_prob, effective_source FROM picks WHERE match_id = 'm-backfill'").get() as
      { effective_prob: number | null; effective_source: string | null };
    check("backfill: eff dari notes terisi terstruktur (0,7271 / lab-band)",
      bf.effective_prob === 0.7271 && bf.effective_source === "lab-band",
      JSON.stringify(bf));
    const ne = db.prepare("SELECT effective_prob, effective_source FROM picks WHERE match_id = 'm-noeff'").get() as
      { effective_prob: number | null; effective_source: string | null };
    check("baris tanpa eff di notes tetap NULL (tak dikarang)",
      ne.effective_prob === null && ne.effective_source === null);

    ledger.recordPick({
      match_id: "m-new", market: "dc", selection: "1x", model_prob: 0.8,
      effective_prob: 0.75, effective_source: "lab-band", source: "live-run",
      kickoff_utc: "2099-01-01T00:00:00Z",
    });
    const nw = db.prepare("SELECT effective_prob, effective_source FROM picks WHERE match_id = 'm-new'").get() as
      { effective_prob: number | null; effective_source: string | null };
    check("roundtrip: recordPick menyimpan kolom efektif",
      nw.effective_prob === 0.75 && nw.effective_source === "lab-band", JSON.stringify(nw));
  } catch (err) {
    failures++;
    console.log(`  FAIL pengecualian ledger test: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    process.chdir(origCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(failures === 0 ? "\nSEMUA LOLOS" : `\n${failures} KEGAGALAN`);
  process.exit(failures === 0 ? 0 : 1);
})();
