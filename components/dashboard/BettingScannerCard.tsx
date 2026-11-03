"use client";

import React from "react";
import { RefreshCwIcon, AlertCircleIcon, ScaleIcon, TrendingUpIcon } from "@/components/icons";
import type { Market1xBetV2 } from "@/lib/1xbet";
import type { BettingResult1xBet, BettingScannerModelSlot } from "./types";

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

/* Satu tampilan untuk Model A & B — perilaku identik, duplikasi JSX disatukan. */
function ModelAdvicePanel({
  model,
  fallbackName,
}: {
  model?: BettingScannerModelSlot | null;
  fallbackName: string;
}) {
  const data = model?.result?.success ? model.result.data : null;
  return (
    <div className="p-4 rounded-[18px] bg-[#1b1b29] border border-[#262636] space-y-3">
      <div className="flex items-center justify-between pb-1">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#b8b0ff]" />
          <h5 className="text-xs font-bold text-[#f4f4f6] font-sans">
            {model?.model_name || model?.model || fallbackName}
          </h5>
        </div>
        {data?.skor_keyakinan && (
          <span className="px-2.5 py-0.5 rounded-[18px] text-[11px] font-sans bg-[#14141f] border border-[#262636] text-[#f4f4f6] font-bold">
            Keyakinan: {data.skor_keyakinan}%
          </span>
        )}
      </div>

      {data ? (
        <div className="space-y-2.5 text-xs">
          {/* Banker */}
          <div className="p-3 rounded-[18px] bg-[#14141f] border border-[#262636] border-l-4 border-l-[#b8b0ff] space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-sans font-bold text-[#f4f4f6]">
                Rekomendasi Teraman (Banker)
              </span>
              <span className="font-sans text-[#f4f4f6] font-bold">
                Odds: {data.rekomendasi_aman?.odds ?? "-"}
              </span>
            </div>
            <p className="font-bold text-[#f4f4f6]">
              {data.rekomendasi_aman?.pasar}:{" "}
              <span className="text-[#f4f4f6]">
                {data.rekomendasi_aman?.pilihan}
              </span>
              {data.rekomendasi_aman?.base !== undefined &&
              data.rekomendasi_aman?.base !== null
                ? ` (Base: ${data.rekomendasi_aman?.base})`
                : ""}
            </p>
            <p className="text-[13px] text-[#a2a2b5] leading-relaxed font-sans">
              {data.rekomendasi_aman?.alasan}
            </p>
          </div>

          {/* Value Bet */}
          <div className="p-3 rounded-[18px] bg-[#14141f] border border-[#262636] border-l-4 border-l-[#b8b0ff] space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-sans font-bold text-[#f4f4f6]">
                Value Bet (Expected Value)
              </span>
              <span className="font-sans text-[#f4f4f6] font-bold">
                Odds: {data.rekomendasi_value?.odds ?? "-"}
              </span>
            </div>
            <p className="font-bold text-[#f4f4f6]">
              {data.rekomendasi_value?.pasar}:{" "}
              <span className="text-[#f4f4f6]">
                {data.rekomendasi_value?.pilihan}
              </span>
            </p>
            <p className="text-[13px] text-[#a2a2b5] leading-relaxed font-sans">
              {data.rekomendasi_value?.alasan}
            </p>
          </div>

          {/* Pasar Niche */}
          <div className="p-3 rounded-[18px] bg-[#14141f] border border-[#262636] border-l-4 border-l-[#4a4a61] space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-sans font-bold text-[#a2a2b5]">
                Pasar Niche Pilihan
              </span>
              <span className="font-sans text-[#f4f4f6] font-bold">
                Odds: {data.pasar_niche?.odds ?? "-"}
              </span>
            </div>
            <p className="font-bold text-[#f4f4f6]">
              {data.pasar_niche?.pasar}:{" "}
              <span className="text-[#f4f4f6]">
                {data.pasar_niche?.pilihan}
              </span>
            </p>
            <p className="text-[13px] text-[#a2a2b5] leading-relaxed font-sans">
              {data.pasar_niche?.alasan}
            </p>
          </div>

          {/* Pasar Hindari */}
          <div className="p-3 rounded-[18px] bg-[#2a161c] border border-[#5c2430] border-l-4 border-l-[#fb4d5e] space-y-1">
            <span className="text-[11px] font-sans font-bold text-[#fda4af] flex items-center gap-1.5">
              <AlertCircleIcon size={12} className="text-[#fda4af] shrink-0" />
              Pasar Hindari (Jebakan Bandar)
            </span>
            <p className="font-bold text-[#fda4af]">
              {data.pasar_hindari?.pasar}:{" "}
              <span className="text-[#fda4af]">
                {data.pasar_hindari?.pilihan}
              </span>
            </p>
            <p className="text-[13px] text-[#fda4af] leading-relaxed">
              {data.pasar_hindari?.alasan}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-[13px] text-[#fda4af]">
          Model gagal: {model?.result?.error || "Unknown error"}
        </p>
      )}
    </div>
  );
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
    <div className="p-6 rounded-[18px] bg-[#14141f] border border-[#262636] space-y-5 text-[#f4f4f6]">
      {/* Scanner Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUpIcon size={15} className="text-[#f4f4f6]" />
            <h4 className="text-xs sm:text-sm font-bold text-[#f4f4f6] font-sans tracking-tight">
              1xBet Market Scanner &amp; Dual-Model AI Intelligence
            </h4>
          </div>
          <p className="text-[13px] text-[#a2a2b5] mt-1 leading-relaxed max-w-2xl font-sans">
            Pindai bursa taruhan 1xBet (scan manual, kuota terbatas) dianalisis bersama model quant{" "}
            <span className="text-[#f4f4f6] font-semibold">bai/qwen3.8-27b</span> &amp; bai/deepseek-v4.1-flash.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onTriggerScan()}
            disabled={loading}
            className="px-3.5 py-2 rounded-[18px] bg-[#b8b0ff] hover:bg-[#b8b0ff] text-xs font-semibold text-[#17131f] transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            {loading ? (
              <>
                <RefreshCwIcon size={12} className="animate-spin" />
                <span>Memindai Pasar...</span>
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
            className="px-3 py-2 rounded-[18px] bg-[#14141f] hover:bg-[#1b1b29] text-xs font-sans text-[#f4f4f6] border border-[#262636] transition-colors cursor-pointer"
            title="Atur ID Laga 1xBet Manual"
          >
            Manual ID
          </button>
        </div>
      </div>

      {/* Manual Match ID Input Toggle */}
      {showManualInput && (
        <div className="p-3.5 rounded-[18px] bg-[#1b1b29] border border-[#262636] flex flex-col sm:flex-row items-stretch sm:items-center gap-2 text-xs">
          <span className="text-[#a2a2b5] shrink-0 font-sans">1xBet Match ID:</span>
          <input
            type="text"
            placeholder="Contoh: 751762591"
            aria-label="Masukkan ID pertandingan 1xBet"
            value={manualId}
            onChange={(e) => onManualIdChange(e.target.value)}
            className="flex-1 bg-[#14141f] text-[#f4f4f6] px-3.5 py-1.5 rounded-[18px] border border-[#262636] font-sans text-[13px] focus:outline-none focus:border-[#b8b0ff]"
          />
          <button
            onClick={() => onTriggerScan(manualId.trim())}
            disabled={loading || !manualId.trim()}
            className="px-4 py-1.5 rounded-[18px] bg-[#b8b0ff] hover:bg-[#b8b0ff] text-[#17131f] font-medium disabled:opacity-50 cursor-pointer"
          >
            Scan ID Ini
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="p-8 text-center space-y-3 rounded-[18px] bg-[#1b1b29] border border-[#262636]">
          <div className="inline-block w-6 h-6 border-2 border-[#262636] border-t-[#0a0a0a] rounded-full animate-spin" />
          <p className="text-[13px] text-[#f4f4f6] font-semibold">
            Menghubungkan ke 1xBet API &amp; mengambil baris pasar...
          </p>
          <p className="text-[13px] text-[#a2a2b5] font-sans">
            Menjalankan penalaran kuantitatif di VPS 9Router (bai/qwen3.8-27b + bai/deepseek-v4.1-flash)
          </p>
        </div>
      )}

      {/* Error Callout */}
      {error && !loading && (
        <div className="p-4 rounded-[18px] bg-[#2a161c] border border-[#5c2430] text-xs space-y-2">
          <div className="flex items-start gap-2.5">
            <AlertCircleIcon size={16} className="text-[#fb4d5e] shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-[13px] text-[#fda4af]">{error}</p>
              <p className="text-[13px] text-[#fda4af] mt-0.5 leading-relaxed">
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
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-[18px] bg-[#1b1b29] border border-[#262636] text-[11px] font-sans text-[#a2a2b5]">
            <div className="flex items-center gap-3">
              <span className="text-[#a2a2b5]">1xBet ID:</span>
              <span className="text-[#f4f4f6] font-bold">{result.match_id_1xbet}</span>
              <span className="text-[#262636]">|</span>
              <span className="text-[#a2a2b5]">Total Pasar:</span>
              <span className="text-[#f4f4f6] font-bold">{result.total_markets_scanned} Lines</span>
            </div>
            <span className="px-2.5 py-0.5 rounded-[18px] bg-[#14141f] border border-[#262636] text-[#f4f4f6] text-[11px] font-bold">
              Cache 60 Min
            </span>
          </div>

          {/* Consensus Summary Box */}
          {result.consensus && (
            <div className="p-4 rounded-[18px] text-xs flex items-start gap-3 border bg-[#1b1b29] border-[#262636]">
              <ScaleIcon size={16} className="shrink-0 mt-0.5 text-[#f4f4f6]" />
              <div className="space-y-0.5">
                <h5 className="font-bold text-[#f4f4f6] font-sans text-[11px]">
                  Sintesis Konsensus Dual-Model
                </h5>
                <p className="text-[13px] text-[#a2a2b5] leading-relaxed font-sans">
                  {result.consensus.summary}
                </p>
              </div>
            </div>
          )}

          {/* Side-by-Side Comparison Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
            {/* MODEL A */}
            <ModelAdvicePanel model={result.model_a} fallbackName="Scanner" />

            {/* MODEL B */}
            <ModelAdvicePanel model={result.model_b} fallbackName="Auditor High" />
          </div>

          {/* Sample Markets Snapshot (hasil pindaian) */}
          {result.sample_markets && result.sample_markets.length > 0 && (
            <details className="p-4 rounded-[18px] bg-[#1b1b29] border border-[#262636] text-xs">
              <summary className="font-bold text-[#a2a2b5] hover:text-[#f4f4f6] cursor-pointer font-sans">
                Lihat Snapshot Garis Pasar 1xBet ({result.sample_markets.length} Pasar Populer)
              </summary>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-1">
                {result.sample_markets.map((sm: Market1xBetV2) => (
                  <div key={sm.market_id} className="p-3 rounded-[18px] bg-[#14141f] border border-[#262636] space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold text-[#f4f4f6] truncate">{sm.name}</span>
                      {sm.base !== null && (
                        <span className="text-[#a2a2b5] font-sans">({sm.base})</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap text-[11px] font-sans">
                      {Object.entries(sm.odds || {}).map(([outcome, odd]) => (
                        <span
                          key={outcome}
                          className="px-2 py-0.5 rounded-[18px] bg-[#1b1b29] border border-[#262636] text-[#f4f4f6]"
                        >
                          {outcome}: <strong className="text-[#f4f4f6] font-bold">{odd}</strong>
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
