"use client";

import React from "react";
import { Analisis } from "./types";
import { formatWib } from "./utils";
import { WhistleIcon, ActivityIcon, CheckCircleIcon, AlertCircleIcon } from "@/components/icons";

interface MatchHeaderCardProps {
  data: Analisis;
  onBack: () => void;
}

export function MatchHeaderCard({ data, onBack }: MatchHeaderCardProps) {
  const p = data.pertandingan;
  const pred = data.prediksi;

  return (
    <div className="space-y-3">
      {/* Back Button with subtle nested styling */}
      <button
        onClick={onBack}
        className="group inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0f131a] hover:bg-[#141a24] border border-white/[0.08] text-xs font-mono text-[#94a3b8] hover:text-[#f8fafc] transition-all cursor-pointer"
      >
        <span className="text-[#64748b] group-hover:-translate-x-0.5 transition-transform">←</span>
        <span>Kembali ke Katalog Pertandingan</span>
      </button>

      {/* Main Header Card with Double-Bezel (Doppelrand) Architecture */}
      <div className="doppel-shell">
        <div className="doppel-core space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-md text-[11px] font-mono flat-tag-blue font-semibold uppercase tracking-wider">
                  {p.kompetisi}
                </span>
                <span className="text-xs font-mono text-[#94a3b8] flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                  {formatWib(p.waktu)}
                </span>
              </div>

              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#f8fafc]">
                {p.tim_kandang} <span className="text-[#64748b] font-light text-xl sm:text-2xl">vs</span> {p.tim_tamu}
              </h1>

              {p.venue && (
                <p className="text-xs text-[#94a3b8] flex items-center gap-1.5 font-mono">
                  <span className="text-[#64748b]">VENUE:</span>
                  <span className="text-[#cbd5e1]">{p.venue}</span>
                </p>
              )}
            </div>

            {/* Quick Result Projection Pill */}
            <div className="shrink-0">
              <div className="p-3.5 rounded-lg bg-[#0f131a] border border-white/[0.08] space-y-1.5 min-w-[200px]">
                <div className="flex items-center justify-between text-[10px] font-mono text-[#94a3b8] uppercase tracking-wider">
                  <span>Proyeksi Utama</span>
                  <ActivityIcon size={12} className="text-[#10b981]" />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-[#10b981] font-mono tracking-tight">
                    {pred.hasil}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold ${
                      pred.keyakinan === "tinggi"
                        ? "flat-tag-green"
                        : pred.keyakinan === "sedang"
                        ? "flat-tag-amber"
                        : "flat-tag-slate"
                    }`}
                  >
                    {pred.keyakinan}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Telemetry Properties Inset Grid */}
          <div className="pt-3 border-t border-white/[0.06] grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono tabular-nums">
            <div className="p-2.5 rounded-md bg-[#0f131a] border border-white/[0.04]">
              <span className="text-[10px] text-[#64748b] uppercase block">Status Lineup</span>
              <span
                className={`font-semibold capitalize flex items-center gap-1.5 mt-0.5 ${
                  data.taktik_dan_lineup.status_lineup === "resmi"
                    ? "text-[#10b981]"
                    : "text-[#f59e0b]"
                }`}
              >
                {data.taktik_dan_lineup.status_lineup === "resmi" ? (
                  <CheckCircleIcon size={12} />
                ) : (
                  <AlertCircleIcon size={12} />
                )}
                <span>{data.taktik_dan_lineup.status_lineup}</span>
              </span>
            </div>

            <div className="p-2.5 rounded-md bg-[#0f131a] border border-white/[0.04]">
              <span className="text-[10px] text-[#64748b] uppercase block">Wasit Utama</span>
              <span className="text-[#f8fafc] font-medium truncate block mt-0.5 flex items-center gap-1.5">
                <WhistleIcon size={12} className="text-[#64748b] shrink-0" />
                <span className="truncate">{data.wasit_analisis.nama || "Belum Ditunjuk"}</span>
              </span>
            </div>

            <div className="p-2.5 rounded-md bg-[#0f131a] border border-white/[0.04]">
              <span className="text-[10px] text-[#64748b] uppercase block">Avg Kartu / Laga</span>
              <span className="text-[#f59e0b] font-bold block mt-0.5">
                {data.wasit_analisis.rata_rata_kartu ?? "-"} Kartu
              </span>
            </div>

            <div className="p-2.5 rounded-md bg-[#0f131a] border border-white/[0.04]">
              <span className="text-[10px] text-[#64748b] uppercase block">Ketegasan Wasit</span>
              <span className="text-[#cbd5e1] uppercase font-semibold block mt-0.5">
                {data.wasit_analisis.level_ketegasan}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
