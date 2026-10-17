"use client";

import React from "react";
import {
  CpuIcon,
  ScaleIcon,
  CoinsIcon,
  CheckCircleIcon,
} from "@/components/icons";

export type AnalysisTabKey =
  | "ringkasan"
  | "kuantitatif"
  | "odds"
  | "debat";

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
    id: "ringkasan",
    step: "01",
    label: "Ringkasan & Vonis",
    desc: "Vonis Utama, Alasan & Jejak Planner",
    icon: CheckCircleIcon,
  },
  {
    id: "kuantitatif",
    step: "02",
    label: "Model Kuantitatif",
    desc: "Dixon-Coles, Probabilitas & Kelly",
    icon: CpuIcon,
  },
  {
    id: "odds",
    step: "03",
    label: "Bursa & Dislokasi",
    desc: "Dislokasi 1X2, Smart Money & 1xBet",
    icon: CoinsIcon,
  },
  {
    id: "debat",
    step: "04",
    label: "Sidang Sindikat",
    desc: "Supreme Verdict, Dual Bench & 4 Persona",
    icon: ScaleIcon,
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
            4 Ruang Bedah
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
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;

          return (
            <button
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`p-3 rounded-[18px] text-left transition-all cursor-pointer relative shrink-0 min-w-[200px] lg:min-w-0 border ${
                isActive
                  ? "bg-[#0a0a0a] text-white border-[#0a0a0a] shadow-[0_2px_4px_rgba(0,0,0,0.1)]"
                  : "bg-white text-[#171717] border-[#e5e5e5] hover:border-[#d4d4d8] hover:bg-[#fafafa]"
              }`}
            >
              <div className="flex items-start gap-2.5">
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-[10px] tabular-nums shrink-0 mt-0.5 ${
                    isActive
                      ? "bg-white text-[#0a0a0a]"
                      : "bg-[#f5f5f5] text-[#737373] border border-[#e5e5e5]"
                  }`}
                >
                  {tab.step}
                </span>

                <div className="space-y-0.5 flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Icon
                      size={13}
                      className={isActive ? "text-white" : "text-[#0a0a0a]"}
                    />
                    <h4
                      className={`text-xs font-bold tracking-tight truncate ${
                        isActive ? "text-white" : "text-[#0a0a0a]"
                      }`}
                    >
                      {tab.label}
                    </h4>
                  </div>
                  <p
                    className={`text-[10px] leading-tight truncate ${
                      isActive ? "text-[#d4d4d8]" : "text-[#737373]"
                    }`}
                  >
                    {tab.desc}
                  </p>
                </div>
              </div>

              {/* Special Context Badges */}
              {tab.id === "kuantitatif" && hasValueBets && (
                <div className="mt-2 pt-1.5 border-t border-white/10 flex items-center justify-between text-[9px]">
                  <span className={isActive ? "text-[#10b981]" : "text-[#059669]"}>
                    ● +EV Terdeteksi
                  </span>
                  <span className={isActive ? "text-[#a1a1aa]" : "text-[#737373]"}>
                    Kelly Active
                  </span>
                </div>
              )}

              {tab.id === "odds" && total1xBetLines && total1xBetLines > 0 && (
                <div className="mt-2 pt-1.5 border-t border-white/10 flex items-center justify-between text-[9px]">
                  <span className={isActive ? "text-[#38bdf8]" : "text-[#0284c7]"}>
                    ● {total1xBetLines} Pasar Live
                  </span>
                  <span className={isActive ? "text-[#a1a1aa]" : "text-[#737373]"}>
                    1xBet
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
