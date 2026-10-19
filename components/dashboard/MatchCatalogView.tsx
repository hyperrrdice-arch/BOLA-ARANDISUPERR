"use client";

import React, { useEffect, useState } from "react";
import { AlertCircleIcon, ArrowUpRightIcon, RadioIcon } from "@/components/icons";
import { MatchItem } from "./types";
import { useGsapChildren } from "./motion";
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

/* Live thing katalog: countdown ke kickoff terdekat dari data existing.
   Render hanya setelah mount (hindari hydration mismatch); tanpa JS daftar tetap lengkap. */
function KickoffCountdown({ matches }: { matches: MatchItem[] }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return null;
  const ts = (m: MatchItem) => new Date(m.utc_date).getTime();
  const next = [...matches].sort((a, b) => ts(a) - ts(b)).find((m) => ts(m) > now);
  if (!next) return null;
  const diff = Math.max(0, ts(next) - now);
  const pad = (n: number) => String(n).padStart(2, "0");
  const label = `${pad(Math.floor(diff / 3600000))}:${pad(Math.floor(diff / 60000) % 60)}:${pad(Math.floor(diff / 1000) % 60)}`;
  return (
    <p className="text-xs text-[#a2a2b5] font-sans tabular-nums flex items-center gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-[#34d399] shrink-0" aria-hidden="true" />
      <span>
        Kickoff terdekat: {normalizeTeamName(next.home_team.name)} vs {normalizeTeamName(next.away_team.name)} dalam {label}
      </span>
    </p>
  );
}

