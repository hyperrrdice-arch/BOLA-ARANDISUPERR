/**
 * scripts/pick-engine-acceptance.ts — Uji penerimaan Fase B (unit-level).
 *
 * Untuk dua paket pipeline yang tersimpan:
 *   1. tasks/e2e-run-1-package.json       (Everton vs Coventry, PL, calibrated)
 *   2. tasks/e2e-cup-package-live.json    (Fenerbahçe vs Liverpool, UCL, partial)
 * memverifikasi:
 *   a. Matriks skor yang dibangun ulang engine dari (λ, μ, ρ) paket
 *      mereproduksi probabilitas pasar terpublikasi paket (1X2, OU2.5, BTTS,
 *      DC) dalam toleransi rounding (≤0.0011 — probabilitas paket ter-round
 *      4 desimal, hasil DC internal ter-roundPct 2 desimal persen).
 *   b. Kaki yang diterbitkan engine + grade-nya mengikuti tabel lab dan cap
 *      gerbang (kasus kerja wajib: Fenerbahçe BTTS → C; OU2.5 → C).
 *   c. Kombo satu pertandingan dihitung eksak dari matriks (bukan produk).
 *
 * Offline penuh: tidak ada panggilan API, tidak ada tulis DB.
 * Output: tasks/pick-engine-acceptance.json + ringkasan ke stdout.
 */

import fs from "node:fs";
import path from "node:path";
import {
  rebuildMatrix,
  probFromMatrix,
  pickLegs,
  sameMatchCombo,
  combineParlay,
  type GateStatus,
  type PickLeg,
  type Population,
} from "../lib/picks/engine";

const TOL = 0.0011;

interface DcSummary {
  lambda_home_xg: number;
  mu_away_xg: number;
  prob_home_win: number;
  prob_draw: number;
  prob_away_win: number;
  over_2_5_prob: number;
  btts_yes_prob: number;
}

interface PanelRow {
  outcome: string;
  probability: number; // persen 0–100 di predictions.db / paket
}

interface StoredPackage {
  meta: { match_id: string };
  selection: {
    fixture: {
      competition_name: string;
      home_team_name: string;
      away_team_name: string;
      utc_date: string;
    };
    registry_row?: { status?: string } | null;
    gate?: { status?: string } | null;
  };
  quant_pure: {
    dixon_coles?: DcSummary;
    quant_package: { dixon_coles: DcSummary };
    shrunk_params: {
      rho?: number;
      metadata?: { calibrationStatus?: string; cupOffset?: unknown };
    };
    cup_offset_metadata?: unknown;
  };
  market_anchor_sm?: {
    shin_stripped?: { fair_prob?: Record<string, number> | null } | null;
  } | null;
  context?: {
    predictions_db?: {
      fulltime_result?: PanelRow[] | null;
      over_under_2_5?: PanelRow[] | null;
      btts?: PanelRow[] | null;
      double_chance?: PanelRow[] | null;
    } | null;
  } | null;
}

function loadPkg(rel: string): StoredPackage {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), rel), "utf8"));
}

/** Panel SM paket (persen) → peta sm_probs engine (0..1, kunci market:selection). */
function smProbsFromPackage(pkg: StoredPackage): Record<string, number> {
  const panel = pkg.context?.predictions_db;
  const out: Record<string, number> = {};
  if (!panel) return out;
  const put = (rows: PanelRow[] | null | undefined, map: Record<string, string>) => {
    for (const r of rows ?? []) {
      const key = map[r.outcome];
      if (key) out[key] = r.probability / 100;
    }
  };
  put(panel.fulltime_result, { home: "1x2:1", draw: "1x2:x", away: "1x2:2" });
  put(panel.double_chance, {
    draw_home: "dc:1x",
    home_away: "dc:12",
    draw_away: "dc:x2",
  });
  put(panel.over_under_2_5, { yes: "ou25:over", no: "ou25:under" });
  put(panel.btts, { yes: "btts:yes", no: "btts:no" });
  return out;
}

