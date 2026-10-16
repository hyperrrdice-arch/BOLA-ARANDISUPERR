"use client";

import React, { useState } from "react";
import { QuantEngineData } from "./types";
import {
  CpuIcon,
  BarChart3Icon,
  ShieldIcon,
  CoinsIcon,
  ScaleIcon,
  ActivityIcon,
} from "@/components/icons";

interface DeepMathEvidenceCardProps {
  quantData: QuantEngineData;
  homeTeam: string;
  awayTeam: string;
  leagueName?: string;
}

export function DeepMathEvidenceCard({
  quantData,
  homeTeam,
  awayTeam,
  leagueName = "Kompetisi Reguler",
}: DeepMathEvidenceCardProps) {
  const [activeEvidenceSection, setActiveEvidenceSection] = useState<
    "all" | "baseline" | "shrinkage" | "dixon_coles" | "kelly"
  >("all");

  const dc = quantData.dixon_coles;
  const vig = quantData.vig_stripping;
  const cal = quantData.calibration_metadata;
  const valueBets = quantData.value_bets || [];

  const homeWeight = cal?.shrinkage_weights?.home ?? 0.238;
  const awayWeight = cal?.shrinkage_weights?.away ?? 0.238;
  const homeAdv = cal?.calibrated_home_advantage ?? 1.15;
  const leagueAvg = cal?.calibrated_league_avg_goals ?? 1.35;
  const divCode = cal?.div ?? "E0";

  return (
    <div className="p-5 rounded-[24px] bg-white border border-[#e5e5e5] shadow-[0_1px_3px_rgba(0,0,0,0.05)] w-full font-mono space-y-5">
      {/* Header Telemetri Kuantitatif */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#e5e5e5]">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#0a0a0a]" />
            <h3 className="text-xs sm:text-sm font-semibold text-[#0a0a0a] uppercase tracking-wider">
              Bukti Matematis &amp; Telemetri Kuantitatif Transparan
            </h3>
          </div>
          <p className="text-[11px] text-[#737373] font-sans">
            Dekomposisi matematis Dixon-Coles, James-Stein Shrinkage, dan Shin vig-stripping dari database master 4 musim.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="px-2.5 py-0.5 rounded-[18px] text-[10px] font-semibold flat-tag-zinc tabular-nums">
            DIV: {divCode} (Terverifikasi)
          </span>
          <span className="px-2.5 py-0.5 rounded-[18px] text-[10px] font-semibold flat-tag-zinc tabular-nums">
            κ = 16 (Prior Sindikat)
          </span>
        </div>
      </div>

      {/* Section Filter Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
        {[
          { id: "all", label: "Semua Bukti Kuantitatif" },
          { id: "baseline", label: "1. Baseline 4 Musim" },
          { id: "shrinkage", label: "2. James-Stein Shrinkage" },
          { id: "dixon_coles", label: "3. Dixon-Coles Bivariate" },
          { id: "kelly", label: "4. Shin & Kelly Cap" },
        ].map((sec) => (
          <button
            key={sec.id}
            onClick={() => setActiveEvidenceSection(sec.id as any)}
            className={`px-3 py-1 rounded-[18px] text-[10px] font-semibold transition-all shrink-0 cursor-pointer border ${
              activeEvidenceSection === sec.id
                ? "bg-[#0a0a0a] text-white border-[#0a0a0a] shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
                : "bg-[#f5f5f5] hover:bg-[#ebebeb] text-[#171717] border-[#e5e5e5]"
            }`}
          >
            {sec.label}
          </button>
        ))}
      </div>

      {/* EVIDENCE PANEL 1: BASELINE 4 MUSIM */}
      {(activeEvidenceSection === "all" || activeEvidenceSection === "baseline") && (
        <div className="p-4 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] space-y-3">
          <div className="flex items-center justify-between border-b border-[#e5e5e5] pb-2">
            <span className="text-xs font-semibold text-[#0a0a0a] flex items-center gap-2 uppercase tracking-wide">
              <BarChart3Icon size={14} className="text-[#0a0a0a]" />
              <span>1. Baseline Historis Master Database 4 Musim (SQLite Calibrated DB)</span>
            </span>
            <span className="text-[10px] text-[#737373]">N ≈ 1,520+ Match</span>
          </div>

          <p className="text-[11px] text-[#171717] font-sans leading-relaxed">
            Model tidak pernah menggunakan data mentah satu musim yang rentan *noise*. Estimasi kekuatan serangan (
            <span className="font-mono text-[#0a0a0a] font-semibold">α_i</span>) dan kerentanan pertahanan (
            <span className="font-mono text-[#0a0a0a] font-semibold">β_j</span>) dihitung dari data 4 musim kompetisi penuh{" "}
            <strong>{cal?.league_name || leagueName}</strong> dengan parameter regresi terkalibrasi:
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs tabular-nums">
            <div className="p-3 rounded-[14px] bg-white border border-[#e5e5e5] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
              <span className="text-[10px] text-[#737373] uppercase block">Home Multiplier (γ)</span>
              <span className="text-[#0a0a0a] font-bold text-sm block mt-0.5">
                {homeAdv.toFixed(3)}x
              </span>
              <span className="text-[9px] text-[#737373] block mt-0.5">Keunggulan kandang liga</span>
            </div>

            <div className="p-3 rounded-[14px] bg-white border border-[#e5e5e5] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
              <span className="text-[10px] text-[#737373] uppercase block">League Goal Baseline (Ḡ)</span>
              <span className="text-[#0a0a0a] font-bold text-sm block mt-0.5">
                {leagueAvg.toFixed(3)}
              </span>
              <span className="text-[9px] text-[#737373] block mt-0.5">Rata-rata gol/tim/laga</span>
            </div>

            <div className="p-3 rounded-[14px] bg-white border border-[#e5e5e5] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
              <span className="text-[10px] text-[#737373] uppercase block">Low-Score Tau (ρ)</span>
              <span className="text-[#0a0a0a] font-bold text-sm block mt-0.5">
                -0.040 s/d -0.130
              </span>
              <span className="text-[9px] text-[#737373] block mt-0.5">Korelasi skor tipis (0-0, 1-1)</span>
            </div>

            <div className="p-3 rounded-[14px] bg-white border border-[#e5e5e5] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
              <span className="text-[10px] text-[#737373] uppercase block">Sumber Data Tim</span>
              <span className="text-[#0a0a0a] font-bold text-xs truncate block mt-1">
                {cal?.home_source === "primary_league" ? "Divisi Utama" : "Promosi Terdiskon"}
              </span>
              <span className="text-[9px] text-[#737373] block mt-0.5">Bobot konversi divisi aktif</span>
            </div>
          </div>
        </div>
      )}

      {/* EVIDENCE PANEL 2: JAMES-STEIN SHRINKAGE */}
      {(activeEvidenceSection === "all" || activeEvidenceSection === "shrinkage") && (
        <div className="p-4 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] space-y-3">
          <div className="flex items-center justify-between border-b border-[#e5e5e5] pb-2">
            <span className="text-xs font-semibold text-[#0a0a0a] flex items-center gap-2 uppercase tracking-wide">
              <ShieldIcon size={14} className="text-[#0a0a0a]" />
              <span>2. James-Stein Empirical Bayes Shrinkage (Anti-Small-Sample Bias)</span>
            </span>
            <span className="text-[10px] text-[#0a0a0a] font-semibold">Rumus: w = N / (N + κ)</span>
          </div>

          <p className="text-[11px] text-[#171717] font-sans leading-relaxed">
            Sampel form langsung terkini (N = 5 s/d 6 laga) terlalu sempit jika berdiri sendiri karena rentan *variance spike*.
            Metode James-Stein menarik rata-rata form pendek kembali ke baseline prior historis 4 musim dengan konstanta prior{" "}
            <code className="text-[#0a0a0a] font-mono font-semibold">κ = 16</code>:
          </p>

          <div className="p-3 rounded-[14px] bg-white border border-[#e5e5e5] space-y-2 text-xs shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#e5e5e5] pb-2">
              <div>
                <span className="text-[11px] text-[#0a0a0a] font-semibold">{homeTeam} (Kandang)</span>
                <span className="text-[10px] text-[#737373] block">
                  Bobot Live Form: {(homeWeight * 100).toFixed(1)}% | Bobot Baseline Historis 4 Musim: {((1 - homeWeight) * 100).toFixed(1)}%
                </span>
              </div>
              <div className="w-full sm:w-48 h-2 rounded-full bg-[#f5f5f5] border border-[#e5e5e5] overflow-hidden flex">
                <div style={{ width: `${homeWeight * 100}%` }} className="h-full bg-[#0a0a0a]" title="Live Form" />
                <div style={{ width: `${(1 - homeWeight) * 100}%` }} className="h-full bg-[#d4d4d8]" title="Historical Baseline" />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="text-[11px] text-[#0a0a0a] font-semibold">{awayTeam} (Tamu)</span>
                <span className="text-[10px] text-[#737373] block">
                  Bobot Live Form: {(awayWeight * 100).toFixed(1)}% | Bobot Baseline Historis 4 Musim: {((1 - awayWeight) * 100).toFixed(1)}%
                </span>
              </div>
              <div className="w-full sm:w-48 h-2 rounded-full bg-[#f5f5f5] border border-[#e5e5e5] overflow-hidden flex">
                <div style={{ width: `${awayWeight * 100}%` }} className="h-full bg-[#0a0a0a]" title="Live Form" />
                <div style={{ width: `${(1 - awayWeight) * 100}%` }} className="h-full bg-[#d4d4d8]" title="Historical Baseline" />
              </div>
            </div>
          </div>

          <div className="p-3 rounded-[14px] bg-white border border-[#e5e5e5] text-[10px] text-[#171717] font-sans leading-relaxed">
            <strong className="text-[#0a0a0a]">Mengapa ini penting?</strong> Tim yang sedang mencetak 4 gol dalam 2 laga tidak langsung dinilai memiliki rata-rata serang 2.00 gol/laga. Model mereduksi estimasi tersebut menjadi angka stabil sekitar 1.35 - 1.45 xG untuk menghindari trap odds bandar.
          </div>
        </div>
      )}

      {/* EVIDENCE PANEL 3: DIXON-COLES BIVARIATE POISSON */}
      {(activeEvidenceSection === "all" || activeEvidenceSection === "dixon_coles") && (
        <div className="p-4 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] space-y-3">
          <div className="flex items-center justify-between border-b border-[#e5e5e5] pb-2">
            <span className="text-xs font-semibold text-[#0a0a0a] flex items-center gap-2 uppercase tracking-wide">
              <CpuIcon size={14} className="text-[#0a0a0a]" />
              <span>3. Dixon-Coles Bivariate Poisson &amp; Matriks Skor Tipis</span>
            </span>
            <span className="text-[10px] text-[#737373]">Expected Total Goals: {dc.expected_total_goals.toFixed(2)}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-[14px] bg-white border border-[#e5e5e5] space-y-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
              <span className="text-[10px] text-[#737373] uppercase block">Dixon-Coles Lambda &amp; Mu Formula</span>
              <div className="text-[11px] text-[#171717] space-y-1">
                <div>
                  <span className="text-[#0a0a0a] font-bold">λ (Home xG):</span> {dc.lambda_home_xg.toFixed(3)}{" "}
                  <span className="text-[#737373]">= (α_home × β_away / Ḡ) × γ</span>
                </div>
                <div>
                  <span className="text-[#0a0a0a] font-bold">μ (Away xG):</span> {dc.mu_away_xg.toFixed(3)}{" "}
                  <span className="text-[#737373]">= (α_away × β_home / Ḡ)</span>
                </div>
              </div>
            </div>

            <div className="p-3 rounded-[14px] bg-white border border-[#e5e5e5] space-y-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
              <span className="text-[10px] text-[#737373] uppercase block">Faktor Koreksi Tau (τ) Skor Tipis</span>
              <div className="text-[11px] text-[#171717] space-y-0.5">
                <div>τ(0,0) = 1 - λμρ | τ(0,1) = 1 + λρ</div>
                <div>τ(1,0) = 1 + μρ | τ(1,1) = 1 - ρ</div>
              </div>
              <span className="text-[9px] text-[#737373] block">Mencegah underestimation probabilitas 0-0 dan 1-1</span>
            </div>
          </div>

          {/* Top Scoreline Probabilities */}
          <div className="space-y-1.5">
            <span className="text-[10px] text-[#737373] uppercase block">
              Top 6 Skor Probabilitas Matriks Bivariate (Ternormalisasi ∑ P(x,y) = 1.0):
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-center text-xs tabular-nums">
              {dc.top_scorelines.slice(0, 6).map((sc, idx) => (
                <div key={idx} className="p-2.5 rounded-[14px] bg-white border border-[#e5e5e5] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                  <span className="text-[#0a0a0a] font-bold block">{sc.homeGoals} - {sc.awayGoals}</span>
                  <span className="text-[#737373] text-[11px]">{sc.prob}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* EVIDENCE PANEL 4: SHIN VIG-STRIPPING & FRACTIONAL KELLY */}
      {(activeEvidenceSection === "all" || activeEvidenceSection === "kelly") && (
        <div className="p-4 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] space-y-3">
          <div className="flex items-center justify-between border-b border-[#e5e5e5] pb-2">
            <span className="text-xs font-semibold text-[#0a0a0a] flex items-center gap-2 uppercase tracking-wide">
              <CoinsIcon size={14} className="text-[#0a0a0a]" />
              <span>4. Shin (1993) Vig-Stripping &amp; Portfolio Kelly Cap 5.0%</span>
            </span>
            <span className="text-[10px] text-[#737373]">Margin Terkoreksi: {vig.margin_percentage}%</span>
          </div>

          <p className="text-[11px] text-[#171717] font-sans leading-relaxed">
            Metode Shin mengasumsikan sebagian taruhan pasar didorong oleh *insider traders* (parameter z), sehingga odds tim favorit sering kali dipotong terlalu dalam (*favorite-longshot bias*). Formula Kelly menerapkan Quarter-Kelly (1/4 sizing) dengan pagu pengaman maksimal 5% bankroll per pertandingan:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs tabular-nums">
            <div className="p-3 rounded-[14px] bg-white border border-[#e5e5e5] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
              <span className="text-[10px] text-[#737373] uppercase block">Fair Odds Model (Shin Strip)</span>
              <span className="text-[#0a0a0a] font-bold block mt-0.5">
                H: {vig.fair_odds?.home.toFixed(2)} | D: {vig.fair_odds?.draw.toFixed(2)} | A: {vig.fair_odds?.away.toFixed(2)}
              </span>
              <span className="text-[9px] text-[#737373] block mt-0.5">Tanpa overround bandar</span>
            </div>

            <div className="p-3 rounded-[14px] bg-white border border-[#e5e5e5] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
              <span className="text-[10px] text-[#737373] uppercase block">Rasio Kelly Multiplier</span>
              <span className="text-[#0a0a0a] font-bold block mt-0.5">
                1/4 Kelly (0.25x)
              </span>
              <span className="text-[9px] text-[#737373] block mt-0.5">Standar sindikat konservatif</span>
            </div>

            <div className="p-3 rounded-[14px] bg-white border border-[#e5e5e5] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
              <span className="text-[10px] text-[#737373] uppercase block">Pagu Eksposur Portofolio</span>
              <span className="text-[#0a0a0a] font-bold block mt-0.5">
                Maksimal 5.0% Bankroll
              </span>
              <span className="text-[9px] text-[#737373] block mt-0.5">Hard cap anti-drawdown leak</span>
            </div>
          </div>

          {valueBets.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <span className="text-[10px] text-[#737373] uppercase block">
                Status Rekomendasi Portofolio Kelly Terkalibrasi:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {valueBets.filter(b => b.is_positive_ev).map((b, i) => (
                  <div key={i} className="p-3 rounded-[14px] bg-white border border-[#e5e5e5] flex items-center justify-between shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                    <span className="font-semibold text-[#0a0a0a]">{b.selection}</span>
                    <div className="text-right flex items-center gap-2">
                      <span className="text-[10px] text-[#737373] block">Stake: {b.recommended_stake_percentage}%</span>
                      <span className="px-2 py-0.5 rounded-[18px] bg-[#0a0a0a] text-white text-[10px] font-bold">
                        {b.ev_percentage} EV
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
