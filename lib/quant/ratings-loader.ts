import path from "node:path";
import fs from "node:fs";
import { normalizeTeamName } from "./team-normalizer";

export interface TeamRating {
  name: string;
  attack: number;   // alpha_i (mean = 1.0)
  defense: number;  // beta_i (mean = 1.0, lower is better)
  matchesCount: number;
  goalsScored: number;
  goalsConceded: number;
  lastMatchDate: string;
}

export interface LeagueCalibratedParameters {
  div: string;
  leagueName: string;
  country: string;
  seasonCount: number;
  totalMatches: number;
  leagueAvgGoals: number;
  homeAdvantage: number;
  rho: number;
  calibrationDate: string;
  teams: Record<string, TeamRating>;
}

export interface CalibratedRatingsFile {
  version: string;
  compiledAt: string;
  totalLeagues: number;
  totalTeams: number;
  leagues: Record<string, LeagueCalibratedParameters>;
}

export interface ShrunkMatchParameters {
  homeAttack: number;
  homeDefense: number;
  awayAttack: number;
  awayDefense: number;
  homeAdvantage: number;
  leagueAvgGoals: number;
  rho: number;
  shrinkageWeights: {
    home: number;
    away: number;
  };
  isCalibrated: boolean;
  metadata?: {
    div: string;
    leagueName: string;
    homeSource: "primary_league" | "second_division_promoted" | "fallback";
    awaySource: "primary_league" | "second_division_promoted" | "fallback";
  };
}

// Pemetaan alias kompetisi (TheStatsAPI/1xBet -> Football-Data Div Code)
export const LEAGUE_ALIAS_TO_DIV: Record<string, string> = {
  // Premier League
  "premier league": "E0",
  "epl": "E0",
  "english premier league": "E0",
  "england premier league": "E0",
  "championship": "E1",
  "english championship": "E1",
  "efl championship": "E1",

  // La Liga
  "la liga": "SP1",
  "laliga": "SP1",
  "primera division": "SP1",
  "spanish la liga": "SP1",
  "segunda division": "SP2",
  "la liga 2": "SP2",

  // Serie A
  "serie a": "I1",
  "italian serie a": "I1",
  "italy serie a": "I1",
  "serie b": "I2",
  "italian serie b": "I2",

  // Bundesliga
  "bundesliga": "D1",
  "german bundesliga": "D1",
  "germany bundesliga": "D1",
  "2. bundesliga": "D2",
  "2 bundesliga": "D2",

  // Ligue 1
  "ligue 1": "F1",
  "french ligue 1": "F1",
  "france ligue 1": "F1",
  "ligue 2": "F2",

  // Eredivisie & Lainnya
  "eredivisie": "N1",
  "dutch eredivisie": "N1",
  "primeira liga": "P1",
  "portuguese primeira liga": "P1",
  "pro league": "B1",
  "belgian pro league": "B1",
  "scottish premiership": "SC0",
  "super lig": "T1",
  "turkish super lig": "T1",
};

// Pasangan Divisi Utama & Kasta Kedua untuk penanganan tim promosi/degradasi
const SECOND_DIVISION_MAP: Record<string, string> = {
  E0: "E1",
  SP1: "SP2",
  I1: "I2",
  D1: "D2",
  F1: "F2",
};

// In-memory cache singleton
let cachedRatings: CalibratedRatingsFile | null = null;

export function loadCalibratedRatings(): CalibratedRatingsFile | null {
  if (cachedRatings) {
    return cachedRatings;
  }

  try {
    const jsonPath = path.join(process.cwd(), "data", "calibrated_ratings.json");
    if (fs.existsSync(jsonPath)) {
      const raw = fs.readFileSync(jsonPath, "utf-8");
      cachedRatings = JSON.parse(raw) as CalibratedRatingsFile;
      return cachedRatings;
    }
  } catch (err) {
    console.error("[ratings-loader] Gagal memuat data/calibrated_ratings.json:", err);
  }

  return null;
}

