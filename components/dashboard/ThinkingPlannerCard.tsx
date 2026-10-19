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

  // Terlipat default: seluruh jejak di dalam satu <details> agar ringkasan tetap ramping.

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
        className="p-3 rounded-[16px] bg-[#1b1b29] border border-[#262636] flex items-start gap-3 transition-colors hover:border-[#34344a]"
      >
        <div className="w-5 h-5 rounded-full bg-[#b8b0ff] text-[#17131f] flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5">
          {st.step}
        </div>
        <div className="space-y-0.5 flex-1 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-[#f4f4f6] text-[11px]">
              Tool: <span className="font-sans text-[#f4f4f6]">{st.tool}</span>
            </span>
            <span className="flex items-center gap-2">
              {typeof st.durasi_ms === "number" && (
                <span className="text-[11px] text-[#f4f4f6] font-semibold tabular-nums">
                  {(st.durasi_ms / 1000).toFixed(1)}s
                </span>
              )}
              {st.trigger && (
                <span className="text-[11px] text-[#f4f4f6] bg-[#14141f] px-2 py-0.5 rounded-[10px] border border-[#34344a]">
                  Re-plan dipicu: {st.trigger}
                </span>
              )}
            </span>
          </div>
          <p className="text-[#e8e8ef] text-[13px] font-sans leading-relaxed">{st.alasan}</p>
          {cov && <p className="text-[11px] text-[#a2a2b5] font-sans">{cov}</p>}
          {st.stage_timings && (
            <p className="text-[11px] text-[#a2a2b5] font-sans tabular-nums">
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
    <div className="p-5 rounded-[18px] bg-[#14141f] border border-[#262636] space-y-3 font-sans text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
        <div className="flex items-center gap-2">
          <CpuIcon size={16} className="text-[#f4f4f6]" />
          <h4 className="font-semibold text-xs sm:text-sm text-[#f4f4f6] tracking-tight">
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

      <p className="text-[13px] text-[#a2a2b5] font-sans">
        Loop otonom planner — tiap langkah: alasan memilih tool, hasil evaluasi coverage oleh CODE,
        dan trigger machine-verifiable yang memicu re-plan. Tanpa karangan: apa adanya dari trace.
      </p>

      {planner && (
        <p className="text-[11px] text-[#a2a2b5] font-sans tabular-nums">
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

      <details className="group">
        <summary className="cursor-pointer select-none text-[11px] text-[#f4f4f6] font-semibold flex items-center justify-between">
          <span>
            Jejak planner: {steps.length} langkah
            {durasi_ms !== null && durasi_ms !== undefined && (
              <> · {(durasi_ms / 1000).toFixed(1)}s</>
            )}{" "}
            · stop {stop_reason}
          </span>
          <span className="text-[10px] text-[#a2a2b5] font-normal group-open:rotate-180 transition-transform">
            ▼
          </span>
        </summary>
        <div className="space-y-2 pt-2">{steps.map(renderStep)}</div>
      </details>
    </div>
  );
}
