"use client";

import React from "react";
import { QuantEngineData } from "./types";

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
      {/* 1. Implied Probability Bar (Flat Solid Colors) */}
      {impliedProb && (
        <div className="flat-card-static p-4 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-[#f0f6fc]">Probabilitas Pasar Tersirat (Asian 1X2)</span>
            <span className="text-[11px] font-mono text-[#8b949e]">TheStatsAPI Consensus</span>
          </div>

          {/* 3-Segment Solid Flat Bar */}
          <div className="h-6 w-full rounded-md bg-[#0d1117] overflow-hidden flex border border-[#2d3748]">
            <div
              style={{ width: `${impliedProb.kandang}%` }}
              className="h-full bg-[#16a34a] text-white flex items-center justify-center text-[10px] font-mono font-bold"
              title={`${homeTeam}: ${impliedProb.kandang}%`}
            >
              {impliedProb.kandang > 12 && `${impliedProb.kandang}%`}
            </div>
            <div
              style={{ width: `${impliedProb.seri}%` }}
              className="h-full bg-[#475569] text-white flex items-center justify-center text-[10px] font-mono font-bold"
              title={`Seri: ${impliedProb.seri}%`}
            >
              {impliedProb.seri > 12 && `${impliedProb.seri}%`}
            </div>
            <div
              style={{ width: `${impliedProb.tandang}%` }}
              className="h-full bg-[#0284c7] text-white flex items-center justify-center text-[10px] font-mono font-bold"
              title={`${awayTeam}: ${impliedProb.tandang}%`}
            >
              {impliedProb.tandang > 12 && `${impliedProb.tandang}%`}
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono">
            <span className="text-[#22c55e] font-semibold">{homeTeam} ({impliedProb.kandang}%)</span>
            <span className="text-[#94a3b8]">Seri ({impliedProb.seri}%)</span>
            <span className="text-[#38bdf8] font-semibold">{awayTeam} ({impliedProb.tandang}%)</span>
          </div>
        </div>
      )}

      {/* 2. Dixon-Coles & Shin Quant Engine Main Card */}
      <div className="flat-card-static p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#2d3748]">
          <div className="flex items-center gap-2">
            <span className="text-base">📐</span>
            <h3 className="font-bold text-xs sm:text-sm text-[#f0f6fc]">
              Enterprise Quant Engine (Dixon-Coles &amp; Shin Vig-Stripping)
            </h3>
          </div>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono flat-tag-green">
            Overround Terbuang: {vig.margin_percentage}%
          </span>
        </div>

        {/* 4 Metric Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono">
          <div className="p-3 rounded-md bg-[#0d1117] border border-[#2d3748]">
            <span className="text-[10px] text-[#8b949e] block">Home Expected Goals (λ)</span>
            <span className="text-[#22c55e] text-base font-bold block mt-1">
              {dc.lambda_home_xg} xG
            </span>
          </div>

          <div className="p-3 rounded-md bg-[#0d1117] border border-[#2d3748]">
            <span className="text-[10px] text-[#8b949e] block">Away Expected Goals (μ)</span>
            <span className="text-[#38bdf8] text-base font-bold block mt-1">
              {dc.mu_away_xg} xG
            </span>
          </div>

          <div className="p-3 rounded-md bg-[#0d1117] border border-[#2d3748]">
            <span className="text-[10px] text-[#8b949e] block">Over 2.5 True Prob</span>
            <span className="text-[#f0f6fc] text-base font-bold block mt-1">
              {(dc.over_2_5_prob * 100).toFixed(1)}%
            </span>
          </div>

          <div className="p-3 rounded-md bg-[#0d1117] border border-[#2d3748]">
            <span className="text-[10px] text-[#8b949e] block">BTTS True Prob</span>
            <span className="text-[#fbbf24] text-base font-bold block mt-1">
              {(dc.btts_yes_prob * 100).toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Fair Odds vs Model Probabilities */}
        <div className="p-3.5 rounded-md bg-[#0d1117] border border-[#2d3748] text-xs font-mono space-y-2.5">
          <div className="flex items-center justify-between text-[11px] text-[#8b949e]">
            <span>Pilihan 1X2</span>
            <span>Model True Probability</span>
            <span>Model Fair Odds</span>
          </div>

          <div className="grid grid-cols-3 gap-2.5 text-center">
            <div className="p-2.5 rounded bg-[#161b22] border border-[#2d3748]">
              <span className="text-[10px] text-[#8b949e] block">1 (Kandang)</span>
              <span className="text-[#22c55e] font-bold block text-sm mt-0.5">
                {(dc.prob_home_win * 100).toFixed(1)}%
              </span>
              <span className="text-[11px] text-[#cbd5e1] block mt-1">
                Fair: {dc.fair_odds.home}
              </span>
            </div>

            <div className="p-2.5 rounded bg-[#161b22] border border-[#2d3748]">
              <span className="text-[10px] text-[#8b949e] block">X (Seri)</span>
              <span className="text-[#f0f6fc] font-bold block text-sm mt-0.5">
                {(dc.prob_draw * 100).toFixed(1)}%
              </span>
              <span className="text-[11px] text-[#cbd5e1] block mt-1">
                Fair: {dc.fair_odds.draw}
              </span>
            </div>

            <div className="p-2.5 rounded bg-[#161b22] border border-[#2d3748]">
              <span className="text-[10px] text-[#8b949e] block">2 (Tamu)</span>
              <span className="text-[#38bdf8] font-bold block text-sm mt-0.5">
                {(dc.prob_away_win * 100).toFixed(1)}%
              </span>
              <span className="text-[11px] text-[#cbd5e1] block mt-1">
                Fair: {dc.fair_odds.away}
              </span>
            </div>
          </div>
        </div>

        {/* Top Scorelines Projected */}
        {dc.top_scorelines?.length > 0 && (
          <div className="space-y-1.5 text-xs font-mono">
            <span className="text-[11px] text-[#8b949e]">
              🎯 Skor Eksak Paling Berpeluang (Dixon-Coles Matrix):
            </span>
            <div className="flex flex-wrap gap-2">
              {dc.top_scorelines.slice(0, 5).map((sc, i) => (
                <span
                  key={i}
                  className="px-2.5 py-1 rounded bg-[#0d1117] text-[#f0f6fc] border border-[#2d3748] text-xs"
                >
                  <strong className="text-[#22c55e]">{sc.homeGoals} - {sc.awayGoals}</strong>{" "}
                  <span className="text-[#8b949e]">({sc.prob}%)</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Expected Points & Clean Sheet */}
        {(dc.expected_points || dc.clean_sheet) && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono pt-1">
            {dc.expected_points && (
              <>
                <div className="p-2.5 rounded bg-[#0d1117] border border-[#2d3748]">
                  <span className="text-[10px] text-[#8b949e] block">Home xPTS</span>
                  <span className="text-[#f0f6fc] font-bold">
                    {dc.expected_points.home_xpts.toFixed(2)} pts
                  </span>
                </div>
                <div className="p-2.5 rounded bg-[#0d1117] border border-[#2d3748]">
                  <span className="text-[10px] text-[#8b949e] block">Away xPTS</span>
                  <span className="text-[#38bdf8] font-bold">
                    {dc.expected_points.away_xpts.toFixed(2)} pts
                  </span>
                </div>
              </>
            )}

            {dc.clean_sheet && (
              <>
                <div className="p-2.5 rounded bg-[#0d1117] border border-[#2d3748]">
                  <span className="text-[10px] text-[#8b949e] block">Home Clean Sheet</span>
                  <span className="text-[#22c55e] font-bold">
                    {(dc.clean_sheet.home_clean_sheet_prob * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="p-2.5 rounded bg-[#0d1117] border border-[#2d3748]">
                  <span className="text-[10px] text-[#8b949e] block">Away Clean Sheet</span>
                  <span className="text-[#22c55e] font-bold">
                    {(dc.clean_sheet.away_clean_sheet_prob * 100).toFixed(1)}%
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Asian Handicap Derivative Matrix */}
        {dc.asian_handicap && (
          <div className="space-y-1.5 text-xs font-mono pt-2 border-t border-[#2d3748]">
            <span className="text-[11px] text-[#8b949e]">
              ⚖️ Asian Handicap Derivative Probabilities:
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="p-2.5 rounded bg-[#0d1117] border border-[#2d3748]">
                <span className="text-[10px] text-[#8b949e] block">AH 0.0 (Draw No Bet)</span>
                <div className="flex justify-between text-[11px] mt-1">
                  <span className="text-[#22c55e]">H: {(dc.asian_handicap.ah_0_0_dnb.home_prob * 100).toFixed(1)}%</span>
                  <span className="text-[#38bdf8]">A: {(dc.asian_handicap.ah_0_0_dnb.away_prob * 100).toFixed(1)}%</span>
                </div>
              </div>

              <div className="p-2.5 rounded bg-[#0d1117] border border-[#2d3748]">
                <span className="text-[10px] text-[#8b949e] block">AH -0.5 (Direct Win)</span>
                <div className="flex justify-between text-[11px] mt-1">
                  <span className="text-[#22c55e]">H: {(dc.asian_handicap.ah_minus_0_5.home_cover * 100).toFixed(1)}%</span>
                  <span className="text-[#38bdf8]">A: {(dc.asian_handicap.ah_minus_0_5.away_cover * 100).toFixed(1)}%</span>
                </div>
              </div>

              <div className="p-2.5 rounded bg-[#0d1117] border border-[#2d3748]">
                <span className="text-[10px] text-[#8b949e] block">AH -1.0 (Margin 2+)</span>
                <div className="flex justify-between text-[11px] mt-1">
                  <span className="text-[#22c55e]">H: {(dc.asian_handicap.ah_minus_1_0.home_cover * 100).toFixed(1)}%</span>
                  <span className="text-[#38bdf8]">A: {(dc.asian_handicap.ah_minus_1_0.away_cover * 100).toFixed(1)}%</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
