import { NextResponse } from "next/server";
import { z } from "zod";
import { cachedStatsGet, getStatsCacheMetrics } from "@/lib/stats-cache";
import {
  TheStatsOddsComparisonData,
  BookmakerOddsComparisonItem,
  BestOddsSelection,
} from "@/components/dashboard/types";

// Strict Zod Schemas for defensive ingestion
const PricePointSchema = z
  .object({
    opening: z.union([z.string(), z.number()]).optional().nullable(),
    last_seen: z.union([z.string(), z.number()]).optional().nullable(),
    price: z.union([z.string(), z.number()]).optional().nullable(),
    value: z.union([z.string(), z.number()]).optional().nullable(),
  })
  .passthrough();

const RawBookmakerSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional().nullable(),
    name: z.string().optional().nullable(),
    markets: z
      .object({
        match_odds: z
          .object({
            home: PricePointSchema.optional().nullable(),
            draw: PricePointSchema.optional().nullable(),
            away: PricePointSchema.optional().nullable(),
          })
          .passthrough()
          .optional()
          .nullable(),
        total_goals: z.record(z.string(), z.any()).optional().nullable(),
        totals: z.record(z.string(), z.any()).optional().nullable(),
        asian_handicap: z.record(z.string(), z.any()).optional().nullable(),
        btts: z.record(z.string(), z.any()).optional().nullable(),
      })
      .passthrough()
      .optional()
      .nullable(),
  })
  .passthrough();

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) && n > 1.0 ? Math.round(n * 100) / 100 : null;
}

