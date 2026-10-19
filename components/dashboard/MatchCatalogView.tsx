"use client";

import React from "react";
import { AlertCircleIcon, ArrowUpRightIcon, RadioIcon } from "@/components/icons";
import { MatchItem } from "./types";
import { formatWib, formatKickoffTime } from "./utils";
import { normalizeTeamName } from "@/lib/quant/team-normalizer";

interface MatchCatalogViewProps {
  matches: MatchItem[];
  loading: boolean;
  error: string | null;
  onSelectMatch: (match: MatchItem) => void;
  onRetry: () => void;
  hours: number;
  hasSearchQuery: boolean;
  offline?: boolean;
  catalogMaxUtc?: string | null;
}

export function MatchCatalogView({
  matches,
  loading,
  error,
  onSelectMatch,
  onRetry,
  hours,
  hasSearchQuery,
  offline,
  catalogMaxUtc,
}: MatchCatalogViewProps) {
  const remainingDays = catalogMaxUtc
    ? Math.max(0, Math.ceil((new Date(catalogMaxUtc).getTime() - Date.now()) / 86_400_000))
    : null;
  return (
    <section className="space-y-5">
      {/* Page Title & Intro */}
      <div className="space-y-1.5 pb-1">
        <div className="flex items-center gap-2">
          <RadioIcon size={16} className="text-[#0a0a0a]" />
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0a0a0a]">
            Database Pertandingan Terjadwal
          </h1>
        </div>
        <p className="text-[13px] text-[#737373] leading-relaxed max-w-3xl font-sans">
          Pusat telemetri pra-laga deterministik TheStatsAPI terintegrasi penalaran kuantitatif AI.
          Pilih pertandingan untuk membuka analisis probabilitas Dixon-Coles, alokasi Kelly, dan konsensus mahkamah arbitrase.
        </p>
      </div>

      {/* Loading Skeleton Shimmer */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="p-5 rounded-[24px] bg-white border border-[#e5e5e5] animate-pulse space-y-3"
            >
              <div className="flex justify-between items-center">
                <div className="h-3.5 bg-[#f5f5f5] rounded w-28" />
                <div className="h-3 bg-[#f5f5f5] rounded w-14" />
              </div>
              <div className="space-y-2 py-3">
                <div className="h-4 bg-[#f5f5f5] rounded w-3/4" />
                <div className="h-4 bg-[#f5f5f5] rounded w-2/3" />
              </div>
              <div className="h-3 bg-[#f5f5f5] rounded w-1/2" />
            </div>
          ))}
        </div>
      )}

      {/* Error Callout */}
      {error && !loading && (
        <div className="p-5 rounded-[24px] border border-[#e7000b]/20 bg-[#e7000b]/5 text-[#0a0a0a] text-xs">
          <div className="flex items-start gap-2.5">
            <AlertCircleIcon size={16} className="shrink-0 mt-0.5 text-[#e7000b]" />
            <div>
              <h3 className="font-semibold text-xs text-[#e7000b]">Gagal Mengambil Data Pertandingan</h3>
              <p className="text-[11px] text-[#737373] mt-0.5">{error}</p>
              <button
                onClick={onRetry}
                className="mt-2.5 px-3.5 py-1.5 rounded-[18px] bg-[#0a0a0a] hover:bg-[#171717] text-xs font-medium text-white transition-colors cursor-pointer"
              >
                Coba Lagi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OFFLINE BANNER — data lokal, ada tanggal kedaluwarsa */}
      {!loading && !error && offline && catalogMaxUtc && (
        <div className="px-4 py-2.5 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] text-[12px] font-mono text-[#737373] flex items-center gap-2">
          <RadioIcon size={13} className="text-[#0a0a0a] shrink-0" />
          <span>
            Data offline s/d {catalogMaxUtc.slice(0, 10)} — sisa {remainingDays} hari. API mati, katalog disajikan dari database lokal.
          </span>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && matches.length === 0 && (
        <div className="p-12 text-center text-[13px] text-[#737373] rounded-[24px] bg-white border border-[#e5e5e5] font-sans">
          {offline
            ? `Katalog lokal habis di rentang ${hours} jam ke depan — bukan error. Coba rentang lebih panjang atau tunggu sinkronisasi berikutnya.`
            : `Tidak ada pertandingan terjadwal dalam rentang ${hours} jam ke depan`}
          {hasSearchQuery ? " yang sesuai dengan kriteria pencarian." : "."}
        </div>
      )}

      {/* Modern Hairline Match Cards Grid with Staggered Entrance */}
      {!loading && !error && matches.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {matches.map((m, index) => {
            const homeName = normalizeTeamName(m.home_team.name);
            const awayName = normalizeTeamName(m.away_team.name);

            return (
              <article
                key={m.id}
                style={{
                  animationDelay: `${Math.min(index * 25, 300)}ms`,
                }}
                className="reveal-up p-5 rounded-[24px] bg-white hover:bg-[#fafafa] border border-[#e5e5e5] hover:border-[#d4d4d8] flex flex-col justify-between cursor-pointer group transition-all"
                onClick={() => onSelectMatch(m)}
              >
                <div>
                  {/* Card Top: Competition & Kickoff */}
                  <div className="flex items-center justify-between gap-2 pb-3">
                    <span className="px-2.5 py-0.5 rounded-[18px] text-[11px] font-mono flat-tag-zinc truncate max-w-[70%] font-semibold">
                      {m.competition_name}
                    </span>
                    <span className="text-[11px] font-mono text-[#737373] shrink-0 font-medium tabular-nums">
                      {formatKickoffTime(m.utc_date)}
                    </span>
                  </div>

                  {/* Teams Title */}
                  <div className="py-3.5 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-sm text-[#0a0a0a] group-hover:text-black transition-colors truncate">
                        {homeName}
                      </h3>
                      <span className="text-[11px] font-mono text-[#737373]">H</span>
                    </div>
                    <div className="text-[11px] text-[#a1a1aa] font-mono">
                      vs
                    </div>
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-sm text-[#0a0a0a] group-hover:text-black transition-colors truncate">
                        {awayName}
                      </h3>
                      <span className="text-[11px] font-mono text-[#737373]">A</span>
                    </div>
                  </div>

                  {/* Date & Venue */}
                  <div className="text-[11px] text-[#737373] space-y-0.5 pb-2 font-mono">
                    <p className="text-[11px] text-[#171717] tabular-nums">{formatWib(m.utc_date)}</p>
                    {m.venue && (
                      <p className="truncate text-[11px] text-[#737373]">
                        Venue: {m.venue.name}, {m.venue.city}
                      </p>
                    )}
                  </div>
                </div>

                {/* Card Footer: Data Indicators & Action */}
                <div className="pt-3 flex items-center justify-between gap-2 text-xs font-mono">
                  <div className="flex items-center gap-1.5">
                    {m.odds_available && (
                      <span className="px-2 py-0.5 rounded-[18px] text-[11px] font-mono flat-tag-white">
                        Odds
                      </span>
                    )}
                    {m.xg_available && (
                      <span className="px-2 py-0.5 rounded-[18px] text-[11px] font-mono flat-tag-zinc">
                        xG
                      </span>
                    )}
                    {m.shotmap_available && (
                      <span className="px-2 py-0.5 rounded-[18px] text-[11px] font-mono flat-tag-zinc">
                        Shotmap
                      </span>
                    )}
                  </div>

                  <span className="text-[11px] text-[#0a0a0a] font-medium flex items-center gap-1 transition-colors">
                    <span>Analisis</span>
                    <ArrowUpRightIcon size={12} className="group-hover:translate-x-0.5 transition-transform" />
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
