/**
 * lib/picks/engine.ts — Mesin pick deterministik untuk parlay "safe bet" (Fase B).
 *
 * Mengonsumsi matriks skor Dixon-Coles (presisi penuh) dari paket kuant pipeline
 * analisis (scripts/run-one-analysis.ts / driver piala) dan memancarkan kaki
 * parlay ter-grade. SEMUA angka probabilitas berasal dari matriks skor; modul
 * ini tidak memanggil API, tidak membaca DB pertandingan, dan tidak menulis apa
 * pun kecuali (opsional, oleh driver) baris ledger lewat lib/picks/ledger.ts.
 *
 * Semantik probabilitas kandidat == semantik hasil ledger BY CONSTRUCTION:
 * probabilitas kandidat dihitung dengan menjumlahkan sel matriks yang lolos
 * predikat `evaluatePick` dari ledger (sumber kebenaran tunggal untuk arti
 * market/seleksi). Jangan fork definisi market di sini.
 *
 * GRADING — implementasi persis proposal lab Fase A
 * (tasks/parlay-lab-report.md + tasks/parlay-lab-results.json, populasi
 * domestik liga calibrated, 163.008 pick ter-resolve):
 *   - Janji lantai empiris: grade A = hit-rate ≥ 0.80, B ≥ 0.70, C ≥ 0.60
 *     pada populasi validasi, toleransi 0.02.
 *   - Lab MENOLAK ambang global tunggal; ambang per-pasar di MARKET_GRADE_THRESHOLDS.
 *   - Sel pita dengan n < 200 = "tipis" → tidak boleh menopang grade A
 *     (sudah tercermin di tabel: 1X2 A ditahan di status capped-thin).
 *   - Gerbang kompetisi menimpa tabel: calibrated → sesuai tabel;
 *     partial → cap B; uncalibrated/tidak dikenal → TIDAK ADA kaki (fail-closed).
 *
 * EFFECTIVE PROBABILITY — probabilitas yang dipakai matematika parlay:
 * hit-rate empiris sel (market, pita) dari populasi lab yang sesuai
 * (domestic / cup) bila n sel ≥ 200 (ambang "tipis" lab sendiri); selain itu
 * fallback ke probabilitas stated dengan flag eksplisit. Lab menemukan produk
 * independensi melebih-lebihkan survival ~1,5–4pp, jadi setiap parlay
 * melaporkan RANGE: combined_effective = estimasi titik, combined_stated
 * (produk stated) = batas atas.
 *
 * KOMBO SATU PERTANDINGAN — probabilitas gabungan dihitung EKSAK dari matriks
 * (jumlah sel yang memenuhi kedua kaki), tidak pernah produk naif. Lab tidak
 * punya sel bukti untuk kombo → effective kombo = stated gabungan + flag.
 */

import fs from "node:fs";
import path from "node:path";
import { calculateDixonColes } from "../quant/dixon-coles";
import { evaluatePick, type PickMarket } from "./ledger";

export type { PickMarket };
export type GateStatus = "calibrated" | "partial" | "uncalibrated";
export type Grade = "A" | "B" | "C";
export type Population = "domestic" | "cup";

/** Lantai janji empiris lab (konteks tabel di bawah; bukan dipakai langsung). */
export const LAB_GRADE_FLOORS = { A: 0.8, B: 0.7, C: 0.6 } as const;
/** Toleransi lab saat menilai wilayah ambang terhadap lantai janji. */
export const LAB_TOLERANCE = 0.02;
/** Sel (market, pita) dengan n di bawah ini = "tipis" menurut lab. */
export const LAB_MIN_CELL_N = 200;

/**
 * Ambang grade per pasar — DATA dari tabel proposal lab
 * (tasks/parlay-lab-results.json → grades.perMarket; null = grade ditahan lab).
 * Setiap entri: probabilitas stated minimum untuk grade itu. Penugasan grade =
 * grade tertinggi yang ambangnya terpenuhi (semantik wilayah lab:
 * [ambang grade, ambang grade di atasnya)). Kalibrasi ulang berikutnya cukup
 * memperbarui tabel ini + file bukti lab — logika tidak berubah.
 */