export function MatchCatalogView({  matches,
  loading,
  error,
  onSelectMatch,
  onRetry,
  hours,
  hasSearchQuery,
  offline,
  catalogMaxUtc,
}: MatchCatalogViewProps) {
  const gridRef = useGsapChildren<HTMLDivElement>([matches.length, loading]);
  const remainingDays = catalogMaxUtc
    ? Math.max(0, Math.ceil((new Date(catalogMaxUtc).getTime() - Date.now()) / 86_400_000))
    : null;
  return (
    <section className="space-y-5">
      {/* Page Title & Intro */}
      <div className="space-y-1.5 pb-1">
        <div className="flex items-center gap-2">
          <RadioIcon size={16} className="text-[#f4f4f6]" />
          <h1 id="katalog-judul" tabIndex={-1} className="text-2xl sm:text-3xl font-bold tracking-tight text-[#f4f4f6] focus:outline-none">
            Database Pertandingan Terjadwal
          </h1>
        </div>
        <p className="text-[13px] text-[#a2a2b5] leading-relaxed max-w-3xl font-sans">
          Pilih pertandingan untuk membuka analisis probabilitas Dixon-Coles, alokasi Kelly, dan debat sindikat.
        </p>
        <KickoffCountdown matches={matches} />
      </div>

      {/* Loading Skeleton Shimmer */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="p-5 rounded-[18px] bg-[#14141f] border border-[#262636] animate-pulse space-y-3"
            >
              <div className="flex justify-between items-center">
                <div className="h-3.5 bg-[#1b1b29] rounded w-28" />
                <div className="h-3 bg-[#1b1b29] rounded w-14" />
              </div>
              <div className="space-y-2 py-3">
                <div className="h-4 bg-[#1b1b29] rounded w-3/4" />
                <div className="h-4 bg-[#1b1b29] rounded w-2/3" />
              </div>
              <div className="h-3 bg-[#1b1b29] rounded w-1/2" />
            </div>
          ))}
        </div>
      )}

      {/* Error Callout */}
      {error && !loading && (
        <div className="p-5 rounded-[18px] border border-[#fb4d5e]/20 bg-[#fb4d5e]/5 text-[#f4f4f6] text-xs">
          <div className="flex items-start gap-2.5">
            <AlertCircleIcon size={16} className="shrink-0 mt-0.5 text-[#fb4d5e]" />
            <div>
              <h3 className="font-semibold text-xs text-[#fb4d5e]">Gagal Mengambil Data Pertandingan</h3>
              <p className="text-[11px] text-[#a2a2b5] mt-0.5">{error}</p>
              <button
                onClick={onRetry}
                className="mt-2.5 px-3.5 py-1.5 rounded-[18px] bg-[#b8b0ff] hover:bg-[#cdc6ff] text-xs font-medium text-[#17131f] transition-colors cursor-pointer"
              >
                Coba Lagi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OFFLINE BANNER — data lokal, ada tanggal kedaluwarsa */}
      {!loading && !error && offline && catalogMaxUtc && (
        <div className="px-4 py-2.5 rounded-[18px] bg-[#1b1b29] border border-[#262636] text-[12px] font-sans text-[#a2a2b5] flex items-center gap-2">
          <RadioIcon size={13} className="text-[#f4f4f6] shrink-0" />
          <span>
            Data offline s/d {catalogMaxUtc.slice(0, 10)} — sisa {remainingDays} hari. API mati, katalog disajikan dari database lokal.
          </span>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && matches.length === 0 && (
        <div className="p-12 text-center text-[13px] text-[#a2a2b5] rounded-[18px] bg-[#14141f] border border-[#262636] font-sans">
          {offline
            ? `Katalog lokal habis di rentang ${hours} jam ke depan — bukan error. Coba rentang lebih panjang atau tunggu sinkronisasi berikutnya.`
            : `Tidak ada pertandingan terjadwal dalam rentang ${hours} jam ke depan`}
          {hasSearchQuery ? " yang sesuai dengan kriteria pencarian." : "."}
        </div>
      )}

      {/* Modern Hairline Match Cards Grid with Staggered Entrance */}
      {!loading && !error && matches.length > 0 && (
        <div ref={gridRef} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {matches.map((m) => {
            const homeName = normalizeTeamName(m.home_team.name);
            const awayName = normalizeTeamName(m.away_team.name);

            return (
              <article
                key={m.id}
                role="button"
                tabIndex={0}
                aria-label={`Analisis ${homeName} vs ${awayName}`}
                className="p-5 rounded-[18px] bg-[#14141f] hover:bg-[#1b1b29] border border-[#262636] hover:border-[#b8b0ff] flex flex-col justify-between cursor-pointer group transition-colors"
                onClick={() => onSelectMatch(m)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectMatch(m);
                  }
                }}
              >
                <div>
                  {/* Card Top: Competition & Kickoff */}
                  <div className="flex items-center justify-between gap-2 pb-3">
                    <span className="px-2.5 py-0.5 rounded-[18px] text-[11px] font-sans flat-tag-zinc truncate max-w-[70%] font-semibold">
                      {m.competition_name}
                    </span>
                    <span className="text-[11px] font-sans text-[#a2a2b5] shrink-0 font-medium tabular-nums">
                      {formatKickoffTime(m.utc_date)}
                    </span>
                  </div>

                  {/* Teams Title */}
                  <div className="py-3.5 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-sm text-[#f4f4f6] group-hover:text-[#f4f4f6] transition-colors truncate">
                        {homeName}
                      </h3>
                      <span className="text-[11px] font-sans text-[#a2a2b5]">H</span>
                    </div>
                    <div className="text-[11px] text-[#8e8ea3] font-sans">
                      vs
                    </div>
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-sm text-[#f4f4f6] group-hover:text-[#f4f4f6] transition-colors truncate">
                        {awayName}
                      </h3>
                      <span className="text-[11px] font-sans text-[#a2a2b5]">A</span>
                    </div>
                  </div>

                  {/* Date & Venue */}
                  <div className="text-[11px] text-[#a2a2b5] space-y-0.5 pb-2 font-sans">
                    <p className="text-[11px] text-[#e8e8ef] tabular-nums">{formatWib(m.utc_date)}</p>
                    {m.venue && (
                      <p className="truncate text-[11px] text-[#a2a2b5]">
                        Venue: {m.venue.name}, {m.venue.city}
                      </p>
                    )}
                  </div>
                </div>

                {/* Card Footer: Data Indicators & Action */}
                <div className="pt-3 flex items-center justify-between gap-2 text-xs font-sans">
                  <div className="flex items-center gap-1.5">
                    {m.odds_available && (
                      <span className="px-2 py-0.5 rounded-[18px] text-[11px] font-sans flat-tag-white">
                        Odds
                      </span>
                    )}
                    {m.xg_available && (
                      <span className="px-2 py-0.5 rounded-[18px] text-[11px] font-sans flat-tag-zinc">
                        xG
                      </span>
                    )}
                    {m.shotmap_available && (
                      <span className="px-2 py-0.5 rounded-[18px] text-[11px] font-sans flat-tag-zinc">
                        Shotmap
                      </span>
                    )}
                  </div>

                  <span className="text-[11px] text-[#f4f4f6] font-medium flex items-center gap-1 transition-colors">
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
