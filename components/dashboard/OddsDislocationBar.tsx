"use client";

import React, { useMemo } from "react";
import { QuantEngineData, BettingResult1xBet } from "./types";
import { TrendingUpIcon, RefreshCwIcon, ArrowUpRightIcon, CoinsIcon } from "@/components/icons";

interface OddsDislocationBarProps {
  odds?: {
    dislocation: {
      ringkasan_1x2: string;
      asian_handicap?: string | null;
      over_under?: string | null;
      btts?: string | null;
      benchmarks?: { home?: number; draw?: number; away?: number; source?: string } | null;
      fair?: { home?: number; draw?: number; away?: number } | null;
    };
    smart_money?: string;
  };
  bursaPasar?: {
    ringkasan_1x2: string;
    asian_handicap: string | null;
    over_under: string | null;
    btts: string | null;
    pergerakan_smart_money: string;
  };
  quantData?: QuantEngineData;
  impliedProb?: { kandang: number; seri: number; tandang: number } | null;
  bettingResult?: BettingResult1xBet | null;
  homeTeam: string;
  awayTeam: string;
  onTriggerScan?: () => void;
  bettingLoading?: boolean;
}

export function OddsDislocationBar({
  odds,
  bursaPasar,
  quantData,
  impliedProb,
  bettingResult,
  homeTeam,
  awayTeam,
  onTriggerScan,
  bettingLoading = false,
}: OddsDislocationBarProps) {
  // Normalisasi data dari odds view atau fallback bursaPasar
  const market1x2 = odds?.dislocation?.ringkasan_1x2 || bursaPasar?.ringkasan_1x2 || "1X2 Aktif";
  const marketAH = odds?.dislocation?.asian_handicap || bursaPasar?.asian_handicap || "Seimbang (AH 0.0)";
  const marketOU = odds?.dislocation?.over_under || bursaPasar?.over_under || "Line Aktif (2.5)";
  const marketBTTS = odds?.dislocation?.btts || bursaPasar?.btts || "Tersedia";
  const smartMoneyText = odds?.smart_money || bursaPasar?.pergerakan_smart_money || "Aliran likuiditas pasar terpantau stabil.";

  // Parsing atau penentuan odds consensus benchmark (TheStatsAPI/Bet365)
  const benchmarkOdds = useMemo(() => {
    if (odds?.dislocation?.benchmarks) {
      return odds.dislocation.benchmarks;
    }

    const text = market1x2;
    const matches = text.match(/(\d+\.\d{2})/g);
    if (matches && matches.length >= 3) {
      return {
        home: parseFloat(matches[0]),
        draw: parseFloat(matches[1]),
        away: parseFloat(matches[2]),
        source: "TheStatsAPI 1X2",
      };
    }

    if (impliedProb && impliedProb.kandang > 0) {
      return {
        home: +(100 / impliedProb.kandang).toFixed(2),
        draw: +(100 / impliedProb.seri).toFixed(2),
        away: +(100 / impliedProb.tandang).toFixed(2),
        source: "Implied Consensus",
      };
    }

    if (quantData?.vig_stripping?.fair_odds) {
      const fo = quantData.vig_stripping.fair_odds;
      return {
        home: fo.home,
        draw: fo.draw,
        away: fo.away,
        source: "Vig-Stripped Odds",
      };
    }

    return null;
  }, [odds, market1x2, impliedProb, quantData]);

  // Model Fair Odds dari Dixon-Coles Poisson Engine
  const modelFair = odds?.dislocation?.fair || quantData?.dixon_coles?.fair_odds;

  // 1xBet Live Odds jika sudah discan
  const oneXBetOdds = useMemo(() => {
    if (bettingResult?.sample_markets && Array.isArray(bettingResult.sample_markets)) {
      const m1x2 = bettingResult.sample_markets.find((m: any) =>
        m.name?.toLowerCase().includes("1x2") || m.name?.toLowerCase().includes("match winner") || m.market_id === 1
      );
      if (m1x2?.odds) {
        const hVal = m1x2.odds["1"] || m1x2.odds["W1"] || m1x2.odds["Home"];
        const dVal = m1x2.odds["X"] || m1x2.odds["Draw"] || m1x2.odds["Seri"];
        const aVal = m1x2.odds["2"] || m1x2.odds["W2"] || m1x2.odds["Away"];
        if (hVal && dVal && aVal) {
          return {
            home: Number(hVal),
            draw: Number(dVal),
            away: Number(aVal),
          };
        }
      }
    }

    if (!bettingResult?.markets_classified) return null;
    const m1x2 = bettingResult.markets_classified["1X2"] || bettingResult.markets_classified["1x2"];
    if (m1x2 && Array.isArray(m1x2) && m1x2.length >= 3) {
      const h = m1x2.find((p: any) => p.name?.includes("1") || p.title?.includes("1"));
      const d = m1x2.find((p: any) => p.name?.includes("X") || p.title?.includes("Draw") || p.title?.includes("Seri"));
      const a = m1x2.find((p: any) => p.name?.includes("2") || p.title?.includes("2"));
      if (h?.odds && d?.odds && a?.odds) {
        return {
          home: Number(h.odds),
          draw: Number(d.odds),
          away: Number(a.odds),
        };
      }
    }
    return null;
  }, [bettingResult]);

  // Hitung Dislokasi Delta (% edge bursa terhadap fair odds model)
  const calculateDislocation = (bookieOdds?: number, fairOdds?: number) => {
    if (
      !bookieOdds ||
      !fairOdds ||
      !Number.isFinite(bookieOdds) ||
      !Number.isFinite(fairOdds) ||
      fairOdds <= 0 ||
      bookieOdds <= 0
    ) {
      return null;
    }
    const delta = ((bookieOdds / fairOdds) - 1) * 100;
    return Number.isFinite(delta) ? delta : null;
  };

  const outcomes = useMemo(() => [
    {
      key: "home",
      label: "1 (Kandang)",
      team: homeTeam,
      fair: modelFair?.home,
      bench: benchmarkOdds?.home,
      oneX: oneXBetOdds?.home,
      prob: quantData?.dixon_coles?.prob_home_win,
    },
    {
      key: "draw",
      label: "X (Seri)",
      team: "Imbang",
      fair: modelFair?.draw,
      bench: benchmarkOdds?.draw,
      oneX: oneXBetOdds?.draw,
      prob: quantData?.dixon_coles?.prob_draw,
    },
    {
      key: "away",
      label: "2 (Tamu)",
      team: awayTeam,
      fair: modelFair?.away,
      bench: benchmarkOdds?.away,
      oneX: oneXBetOdds?.away,
      prob: quantData?.dixon_coles?.prob_away_win,
    },
  ], [homeTeam, awayTeam, modelFair, benchmarkOdds, oneXBetOdds, quantData]);

  return (
    <div className="p-5 sm:p-6 rounded-[24px] bg-white border border-[#e5e5e5] shadow-[0_1px_3px_rgba(0,0,0,0.05)] space-y-5 text-[#0a0a0a] font-mono text-xs">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#e5e5e5]">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <CoinsIcon size={16} className="text-[#0a0a0a]" />
            <h3 className="text-xs sm:text-sm font-bold text-[#0a0a0a] tracking-tight uppercase">
              Bursa Odds, Dislokasi Pasar &amp; Efisiensi Harga
            </h3>
          </div>
          <p className="text-[11px] text-[#737373] font-sans">
            Kompilasi pasar utama bursa global serta deteksi anomali harga (+EV) terhadap model matematis deterministik.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onTriggerScan && (
            <button
              onClick={onTriggerScan}
              disabled={bettingLoading}
              className="px-3.5 py-1.5 rounded-[18px] bg-[#0a0a0a] hover:bg-black text-white text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
            >
              {bettingLoading ? (
                <>
                  <RefreshCwIcon size={12} className="animate-spin" />
                  <span>Sinkronisasi 1xBet...</span>
                </>
              ) : (
                <>
                  <ArrowUpRightIcon size={12} />
                  <span>{oneXBetOdds ? "Refresh 1xBet Feed" : "Scan 1xBet Live Feed"}</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* 4-GRID SUMMARY PASAR (TERINTEGRASI DARI MARKET ODDS OVERVIEW CARD) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
        <div className="p-3 rounded-[14px] bg-[#fafafa] border border-[#e5e5e5] space-y-1">
          <span className="text-[10px] text-[#737373] uppercase block font-semibold">
            1X2 Match Odds
          </span>
          <p className="text-[#0a0a0a] text-xs font-semibold leading-relaxed tabular-nums">
            {market1x2}
          </p>
        </div>

        <div className="p-3 rounded-[14px] bg-[#fafafa] border border-[#e5e5e5] space-y-1">
          <span className="text-[10px] text-[#737373] uppercase block font-semibold">
            Asian Handicap
          </span>
          <p className="text-[#0a0a0a] text-xs font-semibold leading-relaxed tabular-nums">
            {marketAH}
          </p>
        </div>

        <div className="p-3 rounded-[14px] bg-[#fafafa] border border-[#e5e5e5] space-y-1">
          <span className="text-[10px] text-[#737373] uppercase block font-semibold">
            Total Goals (O/U)
          </span>
          <p className="text-[#0a0a0a] text-xs font-semibold leading-relaxed tabular-nums">
            {marketOU}
          </p>
        </div>

        <div className="p-3 rounded-[14px] bg-[#fafafa] border border-[#e5e5e5] space-y-1">
          <span className="text-[10px] text-[#737373] uppercase block font-semibold">
            BTTS (Kedua Tim Gol)
          </span>
          <p className="text-[#0a0a0a] text-xs font-semibold leading-relaxed tabular-nums">
            {marketBTTS}
          </p>
        </div>
      </div>

      {/* Odds Comparison Tri-Panel */}
      <div className="space-y-2">
        <span className="text-[10px] text-[#737373] uppercase tracking-wider block font-semibold">
          Evaluasi Dislokasi 1X2 (Model Fair vs Bursa Real-Time):
        </span>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {outcomes.map((item) => {
            const activeBookieOdds = item.oneX || item.bench;
            const delta = calculateDislocation(activeBookieOdds, item.fair);
            const isPositive = delta !== null && delta > 0;

            return (
              <div
                key={item.key}
                className="p-4 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] space-y-3"
              >
                <div className="flex items-center justify-between pb-2 border-b border-[#e5e5e5]">
                  <div>
                    <span className="text-[10px] text-[#737373] uppercase block font-mono">
                      Pilihan {item.label}
                    </span>
                    <strong className="text-xs font-bold text-[#0a0a0a] block truncate max-w-[170px]">
                      {item.team}
                    </strong>
                  </div>
                  {item.prob !== undefined && (
                    <span className="px-2 py-0.5 rounded-[12px] text-[10px] font-bold flat-tag-zinc tabular-nums">
                      {(item.prob * 100).toFixed(0)}%
                    </span>
                  )}
                </div>

                <div className="space-y-1.5 text-xs tabular-nums">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[#737373]">Dixon-Coles Fair:</span>
                    <strong className="text-[#0a0a0a]">
                      {item.fair !== undefined ? item.fair.toFixed(2) : "-"}
                    </strong>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[#737373]">TheStatsAPI (Consensus):</span>
                    <span className="text-[#0a0a0a] font-medium">
                      {item.bench !== undefined ? item.bench.toFixed(2) : "-"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[#737373]">1xBet Live Market:</span>
                    <span className={item.oneX ? "text-[#0a0a0a] font-bold" : "text-[#737373]"}>
                      {item.oneX !== undefined ? item.oneX.toFixed(2) : "(Belum Scan)"}
                    </span>
                  </div>

                  <div className="pt-2 border-t border-[#e5e5e5] flex items-center justify-between">
                    <span className="text-[10px] text-[#737373] uppercase">Dislocation Delta:</span>
                    {delta !== null ? (
                      <span
                        className={`px-2 py-0.5 rounded-[14px] text-[10px] font-bold ${
                          isPositive
                            ? "bg-[#10b981]/10 text-[#059669] border border-[#10b981]/30"
                            : "bg-[#f43f5e]/10 text-[#e11d48] border border-[#f43f5e]/30"
                        }`}
                      >
                        {isPositive ? `+${delta.toFixed(1)}% Edge` : `${delta.toFixed(1)}% Disadv`}
                      </span>
                    ) : (
                      <span className="text-[10px] text-[#737373]">-</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Smart Money Movement Bar */}
      {smartMoneyText && (
        <div className="p-4 rounded-[16px] bg-[#fafafa] border border-[#e5e5e5] flex items-start gap-2.5 text-xs">
          <TrendingUpIcon size={15} className="text-[#0a0a0a] shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="text-[10px] text-[#0a0a0a] font-bold uppercase tracking-wider block">
              Aliran Likuiditas Smart Money &amp; Pergerakan Line Bursa
            </span>
            <p className="text-[#737373] leading-relaxed font-sans text-xs">
              {smartMoneyText}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
