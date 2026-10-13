"use client";

import React from "react";
import { ShieldIcon } from "@/components/icons";
import { Analisis } from "./types";

interface DataIntegrityShieldProps {
  data: Analisis;
}

export function DataIntegrityShield({ data }: DataIntegrityShieldProps) {
  const audit = data.data_integrity_audit;
  const missing = data.data_tidak_tersedia;

  return (
    <div className="flat-callout p-3.5 border-[#1e4a32] bg-[#101f16] text-xs space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldIcon size={15} className="text-[#22c55e] shrink-0" />
          <span className="font-bold text-[#22c55e] text-xs font-mono">
            DATA INTEGRITY: 100% CLOSED-WORLD GROUNDED
          </span>
        </div>

        <div className="flex items-center gap-3 text-[11px] font-mono text-[#8b949e]">
          <span>
            Dispatcher:{" "}
            <strong className="text-[#cbd5e1]">
              {audit?.dispatcher_model || "ag/gemini-3.8-flash"}
            </strong>
          </span>
          <span>•</span>
          <span>
            API Dihemat:{" "}
            <strong className="text-[#22c55e]">
              {audit?.cache_quota_saved ?? 0} Calls
            </strong>
          </span>
        </div>
      </div>

      {/* Missing / Unrecorded Real-world Data Limits */}
      {missing && missing.length > 0 && (
        <div className="pt-2 border-t border-[#1e4a32]/60 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-[#8b949e] font-mono">
            Batasan Faktual Terverifikasi:
          </span>
          {missing.map((msg, idx) => (
            <span
              key={idx}
              className="px-2 py-0.5 rounded text-[10px] font-mono flat-tag-amber"
            >
              ⚠️ {msg}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
