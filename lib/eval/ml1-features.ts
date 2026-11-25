/**
 * ML1 — EKSTRAKTOR FITUR POINT-IN-TIME (Shadow A/B; design beku di
 * tasks/ml1/design.md).
 *
 * Membangun vektor fitur per laga untuk kandidat GBDT Poisson ML1-A
 * (form/Elo murni) dan ML1-B (A + proxy shots/SoT as-of). Modul ini MURNI:
 * tidak membaca file, tidak menulis DB; pemanggil menyerahkan baris data
 * dalam urutan kanonik (universe: competition_id, utc_date; log kanonik:
 * team_id, match_date).
 *
 * Kontrak point-in-time: cutoff fitur = tanggal laga (bagian tanggal
 * utc_date), strictly-before — konvensi yang sama dengan evaluator PR 3
 * dan fitur Q1 PR 4. Komponen konteks (rest_adv, venue_neutral, promoted,
 * miss_rest) diambil dari Q1FeatureExtractor agar semantiknya IDENTIK
 * dengan PR 4; Elo mengikuti konstruksi Q0-Elo (lib/eval/q0-baselines.ts)
 * dengan predict-then-update; form bergulir dan shots bergulir dihitung
 * dari indeks prefix yang dibangun sekali di konstruktor.
 */
import { outcomeIndex, upperBoundDate, type EvalMatchRow } from "./chronological-evaluator";
import { Q1FeatureExtractor } from "./kandidat-q1-poisson";
import { ELO_HFA, ELO_K, ELO_START, eloExpected } from "./q0-baselines";

/** Baris log kanonik minimum yang dibutuhkan ML1-B (team_match_logs_canonical). */
export interface Ml1CanonicalLogRow {
  team_id: string;
  match_date: string;
  shots_for: number | null;
  shots_against: number | null;
  shots_on_target_for: number | null;
  shots_on_target_against: number | null;
}

/** Urutan kolom ML1-A (design §4 — beku). */
export const ML1_A_FEATURE_NAMES = [
  "form_gf5_home", "form_ga5_home", "form_gf10_home", "form_ga10_home",
  "form_gf5_away", "form_ga5_away", "form_gf10_away", "form_ga10_away",
  "elo_home", "elo_away", "elo_diff",
  "rest_adv", "venue_neutral", "promoted_home", "promoted_away",
  "miss_rest", "miss_form_home", "miss_form_away", "n_prior_home", "n_prior_away",
] as const;

/** Kolom tambahan ML1-B di atas ML1-A (design §4 — beku). */
export const ML1_B_EXTRA_NAMES = [
  "shots_for_home", "shots_against_home", "sot_for_home", "sot_against_home",
  "shots_for_away", "shots_against_away", "sot_for_away", "sot_against_away",
  "n_prior_shots_home", "n_prior_shots_away", "has_prior_shots_home", "has_prior_shots_away",
] as const;

export const ML1_B_FEATURE_NAMES = [...ML1_A_FEATURE_NAMES, ...ML1_B_EXTRA_NAMES] as const;

/** Jendela rolling shots (design §4) dan syarat riwayat minimum audit Item 21. */
export const ML1_SHOTS_WINDOW = 10;
export const ML1_SHOTS_MIN_PRIOR = 3;
/** Jendela rolling form (design §4). */
export const ML1_FORM_WINDOWS = [5, 10] as const;
/** Batas riwayat untuk miss_form (design §4). */
export const ML1_FORM_MIN_PRIOR = 3;

interface ShotSeries {
  dates: string[];
  /** Prefix sum per stat atas log dengan shots_for non-null (stat null dihitung 0, dengan prefix hitung non-null terpisah). */
  sf: number[]; sa: number[]; sotf: number[]; sota: number[];
  sfN: number[]; saN: number[]; sotfN: number[]; sotaN: number[];
}

export class Ml1FeatureExtractor {
  private readonly q1: Q1FeatureExtractor;
  private readonly teamDates = new Map<string, string[]>();
  private readonly teamGfPrefix = new Map<string, number[]>();
  private readonly teamGaPrefix = new Map<string, number[]>();
  private readonly eloByMatch = new Map<string, { home: number; away: number }>();
  private readonly shotSeries = new Map<string, ShotSeries>();

