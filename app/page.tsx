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
import type { AnalysisTabKey } from "@/components/dashboard/SidebarNav";
import dynamic from "next/dynamic";

// Fallback ringan saat chunk lazy belum tiba (dynamic ssr:false di bawah).
function ChunkFallback() {
  return (
    <div
      className="p-5 rounded-[18px] bg-[#14141f] border border-[#262636] animate-pulse space-y-3"
      aria-hidden="true"
    >
      <div className="h-4 bg-[#1b1b29] rounded w-1/3" />
      <div className="h-3 bg-[#1b1b29] rounded w-2/3" />
    </div>
  );
}

// Pasar 1xBet/Scanner = on-demand (butuh scan manual) → lazy, bukan masuk bundle awal.
const OneXBetDeepMarketsCard = dynamic(
  () => import("@/components/dashboard/OneXBetDeepMarketsCard").then((m) => m.OneXBetDeepMarketsCard),
  { ssr: false, loading: () => <ChunkFallback /> }
);
const BettingScannerCard = dynamic(
  () => import("@/components/dashboard/BettingScannerCard").then((m) => m.BettingScannerCard),
  { ssr: false, loading: () => <ChunkFallback /> }
);

// Kartu-kartu analisis cuma dipakai SETELAH match dipilih, tapi sebelumnya diimpor eager
// sehingga ikut di-parse/eksekusi saat hidrasi layar katalog. Code-split ini menghemat
// ~11 KB on-wire (194→183 KB — lihat PERF.md); klaim lama soal penurunan LCP/render delay
// DIGUGURKAN pengukuran (mobile 2459→2487 ms = noise). Semua di sini tidak terjangkau pada
// paint pertama, jadi dipisah dari bundle awal mengikuti pola OneXBet di atas.
const MatchHeaderCard = dynamic(
  () => import("@/components/dashboard/MatchHeaderCard").then((m) => m.MatchHeaderCard),
  { ssr: false, loading: () => <ChunkFallback /> }
);
const SidebarNav = dynamic(
  () => import("@/components/dashboard/SidebarNav").then((m) => m.SidebarNav),
  { ssr: false, loading: () => <ChunkFallback /> }
);
const ThinkingPlannerCard = dynamic(
  () => import("@/components/dashboard/ThinkingPlannerCard").then((m) => m.ThinkingPlannerCard),
  { ssr: false, loading: () => <ChunkFallback /> }
);
const DataIntegrityShield = dynamic(
  () => import("@/components/dashboard/DataIntegrityShield").then((m) => m.DataIntegrityShield),
  { ssr: false, loading: () => <ChunkFallback /> }
);
const StatsAndSplitsCard = dynamic(
  () => import("@/components/dashboard/StatsAndSplitsCard").then((m) => m.StatsAndSplitsCard),
  { ssr: false, loading: () => <ChunkFallback /> }
);
const QuantEngineCard = dynamic(
  () => import("@/components/dashboard/QuantEngineCard").then((m) => m.QuantEngineCard),
  { ssr: false, loading: () => <ChunkFallback /> }
);
const TheStatsOddsComparisonCard = dynamic(
  () => import("@/components/dashboard/TheStatsOddsComparisonCard").then((m) => m.TheStatsOddsComparisonCard),
  { ssr: false, loading: () => <ChunkFallback /> }
);
const OddsDislocationBar = dynamic(
  () => import("@/components/dashboard/OddsDislocationBar").then((m) => m.OddsDislocationBar),
  { ssr: false, loading: () => <ChunkFallback /> }
);
const SyndicateDebateCard = dynamic(
  () => import("@/components/dashboard/SyndicateDebateCard").then((m) => m.SyndicateDebateCard),
  { ssr: false, loading: () => <ChunkFallback /> }
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
  const [catalogOffline, setCatalogOffline] = useState<boolean>(false);
  const [catalogMaxUtc, setCatalogMaxUtc] = useState<string | null>(null);

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
    }, 1000);
    return () => clearInterval(timer);
  }, [analyzing]);

  // Focus management: hasil siap → fokus ke vonis; kembali → fokus ke judul katalog
  // (di handleBackToList). preventScroll: posisi sudah di atas via scrollTo.
  useEffect(() => {
    if (data && !analyzing) {
      document.getElementById("vonis-utama")?.focus({ preventScroll: true });
    }
  }, [data, analyzing]);

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
      setCatalogOffline(json.offline === true);
      setCatalogMaxUtc(typeof json.catalog_max_utc === "string" ? json.catalog_max_utc : null);
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

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });

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
    window.setTimeout(() => {
      document.getElementById("katalog-judul")?.focus({ preventScroll: true });
    }, 0);
  }

  async function trigger1xBetAnalysis(customId?: string) {    if (!selectedMatch) return;
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
    <main id="konten-utama" className="min-h-svh bg-[#0a0a12] text-[#f4f4f6] flex flex-col font-sans">
      {/* HEADER 1 BARIS */}
      <header className="sticky top-0 z-40 w-full bg-[#0a0a12]/95 backdrop-blur-md border-b border-[#262636]">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="font-bold text-[#f4f4f6] tracking-tight text-sm truncate">
              MENCARI UANG DARI PARLAY
            </span>
            <span className="text-[#a2a2b5] text-[11px] hidden md:inline">
              Quant Terminal v2.0
            </span>
          </div>

          <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] bg-[#1b1b29] border border-[#262636] text-[#e8e8ef] font-medium shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-[#b8b0ff]" />
            {catalogOffline ? "Mode Offline — Data Lokal" : "Katalog Lokal"}
          </span>
        </div>
      </header>

      {/* WORKSPACE MAIN CONTAINER */}
      <div className="max-w-[1280px] mx-auto w-full px-4 sm:px-6 py-6 space-y-5 flex-1">
        {/* TAMPILAN 1: KATALOG PERTANDINGAN */}
        {!selectedMatch && (
          <div className="flex gap-5 items-start">
            {/* SIDEBAR LIGA (desktop) */}
            <aside className="hidden lg:block w-60 shrink-0 rounded-[18px] bg-[#14141f] border border-[#262636] p-4 space-y-1 sticky top-[76px]">
              <p className="text-xs font-semibold text-[#f4f4f6] px-2 pb-2">Liga</p>
              <button
                onClick={() => setSelectedCompetitionId("ALL")}
                aria-pressed={selectedCompetitionId === "ALL"}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-[12px] text-xs cursor-pointer transition-colors ${selectedCompetitionId === "ALL" ? "bg-[#b8b0ff] text-[#17131f] font-semibold" : "text-[#e8e8ef] hover:bg-[#1b1b29]"}`}
              >
                Semua Liga
                <span className="tabular-nums">{matches.length}</span>
              </button>
              {activeLeagues.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setSelectedCompetitionId(l.id)}
                  aria-pressed={selectedCompetitionId === l.id}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-[12px] text-xs cursor-pointer transition-colors ${selectedCompetitionId === l.id ? "bg-[#b8b0ff] text-[#17131f] font-semibold" : "text-[#e8e8ef] hover:bg-[#1b1b29]"}`}
                >
                  <span className="truncate text-left">{l.name}</span>
                  <span className="tabular-nums shrink-0">{l.count}</span>
                </button>
              ))}
              <p className="text-[11px] text-[#a2a2b5] px-2 pt-3 tabular-nums">
                {matches.length} laga · {activeLeagues.length} liga · WIB (UTC+7)
              </p>
            </aside>

            <div className="flex-1 min-w-0 space-y-5">
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
              offline={catalogOffline}
              catalogMaxUtc={catalogMaxUtc}
            />
            </div>
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
              <div role="status" aria-live="polite" className="p-6 rounded-[18px] bg-[#14141f] border border-[#262636] space-y-4 font-sans">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#b8b0ff] animate-ping shrink-0" />
                    <div>
                      <h2 className="text-sm font-semibold text-[#f4f4f6]">
                        Menganalisis Data Pertandingan...
                      </h2>
                      <p className="text-xs text-[#a2a2b5] mt-0.5">
                        {selectedMatch.home_team.name} vs {selectedMatch.away_team.name}
                      </p>
                    </div>
                  </div>
                  <span className="px-3 py-1 rounded-[18px] text-xs font-bold bg-[#1b1b29] border border-[#262636] text-[#f4f4f6] tabular-nums">
                    {Math.floor(elapsedMs / 1000)}s
                  </span>
                </div>

                <div className="mono-loading-bar-container">
                  <div className="mono-loading-bar" />
                </div>

                <p className="text-[13px] text-[#a2a2b5] font-sans">
                  Analisis berjalan penuh di server — tipikal 2–7 menit, lebih lama bila debat sindikat masuk ronde 2.
                </p>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#a2a2b5] pt-1">
                  <span>Pipeline: Ingestion &rarr; Quant Bivariate &rarr; Adversarial Debate &rarr; Verdict</span>
                  <button
                    onClick={handleBackToList}
                    className="px-3 py-1.5 rounded-full bg-[#1b1b29] border border-[#262636] text-[#f4f4f6] font-semibold hover:border-[#b8b0ff] transition-colors cursor-pointer"
                  >
                    Batalkan Analisis
                  </button>
                </div>
              </div>
            )}

            {/* ERROR STATE */}
            {agentError && (
              <div role="alert" className="p-5 rounded-[18px] border border-[#fb4d5e]/20 bg-[#fb4d5e]/5 text-[#f4f4f6] text-xs">
                <div className="flex items-start gap-2.5">
                  <AlertCircleIcon size={16} className="shrink-0 mt-0.5 text-[#fb4d5e]" />
                  <div>
                    <h3 className="font-semibold text-xs text-[#fb4d5e]">
                      Gagal Menjalankan Analisis Laga
                    </h3>
                    <p className="text-[13px] text-[#a2a2b5] mt-0.5 font-sans">{agentError}</p>
                    <button
                      onClick={() => runAnalysis(selectedMatch)}
                      className="mt-2.5 px-3 py-1.5 rounded-[18px] bg-[#b8b0ff] hover:bg-[#cdc6ff] text-[#17131f] text-xs font-medium transition-colors cursor-pointer"
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
                    <div role="tabpanel" id="panel-ringkasan" aria-labelledby="tab-ringkasan" tabIndex={0} className="space-y-5">
                      {/* Alasan & faktor kunci (vonis sudah menyatu di header) */}
                      <div className="p-6 rounded-[18px] bg-[#14141f] border border-[#262636] space-y-4 font-sans">
                        <div className="flex items-center gap-2">
                          <CheckCircleIcon size={16} className="text-[#f4f4f6]" />
                          <h3 className="font-bold text-xs sm:text-sm text-[#f4f4f6]">
                            Alasan &amp; Faktor Kunci
                          </h3>
                        </div>

                        <p className="text-[13px] text-[#e8e8ef] leading-relaxed font-sans">
                          {data.ringkasan.alasan}
                        </p>

                        {/* Checklist Faktor Kunci */}
                        {data.ringkasan.faktor_kunci.length > 0 && (
                          <div className="pt-1 space-y-2">
                            <span className="text-[11px] text-[#a2a2b5] block font-semibold">
                              Faktor Kunci Penentu Pertandingan:
                            </span>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {data.ringkasan.faktor_kunci.map((f, i) => (
                                <div
                                  key={i}
                                  className="flex items-start gap-2 p-2.5 rounded-[14px] bg-[#1b1b29] border border-[#262636] text-xs text-[#e8e8ef]"
                                >
                                  <CheckCircleIcon size={13} className="text-[#f4f4f6] shrink-0 mt-0.5" />
                                  <span className="font-sans leading-relaxed text-[13px]">{f}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Pick #1 — satu-satunya panel accent; jujur bila tidak ada +EV */}
                      {data.kuantitatif.hero.ev_teratas ? (
                        <div className="p-5 rounded-[18px] bg-[#b8b0ff] text-[#17131f] space-y-1.5 font-sans">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-extrabold tracking-wide">
                              PICK #1 · EDGE TERATAS MODEL
                            </span>
                            <span className="text-[11px] font-bold tabular-nums">
                              {data.kuantitatif.hero.ev_teratas.ev_percentage} EV
                            </span>
                          </div>
                          <p className="text-xl sm:text-2xl font-bold leading-tight">
                            {data.kuantitatif.hero.ev_teratas.selection}
                          </p>
                          <p className="text-xs font-medium tabular-nums">
                            {data.kuantitatif.hero.ev_teratas.market} · Odds{" "}
                            {data.kuantitatif.hero.ev_teratas.odds.toFixed(2)} · Fair{" "}
                            {data.kuantitatif.hero.ev_teratas.fair_odds.toFixed(2)}
                          </p>
                        </div>
                      ) : (
                        <div className="px-4 py-3 rounded-[18px] bg-[#14141f] border border-[#262636] text-xs text-[#a2a2b5] font-sans">
                          Tidak ada +EV pada laga ini — rekomendasi: No Bet / Pass.
                        </div>
                      )}

                      {/* Section Thinking Planner Trace */}
                      <ThinkingPlannerCard thinking={data.thinking} />

                      {/* Pasar 1xBet on-demand: 1 klik, pindah tab + muat lazy */}
                      {!showMarkets && (
                        <button
                          onClick={() => {
                            setShowMarkets(true);
                            setActiveTab("odds");
                          }}
                          className="w-full p-3.5 rounded-[20px] bg-[#14141f] border border-[#262636] text-xs font-semibold text-[#f4f4f6] hover:bg-[#1b1b29] transition-colors cursor-pointer"
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
                    <div role="tabpanel" id="panel-kuantitatif" aria-labelledby="tab-kuantitatif" tabIndex={0} className="space-y-5">
                      <QuantEngineCard
                        kuantitatif={data.kuantitatif}
                        homeTeam={data.match.home}
                        awayTeam={data.match.away}
                      />
                    </div>
                  )}

                  {/* TAB 3: BURSA & DISLOKASI */}
                  {activeTab === "odds" && (
                    <div role="tabpanel" id="panel-odds" aria-labelledby="tab-odds" tabIndex={0} className="space-y-5">
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
                          className="w-full p-4 rounded-[20px] bg-[#14141f] border border-[#262636] text-xs font-semibold text-[#f4f4f6] hover:bg-[#1b1b29] transition-colors cursor-pointer"
                        >
                          Buka Pemindaian Pasar 1xBet (butuh scan manual) →
                        </button>
                      )}
                    </div>
                  )}

                  {/* TAB 4: SIDANG SINDIKAT */}
                  {activeTab === "debat" && (
                    <div role="tabpanel" id="panel-debat" aria-labelledby="tab-debat" tabIndex={0} className="space-y-5">
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
