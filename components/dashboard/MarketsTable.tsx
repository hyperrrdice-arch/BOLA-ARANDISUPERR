"use client";

import { useMemo, useState } from "react";
import {
  Market1xBetV2,
} from "@/lib/1xbet";
import {
  MarketCategory,
} from "./types";

interface MarketsTableProps {
  markets: Market1xBetV2[];
}

const CATEGORIES: MarketCategory[] = [
  "Semua",
  "Utama 1X2",
  "Total Goals",
  "Asian Handicap",
  "Both Teams to Score",
  "Babak 1/2",
  "Corners & Kartu",
  "Lainnya",
];

function classifyMarket(marketName: string): MarketCategory {
  const lower = marketName.toLowerCase();
  if (
    lower.includes("corner") ||
    lower.includes("card") ||
    lower.includes("yellow") ||
    lower.includes("red") ||
    lower.includes("kartu") ||
    lower.includes("sudut")
  ) {
    return "Corners & Kartu";
  }
  if (
    lower.includes("1st half") ||
    lower.includes("2nd half") ||
    lower.includes("half") ||
    lower.includes("babak") ||
    lower.includes("interval")
  ) {
    return "Babak 1/2";
  }
  if (
    lower.includes("both teams to score") ||
    lower.includes("btts") ||
    lower.includes("goal in both") ||
    lower.includes("kedua tim")
  ) {
    return "Both Teams to Score";
  }
  if (
    lower.includes("handicap") ||
    lower.includes("asian") ||
    lower.includes("ah ")
  ) {
    return "Asian Handicap";
  }
  if (
    lower.includes("total") ||
    lower.includes("over") ||
    lower.includes("under") ||
    lower.includes("goals") ||
    lower.includes("gol")
  ) {
    return "Total Goals";
  }
  if (
    lower === "1x2" ||
    lower.includes("match result") ||
    lower.includes("double chance") ||
    lower.includes("hasil akhir") ||
    lower.includes("pemenang")
  ) {
    return "Utama 1X2";
  }
  return "Lainnya";
}

