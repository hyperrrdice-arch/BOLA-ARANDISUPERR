/**
 * FIT RATING LIGA — inti fit IPF attack/defense dengan time-decay +
 * shrinkage κ. Diekstrak dari scripts/calibrate-ratings.ts (K4 · paritas
 * model lab/produksi) agar SATU implementasi fit dipakai jalur produksi
 * (calibrate-ratings) dan jalur lab/uji (suite Q02: determinisme +
 * pemisahan latih/uji). Algoritme TIDAK diubah dari versi skrip.
 *
 * Parameterisasi identik dengan yang dibaca lib/quant/ratings-loader.ts:
 *   λ_home = leagueAvgGoals × attack_home × defense_away × homeAdvantage
 *   λ_away = leagueAvgGoals × attack_away × defense_home
 *   dengan leagueAvgGoals = rata-rata gol tim AWAY, homeAdvantage = μH/μA,
 *   attack & defense ternormalisasi ke rata-rata 1.
 * Bobot time-decay: w = 0.5^(umur_hari/halfLifeDays).
 *
 * Shrinkage fit: attack/defense tiap tim di-shrink log-space menuju 1,0
 * dengan bobot n_tim/(n_tim+κ). Default κ=10 DIPILIH walk-forward
 * out-of-sample (Fase 3, tasks/oos-results.json). κ di sini adalah "kfit"
 * pada penamaan harness lab (backtest-walkforward: hl365|rho:zero|kfit:10).
 */
import { poissonLogProb, tauAdjustment } from "./dixon-coles";

export interface FitMatchRow {
  competition_id: string; season: string; utc_date: string;
  home_team_id: string; away_team_id: string; home_score: number; away_score: number;
}

export interface LeagueFitResult {
  leagueAvgGoals: number; homeAdvantage: number;
  attack: Map<string, number>; defense: Map<string, number>;
  scaleRatio: number; nMatches: number;
  /** Lambda per match (selaras urutan `matches`) untuk fit rho. */
  lamHome: number[];
  /** Bobot decay per match (dipakai fit rho agar konsisten dengan fit IPF). */
  lamAway: number[];
  weights: number[];
}

export interface FitOptions {
  /** Titik referensi decay (ms epoch) — biasanya waktu fit dijalankan. */
  nowMs: number;
  /** Paruh waktu decay dalam hari. Default produksi 365. */
  halfLifeDays?: number;
  /** κ shrinkage fit (= kfit). Default produksi 10; 0 menonaktifkan. */
  shrinkKappa?: number;
}

export const FIT_DEFAULTS = { halfLifeDays: 365, shrinkKappa: 10 } as const;

/**
 * Pemisahan latih/uji (kontrak Q02): baris yang boleh masuk fit pada
 * cutoff `cutoffIso` hanyalah hasil final (skor ada) bertanggal KETAT
 * sebelum cutoff. Baris bertanggal ≥ cutoff — termasuk baris dari "masa
 * depan" relatif terhadap keputusan — tidak pernah masuk fit.
 */
export function selectTrainingRows<
  T extends { utc_date: string; home_score: number | null; away_score: number | null },
>(rows: readonly T[], cutoffIso: string): T[] {
  return rows.filter(
    (r) =>
      r.home_score != null &&
      r.away_score != null &&
      typeof r.utc_date === "string" &&
      r.utc_date < cutoffIso,
  );
}

