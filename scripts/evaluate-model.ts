/**
 * EVALUATOR LAB (K4) — jalur evaluasi yang memuat manifest aktif yang
 * sama dengan produksi dan menghitung lewat prediktor bersama
 * lib/quant/predict.ts (komposisi yang sama dengan planner produksi).
 *
 * Kontrak:
 *  - Manifest aktif WAJIB ada dan utuh; hilang/rusak → berhenti bernama
 *    (ModelManifestError berkode), tanpa fallback.
 *  - Manifest diverifikasi KETAT terhadap artefak rating di --data-dir
 *    (ratingsHash harus cocok persis).
 *  - --data-dir harus direktori `data` dari root target: proses chdir ke
 *    induknya agar ratings-loader membaca artefak yang sama persis dengan
 *    yang diverifikasi manifest.
 *  - Fitur form tiap sampel dibangun pembaca as-of lib/quant/snapshot.ts
 *    dari baris hasil mentah (available_at ≤ decision_at).
 *
 * Pakai: npx tsx scripts/evaluate-model.ts --samples=samples.json [--data-dir=data] [--out=rows.json]
 * Format samples: {"samples":[{id, homeTeam, awayTeam, leagueHint?, decisionAt,
 *   homeResults?: [{team, date, availableAt?, goalsFor, goalsAgainst}],
 *   awayResults?: [...]}]} (atau array langsung).
 */
import fs from "node:fs";
import path from "node:path";
import {
  ModelManifestError,
  loadActiveManifest,
  readRatingsRaw,
  verifyManifestRatings,
  type ModelManifest,
} from "../lib/quant/model-manifest";
import { predictMatch } from "../lib/quant/predict";
import { buildFormSnapshot, type TeamResultRow } from "../lib/quant/snapshot";

export interface SampleFixture {
  id: string;
  homeTeam: string;
  awayTeam: string;
  leagueHint?: string;
  decisionAt: string;
  homeResults?: TeamResultRow[];
  awayResults?: TeamResultRow[];
}

export interface PredictionRow {
  id: string;
  homeTeam: string;
  awayTeam: string;
  modelVersion: string;
  ratingsHash: string;
  lambda: number;
  mu: number;
  probHome: number;
  probDraw: number;
  probAway: number;
}

export function runEvaluation(opts: {
  dataDir: string;
  samples: SampleFixture[];
}): { manifest: ModelManifest; rows: PredictionRow[] } {
  const dataDir = path.resolve(opts.dataDir);
  if (path.basename(dataDir) !== "data") {
    throw new Error(
      `evaluate-model: --data-dir harus direktori data/ (diterima: ${dataDir}) — ratings-loader membaca <root>/data.`,
    );
  }
  // Loader membaca relatif terhadap cwd — samakan root-nya dengan dataDir.
  process.chdir(path.dirname(dataDir));

  const manifest = loadActiveManifest(dataDir);
  verifyManifestRatings(manifest, readRatingsRaw(dataDir));

  const rows = opts.samples.map((s) => {
    const homeForm = buildFormSnapshot(s.homeResults ?? [], s.homeTeam, s.decisionAt);
    const awayForm = buildFormSnapshot(s.awayResults ?? [], s.awayTeam, s.decisionAt);
    const pred = predictMatch({
      homeTeam: s.homeTeam,
      awayTeam: s.awayTeam,
      leagueHint: s.leagueHint,
      homeFormGoalsAvg: homeForm.goalsAvg ?? undefined,
      awayFormGoalsAvg: awayForm.goalsAvg ?? undefined,
      homeSampleN: homeForm.sampleSize,
      awaySampleN: awayForm.sampleSize,
      cutoff: s.decisionAt.slice(0, 10),
    });
    return {
      id: s.id,
      homeTeam: s.homeTeam,
      awayTeam: s.awayTeam,
      modelVersion: manifest.modelVersion,
      ratingsHash: manifest.ratingsHash,
      lambda: pred.lambda,
      mu: pred.mu,
      probHome: pred.probs.home,
      probDraw: pred.probs.draw,
      probAway: pred.probs.away,
    };
  });
  return { manifest, rows };
}

function argValue(flag: string): string | null {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
}

function main(): void {
  const samplesPath = argValue("--samples");
  if (!samplesPath) {
    console.error("evaluate-model: --samples=<file.json> wajib diisi.");
    process.exit(1);
  }
  const dataDir = argValue("--data-dir") ?? "data";
  try {
    const parsed = JSON.parse(fs.readFileSync(samplesPath, "utf8")) as
      | SampleFixture[]
      | { samples: SampleFixture[] };
    const samples = Array.isArray(parsed) ? parsed : parsed.samples;
    const { manifest, rows } = runEvaluation({ dataDir, samples });
    const out = { modelVersion: manifest.modelVersion, ratingsHash: manifest.ratingsHash, rows };
    const outPath = argValue("--out");
    if (outPath) {
      fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
      console.log(`evaluate-model: ${rows.length} baris prediksi (${manifest.modelVersion}) → ${outPath}`);
    } else {
      console.log(JSON.stringify(out, null, 2));
    }
  } catch (err) {
    if (err instanceof ModelManifestError) {
      console.error(`[${err.code}] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

main();