export function MarketsTable({ markets }: MarketsTableProps) {
  // Filter & Search State
  const [activeCategory, setActiveCategory] = useState<MarketCategory>("Semua");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const pageSize = 30;

  // Filtered 500+ Markets
  const filteredMarkets = useMemo(() => {
    let list = markets;

    if (activeCategory !== "Semua") {
      list = list.filter((m) => classifyMarket(m.name) === activeCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((m) => {
        const nameMatch = m.name.toLowerCase().includes(q);
        const baseMatch = m.base !== null && String(m.base).includes(q);
        const oddsMatch = Object.keys(m.odds || {}).some(
          (k) =>
            k.toLowerCase().includes(q) ||
            String(m.odds[k]).includes(q)
        );
        return nameMatch || baseMatch || oddsMatch;
      });
    }

    return list;
  }, [markets, activeCategory, searchQuery]);

  // Pagination for high performance rendering
  const totalPages = Math.ceil(filteredMarkets.length / pageSize);
  const paginatedMarkets = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredMarkets.slice(start, start + pageSize);
  }, [filteredMarkets, page, pageSize]);

  return (
    <>
      {/* 2. FILTER KATEGORI CEPAT & PENCARIAN INSTAN */}
      <div className="space-y-3 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          {/* Category Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 scrollbar-none font-mono text-xs">
            {CATEGORIES.map((cat) => {
              const isActive = activeCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => {
                    setActiveCategory(cat);
                    setPage(1);
                  }}
                  className={`px-3 py-1.5 rounded-[18px] text-[11px] font-medium transition-colors shrink-0 cursor-pointer ${
                    isActive
                      ? "bg-[#0a0a0a] text-white font-bold"
                      : "bg-[#fafafa] text-[#737373] hover:text-[#0a0a0a] border border-[#e5e5e5]"
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>

          {/* Quick Search Input */}
          <div className="relative w-full sm:w-64 shrink-0 font-mono">
            <input
              type="text"
              placeholder="Cari pasar, line (mis: 2.5), atau opsi..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="w-full bg-[#fafafa] text-[#0a0a0a] placeholder-[#737373] px-3.5 py-1.5 rounded-[18px] border border-[#e5e5e5] focus:outline-none focus:border-[#0a0a0a] text-[13px]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#737373] hover:text-[#0a0a0a] text-xs cursor-pointer"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Counter Indicator */}
        <div className="flex items-center justify-between text-[11px] font-mono text-[#737373]">
          <span>
            Menampilkan{" "}
            <strong className="text-[#0a0a0a] font-bold tabular-nums">
              {filteredMarkets.length}
            </strong>{" "}
            dari{" "}
            <strong className="text-[#0a0a0a] tabular-nums">{markets.length}</strong> bursa pasar
            {activeCategory !== "Semua" ? ` (Kategori: ${activeCategory})` : ""}
          </span>
          {totalPages > 1 && (
            <span>
              Halaman {page} dari {totalPages}
            </span>
          )}
        </div>
      </div>

      {/* 3. GRID 500+ BURSA PASAR 1XBET */}
      {paginatedMarkets.length > 0 ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 font-mono">
            {paginatedMarkets.map((m) => {
              const oddsKeys = Object.keys(m.odds || {});
              return (
                <div
                  key={`mkt-${m.market_id}-${m.name}-${m.base ?? "nobase"}`}
                  className="p-3.5 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] hover:border-[#0a0a0a]/30 transition-colors space-y-2.5 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 text-[11px] text-[#737373] pb-1">
                      <span className="truncate font-semibold text-[#737373]">
                        {classifyMarket(m.name)}
                      </span>
                      <span className="shrink-0 tabular-nums text-[#a3a3a3]">
                        ID: {m.market_id}
                      </span>
                    </div>

                    <div className="flex items-baseline justify-between gap-2 mt-1.5">
                      <h6 className="text-xs font-bold text-[#0a0a0a] leading-tight">
                        {m.name}
                      </h6>
                      {m.base !== null && m.base !== undefined && (
                        <span className="text-[11px] bg-white px-2 py-0.5 rounded-[18px] text-[#0a0a0a] font-bold border border-[#e5e5e5] shrink-0 tabular-nums">
                          Line: {m.base}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Odds Grid */}
                  <div className="pt-2">
                    <div
                      className={`grid gap-1.5 ${
                        oddsKeys.length === 2
                          ? "grid-cols-2"
                          : oddsKeys.length === 3
                          ? "grid-cols-3"
                          : "grid-cols-2"
                      }`}
                    >
                      {oddsKeys.map((key) => {
                        const price = m.odds[key];
                        return (
                          <div
                            key={key}
                            className="p-2 rounded-[18px] bg-white border border-[#e5e5e5] text-center flex flex-col justify-center"
                          >
                            <span className="text-[11px] text-[#737373] truncate block">
                              {key}
                            </span>
                            <span className="text-xs font-bold text-[#0a0a0a] tabular-nums">
                              {typeof price === "number" ? price.toFixed(2) : price}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-3 font-mono text-xs">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3.5 py-1.5 rounded-[18px] bg-white hover:bg-[#fafafa] text-[#0a0a0a] border border-[#e5e5e5] disabled:opacity-30 cursor-pointer"
              >
                ← Sebelumnya
              </button>
              <span className="text-[#737373] px-2">
                Halaman <strong className="text-[#0a0a0a]">{page}</strong> / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3.5 py-1.5 rounded-[18px] bg-white hover:bg-[#fafafa] text-[#0a0a0a] border border-[#e5e5e5] disabled:opacity-30 cursor-pointer"
              >
                Selanjutnya →
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="p-8 text-center space-y-2 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] font-mono text-xs text-[#737373]">
          <p className="text-[#0a0a0a] font-semibold">
            {markets.length === 0
              ? "Belum ada pasar 1xBet yang dimuat."
              : "Tidak ada pasar yang cocok dengan filter atau kata kunci pencarian Anda."}
          </p>
          <p className="text-[13px] text-[#737373] font-sans">
            {markets.length === 0
              ? "Klik 'Pindai Pasar 1xBet' atau masukkan Match ID 1xBet secara manual."
              : "Coba ubah kategori filter atau hapus kata kunci pencarian."}
          </p>
        </div>
      )}
    </>
  );
}
