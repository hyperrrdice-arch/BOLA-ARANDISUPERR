"use client";

import React, { useState } from "react";
import {
  RefreshCwIcon,
  AlertCircleIcon,
  CheckCircleIcon,
  CrosshairIcon,
} from "@/components/icons";
import {
  Market1xBetV2,
} from "@/lib/1xbet";
import {
  QuantEngineData,
  BettingResult1xBet,
} from "./types";
import { useLogicalPicks } from "./use-logical-picks";
import { LogicalPickCard } from "./LogicalPickCard";
import { MarketsTable } from "./MarketsTable";

interface OneXBetDeepMarketsCardProps {
  homeTeam: string;
  awayTeam: string;
  competition?: string;
  quantData?: Pick<QuantEngineData, "dixon_coles"> | null;
  initialMarkets?: Market1xBetV2[] | null;
  initialBettingResult?: BettingResult1xBet | null;
  onTriggerScan?: (customId?: string) => void;
  scanLoading?: boolean;
}

export function OneXBetDeepMarketsCard({
  homeTeam,
  awayTeam,
  competition,
  quantData,
  initialMarkets,
  initialBettingResult,
  onTriggerScan,
  scanLoading = false,
}: OneXBetDeepMarketsCardProps) {
  const [markets, setMarkets] = useState<Market1xBetV2[]>(
    initialMarkets ||
      (Array.isArray(initialBettingResult?.all_markets)
        ? initialBettingResult.all_markets
        : Array.isArray(initialBettingResult?.markets)
        ? initialBettingResult.markets
        : [])
  );
  const [matchId1xBet, setMatchId1xBet] = useState<string>(
    initialBettingResult?.match_id_1xbet
      ? String(initialBettingResult.match_id_1xbet)
      : ""
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filter & Search State
  const [manualIdInput, setManualIdInput] = useState<string>("");
  const [showManualBox, setShowManualBox] = useState<boolean>(false);

  // Sinkronisasi jika initialMarkets atau initialBettingResult berubah (pola React:
  // adjust state saat render, bukan effect — lihat react.dev "you might not need an effect")
  const [prevInitialMarkets, setPrevInitialMarkets] = useState(initialMarkets);
  const [prevInitialBettingResult, setPrevInitialBettingResult] =
    useState(initialBettingResult);
  if (initialMarkets !== prevInitialMarkets) {
    setPrevInitialMarkets(initialMarkets);
    if (initialMarkets && initialMarkets.length > 0) {
      setMarkets(initialMarkets);
    } else {
      setMarkets([]);
    }
  }
  if (initialBettingResult !== prevInitialBettingResult) {
    setPrevInitialBettingResult(initialBettingResult);
    if (initialBettingResult?.all_markets && initialBettingResult.all_markets.length > 0) {
      setMarkets(initialBettingResult.all_markets);
    } else if (initialBettingResult?.markets && initialBettingResult.markets.length > 0) {
      setMarkets(initialBettingResult.markets);
    } else {
      setMarkets([]);
    }
    if (initialBettingResult?.match_id_1xbet) {
      setMatchId1xBet(String(initialBettingResult.match_id_1xbet));
    }
  }

  // Fetch Markets via Fast GET API (scan manual)
  async function fetchMarketsFast(targetId?: string) {
    setLoading(true);
    setError(null);

    try {
      let url = `/api/betting?`;
      if (targetId) {
        url += `match_id=${encodeURIComponent(targetId)}`;
      } else {
        url += `home=${encodeURIComponent(homeTeam)}&away=${encodeURIComponent(
          awayTeam
        )}`;
        if (competition) url += `&competition=${encodeURIComponent(competition)}`;
      }

      const res = await fetch(url);
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }

      if (json.status === "not_found") {
        setError(json.message);
        setShowManualBox(true);
        return;
      }

      const list = json.markets || json.all_markets || [];
      setMarkets(list);
      if (json.match_id_1xbet) {
        setMatchId1xBet(json.match_id_1xbet);
      }
    } catch (err) {
      console.error("[OneXBetDeepMarketsCard] Fetch error:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  // Generate 3-5 "Pilihan Paling Masuk Akal (Most Logical Picks)"
  const logicalPicks = useLogicalPicks({
    markets,
    quantData,
    initialBettingResult,
    homeTeam,
    awayTeam,
  });

  return (
    <div className="p-6 rounded-[18px] bg-[#14141f] border border-[#262636] space-y-6 text-[#f4f4f6]">
      {/* 1. HEADER & TELEMETRY */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-sans text-[#a2a2b5] bg-[#1b1b29] px-2.5 py-1 rounded-[18px] border border-[#262636]">
              1xBet Deep Orderbook Feed
            </span>
            {matchId1xBet && (
              <span className="text-[11px] font-sans text-[#a2a2b5]">
                1xBet ID: <strong className="text-[#f4f4f6]">{matchId1xBet}</strong>
              </span>
            )}
            <span className="text-[11px] font-sans text-[#a2a2b5]">
              {markets.length > 0 ? `${markets.length} Pasar Aktif` : "Katalog Pasar"}
            </span>
          </div>
          <h3 className="text-sm sm:text-base font-bold text-[#f4f4f6] font-sans tracking-tight mt-1">
            Katalog Market 1xBet &amp; Pilihan Logis
          </h3>
          <p className="text-xs text-[#a2a2b5] font-sans mt-0.5">
            {homeTeam} vs {awayTeam} • Penelusuran bursa mendalam &amp; kuantifikasi ekspektasi nilai (+EV)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (onTriggerScan) {
                onTriggerScan();
              } else {
                fetchMarketsFast();
              }
            }}
            disabled={loading || scanLoading}
            className="px-3.5 py-2 rounded-[18px] bg-[#b8b0ff] hover:bg-[#b8b0ff] text-[#17131f] text-xs font-sans font-bold transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCwIcon
              size={12}
              className={loading || scanLoading ? "animate-spin" : ""}
            />
            <span>{loading || scanLoading ? "Memindai..." : "Pindai Pasar 1xBet"}</span>
          </button>

          <button
            onClick={() => setShowManualBox(!showManualBox)}
            className="px-3 py-2 rounded-[18px] bg-[#14141f] hover:bg-[#1b1b29] text-xs font-sans text-[#f4f4f6] border border-[#262636] transition-colors cursor-pointer"
            title="Input Match ID Manual"
          >
            Manual ID
          </button>
        </div>
      </div>

      {/* MANUAL MATCH ID INPUT BOX */}
      {showManualBox && (
        <div className="p-3.5 rounded-[18px] bg-[#1b1b29] border border-[#262636] flex flex-col sm:flex-row items-stretch sm:items-center gap-2 text-xs font-sans">
          <span className="text-[#a2a2b5] shrink-0">1xBet Match ID Manual:</span>
          <input
            type="text"
            placeholder="Contoh: 751762591"
            value={manualIdInput}
            onChange={(e) => setManualIdInput(e.target.value)}
            className="flex-1 bg-[#14141f] text-[#f4f4f6] px-3.5 py-1.5 rounded-[18px] border border-[#262636] focus:outline-none focus:border-[#b8b0ff] font-sans text-[13px]"
          />
          <button
            onClick={() => {
              if (manualIdInput.trim()) {
                if (onTriggerScan) onTriggerScan(manualIdInput.trim());
                else fetchMarketsFast(manualIdInput.trim());
              }
            }}
            disabled={!manualIdInput.trim() || loading}
            className="px-4 py-1.5 rounded-[18px] bg-[#b8b0ff] hover:bg-[#b8b0ff] text-[#17131f] font-bold transition-colors disabled:opacity-50 cursor-pointer"
          >
            Pindai ID Ini
          </button>
        </div>
      )}

      {/* ERROR CALLOUT */}
      {error && (
        <div className="p-4 rounded-[18px] bg-[#2a161c] border border-[#5c2430] text-xs text-[#fda4af] flex items-start gap-2.5 font-sans">
          <AlertCircleIcon size={16} className="text-[#fb4d5e] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold text-[#fda4af]">Pencarian Pasar 1xBet Memerlukan Tindakan</p>
            <p className="text-[13px] text-[#fda4af] leading-relaxed font-sans">{error}</p>
            <p className="text-[13px] text-[#a2a2b5] font-sans">
              Gunakan tombol &quot;Manual ID&quot; di atas untuk memasukkan 1xBet Match ID secara presisi.
            </p>
          </div>
        </div>
      )}

      {/* SECTION KHUSUS: PILIHAN PALING MASUK AKAL (MOST LOGICAL PICKS) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between pb-1">
          <div className="flex items-center gap-2">
            <CrosshairIcon size={15} className="text-[#f4f4f6]" />
            <h4 className="text-xs font-bold text-[#f4f4f6] font-sans">
              Pilihan Paling Masuk Akal (Most Logical Picks)
            </h4>
          </div>
          <span className="text-[11px] font-sans text-[#a2a2b5] bg-[#1b1b29] px-2.5 py-1 rounded-[18px] border border-[#262636]">
            Dixon-Coles + Shin Vig + 1xBet Synthesis
          </span>
        </div>

        {logicalPicks.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {logicalPicks.map((pick) => (
              <LogicalPickCard key={pick.id} pick={pick} />
            ))}
          </div>
        ) : (
          <div className="p-5 rounded-[18px] bg-[#1b1b29] border border-[#262636] text-xs font-sans text-[#a2a2b5] space-y-1">
            <p className="text-[#f4f4f6] font-semibold text-[13px] font-sans">
              Katalog pasar 1xBet belum dipindai untuk komputasi +EV otomatis.
            </p>
            <p className="text-[13px] font-sans">
              Klik tombol <strong className="text-[#f4f4f6]">&quot;Pindai Pasar 1xBet&quot;</strong> di atas
              untuk menarik baris bursa langsung (scan manual, kuota terbatas).
            </p>
          </div>
        )}
      </div>

      {/* 2. FILTER KATEGORI CEPAT & PENCARIAN INSTAN + 3. GRID BURSA PASAR 1XBET */}
      <MarketsTable markets={markets} />

      {/* FOOTER GUARANTEE */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 text-[11px] font-sans text-[#a2a2b5]">
        <div className="flex items-center gap-2">
          <CheckCircleIcon size={12} className="text-[#f4f4f6]" />
          <span>RapidAPI 1xBet Ingestion • 60-Minute RAM Cache Protection</span>
        </div>
        <span>Cakupan bursa hasil pindaian manual</span>
      </div>
    </div>
  );
}
