"use client";

import { useEffect, useState, useMemo } from "react";
import {
  AlertCircleIcon,
  ActivityIcon,
  SparklesIcon,
} from "@/components/icons";
import {
  MatchItem,
  Analisis,
  CacheMetrics,
  BettingResult1xBet,
} from "@/components/dashboard/types";
import { FilterToolbar } from "@/components/dashboard/FilterToolbar";
import { MatchCatalogView } from "@/components/dashboard/MatchCatalogView";
import { MatchHeaderCard } from "@/components/dashboard/MatchHeaderCard";
import { MatchTickerStrip } from "@/components/dashboard/MatchTickerStrip";
import { DataIntegrityShield } from "@/components/dashboard/DataIntegrityShield";
import { OddsDislocationBar } from "@/components/dashboard/OddsDislocationBar";
import { QuantEngineCard } from "@/components/dashboard/QuantEngineCard";
import { KellyMatrixCard } from "@/components/dashboard/KellyMatrixCard";
import { SyndicateDebateCard } from "@/components/dashboard/SyndicateDebateCard";
import { StatsAndSplitsCard } from "@/components/dashboard/StatsAndSplitsCard";
import { MarketOddsOverviewCard } from "@/components/dashboard/MarketOddsOverviewCard";
import { BettingScannerCard } from "@/components/dashboard/BettingScannerCard";
import { DeepMathEvidenceCard } from "@/components/dashboard/DeepMathEvidenceCard";
import { DualThinkingConclusionCard } from "@/components/dashboard/DualThinkingConclusionCard";
import { TheStatsOddsComparisonCard } from "@/components/dashboard/TheStatsOddsComparisonCard";
import { OneXBetDeepMarketsCard } from "@/components/dashboard/OneXBetDeepMarketsCard";
import { SidebarNav, AnalysisTabKey } from "@/components/dashboard/SidebarNav";

