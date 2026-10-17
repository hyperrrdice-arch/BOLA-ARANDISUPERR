"use client";

import React from "react";

interface StatsAndSplitsCardProps {
  splits?: {
    form_kandang: string;
    form_tamu: string;
    rekor_kandang_spesifik: string;
    rekor_tandang_spesifik: string;
    npxg_kandang?: number | null;
    npxg_tamu?: number | null;
    klasemen?: string | null;
    pemain_kunci?: Array<{ nama: string; tim: string; peran: string; catatan: string }>;
    coverage_liga?: {
      has_xg?: boolean;
      has_odds?: boolean;
      has_shotmap?: boolean;
      has_player_stats?: boolean;
    } | null;
  };
  homeTeam?: string;
  awayTeam?: string;
}

export function StatsAndSplitsCard({ splits, homeTeam, awayTeam }: StatsAndSplitsCardProps) {
  const timKandang = homeTeam || "Tim Kandang";
  const timTamu = awayTeam || "Tim Tamu";
  const formKandang = splits?.form_kandang || "-";
  const formTamu = splits?.form_tamu || "-";
  const rekorKandang = splits?.rekor_kandang_spesifik || "Ulasan split kandang stabil.";
  const rekorTandang = splits?.rekor_tandang_spesifik || "Ulasan split tandang stabil.";
  const npxgKandang = splits?.npxg_kandang ?? null;
  const npxgTamu = splits?.npxg_tamu ?? null;
  const klasemen = splits?.klasemen ?? null;
  const pemainKunci = splits?.pemain_kunci ?? [];
  const coverage = splits?.coverage_liga ?? null;

  return (
    <div className="space-y-4 font-mono text-xs">
      {/* Home / Away Isolated Splits */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 rounded-[24px] bg-white border border-[#e5e5e5] space-y-3">
          <div className="flex items-center justify-between pb-1">
            <h4 className="text-xs font-bold text-[#0a0a0a]">
              {timKandang} (Kandang)
            </h4>
            <span className="text-[11px] px-2.5 py-0.5 rounded-[18px] font-semibold bg-[#fafafa] border border-[#e5e5e5] text-[#0a0a0a]">
              Home Split
            </span>
          </div>
          <p className="text-xs text-[#0a0a0a] tabular-nums">
            Form 5 Laga: <strong className="text-[#0a0a0a] font-bold">{formKandang}</strong>
            {npxgKandang != null && (
              <span className="text-[#737373]"> · npxG: <strong className="text-[#0a0a0a]">{npxgKandang.toFixed(2)}</strong></span>
            )}
          </p>
          <div className="p-3.5 rounded-[16px] bg-[#fafafa] border border-[#e5e5e5] text-[#737373] leading-relaxed text-[13px] font-sans">
            {rekorKandang}
          </div>
        </div>

        <div className="p-5 rounded-[24px] bg-white border border-[#e5e5e5] space-y-3">
          <div className="flex items-center justify-between pb-1">
            <h4 className="text-xs font-bold text-[#0a0a0a]">
              {timTamu} (Tandang)
            </h4>
            <span className="text-[11px] px-2.5 py-0.5 rounded-[18px] font-semibold bg-[#fafafa] border border-[#e5e5e5] text-[#0a0a0a]">
              Away Split
            </span>
          </div>
          <p className="text-xs text-[#0a0a0a] tabular-nums">
            Form 5 Laga: <strong className="text-[#0a0a0a] font-bold">{formTamu}</strong>
            {npxgTamu != null && (
              <span className="text-[#737373]"> · npxG: <strong className="text-[#0a0a0a]">{npxgTamu.toFixed(2)}</strong></span>
            )}
          </p>
          <div className="p-3.5 rounded-[16px] bg-[#fafafa] border border-[#e5e5e5] text-[#737373] leading-relaxed text-[13px] font-sans">
            {rekorTandang}
          </div>
        </div>
      </div>

      {/* Klasemen, coverage liga & pemain kunci */}
      <div className="p-5 rounded-[24px] bg-white border border-[#e5e5e5] space-y-3">
        <div className="flex items-center justify-between pb-1">
          <h4 className="text-xs font-bold text-[#0a0a0a]">
            Klasemen &amp; Konteks
          </h4>
          {coverage && (
            <div className="flex flex-wrap items-center gap-1.5">
              {([
                ["xG", coverage.has_xg],
                ["Odds", coverage.has_odds],
                ["Shotmap", coverage.has_shotmap],
                ["Stat Pemain", coverage.has_player_stats],
              ] as const).map(([label, ok]) => (
                <span
                  key={label}
                  className={`text-[11px] px-2 py-0.5 rounded-[18px] border ${
                    ok
                      ? "bg-[#fafafa] border-[#e5e5e5] text-[#0a0a0a]"
                      : "bg-white border-dashed border-[#d4d4d8] text-[#a3a3a3]"
                  }`}
                >
                  {label}: {ok ? "ada" : "—"}
                </span>
              ))}
            </div>
          )}
        </div>

        {klasemen && (
          <p className="text-[13px] text-[#0a0a0a] tabular-nums leading-relaxed">{klasemen}</p>
        )}

        {pemainKunci.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-[11px] text-[#737373] block">
              Pemain Paling Berbahaya:
            </span>
            {pemainKunci.slice(0, 4).map((pk: { nama: string; tim: string; peran: string; catatan: string }, idx: number) => (
              <div key={idx} className="flex items-start gap-2 text-[13px]">
                <span className="font-semibold text-[#0a0a0a]">{pk.nama}</span>
                <span className="text-[#737373]">({pk.peran}, {pk.tim})</span>
                <span className="text-[#737373] font-sans">— {pk.catatan}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