export function resolveDivCode(leagueHint?: string): string | null {
  if (!leagueHint) return null;
  const clean = leagueHint.trim().toLowerCase();
  if (LEAGUE_ALIAS_TO_DIV[clean]) return LEAGUE_ALIAS_TO_DIV[clean];

  // Cek jika hint sudah berupa kode divisi (E0, SP1, dsb.)
  const upper = leagueHint.trim().toUpperCase();
  const file = loadCalibratedRatings();
  if (file && file.leagues[upper]) {
    return upper;
  }

  return null;
}

/**
 * Mencari rating tim di liga utama, atau di divisi kasta kedua jika tim promosi
 */
export function findTeamRating(
  data: CalibratedRatingsFile,
  div: string,
  normalizedTeam: string
): { rating: TeamRating; source: "primary_league" | "second_division_promoted" } | null {
  const league = data.leagues[div];

  // 1. Cek langsung di divisi utama
  if (league?.teams[normalizedTeam]) {
    return { rating: league.teams[normalizedTeam], source: "primary_league" };
  }

  // 2. Cek di kasta kedua (jika tim promosi)
  const secondDiv = SECOND_DIVISION_MAP[div];
  if (secondDiv && data.leagues[secondDiv]?.teams[normalizedTeam]) {
    const rawSecondRating = data.leagues[secondDiv].teams[normalizedTeam];
    // Terapkan diskon konversi liga: attack didiskon 15%, defense dinaikkan 20%
    const adjustedRating: TeamRating = {
      ...rawSecondRating,
      attack: Number((rawSecondRating.attack * 0.85).toFixed(3)),
      defense: Number((rawSecondRating.defense * 1.20).toFixed(3)),
    };
    return { rating: adjustedRating, source: "second_division_promoted" };
  }

  // 3. Fallback pencarian lintas liga
  for (const [otherDiv, otherLeague] of Object.entries(data.leagues)) {
    if (otherDiv === div || otherDiv === secondDiv) continue;
    if (otherLeague.teams[normalizedTeam]) {
      return { rating: otherLeague.teams[normalizedTeam], source: "second_division_promoted" };
    }
  }

  return null;
}

/**
 * Menghitung parameter Dixon-Coles dengan James-Stein Empirical Bayes Shrinkage
 */