  /**
   * @param universeMatches baris laga universe (urutan: competition_id, utc_date)
   * @param compAvgMatches  baris SEMUA laga selesai (untuk indeks Q1: rest/promoted)
   * @param seasonByMatchId peta match_id -> label musim (kolom `season`)
   * @param canonicalLogs   baris team_match_logs_canonical (urutan: team_id, match_date)
   */
  constructor(
    universeMatches: EvalMatchRow[],
    compAvgMatches: EvalMatchRow[],
    seasonByMatchId: Map<string, string>,
    canonicalLogs: Ml1CanonicalLogRow[],
  ) {
    this.q1 = new Q1FeatureExtractor(universeMatches, compAvgMatches, seasonByMatchId);

    // --- Indeks form bergulir per tim (perspektif tim) -------------------
    const byTeam = new Map<string, EvalMatchRow[]>();
    for (const m of universeMatches) {
      const th = byTeam.get(m.home_team_id) ?? [];
      th.push(m);
      byTeam.set(m.home_team_id, th);
      const ta = byTeam.get(m.away_team_id) ?? [];
      ta.push(m);
      byTeam.set(m.away_team_id, ta);
    }
    for (const [team, arr] of byTeam) {
      arr.sort((x, y) => x.utc_date.localeCompare(y.utc_date));
      this.teamDates.set(team, arr.map((m) => m.utc_date.slice(0, 10)));
      const gf = [0];
      const ga = [0];
      for (const m of arr) {
        const isHome = m.home_team_id === team;
        gf.push(gf[gf.length - 1] + (isHome ? m.home_score : m.away_score));
        ga.push(ga[ga.length - 1] + (isHome ? m.away_score : m.home_score));
      }
      this.teamGfPrefix.set(team, gf);
      this.teamGaPrefix.set(team, ga);
    }

    // --- Elo sekuensial per kompetisi (konstruksi Q0-Elo) ----------------
    const byComp = new Map<string, EvalMatchRow[]>();
    for (const m of universeMatches) {
      const arr = byComp.get(m.competition_id) ?? [];
      arr.push(m);
      byComp.set(m.competition_id, arr);
    }
    for (const arr of byComp.values()) {
      const ratings = new Map<string, number>();
      const rating = (t: string): number => ratings.get(t) ?? ELO_START;
      for (const m of arr) {
        const rh = rating(m.home_team_id);
        const ra = rating(m.away_team_id);
        this.eloByMatch.set(m.match_id, { home: rh, away: ra });
        const gap = rh + ELO_HFA - ra;
        const y = outcomeIndex(m.home_score, m.away_score);
        const actual = y === 0 ? 1 : y === 1 ? 0.5 : 0;
        const delta = ELO_K * (actual - eloExpected(gap));
        ratings.set(m.home_team_id, rh + delta);
        ratings.set(m.away_team_id, ra - delta);
      }
    }

    // --- Indeks shots bergulir per tim (log kanonik, shots_for non-null) --
    const logsByTeam = new Map<string, Ml1CanonicalLogRow[]>();
    for (const l of canonicalLogs) {
      if (l.shots_for === null || l.shots_for === undefined) continue;
      const arr = logsByTeam.get(l.team_id) ?? [];
      arr.push(l);
      logsByTeam.set(l.team_id, arr);
    }
    for (const [team, arr] of logsByTeam) {
      arr.sort((x, y) => x.match_date.localeCompare(y.match_date));
      const s: ShotSeries = {
        dates: arr.map((l) => l.match_date),
        sf: [0], sa: [0], sotf: [0], sota: [0],
        sfN: [0], saN: [0], sotfN: [0], sotaN: [0],
      };
      const push = (prefix: number[], cnt: number[], v: number | null): void => {
        prefix.push(prefix[prefix.length - 1] + (v ?? 0));
        cnt.push(cnt[cnt.length - 1] + (v === null || v === undefined ? 0 : 1));
      };
      for (const l of arr) {
        push(s.sf, s.sfN, l.shots_for);
        push(s.sa, s.saN, l.shots_against);
        push(s.sotf, s.sotfN, l.shots_on_target_for);
        push(s.sota, s.sotaN, l.shots_on_target_against);
      }
      this.shotSeries.set(team, s);
    }
  }

