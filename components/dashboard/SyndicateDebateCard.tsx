"use client";

import React from "react";
import { SyndicateDebateData } from "./types";
import { ScaleIcon, TrendingUpIcon, TrendingDownIcon, AlertCircleIcon, ShieldIcon } from "@/components/icons";

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
    <div className="doppel-shell">
      <div className="doppel-core space-y-4">
        {/* Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <ScaleIcon size={16} className="text-[#818cf8]" />
            <h3 className="font-bold text-xs sm:text-sm text-[#f8fafc] font-mono tracking-tight uppercase">
              Multi-Agent Syndicate Consortium (5-Agent Multi-Model &amp; Dual Judicial Bench)
            </h3>
          </div>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono flat-tag-purple font-semibold">
            5-Model Consortium Active
          </span>
        </div>

        {/* Stage 1: Bull vs Neutral vs Bear Debate Panels */}
        <div className={`grid grid-cols-1 ${neutral_case ? "lg:grid-cols-3" : "md:grid-cols-2"} gap-3 text-xs`}>
          {/* Bull Analyst Panel */}
          <div className="p-3.5 rounded-lg bg-[#06281e] border border-[#134e3a] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#10b981] flex items-center gap-1.5 font-mono text-[11px] uppercase">
                <TrendingUpIcon size={13} />
                <span>Bull Analyst (Offensive Upside)</span>
              </span>
              <span className="text-[10px] font-mono text-[#64748b]">{bull_case.model}</span>
            </div>
            <p className="text-[#cbd5e1] leading-relaxed text-xs">
              {bull_case.thesis}
            </p>
            <div className="pt-2 border-t border-[#134e3a]/60 space-y-1">
              <span className="text-[10px] font-mono text-[#94a3b8] uppercase tracking-wider block">
                Faktor Pemicu (Key Drivers):
              </span>
              {bull_case.key_drivers.map((kd, idx) => (
                <div key={`bull-${idx}-${kd.slice(0, 15)}`} className="flex items-start gap-1.5 text-[11px] text-[#cbd5e1]">
                  <span className="text-[#10b981] font-mono">▸</span>
                  <span>{kd}</span>
                </div>
              ))}
            </div>
            {bull_case.tactical_edge && (
              <div className="p-2 rounded-md bg-[#041d16] border border-[#134e3a] text-[11px] text-[#86efac] font-mono">
                <strong className="text-[#10b981]">Edge Taktikal:</strong> {bull_case.tactical_edge}
              </div>
            )}
          </div>

          {/* Neutral Analyst Panel */}
          {neutral_case && (
            <div className="p-3.5 rounded-lg bg-[#07242c] border border-[#0e4c5b] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#06b6d4] flex items-center gap-1.5 font-mono text-[11px] uppercase">
                  <ShieldIcon size={13} />
                  <span>Neutral Analyst (Equilibrium)</span>
                </span>
                <span className="text-[10px] font-mono text-[#64748b]">{neutral_case.model}</span>
              </div>
              <p className="text-[#cbd5e1] leading-relaxed text-xs">
                {neutral_case.thesis}
              </p>
              <div className="pt-2 border-t border-[#0e4c5b]/60 space-y-1">
                <span className="text-[10px] font-mono text-[#94a3b8] uppercase tracking-wider block">
                  Faktor Empiris &amp; Keseimbangan:
                </span>
                {neutral_case.empirical_drivers?.map((ef, idx) => (
                  <div key={`neutral-${idx}-${ef.slice(0, 15)}`} className="flex items-start gap-1.5 text-[11px] text-[#cbd5e1]">
                    <span className="text-[#06b6d4] font-mono">▸</span>
                    <span>{ef}</span>
                  </div>
                ))}
              </div>
              {neutral_case.equilibrium_assessment && (
                <div className="p-2 rounded-md bg-[#051c22] border border-[#0e4c5b] text-[11px] text-[#7dd3fc] font-mono">
                  <strong className="text-[#06b6d4]">Asesmen Keseimbangan:</strong> {neutral_case.equilibrium_assessment}
                </div>
              )}
            </div>
          )}

          {/* Bear Auditor Panel */}
          <div className="p-3.5 rounded-lg bg-[#2a0a11] border border-[#5b1322] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#f43f5e] flex items-center gap-1.5 font-mono text-[11px] uppercase">
                <TrendingDownIcon size={13} />
                <span>Bear Auditor (Risk &amp; Traps)</span>
              </span>
              <span className="text-[10px] font-mono text-[#64748b]">{bear_case.model}</span>
            </div>
            <p className="text-[#cbd5e1] leading-relaxed text-xs">
              {bear_case.thesis}
            </p>
            <div className="pt-2 border-t border-[#5b1322]/60 space-y-1">
              <span className="text-[10px] font-mono text-[#94a3b8] uppercase tracking-wider block">
                Peringatan Jebakan (Trap Warnings):
              </span>
              {bear_case.trap_warnings.map((tw, idx) => (
                <div key={`bear-${idx}-${tw.slice(0, 15)}`} className="flex items-start gap-1.5 text-[11px] text-[#cbd5e1]">
                  <AlertCircleIcon size={11} className="text-[#f43f5e] shrink-0 mt-0.5" />
                  <span>{tw}</span>
                </div>
              ))}
            </div>
            {bear_case.vulnerability_audit && (
              <div className="p-2 rounded-md bg-[#20070c] border border-[#5b1322] text-[11px] text-[#fca5a5] font-mono">
                <strong className="text-[#f43f5e]">Audit Kerentanan:</strong> {bear_case.vulnerability_audit}
              </div>
            )}
          </div>
        </div>

        {/* Stage 2: Dual Judicial Bench */}
        {dual_judgement ? (
          <div className="space-y-3 pt-3 border-t border-white/[0.06]">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-[#818cf8] font-mono uppercase tracking-wider flex items-center gap-1.5">
                <ScaleIcon size={14} />
                <span>Dual Judicial Bench (Cross-Arbiter Examination)</span>
              </span>
              <span className="text-[10px] font-mono text-[#64748b]">
                Dua Mahkamah Arbitrase Independen
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {/* Hakim 1 Panel */}
              <div className="p-3.5 rounded-lg bg-[#14142b] border border-[#312e81] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#818cf8] flex items-center gap-1.5 font-mono">
                    <ScaleIcon size={13} />
                    <span>{dual_judgement.judgement_1.title || "Hakim 1 (Chief Quant Arbiter)"}</span>
                  </span>
                  <span className="text-[10px] font-mono text-[#64748b]">
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
                  <div className="pt-2 border-t border-[#312e81]/60 space-y-1">
                    <span className="text-[10px] font-mono text-[#94a3b8] uppercase tracking-wider block">
                      Pertimbangan Utama:
                    </span>
                    <p className="text-[11px] text-[#cbd5e1] leading-relaxed">
                      {dual_judgement.judgement_1.key_reasoning}
                    </p>
                  </div>
                )}
                <div className="p-2 rounded-md bg-[#0e0e1f] border border-[#312e81]/60 text-[#818cf8] font-mono text-[11px] mt-1">
                  <span className="text-[9px] text-[#64748b] block uppercase">Rekomendasi Pasar:</span>
                  <strong>{dual_judgement.judgement_1.recommended_market}</strong>
                </div>
              </div>

              {/* Hakim 2 Panel */}
              <div className="p-3.5 rounded-lg bg-[#261a06] border border-[#5c3d0b] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#f59e0b] flex items-center gap-1.5 font-mono">
                    <ScaleIcon size={13} />
                    <span>{dual_judgement.judgement_2.title || "Hakim 2 (Cross-Arbiter)"}</span>
                  </span>
                  <span className="text-[10px] font-mono text-[#64748b]">
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
                  <div className="pt-2 border-t border-[#5c3d0b]/60 space-y-1">
                    <span className="text-[10px] font-mono text-[#94a3b8] uppercase tracking-wider block">
                      Perspektif Independen &amp; Cross-Exam:
                    </span>
                    <p className="text-[11px] text-[#cbd5e1] leading-relaxed">
                      {dual_judgement.judgement_2.alternative_perspective}
                    </p>
                  </div>
                )}
                <div className="p-2 rounded-md bg-[#1b1204] border border-[#5c3d0b]/60 text-[#f59e0b] font-mono text-[11px] mt-1">
                  <span className="text-[9px] text-[#64748b] block uppercase">Rekomendasi Pasar:</span>
                  <strong>{dual_judgement.judgement_2.recommended_market}</strong>
                </div>
              </div>
            </div>

            {/* Supreme Syndicate Consensus Box */}
            <div className="p-4 rounded-lg bg-[#0e0e1a] border border-[#312e81] space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-[#f8fafc] flex items-center gap-1.5 text-sm font-mono tracking-tight uppercase">
                  <ScaleIcon size={16} className="text-[#818cf8]" />
                  <span>Supreme Consortium Decision</span>
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider ${
                    dual_judgement.consensus_level === "UNANIMOUS"
                      ? "flat-tag-green"
                      : dual_judgement.consensus_level === "CONCURRING"
                      ? "flat-tag-blue"
                      : dual_judgement.consensus_level === "SPLIT_DECISION"
                      ? "flat-tag-amber"
                      : "flat-tag-red"
                  }`}
                >
                  Status: {dual_judgement.consensus_level.replace(/_/g, " ")}
                </span>
              </div>

              <p className="text-[#cbd5e1] leading-relaxed">
                {dual_judgement.supreme_verdict}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-white/[0.06] font-mono text-[11px] tabular-nums">
                <div className="p-2.5 rounded-md bg-[#0a0c12] border border-white/[0.06] text-[#818cf8]">
                  <span className="text-[10px] text-[#64748b] uppercase block">Pasar Final Konsensus</span>
                  <strong className="block mt-0.5 text-white">{dual_judgement.final_recommended_market}</strong>
                </div>
                <div className="p-2.5 rounded-md bg-[#0a0c12] border border-white/[0.06] text-[#10b981]">
                  <span className="text-[10px] text-[#64748b] uppercase block">Alokasi Stake Kelly</span>
                  <strong className="block mt-0.5">{dual_judgement.final_stake_fraction}</strong>
                </div>
                <div className="p-2.5 rounded-md bg-[#0a0c12] border border-white/[0.06] text-[#f59e0b]">
                  <span className="text-[10px] text-[#64748b] uppercase block">Confidence Tier</span>
                  <strong className="block mt-0.5">{dual_judgement.final_confidence_tier.replace(/_/g, " ")}</strong>
                </div>
              </div>
            </div>
          </div>
        ) : arbiter_verdict && (
          /* Legacy Arbiter Fallback */
          <div className="p-3.5 rounded-lg bg-[#14142b] border border-[#312e81] space-y-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-[#818cf8] flex items-center gap-1.5 font-mono">
                <ScaleIcon size={14} />
                <span>Chief Risk Officer Verdict (Final Consensus)</span>
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-[#64748b]">{arbiter_verdict.model}</span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                    arbiter_verdict.confidence_tier === "A_HIGH_VALUE"
                      ? "flat-tag-green"
                      : arbiter_verdict.confidence_tier === "B_MODERATE"
                      ? "flat-tag-blue"
                      : arbiter_verdict.confidence_tier === "C_LEAN"
                      ? "flat-tag-amber"
                      : "flat-tag-slate"
                  }`}
                >
                  Tier: {arbiter_verdict.confidence_tier.replace(/_/g, " ")}
                </span>
              </div>
            </div>

            <p className="text-[#cbd5e1] leading-relaxed">
              {arbiter_verdict.chief_risk_officer_synthesis}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-[#312e81]/60 font-mono text-[11px] tabular-nums">
              <div className="p-2 rounded-md bg-[#0a0c12] text-[#818cf8]">
                <span className="text-[10px] text-[#64748b] uppercase block">Rekomendasi Pasar</span>
                <strong>{arbiter_verdict.recommended_market}</strong>
              </div>
              <div className="p-2 rounded-md bg-[#0a0c12] text-[#10b981]">
                <span className="text-[10px] text-[#64748b] uppercase block">Ukuran Alokasi Stake</span>
                <strong>{arbiter_verdict.recommended_stake_fraction}</strong>
              </div>
            </div>
          </div>
        )}

        {/* Judge Consensus Callout */}
        {judgeConsensus && (
          <div className="p-3.5 rounded-lg border border-[#312e81] bg-[#14142b] flex items-start gap-3">
            <ScaleIcon size={15} className="text-[#818cf8] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-xs font-bold text-[#818cf8] font-mono uppercase tracking-wider">
                Sintesis Konsensus Panel &amp; Keputusan Hakim (Judge Consensus)
              </h4>
              <p className="text-xs text-[#cbd5e1] leading-relaxed">
                {judgeConsensus}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