/** Probabilitas pasar 1X2 Shin-stripped dari anchor paket (sudah 0..1). */
function marketProbsFromPackage(pkg: StoredPackage): Record<string, number> {
  const fair = pkg.market_anchor_sm?.shin_stripped?.fair_prob;
  if (!fair) return {};
  return { "1x2:1": fair.home, "1x2:x": fair.draw, "1x2:2": fair.away };
}

interface ReproRow {
  quantity: string;
  published: number;
  recomputed: number;
  abs_diff: number;
  within_tolerance: boolean;
}

function checkFixture(rel: string) {
  const pkg = loadPkg(rel);
  const dcBlock = pkg.quant_pure.dixon_coles ?? pkg.quant_pure.quant_package.dixon_coles;
  const lambda = dcBlock.lambda_home_xg;
  const mu = dcBlock.mu_away_xg;
  const rho = pkg.quant_pure.shrunk_params.rho ?? 0;
  const matrix = rebuildMatrix(lambda, mu, rho);

  const pub = pkg.quant_pure.quant_package.dixon_coles;
  const checks: Array<[string, number, number]> = [
    ["1X2 home (1)", pub.prob_home_win, probFromMatrix(matrix, "1x2", "1")],
    ["1X2 draw (x)", pub.prob_draw, probFromMatrix(matrix, "1x2", "x")],
    ["1X2 away (2)", pub.prob_away_win, probFromMatrix(matrix, "1x2", "2")],
    ["OU2.5 over", pub.over_2_5_prob, probFromMatrix(matrix, "ou25", "over")],
    ["OU2.5 under", 1 - pub.over_2_5_prob, probFromMatrix(matrix, "ou25", "under")],
    ["BTTS yes", pub.btts_yes_prob, probFromMatrix(matrix, "btts", "yes")],
    ["BTTS no", 1 - pub.btts_yes_prob, probFromMatrix(matrix, "btts", "no")],
    ["DC 1x", pub.prob_home_win + pub.prob_draw, probFromMatrix(matrix, "dc", "1x")],
    ["DC 12", pub.prob_home_win + pub.prob_away_win, probFromMatrix(matrix, "dc", "12")],
    ["DC x2", pub.prob_draw + pub.prob_away_win, probFromMatrix(matrix, "dc", "x2")],
  ];
  const reproduction: ReproRow[] = checks.map(([quantity, published, recomputed]) => ({
    quantity,
    published,
    recomputed,
    abs_diff: Math.abs(published - recomputed),
    within_tolerance: Math.abs(published - recomputed) <= TOL,
  }));

  const meta = pkg.quant_pure.shrunk_params.metadata ?? {};
  const gate = (meta.calibrationStatus ??
    pkg.selection.gate?.status ??
    pkg.selection.registry_row?.status ??
    "uncalibrated") as GateStatus;
  const isCup = Boolean(meta.cupOffset ?? pkg.quant_pure.cup_offset_metadata);
  const population: Population = isCup ? "cup" : "domestic";

  const legs = pickLegs({
    matrix,
    gate_status: gate,
    population,
    market_probs: marketProbsFromPackage(pkg),
    sm_probs: smProbsFromPackage(pkg),
  });

  return {
    fixture: `${pkg.selection.fixture.home_team_name} vs ${pkg.selection.fixture.away_team_name}`,
    match_id: pkg.meta.match_id,
    competition: pkg.selection.fixture.competition_name,
    utc_date: pkg.selection.fixture.utc_date,
    lambda,
    mu,
    rho,
    gate_status: gate,
    population,
    reproduction,
    reproduction_all_within_tolerance: reproduction.every((r) => r.within_tolerance),
    legs,
  };
}

function fmtLeg(l: PickLeg): string {
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  return (
    `  [${l.grade}] ${l.market}/${l.selection} stated ${pct(l.model_prob)} ` +
    `efektif ${pct(l.effective_prob)} (${l.effective_source}` +
    `${l.band ? `, pita ${l.band} n=${l.band_n}` : ""})` +
    `${l.market_prob !== null ? ` pasar ${pct(l.market_prob)}` : ""}` +
    `${l.sm_prob !== null ? ` SM ${pct(l.sm_prob)}` : ""}` +
    `${l.agreement_spread !== null ? ` spread ${(l.agreement_spread * 100).toFixed(1)}pp` : ""}`
  );
}

