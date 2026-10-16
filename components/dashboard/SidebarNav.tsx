"use client";

import React from "react";
import {
  CpuIcon,
  ScaleIcon,
  CoinsIcon,
  TrendingUpIcon,
  CheckCircleIcon,
  ActivityIcon,
} from "@/components/icons";

export type AnalysisTabKey =
  | "math"
  | "llm"
  | "thestatsapi-odds"
  | "1xbet-markets"
  | "conclusion";

interface SidebarNavProps {
  activeTab: AnalysisTabKey;
  onSelectTab: (tab: AnalysisTabKey) => void;
  homeTeam?: string;
  awayTeam?: string;
  hasValueBets?: boolean;
  total1xBetLines?: number | null;
}

const TABS: Array<{
  id: AnalysisTabKey;
  step: string;
  label: string;
  desc: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  {
    id: "math",
    step: "01",
    label: "Kalkulasi Matematis",
    desc: "Dixon-Coles, xG, Fair Odds & Kelly",
    icon: CpuIcon,
  },
  {
    id: "llm",
    step: "02",
    label: "Sidang Analis AI",
    desc: "Debat Bull vs Bear & Panel Mahkamah",
    icon: ScaleIcon,
  },
  {
    id: "thestatsapi-odds",
    step: "03",
    label: "Odds Booker TheStatsAPI",
    desc: "Bursa resmi & vig margin overround",
    icon: CoinsIcon,
  },
  {
    id: "1xbet-markets",
    step: "04",
    label: "Katalog 500+ Market 1xBet",
    desc: "Scanner live bookie & dual-model AI",
    icon: TrendingUpIcon,
  },
  {
    id: "conclusion",
    step: "05",
    label: "Vonis Akhir Dual Thinking",
    desc: "Pilihan paling masuk akal & eksekusi",
    icon: CheckCircleIcon,
  },
];

export function SidebarNav({
  activeTab,
  onSelectTab,
  homeTeam,
  awayTeam,
  hasValueBets,
  total1xBetLines,
}: SidebarNavProps) {
  return (
    <aside className="w-full lg:w-[270px] shrink-0 space-y-3 font-mono">
      {/* Sidebar Header Badge */}
      <div className="p-3.5 rounded-[18px] bg-white border border-[#e5e5e5] shadow-[0_1px_3px_rgba(0,0,0,0.05)] space-y-1">
        <div className="flex items-center justify-between text-[10px] text-[#737373]">
          <span className="uppercase tracking-wider font-semibold">Navigasi Analisis</span>
          <span className="px-2 py-0.5 rounded-[18px] bg-[#f5f5f5] border border-[#e5e5e5] text-[#171717] font-medium">
            5 Ruang Bedah
          </span>
        </div>
        {homeTeam && awayTeam && (
          <p className="text-xs text-[#0a0a0a] font-semibold truncate pt-0.5">
            {homeTeam} <span className="text-[#a1a1aa] font-normal">vs</span> {awayTeam}
          </p>
        )}
      </div>

      {/* Vertical Navigation Buttons */}
      <nav className="flex flex-row lg:flex-col gap-2 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0 scrollbar-thin">
        {TABS.map((tab) => {
          const IconComponent = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`w-full text-left p-3 rounded-[18px] border transition-all cursor-pointer flex items-start gap-3 shrink-0 sm:shrink lg:shrink-0 ${
                isActive
                  ? "bg-[#0a0a0a] text-white border-[#0a0a0a] shadow-[0_2px_4px_rgba(0,0,0,0.1)] font-medium"
                  : "bg-white hover:bg-[#fafafa] text-[#737373] hover:text-[#0a0a0a] border-[#e5e5e5] shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
              }`}
            >
              <div
                className={`p-1.5 rounded-[10px] border shrink-0 mt-0.5 ${
                  isActive
                    ? "bg-white/10 text-white border-white/20"
                    : "bg-[#f5f5f5] text-[#0a0a0a] border-[#e5e5e5]"
                }`}
              >
                <IconComponent size={14} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={`text-xs font-semibold truncate block tracking-tight ${
                      isActive ? "text-white" : "text-[#0a0a0a]"
                    }`}
                  >
                    {tab.label}
                  </span>
                  <span
                    className={`text-[9px] font-mono px-1.5 py-0.2 rounded-[10px] border ${
                      isActive
                        ? "bg-white/10 text-white border-white/20"
                        : "text-[#a1a1aa] border-transparent"
                    }`}
                  >
                    {tab.step}
                  </span>
                </div>
                <p
                  className={`text-[10px] truncate mt-0.5 font-sans leading-normal ${
                    isActive ? "text-zinc-300" : "text-[#737373]"
                  }`}
                >
                  {tab.desc}
                </p>

                {/* Sub-Badges */}
                {tab.id === "math" && hasValueBets && (
                  <span
                    className={`mt-1.5 inline-block text-[9px] px-2 py-0.5 rounded-[18px] font-mono font-semibold ${
                      isActive
                        ? "bg-white text-[#0a0a0a]"
                        : "bg-[#0a0a0a] text-white"
                    }`}
                  >
                    +EV Edge Terdeteksi
                  </span>
                )}
                {tab.id === "1xbet-markets" && total1xBetLines && total1xBetLines > 0 && (
                  <span
                    className={`mt-1.5 inline-block text-[9px] px-2 py-0.5 rounded-[18px] font-mono ${
                      isActive
                        ? "bg-white/20 text-white border border-white/20"
                        : "bg-[#f5f5f5] text-[#171717] border border-[#e5e5e5]"
                    }`}
                  >
                    {total1xBetLines} Baris Siap
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </nav>

      {/* Mini Tip Box */}
      <div className="hidden lg:block p-3.5 rounded-[18px] bg-white border border-[#e5e5e5] text-[11px] text-[#737373] space-y-1 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
        <div className="flex items-center gap-1.5 text-[#0a0a0a] font-semibold text-[10px] uppercase">
          <ActivityIcon size={12} className="text-[#0a0a0a]" />
          <span>Tips Santai</span>
        </div>
        <p className="text-[10px] text-[#737373] leading-relaxed font-sans">
          Buka tiap tab buat lihat kalkulasi matematis, debat AI, sampai vonis akhir secara terpisah tanpa pusing tumpukan data.
        </p>
      </div>
    </aside>
  );
}