export const MARKET_GRADE_THRESHOLDS: Record<
  PickMarket,
  { A: number | null; B: number | null; C: number | null }
> = {
  // A ditahan capped-thin (wilayah ≥0.70 hit 0.7806 tapi semua sel tipis, n=360);
  // B ≥0.60 (hit 0.6999, n=1336); C ditahan (pita 55–60 hit 0.5692 < 0.58).
  // Favorit 1X2 justru under-confident di pita 65–75 — tetap cap B per lab.
  "1x2": { A: null, B: 0.6, C: null },
  // Pasar paling tidak jujur di lab: A ditahan (pita 70–75 gap −0.08, n=274),
  // B ditahan ([0.60,1] hit 0.6032) → BTTS mentok C.
  btts: { A: null, B: null, C: 0.6 },
  // A ≥0.75 (hit 0.7817, n=9023 — dalam toleransi lantai 0.80); B ≥0.60
  // (wilayah [0.60,0.75) hit 0.6979); C ditahan (55–60 hit 0.5793).
  // Caveat lab: seleksi '12' pita 85+ overconfident (gap −0.0454, n=178).
  dc: { A: 0.75, B: 0.6, C: null },
  // A ≥0.85 (hit 0.8553); B ≥0.60 (0.7455); C ≥0.55 (0.5837).
  // Caveat lab: 'over' pita 80–85 gap −0.0391 (n=2155).
  ou15: { A: 0.85, B: 0.6, C: 0.55 },
  // Over 2.5 overconfident di SEMUA pita (−3,1…−5,4pp) → A ditahan;
  // B ≥0.70 (hit 0.6919, n=805); C ≥0.60 (wilayah [0.60,0.70) hit 0.6074).
  ou25: { A: null, B: 0.7, C: 0.6 },
  // A ≥0.85 (hit 0.8675); B ≥0.60 (0.7266); C ≥0.55 (0.6417).
  // Caveat lab: 'under' pita 80–85 gap −0.0396 (n=621).
  ou35: { A: 0.85, B: 0.6, C: 0.55 },
  // Pasar paling jujur di lab: A ≥0.70 (hit 0.8007, n=6958); B ≥0.65
  // (wilayah [0.65,0.70) hit 0.6986); C ≥0.55 (0.6178).
  team_over05_home: { A: 0.7, B: 0.65, C: 0.55 },
  // A ≥0.75 (hit 0.7892); B ≥0.70 (wilayah [0.70,0.75) hit 0.7014); C ≥0.55 (0.6272).
  team_over05_away: { A: 0.75, B: 0.7, C: 0.55 },
};

const GRADE_ORDER: Record<Grade, number> = { A: 3, B: 2, C: 1 };

/**
 * 16 kandidat per pertandingan — persis himpunan kandidat lab
 * (parlay-lab candidatesPerMatch = 16). team_over05 hanya seleksi 'yes':
 * hanya itu yang diukur lab (bands.bySelectionDomestic tidak punya 'no'
 * untuk pasar tim), jadi 'no' tidak di-grade dari bukti yang tidak ada.
 */
export const CANDIDATES: ReadonlyArray<{ market: PickMarket; selection: string }> = [
  { market: "1x2", selection: "1" },
  { market: "1x2", selection: "x" },
  { market: "1x2", selection: "2" },
  { market: "dc", selection: "1x" },
  { market: "dc", selection: "12" },
  { market: "dc", selection: "x2" },
  { market: "ou15", selection: "over" },
  { market: "ou15", selection: "under" },
  { market: "ou25", selection: "over" },
  { market: "ou25", selection: "under" },
  { market: "ou35", selection: "over" },
  { market: "ou35", selection: "under" },
  { market: "btts", selection: "yes" },
  { market: "btts", selection: "no" },
  { market: "team_over05_home", selection: "yes" },
  { market: "team_over05_away", selection: "yes" },
];

