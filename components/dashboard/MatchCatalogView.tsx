"use client";

import React from "react";
import { AlertCircleIcon } from "@/components/icons";
import { MatchItem } from "./types";
import { formatWib, formatKickoffTime } from "./utils";

interface MatchCatalogViewProps {
  matches: MatchItem[];
  loading: boolean;
  error: string | null;
  onSelectMatch: (match: MatchItem) => void;
  onRetry: () => void;
  hours: number;
  hasSearchQuery: boolean;
}

export function MatchCatalogView({
  matches,
  loading,
  error,
  onSelectMatch,
  onRetry,
  hours,
  hasSearchQuery,
}: MatchCatalogViewProps) {
  return (
    <section className="space-y-6">
      {/* Page Title & Intro */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl">⚽</span>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#f0f6fc]">
            Database Pertandingan Terjadwal
          </h1>
        </div>
        <p className="text-xs text-[#8b949e] leading-relaxed max-w-3xl">
          Pusat telemetri pra-laga deterministik TheStatsAPI terintegrasi penalaran kuantitatif AI.
          Pilih pertandingan untuk membuka analisis probabilitas Dixon-Coles, alokasi Kelly, dan konsensus mahkamah arbitrase.
        </p>
      </div>

      {/* Loading Skeleton */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="flat-card-static p-4 animate-pulse space-y-3"
            >
              <div className="flex justify-between items-center">
                <div className="h-4 bg-[#21262d] rounded w-24" />
                <div className="h-3 bg-[#21262d] rounded w-12" />
              </div>
              <div className="space-y-2 py-2">
                <div className="h-4 bg-[#21262d] rounded w-3/4" />
                <div className="h-4 bg-[#21262d] rounded w-2/3" />
              </div>
              <div className="h-3 bg-[#21262d] rounded w-1/2" />
            </div>
          ))}
        </div>
      )}

      {/* Error Callout */}
      {error && !loading && (
        <div className="flat-callout border-[#542022] bg-[#241315] text-[#f87171]">
          <div className="flex items-start gap-2.5">
            <AlertCircleIcon size={16} className="shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-xs text-[#f87171]">Gagal Mengambil Data Pertandingan</h3>
              <p className="text-[11px] text-[#fca5a5] mt-0.5">{error}</p>
              <button
                onClick={onRetry}
                className="mt-2.5 px-3 py-1 rounded bg-[#381e20] hover:bg-[#4a282b] text-xs font-medium text-white transition-colors"
              >
                Coba Lagi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && matches.length === 0 && (
        <div className="flat-callout text-center py-12 text-xs text-[#8b949e]">
          Tidak ada pertandingan terjadwal dalam rentang {hours} jam ke depan
          {hasSearchQuery ? " yang sesuai dengan kriteria pencarian." : "."}
        </div>
      )}

      {/* Modern Flat Match Cards Grid */}
      {!loading && !error && matches.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {matches.map((m) => (
            <article
              key={m.id}
              className="flat-card p-4 flex flex-col justify-between cursor-pointer group"
              onClick={() => onSelectMatch(m)}
            >
              <div>
                {/* Card Top: Competition & Kickoff */}
                <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-[#2d3748]">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono flat-tag-blue truncate max-w-[70%]">
                    {m.competition_name}
                  </span>
                  <span className="text-[10px] font-mono text-[#8b949e] shrink-0 font-medium">
                    {formatKickoffTime(m.utc_date)}
                  </span>
                </div>

                {/* Teams Title */}
                <div className="py-3.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-sm text-[#f0f6fc] group-hover:text-[#38bdf8] transition-colors truncate">
                      {m.home_team.name}
                    </h3>
                    <span className="text-[10px] font-mono text-[#8b949e]">H</span>
                  </div>
                  <div className="text-[11px] text-[#64748b] font-mono">vs</div>
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-sm text-[#f0f6fc] group-hover:text-[#38bdf8] transition-colors truncate">
                      {m.away_team.name}
                    </h3>
                    <span className="text-[10px] font-mono text-[#8b949e]">A</span>
                  </div>
                </div>

                {/* Date & Venue */}
                <div className="text-[11px] text-[#8b949e] space-y-0.5 pb-2">
                  <p className="font-mono text-[10px] text-[#cbd5e1]">{formatWib(m.utc_date)}</p>
                  {m.venue && (
                    <p className="truncate text-[10px] text-[#8b949e]">
                      📍 {m.venue.name}, {m.venue.city}
                    </p>
                  )}
                </div>
              </div>

              {/* Card Footer: Data Indicators & Action */}
              <div className="pt-2.5 border-t border-[#2d3748] flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  {m.odds_available && (
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-mono flat-tag-green">
                      Odds
                    </span>
                  )}
                  {m.xg_available && (
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-mono flat-tag-blue">
                      xG
                    </span>
                  )}
                  {m.shotmap_available && (
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-mono flat-tag-purple">
                      Shotmap
                    </span>
                  )}
                </div>

                <span className="text-xs text-[#8b949e] group-hover:text-[#f0f6fc] font-medium flex items-center gap-1 transition-colors">
                  <span>Analisis</span>
                  <span>→</span>
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
