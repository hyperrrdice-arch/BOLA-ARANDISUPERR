"use client";

import React from "react";
import { Analisis } from "./types";
import { formatWib } from "./utils";

interface MatchHeaderCardProps {
  data: Analisis;
  onBack: () => void;
}

export function MatchHeaderCard({ data, onBack }: MatchHeaderCardProps) {
  const p = data.pertandingan;
  const pred = data.prediksi;

  return (
    <div className="space-y-4">
      {/* Back Button */}
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs text-[#8b949e] hover:text-[#f0f6fc] transition-colors"
      >
        <span>←</span>
        <span>Kembali ke Katalog Pertandingan</span>
      </button>

      {/* Main Header Card */}
      <div className="flat-card-static p-5 sm:p-6 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded text-xs font-mono flat-tag-blue">
                {p.kompetisi}
              </span>
              <span className="text-xs font-mono text-[#8b949e]">{formatWib(p.waktu)}</span>
            </div>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-[#f0f6fc]">
              {p.tim_kandang} <span className="text-[#8b949e] font-normal">vs</span> {p.tim_tamu}
            </h1>
            {p.venue && (
              <p className="text-xs text-[#8b949e]">
                📍 Stadion: <span className="text-[#cbd5e1]">{p.venue}</span>
              </p>
            )}
          </div>

          {/* Quick Result Prediction Pill */}
          <div className="flex flex-col sm:flex-row md:flex-col items-start md:items-end gap-2 shrink-0">
            <div className="p-3 rounded-md bg-[#0d1117] border border-[#2d3748] space-y-1 min-w-[180px]">
              <span className="text-[10px] font-mono text-[#8b949e] uppercase block">
                Proyeksi Hasil Utama
              </span>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-[#22c55e] font-mono">{pred.hasil}</span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
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

        {/* Metadata Properties Table */}
        <div className="pt-3 border-t border-[#2d3748] grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
          <div>
            <span className="text-[10px] text-[#8b949e] block">Status Lineup:</span>
            <span
              className={`font-semibold capitalize ${
                data.taktik_dan_lineup.status_lineup === "resmi"
                  ? "text-[#22c55e]"
                  : "text-[#fbbf24]"
              }`}
            >
              {data.taktik_dan_lineup.status_lineup}
            </span>
          </div>

          <div>
            <span className="text-[10px] text-[#8b949e] block">Wasit Utama:</span>
            <span className="text-[#cbd5e1] truncate block">
              {data.wasit_analisis.nama || "Belum Ditunjuk"}
            </span>
          </div>

          <div>
            <span className="text-[10px] text-[#8b949e] block">Avg Kartu/Laga:</span>
            <span className="text-[#fbbf24]">
              {data.wasit_analisis.rata_rata_kartu ?? "-"} Kartu
            </span>
          </div>

          <div>
            <span className="text-[10px] text-[#8b949e] block">Ketegasan Wasit:</span>
            <span className="text-[#cbd5e1] uppercase">
              {data.wasit_analisis.level_ketegasan}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
