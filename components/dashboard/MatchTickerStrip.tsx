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
      <div className="w-full bg-[#ffffff] border-b border-[#e5e5e5] py-2 px-4 sm:px-6">
        <div className="max-w-[1280px] mx-auto flex items-center gap-3 overflow-hidden animate-pulse">
          <div className="flex items-center gap-1.5 text-[11px] text-[#737373] font-mono shrink-0">
            <span className="w-2 h-2 rounded-full bg-[#d4d4d8]" />
            <span>Memuat Jadwal...</span>
          </div>
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-7 w-44 rounded-[18px] bg-[#f5f5f5] shrink-0 border border-[#e5e5e5]"
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
    <div className="w-full bg-[#ffffff] border-b border-[#e5e5e5] py-2 px-4 sm:px-6">
      <div className="max-w-[1280px] mx-auto flex items-center gap-2 overflow-x-auto scrollbar-thin">
        <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider shrink-0 pr-2 border-r border-[#e5e5e5]">
          <RadioIcon size={12} className="text-[#0a0a0a] animate-pulse" />
          <span className="font-semibold text-[#171717]">Live Ticker</span>
        </div>

        <div className="flex items-center gap-2">
          {matches.map((m) => {
            const isSelected = selectedMatchId === m.id;
            return (
              <button
                key={m.id}
                onClick={() => onSelectMatch(m)}
                className={`group flex items-center gap-2 px-3 py-1 rounded-[18px] text-xs font-mono shrink-0 transition-colors cursor-pointer border ${
                  isSelected
                    ? "bg-[#0a0a0a] border-[#0a0a0a] text-white"
                    : "bg-[#f5f5f5] hover:bg-[#ebebeb] border-[#e5e5e5] text-[#171717]"
                }`}
                title={`${m.home_team.name} vs ${m.away_team.name} - ${m.competition_name}`}
              >
                <span className={`text-[10px] tabular-nums ${isSelected ? "text-zinc-300" : "text-[#737373]"}`}>
                  {formatKickoffTime(m.utc_date)}
                </span>
                <span className={isSelected ? "text-zinc-600" : "text-[#e5e5e5]"}>|</span>
                <span className={`font-medium truncate max-w-[140px] ${isSelected ? "text-white" : "text-[#0a0a0a]"}`}>
                  {m.home_team.name} <span className={isSelected ? "text-zinc-400" : "text-[#737373]"}>v</span> {m.away_team.name}
                </span>
                {isSelected && (
                  <span className="w-1.5 h-1.5 rounded-full bg-white shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
