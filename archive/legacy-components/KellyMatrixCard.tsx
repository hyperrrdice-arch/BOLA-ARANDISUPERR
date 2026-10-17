"use client";

import React, { useState, useMemo } from "react";
import { ValueBetItem } from "./types";
import { CoinsIcon, ArrowUpRightIcon, ShieldIcon } from "@/components/icons";

interface KellyMatrixCardProps {
  valueBets: ValueBetItem[];
}

export function KellyMatrixCard({ valueBets }: KellyMatrixCardProps) {
  const [bankroll, setBankroll] = useState<number>(10000000); // Default Rp 10.000.000
  const [kellyMultiplier, setKellyMultiplier] = useState<number>(0.25); // 0.25 = Quarter, 0.5 = Half, 1.0 = Full

  const positiveBets = useMemo(() => {
    return (valueBets || []).filter((vb) => vb.is_positive_ev);
  }, [valueBets]);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    }).format(val);
  };

  return (
    <div className="p-5 rounded-[24px] bg-white border border-[#e5e5e5] shadow-[0_1px_3px_rgba(0,0,0,0.05)] space-y-4">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#e5e5e5]">
        <div className="flex items-center gap-2">
          <CoinsIcon size={15} className="text-[#0a0a0a]" />
          <h4 className="font-semibold text-xs sm:text-sm text-[#0a0a0a] font-mono tracking-tight uppercase">
            Portfolio Kelly Matrix &amp; Capital Sizing Simulator
          </h4>
        </div>

        {/* Sizing Strategy Selector */}
        <div className="flex items-center gap-1 bg-[#f5f5f5] p-0.5 rounded-[18px] border border-[#e5e5e5] text-[10px] font-mono">
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

      {/* Interactive Bankroll Input & Slider */}
      <div className="p-4 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-mono">
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
              className="w-36 bg-white text-[#0a0a0a] font-bold px-3 py-1 rounded-[18px] border border-[#e5e5e5] text-xs font-mono tabular-nums focus:outline-none focus:border-[#0a0a0a]"
            />
            <span className="text-xs font-bold text-[#0a0a0a] tabular-nums">
              ({formatCurrency(bankroll)})
            </span>
          </div>
        </div>

        <div className="space-y-1">
          <input
            type="range"
            min={1000000}
            max={100000000}
            step={1000000}
            value={bankroll}
            onChange={(e) => setBankroll(Number(e.target.value))}
            className="w-full h-1.5 bg-[#e5e5e5] rounded-lg appearance-none cursor-pointer accent-[#0a0a0a]"
          />
          <div className="flex justify-between text-[9px] font-mono text-[#737373] tabular-nums">
            <span>Rp 1 Jt</span>
            <span>Rp 25 Jt</span>
            <span>Rp 50 Jt</span>
            <span>Rp 100 Jt</span>
          </div>
        </div>
      </div>

      {/* Positive EV Bets Display with Real-time Sizing Simulation */}
      {positiveBets.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {positiveBets.map((vb, i) => {
            // Hitung porsi taruhan dinamis berdasarkan multiplier
            // Default formula base percentage adalah 1/4 Kelly (0.25)
            const baseStakePct = vb.recommended_stake_percentage || 0;
            const scaledStakePct = +(baseStakePct * (kellyMultiplier / 0.25)).toFixed(1);
            const cappedStakePct = Math.min(scaledStakePct, 10.0); // Hard risk ceiling 10%
            const stakeAmount = (bankroll * cappedStakePct) / 100;
            const potentialProfit = stakeAmount * (vb.bookmaker_odds - 1);

            return (
              <div
                key={`${vb.market_name}-${vb.selection}-${i}`}
                className="p-4 rounded-[18px] bg-white border border-[#e5e5e5] shadow-[0_1px_3px_rgba(0,0,0,0.05)] space-y-3 text-xs font-mono tabular-nums transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 truncate">
                    <ArrowUpRightIcon size={12} className="text-[#0a0a0a] shrink-0" />
                    <span className="font-semibold text-[#0a0a0a] truncate">{vb.selection}</span>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-[18px] text-[10px] font-bold bg-[#0a0a0a] text-white shrink-0">
                    {vb.ev_percentage} EV
                  </span>
                </div>

                {/* Sizing Matrix Grid */}
                <div className="space-y-1.5 pt-2.5 border-t border-[#e5e5e5] text-[11px]">
                  <div className="flex items-center justify-between text-[#737373]">
                    <span>Odds Pasar:</span>
                    <strong className="text-[#0a0a0a]">
                      {Number.isFinite(vb.bookmaker_odds) ? vb.bookmaker_odds.toFixed(2) : "-"}
                    </strong>
                  </div>

                  <div className="flex items-center justify-between text-[#737373]">
                    <span>Alokasi Stake ({cappedStakePct}%):</span>
                    <strong className="text-[#0a0a0a] font-bold">
                      {formatCurrency(stakeAmount)}
                    </strong>
                  </div>

                  <div className="flex items-center justify-between text-[#737373]">
                    <span>Potensi Net Profit:</span>
                    <strong className="text-[#0a0a0a] font-bold">
                      +{formatCurrency(potentialProfit)}
                    </strong>
                  </div>
                </div>

                <p className="text-[10px] text-[#737373] leading-relaxed line-clamp-3 font-sans pt-2 border-t border-[#e5e5e5]">
                  {vb.rationale}
                </p>

                {vb.edge_rating && (
                  <div className="text-[9px] text-[#737373] uppercase pt-2 border-t border-[#e5e5e5] flex justify-between">
                    <span>Edge Rating:</span>
                    <span className="text-[#0a0a0a] font-semibold">{vb.edge_rating}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="p-5 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] text-center text-xs text-[#737373] space-y-1.5">
          <div className="flex items-center justify-center gap-1.5 text-[#0a0a0a]">
            <ShieldIcon size={14} className="text-[#0a0a0a]" />
            <span className="font-mono text-[11px] font-semibold uppercase">
              Disiplin Modal Kuantitatif (Zero +EV)
            </span>
          </div>
          <p className="text-[11px] text-[#737373] leading-relaxed max-w-md mx-auto">
            Tidak ada pasar utama dengan mathematical edge positif (+EV) signifikan pada bursa ini.
            Disarankan menahan diri (<strong className="text-[#0a0a0a]">Pass / Avoid</strong>) demi menjaga modal.
          </p>
        </div>
      )}
    </div>
  );
}
