"use client";

import React from "react";
import type { AnalysisView } from "@/lib/view/analysis-view";
import { formatWib } from "./utils";
import {
  WhistleIcon,
  CheckCircleIcon,
  RefreshCwIcon,
  SparklesIcon,
} from "@/components/icons";

interface MatchHeaderCardProps {
  view?: AnalysisView | null;
  onBack: () => void;
  onRefreshOdds?: () => void;
  onRerunAnalysis?: () => void;
  refreshingOdds?: boolean;
  rerunningAnalysis?: boolean;
}

export function MatchHeaderCard({
  view,
  onBack,
  onRefreshOdds,
  onRerunAnalysis,
  refreshingOdds = false,
  rerunningAnalysis = false,
}: MatchHeaderCardProps) {
  const homeTeam = view?.match.home || "Tim Kandang";
  const awayTeam = view?.match.away || "Tim Tamu";
  const competition = view?.match.competition || "Kompetisi";
  const kickoff = view?.match.kickoff_wib || "";
  const venue = view?.match.venue;
  const wasit = view?.match.wasit || "Belum Ditunjuk";
  const wasitKartu = view?.match.wasit_kartu ?? null;
  const statusLineup = view?.match.status_lineup ?? null;
  const verdict = view?.ringkasan.verdict || "Menganalisis...";
  const confidence = view?.ringkasan.keyakinan || "—";

  const probCandidates = [
    { label: "1", v: view?.kuantitatif?.hero?.prob?.home ?? null },
    { label: "X", v: view?.kuantitatif?.hero?.prob?.draw ?? null },
    { label: "2", v: view?.kuantitatif?.hero?.prob?.away ?? null },
  ].filter((c): c is { label: string; v: number } => c.v != null && Number.isFinite(c.v));
  const probTerbaik = probCandidates.length > 0
    ? probCandidates.reduce((a, b) => (b.v > a.v ? b : a))
    : null;
  const evTop = view?.kuantitatif?.hero?.ev_teratas ?? null;
  const kellyRows = view?.kuantitatif?.detail?.kelly?.tabel ?? [];
  const kellyTop = kellyRows.length > 0
    ? kellyRows.reduce((a, b) => ((b.recommended_stake_percentage ?? 0) > (a.recommended_stake_percentage ?? 0) ? b : a))
    : null;

  const dcHomeXg = view?.kuantitatif?.detail?.metode?.baseline?.lambda;
  const dcAwayXg = view?.kuantitatif?.detail?.metode?.baseline?.mu;

  return (
    <div className="space-y-3 font-sans">
      {/* Top Action Navigation Bar */}
      <div className="flex items-center justify-between gap-3">
        {/* Back Button */}
        <button
          onClick={onBack}
          className="group inline-flex items-center gap-2 px-3.5 py-1.5 rounded-[18px] bg-[#14141f] hover:bg-[#1b1b29] border border-[#262636] text-xs text-[#f4f4f6] transition-colors cursor-pointer"
        >
          <span className="text-[#a2a2b5] group-hover:-translate-x-0.5 transition-transform">←</span>
          <span>Cari Laga Lain</span>
        </button>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {onRefreshOdds && (
            <button
              onClick={onRefreshOdds}
              disabled={refreshingOdds}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[18px] bg-[#14141f] hover:bg-[#1b1b29] border border-[#262636] text-xs text-[#f4f4f6] transition-colors cursor-pointer disabled:opacity-50"
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
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[18px] bg-[#b8b0ff] hover:bg-[#cdc6ff] text-xs text-[#17131f] font-medium transition-colors cursor-pointer disabled:opacity-50"
              title="Bedah ulang laga ini dengan AI"
            >
              <SparklesIcon size={12} className={rerunningAnalysis ? "animate-spin" : ""} />
              <span>Analisis Ulang</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Header Card */}
      <div className="p-5 rounded-[18px] bg-[#14141f] border border-[#262636] space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-[18px] text-[11px] flat-tag-zinc font-semibold">
                {competition}
              </span>
              <span className="text-xs text-[#a2a2b5] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#b8b0ff]" />
                {kickoff ? formatWib(kickoff) : "Jadwal Belum Ditetapkan"}
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#f4f4f6] font-sans">
              {homeTeam} <span className="text-[#a2a2b5] font-light text-xl sm:text-2xl">vs</span> {awayTeam}
            </h1>

            {venue && (
              <p className="text-xs text-[#a2a2b5] flex items-center gap-1.5">
                <span className="text-[#8e8ea3]">Venue:</span>
                <span className="text-[#e8e8ef]">{venue}</span>
              </p>
            )}
            {statusLineup && (
              <p className="text-[11px] text-[#a2a2b5]">
                Lineup: <span className="text-[#f4f4f6] font-semibold">{statusLineup}</span>
              </p>
            )}
          </div>
        </div>

        {/* Vonis hero menyatu + strip 4 stat */}
        <div className="pt-1 space-y-3">
          <div className="space-y-1">
            <span className="text-[11px] font-bold tracking-wide text-[#a2a2b5]">
              VONIS UTAMA
            </span>
            <h2 id="vonis-utama" tabIndex={-1} className="text-2xl sm:text-[32px] font-bold text-[#f4f4f6] font-sans leading-tight focus:outline-none">
              {verdict}
            </h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 tabular-nums">
            <div className="p-3 rounded-[14px] bg-[#1b1b29] border border-[#262636]">
              <span className="text-[11px] text-[#a2a2b5] block">Probabilitas Terbaik</span>
              <strong className="block mt-0.5 text-[#f4f4f6] text-2xl leading-none">
                {probTerbaik ? `${probTerbaik.label} · ${Math.round(probTerbaik.v * 100)}%` : "—"}
              </strong>
            </div>
            <div className="p-3 rounded-[14px] bg-[#1b1b29] border border-[#262636]">
              <span className="text-[11px] text-[#a2a2b5] block">EV Teratas</span>
              <strong className="block mt-0.5 text-[#34d399] text-2xl leading-none">
                {evTop ? evTop.ev_percentage : "—"}
              </strong>
              {evTop && <span className="text-[11px] text-[#a2a2b5] block truncate mt-0.5">{evTop.selection}</span>}
            </div>
            <div className="p-3 rounded-[14px] bg-[#1b1b29] border border-[#262636]">
              <span className="text-[11px] text-[#a2a2b5] block">Stake Kelly Teratas</span>
              <strong className="block mt-0.5 text-[#f4f4f6] text-2xl leading-none">
                {kellyTop?.recommended_stake_percentage != null ? `${kellyTop.recommended_stake_percentage}%` : "—"}
              </strong>
            </div>
            <div className="p-3 rounded-[14px] bg-[#1b1b29] border border-[#262636]">
              <span className="text-[11px] text-[#a2a2b5] block">Keyakinan</span>
              <strong className="block mt-0.5 text-[#f4f4f6] text-2xl leading-none truncate">
                {confidence}
              </strong>
            </div>
          </div>
        </div>

        {/* Telemetry Properties Inset Grid */}
        <div className="pt-1 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs tabular-nums">
          <div className="p-3 rounded-[16px] bg-[#1b1b29] border border-[#262636]">
            <span className="text-[11px] text-[#a2a2b5] block">Integritas Data</span>
            <span className="font-semibold flex items-center gap-1.5 mt-0.5 text-[#f4f4f6]">
              <CheckCircleIcon size={12} className="text-[#f4f4f6]" />
              <span>{view ? (view.ringkasan.integrity.gaps.length > 0 ? `${view.ringkasan.integrity.gaps.length} gap data` : "Data tercatat lengkap") : "Menganalisis..."}</span>
            </span>
          </div>

          <div className="p-3 rounded-[16px] bg-[#1b1b29] border border-[#262636]">
            <span className="text-[11px] text-[#a2a2b5] block">Wasit Pertandingan</span>
            <span className="text-[#f4f4f6] font-medium truncate block mt-0.5 flex items-center gap-1.5">
              <WhistleIcon size={12} className="text-[#a2a2b5] shrink-0" />
              <span className="truncate">{wasit}</span>
            </span>
            {wasitKartu != null && (
              <span className="text-[11px] text-[#a2a2b5] block mt-0.5 tabular-nums">
                Rata-rata {wasitKartu} kartu / laga
              </span>
            )}
          </div>

          <div className="p-3 rounded-[16px] bg-[#1b1b29] border border-[#262636]">
            <span className="text-[11px] text-[#a2a2b5] block">Status Bursa</span>
            <span className="text-[#f4f4f6] font-semibold block mt-0.5">
              {view ? "Lihat tab Bursa" : "Menganalisis..."}
            </span>
          </div>

          <div className="p-3 rounded-[16px] bg-[#1b1b29] border border-[#262636]">
            <span className="text-[11px] text-[#a2a2b5] block">Target xG Poisson</span>
            <span className="text-[#f4f4f6] font-semibold block mt-0.5">
              {dcHomeXg != null && dcAwayXg != null && Number.isFinite(Number(dcHomeXg)) && Number.isFinite(Number(dcAwayXg))
                ? `${Number(dcHomeXg).toFixed(2)} vs ${Number(dcAwayXg).toFixed(2)}`
                : "—"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
