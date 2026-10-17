"use client";

import React, { useRef, useEffect, useState } from "react";
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
  sortBy?: "time" | "name";
  onSortChange?: (sort: "time" | "name") => void;
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
  sortBy = "time",
  onSortChange,
}: FilterToolbarProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [localSearch, setLocalSearch] = useState(searchQuery);

  // Debounced search dispatch (150ms)
  useEffect(() => {
    const handler = setTimeout(() => {
      onSearchChange(localSearch);
    }, 150);
    return () => clearTimeout(handler);
  }, [localSearch, onSearchChange]);

  // Keep local search synced if parent resets it
  useEffect(() => {
    setLocalSearch(searchQuery);
  }, [searchQuery]);

  // Keyboard shortcut listener: '/' or 'Ctrl/Cmd + K' to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") ||
        ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="p-5 rounded-[24px] bg-white border border-[#e5e5e5] space-y-4">
      {/* Top Row: Search Input & Horizon & Sort & Refresh */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search Box with keyboard shortcut chip */}
        <div className="relative flex-1">
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Cari tim atau liga (tekan '/' atau ⌘K)..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="w-full bg-[#f5f5f5] focus:bg-white text-[#0a0a0a] placeholder-[#737373] px-4 py-2 pr-16 rounded-[18px] border border-transparent focus:border-[#e5e5e5] text-[13px] font-mono focus:outline-none transition-colors"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
            {localSearch ? (
              <button
                type="button"
                onClick={() => {
                  setLocalSearch("");
                  onSearchChange("");
                }}
                className="pointer-events-auto text-xs text-[#737373] hover:text-[#0a0a0a] px-1"
              >
                ×
              </button>
            ) : (
              <kbd className="px-1.5 py-0.5 rounded-[6px] bg-white border border-[#e5e5e5] text-[11px] font-mono text-[#737373]">
                /
              </kbd>
            )}
          </div>
        </div>

        {/* Controls: Time Horizon & Sorting & Refresh */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap sm:flex-nowrap">
          {/* Time Horizon Selector */}
          <div className="flex items-center rounded-[18px] border border-[#e5e5e5] bg-[#f5f5f5] p-0.5 text-xs font-mono">
            {[12, 24, 48, 72].map((h) => (
              <button
                key={h}
                onClick={() => onHoursChange(h)}
                className={`px-3 py-1 rounded-[18px] text-xs font-medium transition-colors cursor-pointer ${
                  hours === h
                    ? "bg-[#0a0a0a] text-white font-semibold"
                    : "text-[#737373] hover:text-[#0a0a0a]"
                }`}
              >
                {h}h
              </button>
            ))}
          </div>

          {/* Sort Toggle */}
          {onSortChange && (
            <div className="flex items-center rounded-[18px] border border-[#e5e5e5] bg-[#f5f5f5] p-0.5 text-xs font-mono">
              <button
                onClick={() => onSortChange("time")}
                className={`px-3 py-1 rounded-[18px] text-[11px] transition-colors cursor-pointer ${
                  sortBy === "time"
                    ? "bg-[#0a0a0a] text-white font-semibold"
                    : "text-[#737373] hover:text-[#0a0a0a]"
                }`}
                title="Urutkan berdasarkan Kick-off"
              >
                Waktu
              </button>
              <button
                onClick={() => onSortChange("name")}
                className={`px-3 py-1 rounded-[18px] text-[11px] transition-colors cursor-pointer ${
                  sortBy === "name"
                    ? "bg-[#0a0a0a] text-white font-semibold"
                    : "text-[#737373] hover:text-[#0a0a0a]"
                }`}
                title="Urutkan berdasarkan Nama Tim"
              >
                Tim
              </button>
            </div>
          )}

          {/* Refresh Button */}
          <button
            onClick={onRefresh}
            disabled={loading}
            className="px-3.5 py-1.5 rounded-[18px] bg-[#f5f5f5] hover:bg-[#ebebeb] text-[#0a0a0a] hover:text-black border border-[#e5e5e5] text-xs font-mono font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            title="Muat ulang pertandingan"
          >
            <RefreshCwIcon size={12} className={loading ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* League Filter Pills with fluid selection */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs font-mono scrollbar-thin">
        <button
          onClick={() => onCompetitionChange("ALL")}
          className={`px-3.5 py-1 rounded-[18px] text-xs font-medium shrink-0 transition-colors cursor-pointer border ${
            selectedCompetitionId === "ALL"
              ? "bg-[#0a0a0a] text-white border-[#0a0a0a] font-semibold"
              : "bg-[#f5f5f5] hover:bg-[#ebebeb] text-[#171717] border-[#e5e5e5]"
          }`}
        >
          Semua Liga
        </button>

        {activeLeagues.map((lg) => {
          const isSelected = selectedCompetitionId === lg.id;
          return (
            <button
              key={lg.id}
              onClick={() => onCompetitionChange(lg.id)}
              className={`px-3.5 py-1 rounded-[18px] text-xs font-medium shrink-0 flex items-center gap-1.5 transition-colors cursor-pointer border ${
                isSelected
                  ? "bg-[#0a0a0a] text-white border-[#0a0a0a] font-semibold"
                  : "bg-[#f5f5f5] hover:bg-[#ebebeb] text-[#171717] border-[#e5e5e5]"
              }`}
            >
              <span>{lg.name}</span>
              <span
                className={`px-1.5 py-0.5 rounded-[18px] text-[11px] font-mono tabular-nums ${
                  isSelected
                    ? "bg-zinc-800 text-white"
                    : "bg-white text-[#0a0a0a] border border-[#e5e5e5]"
                }`}
              >
                {lg.count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
