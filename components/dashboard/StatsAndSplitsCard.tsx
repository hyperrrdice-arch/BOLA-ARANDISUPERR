"use client";

import React from "react";
import { WhistleIcon, LayersIcon, FlameIcon } from "@/components/icons";
import { Analisis } from "./types";

interface StatsAndSplitsCardProps {
  data: Analisis;
}

export function StatsAndSplitsCard({ data }: StatsAndSplitsCardProps) {
  const p = data.pertandingan;
  const f = data.form_dan_split;
  const s = data.statistik_mendalam;
  const wasit = data.wasit_analisis;
  const cov = data.coverage_liga;

  return (
    <div className="space-y-4">
      {/* 1. Home / Away Isolated Splits */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-6 rounded-[24px] bg-white border border-[#e5e5e5] shadow-[0_1px_3px_rgba(0,0,0,0.05)] space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#e5e5e5]">
            <h4 className="text-xs font-bold text-[#0a0a0a] font-mono uppercase tracking-wider">
              {p.tim_kandang} (Kandang)
            </h4>
            <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-[18px] font-semibold bg-[#fafafa] border border-[#e5e5e5] text-[#0a0a0a]">
              HOME SPLIT
            </span>
          </div>
          <p className="text-xs text-[#0a0a0a] font-mono tabular-nums">
            Form 5 Laga: <strong className="text-[#0a0a0a] font-bold">{f.form_kandang}</strong>
          </p>
          <div className="p-3.5 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] text-xs text-[#737373] leading-relaxed font-mono text-[11px]">
            {f.rekor_kandang_spesifik}
          </div>
        </div>

        <div className="p-6 rounded-[24px] bg-white border border-[#e5e5e5] shadow-[0_1px_3px_rgba(0,0,0,0.05)] space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#e5e5e5]">
            <h4 className="text-xs font-bold text-[#0a0a0a] font-mono uppercase tracking-wider">
              {p.tim_tamu} (Tandang)
            </h4>
            <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-[18px] font-semibold bg-[#fafafa] border border-[#e5e5e5] text-[#0a0a0a]">
              AWAY SPLIT
            </span>
          </div>
          <p className="text-xs text-[#0a0a0a] font-mono tabular-nums">
            Form 5 Laga: <strong className="text-[#0a0a0a] font-bold">{f.form_tamu}</strong>
          </p>
          <div className="p-3.5 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] text-xs text-[#737373] leading-relaxed font-mono text-[11px]">
            {f.rekor_tandang_spesifik}
          </div>
        </div>
      </div>

      {/* 2. Urgensi Klasemen & npxG Shot Quality */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-6 rounded-[24px] bg-white border border-[#e5e5e5] shadow-[0_1px_3px_rgba(0,0,0,0.05)] space-y-3">
          <h4 className="text-xs font-bold text-[#0a0a0a] font-mono uppercase tracking-wider">
            Urgensi Posisi Klasemen &amp; Poin
          </h4>
          <p className="text-xs text-[#737373] leading-relaxed">
            {data.klasemen}
          </p>
        </div>

        <div className="p-6 rounded-[24px] bg-white border border-[#e5e5e5] shadow-[0_1px_3px_rgba(0,0,0,0.05)] space-y-3">
          <h4 className="text-xs font-bold text-[#0a0a0a] font-mono uppercase tracking-wider">
            Kualitas Tembakan &amp; non-penalty xG (npxG)
          </h4>
          <div className="grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
            <div className="p-3 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] text-center">
              <span className="text-[10px] text-[#737373] truncate block font-medium">
                {p.tim_kandang}
              </span>
              <span className="text-base font-bold text-[#0a0a0a] mt-1 block">
                {s.shot_quality.npxg_kandang !== null
                  ? `${s.shot_quality.npxg_kandang} npxG`
                  : "-"}
              </span>
            </div>

            <div className="p-3 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] text-center">
              <span className="text-[10px] text-[#737373] truncate block font-medium">
                {p.tim_tamu}
              </span>
              <span className="text-base font-bold text-[#0a0a0a] mt-1 block">
                {s.shot_quality.npxg_tamu !== null
                  ? `${s.shot_quality.npxg_tamu} npxG`
                  : "-"}
              </span>
            </div>
          </div>
          <p className="text-[11px] text-[#737373] leading-relaxed font-mono">
            {s.shot_quality.catatan}
          </p>
        </div>
      </div>

      {/* 3. Referee Profile & League Coverage */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Referee Card */}
        <div className="p-6 rounded-[24px] bg-white border border-[#e5e5e5] shadow-[0_1px_3px_rgba(0,0,0,0.05)] space-y-3">
          <div className="flex items-center gap-2">
            <WhistleIcon size={14} className="text-[#0a0a0a]" />
            <h4 className="text-xs font-bold text-[#0a0a0a] font-mono uppercase tracking-wider">
              Indeks Ketegasan Wasit
            </h4>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
            <div className="p-3 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5]">
              <span className="text-[10px] text-[#737373] uppercase block">Wasit</span>
              <span className="text-[#0a0a0a] font-medium truncate block mt-0.5">
                {wasit.nama || "Belum Ditunjuk"}
              </span>
            </div>
            <div className="p-3 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5]">
              <span className="text-[10px] text-[#737373] uppercase block">Avg Kartu/Laga</span>
              <span className="text-[#0a0a0a] font-bold block mt-0.5 flex items-center gap-1.5">
                <span className="w-2 h-2.5 rounded-xs bg-[#0a0a0a]" />
                <span>{wasit.rata_rata_kartu ?? "-"}</span>
              </span>
            </div>
            <div className="p-3 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5]">
              <span className="text-[10px] text-[#737373] uppercase block">Level Ketegasan</span>
              <span className="text-[#0a0a0a] uppercase block mt-0.5">
                {wasit.level_ketegasan}
              </span>
            </div>
            <div className="p-3 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5]">
              <span className="text-[10px] text-[#737373] uppercase block">Total Kartu Merah</span>
              <span className="text-[#0a0a0a] font-bold block mt-0.5 flex items-center gap-1.5">
                <span className="w-2 h-2.5 rounded-xs bg-[#e7000b]" />
                <span>{wasit.total_kartu_merah ?? "-"}</span>
              </span>
            </div>
          </div>

          <p className="text-[11px] text-[#737373] leading-relaxed font-mono">
            {wasit.catatan}
          </p>
        </div>

        {/* Coverage Card */}
        <div className="p-6 rounded-[24px] bg-white border border-[#e5e5e5] shadow-[0_1px_3px_rgba(0,0,0,0.05)] space-y-3">
          <div className="flex items-center gap-2">
            <LayersIcon size={14} className="text-[#0a0a0a]" />
            <h4 className="text-xs font-bold text-[#0a0a0a] font-mono uppercase tracking-wider">
              Cakupan Data Liga (TheStatsAPI)
            </h4>
          </div>

          <div className="space-y-1.5 text-xs font-mono">
            {[
              { label: "Expected Goals (xG)", active: cov.has_xg },
              { label: "Bursa Odds Lengkap", active: cov.has_odds },
              { label: "Shotmap Koordinat Tembakan", active: cov.has_shotmap },
              { label: "Statistik Individu Pemain", active: cov.has_player_stats },
            ].map((item, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2.5 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5]"
              >
                <span className="text-[#737373]">{item.label}</span>
                <span className={item.active ? "text-[#0a0a0a] font-semibold" : "text-[#a3a3a3]"}>
                  {item.active ? "Tersedia ✓" : "Tidak Ada ✗"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 4. Player Props Goalscorer Threats */}
      {s.pemain_kunci?.length > 0 && (
        <div className="p-6 rounded-[24px] bg-white border border-[#e5e5e5] shadow-[0_1px_3px_rgba(0,0,0,0.05)] space-y-4">
          <div className="flex items-center gap-2">
            <FlameIcon size={14} className="text-[#0a0a0a]" />
            <h4 className="text-xs font-bold text-[#0a0a0a] font-mono uppercase tracking-wider">
              Pemain Paling Berbahaya (Player Props Goalscorer Threats)
            </h4>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {s.pemain_kunci.map((pk, idx) => (
              <div
                key={idx}
                className="p-3.5 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <span className="text-xs font-bold text-[#0a0a0a] block truncate">{pk.nama}</span>
                  <span className="text-[10px] text-[#737373] font-mono">
                    {pk.tim} • <span className="text-[#0a0a0a] font-medium">{pk.peran}</span>
                  </span>
                </div>
                <span className="px-2.5 py-0.5 rounded-[18px] text-[10px] font-mono bg-white border border-[#e5e5e5] text-[#0a0a0a] shrink-0 font-medium">
                  {pk.catatan}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
