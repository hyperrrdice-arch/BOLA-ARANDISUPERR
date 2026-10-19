"use client";

import React from "react";
import type { AnalysisView } from "@/lib/view/analysis-view";
import {
  ScaleIcon,
  TrendingUpIcon,
  TrendingDownIcon,
  AlertCircleIcon,
  ShieldIcon,
} from "@/components/icons";

interface SyndicateDebateCardProps {
  debat: AnalysisView["debat"];
}

export function SyndicateDebateCard({
  debat,
}: SyndicateDebateCardProps) {
  const { consensus, supreme, persona, dual_bench } = debat;

  const consensusBadgeClass =
    consensus === "UNANIMOUS" || consensus === "FULL_CONSENSUS"
      ? "flat-tag-zinc border-[#b8b0ff] text-[#f4f4f6]"
      : consensus === "CONCURRING"
      ? "flat-tag-zinc text-[#e8e8ef]"
      : consensus === "SPLIT_DECISION"
      ? "flat-tag-amber text-[#fbbf24]"
      : "flat-tag-red text-[#fb7185]";

  const bullCount = persona.filter((p) => p.role.toLowerCase().includes("bull")).length;
  const bearCount = persona.filter((p) => p.role.toLowerCase().includes("bear")).length;
  const neutralCount = Math.max(0, persona.length - bullCount - bearCount);
  const pct = (n: number) => (persona.length > 0 ? Math.round((n / persona.length) * 100) : 0);

  return (
    <div className="space-y-4 font-sans text-xs">
      {/* 1. SUPREME CONSORTIUM DECISION (MERGED FROM DUAL THINKING) */}
      {supreme && (
        <div className="p-5 rounded-[18px] bg-[#14141f] border border-[#262636] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
            <div className="flex items-center gap-2">
              <ScaleIcon size={16} className="text-[#f4f4f6]" />
              <h3 className="font-semibold text-xs sm:text-sm text-[#f4f4f6] tracking-tight">
                Supreme Syndicate Consortium Verdict
              </h3>
            </div>
            <span className={`px-2.5 py-0.5 rounded-[18px] text-[11px] font-bold ${consensusBadgeClass}`}>
              Status: {consensus.replace(/_/g, " ")}
            </span>
          </div>

          <p className="text-[#e8e8ef] leading-relaxed text-[13px] font-sans">
            {supreme.verdict}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1 tabular-nums">
            <div className="p-3 rounded-[12px] bg-[#1b1b29] border border-[#262636]">
              <span className="text-[11px] text-[#a2a2b5] block">Pasar Final Konsensus</span>
              <strong className="block mt-0.5 text-[#f4f4f6] text-xl sm:text-2xl leading-tight truncate">{supreme.recommended_market}</strong>
            </div>
            <div className="p-3 rounded-[12px] bg-[#1b1b29] border border-[#262636]">
              <span className="text-[11px] text-[#a2a2b5] block">Alokasi Stake Kelly</span>
              <strong className="block mt-0.5 text-[#f4f4f6] text-xl sm:text-2xl leading-tight tabular-nums">{supreme.stake_fraction}</strong>
            </div>
            <div className="p-3 rounded-[12px] bg-[#1b1b29] border border-[#262636]">
              <span className="text-[11px] text-[#a2a2b5] block">Confidence Tier</span>
              <strong className="block mt-0.5 text-[#f4f4f6] text-xl sm:text-2xl leading-tight tabular-nums">{supreme.confidence_tier.replace(/_/g, " ")}</strong>
            </div>
          </div>
        </div>
      )}

      {/* 1B. PETA SUARA SINDIKAT — terbaca tanpa membuka satu pun argumen */}
      <div className="p-4 rounded-[18px] bg-[#14141f] border border-[#262636] space-y-2.5">
        <div className="flex items-center justify-between text-[11px] text-[#a2a2b5]">
          <span className="font-semibold text-[#f4f4f6]">Peta Suara Sindikat</span>
          <span className="tabular-nums">{persona.length} persona</span>
        </div>
        <div
          className="flex h-2.5 w-full rounded-full overflow-hidden bg-[#1b1b29]"
          role="img"
          aria-label={`Bull ${bullCount}, Bear ${bearCount}, Netral ${neutralCount} dari ${persona.length} persona`}
        >
          {bullCount > 0 && <div style={{ width: `${pct(bullCount)}%` }} className="h-full bg-[#34d399]" />}
          {neutralCount > 0 && <div style={{ width: `${pct(neutralCount)}%` }} className="h-full bg-[#4a4a61]" />}
          {bearCount > 0 && <div style={{ width: `${pct(bearCount)}%` }} className="h-full bg-[#fb7185]" />}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] tabular-nums">
          <span className="flex items-center gap-1.5 text-[#e8e8ef]">
            <TrendingUpIcon size={12} className="text-[#34d399]" />
            Bull {bullCount} · {pct(bullCount)}%
          </span>
          <span className="flex items-center gap-1.5 text-[#e8e8ef]">
            <ShieldIcon size={12} className="text-[#a2a2b5]" />
            Netral {neutralCount} · {pct(neutralCount)}%
          </span>
          <span className="flex items-center gap-1.5 text-[#e8e8ef]">
            <TrendingDownIcon size={12} className="text-[#fb7185]" />
            Bear {bearCount} · {pct(bearCount)}%
          </span>
        </div>
      </div>

      {/* 2. DUAL JUDICIAL BENCH (HAKIM 1 & HAKIM 2) */}
      {dual_bench && (
        <div className="p-5 rounded-[18px] bg-[#14141f] border border-[#262636] space-y-3">
          <div className="flex items-center justify-between pb-1">
            <span className="font-semibold text-[#f4f4f6] flex items-center gap-1.5">
              <ScaleIcon size={14} className="text-[#f4f4f6]" />
              Dual Judicial Bench (Cross-Arbiter Examination)
            </span>
            <span className="text-[11px] text-[#a2a2b5]">Dua Mahkamah Independen</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {/* Hakim 1 */}
            <div className="p-4 rounded-[12px] bg-[#1b1b29] border border-[#262636] space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#f4f4f6]">{dual_bench.judgement_1.title || "Hakim 1 (Lead Arbiter)"}</span>
                <span className="text-[11px] text-[#a2a2b5]">{dual_bench.judgement_1.model}</span>
              </div>
              <p className="text-[#e8e8ef] leading-relaxed text-[13px] font-sans">
                {dual_bench.judgement_1.verdict_summary || dual_bench.judgement_1.verdict || dual_bench.judgement_1.key_justification}
              </p>
              {dual_bench.judgement_1.recommended_market && (
                <div className="p-2 rounded-[12px] bg-[#14141f] border border-[#262636] text-[#f4f4f6] text-[11px]">
                  <span className="text-[11px] text-[#a2a2b5] block">Rekomendasi:</span>
                  <strong>{dual_bench.judgement_1.recommended_market}</strong>
                </div>
              )}
            </div>

            {/* Hakim 2 */}
            <div className="p-4 rounded-[12px] bg-[#1b1b29] border border-[#262636] space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#f4f4f6]">{dual_bench.judgement_2.title || "Hakim 2 (Cross-Examiner)"}</span>
                <span className="text-[11px] text-[#a2a2b5]">{dual_bench.judgement_2.model}</span>
              </div>
              <p className="text-[#e8e8ef] leading-relaxed text-[13px] font-sans">
                {dual_bench.judgement_2.verdict_summary || dual_bench.judgement_2.alternative_perspective || dual_bench.judgement_2.verdict || dual_bench.judgement_2.key_justification}
              </p>
              {dual_bench.judgement_2.recommended_market && (
                <div className="p-2 rounded-[12px] bg-[#14141f] border border-[#262636] text-[#f4f4f6] text-[11px]">
                  <span className="text-[11px] text-[#a2a2b5] block">Rekomendasi:</span>
                  <strong>{dual_bench.judgement_2.recommended_market}</strong>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3. MULTI-AGENT SYNDICATE DEBATE PANELS */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-[#a2a2b5]">
          <span className="font-semibold text-[#f4f4f6]">
            Sintesis Adversarial Peran Sindikat ({persona.length} Model Panelists)
          </span>
          <span>Zero Contamination Grounding</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {persona.map((p, idx) => {
            const isBull = p.role.toLowerCase().includes("bull");
            const isBear = p.role.toLowerCase().includes("bear");
            const isNeutral = p.role.toLowerCase().includes("neutral");

            return (
              <div
                key={idx}
                className={`p-4 rounded-[18px] bg-[#14141f] border border-[#262636] border-l-4 space-y-2.5 ${
                  isBull ? "border-l-[#34d399]" : isBear ? "border-l-[#fb7185]" : "border-l-[#4a4a61]"
                }`}
              >
                <div className="flex items-center justify-between pb-1">
                  <span className="font-semibold text-[#f4f4f6] flex items-center gap-1.5 text-[11px]">
                    {isBull && <TrendingUpIcon size={14} className="text-[#f4f4f6]" />}
                    {isBear && <TrendingDownIcon size={14} className="text-[#fb7185]" />}
                    {isNeutral && <ShieldIcon size={14} className="text-[#a2a2b5]" />}
                    {!isBull && !isBear && !isNeutral && <ScaleIcon size={14} className="text-[#f4f4f6]" />}
                    <span>{p.role}</span>
                  </span>
                  <span className="text-[11px] text-[#a2a2b5]">{p.model}</span>
                </div>

                <p className="text-[#e8e8ef] leading-relaxed text-[13px] font-sans">
                  {p.ringkasan}
                </p>

                {p.argumen && p.argumen.length > 0 && (
                  <details className="group pt-1">
                    <summary className="cursor-pointer select-none text-[11px] text-[#f4f4f6] font-semibold flex items-center justify-between">
                      <span>Argumen / Indikator Kunci ({p.argumen.length})</span>
                      <span className="text-[9px] text-[#a2a2b5] font-normal group-open:rotate-180 transition-transform">▼</span>
                    </summary>
                    <div className="space-y-1 pt-1.5">
                      {p.argumen.map((arg, aIdx) => (
                        <div key={aIdx} className="flex items-start gap-1.5 text-[13px] text-[#e8e8ef] font-sans">
                          {isBear ? (
                            <AlertCircleIcon size={12} className="text-[#fb7185] shrink-0 mt-0.5" />
                          ) : (
                            <span className="text-[#f4f4f6]">▸</span>
                          )}
                          <span>{arg}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