/** Tepi pita lab (mirror BANDS di ledger; dipakai hanya untuk lookup bukti). */
const BAND_LOS = [0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85] as const;

export interface BandCell {
  band: string;
  lo: number;
  n: number;
  meanProb: number;
  hitRate: number;
  gap: number;
}

export type BandEvidence = Partial<
  Record<Population, Partial<Record<PickMarket, BandCell[]>>>
>;

let evidenceCache: BandEvidence | null = null;

/**
 * Muat bukti pita dari tasks/parlay-lab-results.json (sekali, di-cache).
 * File tidak terbaca → bukti kosong → semua effective_prob fallback ke stated
 * dengan flag (mesin tetap jalan; tidak ada angka yang dikarang).
 */
export function loadBandEvidence(resultsPath?: string): BandEvidence {
  if (evidenceCache) return evidenceCache;
  const file =
    resultsPath ??
    process.env.PICKS_LAB_RESULTS ??
    path.join(process.cwd(), "tasks", "parlay-lab-results.json");
  const out: BandEvidence = {};
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
      bands?: {
        byPopulation?: Record<
          string,
          Array<{ market?: string; bands?: BandCell[] }>
        >;
      };
    };
    for (const pop of ["domestic", "cup"] as Population[]) {
      const entries = raw.bands?.byPopulation?.[pop];
      if (!Array.isArray(entries)) continue;
      out[pop] = {};
      for (const entry of entries) {
        if (entry?.market && entry?.bands) {
          out[pop]![entry.market as PickMarket] = entry.bands;
        }
      }
    }
  } catch {
    /* bukti absen → fallback stated (ter-flag) */
  }
  evidenceCache = out;
  return out;
}

/** Sel pita yang memuat probabilitas p (null bila di luar cakupan lab). */
function bandCellFor(
  evidence: BandEvidence,
  population: Population,
  market: PickMarket,
  p: number,
): BandCell | null {
  if (p < BAND_LOS[0] || p >= 1.01) return null;
  const cells = evidence[population]?.[market];
  if (!cells) return null;
  return cells.find((c) => p >= c.lo && p < c.lo + 0.05 + (c.lo === 0.85 ? 0.11 : 0)) ?? null;
}

/**
 * Bangun ulang matriks skor dari (λ, μ, ρ) paket yang tersimpan — paket
 * tersimpan TIDAK menserialisasi score_matrix. Konvensi rasio harness lab:
 * calculateDixonColes merakit λ = leagueAvgGoals × homeAttack × awayDefense ×
 * homeAdvantage; dengan attack/defense = 1, leagueAvgGoals = μ, dan
 * homeAdvantage = λ/μ, λ internal ter-reproduksi persis (lalu di-round 3dp
 * oleh fungsi itu sendiri, sama seperti jalur produksi).
 */
export function rebuildMatrix(
  lambda: number,
  mu: number,
  rho = 0,
  maxGoals = 10,
): number[][] {
  if (!(mu > 0) || !(lambda > 0)) {
    throw new Error(`rebuildMatrix: λ/μ tidak valid (λ=${lambda}, μ=${mu})`);
  }
  return calculateDixonColes({
    homeAttack: 1,
    homeDefense: 1,
    awayAttack: 1,
    awayDefense: 1,
    leagueAvgGoals: mu,
    homeAdvantage: lambda / mu,
    rho,
    maxGoals,
  }).score_matrix;
}

/** Probabilitas (market, seleksi) = jumlah sel matriks yang lolos evaluatePick. */
export function probFromMatrix(
  matrix: number[][],
  market: PickMarket,
  selection: string,
): number {
  let s = 0;
  for (let h = 0; h < matrix.length; h++) {
    for (let a = 0; a < matrix[h].length; a++) {
      if (evaluatePick(market, selection, h, a) === 1) s += matrix[h][a];
    }
  }
  return s;
}

