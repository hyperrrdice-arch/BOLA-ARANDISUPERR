"use client";

import React from "react";
import { PitchIcon } from "@/components/icons";
import { PlayerItem } from "./types";

interface TacticalPitchCardProps {
  homeName: string;
  awayName: string;
  homeFormation: string | null;
  awayFormation: string | null;
  homePlayers: PlayerItem[];
  awayPlayers: PlayerItem[];
  tacticalReview: string;
  statusLineup: string;
}

export function TacticalPitchCard({
  homeName,
  awayName,
  homeFormation,
  awayFormation,
  homePlayers,
  awayPlayers,
  tacticalReview,
  statusLineup,
}: TacticalPitchCardProps) {
  const groupPos = (list: PlayerItem[]) => {
    const gk = list.filter((p) => p.pos === "G");
    const def = list.filter((p) => p.pos === "D");
    const mid = list.filter((p) => p.pos === "M");
    const fwd = list.filter((p) => p.pos === "F");
    return { gk, def, mid, fwd };
  };

  const homeG = groupPos(homePlayers);
  const awayG = groupPos(awayPlayers);

  return (
    <div className="space-y-4">
      {/* Blueprint Container */}
      <div className="flat-card-static p-4 sm:p-5 space-y-4">
        {/* Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#2d3748]">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#16a34a]" />
            <span className="text-sm font-bold text-[#f0f6fc]">{homeName}</span>
            <span className="px-2 py-0.5 rounded text-[11px] font-mono flat-tag-green">
              {homeFormation || "4-3-3"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#0d1117] border border-[#2d3748] text-xs font-mono text-[#8b949e]">
              <PitchIcon size={13} className="text-[#8b949e]" />
              <span>Tactical Blueprint 2D</span>
            </div>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
                statusLineup === "resmi" ? "flat-tag-green" : "flat-tag-amber"
              }`}
            >
              {statusLineup}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[11px] font-mono flat-tag-blue">
              {awayFormation || "4-3-3"}
            </span>
            <span className="text-sm font-bold text-[#f0f6fc]">{awayName}</span>
            <span className="w-2.5 h-2.5 rounded-full bg-[#0284c7]" />
          </div>
        </div>

        {/* Pitch Canvas */}
        <div className="relative w-full aspect-[16/9] min-h-[300px] md:min-h-[380px] rounded-lg pitch-turf overflow-hidden">
          {/* Flat Crisp Pitch Lines */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none stroke-[rgba(255,255,255,0.28)] fill-none"
            strokeWidth="1.2"
          >
            {/* Outer Pitch Border */}
            <rect x="3%" y="5%" width="94%" height="90%" rx="2" />
            {/* Halfway Line */}
            <line x1="50%" y1="5%" x2="50%" y2="95%" />
            {/* Center Circle & Spot */}
            <circle cx="50%" cy="50%" r="13%" />
            <circle cx="50%" cy="50%" r="2.5" fill="rgba(255,255,255,0.6)" />
            {/* Left Penalty Area (Home) */}
            <rect x="3%" y="24%" width="14%" height="52%" />
            <rect x="3%" y="36%" width="5%" height="28%" />
            <path d="M 17% 43% A 7 7 0 0 1 17% 57%" />
            {/* Right Penalty Area (Away) */}
            <rect x="83%" y="24%" width="14%" height="52%" />
            <rect x="92%" y="36%" width="5%" height="28%" />
            <path d="M 83% 43% A 7 7 0 0 0 83% 57%" />
          </svg>

          {/* Player Pins Layer */}
          <div className="relative z-10 w-full h-full flex">
            {/* HOME TEAM (Left half) */}
            <div className="w-1/2 h-full flex justify-between items-center py-4 px-3 sm:px-6">
              <div className="flex flex-col items-center justify-around h-full">
                {homeG.gk.map((p, i) => (
                  <FlatPlayerPin key={`hgk-${i}`} player={p} isHome={true} />
                ))}
              </div>
              <div className="flex flex-col items-center justify-around h-full">
                {homeG.def.map((p, i) => (
                  <FlatPlayerPin key={`hdef-${i}`} player={p} isHome={true} />
                ))}
              </div>
              <div className="flex flex-col items-center justify-around h-full">
                {homeG.mid.map((p, i) => (
                  <FlatPlayerPin key={`hmid-${i}`} player={p} isHome={true} />
                ))}
              </div>
              <div className="flex flex-col items-center justify-around h-full">
                {homeG.fwd.map((p, i) => (
                  <FlatPlayerPin key={`hfwd-${i}`} player={p} isHome={true} />
                ))}
              </div>
            </div>

            {/* AWAY TEAM (Right half - reversed) */}
            <div className="w-1/2 h-full flex justify-between items-center py-4 px-3 sm:px-6 flex-row-reverse">
              <div className="flex flex-col items-center justify-around h-full">
                {awayG.gk.map((p, i) => (
                  <FlatPlayerPin key={`agk-${i}`} player={p} isHome={false} />
                ))}
              </div>
              <div className="flex flex-col items-center justify-around h-full">
                {awayG.def.map((p, i) => (
                  <FlatPlayerPin key={`adef-${i}`} player={p} isHome={false} />
                ))}
              </div>
              <div className="flex flex-col items-center justify-around h-full">
                {awayG.mid.map((p, i) => (
                  <FlatPlayerPin key={`amid-${i}`} player={p} isHome={false} />
                ))}
              </div>
              <div className="flex flex-col items-center justify-around h-full">
                {awayG.fwd.map((p, i) => (
                  <FlatPlayerPin key={`afwd-${i}`} player={p} isHome={false} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tactical Clash Review */}
      {tacticalReview && (
        <div className="flat-callout flex items-start gap-3">
          <span className="text-lg shrink-0 mt-0.5">⚔️</span>
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-[#f0f6fc]">
              Ulasan Benturan Taktikal &amp; Struktur Lapangan
            </h4>
            <p className="text-xs text-[#cbd5e1] leading-relaxed">
              {tacticalReview}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function FlatPlayerPin({ player, isHome }: { player: PlayerItem; isHome: boolean }) {
  const lastName = player.name.split(" ").slice(-1)[0] || player.name;

  return (
    <div
      className="group relative flex flex-col items-center cursor-pointer transition-transform duration-150 hover:scale-105 z-20"
      title={`${player.name} (${player.pos})`}
    >
      {/* Player Circle Chip (Solid Flat Color) */}
      <div
        className={`w-6 h-6 md:w-7 md:h-7 rounded-full flex items-center justify-center font-mono text-[10px] md:text-[11px] font-bold text-white shadow-sm ${
          isHome
            ? "bg-[#16a34a] border border-[#22c55e]"
            : "bg-[#0284c7] border border-[#38bdf8]"
        }`}
      >
        {player.num ?? player.pos}
      </div>

      {/* Player Name Pill */}
      <span className="mt-1 max-w-[60px] md:max-w-[75px] text-center truncate text-[9px] md:text-[10px] font-medium text-[#f0f6fc] bg-[#0d1117] px-1 py-0.2 rounded border border-[#2d3748]">
        {lastName}
      </span>

      {/* Flat Clean Hover Tooltip */}
      <div className="pointer-events-none absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50 whitespace-nowrap bg-[#161b22] border border-[#3b4554] rounded-md px-2.5 py-1 shadow-lg text-[11px]">
        <p className="font-semibold text-[#f0f6fc]">{player.name}</p>
        <p className="text-[10px] text-[#8b949e] font-mono">
          Posisi: {player.pos} {player.num ? `• #${player.num}` : ""}
        </p>
      </div>
    </div>
  );
}