function parsePricePoint(rawPoint: unknown): {
  opening: number | null;
  last_seen: number | null;
  diff: number | null;
} {
  if (!rawPoint || typeof rawPoint !== "object") {
    return { opening: null, last_seen: null, diff: null };
  }

  const opening = toNum((rawPoint as Record<string, unknown>).opening);
  const last_seen = toNum((rawPoint as Record<string, unknown>).last_seen ?? (rawPoint as Record<string, unknown>).price ?? (rawPoint as Record<string, unknown>).value);
  const effectiveOpening = opening ?? last_seen;
  const effectiveLast = last_seen ?? opening;

  let diff: number | null = null;
  if (effectiveOpening !== null && effectiveLast !== null) {
    diff = Math.round((effectiveLast - effectiveOpening) * 100) / 100;
  }

  return {
    opening: effectiveOpening,
    last_seen: effectiveLast,
    diff,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const matchId = searchParams.get("match_id");

  if (!matchId) {
    return NextResponse.json(
      { error: "Parameter match_id wajib disertakan" },
      { status: 400 }
    );
  }

  try {
    // 15 menit RAM cache (atau 10 menit jika kickoff dekat)
    const rawRes = await cachedStatsGet(
      `/football/matches/${encodeURIComponent(matchId)}/odds`,
      {},
      15 * 60 * 1000
    );

    if (rawRes?.error) {
      return NextResponse.json({
        match_id: matchId,
        is_available: false,
        message: "Data belum tersedia dari TheStatsAPI",
        bookmakers: [],
        best_odds: null,
        averages: {
          home: null,
          draw: null,
          away: null,
          over_2_5: null,
          under_2_5: null,
          average_margin_1x2: null,
        },
        lowest_margin_bookmaker: null,
        timestamp: new Date().toISOString(),
        cache_metrics: getStatsCacheMetrics(),
      } satisfies TheStatsOddsComparisonData & {
        cache_metrics: ReturnType<typeof getStatsCacheMetrics>;
      });
    }

    const rawList = Array.isArray(rawRes?.data?.bookmakers)
      ? rawRes.data.bookmakers
      : Array.isArray(rawRes?.data)
      ? rawRes.data
      : [];

    if (rawList.length === 0) {
      return NextResponse.json({
        match_id: matchId,
        is_available: false,
        message: "Data belum tersedia dari TheStatsAPI",
        bookmakers: [],
        best_odds: null,
        averages: {
          home: null,
          draw: null,
          away: null,
          over_2_5: null,
          under_2_5: null,
          average_margin_1x2: null,
        },
        lowest_margin_bookmaker: null,
        timestamp: new Date().toISOString(),
        cache_metrics: getStatsCacheMetrics(),
      } satisfies TheStatsOddsComparisonData & {
        cache_metrics: ReturnType<typeof getStatsCacheMetrics>;
      });
    }

    const bookmakers: BookmakerOddsComparisonItem[] = [];

    for (let i = 0; i < rawList.length; i++) {
      const parsedItem = RawBookmakerSchema.safeParse(rawList[i]);
      const rawBm = parsedItem.success ? parsedItem.data : rawList[i];
      const name = rawBm?.name || `Bookmaker ${i + 1}`;

      const mo = rawBm?.markets?.match_odds;
      const homePoint = parsePricePoint(mo?.home);
      const drawPoint = parsePricePoint(mo?.draw);
      const awayPoint = parsePricePoint(mo?.away);

      // Over/Under 2.5
      const totalGoals = rawBm?.markets?.total_goals || rawBm?.markets?.totals || {};
      const o25Raw = totalGoals.over_2_5 || totalGoals["2.5"]?.over || totalGoals.over;
      const u25Raw = totalGoals.under_2_5 || totalGoals["2.5"]?.under || totalGoals.under;
      const overPoint = parsePricePoint(o25Raw);
      const underPoint = parsePricePoint(u25Raw);

      // Overround & Margin 1X2
      let margin_1x2: number | null = null;
      let overround_1x2: number | null = null;
      if (homePoint.last_seen && drawPoint.last_seen && awayPoint.last_seen) {
        const sumInv =
          1 / homePoint.last_seen + 1 / drawPoint.last_seen + 1 / awayPoint.last_seen;
        overround_1x2 = Math.round(sumInv * 1000) / 10;
        margin_1x2 = Math.round((sumInv - 1) * 1000) / 10;
      }

      // Overround & Margin O/U 2.5
      let margin_ou: number | null = null;
      let overround_ou: number | null = null;
      if (overPoint.last_seen && underPoint.last_seen) {
        const sumInvOU = 1 / overPoint.last_seen + 1 / underPoint.last_seen;
        overround_ou = Math.round(sumInvOU * 1000) / 10;
        margin_ou = Math.round((sumInvOU - 1) * 1000) / 10;
      }

      bookmakers.push({
        id: `bm-${i}-${name.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
        name,
        match_odds: {
          home: homePoint,
          draw: drawPoint,
          away: awayPoint,
        },
        total_goals_2_5: {
          over: overPoint,
          under: underPoint,
        },
        margin_1x2,
        overround_1x2,
        margin_ou,
        overround_ou,
      });
    }

    // Compute Best Odds Selections
    let bestHome: BestOddsSelection | null = null;
    let bestDraw: BestOddsSelection | null = null;
    let bestAway: BestOddsSelection | null = null;
    let bestOver: BestOddsSelection | null = null;
    let bestUnder: BestOddsSelection | null = null;

    let homeSum = 0,
      homeCount = 0;
    let drawSum = 0,
      drawCount = 0;
    let awaySum = 0,
      awayCount = 0;
    let overSum = 0,
      overCount = 0;
    let underSum = 0,
      underCount = 0;
    let marginSum = 0,
      marginCount = 0;

    let lowestMarginBm: { name: string; margin: number } | null = null;

    for (const b of bookmakers) {
      if (b.match_odds.home.last_seen) {
        const p = b.match_odds.home.last_seen;
        homeSum += p;
        homeCount++;
        if (!bestHome || p > bestHome.price) {
          bestHome = { price: p, bookmaker: b.name };
        }
      }

      if (b.match_odds.draw.last_seen) {
        const p = b.match_odds.draw.last_seen;
        drawSum += p;
        drawCount++;
        if (!bestDraw || p > bestDraw.price) {
          bestDraw = { price: p, bookmaker: b.name };
        }
      }

      if (b.match_odds.away.last_seen) {
        const p = b.match_odds.away.last_seen;
        awaySum += p;
        awayCount++;
        if (!bestAway || p > bestAway.price) {
          bestAway = { price: p, bookmaker: b.name };
        }
      }

      if (b.total_goals_2_5.over.last_seen) {
        const p = b.total_goals_2_5.over.last_seen;
        overSum += p;
        overCount++;
        if (!bestOver || p > bestOver.price) {
          bestOver = { price: p, bookmaker: b.name };
        }
      }

      if (b.total_goals_2_5.under.last_seen) {
        const p = b.total_goals_2_5.under.last_seen;
        underSum += p;
        underCount++;
        if (!bestUnder || p > bestUnder.price) {
          bestUnder = { price: p, bookmaker: b.name };
        }
      }

      if (b.margin_1x2 !== null) {
        marginSum += b.margin_1x2;
        marginCount++;
        if (!lowestMarginBm || b.margin_1x2 < lowestMarginBm.margin) {
          lowestMarginBm = { name: b.name, margin: b.margin_1x2 };
        }
      }
    }

    const payload: TheStatsOddsComparisonData & {
      cache_metrics: ReturnType<typeof getStatsCacheMetrics>;
    } = {
      match_id: matchId,
      is_available: bookmakers.length > 0,
      message: bookmakers.length > 0 ? undefined : "Data belum tersedia dari TheStatsAPI",
      bookmakers,
      best_odds: {
        home: bestHome,
        draw: bestDraw,
        away: bestAway,
        over_2_5: bestOver,
        under_2_5: bestUnder,
      },
      averages: {
        home: homeCount > 0 ? Math.round((homeSum / homeCount) * 100) / 100 : null,
        draw: drawCount > 0 ? Math.round((drawSum / drawCount) * 100) / 100 : null,
        away: awayCount > 0 ? Math.round((awaySum / awayCount) * 100) / 100 : null,
        over_2_5: overCount > 0 ? Math.round((overSum / overCount) * 100) / 100 : null,
        under_2_5: underCount > 0 ? Math.round((underSum / underCount) * 100) / 100 : null,
        average_margin_1x2:
          marginCount > 0 ? Math.round((marginSum / marginCount) * 10) / 10 : null,
      },
      lowest_margin_bookmaker: lowestMarginBm,
      timestamp: new Date().toISOString(),
      cache_metrics: getStatsCacheMetrics(),
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[api/odds] Error fetching bookmaker comparison:", error);
    return NextResponse.json(
      {
        match_id: matchId,
        is_available: false,
        message: "Data belum tersedia dari TheStatsAPI",
        bookmakers: [],
        best_odds: null,
        averages: {
          home: null,
          draw: null,
          away: null,
          over_2_5: null,
          under_2_5: null,
          average_margin_1x2: null,
        },
        lowest_margin_bookmaker: null,
        timestamp: new Date().toISOString(),
        cache_metrics: getStatsCacheMetrics(),
      },
      { status: 200 }
    );
  }
}
