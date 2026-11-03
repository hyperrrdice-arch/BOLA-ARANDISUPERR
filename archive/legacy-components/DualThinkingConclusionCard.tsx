"use client";

import React from "react";
import {
  SyndicateDualJudgement,
  SyndicateArbiterVerdict,
} from "./types";
import {
  ScaleIcon,
  ShieldIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  ArrowUpRightIcon,
  ZapIcon,
  CpuIcon,
} from "@/components/icons";

interface DualThinkingConclusionCardProps {
  dualJudgement?: SyndicateDualJudgement;
  arbiterVerdict?: SyndicateArbiterVerdict;
  prediction?: {
    hasil: string;
    keyakinan: "rendah" | "sedang" | "tinggi" | string;
    alasan: string;
    konsensus_panel?: string;
  };
  homeTeam?: string;
  awayTeam?: string;
}

export function DualThinkingConclusionCard({
  dualJudgement,
  arbiterVerdict,
  prediction,
  homeTeam = "Tim Kandang",
  awayTeam = "Tim Tamu",
}: DualThinkingConclusionCardProps) {
  // Fallback defaults if dualJudgement is undefined
  const hasDual = Boolean(dualJudgement);

  const consensusLevel = dualJudgement?.consensus_level || "CONCURRING";
  const consensusBadgeClass =
    consensusLevel === "UNANIMOUS"
      ? "flat-tag-green text-[#10b981] border-[#134e3a]"
      : consensusLevel === "CONCURRING"
      ? "flat-tag-blue text-[#818cf8] border-[#312e81]"
      : consensusLevel === "SPLIT_DECISION"
      ? "flat-tag-amber text-[#f59e0b] border-[#78350f]"
      : "flat-tag-red text-[#f43f5e] border-[#881337]";

  const consensusDescription =
    consensusLevel === "UNANIMOUS"
      ? "Kedua hakim sepakat bulat pada proyeksi edge matematis & arah taruhan tanpa friksi."
      : consensusLevel === "CONCURRING"
      ? "Kedua hakim menyepakati arah umum pertandingan dengan sedikit perbedaan margin/line."
      : consensusLevel === "SPLIT_DECISION"
      ? "Terjadi friksi model antara proyeksi upside dan perangkap vig. Kelly stake dipangkas defensif."
      : "Dissent tajam antar model penalaran. Sinyal pasar tidak stabil — disarankan No Bet / Pass.";

  const judge1 = dualJudgement?.judgement_1;
  const judge2 = dualJudgement?.judgement_2;

  const finalMarket =
    dualJudgement?.final_recommended_market ||
    arbiterVerdict?.recommended_market ||
    prediction?.hasil ||
    "Pasar 1X2 Reguler";

  const finalConfidence =
    dualJudgement?.final_confidence_tier ||
    arbiterVerdict?.confidence_tier ||
    (prediction?.keyakinan === "tinggi" ? "A_HIGH_VALUE" : "B_MODERATE");

  const finalStake =
    dualJudgement?.final_stake_fraction ||
    arbiterVerdict?.recommended_stake_fraction ||
    "2.5% Bankroll (Quarter Kelly)";

  const supremeVerdictText =
    dualJudgement?.supreme_verdict ||
    arbiterVerdict?.chief_risk_officer_synthesis ||
    prediction?.alasan ||
    "Konsensus menyimpulkan tidak ada anomali harga yang cukup lebar untuk taruhan agresif.";

  return (
    <div className="p-5 rounded-[24px] bg-white border border-[#e5e5e5] shadow-[0_1px_3px_rgba(0,0,0,0.05)] w-full font-mono space-y-5">
      {/* Header Mahkamah Dual Thinking */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#e5e5e5]">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ScaleIcon size={16} className="text-[#0a0a0a]" />
            <h3 className="text-xs sm:text-sm font-semibold text-[#0a0a0a] uppercase tracking-wider">
              Mahkamah Arbitrase Dual-Thinking (Cross-Arbiter Examination)
            </h3>
          </div>
          <p className="text-[11px] text-[#737373] font-sans">
            Evaluasi paralel independen tanpa kontaminasi silang antar model penalaran untuk mencegah bias halusinasi tunggal.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="px-2.5 py-0.5 rounded-[18px] text-[10px] font-bold uppercase tracking-wider flat-tag-white">
            STATUS: {consensusLevel.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      {/* Side-by-side Dual Chamber: Hakim 1 vs Hakim 2 */}
      {hasDual && judge1 && judge2 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Hakim 1 Chamber (Chief Quant Arbiter) */}
          <div className="p-4 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] flex flex-col justify-between space-y-3">
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-[#e5e5e5]">
                <div className="space-y-0.5">
                  <span className="text-[10px] text-[#0a0a0a] uppercase tracking-wider font-semibold flex items-center gap-1.5">
                    <CpuIcon size={13} className="text-[#0a0a0a]" />
                    {judge1.title || "Hakim 1 — Chief Quant Arbiter"}
                  </span>
                  <span className="text-[10px] text-[#737373] block truncate">
                    Model: {judge1.model}
                  </span>
                </div>
                <span className="px-2.5 py-0.5 rounded-[18px] text-[10px] font-semibold flat-tag-zinc">
                  Tier: {judge1.confidence_tier.replace(/_/g, " ")}
                </span>
              </div>

              {/* Verdict Summary */}
              <div className="space-y-1 text-xs">
                <span className="text-[10px] text-[#737373] uppercase tracking-wider font-semibold block">
                  Vonis Evaluasi Kuantitatif:
                </span>
                <p className="text-xs text-[#171717] leading-relaxed font-sans bg-white p-3 rounded-[12px] border border-[#e5e5e5] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                  {judge1.verdict_summary}
                </p>
              </div>

              {/* Key Reasoning */}
              {judge1.key_reasoning && (
                <div className="space-y-1 text-xs">
                  <span className="text-[10px] text-[#737373] uppercase tracking-wider font-semibold block">
                    Pertimbangan Matematis &amp; Edge Dislocation:
                  </span>
                  <p className="text-[11px] text-[#737373] leading-relaxed font-sans">
                    {judge1.key_reasoning}
                  </p>
                </div>
              )}
            </div>

            {/* Rekomendasi Pasar Hakim 1 */}
            <div className="pt-2 border-t border-[#e5e5e5]">
              <div className="p-2.5 rounded-[12px] bg-white border border-[#e5e5e5] flex items-center justify-between shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                <div>
                  <span className="text-[9px] text-[#737373] uppercase block">Pilihan Pasar Hakim 1:</span>
                  <span className="text-xs font-bold text-[#0a0a0a]">
                    {judge1.recommended_market}
                  </span>
                </div>
                <ArrowUpRightIcon size={14} className="text-[#0a0a0a]" />
              </div>
            </div>
          </div>

          {/* Hakim 2 Chamber (Independent Cross-Arbiter) */}
          <div className="p-4 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] flex flex-col justify-between space-y-3">
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-[#e5e5e5]">
                <div className="space-y-0.5">
                  <span className="text-[10px] text-[#0a0a0a] uppercase tracking-wider font-semibold flex items-center gap-1.5">
                    <ShieldIcon size={13} className="text-[#0a0a0a]" />
                    {judge2.title || "Hakim 2 — Independent Cross-Arbiter"}
                  </span>
                  <span className="text-[10px] text-[#737373] block truncate">
                    Model: {judge2.model}
                  </span>
                </div>
                <span className="px-2.5 py-0.5 rounded-[18px] text-[10px] font-semibold flat-tag-zinc">
                  Tier: {judge2.confidence_tier.replace(/_/g, " ")}
                </span>
              </div>

              {/* Verdict Summary */}
              <div className="space-y-1 text-xs">
                <span className="text-[10px] text-[#737373] uppercase tracking-wider font-semibold block">
                  Vonis Pengujian Silang &amp; Risiko:
                </span>
                <p className="text-xs text-[#171717] leading-relaxed font-sans bg-white p-3 rounded-[12px] border border-[#e5e5e5] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                  {judge2.verdict_summary}
                </p>
              </div>

              {/* Alternative Perspective / Cross Exam */}
              {(judge2.alternative_perspective || judge2.key_reasoning) && (
                <div className="space-y-1 text-xs">
                  <span className="text-[10px] text-[#737373] uppercase tracking-wider font-semibold block">
                    Perspektif Independen &amp; Uji Stres (Contrarian Audit):
                  </span>
                  <p className="text-[11px] text-[#737373] leading-relaxed font-sans">
                    {judge2.alternative_perspective || judge2.key_reasoning}
                  </p>
                </div>
              )}
            </div>

            {/* Rekomendasi Pasar Hakim 2 */}
            <div className="pt-2 border-t border-[#e5e5e5]">
              <div className="p-2.5 rounded-[12px] bg-white border border-[#e5e5e5] flex items-center justify-between shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                <div>
                  <span className="text-[9px] text-[#737373] uppercase block">Pilihan Pasar Hakim 2:</span>
                  <span className="text-xs font-bold text-[#0a0a0a]">
                    {judge2.recommended_market}
                  </span>
                </div>
                <ArrowUpRightIcon size={14} className="text-[#0a0a0a]" />
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Fallback Single Arbiter View if Dual Judgement data is absent */
        <div className="p-4 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] space-y-2 text-xs">
          <div className="flex items-center gap-2 text-[#0a0a0a] font-semibold">
            <AlertCircleIcon size={14} className="text-[#0a0a0a]" />
            <span>Sidang Dual-Thinking Terbatas (Menggunakan Mode Arbiter Tunggal)</span>
          </div>
          <p className="text-[#737373] text-[11px] font-sans">
            Data dual arbiter belum tergenerate secara lengkap. Menampilkan sintesis risiko terpadu dari sistem orchestrator.
          </p>
        </div>
      )}

      {/* Supreme Syndicate Consensus Box (Vonis Akhir Konsorsium) */}
      <div className="p-5 rounded-[18px] bg-white border border-[#e5e5e5] shadow-[0_1px_3px_rgba(0,0,0,0.05)] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#e5e5e5]">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <ZapIcon size={15} className="text-[#0a0a0a]" />
              <h4 className="text-xs font-semibold text-[#0a0a0a] uppercase tracking-wider">
                Vonis Tertinggi Konsorsium (Supreme Consortium Verdict)
              </h4>
            </div>
            <p className="text-[11px] text-[#737373] font-sans">
              {consensusDescription}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-[18px] text-[10px] font-bold flat-tag-white">
              TIER: {finalConfidence.replace(/_/g, " ")}
            </span>
          </div>
        </div>

        {/* Sintesis Tertulis Vonis */}
        <div className="space-y-1.5 text-xs">
          <span className="text-[10px] text-[#737373] uppercase tracking-wider font-semibold block">
            Ringkasan Eksekutif &amp; Sintesis Keputusan Akhir:
          </span>
          <div className="p-3.5 rounded-[12px] bg-[#fafafa] border border-[#e5e5e5] text-xs text-[#171717] leading-relaxed font-sans">
            {supremeVerdictText}
          </div>
        </div>

        {/* 3 Metrics Sizing Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-[#e5e5e5] text-xs tabular-nums">
          <div className="p-3 rounded-[12px] bg-[#fafafa] border border-[#e5e5e5]">
            <span className="text-[10px] text-[#737373] uppercase tracking-wider block">
              Pasar Rekomendasi Final
            </span>
            <strong className="block mt-1 text-xs sm:text-sm text-[#0a0a0a] truncate">
              {finalMarket}
            </strong>
            <span className="text-[9px] text-[#737373] block mt-0.5">
              Konsensus Mahkamah Arbitrase
            </span>
          </div>

          <div className="p-3 rounded-[12px] bg-[#fafafa] border border-[#e5e5e5]">
            <span className="text-[10px] text-[#737373] uppercase tracking-wider block">
              Alokasi Kelly Stake Sizing
            </span>
            <strong className="block mt-1 text-xs sm:text-sm text-[#0a0a0a]">
              {finalStake}
            </strong>
            <span className="text-[9px] text-[#737373] block mt-0.5">
              Maksimal Hard-Cap 5.0% Bankroll
            </span>
          </div>

          <div className="p-3 rounded-[12px] bg-[#fafafa] border border-[#e5e5e5]">
            <span className="text-[10px] text-[#737373] uppercase tracking-wider block">
              Derajat Kesepakatan
            </span>
            <strong className="block mt-1 text-xs sm:text-sm text-[#0a0a0a]">
              {consensusLevel === "UNANIMOUS"
                ? "100% Sepakat (Unanimous)"
                : consensusLevel === "CONCURRING"
                ? "80% Searah (Concurring)"
                : consensusLevel === "SPLIT_DECISION"
                ? "50/50 Terbelah (Split)"
                : "0% Dissent (No Bet)"}
            </strong>
            <span className="text-[9px] text-[#737373] block mt-0.5">
              Filtered via Dixon-Coles Tau
            </span>
          </div>
        </div>
      </div>

      {/* Panel Konsensus Bawaan atau Alasan Laga */}
      {prediction?.konsensus_panel && (
        <div className="p-3.5 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] flex items-start gap-2.5 text-xs">
          <CheckCircleIcon size={14} className="text-[#0a0a0a] shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="text-[10px] font-semibold text-[#0a0a0a] uppercase tracking-wider block">
              Catatan Panel Konsensus:
            </span>
            <p className="text-[11px] text-[#737373] font-sans leading-relaxed">
              {prediction.konsensus_panel}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
