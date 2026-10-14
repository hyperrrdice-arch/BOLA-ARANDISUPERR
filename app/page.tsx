"use client";

import { useEffect, useState, useMemo } from "react";
import {
  AlertCircleIcon,
  ActivityIcon,
  CpuIcon,
  PitchIcon,
  BarChart3Icon,
  CoinsIcon,
  ScaleIcon,
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
import { TacticalPitchCard } from "@/components/dashboard/TacticalPitchCard";
import { QuantEngineCard } from "@/components/dashboard/QuantEngineCard";
import { KellyMatrixCard } from "@/components/dashboard/KellyMatrixCard";
import { SyndicateDebateCard } from "@/components/dashboard/SyndicateDebateCard";
import { StatsAndSplitsCard } from "@/components/dashboard/StatsAndSplitsCard";
import { MarketOddsOverviewCard } from "@/components/dashboard/MarketOddsOverviewCard";
import { BettingScannerCard } from "@/components/dashboard/BettingScannerCard";

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

  const [selectedMatch, setSelectedMatch] = useState<MatchItem | null>(null);
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [data, setData] = useState<Analisis | null>(null);
  const [modelUsed, setModelUsed] = useState<string>("");

  // Workspace Mode: 'bento' (Tri-Panel Cockpit) | 'tactics' | 'stats' | 'odds'
  const [activeTab, setActiveTab] = useState<"bento" | "tactics" | "stats" | "odds">("bento");

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

    return list;
  }, [matches, selectedCompetitionId, searchQuery]);

  async function runAnalysis(match: MatchItem) {
    setSelectedMatch(match);
    setAnalyzing(true);
    setAgentError(null);
    setData(null);
    setModelUsed("");
    setActiveTab("bento");

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
      setModelUsed(json.modelUsed ?? "oc/muse-spark-1.3-contributor-free");
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
    <main className="min-h-screen bg-[#080a0e] text-[#cbd5e1] flex flex-col">
      {/* HIGH-DENSITY TERMINAL HEADER */}
      <header className="sticky top-0 z-40 w-full border-b border-white/[0.08] bg-[#0a0d13]/95 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-12 flex items-center justify-between gap-4 text-xs font-mono">
          <div className="flex items-center gap-2.5 truncate">
            <span className="w-2 h-2 rounded-full bg-[#10b981] animate-pulse shrink-0" />
            <span className="font-extrabold text-[#f8fafc] tracking-tight text-xs uppercase">
              Football-Agent Quant Terminal
            </span>
            <span className="text-white/[0.2] hidden sm:inline">/</span>
            <span className="text-[#64748b] text-[11px] hidden sm:inline">
              Deterministic Intelligence v1.2
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] flat-tag-green font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
              TheStatsAPI Live
            </span>
            <span className="text-white/[0.2] hidden sm:inline">|</span>
            <span className="text-[11px] text-[#94a3b8] tabular-nums hidden sm:inline">
              WIB (UTC+7)
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
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 space-y-6 flex-1">
        {/* TAMPILAN 1: KATALOG PERTANDINGAN */}
        {!selectedMatch && (
          <div className="space-y-6">
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
            <MatchHeaderCard
              data={
                data || {
                  pertandingan: {
                    id: selectedMatch.id,
                    tim_kandang: selectedMatch.home_team.name,
                    tim_tamu: selectedMatch.away_team.name,
                    waktu: selectedMatch.utc_date,
                    kompetisi: selectedMatch.competition_name,
                    venue: selectedMatch.venue ? `${selectedMatch.venue.name}, ${selectedMatch.venue.city}` : null,
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
                    hasil: "Menganalisis...",
                    keyakinan: "sedang",
                    alasan: "",
                    konsensus_panel: "",
                  },
                  data_tidak_tersedia: [],
                }
              }
              onBack={handleBackToList}
            />

            {/* ANALYZING STATE */}
            {analyzing && (
              <div className="doppel-shell p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-5 h-5 border-2 border-white/[0.1] border-t-[#10b981] rounded-full animate-spin shrink-0" />
                  <div>
                    <h2 className="text-sm font-bold text-[#f8fafc] font-mono uppercase tracking-wider">
                      Memproses Penalaran AI Multi-Model...
                    </h2>
                    <p className="text-xs text-[#94a3b8] font-mono mt-0.5">
                      {selectedMatch.home_team.name} vs {selectedMatch.away_team.name}
                    </p>
                  </div>
                </div>

                <div className="space-y-2 text-xs font-mono text-[#cbd5e1] pl-8">
                  <div className="flex items-center gap-2">
                    <span className="text-[#10b981]">✓</span>
                    <span>Fase 1: Telemetri deterministik ditarik dari TheStatsAPI (H2H, Form, Lineup, Odds)</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#f59e0b]">
                    <span>⚡</span>
                    <span>Fase 2: Gemini 3.8 Flash mengevaluasi taktik, Dixon-Coles xG, dan konsensus mahkamah arbitrase...</span>
                  </div>
                </div>
              </div>
            )}

            {/* ERROR STATE */}
            {agentError && (
              <div className="p-4 rounded-lg border border-[#5b1322] bg-[#2a0a11] text-[#f43f5e] text-xs">
                <div className="flex items-start gap-2.5">
                  <AlertCircleIcon size={16} className="shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-xs text-[#f43f5e]">Analisis Gagal Diproses</h3>
                    <p className="text-[11px] text-[#fca5a5] mt-0.5">{agentError}</p>
                    <button
                      onClick={() => runAnalysis(selectedMatch)}
                      className="mt-2.5 px-3 py-1 rounded bg-[#3b1219] hover:bg-[#4f1821] text-xs font-medium text-white transition-colors cursor-pointer"
                    >
                      Ulangi Analisis
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* REPORT VIEW WHEN DATA READY */}
            {data && (
              <div className="space-y-5">
                {/* 1. Closed-world Grounding Audit Shield */}
                <DataIntegrityShield data={data} />

                {/* 2. Unified Odds Dislocation Bar */}
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

                {/* WORKSPACE VIEW MODE SWITCHER */}
                <div className="flex items-center gap-2 border-b border-white/[0.08] pb-2 overflow-x-auto text-xs font-mono">
                  {[
                    { key: "bento", label: "Tri-Panel Bento Cockpit", icon: ActivityIcon },
                    { key: "tactics", label: "2D Tactical Pitch & Lineup", icon: PitchIcon },
                    { key: "stats", label: "Statistik Mendalam & npxG", icon: BarChart3Icon },
                    { key: "odds", label: "1xBet Deep Scanner & Orderbook", icon: CoinsIcon },
                  ].map((tab) => {
                    const IconComponent = tab.icon;
                    const isActive = activeTab === tab.key;
                    return (
                      <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key as any)}
                        className={`px-3.5 py-1.5 rounded-md font-medium transition-all shrink-0 flex items-center gap-2 cursor-pointer ${
                          isActive
                            ? "bg-[#14231b] text-[#10b981] border border-[#134e3a] font-bold shadow-[0_0_12px_rgba(16,185,129,0.15)]"
                            : "text-[#94a3b8] hover:text-[#f8fafc] hover:bg-[#0f131a] border border-transparent"
                        }`}
                      >
                        <IconComponent size={13} />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* MODE 1: TRI-PANEL BENTO COCKPIT (THE FLAGSHIP UNIFIED VIEW) */}
                {activeTab === "bento" && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                    {/* PANEL KIRI (COL-SPAN-4): QUANT MATHEMATICAL ENGINE */}
                    <div className="lg:col-span-4 space-y-4">
                      {data.quant_engine && (
                        <QuantEngineCard
                          quantData={data.quant_engine}
                          impliedProb={data.probabilitas_pasar}
                          homeTeam={data.pertandingan.tim_kandang}
                          awayTeam={data.pertandingan.tim_tamu}
                        />
                      )}
                      <StatsAndSplitsCard data={data} />
                    </div>

                    {/* PANEL TENGAH (COL-SPAN-5): 5-AGENT SYNDICATE DEBATE & VERDICT */}
                    <div className="lg:col-span-5 space-y-4">
                      {data.syndicate_debate && (
                        <SyndicateDebateCard
                          syndicateData={data.syndicate_debate}
                          judgeConsensus={data.prediksi.konsensus_panel}
                        />
                      )}

                      {/* Tactical Narrative Callout */}
                      <div className="doppel-shell">
                        <div className="doppel-core space-y-2">
                          <div className="flex items-center gap-2">
                            <ActivityIcon size={14} className="text-[#10b981]" />
                            <h4 className="text-xs font-bold text-[#f8fafc] font-mono uppercase tracking-wider">
                              Ulasan Komprehensif Prediksi Taktis
                            </h4>
                          </div>
                          <p className="text-xs text-[#cbd5e1] leading-relaxed">
                            {data.prediksi.alasan}
                          </p>
                        </div>
                      </div>

                      {/* Key Drivers Checklist */}
                      {data.faktor_kunci?.length > 0 && (
                        <div className="doppel-shell">
                          <div className="doppel-core space-y-2.5">
                            <h4 className="text-xs font-bold text-[#f8fafc] font-mono uppercase tracking-wider">
                              Faktor Kunci Penentu Laga (Key Drivers)
                            </h4>
                            <div className="space-y-1.5">
                              {data.faktor_kunci.map((f, i) => (
                                <div key={`factor-${i}-${f.slice(0, 15)}`} className="flex items-start gap-2 text-xs text-[#cbd5e1]">
                                  <span className="text-[#10b981] font-mono font-bold shrink-0">✓</span>
                                  <span className="leading-relaxed">{f}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* PANEL KANAN (COL-SPAN-3): PORTFOLIO KELLY & 1XBET SCANNER */}
                    <div className="lg:col-span-3 space-y-4">
                      {data.quant_engine?.value_bets && (
                        <KellyMatrixCard valueBets={data.quant_engine.value_bets} />
                      )}

                      <MarketOddsOverviewCard bursaPasar={data.bursa_pasar} />

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
                  </div>
                )}

                {/* MODE 2: DEDICATED TACTICAL PITCH 2D */}
                {activeTab === "tactics" && (
                  <TacticalPitchCard
                    homeName={data.pertandingan.tim_kandang}
                    awayName={data.pertandingan.tim_tamu}
                    homeFormation={data.taktik_dan_lineup.formasi_kandang}
                    awayFormation={data.taktik_dan_lineup.formasi_tamu}
                    homePlayers={data.taktik_dan_lineup.starting_xi_kandang}
                    awayPlayers={data.taktik_dan_lineup.starting_xi_tamu}
                    tacticalReview={data.taktik_dan_lineup.ulasan_benturan_taktik}
                    statusLineup={data.taktik_dan_lineup.status_lineup}
                  />
                )}

                {/* MODE 3: STATISTIK & FORM */}
                {activeTab === "stats" && (
                  <StatsAndSplitsCard data={data} />
                )}

                {/* MODE 4: BURSA PASAR & ODDS DEEP DIVE */}
                {activeTab === "odds" && (
                  <div className="space-y-5">
                    <MarketOddsOverviewCard bursaPasar={data.bursa_pasar} />

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
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
