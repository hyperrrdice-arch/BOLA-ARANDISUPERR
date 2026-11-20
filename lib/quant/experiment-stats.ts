/**
 * STATISTIK EKSPERIMEN MODEL (K5 · bab Model Q4) — fungsi murni untuk
 * eksperimen kandidat model yang terdaftar di muka:
 *
 *  - bootstrap blok berpasangan atas Δ log-loss per laga
 *    (Δ = LL kandidat − LL champion): blok pekan sepak bola
 *    diresample utuh (semua laga + kedua model tetap bersama),
 *    5.000 resample, seed tetap — deterministik byte-per-byte.
 *  - aturan keputusan promosi bab Q4 sebagai fungsi murni:
 *    tepat satu putusan `promote` | `retain` | `inconclusive`
 *    dari ambang yang ditulis sebelum hasil dibuka
 *    (tasks/experiments/k5-kappa/DESIGN.md §7).
 *
 * Tidak membaca file, tidak memanggil mesin rating — pemanggil
 * (runner eksperimen) menyerahkan angka penuh-presisi; fungsi ini
 * hanya menghitung. Suite: tests/test-experiment-stats.ts.
 */

/** PRNG mulberry32 — deterministik lintas platform (operasi 32-bit). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PairedDeltaRow {
  /** Kunci blok (pekan ISO tanggal laga). */
  block: string;
  /** Δ log-loss laga ini: kandidat − champion. */
  delta: number;
}

export interface BlockBootstrapResult {
  /** Mean Δ teramati pada sampel asli (bukan mean bootstrap). */
  meanDelta: number;
  /** Mean dari distribusi bootstrap (diagnostik bias). */
  bootstrapMean: number;
  /** Batas atas satu sisi 95%: persentil ke-95 mean bootstrap. */
  upperOneSided95: number;
  /** Interval dua sisi 95%: [persentil 2,5; persentil 97,5]. */
  ci95Low: number;
  ci95High: number;
  nMatches: number;
  nBlocks: number;
  resamples: number;
  seed: number;
}