  /** Rata-rata form satu tim atas `window` laga terakhir strictly sebelum cutoff. */
  private formWindow(teamId: string, cutoff: string, window: number): { gf: number; ga: number } {
    const dates = this.teamDates.get(teamId);
    if (!dates) return { gf: 0, ga: 0 };
    const end = upperBoundDate(dates, cutoff);
    if (end === 0) return { gf: 0, ga: 0 };
    const start = Math.max(0, end - window);
    const gfP = this.teamGfPrefix.get(teamId)!;
    const gaP = this.teamGaPrefix.get(teamId)!;
    const k = end - start;
    return { gf: (gfP[end] - gfP[start]) / k, ga: (gaP[end] - gaP[start]) / k };
  }

  /** Jumlah laga lampau tim strictly sebelum cutoff. */
  private nPrior(teamId: string, cutoff: string): number {
    const dates = this.teamDates.get(teamId);
    return dates ? upperBoundDate(dates, cutoff) : 0;
  }

  /** Blok shots satu tim: rata-rata jendela + hitungan + flag (design §4). */
  private shotsBlock(teamId: string, cutoff: string): { sf: number; sa: number; sotf: number; sota: number; n: number; has: number } {
    const zero = { sf: 0, sa: 0, sotf: 0, sota: 0, n: 0, has: 0 };
    const s = this.shotSeries.get(teamId);
    if (!s) return zero;
    const end = upperBoundDate(s.dates, cutoff);
    if (end < ML1_SHOTS_MIN_PRIOR) return { ...zero, n: end };
    const start = Math.max(0, end - ML1_SHOTS_WINDOW);
    const mean = (prefix: number[], cnt: number[]): number => {
      const k = cnt[end] - cnt[start];
      return k > 0 ? (prefix[end] - prefix[start]) / k : 0;
    };
    return {
      sf: mean(s.sf, s.sfN),
      sa: mean(s.sa, s.saN),
      sotf: mean(s.sotf, s.sotfN),
      sota: mean(s.sota, s.sotaN),
      n: end,
      has: 1,
    };
  }

  /** Vektor ML1-A (20 kolom, urutan ML1_A_FEATURE_NAMES). */
  featuresA(m: EvalMatchRow): number[] {
    const cutoff = m.utc_date.slice(0, 10);
    const q1f = this.q1.featuresFor(m);
    const f5h = this.formWindow(m.home_team_id, cutoff, ML1_FORM_WINDOWS[0]);
    const f10h = this.formWindow(m.home_team_id, cutoff, ML1_FORM_WINDOWS[1]);
    const f5a = this.formWindow(m.away_team_id, cutoff, ML1_FORM_WINDOWS[0]);
    const f10a = this.formWindow(m.away_team_id, cutoff, ML1_FORM_WINDOWS[1]);
    const nH = this.nPrior(m.home_team_id, cutoff);
    const nA = this.nPrior(m.away_team_id, cutoff);
    const elo = this.eloByMatch.get(m.match_id) ?? { home: ELO_START, away: ELO_START };
    return [
      f5h.gf, f5h.ga, f10h.gf, f10h.ga,
      f5a.gf, f5a.ga, f10a.gf, f10a.ga,
      elo.home, elo.away, elo.home - elo.away,
      q1f.home.restAdv, q1f.home.venueNeutral, q1f.home.promoted, q1f.away.promoted,
      q1f.home.missRest,
      nH < ML1_FORM_MIN_PRIOR ? 1 : 0,
      nA < ML1_FORM_MIN_PRIOR ? 1 : 0,
      nH, nA,
    ];
  }

  /** Vektor ML1-B (32 kolom, urutan ML1_B_FEATURE_NAMES) — 20 kolom pertama identik ML1-A. */
  featuresB(m: EvalMatchRow): number[] {
    const cutoff = m.utc_date.slice(0, 10);
    const a = this.featuresA(m);
    const sh = this.shotsBlock(m.home_team_id, cutoff);
    const sa = this.shotsBlock(m.away_team_id, cutoff);
    return [
      ...a,
      sh.sf, sh.sa, sh.sotf, sh.sota,
      sa.sf, sa.sa, sa.sotf, sa.sota,
      sh.n, sa.n, sh.has, sa.has,
    ];
  }
}
