import path from "node:path";
import fs from "node:fs";
import { normalizeTeamName } from "./team-normalizer";
import { getTheStatsDb } from "../db/thestats-dataset";
import {
  getTeamRollingTelemetry,
  aggregateRollingXg,
  competitionIdForDiv,
  type TeamRollingTelemetry,
} from "../db/team-telemetry";
import { evaluateMatchupLuck, type MatchupLuckSignal } from "./luck-regression";
import { getLeagueGate, competitionIdToDiv, type CalibrationStatus } from "./league-gate";
import { resolveServingForMatch, type ServingResolution } from "./league-identity";
import { getCupShrunkParameters, type CupOffsetsBlock } from "./global-offsets";

export type { ServingResolution } from "./league-identity";

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
  /** Additive (fit Sportmonks): sumber fit + status gerbang saat ditulis. */
  source?: string;
  calibrationStatus?: CalibrationStatus;
  fitMethod?: string;
  /** canonical_id liga ini di registry kanonik (ditulis calibrate-ratings.ts). */
  canonicalId?: string;
  teams: Record<string, TeamRating>;
}

export interface CalibratedRatingsFile {
  version: string;
  compiledAt: string;
  totalLeagues: number;
  totalTeams: number;
  /** Metadata registry kanonik yang memetakan tiap fit key → canonical league. */
  canonical?: {
    registry: string;
    registryVersion?: number;
    registryGeneratedAt?: string;
    note?: string;
    /** Parameter graf offset global piala (ditulis scripts/fit-global-offsets.ts). */
    cupOffsets?: CupOffsetsBlock;
  };
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
    /** Status gerbang kalibrasi dari registry league_calibration (Fase 1). */
    calibrationStatus?: CalibrationStatus;
    /** Alasan gerbang (wajib terbaca saat partial/blokir — tidak ada penyajian diam-diam). */
    calibrationGate?: string;
    /** Jejak resolusi identitas kanonik: liga apa + fit mana yang melayani + lewat jalur apa (audit). */
    leagueResolution?: {
      canonicalId: string | null;
      fitSystem: "sportmonks" | "legacy-div" | "special" | null;
      via: string;
      note: string;
    };
    /** Jejak transformasi offset global bila fixture ini piala tercakup offset (audit penuh input δ). */
    cupOffset?: {
      graph: string;
      competitionCanonicalId: string;
      homeLeagueCanonicalId: string;
      awayLeagueCanonicalId: string;
      homeFitDiv: string;
      awayFitDiv: string;
      homeDelta: number;
      awayDelta: number;
      baseAvgGoals: number;
      baseAvgSource: string;
      cupHomeAdvantage: number;
      neutralVenue: boolean;
      homeCandidates: number;
      awayCandidates: number;
    };
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

// Pasangan Divisi Utama & Kasta Kedua untuk penanganan tim promosi/degradasi
const SECOND_DIVISION_MAP: Record<string, string> = {
  E0: "E1",
  SP1: "SP2",
  I1: "I2",
  D1: "D2",
  F1: "F2",
};

// CATATAN PENSIUN (fase kalibrasi piala): penskalaan lintas-liga lama untuk
// UCL — UEFA_LEAGUE_COEFFICIENT (Q(L) tulisan tangan) + findTeamRatingForUCL
// (√Q) — DIHAPUS. Kompetisi kontinental kini dilayani model offset global:
// δ liga di-fit dari hasil lintas-liga nyata (lib/quant/cup-offset-fit.ts),
// penyajian di lib/quant/global-offsets.ts. Alias nama "UCL" di
// LEAGUE_ALIAS_TO_DIV dibiarkan sebagai petunjuk nama warisan; resolusi
// kanonik (resolveServingForMatch) mendahuluinya, dan muara 'UCL' dari
// fallback warisan ditolak eksplisit di resolveMatchLeague.

// In-memory cache singleton
let cachedRatings: CalibratedRatingsFile | null = null;

/**
 * Jahitan injeksi artefak pointer (fix-5, review K8 §5): jalur saji
 * (pick-slate) dan evaluator memuat bobot dari artefak immutable yang
 * dirujuk manifest aktif lewat loadServingModel, lalu MENANAMKANNYA di
 * sini sebelum pemakaian pertama — seluruh konsumen dalam proses
 * (termasuk planner) memakai bobot artefak itu, bukan file lepas
 * data/calibrated_ratings.json. Proses yang tidak memanggil fungsi ini
 * membaca file lepas seperti biasa (jalur lab warisan).
 */
export function setCalibratedRatingsOverride(ratings: CalibratedRatingsFile): void {
  cachedRatings = ratings;
}

/** Lepas cache/override (pemakaian ulang proses, mis. pengujian). */
export function clearCalibratedRatingsCache(): void {
  cachedRatings = null;
}

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

