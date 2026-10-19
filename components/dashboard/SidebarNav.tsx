"use client";

import React, { useRef } from "react";
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
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusTab = (i: number) => tabRefs.current[i]?.focus();
  const onTabKeyDown = (e: React.KeyboardEvent, id: AnalysisTabKey) => {
    const i = TABS.findIndex((t) => t.id === id);
    let j: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") j = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = TABS.length - 1;
    if (j !== null) {
      e.preventDefault();
      onSelectTab(TABS[j].id);
      focusTab(j);
    }
  };
  return (
    <aside className="w-full lg:w-[270px] shrink-0 space-y-3 font-sans">
      {/* Sidebar Header Badge */}
      <div className="p-3.5 rounded-[18px] bg-[#14141f] border border-[#262636] space-y-1">
        <div className="flex items-center justify-between text-[11px] text-[#a2a2b5]">
          <span className="font-semibold">Navigasi Analisis</span>
          <span className="px-2 py-0.5 rounded-[18px] bg-[#1b1b29] border border-[#262636] text-[#e8e8ef] font-medium">
            4 Ruang Bedah
          </span>
        </div>
        {homeTeam && awayTeam && (
          <p className="text-xs text-[#f4f4f6] font-semibold truncate pt-0.5">
            {homeTeam} <span className="text-[#8e8ea3] font-normal">vs</span> {awayTeam}
          </p>
        )}
      </div>

      {/* Vertical Navigation Buttons */}
      <nav role="tablist" aria-label="Ruang bedah analisis" className="flex flex-row lg:flex-col gap-2 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0 scrollbar-thin">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;

          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[TABS.findIndex((t) => t.id === tab.id)] = el;
              }}
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onSelectTab(tab.id)}
              onKeyDown={(e) => onTabKeyDown(e, tab.id)}
              className={`p-3 rounded-[18px] text-left transition-colors cursor-pointer relative shrink-0 min-w-[200px] lg:min-w-0 border ${
                isActive
                  ? "bg-[#b8b0ff] text-[#17131f] border-[#b8b0ff]"
                  : "bg-[#14141f] text-[#e8e8ef] border-[#262636] hover:border-[#34344a] hover:bg-[#1b1b29]"
              }`}
            >
              <div className="flex items-start gap-2.5">
                <div className="space-y-0.5 flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Icon
                      size={13}
                      className={isActive ? "text-[#17131f]" : "text-[#f4f4f6]"}
                    />
                    <h4
                      className={`text-xs font-bold tracking-tight truncate ${
                        isActive ? "text-[#17131f]" : "text-[#f4f4f6]"
                      }`}
                    >
                      {tab.label}
                    </h4>
                  </div>
                  <p
                    className={`text-[11px] leading-tight truncate ${
                      isActive ? "text-[#34344a]" : "text-[#a2a2b5]"
                    }`}
                  >
                    {tab.desc}
                  </p>
                </div>
              </div>

              {/* Special Context Badges */}
              {tab.id === "kuantitatif" && hasValueBets && (
                <div className="mt-2.5 flex items-center justify-between text-[11px]">
                  <span className={isActive ? "text-[#34d399]" : "text-[#34d399]"}>
                    ● +EV Terdeteksi
                  </span>
                  <span className={isActive ? "text-[#8e8ea3]" : "text-[#a2a2b5]"}>
                    Kelly Active
                  </span>
                </div>
              )}

              {tab.id === "odds" && total1xBetLines && total1xBetLines > 0 && (
                <div className="mt-2.5 flex items-center justify-between text-[11px]">
                  <span className={isActive ? "text-[#7dd3fc]" : "text-[#7dd3fc]"}>
                    ● {total1xBetLines} Pasar
                  </span>
                  <span className={isActive ? "text-[#8e8ea3]" : "text-[#a2a2b5]"}>
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
