"use client";

import React, { useState } from "react";
import type { AnalysisView } from "@/lib/view/analysis-view";
import {
  CpuIcon,
  BarChart3Icon,
  CoinsIcon,
  ArrowUpRightIcon,
  ShieldIcon,
  CheckCircleIcon,
  ActivityIcon,
} from "@/components/icons";

interface QuantEngineCardProps {
  kuantitatif: AnalysisView["kuantitatif"];
  homeTeam: string;
  awayTeam: string;
}

export function QuantEngineCard({
  kuantitatif,
  homeTeam,
  awayTeam,
}: QuantEngineCardProps) {
  const { hero, bukti, detail } = kuantitatif;
  const value_bets = detail?.kelly?.tabel || [];
  const metode = detail?.metode || {};

  // State untuk Kelly Bankroll Simulator
  const [bankroll, setBankroll] = useState<number>(10000000); // Rp 10.000.000
  const [kellyMultiplier, setKellyMultiplier] = useState<number>(0.25); // 0.25 = Quarter Kelly

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    }).format(val);
  };

  const probHomePct = Math.round(hero.prob.home * 100);
  const probDrawPct = Math.round(hero.prob.draw * 100);
  const probAwayPct = Math.round(hero.prob.away * 100);

  return (
    <div className="space-y-4 font-mono text-xs">
      {/* 1. HERO QUANT CARD: 3-WAY PROBABILITIES & FAIR ODDS */}
      <div className="p-5 rounded-[24px] bg-white border border-[#e5e5e5] shadow-[0_1px_3px_rgba(0,0,0,0.05)] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#e5e5e5]">
          <div className="flex items-center gap-2">
            <CpuIcon size={16} className="text-[#0a0a0a]" />
            <h3 className="font-semibold text-xs sm:text-sm text-[#0a0a0a] tracking-tight uppercase">
              Deterministic Quant Engine (Dixon-Coles Poisson + Shin Fair Odds)
            </h3>
          </div>
          {hero.ev_teratas && (
            <span className="px-2.5 py-0.5 rounded-[18px] text-[10px] font-bold flat-tag-zinc flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
              Edge Teratas: {hero.ev_teratas.selection} ({hero.ev_teratas.ev_percentage})
            </span>
          )}
        </div>

        {/* 3-Way True Probability Bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-[#737373]">
            <span>Probabilitas Riil Model (Tanpa Vigorish)</span>
            <span className="text-[#0a0a0a] font-semibold">Total: 100%</span>
          </div>

          <div className="h-6 w-full rounded-[18px] bg-[#f5f5f5] overflow-hidden flex border border-[#e5e5e5]">
            <div
              style={{ width: `${probHomePct}%` }}
              className="h-full bg-[#0a0a0a] text-white flex items-center justify-center text-[10px] font-semibold tabular-nums"
              title={`${homeTeam}: ${probHomePct}%`}
            >
              {probHomePct > 12 && `${homeTeam} ${probHomePct}%`}
            </div>
            <div
              style={{ width: `${probDrawPct}%` }}
              className="h-full bg-[#737373] text-white flex items-center justify-center text-[10px] font-semibold tabular-nums"
              title={`Seri: ${probDrawPct}%`}
            >
              {probDrawPct > 10 && `X ${probDrawPct}%`}
            </div>
            <div
              style={{ width: `${probAwayPct}%` }}
              className="h-full bg-[#d4d4d8] text-[#0a0a0a] flex items-center justify-center text-[10px] font-semibold tabular-nums"
              title={`${awayTeam}: ${probAwayPct}%`}
            >
              {probAwayPct > 12 && `${awayTeam} ${probAwayPct}%`}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-1 text-[11px] tabular-nums">
            <div className="p-2.5 rounded-[12px] bg-[#fafafa] border border-[#e5e5e5]">
              <span className="text-[10px] text-[#737373] block truncate">{homeTeam} (1)</span>
              <strong className="text-[#0a0a0a] text-sm block mt-0.5">{probHomePct}%</strong>
              <span className="text-[10px] text-[#737373]">Fair Odds: {hero.fair_odds.home.toFixed(2)}</span>
            </div>
            <div className="p-2.5 rounded-[12px] bg-[#fafafa] border border-[#e5e5e5]">
              <span className="text-[10px] text-[#737373] block">Seri (X)</span>
              <strong className="text-[#0a0a0a] text-sm block mt-0.5">{probDrawPct}%</strong>
              <span className="text-[10px] text-[#737373]">Fair Odds: {hero.fair_odds.draw.toFixed(2)}</span>
            </div>
            <div className="p-2.5 rounded-[12px] bg-[#fafafa] border border-[#e5e5e5]">
              <span className="text-[10px] text-[#737373] block truncate">{awayTeam} (2)</span>
              <strong className="text-[#0a0a0a] text-sm block mt-0.5">{probAwayPct}%</strong>
              <span className="text-[10px] text-[#737373]">Fair Odds: {hero.fair_odds.away.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* 2. BUKTI TERPENTING (MAX 5 BARIS KEY TELEMETRY) */}
        {bukti.length > 0 && (
          <div className="pt-2 border-t border-[#e5e5e5] space-y-2">
            <span className="text-[10px] font-semibold text-[#737373] uppercase tracking-wider block">
              Parameter Kunci Dixon-Coles Bivariate:
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 text-[11px] tabular-nums">
              {bukti.map((b, idx) => (
                <div key={idx} className="p-2.5 rounded-[12px] bg-[#fafafa] border border-[#e5e5e5]">
                  <span className="text-[10px] text-[#737373] block truncate">{b.label}</span>
                  <strong className="text-[#0a0a0a] block mt-0.5">{b.value}</strong>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 3. VALUE BETS & KELLY CAPITAL SIZING SIMULATOR */}
      <div className="p-5 rounded-[24px] bg-white border border-[#e5e5e5] shadow-[0_1px_3px_rgba(0,0,0,0.05)] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#e5e5e5]">
          <div className="flex items-center gap-2">
            <CoinsIcon size={16} className="text-[#0a0a0a]" />
            <h4 className="font-semibold text-xs sm:text-sm text-[#0a0a0a] tracking-tight uppercase">
              Kelly Criterion Matrix &amp; Capital Sizing
            </h4>
          </div>

          {/* Sizing Strategy Selector */}
          <div className="flex items-center gap-1 bg-[#f5f5f5] p-0.5 rounded-[18px] border border-[#e5e5e5] text-[10px]">
            {[
              { label: "1/4 Kelly (Konservatif)", value: 0.25 },
              { label: "1/2 Kelly (Moderat)", value: 0.5 },
              { label: "Full Kelly (Agresif)", value: 1.0 },
            ].map((strat) => (
              <button
                key={strat.value}
                onClick={() => setKellyMultiplier(strat.value)}
                className={`px-3 py-1 rounded-[18px] transition-colors cursor-pointer ${
                  kellyMultiplier === strat.value
                    ? "bg-[#0a0a0a] text-white font-semibold"
                    : "text-[#737373] hover:text-[#0a0a0a]"
                }`}
              >
                {strat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Bankroll Controller */}
        <div className="p-3.5 rounded-[16px] bg-[#fafafa] border border-[#e5e5e5] space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <span className="text-[#737373] uppercase tracking-wider text-[10px]">
              Modal Bankroll Portofolio:
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[#737373]">IDR</span>
              <input
                type="number"
                min={100000}
                max={500000000}
                step={500000}
                value={bankroll}
                onChange={(e) => setBankroll(Math.max(0, Number(e.target.value)))}
                className="w-36 bg-white text-[#0a0a0a] font-bold px-3 py-1 rounded-[14px] border border-[#e5e5e5] text-xs tabular-nums focus:outline-none focus:border-[#0a0a0a]"
              />
              <span className="text-xs font-bold text-[#0a0a0a] tabular-nums">
                ({formatCurrency(bankroll)})
              </span>
            </div>
          </div>

          <input
            type="range"
            min={1000000}
            max={100000000}
            step={1000000}
            value={bankroll}
            onChange={(e) => setBankroll(Number(e.target.value))}
            className="w-full h-1.5 bg-[#e5e5e5] rounded-lg appearance-none cursor-pointer accent-[#0a0a0a]"
          />
        </div>

        {/* Value Bet Table */}
        {value_bets.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#e5e5e5] text-[10px] text-[#737373] uppercase">
                  <th className="py-2 pr-3">Pasar &amp; Pilihan</th>
                  <th className="py-2 px-3 text-right">Bursa Odds</th>
                  <th className="py-2 px-3 text-right">Fair Odds</th>
                  <th className="py-2 px-3 text-right">Edge (EV)</th>
                  <th className="py-2 px-3 text-right">Kelly Stake (%)</th>
                  <th className="py-2 pl-3 text-right">Nominal Taruhan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5e5e5] tabular-nums">
                {value_bets.map((vb: any, idx: number) => {
                  const effectiveStakePct = +(vb.recommended_stake_percentage * kellyMultiplier).toFixed(2);
                  const stakeIdr = Math.round((bankroll * effectiveStakePct) / 100);

                  return (
                    <tr key={idx} className="hover:bg-[#fafafa] transition-colors">
                      <td className="py-2.5 pr-3">
                        <div className="font-semibold text-[#0a0a0a]">{vb.selection}</div>
                        <span className="text-[10px] text-[#737373]">{vb.market_name}</span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-[#0a0a0a]">
                        {vb.bookmaker_odds.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-[#737373]">
                        {vb.fair_odds.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-[#10b981]">
                        {vb.ev_percentage}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-[#0a0a0a]">
                        {effectiveStakePct}%
                      </td>
                      <td className="py-2.5 pl-3 text-right font-bold text-[#0a0a0a]">
                        {formatCurrency(stakeIdr)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4 rounded-[16px] bg-[#fafafa] border border-[#e5e5e5] text-center text-[#737373]">
            Tidak ada dislokasi harga bernilai positif (EV &gt; 0) yang melampaui ambang batas keamanan sindikat pada laga ini. Disarankan No Bet / Pass.
          </div>
        )}
      </div>

      {/* 4. EXPANDABLE DETAILS: FORMULA & PARAMETER KALIBRASI */}
      <details className="p-4 rounded-[20px] bg-[#fafafa] border border-[#e5e5e5] space-y-3 cursor-pointer group">
        <summary className="font-semibold text-xs text-[#0a0a0a] uppercase tracking-wider flex items-center justify-between select-none">
          <span className="flex items-center gap-2">
            <ShieldIcon size={14} className="text-[#0a0a0a]" />
            Formula &amp; Parameter Kalibrasi Matematis (Dekomposisi Mendalam)
          </span>
          <span className="text-[10px] text-[#737373] font-normal group-open:rotate-180 transition-transform">
            ▼
          </span>
        </summary>

        <div className="pt-3 border-t border-[#e5e5e5] space-y-3 text-[11px] text-[#171717] tabular-nums">
          <p className="font-sans leading-relaxed text-[#737373]">
            Dekomposisi parameter Poisson bivariate Dixon-Coles dengan matriks skor rendah rho (ρ), penyesuaian penyusutan James-Stein (shrinkage), dan isolasi vigorish Shin untuk mengestimasi probabilitas murni.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            <div className="p-3 rounded-[12px] bg-white border border-[#e5e5e5]">
              <span className="text-[10px] text-[#737373] uppercase block">Home Base xG (λ)</span>
              <strong className="text-[#0a0a0a] block mt-0.5">{metode.baseline?.lambda ?? "-"}</strong>
              <span className="text-[9px] text-[#737373]">Intensitas serang kandang</span>
            </div>

            <div className="p-3 rounded-[12px] bg-white border border-[#e5e5e5]">
              <span className="text-[10px] text-[#737373] uppercase block">Away Base xG (μ)</span>
              <strong className="text-[#0a0a0a] block mt-0.5">{metode.baseline?.mu ?? "-"}</strong>
              <span className="text-[9px] text-[#737373]">Intensitas serang tandang</span>
            </div>

            <div className="p-3 rounded-[12px] bg-white border border-[#e5e5e5]">
              <span className="text-[10px] text-[#737373] uppercase block">Skor Teratas (Top Scorelines)</span>
              <div className="mt-1 space-y-0.5">
                {(metode.dixon_coles?.top_scorelines || []).slice(0, 3).map((ts: any, idx: number) => (
                  <div key={idx} className="flex justify-between text-[10px]">
                    <span className="font-semibold text-[#0a0a0a]">{ts.score}</span>
                    <span className="text-[#737373]">{(ts.prob * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}
