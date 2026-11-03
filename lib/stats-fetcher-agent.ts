import { generateText } from "ai";
import { STATS_FETCHER } from "./llm/models";
import { nineRouter } from "@/lib/agent/llm";
import { cachedStatsGet, getStatsCacheMetrics } from "@/lib/stats-cache";
import {
  validateAndSanitizeMatchData,
  type VerifiedMatchIntelligence,
} from "@/lib/stats-validator";
import {
  getLocalH2HMatches,
  getLocalRecentMatches,
  getLocalSquadInjuries,
  getMatchOddsAnchor,
} from "@/lib/db/thestats-dataset";
import { getUpcomingByMatchId } from "@/lib/db/upcoming-fixtures";

/**
 * Rakit matchRes + oddsRes offline dari store lokal (Task 7, versi minimal).
 * Return null = match tak dikenal lokal → pemanggil tetap throw jujur.
 * Bentuk payload disamakan dengan respons API (validator baca `.data`).
 */
function buildOfflineMatchRes(matchId: string): { matchRes: any; oddsRes: any } | null {
  const row = getUpcomingByMatchId(matchId);
  if (!row) return null;
  const matchRes = {
    data: {
      id: row.match_id,
      utc_date: row.utc_date,
      status: row.status || "scheduled",
      competition_id: row.competition_id,
      competition_name: row.competition_name,
      venue: row.venue || null,
      home_team: { id: row.home_team_id, name: row.home_team_name },
      away_team: { id: row.away_team_id, name: row.away_team_name },
    },
    source: "offline_sqlite",
  };
  const anchor = getMatchOddsAnchor(matchId);
  const oddsRes = anchor && anchor.has_odds && anchor.payload ? anchor.payload : null;
  return { matchRes, oddsRes };
}


/**
 * ============================================================================
 * DYNAMIC FETCHER AGENT (LIGHTWEIGHT DISPATCHER)
 * ============================================================================
 * Menggunakan model cepat 'ag/gemini-3.8-flash' (atau fallback heuristic)
 * untuk mengevaluasi konteks laga dan memutuskan secara cerdas endpoint TheStatsAPI mana
 * yang wajib dipanggil vs yang dilewati demi menghemat kuota API.
 */

// Klien 9Router tunggal: lihat lib/agent/llm.ts (customFetch non-streaming + failover).

const MODEL_DISPATCHER = STATS_FETCHER.MODEL_DISPATCHER;

export interface DispatcherDecision {
  fetch_referee: boolean;
  fetch_lineups: boolean;
  fetch_injuries: boolean;
  fetch_odds: boolean;
  fetch_h2h: boolean;
  cache_ttl_minutes: number;
  reasoning: string;
}

export interface FetchResultWithAudit {
  intelligence: VerifiedMatchIntelligence;
  audit: {
    dispatcher_model: string;
    decision: DispatcherDecision;
    endpoints_called: string[];
    endpoints_skipped: string[];
    cache_metrics: ReturnType<typeof getStatsCacheMetrics>;
    timestamp: string;
  };
}

/**
 * Heuristik deterministik cepat jika agen AI timeout (> 2.5s) atau offline
 */
function getHeuristicDecision(hoursUntilKickoff: number, status: string): DispatcherDecision {
  const isFinished = status === "finished";
  const isLive = status === "in_play" || status === "live";

  // Jika laga masih lebih dari 3 jam, lineup resmi hampir mustahil ada (hanya buang kuota)
  const shouldFetchLineups = isFinished || isLive || hoursUntilKickoff <= 2.5;
  const shouldFetchInjuries = !isFinished && hoursUntilKickoff <= 48;
  const shouldFetchOdds = !isFinished;

  let ttl = 30; // default 30 menit
  if (isFinished) ttl = 24 * 60; // laga selesai di-cache 24 jam
  else if (hoursUntilKickoff > 24) ttl = 60; // H-1 hari di-cache 1 jam
  else if (hoursUntilKickoff <= 2) ttl = 10; // H-2 jam di-cache 10 menit agar update lineup tertangkap

  return {
    fetch_referee: true,
    fetch_lineups: shouldFetchLineups,
    fetch_injuries: shouldFetchInjuries,
    fetch_odds: shouldFetchOdds,
    fetch_h2h: true,
    cache_ttl_minutes: ttl,
    reasoning: `Heuristic rule: Kickoff ${hoursUntilKickoff}h (${status}). Lineup ${
      shouldFetchLineups ? "wajib diambil" : "dilewati (terlalu jauh)"
    }.`,
  };
}