function percentile(sortedAsc: number[], q: number): number {
  // nearest-rank
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(q * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

/**
 * Bootstrap blok berpasangan: agregat per blok (ΣΔ, n) dihitung dulu,
 * lalu blok diresample dengan pengembalian sebanyak jumlah blok;
 * mean Δ resample = Σ(ΣΔ blok terpilih) / Σ(n blok terpilih).
 */
export function blockBootstrapDelta(
  rows: readonly PairedDeltaRow[],
  opts: { resamples: number; seed: number },
): BlockBootstrapResult {
  const blocks = new Map<string, { sum: number; n: number }>();
  let totalSum = 0;
  for (const r of rows) {
    const b = blocks.get(r.block) ?? { sum: 0, n: 0 };
    b.sum += r.delta;
    b.n += 1;
    blocks.set(r.block, b);
    totalSum += r.delta;
  }
  const blockArr = [...blocks.values()];
  const nBlocks = blockArr.length;
  const nMatches = rows.length;
  const meanDelta = nMatches > 0 ? totalSum / nMatches : NaN;

  const rand = mulberry32(opts.seed);
  const means: number[] = new Array(opts.resamples);
  for (let i = 0; i < opts.resamples; i++) {
    let s = 0;
    let n = 0;
    for (let j = 0; j < nBlocks; j++) {
      const b = blockArr[Math.floor(rand() * nBlocks)];
      s += b.sum;
      n += b.n;
    }
    means[i] = n > 0 ? s / n : NaN;
  }
  const sorted = [...means].sort((a, b) => a - b);
  const bootstrapMean = means.reduce((a, v) => a + v, 0) / means.length;
  return {
    meanDelta,
    bootstrapMean,
    upperOneSided95: percentile(sorted, 0.95),
    ci95Low: percentile(sorted, 0.025),
    ci95High: percentile(sorted, 0.975),
    nMatches,
    nBlocks,
    resamples: opts.resamples,
    seed: opts.seed,
  };
}

// ---------------------------------------------------------------------------
// Aturan keputusan promosi (bab Model Q4; dibekukan di DESIGN.md §7)
// ---------------------------------------------------------------------------

export const KAPPA_DECISION_THRESHOLDS = {
  /** Target manfaat terdaftar: mean Δ ≤ −0,005. */
  meanDeltaMax: -0.005,
  /** Penurunan cakupan maksimal 2 poin persentase. */
  coverageDropMax: 0.02,
  /** Kenaikan Brier maksimal pada irisan utama. */
  brierIncreaseMax: 0.002,
  /** Lantai sampel klaim lintas liga domestik. */
  minMatches: 1000,
  minBlocks: 20,
} as const;

export interface KappaDecisionInput {
  meanDelta: number;
  bootstrapUpperOneSided95: number;
  coverageChampion: number;
  coverageChallenger: number;
  brierChampion: number;
  brierChallenger: number;
  nMatches: number;
  nBlocks: number;
}

export interface KappaDecisionCheck {
  id: "sample_floor" | "mean_delta" | "bootstrap_upper" | "coverage_drop" | "brier_increase";
  /** Nilai teramati yang dinilai cek ini. */
  observed: number;
  /** Ambang tertulis (bentuk terbaca dicatat pemanggil/laporan). */
  threshold: number;
  pass: boolean;
}

export type KappaDecisionKind = "promote" | "retain" | "inconclusive";

export interface KappaDecision {
  decision: KappaDecisionKind;
  checks: KappaDecisionCheck[];
}

/**
 * Tepat satu putusan mengikuti aturan tertulis:
 *  - lantai sampel gagal → `inconclusive` (champion dipertahankan,
 *    kumpulkan data shadow) — cek lain tetap dihitung untuk laporan;
 *  - lantai lolos + semua cek manfaat/lindungan lolos → `promote`;
 *  - lantai lolos + ada cek yang gagal → `retain`.
 */
/**
 * Toleransi representasi biner (1e-12) untuk perbandingan ≤ pada
 * ambang desimal: 1 − 0,98 dalam double adalah 0,020000000000000004,
 * padahal nilai matematisnya tepat 0,02 dan harus lolos "maksimal
 * 0,02". Epsilon ini HANYA menyerap galat representasi — selisih
 * nyata ≥ 1e-9 tetap gagal. Perbandingan UB bootstrap < 0 tetap
 * ketat tanpa epsilon (0 memang harus gagal).
 */
const REPRESENTATION_EPS = 1e-12;

export function applyKappaDecision(input: KappaDecisionInput): KappaDecision {
  const T = KAPPA_DECISION_THRESHOLDS;
  const checks: KappaDecisionCheck[] = [
    {
      id: "sample_floor",
      observed: Math.min(input.nMatches / T.minMatches, input.nBlocks / T.minBlocks),
      threshold: 1,
      pass: input.nMatches >= T.minMatches && input.nBlocks >= T.minBlocks,
    },
    {
      id: "mean_delta",
      observed: input.meanDelta,
      threshold: T.meanDeltaMax,
      pass: input.meanDelta <= T.meanDeltaMax + REPRESENTATION_EPS,
    },
    {
      id: "bootstrap_upper",
      observed: input.bootstrapUpperOneSided95,
      threshold: 0,
      pass: input.bootstrapUpperOneSided95 < 0,
    },
    {
      id: "coverage_drop",
      observed: input.coverageChampion - input.coverageChallenger,
      threshold: T.coverageDropMax,
      pass: input.coverageChampion - input.coverageChallenger <= T.coverageDropMax + REPRESENTATION_EPS,
    },
    {
      id: "brier_increase",
      observed: input.brierChallenger - input.brierChampion,
      threshold: T.brierIncreaseMax,
      pass: input.brierChallenger - input.brierChampion <= T.brierIncreaseMax + REPRESENTATION_EPS,
    },
  ];
  const floor = checks[0];
  if (!floor.pass) return { decision: "inconclusive", checks };
  const allPass = checks.every((c) => c.pass);
  return { decision: allPass ? "promote" : "retain", checks };
}
