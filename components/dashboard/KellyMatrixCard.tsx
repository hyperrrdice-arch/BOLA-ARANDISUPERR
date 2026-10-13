"use client";

import React from "react";
import { ValueBetItem } from "./types";

interface KellyMatrixCardProps {
  valueBets: ValueBetItem[];
}

export function KellyMatrixCard({ valueBets }: KellyMatrixCardProps) {
  const positiveBets = valueBets.filter((vb) => vb.is_positive_ev);

  return (
    <div className="flat-card-static p-4 sm:p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#2d3748]">
        <div className="flex items-center gap-2">
          <span className="text-base">💰</span>
          <h4 className="font-bold text-xs sm:text-sm text-[#f0f6fc]">
            Sinyal Expected Value (+EV) &amp; Kelly Sizing
          </h4>
        </div>
        <span className="text-[10px] font-mono text-[#8b949e]">
          Fractional Kelly Criterion (1/4 Sizing)
        </span>
      </div>

      {positiveBets.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {positiveBets.map((vb, i) => (
            <div
              key={i}
              className="p-3 rounded-md bg-[#0d1117] border border-[#1e4a32] space-y-2 text-xs font-mono"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-[#f0f6fc] truncate">{vb.selection}</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold flat-tag-green shrink-0">
                  {vb.ev_percentage} EV
                </span>
              </div>

              <div className="flex items-center justify-between text-[11px] text-[#8b949e] pt-1 border-t border-[#1e4a32]/40">
                <span>Odds: <strong className="text-[#cbd5e1]">{vb.bookmaker_odds.toFixed(2)}</strong></span>
                <span className="text-[#22c55e] font-semibold">
                  Stake: {vb.recommended_stake_percentage}%
                </span>
              </div>

              <p className="text-[10px] text-[#8b949e] leading-snug line-clamp-3">
                {vb.rationale}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-4 rounded-md bg-[#0d1117] border border-[#2d3748] text-center text-xs text-[#8b949e]">
          Tidak ada pasar utama dengan mathematical edge positif (+EV) signifikan pada bursa ini.
          Disarankan menahan diri (*pass/avoid*) untuk menjaga modal.
        </div>
      )}
    </div>
  );
}