  // Registry kanonik dulu (lib/quant/league-identity.ts): ID sumber, atau
  // nama yang menunjuk TEPAT satu liga kanonik. Liga yang dikenal registry
  // tapi tak ber-fit / ambigu → null di sini juga (jawaban final — bukan
  // jatuh ke tebakan alias warisan di bawah).
  const canonical = resolveServingForMatch({ hint: leagueHint });
  if (canonical.canonical || canonical.ambiguous) return canonical.div;

  // Hint berbentuk ID kompetisi Sportmonks ('sm:8') atau kode divisi SM
  // ('SM8') — ruang ID baru pasca sprint; resolver lama tidak mengenalnya.
  const smDiv = competitionIdToDiv(leagueHint);
  if (smDiv) return smDiv;
  if (/^SM\d+$/i.test(leagueHint.trim())) return leagueHint.trim().toUpperCase();

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
 * Resolusi divisi WARISAN (pra-kanonik) — hanya dipakai sebagai jaring
 * pengaman untuk string hint yang TIDAK dikenal registry kanonik sama
 * sekali (mis. singkatan feed eksternal seperti "epl"). Nama liga saja
 * ambigu — "Premier League" ada di ≥6 negara. Kandidat disaring oleh
 * keanggotaan kedua tim; seri → kandidat pertama (urutan alias legacy).
 */
function legacyResolveDivForMatch(
  data: CalibratedRatingsFile,
  leagueHint: string | null | undefined,
  homeTeam: string,
  awayTeam: string
): string | null {
  if (!leagueHint) return null;
  const candidates: string[] = [];
  const push = (d: string | null | undefined) => {
    if (d && data.leagues[d] && !candidates.includes(d)) candidates.push(d);
  };

  push(competitionIdToDiv(leagueHint));
  const clean = leagueHint.trim().toLowerCase();
  push(LEAGUE_ALIAS_TO_DIV[clean]);
  const upper = leagueHint.trim().toUpperCase();
  push(upper);
  const dotIdx = clean.indexOf(".");
  if (dotIdx > 0 && dotIdx < clean.length - 1) {
    push(LEAGUE_ALIAS_TO_DIV[clean.slice(dotIdx + 1).trim()]);
  }
  for (const [div, league] of Object.entries(data.leagues)) {
    const leagueName = league.leagueName?.trim().toLowerCase();
    if (leagueName && leagueName === clean) push(div);
  }

  if (candidates.length === 0) return resolveDivCode(leagueHint);
  if (candidates.length === 1) return candidates[0];

  const normHome = normalizeTeamName(homeTeam);
  const normAway = normalizeTeamName(awayTeam);
  let best = candidates[0];
  let bestScore = -1;
  for (const div of candidates) {
    const score =
      (lookupTeamRating(data, div, normHome) ? 1 : 0) + (lookupTeamRating(data, div, normAway) ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = div;
    }
  }
  // Nama ambigu + TIDAK ada kandidat yang memuat salah satu tim = nama
  // tidak bisa dipercaya (mis. "Premier League" Ghana → E0 Inggris akan
  // meminjam parameter liga yang salah). Lebih jujur: tanpa divisi.
  // Kandidat TUNGGAL dengan skor 0 tetap dipakai (nama unik; timnya saja
  // yang baru/promosi — parameter liganya tetap benar).
  if (bestScore === 0 && candidates.length > 1) return null;
  return best;
}

/**
 * Resolusi liga untuk satu pertandingan LEWAT REGISTRY KANONIK
 * (lib/quant/league-identity.ts): ID sumber → baris fixture tersimpan →
 * nama+negara → nama tunggal / saringan tim. Fit yang melayani = fit yang
 * sistemnya sama dengan sumber fixture (sm: → fit Sportmonks; legacy/
 * TheStats → fit legacy), tercatat eksplisit di hasil (via + note).
 *
 * Registry mengenal liganya tapi fit tak tersedia di file ratings yang
 * dimuat → div null (jujur), BUKAN jatuh ke tebakan nama. Registry sama
 * sekali tidak mengenal hint → barulah jalur warisan di atas yang bicara.
 */
export function resolveMatchLeague(
  data: CalibratedRatingsFile,
  leagueHint: string | null | undefined,
  homeTeam: string,
  awayTeam: string,
  asOfDate?: string | null
): ServingResolution {
  const res = resolveServingForMatch({
    hint: leagueHint,
    homeTeam,
    awayTeam,
    asOf: asOfDate ?? null,
    hasTeam: (div, normalized) => !!lookupTeamRating(data, div, normalized),
  });
  if (res.canonical || res.ambiguous) {
    if (res.div && res.div !== "UCL" && !data.leagues[res.div]) {
      return {
        ...res,
        div: null,
        fitSystem: null,
        note: `${res.note} [fit ${res.div} tidak ada di calibrated_ratings.json yang dimuat — diperlakukan tanpa fit]`,
      };
    }
    return res;
  }
  const div = legacyResolveDivForMatch(data, leagueHint, homeTeam, awayTeam);
  if (!div) return res;
  // Jalur pseudo-UCL PENSIUN (fase kalibrasi piala): divisi semu 'UCL'
  // (parameter hardcoded + penskalaan koefisien UEFA) tidak lagi dilayani.
  // Kompetisi kontinental harus ter-resolve kanonik ke model offset global;
  // hint warisan yang hanya bermuara ke 'UCL' berhenti di sini dengan
  // penjelasan, bukan parameter karangan.
  if (div === "UCL") {
    return {
      ...res,
      note: "Hint hanya ter-resolve ke divisi semu 'UCL' warisan — jalur pseudo-UCL pensiun; kompetisi ini harus ter-resolve kanonik (model offset global) agar bisa dilayani.",
    };
  }
  return {
    canonical: null,
    div,
    fitSystem: div.startsWith("SM") ? "sportmonks" : "legacy-div",
    via: "legacy-fallback",
    sourceSystem: null,
    ambiguous: false,
    cupModel: null,
    note: "Registry kanonik tidak mengenal hint ini — resolusi warisan (alias + saringan keanggotaan tim) yang melayani.",
  };
}

/** Kompatibilitas pemanggil lama: hanya kunci divisi yang melayani. */
export function resolveDivForMatch(
  data: CalibratedRatingsFile,
  leagueHint: string | null | undefined,
  homeTeam: string,
  awayTeam: string
): string | null {
  return resolveMatchLeague(data, leagueHint, homeTeam, awayTeam).div;
}

/**
 * Indeks kunci tim per divisi: normalize(kunci JSON) → kunci JSON aktual.
 *
 * Kunci JSON ditulis dari nama sumber (football-data untuk legacy,
 * Sportmonks untuk SM) sedangkan pencarian memakai nama yang sudah
 * dinormalisasi dari sumber LAIN (TheStats/SM) — bentuknya bisa berbeda
 * ("Werder Bremen" vs "SV Werder Bremen"). Indeks ini menjembatani kedua
 * bentuk lewat normalizer yang sama, tanpa menulis ulang file ratings.
 */
const teamKeyIndexCache = new WeakMap<CalibratedRatingsFile, Map<string, Map<string, string>>>();

function teamKeyIndex(data: CalibratedRatingsFile, div: string): Map<string, string> | null {
  let perFile = teamKeyIndexCache.get(data);
  if (!perFile) {
    perFile = new Map();
    teamKeyIndexCache.set(data, perFile);
  }
  let idx = perFile.get(div);
  if (!idx) {
    const league = data.leagues[div];
    if (!league) return null;
    idx = new Map();
    for (const key of Object.keys(league.teams)) {
      const nk = normalizeTeamName(key);
      if (!idx.has(nk)) idx.set(nk, key);
    }
    perFile.set(div, idx);
  }
  return idx;
}

/** Ambil rating tim dari satu divisi dengan toleransi bentuk nama (lihat indeks di atas). */
export function lookupTeamRating(
  data: CalibratedRatingsFile,
  div: string,
  normalizedTeam: string
): TeamRating | null {
  const league = data.leagues[div];
  if (!league) return null;
  if (league.teams[normalizedTeam]) return league.teams[normalizedTeam];
  const idx = teamKeyIndex(data, div);
  const actualKey = idx?.get(normalizedTeam);
  return actualKey ? league.teams[actualKey] : null;
}

/**
 * Mencari rating tim di liga utama, atau di divisi kasta kedua jika tim promosi
 */
export function findTeamRating(
  data: CalibratedRatingsFile,
  div: string,
  normalizedTeam: string
): { rating: TeamRating; source: "primary_league" | "second_division_promoted" } | null {
  // 1. Cek langsung di divisi utama
  const direct = lookupTeamRating(data, div, normalizedTeam);
  if (direct) {
    return { rating: direct, source: "primary_league" };
  }

  // 2. Cek di kasta kedua (jika tim promosi)
  const secondDiv = SECOND_DIVISION_MAP[div];
  const secondRating = secondDiv ? lookupTeamRating(data, secondDiv, normalizedTeam) : null;
  if (secondDiv && secondRating) {
    // Terapkan diskon konversi liga: attack didiskon 15%, defense dinaikkan 20%
    const adjustedRating: TeamRating = {
      ...secondRating,
      attack: Number((secondRating.attack * 0.85).toFixed(3)),
      defense: Number((secondRating.defense * 1.20).toFixed(3)),
    };
    return { rating: adjustedRating, source: "second_division_promoted" };
  }

  // 3. Fallback pencarian lintas liga.
  // Liga berstatus partial TIDAK boleh dipinjam diam-diam lewat jalur ini —
  // ratings partial hanya sah tersaji di liganya sendiri, dengan flag.
  for (const [otherDiv, otherLeague] of Object.entries(data.leagues)) {
    if (otherDiv === div || otherDiv === secondDiv) continue;
    if (otherLeague.calibrationStatus && otherLeague.calibrationStatus !== "calibrated") continue;
    const found = lookupTeamRating(data, otherDiv, normalizedTeam);
    if (found) {
      return { rating: found, source: "second_division_promoted" };
    }
  }

  return null;
}

let theStatsTeamMap: Map<string, string[]> | null = null;
const teamIdPickCache = new Map<string, string | null>();

function getTheStatsTeamIds(teamName: string): string[] {
  if (!theStatsTeamMap) {
    theStatsTeamMap = new Map();
    try {
      const db = getTheStatsDb();
      const rows = db.prepare("SELECT team_id, name FROM teams").all() as { team_id: string; name: string }[];
      for (const r of rows) {
        const key = normalizeTeamName(r.name).toLowerCase();
        const arr = theStatsTeamMap.get(key) ?? [];
        if (!arr.includes(r.team_id)) arr.push(r.team_id);
        theStatsTeamMap.set(key, arr);
      }
    } catch {
      // Ignore jika database belum tersedia
    }
  }
  return theStatsTeamMap.get(normalizeTeamName(teamName).toLowerCase()) ?? [];
}

/**
 * Resolusi nama → team_id SADAR TABRAKAN (Fase 1). Tabel teams memuat
 * nama yang bertabrakan antar team_id — 9 grup nama persis, 37 grup
 * setelah normalisasi (mis. "Al Ahli" ×2; Real Betis ×2 ternormalisasi).
 * Dulu: last-wins/LIMIT 1 acak → telemetri tim lain bisa terbaca sebagai
 * milik tim ini. Sekarang: kandidat dipilih yang punya log terbanyak di
 * kompetisi divisi target; tanpa konteks divisi → log terbanyak overall.
 */
function getTheStatsTeamId(teamName: string, div?: string): string | null {
  const ids = getTheStatsTeamIds(teamName);
  if (ids.length === 0) return null;
  if (ids.length === 1) return ids[0];

  const cacheKey = `${normalizeTeamName(teamName).toLowerCase()}|${div ?? ""}`;
  if (teamIdPickCache.has(cacheKey)) return teamIdPickCache.get(cacheKey) ?? null;

  let picked: string | null = null;
  try {
    const db = getTheStatsDb();
    const compId = div ? competitionIdForDiv(div) : null;
    const placeholders = ids.map(() => "?").join(",");
    const pick = (restrictComp: boolean): string | null => {
      const sql = restrictComp
        ? `SELECT l.team_id AS tid, COUNT(*) AS c FROM team_match_logs l
           JOIN matches m ON l.match_id = m.match_id
           WHERE l.team_id IN (${placeholders}) AND m.competition_id = ?
           GROUP BY l.team_id ORDER BY c DESC LIMIT 1`
        : `SELECT team_id AS tid, COUNT(*) AS c FROM team_match_logs
           WHERE team_id IN (${placeholders})
           GROUP BY team_id ORDER BY c DESC LIMIT 1`;
      const row = (
        restrictComp ? db.prepare(sql).get(...ids, compId) : db.prepare(sql).get(...ids)
      ) as { tid: string } | undefined;
      return row?.tid ?? null;
    };
    picked = (compId ? pick(true) : null) ?? pick(false) ?? ids[0];
  } catch {
    picked = ids[0];
  }
  teamIdPickCache.set(cacheKey, picked);
  return picked;
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
  /** Venue netral (final satu leg di tempat netral): home advantage piala = 1. */
  isNeutralVenue?: boolean;
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
  // Resolusi lewat registry kanonik (identitas liga tunggal): ID sumber /
  // baris fixture / nama+negara — fit yang melayani = fit se-sumber dengan
  // fixture, tercatat di metadata.leagueResolution. Liga dikenal tapi tak
  // ber-fit: divCode memakai canonical_id supaya gerbang registry tetap
  // bisa bicara eksplisit (mis. uncalibrated), bukan "UNKNOWN" generik.
  const resolution: ServingResolution | null = ratingsData
    ? resolveMatchLeague(ratingsData, options.leagueHint, options.homeTeam, options.awayTeam, options.matchDateCutoff)
    : null;
  const resolvedDiv = resolution ? resolution.div : resolveDivCode(options.leagueHint);
  const divCode = resolvedDiv || resolution?.canonical?.canonical_id || "UNKNOWN";
  const leagueResolutionMeta = resolution
    ? {
        canonicalId: resolution.canonical?.canonical_id ?? null,
        fitSystem: resolution.fitSystem,
        via: resolution.via,
        note: resolution.note,
      }
    : undefined;

  // Gerbang kalibrasi (registry league_calibration) — sumber kebenaran status.
  const gate = divCode !== "UNKNOWN" && divCode !== "UCL" ? getLeagueGate(divCode) : null;

  // Attack fallback = RASIO terhadap rata-rata liga (skala yang sama dengan
  // jalur utama dan kontrak Dixon-Coles), BUKAN rata-rata gol absolut.
  // Form 0 yang terobservasi dihormati sebagai 0; form tak tersedia / tak
  // valid → prior rasio eksplisit 1,0 (tim rata-rata liga). Defense tanpa
  // observasi = prior 1,0 — tidak pernah ditebak dari attack lawan (pola
  // lama membuat λ non-monoton terhadap form kandang: form naik, λ turun).
  const FALLBACK_LEAGUE_AVG = 1.35;
  const fallbackAttackRatio = (form: number | undefined, avg: number): number =>
    Number.isFinite(form) && (form as number) >= 0 ? (form as number) / avg : 1.0;

  // Default fallback jika data JSON tidak tersedia sama sekali
  const defaultFallback: ShrunkMatchParameters = {
    homeAttack: fallbackAttackRatio(options.liveHomeFormGoalsAvg, FALLBACK_LEAGUE_AVG),
    homeDefense: 1.0,
    awayAttack: fallbackAttackRatio(options.liveAwayFormGoalsAvg, FALLBACK_LEAGUE_AVG),
    awayDefense: 1.0,
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
      calibrationStatus: gate?.status ?? "unknown",
      calibrationGate: gate?.reason,
      leagueResolution: leagueResolutionMeta,
    },
  };

