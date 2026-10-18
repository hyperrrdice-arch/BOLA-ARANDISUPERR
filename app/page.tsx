"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import {
  AlertCircleIcon,
  CheckCircleIcon,
} from "@/components/icons";
import {
  MatchItem,
  BettingResult1xBet,
} from "@/components/dashboard/types";
import type { AnalysisView } from "@/lib/view/analysis-view";
import { FilterToolbar } from "@/components/dashboard/FilterToolbar";
import { MatchCatalogView } from "@/components/dashboard/MatchCatalogView";
import { MatchTickerStrip } from "@/components/dashboard/MatchTickerStrip";
import type { AnalysisTabKey } from "@/components/dashboard/SidebarNav";
import dynamic from "next/dynamic";

// Pasar 1xBet/Scanner = on-demand (butuh scan manual) → lazy, bukan masuk bundle awal.
const OneXBetDeepMarketsCard = dynamic(
  () => import("@/components/dashboard/OneXBetDeepMarketsCard").then((m) => m.OneXBetDeepMarketsCard),
  { ssr: false }
);
const BettingScannerCard = dynamic(
  () => import("@/components/dashboard/BettingScannerCard").then((m) => m.BettingScannerCard),
  { ssr: false }
);

// Kartu-kartu analisis cuma dipakai SETELAH match dipilih, tapi sebelumnya diimpor eager
// sehingga ikut di-parse/eksekusi saat hidrasi layar katalog. Code-split ini menghemat
// ~11 KB on-wire (194→183 KB — lihat PERF.md); klaim lama soal penurunan LCP/render delay
// DIGUGURKAN pengukuran (mobile 2459→2487 ms = noise). Semua di sini tidak terjangkau pada
// paint pertama, jadi dipisah dari bundle awal mengikuti pola OneXBet di atas.
const MatchHeaderCard = dynamic(
  () => import("@/components/dashboard/MatchHeaderCard").then((m) => m.MatchHeaderCard),
  { ssr: false }
);
const SidebarNav = dynamic(
  () => import("@/components/dashboard/SidebarNav").then((m) => m.SidebarNav),
  { ssr: false }
);
const ThinkingPlannerCard = dynamic(
  () => import("@/components/dashboard/ThinkingPlannerCard").then((m) => m.ThinkingPlannerCard),
  { ssr: false }
);
const DataIntegrityShield = dynamic(
  () => import("@/components/dashboard/DataIntegrityShield").then((m) => m.DataIntegrityShield),
  { ssr: false }
);
const StatsAndSplitsCard = dynamic(
  () => import("@/components/dashboard/StatsAndSplitsCard").then((m) => m.StatsAndSplitsCard),
  { ssr: false }
);
const QuantEngineCard = dynamic(
  () => import("@/components/dashboard/QuantEngineCard").then((m) => m.QuantEngineCard),
  { ssr: false }
);
const TheStatsOddsComparisonCard = dynamic(
  () => import("@/components/dashboard/TheStatsOddsComparisonCard").then((m) => m.TheStatsOddsComparisonCard),
  { ssr: false }
);
const OddsDislocationBar = dynamic(
  () => import("@/components/dashboard/OddsDislocationBar").then((m) => m.OddsDislocationBar),
  { ssr: false }
);
const SyndicateDebateCard = dynamic(
  () => import("@/components/dashboard/SyndicateDebateCard").then((m) => m.SyndicateDebateCard),
  { ssr: false }
);

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
  const [sortBy, setSortBy] = useState<"time" | "name">("time");

  const [selectedMatch, setSelectedMatch] = useState<MatchItem | null>(null);
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [data, setData] = useState<AnalysisView | null>(null);

  // 4 Tab Bersih (Verdict-First): 'ringkasan' | 'kuantitatif' | 'odds' | 'debat'
  const [activeTab, setActiveTab] = useState<AnalysisTabKey>("ringkasan");
  const [showMarkets, setShowMarkets] = useState<boolean>(false);

  // 1xBet State
  const [bettingLoading, setBettingLoading] = useState<boolean>(false);
  const [bettingError, setBettingError] = useState<string | null>(null);
  const [bettingResult, setBettingResult] = useState<BettingResult1xBet | null>(null);
  const [manual1xBetId, setManual1xBetId] = useState<string>("");
  const [showManualInput, setShowManualInput] = useState<boolean>(false);

  // Guard race: response lama yang balik setelah request baru jalan wajib diabaikan
  const analysisReqId = useRef(0);
  const bettingReqId = useRef(0);
  // Abort request analisis yang sudah usang supaya server berhenti bekerja
  // (satu analisis = puluhan panggilan LLM, bukan request murah).
  const analysisAbort = useRef<AbortController | null>(null);

  // Live elapsed timer saat analisis sedang berjalan.
  // setElapsedMs(0) sengaja di tick pertama: effect = sinkronisasi timer eksternal (interval),
  // bukan cascade render (lihat react.dev "synchronizing with effects").
  useEffect(() => {
    if (!analyzing) return;
    const start = Date.now();
    const timer = setInterval(() => {
      setElapsedMs(Date.now() - start);
    }, 100);
    return () => clearInterval(timer);
  }, [analyzing]);

  // Ambil daftar laga terjadwal. `isStale` = callback cek apakah permintaan sudah usang.
  async function fetchUpcomingMatches(selectedHours: number, isStale: () => boolean = () => false) {
    setLoadingMatches(true);
    setMatchError(null);
    try {
      const res = await fetch(`/api/matches?hours=${selectedHours}`);
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      if (isStale()) return;
      setMatches(json.matches ?? []);
      setActiveLeagues(json.leagues ?? []);
    } catch (e) {
      if (isStale()) return;
      setMatchError(e instanceof Error ? e.message : String(e));
    } finally {
      if (isStale()) return;
      setLoadingMatches(false);
    }
  }

  useEffect(() => {
    // `ignore` = flag stale-request (direset tiap cleanup), mengikuti pola resmi React
    // (react.dev "fetching data"): fetch di effect SAH + race guard.
    // Semua setState spinner ada DI DALAM fetch (bukan di body effect).
    let ignore = false;
    /* eslint-disable react-hooks/set-state-in-effect -- setState loading/error sinkron saat
       `hours` berubah; pola resmi React (fetch di effect + race guard `ignore`). */
    void fetchUpcomingMatches(hours, () => ignore);
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => {
      ignore = true;
    };
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
    const reqId = ++analysisReqId.current;
    setSelectedMatch(match);
    setAnalyzing(true);
    setAgentError(null);
    setData(null);
    // Reset state betting/1xBet milik analisis sebelumnya — jangan sampai bocor ke match baru
    bettingReqId.current++; // batalkan request 1xBet yang masih in-flight
    setBettingResult(null);
    setBettingError(null);
    setManual1xBetId("");
    setShowManualInput(false);
    setShowMarkets(false);
    setActiveTab("ringkasan");

    window.scrollTo({ top: 0, behavior: "smooth" });

    // Batalkan run sebelumnya (kalau masih jalan) sebelum memulai yang baru.
    analysisAbort.current?.abort();
    const controller = new AbortController();
    analysisAbort.current = controller;

    try {
      const res = await fetch(
        `/api/agent?match_id=${encodeURIComponent(match.id)}&competition_id=${encodeURIComponent(
          match.competition_id
        )}`,
        { signal: controller.signal }
      );
      const json = await res.json();
      if (analysisReqId.current !== reqId) return; // stale response
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      // JSON adalah AnalysisView bersih dari BFF layer
      setData(json);
    } catch (e) {
      if (analysisReqId.current !== reqId) return;
      // Abort memang disengaja (user pindah match) — bukan error yang perlu ditampilkan.
      if (e instanceof DOMException && e.name === "AbortError") return;
      setAgentError(e instanceof Error ? e.message : String(e));
    } finally {
      if (analysisReqId.current === reqId) setAnalyzing(false);
    }
  }

  function handleBackToList() {
    analysisReqId.current++;
    bettingReqId.current++;
    // User keluar dari analisis → hentikan run di server, jangan biarkan jalan 8 menit.
    analysisAbort.current?.abort();
    analysisAbort.current = null;
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
    const reqId = ++bettingReqId.current;
    const match = selectedMatch;
    setBettingLoading(true);
    setBettingError(null);

    try {
      const res = await fetch("/api/betting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          match_id_1xbet: customId || (manual1xBetId.trim() ? manual1xBetId.trim() : undefined),
          home_team: match.home_team.name,
          away_team: match.away_team.name,
          competition: match.competition_name,
          match_context: {
            hasil_proyeksi: data?.ringkasan.prediksi,
            keyakinan: data?.ringkasan.keyakinan,
            alasan: data?.ringkasan.alasan,
            probabilitas_pasar: data?.odds.dislocation.pasar_konsensus,
            form_kandang: data?.kuantitatif.detail.splits.form_kandang,
            form_tamu: data?.kuantitatif.detail.splits.form_tamu,
            wasit: data?.match.wasit,
            wasit_kartu: data?.match.wasit_kartu,
            npxg_kandang: data?.kuantitatif.detail.splits.npxg_kandang,
            npxg_tamu: data?.kuantitatif.detail.splits.npxg_tamu,
          },
        }),
      });

      const json = await res.json();
      if (bettingReqId.current !== reqId) return; // hasil match lama, sudah diganti request baru
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
      if (bettingReqId.current !== reqId) return;
      setBettingError(e instanceof Error ? e.message : String(e));
    } finally {
      if (bettingReqId.current === reqId) setBettingLoading(false);
    }
  }

  return (
    <main className="min-h-svh bg-[#f5f5f5] text-[#0a0a0a] flex flex-col font-sans">
      {/* HEADER & TELEMETRY STRIP */}
      <header className="sticky top-0 z-40 w-full bg-[#ffffff]/95 backdrop-blur-md">
        {/* System Telemetry Bar */}
        <div className="bg-[#fafafa] py-1 px-4 sm:px-6">
          <div className="max-w-[1280px] mx-auto flex items-center text-[11px] font-mono tabular-nums text-[#525252] truncate">
            <span className="truncate">
              <strong className="text-[#737373]">{matches.length}</strong> laga ·{" "}
              <strong className="text-[#737373]">
                {activeLeagues.length > 0 ? activeLeagues.length : 7}
              </strong>{" "}
              liga · WIB (UTC+7)
            </span>
          </div>
        </div>

        {/* Command Navigation Row */}
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 h-12 flex items-center justify-between gap-3 text-xs font-mono">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="font-bold text-[#0a0a0a] tracking-tight text-xs truncate">
              BOLA-ARANDISUPERR Quant Terminal
            </span>
            <span className="text-[#e5e5e5] hidden sm:inline">/</span>
            <span className="text-[#737373] text-[11px] hidden sm:inline">
              Deterministic Intelligence v2.0
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[18px] text-[11px] bg-[#f5f5f5] border border-[#e5e5e5] text-[#171717] font-medium">
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
              <div className="p-6 rounded-[24px] bg-white border border-[#e5e5e5] space-y-4 font-mono">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#0a0a0a] animate-ping shrink-0" />
                    <div>
                      <h2 className="text-sm font-semibold text-[#0a0a0a]">
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

                <p className="text-[13px] text-[#737373] font-sans">
                  Analisis berjalan penuh di server — tipikal 2–7 menit, lebih lama bila debat sindikat masuk ronde 2.
                </p>

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
                    <p className="text-[13px] text-[#737373] mt-0.5 font-sans">{agentError}</p>
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
                      <div className="p-6 rounded-[24px] bg-white border border-[#e5e5e5] space-y-4 font-mono">
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
                          <div className="flex items-center gap-2">
                            <CheckCircleIcon size={16} className="text-[#0a0a0a]" />
                            <h3 className="font-bold text-xs sm:text-sm text-[#0a0a0a]">
                              Vonis Utama &amp; Konsensus Laga
                            </h3>
                          </div>
                          <span className="px-2.5 py-0.5 rounded-[18px] text-[11px] font-bold flat-tag-zinc">
                            Keyakinan: {data.ringkasan.keyakinan}
                          </span>
                        </div>

                        <div className="space-y-2">
                          <h2 className="text-xl sm:text-2xl font-bold text-[#0a0a0a] font-sans">
                            {data.ringkasan.verdict}
                          </h2>
                          <p className="text-[13px] text-[#171717] leading-relaxed font-sans">
                            {data.ringkasan.alasan}
                          </p>
                        </div>

                        {/* Checklist Faktor Kunci */}
                        {data.ringkasan.faktor_kunci.length > 0 && (
                          <div className="pt-1 space-y-2">
                            <span className="text-[11px] text-[#737373] block font-semibold">
                              Faktor Kunci Penentu Pertandingan:
                            </span>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {data.ringkasan.faktor_kunci.map((f, i) => (
                                <div
                                  key={i}
                                  className="flex items-start gap-2 p-2.5 rounded-[14px] bg-[#fafafa] border border-[#e5e5e5] text-xs text-[#171717]"
                                >
                                  <CheckCircleIcon size={13} className="text-[#0a0a0a] shrink-0 mt-0.5" />
                                  <span className="font-sans leading-relaxed text-[13px]">{f}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Section Thinking Planner Trace */}
                      <ThinkingPlannerCard thinking={data.thinking} />

                      {/* Pasar 1xBet on-demand: 1 klik, pindah tab + muat lazy */}
                      {!showMarkets && (
                        <button
                          onClick={() => {
                            setShowMarkets(true);
                            setActiveTab("odds");
                          }}
                          className="w-full p-3.5 rounded-[20px] bg-white border border-[#e5e5e5] text-xs font-semibold text-[#0a0a0a] hover:bg-[#fafafa] transition-colors cursor-pointer"
                        >
                          Buka Pemindaian Pasar 1xBet →
                        </button>
                      )}

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
                        impliedProb={data.odds.dislocation.pasar_konsensus}
                        quantData={{
                          dixon_coles: data.kuantitatif.detail.metode.dixon_coles,
                          vig_stripping: data.kuantitatif.detail.metode.shin_kelly,
                        }}
                        bettingResult={bettingResult}
                        homeTeam={data.match.home}
                        awayTeam={data.match.away}
                        onTriggerScan={() => trigger1xBetAnalysis()}
                        bettingLoading={bettingLoading}
                      />

                      {showMarkets ? (
                        <>
                          <OneXBetDeepMarketsCard
                            homeTeam={data.match.home}
                            awayTeam={data.match.away}
                            competition={data.match.competition}
                            quantData={{ dixon_coles: data.kuantitatif.detail.metode.dixon_coles }}
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
                        </>
                      ) : (
                        <button
                          onClick={() => setShowMarkets(true)}
                          className="w-full p-4 rounded-[20px] bg-white border border-[#e5e5e5] text-xs font-semibold text-[#0a0a0a] hover:bg-[#fafafa] transition-colors cursor-pointer"
                        >
                          Buka Pemindaian Pasar 1xBet (butuh scan manual) →
                        </button>
                      )}
                    </div>
                  )}

                  {/* TAB 4: SIDANG SINDIKAT */}
                  {activeTab === "debat" && (
                    <div className="space-y-5">
                      <SyndicateDebateCard debat={data.debat} />
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
