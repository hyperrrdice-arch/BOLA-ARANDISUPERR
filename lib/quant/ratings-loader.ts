import path from "node:path";
import fs from "node:fs";
import { normalizeTeamName } from "./team-normalizer";
import { getTheStatsDb } from "../db/thestats-dataset";
import { getTeamRollingTelemetry, type TeamRollingTelemetry } from "../db/team-telemetry";
import { evaluateMatchupLuck, type MatchupLuckSignal } from "./luck-regression";

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
    macroPriorDate?: string;
    telemetrySource?: {
      home: "thestats_observed_xg" | "thestats_observed_goals" | "macro_prior_only";
      away: "thestats_observed_xg" | "thestats_observed_goals" | "macro_prior_only";
    };
    observedXgSamples?: {
      home: number;
      away: number;
    };
    isEstimatedTelemetry?: boolean;
    preMatchCutoff?: string;
    luckMetrics?: MatchupLuckSignal;
  };
}

// Pemetaan alias kompetisi (TheStatsAPI/1xBet -> Football-Data Div Code)
export const LEAGUE_ALIAS_TO_DIV: Record<string, string> = {
  // Premier League
  "premier league": "E0",
  "epl": "E0",
  "english premier league": "E0",
  "england premier league": "E0",
  "england. premier league": "E0",
  "championship": "E1",
  "english championship": "E1",
  "efl championship": "E1",
  "england. championship": "E1",

  // La Liga
  "la liga": "SP1",
  "laliga": "SP1",
  "primera division": "SP1",
  "spanish la liga": "SP1",
  "spain. la liga": "SP1",
  "segunda division": "SP2",
  "spanish segunda division": "SP2",
  "spain. segunda division": "SP2",
  "la liga 2": "SP2",

  // Serie A
  "serie a": "I1",
  "italian serie a": "I1",
  "italy serie a": "I1",
  "italy. serie a": "I1",
  "serie b": "I2",
  "italian serie b": "I2",
  "italy. serie b": "I2",

  // Bundesliga
  "bundesliga": "D1",
  "german bundesliga": "D1",
  "germany bundesliga": "D1",
  "germany. bundesliga": "D1",
  "2. bundesliga": "D2",
  "2 bundesliga": "D2",
  "german 2. bundesliga": "D2",
  "germany. 2. bundesliga": "D2",

  // Ligue 1
  "ligue 1": "F1",
  "french ligue 1": "F1",
  "france ligue 1": "F1",
  "france. ligue 1": "F1",
  "ligue 2": "F2",
  "french ligue 2": "F2",
  "france. ligue 2": "F2",

  // Eredivisie & Lainnya
  "eredivisie": "N1",
  "dutch eredivisie": "N1",
  "netherlands. eredivisie": "N1",
  "primeira liga": "P1",
  "portuguese primeira liga": "P1",
  "portugal. primeira liga": "P1",
  "pro league": "B1",
  "belgian pro league": "B1",
  "belgian first division a": "B1",
  "belgium. pro league": "B1",
  "belgium. first division a": "B1",
  "scottish premiership": "SC0",
  "scotland. premiership": "SC0",
  "super lig": "T1",
  "turkish super lig": "T1",
  "turkey. super lig": "T1",

  // Greek Super League (HATI-HATI: bedakan dari "super lig" T1 Turki)
  "super league": "G1",
  "greek super league": "G1",
  "super league greece": "G1",
  "greece. super league": "G1",
  "greece super league": "G1",
  "greek super league 1": "G1",
  "super league 1 greece": "G1",

  // UEFA Champions League (Kontinental)
  "ucl": "UCL",
  "champions league": "UCL",
  "uefa champions league": "UCL",
  "champions-league": "UCL",
  "europe. uefa champions league": "UCL",
};

// Koefisien Kualitas Liga UEFA Q(L) untuk penskalaan tim lintas liga di UCL
export const UEFA_LEAGUE_COEFFICIENT: Record<string, number> = {
  E0: 1.000,   // Premier League
  SP1: 0.965,  // LaLiga
  D1: 0.940,   // Bundesliga
  I1: 0.935,   // Serie A
  F1: 0.865,   // Ligue 1
  N1: 0.780,   // Eredivisie
  P1: 0.770,   // Primeira Liga
  B1: 0.720,   // Belgian Pro League
  SC0: 0.650,  // Scottish Premiership
  T1: 0.640,   // Turkish Super Lig
  G1: 0.600,   // Greek Super League
};

// Pasangan Divisi Utama & Kasta Kedua untuk penanganan tim promosi/degradasi
const SECOND_DIVISION_MAP: Record<string, string> = {
  E0: "E1",
  SP1: "SP2",
  I1: "I2",
  D1: "D2",
  F1: "F2",
};

