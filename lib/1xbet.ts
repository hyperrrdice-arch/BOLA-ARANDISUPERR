import fs from "fs";
import path from "path";

// In-Memory Cache with TTL to strictly protect the 500 requests/month quota
interface CacheEntry<T> {
  data: T;
  expiry: number;
}

const memoryCache = new Map<string, CacheEntry<any>>();

function getFromCache<T>(key: string): T | null {
  const item = memoryCache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiry) {
    memoryCache.delete(key);
    return null;
  }
  return item.data as T;
}

function setInCache<T>(key: string, data: T, ttlMs: number = 60 * 60 * 1000): void {
  memoryCache.set(key, {
    data,
    expiry: Date.now() + ttlMs,
  });
}

const HOST = process.env.RAPIDAPI_1XBET_HOST || "1xbet-api.p.rapidapi.com";
const KEY = process.env.RAPIDAPI_1XBET_KEY || "c8267e344fmsh6add4d3eaa51353p1dc5d8jsna8bca937e332";

async function fetch1xBetRaw(endpoint: string): Promise<any> {
  const url = `https://${HOST}${endpoint}`;
  const res = await fetch(url, {
    headers: {
      "x-rapidapi-host": HOST,
      "x-rapidapi-key": KEY,
    },
    next: { revalidate: 3600 }, // Next.js cache 1 hour
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`1xBet API HTTP ${res.status}: ${text}`);
  }

  return await res.json();
}

export interface League1xBet {
  league_id: number;
  league_name: string;
  logo?: string;
}

export interface Match1xBet {
  id: number | string;
  home_team: string;
  away_team: string;
  home_team_logo?: string;
  away_team_logo?: string;
  league_logo?: string;
  start_timestamp: number;
}

export interface Market1xBetV2 {
  market_id: number;
  name: string;
  base: number | string | null;
  blocked_events?: Record<string, boolean>;
  odds: Record<string, number>;
}

// 1. Get Leagues (reads local disk cache data/1xbet_leagues.json, or fetches once)
export async function get1xBetLeagues(): Promise<League1xBet[]> {
  const cacheKey = "1xbet:leagues";
  const cached = getFromCache<League1xBet[]>(cacheKey);
  if (cached) return cached;

  const diskPath = path.join(process.cwd(), "data", "1xbet_leagues.json");
  if (fs.existsSync(diskPath)) {
    try {
      const raw = fs.readFileSync(diskPath, "utf-8");
      const list = JSON.parse(raw);
      setInCache(cacheKey, list, 24 * 60 * 60 * 1000); // 24 hours
      return list;
    } catch (e) {
      console.warn("Failed to read disk leagues cache, falling back to API", e);
    }
  }

  const json = await fetch1xBetRaw("/sports/1/leagues");
  const leagues = json.data || [];
  setInCache(cacheKey, leagues, 24 * 60 * 60 * 1000);
  return leagues;
}

// 2. Fetch Matches in a League (with 30 min cache)
export async function get1xBetMatchesInLeague(leagueId: number): Promise<Match1xBet[]> {
  const cacheKey = `1xbet:matches:league:${leagueId}`;
  const cached = getFromCache<Match1xBet[]>(cacheKey);
  if (cached) return cached;

  const json = await fetch1xBetRaw(`/matches?sport_id=1&league_id=${leagueId}`);
  const matches = json.data || [];
  setInCache(cacheKey, matches, 30 * 60 * 1000); // 30 minutes
  return matches;
}

// Helper: Normalize team name for fuzzy matching
function cleanName(n: string): string {
  return n
    .toLowerCase()
    .replace(/\b(fc|cf|sc|ac|rc|united|city|club|de|la|el|real|atletico|sporting)\b/gi, "")
    .replace(/[^a-z0-9]/gi, "")
    .trim();
}

// 3. Search / Match TheStatsAPI match to 1xBet
export async function find1xBetMatch(
  homeTeam: string,
  awayTeam: string,
  competitionHint?: string,
  directLeagueId?: number | null
): Promise<{ match: Match1xBet; league: League1xBet } | null> {
  const leagues = await get1xBetLeagues();
  if (!leagues || leagues.length === 0) return null;

  const normHome = cleanName(homeTeam);
  const normAway = cleanName(awayTeam);

  // Jika directLeagueId terdeteksi dari standarisasi liga, prioritaskan liga tersebut langsung
  let candidateLeagues: League1xBet[] = [];
  if (directLeagueId) {
    const direct = leagues.find((l) => l.league_id === Number(directLeagueId));
    if (direct) {
      candidateLeagues.push(direct);
    }
  }

  // Filter leagues by competition hint if available dan belum ditemukan direct
  if (candidateLeagues.length === 0 && competitionHint) {
    const hintClean = cleanName(competitionHint);
    const matched = leagues.filter(
      (l) => cleanName(l.league_name).includes(hintClean) || hintClean.includes(cleanName(l.league_name))
    );
    if (matched.length > 0) {
      candidateLeagues = matched;
    }
  }

  if (candidateLeagues.length === 0) {
    candidateLeagues = leagues;
  }

  // Iterate candidate leagues (max top 3 leagues to conserve requests)
  for (const l of candidateLeagues.slice(0, 3)) {
    try {
      const matches = await get1xBetMatchesInLeague(l.league_id);
      for (const m of matches) {
        const mHome = cleanName(m.home_team || "");
        const mAway = cleanName(m.away_team || "");

        const homeMatch = mHome.includes(normHome) || normHome.includes(mHome);
        const awayMatch = mAway.includes(normAway) || normAway.includes(mAway);

        if (homeMatch && awayMatch) {
          return { match: m, league: l };
        }
      }
    } catch (e) {
      console.warn(`Error scanning matches in league ${l.league_id}:`, e);
    }
  }

  return null;
}

// 4. Fetch 1xBet Markets V2 for a Match (Cached for 60 minutes)
export async function get1xBetMarketsV2(matchId: string | number): Promise<Market1xBetV2[]> {
  const cacheKey = `1xbet:markets_v2:${matchId}`;
  const cached = getFromCache<Market1xBetV2[]>(cacheKey);
  if (cached) {
    console.log(`[1xBet] Cache hit for matchId ${matchId} (0 API requests used)`);
    return cached;
  }

  console.log(`[1xBet] Fetching fresh markets for matchId ${matchId} from RapidAPI...`);
  const json = await fetch1xBetRaw(`/matches/${matchId}/markets_v2`);
  const markets = json.data || [];

  setInCache(cacheKey, markets, 60 * 60 * 1000); // 60 minutes TTL
  return markets;
}
