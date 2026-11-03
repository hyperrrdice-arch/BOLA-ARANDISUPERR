"use client";

import React from "react";
import type { AnalysisView } from "@/lib/view/analysis-view";
import { SparklesIcon } from "@/components/icons";
import { useGsapChildren } from "./motion";

type SmPrediction = NonNullable<AnalysisView["sm_predictions"]>[number];

interface OuterPredictionsCardProps {
  predictions: SmPrediction[];
}

/* Dumb renderer: string backend ditampilkan apa adanya.
   DILARANG: parse angka, hitung ulang, fetch sendiri, label "rekomendasi". */
export function OuterPredictionsCard({ predictions }: OuterPredictionsCardProps) {
  const rowsRef = useGsapChildren<HTMLDivElement>([predictions.length]);
  if (predictions.length === 0) return null;

  return (
    <div className="rounded-[18px] bg-[#14141f] border border-[#262636] font-sans">
      <details className="group">
        <summary className="cursor-pointer select-none list-none p-5 sm:p-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <SparklesIcon size={16} className="text-[#b8b0ff] shrink-0" />
            <div className="min-w-0">
              <h3 className="font-bold text-sm sm:text-base text-[#f4f4f6] tracking-tight truncate">
                Outer Prediction — Pembanding AI
              </h3>
              <p className="text-[11px] text-[#a2a2b5] mt-0.5">
                Referensi luar, bukan rekomendasi app. Akurasi masih dicatat.
              </p>
            </div>
          </div>
          <span className="shrink-0 px-2.5 py-0.5 rounded-[18px] text-[11px] font-bold bg-[#1b1b29] border border-[#262636] text-[#a2a2b5] tabular-nums">
            {predictions.length} referensi
          </span>
        </summary>

        <div ref={rowsRef} className="px-5 sm:px-6 pb-5 sm:pb-6 space-y-2.5">
          {predictions.map((p, i) => (
            <div
              key={`${p.type}-${i}`}
              className="p-4 rounded-[12px] bg-[#1b1b29] border border-[#262636] space-y-1.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-[#f4f4f6]">{p.type}</span>
                <span className="px-2 py-0.5 rounded-[18px] text-[11px] font-medium bg-[#14141f] border border-[#262636] text-[#a2a2b5]">
                  {p.source}
                </span>
              </div>
              <p className="text-sm text-[#e8e8ef] leading-relaxed tabular-nums">{p.detail}</p>
              {p.fetched_at && (
                <p className="text-[11px] text-[#8e8ea3] tabular-nums">
                  Diambil {p.fetched_at.slice(0, 16).replace("T", " ")}
                </p>
              )}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