export function getShrunkMatchParameters(options: {
  homeTeam: string;
  awayTeam: string;
  liveHomeFormGoalsAvg?: number;
  liveAwayFormGoalsAvg?: number;
  homeSampleN?: number; // Jumlah laga live form yang tersedia (default 5)
  awaySampleN?: number;
  leagueHint?: string;
}): ShrunkMatchParameters {
  const normHome = normalizeTeamName(options.homeTeam);
  const normAway = normalizeTeamName(options.awayTeam);

  const ratingsData = loadCalibratedRatings();
  const divCode = resolveDivCode(options.leagueHint) || "E0"; // Default ke EPL jika tidak dikenal

  // Default fallback jika data JSON tidak tersedia sama sekali
  const defaultFallback: ShrunkMatchParameters = {
    homeAttack: options.liveHomeFormGoalsAvg || 1.35,
    homeDefense: Math.max(0.6, 2.5 - (options.liveAwayFormGoalsAvg || 1.2)),
    awayAttack: options.liveAwayFormGoalsAvg || 1.15,
    awayDefense: Math.max(0.7, 2.6 - (options.liveHomeFormGoalsAvg || 1.35)),
    homeAdvantage: 1.15,
    leagueAvgGoals: 1.35,
    rho: -0.04,
    shrinkageWeights: { home: 1.0, away: 1.0 },
    isCalibrated: false,
  };

  if (!ratingsData || !ratingsData.leagues[divCode]) {
    return defaultFallback;
  }

  const league = ratingsData.leagues[divCode];
  const homeResolved = findTeamRating(ratingsData, divCode, normHome);
  const awayResolved = findTeamRating(ratingsData, divCode, normAway);

  // Jika kedua tim tidak ditemukan sama sekali di database historis
  if (!homeResolved && !awayResolved) {
    return {
      ...defaultFallback,
      homeAdvantage: Number.isFinite(league.homeAdvantage) && league.homeAdvantage > 0 ? league.homeAdvantage : 1.15,
      leagueAvgGoals: Number.isFinite(league.leagueAvgGoals) && league.leagueAvgGoals > 0 ? league.leagueAvgGoals : 1.35,
      rho: Number.isFinite(league.rho) ? league.rho : -0.04,
    };
  }

  // Parameter shrinkage James-Stein: w_i = n_i / (n_i + kappa)
  // kappa = 16 (standar sindikat kuantitatif untuk prior half-season)
  const KAPPA = 16;
  const nHome = Math.max(0, Number.isFinite(options.homeSampleN) ? (options.homeSampleN as number) : 5);
  const nAway = Math.max(0, Number.isFinite(options.awaySampleN) ? (options.awaySampleN as number) : 5);

  const wHome = (nHome + KAPPA) > 0 ? nHome / (nHome + KAPPA) : 0;
  const wAway = (nAway + KAPPA) > 0 ? nAway / (nAway + KAPPA) : 0;

  const safeLeagueAvg = Number.isFinite(league.leagueAvgGoals) && league.leagueAvgGoals > 0 ? league.leagueAvgGoals : 1.35;

  // Estimasi Live Attack dengan proteksi division by zero & NaN
  const rawHomeGoals = Number.isFinite(options.liveHomeFormGoalsAvg) && (options.liveHomeFormGoalsAvg as number) > 0
    ? (options.liveHomeFormGoalsAvg as number)
    : 1.35;
  const rawAwayGoals = Number.isFinite(options.liveAwayFormGoalsAvg) && (options.liveAwayFormGoalsAvg as number) > 0
    ? (options.liveAwayFormGoalsAvg as number)
    : 1.15;

  const liveHomeAttack = rawHomeGoals / safeLeagueAvg;
  const liveAwayAttack = rawAwayGoals / safeLeagueAvg;

  // Baseline Histori
  const histHomeAttack = homeResolved && Number.isFinite(homeResolved.rating.attack) ? homeResolved.rating.attack : 1.0;
  const histHomeDefense = homeResolved && Number.isFinite(homeResolved.rating.defense) ? homeResolved.rating.defense : 1.0;
  const histAwayAttack = awayResolved && Number.isFinite(awayResolved.rating.attack) ? awayResolved.rating.attack : 1.0;
  const histAwayDefense = awayResolved && Number.isFinite(awayResolved.rating.defense) ? awayResolved.rating.defense : 1.0;

  // James-Stein Shrinkage Blend
  const calcHomeAttack = wHome * liveHomeAttack + (1 - wHome) * histHomeAttack;
  const calcHomeDefense = wHome * Math.max(0.6, 2.5 - liveAwayAttack) + (1 - wHome) * histHomeDefense;
  const calcAwayAttack = wAway * liveAwayAttack + (1 - wAway) * histAwayAttack;
  const calcAwayDefense = wAway * Math.max(0.7, 2.6 - liveHomeAttack) + (1 - wAway) * histAwayDefense;

  const finalHomeAttack = Number.isFinite(calcHomeAttack) ? Number(calcHomeAttack.toFixed(3)) : 1.35;
  const finalHomeDefense = Number.isFinite(calcHomeDefense) ? Number(calcHomeDefense.toFixed(3)) : 1.15;
  const finalAwayAttack = Number.isFinite(calcAwayAttack) ? Number(calcAwayAttack.toFixed(3)) : 1.15;
  const finalAwayDefense = Number.isFinite(calcAwayDefense) ? Number(calcAwayDefense.toFixed(3)) : 1.25;

  return {
    homeAttack: Math.max(0.5, finalHomeAttack),
    homeDefense: Math.max(0.5, finalHomeDefense),
    awayAttack: Math.max(0.4, finalAwayAttack),
    awayDefense: Math.max(0.5, finalAwayDefense),
    homeAdvantage: Number.isFinite(league.homeAdvantage) && league.homeAdvantage > 0 ? league.homeAdvantage : 1.15,
    leagueAvgGoals: safeLeagueAvg,
    rho: Number.isFinite(league.rho) ? league.rho : -0.04,
    shrinkageWeights: {
      home: Number(wHome.toFixed(3)),
      away: Number(wAway.toFixed(3)),
    },
    isCalibrated: true,
    metadata: {
      div: divCode,
      leagueName: league.leagueName,
      homeSource: homeResolved ? homeResolved.source : "fallback",
      awaySource: awayResolved ? awayResolved.source : "fallback",
    },
  };
}
