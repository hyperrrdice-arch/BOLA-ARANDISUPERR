"use client";

import React from "react";
import type { AnalysisView } from "@/lib/view/analysis-view";
import {
  ScaleIcon,
  TrendingUpIcon,
  TrendingDownIcon,
  AlertCircleIcon,
  ShieldIcon,
  CheckCircleIcon,
} from "@/components/icons";

interface SyndicateDebateCardProps {
  debat: AnalysisView["debat"];
  homeTeam?: string;
  awayTeam?: string;
}

export function SyndicateDebateCard({
  debat,
  homeTeam = "Tim Kandang",
  awayTeam = "Tim Tamu",
}: SyndicateDebateCardProps) {
  const { consensus, supreme, persona, dual_bench } = debat;

  const consensusBadgeClass =
    consensus === "UNANIMOUS" || consensus === "FULL_CONSENSUS"
      ? "flat-tag-zinc border-[#0a0a0a] text-[#0a0a0a]"
      : consensus === "CONCURRING"
      ? "flat-tag-zinc text-[#171717]"
      : consensus === "SPLIT_DECISION"
      ? "flat-tag-amber text-[#b45309]"
      : "flat-tag-red text-[#e11d48]";

  return (
    <div className="space-y-4 font-mono text-xs">
      {/* 1. SUPREME CONSORTIUM DECISION (MERGED FROM DUAL THINKING) */}
      {supreme && (
        <div className="p-5 rounded-[24px] bg-white border border-[#e5e5e5] shadow-[0_1px_3px_rgba(0,0,0,0.05)] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#e5e5e5]">
            <div className="flex items-center gap-2">
              <ScaleIcon size={16} className="text-[#0a0a0a]" />
              <h3 className="font-semibold text-xs sm:text-sm text-[#0a0a0a] tracking-tight uppercase">
                Supreme Syndicate Consortium Verdict
              </h3>
            </div>
            <span className={`px-2.5 py-0.5 rounded-[18px] text-[10px] font-bold uppercase tracking-wider ${consensusBadgeClass}`}>
              Status: {consensus.replace(/_/g, " ")}
            </span>
          </div>

          <p className="text-[#171717] leading-relaxed text-xs">
            {supreme.verdict}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-[#e5e5e5] tabular-nums">
            <div className="p-3 rounded-[14px] bg-[#fafafa] border border-[#e5e5e5]">
              <span className="text-[10px] text-[#737373] uppercase block">Pasar Final Konsensus</span>
              <strong className="block mt-0.5 text-[#0a0a0a] text-xs sm:text-sm">{supreme.recommended_market}</strong>
            </div>
            <div className="p-3 rounded-[14px] bg-[#fafafa] border border-[#e5e5e5]">
              <span className="text-[10px] text-[#737373] uppercase block">Alokasi Stake Kelly</span>
              <strong className="block mt-0.5 text-[#0a0a0a] text-xs sm:text-sm">{supreme.stake_fraction}</strong>
            </div>
            <div className="p-3 rounded-[14px] bg-[#fafafa] border border-[#e5e5e5]">
              <span className="text-[10px] text-[#737373] uppercase block">Confidence Tier</span>
              <strong className="block mt-0.5 text-[#0a0a0a] text-xs sm:text-sm">{supreme.confidence_tier.replace(/_/g, " ")}</strong>
            </div>
          </div>
        </div>
      )}

      {/* 2. DUAL JUDICIAL BENCH (HAKIM 1 & HAKIM 2) */}
      {dual_bench && (
        <div className="p-5 rounded-[24px] bg-white border border-[#e5e5e5] shadow-[0_1px_3px_rgba(0,0,0,0.05)] space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#e5e5e5]">
            <span className="font-semibold text-[#0a0a0a] uppercase tracking-wider flex items-center gap-1.5">
              <ScaleIcon size={14} className="text-[#0a0a0a]" />
              Dual Judicial Bench (Cross-Arbiter Examination)
            </span>
            <span className="text-[10px] text-[#737373]">Dua Mahkamah Independen</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {/* Hakim 1 */}
            <div className="p-4 rounded-[16px] bg-[#fafafa] border border-[#e5e5e5] space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#0a0a0a]">{dual_bench.judgement_1.title || "Hakim 1 (Lead Arbiter)"}</span>
                <span className="text-[10px] text-[#737373]">{dual_bench.judgement_1.model}</span>
              </div>
              <p className="text-[#171717] leading-relaxed">
                {dual_bench.judgement_1.verdict_summary || dual_bench.judgement_1.verdict || dual_bench.judgement_1.key_justification}
              </p>
              {dual_bench.judgement_1.recommended_market && (
                <div className="p-2 rounded-[10px] bg-white border border-[#e5e5e5] text-[#0a0a0a] text-[11px]">
                  <span className="text-[9px] text-[#737373] block uppercase">Rekomendasi:</span>
                  <strong>{dual_bench.judgement_1.recommended_market}</strong>
                </div>
              )}
            </div>

            {/* Hakim 2 */}
            <div className="p-4 rounded-[16px] bg-[#fafafa] border border-[#e5e5e5] space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#0a0a0a]">{dual_bench.judgement_2.title || "Hakim 2 (Cross-Examiner)"}</span>
                <span className="text-[10px] text-[#737373]">{dual_bench.judgement_2.model}</span>
              </div>
              <p className="text-[#171717] leading-relaxed">
                {dual_bench.judgement_2.verdict_summary || dual_bench.judgement_2.alternative_perspective || dual_bench.judgement_2.verdict || dual_bench.judgement_2.key_justification}
              </p>
              {dual_bench.judgement_2.recommended_market && (
                <div className="p-2 rounded-[10px] bg-white border border-[#e5e5e5] text-[#0a0a0a] text-[11px]">
                  <span className="text-[9px] text-[#737373] block uppercase">Rekomendasi:</span>
                  <strong>{dual_bench.judgement_2.recommended_market}</strong>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3. MULTI-AGENT SYNDICATE DEBATE PANELS */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-[#737373]">
          <span className="font-semibold text-[#0a0a0a] uppercase tracking-wider">
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
                className="p-4 rounded-[20px] bg-white border border-[#e5e5e5] shadow-[0_1px_2px_rgba(0,0,0,0.03)] space-y-2.5"
              >
                <div className="flex items-center justify-between pb-1.5 border-b border-[#e5e5e5]">
                  <span className="font-semibold text-[#0a0a0a] flex items-center gap-1.5 uppercase text-[11px]">
                    {isBull && <TrendingUpIcon size={14} className="text-[#0a0a0a]" />}
                    {isBear && <TrendingDownIcon size={14} className="text-[#e11d48]" />}
                    {isNeutral && <ShieldIcon size={14} className="text-[#737373]" />}
                    {!isBull && !isBear && !isNeutral && <ScaleIcon size={14} className="text-[#0a0a0a]" />}
                    <span>{p.role}</span>
                  </span>
                  <span className="text-[10px] text-[#737373]">{p.model}</span>
                </div>

                <p className="text-[#171717] leading-relaxed text-xs">
                  {p.ringkasan}
                </p>

                {p.argumen && p.argumen.length > 0 && (
                  <div className="pt-2 border-t border-[#e5e5e5] space-y-1">
                    <span className="text-[10px] text-[#737373] uppercase tracking-wider block">
                      Argumen / Indikator Kunci:
                    </span>
                    {p.argumen.map((arg, aIdx) => (
                      <div key={aIdx} className="flex items-start gap-1.5 text-[11px] text-[#171717]">
                        {isBear ? (
                          <AlertCircleIcon size={12} className="text-[#e11d48] shrink-0 mt-0.5" />
                        ) : (
                          <span className="text-[#0a0a0a]">▸</span>
                        )}
                        <span>{arg}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
