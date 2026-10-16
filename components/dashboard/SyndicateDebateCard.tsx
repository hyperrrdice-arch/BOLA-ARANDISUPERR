"use client";

import React from "react";
import { SyndicateDebateData } from "./types";
import {
  ScaleIcon,
  TrendingUpIcon,
  TrendingDownIcon,
  AlertCircleIcon,
  ShieldIcon,
  CheckCircleIcon,
} from "@/components/icons";

interface SyndicateDebateCardProps {
  syndicateData: SyndicateDebateData;
  judgeConsensus?: string;
}

export function SyndicateDebateCard({
  syndicateData,
  judgeConsensus,
}: SyndicateDebateCardProps) {
  const { bull_case, neutral_case, bear_case, dual_judgement, arbiter_verdict } = syndicateData;

  // 5-Agent Syndicate Pipeline Nodes
  const syndicateAgents = [
    { id: 1, name: "Data Specialist", role: "Telemetry Ingestion", status: "Resolved", tag: "Grounding" },
    { id: 2, name: "Quant Auditor", role: "Dixon-Coles & Poisson", status: "Resolved", tag: "λ / μ Models" },
    { id: 3, name: "Tactical Modeler", role: "Field Control & Lineup", status: "Resolved", tag: "Formations" },
    { id: 4, name: "Risk Assessor", role: "Vig & Trap Audit", status: "Resolved", tag: "Bear Traps" },
    { id: 5, name: "Judicial Bench", role: "Supreme Consensus", status: "Resolved", tag: "Dual Arbiters" },
  ];

  return (
    <div className="p-5 rounded-[24px] bg-white border border-[#e5e5e5] shadow-[0_1px_3px_rgba(0,0,0,0.05)] space-y-4">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#e5e5e5]">
        <div className="flex items-center gap-2">
          <ScaleIcon size={16} className="text-[#0a0a0a]" />
          <h3 className="font-semibold text-xs sm:text-sm text-[#0a0a0a] font-mono tracking-tight uppercase">
            Multi-Agent Syndicate Consortium (5-Agent Multi-Model &amp; Dual Judicial Bench)
          </h3>
        </div>
        <span className="px-2.5 py-0.5 rounded-[18px] text-[10px] font-mono flat-tag-zinc font-semibold">
          5-Model Consortium Active
        </span>
      </div>

      {/* Minimal Horizontal Stepper for 5-Agent Progress */}
      <div className="p-3.5 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] overflow-x-auto scrollbar-thin">
        <div className="flex items-center justify-between min-w-[540px] gap-2 text-xs font-mono">
          {syndicateAgents.map((ag, idx) => (
            <React.Fragment key={ag.id}>
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-[#0a0a0a] text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                  <CheckCircleIcon size={12} />
                </div>
                <div>
                  <span className="text-[11px] font-semibold text-[#0a0a0a] block truncate max-w-[95px]">
                    {ag.name}
                  </span>
                  <span className="text-[9px] text-[#737373] block truncate max-w-[95px]">
                    {ag.tag}
                  </span>
                </div>
              </div>
              {idx < syndicateAgents.length - 1 && (
                <div className="h-px flex-1 bg-[#e5e5e5] min-w-[15px]" />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Stage 1: Bull vs Neutral vs Bear Debate Panels */}
      <div className={`grid grid-cols-1 ${neutral_case ? "lg:grid-cols-3" : "md:grid-cols-2"} gap-3 text-xs`}>
        {/* Bull Analyst Panel */}
        <div className="p-4 rounded-[18px] bg-white border border-[#e5e5e5] shadow-[0_1px_2px_rgba(0,0,0,0.02)] space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[#0a0a0a] flex items-center gap-1.5 font-mono text-[11px] uppercase">
              <TrendingUpIcon size={13} className="text-[#0a0a0a]" />
              <span>Bull Analyst (Offensive Upside)</span>
            </span>
            <span className="text-[10px] font-mono text-[#737373]">{bull_case.model}</span>
          </div>
          <p className="text-[#171717] leading-relaxed text-xs">
            {bull_case.thesis}
          </p>
          <div className="pt-2 border-t border-[#e5e5e5] space-y-1">
            <span className="text-[10px] font-mono text-[#737373] uppercase tracking-wider block">
              Faktor Pemicu (Key Drivers):
            </span>
            {bull_case.key_drivers.map((kd, idx) => (
              <div key={`bull-${idx}-${kd.slice(0, 15)}`} className="flex items-start gap-1.5 text-[11px] text-[#171717]">
                <span className="text-[#0a0a0a] font-mono">▸</span>
                <span>{kd}</span>
              </div>
            ))}
          </div>
          {bull_case.tactical_edge && (
            <div className="p-2.5 rounded-[12px] bg-[#fafafa] border border-[#e5e5e5] text-[11px] text-[#0a0a0a] font-mono">
              <strong className="text-[#0a0a0a]">Edge Taktikal:</strong> {bull_case.tactical_edge}
            </div>
          )}
        </div>

        {/* Neutral Analyst Panel */}
        {neutral_case && (
          <div className="p-4 rounded-[18px] bg-white border border-[#e5e5e5] shadow-[0_1px_2px_rgba(0,0,0,0.02)] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#0a0a0a] flex items-center gap-1.5 font-mono text-[11px] uppercase">
                <ShieldIcon size={13} className="text-[#0a0a0a]" />
                <span>Neutral Analyst (Equilibrium)</span>
              </span>
              <span className="text-[10px] font-mono text-[#737373]">{neutral_case.model}</span>
            </div>
            <p className="text-[#171717] leading-relaxed text-xs">
              {neutral_case.thesis}
            </p>
            <div className="pt-2 border-t border-[#e5e5e5] space-y-1">
              <span className="text-[10px] font-mono text-[#737373] uppercase tracking-wider block">
                Faktor Empiris &amp; Keseimbangan:
              </span>
              {neutral_case.empirical_drivers?.map((ef, idx) => (
                <div key={`neutral-${idx}-${ef.slice(0, 15)}`} className="flex items-start gap-1.5 text-[11px] text-[#171717]">
                  <span className="text-[#0a0a0a] font-mono">▸</span>
                  <span>{ef}</span>
                </div>
              ))}
            </div>
            {neutral_case.equilibrium_assessment && (
              <div className="p-2.5 rounded-[12px] bg-[#fafafa] border border-[#e5e5e5] text-[11px] text-[#0a0a0a] font-mono">
                <strong className="text-[#0a0a0a]">Asesmen Keseimbangan:</strong> {neutral_case.equilibrium_assessment}
              </div>
            )}
          </div>
        )}

        {/* Bear Auditor Panel */}
        <div className="p-4 rounded-[18px] bg-white border border-[#e5e5e5] shadow-[0_1px_2px_rgba(0,0,0,0.02)] space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[#0a0a0a] flex items-center gap-1.5 font-mono text-[11px] uppercase">
              <TrendingDownIcon size={13} className="text-[#0a0a0a]" />
              <span>Bear Auditor (Risk &amp; Traps)</span>
            </span>
            <span className="text-[10px] font-mono text-[#737373]">{bear_case.model}</span>
          </div>
          <p className="text-[#171717] leading-relaxed text-xs">
            {bear_case.thesis}
          </p>
          <div className="pt-2 border-t border-[#e5e5e5] space-y-1">
            <span className="text-[10px] font-mono text-[#737373] uppercase tracking-wider block">
              Peringatan Jebakan (Trap Warnings):
            </span>
            {bear_case.trap_warnings.map((tw, idx) => (
              <div key={`bear-${idx}-${tw.slice(0, 15)}`} className="flex items-start gap-1.5 text-[11px] text-[#171717]">
                <AlertCircleIcon size={12} className="text-[#e7000b] shrink-0 mt-0.5" />
                <span>{tw}</span>
              </div>
            ))}
          </div>
          {bear_case.vulnerability_audit && (
            <div className="p-2.5 rounded-[12px] bg-[#e7000b]/5 border border-[#e7000b]/20 text-[11px] text-[#0a0a0a] font-mono">
              <strong className="text-[#e7000b]">Audit Kerentanan:</strong> {bear_case.vulnerability_audit}
            </div>
          )}
        </div>
      </div>

      {/* Stage 2: Dual Judicial Bench */}
      {dual_judgement ? (
        <div className="space-y-3 pt-3 border-t border-[#e5e5e5]">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[#0a0a0a] font-mono uppercase tracking-wider flex items-center gap-1.5">
              <ScaleIcon size={14} className="text-[#0a0a0a]" />
              <span>Dual Judicial Bench (Cross-Arbiter Examination)</span>
            </span>
            <span className="text-[10px] font-mono text-[#737373]">
              Dua Mahkamah Arbitrase Independen
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {/* Hakim 1 Panel */}
            <div className="p-4 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#0a0a0a] flex items-center gap-1.5 font-mono">
                  <ScaleIcon size={13} className="text-[#0a0a0a]" />
                  <span>{dual_judgement.judgement_1.title || "Hakim 1 (Chief Quant Arbiter)"}</span>
                </span>
                <span className="text-[10px] font-mono text-[#737373]">
                  {dual_judgement.judgement_1.model}
                </span>
              </div>
              <div>
                <span className="px-2.5 py-0.5 rounded-[18px] text-[10px] font-mono font-semibold flat-tag-zinc">
                  Tier: {dual_judgement.judgement_1.confidence_tier.replace(/_/g, " ")}
                </span>
              </div>
              <p className="text-[#171717] leading-relaxed">
                {dual_judgement.judgement_1.verdict_summary}
              </p>
              {dual_judgement.judgement_1.key_reasoning && (
                <div className="pt-2 border-t border-[#e5e5e5] space-y-1">
                  <span className="text-[10px] font-mono text-[#737373] uppercase tracking-wider block">
                    Pertimbangan Utama:
                  </span>
                  <p className="text-[11px] text-[#171717] leading-relaxed font-sans">
                    {dual_judgement.judgement_1.key_reasoning}
                  </p>
                </div>
              )}
              <div className="p-2.5 rounded-[12px] bg-white border border-[#e5e5e5] text-[#0a0a0a] font-mono text-[11px] mt-1 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                <span className="text-[9px] text-[#737373] block uppercase">Rekomendasi Pasar:</span>
                <strong>{dual_judgement.judgement_1.recommended_market}</strong>
              </div>
            </div>

            {/* Hakim 2 Panel */}
            <div className="p-4 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#0a0a0a] flex items-center gap-1.5 font-mono">
                  <ScaleIcon size={13} className="text-[#0a0a0a]" />
                  <span>{dual_judgement.judgement_2.title || "Hakim 2 (Cross-Arbiter)"}</span>
                </span>
                <span className="text-[10px] font-mono text-[#737373]">
                  {dual_judgement.judgement_2.model}
                </span>
              </div>
              <div>
                <span className="px-2.5 py-0.5 rounded-[18px] text-[10px] font-mono font-semibold flat-tag-zinc">
                  Tier: {dual_judgement.judgement_2.confidence_tier.replace(/_/g, " ")}
                </span>
              </div>
              <p className="text-[#171717] leading-relaxed">
                {dual_judgement.judgement_2.verdict_summary}
              </p>
              {dual_judgement.judgement_2.alternative_perspective && (
                <div className="pt-2 border-t border-[#e5e5e5] space-y-1">
                  <span className="text-[10px] font-mono text-[#737373] uppercase tracking-wider block">
                    Perspektif Independen &amp; Cross-Exam:
                  </span>
                  <p className="text-[11px] text-[#171717] leading-relaxed font-sans">
                    {dual_judgement.judgement_2.alternative_perspective}
                  </p>
                </div>
              )}
              <div className="p-2.5 rounded-[12px] bg-white border border-[#e5e5e5] text-[#0a0a0a] font-mono text-[11px] mt-1 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                <span className="text-[9px] text-[#737373] block uppercase">Rekomendasi Pasar:</span>
                <strong>{dual_judgement.judgement_2.recommended_market}</strong>
              </div>
            </div>
          </div>

          {/* Supreme Syndicate Consensus Box */}
          <div className="p-4 rounded-[18px] bg-white border border-[#e5e5e5] shadow-[0_1px_3px_rgba(0,0,0,0.05)] space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-[#0a0a0a] flex items-center gap-1.5 text-sm font-mono tracking-tight uppercase">
                <ScaleIcon size={16} className="text-[#0a0a0a]" />
                <span>Supreme Consortium Decision</span>
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-[18px] text-[10px] font-mono font-bold uppercase tracking-wider ${
                  dual_judgement.consensus_level === "UNANIMOUS"
                    ? "flat-tag-white"
                    : dual_judgement.consensus_level === "CONCURRING"
                    ? "flat-tag-zinc"
                    : dual_judgement.consensus_level === "SPLIT_DECISION"
                    ? "flat-tag-amber"
                    : "flat-tag-red"
                }`}
              >
                Status: {dual_judgement.consensus_level.replace(/_/g, " ")}
              </span>
            </div>

            <p className="text-[#171717] leading-relaxed">
              {dual_judgement.supreme_verdict}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-[#e5e5e5] font-mono text-[11px] tabular-nums">
              <div className="p-3 rounded-[12px] bg-[#fafafa] border border-[#e5e5e5] text-[#0a0a0a]">
                <span className="text-[10px] text-[#737373] uppercase block">Pasar Final Konsensus</span>
                <strong className="block mt-0.5 text-[#0a0a0a]">{dual_judgement.final_recommended_market}</strong>
              </div>
              <div className="p-3 rounded-[12px] bg-[#fafafa] border border-[#e5e5e5] text-[#0a0a0a]">
                <span className="text-[10px] text-[#737373] uppercase block">Alokasi Stake Kelly</span>
                <strong className="block mt-0.5 text-[#0a0a0a]">{dual_judgement.final_stake_fraction}</strong>
              </div>
              <div className="p-3 rounded-[12px] bg-[#fafafa] border border-[#e5e5e5] text-[#0a0a0a]">
                <span className="text-[10px] text-[#737373] uppercase block">Confidence Tier</span>
                <strong className="block mt-0.5 text-[#0a0a0a]">{dual_judgement.final_confidence_tier.replace(/_/g, " ")}</strong>
              </div>
            </div>
          </div>
        </div>
      ) : arbiter_verdict && (
        /* Legacy Arbiter Fallback */
        <div className="p-4 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] space-y-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-[#0a0a0a] flex items-center gap-1.5 font-mono">
              <ScaleIcon size={14} className="text-[#0a0a0a]" />
              <span>Chief Risk Officer Verdict (Final Consensus)</span>
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-[#737373]">{arbiter_verdict.model}</span>
              <span
                className={`px-2.5 py-0.5 rounded-[18px] text-[10px] font-mono font-bold uppercase ${
                  arbiter_verdict.confidence_tier === "A_HIGH_VALUE"
                    ? "flat-tag-white"
                    : arbiter_verdict.confidence_tier === "B_MODERATE"
                    ? "flat-tag-zinc"
                    : arbiter_verdict.confidence_tier === "C_LEAN"
                    ? "flat-tag-amber"
                    : "flat-tag-slate"
                }`}
              >
                Tier: {arbiter_verdict.confidence_tier.replace(/_/g, " ")}
              </span>
            </div>
          </div>

          <p className="text-[#171717] leading-relaxed">
            {arbiter_verdict.chief_risk_officer_synthesis}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-[#e5e5e5] font-mono text-[11px] tabular-nums">
            <div className="p-2.5 rounded-[12px] bg-white border border-[#e5e5e5] text-[#0a0a0a]">
              <span className="text-[10px] text-[#737373] uppercase block">Rekomendasi Pasar</span>
              <strong>{arbiter_verdict.recommended_market}</strong>
            </div>
            <div className="p-2.5 rounded-[12px] bg-white border border-[#e5e5e5] text-[#0a0a0a]">
              <span className="text-[10px] text-[#737373] uppercase block">Ukuran Alokasi Stake</span>
              <strong>{arbiter_verdict.recommended_stake_fraction}</strong>
            </div>
          </div>
        </div>
      )}

      {/* Judge Consensus Callout */}
      {judgeConsensus && (
        <div className="p-4 rounded-[18px] border border-[#e5e5e5] bg-[#fafafa] flex items-start gap-3">
          <ScaleIcon size={15} className="text-[#0a0a0a] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="text-xs font-semibold text-[#0a0a0a] font-mono uppercase tracking-wider">
              Sintesis Konsensus Panel &amp; Keputusan Hakim (Judge Consensus)
            </h4>
            <p className="text-xs text-[#171717] leading-relaxed">
              {judgeConsensus}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
