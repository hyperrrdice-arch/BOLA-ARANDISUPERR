"use client";

import React from "react";
import { TrendingUpIcon } from "@/components/icons";
import { Analisis } from "./types";

interface MarketOddsOverviewCardProps {
  bursaPasar: Analisis["bursa_pasar"];
}

export function MarketOddsOverviewCard({ bursaPasar }: MarketOddsOverviewCardProps) {
  return (
    <div className="flat-card-static p-4 sm:p-5 space-y-4">
      <div className="flex items-center justify-between pb-2.5 border-b border-[#2d3748]">
        <h4 className="text-xs sm:text-sm font-bold text-[#f0f6fc]">
          Matriks Bursa Pasar &amp; Pergerakan Line Odds
        </h4>
        <span className="text-[10px] font-mono text-[#8b949e]">TheStatsAPI Consensus</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
        <div className="p-3 rounded-md bg-[#0d1117] border border-[#2d3748] space-y-1">
          <span className="text-[10px] font-mono text-[#22c55e] uppercase block font-semibold">
            1X2 Match Odds
          </span>
          <p className="text-[#f0f6fc] text-xs leading-relaxed">{bursaPasar.ringkasan_1x2}</p>
        </div>

        <div className="p-3 rounded-md bg-[#0d1117] border border-[#2d3748] space-y-1">
          <span className="text-[10px] font-mono text-[#38bdf8] uppercase block font-semibold">
            Asian Handicap
          </span>
          <p className="text-[#f0f6fc] text-xs leading-relaxed">
            {bursaPasar.asian_handicap || "Seimbang"}
          </p>
        </div>

        <div className="p-3 rounded-md bg-[#0d1117] border border-[#2d3748] space-y-1">
          <span className="text-[10px] font-mono text-[#fbbf24] uppercase block font-semibold">
            Total Goals (O/U)
          </span>
          <p className="text-[#f0f6fc] text-xs leading-relaxed">
            {bursaPasar.over_under || "Pasar O/U Aktif"}
          </p>
        </div>

        <div className="p-3 rounded-md bg-[#0d1117] border border-[#2d3748] space-y-1">
          <span className="text-[10px] font-mono text-[#818cf8] uppercase block font-semibold">
            Both Teams To Score (BTTS)
          </span>
          <p className="text-[#f0f6fc] text-xs leading-relaxed">
            {bursaPasar.btts || "Tersedia"}
          </p>
        </div>
      </div>

      {/* Smart Money Callout */}
      {bursaPasar.pergerakan_smart_money && (
        <div className="p-3.5 rounded-md bg-[#0d1117] border border-[#1e4a32] flex items-start gap-3">
          <TrendingUpIcon size={16} className="text-[#22c55e] shrink-0 mt-0.5" />
          <div className="space-y-0.5 text-xs">
            <h5 className="font-bold text-[#f0f6fc]">
              Analisis Aliran Dana &amp; Smart Money Movement
            </h5>
            <p className="text-[#cbd5e1] leading-relaxed">
              {bursaPasar.pergerakan_smart_money}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
