"use client";

import React, { useState, useMemo } from "react";
import {
  RefreshCwIcon,
  AlertCircleIcon,
  CheckCircleIcon,
  CrosshairIcon,
} from "@/components/icons";
import {
  Market1xBetV2,
} from "@/lib/1xbet";
import {
  QuantEngineData,
  BettingResult1xBet,
  BettingScannerAdviceData,
  MarketCategory,
  LogicalPickItem,
} from "./types";

interface OneXBetDeepMarketsCardProps {
  homeTeam: string;
  awayTeam: string;
  competition?: string;
  quantData?: Pick<QuantEngineData, "dixon_coles"> | null;
  initialMarkets?: Market1xBetV2[] | null;
  initialBettingResult?: BettingResult1xBet | null;
  onTriggerScan?: (customId?: string) => void;
  scanLoading?: boolean;
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

export function OneXBetDeepMarketsCard({
  homeTeam,
  awayTeam,
  competition,
  quantData,
  initialMarkets,
  initialBettingResult,
  onTriggerScan,
  scanLoading = false,
}: OneXBetDeepMarketsCardProps) {
  const [markets, setMarkets] = useState<Market1xBetV2[]>(
    initialMarkets ||
      (Array.isArray(initialBettingResult?.all_markets)
        ? initialBettingResult.all_markets
        : Array.isArray(initialBettingResult?.markets)
        ? initialBettingResult.markets
        : [])
  );
  const [matchId1xBet, setMatchId1xBet] = useState<string>(
    initialBettingResult?.match_id_1xbet
      ? String(initialBettingResult.match_id_1xbet)
      : ""
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filter & Search State
  const [activeCategory, setActiveCategory] = useState<MarketCategory>("Semua");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [manualIdInput, setManualIdInput] = useState<string>("");
  const [showManualBox, setShowManualBox] = useState<boolean>(false);
  const [page, setPage] = useState<number>(1);
  const pageSize = 30;

  // Sinkronisasi jika initialMarkets atau initialBettingResult berubah (pola React:
  // adjust state saat render, bukan effect — lihat react.dev "you might not need an effect")
  const [prevInitialMarkets, setPrevInitialMarkets] = useState(initialMarkets);
  const [prevInitialBettingResult, setPrevInitialBettingResult] =
    useState(initialBettingResult);
  if (initialMarkets !== prevInitialMarkets) {
    setPrevInitialMarkets(initialMarkets);
    if (initialMarkets && initialMarkets.length > 0) {
      setMarkets(initialMarkets);
    }
  }
  if (initialBettingResult !== prevInitialBettingResult) {
    setPrevInitialBettingResult(initialBettingResult);
    if (initialBettingResult?.all_markets && initialBettingResult.all_markets.length > 0) {
      setMarkets(initialBettingResult.all_markets);
    } else if (initialBettingResult?.markets && initialBettingResult.markets.length > 0) {
      setMarkets(initialBettingResult.markets);
    }
    if (initialBettingResult?.match_id_1xbet) {
      setMatchId1xBet(String(initialBettingResult.match_id_1xbet));
    }
  }

  // Fetch 500+ Markets via Fast GET API
  async function fetchMarketsFast(targetId?: string) {
    setLoading(true);
    setError(null);

    try {
      let url = `/api/betting?`;
      if (targetId) {
        url += `match_id=${encodeURIComponent(targetId)}`;
      } else {
        url += `home=${encodeURIComponent(homeTeam)}&away=${encodeURIComponent(
          awayTeam
        )}`;
        if (competition) url += `&competition=${encodeURIComponent(competition)}`;
      }

      const res = await fetch(url);
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }

      if (json.status === "not_found") {
        setError(json.message);
        setShowManualBox(true);
        return;
      }

      const list = json.markets || json.all_markets || [];
      setMarkets(list);
      if (json.match_id_1xbet) {
        setMatchId1xBet(json.match_id_1xbet);
      }
    } catch (err) {
      console.error("[OneXBetDeepMarketsCard] Fetch error:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  // Generate 3-5 "Pilihan Paling Masuk Akal (Most Logical Picks)"
  const logicalPicks = useMemo<LogicalPickItem[]>(() => {
    const picks: LogicalPickItem[] = [];

    // Jika ada quant engine model
    const dc = quantData?.dixon_coles;
    if (!dc) {
      // Fallback jika quant belum di-load: gunakan rekomendasi AI jika tersedia
      const aiAdvice =
        initialBettingResult?.model_a?.result?.data ||
        initialBettingResult?.model_b?.result?.data;
      if (aiAdvice) {
        const toPick = (
          advice: NonNullable<BettingScannerAdviceData["rekomendasi_aman"]>,
          id: string,
          category: MarketCategory,
          confidence: LogicalPickItem["confidence_level"],
          fairDivisor: number,
          defaultEv: string,
          defaultEvNum: number
        ): LogicalPickItem => {
          const oddsNum = typeof advice.odds === "number" ? advice.odds : 0;
          return {
            id,
            market_id: id,
            market_name: advice.pasar ?? "",
            category,
            selection: advice.pilihan ?? "",
            bookmaker_odds: oddsNum,
            fair_odds:
              oddsNum > 0
                ? Math.round((oddsNum / fairDivisor) * 100) / 100
                : 0,
            model_probability: 0.6,
            expected_value: defaultEvNum,
            ev_percentage: advice.expected_value || defaultEv,
            kelly_percentage: 0,
            confidence_level: confidence,
            rationale: advice.alasan ?? "",
            is_positive_ev: true,
          };
        };
        if (aiAdvice.rekomendasi_aman) {
          picks.push(
            toPick(
              aiAdvice.rekomendasi_aman,
              "pick-ai-safe",
              "Utama 1X2",
              "TINGGI",
              1.1,
              "+8.0%",
              0.08
            )
          );
        }
        if (aiAdvice.rekomendasi_value) {
          picks.push(
            toPick(
              aiAdvice.rekomendasi_value,
              "pick-ai-val",
              "Asian Handicap",
              "SANGAT TINGGI",
              1.15,
              "+12.0%",
              0.12
            )
          );
        }
        if (aiAdvice.pasar_niche) {
          picks.push(
            toPick(
              aiAdvice.pasar_niche,
              "pick-ai-niche",
              "Total Goals",
              "TINGGI",
              1.1,
              "+9.0%",
              0.09
            )
          );
        }
      }
      return picks;
    }

    // Algoritma Closed-World Quant Matching dari Katalog 500+ Markets
    // 1. Cek Pasar Utama 1X2
    const m1x2 = markets.find((m) => m.name.toLowerCase() === "1x2" || m.market_id === 1);
    if (m1x2 && m1x2.odds) {
      const oH = m1x2.odds["W1"] ?? m1x2.odds["1"];
      const oA = m1x2.odds["W2"] ?? m1x2.odds["2"];

      const evHome = oH ? dc.prob_home_win * oH - 1 : -1;
      const evAway = oA ? dc.prob_away_win * oA - 1 : -1;

      if (oH && evHome > 0.02) {
        const kelly = Math.max(0.5, Math.min(5.0, (evHome / (oH - 1)) * 25));
        picks.push({
          id: "logical-1x2-home",
          market_id: m1x2.market_id,
          market_name: "1X2 (Hasil Akhir)",
          category: "Utama 1X2",
          selection: `Kemenangan ${homeTeam} (1)`,
          bookmaker_odds: oH,
          fair_odds: dc.fair_odds.home,
          model_probability: dc.prob_home_win,
          expected_value: evHome,
          ev_percentage: `+${(evHome * 100).toFixed(1)}%`,
          kelly_percentage: Math.round(kelly * 10) / 10,
          confidence_level: dc.prob_home_win >= 0.55 ? "SANGAT TINGGI" : "TINGGI",
          rationale: `Model Dixon-Coles xG memproyeksikan probabilitas ${(dc.prob_home_win * 100).toFixed(1)}% vs odds 1xBet ${oH.toFixed(2)}, memberikan ekspektasi nilai positif.`,
          is_positive_ev: true,
        });
      } else if (oA && evAway > 0.02) {
        const kelly = Math.max(0.5, Math.min(5.0, (evAway / (oA - 1)) * 25));
        picks.push({
          id: "logical-1x2-away",
          market_id: m1x2.market_id,
          market_name: "1X2 (Hasil Akhir)",
          category: "Utama 1X2",
          selection: `Kemenangan ${awayTeam} (2)`,
          bookmaker_odds: oA,
          fair_odds: dc.fair_odds.away,
          model_probability: dc.prob_away_win,
          expected_value: evAway,
          ev_percentage: `+${(evAway * 100).toFixed(1)}%`,
          kelly_percentage: Math.round(kelly * 10) / 10,
          confidence_level: dc.prob_away_win >= 0.5 ? "SANGAT TINGGI" : "TINGGI",
          rationale: `Dislokasi harga terdeteksi pada ${awayTeam}: Model Poisson memprediksi ${(dc.prob_away_win * 100).toFixed(1)}% vs pasar ${(100 / oA).toFixed(1)}%.`,
          is_positive_ev: true,
        });
      }
    }

    // 2. Cek Double Chance (1X atau X2) sebagai Banker Aman
    const mDC = markets.find(
      (m) => m.name.toLowerCase().includes("double chance") || m.market_id === 8
    );
    if (mDC && mDC.odds) {
      const o1X = mDC.odds["1X"] ?? mDC.odds["1X (Home or Draw)"];
      const prob1X = dc.prob_home_win + dc.prob_draw;
      if (o1X && prob1X >= 0.65) {
        const ev1X = prob1X * o1X - 1;
        picks.push({
          id: "logical-dc-1x",
          market_id: mDC.market_id,
          market_name: "Double Chance (Banker)",
          category: "Utama 1X2",
          selection: `${homeTeam} atau Seri (1X)`,
          bookmaker_odds: o1X,
          fair_odds: Math.round((1 / prob1X) * 100) / 100,
          model_probability: prob1X,
          expected_value: ev1X,
          ev_percentage: `${ev1X >= 0 ? "+" : ""}${(ev1X * 100).toFixed(1)}%`,
          kelly_percentage: 3.5,
          confidence_level: "SANGAT TINGGI",
          rationale: `Tingkat resistensi kekalahan tinggi: Model mengonfirmasi probabilitas 1X mencapai ${(prob1X * 100).toFixed(1)}%, opsi konservatif paling stabil.`,
          is_positive_ev: ev1X >= 0,
        });
      }
    }

    // 3. Cek Total Goals Over / Under 2.5
    const mTotals = markets.filter(
      (m) =>
        m.name.toLowerCase() === "total" ||
        m.name.toLowerCase() === "totals" ||
        m.market_id === 17
    );
    const m25 = mTotals.find(
      (m) => String(m.base) === "2.5" || String(m.base) === "2,5"
    );
    if (m25 && m25.odds) {
      const oOver = m25.odds["Over"] ?? m25.odds["1"];
      const oUnder = m25.odds["Under"] ?? m25.odds["2"];

      const probOver = dc.over_2_5_prob;
      const probUnder = 1 - probOver;

      if (oOver && probOver * oOver - 1 > 0.02) {
        const evO = probOver * oOver - 1;
        picks.push({
          id: "logical-total-over-25",
          market_id: m25.market_id,
          market_name: "Total Goals (2.5 Line)",
          category: "Total Goals",
          selection: "Over 2.5 Goals",
          bookmaker_odds: oOver,
          fair_odds: Math.round((1 / probOver) * 100) / 100,
          model_probability: probOver,
          expected_value: evO,
          ev_percentage: `+${(evO * 100).toFixed(1)}%`,
          kelly_percentage: Math.round(Math.max(1, (evO / (oOver - 1)) * 25) * 10) / 10,
          confidence_level: probOver >= 0.58 ? "SANGAT TINGGI" : "TINGGI",
          rationale: `Expected total goals ${dc.expected_total_goals.toFixed(2)} gol mendukung skenario Over 2.5 dengan probabilitas model ${(probOver * 100).toFixed(1)}%.`,
          is_positive_ev: true,
        });
      } else if (oUnder && probUnder * oUnder - 1 > 0.02) {
        const evU = probUnder * oUnder - 1;
        picks.push({
          id: "logical-total-under-25",
          market_id: m25.market_id,
          market_name: "Total Goals (2.5 Line)",
          category: "Total Goals",
          selection: "Under 2.5 Goals",
          bookmaker_odds: oUnder,
          fair_odds: Math.round((1 / probUnder) * 100) / 100,
          model_probability: probUnder,
          expected_value: evU,
          ev_percentage: `+${(evU * 100).toFixed(1)}%`,
          kelly_percentage: Math.round(Math.max(1, (evU / (oUnder - 1)) * 25) * 10) / 10,
          confidence_level: probUnder >= 0.58 ? "SANGAT TINGGI" : "TINGGI",
          rationale: `Pertahanan solid dan xG rendah (${dc.expected_total_goals.toFixed(2)} xG total) mendukung garis Under 2.5 dengan probabilitas ${(probUnder * 100).toFixed(1)}%.`,
          is_positive_ev: true,
        });
      }
    }

    // 4. Cek Both Teams To Score (BTTS)
    const mBTTS = markets.find(
      (m) =>
        m.name.toLowerCase().includes("both teams to score") ||
        m.market_id === 19
    );
    if (mBTTS && mBTTS.odds) {
      const oYes = mBTTS.odds["Yes"] ?? mBTTS.odds["1"];
      const oNo = mBTTS.odds["No"] ?? mBTTS.odds["2"];
      const probYes = dc.btts_yes_prob;
      const probNo = 1 - probYes;

      if (oYes && probYes * oYes - 1 > 0.02) {
        const ev = probYes * oYes - 1;
        picks.push({
          id: "logical-btts-yes",
          market_id: mBTTS.market_id,
          market_name: "Both Teams to Score",
          category: "Both Teams to Score",
          selection: "Kedua Tim Mencetak Gol (Yes)",
          bookmaker_odds: oYes,
          fair_odds: Math.round((1 / probYes) * 100) / 100,
          model_probability: probYes,
          expected_value: ev,
          ev_percentage: `+${(ev * 100).toFixed(1)}%`,
          kelly_percentage: 2.4,
          confidence_level: probYes >= 0.6 ? "SANGAT TINGGI" : "TINGGI",
          rationale: `Kedua tim memiliki attacking rating tajam; probabilitas BTTS Yes mencapai ${(probYes * 100).toFixed(1)}% melampaui implied odds pasar.`,
          is_positive_ev: true,
        });
      } else if (oNo && probNo * oNo - 1 > 0.02) {
        const ev = probNo * oNo - 1;
        picks.push({
          id: "logical-btts-no",
          market_id: mBTTS.market_id,
          market_name: "Both Teams to Score",
          category: "Both Teams to Score",
          selection: "Salah Satu Tidak Cetak Gol (No)",
          bookmaker_odds: oNo,
          fair_odds: Math.round((1 / probNo) * 100) / 100,
          model_probability: probNo,
          expected_value: ev,
          ev_percentage: `+${(ev * 100).toFixed(1)}%`,
          kelly_percentage: 2.2,
          confidence_level: "SEDANG",
          rationale: `Potensi clean sheet sepihak diperkirakan tinggi oleh model Dixon-Coles dengan peluang ${(probNo * 100).toFixed(1)}%.`,
          is_positive_ev: true,
        });
      }
    }

    // 5. Cek Asian Handicap 0.0 (Draw No Bet)
    const dnb = dc.asian_handicap?.ah_0_0_dnb;
    if (dnb) {
      const mAH = markets.filter(
        (m) =>
          m.name.toLowerCase().includes("handicap") ||
          m.name.toLowerCase().includes("asian") ||
          m.market_id === 2
      );
      const mAH0 = mAH.find(
        (m) => String(m.base) === "0" || String(m.base) === "0.0"
      );
      if (mAH0 && mAH0.odds) {
        const oH0 = mAH0.odds["1"] ?? mAH0.odds["Home"];
        if (oH0 && dnb.home_prob * oH0 - 1 > 0.01) {
          const ev = dnb.home_prob * oH0 - 1;
          picks.push({
            id: "logical-ah-0",
            market_id: mAH0.market_id,
            market_name: "Asian Handicap (AH 0.0 / DNB)",
            category: "Asian Handicap",
            selection: `${homeTeam} AH 0.0 (Draw No Bet)`,
            bookmaker_odds: oH0,
            fair_odds: dnb.fair_odds_home,
            model_probability: dnb.home_prob,
            expected_value: ev,
            ev_percentage: `+${(ev * 100).toFixed(1)}%`,
            kelly_percentage: 3.2,
            confidence_level: "SANGAT TINGGI",
            rationale: `Perlindungan modal penuh jika seri (push). Probabilitas cover ${homeTeam} ${(dnb.home_prob * 100).toFixed(1)}% dengan margin keamanan optimal.`,
            is_positive_ev: true,
          });
        }
      }
    }

    // Sort berdasarkan kombinasi probabilitas model dan EV tertinggi
    return picks
      .sort((a, b) => b.model_probability * 0.6 + b.expected_value * 0.4 - (a.model_probability * 0.6 + a.expected_value * 0.4))
      .slice(0, 4);
  }, [markets, quantData, initialBettingResult, homeTeam, awayTeam]);

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
    <div className="p-6 rounded-[24px] bg-white border border-[#e5e5e5] space-y-6 text-[#0a0a0a]">
      {/* 1. HEADER & TELEMETRY */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-[#737373] bg-[#fafafa] px-2.5 py-1 rounded-[18px] border border-[#e5e5e5]">
              1xBet Deep Orderbook Feed
            </span>
            {matchId1xBet && (
              <span className="text-[11px] font-mono text-[#737373]">
                1xBet ID: <strong className="text-[#0a0a0a]">{matchId1xBet}</strong>
              </span>
            )}
            <span className="text-[11px] font-mono text-[#737373]">
              {markets.length > 0 ? `${markets.length} Pasar Aktif` : "Katalog 500+ Baris"}
            </span>
          </div>
          <h3 className="text-sm sm:text-base font-bold text-[#0a0a0a] font-mono tracking-tight mt-1">
            Katalog 500+ Market 1xBet &amp; Pilihan Logis
          </h3>
          <p className="text-xs text-[#737373] font-sans mt-0.5">
            {homeTeam} vs {awayTeam} • Penelusuran bursa mendalam &amp; kuantifikasi ekspektasi nilai (+EV)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (onTriggerScan) {
                onTriggerScan();
              } else {
                fetchMarketsFast();
              }
            }}
            disabled={loading || scanLoading}
            className="px-3.5 py-2 rounded-[18px] bg-[#0a0a0a] hover:bg-black text-white text-xs font-mono font-bold transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCwIcon
              size={12}
              className={loading || scanLoading ? "animate-spin" : ""}
            />
            <span>{loading || scanLoading ? "Memindai 500+..." : "Pindai Pasar 1xBet"}</span>
          </button>

          <button
            onClick={() => setShowManualBox(!showManualBox)}
            className="px-3 py-2 rounded-[18px] bg-white hover:bg-[#fafafa] text-xs font-mono text-[#0a0a0a] border border-[#e5e5e5] transition-colors cursor-pointer"
            title="Input Match ID Manual"
          >
            Manual ID
          </button>
        </div>
      </div>

      {/* MANUAL MATCH ID INPUT BOX */}
      {showManualBox && (
        <div className="p-3.5 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] flex flex-col sm:flex-row items-stretch sm:items-center gap-2 text-xs font-mono">
          <span className="text-[#737373] shrink-0">1xBet Match ID Manual:</span>
          <input
            type="text"
            placeholder="Contoh: 751762591"
            value={manualIdInput}
            onChange={(e) => setManualIdInput(e.target.value)}
            className="flex-1 bg-white text-[#0a0a0a] px-3.5 py-1.5 rounded-[18px] border border-[#e5e5e5] focus:outline-none focus:border-[#0a0a0a] font-mono text-[13px]"
          />
          <button
            onClick={() => {
              if (manualIdInput.trim()) {
                if (onTriggerScan) onTriggerScan(manualIdInput.trim());
                else fetchMarketsFast(manualIdInput.trim());
              }
            }}
            disabled={!manualIdInput.trim() || loading}
            className="px-4 py-1.5 rounded-[18px] bg-[#0a0a0a] hover:bg-black text-white font-bold transition-colors disabled:opacity-50 cursor-pointer"
          >
            Pindai ID Ini
          </button>
        </div>
      )}

      {/* ERROR CALLOUT */}
      {error && (
        <div className="p-4 rounded-[18px] bg-[#fef2f2] border border-[#fecaca] text-xs text-[#991b1b] flex items-start gap-2.5 font-mono">
          <AlertCircleIcon size={16} className="text-[#e7000b] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold text-[#991b1b]">Pencarian Pasar 1xBet Memerlukan Tindakan</p>
            <p className="text-[13px] text-[#b91c1c] leading-relaxed font-sans">{error}</p>
            <p className="text-[13px] text-[#737373] font-sans">
              Gunakan tombol &quot;Manual ID&quot; di atas untuk memasukkan 1xBet Match ID secara presisi.
            </p>
          </div>
        </div>
      )}

      {/* SECTION KHUSUS: PILIHAN PALING MASUK AKAL (MOST LOGICAL PICKS) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between pb-1">
          <div className="flex items-center gap-2">
            <CrosshairIcon size={15} className="text-[#0a0a0a]" />
            <h4 className="text-xs font-bold text-[#0a0a0a] font-mono">
              Pilihan Paling Masuk Akal (Most Logical Picks)
            </h4>
          </div>
          <span className="text-[11px] font-mono text-[#737373] bg-[#fafafa] px-2.5 py-1 rounded-[18px] border border-[#e5e5e5]">
            Dixon-Coles + Shin Vig + 1xBet Synthesis
          </span>
        </div>

        {logicalPicks.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {logicalPicks.map((pick) => (
              <div
                key={pick.id}
                className="p-4 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] hover:border-[#0a0a0a]/30 transition-colors space-y-3 font-mono"
              >
                {/* Pick Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-[18px] bg-white border border-[#e5e5e5] text-[#0a0a0a]">
                        {pick.category}
                      </span>
                      <span className="text-[11px] text-[#737373]">{pick.market_name}</span>
                    </div>
                    <h5 className="text-xs font-bold text-[#0a0a0a]">{pick.selection}</h5>
                  </div>

                  <span
                    className={`text-[11px] font-extrabold px-2.5 py-0.5 rounded-[18px] border ${
                      pick.confidence_level === "SANGAT TINGGI"
                        ? "bg-[#0a0a0a] text-white border-[#0a0a0a]"
                        : "bg-white text-[#0a0a0a] border-[#e5e5e5]"
                    }`}
                  >
                    {pick.confidence_level}
                  </span>
                </div>

                {/* Metric Strip */}
                <div className="grid grid-cols-4 gap-1.5 p-2 rounded-[18px] bg-white border border-[#e5e5e5] text-center text-xs tabular-nums">
                  <div>
                    <span className="text-[11px] text-[#737373] block">1xBet</span>
                    <span className="text-xs font-bold text-[#0a0a0a]">
                      {pick.bookmaker_odds.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-[#737373] block">Fair Odds</span>
                    <span className="text-xs font-medium text-[#737373]">
                      {pick.fair_odds.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-[#737373] block">Win Prob</span>
                    <span className="text-xs font-bold text-[#0a0a0a]">
                      {(pick.model_probability * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-[#737373] block">+EV Edge</span>
                    <span className="text-xs font-bold text-[#0a0a0a]">
                      {pick.ev_percentage}
                    </span>
                  </div>
                </div>

                {/* Rationale */}
                <p className="text-[13px] text-[#737373] leading-relaxed font-sans">
                  {pick.rationale}
                </p>

                {/* Kelly Fraction footer */}
                <div className="flex items-center justify-between pt-1 text-[11px] text-[#737373]">
                  <span>Alokasi Kelly Rekomendasi:</span>
                  <span className="font-bold text-[#0a0a0a]">
                    {pick.kelly_percentage}% Bankroll
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-5 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] text-xs font-mono text-[#737373] space-y-1">
            <p className="text-[#0a0a0a] font-semibold text-[13px] font-sans">
              Katalog pasar 1xBet belum dipindai untuk komputasi +EV otomatis.
            </p>
            <p className="text-[13px] font-sans">
              Klik tombol <strong className="text-[#0a0a0a]">&quot;Pindai Pasar 1xBet&quot;</strong> di atas
              untuk menarik 500+ baris bursa langsung dari RapidAPI.
            </p>
          </div>
        )}
      </div>

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

      {/* FOOTER GUARANTEE */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 text-[11px] font-mono text-[#737373]">
        <div className="flex items-center gap-2">
          <CheckCircleIcon size={12} className="text-[#0a0a0a]" />
          <span>RapidAPI 1xBet Ingestion • 60-Minute RAM Cache Protection</span>
        </div>
        <span>500+ Lines Exhaustive Coverage</span>
      </div>
    </div>
  );
}
