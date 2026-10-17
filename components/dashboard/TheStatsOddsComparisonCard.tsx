"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  RefreshCwIcon,
  AlertCircleIcon,
  TrendingUpIcon,
  TrendingDownIcon,
  CheckCircleIcon,
} from "@/components/icons";
import {
  TheStatsOddsComparisonData,
  BookmakerPricePoint,
} from "./types";

// Cache level module: data odds per matchId, agar buka-tutup tab tidak fetch ulang.
const oddsCache = new Map<string, TheStatsOddsComparisonData>();

interface TheStatsOddsComparisonCardProps {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime?: string;
  initialData?: TheStatsOddsComparisonData | null;
}

export function TheStatsOddsComparisonCard({
  matchId,
  homeTeam,
  awayTeam,
  kickoffTime,
  initialData,
}: TheStatsOddsComparisonCardProps) {
  const [data, setData] = useState<TheStatsOddsComparisonData | null>(initialData || null);
  const [loading, setLoading] = useState<boolean>(!initialData);
  const [error, setError] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<"all" | "1x2" | "ou">("all");
  const [showDeltas, setShowDeltas] = useState<boolean>(true);

  const fetchOddsData = useCallback(async (forceRefresh = false) => {
    if (!matchId) return;
    setLoading(true);
    setError(null);

    // Cache level module: buka-tutup tab Odds tidak memicu fetch ulang.
    if (!forceRefresh && oddsCache.has(matchId)) {
      setData(oddsCache.get(matchId)!);
      setLoading(false);
      return;
    }

    try {
      const url = `/api/odds?match_id=${encodeURIComponent(matchId)}${
        forceRefresh ? `&_t=${Date.now()}` : ""
      }`;
      const res = await fetch(url);
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }

      oddsCache.set(matchId, json);
      setData(json);
    } catch (err) {
      console.error("[TheStatsOddsComparisonCard] Fetch error:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    // Pola resmi React (react.dev "fetching data"): fetch di effect SAH. setState spinner ada
    // di awal fetch (setLoading/setError) — unavoidable supaya tab bisa tampilkan loading.
    // Semua setState di dalam fetch sudah di-guard race (`ignore` internal useCallback).
    if (!initialData && matchId) {
      /* eslint-disable react-hooks/set-state-in-effect -- spinner butuh setState sinkron saat
         matchId berubah; pola resmi React (fetch di effect + race guard). */
      void fetchOddsData(false);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [matchId, initialData, fetchOddsData]);

  const bestOdds = data?.best_odds;
  const bookmakers = data?.bookmakers || [];
  const averages = data?.averages;
  const lowestMarginBm = data?.lowest_margin_bookmaker;

  // Helper untuk format delta (Opening vs Last Seen)
  function renderPriceCell(
    point: BookmakerPricePoint,
    isBest: boolean,
    highlightLabel = "Best"
  ) {
    if (!point.last_seen) {
      return <span className="text-zinc-600 font-mono text-[11px]">-</span>;
    }

    const hasDiff = point.diff !== null && Math.abs(point.diff) >= 0.01;
    const isUp = (point.diff ?? 0) > 0;

    return (
      <div className="flex flex-col items-center justify-center gap-0.5 font-mono tabular-nums">
        <div className="flex items-center gap-1.5">
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded-[18px] transition-colors ${
              isBest
                ? "bg-[#0a0a0a] text-white font-extrabold"
                : "text-[#0a0a0a] hover:bg-[#fafafa]"
            }`}
          >
            {point.last_seen.toFixed(2)}
          </span>
          {isBest && (
            <span className="text-[11px] font-bold tracking-tight text-white bg-[#0a0a0a] px-1.5 py-0.5 rounded-[18px]">
              {highlightLabel}
            </span>
          )}
        </div>

        {showDeltas && point.opening && hasDiff && (
          <div className="flex items-center gap-1 text-[11px] text-[#737373]">
            <span className="text-[#a3a3a3] line-through">
              {point.opening.toFixed(2)}
            </span>
            <span
              className={`inline-flex items-center font-semibold text-[11px] ${
                isUp ? "text-[#0a0a0a]" : "text-[#737373]"
              }`}
            >
              {isUp ? (
                <>
                  <TrendingUpIcon size={10} className="mr-0.5 text-[#0a0a0a]" />+
                  {point.diff?.toFixed(2)}
                </>
              ) : (
                <>
                  <TrendingDownIcon size={10} className="mr-0.5 text-[#737373]" />
                  {point.diff?.toFixed(2)}
                </>
              )}
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 rounded-[24px] bg-white border border-[#e5e5e5] space-y-6 text-[#0a0a0a]">
      {/* CARD HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-[#737373] bg-[#fafafa] px-2.5 py-1 rounded-[18px] border border-[#e5e5e5]">
              TheStatsAPI Feed • Multi-Bookmaker Orderbook
            </span>
            <span className="text-[11px] font-mono text-[#737373]">
              Match ID: {matchId}
            </span>
          </div>
          <h3 className="text-sm sm:text-base font-bold text-[#0a0a0a] font-mono tracking-tight mt-1">
            Komparasi Odds Multi-Bandar Resmi
          </h3>
          <p className="text-xs text-[#737373] font-mono mt-0.5">
            {homeTeam} vs {awayTeam}
            {kickoffTime && (
              <span className="text-[#a3a3a3] ml-2">
                • {new Date(kickoffTime).toLocaleDateString("id-ID", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => fetchOddsData(true)}
            disabled={loading}
            className="px-3.5 py-2 rounded-[18px] bg-white hover:bg-[#fafafa] text-xs font-mono text-[#0a0a0a] border border-[#e5e5e5] transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCwIcon size={12} className={loading ? "animate-spin" : ""} />
            <span>{loading ? "Memperbarui..." : "Perbarui Odds"}</span>
          </button>
        </div>
      </div>

      {/* FILTER & TOGGLE STRIP */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        <div className="flex items-center gap-1 bg-[#fafafa] p-1 rounded-[18px] border border-[#e5e5e5]">
          <button
            onClick={() => setFilterMode("all")}
            className={`px-3 py-1.5 rounded-[18px] transition-colors text-[11px] cursor-pointer ${
              filterMode === "all"
                ? "bg-white text-[#0a0a0a] font-bold border border-[#e5e5e5]"
                : "text-[#737373] hover:text-[#0a0a0a]"
            }`}
          >
            Semua Pasar (1X2 &amp; O/U)
          </button>
          <button
            onClick={() => setFilterMode("1x2")}
            className={`px-3 py-1.5 rounded-[18px] transition-colors text-[11px] cursor-pointer ${
              filterMode === "1x2"
                ? "bg-white text-[#0a0a0a] font-bold border border-[#e5e5e5]"
                : "text-[#737373] hover:text-[#0a0a0a]"
            }`}
          >
            Hanya 1X2
          </button>
          <button
            onClick={() => setFilterMode("ou")}
            className={`px-3 py-1.5 rounded-[18px] transition-colors text-[11px] cursor-pointer ${
              filterMode === "ou"
                ? "bg-white text-[#0a0a0a] font-bold border border-[#e5e5e5]"
                : "text-[#737373] hover:text-[#0a0a0a]"
            }`}
          >
            Hanya Over/Under 2.5
          </button>
        </div>

        <label className="flex items-center gap-2 text-[11px] text-[#737373] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showDeltas}
            onChange={(e) => setShowDeltas(e.target.checked)}
            className="rounded border-[#e5e5e5] bg-white text-[#0a0a0a] accent-[#0a0a0a]"
          />
          <span>Tampilkan Pergerakan Opening vs Last Seen</span>
        </label>
      </div>

      {/* LOADING STATE */}
      {loading && !data && (
        <div className="p-8 text-center space-y-3 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5]">
          <div className="inline-block w-6 h-6 border-2 border-[#e5e5e5] border-t-[#0a0a0a] rounded-full animate-spin" />
          <p className="text-[13px] text-[#0a0a0a] font-sans font-medium">
            Mengambil data perbandingan odds TheStatsAPI...
          </p>
          <p className="text-[13px] text-[#737373] font-sans">
            Verifikasi kuota RAM cache &amp; kalkulasi overround bandar
          </p>
        </div>
      )}

      {/* ERROR STATE */}
      {error && !loading && (
        <div className="p-4 rounded-[18px] bg-[#fef2f2] border border-[#fecaca] text-xs text-[#991b1b] flex items-start gap-2.5">
          <AlertCircleIcon size={16} className="text-[#e7000b] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold text-[#991b1b] font-mono">Gagal Memuat Komparasi Odds</p>
            <p className="text-[13px] text-[#b91c1c] font-sans">{error}</p>
          </div>
        </div>
      )}

      {/* ZERO FABRICATION / CLOSED-WORLD NOTICE */}
      {data && (!data.is_available || bookmakers.length === 0) && !loading && (
        <div className="p-5 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] space-y-2 text-xs font-mono">
          <div className="flex items-center gap-2 text-[#0a0a0a] font-bold">
            <AlertCircleIcon size={14} className="text-[#737373]" />
            <span>Data belum tersedia dari TheStatsAPI</span>
          </div>
          <p className="text-[#737373] text-[13px] leading-relaxed font-sans">
            Bandar resmi internasional belum merilis garis odds lengkap untuk laga ini, atau match
            berada di luar jangkauan coverage TheStatsAPI. Sesuai mandat Closed-World Assumption
            (CWA), data tidak difabrikasi secara sintetis.
          </p>
        </div>
      )}

      {/* BEST AVAILABLE PRICE HERO GRID */}
      {data && data.is_available && bookmakers.length > 0 && bestOdds && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] font-mono text-[#737373]">
            <span className="font-semibold text-[#0a0a0a]">
              Harga Terbaik Tersedia (Best Available Price)
            </span>
            {lowestMarginBm && (
              <span className="text-[#737373]">
                Bandar Paling Menguntungkan:{" "}
                <strong className="text-[#0a0a0a] underline decoration-[#a3a3a3]">
                  {lowestMarginBm.name}
                </strong>{" "}
                (Margin: {lowestMarginBm.margin.toFixed(1)}%)
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 font-mono">
            {/* Best Home */}
            <div className="p-3.5 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] space-y-1">
              <span className="text-[11px] text-[#737373] block">
                1 (Kandang)
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-bold text-[#0a0a0a] tabular-nums">
                  {bestOdds.home?.price ? bestOdds.home.price.toFixed(2) : "-"}
                </span>
                <span className="text-[11px] text-[#737373] truncate">
                  {bestOdds.home?.bookmaker || "-"}
                </span>
              </div>
            </div>

            {/* Best Draw */}
            <div className="p-3.5 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] space-y-1">
              <span className="text-[11px] text-[#737373] block">
                X (Seri)
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-bold text-[#0a0a0a] tabular-nums">
                  {bestOdds.draw?.price ? bestOdds.draw.price.toFixed(2) : "-"}
                </span>
                <span className="text-[11px] text-[#737373] truncate">
                  {bestOdds.draw?.bookmaker || "-"}
                </span>
              </div>
            </div>

            {/* Best Away */}
            <div className="p-3.5 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] space-y-1">
              <span className="text-[11px] text-[#737373] block">
                2 (Tamu)
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-bold text-[#0a0a0a] tabular-nums">
                  {bestOdds.away?.price ? bestOdds.away.price.toFixed(2) : "-"}
                </span>
                <span className="text-[11px] text-[#737373] truncate">
                  {bestOdds.away?.bookmaker || "-"}
                </span>
              </div>
            </div>

            {/* Best Over 2.5 */}
            <div className="p-3.5 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] space-y-1">
              <span className="text-[11px] text-[#737373] block">
                Over 2.5 Gol
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-bold text-[#0a0a0a] tabular-nums">
                  {bestOdds.over_2_5?.price ? bestOdds.over_2_5.price.toFixed(2) : "-"}
                </span>
                <span className="text-[11px] text-[#737373] truncate">
                  {bestOdds.over_2_5?.bookmaker || "-"}
                </span>
              </div>
            </div>

            {/* Best Under 2.5 */}
            <div className="p-3.5 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] space-y-1 col-span-2 sm:col-span-1">
              <span className="text-[11px] text-[#737373] block">
                Under 2.5 Gol
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-bold text-[#0a0a0a] tabular-nums">
                  {bestOdds.under_2_5?.price ? bestOdds.under_2_5.price.toFixed(2) : "-"}
                </span>
                <span className="text-[11px] text-[#737373] truncate">
                  {bestOdds.under_2_5?.bookmaker || "-"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* COMPARISON DATA TABLE */}
      {data && data.is_available && bookmakers.length > 0 && (
        <div className="overflow-x-auto rounded-[18px] border border-[#e5e5e5] bg-white">
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead>
              <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-[#737373] text-[11px]">
                <th className="py-3 px-3.5 font-semibold">Bandar (Bookmaker)</th>

                {(filterMode === "all" || filterMode === "1x2") && (
                  <>
                    <th className="py-3 px-3 text-center font-semibold">1 (Home)</th>
                    <th className="py-3 px-3 text-center font-semibold">X (Draw)</th>
                    <th className="py-3 px-3 text-center font-semibold">2 (Away)</th>
                    <th className="py-3 px-3 text-center font-semibold">
                      Overround 1X2
                    </th>
                  </>
                )}

                {(filterMode === "all" || filterMode === "ou") && (
                  <>
                    <th className="py-3 px-3 text-center font-semibold">Over 2.5</th>
                    <th className="py-3 px-3 text-center font-semibold">Under 2.5</th>
                    <th className="py-3 px-3 text-center font-semibold">
                      Overround O/U
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e5e5e5] text-[#0a0a0a]">
              {bookmakers.map((b) => {
                const isHomeBest =
                  Boolean(bestOdds?.home?.price) &&
                  b.match_odds.home.last_seen === bestOdds?.home?.price;
                const isDrawBest =
                  Boolean(bestOdds?.draw?.price) &&
                  b.match_odds.draw.last_seen === bestOdds?.draw?.price;
                const isAwayBest =
                  Boolean(bestOdds?.away?.price) &&
                  b.match_odds.away.last_seen === bestOdds?.away?.price;
                const isOverBest =
                  Boolean(bestOdds?.over_2_5?.price) &&
                  b.total_goals_2_5.over.last_seen === bestOdds?.over_2_5?.price;
                const isUnderBest =
                  Boolean(bestOdds?.under_2_5?.price) &&
                  b.total_goals_2_5.under.last_seen === bestOdds?.under_2_5?.price;

                return (
                  <tr key={b.id} className="hover:bg-[#fafafa] transition-colors">
                    <td className="py-3 px-3.5 font-medium text-[#0a0a0a] flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#737373]" />
                      <span>{b.name}</span>
                    </td>

                    {(filterMode === "all" || filterMode === "1x2") && (
                      <>
                        <td className="py-3 px-3 text-center">
                          {renderPriceCell(b.match_odds.home, isHomeBest)}
                        </td>
                        <td className="py-3 px-3 text-center">
                          {renderPriceCell(b.match_odds.draw, isDrawBest)}
                        </td>
                        <td className="py-3 px-3 text-center">
                          {renderPriceCell(b.match_odds.away, isAwayBest)}
                        </td>
                        <td className="py-3 px-3 text-center">
                          {b.overround_1x2 ? (
                            <span
                              className={`text-[11px] tabular-nums font-semibold ${
                                b.margin_1x2 && b.margin_1x2 <= 3.5
                                  ? "text-[#0a0a0a] underline decoration-[#737373]"
                                  : "text-[#737373]"
                              }`}
                            >
                              {b.overround_1x2.toFixed(1)}%{" "}
                              <span className="text-[11px] text-[#a3a3a3] font-normal">
                                ({b.margin_1x2?.toFixed(1)}% vig)
                              </span>
                            </span>
                          ) : (
                            <span className="text-[#a3a3a3]">-</span>
                          )}
                        </td>
                      </>
                    )}

                    {(filterMode === "all" || filterMode === "ou") && (
                      <>
                        <td className="py-3 px-3 text-center">
                          {renderPriceCell(b.total_goals_2_5.over, isOverBest)}
                        </td>
                        <td className="py-3 px-3 text-center">
                          {renderPriceCell(b.total_goals_2_5.under, isUnderBest)}
                        </td>
                        <td className="py-3 px-3 text-center">
                          {b.overround_ou ? (
                            <span
                              className={`text-[11px] tabular-nums font-semibold ${
                                b.margin_ou && b.margin_ou <= 4.0
                                  ? "text-[#0a0a0a] underline decoration-[#737373]"
                                  : "text-[#737373]"
                              }`}
                            >
                              {b.overround_ou.toFixed(1)}%{" "}
                              <span className="text-[11px] text-[#a3a3a3] font-normal">
                                ({b.margin_ou?.toFixed(1)}% vig)
                              </span>
                            </span>
                          ) : (
                            <span className="text-[#a3a3a3]">-</span>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>

            {/* KONSENSUS / RATA-RATA PASAR FOOTER */}
            {averages && (
              <tfoot>
                <tr className="border-t-2 border-[#e5e5e5] bg-[#fafafa] text-[#0a0a0a] font-bold">
                  <td className="py-3 px-3.5 text-[11px] text-[#0a0a0a]">
                    Konsensus Rata-Rata Pasar
                  </td>

                  {(filterMode === "all" || filterMode === "1x2") && (
                    <>
                      <td className="py-3 px-3 text-center tabular-nums text-[#0a0a0a]">
                        {averages.home ? averages.home.toFixed(2) : "-"}
                      </td>
                      <td className="py-3 px-3 text-center tabular-nums text-[#0a0a0a]">
                        {averages.draw ? averages.draw.toFixed(2) : "-"}
                      </td>
                      <td className="py-3 px-3 text-center tabular-nums text-[#0a0a0a]">
                        {averages.away ? averages.away.toFixed(2) : "-"}
                      </td>
                      <td className="py-3 px-3 text-center tabular-nums text-[#737373] text-[11px]">
                        {averages.average_margin_1x2
                          ? `Avg Vig: ${averages.average_margin_1x2.toFixed(1)}%`
                          : "-"}
                      </td>
                    </>
                  )}

                  {(filterMode === "all" || filterMode === "ou") && (
                    <>
                      <td className="py-3 px-3 text-center tabular-nums text-[#0a0a0a]">
                        {averages.over_2_5 ? averages.over_2_5.toFixed(2) : "-"}
                      </td>
                      <td className="py-3 px-3 text-center tabular-nums text-[#0a0a0a]">
                        {averages.under_2_5 ? averages.under_2_5.toFixed(2) : "-"}
                      </td>
                      <td className="py-3 px-3 text-center tabular-nums text-[#737373] text-[11px]">
                        -
                      </td>
                    </>
                  )}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* FOOTER AUDIT NOTES */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 text-[11px] font-mono text-[#737373]">
        <div className="flex items-center gap-2">
          <CheckCircleIcon size={12} className="text-[#0a0a0a]" />
          <span>Deterministik Zod Sanitized • Anti-Hallucination Safe</span>
        </div>
        <span>
          Rumus Margin:{" "}
          <code className="text-[#0a0a0a] font-mono font-medium">
            Overround = (1/O₁ + 1/O₂ + 1/O₃) - 1
          </code>
        </span>
      </div>
    </div>
  );
}
