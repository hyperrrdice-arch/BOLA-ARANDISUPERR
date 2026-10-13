"use client";

import React from "react";
import { RefreshCwIcon } from "@/components/icons";
import { CacheMetrics } from "./types";

interface FilterToolbarProps {
  hours: number;
  onHoursChange: (hours: number) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedCompetitionId: string;
  onCompetitionChange: (compId: string) => void;
  activeLeagues: Array<{ id: string; name: string; count: number }>;
  cacheMetrics: CacheMetrics | null;
  loading: boolean;
  onRefresh: () => void;
}

export function FilterToolbar({
  hours,
  onHoursChange,
  searchQuery,
  onSearchChange,
  selectedCompetitionId,
  onCompetitionChange,
  activeLeagues,
  cacheMetrics,
  loading,
  onRefresh,
}: FilterToolbarProps) {
  return (
    <div className="flat-card-static p-4 space-y-4">
      {/* Top Row: Search Input & Time Window Switcher & Refresh */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search Box */}
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Cari tim atau kompetisi (cth: Arsenal, Real Madrid, Premier League)..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full bg-[#0d1117] text-[#f0f6fc] placeholder-[#8b949e] px-3.5 py-2 rounded-md border border-[#2d3748] text-xs focus:outline-none focus:border-[#3b82f6] transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[#8b949e] hover:text-[#f0f6fc]"
            >
              ✕
            </button>
          )}
        </div>

        {/* Time Horizon Buttons & Refresh */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center rounded-md border border-[#2d3748] bg-[#0d1117] p-0.5 text-xs">
            {[12, 24, 48].map((h) => (
              <button
                key={h}
                onClick={() => onHoursChange(h)}
                className={`px-3 py-1.5 rounded font-mono text-xs font-medium transition-colors ${
                  hours === h
                    ? "bg-[#21262d] text-[#f0f6fc]"
                    : "text-[#8b949e] hover:text-[#f0f6fc]"
                }`}
              >
                {h}h
              </button>
            ))}
          </div>

          <button
            onClick={onRefresh}
            disabled={loading}
            className="px-3 py-2 rounded-md bg-[#21262d] hover:bg-[#30363d] text-[#cbd5e1] border border-[#2d3748] text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50"
            title="Muat ulang pertandingan"
          >
            <RefreshCwIcon size={13} className={loading ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* League Filter Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
        <button
          onClick={() => onCompetitionChange("ALL")}
          className={`px-3 py-1.5 rounded-md font-medium shrink-0 transition-colors ${
            selectedCompetitionId === "ALL"
              ? "bg-[#2563eb] text-white"
              : "bg-[#21262d] text-[#8b949e] hover:text-[#f0f6fc] border border-[#2d3748]"
          }`}
        >
          Semua Liga
        </button>

        {activeLeagues.map((lg) => (
          <button
            key={lg.id}
            onClick={() => onCompetitionChange(lg.id)}
            className={`px-3 py-1.5 rounded-md font-medium shrink-0 flex items-center gap-1.5 transition-colors ${
              selectedCompetitionId === lg.id
                ? "bg-[#2563eb] text-white"
                : "bg-[#21262d] text-[#8b949e] hover:text-[#f0f6fc] border border-[#2d3748]"
            }`}
          >
            <span>{lg.name}</span>
            <span className="px-1.5 py-0.2 rounded bg-[#161b22] text-[10px] font-mono">
              {lg.count}
            </span>
          </button>
        ))}
      </div>

      {/* Bottom Telemetry & Cache Metrics Bar */}
      {cacheMetrics && (
        <div className="pt-2.5 border-t border-[#2d3748] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[#8b949e]">
          <div className="flex items-center gap-3">
            <span>
              Cache Hits: <strong className="text-[#22c55e]">{cacheMetrics.hits}</strong>
            </span>
            <span>•</span>
            <span>
              Misses: <strong className="text-[#cbd5e1]">{cacheMetrics.misses}</strong>
            </span>
            <span>•</span>
            <span>
              Total Entri: <strong className="text-[#38bdf8]">{cacheMetrics.totalEntries}</strong>
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-[#22c55e]">
            <span>⚡ API Calls Dihemat:</span>
            <strong>{cacheMetrics.savedCalls}</strong>
          </div>
        </div>
      )}
    </div>
  );
}
