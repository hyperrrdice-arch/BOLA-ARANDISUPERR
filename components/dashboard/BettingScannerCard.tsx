"use client";

import React from "react";
import { RefreshCwIcon, AlertCircleIcon, ScaleIcon, TrendingUpIcon } from "@/components/icons";
import type { Market1xBetV2 } from "@/lib/1xbet";
import type { BettingResult1xBet } from "./types";

interface BettingScannerCardProps {
  loading: boolean;
  error: string | null;
  result: BettingResult1xBet | null;
  manualId: string;
  showManualInput: boolean;
  onManualIdChange: (id: string) => void;
  onToggleManualInput: () => void;
  onTriggerScan: (customId?: string) => void;
  homeTeam: string;
  awayTeam: string;
}

export function BettingScannerCard({
  loading,
  error,
  result,
  manualId,
  showManualInput,
  onManualIdChange,
  onToggleManualInput,
  onTriggerScan,
}: BettingScannerCardProps) {
  return (
    <div className="p-6 rounded-[24px] bg-white border border-[#e5e5e5] space-y-5 text-[#0a0a0a]">
      {/* Scanner Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUpIcon size={15} className="text-[#0a0a0a]" />
            <h4 className="text-xs sm:text-sm font-bold text-[#0a0a0a] font-mono tracking-tight">
              1xBet Market Scanner &amp; Dual-Model AI Intelligence
            </h4>
          </div>
          <p className="text-[13px] text-[#737373] mt-1 leading-relaxed max-w-2xl font-sans">
            Pindai 500+ baris data bursa taruhan 1xBet RapidAPI dianalisis bersama model quant{" "}
            <span className="text-[#0a0a0a] font-semibold">bai/qwen3.8-27b</span> &amp; bai/deepseek-v4.1-flash.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onTriggerScan()}
            disabled={loading}
            className="px-3.5 py-2 rounded-[18px] bg-[#0a0a0a] hover:bg-black text-xs font-semibold text-white transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            {loading ? (
              <>
                <RefreshCwIcon size={12} className="animate-spin" />
                <span>Scanning 500+ Baris...</span>
              </>
            ) : (
              <>
                <TrendingUpIcon size={12} />
                <span>Scan Pasar 1xBet &amp; Analisis AI</span>
              </>
            )}
          </button>

          <button
            onClick={onToggleManualInput}
            className="px-3 py-2 rounded-[18px] bg-white hover:bg-[#fafafa] text-xs font-mono text-[#0a0a0a] border border-[#e5e5e5] transition-colors cursor-pointer"
            title="Atur ID Laga 1xBet Manual"
          >
            Manual ID
          </button>
        </div>
      </div>

      {/* Manual Match ID Input Toggle */}
      {showManualInput && (
        <div className="p-3.5 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] flex flex-col sm:flex-row items-stretch sm:items-center gap-2 text-xs">
          <span className="text-[#737373] shrink-0 font-mono">1xBet Match ID:</span>
          <input
            type="text"
            placeholder="Contoh: 751762591"
            value={manualId}
            onChange={(e) => onManualIdChange(e.target.value)}
            className="flex-1 bg-white text-[#0a0a0a] px-3.5 py-1.5 rounded-[18px] border border-[#e5e5e5] font-mono text-[13px] focus:outline-none focus:border-[#0a0a0a]"
          />
          <button
            onClick={() => onTriggerScan(manualId.trim())}
            disabled={loading || !manualId.trim()}
            className="px-4 py-1.5 rounded-[18px] bg-[#0a0a0a] hover:bg-black text-white font-medium disabled:opacity-50 cursor-pointer"
          >
            Scan ID Ini
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="p-8 text-center space-y-3 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5]">
          <div className="inline-block w-6 h-6 border-2 border-[#e5e5e5] border-t-[#0a0a0a] rounded-full animate-spin" />
          <p className="text-[13px] text-[#0a0a0a] font-semibold">
            Menghubungkan ke 1xBet API &amp; Mengambil 500+ Baris Pasar...
          </p>
          <p className="text-[13px] text-[#737373] font-sans">
            Menjalankan penalaran kuantitatif di VPS 9Router (bai/qwen3.8-27b + bai/deepseek-v4.1-flash)
          </p>
        </div>
      )}

      {/* Error Callout */}
      {error && !loading && (
        <div className="p-4 rounded-[18px] bg-[#fef2f2] border border-[#fecaca] text-xs space-y-2">
          <div className="flex items-start gap-2.5">
            <AlertCircleIcon size={16} className="text-[#e7000b] shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-[13px] text-[#991b1b]">{error}</p>
              <p className="text-[13px] text-[#b91c1c] mt-0.5 leading-relaxed">
                Tips: Buka situs 1xBet di browser atau gunakan tombol &quot;Manual ID&quot; di atas untuk memasukkan ID laga secara langsung.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Result Display: Dual Model Comparison Board */}
      {result && !loading && (
        <div className="space-y-4 pt-1">
          {/* Telemetry Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] text-[11px] font-mono text-[#737373]">
            <div className="flex items-center gap-3">
              <span className="text-[#737373]">1xBet ID:</span>
              <span className="text-[#0a0a0a] font-bold">{result.match_id_1xbet}</span>
              <span className="text-[#e5e5e5]">|</span>
              <span className="text-[#737373]">Total Pasar:</span>
              <span className="text-[#0a0a0a] font-bold">{result.total_markets_scanned} Lines</span>
            </div>
            <span className="px-2.5 py-0.5 rounded-[18px] bg-white border border-[#e5e5e5] text-[#0a0a0a] text-[11px] font-bold">
              Cache 60 Min
            </span>
          </div>

          {/* Consensus Summary Box */}
          {result.consensus && (
            <div className="p-4 rounded-[18px] text-xs flex items-start gap-3 border bg-[#fafafa] border-[#e5e5e5]">
              <ScaleIcon size={16} className="shrink-0 mt-0.5 text-[#0a0a0a]" />
              <div className="space-y-0.5">
                <h5 className="font-bold text-[#0a0a0a] font-mono text-[11px]">
                  Sintesis Konsensus Dual-Model
                </h5>
                <p className="text-[13px] text-[#737373] leading-relaxed font-sans">
                  {result.consensus.summary}
                </p>
              </div>
            </div>
          )}

          {/* Side-by-Side Comparison Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
            {/* MODEL A */}
            <div className="p-4 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] space-y-3">
              <div className="flex items-center justify-between pb-1">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#0a0a0a]" />
                  <h5 className="text-xs font-bold text-[#0a0a0a] font-mono">
                    Model A: {result.model_a?.model_name || result.model_a?.model || "Scanner"}
                  </h5>
                </div>
                {result.model_a?.result?.data?.skor_keyakinan && (
                  <span className="px-2.5 py-0.5 rounded-[18px] text-[11px] font-mono bg-white border border-[#e5e5e5] text-[#0a0a0a] font-bold">
                    Keyakinan: {result.model_a.result.data.skor_keyakinan}%
                  </span>
                )}
              </div>

              {result.model_a?.result?.success && result.model_a?.result?.data ? (
                <div className="space-y-2.5 text-xs">
                  {/* Banker */}
                  <div className="p-3 rounded-[18px] bg-white border border-[#e5e5e5] border-l-4 border-l-[#0a0a0a] space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono font-bold text-[#0a0a0a]">
                        Rekomendasi Teraman (Banker)
                      </span>
                      <span className="font-mono text-[#0a0a0a] font-bold">
                        Odds: {result.model_a.result.data.rekomendasi_aman?.odds ?? "-"}
                      </span>
                    </div>
                    <p className="font-bold text-[#0a0a0a]">
                      {result.model_a.result.data.rekomendasi_aman?.pasar}:{" "}
                      <span className="text-[#0a0a0a]">
                        {result.model_a.result.data.rekomendasi_aman?.pilihan}
                      </span>
                      {result.model_a.result.data.rekomendasi_aman?.base !== undefined &&
                      result.model_a.result.data.rekomendasi_aman?.base !== null
                        ? ` (Base: ${result.model_a.result.data.rekomendasi_aman?.base})`
                        : ""}
                    </p>
                    <p className="text-[13px] text-[#737373] leading-relaxed font-sans">
                      {result.model_a.result.data.rekomendasi_aman?.alasan}
                    </p>
                  </div>

                  {/* Value Bet */}
                  <div className="p-3 rounded-[18px] bg-white border border-[#e5e5e5] border-l-4 border-l-[#0a0a0a] space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono font-bold text-[#0a0a0a]">
                        Value Bet (Expected Value)
                      </span>
                      <span className="font-mono text-[#0a0a0a] font-bold">
                        Odds: {result.model_a.result.data.rekomendasi_value?.odds ?? "-"}
                      </span>
                    </div>
                    <p className="font-bold text-[#0a0a0a]">
                      {result.model_a.result.data.rekomendasi_value?.pasar}:{" "}
                      <span className="text-[#0a0a0a]">
                        {result.model_a.result.data.rekomendasi_value?.pilihan}
                      </span>
                    </p>
                    <p className="text-[13px] text-[#737373] leading-relaxed font-sans">
                      {result.model_a.result.data.rekomendasi_value?.alasan}
                    </p>
                  </div>

                  {/* Pasar Niche */}
                  <div className="p-3 rounded-[18px] bg-white border border-[#e5e5e5] border-l-4 border-l-[#737373] space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono font-bold text-[#737373]">
                        Pasar Niche Pilihan
                      </span>
                      <span className="font-mono text-[#0a0a0a] font-bold">
                        Odds: {result.model_a.result.data.pasar_niche?.odds ?? "-"}
                      </span>
                    </div>
                    <p className="font-bold text-[#0a0a0a]">
                      {result.model_a.result.data.pasar_niche?.pasar}:{" "}
                      <span className="text-[#0a0a0a]">
                        {result.model_a.result.data.pasar_niche?.pilihan}
                      </span>
                    </p>
                    <p className="text-[13px] text-[#737373] leading-relaxed font-sans">
                      {result.model_a.result.data.pasar_niche?.alasan}
                    </p>
                  </div>

                  {/* Pasar Hindari */}
                  <div className="p-3 rounded-[18px] bg-[#fef2f2] border border-[#fecaca] border-l-4 border-l-[#e7000b] space-y-1">
                    <span className="text-[11px] font-mono font-bold text-[#991b1b] flex items-center gap-1.5">
                      <AlertCircleIcon size={12} className="text-[#991b1b] shrink-0" />
                      Pasar Hindari (Jebakan Bandar)
                    </span>
                    <p className="font-bold text-[#991b1b]">
                      {result.model_a.result.data.pasar_hindari?.pasar}:{" "}
                      <span className="text-[#991b1b]">
                        {result.model_a.result.data.pasar_hindari?.pilihan}
                      </span>
                    </p>
                    <p className="text-[13px] text-[#b91c1c] leading-relaxed">
                      {result.model_a.result.data.pasar_hindari?.alasan}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-[13px] text-[#991b1b]">
                  Model A gagal: {result.model_a?.result?.error || "Unknown error"}
                </p>
              )}
            </div>

            {/* MODEL B */}
            <div className="p-4 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] space-y-3">
              <div className="flex items-center justify-between pb-1">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#0a0a0a]" />
                  <h5 className="text-xs font-bold text-[#0a0a0a] font-mono">
                    Model B: {result.model_b?.model_name || result.model_b?.model || "Auditor High"}
                  </h5>
                </div>
                {result.model_b?.result?.data?.skor_keyakinan && (
                  <span className="px-2.5 py-0.5 rounded-[18px] text-[11px] font-mono bg-white border border-[#e5e5e5] text-[#0a0a0a] font-bold">
                    Keyakinan: {result.model_b.result.data.skor_keyakinan}%
                  </span>
                )}
              </div>

              {result.model_b?.result?.success && result.model_b?.result?.data ? (
                <div className="space-y-2.5 text-xs">
                  {/* Banker */}
                  <div className="p-3 rounded-[18px] bg-white border border-[#e5e5e5] border-l-4 border-l-[#0a0a0a] space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono font-bold text-[#0a0a0a]">
                        Rekomendasi Teraman (Banker)
                      </span>
                      <span className="font-mono text-[#0a0a0a] font-bold">
                        Odds: {result.model_b.result.data.rekomendasi_aman?.odds ?? "-"}
                      </span>
                    </div>
                    <p className="font-bold text-[#0a0a0a]">
                      {result.model_b.result.data.rekomendasi_aman?.pasar}:{" "}
                      <span className="text-[#0a0a0a]">
                        {result.model_b.result.data.rekomendasi_aman?.pilihan}
                      </span>
                      {result.model_b.result.data.rekomendasi_aman?.base !== undefined &&
                      result.model_b.result.data.rekomendasi_aman?.base !== null
                        ? ` (Base: ${result.model_b.result.data.rekomendasi_aman?.base})`
                        : ""}
                    </p>
                    <p className="text-[13px] text-[#737373] leading-relaxed font-sans">
                      {result.model_b.result.data.rekomendasi_aman?.alasan}
                    </p>
                  </div>

                  {/* Value Bet */}
                  <div className="p-3 rounded-[18px] bg-white border border-[#e5e5e5] border-l-4 border-l-[#0a0a0a] space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono font-bold text-[#0a0a0a]">
                        Value Bet (Expected Value)
                      </span>
                      <span className="font-mono text-[#0a0a0a] font-bold">
                        Odds: {result.model_b.result.data.rekomendasi_value?.odds ?? "-"}
                      </span>
                    </div>
                    <p className="font-bold text-[#0a0a0a]">
                      {result.model_b.result.data.rekomendasi_value?.pasar}:{" "}
                      <span className="text-[#0a0a0a]">
                        {result.model_b.result.data.rekomendasi_value?.pilihan}
                      </span>
                    </p>
                    <p className="text-[13px] text-[#737373] leading-relaxed font-sans">
                      {result.model_b.result.data.rekomendasi_value?.alasan}
                    </p>
                  </div>

                  {/* Pasar Niche */}
                  <div className="p-3 rounded-[18px] bg-white border border-[#e5e5e5] border-l-4 border-l-[#737373] space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono font-bold text-[#737373]">
                        Pasar Niche Pilihan
                      </span>
                      <span className="font-mono text-[#0a0a0a] font-bold">
                        Odds: {result.model_b.result.data.pasar_niche?.odds ?? "-"}
                      </span>
                    </div>
                    <p className="font-bold text-[#0a0a0a]">
                      {result.model_b.result.data.pasar_niche?.pasar}:{" "}
                      <span className="text-[#0a0a0a]">
                        {result.model_b.result.data.pasar_niche?.pilihan}
                      </span>
                    </p>
                    <p className="text-[13px] text-[#737373] leading-relaxed font-sans">
                      {result.model_b.result.data.pasar_niche?.alasan}
                    </p>
                  </div>

                  {/* Pasar Hindari */}
                  <div className="p-3 rounded-[18px] bg-[#fef2f2] border border-[#fecaca] border-l-4 border-l-[#e7000b] space-y-1">
                    <span className="text-[11px] font-mono font-bold text-[#991b1b] flex items-center gap-1.5">
                      <AlertCircleIcon size={12} className="text-[#991b1b] shrink-0" />
                      Pasar Hindari (Jebakan Bandar)
                    </span>
                    <p className="font-bold text-[#991b1b]">
                      {result.model_b.result.data.pasar_hindari?.pasar}:{" "}
                      <span className="text-[#991b1b]">
                        {result.model_b.result.data.pasar_hindari?.pilihan}
                      </span>
                    </p>
                    <p className="text-[13px] text-[#b91c1c] leading-relaxed">
                      {result.model_b.result.data.pasar_hindari?.alasan}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-[13px] text-[#991b1b]">
                  Model B gagal: {result.model_b?.result?.error || "Unknown error"}
                </p>
              )}
            </div>
          </div>

          {/* Sample Live Markets Snapshot */}
          {result.sample_markets && result.sample_markets.length > 0 && (
            <details className="p-4 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] text-xs">
              <summary className="font-bold text-[#737373] hover:text-[#0a0a0a] cursor-pointer font-mono">
                Lihat Snapshot Garis Pasar 1xBet Langsung ({result.sample_markets.length} Pasar Populer)
              </summary>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-1">
                {result.sample_markets.map((sm: Market1xBetV2) => (
                  <div key={sm.market_id} className="p-3 rounded-[18px] bg-white border border-[#e5e5e5] space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold text-[#0a0a0a] truncate">{sm.name}</span>
                      {sm.base !== null && (
                        <span className="text-[#737373] font-mono">({sm.base})</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap text-[11px] font-mono">
                      {Object.entries(sm.odds || {}).map(([outcome, odd]) => (
                        <span
                          key={outcome}
                          className="px-2 py-0.5 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] text-[#0a0a0a]"
                        >
                          {outcome}: <strong className="text-[#0a0a0a] font-bold">{odd}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
