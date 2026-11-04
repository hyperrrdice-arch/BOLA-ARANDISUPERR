/**
 * CUP FORM BLEND — inti bersama (murni, tanpa akses DB) untuk varian
 * form-blend di jalur piala (Phase C safe-bet parlay).
 *
 * Jalur piala produksi (lib/quant/global-offsets.ts) saat ini menyajikan
 * parameter offset murni TANPA blend telemetri last-6: att* = att·e^δ,
 * def* = def·e^−δ dari fit domestik, lalu λ = G·HA·attH*·defA*,
 * μ = G·attA*·defH*. Modul ini menerapkan blend James-Stein yang SAMA
 * seperti jalur domestik Level B (pemenang produksi κ×2) di atas prior
 * yang SUDAH ditransformasi δ:
 *
 *   priorAtt/priorDef  = att·e^δ / def·e^−δ  (dihitung pemanggil)
 *   liveAtt/liveDef    = dari telemetri rolling last-6 / form gol,
 *                        dinormalisasi terhadap avg = G (globalAvg graf)
 *   w                  = n / (n + κbase·KAPPA_SCALE), KAPPA_SCALE = 2
 *   blended            = clamp(round3(w·live + (1−w)·prior))
 *
 * Semantik cabang dicerminkan PERSIS dari cerminan lab di
 * scripts/parlay-lab.ts (blendInput / lamMuFromBlend), yang sendirinya
 * mencerminkan blend produksi di lib/quant/ratings-loader.ts
 * (~baris 770–850):
 *   - telemetri xG ≥ 3 sampel → live dari xG rolling, n = xgSamples,
 *     κbase = 8 (κ efektif 16);
 *   - else sampel telemetri ≥ 1 → live dari gol rolling, n = sampleSize,
 *     κbase = 14 (κ efektif 28);
 *   - else fallback form: liveAtt dari rata-rata gol form tim
 *     (default 1.35 kandang / 1.15 tandang bila tanpa form),
 *     liveDef = max(0.6, 2.0 − oppLiveAtt) kandang /
 *               max(0.7, 2.0 − oppLiveAtt) tandang,
 *     n = form.n atau 5, κbase = 16 (κ efektif 32).
 *
 * CATATAN KETERGANTUNGAN SILANG (persis lab/produksi): liveDef fallback
 * dihitung dari liveAtt FORM lawan (nilai berbasis form SEBELUM override
 * telemetri lawan), dan liveDef cabang-xG yang rollingXgAgainst-nya null
 * juga jatuh ke nilai fallback itu. Karena itu blend per tim menerima
 * `oppLiveAttForm` (liveAtt form lawan yang sudah dinormalisasi) —
 * blendCupMatch menghitung kedua nilai form dulu, baru mem-blend.
 *
 * Clamp pasca-blend sama seperti lamMuFromBlend lab: attH ≥ 0.5,
 * defH ≥ 0.5, attA ≥ 0.4, defA ≥ 0.5 (pembulatan round3 SEBELUM clamp).
 *
 * Modul ini murni: semua input struct polos (telemetri/form dihitung
 * pemanggil dari store offline), tidak ada baca DB / file di sini.
 */

/** Skala κ produksi tervalidasi (Level B, κ×2) — sama seperti parlay-lab. */
export const CUP_BLEND_KAPPA_SCALE = 2;

/** κbase per cabang telemetri (sebelum ×KAPPA_SCALE). */
export const CUP_BLEND_KAPPA_BASE = { xg: 8, goals: 14, fallback: 16 } as const;

export type CupBlendBranch = "xg" | "goals" | "fallback";
export type CupSide = "home" | "away";

/**
 * Telemetri rolling last-6 satu tim — bentuk identik RollingTelem di
 * scripts/parlay-lab.ts (rollingTelem): xG sudah tertimbang rasio
 * rata-rata kompetisi dan dibulatkan round2 oleh penghitungnya.
 */
export interface CupRollingTelem {
  sampleSize: number;
  xgSamples: number;
  rollingXgFor: number | null;
  rollingXgAgainst: number | null;
  rollingGoalsFor: number;
  rollingGoalsAgainst: number;
}

/** Form gol satu tim — bentuk identik keluaran formGoals di parlay-lab. */
export interface CupFormGoals {
  avg: number | null;
  n: number;
}

export interface CupBlendResult {
  att: number;
  def: number;
  /** Bobot live (James-Stein) yang dipakai sisi ini. */
  w: number;
  branch: CupBlendBranch;
  liveAtt: number;
  liveDef: number;
  n: number;
  kappaBase: number;
}

const round3 = (v: number) => Number(v.toFixed(3));

/** Default liveAtt form (gol absolut) per sisi bila tim tanpa form. */
const FORM_DEFAULT: Record<CupSide, number> = { home: 1.35, away: 1.15 };
/** Lantai liveDef fallback per sisi pemilik def (bukan sisi lawan). */
const FALLBACK_DEF_FLOOR: Record<CupSide, number> = { home: 0.6, away: 0.7 };
/** Lantai att pasca-blend per sisi (lamMuFromBlend: attH 0.5, attA 0.4). */
const ATT_FLOOR: Record<CupSide, number> = { home: 0.5, away: 0.4 };

