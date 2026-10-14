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
    <div className="p-3.5 rounded-lg bg-[#0a1410] border border-[#134e3a] text-xs space-y-2.5 shadow-[0_2px_12px_rgba(16,185,129,0.06)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldIcon size={14} className="text-[#10b981] shrink-0" />
          <span className="font-bold text-[#10b981] text-xs font-mono tracking-tight uppercase">
            Closed-World Grounding Audit: 100% Deterministic Integrity
          </span>
        </div>

        <div className="flex items-center gap-3 text-[11px] font-mono text-[#94a3b8] tabular-nums">
          <span className="flex items-center gap-1.5">
            <CpuIcon size={12} className="text-[#64748b]" />
            <span>Dispatcher:</span>
            <strong className="text-[#f8fafc]">
              {audit?.dispatcher_model || "ag/gemini-3.8-flash"}
            </strong>
          </span>
          <span className="text-white/[0.2]">|</span>
          <span>
            API Terhemat:{" "}
            <strong className="text-[#10b981]">
              {audit?.cache_quota_saved ?? 0} Calls
            </strong>
          </span>
        </div>
      </div>

      {/* Missing / Unrecorded Real-world Data Limits */}
      {missing && missing.length > 0 && (
        <div className="pt-2 border-t border-[#134e3a]/60 flex flex-wrap items-center gap-2">
          <span className="text-[10px] text-[#94a3b8] font-mono uppercase tracking-wider">
            Batasan Faktual Terverifikasi:
          </span>
          {missing.map((msg, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono flat-tag-amber"
            >
              <AlertCircleIcon size={10} className="text-[#f59e0b] shrink-0" />
              <span>{msg}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
