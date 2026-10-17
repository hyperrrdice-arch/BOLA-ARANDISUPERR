"use client";

import React from "react";
import { WhistleIcon, LayersIcon, FlameIcon } from "@/components/icons";

interface StatsAndSplitsCardProps {
  splits?: {
    form_kandang: string;
    form_tamu: string;
    rekor_kandang_spesifik: string;
    rekor_tandang_spesifik: string;
  };
  homeTeam?: string;
  awayTeam?: string;
  data?: any;
}

export function StatsAndSplitsCard({ splits, homeTeam, awayTeam, data }: StatsAndSplitsCardProps) {
  const timKandang = homeTeam || data?.pertandingan?.tim_kandang || "Tim Kandang";
  const timTamu = awayTeam || data?.pertandingan?.tim_tamu || "Tim Tamu";
  const formKandang = splits?.form_kandang || data?.form_dan_split?.form_kandang || "-";
  const formTamu = splits?.form_tamu || data?.form_dan_split?.form_tamu || "-";
  const rekorKandang = splits?.rekor_kandang_spesifik || data?.form_dan_split?.rekor_kandang_spesifik || "Ulasan split kandang stabil.";
  const rekorTandang = splits?.rekor_tandang_spesifik || data?.form_dan_split?.rekor_tandang_spesifik || "Ulasan split tandang stabil.";

  return (
    <div className="space-y-4 font-mono text-xs">
      {/* Home / Away Isolated Splits */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 rounded-[24px] bg-white border border-[#e5e5e5] shadow-[0_1px_3px_rgba(0,0,0,0.05)] space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#e5e5e5]">
            <h4 className="text-xs font-bold text-[#0a0a0a] uppercase tracking-wider">
              {timKandang} (Kandang)
            </h4>
            <span className="text-[10px] px-2.5 py-0.5 rounded-[18px] font-semibold bg-[#fafafa] border border-[#e5e5e5] text-[#0a0a0a]">
              HOME SPLIT
            </span>
          </div>
          <p className="text-xs text-[#0a0a0a] tabular-nums">
            Form 5 Laga: <strong className="text-[#0a0a0a] font-bold">{formKandang}</strong>
          </p>
          <div className="p-3.5 rounded-[16px] bg-[#fafafa] border border-[#e5e5e5] text-xs text-[#737373] leading-relaxed text-[11px] font-sans">
            {rekorKandang}
          </div>
        </div>

        <div className="p-5 rounded-[24px] bg-white border border-[#e5e5e5] shadow-[0_1px_3px_rgba(0,0,0,0.05)] space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#e5e5e5]">
            <h4 className="text-xs font-bold text-[#0a0a0a] uppercase tracking-wider">
              {timTamu} (Tandang)
            </h4>
            <span className="text-[10px] px-2.5 py-0.5 rounded-[18px] font-semibold bg-[#fafafa] border border-[#e5e5e5] text-[#0a0a0a]">
              AWAY SPLIT
            </span>
          </div>
          <p className="text-xs text-[#0a0a0a] tabular-nums">
            Form 5 Laga: <strong className="text-[#0a0a0a] font-bold">{formTamu}</strong>
          </p>
          <div className="p-3.5 rounded-[16px] bg-[#fafafa] border border-[#e5e5e5] text-xs text-[#737373] leading-relaxed text-[11px] font-sans">
            {rekorTandang}
          </div>
        </div>
      </div>
    </div>
  );
}
