"use client";

import React, { useMemo } from "react";
import { QuantEngineData, BettingResult1xBet } from "./types";
import { TrendingUpIcon, RefreshCwIcon, ArrowUpRightIcon } from "@/components/icons";

interface OddsDislocationBarProps {
  bursaPasar: {
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
  bursaPasar,
  quantData,
  impliedProb,
  bettingResult,
  homeTeam,
  awayTeam,
  onTriggerScan,
  bettingLoading = false,
}: OddsDislocationBarProps) {
  // Parsing atau penentuan odds consensus benchmark (TheStatsAPI/Bet365)
  const benchmarkOdds = useMemo(() => {
    // 1. Coba ekstrak dari ringkasan_1x2 jika berformat angka (cth: "Kandang: 2.10 | Seri: 3.40 | Tamu: 3.60")
    const text = bursaPasar?.ringkasan_1x2 || "";
    const matches = text.match(/(\d+\.\d{2})/g);
    if (matches && matches.length >= 3) {
      return {
        home: parseFloat(matches[0]),
        draw: parseFloat(matches[1]),
        away: parseFloat(matches[2]),
        source: "TheStatsAPI 1X2",
      };
    }

    // 2. Jika tidak ada di text tapi ada implied prob, hitung implied odds kasar
    if (impliedProb && impliedProb.kandang > 0) {
      return {
        home: +(100 / impliedProb.kandang).toFixed(2),
        draw: +(100 / impliedProb.seri).toFixed(2),
        away: +(100 / impliedProb.tandang).toFixed(2),
        source: "Implied Consensus",
      };
    }

    // 3. Fallback ke fair odds jika tidak ada data bursa lain
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
  }, [bursaPasar, impliedProb, quantData]);

  // Model Fair Odds dari Dixon-Coles Poisson Engine
  const modelFair = quantData?.dixon_coles?.fair_odds;

  // 1xBet Live Odds jika sudah discan
  const oneXBetOdds = useMemo(() => {
    // 1. Cek dari sample_markets jika ada
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

    // 2. Cek dari markets_classified
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
    <div className="doppel-shell w-full">
      <div className="doppel-core space-y-4">
        {/* Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/[0.06]">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#06b6d4]" />
              <h3 className="text-xs sm:text-sm font-bold text-[#f8fafc] tracking-tight uppercase font-mono">
                Unified Odds Dislocation &amp; Market Efficiency Monitor
              </h3>
            </div>
            <p className="text-[11px] text-[#94a3b8]">
              Perbandingan bursa live vs model matematika deterministik untuk mendeteksi anomali harga (+EV).
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onTriggerScan && (
              <button
                onClick={onTriggerScan}
                disabled={bettingLoading}
                className="px-3 py-1.5 rounded-md bg-[#10b981] hover:bg-[#059669] text-white text-xs font-semibold font-mono flex items-center gap-1.5 transition-all shadow-[0_2px_10px_rgba(16,185,129,0.2)] disabled:opacity-50 cursor-pointer"
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

        {/* Odds Comparison Tri-Panel */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {outcomes.map((item) => {
            const activeOdds = item.oneX || item.bench;
            const delta = calculateDislocation(activeOdds, item.fair);
            const isPositive = delta !== null && delta > 0;
            const isSignificant = delta !== null && delta >= 3.0;

            return (
              <div
                key={item.key}
                className={`p-3.5 rounded-lg border transition-all ${
                  isSignificant
                    ? "bg-[#06281e] border-[#134e3a] shadow-[0_0_15px_rgba(16,185,129,0.1)]"
                    : "bg-[#0f131a] border-white/[0.06]"
                }`}
              >
                {/* Outcome Header */}
                <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
                  <div>
                    <span className="text-[10px] font-mono text-[#94a3b8] uppercase block">
                      {item.label}
                    </span>
                    <strong className="text-xs text-[#f8fafc] truncate block max-w-[150px]">
                      {item.team}
                    </strong>
                  </div>

                  {item.prob !== undefined && (
                    <div className="text-right">
                      <span className="text-[10px] font-mono text-[#64748b] block">True Win %</span>
                      <span className="text-xs font-mono font-bold text-[#06b6d4] tabular-nums">
                        {(item.prob * 100).toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>

                {/* 3 Price Lines Comparison */}
                <div className="space-y-1.5 pt-2.5 text-xs font-mono tabular-nums">
                  {/* Line 1: Dixon-Coles Fair Odds */}
                  <div className="flex items-center justify-between text-[#cbd5e1]">
                    <span className="text-[11px] text-[#64748b]">Dixon-Coles Fair:</span>
                    <strong className="text-[#06b6d4]">
                      {item.fair !== undefined ? item.fair.toFixed(2) : "-"}
                    </strong>
                  </div>

                  {/* Line 2: Benchmark Consensus */}
                  <div className="flex items-center justify-between text-[#cbd5e1]">
                    <span className="text-[11px] text-[#64748b]">TheStatsAPI (Bet365):</span>
                    <span className="text-[#f8fafc] font-medium">
                      {item.bench !== undefined ? item.bench.toFixed(2) : "-"}
                    </span>
                  </div>

                  {/* Line 3: 1xBet Live Odds */}
                  <div className="flex items-center justify-between text-[#cbd5e1]">
                    <span className="text-[11px] text-[#64748b]">1xBet Live Market:</span>
                    <span className={item.oneX ? "text-[#10b981] font-bold" : "text-[#64748b]"}>
                      {item.oneX !== undefined ? item.oneX.toFixed(2) : "(Belum Scan)"}
                    </span>
                  </div>

                  {/* Dislocation Delta Metric */}
                  <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between">
                    <span className="text-[10px] text-[#94a3b8] uppercase">Dislocation Delta:</span>
                    {delta !== null ? (
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${
                          isPositive
                            ? "bg-[#06281e] text-[#10b981] border border-[#134e3a]"
                            : "bg-[#2a0a11] text-[#f43f5e] border border-[#5b1322]"
                        }`}
                      >
                        {isPositive ? `+${delta.toFixed(1)}% Edge` : `${delta.toFixed(1)}% Disadv`}
                      </span>
                    ) : (
                      <span className="text-[10px] text-[#64748b]">-</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Smart Money Movement Bar */}
        {bursaPasar?.pergerakan_smart_money && (
          <div className="p-3 rounded-lg bg-[#0d1017] border border-white/[0.06] flex items-start gap-2.5 text-xs">
            <TrendingUpIcon size={14} className="text-[#10b981] shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="text-[10px] font-mono text-[#10b981] font-bold uppercase tracking-wider block">
                Aliran Likuiditas Smart Money
              </span>
              <p className="text-[#cbd5e1] leading-relaxed">
                {bursaPasar.pergerakan_smart_money}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