  // Cabang PIALA — model offset global (fase kalibrasi piala). Kompetisi
  // ter-resolve kanonik ke cup_model: parameter dibangun dari fit domestik
  // kedua tim yang ditransformasi δ liga masing-masing
  // (lib/quant/global-offsets.ts). Menggantikan jalur pseudo-UCL lama
  // (parameter hardcoded + penskalaan koefisien UEFA) — diganti, bukan
  // dilapisi. Gerbang = label (keputusan owner 2026-11-05): status kompetisi
  // — termasuk uncalibrated — tidak lagi memblokir jalur offset; statusnya
  // diteruskan sebagai label di metadata. Tim yang tidak ter-resolve →
  // fallback teranotasi, bukan angka karangan.
  if (resolution?.cupModel && ratingsData && resolution.canonical) {
    const cupMeta = defaultFallback.metadata as NonNullable<ShrunkMatchParameters["metadata"]>;
    const cup = getCupShrunkParameters(ratingsData, lookupTeamRating, {
      competition: resolution.canonical,
      homeTeam: options.homeTeam,
      awayTeam: options.awayTeam,
      isNeutralVenue: options.isNeutralVenue,
      matchDateCutoff: options.matchDateCutoff,
      calibrationStatus: gate?.status ?? "unknown",
      calibrationGate: gate?.reason,
    });
    if (cup?.kind === "ok") return cup.params;
    const why =
      cup?.kind === "missing-team"
        ? `Tim ${cup.side === "home" ? "kandang" : "tamu"} "${cup.teamName}" tidak ter-resolve ke liga domestik teridentifikasi di graf ${resolution.cupModel.graph} — fixture piala ini belum bisa dinilai offset.`
        : cup?.kind === "no-graph-params"
          ? `Parameter graf ${cup.graph} belum ter-fit di blok canonical.cupOffsets — jalankan scripts/fit-global-offsets.ts.`
          : "Model offset tidak tersedia untuk kompetisi ini.";
    return {
      ...defaultFallback,
      metadata: {
        ...cupMeta,
        div: divCode,
        leagueName: resolution.canonical.name,
        calibrationStatus: gate?.status ?? "unknown",
        calibrationGate: gate?.reason,
        leagueResolution: leagueResolutionMeta
          ? { ...leagueResolutionMeta, note: `${leagueResolutionMeta.note} ${why}` }
          : leagueResolutionMeta,
      },
    };
  }

