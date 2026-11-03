import { useMemo } from "react";
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

export interface UseLogicalPicksParams {
  markets: Market1xBetV2[];
  quantData?: Pick<QuantEngineData, "dixon_coles"> | null;
  initialBettingResult?: BettingResult1xBet | null;
  homeTeam: string;
  awayTeam: string;
}

// Generate 3-5 "Pilihan Paling Masuk Akal (Most Logical Picks)"
export function useLogicalPicks({
  markets,
  quantData,
  initialBettingResult,
  homeTeam,
  awayTeam,
}: UseLogicalPicksParams): LogicalPickItem[] {
  return useMemo<LogicalPickItem[]>(() => {
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
          confidence: LogicalPickItem["confidence_level"]
        ): LogicalPickItem => {
          const oddsNum = typeof advice.odds === "number" ? advice.odds : 0;
          // Tanpa probabilitas model, fair odds/EV/Kelly tidak bisa dihitung → 0 (render "—").
          // is_positive_ev hanya boleh true kalau EV-nya benar-benar terverifikasi dari advice.
          const evPct = typeof advice.expected_value === "string"
            ? parseFloat(advice.expected_value.replace("%", ""))
            : NaN;
          return {
            id,
            market_id: id,
            market_name: advice.pasar ?? "",
            category,
            selection: advice.pilihan ?? "",
            bookmaker_odds: oddsNum,
            fair_odds: 0,
            model_probability: 0,
            expected_value: 0,
            ev_percentage: advice.expected_value ?? "",
            kelly_percentage: 0,
            confidence_level: confidence,
            rationale: advice.alasan ?? "",
            is_positive_ev: Number.isFinite(evPct) ? evPct > 0 : false,
          };
        };
        if (aiAdvice.rekomendasi_aman) {
          picks.push(
            toPick(aiAdvice.rekomendasi_aman, "pick-ai-safe", "Utama 1X2", "TINGGI")
          );
        }
        if (aiAdvice.rekomendasi_value) {
          picks.push(
            toPick(aiAdvice.rekomendasi_value, "pick-ai-val", "Asian Handicap", "SANGAT TINGGI")
          );
        }
        if (aiAdvice.pasar_niche) {
          picks.push(
            toPick(aiAdvice.pasar_niche, "pick-ai-niche", "Total Goals", "TINGGI")
          );
        }
      }
      return picks;
    }

    // Algoritma Closed-World Quant Matching dari katalog markets hasil scan
    // 1. Cek Pasar Utama 1X2
    const m1x2 = markets.find((m) => m.name.toLowerCase() === "1x2" || m.market_id === 1);
    if (m1x2 && m1x2.odds) {
      const oH = m1x2.odds["W1"] ?? m1x2.odds["1"];
      const oA = m1x2.odds["W2"] ?? m1x2.odds["2"];

      const evHome = oH ? dc.prob_home_win * oH - 1 : -1;
      const evAway = oA ? dc.prob_away_win * oA - 1 : -1;

      if (oH && evHome > 0.02) {
        // Kelly aman: tanpa edge positif → 0; odds <= 1 → 0 (hindari div/0 & Infinity)
        const kelly = (oH > 1 && evHome > 0) ? Math.max(0, Math.min(5.0, (evHome / (oH - 1)) * 25)) : 0;
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
        const kelly = (oA > 1 && evAway > 0) ? Math.max(0, Math.min(5.0, (evAway / (oA - 1)) * 25)) : 0;
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
          kelly_percentage: Math.round(Math.max(0, Math.min(5.0, (o1X > 1 && ev1X > 0) ? (ev1X / (o1X - 1)) * 25 : 0)) * 10) / 10,
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
          kelly_percentage: Math.round(Math.max(0, Math.min(5.0, (oOver > 1 && evO > 0) ? (evO / (oOver - 1)) * 25 : 0)) * 10) / 10,
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
          kelly_percentage: Math.round(Math.max(0, Math.min(5.0, (oUnder > 1 && evU > 0) ? (evU / (oUnder - 1)) * 25 : 0)) * 10) / 10,
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
          kelly_percentage: Math.round(Math.max(0, Math.min(5.0, (oYes > 1 && ev > 0) ? (ev / (oYes - 1)) * 25 : 0)) * 10) / 10,
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
          kelly_percentage: Math.round(Math.max(1, (ev / (oNo - 1)) * 25) * 10) / 10,
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
            kelly_percentage: Math.round(Math.max(0, Math.min(5.0, (oH0 > 1 && ev > 0) ? (ev / (oH0 - 1)) * 25 : 0)) * 10) / 10,
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
}
