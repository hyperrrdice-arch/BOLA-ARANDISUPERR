"use client";

import React from "react";
import { TrendingUpIcon, CoinsIcon } from "@/components/icons";
import { Analisis } from "./types";

interface MarketOddsOverviewCardProps {
  bursaPasar: Analisis["bursa_pasar"];
  vigMargin?: number;
}

export function MarketOddsOverviewCard({
  bursaPasar,
  vigMargin,
}: MarketOddsOverviewCardProps) {
  return (
    <div className="doppel-shell">
      <div className="doppel-core space-y-4">
        <div className="flex items-center justify-between pb-2.5 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <CoinsIcon size={14} className="text-[#06b6d4]" />
            <h4 className="text-xs sm:text-sm font-bold text-[#f8fafc] font-mono tracking-tight uppercase">
              Matriks Bursa Pasar &amp; Pergerakan Line Odds
            </h4>
          </div>
          <div className="flex items-center gap-2">
            {vigMargin !== undefined && (
              <span className="px-2 py-0.5 rounded text-[10px] font-mono flat-tag-green tabular-nums">
                Margin: {vigMargin.toFixed(1)}%
              </span>
            )}
            <span className="text-[10px] font-mono text-[#64748b] uppercase">TheStatsAPI Consensus</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs font-mono">
          <div className="p-3 rounded-lg bg-[#0f131a] border border-white/[0.06] space-y-1">
            <span className="text-[10px] text-[#10b981] uppercase block font-semibold">
              1X2 Match Odds
            </span>
            <p className="text-[#f8fafc] text-xs leading-relaxed tabular-nums">
              {bursaPasar.ringkasan_1x2}
            </p>
          </div>

          <div className="p-3 rounded-lg bg-[#0f131a] border border-white/[0.06] space-y-1">
            <span className="text-[10px] text-[#06b6d4] uppercase block font-semibold">
              Asian Handicap
            </span>
            <p className="text-[#f8fafc] text-xs leading-relaxed tabular-nums">
              {bursaPasar.asian_handicap || "Seimbang (AH 0.0)"}
            </p>
          </div>

          <div className="p-3 rounded-lg bg-[#0f131a] border border-white/[0.06] space-y-1">
            <span className="text-[10px] text-[#f59e0b] uppercase block font-semibold">
              Total Goals (O/U)
            </span>
            <p className="text-[#f8fafc] text-xs leading-relaxed tabular-nums">
              {bursaPasar.over_under || "Line Aktif (2.5)"}
            </p>
          </div>

          <div className="p-3 rounded-lg bg-[#0f131a] border border-white/[0.06] space-y-1">
            <span className="text-[10px] text-[#818cf8] uppercase block font-semibold">
              Both Teams To Score (BTTS)
            </span>
            <p className="text-[#f8fafc] text-xs leading-relaxed tabular-nums">
              {bursaPasar.btts || "Tersedia"}
            </p>
          </div>
        </div>

        {/* Smart Money Callout */}
        {bursaPasar.pergerakan_smart_money && (
          <div className="p-3 rounded-lg bg-[#0f131a] border border-[#134e3a] flex items-start gap-2.5">
            <TrendingUpIcon size={14} className="text-[#10b981] shrink-0 mt-0.5" />
            <div className="space-y-0.5 text-xs">
              <h5 className="font-bold text-[#f8fafc] font-mono uppercase text-[11px] tracking-wider">
                Analisis Aliran Dana &amp; Smart Money Movement
              </h5>
              <p className="text-[#cbd5e1] leading-relaxed font-mono text-[11px]">
                {bursaPasar.pergerakan_smart_money}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
