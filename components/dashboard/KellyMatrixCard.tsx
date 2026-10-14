"use client";

import React from "react";
import { ValueBetItem } from "./types";
import { CoinsIcon, ArrowUpRightIcon, ShieldIcon } from "@/components/icons";

interface KellyMatrixCardProps {
  valueBets: ValueBetItem[];
}

export function KellyMatrixCard({ valueBets }: KellyMatrixCardProps) {
  const positiveBets = valueBets.filter((vb) => vb.is_positive_ev);

  return (
    <div className="doppel-shell">
      <div className="doppel-core space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <CoinsIcon size={15} className="text-[#10b981]" />
            <h4 className="font-bold text-xs sm:text-sm text-[#f8fafc] font-mono tracking-tight uppercase">
              Sinyal Expected Value (+EV) &amp; Kelly Sizing
            </h4>
          </div>
          <span className="text-[10px] font-mono text-[#94a3b8] uppercase">
            Fractional Kelly Criterion (1/4 Sizing)
          </span>
        </div>

        {positiveBets.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {positiveBets.map((vb, i) => (
              <div
                key={`${vb.market_name}-${vb.selection}-${i}`}
                className="p-3.5 rounded-lg bg-[#06281e] border border-[#134e3a] space-y-2.5 text-xs font-mono tabular-nums shadow-[0_2px_12px_rgba(16,185,129,0.08)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 truncate">
                    <ArrowUpRightIcon size={12} className="text-[#10b981] shrink-0" />
                    <span className="font-bold text-[#f8fafc] truncate">{vb.selection}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold flat-tag-green shrink-0">
                    {vb.ev_percentage} EV
                  </span>
                </div>

                <div className="flex items-center justify-between text-[11px] text-[#94a3b8] pt-1.5 border-t border-[#134e3a]/60">
                  <span>
                    Odds Pasar: <strong className="text-white">{Number.isFinite(vb.bookmaker_odds) ? vb.bookmaker_odds.toFixed(2) : "-"}</strong>
                  </span>
                  <span className="text-[#10b981] font-bold">
                    Stake: {vb.recommended_stake_percentage}%
                  </span>
                </div>

                <p className="text-[10px] text-[#cbd5e1] leading-relaxed line-clamp-3 font-sans">
                  {vb.rationale}
                </p>

                {vb.edge_rating && (
                  <div className="text-[9px] text-[#94a3b8] uppercase pt-1 border-t border-[#134e3a]/40 flex justify-between">
                    <span>Edge Rating:</span>
                    <span className="text-[#10b981] font-semibold">{vb.edge_rating}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 rounded-lg bg-[#0f131a] border border-white/[0.06] text-center text-xs text-[#94a3b8] space-y-1">
            <div className="flex items-center justify-center gap-1.5 text-[#f59e0b]">
              <ShieldIcon size={13} />
              <span className="font-mono text-[11px] font-semibold uppercase">Disiplin Modal Kuantitatif (Zero +EV)</span>
            </div>
            <p className="text-[11px] text-[#64748b] leading-relaxed">
              Tidak ada pasar utama dengan mathematical edge positif (+EV) signifikan pada bursa ini.
              Disarankan menahan diri (<strong className="text-[#94a3b8]">Pass / Avoid</strong>) demi menjaga modal.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
