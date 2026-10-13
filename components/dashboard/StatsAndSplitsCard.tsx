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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        <div className="flat-card-static p-4 space-y-2.5">
          <div className="flex items-center justify-between pb-2 border-b border-[#2d3748]">
            <h4 className="text-xs font-bold text-[#22c55e]">
              {p.tim_kandang} (Kandang)
            </h4>
            <span className="text-[10px] font-mono flat-tag-green px-2 py-0.5 rounded">
              HOME SPLIT
            </span>
          </div>
          <p className="text-xs text-[#cbd5e1] font-mono">
            Form 5 Laga: <strong className="text-[#f0f6fc]">{f.form_kandang}</strong>
          </p>
          <div className="p-3 rounded-md bg-[#0d1117] border border-[#2d3748] text-xs text-[#cbd5e1] leading-relaxed">
            {f.rekor_kandang_spesifik}
          </div>
        </div>

        <div className="flat-card-static p-4 space-y-2.5">
          <div className="flex items-center justify-between pb-2 border-b border-[#2d3748]">
            <h4 className="text-xs font-bold text-[#38bdf8]">
              {p.tim_tamu} (Tandang)
            </h4>
            <span className="text-[10px] font-mono flat-tag-blue px-2 py-0.5 rounded">
              AWAY SPLIT
            </span>
          </div>
          <p className="text-xs text-[#cbd5e1] font-mono">
            Form 5 Laga: <strong className="text-[#f0f6fc]">{f.form_tamu}</strong>
          </p>
          <div className="p-3 rounded-md bg-[#0d1117] border border-[#2d3748] text-xs text-[#cbd5e1] leading-relaxed">
            {f.rekor_tandang_spesifik}
          </div>
        </div>
      </div>

      {/* 2. Klasemen Context & npxG Shot Quality */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        <div className="flat-card-static p-4 space-y-2">
          <h4 className="text-xs font-bold text-[#f0f6fc]">
            Urgensi Posisi Klasemen &amp; Poin
          </h4>
          <p className="text-xs text-[#cbd5e1] leading-relaxed">
            {data.klasemen}
          </p>
        </div>

        <div className="flat-card-static p-4 space-y-3">
          <h4 className="text-xs font-bold text-[#f0f6fc]">
            Kualitas Tembakan &amp; non-penalty xG (npxG)
          </h4>
          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <div className="p-2.5 rounded-md bg-[#0d1117] border border-[#2d3748] text-center">
              <span className="text-[10px] text-[#22c55e] truncate block font-medium">
                {p.tim_kandang}
              </span>
              <span className="text-base font-bold text-[#f0f6fc] mt-1 block">
                {s.shot_quality.npxg_kandang !== null
                  ? `${s.shot_quality.npxg_kandang} npxG`
                  : "-"}
              </span>
            </div>

            <div className="p-2.5 rounded-md bg-[#0d1117] border border-[#2d3748] text-center">
              <span className="text-[10px] text-[#38bdf8] truncate block font-medium">
                {p.tim_tamu}
              </span>
              <span className="text-base font-bold text-[#f0f6fc] mt-1 block">
                {s.shot_quality.npxg_tamu !== null
                  ? `${s.shot_quality.npxg_tamu} npxG`
                  : "-"}
              </span>
            </div>
          </div>
          <p className="text-[11px] text-[#8b949e] leading-relaxed">
            {s.shot_quality.catatan}
          </p>
        </div>
      </div>

      {/* 3. Referee Profile & League Coverage */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {/* Referee Card */}
        <div className="flat-card-static p-4 space-y-3">
          <div className="flex items-center gap-2">
            <WhistleIcon size={14} className="text-[#fbbf24]" />
            <h4 className="text-xs font-bold text-[#f0f6fc]">Indeks Ketegasan Wasit</h4>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <div className="p-2.5 rounded-md bg-[#0d1117] border border-[#2d3748]">
              <span className="text-[10px] text-[#8b949e] block">Wasit</span>
              <span className="text-[#f0f6fc] font-medium truncate block mt-0.5">
                {wasit.nama || "Belum Ditunjuk"}
              </span>
            </div>
            <div className="p-2.5 rounded-md bg-[#0d1117] border border-[#2d3748]">
              <span className="text-[10px] text-[#8b949e] block">Avg Kartu/Laga</span>
              <span className="text-[#fbbf24] font-bold block mt-0.5">
                🟨 {wasit.rata_rata_kartu ?? "-"}
              </span>
            </div>
            <div className="p-2.5 rounded-md bg-[#0d1117] border border-[#2d3748]">
              <span className="text-[10px] text-[#8b949e] block">Level Ketegasan</span>
              <span className="text-[#f0f6fc] uppercase block mt-0.5">
                {wasit.level_ketegasan}
              </span>
            </div>
            <div className="p-2.5 rounded-md bg-[#0d1117] border border-[#2d3748]">
              <span className="text-[10px] text-[#8b949e] block">Total Kartu Merah</span>
              <span className="text-[#f87171] block mt-0.5">
                🟥 {wasit.total_kartu_merah ?? "-"}
              </span>
            </div>
          </div>

          <p className="text-[11px] text-[#8b949e] leading-relaxed">
            {wasit.catatan}
          </p>
        </div>

        {/* Coverage Card */}
        <div className="flat-card-static p-4 space-y-3">
          <div className="flex items-center gap-2">
            <LayersIcon size={14} className="text-[#38bdf8]" />
            <h4 className="text-xs font-bold text-[#f0f6fc]">Cakupan Data Liga (TheStatsAPI)</h4>
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
                className="flex items-center justify-between p-2.5 rounded-md bg-[#0d1117] border border-[#2d3748]"
              >
                <span className="text-[#cbd5e1]">{item.label}</span>
                <span className={item.active ? "text-[#22c55e] font-semibold" : "text-[#64748b]"}>
                  {item.active ? "Tersedia ✓" : "Tidak Ada ✗"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 4. Player Props Goalscorer Threats */}
      {s.pemain_kunci?.length > 0 && (
        <div className="flat-card-static p-4 space-y-3">
          <div className="flex items-center gap-2">
            <FlameIcon size={14} className="text-[#f87171]" />
            <h4 className="text-xs font-bold text-[#f0f6fc]">
              Pemain Paling Berbahaya (Player Props Goalscorer Threats)
            </h4>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {s.pemain_kunci.map((pk, idx) => (
              <div
                key={idx}
                className="p-3 rounded-md bg-[#0d1117] border border-[#2d3748] flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <span className="text-xs font-bold text-[#f0f6fc] block truncate">{pk.nama}</span>
                  <span className="text-[10px] text-[#8b949e] font-mono">
                    {pk.tim} • <span className="text-[#22c55e] font-medium">{pk.peran}</span>
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono flat-tag-slate shrink-0">
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
