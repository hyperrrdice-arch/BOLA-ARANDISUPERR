/**
 * GLOBAL OFFSETS — penyajian runtime model offset global untuk piala.
 *
 * Untuk fixture yang kompetisinya kanonik-piala tercakup offset
 * (`cup_model` di registry kanonik, ditulis scripts/fit-global-offsets.ts):
 * parameter Dixon-Coles dibangun dari fit domestik kedua tim yang
 * ditransformasi offset δ liga domestik masing-masing
 *   att* = att × e^δ   ·   def* = def ÷ e^δ
 * dengan rata-rata gol global graf + home advantage piala graf itu
 * (venue netral → HA = 1), rho = 0 — persis formula yang divalidasi
 * walk-forward di scripts/backtest-cup-offsets.ts.
 *
 * v1 jujur: parameter tim = fit domestik murni (prior makro), TANPA blend
 * telemetri last-6 — sumber telemetri dicatat 'macro_prior_only' di
 * metadata agar konsumen tahu tidak ada form live yang dipakai.
 *
 * Status kompetisi dibaca dari registry league_calibration lewat
 * league-gate (sumber kebenaran status): status — termasuk uncalibrated —
 * adalah label (keputusan owner 2026-11-05), diteruskan pemanggil
 * (ratings-loader) sebagai flag di metadata.calibrationStatus.
 */
import { normalizeTeamName } from "./team-normalizer";
import {
  getCanonicalCupOffset,
  loadCanonicalLeagues,
  type CanonicalLeague,
} from "./league-identity";
import type { CalibrationStatus } from "./league-gate";
import type {
  CalibratedRatingsFile,
  ShrunkMatchParameters,
  TeamRating,
} from "./ratings-loader";

export interface CupGraphParams {
  reference: string;
  globalAvgGoals: number;
  cupHomeAdvantage: number;
  nAnchorMatches: number;
  nLeaguesIdentified: number;
}

export interface CupOffsetsBlock {
  fittedAt: string;
  graphs: Record<string, CupGraphParams>;
  competitions: Record<string, { graph: string; status: string }>;
}

type LookupFn = (
  data: CalibratedRatingsFile,
  div: string,
  normalizedTeam: string,
) => TeamRating | null;

interface TeamCupResolution {
  teamName: string;
  fitDiv: string;
  leagueCanonicalId: string;
  delta: number;
  rating: TeamRating;
  calibrationStatus: string | undefined;
  candidates: number;
}

const STATUS_RANK: Record<string, number> = { calibrated: 0, partial: 1 };

/**
 * Resolusi satu tim ke liga domestiknya di dalam graf: pindai entri JSON
 * yang liga kanoniknya membawa cup_offset teridentifikasi di graf yang
 * sama, cari tim di roster fit itu. Kandidat >1 (nama bertabrakan lintas
 * liga) dipilih deterministik: status fit lebih baik dulu, lalu
 * matchesCount tim terbesar — jumlah kandidat dicatat untuk metadata.
 */
