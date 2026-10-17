"use client";

import { useEffect, useState, useMemo } from "react";
import {
  AlertCircleIcon,
  ActivityIcon,
  SparklesIcon,
  CheckCircleIcon,
} from "@/components/icons";
import {
  MatchItem,
  CacheMetrics,
  BettingResult1xBet,
} from "@/components/dashboard/types";
import type { AnalysisView } from "@/lib/view/analysis-view";
import { FilterToolbar } from "@/components/dashboard/FilterToolbar";
import { MatchCatalogView } from "@/components/dashboard/MatchCatalogView";
import { MatchHeaderCard } from "@/components/dashboard/MatchHeaderCard";
import { MatchTickerStrip } from "@/components/dashboard/MatchTickerStrip";
import { DataIntegrityShield } from "@/components/dashboard/DataIntegrityShield";
import { OddsDislocationBar } from "@/components/dashboard/OddsDislocationBar";
import { QuantEngineCard } from "@/components/dashboard/QuantEngineCard";
import { SyndicateDebateCard } from "@/components/dashboard/SyndicateDebateCard";
import { StatsAndSplitsCard } from "@/components/dashboard/StatsAndSplitsCard";
import { ThinkingPlannerCard } from "@/components/dashboard/ThinkingPlannerCard";
import { BettingScannerCard } from "@/components/dashboard/BettingScannerCard";
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
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [data, setData] = useState<AnalysisView | null>(null);

  // 4 Tab Bersih (Verdict-First): 'ringkasan' | 'kuantitatif' | 'odds' | 'debat'
  const [activeTab, setActiveTab] = useState<AnalysisTabKey>("ringkasan");

  // 1xBet State
  const [bettingLoading, setBettingLoading] = useState<boolean>(false);
  const [bettingError, setBettingError] = useState<string | null>(null);
  const [bettingResult, setBettingResult] = useState<BettingResult1xBet | null>(null);
  const [manual1xBetId, setManual1xBetId] = useState<string>("");
  const [showManualInput, setShowManualInput] = useState<boolean>(false);

  // Live elapsed timer saat analisis sedang berjalan
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (analyzing) {
      const start = Date.now();
      setElapsedMs(0);
      timer = setInterval(() => {
        setElapsedMs(Date.now() - start);
      }, 100);
    }
    return () => clearInterval(timer);
  }, [analyzing]);

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
    setActiveTab("ringkasan");

    window.scrollTo({ top: 0, behavior: "smooth" });

    try {
      const res = await fetch(
        `/api/agent?match_id=${encodeURIComponent(match.id)}&competition_id=${encodeURIComponent(
          match.competition_id
        )}`
      );
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      // JSON adalah AnalysisView bersih dari BFF layer
      setData(json);
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
            hasil_proyeksi: data?.ringkasan.prediksi,
            keyakinan: data?.ringkasan.keyakinan,
            alasan: data?.ringkasan.alasan,
            probabilitas_pasar: data?.kuantitatif.hero.prob,
            form_kandang: data?.kuantitatif.detail.splits.form_kandang,
            form_tamu: data?.kuantitatif.detail.splits.form_tamu,
            wasit: data?.match.wasit,
            npxg_kandang: data?.kuantitatif.detail.metode.baseline?.lambda,
            npxg_tamu: data?.kuantitatif.detail.metode.baseline?.mu,
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
      {/* HEADER & TELEMETRY STRIP */}
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

        {/* TAMPILAN 2: LAPORAN ANALISIS LAGA */}
        {selectedMatch && (
          <div className="space-y-5">
            {/* Header Laga Selalu Berada di Atas */}
            <MatchHeaderCard
              view={data}
              onBack={handleBackToList}
              onRefreshOdds={() => trigger1xBetAnalysis()}
              onRerunAnalysis={() => selectedMatch && runAnalysis(selectedMatch)}
              refreshingOdds={bettingLoading}
              rerunningAnalysis={analyzing}
            />

            {/* LIVE ELAPSED LOADING BAR (TIMER JUJUR) */}
            {analyzing && (
              <div className="p-6 rounded-[24px] bg-white border border-[#e5e5e5] shadow-[0_1px_3px_rgba(0,0,0,0.05)] space-y-4 font-mono">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#0a0a0a] animate-ping shrink-0" />
                    <div>
                      <h2 className="text-sm font-semibold text-[#0a0a0a] uppercase tracking-wider">
                        Menganalisis Data Pertandingan...
                      </h2>
                      <p className="text-xs text-[#737373] mt-0.5">
                        {selectedMatch.home_team.name} vs {selectedMatch.away_team.name}
                      </p>
                    </div>
                  </div>
                  <span className="px-3 py-1 rounded-[18px] text-xs font-bold bg-[#fafafa] border border-[#e5e5e5] text-[#0a0a0a] tabular-nums">
                    {(elapsedMs / 1000).toFixed(1)}s
                  </span>
                </div>

                <div className="mono-loading-bar-container">
                  <div className="mono-loading-bar" />
                </div>

                <div className="flex items-center justify-between text-xs text-[#737373] pt-1">
                  <span>Pipeline: Ingestion &rarr; Quant Bivariate &rarr; Adversarial Debate &rarr; Verdict</span>
                  <span className="animate-pulse text-[#0a0a0a] font-semibold">Berjalan...</span>
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
                      Gagal Menjalankan Analisis Laga
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

            {/* WORKSPACE DENGAN 4 TAB (KETIKA DATA SIAP) */}
            {data && !analyzing && (
              <div className="flex flex-col lg:flex-row gap-5 items-start">
                {/* 1. SIDEBAR NAVIGASI KIRI */}
                <SidebarNav
                  activeTab={activeTab}
                  onSelectTab={setActiveTab}
                  homeTeam={data.match.home}
                  awayTeam={data.match.away}
                  hasValueBets={Boolean(
                    data.kuantitatif.detail.kelly.tabel && data.kuantitatif.detail.kelly.tabel.length > 0
                  )}
                  total1xBetLines={bettingResult?.total_markets_scanned ?? null}
                />

                {/* 2. CONTENT WORKSPACE KANAN (TAMPIL EKSKLUSIF PER TAB) */}
                <div className="flex-1 min-w-0 w-full space-y-5">
                  {/* TAB 1: RINGKASAN & VONIS (VERDICT-FIRST DEFAULT) */}
                  {activeTab === "ringkasan" && (
                    <div className="space-y-5">
                      {/* Top Verdict Banner */}
                      <div className="p-6 rounded-[24px] bg-white border border-[#e5e5e5] shadow-[0_1px_3px_rgba(0,0,0,0.05)] space-y-4 font-mono">
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#e5e5e5]">
                          <div className="flex items-center gap-2">
                            <CheckCircleIcon size={16} className="text-[#0a0a0a]" />
                            <h3 className="font-bold text-xs sm:text-sm text-[#0a0a0a] uppercase tracking-wider">
                              Vonis Utama &amp; Konsensus Laga
                            </h3>
                          </div>
                          <span className="px-2.5 py-0.5 rounded-[18px] text-[10px] font-bold flat-tag-zinc uppercase">
                            Keyakinan: {data.ringkasan.keyakinan}
                          </span>
                        </div>

                        <div className="space-y-2">
                          <h2 className="text-xl sm:text-2xl font-bold text-[#0a0a0a] font-sans">
                            {data.ringkasan.verdict}
                          </h2>
                          <p className="text-xs text-[#171717] leading-relaxed font-sans">
                            {data.ringkasan.alasan}
                          </p>
                        </div>

                        {/* Checklist Faktor Kunci */}
                        {data.ringkasan.faktor_kunci.length > 0 && (
                          <div className="pt-3 border-t border-[#e5e5e5] space-y-2">
                            <span className="text-[10px] text-[#737373] uppercase tracking-wider block font-semibold">
                              Faktor Kunci Penentu Pertandingan:
                            </span>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {data.ringkasan.faktor_kunci.map((f, i) => (
                                <div
                                  key={i}
                                  className="flex items-start gap-2 p-2.5 rounded-[14px] bg-[#fafafa] border border-[#e5e5e5] text-xs text-[#171717]"
                                >
                                  <span className="text-[#0a0a0a] font-bold mt-0.5">✓</span>
                                  <span className="font-sans leading-relaxed text-[11px]">{f}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Section Thinking Planner Trace */}
                      <ThinkingPlannerCard thinking={data.thinking} />

                      {/* Data Integrity Shield */}
                      <DataIntegrityShield integrity={data.ringkasan.integrity} />

                      {/* Form & Rekor Split */}
                      <StatsAndSplitsCard
                        splits={data.kuantitatif.detail.splits}
                        homeTeam={data.match.home}
                        awayTeam={data.match.away}
                      />
                    </div>
                  )}

                  {/* TAB 2: MODEL KUANTITATIF */}
                  {activeTab === "kuantitatif" && (
                    <div className="space-y-5">
                      <QuantEngineCard
                        kuantitatif={data.kuantitatif}
                        homeTeam={data.match.home}
                        awayTeam={data.match.away}
                      />
                    </div>
                  )}

                  {/* TAB 3: BURSA & DISLOKASI */}
                  {activeTab === "odds" && (
                    <div className="space-y-5">
                      <TheStatsOddsComparisonCard
                        matchId={selectedMatch.id}
                        homeTeam={data.match.home}
                        awayTeam={data.match.away}
                        kickoffTime={data.match.kickoff_wib}
                      />

                      <OddsDislocationBar
                        odds={data.odds}
                        bettingResult={bettingResult}
                        homeTeam={data.match.home}
                        awayTeam={data.match.away}
                        onTriggerScan={() => trigger1xBetAnalysis()}
                        bettingLoading={bettingLoading}
                      />

                      <OneXBetDeepMarketsCard
                        homeTeam={data.match.home}
                        awayTeam={data.match.away}
                        competition={data.match.competition}
                        quantData={data.kuantitatif as any}
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
                        homeTeam={data.match.home}
                        awayTeam={data.match.away}
                      />
                    </div>
                  )}

                  {/* TAB 4: SIDANG SINDIKAT */}
                  {activeTab === "debat" && (
                    <div className="space-y-5">
                      <SyndicateDebateCard
                        debat={data.debat}
                        homeTeam={data.match.home}
                        awayTeam={data.match.away}
                      />
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
