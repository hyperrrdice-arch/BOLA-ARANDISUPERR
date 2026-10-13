"use client";

import { useEffect, useState, useMemo } from "react";
import { AlertCircleIcon } from "@/components/icons";
import {
  MatchItem,
  Analisis,
  CacheMetrics,
  BettingResult1xBet,
} from "@/components/dashboard/types";
import { FilterToolbar } from "@/components/dashboard/FilterToolbar";
import { MatchCatalogView } from "@/components/dashboard/MatchCatalogView";
import { MatchHeaderCard } from "@/components/dashboard/MatchHeaderCard";
import { DataIntegrityShield } from "@/components/dashboard/DataIntegrityShield";
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

  // Tab State: 'overview' | 'tactics' | 'stats' | 'odds'
  const [activeTab, setActiveTab] = useState<"overview" | "tactics" | "stats" | "odds">("overview");

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
    setActiveTab("overview");

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
    <main className="min-h-screen bg-[#0d1117] text-[#cbd5e1]">
      {/* FLAT TOP COMMAND HEADER */}
      <header className="sticky top-0 z-40 w-full border-b border-[#2d3748] bg-[#161b22]/95 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-13 flex items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-2 truncate">
            <span className="text-base">⚽</span>
            <span className="font-bold text-[#f0f6fc] tracking-tight">
              Football Agent Quant Terminal
            </span>
            <span className="text-[#475569] hidden sm:inline">/</span>
            <span className="text-[#8b949e] font-mono hidden sm:inline">
              Deterministic Intelligence v1.1
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono flat-tag-green">
              <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
              TheStatsAPI Live
            </span>
            <span className="text-[#475569] hidden sm:inline">|</span>
            <span className="text-[11px] font-mono text-[#8b949e] hidden sm:inline">
              Asia/Jakarta (WIB)
            </span>
          </div>
        </div>
      </header>

      {/* WORKSPACE MAIN CONTAINER */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
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
          <div className="space-y-6">
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
              <div className="flat-card-static p-6 sm:p-8 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-5 h-5 border-2 border-[#2d3748] border-t-[#22c55e] rounded-full animate-spin shrink-0" />
                  <div>
                    <h2 className="text-sm font-bold text-[#f0f6fc]">
                      Memproses Analisis AI Fusion...
                    </h2>
                    <p className="text-xs text-[#8b949e] font-mono mt-0.5">
                      {selectedMatch.home_team.name} vs {selectedMatch.away_team.name}
                    </p>
                  </div>
                </div>

                <div className="space-y-2 text-xs font-mono text-[#cbd5e1] pl-8">
                  <div className="flex items-center gap-2">
                    <span className="text-[#22c55e]">✓</span>
                    <span>Fase 1: Telemetri deterministik ditarik dari TheStatsAPI (H2H, Form, Lineup, Odds)</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#fbbf24]">
                    <span>⚡</span>
                    <span>Fase 2: Gemini 3.8 Flash mengevaluasi taktik, xG, dan sintesis keputusan kuantitatif...</span>
                  </div>
                </div>
              </div>
            )}

            {/* ERROR STATE */}
            {agentError && (
              <div className="flat-callout border-[#542022] bg-[#241315] text-[#f87171]">
                <div className="flex items-start gap-2.5">
                  <AlertCircleIcon size={16} className="shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-xs text-[#f87171]">Analisis Gagal Diproses</h3>
                    <p className="text-[11px] text-[#fca5a5] mt-0.5">{agentError}</p>
                    <button
                      onClick={() => runAnalysis(selectedMatch)}
                      className="mt-2.5 px-3 py-1 rounded bg-[#381e20] hover:bg-[#4a282b] text-xs font-medium text-white transition-colors"
                    >
                      Ulangi Analisis
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* REPORT VIEW WHEN DATA READY */}
            {data && (
              <div className="space-y-6">
                <DataIntegrityShield data={data} />

                {/* TAB SWITCHER */}
                <div className="flex items-center gap-1.5 border-b border-[#2d3748] pb-1.5 overflow-x-auto text-xs">
                  {[
                    { key: "overview", label: "Ringkasan & Prediksi", icon: "📋" },
                    { key: "tactics", label: "Taktik & Lapangan 2D", icon: "⚽" },
                    { key: "stats", label: "Statistik & Form", icon: "📊" },
                    { key: "odds", label: "Bursa Pasar & Odds", icon: "💰" },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key as any)}
                      className={`px-3.5 py-2 rounded-md font-medium transition-colors shrink-0 flex items-center gap-2 ${
                        activeTab === tab.key
                          ? "bg-[#2563eb] text-white"
                          : "text-[#8b949e] hover:text-[#f0f6fc] hover:bg-[#161b22]"
                      }`}
                    >
                      <span>{tab.icon}</span>
                      <span>{tab.label}</span>
                    </button>
                  ))}
                </div>

                {/* TAB 1: RINGKASAN & PREDIKSI */}
                {activeTab === "overview" && (
                  <div className="space-y-5">
                    {/* Implied Prob & Dixon-Coles Quant Engine */}
                    {data.quant_engine && (
                      <QuantEngineCard
                        quantData={data.quant_engine}
                        impliedProb={data.probabilitas_pasar}
                        homeTeam={data.pertandingan.tim_kandang}
                        awayTeam={data.pertandingan.tim_tamu}
                      />
                    )}

                    {/* Kelly Staking Matrix */}
                    {data.quant_engine?.value_bets && (
                      <KellyMatrixCard valueBets={data.quant_engine.value_bets} />
                    )}

                    {/* Syndicate Debate & Dual Judges */}
                    {data.syndicate_debate && (
                      <SyndicateDebateCard
                        syndicateData={data.syndicate_debate}
                        judgeConsensus={data.prediksi.konsensus_panel}
                      />
                    )}

                    {/* Tactical Narrative Callout */}
                    <div className="flat-callout flex items-start gap-3">
                      <span className="text-lg shrink-0 mt-0.5">💡</span>
                      <div className="space-y-1">
                        <h4 className="text-xs font-bold text-[#f0f6fc]">
                          Ulasan Komprehensif Prediksi Taktis
                        </h4>
                        <p className="text-xs text-[#cbd5e1] leading-relaxed">
                          {data.prediksi.alasan}
                        </p>
                      </div>
                    </div>

                    {/* Key Drivers Checklist */}
                    {data.faktor_kunci?.length > 0 && (
                      <div className="flat-card-static p-4 space-y-3">
                        <h4 className="text-xs font-bold text-[#f0f6fc]">
                          Faktor Kunci Penentu Laga (Key Drivers)
                        </h4>
                        <div className="space-y-2">
                          {data.faktor_kunci.map((f, i) => (
                            <div key={i} className="flex items-start gap-2.5 text-xs text-[#cbd5e1]">
                              <span className="text-[#22c55e] font-mono shrink-0 font-bold">☑</span>
                              <span className="leading-relaxed">{f}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 2: TAKTIK & LAPANGAN 2D */}
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

                {/* TAB 3: STATISTIK & FORM */}
                {activeTab === "stats" && (
                  <StatsAndSplitsCard data={data} />
                )}

                {/* TAB 4: BURSA PASAR & ODDS */}
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
