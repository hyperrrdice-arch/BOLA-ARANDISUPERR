"use client";

import React from "react";
import { MatchItem } from "./types";
import { formatKickoffTime } from "./utils";
import { RadioIcon } from "@/components/icons";

interface MatchTickerStripProps {
  matches: MatchItem[];
  selectedMatchId: string | null;
  onSelectMatch: (match: MatchItem) => void;
  loading: boolean;
}

export function MatchTickerStrip({
  matches,
  selectedMatchId,
  onSelectMatch,
  loading,
}: MatchTickerStripProps) {
  if (loading) {
    return (
      <div className="w-full bg-[#0a0d13] border-b border-white/[0.06] py-2 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto flex items-center gap-3 overflow-hidden animate-pulse">
          <div className="flex items-center gap-1.5 text-[11px] text-[#64748b] font-mono shrink-0">
            <span className="w-2 h-2 rounded-full bg-[#334155]" />
            <span>Memuat Jadwal...</span>
          </div>
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-7 w-44 rounded-md bg-[#141a24] shrink-0 border border-white/[0.04]"
            />
          ))}
        </div>
      </div>
    );
  }

  if (matches.length === 0) {
    return null;
  }

  return (
    <div className="w-full bg-[#0a0d13] border-b border-white/[0.06] py-2 px-4 sm:px-6">
      <div className="max-w-7xl mx-auto flex items-center gap-2 overflow-x-auto scrollbar-thin">
        <div className="flex items-center gap-1.5 text-[10px] text-[#64748b] font-mono uppercase tracking-wider shrink-0 pr-2 border-r border-white/[0.08]">
          <RadioIcon size={12} className="text-[#10b981] animate-pulse" />
          <span className="font-semibold text-[#94a3b8]">Live Ticker</span>
        </div>

        <div className="flex items-center gap-2">
          {matches.map((m) => {
            const isSelected = selectedMatchId === m.id;
            return (
              <button
                key={m.id}
                onClick={() => onSelectMatch(m)}
                className={`group flex items-center gap-2 px-2.5 py-1 rounded-md text-xs font-mono shrink-0 transition-all cursor-pointer border ${
                  isSelected
                    ? "bg-[#14231b] border-[#134e3a] text-[#f8fafc] shadow-[0_0_12px_rgba(16,185,129,0.15)]"
                    : "bg-[#0f131a] hover:bg-[#141a24] border-white/[0.06] hover:border-white/[0.14] text-[#94a3b8] hover:text-[#f8fafc]"
                }`}
                title={`${m.home_team.name} vs ${m.away_team.name} - ${m.competition_name}`}
              >
                <span className="text-[10px] text-[#64748b] tabular-nums">
                  {formatKickoffTime(m.utc_date)}
                </span>
                <span className="text-white/[0.2] font-sans">|</span>
                <span className="font-semibold truncate max-w-[140px] text-[#cbd5e1] group-hover:text-white">
                  {m.home_team.name} <span className="text-[#64748b] font-normal">v</span> {m.away_team.name}
                </span>
                {isSelected && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
