/**
 * EVALUATOR LAB (K4) — jalur evaluasi yang memuat manifest aktif yang
 * sama dengan produksi dan menghitung lewat prediktor bersama
 * lib/quant/predict.ts (komposisi yang sama dengan planner produksi).
 *
 * Kontrak:
 *  - Manifest aktif WAJIB ada dan utuh; hilang/rusak → berhenti bernama
 *    (ModelManifestError berkode), tanpa fallback.
 *  - Bobot yang dipakai adalah artefak immutable yang dirujuk manifest
 *    aktif dari store (fix-5): hash artefak divalidasi terhadap
 *    manifest, lalu bobot ditanam ke ratings-loader — file lepas
 *    data/calibrated_ratings.json TIDAK dibaca jalur ini.
 *  - PENJAGA POINT-IN-TIME (fix-5): bila jendela latih artefak melampaui
 *    jam keputusan sampel mana pun (window.end >= tanggal keputusan),
 *    evaluator BERHENTI dengan point_in_time_violation — rating tidak
 *    boleh menilai keputusan yang mendahului data latihnya. Pengecualian
 *    hanya lewat --allow-non-point-in-time yang EKSPLISIT, dan hasilnya
 *    dicap mencolok sebagai BUKAN point-in-time (field pointInTime:
 *    false + banner). Keadaan historis apa adanya: snapshot artefak
 *    per-keputusan SEBELUM era artefak immutable tidak ada, jadi
 *    evaluasi atas keputusan lama tidak dapat dibuat point-in-time
 *    secara retroaktif — artefak immutable mulai kartu ini membuat
 *    shadow prospektif (keputusan baru dinilai artefak sezamannya)
 *    mungkin ke depan.
 *  - --data-dir harus direktori `data` dari root target: proses chdir ke
 *    induknya agar store telemetri membaca root yang sama.
 *  - Fitur form tiap sampel dibangun pembaca as-of lib/quant/snapshot.ts
 *    dari baris hasil mentah (available_at ≤ decision_at).
 *
 * Pakai: npx tsx scripts/evaluate-model.ts --samples=samples.json [--data-dir=data] [--out=rows.json] [--allow-non-point-in-time]
 * Format samples: {"samples":[{id, homeTeam, awayTeam, leagueHint?, decisionAt,
 *   homeResults?: [{team, date, availableAt?, goalsFor, goalsAgainst}],
 *   awayResults?: [...]}]} (atau array langsung).
 */
import fs from "node:fs";
import path from "node:path";
import {
  ModelManifestError,
  loadActiveManifest,
  pointInTimeViolations,
  resolveRatingsArtifact,
  type ModelManifest,
  type PointInTimeViolation,
} from "../lib/quant/model-manifest";
import { setCalibratedRatingsOverride } from "../lib/quant/ratings-loader";
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

export interface EvaluationResult {
  manifest: ModelManifest;
  rows: PredictionRow[];
  /** false hanya bila pelanggaran point-in-time diizinkan eksplisit. */
  pointInTime: boolean;
  violations: PointInTimeViolation[];
}

export function runEvaluation(opts: {
  dataDir: string;
  samples: SampleFixture[];
  allowNonPointInTime?: boolean;
}): EvaluationResult {
  const dataDir = path.resolve(opts.dataDir);
  if (path.basename(dataDir) !== "data") {
    throw new Error(
      `evaluate-model: --data-dir harus direktori data/ (diterima: ${dataDir}) — ratings-loader membaca <root>/data.`,
    );
  }
  // Loader membaca relatif terhadap cwd — samakan root-nya dengan dataDir.
  process.chdir(path.dirname(dataDir));

  const manifest = loadActiveManifest(dataDir);

  // Penjaga point-in-time: artefak tidak boleh menilai keputusan yang
  // mendahului akhir jendela latihnya (kebocoran masa depan).
  const violations = pointInTimeViolations(
    manifest,
    opts.samples.map((s) => s.decisionAt),
  );
  if (violations.length > 0 && !opts.allowNonPointInTime) {
    const first = violations[0];
    throw new ModelManifestError(
      "point_in_time_violation",
      `Evaluasi BUKAN point-in-time: artefak ${manifest.modelVersion} dilatih s.d. ${manifest.training.window.end}, ` +
        `tetapi ${violations.length} dari ${opts.samples.length} keputusan bertanggal <= jendela itu ` +
        `(terawal: ${first.decisionAt}). Rating dari masa depan tidak boleh menilai keputusan masa lalu. ` +
        `Untuk diagnostik bertanda saja, jalankan dengan --allow-non-point-in-time.`,
    );
  }

  // Bobot dari artefak pointer (tervalidasi hash) — bukan file lepas.
  const resolved = resolveRatingsArtifact(dataDir, manifest);
  setCalibratedRatingsOverride(JSON.parse(resolved.raw));

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
  return { manifest, rows, pointInTime: violations.length === 0, violations };
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
  const allowNonPointInTime = process.argv.includes("--allow-non-point-in-time");
  try {
    const parsed = JSON.parse(fs.readFileSync(samplesPath, "utf8")) as
      | SampleFixture[]
      | { samples: SampleFixture[] };
    const samples = Array.isArray(parsed) ? parsed : parsed.samples;
    const { manifest, rows, pointInTime, violations } = runEvaluation({
      dataDir,
      samples,
      allowNonPointInTime,
    });
    if (!pointInTime) {
      console.error(
        `\n*** PERINGATAN: HASIL INI BUKAN POINT-IN-TIME ***\n` +
          `Artefak ${manifest.modelVersion} dilatih s.d. ${manifest.training.window.end}; ` +
          `${violations.length} keputusan mendahului akhir jendela latih itu. ` +
          `Angka ini diagnostik bertanda saja — BUKAN bukti akurasi point-in-time.\n`,
      );
    }
    const out = {
      modelVersion: manifest.modelVersion,
      ratingsHash: manifest.ratingsHash,
      pointInTime,
      ...(pointInTime
        ? {}
        : {
            pointInTimeWarning:
              `BUKAN point-in-time: ${violations.length} keputusan mendahului akhir jendela latih ` +
              `${manifest.training.window.end} artefak ${manifest.modelVersion}.`,
          }),
      rows,
    };
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
