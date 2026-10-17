import leaguesData from "@/data/1xbet_leagues.json";
import {
  POPULAR_COMPETITIONS,
  type PopularCompetition,
  format1xBetLeagueName,
} from "./league-constants";

export { POPULAR_COMPETITIONS, type PopularCompetition, format1xBetLeagueName };

export interface StandardizedLeague {
  standard_name: string;
  league_1xbet_id: number | null;
  logo?: string;
}

// Mapping alias eksplisit TheStatsAPI -> 1xBet
const EXPLICIT_ALIAS_MAP: Record<string, { id: number; standard_name: string }> = {
  "uefa champions league": { id: 118587, standard_name: "UEFA Champions League" },
  "champions league": { id: 118587, standard_name: "UEFA Champions League" },
  "ucl": { id: 118587, standard_name: "UEFA Champions League" },
  "uefa europa league": { id: 118593, standard_name: "UEFA Europa League" },
  "europa league": { id: 118593, standard_name: "UEFA Europa League" },
  "uel": { id: 118593, standard_name: "UEFA Europa League" },
  "uefa conference league": { id: 2252762, standard_name: "UEFA Conference League" },
  "conference league": { id: 2252762, standard_name: "UEFA Conference League" },
  "uefa nations league": { id: 1706694, standard_name: "UEFA Nations League" },
  "nations league": { id: 1706694, standard_name: "UEFA Nations League" },
  
  "premier league": { id: 88637, standard_name: "England. Premier League" },
  "epl": { id: 88637, standard_name: "England. Premier League" },
  "england premier league": { id: 88637, standard_name: "England. Premier League" },
  "championship": { id: 105759, standard_name: "England. Championship" },
  "england championship": { id: 105759, standard_name: "England. Championship" },
  "efl cup": { id: 119237, standard_name: "England. League Cup" },
  "league cup": { id: 119237, standard_name: "England. League Cup" },
  "fa cup": { id: 119239, standard_name: "England. FA Cup" },

  "serie a": { id: 110163, standard_name: "Italy. Serie A" },
  "italy serie a": { id: 110163, standard_name: "Italy. Serie A" },
  "serie b": { id: 110167, standard_name: "Italy. Serie B" },
  "coppa italia": { id: 119249, standard_name: "Italy. Cup" },
  
  "la liga": { id: 127733, standard_name: "Spain. La Liga" },
  "laliga": { id: 127733, standard_name: "Spain. La Liga" },
  "spain la liga": { id: 127733, standard_name: "Spain. La Liga" },
  "primera division": { id: 127733, standard_name: "Spain. La Liga" },
  "copa del rey": { id: 119245, standard_name: "Spain. Copa del Rey" },

  "bundesliga": { id: 96463, standard_name: "Germany. Bundesliga" },
  "germany bundesliga": { id: 96463, standard_name: "Germany. Bundesliga" },
  "2. bundesliga": { id: 109313, standard_name: "Germany. 2. Bundesliga" },
  "2 bundesliga": { id: 109313, standard_name: "Germany. 2. Bundesliga" },
  "dfb pokal": { id: 119235, standard_name: "Germany DFB Pokal" },

  "ligue 1": { id: 12821, standard_name: "France. Ligue 1" },
  "france ligue 1": { id: 12821, standard_name: "France. Ligue 1" },
  "ligue 2": { id: 12829, standard_name: "France. Ligue 2" },
  "coupe de france": { id: 12823, standard_name: "France. Cup" },

  "eredivisie": { id: 118663, standard_name: "Netherlands. Eredivisie" },
  "primeira liga": { id: 118671, standard_name: "Portugal. Primeira Liga" },
  "copa libertadores": { id: 142091, standard_name: "Copa Libertadores" },
  "copa sudamericana": { id: 1528791, standard_name: "Copa Sudamericana" },
  "afc champions league": { id: 2740174, standard_name: "AFC Champions League Elite" },
};

function cleanCompetitionKey(str: string): string {
  return str
    .toLowerCase()
    .replace(/[.\-_,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Standardize nama kompetisi dari TheStatsAPI sesuai standar 1xBet
 */
export function standardizeLeague(rawCompetitionName: string | undefined | null): StandardizedLeague {
  if (!rawCompetitionName || typeof rawCompetitionName !== "string") {
    return {
      standard_name: "Other Tournament",
      league_1xbet_id: null,
    };
  }

  const cleaned = cleanCompetitionKey(rawCompetitionName);

  // 1. Cek explicit alias map
  if (EXPLICIT_ALIAS_MAP[cleaned]) {
    const matched = EXPLICIT_ALIAS_MAP[cleaned];
    return {
      standard_name: matched.standard_name,
      league_1xbet_id: matched.id,
    };
  }

  // Cek substring pada alias map
  for (const [alias, val] of Object.entries(EXPLICIT_ALIAS_MAP)) {
    if (cleaned.includes(alias)) {
      return {
        standard_name: val.standard_name,
        league_1xbet_id: val.id,
      };
    }
  }

  // 2. Cek terhadap 283 liga di 1xbet_leagues.json (static JSON import)
  const allLeagues = (leaguesData as Array<{ league_id: number; league_name: string; logo?: string }>) || [];
  
  // Filter keluar turunan khusus seperti "Team vs Player" atau "Statistics Round" agar dapat main tournament
  const mainLeagues = allLeagues.filter(
    (l) => !/team vs player|statistics round|play-off round/i.test(l.league_name)
  );

  // Cari exact match
  const exact = mainLeagues.find(
    (l) => cleanCompetitionKey(l.league_name) === cleaned
  );
  if (exact) {
    return {
      standard_name: exact.league_name,
      league_1xbet_id: exact.league_id,
      logo: exact.logo,
    };
  }

  // Cari fuzzy substring
  const fuzzy = mainLeagues.find((l) => {
    const lClean = cleanCompetitionKey(l.league_name);
    return lClean.includes(cleaned) || cleaned.includes(lClean);
  });

  if (fuzzy) {
    return {
      standard_name: fuzzy.league_name,
      league_1xbet_id: fuzzy.league_id,
      logo: fuzzy.logo,
    };
  }

  // 3. Fallback: gunakan nama asli yang dirapikan jika tidak ada di 1xBet
  return {
    standard_name: rawCompetitionName.trim(),
    league_1xbet_id: null,
  };
}
