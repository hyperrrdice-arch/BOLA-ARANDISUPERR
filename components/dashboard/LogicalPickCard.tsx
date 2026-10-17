"use client";

import { LogicalPickItem } from "./types";

interface LogicalPickCardProps {
  pick: LogicalPickItem;
}

// Kartu pick tunggal: header, metric strip, rationale, dan footer Alokasi Kelly
export function LogicalPickCard({ pick }: LogicalPickCardProps) {
  return (
    <div
      className="p-4 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] hover:border-[#0a0a0a]/30 transition-colors space-y-3 font-mono"
    >
      {/* Pick Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-[18px] bg-white border border-[#e5e5e5] text-[#0a0a0a]">
              {pick.category}
            </span>
            <span className="text-[11px] text-[#737373]">{pick.market_name}</span>
          </div>
          <h5 className="text-xs font-bold text-[#0a0a0a]">{pick.selection}</h5>
        </div>

        <span
          className={`text-[11px] font-extrabold px-2.5 py-0.5 rounded-[18px] border ${
            pick.confidence_level === "SANGAT TINGGI"
              ? "bg-[#0a0a0a] text-white border-[#0a0a0a]"
              : "bg-white text-[#0a0a0a] border-[#e5e5e5]"
          }`}
        >
          {pick.confidence_level}
        </span>
      </div>

      {/* Metric Strip */}
      <div className="grid grid-cols-4 gap-1.5 p-2 rounded-[18px] bg-white border border-[#e5e5e5] text-center text-xs tabular-nums">
        <div>
          <span className="text-[11px] text-[#737373] block">1xBet</span>
          <span className="text-xs font-bold text-[#0a0a0a]">
            {pick.bookmaker_odds.toFixed(2)}
          </span>
        </div>
        <div>
          <span className="text-[11px] text-[#737373] block">Fair Odds</span>
          <span className="text-xs font-medium text-[#737373]">
            {pick.fair_odds > 0 ? pick.fair_odds.toFixed(2) : "—"}
          </span>
        </div>
        <div>
          <span className="text-[11px] text-[#737373] block">Win Prob</span>
          <span className="text-xs font-bold text-[#0a0a0a]">
            {pick.model_probability > 0 ? `${(pick.model_probability * 100).toFixed(0)}%` : "—"}
          </span>
        </div>
        <div>
          <span className="text-[11px] text-[#737373] block">+EV Edge</span>
          <span className="text-xs font-bold text-[#0a0a0a]">
            {pick.ev_percentage || "—"}
          </span>
        </div>
      </div>

      {/* Rationale */}
      <p className="text-[13px] text-[#737373] leading-relaxed font-sans">
        {pick.rationale}
      </p>

      {/* Kelly Fraction footer */}
      <div className="flex items-center justify-between pt-1 text-[11px] text-[#737373]">
        <span>Alokasi Kelly Rekomendasi:</span>
        <span className="font-bold text-[#0a0a0a]">
          {pick.kelly_percentage > 0 ? `${pick.kelly_percentage}% Bankroll` : "—"}
        </span>
      </div>
    </div>
  );
}
