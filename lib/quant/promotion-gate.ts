/**
 * GERBANG PROMOSI MODEL (K4).
 *
 * Promosi kandidat → champion adalah tindakan EKSPLISIT lewat gerbang ini
 * (dipakai scripts/promote-model.ts). Jalur fit/refresh tidak pernah
 * mempromosikan diam-diam: ia hanya menulis manifest kandidat.
 *
 * Aturan gerbang (prasyarat mekanis — keputusan kualitas eksperimen
 * seperti Δ log-loss/bootstrap adalah jalur K5 dan dicatat sebagai note
 * bila konfigurasi berubah):
 *  - REJECT bila kandidat dilatih pada jumlah pertandingan LEBIH KECIL
 *    dari champion (fit menyusut tidak boleh menggantikan champion).
 *  - REJECT bila paritas lab/produksi pada sampel melebihi toleransi
 *    Σ|Δp| (PARITY_SUM_ABS_TOLERANCE atas seluruh probabilitas sampel).
 *  - WARNING (tidak memblokir) untuk cakupan yang menyusut: divisi
 *    champion hilang di kandidat, liga calibrated berkurang, atau liga
 *    tanpa status kalibrasi bertambah.
 *  - NOTE bila konfigurasi berubah (κ/kfit/half-life/rho/blend): promosi
 *    konfigurasi baru memerlukan keputusan eksperimen terdokumentasi.
 */
import type { ModelManifest } from "./model-manifest";

/** Toleransi paritas: jumlah |Δp| atas seluruh probabilitas 1X2 sampel. */
export const PARITY_SUM_ABS_TOLERANCE = 0.005;

export interface ParitySummary {
  sampleSize: number;
  sumAbsDelta: number;
}

export interface PromotionEvaluation {
  decision: "promote" | "reject";
  reasons: string[];
  warnings: string[];
  notes: string[];
}

export function evaluatePromotion(args: {
  champion: ModelManifest;
  candidate: ModelManifest;
  parity?: ParitySummary | null;
}): PromotionEvaluation {
  const { champion, candidate } = args;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];

  if (candidate.training.totalMatches < champion.training.totalMatches) {
    reasons.push(
      `candidate_training_smaller: kandidat dilatih pada ${candidate.training.totalMatches} laga < champion ${champion.training.totalMatches} — fit dengan jumlah latih lebih kecil ditolak`,
    );
  }

  const championDivs = new Set(champion.training.perLeague.map((l) => l.div));
  const candidateDivs = new Set(candidate.training.perLeague.map((l) => l.div));
  for (const div of [...championDivs].filter((d) => !candidateDivs.has(d)).sort()) {
    warnings.push(`coverage_missing_league: divisi ${div} ada di champion tapi hilang di kandidat`);
  }
  if (candidate.calibration.calibrated < champion.calibration.calibrated) {
    warnings.push(
      `calibration_regressed: liga calibrated turun ${champion.calibration.calibrated} → ${candidate.calibration.calibrated}`,
    );
  }
  if (candidate.calibration.unknown > champion.calibration.unknown) {
    warnings.push(
      `calibration_unknown_grew: liga tanpa status kalibrasi naik ${champion.calibration.unknown} → ${candidate.calibration.unknown}`,
    );
  }

  const cfgDiff: string[] = [];
  if (candidate.config.kappa !== champion.config.kappa) {
    cfgDiff.push(`kappa ${champion.config.kappa}→${candidate.config.kappa}`);
  }
  if (candidate.config.kfit !== champion.config.kfit) {
    cfgDiff.push(`kfit ${champion.config.kfit}→${candidate.config.kfit}`);
  }
  if (candidate.config.halfLifeDays !== champion.config.halfLifeDays) {
    cfgDiff.push(`halfLifeDays ${champion.config.halfLifeDays}→${candidate.config.halfLifeDays}`);
  }
  if (candidate.config.rhoMode !== champion.config.rhoMode) {
    cfgDiff.push(`rhoMode ${champion.config.rhoMode}→${candidate.config.rhoMode}`);
  }
  if (candidate.config.blend.kappaScale !== champion.config.blend.kappaScale) {
    cfgDiff.push(`blendKappaScale ${champion.config.blend.kappaScale}→${candidate.config.blend.kappaScale}`);
  }
  if (cfgDiff.length) {
    notes.push(
      `config_change: ${cfgDiff.join(", ")} — promosi konfigurasi baru memerlukan keputusan eksperimen terdokumentasi (jalur K5), bukan sekadar gerbang ini`,
    );
  }

  if (args.parity) {
    if (!(args.parity.sumAbsDelta <= PARITY_SUM_ABS_TOLERANCE)) {
      reasons.push(
        `parity_delta_exceeded: Σ|Δp|=${args.parity.sumAbsDelta} > toleransi ${PARITY_SUM_ABS_TOLERANCE} pada ${args.parity.sampleSize} sampel`,
      );
    } else {
      notes.push(
        `parity_ok: Σ|Δp|=${args.parity.sumAbsDelta} ≤ ${PARITY_SUM_ABS_TOLERANCE} pada ${args.parity.sampleSize} sampel`,
      );
    }
  } else {
    warnings.push("parity_not_supplied: gerbang dijalankan tanpa ringkasan paritas lab/produksi");
  }

  return { decision: reasons.length ? "reject" : "promote", reasons, warnings, notes };
}
