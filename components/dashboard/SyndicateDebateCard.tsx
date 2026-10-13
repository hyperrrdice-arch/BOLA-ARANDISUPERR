"use client";

import React from "react";
import { SyndicateDebateData } from "./types";

interface SyndicateDebateCardProps {
  syndicateData: SyndicateDebateData;
  judgeConsensus?: string;
}

export function SyndicateDebateCard({
  syndicateData,
  judgeConsensus,
}: SyndicateDebateCardProps) {
  const { bull_case, neutral_case, bear_case, dual_judgement, arbiter_verdict } = syndicateData;

  return (
    <div className="flat-card-static p-4 sm:p-5 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#2d3748]">
        <div className="flex items-center gap-2">
          <span className="text-base">🏛️</span>
          <h3 className="font-bold text-xs sm:text-sm text-[#f0f6fc]">
            Multi-Agent Syndicate Consortium (5-Agent Multi-Model &amp; Dual Judicial Bench)
          </h3>
        </div>
        <span className="px-2 py-0.5 rounded text-[10px] font-mono flat-tag-purple">
          5-Model Consortium
        </span>
      </div>

      {/* Stage 1: Bull vs Neutral vs Bear Debate Panels (Flat Solid Styles) */}
      <div className={`grid grid-cols-1 ${neutral_case ? "lg:grid-cols-3" : "md:grid-cols-2"} gap-3 text-xs`}>
        {/* Bull Panel */}
        <div className="p-3.5 rounded-md bg-[#101d16] border border-[#1e4a32] space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-bold text-[#22c55e] flex items-center gap-1.5">
              <span>🟢</span> Bull Analyst (Offensive Upside)
            </span>
            <span className="text-[10px] font-mono text-[#8b949e]">{bull_case.model}</span>
          </div>
          <p className="text-[#cbd5e1] leading-relaxed text-xs">
            {bull_case.thesis}
          </p>
          <div className="pt-2 border-t border-[#1e4a32]/60 space-y-1">
            <span className="text-[10px] font-mono text-[#8b949e] uppercase block">Faktor Pemicu (Key Drivers):</span>
            {bull_case.key_drivers.map((kd, idx) => (
              <div key={idx} className="flex items-start gap-1.5 text-[11px] text-[#cbd5e1]">
                <span className="text-[#22c55e] font-mono">▸</span>
                <span>{kd}</span>
              </div>
            ))}
          </div>
          {bull_case.tactical_edge && (
            <div className="p-2 rounded bg-[#0d1712] border border-[#1e4a32]/60 text-[11px] text-[#86efac] font-mono">
              <strong>Edge Taktikal:</strong> {bull_case.tactical_edge}
            </div>
          )}
        </div>

        {/* Neutral Panel */}
        {neutral_case && (
          <div className="p-3.5 rounded-md bg-[#101824] border border-[#1e3e60] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#38bdf8] flex items-center gap-1.5">
                <span>🔵</span> Neutral Analyst (Equilibrium Baseline)
              </span>
              <span className="text-[10px] font-mono text-[#8b949e]">{neutral_case.model}</span>
            </div>
            <p className="text-[#cbd5e1] leading-relaxed text-xs">
              {neutral_case.thesis}
            </p>
            <div className="pt-2 border-t border-[#1e3e60]/60 space-y-1">
              <span className="text-[10px] font-mono text-[#8b949e] uppercase block">Faktor Empiris &amp; Keseimbangan:</span>
              {neutral_case.empirical_drivers?.map((ef, idx) => (
                <div key={idx} className="flex items-start gap-1.5 text-[11px] text-[#cbd5e1]">
                  <span className="text-[#38bdf8] font-mono">▸</span>
                  <span>{ef}</span>
                </div>
              ))}
            </div>
            {neutral_case.equilibrium_assessment && (
              <div className="p-2 rounded bg-[#0d131d] border border-[#1e3e60]/60 text-[11px] text-[#7dd3fc] font-mono">
                <strong>Asesmen Keseimbangan:</strong> {neutral_case.equilibrium_assessment}
              </div>
            )}
          </div>
        )}

        {/* Bear Panel */}
        <div className="p-3.5 rounded-md bg-[#201214] border border-[#542022] space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-bold text-[#f87171] flex items-center gap-1.5">
              <span>🔴</span> Bear Auditor (Defensive Risk &amp; Traps)
            </span>
            <span className="text-[10px] font-mono text-[#8b949e]">{bear_case.model}</span>
          </div>
          <p className="text-[#cbd5e1] leading-relaxed text-xs">
            {bear_case.thesis}
          </p>
          <div className="pt-2 border-t border-[#542022]/60 space-y-1">
            <span className="text-[10px] font-mono text-[#8b949e] uppercase block">Peringatan Jebakan (Trap Warnings):</span>
            {bear_case.trap_warnings.map((tw, idx) => (
              <div key={idx} className="flex items-start gap-1.5 text-[11px] text-[#cbd5e1]">
                <span className="text-[#f87171] font-mono">⚠</span>
                <span>{tw}</span>
              </div>
            ))}
          </div>
          {bear_case.vulnerability_audit && (
            <div className="p-2 rounded bg-[#180e0f] border border-[#542022]/60 text-[11px] text-[#fca5a5] font-mono">
              <strong>Audit Kerentanan:</strong> {bear_case.vulnerability_audit}
            </div>
          )}
        </div>
      </div>

      {/* Stage 2: Dual Judicial Bench */}
      {dual_judgement ? (
        <div className="space-y-3 pt-3 border-t border-[#2d3748]">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-[#818cf8] flex items-center gap-1.5">
              <span>⚖️</span> Dual Judicial Bench (Dual Arbiters Cross-Examination)
            </span>
            <span className="text-[10px] font-mono text-[#8b949e]">
              Dua Mahkamah Arbitrase Independen
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {/* Hakim 1 Panel */}
            <div className="p-3.5 rounded-md bg-[#161324] border border-[#383162] space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#818cf8] flex items-center gap-1.5">
                  <span>🧑‍⚖️</span> {dual_judgement.judgement_1.title || "Hakim 1 (Chief Quant Arbiter)"}
                </span>
                <span className="text-[10px] font-mono text-[#8b949e]">
                  {dual_judgement.judgement_1.model}
                </span>
              </div>
              <div>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold flat-tag-purple">
                  Tier: {dual_judgement.judgement_1.confidence_tier.replace(/_/g, " ")}
                </span>
              </div>
              <p className="text-[#cbd5e1] leading-relaxed">
                {dual_judgement.judgement_1.verdict_summary}
              </p>
              {dual_judgement.judgement_1.key_reasoning && (
                <div className="pt-2 border-t border-[#383162]/60 space-y-1">
                  <span className="text-[10px] font-mono text-[#8b949e] uppercase block">Pertimbangan Utama:</span>
                  <p className="text-[11px] text-[#cbd5e1] leading-relaxed">
                    {dual_judgement.judgement_1.key_reasoning}
                  </p>
                </div>
              )}
              <div className="p-2 rounded bg-[#0f0d19] border border-[#383162]/60 text-[#818cf8] font-mono text-[11px] mt-1">
                <span className="text-[9px] text-[#8b949e] block">Rekomendasi Pasar:</span>
                <strong>{dual_judgement.judgement_1.recommended_market}</strong>
              </div>
            </div>

            {/* Hakim 2 Panel */}
            <div className="p-3.5 rounded-md bg-[#1d1710] border border-[#4d371d] space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#fbbf24] flex items-center gap-1.5">
                  <span>🧑‍⚖️</span> {dual_judgement.judgement_2.title || "Hakim 2 (Cross-Arbiter)"}
                </span>
                <span className="text-[10px] font-mono text-[#8b949e]">
                  {dual_judgement.judgement_2.model}
                </span>
              </div>
              <div>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold flat-tag-amber">
                  Tier: {dual_judgement.judgement_2.confidence_tier.replace(/_/g, " ")}
                </span>
              </div>
              <p className="text-[#cbd5e1] leading-relaxed">
                {dual_judgement.judgement_2.verdict_summary}
              </p>
              {dual_judgement.judgement_2.alternative_perspective && (
                <div className="pt-2 border-t border-[#4d371d]/60 space-y-1">
                  <span className="text-[10px] font-mono text-[#8b949e] uppercase block">Perspektif Independen &amp; Cross-Exam:</span>
                  <p className="text-[11px] text-[#cbd5e1] leading-relaxed">
                    {dual_judgement.judgement_2.alternative_perspective}
                  </p>
                </div>
              )}
              <div className="p-2 rounded bg-[#130f0a] border border-[#4d371d]/60 text-[#fbbf24] font-mono text-[11px] mt-1">
                <span className="text-[9px] text-[#8b949e] block">Rekomendasi Pasar:</span>
                <strong>{dual_judgement.judgement_2.recommended_market}</strong>
              </div>
            </div>
          </div>

          {/* Supreme Syndicate Consensus Box */}
          <div className="p-4 rounded-md bg-[#13111e] border border-[#383162] space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-[#f0f6fc] flex items-center gap-1.5 text-sm">
                <span>🏛️</span> Supreme Consortium Decision
              </span>
              <span className={`px-2.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                dual_judgement.consensus_level === "UNANIMOUS"
                  ? "flat-tag-green"
                  : dual_judgement.consensus_level === "CONCURRING"
                  ? "flat-tag-blue"
                  : dual_judgement.consensus_level === "SPLIT_DECISION"
                  ? "flat-tag-amber"
                  : "flat-tag-red"
              }`}>
                Status: {dual_judgement.consensus_level.replace(/_/g, " ")}
              </span>
            </div>

            <p className="text-[#cbd5e1] leading-relaxed">
              {dual_judgement.supreme_verdict}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-[#2d3748] font-mono text-[11px]">
              <div className="p-2.5 rounded bg-[#0d1117] border border-[#2d3748] text-[#818cf8]">
                <span className="text-[10px] text-[#8b949e] block">Pasar Final Konsensus:</span>
                <strong className="block mt-0.5">{dual_judgement.final_recommended_market}</strong>
              </div>
              <div className="p-2.5 rounded bg-[#0d1117] border border-[#2d3748] text-[#22c55e]">
                <span className="text-[10px] text-[#8b949e] block">Alokasi Stake Kelly:</span>
                <strong className="block mt-0.5">{dual_judgement.final_stake_fraction}</strong>
              </div>
              <div className="p-2.5 rounded bg-[#0d1117] border border-[#2d3748] text-[#fbbf24]">
                <span className="text-[10px] text-[#8b949e] block">Confidence Tier:</span>
                <strong className="block mt-0.5">{dual_judgement.final_confidence_tier.replace(/_/g, " ")}</strong>
              </div>
            </div>
          </div>
        </div>
      ) : arbiter_verdict && (
        /* Legacy Arbiter Fallback */
        <div className="p-3.5 rounded-md bg-[#161324] border border-[#383162] space-y-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-[#818cf8] flex items-center gap-1.5">
              <span>⚖️</span> Chief Risk Officer Verdict (Final Consensus)
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-[#8b949e]">{arbiter_verdict.model}</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                arbiter_verdict.confidence_tier === "A_HIGH_VALUE"
                  ? "flat-tag-green"
                  : arbiter_verdict.confidence_tier === "B_MODERATE"
                  ? "flat-tag-blue"
                  : arbiter_verdict.confidence_tier === "C_LEAN"
                  ? "flat-tag-amber"
                  : "flat-tag-slate"
              }`}>
                Tier: {arbiter_verdict.confidence_tier.replace(/_/g, " ")}
              </span>
            </div>
          </div>

          <p className="text-[#cbd5e1] leading-relaxed">
            {arbiter_verdict.chief_risk_officer_synthesis}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-[#383162]/60 font-mono text-[11px]">
            <div className="p-2 rounded bg-[#0f0d19] text-[#818cf8]">
              <span className="text-[10px] text-[#8b949e] block">Rekomendasi Pasar:</span>
              <strong>{arbiter_verdict.recommended_market}</strong>
            </div>
            <div className="p-2 rounded bg-[#0f0d19] text-[#22c55e]">
              <span className="text-[10px] text-[#8b949e] block">Ukuran Alokasi Stake:</span>
              <strong>{arbiter_verdict.recommended_stake_fraction}</strong>
            </div>
          </div>
        </div>
      )}

      {/* Judge Consensus Callout */}
      {judgeConsensus && (
        <div className="flat-callout flex items-start gap-3 border-[#383162] bg-[#161324]">
          <span className="text-lg shrink-0 mt-0.5">⚖️</span>
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-[#818cf8] font-mono uppercase">
              Sintesis Konsensus Panel &amp; Keputusan Hakim (Judge Consensus)
            </h4>
            <p className="text-xs text-[#cbd5e1] leading-relaxed">
              {judgeConsensus}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
