"use client";

import React, { useMemo } from "react";
import { QuantEngineData, BettingResult1xBet } from "./types";
import type { Market1xBetV2 } from "@/lib/1xbet";
import { TrendingUpIcon, RefreshCwIcon, ArrowUpRightIcon, CoinsIcon } from "@/components/icons";

interface OddsDislocationBarProps {
  odds?: {
    dislocation: {
      ringkasan_1x2: string;
      asian_handicap?: string | null;
      over_under?: string | null;
      btts?: string | null;
      benchmarks?: { home?: number; draw?: number; away?: number; source?: string } | null;
      pasar_konsensus?: { kandang: number; seri: number; tandang: number } | null;
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
  quantData?: Pick<QuantEngineData, "dixon_coles" | "vig_stripping">;
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
  // Normalisasi data dari odds view atau fallback bursaPasar — tanpa karangan.
  const market1x2 = odds?.dislocation?.ringkasan_1x2 || bursaPasar?.ringkasan_1x2 || null;
  const marketAH = odds?.dislocation?.asian_handicap || bursaPasar?.asian_handicap || null;
  const marketOU = odds?.dislocation?.over_under || bursaPasar?.over_under || null;
  const marketBTTS = odds?.dislocation?.btts || bursaPasar?.btts || null;
  const smartMoneyText = odds?.smart_money || bursaPasar?.pergerakan_smart_money || null;

  // Parsing atau penentuan odds consensus benchmark (TheStatsAPI/Bet365)
  const benchmarkOdds = useMemo(() => {
    if (odds?.dislocation?.benchmarks) {
      return odds.dislocation.benchmarks;
    }

    const text = market1x2 ?? "";
    const matches = text.match(/(\d+\.\d{2})/g);
    if (matches && matches.length >= 3) {
      return {
        home: parseFloat(matches[0]),
        draw: parseFloat(matches[1]),
        away: parseFloat(matches[2]),
        source: "TheStatsAPI 1X2",
      };
    }

    // Validasi 3 arah: satu-satunya nilai 0/null bikin 100/x = Infinity → NaN
    if (impliedProb && impliedProb.kandang > 0 && impliedProb.seri > 0 && impliedProb.tandang > 0) {
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

  // Odds 1xBet hasil scan manual (hanya ada setelah pindai)
  const oneXBetOdds = useMemo(() => {
    if (bettingResult?.sample_markets && Array.isArray(bettingResult.sample_markets)) {
      const m1x2 = bettingResult.sample_markets.find(
        (m: Market1xBetV2) =>
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
      const h = m1x2.find((p: Market1xBetV2) => p.name?.includes("1"));
      const d = m1x2.find((p: Market1xBetV2) => p.name?.includes("X"));
      const a = m1x2.find((p: Market1xBetV2) => p.name?.includes("2"));
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
    <div className="p-5 sm:p-6 rounded-[18px] bg-[#14141f] border border-[#262636] space-y-5 text-[#f4f4f6] font-sans text-xs">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <CoinsIcon size={16} className="text-[#f4f4f6]" />
            <h3 className="text-xs sm:text-sm font-bold text-[#f4f4f6] tracking-tight">
              Bursa Odds, Dislokasi Pasar &amp; Efisiensi Harga
            </h3>
          </div>
          <p className="text-[13px] text-[#a2a2b5] font-sans">
            Kompilasi pasar utama bursa global serta deteksi anomali harga (+EV) terhadap model matematis deterministik.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onTriggerScan && (
            <button
              onClick={onTriggerScan}
              disabled={bettingLoading}
              className="px-3.5 py-1.5 rounded-[18px] bg-[#b8b0ff] hover:bg-[#b8b0ff] text-[#17131f] text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {bettingLoading ? (
                <>
                  <RefreshCwIcon size={12} className="animate-spin" />
                  <span>Sinkronisasi 1xBet...</span>
                </>
              ) : (
                <>
                  <ArrowUpRightIcon size={12} />
                  <span>{oneXBetOdds ? "Perbarui Odds 1xBet" : "Pindai Pasar 1xBet"}</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* 4-GRID SUMMARY PASAR (TERINTEGRASI DARI MARKET ODDS OVERVIEW CARD) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
        <div className="p-3 rounded-[14px] bg-[#1b1b29] border border-[#262636] space-y-1">
          <span className="text-[11px] text-[#a2a2b5] block font-semibold">
            1X2 Match Odds
          </span>
          <p className="text-[#f4f4f6] text-xs font-semibold leading-relaxed tabular-nums">
            {market1x2 ?? <span className="text-[#a2a2b5] font-normal">Data tidak tersedia</span>}
          </p>
        </div>

        <div className="p-3 rounded-[14px] bg-[#1b1b29] border border-[#262636] space-y-1">
          <span className="text-[11px] text-[#a2a2b5] block font-semibold">
            Asian Handicap
          </span>
          <p className="text-[#f4f4f6] text-xs font-semibold leading-relaxed tabular-nums">
            {marketAH ?? <span className="text-[#a2a2b5] font-normal">Data tidak tersedia</span>}
          </p>
        </div>

        <div className="p-3 rounded-[14px] bg-[#1b1b29] border border-[#262636] space-y-1">
          <span className="text-[11px] text-[#a2a2b5] block font-semibold">
            Total Goals (O/U)
          </span>
          <p className="text-[#f4f4f6] text-xs font-semibold leading-relaxed tabular-nums">
            {marketOU ?? <span className="text-[#a2a2b5] font-normal">Data tidak tersedia</span>}
          </p>
        </div>

        <div className="p-3 rounded-[14px] bg-[#1b1b29] border border-[#262636] space-y-1">
          <span className="text-[11px] text-[#a2a2b5] block font-semibold">
            BTTS (Kedua Tim Gol)
          </span>
          <p className="text-[#f4f4f6] text-xs font-semibold leading-relaxed tabular-nums">
            {marketBTTS ?? <span className="text-[#a2a2b5] font-normal">Data tidak tersedia</span>}
          </p>
        </div>
      </div>

      {/* Odds Comparison Tri-Panel */}
      <div className="space-y-2">
        <span className="text-[11px] text-[#a2a2b5] block font-semibold">
          Evaluasi Dislokasi 1X2 (Model Fair vs Bursa Anchor):
        </span>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {outcomes.map((item) => {
            const activeBookieOdds = item.oneX || item.bench;
            const delta = calculateDislocation(activeBookieOdds, item.fair);
            const isPositive = delta !== null && delta > 0;

            return (
              <div
                key={item.key}
                className="p-4 rounded-[18px] bg-[#1b1b29] border border-[#262636] space-y-3"
              >
                <div className="flex items-center justify-between pb-1">
                  <div>
                    <span className="text-[11px] text-[#a2a2b5] block font-sans">
                      Pilihan {item.label}
                    </span>
                    <strong className="text-xs font-bold text-[#f4f4f6] block truncate max-w-[170px]">
                      {item.team}
                    </strong>
                  </div>
                  {item.prob != null && Number.isFinite(item.prob) && (
                    <span className="px-2 py-0.5 rounded-[12px] text-[11px] font-bold flat-tag-zinc tabular-nums">
                      {(item.prob * 100).toFixed(0)}%
                    </span>
                  )}
                </div>

                <div className="space-y-1.5 text-xs tabular-nums">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[#a2a2b5]">Dixon-Coles Fair:</span>
                    <strong className="text-[#f4f4f6]">
                      {item.fair != null ? item.fair.toFixed(2) : "-"}
                    </strong>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[#a2a2b5]">TheStatsAPI (Anchor):</span>
                    <span className="text-[#f4f4f6] font-medium">
                      {item.bench != null ? item.bench.toFixed(2) : "-"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[#a2a2b5]">1xBet (Pindai Manual):</span>
                    <span className={item.oneX ? "text-[#f4f4f6] font-bold" : "text-[#a2a2b5]"}>
                      {item.oneX != null ? item.oneX.toFixed(2) : "(Belum Scan)"}
                    </span>
                  </div>

                  <div className="pt-1 flex items-center justify-between">
                    <span className="text-[11px] text-[#a2a2b5]">Dislocation Delta:</span>
                    {delta !== null ? (
                      <span
                        className={`px-2 py-0.5 rounded-[14px] text-[11px] font-bold ${
                          isPositive
                            ? "bg-[#34d399]/10 text-[#34d399] border border-[#34d399]/30"
                            : "bg-[#fb7185]/10 text-[#fb7185] border border-[#fb7185]/30"
                        }`}
                      >
                        {isPositive ? `+${delta.toFixed(1)}% Edge` : `${delta.toFixed(1)}% Disadv`}
                      </span>
                    ) : (
                      <span className="text-[11px] text-[#a2a2b5]">-</span>
                    )}
                  </div>

                  {/* Bar horizontal model vs pasar (skala dari data nyata) */}
                  {item.fair != null && activeBookieOdds != null && (() => {
                    const scale = Math.max(item.fair, activeBookieOdds);
                    if (!Number.isFinite(scale) || scale <= 0) return null;
                    return (
                      <div className="space-y-1 pt-0.5 tabular-nums" aria-hidden="true">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-[#a2a2b5] w-8 shrink-0">Fair</span>
                          <div className="h-1.5 flex-1 rounded-full bg-[#14141f] overflow-hidden">
                            <div style={{ width: `${(item.fair / scale) * 100}%` }} className="h-full bg-[#b8b0ff]" />
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-[#a2a2b5] w-8 shrink-0">Bursa</span>
                          <div className="h-1.5 flex-1 rounded-full bg-[#14141f] overflow-hidden">
                            <div
                              style={{ width: `${(activeBookieOdds / scale) * 100}%` }}
                              className={`h-full ${isPositive ? "bg-[#34d399]" : "bg-[#fb7185]"}`}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Smart Money Movement Bar */}
      {smartMoneyText && (
        <div className="p-4 rounded-[16px] bg-[#1b1b29] border border-[#262636] flex items-start gap-2.5 text-xs">
          <TrendingUpIcon size={15} className="text-[#f4f4f6] shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="text-[11px] text-[#f4f4f6] font-bold block">
              Aliran Likuiditas Smart Money &amp; Pergerakan Line Bursa
            </span>
            <p className="text-[#a2a2b5] leading-relaxed font-sans text-[13px]">
              {smartMoneyText}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