/** Probabilitas gabungan EKSAK dua kaki satu pertandingan dari matriks. */
export function jointProbFromMatrix(
  matrix: number[][],
  a: { market: PickMarket; selection: string },
  b: { market: PickMarket; selection: string },
): number {
  let s = 0;
  for (let h = 0; h < matrix.length; h++) {
    for (let aw = 0; aw < matrix[h].length; aw++) {
      if (
        evaluatePick(a.market, a.selection, h, aw) === 1 &&
        evaluatePick(b.market, b.selection, h, aw) === 1
      ) {
        s += matrix[h][aw];
      }
    }
  }
  return s;
}

/** Grade murni dari tabel lab (tanpa cap gerbang). Null = di bawah lantai C / ditahan. */
export function gradeFromTable(market: PickMarket, statedProb: number): Grade | null {
  const t = MARKET_GRADE_THRESHOLDS[market];
  if (t.A !== null && statedProb >= t.A) return "A";
  if (t.B !== null && statedProb >= t.B) return "B";
  if (t.C !== null && statedProb >= t.C) return "C";
  return null;
}

/** Cap gerbang kompetisi: partial → maks B; uncalibrated → tidak ada grade. */
export function applyGateCap(grade: Grade, gate: GateStatus): Grade | null {
  if (gate === "uncalibrated") return null;
  if (gate === "partial" && grade === "A") return "B";
  return grade;
}

/** Grade akhir = tabel lab lalu cap gerbang. Null = kaki tidak diterbitkan. */
export function gradeLeg(
  market: PickMarket,
  statedProb: number,
  gate: GateStatus,
): Grade | null {
  const g = gradeFromTable(market, statedProb);
  return g ? applyGateCap(g, gate) : null;
}

export interface EffectiveResult {
  effective_prob: number;
  source: "lab-band" | "stated-fallback";
  band: string | null;
  band_n: number | null;
}

/**
 * Effective probability dari bukti lab populasi terkait. Sel dipakai hanya
 * bila n ≥ LAB_MIN_CELL_N (notion kecukupan lab sendiri); selain itu fallback
 * ke stated, ter-flag.
 */
export function effectiveProb(
  market: PickMarket,
  statedProb: number,
  population: Population,
  evidence: BandEvidence = loadBandEvidence(),
): EffectiveResult {
  const cell = bandCellFor(evidence, population, market, statedProb);
  if (cell && cell.n >= LAB_MIN_CELL_N) {
    return {
      effective_prob: cell.hitRate,
      source: "lab-band",
      band: cell.band,
      band_n: cell.n,
    };
  }
  return {
    effective_prob: statedProb,
    source: "stated-fallback",
    band: cell?.band ?? null,
    band_n: cell?.n ?? null,
  };
}

const selKey = (market: PickMarket, selection: string) => `${market}:${selection}`;

export interface PickLeg {
  market: PickMarket;
  selection: string;
  /** Probabilitas model dari matriks skor (presisi penuh). */
  model_prob: number;
  /** Probabilitas efektif (bukti lab) — dipakai matematika parlay. */
  effective_prob: number;
  effective_source: "lab-band" | "stated-fallback";
  band: string | null;
  band_n: number | null;
  grade: Grade;
  /** Probabilitas pasar (Shin-stripped / two-way strip) bila disediakan driver. */
  market_prob: number | null;
  /** Probabilitas panel Sportmonks (skala 0..1) bila disediakan driver. */
  sm_prob: number | null;
  /** max − min dari probabilitas yang tersedia (≥2 sumber); null bila <2. */
  agreement_spread: number | null;
}

export interface PickLegsInput {
  matrix: number[][];
  gate_status: GateStatus;
  population: Population;
  /** Kunci `${market}:${selection}` → probabilitas 0..1. */
  market_probs?: Partial<Record<string, number>>;
  sm_probs?: Partial<Record<string, number>>;
  evidence?: BandEvidence;
}

