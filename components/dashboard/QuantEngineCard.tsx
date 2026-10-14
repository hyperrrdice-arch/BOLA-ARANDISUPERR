"use client";

import React from "react";
import { QuantEngineData } from "./types";
import { CpuIcon, BarChart3Icon, CrosshairIcon, ActivityIcon } from "@/components/icons";

interface QuantEngineCardProps {
  quantData: QuantEngineData;
  impliedProb: { kandang: number; seri: number; tandang: number } | null;
  homeTeam: string;
  awayTeam: string;
}

export function QuantEngineCard({
  quantData,
  impliedProb,
  homeTeam,
  awayTeam,
}: QuantEngineCardProps) {
  const dc = quantData.dixon_coles;
  const vig = quantData.vig_stripping;

  return (
    <div className="space-y-4">
      {/* 1. Implied Market Probability Bar */}
      {impliedProb && (
        <div className="doppel-shell">
          <div className="doppel-core space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-[#f8fafc] font-mono uppercase tracking-wider flex items-center gap-1.5">
                <BarChart3Icon size={13} className="text-[#06b6d4]" />
                <span>Probabilitas Pasar Tersirat (Asian 1X2)</span>
              </span>
              <span className="text-[10px] font-mono text-[#64748b] uppercase">TheStatsAPI Consensus</span>
            </div>

            {/* 3-Segment Calibrated Solid Bar */}
            <div className="h-6 w-full rounded-md bg-[#080a0e] overflow-hidden flex border border-white/[0.08]">
              <div
                style={{ width: `${impliedProb.kandang}%` }}
                className="h-full bg-[#10b981] text-white flex items-center justify-center text-[10px] font-mono font-bold tabular-nums"
                title={`${homeTeam}: ${impliedProb.kandang}%`}
              >
                {impliedProb.kandang > 12 && `${impliedProb.kandang}%`}
              </div>
              <div
                style={{ width: `${impliedProb.seri}%` }}
                className="h-full bg-[#475569] text-white flex items-center justify-center text-[10px] font-mono font-bold tabular-nums"
                title={`Seri: ${impliedProb.seri}%`}
              >
                {impliedProb.seri > 12 && `${impliedProb.seri}%`}
              </div>
              <div
                style={{ width: `${impliedProb.tandang}%` }}
                className="h-full bg-[#06b6d4] text-white flex items-center justify-center text-[10px] font-mono font-bold tabular-nums"
                title={`${awayTeam}: ${impliedProb.tandang}%`}
              >
                {impliedProb.tandang > 12 && `${impliedProb.tandang}%`}
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
              <span className="text-[#10b981] font-semibold">{homeTeam} ({impliedProb.kandang}%)</span>
              <span className="text-[#94a3b8]">Seri ({impliedProb.seri}%)</span>
              <span className="text-[#06b6d4] font-semibold">{awayTeam} ({impliedProb.tandang}%)</span>
            </div>
          </div>
        </div>
      )}

      {/* 2. Dixon-Coles & Shin Quant Engine Main Card */}
      <div className="doppel-shell">
        <div className="doppel-core space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <CpuIcon size={15} className="text-[#06b6d4]" />
              <h3 className="font-bold text-xs sm:text-sm text-[#f8fafc] font-mono tracking-tight uppercase">
                Enterprise Quant Engine (Dixon-Coles &amp; Shin Vig-Stripping)
              </h3>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono flat-tag-green font-semibold tabular-nums">
              Overround Terbuang: {vig.margin_percentage}%
            </span>
          </div>

          {/* 4 Metric Telemetry Gauges */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono tabular-nums">
            <div className="p-3 rounded-lg bg-[#0f131a] border border-white/[0.06]">
              <span className="text-[10px] text-[#94a3b8] uppercase block">Home xG (λ)</span>
              <span className="text-[#10b981] text-base font-bold block mt-1">
                {dc.lambda_home_xg.toFixed(2)} xG
              </span>
            </div>

            <div className="p-3 rounded-lg bg-[#0f131a] border border-white/[0.06]">
              <span className="text-[10px] text-[#94a3b8] uppercase block">Away xG (μ)</span>
              <span className="text-[#06b6d4] text-base font-bold block mt-1">
                {dc.mu_away_xg.toFixed(2)} xG
              </span>
            </div>

            <div className="p-3 rounded-lg bg-[#0f131a] border border-white/[0.06]">
              <span className="text-[10px] text-[#94a3b8] uppercase block">Over 2.5 True Prob</span>
              <span className="text-[#f8fafc] text-base font-bold block mt-1">
                {(dc.over_2_5_prob * 100).toFixed(1)}%
              </span>
            </div>

            <div className="p-3 rounded-lg bg-[#0f131a] border border-white/[0.06]">
              <span className="text-[10px] text-[#94a3b8] uppercase block">BTTS True Prob</span>
              <span className="text-[#f59e0b] text-base font-bold block mt-1">
                {(dc.btts_yes_prob * 100).toFixed(1)}%
              </span>
            </div>
          </div>

          {/* Fair Odds vs Model Probabilities */}
          <div className="p-3.5 rounded-lg bg-[#0f131a] border border-white/[0.06] text-xs font-mono tabular-nums space-y-2.5">
            <div className="flex items-center justify-between text-[10px] text-[#64748b] uppercase tracking-wider">
              <span>Pilihan 1X2</span>
              <span>Model True Probability</span>
              <span>Model Fair Odds</span>
            </div>

            <div className="grid grid-cols-3 gap-2.5 text-center">
              <div className="p-2.5 rounded-md bg-[#0a0c12] border border-white/[0.06]">
                <span className="text-[10px] text-[#94a3b8] block uppercase">1 (Kandang)</span>
                <span className="text-[#10b981] font-bold block text-sm mt-0.5">
                  {dc.prob_home_win != null ? (dc.prob_home_win * 100).toFixed(1) : "0.0"}%
                </span>
                <span className="text-[11px] text-[#cbd5e1] block mt-1">
                  Fair: <strong className="text-white">{dc.fair_odds?.home != null ? dc.fair_odds.home.toFixed(2) : "-"}</strong>
                </span>
              </div>

              <div className="p-2.5 rounded-md bg-[#0a0c12] border border-white/[0.06]">
                <span className="text-[10px] text-[#94a3b8] block uppercase">X (Seri)</span>
                <span className="text-[#f8fafc] font-bold block text-sm mt-0.5">
                  {dc.prob_draw != null ? (dc.prob_draw * 100).toFixed(1) : "0.0"}%
                </span>
                <span className="text-[11px] text-[#cbd5e1] block mt-1">
                  Fair: <strong className="text-white">{dc.fair_odds?.draw != null ? dc.fair_odds.draw.toFixed(2) : "-"}</strong>
                </span>
              </div>

              <div className="p-2.5 rounded-md bg-[#0a0c12] border border-white/[0.06]">
                <span className="text-[10px] text-[#94a3b8] block uppercase">2 (Tamu)</span>
                <span className="text-[#06b6d4] font-bold block text-sm mt-0.5">
                  {dc.prob_away_win != null ? (dc.prob_away_win * 100).toFixed(1) : "0.0"}%
                </span>
                <span className="text-[11px] text-[#cbd5e1] block mt-1">
                  Fair: <strong className="text-white">{dc.fair_odds?.away != null ? dc.fair_odds.away.toFixed(2) : "-"}</strong>
                </span>
              </div>
            </div>
          </div>

          {/* Top Scorelines Projected */}
          {dc.top_scorelines?.length > 0 && (
            <div className="space-y-2 text-xs font-mono tabular-nums">
              <div className="flex items-center gap-1.5 text-[11px] text-[#94a3b8]">
                <CrosshairIcon size={12} className="text-[#06b6d4]" />
                <span className="uppercase tracking-wider">Skor Paling Berpeluang (Poisson Distribution Matrix):</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {dc.top_scorelines.slice(0, 5).map((sc, i) => (
                  <span
                    key={`${sc.homeGoals}-${sc.awayGoals}-${i}`}
                    className="px-2.5 py-1 rounded-md bg-[#0f131a] text-[#f8fafc] border border-white/[0.08] text-xs font-mono flex items-center gap-2"
                  >
                    <strong className="text-[#10b981]">{sc.homeGoals} - {sc.awayGoals}</strong>
                    <span className="text-[#64748b]">({sc.prob}%)</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Expected Points & Clean Sheet */}
          {(dc.expected_points || dc.clean_sheet) && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono tabular-nums pt-1">
              {dc.expected_points && (
                <>
                  <div className="p-2.5 rounded-md bg-[#0f131a] border border-white/[0.06]">
                    <span className="text-[10px] text-[#64748b] uppercase block">Home xPTS</span>
                    <span className="text-[#f8fafc] font-bold">
                      {dc.expected_points.home_xpts.toFixed(2)} pts
                    </span>
                  </div>
                  <div className="p-2.5 rounded-md bg-[#0f131a] border border-white/[0.06]">
                    <span className="text-[10px] text-[#64748b] uppercase block">Away xPTS</span>
                    <span className="text-[#06b6d4] font-bold">
                      {dc.expected_points.away_xpts.toFixed(2)} pts
                    </span>
                  </div>
                </>
              )}

              {dc.clean_sheet && (
                <>
                  <div className="p-2.5 rounded-md bg-[#0f131a] border border-white/[0.06]">
                    <span className="text-[10px] text-[#64748b] uppercase block">Home Clean Sheet</span>
                    <span className="text-[#10b981] font-bold">
                      {(dc.clean_sheet.home_clean_sheet_prob * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="p-2.5 rounded-md bg-[#0f131a] border border-white/[0.06]">
                    <span className="text-[10px] text-[#64748b] uppercase block">Away Clean Sheet</span>
                    <span className="text-[#06b6d4] font-bold">
                      {(dc.clean_sheet.away_clean_sheet_prob * 100).toFixed(1)}%
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Asian Handicap Derivative Matrix */}
          {dc.asian_handicap && (
            <div className="space-y-2 text-xs font-mono tabular-nums pt-2 border-t border-white/[0.06]">
              <span className="text-[11px] text-[#94a3b8] uppercase tracking-wider block">
                Asian Handicap Derivative Probabilities:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="p-2.5 rounded-md bg-[#0f131a] border border-white/[0.06]">
                  <span className="text-[10px] text-[#64748b] block uppercase">AH 0.0 (Draw No Bet)</span>
                  <div className="flex justify-between text-[11px] mt-1">
                    <span className="text-[#10b981]">H: {(dc.asian_handicap.ah_0_0_dnb.home_prob * 100).toFixed(1)}%</span>
                    <span className="text-[#06b6d4]">A: {(dc.asian_handicap.ah_0_0_dnb.away_prob * 100).toFixed(1)}%</span>
                  </div>
                </div>

                <div className="p-2.5 rounded-md bg-[#0f131a] border border-white/[0.06]">
                  <span className="text-[10px] text-[#64748b] block uppercase">AH -0.5 (Direct Win)</span>
                  <div className="flex justify-between text-[11px] mt-1">
                    <span className="text-[#10b981]">H: {(dc.asian_handicap.ah_minus_0_5.home_cover * 100).toFixed(1)}%</span>
                    <span className="text-[#06b6d4]">A: {(dc.asian_handicap.ah_minus_0_5.away_cover * 100).toFixed(1)}%</span>
                  </div>
                </div>

                <div className="p-2.5 rounded-md bg-[#0f131a] border border-white/[0.06]">
                  <span className="text-[10px] text-[#64748b] block uppercase">AH -1.0 (Margin 2+)</span>
                  <div className="flex justify-between text-[11px] mt-1">
                    <span className="text-[#10b981]">H: {(dc.asian_handicap.ah_minus_1_0.home_cover * 100).toFixed(1)}%</span>
                    <span className="text-[#06b6d4]">A: {(dc.asian_handicap.ah_minus_1_0.away_cover * 100).toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
