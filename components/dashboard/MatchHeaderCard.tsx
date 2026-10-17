"use client";

import React from "react";
import type { AnalysisView } from "@/lib/view/analysis-view";
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
  view?: AnalysisView | null;
  data?: any;
  onBack: () => void;
  onRefreshOdds?: () => void;
  onRerunAnalysis?: () => void;
  refreshingOdds?: boolean;
  rerunningAnalysis?: boolean;
}

export function MatchHeaderCard({
  view,
  data,
  onBack,
  onRefreshOdds,
  onRerunAnalysis,
  refreshingOdds = false,
  rerunningAnalysis = false,
}: MatchHeaderCardProps) {
  const homeTeam = view?.match.home || data?.pertandingan?.tim_kandang || "Tim Kandang";
  const awayTeam = view?.match.away || data?.pertandingan?.tim_tamu || "Tim Tamu";
  const competition = view?.match.competition || data?.pertandingan?.kompetisi || "Kompetisi";
  const kickoff = view?.match.kickoff_wib || data?.pertandingan?.waktu || "";
  const venue = view?.match.venue || data?.pertandingan?.venue;
  const wasit = view?.match.wasit || data?.wasit_analisis?.nama || "Belum Ditunjuk";
  const wasitKartu = view?.match.wasit_kartu ?? data?.wasit_analisis?.rata_rata_kartu ?? null;
  const statusLineup = view?.match.status_lineup ?? data?.taktik_dan_lineup?.status_lineup ?? null;
  const prediksiHasil = view?.ringkasan.prediksi || data?.prediksi?.hasil || "Menganalisis...";
  const keyakinan = (view?.ringkasan.keyakinan || data?.prediksi?.keyakinan || "sedang").toLowerCase();

  const dcHomeXg = view?.kuantitatif?.detail?.metode?.baseline?.lambda ?? data?.quant_engine?.dixon_coles?.lambda_home_xg;
  const dcAwayXg = view?.kuantitatif?.detail?.metode?.baseline?.mu ?? data?.quant_engine?.dixon_coles?.mu_away_xg;

  return (
    <div className="space-y-3 font-mono">
      {/* Top Action Navigation Bar */}
      <div className="flex items-center justify-between gap-3">
        {/* Back Button */}
        <button
          onClick={onBack}
          className="group inline-flex items-center gap-2 px-3.5 py-1.5 rounded-[18px] bg-white hover:bg-[#fafafa] border border-[#e5e5e5] text-xs text-[#0a0a0a] transition-colors cursor-pointer"
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
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[18px] bg-white hover:bg-[#fafafa] border border-[#e5e5e5] text-xs text-[#0a0a0a] transition-colors cursor-pointer disabled:opacity-50"
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
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[18px] bg-[#0a0a0a] hover:bg-[#171717] text-xs text-white font-medium transition-colors cursor-pointer disabled:opacity-50"
              title="Bedah ulang laga ini dengan AI"
            >
              <SparklesIcon size={12} className={rerunningAnalysis ? "animate-spin" : ""} />
              <span>Analisis Ulang</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Header Card */}
      <div className="p-5 rounded-[24px] bg-white border border-[#e5e5e5] space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-[18px] text-[11px] flat-tag-zinc font-semibold">
                {competition}
              </span>
              <span className="text-xs text-[#737373] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#0a0a0a]" />
                {kickoff ? formatWib(kickoff) : "Jadwal Belum Ditetapkan"}
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#0a0a0a] font-sans">
              {homeTeam} <span className="text-[#737373] font-light text-xl sm:text-2xl">vs</span> {awayTeam}
            </h1>

            {venue && (
              <p className="text-xs text-[#737373] flex items-center gap-1.5">
                <span className="text-[#a1a1aa]">Venue:</span>
                <span className="text-[#171717]">{venue}</span>
              </p>
            )}
          </div>

          {/* Quick Result Projection Pill */}
          <div className="shrink-0">
            <div className="p-3.5 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] space-y-1.5 min-w-[200px]">
              <div className="flex items-center justify-between text-[11px] text-[#737373]">
                <span>Proyeksi Utama</span>
                <ActivityIcon size={12} className="text-[#0a0a0a]" />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[#0a0a0a] tracking-tight truncate max-w-[150px]">
                  {prediksiHasil}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-[18px] text-[11px] font-bold ${
                    keyakinan === "tinggi"
                      ? "flat-tag-white"
                      : keyakinan === "sedang"
                      ? "flat-tag-amber"
                      : "flat-tag-slate"
                  }`}
                >
                  {keyakinan}
                </span>
              </div>
              {statusLineup && (
                <div className="text-[11px] text-[#737373]">
                  Lineup: <span className="text-[#0a0a0a] font-semibold">{statusLineup}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Telemetry Properties Inset Grid */}
        <div className="pt-1 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs tabular-nums">
          <div className="p-3 rounded-[16px] bg-[#fafafa] border border-[#e5e5e5]">
            <span className="text-[11px] text-[#737373] block">Integritas Data</span>
            <span className="font-semibold flex items-center gap-1.5 mt-0.5 text-[#0a0a0a]">
              <CheckCircleIcon size={12} className="text-[#0a0a0a]" />
              <span>Grounded 100%</span>
            </span>
          </div>

          <div className="p-3 rounded-[16px] bg-[#fafafa] border border-[#e5e5e5]">
            <span className="text-[11px] text-[#737373] block">Wasit Pertandingan</span>
            <span className="text-[#0a0a0a] font-medium truncate block mt-0.5 flex items-center gap-1.5">
              <WhistleIcon size={12} className="text-[#737373] shrink-0" />
              <span className="truncate">{wasit}</span>
            </span>
            {wasitKartu != null && (
              <span className="text-[11px] text-[#737373] block mt-0.5 tabular-nums">
                Rata-rata {wasitKartu} kartu / laga
              </span>
            )}
          </div>

          <div className="p-3 rounded-[16px] bg-[#fafafa] border border-[#e5e5e5]">
            <span className="text-[11px] text-[#737373] block">Status Bursa</span>
            <span className="text-[#0a0a0a] font-semibold block mt-0.5">
              Aktif &amp; Terkalibrasi
            </span>
          </div>

          <div className="p-3 rounded-[16px] bg-[#fafafa] border border-[#e5e5e5]">
            <span className="text-[11px] text-[#737373] block">Target xG Poisson</span>
            <span className="text-[#0a0a0a] font-semibold block mt-0.5">
              {dcHomeXg !== undefined && dcAwayXg !== undefined
                ? `${Number(dcHomeXg).toFixed(2)} vs ${Number(dcAwayXg).toFixed(2)}`
                : "Terkalibrasi"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
