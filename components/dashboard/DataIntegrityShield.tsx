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
    <div className="p-4 rounded-[24px] bg-white border border-[#e5e5e5] text-xs space-y-3 text-[#0a0a0a] font-mono">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldIcon size={14} className="text-[#0a0a0a] shrink-0" />
          <span className="font-bold text-[#0a0a0a] text-xs tracking-tight">
            Closed-World Grounding Audit: 100% Deterministic Integrity
          </span>
        </div>
      </div>

      {/* Missing / Unrecorded Real-world Data Limits */}
      {(missing.length > 0 || statusEstimasi.length > 0) && (
        <div className="pt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-[#737373]">
            Integritas Faktual &amp; Telemetri:
          </span>
          {missing.map((msg: string, idx: number) => (
            <span
              key={`gap-${idx}`}
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[18px] text-[11px] bg-[#fafafa] border border-[#e5e5e5] text-[#0a0a0a]"
            >
              <AlertCircleIcon size={10} className="text-[#737373] shrink-0" />
              <span>{msg}</span>
            </span>
          ))}
          {statusEstimasi.map((est: string, idx: number) => (
            <span
              key={`est-${idx}`}
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[18px] text-[11px] bg-[#f5f5f5] border border-[#e5e5e5] text-[#737373]"
            >
              <AlertCircleIcon size={10} className="text-[#737373] shrink-0" />
              <span>{est}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