/**
 * LiveAtt berbasis form saja (dinormalisasi terhadap avg) — nilai yang
 * dipakai lab/produksi sebagai basis liveDef fallback lawan, dihitung
 * SEBELUM override telemetri apa pun.
 */
export function formLiveAttack(form: CupFormGoals, side: CupSide, avg: number): number {
  const raw = form.avg && form.avg > 0 ? form.avg : FORM_DEFAULT[side];
  return raw / avg;
}

/** LiveDef fallback dari liveAtt form lawan (sudah dinormalisasi). */
function fallbackLiveDef(side: CupSide, oppLiveAttForm: number): number {
  return Math.max(FALLBACK_DEF_FLOOR[side], 2.0 - oppLiveAttForm);
}

/**
 * Blend satu tim: prior (sudah tertransformasi δ) × live (telemetri/form).
 * `oppLiveAttForm` = formLiveAttack(form lawan, sisi lawan, avg) — hanya
 * dipakai cabang fallback dan cabang xG tanpa rollingXgAgainst.
 */
export function blendCupTeam(args: {
  priorAtt: number;
  priorDef: number;
  side: CupSide;
  telem: CupRollingTelem;
  form: CupFormGoals;
  oppLiveAttForm: number;
  avg: number;
  kappaScale?: number;
}): CupBlendResult {
  const { priorAtt, priorDef, side, telem, form, oppLiveAttForm, avg } = args;
  const kappaScale = args.kappaScale ?? CUP_BLEND_KAPPA_SCALE;

  let branch: CupBlendBranch;
  let liveAtt: number;
  let liveDef: number;
  let n: number;
  let kappaBase: number;

  if (telem.xgSamples >= 3 && telem.rollingXgFor !== null) {
    branch = "xg";
    liveAtt = telem.rollingXgFor / avg;
    liveDef = telem.rollingXgAgainst !== null ? telem.rollingXgAgainst / avg : fallbackLiveDef(side, oppLiveAttForm);
    n = telem.xgSamples;
    kappaBase = CUP_BLEND_KAPPA_BASE.xg;
  } else if (telem.sampleSize >= 1) {
    branch = "goals";
    liveAtt = telem.rollingGoalsFor / avg;
    liveDef = telem.rollingGoalsAgainst / avg;
    n = telem.sampleSize;
    kappaBase = CUP_BLEND_KAPPA_BASE.goals;
  } else {
    branch = "fallback";
    liveAtt = formLiveAttack(form, side, avg);
    liveDef = fallbackLiveDef(side, oppLiveAttForm);
    n = form.n > 0 ? form.n : 5;
    kappaBase = CUP_BLEND_KAPPA_BASE.fallback;
  }

  const w = n / (n + kappaBase * kappaScale);
  const att = Math.max(ATT_FLOOR[side], round3(w * liveAtt + (1 - w) * priorAtt));
  const def = Math.max(0.5, round3(w * liveDef + (1 - w) * priorDef));
  return { att, def, w, branch, liveAtt, liveDef, n, kappaBase };
}

/**
 * Blend kedua tim satu laga piala: menghitung liveAtt form kedua sisi
 * dulu (untuk liveDef fallback silang), lalu blendCupTeam per sisi.
 */
export function blendCupMatch(args: {
  priorAttH: number;
  priorDefH: number;
  priorAttA: number;
  priorDefA: number;
  telemH: CupRollingTelem;
  telemA: CupRollingTelem;
  formH: CupFormGoals;
  formA: CupFormGoals;
  avg: number;
  kappaScale?: number;
}): { home: CupBlendResult; away: CupBlendResult } {
  const formAttH = formLiveAttack(args.formH, "home", args.avg);
  const formAttA = formLiveAttack(args.formA, "away", args.avg);
  const home = blendCupTeam({
    priorAtt: args.priorAttH,
    priorDef: args.priorDefH,
    side: "home",
    telem: args.telemH,
    form: args.formH,
    oppLiveAttForm: formAttA,
    avg: args.avg,
    kappaScale: args.kappaScale,
  });
  const away = blendCupTeam({
    priorAtt: args.priorAttA,
    priorDef: args.priorDefA,
    side: "away",
    telem: args.telemA,
    form: args.formA,
    oppLiveAttForm: formAttH,
    avg: args.avg,
    kappaScale: args.kappaScale,
  });
  return { home, away };
}

/**
 * Kombiner λ/μ jalur piala dari parameter hasil blend:
 * λ = G·HA·attH·defA, μ = G·attA·defH (formula offset global, dengan
 * att/def di sini adalah keluaran blend di atas prior tertransformasi δ).
 */
export function cupLamMu(
  home: { att: number; def: number },
  away: { att: number; def: number },
  globalAvg: number,
  cupHA: number,
): { lam: number; mu: number } {
  return {
    lam: globalAvg * cupHA * home.att * away.def,
    mu: globalAvg * away.att * home.def,
  };
}
