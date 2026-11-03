"use client";

import React, { useRef, useEffect, useState } from "react";
import { RefreshCwIcon } from "@/components/icons";

interface FilterToolbarProps {
  hours: number;
  onHoursChange: (hours: number) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedCompetitionId: string;
  onCompetitionChange: (compId: string) => void;
  activeLeagues: Array<{ id: string; name: string; count: number }>;
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
  loading,
  onRefresh,
  sortBy = "time",
  onSortChange,
}: FilterToolbarProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [localSearch, setLocalSearch] = useState(searchQuery);
  // Sinkron jika parent reset prop (mis. ganti liga) — pola React: adjust saat render, bukan effect
  const [prevSearchQuery, setPrevSearchQuery] = useState(searchQuery);
  if (searchQuery !== prevSearchQuery) {
    setPrevSearchQuery(searchQuery);
    setLocalSearch(searchQuery);
  }

  // Debounced search dispatch (150ms)
  useEffect(() => {
    const handler = setTimeout(() => {
      onSearchChange(localSearch);
    }, 150);
    return () => clearTimeout(handler);
  }, [localSearch, onSearchChange]);

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
    <div className="p-5 rounded-[18px] bg-[#14141f] border border-[#262636] space-y-4">
      {/* Top Row: Search Input & Horizon & Sort & Refresh */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search Box with keyboard shortcut chip */}
        <div className="relative flex-1">
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Cari tim atau liga (tekan '/' atau ⌘K)..." aria-label="Cari tim atau liga"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="w-full bg-[#1b1b29] focus:bg-[#14141f] text-[#f4f4f6] placeholder-[#a2a2b5] px-4 py-2 pr-16 rounded-[18px] border border-transparent focus:border-[#262636] text-[13px] font-sans focus:outline-none transition-colors"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
            {localSearch ? (
              <button
                type="button"
                aria-label="Hapus pencarian"
                onClick={() => {
                  setLocalSearch("");
                  onSearchChange("");
                }}
                className="pointer-events-auto text-xs text-[#a2a2b5] hover:text-[#f4f4f6] px-1"
              >
                ×
              </button>
            ) : (
              <kbd className="px-1.5 py-0.5 rounded-[6px] bg-[#14141f] border border-[#262636] text-[11px] font-sans text-[#a2a2b5]">
                /
              </kbd>
            )}
          </div>
        </div>

        {/* Controls: Time Horizon & Sorting & Refresh */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap sm:flex-nowrap">
          {/* Time Horizon Selector */}
          <div className="flex items-center rounded-[18px] border border-[#262636] bg-[#1b1b29] p-0.5 text-xs font-sans">
            {[12, 24, 48, 72].map((h) => (
              <button
                key={h}
                onClick={() => onHoursChange(h)}
                className={`px-3 py-1 rounded-[18px] text-xs font-medium transition-colors cursor-pointer ${
                  hours === h
                    ? "bg-[#b8b0ff] text-[#17131f] font-semibold"
                    : "text-[#a2a2b5] hover:text-[#f4f4f6]"
                }`}
              >
                {h}h
              </button>
            ))}
          </div>

          {/* Sort Toggle */}
          {onSortChange && (
            <div className="flex items-center rounded-[18px] border border-[#262636] bg-[#1b1b29] p-0.5 text-xs font-sans">
              <button
                onClick={() => onSortChange("time")}
                className={`px-3 py-1 rounded-[18px] text-[11px] transition-colors cursor-pointer ${
                  sortBy === "time"
                    ? "bg-[#b8b0ff] text-[#17131f] font-semibold"
                    : "text-[#a2a2b5] hover:text-[#f4f4f6]"
                }`}
                title="Urutkan berdasarkan Kick-off"
              >
                Waktu
              </button>
              <button
                onClick={() => onSortChange("name")}
                className={`px-3 py-1 rounded-[18px] text-[11px] transition-colors cursor-pointer ${
                  sortBy === "name"
                    ? "bg-[#b8b0ff] text-[#17131f] font-semibold"
                    : "text-[#a2a2b5] hover:text-[#f4f4f6]"
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
            className="px-3.5 py-1.5 rounded-[18px] bg-[#1b1b29] hover:bg-[#232334] text-[#f4f4f6] hover:text-[#f4f4f6] border border-[#262636] text-xs font-sans font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            title="Muat ulang pertandingan"
          >
            <RefreshCwIcon size={12} className={loading ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* League Filter Pills — mobile saja; desktop pakai sidebar liga */}
      <div className="flex lg:hidden items-center gap-1.5 overflow-x-auto pb-1 text-xs font-sans scrollbar-thin">
        <button
          onClick={() => onCompetitionChange("ALL")}
          className={`px-3.5 py-1 rounded-[18px] text-xs font-medium shrink-0 transition-colors cursor-pointer border ${
            selectedCompetitionId === "ALL"
              ? "bg-[#b8b0ff] text-[#17131f] border-[#b8b0ff] font-semibold"
              : "bg-[#1b1b29] hover:bg-[#232334] text-[#e8e8ef] border-[#262636]"
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
                  ? "bg-[#b8b0ff] text-[#17131f] border-[#b8b0ff] font-semibold"
                  : "bg-[#1b1b29] hover:bg-[#232334] text-[#e8e8ef] border-[#262636]"
              }`}
            >
              <span>{lg.name}</span>
              <span
                className={`px-1.5 py-0.5 rounded-[18px] text-[11px] font-sans tabular-nums ${
                  isSelected
                    ? "bg-zinc-800 text-white"
                    : "bg-[#14141f] text-[#f4f4f6] border border-[#262636]"
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
