import { NextResponse } from "next/server";
import { cachedStatsGet, getStatsCacheMetrics } from "@/lib/stats-cache";
import { format1xBetLeagueName } from "@/lib/league-constants";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const hours = Math.min(Math.max(Number(searchParams.get("hours")) || 12, 1), 48);
  const competitionId = searchParams.get("competition_id") || undefined;

  const now = new Date();
  const maxTime = new Date(now.getTime() + hours * 60 * 60 * 1000);

  // Ambil date_from (hari ini) dan date_to (2 hari ke depan untuk mencakup jendela jam)
  const dateFrom = now.toISOString().slice(0, 10);
  const futureDate = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
  const dateTo = futureDate.toISOString().slice(0, 10);

  const queryParams: Record<string, string> = {
    status: "scheduled",
    sort: "utc_date",
    date_from: dateFrom,
    date_to: dateTo,
    per_page: "100",
  };
  if (competitionId) {
    queryParams.competition_id = competitionId;
  }

  try {
    // 1. Ambil jadwal laga dari TheStatsAPI dengan in-memory cache 10 menit
    const json = await cachedStatsGet("/football/matches", queryParams, 10 * 60 * 1000);

    if (json.error) {
      return NextResponse.json(
        {
          error: json.message || `HTTP ${json.error}: Gagal mengambil jadwal pertandingan`,
        },
        { status: 500 }
      );
    }

    // 2. Ambil kamus kompetisi TheStatsAPI dengan in-memory cache 24 jam (hanya 1 request per hari)
    const [compsP1, compsP2, compsP3, compsP4] = await Promise.all([
      cachedStatsGet("/football/competitions", { per_page: 100, page: 1 }, 24 * 60 * 60 * 1000),
      cachedStatsGet("/football/competitions", { per_page: 100, page: 2 }, 24 * 60 * 60 * 1000),
      cachedStatsGet("/football/competitions", { per_page: 100, page: 3 }, 24 * 60 * 60 * 1000),
      cachedStatsGet("/football/competitions", { per_page: 100, page: 4 }, 24 * 60 * 60 * 1000),
    ]);

    const competitionMap = new Map<string, { id: string; name: string; country?: string | null }>();
    const allComps = [
      ...(Array.isArray(compsP1?.data) ? compsP1.data : []),
      ...(Array.isArray(compsP2?.data) ? compsP2.data : []),
      ...(Array.isArray(compsP3?.data) ? compsP3.data : []),
      ...(Array.isArray(compsP4?.data) ? compsP4.data : []),
    ];
    for (const c of allComps) {
      if (c?.id) {
        competitionMap.set(String(c.id), {
          id: String(c.id),
          name: c.name,
          country: c.country,
        });
      }
    }

    const rawMatches = json?.data || [];

    // Filter pertandingan yang kickoff-nya berada dalam rentang [sekarang, sekarang + hours]
    const leagueMap = new Map<string, { id: string; name: string; count: number }>();

    const filtered = rawMatches
      .filter((m: any) => {
        if (!m.utc_date) return false;
        const kickoff = new Date(m.utc_date);
        return kickoff >= now && kickoff <= maxTime;
      })
      .map((m: any) => {
        const compId = String(m.competition_id || "");
        const compMeta = competitionMap.get(compId);

        // Format nama kompetisi mengikuti standar 1xBet: "<Country>. <League Name>" atau "<Tournament Name>"
        const standardName = format1xBetLeagueName(
          compMeta?.name || m.competition_name || m.stage_name,
          compMeta?.country
        );

        // Agregasi jumlah laga per kompetisi untuk filter pills & dropdown
        if (compId) {
          const existing = leagueMap.get(compId);
          if (existing) {
            existing.count += 1;
          } else {
            leagueMap.set(compId, {
              id: compId,
              name: standardName,
              count: 1,
            });
          }
        }

        return {
          id: m.id,
          utc_date: m.utc_date,
          competition_id: compId,
          competition_name: standardName,
          home_team: {
            id: m.home_team?.id,
            name: m.home_team?.name,
          },
          away_team: {
            id: m.away_team?.id,
            name: m.away_team?.name,
          },
          venue: m.venue || null,
          is_neutral: m.is_neutral ?? false,
          odds_available: m.odds_available ?? false,
          xg_available: m.xg_available ?? false,
          shotmap_available: m.shotmap_available ?? false,
        };
      });

    // Urutkan daftar liga aktif berdasarkan jumlah pertandingan terbanyak
    const activeLeagues = Array.from(leagueMap.values()).sort((a, b) => b.count - a.count);

    return NextResponse.json({
      hours,
      total: filtered.length,
      matches: filtered,
      leagues: activeLeagues,
      cacheMetrics: getStatsCacheMetrics(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
