"use client";

import React from "react";
import type { AnalysisView } from "@/lib/view/analysis-view";
import { CpuIcon } from "@/components/icons";

interface ThinkingPlannerCardProps {
  thinking: AnalysisView["thinking"];
}

export function ThinkingPlannerCard({ thinking }: ThinkingPlannerCardProps) {
  const { steps, stop_reason, durasi_ms, planner } = thinking;

  if (!steps || steps.length === 0) return null;

  // Anti-tumpuk: 2 step pertama + semua step yang memicu re-plan tampil terbuka;
  // sisanya dalam satu lipatan. Setiap step membawa hasil coverage_check apa adanya.
  const OPEN_PREFIX = 2;
  const isOpen = (st: (typeof steps)[number], idx: number) =>
    idx < OPEN_PREFIX || Boolean(st.trigger);
  const openSteps = steps.filter((st, idx) => isOpen(st, idx));
  const foldedSteps = steps.filter((st, idx) => !isOpen(st, idx));

  const coverageLabel = (cov: unknown): string | null => {
    if (!cov || typeof cov !== "object") return null;
    const c = cov as { complete?: boolean; gaps?: unknown[]; triggers?: unknown[] };
    if (c.complete === true) return "Cakupan lengkap";
    const gaps = Array.isArray(c.gaps) && c.gaps.length > 0 ? ` gap: ${c.gaps.join(", ")}` : "";
    const trig = Array.isArray(c.triggers) && c.triggers.length > 0 ? ` · trigger: ${c.triggers.join(", ")}` : "";
    return `Cakupan belum lengkap${gaps}${trig}`;
  };

  const renderStep = (st: (typeof steps)[number]) => {
    const cov = coverageLabel(st.coverage);
    return (
      <div
        key={st.step}
        className="p-3 rounded-[16px] bg-[#fafafa] border border-[#e5e5e5] flex items-start gap-3 transition-colors hover:border-[#d4d4d8]"
      >
        <div className="w-5 h-5 rounded-full bg-[#0a0a0a] text-white flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5">
          {st.step}
        </div>
        <div className="space-y-0.5 flex-1 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-[#0a0a0a] text-[11px]">
              Tool: <span className="font-mono text-[#0a0a0a]">{st.tool}</span>
            </span>
            <span className="flex items-center gap-2">
              {typeof st.durasi_ms === "number" && (
                <span className="text-[11px] text-[#0a0a0a] font-semibold tabular-nums">
                  {(st.durasi_ms / 1000).toFixed(1)}s
                </span>
              )}
              {st.trigger && (
                <span className="text-[11px] text-[#0a0a0a] bg-white px-2 py-0.5 rounded-[10px] border border-[#d4d4d8]">
                  Re-plan dipicu: {st.trigger}
                </span>
              )}
            </span>
          </div>
          <p className="text-[#171717] text-[13px] font-sans leading-relaxed">{st.alasan}</p>
          {cov && <p className="text-[11px] text-[#737373] font-sans">{cov}</p>}
          {st.stage_timings && (
            <p className="text-[11px] text-[#737373] font-sans tabular-nums">
              {Object.entries(st.stage_timings)
                .map(([k, v]) => `${k.replace(/_ms$/, "")} ${(v / 1000).toFixed(1)}s`)
                .join(" · ")}
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="p-5 rounded-[24px] bg-white border border-[#e5e5e5] space-y-3 font-mono text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
        <div className="flex items-center gap-2">
          <CpuIcon size={16} className="text-[#0a0a0a]" />
          <h4 className="font-semibold text-xs sm:text-sm text-[#0a0a0a] tracking-tight">
            Cara Agen Menyusun Analisis Ini
          </h4>
        </div>
        <div className="flex items-center gap-2">
          {durasi_ms !== null && durasi_ms !== undefined && (
            <span className="px-2.5 py-0.5 rounded-[18px] text-[11px] font-semibold flat-tag-zinc tabular-nums">
              Durasi: {(durasi_ms / 1000).toFixed(2)}s
            </span>
          )}
          <span className="px-2.5 py-0.5 rounded-[18px] text-[11px] font-semibold flat-tag-zinc">
            Stop: {stop_reason}
          </span>
        </div>
      </div>

      <p className="text-[13px] text-[#737373] font-sans">
        Loop otonom planner — tiap langkah: alasan memilih tool, hasil evaluasi coverage oleh CODE,
        dan trigger machine-verifiable yang memicu re-plan. Tanpa karangan: apa adanya dari trace.
      </p>

      {planner && (
        <p className="text-[11px] text-[#737373] font-sans tabular-nums">
          Waktu loop {(planner.loop_ms / 1000).toFixed(1)}s = tool {(planner.tool_ms / 1000).toFixed(1)}s +
          planner {(planner.planner_overhead_ms / 1000).toFixed(1)}s
          {planner.step_timings.length > 0 && (
            <>
              {" "}
              ({planner.step_timings.length} step, rata-rata planner{" "}
              {(planner.planner_overhead_ms / 1000 / planner.step_timings.length).toFixed(1)}s/step)
            </>
          )}
        </p>
      )}

      <div className="space-y-2 pt-1">{openSteps.map(renderStep)}</div>

      {foldedSteps.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer select-none text-[11px] text-[#0a0a0a] font-semibold flex items-center justify-between">
            <span>{foldedSteps.length} langkah berikutnya</span>
            <span className="text-[10px] text-[#737373] font-normal group-open:rotate-180 transition-transform">
              ▼
            </span>
          </summary>
          <div className="space-y-2 pt-2">{foldedSteps.map(renderStep)}</div>
        </details>
      )}
    </div>
  );
}
