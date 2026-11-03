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

/* Dots W/D/L semantik dari string form apa adanya; karakter tak dikenal tampil teks. */
function FormDots({ form }: { form: string }) {
  const dots: Array<"W" | "D" | "L"> = [];
  let unknown = "";
  for (const ch of form.toUpperCase()) {
    if (ch === "W" || ch === "M") dots.push("W");
    else if (ch === "D" || ch === "S") dots.push("D");
    else if (ch === "L" || ch === "K") dots.push("L");
    else if (!" ,-/|·".includes(ch)) unknown += ch;
  }
  if (dots.length === 0) return <strong className="text-[#f4f4f6] font-bold">{form}</strong>;
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={`Form: ${form}`}>
      {dots.map((d, i) => (
        <span
          key={i}
          title={d === "W" ? "Menang" : d === "D" ? "Seri" : "Kalah"}
          className={`w-2.5 h-2.5 rounded-full ${
            d === "W" ? "bg-[#34d399]" : d === "D" ? "bg-[#4a4a61]" : "bg-[#fb7185]"
          }`}
        />
      ))}
      {unknown && <span className="text-[11px] text-[#a2a2b5] ml-1">{unknown}</span>}
    </span>
  );
}

export function StatsAndSplitsCard({ splits, homeTeam, awayTeam }: StatsAndSplitsCardProps) {  const timKandang = homeTeam || "Tim Kandang";
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
    <div className="space-y-4 font-sans text-xs">
      {/* Home / Away Isolated Splits */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 rounded-[18px] bg-[#14141f] border border-[#262636] space-y-3">
          <div className="flex items-center justify-between pb-1">
            <h4 className="text-xs font-bold text-[#f4f4f6]">
              {timKandang} (Kandang)
            </h4>
            <span className="text-[11px] px-2.5 py-0.5 rounded-[18px] font-semibold bg-[#1b1b29] border border-[#262636] text-[#f4f4f6]">
              Home Split
            </span>
          </div>
          <p className="text-xs text-[#f4f4f6] tabular-nums flex items-center gap-2">
            <span className="text-[#a2a2b5]">Form 5 Laga:</span> <FormDots form={formKandang} />
            {npxgKandang != null && (
              <span className="text-[#a2a2b5]"> · npxG: <strong className="text-[#f4f4f6]">{npxgKandang.toFixed(2)}</strong></span>
            )}
          </p>
          <div className="p-3.5 rounded-[16px] bg-[#1b1b29] border border-[#262636] text-[#a2a2b5] leading-relaxed text-[13px] font-sans">
            {rekorKandang}
          </div>
        </div>

        <div className="p-5 rounded-[18px] bg-[#14141f] border border-[#262636] space-y-3">
          <div className="flex items-center justify-between pb-1">
            <h4 className="text-xs font-bold text-[#f4f4f6]">
              {timTamu} (Tandang)
            </h4>
            <span className="text-[11px] px-2.5 py-0.5 rounded-[18px] font-semibold bg-[#1b1b29] border border-[#262636] text-[#f4f4f6]">
              Away Split
            </span>
          </div>
          <p className="text-xs text-[#f4f4f6] tabular-nums flex items-center gap-2">
            <span className="text-[#a2a2b5]">Form 5 Laga:</span> <FormDots form={formTamu} />
            {npxgTamu != null && (
              <span className="text-[#a2a2b5]"> · npxG: <strong className="text-[#f4f4f6]">{npxgTamu.toFixed(2)}</strong></span>
            )}
          </p>
          <div className="p-3.5 rounded-[16px] bg-[#1b1b29] border border-[#262636] text-[#a2a2b5] leading-relaxed text-[13px] font-sans">
            {rekorTandang}
          </div>
        </div>
      </div>

      {/* Klasemen, coverage liga & pemain kunci */}
      <div className="p-5 rounded-[18px] bg-[#14141f] border border-[#262636] space-y-3">
        <div className="flex items-center justify-between pb-1">
          <h4 className="text-xs font-bold text-[#f4f4f6]">
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
                      ? "bg-[#1b1b29] border-[#262636] text-[#f4f4f6]"
                      : "bg-[#14141f] border-dashed border-[#34344a] text-[#8e8ea3]"
                  }`}
                >
                  {label}: {ok ? "ada" : "—"}
                </span>
              ))}
            </div>
          )}
        </div>

        {klasemen && (
          <p className="text-[13px] text-[#f4f4f6] tabular-nums leading-relaxed">{klasemen}</p>
        )}

        {pemainKunci.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-[11px] text-[#a2a2b5] block">
              Pemain Paling Berbahaya:
            </span>
            {pemainKunci.slice(0, 4).map((pk: { nama: string; tim: string; peran: string; catatan: string }, idx: number) => (
              <div key={idx} className="flex items-start gap-2 text-[13px]">
                <span className="font-semibold text-[#f4f4f6]">{pk.nama}</span>
                <span className="text-[#a2a2b5]">({pk.peran}, {pk.tim})</span>
                <span className="text-[#a2a2b5] font-sans">— {pk.catatan}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