function resolveTeamInGraph(
  data: CalibratedRatingsFile,
  lookup: LookupFn,
  teamName: string,
  graph: string,
): TeamCupResolution | null {
  const normalized = normalizeTeamName(teamName);
  const candidates: TeamCupResolution[] = [];
  for (const [div, league] of Object.entries(data.leagues)) {
    const cid = league.canonicalId ?? null;
    if (!cid) continue;
    const off = getCanonicalCupOffset(cid);
    if (!off || off.graph !== graph || !off.identified || off.delta === null) continue;
    const rating = lookup(data, div, normalized);
    if (!rating) continue;
    candidates.push({
      teamName,
      fitDiv: div,
      leagueCanonicalId: cid,
      delta: off.delta,
      rating,
      calibrationStatus: league.calibrationStatus,
      candidates: 0,
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const ra = STATUS_RANK[a.calibrationStatus ?? ""] ?? 2;
    const rb = STATUS_RANK[b.calibrationStatus ?? ""] ?? 2;
    if (ra !== rb) return ra - rb;
    return (b.rating.matchesCount ?? 0) - (a.rating.matchesCount ?? 0);
  });
  const best = candidates[0];
  best.candidates = candidates.length;
  return best;
}

export type CupParamsResult =
  | { kind: "ok"; params: ShrunkMatchParameters }
  | { kind: "missing-team"; side: "home" | "away"; teamName: string }
  | { kind: "no-graph-params"; graph: string };

/**
 * Bangun ShrunkMatchParameters untuk fixture piala. Mengembalikan null
 * bila kompetisi tidak membawa cup_model / blok offset belum ter-fit —
 * pemanggil jatuh ke fallback jujur, bukan angka karangan.
 */
export function getCupShrunkParameters(
  data: CalibratedRatingsFile,
  lookup: LookupFn,
  opts: {
    competition: CanonicalLeague;
    homeTeam: string;
    awayTeam: string;
    isNeutralVenue?: boolean;
    matchDateCutoff?: string;
    calibrationStatus?: CalibrationStatus;
    calibrationGate?: string;
  },
): CupParamsResult | null {
  const model = opts.competition.cup_model;
  if (!model) return null;
  const block = (data.canonical as { cupOffsets?: CupOffsetsBlock } | undefined)?.cupOffsets;
  const graphParams = block?.graphs?.[model.graph];
  if (!graphParams) return { kind: "no-graph-params", graph: model.graph };

  const home = resolveTeamInGraph(data, lookup, opts.homeTeam, model.graph);
  if (!home) return { kind: "missing-team", side: "home", teamName: opts.homeTeam };
  const away = resolveTeamInGraph(data, lookup, opts.awayTeam, model.graph);
  if (!away) return { kind: "missing-team", side: "away", teamName: opts.awayTeam };

  const attH = home.rating.attack * Math.exp(home.delta);
  const defH = home.rating.defense * Math.exp(-home.delta);
  const attA = away.rating.attack * Math.exp(away.delta);
  const defA = away.rating.defense * Math.exp(-away.delta);

  // Basis rata-rata = globalAvg graf untuk SEMUA pasangan (termasuk
  // pasangan satu liga di piala domestik) — persis formula yang divalidasi
  // walk-forward; varian basis liga domestik untuk pasangan satu liga
  // adalah penyempurnaan masa depan yang butuh validasinya sendiri.
  const leagueAvgGoals = graphParams.globalAvgGoals;
  const neutral = opts.isNeutralVenue === true;
  const homeAdvantage = neutral ? 1 : graphParams.cupHomeAdvantage;

  const params: ShrunkMatchParameters = {
    homeAttack: Math.max(0.5, Number(attH.toFixed(3))),
    homeDefense: Math.max(0.5, Number(defH.toFixed(3))),
    awayAttack: Math.max(0.4, Number(attA.toFixed(3))),
    awayDefense: Math.max(0.5, Number(defA.toFixed(3))),
    homeAdvantage,
    leagueAvgGoals,
    rho: 0,
    shrinkageWeights: { home: 0, away: 0 },
    isCalibrated: true,
    metadata: {
      div: opts.competition.canonical_id,
      leagueName: opts.competition.name,
      homeSource: "primary_league",
      awaySource: "primary_league",
      macroPriorDate: block?.fittedAt?.slice(0, 10),
      telemetrySource: { home: "macro_prior_only", away: "macro_prior_only" },
      observedXgSamples: { home: 0, away: 0 },
      isEstimatedTelemetry: true,
      preMatchCutoff: opts.matchDateCutoff,
      calibrationStatus: opts.calibrationStatus,
      calibrationGate: opts.calibrationGate,
      leagueResolution: {
        canonicalId: opts.competition.canonical_id,
        fitSystem: "special",
        via: "cup-offset",
        note: `Model offset global graf ${model.graph}: kandang dari ${home.leagueCanonicalId} (δ=${home.delta}), tamu dari ${away.leagueCanonicalId} (δ=${away.delta}).`,
      },
      cupOffset: {
        graph: model.graph,
        competitionCanonicalId: opts.competition.canonical_id,
        homeLeagueCanonicalId: home.leagueCanonicalId,
        awayLeagueCanonicalId: away.leagueCanonicalId,
        homeFitDiv: home.fitDiv,
        awayFitDiv: away.fitDiv,
        homeDelta: home.delta,
        awayDelta: away.delta,
        baseAvgGoals: leagueAvgGoals,
        baseAvgSource: "graph-global",
        cupHomeAdvantage: homeAdvantage,
        neutralVenue: neutral,
        homeCandidates: home.candidates,
        awayCandidates: away.candidates,
      },
    },
  };
  return { kind: "ok", params };
}

/** Kompetisi kanonik yang tercakup offset (untuk verifikasi konsumsi). */
export function cupCompetitionsCovered(): CanonicalLeague[] {
  return loadCanonicalLeagues().filter((e) => e.cup_model);
}