/**
 * Tanya model ringan oc/muse-spark-1.3 untuk merencanakan pengambilan endpoint
 */
async function planFetchWithLightweightAgent(
  homeTeam: string,
  awayTeam: string,
  hoursUntilKickoff: number,
  status: string
): Promise<{ decision: DispatcherDecision; modelUsed: string }> {
  const heuristic = getHeuristicDecision(hoursUntilKickoff, status);

  // Shortcut PLAN-D: dispatcher LLM selalu kalah dari timeout 2.5s di lingkungan lokal
  // dan output-nya identik dengan heuristic (aturan prompt = aturan heuristic).
  // Aktifkan kembali eksperimen LLM via env DISPATCHER_LLM=1.
  if (process.env.DISPATCHER_LLM !== "1") {
    return {
      decision: heuristic,
      modelUsed: `${MODEL_DISPATCHER} (fast heuristic fallback)`,
    };
  }

  try {
    const prompt =
      `Kamu adalah API DISPATCHER PLANNER untuk TheStatsAPI sepak bola.\n` +
      `Pertandingan: ${homeTeam} vs ${awayTeam}\n` +
      `Status: ${status}, Kickoff: ${hoursUntilKickoff} jam lagi.\n\n` +
      `Tugas: Tentukan apakah endpoint berikut PERLU dipanggil atau DILEWATI untuk menghemat kuota:\n` +
      `- fetch_referee (boolean): selalu true kecuali laga amatir\n` +
      `- fetch_lineups (boolean): HANYA true jika laga selesai ATAU kickoff <= 2.5 jam lagi (sebab official lineup rilis H-1 jam)\n` +
      `- fetch_injuries (boolean): true jika kickoff <= 48 jam\n` +
      `- fetch_odds (boolean): true jika laga belum selesai\n` +
      `- fetch_h2h (boolean): selalu true\n` +
      `- cache_ttl_minutes (number): rekomendasi TTL cache (10 s/d 1440)\n` +
      `- reasoning (string pendek)\n\n` +
      `KEMBALIKAN HANYA JSON VALID format: { "fetch_referee": boolean, "fetch_lineups": boolean, "fetch_injuries": boolean, "fetch_odds": boolean, "fetch_h2h": boolean, "cache_ttl_minutes": number, "reasoning": string }`;

    // Beri batas timeout 2500ms agar UI tetap secepat kilat
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Dispatcher agent timeout")), 2500);
    });

    const callPromise = generateText({
      model: nineRouter.chat(MODEL_DISPATCHER),
      system: "Balas hanya JSON valid murni tanpa markdown formatting.",
      prompt,
    });

    let res;
    try {
      res = await Promise.race([callPromise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }

    const cleanJson = res.text.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleanJson);

    return {
      decision: {
        fetch_referee: Boolean(parsed.fetch_referee ?? heuristic.fetch_referee),
        fetch_lineups: Boolean(parsed.fetch_lineups ?? heuristic.fetch_lineups),
        fetch_injuries: Boolean(parsed.fetch_injuries ?? heuristic.fetch_injuries),
        fetch_odds: Boolean(parsed.fetch_odds ?? heuristic.fetch_odds),
        fetch_h2h: Boolean(parsed.fetch_h2h ?? heuristic.fetch_h2h),
        cache_ttl_minutes: Number(parsed.cache_ttl_minutes) || heuristic.cache_ttl_minutes,
        reasoning: String(parsed.reasoning || "Dianalisis oleh AI Dispatcher"),
      },
      modelUsed: MODEL_DISPATCHER,
    };
  } catch (err) {
    console.log(`[Dispatcher Agent] Menggunakan heuristic fallback (${err instanceof Error ? err.message : err})`);
    return {
      decision: heuristic,
      modelUsed: `${MODEL_DISPATCHER} (fast heuristic fallback)`,
    };
  }
}