/** IPF dengan bobot waktu; parameterisasi identik ratings-loader. */
export function fitLeagueRatings(matches: FitMatchRow[], opts: FitOptions): LeagueFitResult | null {
  const halfLifeDays = opts.halfLifeDays ?? FIT_DEFAULTS.halfLifeDays;
  const shrinkKappa = opts.shrinkKappa ?? FIT_DEFAULTS.shrinkKappa;
  const nowMs = opts.nowMs;
  // IPF linear O(match) per iterasi (tim diindeks, array datar) — update
  // multiplikatifnya IDENTIK dengan implementasi lama yang memindai semua
  // match per tim per iterasi (O(tim × match)): λ/att_t menyisakan
  // lgAvg × def_lawan (× HA) sehingga den penyebut bisa diakumulasi satu
  // lintasan. Ekuivalensi terverifikasi 2026-11-04: selisih parameter
  // maksimum 4,4e-16 pada sm:8/sm:1034/sm:779, runtime 50–300× lebih cepat.
  const teamIdx = new Map<string, number>();
  for (const m of matches) {
    if (!teamIdx.has(m.home_team_id)) teamIdx.set(m.home_team_id, teamIdx.size);
    if (!teamIdx.has(m.away_team_id)) teamIdx.set(m.away_team_id, teamIdx.size);
  }
  const T = teamIdx.size;
  const n = matches.length;
  if (T < 4 || n === 0) return null;
  const hi = new Int32Array(n), ai = new Int32Array(n);
  const hs = new Float64Array(n), as = new Float64Array(n), w = new Float64Array(n);
  let wSum = 0, hSum = 0, aSum = 0;
  for (let i = 0; i < n; i++) {
    const m = matches[i];
    hi[i] = teamIdx.get(m.home_team_id)!;
    ai[i] = teamIdx.get(m.away_team_id)!;
    hs[i] = m.home_score; as[i] = m.away_score;
    w[i] = Math.pow(0.5, (nowMs - Date.parse(m.utc_date)) / (halfLifeDays * 86400_000));
    wSum += w[i]; hSum += w[i] * hs[i]; aSum += w[i] * as[i];
  }
  const muH = hSum / wSum;
  const muA = aSum / wSum;
  if (!(muA > 0) || !(muH > 0)) return null;
  const lgAvg = muA;
  const ha = muH / muA;
  const attack = new Float64Array(T).fill(1);
  const defense = new Float64Array(T).fill(1);
  const baseH = new Float64Array(n), baseA = new Float64Array(n);
  const num = new Float64Array(T), den = new Float64Array(T);
  for (let iter = 0; iter < 200; iter++) {
    let maxDelta = 0;
    // Serangan
    for (let i = 0; i < n; i++) { baseH[i] = lgAvg * defense[ai[i]] * ha; baseA[i] = lgAvg * defense[hi[i]]; }
    num.fill(0); den.fill(0);
    for (let i = 0; i < n; i++) {
      num[hi[i]] += w[i] * hs[i]; den[hi[i]] += w[i] * baseH[i];
      num[ai[i]] += w[i] * as[i]; den[ai[i]] += w[i] * baseA[i];
    }
    for (let t = 0; t < T; t++) {
      if (den[t] > 0) {
        const next = num[t] / den[t];
        const d = Math.abs(next - attack[t]);
        if (d > maxDelta) maxDelta = d;
        attack[t] = next;
      }
    }
    // Pertahanan
    for (let i = 0; i < n; i++) { baseH[i] = lgAvg * attack[hi[i]] * ha; baseA[i] = lgAvg * attack[ai[i]]; }
    num.fill(0); den.fill(0);
    for (let i = 0; i < n; i++) {
      num[ai[i]] += w[i] * hs[i]; den[ai[i]] += w[i] * baseH[i];
      num[hi[i]] += w[i] * as[i]; den[hi[i]] += w[i] * baseA[i];
    }
    for (let t = 0; t < T; t++) {
      if (den[t] > 0) {
        const next = num[t] / den[t];
        const d = Math.abs(next - defense[t]);
        if (d > maxDelta) maxDelta = d;
        defense[t] = next;
      }
    }
    // Normalisasi rata-rata 1
    let ma = 0, md = 0;
    for (let t = 0; t < T; t++) { ma += attack[t]; md += defense[t]; }
    ma /= T; md /= T;
    if (ma > 0) for (let t = 0; t < T; t++) attack[t] /= ma;
    if (md > 0) for (let t = 0; t < T; t++) defense[t] /= md;
    if (maxDelta < 1e-7) break;
  }
  // Shrinkage fit (lihat FitOptions.shrinkKappa): diterapkan SEBELUM uji
  // skala dan penulisan ratings — parameter yang diuji gerbang = parameter
  // tersaji.
  if (shrinkKappa > 0) {
    const counts = new Float64Array(T);
    for (let i = 0; i < n; i++) { counts[hi[i]]++; counts[ai[i]]++; }
    const shrinkArr = (arr: Float64Array) => {
      let sum = 0;
      for (let t = 0; t < T; t++) {
        const wgt = counts[t] / (counts[t] + shrinkKappa);
        arr[t] = Math.exp(Math.log(Math.max(1e-6, arr[t])) * wgt);
        sum += arr[t];
      }
      const mean = sum / T;
      if (mean > 0) for (let t = 0; t < T; t++) arr[t] /= mean;
    };
    shrinkArr(attack);
    shrinkArr(defense);
  }
  const attackMap = new Map<string, number>();
  const defenseMap = new Map<string, number>();
  for (const [team, idx] of teamIdx) { attackMap.set(team, attack[idx]); defenseMap.set(team, defense[idx]); }
  const lamHome = (m: FitMatchRow) => lgAvg * (attackMap.get(m.home_team_id) ?? 1) * (defenseMap.get(m.away_team_id) ?? 1) * ha;
  const lamAway = (m: FitMatchRow) => lgAvg * (attackMap.get(m.away_team_id) ?? 1) * (defenseMap.get(m.home_team_id) ?? 1);
  // Uji skala: Σλ (tanpa bobot, seluruh match) vs Σ gol aktual.
  let lam = 0, goals = 0;
  for (const m of matches) { lam += lamHome(m) + lamAway(m); goals += m.home_score + m.away_score; }
  return {
    leagueAvgGoals: lgAvg, homeAdvantage: ha, attack: attackMap, defense: defenseMap,
    scaleRatio: goals > 0 ? lam / goals : 0, nMatches: n,
    lamHome: matches.map((m) => lamHome(m)), lamAway: matches.map((m) => lamAway(m)),
    weights: Array.from(w),
  };
}

/**
 * Fit rho per liga: grid search memaksimalkan log-likelihood skor eksak
 * (terbobot decay yang sama dengan fit IPF) atas λ/μ hasil fit.
 * Kebijakan pemakaiannya (zero/global/fitted) dipilih via validasi OOS.
 */
export function fitRhoOnTrain(matches: FitMatchRow[], fit: LeagueFitResult): number {
  let bestRho = 0;
  let bestLL = -Infinity;
  for (let rho = -0.20; rho <= 0.0501; rho += 0.005) {
    let ll = 0;
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const lam = fit.lamHome[i], mu = fit.lamAway[i];
      const tau = tauAdjustment(m.home_score, m.away_score, lam, mu, rho);
      if (tau <= 0) { ll = -Infinity; break; }
      ll += fit.weights[i] * (poissonLogProb(lam, m.home_score) + poissonLogProb(mu, m.away_score) + Math.log(tau));
    }
    if (ll > bestLL) { bestLL = ll; bestRho = rho; }
  }
  return Number(bestRho.toFixed(3));
}