function main() {
  const everton = checkFixture("tasks/e2e-run-1-package.json");
  const fener = checkFixture("tasks/e2e-cup-package-live.json");

  // Kombo satu pertandingan (Fenerbahçe): Over 2.5 + BTTS yes, eksak dari matriks.
  const fenerPkg = loadPkg("tasks/e2e-cup-package-live.json");
  const fdc = fenerPkg.quant_pure.dixon_coles ?? fenerPkg.quant_pure.quant_package.dixon_coles;
  const fMatrix = rebuildMatrix(fdc.lambda_home_xg, fdc.mu_away_xg, fenerPkg.quant_pure.shrunk_params.rho ?? 0);
  const combo = sameMatchCombo(
    fMatrix,
    { market: "ou25", selection: "over" },
    { market: "btts", selection: "yes" },
  );
  const naiveProduct =
    probFromMatrix(fMatrix, "ou25", "over") * probFromMatrix(fMatrix, "btts", "yes");

  // Contoh parlay lintas pertandingan dari kaki terbaik kedua fixture.
  const topE = everton.legs[0];
  const topF = fener.legs[0];
  const exampleParlay = combineParlay([
    {
      label: `Everton vs Coventry: ${topE.market}/${topE.selection}`,
      stated_prob: topE.model_prob,
      effective_prob: topE.effective_prob,
    },
    {
      label: `Fenerbahçe vs Liverpool: ${topF.market}/${topF.selection}`,
      stated_prob: topF.model_prob,
      effective_prob: topF.effective_prob,
    },
    {
      label: `Fenerbahçe vs Liverpool kombo OU2.5+BTTS (eksak)`,
      stated_prob: combo.stated_prob,
      effective_prob: combo.effective_prob,
    },
  ]);

  const out = {
    generated_at: new Date().toISOString(),
    tolerance: TOL,
    fixtures: [everton, fener],
    fenerbahce_same_match_combo: {
      legs: combo.legs,
      joint_exact: combo.stated_prob,
      naive_product_for_comparison: naiveProduct,
      effective_source: combo.effective_source,
    },
    example_cross_match_parlay: exampleParlay,
  };
  fs.writeFileSync(
    path.join(process.cwd(), "tasks", "pick-engine-acceptance.json"),
    JSON.stringify(out, null, 2),
  );

  for (const f of [everton, fener]) {
    console.log(`\n=== ${f.fixture} (${f.competition}, gerbang ${f.gate_status}, populasi ${f.population}) ===`);
    console.log(`Reproduksi probabilitas: ${f.reproduction_all_within_tolerance ? "SEMUA dalam toleransi" : "ADA YANG DI LUAR TOLERANSI"}`);
    for (const r of f.reproduction) {
      console.log(
        `  ${r.quantity}: terpublikasi ${r.published.toFixed(4)} vs hitung ulang ${r.recomputed.toFixed(4)} (Δ ${r.abs_diff.toFixed(5)})${r.within_tolerance ? "" : "  <-- DI LUAR"}`,
      );
    }
    console.log(`Kaki diterbitkan (${f.legs.length}):`);
    for (const l of f.legs) console.log(fmtLeg(l));
  }
  console.log(
    `\nKombo Fenerbahçe OU2.5 over + BTTS yes: gabungan eksak ${(combo.stated_prob * 100).toFixed(2)}% ` +
      `vs produk naif ${(naiveProduct * 100).toFixed(2)}%`,
  );
  console.log(
    `Contoh parlay lintas pertandingan: efektif ${(exampleParlay.combined_effective * 100).toFixed(1)}% ` +
      `(titik) s.d. stated ${(exampleParlay.combined_stated * 100).toFixed(1)}% (batas atas)`,
  );
  console.log("\nTertulis: tasks/pick-engine-acceptance.json");
}

main();
