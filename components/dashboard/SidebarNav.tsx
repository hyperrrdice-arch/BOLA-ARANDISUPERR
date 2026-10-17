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
  label: string;
  desc: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  {
    id: "ringkasan",
    label: "Ringkasan & Vonis",
    desc: "Vonis Utama, Alasan & Jejak Planner",
    icon: CheckCircleIcon,
  },
  {
    id: "kuantitatif",
    label: "Model Kuantitatif",
    desc: "Dixon-Coles, Probabilitas & Kelly",
    icon: CpuIcon,
  },
  {
    id: "odds",
    label: "Bursa & Dislokasi",
    desc: "Dislokasi 1X2, Smart Money & 1xBet",
    icon: CoinsIcon,
  },
  {
    id: "debat",
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
      <div className="p-3.5 rounded-[18px] bg-white border border-[#e5e5e5] space-y-1">
        <div className="flex items-center justify-between text-[11px] text-[#737373]">
          <span className="font-semibold">Navigasi Analisis</span>
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
                  ? "bg-[#0a0a0a] text-white border-[#0a0a0a]"
                  : "bg-white text-[#171717] border-[#e5e5e5] hover:border-[#d4d4d8] hover:bg-[#fafafa]"
              }`}
            >
              <div className="flex items-start gap-2.5">
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
                    className={`text-[11px] leading-tight truncate ${
                      isActive ? "text-[#d4d4d8]" : "text-[#737373]"
                    }`}
                  >
                    {tab.desc}
                  </p>
                </div>
              </div>

              {/* Special Context Badges */}
              {tab.id === "kuantitatif" && hasValueBets && (
                <div className="mt-2.5 flex items-center justify-between text-[11px]">
                  <span className={isActive ? "text-[#10b981]" : "text-[#059669]"}>
                    ● +EV Terdeteksi
                  </span>
                  <span className={isActive ? "text-[#a1a1aa]" : "text-[#737373]"}>
                    Kelly Active
                  </span>
                </div>
              )}

              {tab.id === "odds" && total1xBetLines && total1xBetLines > 0 && (
                <div className="mt-2.5 flex items-center justify-between text-[11px]">
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