/**
 * Terbitkan kaki ter-grade untuk satu pertandingan. Kaki di bawah lantai C
 * pasar-nya (atau tertahan cap gerbang) TIDAK diterbitkan. Urutan: grade
 * (A→C), lalu effective_prob menurun — urutan peringkat slate.
 */
export function pickLegs(input: PickLegsInput): PickLeg[] {
  const evidence = input.evidence ?? loadBandEvidence();
  const legs: PickLeg[] = [];
  for (const cand of CANDIDATES) {
    const stated = probFromMatrix(input.matrix, cand.market, cand.selection);
    const grade = gradeLeg(cand.market, stated, input.gate_status);
    if (!grade) continue;
    const eff = effectiveProb(cand.market, stated, input.population, evidence);
    const key = selKey(cand.market, cand.selection);
    const market_prob = input.market_probs?.[key] ?? null;
    const sm_prob = input.sm_probs?.[key] ?? null;
    const available = [stated, market_prob, sm_prob].filter(
      (v): v is number => v !== null,
    );
    legs.push({
      market: cand.market,
      selection: cand.selection,
      model_prob: stated,
      effective_prob: eff.effective_prob,
      effective_source: eff.source,
      band: eff.band,
      band_n: eff.band_n,
      grade,
      market_prob,
      sm_prob,
      agreement_spread:
        available.length >= 2 ? Math.max(...available) - Math.min(...available) : null,
    });
  }
  return legs.sort(
    (x, y) =>
      GRADE_ORDER[y.grade] - GRADE_ORDER[x.grade] ||
      y.effective_prob - x.effective_prob,
  );
}

export interface SameMatchCombo {
  legs: [
    { market: PickMarket; selection: string },
    { market: PickMarket; selection: string },
  ];
  /** Probabilitas gabungan eksak dari matriks (bukan produk). */
  stated_prob: number;
  /** Lab tidak punya sel bukti kombo → effective = stated, ter-flag. */
  effective_prob: number;
  effective_source: "joint-exact-stated";
}

/** Kombo dua kaki SATU pertandingan: probabilitas gabungan eksak dari matriks. */
export function sameMatchCombo(
  matrix: number[][],
  a: { market: PickMarket; selection: string },
  b: { market: PickMarket; selection: string },
): SameMatchCombo {
  const joint = jointProbFromMatrix(matrix, a, b);
  return {
    legs: [a, b],
    stated_prob: joint,
    effective_prob: joint,
    effective_source: "joint-exact-stated",
  };
}

export interface ParlayUnit {
  label: string;
  stated_prob: number;
  effective_prob: number;
}

export interface ParlayCombination {
  units: ParlayUnit[];
  /** Produk probabilitas stated — BATAS ATAS (lab: produk independensi melebih-lebihkan ~1,5–4pp). */
  combined_stated: number;
  /** Produk probabilitas efektif — estimasi titik. */
  combined_effective: number;
  range_note: string;
}

/**
 * Rakit parlay dari unit-unit (kaki lintas pertandingan ATAU kombo satu
 * pertandingan yang sudah dihitung eksak). Antar-unit diasumsikan independen;
 * hasil dilaporkan sebagai RANGE per temuan survival lab.
 */
export function combineParlay(units: ParlayUnit[]): ParlayCombination {
  if (units.length === 0) throw new Error("combineParlay: tidak ada unit");
  const combined_stated = units.reduce((p, u) => p * u.stated_prob, 1);
  const combined_effective = units.reduce((p, u) => p * u.effective_prob, 1);
  return {
    units,
    combined_stated,
    combined_effective,
    range_note:
      `Kombinasi efektif ${(combined_effective * 100).toFixed(1)}% adalah estimasi titik; ` +
      `produk stated ${(combined_stated * 100).toFixed(1)}% adalah batas atas — lab Fase A ` +
      `mengukur produk independensi melebih-lebihkan survival parlay ~1,5–4pp.`,
  };
}
