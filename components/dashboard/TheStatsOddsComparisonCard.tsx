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

  // Guard race: jangan sampai respon match lama menimpa match baru jika switch cepat
  const activeMatchIdRef = React.useRef(matchId);
  useEffect(() => {
    activeMatchIdRef.current = matchId;
  }, [matchId]);

  const formattedKickoff = React.useMemo(() => {
    if (!kickoffTime) return null;
    const d = new Date(kickoffTime);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("id-ID", { hour: "2-digit", minute: "2-digit" });
  }, [kickoffTime]);

  const fetchOddsData = useCallback(async (forceRefresh = false) => {
    if (!matchId) return;
    const targetId = matchId;
    setLoading(true);
    setError(null);

    // Cache level module: buka-tutup tab Odds tidak memicu fetch ulang.
    if (!forceRefresh && oddsCache.has(targetId)) {
      setData(oddsCache.get(targetId)!);
      setLoading(false);
      return;
    }

    try {
      const url = `/api/odds?match_id=${encodeURIComponent(targetId)}${
        forceRefresh ? `&_t=${Date.now()}` : ""
      }`;
      const res = await fetch(url);
      const json = await res.json();

      if (activeMatchIdRef.current !== targetId) return;

      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }

      oddsCache.set(targetId, json);
      setData(json);
    } catch (err) {
      if (activeMatchIdRef.current !== targetId) return;
      console.error("[TheStatsOddsComparisonCard] Fetch error:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (activeMatchIdRef.current === targetId) {
        setLoading(false);
      }
    }
  }, [matchId]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- spinner & cache-hit butuh setState sinkron
       saat matchId berubah; pola resmi React (fetch di effect + race guard). */
    if (!initialData && matchId) {
      if (oddsCache.has(matchId)) {
        setData(oddsCache.get(matchId)!);
        setLoading(false);
        setError(null);
      } else {
        setData(null);
        void fetchOddsData(false);
      }
    } else if (initialData) {
      setData(initialData);
      setLoading(false);
      setError(null);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
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
      return <span className="text-zinc-600 font-sans text-[11px]">-</span>;
    }

    const hasDiff = point.diff !== null && Math.abs(point.diff) >= 0.01;
    const isUp = (point.diff ?? 0) > 0;

    return (
      <div className="flex flex-col items-center justify-center gap-0.5 font-sans tabular-nums">
        <div className="flex items-center gap-1.5">
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded-[18px] transition-colors ${
              isBest
                ? "bg-[#b8b0ff] text-[#17131f] font-extrabold"
                : "text-[#f4f4f6] hover:bg-[#1b1b29]"
            }`}
          >
            {point.last_seen.toFixed(2)}
          </span>
          {isBest && (
            <span className="text-[11px] font-bold tracking-tight text-[#17131f] bg-[#b8b0ff] px-1.5 py-0.5 rounded-[18px]">
              {highlightLabel}
            </span>
          )}
        </div>

        {showDeltas && point.opening && hasDiff && (
          <div className="flex items-center gap-1 text-[11px] text-[#a2a2b5]">
            <span className="text-[#8e8ea3] line-through">
              {point.opening.toFixed(2)}
            </span>
            <span
              className={`inline-flex items-center font-semibold text-[11px] ${
                isUp ? "text-[#f4f4f6]" : "text-[#a2a2b5]"
              }`}
            >
              {isUp ? (
                <>
                  <TrendingUpIcon size={10} className="mr-0.5 text-[#f4f4f6]" />+
                  {point.diff?.toFixed(2)}
                </>
              ) : (
                <>
                  <TrendingDownIcon size={10} className="mr-0.5 text-[#a2a2b5]" />
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
    <div className="p-6 rounded-[18px] bg-[#14141f] border border-[#262636] space-y-6 text-[#f4f4f6]">
      {/* CARD HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-sans text-[#a2a2b5] bg-[#1b1b29] px-2.5 py-1 rounded-[18px] border border-[#262636]">
              TheStatsAPI Feed • Multi-Bookmaker Orderbook
            </span>
            <span className="text-[11px] font-sans text-[#a2a2b5]">
              Match ID: {matchId}
            </span>
          </div>
          <h3 className="text-sm sm:text-base font-bold text-[#f4f4f6] font-sans tracking-tight mt-1">
            Komparasi Odds Multi-Bandar Resmi
          </h3>
          <p className="text-xs text-[#a2a2b5] font-sans mt-0.5">
            {homeTeam} vs {awayTeam}
            {formattedKickoff && (
              <span className="text-[#8e8ea3] ml-2">• {formattedKickoff}</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => fetchOddsData(true)}
            disabled={loading}
            className="px-3.5 py-2 rounded-[18px] bg-[#14141f] hover:bg-[#1b1b29] text-xs font-sans text-[#f4f4f6] border border-[#262636] transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCwIcon size={12} className={loading ? "animate-spin" : ""} />
            <span>{loading ? "Memperbarui..." : "Perbarui Odds"}</span>
          </button>
        </div>
      </div>

      {/* FILTER & TOGGLE STRIP */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-sans">
        <div className="flex items-center gap-1 bg-[#1b1b29] p-1 rounded-[18px] border border-[#262636]">
          <button
            onClick={() => setFilterMode("all")}
            className={`px-3 py-1.5 rounded-[18px] transition-colors text-[11px] cursor-pointer ${
              filterMode === "all"
                ? "bg-[#14141f] text-[#f4f4f6] font-bold border border-[#262636]"
                : "text-[#a2a2b5] hover:text-[#f4f4f6]"
            }`}
          >
            Semua Pasar (1X2 &amp; O/U)
          </button>
          <button
            onClick={() => setFilterMode("1x2")}
            className={`px-3 py-1.5 rounded-[18px] transition-colors text-[11px] cursor-pointer ${
              filterMode === "1x2"
                ? "bg-[#14141f] text-[#f4f4f6] font-bold border border-[#262636]"
                : "text-[#a2a2b5] hover:text-[#f4f4f6]"
            }`}
          >
            Hanya 1X2
          </button>
          <button
            onClick={() => setFilterMode("ou")}
            className={`px-3 py-1.5 rounded-[18px] transition-colors text-[11px] cursor-pointer ${
              filterMode === "ou"
                ? "bg-[#14141f] text-[#f4f4f6] font-bold border border-[#262636]"
                : "text-[#a2a2b5] hover:text-[#f4f4f6]"
            }`}
          >
            Hanya Over/Under 2.5
          </button>
        </div>

        <label className="flex items-center gap-2 text-[11px] text-[#a2a2b5] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showDeltas}
            onChange={(e) => setShowDeltas(e.target.checked)}
            className="rounded border-[#262636] bg-[#14141f] text-[#f4f4f6] accent-[#0a0a0a]"
          />
          <span>Tampilkan Pergerakan Opening vs Last Seen</span>
        </label>
      </div>

      {/* LOADING STATE */}
      {loading && !data && (
        <div className="p-8 text-center space-y-3 rounded-[18px] bg-[#1b1b29] border border-[#262636]">
          <div className="inline-block w-6 h-6 border-2 border-[#262636] border-t-[#0a0a0a] rounded-full animate-spin" />
          <p className="text-[13px] text-[#f4f4f6] font-sans font-medium">
            Mengambil data perbandingan odds TheStatsAPI...
          </p>
          <p className="text-[13px] text-[#a2a2b5] font-sans">
            Verifikasi kuota RAM cache &amp; kalkulasi overround bandar
          </p>
        </div>
      )}

      {/* ERROR STATE */}
      {error && !loading && (
        <div className="p-4 rounded-[18px] bg-[#2a161c] border border-[#5c2430] text-xs text-[#fda4af] flex items-start gap-2.5">
          <AlertCircleIcon size={16} className="text-[#fb4d5e] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold text-[#fda4af] font-sans">Gagal Memuat Komparasi Odds</p>
            <p className="text-[13px] text-[#fda4af] font-sans">{error}</p>
          </div>
        </div>
      )}

      {/* ZERO FABRICATION / CLOSED-WORLD NOTICE */}
      {data && (!data.is_available || bookmakers.length === 0) && !loading && (
        <div className="p-5 rounded-[18px] bg-[#1b1b29] border border-[#262636] space-y-2 text-xs font-sans">
          <div className="flex items-center gap-2 text-[#f4f4f6] font-bold">
            <AlertCircleIcon size={14} className="text-[#a2a2b5]" />
            <span>{data.message || "Data belum tersedia dari TheStatsAPI"}</span>
          </div>
          <p className="text-[#a2a2b5] text-[13px] leading-relaxed font-sans">
            Bandar resmi internasional belum merilis garis odds lengkap untuk laga ini, atau match
            berada di luar jangkauan coverage TheStatsAPI. Sesuai mandat Closed-World Assumption
            (CWA), data tidak difabrikasi secara sintetis.
          </p>
        </div>
      )}

      {/* BEST AVAILABLE PRICE HERO GRID */}
      {data && data.is_available && bookmakers.length > 0 && bestOdds && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] font-sans text-[#a2a2b5]">
            <span className="font-semibold text-[#f4f4f6]">
              Harga Terbaik Tersedia (Best Available Price)
            </span>
            {data.source === "local_anchor" && data.captured_utc && (
              <span className="text-[#a2a2b5]">
                Anchor lokal {data.captured_utc.slice(0, 10)} · bukan closing
              </span>
            )}
            {lowestMarginBm && (
              <span className="text-[#a2a2b5]">
                Bandar Paling Menguntungkan:{" "}
                <strong className="text-[#f4f4f6] underline decoration-[#8e8ea3]">
                  {lowestMarginBm.name}
                </strong>{" "}
                (Margin: {lowestMarginBm.margin.toFixed(1)}%)
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 font-sans">
            {/* Best Home */}
            <div className="p-3.5 rounded-[18px] bg-[#1b1b29] border border-[#262636] space-y-1">
              <span className="text-[11px] text-[#a2a2b5] block">
                1 (Kandang)
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-[#f4f4f6] tabular-nums">
                  {bestOdds.home?.price ? bestOdds.home.price.toFixed(2) : "-"}
                </span>
                <span className="text-[11px] text-[#a2a2b5] truncate">
                  {bestOdds.home?.bookmaker || "-"}
                </span>
              </div>
            </div>

            {/* Best Draw */}
            <div className="p-3.5 rounded-[18px] bg-[#1b1b29] border border-[#262636] space-y-1">
              <span className="text-[11px] text-[#a2a2b5] block">
                X (Seri)
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-[#f4f4f6] tabular-nums">
                  {bestOdds.draw?.price ? bestOdds.draw.price.toFixed(2) : "-"}
                </span>
                <span className="text-[11px] text-[#a2a2b5] truncate">
                  {bestOdds.draw?.bookmaker || "-"}
                </span>
              </div>
            </div>

            {/* Best Away */}
            <div className="p-3.5 rounded-[18px] bg-[#1b1b29] border border-[#262636] space-y-1">
              <span className="text-[11px] text-[#a2a2b5] block">
                2 (Tamu)
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-[#f4f4f6] tabular-nums">
                  {bestOdds.away?.price ? bestOdds.away.price.toFixed(2) : "-"}
                </span>
                <span className="text-[11px] text-[#a2a2b5] truncate">
                  {bestOdds.away?.bookmaker || "-"}
                </span>
              </div>
            </div>

            {/* Best Over 2.5 */}
            <div className="p-3.5 rounded-[18px] bg-[#1b1b29] border border-[#262636] space-y-1">
              <span className="text-[11px] text-[#a2a2b5] block">
                Over 2.5 Gol
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-[#f4f4f6] tabular-nums">
                  {bestOdds.over_2_5?.price ? bestOdds.over_2_5.price.toFixed(2) : "-"}
                </span>
                <span className="text-[11px] text-[#a2a2b5] truncate">
                  {bestOdds.over_2_5?.bookmaker || "-"}
                </span>
              </div>
            </div>

            {/* Best Under 2.5 */}
            <div className="p-3.5 rounded-[18px] bg-[#1b1b29] border border-[#262636] space-y-1 col-span-2 sm:col-span-1">
              <span className="text-[11px] text-[#a2a2b5] block">
                Under 2.5 Gol
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-[#f4f4f6] tabular-nums">
                  {bestOdds.under_2_5?.price ? bestOdds.under_2_5.price.toFixed(2) : "-"}
                </span>
                <span className="text-[11px] text-[#a2a2b5] truncate">
                  {bestOdds.under_2_5?.bookmaker || "-"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* COMPARISON DATA TABLE */}
      {data && data.is_available && bookmakers.length > 0 && (
        <div className="overflow-x-auto rounded-[18px] border border-[#262636] bg-[#14141f]">
          <table className="w-full min-w-[560px] text-left border-collapse text-xs font-sans">
            <thead>
              <tr className="border-b border-[#262636] bg-[#1b1b29] text-[#a2a2b5] text-[11px]">
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
            <tbody className="divide-y divide-[#262636] text-[#f4f4f6]">
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
                  <tr key={b.id} className="hover:bg-[#1b1b29] transition-colors">
                    <td className="py-3 px-3.5 font-medium text-[#f4f4f6] flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#4a4a61]" />
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
                                  ? "text-[#f4f4f6] underline decoration-[#737373]"
                                  : "text-[#a2a2b5]"
                              }`}
                            >
                              {b.overround_1x2.toFixed(1)}%{" "}
                              <span className="text-[11px] text-[#8e8ea3] font-normal">
                                ({b.margin_1x2?.toFixed(1)}% vig)
                              </span>
                            </span>
                          ) : (
                            <span className="text-[#8e8ea3]">-</span>
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
                                  ? "text-[#f4f4f6] underline decoration-[#737373]"
                                  : "text-[#a2a2b5]"
                              }`}
                            >
                              {b.overround_ou.toFixed(1)}%{" "}
                              <span className="text-[11px] text-[#8e8ea3] font-normal">
                                ({b.margin_ou?.toFixed(1)}% vig)
                              </span>
                            </span>
                          ) : (
                            <span className="text-[#8e8ea3]">-</span>
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
                <tr className="border-t-2 border-[#262636] bg-[#1b1b29] text-[#f4f4f6] font-bold">
                  <td className="py-3 px-3.5 text-[11px] text-[#f4f4f6]">
                    Konsensus Rata-Rata Pasar
                  </td>

                  {(filterMode === "all" || filterMode === "1x2") && (
                    <>
                      <td className="py-3 px-3 text-center tabular-nums text-[#f4f4f6]">
                        {averages.home ? averages.home.toFixed(2) : "-"}
                      </td>
                      <td className="py-3 px-3 text-center tabular-nums text-[#f4f4f6]">
                        {averages.draw ? averages.draw.toFixed(2) : "-"}
                      </td>
                      <td className="py-3 px-3 text-center tabular-nums text-[#f4f4f6]">
                        {averages.away ? averages.away.toFixed(2) : "-"}
                      </td>
                      <td className="py-3 px-3 text-center tabular-nums text-[#a2a2b5] text-[11px]">
                        {averages.average_margin_1x2
                          ? `Avg Vig: ${averages.average_margin_1x2.toFixed(1)}%`
                          : "-"}
                      </td>
                    </>
                  )}

                  {(filterMode === "all" || filterMode === "ou") && (
                    <>
                      <td className="py-3 px-3 text-center tabular-nums text-[#f4f4f6]">
                        {averages.over_2_5 ? averages.over_2_5.toFixed(2) : "-"}
                      </td>
                      <td className="py-3 px-3 text-center tabular-nums text-[#f4f4f6]">
                        {averages.under_2_5 ? averages.under_2_5.toFixed(2) : "-"}
                      </td>
                      <td className="py-3 px-3 text-center tabular-nums text-[#a2a2b5] text-[11px]">
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 text-[11px] font-sans text-[#a2a2b5]">
        <div className="flex items-center gap-2">
          <CheckCircleIcon size={12} className="text-[#f4f4f6]" />
          <span>Deterministik Zod Sanitized • Anti-Hallucination Safe</span>
        </div>
        <span>
          Rumus Margin:{" "}
          <code className="text-[#f4f4f6] font-sans font-medium">
            Overround = (1/O₁ + 1/O₂ + 1/O₃) - 1
          </code>
        </span>
      </div>
    </div>
  );
}
