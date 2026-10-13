"use client";

import React from "react";
import { RefreshCwIcon, AlertCircleIcon } from "@/components/icons";

interface BettingScannerCardProps {
  loading: boolean;
  error: string | null;
  result: any | null;
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
  homeTeam,
  awayTeam,
}: BettingScannerCardProps) {
  return (
    <div className="flat-card-static p-4 sm:p-5 space-y-4">
      {/* Scanner Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#2d3748]">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base">🎲</span>
            <h4 className="text-xs sm:text-sm font-bold text-[#f0f6fc]">
              1xBet Market Scanner &amp; Dual-Model AI Intelligence
            </h4>
          </div>
          <p className="text-xs text-[#8b949e] mt-1 leading-relaxed max-w-2xl">
            Pindai 500+ baris data bursa taruhan 1xBet RapidAPI dianalisis bersama model quant{" "}
            <span className="text-[#38bdf8] font-mono font-medium">oc/muse-spark-1.3-contributor-free</span> &amp; Gemini 3.8.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onTriggerScan()}
            disabled={loading}
            className="px-3 py-1.5 rounded-md bg-[#16a34a] hover:bg-[#15803d] text-xs font-semibold text-white transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            {loading ? (
              <>
                <RefreshCwIcon size={12} className="animate-spin" />
                <span>Scanning 500+ Baris...</span>
              </>
            ) : (
              <>
                <span>🎲</span>
                <span>Scan Pasar 1xBet &amp; Analisis AI</span>
              </>
            )}
          </button>

          <button
            onClick={onToggleManualInput}
            className="px-2.5 py-1.5 rounded-md bg-[#0d1117] hover:bg-[#21262d] text-xs text-[#8b949e] hover:text-[#f0f6fc] border border-[#2d3748] transition-colors"
            title="Atur ID Laga 1xBet Manual"
          >
            ⚙️ Manual ID
          </button>
        </div>
      </div>

      {/* Manual Match ID Input Toggle */}
      {showManualInput && (
        <div className="p-3 rounded-md bg-[#0d1117] border border-[#2d3748] flex flex-col sm:flex-row items-stretch sm:items-center gap-2 text-xs">
          <span className="text-[#8b949e] shrink-0 font-mono">1xBet Match ID:</span>
          <input
            type="text"
            placeholder="Contoh: 751762591"
            value={manualId}
            onChange={(e) => onManualIdChange(e.target.value)}
            className="flex-1 bg-[#161b22] text-[#f0f6fc] px-2.5 py-1 rounded border border-[#2d3748] font-mono text-xs focus:outline-none focus:border-[#38bdf8]"
          />
          <button
            onClick={() => onTriggerScan(manualId.trim())}
            disabled={loading || !manualId.trim()}
            className="px-3 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#f0f6fc] font-medium disabled:opacity-50"
          >
            Scan ID Ini
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="p-6 text-center space-y-3 rounded-md bg-[#0d1117] border border-[#2d3748]">
          <div className="inline-block w-6 h-6 border-2 border-[#2d3748] border-t-[#22c55e] rounded-full animate-spin" />
          <p className="text-xs text-[#f0f6fc] font-semibold">
            Menghubungkan ke 1xBet API &amp; Mengambil 500+ Baris Pasar...
          </p>
          <p className="text-[11px] text-[#8b949e] font-mono">
            Menjalankan penalaran kuantitatif di VPS 9Router (Muse Spark 1.3 Contributor Free)
          </p>
        </div>
      )}

      {/* Error Callout */}
      {error && !loading && (
        <div className="flat-callout border-[#542022] bg-[#241315] text-[#f87171] text-xs space-y-2">
          <div className="flex items-start gap-2.5">
            <AlertCircleIcon size={16} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-xs text-[#f87171]">{error}</p>
              <p className="text-[11px] text-[#fca5a5] mt-0.5 leading-relaxed">
                Tips: Buka situs 1xBet di browser atau gunakan tombol "Manual ID" di atas untuk memasukkan ID laga secara langsung.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Result Display: Dual Model Comparison Board */}
      {result && !loading && (
        <div className="space-y-4 pt-1">
          {/* Telemetry Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-md bg-[#0d1117] border border-[#2d3748] text-[11px] font-mono">
            <div className="flex items-center gap-3">
              <span className="text-[#8b949e]">1xBet ID:</span>
              <span className="text-[#f0f6fc] font-bold">{result.match_id_1xbet}</span>
              <span className="text-[#475569]">|</span>
              <span className="text-[#8b949e]">Total Pasar:</span>
              <span className="text-[#22c55e] font-bold">{result.total_markets_scanned} Lines</span>
            </div>
            <span className="px-2 py-0.5 rounded flat-tag-green text-[10px]">
              Cache 60 Min
            </span>
          </div>

          {/* Consensus Summary Box */}
          {result.consensus && (
            <div
              className={`p-3.5 rounded-md text-xs flex items-start gap-2.5 border ${
                result.consensus.agreed
                  ? "border-[#1e4a32] bg-[#101f16]"
                  : "border-[#2d3748] bg-[#0d1117]"
              }`}
            >
              <span className="text-base shrink-0 mt-0.5">
                {result.consensus.agreed ? "🤝" : "⚖️"}
              </span>
              <div className="space-y-0.5">
                <h5 className="font-bold text-[#f0f6fc]">
                  Sintesis Konsensus Dual-Model
                </h5>
                <p className="text-xs text-[#cbd5e1] leading-relaxed">
                  {result.consensus.summary}
                </p>
              </div>
            </div>
          )}

          {/* Side-by-Side Comparison Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
            {/* MODEL A */}
            <div className="p-4 rounded-md bg-[#0d1117] border border-[#383162] space-y-3">
              <div className="flex items-center justify-between pb-2.5 border-b border-[#2d3748]">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#818cf8]" />
                  <h5 className="text-xs font-bold text-[#818cf8] font-mono uppercase">
                    Model A: {result.model_a?.model_name || result.model_a?.model || "Scanner"}
                  </h5>
                </div>
                {result.model_a?.result?.data?.skor_keyakinan && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono flat-tag-purple">
                    Keyakinan: {result.model_a.result.data.skor_keyakinan}%
                  </span>
                )}
              </div>

              {result.model_a?.result?.success && result.model_a?.result?.data ? (
                <div className="space-y-2.5 text-xs">
                  {/* Banker */}
                  <div className="p-2.5 rounded bg-[#161b22] border-l-2 border-[#16a34a] space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono font-bold text-[#22c55e] uppercase">
                        🟢 Rekomendasi Teraman (Banker)
                      </span>
                      <span className="font-mono text-[#f0f6fc] font-bold">
                        Odds: {result.model_a.result.data.rekomendasi_aman?.odds ?? "-"}
                      </span>
                    </div>
                    <p className="font-bold text-[#f0f6fc]">
                      {result.model_a.result.data.rekomendasi_aman?.pasar}:{" "}
                      <span className="text-[#22c55e]">
                        {result.model_a.result.data.rekomendasi_aman?.pilihan}
                      </span>
                      {result.model_a.result.data.rekomendasi_aman?.base !== undefined &&
                      result.model_a.result.data.rekomendasi_aman?.base !== null
                        ? ` (Base: ${result.model_a.result.data.rekomendasi_aman?.base})`
                        : ""}
                    </p>
                    <p className="text-[11px] text-[#8b949e] leading-relaxed">
                      {result.model_a.result.data.rekomendasi_aman?.alasan}
                    </p>
                  </div>

                  {/* Value Bet */}
                  <div className="p-2.5 rounded bg-[#161b22] border-l-2 border-[#0284c7] space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono font-bold text-[#38bdf8] uppercase">
                        💎 Value Bet (Expected Value)
                      </span>
                      <span className="font-mono text-[#f0f6fc] font-bold">
                        Odds: {result.model_a.result.data.rekomendasi_value?.odds ?? "-"}
                      </span>
                    </div>
                    <p className="font-bold text-[#f0f6fc]">
                      {result.model_a.result.data.rekomendasi_value?.pasar}:{" "}
                      <span className="text-[#38bdf8]">
                        {result.model_a.result.data.rekomendasi_value?.pilihan}
                      </span>
                    </p>
                    <p className="text-[11px] text-[#8b949e] leading-relaxed">
                      {result.model_a.result.data.rekomendasi_value?.alasan}
                    </p>
                  </div>

                  {/* Pasar Niche */}
                  <div className="p-2.5 rounded bg-[#161b22] border-l-2 border-[#d97706] space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono font-bold text-[#fbbf24] uppercase">
                        🎯 Pasar Niche Pilihan
                      </span>
                      <span className="font-mono text-[#f0f6fc] font-bold">
                        Odds: {result.model_a.result.data.pasar_niche?.odds ?? "-"}
                      </span>
                    </div>
                    <p className="font-bold text-[#f0f6fc]">
                      {result.model_a.result.data.pasar_niche?.pasar}:{" "}
                      <span className="text-[#fbbf24]">
                        {result.model_a.result.data.pasar_niche?.pilihan}
                      </span>
                    </p>
                    <p className="text-[11px] text-[#8b949e] leading-relaxed">
                      {result.model_a.result.data.pasar_niche?.alasan}
                    </p>
                  </div>

                  {/* Pasar Hindari */}
                  <div className="p-2.5 rounded bg-[#161b22] border-l-2 border-[#dc2626] space-y-1">
                    <span className="text-[10px] font-mono font-bold text-[#f87171] uppercase block">
                      ⚠️ Pasar Hindari (Jebakan Bandar)
                    </span>
                    <p className="font-bold text-[#f0f6fc]">
                      {result.model_a.result.data.pasar_hindari?.pasar}:{" "}
                      <span className="text-[#f87171]">
                        {result.model_a.result.data.pasar_hindari?.pilihan}
                      </span>
                    </p>
                    <p className="text-[11px] text-[#8b949e] leading-relaxed">
                      {result.model_a.result.data.pasar_hindari?.alasan}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-[#f87171]">
                  Model A gagal: {result.model_a?.result?.error || "Unknown error"}
                </p>
              )}
            </div>

            {/* MODEL B */}
            <div className="p-4 rounded-md bg-[#0d1117] border border-[#1e3e60] space-y-3">
              <div className="flex items-center justify-between pb-2.5 border-b border-[#2d3748]">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#38bdf8]" />
                  <h5 className="text-xs font-bold text-[#38bdf8] font-mono uppercase">
                    Model B: {result.model_b?.model_name || result.model_b?.model || "Auditor High"}
                  </h5>
                </div>
                {result.model_b?.result?.data?.skor_keyakinan && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono flat-tag-blue">
                    Keyakinan: {result.model_b.result.data.skor_keyakinan}%
                  </span>
                )}
              </div>

              {result.model_b?.result?.success && result.model_b?.result?.data ? (
                <div className="space-y-2.5 text-xs">
                  {/* Banker */}
                  <div className="p-2.5 rounded bg-[#161b22] border-l-2 border-[#16a34a] space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono font-bold text-[#22c55e] uppercase">
                        🟢 Rekomendasi Teraman (Banker)
                      </span>
                      <span className="font-mono text-[#f0f6fc] font-bold">
                        Odds: {result.model_b.result.data.rekomendasi_aman?.odds ?? "-"}
                      </span>
                    </div>
                    <p className="font-bold text-[#f0f6fc]">
                      {result.model_b.result.data.rekomendasi_aman?.pasar}:{" "}
                      <span className="text-[#22c55e]">
                        {result.model_b.result.data.rekomendasi_aman?.pilihan}
                      </span>
                      {result.model_b.result.data.rekomendasi_aman?.base !== undefined &&
                      result.model_b.result.data.rekomendasi_aman?.base !== null
                        ? ` (Base: ${result.model_b.result.data.rekomendasi_aman?.base})`
                        : ""}
                    </p>
                    <p className="text-[11px] text-[#8b949e] leading-relaxed">
                      {result.model_b.result.data.rekomendasi_aman?.alasan}
                    </p>
                  </div>

                  {/* Value Bet */}
                  <div className="p-2.5 rounded bg-[#161b22] border-l-2 border-[#0284c7] space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono font-bold text-[#38bdf8] uppercase">
                        💎 Value Bet (Expected Value)
                      </span>
                      <span className="font-mono text-[#f0f6fc] font-bold">
                        Odds: {result.model_b.result.data.rekomendasi_value?.odds ?? "-"}
                      </span>
                    </div>
                    <p className="font-bold text-[#f0f6fc]">
                      {result.model_b.result.data.rekomendasi_value?.pasar}:{" "}
                      <span className="text-[#38bdf8]">
                        {result.model_b.result.data.rekomendasi_value?.pilihan}
                      </span>
                    </p>
                    <p className="text-[11px] text-[#8b949e] leading-relaxed">
                      {result.model_b.result.data.rekomendasi_value?.alasan}
                    </p>
                  </div>

                  {/* Pasar Niche */}
                  <div className="p-2.5 rounded bg-[#161b22] border-l-2 border-[#d97706] space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono font-bold text-[#fbbf24] uppercase">
                        🎯 Pasar Niche Pilihan
                      </span>
                      <span className="font-mono text-[#f0f6fc] font-bold">
                        Odds: {result.model_b.result.data.pasar_niche?.odds ?? "-"}
                      </span>
                    </div>
                    <p className="font-bold text-[#f0f6fc]">
                      {result.model_b.result.data.pasar_niche?.pasar}:{" "}
                      <span className="text-[#fbbf24]">
                        {result.model_b.result.data.pasar_niche?.pilihan}
                      </span>
                    </p>
                    <p className="text-[11px] text-[#8b949e] leading-relaxed">
                      {result.model_b.result.data.pasar_niche?.alasan}
                    </p>
                  </div>

                  {/* Pasar Hindari */}
                  <div className="p-2.5 rounded bg-[#161b22] border-l-2 border-[#dc2626] space-y-1">
                    <span className="text-[10px] font-mono font-bold text-[#f87171] uppercase block">
                      ⚠️ Pasar Hindari (Jebakan Bandar)
                    </span>
                    <p className="font-bold text-[#f0f6fc]">
                      {result.model_b.result.data.pasar_hindari?.pasar}:{" "}
                      <span className="text-[#f87171]">
                        {result.model_b.result.data.pasar_hindari?.pilihan}
                      </span>
                    </p>
                    <p className="text-[11px] text-[#8b949e] leading-relaxed">
                      {result.model_b.result.data.pasar_hindari?.alasan}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-[#f87171]">
                  Model B gagal: {result.model_b?.result?.error || "Unknown error"}
                </p>
              )}
            </div>
          </div>

          {/* Sample Live Markets Snapshot */}
          {result.sample_markets && result.sample_markets.length > 0 && (
            <details className="p-3 rounded-md bg-[#0d1117] border border-[#2d3748] text-xs">
              <summary className="font-bold text-[#8b949e] hover:text-[#f0f6fc] cursor-pointer font-mono">
                📊 Lihat Snapshot Garis Pasar 1xBet Langsung ({result.sample_markets.length} Pasar Populer)
              </summary>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-2 border-t border-[#2d3748]">
                {result.sample_markets.map((sm: any, idx: number) => (
                  <div key={idx} className="p-2.5 rounded bg-[#161b22] border border-[#2d3748] space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold text-[#f0f6fc] truncate">{sm.name}</span>
                      {sm.base !== null && (
                        <span className="text-[#8b949e] font-mono">({sm.base})</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-mono">
                      {Object.entries(sm.odds || {}).map(([outcome, odd]: any) => (
                        <span
                          key={outcome}
                          className="px-1.5 py-0.5 rounded bg-[#0d1117] border border-[#2d3748] text-[#cbd5e1]"
                        >
                          {outcome}: <strong className="text-[#22c55e]">{odd}</strong>
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
