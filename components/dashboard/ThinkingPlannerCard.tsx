"use client";

import React from "react";
import type { AnalysisView } from "@/lib/view/analysis-view";
import { CpuIcon, CheckCircleIcon, ZapIcon, ActivityIcon } from "@/components/icons";

interface ThinkingPlannerCardProps {
  thinking: AnalysisView["thinking"];
}

export function ThinkingPlannerCard({ thinking }: ThinkingPlannerCardProps) {
  const { steps, stop_reason, durasi_ms } = thinking;

  if (!steps || steps.length === 0) return null;

  return (
    <div className="p-5 rounded-[24px] bg-white border border-[#e5e5e5] shadow-[0_1px_3px_rgba(0,0,0,0.05)] space-y-3 font-mono text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#e5e5e5]">
        <div className="flex items-center gap-2">
          <CpuIcon size={16} className="text-[#0a0a0a]" />
          <h4 className="font-semibold text-xs sm:text-sm text-[#0a0a0a] tracking-tight uppercase">
            Jejak Penalaran Agen (Thinking Planner Trace)
          </h4>
        </div>
        <div className="flex items-center gap-2">
          {durasi_ms !== null && durasi_ms !== undefined && (
            <span className="px-2.5 py-0.5 rounded-[18px] text-[10px] font-semibold flat-tag-zinc tabular-nums">
              Durasi: {(durasi_ms / 1000).toFixed(2)}s
            </span>
          )}
          <span className="px-2.5 py-0.5 rounded-[18px] text-[10px] font-semibold flat-tag-zinc uppercase">
            Stop: {stop_reason}
          </span>
        </div>
      </div>

      <p className="text-[11px] text-[#737373] font-sans">
        Rangkaian tahapan otonom planner (Plan → Act → Evaluate) yang dijalankan sistem untuk mengekstrak fakta dan memitigasi celah data:
      </p>

      <div className="space-y-2 pt-1">
        {steps.map((st, idx) => (
          <div
            key={idx}
            className="p-3 rounded-[16px] bg-[#fafafa] border border-[#e5e5e5] flex items-start gap-3 transition-colors hover:border-[#d4d4d8]"
          >
            <div className="w-5 h-5 rounded-full bg-[#0a0a0a] text-white flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
              {st.step}
            </div>
            <div className="space-y-0.5 flex-1 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-[#0a0a0a] uppercase tracking-wide text-[11px]">
                  Tool: <span className="font-mono text-[#0a0a0a]">{st.tool}</span>
                </span>
                {st.trigger && (
                  <span className="text-[9px] text-[#737373] bg-white px-2 py-0.5 rounded-[10px] border border-[#e5e5e5]">
                    Pemicu: {st.trigger}
                  </span>
                )}
              </div>
              <p className="text-[#171717] text-xs font-sans leading-relaxed">
                {st.alasan}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
