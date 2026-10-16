"use client";

import React from "react";
import { Analisis } from "./types";
import { formatWib } from "./utils";
import {
  WhistleIcon,
  ActivityIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  RefreshCwIcon,
  SparklesIcon,
} from "@/components/icons";

interface MatchHeaderCardProps {
  data: Analisis;
  onBack: () => void;
  onRefreshOdds?: () => void;
  onRerunAnalysis?: () => void;
  refreshingOdds?: boolean;
  rerunningAnalysis?: boolean;
}

export function MatchHeaderCard({
  data,
  onBack,
  onRefreshOdds,
  onRerunAnalysis,
  refreshingOdds = false,
  rerunningAnalysis = false,
}: MatchHeaderCardProps) {
  const p = data.pertandingan;
  const pred = data.prediksi;
  const dc = data.quant_engine?.dixon_coles;

  return (
    <div className="space-y-3">
      {/* Top Action Navigation Bar */}
      <div className="flex items-center justify-between gap-3">
        {/* Back Button */}
        <button
          onClick={onBack}
          className="group inline-flex items-center gap-2 px-3.5 py-1.5 rounded-[18px] bg-white hover:bg-[#fafafa] border border-[#e5e5e5] text-xs font-mono text-[#0a0a0a] transition-colors cursor-pointer shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
        >
          <span className="text-[#737373] group-hover:-translate-x-0.5 transition-transform">←</span>
          <span>Cari Laga Lain</span>
        </button>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {onRefreshOdds && (
            <button
              onClick={onRefreshOdds}
              disabled={refreshingOdds}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[18px] bg-white hover:bg-[#fafafa] border border-[#e5e5e5] text-xs font-mono text-[#0a0a0a] transition-colors cursor-pointer disabled:opacity-50 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
              title="Perbarui data odds bursa"
            >
              <RefreshCwIcon size={12} className={refreshingOdds ? "animate-spin" : ""} />
              <span className="hidden sm:inline">Refresh Odds</span>
            </button>
          )}

          {onRerunAnalysis && (
            <button
              onClick={onRerunAnalysis}
              disabled={rerunningAnalysis}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[18px] bg-[#0a0a0a] hover:bg-[#171717] text-xs font-mono text-white font-medium transition-colors cursor-pointer disabled:opacity-50 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
              title="Bedah ulang laga ini dengan AI"
            >
              <SparklesIcon size={12} className={rerunningAnalysis ? "animate-spin" : ""} />
              <span>Analisis Ulang</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Header Card with Double-Bezel (Doppelrand) Architecture */}
      <div className="doppel-shell">
        <div className="doppel-core space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-[18px] text-[11px] font-mono flat-tag-zinc font-semibold uppercase tracking-wider">
                  {p.kompetisi}
                </span>
                <span className="text-xs font-mono text-[#737373] flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0a0a0a]" />
                  {formatWib(p.waktu)}
                </span>
              </div>

              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#0a0a0a]">
                {p.tim_kandang} <span className="text-[#737373] font-light text-xl sm:text-2xl">vs</span> {p.tim_tamu}
              </h1>

              {p.venue && (
                <p className="text-xs text-[#737373] flex items-center gap-1.5 font-mono">
                  <span className="text-[#a1a1aa]">VENUE:</span>
                  <span className="text-[#171717]">{p.venue}</span>
                </p>
              )}
            </div>

            {/* Quick Result Projection Pill */}
            <div className="shrink-0">
              <div className="p-3.5 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] space-y-1.5 min-w-[200px]">
                <div className="flex items-center justify-between text-[10px] font-mono text-[#737373] uppercase tracking-wider">
                  <span>Proyeksi Utama</span>
                  <ActivityIcon size={12} className="text-[#0a0a0a]" />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[#0a0a0a] font-mono tracking-tight">
                    {pred.hasil}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-[18px] text-[10px] font-mono uppercase font-bold ${
                      pred.keyakinan === "tinggi"
                        ? "flat-tag-white"
                        : pred.keyakinan === "sedang"
                        ? "flat-tag-amber"
                        : "flat-tag-slate"
                    }`}
                  >
                    {pred.keyakinan}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Telemetry Properties Inset Grid */}
          <div className="pt-3 border-t border-[#e5e5e5] grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono tabular-nums">
            <div className="p-3 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5]">
              <span className="text-[10px] text-[#737373] uppercase block">Status Lineup</span>
              <span
                className={`font-semibold capitalize flex items-center gap-1.5 mt-0.5 text-[#0a0a0a]`}
              >
                {data.taktik_dan_lineup.status_lineup === "resmi" ? (
                  <CheckCircleIcon size={12} className="text-[#0a0a0a]" />
                ) : (
                  <AlertCircleIcon size={12} className="text-[#737373]" />
                )}
                <span>{data.taktik_dan_lineup.status_lineup}</span>
              </span>
            </div>

            <div className="p-3 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5]">
              <span className="text-[10px] text-[#737373] uppercase block">Wasit Utama</span>
              <span className="text-[#0a0a0a] font-medium truncate block mt-0.5 flex items-center gap-1.5">
                <WhistleIcon size={12} className="text-[#737373] shrink-0" />
                <span className="truncate">{data.wasit_analisis.nama || "Belum Ditunjuk"}</span>
              </span>
            </div>

            <div className="p-3 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5]">
              <span className="text-[10px] text-[#737373] uppercase block">Avg Kartu / Laga</span>
              <span className="text-[#0a0a0a] font-semibold block mt-0.5">
                {data.wasit_analisis.rata_rata_kartu ?? "-"} Kartu
              </span>
            </div>

            <div className="p-3 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5]">
              <span className="text-[10px] text-[#737373] uppercase block">Dixon-Coles Target</span>
              <span className="text-[#0a0a0a] font-semibold block mt-0.5">
                {dc ? `${dc.lambda_home_xg.toFixed(2)} vs ${dc.mu_away_xg.toFixed(2)} xG` : "-"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