/**
 * Eksekutor Utama: Fetch dinamis + Cache cerdas + Zod Sanitizer
 */
export async function fetchAndValidateMatchIntelligence(
  matchId: string,
  competitionIdHint?: string,
  signal?: AbortSignal
): Promise<FetchResultWithAudit> {
  // Boundary: matchId datang dari query string publik → jangan pernah di-interpolasi mentah
  // ke path upstream (? # / bisa retarget endpoint lain + poison cache key)
  if (!/^[\w-]+$/.test(matchId || "")) {
    throw new Error("matchId tidak valid — hanya alfanumerik, '-' dan '_' yang diterima.");
  }
  const safeMatchId = encodeURIComponent(matchId);

  // Semua fetch TheStatsAPI di fungsi ini ikut signal request supaya run yang
  // ditinggalkan client berhenti, bukan lanjut menguras kuota (plan-perf Task 3).
  const get = (
    path: string,
    params: Record<string, string | number | boolean | undefined>,
    ttlMs: number
  ) => cachedStatsGet(path, params, ttlMs, signal);

  // Endpoint OPSIONAL tidak boleh membunuh intel: gagal (key hilang/API mati) →
  // null → validator menandai unavailable + missing registry (Task 7 offline).
  // Hanya match dasar yang strict (throw → fallback offline → throw jujur).
  const safeGet = (
    path: string,
    params: Record<string, string | number | boolean | undefined>,
    ttlMs: number
  ): Promise<any> => {
    try {
      return get(path, params, ttlMs).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  };

  // 1. Ambil Match Dasar (Cache 15 menit). Offline-first (Task 7):
  // live gagal (API mati / key hilang) + baris fixture lokal ada → rakit intel
  // dari upcoming_fixtures + odds anchor. Tanpa baris lokal → throw jujur.
  let matchRes: any = null;
  let matchData: any = null;
  let matchError: string | null = null;
  let offlineOddsRes: any = null;
  let offlineIntel = false;
  try {
    matchRes = await get(`/football/matches/${safeMatchId}`, {}, 15 * 60 * 1000);
    matchData = matchRes?.data || null;
    if (!matchData) matchError = matchRes?.message || "Data pertandingan tidak ditemukan di TheStatsAPI";
  } catch (err) {
    matchError = err instanceof Error ? err.message : String(err);
  }

  if (!matchData) {
    const offline = buildOfflineMatchRes(matchId);
    if (offline) {
      matchRes = offline.matchRes;
      matchData = matchRes.data;
      offlineOddsRes = offline.oddsRes;
      offlineIntel = true;
      matchError = null;
    } else {
      throw new Error(`Data pertandingan ${matchId} tidak ditemukan di sumber live maupun lokal (live: ${matchError})`);
    }
  }

  const kickoffDate = new Date(matchData.utc_date || Date.now());
  const now = new Date();
  const hoursUntilKickoff = Math.round(((kickoffDate.getTime() - now.getTime()) / (1000 * 60 * 60)) * 10) / 10;
  const status = String(matchData.status || "scheduled");

  // 2. Agen Dispatcher memutuskan endpoint yang perlu dipanggil
  const homeTeam = matchData.home_team?.name || "Kandang";
  const awayTeam = matchData.away_team?.name || "Tamu";
  const homeTeamId = matchData.home_team?.id;
  const awayTeamId = matchData.away_team?.id;

  const { decision, modelUsed } = await planFetchWithLightweightAgent(
    homeTeam,
    awayTeam,
    hoursUntilKickoff,
    status
  );

  const ttlMs = decision.cache_ttl_minutes * 60 * 1000;
  const endpointsCalled: string[] = [`/football/matches/${safeMatchId}`];
  const endpointsSkipped: string[] = [];
  if (offlineIntel) {
    endpointsCalled.push("upcoming_fixtures+match_odds_history (offline SQLite)");
  }

  // 3. Eksekusi panggilan secara selektif & paralel
  const promises: {
    refRes?: Promise<any>;
    lineupsRes?: Promise<any>;
    homeRecentRes?: Promise<any>;
    awayRecentRes?: Promise<any>;
    h2hRes?: Promise<any>;
    homeInjuriesRes?: Promise<any>;
    awayInjuriesRes?: Promise<any>;
    oddsRes?: Promise<any>;
  } = {};

  if (decision.fetch_referee) {
    endpointsCalled.push(`/football/matches/${safeMatchId}/referee`);
    promises.refRes = safeGet(`/football/matches/${safeMatchId}/referee`, {}, ttlMs);
  } else {
    endpointsSkipped.push("referee");
  }

  if (decision.fetch_lineups) {
    endpointsCalled.push(`/football/matches/${safeMatchId}/lineups`);
    promises.lineupsRes = safeGet(`/football/matches/${safeMatchId}/lineups`, {}, ttlMs);
  } else {
    endpointsSkipped.push("lineups (kickoff > 2.5 jam)");
  }

  // 1. Cek Ketersediaan Data Lokal (Tier-1 Offline SQLite Ingestion)
  // Cutoff = kickoff match yang sedang dianalisis: form/H2H lokal hanya boleh
  // berisi match SEBELUM ini (anti-leakage waktu saat match lama diulang).
  // FAIL-CLOSED (audit 2026-10-18): tanpa utc_date, cutoff tidak bisa dipastikan →
  // sumber lokal TIDAK dipakai (query tanpa batas waktu bisa membocorkan match
  // masa depan). Jalur online tetap aman karena difilter status=finished.
  const beforeDate = String(matchData.utc_date || "");
  const canUseLocalSources = beforeDate !== "";
  if (!canUseLocalSources) {
    console.warn(`[stats-fetcher] ${safeMatchId}: utc_date absen — sumber lokal dilewati (fail-closed anti-leakage).`);
  }
  const localH2H = (canUseLocalSources && homeTeamId && awayTeamId) 
    ? getLocalH2HMatches(String(homeTeamId), String(awayTeamId), 6, beforeDate) 
    : [];
  const localHomeRecent = canUseLocalSources && homeTeamId ? getLocalRecentMatches(String(homeTeamId), 6, beforeDate) : [];
  const localAwayRecent = canUseLocalSources && awayTeamId ? getLocalRecentMatches(String(awayTeamId), 6, beforeDate) : [];
  const localHomeInjuries = homeTeamId ? getLocalSquadInjuries(String(homeTeamId)) : [];
  const localAwayInjuries = awayTeamId ? getLocalSquadInjuries(String(awayTeamId)) : [];

  // H2H: Pakai database lokal jika ada, fallback online jika kosong
  if (localH2H.length > 0) {
    endpointsSkipped.push(`h2h (Tier-1 Local SQLite: ${localH2H.length} laga)`);
    promises.h2hRes = Promise.resolve({ data: localH2H, source: "offline_sqlite" });
  } else if (decision.fetch_h2h && homeTeamId) {
    endpointsCalled.push(`/football/matches (h2h pool online fallback)`);
    promises.h2hRes = safeGet(
      "/football/matches",
      { status: "finished", team_id: homeTeamId, sort: "-utc_date", per_page: 30 },
      ttlMs
    );
  } else {
    endpointsSkipped.push("h2h");
  }

  // Recent Matches: Pakai database lokal jika ada (>= 3 match)
  if (localHomeRecent.length >= 3 && localAwayRecent.length >= 3) {
    endpointsSkipped.push(`recent_matches (Tier-1 Local SQLite: ${localHomeRecent.length}H / ${localAwayRecent.length}A)`);
    promises.homeRecentRes = Promise.resolve({ data: localHomeRecent, source: "offline_sqlite" });
    promises.awayRecentRes = Promise.resolve({ data: localAwayRecent, source: "offline_sqlite" });
  } else if (homeTeamId && awayTeamId) {
    endpointsCalled.push("/football/matches (recent home/away online fallback)");
    promises.homeRecentRes = safeGet(
      "/football/matches",
      { status: "finished", team_id: homeTeamId, sort: "-utc_date", per_page: 6 },
      ttlMs
    );
    promises.awayRecentRes = safeGet(
      "/football/matches",
      { status: "finished", team_id: awayTeamId, sort: "-utc_date", per_page: 6 },
      ttlMs
    );
  }

  // Injuries: Pakai database lokal jika terdaftar di squad DB
  if (localHomeInjuries.length > 0 || localAwayInjuries.length > 0) {
    endpointsSkipped.push(`injuries (Tier-1 Local SQLite: ${localHomeInjuries.length}H / ${localAwayInjuries.length}A)`);
    promises.homeInjuriesRes = Promise.resolve({ data: localHomeInjuries, source: "offline_sqlite" });
    promises.awayInjuriesRes = Promise.resolve({ data: localAwayInjuries, source: "offline_sqlite" });
  } else if (decision.fetch_injuries && homeTeamId && awayTeamId) {
    endpointsCalled.push("injuries-suspensions (online fallback)");
    promises.homeInjuriesRes = safeGet(
      `/football/teams/${homeTeamId}/injuries-suspensions`,
      { current: true },
      ttlMs
    );
    promises.awayInjuriesRes = safeGet(
      `/football/teams/${awayTeamId}/injuries-suspensions`,
      { current: true },
      ttlMs
    );
  } else {
    endpointsSkipped.push("injuries (laga masih jauh / selesai)");
  }

  if (offlineOddsRes) {
    endpointsSkipped.push("odds (offline anchor SQLite)");
    promises.oddsRes = Promise.resolve(offlineOddsRes);
  } else if (decision.fetch_odds) {
    endpointsCalled.push(`/football/matches/${safeMatchId}/odds`);
    promises.oddsRes = safeGet(
      `/football/matches/${safeMatchId}/odds`,
      { bookmaker: "bet365,pinnacle" },
      ttlMs
    );
  } else {
    endpointsSkipped.push("odds");
  }

  // Tunggu semua promise selektif selesai
  const [
    refRes,
    lineupsRes,
    h2hRes,
    homeRecentRes,
    awayRecentRes,
    homeInjuriesRes,
    awayInjuriesRes,
    oddsRes,
  ] = await Promise.all([
    promises.refRes ?? Promise.resolve(null),
    promises.lineupsRes ?? Promise.resolve(null),
    promises.h2hRes ?? Promise.resolve(null),
    promises.homeRecentRes ?? Promise.resolve(null),
    promises.awayRecentRes ?? Promise.resolve(null),
    promises.homeInjuriesRes ?? Promise.resolve(null),
    promises.awayInjuriesRes ?? Promise.resolve(null),
    promises.oddsRes ?? Promise.resolve(null),
  ]);

  // 4. Lakukan validasi dan sanitisasi Zod ketat
  const verifiedIntelligence = validateAndSanitizeMatchData({
    matchRes,
    refRes,
    lineupsRes,
    h2hRes,
    homeRecentRes,
    awayRecentRes,
    homeInjuriesRes,
    awayInjuriesRes,
    oddsRes,
  });

  return {
    intelligence: verifiedIntelligence,
    audit: {
      dispatcher_model: modelUsed,
      decision,
      endpoints_called: endpointsCalled,
      endpoints_skipped: endpointsSkipped,
      cache_metrics: getStatsCacheMetrics(),
      timestamp: new Date().toISOString(),
    },
  };
}