  const league = ratingsData ? ratingsData.leagues[divCode] : undefined;

  if (!ratingsData || !resolvedDiv || !league) {
    return defaultFallback;
  }

  // Gerbang = label (keputusan owner 2026-11-05): liga uncalibrated yang
  // fit-nya ada di JSON tetap disajikan; statusnya menempel di metadata
  // lewat gateStatus/calibrationGate di bawah. Blokir lama dicabut.
  const gateStatus: CalibrationStatus = gate?.status ?? league.calibrationStatus ?? "unknown";

  const homeResolved = findTeamRating(ratingsData, divCode, normHome);
  const awayResolved = findTeamRating(ratingsData, divCode, normAway);

  // Jika kedua tim tidak ditemukan sama sekali di database historis
  if (!homeResolved && !awayResolved) {
    const fbLeagueAvg = Number.isFinite(league.leagueAvgGoals) && league.leagueAvgGoals > 0 ? league.leagueAvgGoals : FALLBACK_LEAGUE_AVG;
    return {
      ...defaultFallback,
      homeAttack: fallbackAttackRatio(options.liveHomeFormGoalsAvg, fbLeagueAvg),
      awayAttack: fallbackAttackRatio(options.liveAwayFormGoalsAvg, fbLeagueAvg),
      homeAdvantage: Number.isFinite(league.homeAdvantage) && league.homeAdvantage > 0 ? league.homeAdvantage : 1.15,
      leagueAvgGoals: fbLeagueAvg,
      rho: Number.isFinite(league.rho) ? league.rho : -0.04,
      metadata: {
        ...(defaultFallback.metadata as NonNullable<ShrunkMatchParameters["metadata"]>),
        leagueName: league.leagueName,
        calibrationStatus: gateStatus,
        calibrationGate: gate?.reason,
      },
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
    const homeId = getTheStatsTeamId(options.homeTeam, divCode);
    if (homeId) {
      try {
        homeTelem = getTeamRollingTelemetry(homeId, 6, options.matchDateCutoff, divCode);
      } catch {
        homeTelem = null;
      }
    }
  }

  if (awayTelem === undefined) {
    const awayId = getTheStatsTeamId(options.awayTeam, divCode);
    if (awayId) {
      try {
        awayTelem = getTeamRollingTelemetry(awayId, 6, options.matchDateCutoff, divCode);
      } catch {
        awayTelem = null;
      }
    }
  }

  // Penimbangan ulang xG telemetri dari pemanggil: planner (🔒) tidak bisa
  // membawa targetDivCode, jadi telemetri darinya berbobot 1.0 — penanda
  // xg_weighted_toward ≠ target divisi ini. Timbang ulang dari recent_logs
  // memakai aggregateRollingXg (satu definisi agregasi yang sama dengan
  // jalur loader) agar input blend = standar tervalidasi harness. Bekerja
  // pada SALINAN dangkal — objek pemanggil tidak dimutasi (planner memakai
  // salinannya lagi untuk konteks intel). Counter sampel tidak berubah
  // oleh pembobotan, jadi tidak ikut diganti. Telemetri hitungan loader
  // sendiri penandanya sudah = target → lolos tanpa disentuh.
  const targetCompId = competitionIdForDiv(divCode);
  const reweightTowardDiv = (
    telem: TeamRollingTelemetry | null | undefined
  ): TeamRollingTelemetry | null | undefined => {
    if (!telem || telem.xg_weighted_toward === targetCompId || !telem.recent_logs?.length) return telem;
    const agg = aggregateRollingXg(telem.recent_logs, divCode, options.matchDateCutoff);
    return {
      ...telem,
      rolling_xg_for: agg.rolling_xg_for,
      rolling_xg_against: agg.rolling_xg_against,
      rolling_npxg_for: agg.rolling_npxg_for,
      rolling_npxg_against: agg.rolling_npxg_against,
      xg_weighted_toward: agg.xg_weighted_toward,
    };
  };
  homeTelem = reweightTowardDiv(homeTelem);
  awayTelem = reweightTowardDiv(awayTelem);

  // 1. Evaluasi Likelihood Home Team
  let liveHomeAttack = (Number.isFinite(options.liveHomeFormGoalsAvg) && (options.liveHomeFormGoalsAvg as number) > 0 ? (options.liveHomeFormGoalsAvg as number) : 1.35) / safeLeagueAvg;
  let liveAwayAttack = (Number.isFinite(options.liveAwayFormGoalsAvg) && (options.liveAwayFormGoalsAvg as number) > 0 ? (options.liveAwayFormGoalsAvg as number) : 1.15) / safeLeagueAvg;
  // Defense awal = prior rasio eksplisit 1,0 (tim rata-rata liga); ditimpa
  // telemetri bila tersedia. Jangan ditebak dari attack lawan — pola lama
  // (2,0 − attack lawan) membuat defense bergerak melawan form tim sendiri.
  let liveHomeDefense = 1.0;
  let liveAwayDefense = 1.0;
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
  // Bimodal Kappa: kappa = 16.0 jika observed_xg, 28.0 jika observed_goals, 32.0 fallback.
  // Nilai awal (8/14/16, asumsi tanpa fit) DIGANDAKAN berdasarkan validasi
  // walk-forward out-of-sample Fase 3 (scripts/backtest-walkforward.ts,
  // tasks/oos-results.json): skala κ ×2 terpilih di lipatan validasi V2 dan
  // terkonfirmasi di held-out. Adopsi awal 2026-11-04; TERKONFIRMASI ULANG
  // oleh re-run point-in-time 2026-11-09 (audit T5, tanpa look-ahead):
  // held-out jalur blend produksi κ×1 1,0251 → winner κ×2 1,0092, slope
  // 0,649 → 1,146 (n=6.317; rincian + caveat perbandingan di
  // tasks/oos-rerun-pointintime-2026-11-09.md). Telemetri 6 laga terbukti
  // terlalu berisik untuk bobot sebesar asumsi lama.
  const kappaHome = homeTelemetrySource === "thestats_observed_xg" ? 16.0 : (homeTelemetrySource === "thestats_observed_goals" ? 28.0 : 32.0);
  const kappaAway = awayTelemetrySource === "thestats_observed_xg" ? 16.0 : (awayTelemetrySource === "thestats_observed_goals" ? 28.0 : 32.0);

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
      calibrationStatus: gateStatus,
      calibrationGate: gate?.reason,
      leagueResolution: leagueResolutionMeta,
    },
  };
}
