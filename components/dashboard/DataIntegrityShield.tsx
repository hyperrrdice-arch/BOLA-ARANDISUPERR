"use client";

import React from "react";
import { ShieldIcon, AlertCircleIcon } from "@/components/icons";
import type { AnalysisView } from "@/lib/view/analysis-view";

interface DataIntegrityShieldProps {
  integrity?: AnalysisView["ringkasan"]["integrity"];
}

export function DataIntegrityShield({ integrity }: DataIntegrityShieldProps) {
  const missing = integrity?.gaps || [];
  const statusEstimasi = integrity?.status_estimasi || [];

  return (
    <div className="p-4 rounded-[18px] bg-[#14141f] border border-[#262636] text-xs space-y-3 text-[#f4f4f6] font-sans">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldIcon size={14} className="text-[#f4f4f6] shrink-0" />
          <span className="font-bold text-[#f4f4f6] text-xs tracking-tight">
            Audit Data: gap &amp; estimasi tercatat apa adanya
          </span>
          {missing.length > 0 ? (
            <span className="px-2 py-0.5 rounded-[18px] text-[11px] font-bold bg-[#1b1b29] border border-[#262636] text-[#fbbf24] tabular-nums">
              {missing.length} gap
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-[18px] text-[11px] font-bold bg-[#1b1b29] border border-[#262636] text-[#34d399]">
              Lengkap
            </span>
          )}
        </div>
      </div>

      {/* Missing / Unrecorded Real-world Data Limits */}
      {(missing.length > 0 || statusEstimasi.length > 0) && (
        <details className="group">
          <summary className="cursor-pointer select-none text-[11px] text-[#a2a2b5] font-semibold">
            Rincian: {missing.length} gap · {statusEstimasi.length} estimasi
          </summary>
          <div className="pt-2.5 flex flex-wrap items-center gap-2">
          {missing.map((msg: string, idx: number) => (
            <span
              key={`gap-${idx}`}
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[18px] text-[11px] bg-[#1b1b29] border border-[#262636] text-[#f4f4f6]"
            >
              <AlertCircleIcon size={10} className="text-[#a2a2b5] shrink-0" />
              <span>{msg}</span>
            </span>
          ))}
          {statusEstimasi.map((est: string, idx: number) => (
            <span
              key={`est-${idx}`}
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[18px] text-[11px] bg-[#1b1b29] border border-[#262636] text-[#a2a2b5]"
            >
              <AlertCircleIcon size={10} className="text-[#a2a2b5] shrink-0" />
              <span>{est}</span>
            </span>
          ))}
          </div>
        </details>
      )}
    </div>
  );
}