export default function Home() {
  const [hours, setHours] = useState<number>(12);
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [loadingMatches, setLoadingMatches] = useState<boolean>(true);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedCompetitionId, setSelectedCompetitionId] = useState<string>("ALL");
  const [activeLeagues, setActiveLeagues] = useState<
    Array<{ id: string; name: string; count: number }>
  >([]);
  const [cacheMetrics, setCacheMetrics] = useState<CacheMetrics | null>(null);
  const [sortBy, setSortBy] = useState<"time" | "name">("time");

  const [selectedMatch, setSelectedMatch] = useState<MatchItem | null>(null);
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [data, setData] = useState<Analisis | null>(null);
  const [modelUsed, setModelUsed] = useState<string>("");

  // 5 Analysis Tabs: 'math' | 'llm' | 'thestatsapi-odds' | '1xbet-markets' | 'conclusion'
  const [activeTab, setActiveTab] = useState<AnalysisTabKey>("math");

  // 1xBet State
  const [bettingLoading, setBettingLoading] = useState<boolean>(false);
  const [bettingError, setBettingError] = useState<string | null>(null);
  const [bettingResult, setBettingResult] = useState<BettingResult1xBet | null>(null);
  const [manual1xBetId, setManual1xBetId] = useState<string>("");
  const [showManualInput, setShowManualInput] = useState<boolean>(false);

  // Ambil daftar laga terjadwal
  async function fetchUpcomingMatches(selectedHours: number) {
    setLoadingMatches(true);
    setMatchError(null);
    try {
      const res = await fetch(`/api/matches?hours=${selectedHours}`);
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      setMatches(json.matches ?? []);
      setActiveLeagues(json.leagues ?? []);
      if (json.cacheMetrics) {
        setCacheMetrics(json.cacheMetrics);
      }
    } catch (e) {
      setMatchError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMatches(false);
    }
  }

  useEffect(() => {
    fetchUpcomingMatches(hours);
  }, [hours]);

  const filteredMatches = useMemo(() => {
    let list = matches;

    if (selectedCompetitionId !== "ALL") {
      list = list.filter((m) => m.competition_id === selectedCompetitionId);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (m) =>
          m.home_team.name.toLowerCase().includes(q) ||
          m.away_team.name.toLowerCase().includes(q) ||
          m.competition_name.toLowerCase().includes(q)
      );
    }

    if (sortBy === "name") {
      return [...list].sort((a, b) => a.home_team.name.localeCompare(b.home_team.name));
    }

    return [...list].sort(
      (a, b) => new Date(a.utc_date).getTime() - new Date(b.utc_date).getTime()
    );
  }, [matches, selectedCompetitionId, searchQuery, sortBy]);

  async function runAnalysis(match: MatchItem) {
    setSelectedMatch(match);
    setAnalyzing(true);
    setAgentError(null);
    setData(null);
    setModelUsed("");
    setActiveTab("math");

    window.scrollTo({ top: 0, behavior: "smooth" });

    try {
      const res = await fetch(
        `/api/agent?match_id=${encodeURIComponent(match.id)}&competition_id=${encodeURIComponent(
          match.competition_id
        )}`
      );
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json.analisis);
      if (json.cacheMetrics) {
        setCacheMetrics(json.cacheMetrics);
      }
      setModelUsed(json.modelUsed ?? "bai/mimo-v2.6-pro");
    } catch (e) {
      setAgentError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  function handleBackToList() {
    setSelectedMatch(null);
    setData(null);
    setAgentError(null);
    setBettingLoading(false);
    setBettingError(null);
    setBettingResult(null);
    setManual1xBetId("");
    setShowManualInput(false);
  }

  async function trigger1xBetAnalysis(customId?: string) {
    if (!selectedMatch) return;
    setBettingLoading(true);
    setBettingError(null);

    try {
      const res = await fetch("/api/betting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          match_id_1xbet: customId || (manual1xBetId.trim() ? manual1xBetId.trim() : undefined),
          home_team: selectedMatch.home_team.name,
          away_team: selectedMatch.away_team.name,
          competition: selectedMatch.competition_name,
          match_context: {
            hasil_proyeksi: data?.prediksi?.hasil,
            keyakinan: data?.prediksi?.keyakinan,
            alasan: data?.prediksi?.alasan,
            probabilitas_pasar: data?.probabilitas_pasar,
            form_kandang: data?.form_dan_split?.form_kandang,
            form_tamu: data?.form_dan_split?.form_tamu,
            wasit: data?.wasit_analisis?.nama,
            wasit_kartu: data?.wasit_analisis?.rata_rata_kartu,
            npxg_kandang: data?.statistik_mendalam?.shot_quality?.npxg_kandang,
            npxg_tamu: data?.statistik_mendalam?.shot_quality?.npxg_tamu,
          },
        }),
      });

      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }

      if (json.status === "not_found") {
        setBettingError(json.message);
        setShowManualInput(true);
        return;
      }

      if (json.status === "empty") {
        setBettingError(json.message);
        return;
      }

      setBettingResult(json);
    } catch (e) {
      setBettingError(e instanceof Error ? e.message : String(e));
    } finally {
      setBettingLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f5f5f5] text-[#0a0a0a] flex flex-col font-sans">
      {/* CLINICAL BLUEPRINT HEADER WITH TELEMETRY STRIP */}
      <header className="sticky top-0 z-40 w-full border-b border-[#e5e5e5] bg-[#ffffff]/95 backdrop-blur-md">
        {/* System Telemetry Bar */}
        <div className="border-b border-[#e5e5e5] bg-[#fafafa] py-1.5 px-4 sm:px-6">
          <div className="max-w-[1280px] mx-auto flex items-center justify-between text-[11px] font-mono tabular-nums text-[#737373]">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-[#0a0a0a] font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-[#0a0a0a] animate-pulse" />
                <span>SISTEM SIAP TEMPUR</span>
              </span>
              <span className="text-[#e5e5e5]">|</span>
              <span>
                Cakupan:{" "}
                <strong className="text-[#0a0a0a]">
                  {activeLeagues.length > 0 ? activeLeagues.length : 7} Liga
                </strong>
              </span>
              <span className="text-[#e5e5e5] hidden sm:inline">|</span>
              <span className="hidden sm:inline">
                DB: <strong className="text-[#171717]">SQLite Master Terverifikasi</strong>
              </span>
            </div>

            <div className="flex items-center gap-3">
              <span>
                Jadwal:{" "}
                <strong className="text-[#0a0a0a]">{matches.length} Laga Siap Bedah</strong>
              </span>
              <span className="text-[#e5e5e5]">|</span>
              <span className="text-[#737373]">WIB (UTC+7)</span>
            </div>
          </div>
        </div>

        {/* Command Navigation Row */}
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 h-12 flex items-center justify-between gap-4 text-xs font-mono">
          <div className="flex items-center gap-2.5 truncate">
            <span className="font-bold text-[#0a0a0a] tracking-tight text-xs uppercase">
              BOLA-ARANDISUPERR Quant Terminal
            </span>
            <span className="text-[#e5e5e5] hidden sm:inline">/</span>
            <span className="text-[#737373] text-[11px] hidden sm:inline">
              Deterministic Intelligence v2.0
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[18px] text-[11px] bg-[#f5f5f5] border border-[#e5e5e5] text-[#171717] font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-[#0a0a0a]" />
              TheStatsAPI Live Feed
            </span>
          </div>
        </div>

        {/* HORIZONTAL MATCH TICKER STRIP */}
        <MatchTickerStrip
          matches={filteredMatches}
          selectedMatchId={selectedMatch?.id ?? null}
          onSelectMatch={runAnalysis}
          loading={loadingMatches}
        />
      </header>

      {/* WORKSPACE MAIN CONTAINER */}
      <div className="max-w-[1280px] mx-auto w-full px-4 sm:px-6 py-6 space-y-5 flex-1">
        {/* TAMPILAN 1: KATALOG PERTANDINGAN */}
        {!selectedMatch && (
          <div className="space-y-5">
            <FilterToolbar
              hours={hours}
              onHoursChange={setHours}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              selectedCompetitionId={selectedCompetitionId}
              onCompetitionChange={setSelectedCompetitionId}
              activeLeagues={activeLeagues}
              cacheMetrics={cacheMetrics}
              loading={loadingMatches}
              onRefresh={() => fetchUpcomingMatches(hours)}
              sortBy={sortBy}
              onSortChange={setSortBy}
            />

            <MatchCatalogView
              matches={filteredMatches}
              loading={loadingMatches}
              error={matchError}
              onSelectMatch={runAnalysis}
              onRetry={() => fetchUpcomingMatches(hours)}
              hours={hours}
              hasSearchQuery={Boolean(searchQuery.trim())}
            />
          </div>
        )}

        {/* TAMPILAN 2: LAPORAN ANALISIS LAGA DEEP-DIVE */}
        {selectedMatch && (
          <div className="space-y-5">
            {/* Header Laga Selalu Berada di Atas */}
            <MatchHeaderCard
              data={
                data || {
                  pertandingan: {
                    id: selectedMatch.id,
                    tim_kandang: selectedMatch.home_team.name,
                    tim_tamu: selectedMatch.away_team.name,
                    waktu: selectedMatch.utc_date,
                    kompetisi: selectedMatch.competition_name,
                    venue: selectedMatch.venue
                      ? `${selectedMatch.venue.name}, ${selectedMatch.venue.city}`
                      : null,
                    wasit: null,
                  },
                  wasit_analisis: {
                    nama: null,
                    rata_rata_kartu: null,
                    level_ketegasan: "tidak diketahui",
                    catatan: "Memuat telemetri wasit...",
                  },
                  taktik_dan_lineup: {
                    formasi_kandang: null,
                    formasi_tamu: null,
                    status_lineup: "belum_tersedia",
                    starting_xi_kandang: [],
                    starting_xi_tamu: [],
                    ulasan_benturan_taktik: "",
                  },
                  coverage_liga: {
                    has_xg: selectedMatch.xg_available,
                    has_odds: selectedMatch.odds_available,
                    has_shotmap: selectedMatch.shotmap_available,
                    has_player_stats: false,
                  },
                  form_dan_split: {
                    form_kandang: "-",
                    form_tamu: "-",
                    rekor_kandang_spesifik: "",
                    rekor_tandang_spesifik: "",
                  },
                  klasemen: "",
                  bursa_pasar: {
                    ringkasan_1x2: "",
                    asian_handicap: null,
                    over_under: null,
                    btts: null,
                    pergerakan_smart_money: "",
                  },
                  probabilitas_pasar: null,
                  statistik_mendalam: {
                    shot_quality: { npxg_kandang: null, npxg_tamu: null, catatan: "" },
                    pemain_kunci: [],
                  },
                  faktor_kunci: [],
                  prediksi: {
                    hasil: "Lagi Membedah Data...",
                    keyakinan: "sedang",
                    alasan: "",
                    konsensus_panel: "",
                  },
                  data_tidak_tersedia: [],
                }
              }
              onBack={handleBackToList}
              onRefreshOdds={() => trigger1xBetAnalysis()}
              onRerunAnalysis={() => selectedMatch && runAnalysis(selectedMatch)}
              refreshingOdds={bettingLoading}
              rerunningAnalysis={analyzing}
            />

            {/* ANALYZING PROGRESSIVE STATE DENGAN MONO-LOADING-BAR */}
            {analyzing && (
              <div className="p-6 rounded-[24px] bg-white border border-[#e5e5e5] shadow-[0_1px_3px_rgba(0,0,0,0.05)] space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#0a0a0a] animate-ping shrink-0" />
                    <div>
                      <h2 className="text-sm font-semibold text-[#0a0a0a] font-mono uppercase tracking-wider">
                        Lagi Bedah Data &amp; Olah Statistik Laga...
                      </h2>
                      <p className="text-xs text-[#737373] font-mono mt-0.5">
                        {selectedMatch.home_team.name} vs {selectedMatch.away_team.name}
                      </p>
                    </div>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-[18px] text-[10px] font-mono bg-[#f5f5f5] border border-[#e5e5e5] text-[#171717]">
                    Dual Thinking Active
                  </span>
                </div>

                {/* Monochrome Smooth Indeterminate Loading Bar */}
                <div className="mono-loading-bar-container">
                  <div className="mono-loading-bar" />
                </div>

                <div className="space-y-2 text-xs font-mono text-[#171717] pt-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[#0a0a0a] font-bold">✓</span>
                    <span>
                      Fase 1: Telemetri ditarik dari TheStatsAPI (H2H, Form, Lineup, Vig Margins)
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[#737373]">
                    <span className="text-[#0a0a0a]">⚡</span>
                    <span>
                      Fase 2: Model Dixon-Coles xG, vig stripping, dan sidang panel analis AI lagi berdebat...
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* ERROR STATE */}
            {agentError && (
              <div className="p-5 rounded-[24px] border border-[#e7000b]/20 bg-[#e7000b]/5 text-[#0a0a0a] text-xs">
                <div className="flex items-start gap-2.5">
                  <AlertCircleIcon size={16} className="shrink-0 mt-0.5 text-[#e7000b]" />
                  <div>
                    <h3 className="font-semibold text-xs text-[#e7000b]">
                      Waduh, Gagal Ambil Analisis Laga
                    </h3>
                    <p className="text-[11px] text-[#737373] mt-0.5">{agentError}</p>
                    <button
                      onClick={() => runAnalysis(selectedMatch)}
                      className="mt-2.5 px-3 py-1.5 rounded-[18px] bg-[#0a0a0a] hover:bg-[#171717] text-white text-xs font-medium transition-colors cursor-pointer"
                    >
                      Coba Analisis Ulang
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* WORKSPACE DENGAN SIDEBAR KIRI + WORKSPACE KANAN (KETIKA DATA SIAP) */}
            {data && !analyzing && (
              <div className="flex flex-col lg:flex-row gap-5 items-start">
                {/* 1. SIDEBAR NAVIGASI KIRI */}
                <SidebarNav
                  activeTab={activeTab}
                  onSelectTab={setActiveTab}
                  homeTeam={data.pertandingan.tim_kandang}
                  awayTeam={data.pertandingan.tim_tamu}
                  hasValueBets={Boolean(
                    data.quant_engine?.value_bets && data.quant_engine.value_bets.length > 0
                  )}
                  total1xBetLines={bettingResult?.total_markets_scanned ?? null}
                />

                {/* 2. CONTENT WORKSPACE KANAN (TAMPIL EKSKLUSIF PER TAB) */}
                <div className="flex-1 min-w-0 w-full space-y-5">
                  {/* TAB 1: KALKULASI MATEMATIS */}
                  {activeTab === "math" && (
                    <div className="space-y-5">
                      {data.quant_engine && (
                        <>
                          <QuantEngineCard
                            quantData={data.quant_engine}
                            impliedProb={data.probabilitas_pasar}
                            homeTeam={data.pertandingan.tim_kandang}
                            awayTeam={data.pertandingan.tim_tamu}
                          />

                          <DeepMathEvidenceCard
                            quantData={data.quant_engine}
                            homeTeam={data.pertandingan.tim_kandang}
                            awayTeam={data.pertandingan.tim_tamu}
                            leagueName={data.pertandingan.kompetisi}
                          />
                        </>
                      )}

                      {data.quant_engine?.value_bets && (
                        <KellyMatrixCard valueBets={data.quant_engine.value_bets} />
                      )}

                      <StatsAndSplitsCard data={data} />
                    </div>
                  )}

                  {/* TAB 2: SIDANG ANALIS AI */}
                  {activeTab === "llm" && (
                    <div className="space-y-5">
                      {data.syndicate_debate ? (
                        <SyndicateDebateCard
                          syndicateData={data.syndicate_debate}
                          judgeConsensus={data.prediksi.konsensus_panel}
                        />
                      ) : (
                        <div className="p-5 rounded-[24px] bg-white border border-[#e5e5e5] text-xs text-[#737373] font-mono shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
                          Sidang analis AI belum tersedia buat laga ini.
                        </div>
                      )}

                      {/* Tactical Narrative Callout */}
                      <div className="p-5 rounded-[24px] bg-white border border-[#e5e5e5] space-y-2 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
                        <div className="flex items-center gap-2">
                          <ActivityIcon size={14} className="text-[#0a0a0a]" />
                          <h4 className="text-xs font-semibold text-[#0a0a0a] font-mono uppercase tracking-wider">
                            Sintesis Ulasan Taktis &amp; Rekomendasi
                          </h4>
                        </div>
                        <p className="text-xs text-[#171717] leading-relaxed font-sans">
                          {data.prediksi.alasan}
                        </p>
                      </div>

                      {/* Key Drivers Checklist */}
                      {data.faktor_kunci?.length > 0 && (
                        <div className="p-5 rounded-[24px] bg-white border border-[#e5e5e5] space-y-3 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
                          <h4 className="text-xs font-semibold text-[#0a0a0a] font-mono uppercase tracking-wider">
                            Faktor Kunci Penentu Laga (Key Drivers)
                          </h4>
                          <div className="space-y-2 font-mono text-xs">
                            {data.faktor_kunci.map((f, i) => (
                              <div
                                key={`keydriver-${i}-${f.slice(0, 15)}`}
                                className="flex items-start gap-2.5 text-[#171717]"
                              >
                                <span className="text-[#0a0a0a] font-bold shrink-0">✓</span>
                                <span className="leading-relaxed font-sans text-xs">{f}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 3: ODDS BOOKER THETATSAPI */}
                  {activeTab === "thestatsapi-odds" && (
                    <div className="space-y-5">
                      <TheStatsOddsComparisonCard
                        matchId={selectedMatch.id}
                        homeTeam={data.pertandingan.tim_kandang}
                        awayTeam={data.pertandingan.tim_tamu}
                        kickoffTime={data.pertandingan.waktu}
                      />

                      <OddsDislocationBar
                        bursaPasar={data.bursa_pasar}
                        quantData={data.quant_engine}
                        impliedProb={data.probabilitas_pasar}
                        bettingResult={bettingResult}
                        homeTeam={data.pertandingan.tim_kandang}
                        awayTeam={data.pertandingan.tim_tamu}
                        onTriggerScan={() => trigger1xBetAnalysis()}
                        bettingLoading={bettingLoading}
                      />

                      <MarketOddsOverviewCard
                        bursaPasar={data.bursa_pasar}
                        vigMargin={data.quant_engine?.vig_stripping?.margin_percentage}
                      />
                    </div>
                  )}

                  {/* TAB 4: KATALOG 500+ MARKET 1XBET */}
                  {activeTab === "1xbet-markets" && (
                    <div className="space-y-5">
                      <OneXBetDeepMarketsCard
                        homeTeam={data.pertandingan.tim_kandang}
                        awayTeam={data.pertandingan.tim_tamu}
                        competition={data.pertandingan.kompetisi}
                        quantData={data.quant_engine}
                        initialMarkets={bettingResult?.markets || bettingResult?.all_markets}
                        initialBettingResult={bettingResult}
                        onTriggerScan={trigger1xBetAnalysis}
                        scanLoading={bettingLoading}
                      />

                      <BettingScannerCard
                        loading={bettingLoading}
                        error={bettingError}
                        result={bettingResult}
                        manualId={manual1xBetId}
                        showManualInput={showManualInput}
                        onManualIdChange={setManual1xBetId}
                        onToggleManualInput={() => setShowManualInput(!showManualInput)}
                        onTriggerScan={trigger1xBetAnalysis}
                        homeTeam={data.pertandingan.tim_kandang}
                        awayTeam={data.pertandingan.tim_tamu}
                      />
                    </div>
                  )}

                  {/* TAB 5: VONIS AKHIR DUAL THINKING */}
                  {activeTab === "conclusion" && (
                    <div className="space-y-5">
                      {/* Dual Thinking Conclusion Card */}
                      <DualThinkingConclusionCard
                        dualJudgement={data.syndicate_debate?.dual_judgement}
                        arbiterVerdict={data.syndicate_debate?.arbiter_verdict}
                        prediction={data.prediksi}
                        homeTeam={data.pertandingan.tim_kandang}
                        awayTeam={data.pertandingan.tim_tamu}
                      />

                      {/* Closed-world Grounding Audit Shield */}
                      <DataIntegrityShield data={data} />

                      {/* Key Drivers Checklist */}
                      {data.faktor_kunci?.length > 0 && (
                        <div className="p-5 rounded-[24px] bg-white border border-[#e5e5e5] space-y-3 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
                          <h4 className="text-xs font-semibold text-[#0a0a0a] font-mono uppercase tracking-wider">
                            Faktor Kunci Penentu Laga (Key Drivers)
                          </h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {data.faktor_kunci.map((f, i) => (
                              <div
                                key={`conclusion-driver-${i}`}
                                className="flex items-start gap-2.5 text-xs text-[#171717] p-3 rounded-[18px] bg-[#fafafa] border border-[#e5e5e5] font-mono"
                              >
                                <span className="text-[#0a0a0a] font-bold shrink-0">✓</span>
                                <span className="leading-relaxed font-sans text-xs">{f}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
