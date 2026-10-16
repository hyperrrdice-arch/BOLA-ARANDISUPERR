"use client";

import React from "react";
import { ShieldIcon, AlertCircleIcon, CpuIcon } from "@/components/icons";
import { Analisis } from "./types";

interface DataIntegrityShieldProps {
  data: Analisis;
}

export function DataIntegrityShield({ data }: DataIntegrityShieldProps) {
  const audit = data.data_integrity_audit;
  const missing = data.data_tidak_tersedia;

  return (
    <div className="p-4 rounded-[24px] bg-white border border-[#e5e5e5] shadow-[0_1px_3px_rgba(0,0,0,0.05)] text-xs space-y-3 text-[#0a0a0a]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldIcon size={14} className="text-[#0a0a0a] shrink-0" />
          <span className="font-bold text-[#0a0a0a] text-xs font-mono tracking-tight uppercase">
            Closed-World Grounding Audit: 100% Deterministic Integrity
          </span>
        </div>

        <div className="flex items-center gap-3 text-[11px] font-mono text-[#737373] tabular-nums">
          <span className="flex items-center gap-1.5">
            <CpuIcon size={12} className="text-[#737373]" />
            <span>Dispatcher:</span>
            <strong className="text-[#0a0a0a] font-bold">
              {audit?.dispatcher_model || "ag/gemini-3.8-flash"}
            </strong>
          </span>
          <span className="text-[#e5e5e5]">|</span>
          <span>
            API Terhemat:{" "}
            <strong className="text-[#0a0a0a] font-bold">
              {audit?.cache_quota_saved ?? 0} Calls
            </strong>
          </span>
        </div>
      </div>

      {/* Missing / Unrecorded Real-world Data Limits */}
      {missing && missing.length > 0 && (
        <div className="pt-2.5 border-t border-[#e5e5e5] flex flex-wrap items-center gap-2">
          <span className="text-[10px] text-[#737373] font-mono uppercase tracking-wider">
            Batasan Faktual Terverifikasi:
          </span>
          {missing.map((msg, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[18px] text-[10px] font-mono bg-[#fafafa] border border-[#e5e5e5] text-[#0a0a0a]"
            >
              <AlertCircleIcon size={10} className="text-[#737373] shrink-0" />
              <span>{msg}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