/**
 * Mencari rating klub untuk kompetisi kontinental UCL melintasi semua liga utama
 * dengan penskalaan koefisien kualitas liga UEFA Q(L)
 */
// Divisi kasta kedua (nilai map) dilewati di pencarian UCL: tim UCL dicari di
// liga domestik utama. (Sebelumnya memeriksa key map sehingga justru 5 liga
// utama E0/SP1/I1/D1/F1 yang dilewati — semua laga UCL antar tim top-5 jatuh
// ke prior + telemetri lokal dibuang.)
const SECOND_DIVS = new Set(Object.values(SECOND_DIVISION_MAP));
export function findTeamRatingForUCL(
  data: CalibratedRatingsFile,
  normalizedTeam: string
): { rating: TeamRating; source: "primary_league"; domesticDiv: string } | null {
  for (const [div, league] of Object.entries(data.leagues)) {
    if (SECOND_DIVS.has(div) || !UEFA_LEAGUE_COEFFICIENT[div]) continue;
    if (league.teams[normalizedTeam]) {
      const raw = league.teams[normalizedTeam];
      const q = UEFA_LEAGUE_COEFFICIENT[div] || 0.80;
      const adjustedAttack = Number((raw.attack * Math.sqrt(q)).toFixed(3));
      const adjustedDefense = Number((raw.defense / Math.sqrt(q)).toFixed(3));
      return {
        rating: {
          ...raw,
          attack: adjustedAttack,
          defense: adjustedDefense,
        },
        source: "primary_league",
        domesticDiv: div,
      };
    }
  }
  return null;
}

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

  // Format 1xBet: "<Country>. <League Name>" -> buang prefix negara lalu cek lagi
  const dotIdx = clean.indexOf(".");
  if (dotIdx > 0 && dotIdx < clean.length - 1) {
    const stripped = clean.slice(dotIdx + 1).trim();
    if (LEAGUE_ALIAS_TO_DIV[stripped]) return LEAGUE_ALIAS_TO_DIV[stripped];
  }

  // Cocokkan nama liga yang tercatat di calibrated_ratings.json (mis. "greek super league")
  if (file) {
    for (const [div, league] of Object.entries(file.leagues)) {
      const leagueName = league.leagueName?.trim().toLowerCase();
      if (leagueName && leagueName === clean) return div;
    }
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

let theStatsTeamMap: Map<string, string> | null = null;

function getTheStatsTeamId(teamName: string): string | null {
  if (!theStatsTeamMap) {
    theStatsTeamMap = new Map();
    try {
      const db = getTheStatsDb();
      const rows = db.prepare("SELECT team_id, name FROM teams").all() as { team_id: string; name: string }[];
      for (const r of rows) {
        theStatsTeamMap.set(normalizeTeamName(r.name).toLowerCase(), r.team_id);
      }
    } catch {
      // Ignore jika database belum tersedia
    }
  }
  return theStatsTeamMap.get(normalizeTeamName(teamName).toLowerCase()) || null;
}

export interface ShrunkMatchParametersOptions {
  homeTeam: string;
  awayTeam: string;
  liveHomeFormGoalsAvg?: number;
  liveAwayFormGoalsAvg?: number;
  homeSampleN?: number;
  awaySampleN?: number;
  leagueHint?: string;
  homeTelemetry?: TeamRollingTelemetry | null;
  awayTelemetry?: TeamRollingTelemetry | null;
  matchDateCutoff?: string; // Pre-match cutoff (anti-leakage)
}

/**
 * Menghitung parameter Dixon-Coles dengan James-Stein Empirical Bayes Shrinkage
 * Mengintegrasikan Macro Prior historis dengan Micro Telemetry thestats_dataset.db
 */
export function getShrunkMatchParameters(options: ShrunkMatchParametersOptions): ShrunkMatchParameters {
  const normHome = normalizeTeamName(options.homeTeam);
  const normAway = normalizeTeamName(options.awayTeam);

  const ratingsData = loadCalibratedRatings();
  // JANGAN fallback ke E0: liga tak dikenal harus dilaporkan sebagai tidak terkalibrasi,
  // bukan diam-diam memakai parameter Premier League.
  const resolvedDiv = resolveDivCode(options.leagueHint);
  const divCode = resolvedDiv || "UNKNOWN";

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
    metadata: {
      div: divCode,
      leagueName: options.leagueHint ? `Tidak terkalibrasi (${options.leagueHint})` : "Default League",
      homeSource: "fallback",
      awaySource: "fallback",
      macroPriorDate: "2026-10-12",
      telemetrySource: { home: "macro_prior_only", away: "macro_prior_only" },
      observedXgSamples: { home: 0, away: 0 },
      isEstimatedTelemetry: true,
      preMatchCutoff: options.matchDateCutoff,
    },
  };

  const isUCL = divCode === "UCL";
  const league = isUCL
    ? {
        div: "UCL",
        leagueName: "UEFA Champions League",
        country: "Europe",
        seasonCount: 1,
        totalMatches: 36,
        leagueAvgGoals: 2.04,
        homeAdvantage: 1.12,
        rho: -0.05,
        calibrationDate: "2026-10-17",
        teams: {},
      }
    : (ratingsData ? ratingsData.leagues[divCode] : undefined);

  if (!ratingsData || !resolvedDiv || !league) {
    return defaultFallback;
  }

  const homeResolved = isUCL
    ? findTeamRatingForUCL(ratingsData, normHome)
    : findTeamRating(ratingsData, divCode, normHome);
  const awayResolved = isUCL
    ? findTeamRatingForUCL(ratingsData, normAway)
    : findTeamRating(ratingsData, divCode, normAway);

  // Jika kedua tim tidak ditemukan sama sekali di database historis
  if (!homeResolved && !awayResolved) {
    return {
      ...defaultFallback,
      homeAdvantage: Number.isFinite(league.homeAdvantage) && league.homeAdvantage > 0 ? league.homeAdvantage : 1.15,
      leagueAvgGoals: Number.isFinite(league.leagueAvgGoals) && league.leagueAvgGoals > 0 ? league.leagueAvgGoals : 1.35,
      rho: Number.isFinite(league.rho) ? league.rho : -0.04,
    };
  }

  const safeLeagueAvg = Number.isFinite(league.leagueAvgGoals) && league.leagueAvgGoals > 0 ? league.leagueAvgGoals : 1.35;

  // Baseline Histori dari Macro Prior
  const histHomeAttack = homeResolved && Number.isFinite(homeResolved.rating.attack) ? homeResolved.rating.attack : 1.0;
  const histHomeDefense = homeResolved && Number.isFinite(homeResolved.rating.defense) ? homeResolved.rating.defense : 1.0;
  const histAwayAttack = awayResolved && Number.isFinite(awayResolved.rating.attack) ? awayResolved.rating.attack : 1.0;
  const histAwayDefense = awayResolved && Number.isFinite(awayResolved.rating.defense) ? awayResolved.rating.defense : 1.0;

  // Resolusi Telemetry Lokal (thestats_dataset.db) jika tersedia.
  let homeTelem = options.homeTelemetry;
  let awayTelem = options.awayTelemetry;

  if (homeTelem === undefined) {
    const homeId = getTheStatsTeamId(options.homeTeam);
    if (homeId) {
      try {
        homeTelem = getTeamRollingTelemetry(homeId, 6, options.matchDateCutoff, divCode);
      } catch {
        homeTelem = null;
      }
    }
  }

  if (awayTelem === undefined) {
    const awayId = getTheStatsTeamId(options.awayTeam);
    if (awayId) {
      try {
        awayTelem = getTeamRollingTelemetry(awayId, 6, options.matchDateCutoff, divCode);
      } catch {
        awayTelem = null;
      }
    }
  }

  // 1. Evaluasi Likelihood Home Team
  let liveHomeAttack = (Number.isFinite(options.liveHomeFormGoalsAvg) && (options.liveHomeFormGoalsAvg as number) > 0 ? (options.liveHomeFormGoalsAvg as number) : 1.35) / safeLeagueAvg;
  let liveAwayAttack = (Number.isFinite(options.liveAwayFormGoalsAvg) && (options.liveAwayFormGoalsAvg as number) > 0 ? (options.liveAwayFormGoalsAvg as number) : 1.15) / safeLeagueAvg;
  let liveHomeDefense = Math.max(0.6, 2.0 - liveAwayAttack);
  let liveAwayDefense = Math.max(0.7, 2.0 - liveHomeAttack);
  let nHome = Math.max(0, Number.isFinite(options.homeSampleN) ? (options.homeSampleN as number) : 5);
  let nAway = Math.max(0, Number.isFinite(options.awaySampleN) ? (options.awaySampleN as number) : 5);
  let homeTelemetrySource: "thestats_observed_xg" | "thestats_observed_goals" | "macro_prior_only" = "macro_prior_only";
  let awayTelemetrySource: "thestats_observed_xg" | "thestats_observed_goals" | "macro_prior_only" = "macro_prior_only";
  let homeObservedXg = 0;
  let awayObservedXg = 0;

  if (homeTelem && homeTelem.observed_xg_samples >= 3 && homeTelem.rolling_xg_for !== null) {
    liveHomeAttack = homeTelem.rolling_xg_for / safeLeagueAvg;
    if (homeTelem.rolling_xg_against !== null) {
      liveHomeDefense = homeTelem.rolling_xg_against / safeLeagueAvg;
    }
    nHome = homeTelem.observed_xg_samples;
    homeTelemetrySource = "thestats_observed_xg";
    homeObservedXg = homeTelem.observed_xg_samples;
  } else if (homeTelem && homeTelem.sample_size >= 1) {
    liveHomeAttack = homeTelem.rolling_goals_for / safeLeagueAvg;
    liveHomeDefense = homeTelem.rolling_goals_against / safeLeagueAvg;
    nHome = homeTelem.sample_size;
    homeTelemetrySource = "thestats_observed_goals";
  }

  // 2. Evaluasi Likelihood Away Team
  if (awayTelem && awayTelem.observed_xg_samples >= 3 && awayTelem.rolling_xg_for !== null) {
    liveAwayAttack = awayTelem.rolling_xg_for / safeLeagueAvg;
    if (awayTelem.rolling_xg_against !== null) {
      liveAwayDefense = awayTelem.rolling_xg_against / safeLeagueAvg;
    }
    nAway = awayTelem.observed_xg_samples;
    awayTelemetrySource = "thestats_observed_xg";
    awayObservedXg = awayTelem.observed_xg_samples;
  } else if (awayTelem && awayTelem.sample_size >= 1) {
    liveAwayAttack = awayTelem.rolling_goals_for / safeLeagueAvg;
    liveAwayDefense = awayTelem.rolling_goals_against / safeLeagueAvg;
    nAway = awayTelem.sample_size;
    awayTelemetrySource = "thestats_observed_goals";
  }

  // Parameter shrinkage James-Stein: w_i = n_i / (n_i + kappa_i)
  // Bimodal Kappa: kappa = 8.0 jika observed_xg (varians rendah), 14.0 jika observed_goals, 16.0 fallback
  const kappaHome = homeTelemetrySource === "thestats_observed_xg" ? 8.0 : (homeTelemetrySource === "thestats_observed_goals" ? 14.0 : 16.0);
  const kappaAway = awayTelemetrySource === "thestats_observed_xg" ? 8.0 : (awayTelemetrySource === "thestats_observed_goals" ? 14.0 : 16.0);

  const wHome = (nHome + kappaHome) > 0 ? nHome / (nHome + kappaHome) : 0;
  const wAway = (nAway + kappaAway) > 0 ? nAway / (nAway + kappaAway) : 0;

  // James-Stein Shrinkage Blend
  const calcHomeAttack = wHome * liveHomeAttack + (1 - wHome) * histHomeAttack;
  const calcHomeDefense = wHome * liveHomeDefense + (1 - wHome) * histHomeDefense;
  const calcAwayAttack = wAway * liveAwayAttack + (1 - wAway) * histAwayAttack;
  const calcAwayDefense = wAway * liveAwayDefense + (1 - wAway) * histAwayDefense;

  // Fallback non-finite harus tetap skala rasio (mean 1.0), bukan gol absolut
  const finalHomeAttack = Number.isFinite(calcHomeAttack) ? Number(calcHomeAttack.toFixed(3)) : 1.0;
  const finalHomeDefense = Number.isFinite(calcHomeDefense) ? Number(calcHomeDefense.toFixed(3)) : 1.0;
  const finalAwayAttack = Number.isFinite(calcAwayAttack) ? Number(calcAwayAttack.toFixed(3)) : 1.0;
  const finalAwayDefense = Number.isFinite(calcAwayDefense) ? Number(calcAwayDefense.toFixed(3)) : 1.0;

  // Evaluasi Metrik Keberuntungan xG (Luck Regression)
  let luckSignal: MatchupLuckSignal | undefined = undefined;
  try {
    luckSignal = evaluateMatchupLuck(options.homeTeam, options.awayTeam, options.matchDateCutoff);
  } catch {}

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
      macroPriorDate: league.calibrationDate || "2026-10-12",
      telemetrySource: {
        home: homeTelemetrySource,
        away: awayTelemetrySource,
      },
      observedXgSamples: {
        home: homeObservedXg,
        away: awayObservedXg,
      },
      isEstimatedTelemetry: homeTelemetrySource === "macro_prior_only" || awayTelemetrySource === "macro_prior_only",
      preMatchCutoff: options.matchDateCutoff,
      luckMetrics: luckSignal,
    },
  };
}
