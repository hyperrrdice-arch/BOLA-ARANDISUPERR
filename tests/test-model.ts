/**
 * TEST:MODEL — suite K4 (paritas model lab/produksi), menjalankan Q01–Q04
 * bab QA pada sampel yang dinyatakan dokumen + acceptance.json:
 *
 *  A. Q01 integritas probabilitas: matriks fixture joint_matrix
 *     (1X2 = 0,47/0,40/0,13; 1X = 0,87; irisan 1∩1X = 0,47; 1∩2 = 0;
 *     toleransi 1e-8) + invarian matriks Dixon-Coles asli (Σ sel = 1 ±
 *     1e-9, produk dua laga independen cocok dalam 1e-12).
 *  B. Manifest (Q03): field wajib lengkap, identitas κ=10/kfit=10,
 *     contentHash regenerasi-stabil, berhenti bernama
 *     (manifest_missing/corrupt/field_missing/hash_mismatch/
 *     ratings_mismatch), konvensi hash sama dengan ratings_marker slate.
 *  C. Q02 determinisme & pemisahan latih/uji: fit dua kali pada masukan
 *     sama → parameter identik persis; selectTrainingRows menolak baris
 *     bertanggal ≥ cutoff.
 *  D. Gerbang promosi (Q04): fit latih lebih kecil DITOLAK; cakupan
 *     menyusut = peringatan; paritas > 0,005 ditolak; perubahan
 *     konfigurasi dicatat sebagai note jalur K5.
 *  E. Snapshot as-of (Q03): suntikan observasi masa depan tidak mengubah
 *     snapshot; observasi sah sebelumnya mengubahnya; tanggal-saja pada
 *     hari keputusan belum terhitung.
 *  F. Sandbox ujung-ke-ujung (Q03/Q04): manifest bootstrap pada artefak
 *     asli; evaluator lab vs runner produksi (buildQuantPackage planner)
 *     pada 20 laga sampel — selisih per probabilitas ≤ 1e-8 dan
 *     Σ|Δp| ≤ 0,005; regenerasi lab identik; refresh (bangun kandidat)
 *     TIDAK mengubah manifest aktif; promosi CLI hanya lewat gerbang;
 *     manifest hilang/rusak → evaluator berhenti bernama; identitas
 *     manifest tercap pada pick yang diterbitkan jalur publikasi K2.
 *
 * Pakai: npm run test:quant (suite ini dirantai di dalamnya)
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  REPO_ROOT,
  Suite,
  buildCoreSchemas,
  createFixtureEnv,
  runScript,
  settleFixtureEnv,
  type FixtureEnv,
} from "./helpers/fixture-env";
import { calculateDixonColes } from "../lib/quant/dixon-coles";
import { jointProbFromMatrix, probFromMatrix } from "../lib/picks/engine";
import {
  fitLeagueRatings,
  fitRhoOnTrain,
  selectTrainingRows,
  type FitMatchRow,
} from "../lib/quant/fit";
import {
  ModelManifestError,
  buildManifest,
  loadManifestFile,
  parseManifest,
  ratingsHashOf,
  serializeManifest,
  verifyManifestRatings,
  type ModelManifest,
} from "../lib/quant/model-manifest";
import { PARITY_SUM_ABS_TOLERANCE, evaluatePromotion } from "../lib/quant/promotion-gate";
import { buildFormSnapshot, isAvailableAt, type TeamResultRow } from "../lib/quant/snapshot";
import type { CalibratedRatingsFile } from "../lib/quant/ratings-loader";

const suite = new Suite("test:model");
const approx = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const throwsCode = (fn: () => unknown, code: string): boolean => {
  try {
    fn();
    return false;
  } catch (err) {
    return err instanceof ModelManifestError && err.code === code;
  }
};

// ---------------------------------------------------------------------------
// A. Q01 — integritas probabilitas
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
console.log("A. Q01 integritas probabilitas (fixture joint_matrix + matriks asli)");
{
  // acceptance.json → joint_matrix (sumbu baris gol kandang, kolom gol tamu).
  const M = [
    [0.1, 0.08, 0.02],
    [0.12, 0.1, 0.03],
    [0.2, 0.15, 0.2],
  ];
  suite.check("Q01 jumlah sel matriks fixture = 1", approx(M.flat().reduce((s, v) => s + v, 0), 1, 1e-9));
  suite.check("Q01 P(1) = 0,47", approx(probFromMatrix(M, "1x2", "1"), 0.47, 1e-8), `=${probFromMatrix(M, "1x2", "1")}`);
  suite.check("Q01 P(X) = 0,40", approx(probFromMatrix(M, "1x2", "x"), 0.4, 1e-8));
  suite.check("Q01 P(2) = 0,13", approx(probFromMatrix(M, "1x2", "2"), 0.13, 1e-8));
  suite.check("Q01 P(1X) = 0,87", approx(probFromMatrix(M, "dc", "1x"), 0.87, 1e-8));
  const j1x = jointProbFromMatrix(M, { market: "1x2", selection: "1" }, { market: "dc", selection: "1x" });
  const j12 = jointProbFromMatrix(M, { market: "1x2", selection: "1" }, { market: "1x2", selection: "2" });
  suite.check("Q01 irisan 1∩1X = 0,47", approx(j1x, 0.47, 1e-8), `=${j1x}`);
  suite.check("Q01 irisan 1∩2 = 0 (saling meniadakan)", j12 === 0, `=${j12}`);
  suite.check(
    "Q01 irisan konsisten: P(1X) ≥ 1∩1X ≥ 1∩2",
    probFromMatrix(M, "dc", "1x") >= j1x && j1x >= j12,
  );

  // Matriks Dixon-Coles asli dari mesin produksi.
  const dc = calculateDixonColes({
    homeAttack: 1.25, homeDefense: 0.92, awayAttack: 1.08, awayDefense: 1.03,
    homeAdvantage: 1.24, leagueAvgGoals: 1.33, rho: -0.06,
  });
  const cellSum = dc.score_matrix.flat().reduce((s, v) => s + v, 0);
  suite.check("Q01 Σ sel matriks DC = 1 ± 1e-9", approx(cellSum, 1, 1e-9), `sum=${cellSum}`);
  suite.check(
    "Q01 semua sel matriks DC ≥ 0",
    dc.score_matrix.flat().every((v) => v >= 0),
  );

  // Produk dua laga independen cocok dalam 1e-12 (distribusi gabungan
  // dibangun eksplisit sebagai produk luar kedua matriks).
  const dc2 = calculateDixonColes({
    homeAttack: 0.94, homeDefense: 1.11, awayAttack: 1.31, awayDefense: 0.88,
    homeAdvantage: 1.18, leagueAvgGoals: 1.29, rho: -0.03,
  });
  const p1 = probFromMatrix(dc.score_matrix, "1x2", "1");
  const p2 = probFromMatrix(dc2.score_matrix, "1x2", "1");
  let both = 0;
  for (let h1 = 0; h1 < dc.score_matrix.length; h1++)
    for (let a1 = 0; a1 < dc.score_matrix[h1].length; a1++)
      for (let h2 = 0; h2 < dc2.score_matrix.length; h2++)
        for (let a2 = 0; a2 < dc2.score_matrix[h2].length; a2++)
          if (h1 > a1 && h2 > a2) both += dc.score_matrix[h1][a1] * dc2.score_matrix[h2][a2];
  suite.check("Q01 produk dua laga = peluang gabungan (1e-12)", approx(both, p1 * p2, 1e-12), `gabungan=${both} produk=${p1 * p2}`);
}

// ---------------------------------------------------------------------------
// B. Manifest — kelengkapan field, identitas, integritas (Q03)
// ---------------------------------------------------------------------------
console.log("\nB. manifest model (Q03)");
function synthRatings(leagues: Record<string, unknown>): CalibratedRatingsFile {
  return {
    version: "2.0-dixon-coles-mle",
    compiledAt: "2026-11-20T00:00:00.000Z",
    totalLeagues: Object.keys(leagues).length,
    totalTeams: 0,
    leagues,
  } as unknown as CalibratedRatingsFile;
}
function synthLeague(div: string, matches: number, status: string | undefined, teams: number) {
  const teamMap: Record<string, unknown> = {};
  for (let i = 0; i < teams; i++) {
    teamMap[`${div}-T${i}`] = {
      name: `${div}-T${i}`, attack: 1.1, defense: 0.9, matchesCount: 40,
      goalsScored: 50, goalsConceded: 40, lastMatchDate: "2026-11-14",
    };
  }
  return {
    div, leagueName: `Liga ${div}`, country: "Testland", seasonCount: 2,
    totalMatches: matches, leagueAvgGoals: 1.33, homeAdvantage: 1.21, rho: -0.05,
    calibrationDate: "2026-11-01",
    ...(status ? { calibrationStatus: status } : {}),
    teams: teamMap,
  };
}
{
  const ratings = synthRatings({
    E0: synthLeague("E0", 600, "calibrated", 4),
    SP1: synthLeague("SP1", 400, "partial", 4),
  });
  const raw = JSON.stringify(ratings);
  const args = {
    ratingsRaw: raw,
    generatedBy: "test:model",
    generatedAt: "2026-11-20T00:00:00.000Z",
    window: { start: "2025-08-01", end: "2026-11-14", basis: "match_dates" as const },
  };
  const m = buildManifest(args);
  suite.check("manifest: κ = 10 dan kfit = 10 (identitas champion)", m.config.kappa === 10 && m.config.kfit === 10);
  suite.check("manifest: modelVersion memuat kfit10", m.modelVersion.includes("kfit10"), m.modelVersion);
  suite.check(
    "manifest: field wajib lengkap (versi skema, engine, training, kalibrasi, hash)",
    m.manifestVersion === 1 &&
      m.engine.ratingsVersion === "2.0-dixon-coles-mle" &&
      m.training.totalMatches === 1000 &&
      m.training.leagueCount === 2 &&
      m.training.teamCount === 8 &&
      m.training.window.start === "2025-08-01" &&
      m.training.perLeague.length === 2 &&
      m.calibration.calibrated === 1 &&
      m.calibration.partial === 1 &&
      m.ratingsHash.length > 0 &&
      m.contentHash.length > 0,
  );
  suite.check(
    "manifest: ratingsHash = konvensi ratings_marker slate (sha256 16 hex)",
    m.ratingsHash === `sha256:${createHash("sha256").update(raw).digest("hex").slice(0, 16)}` &&
      m.ratingsHash === ratingsHashOf(raw),
  );
  const roundtrip = parseManifest(serializeManifest(m), "test");
  suite.check("manifest: parse(serialize) lolos verifikasi hash isi", roundtrip.contentHash === m.contentHash);

  const regen = buildManifest(args);
  suite.check(
    "manifest: regenerasi dari artefak+konfigurasi sama → contentHash & bytes identik",
    regen.contentHash === m.contentHash && serializeManifest(regen) === serializeManifest(m),
  );

  const tampered = JSON.parse(serializeManifest(m)) as ModelManifest;
  tampered.config.kfit = 20;
  suite.check(
    "manifest: isi diubah tanpa bangun ulang → manifest_hash_mismatch",
    throwsCode(() => parseManifest(JSON.stringify(tampered), "test"), "manifest_hash_mismatch"),
  );
  const incomplete = JSON.parse(serializeManifest(m)) as unknown as Record<string, unknown>;
  delete (incomplete.training as Record<string, unknown>).totalMatches;
  suite.check(
    "manifest: field wajib hilang → manifest_field_missing",
    throwsCode(() => parseManifest(JSON.stringify(incomplete), "test"), "manifest_field_missing"),
  );
  suite.check(
    "manifest: JSON rusak → manifest_corrupt",
    throwsCode(() => parseManifest("{bukan json", "test"), "manifest_corrupt"),
  );
  suite.check(
    "manifest: file tidak ada → manifest_missing",
    throwsCode(() => loadManifestFile(path.join(REPO_ROOT, "data", "tidak-ada-manifest.json")), "manifest_missing"),
  );
  suite.check("manifest: verifyManifestRatings cocok untuk artefak asal", (() => {
    try { verifyManifestRatings(m, raw); return true; } catch { return false; }
  })());
  suite.check(
    "manifest: artefak berubah → manifest_ratings_mismatch",
    throwsCode(() => verifyManifestRatings(m, `${raw} `), "manifest_ratings_mismatch"),
  );
}

// ---------------------------------------------------------------------------
// C. Q02 — determinisme fit & pemisahan latih/uji
// ---------------------------------------------------------------------------
console.log("\nC. Q02 determinisme fit + pemisahan latih/uji");
{
  const rows: FitMatchRow[] = [];
  let t = Date.parse("2026-01-05T15:00:00.000Z");
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      if (i === j) continue;
      rows.push({
        competition_id: "sm:test", season: "2026",
        utc_date: new Date(t).toISOString(),
        home_team_id: `t${i}`, away_team_id: `t${j}`,
        home_score: (i * 7 + j * 3) % 4, away_score: (i * 2 + j * 5) % 3,
      });
      t += 3 * 86400_000;
    }
  }
  const nowMs = Date.parse("2026-08-01T00:00:00.000Z");
  const serializeFit = (f: ReturnType<typeof fitLeagueRatings>) =>
    f === null
      ? "null"
      : JSON.stringify({
          avg: f.leagueAvgGoals, ha: f.homeAdvantage, scale: f.scaleRatio, n: f.nMatches,
          att: [...f.attack.entries()].sort(), def: [...f.defense.entries()].sort(),
          lamH: f.lamHome, lamA: f.lamAway,
        });
  const f1 = fitLeagueRatings(rows, { nowMs });
  const f2 = fitLeagueRatings(rows, { nowMs });
  suite.check("Q02 fit menghasilkan parameter (liga sintetis 30 laga)", f1 !== null && f1.nMatches === 30);
  suite.check("Q02 fit dua kali pada masukan sama → parameter identik persis", serializeFit(f1) === serializeFit(f2));
  suite.check(
    "Q02 fit rho deterministik",
    f1 !== null && fitRhoOnTrain(rows, f1) === fitRhoOnTrain(rows, f1),
  );

  const cutoff = "2026-08-01T00:00:00.000Z";
  const withFuture: FitMatchRow[] = [
    ...rows,
    { competition_id: "sm:test", season: "2026", utc_date: cutoff, home_team_id: "t0", away_team_id: "t1", home_score: 9, away_score: 9 },
    { competition_id: "sm:test", season: "2026", utc_date: "2026-09-01T15:00:00.000Z", home_team_id: "t2", away_team_id: "t3", home_score: 8, away_score: 0 },
  ];
  const train = selectTrainingRows(withFuture, cutoff);
  suite.check(
    "Q02 selectTrainingRows menolak baris ≥ cutoff (30 dari 32)",
    train.length === 30 && train.every((r) => r.utc_date < cutoff),
    `kept=${train.length}`,
  );
  suite.check(
    "Q02 fit pada baris terseleksi = fit pada data dalam-jendela (filter tak mengubah fit sah)",
    serializeFit(fitLeagueRatings(train, { nowMs })) === serializeFit(f1),
  );
}

// ---------------------------------------------------------------------------
// D. Gerbang promosi (Q04)
// ---------------------------------------------------------------------------
console.log("\nD. gerbang promosi (Q04)");
{
  const mk = (
    leagues: Record<string, unknown>,
    config?: Parameters<typeof buildManifest>[0]["config"],
  ): ModelManifest =>
    buildManifest({
      ratingsRaw: JSON.stringify(synthRatings(leagues)),
      generatedBy: "test:model",
      generatedAt: "2026-11-20T00:00:00.000Z",
      window: { start: "2025-08-01", end: "2026-11-14", basis: "match_dates" },
      config,
    });
  const champion = mk({ E0: synthLeague("E0", 600, "calibrated", 4), SP1: synthLeague("SP1", 400, "partial", 4) });

  const smaller = mk({ E0: synthLeague("E0", 500, "calibrated", 4) });
  const evSmaller = evaluatePromotion({ champion, candidate: smaller, parity: { sampleSize: 20, sumAbsDelta: 0 } });
  suite.check(
    "Q04 gerbang: fit latih lebih kecil DITOLAK",
    evSmaller.decision === "reject" && evSmaller.reasons.some((r) => r.includes("candidate_training_smaller")),
    JSON.stringify(evSmaller.reasons),
  );

  const shrunk = mk({ E0: synthLeague("E0", 1100, "calibrated", 4) });
  const evShrunk = evaluatePromotion({ champion, candidate: shrunk, parity: { sampleSize: 20, sumAbsDelta: 0 } });
  suite.check(
    "Q04 gerbang: cakupan menyusut = peringatan, bukan blokir",
    evShrunk.decision === "promote" && evShrunk.warnings.some((w) => w.includes("coverage_missing_league")),
    JSON.stringify(evShrunk.warnings),
  );

  const grown = mk({ E0: synthLeague("E0", 700, "calibrated", 4), SP1: synthLeague("SP1", 500, "partial", 4) });
  const evParityBad = evaluatePromotion({ champion, candidate: grown, parity: { sampleSize: 20, sumAbsDelta: PARITY_SUM_ABS_TOLERANCE + 0.001 } });
  suite.check(
    "Q04 gerbang: paritas Σ|Δp| > 0,005 DITOLAK",
    evParityBad.decision === "reject" && evParityBad.reasons.some((r) => r.includes("parity_delta_exceeded")),
  );
  const evParityOk = evaluatePromotion({ champion, candidate: grown, parity: { sampleSize: 20, sumAbsDelta: 0.001 } });
  suite.check(
    "Q04 gerbang: kandidat sah + paritas dalam toleransi → promote",
    evParityOk.decision === "promote" && evParityOk.notes.some((n) => n.includes("parity_ok")),
  );

  const challenger = mk(
    { E0: synthLeague("E0", 700, "calibrated", 4), SP1: synthLeague("SP1", 500, "partial", 4) },
    { kappa: 20, kfit: 20, halfLifeDays: 365, rhoMode: "zero", blend: { kind: "james-stein", kappaScale: 2 } },
  );
  const evChallenger = evaluatePromotion({ champion, candidate: challenger, parity: { sampleSize: 20, sumAbsDelta: 0 } });
  suite.check(
    "Q04 gerbang: perubahan konfigurasi dicatat sebagai note jalur eksperimen (K5)",
    evChallenger.notes.some((n) => n.includes("config_change")),
    JSON.stringify(evChallenger.notes),
  );
}

// ---------------------------------------------------------------------------
// E. Snapshot as-of (Q03, level unit)
// ---------------------------------------------------------------------------
console.log("\nE. snapshot as-of (Q03)");
{
  const decision = "2026-11-21T12:00:00.000Z";
  const base: TeamResultRow[] = [
    { team: "Arsenal", date: "2026-11-10", goalsFor: 2, goalsAgainst: 0 },
    { team: "Arsenal", date: "2026-11-14", goalsFor: 1, goalsAgainst: 1 },
  ];
  const s0 = buildFormSnapshot(base, "Arsenal", decision);
  suite.check("Q03 snapshot dasar: 2 observasi, rata-rata 1,5", s0.sampleSize === 2 && approx(s0.goalsAvg ?? -1, 1.5, 1e-12));

  const future: TeamResultRow[] = [
    ...base,
    { team: "Arsenal", date: "2026-11-25", availableAt: "2026-11-25T00:00:00.000Z", goalsFor: 9, goalsAgainst: 0 },
  ];
  const sFuture = buildFormSnapshot(future, "Arsenal", decision);
  suite.check(
    "Q03 suntikan masa depan (available_at > keputusan) tidak mengubah snapshot",
    sFuture.sampleSize === s0.sampleSize && sFuture.goalsAvg === s0.goalsAvg,
  );

  const sameDay: TeamResultRow[] = [...base, { team: "Arsenal", date: "2026-11-21", goalsFor: 9, goalsAgainst: 0 }];
  const sSameDay = buildFormSnapshot(sameDay, "Arsenal", decision);
  suite.check(
    "Q03 hasil tanggal-saja pada hari keputusan belum terhitung",
    sSameDay.sampleSize === 2 && sSameDay.goalsAvg === s0.goalsAvg,
  );

  const legit: TeamResultRow[] = [...base, { team: "Arsenal", date: "2026-11-18", goalsFor: 4, goalsAgainst: 0 }];
  const sLegit = buildFormSnapshot(legit, "Arsenal", decision);
  suite.check(
    "Q03 observasi sah sebelumnya mengubah snapshot (3 obs, rata-rata 7/3)",
    sLegit.sampleSize === 3 && approx(sLegit.goalsAvg ?? -1, 7 / 3, 1e-12),
  );
  suite.check(
    "Q03 isAvailableAt: available_at == keputusan terhitung; sesudahnya tidak",
    isAvailableAt({ team: "Arsenal", date: "2026-11-20", availableAt: decision, goalsFor: 0, goalsAgainst: 0 }, decision) &&
      !isAvailableAt({ team: "Arsenal", date: "2026-11-20", availableAt: "2026-11-21T12:00:00.001Z", goalsFor: 0, goalsAgainst: 0 }, decision),
  );
}

// ---------------------------------------------------------------------------
// F. Sandbox ujung-ke-ujung: paritas lab vs produksi + gerbang CLI (Q03/Q04)
// ---------------------------------------------------------------------------
console.log("\nF. sandbox: paritas 20 laga + promosi + berhenti bernama (Q03/Q04)");
const env: FixtureEnv = createFixtureEnv("model");
let envFailed = false;
try {
  for (const f of ["calibrated_ratings.json", "league-canonical.json", "team-canonical.json", "fixture-links.json"]) {
    fs.copyFileSync(path.join(REPO_ROOT, "data", f), path.join(env.dataDir, f));
  }

  const TEAMS = [
    "Arsenal", "Aston Villa", "Brentford", "Brighton & Hove Albion", "Chelsea",
    "Crystal Palace", "Everton", "Fulham", "Burnley", "Coventry City",
  ];
  const DECISION = "2026-11-21T12:00:00.000Z";
  const samples: Record<string, unknown>[] = [];
  for (let i = 0; i < 10; i++) {
    for (const off of [1, 3]) {
      samples.push({
        id: `p${samples.length + 1}`,
        homeTeam: TEAMS[i],
        awayTeam: TEAMS[(i + off) % 10],
        leagueHint: "English Premier League",
        decisionAt: DECISION,
        form: { homeGoalsAvg: null, awayGoalsAvg: null, homeSampleN: 0, awaySampleN: 0 },
      });
    }
  }
  // Sampel pertama membawa form nyata: rata-rata turunan snapshot harus
  // sama persis dengan form yang dinyatakan untuk jalur produksi.
  const formHome: TeamResultRow[] = [3, 2, 1, 2, 1].map((g, k) => ({
    team: "Arsenal", date: `2026-11-${String(1 + k * 3).padStart(2, "0")}`, goalsFor: g, goalsAgainst: 0,
  }));
  const formAway: TeamResultRow[] = [1, 0, 1, 0, 1].map((g, k) => ({
    team: "Aston Villa", date: `2026-11-${String(2 + k * 3).padStart(2, "0")}`, goalsFor: g, goalsAgainst: 1,
  }));
  samples[0].homeResults = formHome;
  samples[0].awayResults = formAway;
  samples[0].form = { homeGoalsAvg: 1.8, awayGoalsAvg: 0.6, homeSampleN: 5, awaySampleN: 5 };
  const derived = buildFormSnapshot(formHome, "Arsenal", DECISION);
  suite.check(
    "Q03 form turunan snapshot = form terdeklarasi (1,8 dari 5 laga)",
    derived.sampleSize === 5 && approx(derived.goalsAvg ?? -1, 1.8, 1e-12),
  );

  const samplesPath = path.join(env.root, "samples.json");
  fs.writeFileSync(samplesPath, JSON.stringify({ samples }));

  // 1) Bootstrap manifest aktif pada artefak asli.
  const boot = runScript(env, "scripts/build-model-manifest.ts", ["--activate", `--data-dir=${env.dataDir}`]);
  suite.check("sandbox: builder --activate exit 0", boot.code === 0, boot.stderr.slice(0, 300));
  const activePath = path.join(env.dataDir, "model-manifest.json");
  const manifest = loadManifestFile(activePath);
  suite.check(
    "Q04 manifest artefak asli: κ/kfit 10, cakupan konsisten internal",
    manifest.config.kappa === 10 &&
      manifest.config.kfit === 10 &&
      manifest.training.leagueCount === manifest.training.perLeague.length &&
      manifest.training.totalMatches ===
        manifest.training.perLeague.reduce((s, l) => s + l.matches, 0) &&
      manifest.training.totalMatches > 10000,
    `liga=${manifest.training.leagueCount} latih=${manifest.training.totalMatches}`,
  );
  suite.check("Q04 manifest cocok ketat dengan artefak rating sandbox", (() => {
    try {
      verifyManifestRatings(manifest, fs.readFileSync(path.join(env.dataDir, "calibrated_ratings.json"), "utf8"));
      return true;
    } catch { return false; }
  })());

  // 2) Evaluator lab dua kali — regenerasi harus identik (Q04).
  const labEnv = { TSX_TSCONFIG_PATH: path.join(REPO_ROOT, "tsconfig.json") };
  const labOut1 = path.join(env.root, "lab1.json");
  const lab1 = runScript(env, "scripts/evaluate-model.ts", [
    `--samples=${samplesPath}`, `--data-dir=${env.dataDir}`, `--out=${labOut1}`,
  ], labEnv);
  suite.check("sandbox: evaluator lab exit 0", lab1.code === 0, lab1.stderr.slice(0, 300));
  const labOut2 = path.join(env.root, "lab2.json");
  const lab2 = runScript(env, "scripts/evaluate-model.ts", [
    `--samples=${samplesPath}`, `--data-dir=${env.dataDir}`, `--out=${labOut2}`,
  ], labEnv);
  suite.check(
    "Q04 regenerasi evaluator: dua run menghasilkan baris prediksi identik",
    lab2.code === 0 && fs.readFileSync(labOut1, "utf8") === fs.readFileSync(labOut2, "utf8"),
  );
  const labRows = (JSON.parse(fs.readFileSync(labOut1, "utf8")) as { rows: Record<string, number | string>[] }).rows;
  suite.check(
    "Q04 baris lab membawa identitas manifest (modelVersion + ratingsHash)",
    labRows.length === 20 &&
      labRows.every((r) => r.modelVersion === manifest.modelVersion && r.ratingsHash === manifest.ratingsHash),
  );

  // 3) Runner produksi (buildQuantPackage planner — jalur slate).
  const prodOut = path.join(env.root, "prod.json");
  const prod = runScript(env, "tests/helpers/predict-runner.ts", [
    `--samples=${samplesPath}`, `--out=${prodOut}`,
  ], {
    TSX_TSCONFIG_PATH: path.join(REPO_ROOT, "tsconfig.json"),
    NINE_ROUTER_BASE_URL: "http://127.0.0.1:9",
    NINE_ROUTER_API_KEY: "placeholder",
    ROUTER9_API_KEY: "placeholder",
  });
  suite.check("sandbox: runner produksi exit 0", prod.code === 0, prod.stderr.slice(0, 400));
  const prodRows = (JSON.parse(fs.readFileSync(prodOut, "utf8")) as { rows: Record<string, number | string>[] }).rows;
  suite.check("paritas: kedua jalur menghasilkan 20 baris sampel", labRows.length === 20 && prodRows.length === 20);

  // 4) Paritas numerik.
  const prodById = new Map(prodRows.map((r) => [r.id, r]));
  let maxAbs = 0;
  let sumAbs = 0;
  for (const lr of labRows) {
    const pr = prodById.get(lr.id as string);
    if (!pr) continue;
    for (const f of ["probHome", "probDraw", "probAway"] as const) {
      const d = Math.abs((lr[f] as number) - (pr[f] as number));
      if (d > maxAbs) maxAbs = d;
      sumAbs += d;
    }
  }
  suite.check("Q03 paritas: selisih per probabilitas ≤ 1e-8 (dokumen Q02)", maxAbs <= 1e-8, `maxAbs=${maxAbs}`);
  suite.check(
    `Q03 paritas: Σ|Δp| ≤ ${PARITY_SUM_ABS_TOLERANCE} pada 20 laga`,
    sumAbs <= PARITY_SUM_ABS_TOLERANCE,
    `sumAbs=${sumAbs}`,
  );
  const parityPath = path.join(env.root, "parity.json");
  fs.writeFileSync(parityPath, JSON.stringify({ sampleSize: 20, sumAbsDelta: sumAbs }));

  // 5) Refresh TIDAK mempromosikan diam-diam: bangun kandidat dari artefak
  // yang berubah; manifest aktif harus byte-identik.
  const activeBefore = fs.readFileSync(activePath, "utf8");
  const ratingsPath = path.join(env.dataDir, "calibrated_ratings.json");
  const ratingsObj = JSON.parse(fs.readFileSync(ratingsPath, "utf8")) as Record<string, unknown>;
  ratingsObj.compiledAt = "2026-11-21T00:00:00.000Z";
  fs.writeFileSync(ratingsPath, JSON.stringify(ratingsObj, null, 2));
  const candBuild = runScript(env, "scripts/build-model-manifest.ts", [`--data-dir=${env.dataDir}`]);
  const candidatePath = path.join(env.dataDir, "model-manifest.candidate.json");
  suite.check(
    "refresh: builder kandidat exit 0 + file kandidat terbit",
    candBuild.code === 0 && fs.existsSync(candidatePath),
    candBuild.stderr.slice(0, 300),
  );
  suite.check(
    "refresh: manifest AKTIF tidak berubah oleh jalur fit (tidak ada promosi diam-diam)",
    fs.readFileSync(activePath, "utf8") === activeBefore,
  );

  // 6) Promosi CLI (Item 24 fail-closed): tanpa bukti lengkap → reject;
  // kandidat sah (latih sama) + paritas + bukti lengkap → promote.
  const candManifest = JSON.parse(fs.readFileSync(candidatePath, "utf8")) as {
    contentHash: string;
    ratingsHash: string;
    modelVersion: string;
  };
  const promoteNoEvidence = runScript(env, "scripts/promote-model.ts", [
    `--data-dir=${env.dataDir}`, `--parity-file=${parityPath}`,
  ]);
  suite.check(
    "gerbang CLI: tanpa bukti promosi ditolak fail-closed (exit 2)",
    promoteNoEvidence.code === 2 &&
      promoteNoEvidence.stdout.includes("decision_missing") &&
      fs.readFileSync(activePath, "utf8") === activeBefore,
    `code=${promoteNoEvidence.code} out=${promoteNoEvidence.stdout.slice(0, 200)}`,
  );
  const evDir = path.join(env.root, "promosi-bukti");
  fs.mkdirSync(evDir, { recursive: true });
  const decisionPath = path.join(evDir, "decision.json");
  fs.writeFileSync(
    decisionPath,
    JSON.stringify({
      decision: "eligible_for_shadow",
      gate_checks: [
        { id: "sample_floor", observed: 1.65, threshold: 1, pass: true },
        { id: "mean_delta", observed: -0.006, threshold: -0.005, pass: true },
        { id: "bootstrap_upper", observed: -0.001, threshold: 0, pass: true },
        { id: "coverage_drop", observed: 0, threshold: 0.02, pass: true },
        { id: "brier_increase", observed: 0.0001, threshold: 0.002, pass: true },
      ],
      headline: { n: 6708, coverage_champion: 1, coverage_candidate: 1 },
      promotion_performed: false,
    }),
  );
  const runManifestPath = path.join(evDir, "run-manifest.json");
  fs.writeFileSync(
    runManifestPath,
    JSON.stringify({
      tool: "tests/test-model.ts (sandbox Item 24)",
      promotion: {
        candidate_content_hash: candManifest.contentHash,
        candidate_ratings_hash: candManifest.ratingsHash,
        candidate_model_version: candManifest.modelVersion,
        input_hashes: { matches: "sha256:a9ce4587" },
        coverage: { candidate: 1, champion: 1 },
      },
    }),
  );
  const approvalPath = path.join(evDir, "approval.json");
  fs.writeFileSync(
    approvalPath,
    JSON.stringify({
      approved: true,
      approved_by: "Arandi (pemilik)",
      approved_at_utc: "2026-11-24T15:00:00.000Z",
      candidate_content_hash: candManifest.contentHash,
    }),
  );
  const rollbackPath = path.join(evDir, "rollback.md");
  fs.writeFileSync(rollbackPath, "# Rollback: pulihkan manifest aktif dari backup predeploy.\n");
  const promoteOk = runScript(env, "scripts/promote-model.ts", [
    `--data-dir=${env.dataDir}`, `--parity-file=${parityPath}`,
    `--decision-file=${decisionPath}`, `--run-manifest=${runManifestPath}`,
    `--owner-approval=${approvalPath}`, `--rollback-plan=${rollbackPath}`,
  ]);
  suite.check(
    "gerbang CLI: kandidat sah + bukti lengkap terpromosi (exit 0)",
    promoteOk.code === 0 && promoteOk.stdout.includes('"decision": "promote"'),
    `code=${promoteOk.code} out=${promoteOk.stdout.slice(0, 200)} err=${promoteOk.stderr.slice(0, 200)}`,
  );
  const activeAfterPromote = fs.readFileSync(activePath, "utf8");
  suite.check(
    "gerbang CLI: manifest aktif sesudah promosi = isi kandidat",
    activeAfterPromote === fs.readFileSync(candidatePath, "utf8"),
  );

  // 7) Promosi CLI: kandidat latih lebih kecil → reject, aktif tak berubah.
  const ratingsObj2 = JSON.parse(fs.readFileSync(ratingsPath, "utf8")) as {
    leagues: Record<string, unknown>;
  };
  delete ratingsObj2.leagues.B1;
  fs.writeFileSync(ratingsPath, JSON.stringify(ratingsObj2, null, 2));
  runScript(env, "scripts/build-model-manifest.ts", [`--data-dir=${env.dataDir}`]);
  const promoteReject = runScript(env, "scripts/promote-model.ts", [
    `--data-dir=${env.dataDir}`, `--parity-file=${parityPath}`,
  ]);
  suite.check(
    "gerbang CLI: kandidat latih lebih kecil ditolak (exit 2 + alasan bernama)",
    promoteReject.code === 2 && promoteReject.stdout.includes("candidate_training_smaller"),
    `code=${promoteReject.code} out=${promoteReject.stdout.slice(0, 300)}`,
  );
  suite.check(
    "gerbang CLI: penolakan tidak mengubah manifest aktif",
    fs.readFileSync(activePath, "utf8") === activeAfterPromote,
  );

  // 8) Berhenti bernama: manifest hilang / rusak.
  const env2 = createFixtureEnv("model-nomanifest");
  try {
    fs.copyFileSync(path.join(REPO_ROOT, "data", "calibrated_ratings.json"), path.join(env2.dataDir, "calibrated_ratings.json"));
    const noManifest = runScript(env2, "scripts/evaluate-model.ts", [
      `--samples=${samplesPath}`, `--data-dir=${env2.dataDir}`,
    ], labEnv);
    suite.check(
      "berhenti bernama: tanpa manifest → evaluator gagal dengan manifest_missing",
      noManifest.code !== 0 && noManifest.stderr.includes("manifest_missing"),
      `code=${noManifest.code} err=${noManifest.stderr.slice(0, 200)}`,
    );
    fs.writeFileSync(path.join(env2.dataDir, "model-manifest.json"), "{ rusak");
    const corrupt = runScript(env2, "scripts/evaluate-model.ts", [
      `--samples=${samplesPath}`, `--data-dir=${env2.dataDir}`,
    ], labEnv);
    suite.check(
      "berhenti bernama: manifest rusak → evaluator gagal dengan manifest_corrupt",
      corrupt.code !== 0 && corrupt.stderr.includes("manifest_corrupt"),
      `code=${corrupt.code} err=${corrupt.stderr.slice(0, 200)}`,
    );
  } finally {
    settleFixtureEnv(env2, suite.failedCount > 0);
  }

  // 9) Identitas manifest tercap pada pick terbit (jalur publikasi K2 —
  // jahitan yang sama dengan yang dipakai pick-slate).
  process.chdir(env.root);
  await buildCoreSchemas();
  const pub = await import("../lib/picks/publication");
  const published = pub.publishPicks(
    {
      series: "live-run",
      source_match_id: "fx_k4_seed",
      fixture_uid: "uid-fx-k4-seed",
      competition_canonical_id: "eng-premier",
      kickoff_utc: "2026-11-22T17:30:00.000Z",
      scheduled_cutoff_utc: "2026-11-21T12:00:00.000Z",
      decision_at_utc: "2026-11-21T11:00:00.000Z",
      model_version: manifest.modelVersion,
      ratings_hash: manifest.ratingsHash,
      package: {
        trigger: "slate",
        gate_status: "calibrated",
        payload: {
          kind: "quant-package",
          version: 1,
          legs: [{ market: "1x2", selection: "1", model_prob: 0.61, effective_prob: 0.6 }],
        },
      },
      legs: [
        {
          market: "1x2", selection: "1", model_prob: 0.61, effective_prob: 0.6,
          effective_source: "lab-band", market_prob: 0.58, sm_prob: null,
          grade: "B", gate_status: "calibrated",
        },
      ],
    },
    {
      now: () => "2026-11-21T12:00:00.000Z",
      fixture_state: () => ({ status: "scheduled", kickoff_utc: "2026-11-22T17:30:00.000Z" }),
    },
  );
  suite.check("Q04 pick berseed terbit lewat jalur publikasi", published.status === "published", published.status);
  const picksDb = new DatabaseSync(path.join(env.dataDir, "picks.db"), { readOnly: true });
  const pickRow = picksDb.prepare("SELECT model_version, ratings_hash FROM picks ORDER BY id DESC LIMIT 1").get() as {
    model_version: string; ratings_hash: string;
  };
  picksDb.close();
  suite.check(
    "Q04 pick tersimpan membawa identitas manifest persis (κ/kfit 10)",
    pickRow.model_version === manifest.modelVersion &&
      pickRow.model_version.includes("kfit10") &&
      pickRow.ratings_hash === manifest.ratingsHash,
    `model_version=${pickRow.model_version}`,
  );

  // 10) Penjaga wiring statis: slate memuat manifest; refresh tak mempromosikan.
  const slateSrc = fs.readFileSync(path.join(REPO_ROOT, "scripts", "pick-slate.ts"), "utf8");
  suite.check(
    "wiring: pick-slate memuat model saji pointer (loadServingModel) + mencap modelVersion manifest",
    slateSrc.includes("loadServingModel") && slateSrc.includes("model_version: modelVersion"),
  );
  const refreshSrc = fs.readFileSync(path.join(REPO_ROOT, "scripts", "free-refresh.ts"), "utf8");
  const calibrateSrc = fs.readFileSync(path.join(REPO_ROOT, "scripts", "calibrate-ratings.ts"), "utf8");
  const offsetsSrc = fs.readFileSync(path.join(REPO_ROOT, "scripts", "fit-global-offsets.ts"), "utf8");
  suite.check(
    "wiring: rantai refresh tak memanggil gerbang; jalur fit menulis kandidat, tak pernah manifest aktif",
    !refreshSrc.includes("promote-model") &&
      !calibrateSrc.includes("writeActiveManifest") &&
      !offsetsSrc.includes("writeActiveManifest") &&
      calibrateSrc.includes("writeCandidateManifest") &&
      offsetsSrc.includes("writeCandidateManifest"),
  );
} catch (err) {
  envFailed = true;
  console.error("FATAL sandbox:", err);
  suite.check("sandbox selesai tanpa exception", false, err instanceof Error ? err.message : String(err));
} finally {
  settleFixtureEnv(env, envFailed || suite.failedCount > 0);
}

suite.finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
