/**
 * E2E RUN 1 — satu analisis kuant end-to-end di backend pasca-overhaul.
 *
 * Tujuan: uji nyata jalur analisis (offline murni) untuk SATU fixture:
 *   seleksi fixture → fetchAndValidateMatchIntelligence (jalur offline)
 *   → buildQuantPackage (planner 🔒, dipanggil apa adanya)
 *   → buildQuantPackageWithSportmonks dengan detail SM yang direkonstruksi
 *     OFFLINE dari payload odds tersimpan di match_odds_history
 *     (BUKAN fetchSportmonksDetailIfMapped — fungsi itu memanggil API live;
 *      run ini dilarang memanggil API sama sekali).
 *
 * Dijalankan TANPA STATS_API_KEY di env → semua upaya live TheStatsAPI
 * gagal seketika di klien (throw sebelum fetch) → jalur offline melayani
 * semuanya. Nol panggilan jaringan, nol tulis ke analysis_snapshots.db,
 * nol modifikasi file 🔒.
 *
 * Output: paket JSON lengkap ke tasks/e2e-run-1-package.json + trace
 * tahap-demi-tahap (termasuk semua null/fallback/default yang menyala)
 * ke stdout dan ke key `trace` di JSON.
 *
 * Pakai: npx tsx scripts/run-one-analysis.ts
 */
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fetchAndValidateMatchIntelligence } from "../lib/stats-fetcher-agent";
import { buildQuantPackage, buildQuantPackageWithSportmonks } from "../lib/agent/planner";
import {
  loadCalibratedRatings,
  resolveDivForMatch,
  findTeamRating,
} from "../lib/quant/ratings-loader";
import { normalizeTeamName } from "../lib/quant/team-normalizer";
import { getLeagueGate } from "../lib/quant/league-gate";
import { getUpcomingDb } from "../lib/db/upcoming-fixtures";
import { parseFixtureDetail } from "../lib/odds/sportmonks-adapter";
import { pickSmQuotes } from "../lib/odds/sportmonks-wire";
import { stripVigShin } from "../lib/quant/vig-stripping";
import { dbPath } from "../lib/db/paths";

// ---------------------------------------------------------------------------
// Fixture terpilih (hasil scan katalog 4 Nov 2026 ~11:08 WIB, jendela 72 jam):
// Everton vs Coventry City — Premier League (sm:8, calibrated), kickoff
// 2026-11-06T20:00:00Z (Sabtu 7 Nov 03:00 WIB). Bukti seleksi dihitung ulang
// secara live di Tahap 0 di bawah.
// ---------------------------------------------------------------------------
const MATCH_ID = "sm_19722110";
const COMPETITION_ID = "sm:8";
const FIXTURE_SM_ID = 19722110;
const TODAY = new Date().toISOString().slice(0, 10); // sama seperti createRunState planner

type TraceEntry = {
  stage: string;
  inputs?: unknown;
  outputs?: unknown;
  fallbacks: string[];
  error?: string;
};
const trace: TraceEntry[] = [];
function log(stage: string, msg: string) {
  console.log(`[${stage}] ${msg}`);
}

/** Ringkas nilai untuk JSON: array panjang dipotong dengan catatan jujur. */
function cap(v: unknown, depth = 0): unknown {
  if (Array.isArray(v)) {
    if (v.length > 24) {
      return {
        _array_length: v.length,
        _first_24: v.slice(0, 24).map((x) => cap(x, depth + 1)),
        _note: "dipotong untuk ringkasan — bukan data hilang",
      };
    }
    return v.map((x) => cap(x, depth + 1));
  }
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = depth > 6 ? (Array.isArray(val) ? `[array ${val.length}]` : val) : cap(val, depth + 1);
    }
    return out;
  }
  if (typeof v === "string" && v.length > 400) return v.slice(0, 400) + "…[dipotong]";
  return v;
}

function openRo(path: string): DatabaseSync {
  return new DatabaseSync(path, { readOnly: true });
}

async function main() {
  const pkg: Record<string, unknown> = {
    meta: {
      run: "e2e-run-1",
      generated_at: new Date().toISOString(),
      today_cutoff: TODAY,
      match_id: MATCH_ID,
      competition_id: COMPETITION_ID,
      offline_only: true,
      notes: [
        "Detail SM untuk jalur wire direkonstruksi offline dari payload odds tersimpan (match_odds_history, tangkapan baseline) via parseFixtureDetail — fungsi fetch live planner (fetchSportmonksDetailIfMapped) sengaja TIDAK dipanggil.",
        "Env tanpa STATS_API_KEY → klien TheStatsAPI throw sebelum fetch; intel dilayani jalur offline SQLite.",
      ],
    },
  };

  // =========================================================================
  // TAHAP 0 — bukti seleksi fixture (dihitung ulang live)
  // =========================================================================
  const selFallbacks: string[] = [];
  const upDb = getUpcomingDb();
  const fixture = upDb
    .prepare(
      "SELECT match_id, competition_id, competition_name, competition_country, utc_date, status, home_team_id, home_team_name, away_team_id, away_team_name, venue FROM upcoming_fixtures WHERE match_id = ?"
    )
    .get(MATCH_ID) as Record<string, unknown> | undefined;
  if (!fixture) throw new Error(`fixture ${MATCH_ID} tidak ditemukan di upcoming_fixtures`);

  const dsDb = openRo(dbPath("thestats_dataset.db"));
  const registry = dsDb
    .prepare("SELECT * FROM league_calibration WHERE league_id = ?")
    .get(COMPETITION_ID) as Record<string, unknown> | undefined;

  const ratings = loadCalibratedRatings();
  if (!ratings) throw new Error("calibrated_ratings.json tidak terbaca");
  const div = resolveDivForMatch(
    ratings,
    String(fixture.competition_name),
    String(fixture.home_team_name),
    String(fixture.away_team_name)
  );
  const homeRating = div ? findTeamRating(ratings, div, normalizeTeamName(String(fixture.home_team_name))) : null;
  const awayRating = div ? findTeamRating(ratings, div, normalizeTeamName(String(fixture.away_team_name))) : null;
  const gate = div ? getLeagueGate(div) : null;

  const oddsRows = dsDb
    .prepare(
      "SELECT captured_utc, has_odds, source, capture_kind, length(payload_json) AS bytes FROM match_odds_history WHERE match_id = ? ORDER BY captured_utc DESC"
    )
    .all(MATCH_ID) as Record<string, unknown>[];

  const prDb = openRo(dbPath("predictions.db"));
  const predCount = prDb
    .prepare("SELECT COUNT(*) AS n FROM sm_predictions WHERE fixture_sm_id = ?")
    .get(FIXTURE_SM_ID) as { n: number };

  const selection = {
    fixture,
    kickoff_local_wib: "2026-11-07T03:00:00+07:00 (dari utc_date 2026-11-06T20:00:00.000Z)",
    registry_row: registry ?? null,
    resolved_div: div,
    gate: gate ? { status: gate.status, reason: gate.reason } : null,
    home_rating_found: !!homeRating,
    away_rating_found: !!awayRating,
    home_rating: homeRating,
    away_rating: awayRating,
    odds_rows: oddsRows,
    predictions_rows: predCount.n,
  };
  pkg.selection = selection;
  if (registry?.status !== "calibrated") selFallbacks.push(`registry status = ${String(registry?.status)} (bukan calibrated)`);
  if (!div) selFallbacks.push("resolveDivForMatch mengembalikan null");
  if (!homeRating) selFallbacks.push("tim kandang TIDAK ditemukan di ratings divisi ter-resolve");
  if (!awayRating) selFallbacks.push("tim tamu TIDAK ditemukan di ratings divisi ter-resolve");
  if (oddsRows.length === 0) selFallbacks.push("tidak ada baris odds tertangkap");
  if (predCount.n === 0) selFallbacks.push("tidak ada baris predictions");
  trace.push({ stage: "0-seleksi", outputs: selection, fallbacks: selFallbacks });
  log("0-seleksi", `div=${div} gate=${gate?.status} homeRating=${!!homeRating} awayRating=${!!awayRating} oddsRows=${oddsRows.length} predRows=${predCount.n}`);

  // =========================================================================
  // TAHAP 1 — intelligence (jalur offline planner)
  // =========================================================================
  let intel: Awaited<ReturnType<typeof fetchAndValidateMatchIntelligence>>["intelligence"] | null = null;
  let audit: Awaited<ReturnType<typeof fetchAndValidateMatchIntelligence>>["audit"] | null = null;
  try {
    const fetched = await fetchAndValidateMatchIntelligence(MATCH_ID, COMPETITION_ID);
    intel = fetched.intelligence;
    audit = fetched.audit;
    const fb: string[] = [];
    if (!intel.market_odds || intel.market_odds.home_last == null) fb.push("market_odds 1X2 lokal = null (payload anchor berbentuk SM tidak ter-parse validator TheStats — sesuai flow map §3#7)");
    if (!intel.lineups?.is_available) fb.push("lineups lokal tidak tersedia (missing registry)");
    if (!intel.injuries?.is_available) fb.push("injuries lokal tidak tersedia");
    if ((intel.missing_data_registry ?? []).length > 0) fb.push(`missing_data_registry: ${(intel.missing_data_registry ?? []).join(" | ")}`);
    if (intel.form_split?.home_form_sample_size === 0) fb.push("form_split kandang sample 0");
    if (intel.form_split?.away_form_sample_size === 0) fb.push("form_split tamu sample 0");
    trace.push({
      stage: "1-intelligence",
      inputs: { matchId: MATCH_ID, competitionIdHint: COMPETITION_ID },
      outputs: {
        pertandingan: intel.pertandingan,
        market_odds: intel.market_odds,
        form_split: intel.form_split,
        audit_endpoints_called: audit.endpoints_called,
        audit_endpoints_skipped: audit.endpoints_skipped,
        audit_dispatcher_model: audit.dispatcher_model,
      },
      fallbacks: fb,
    });
    pkg.intel = cap(intel);
    pkg.fetch_audit = audit;
    log("1-intelligence", `kompetisi="${intel.pertandingan.kompetisi}" home_last=${intel.market_odds?.home_last ?? "null"} formH=${intel.form_split?.home_form_sample_size} formA=${intel.form_split?.away_form_sample_size}`);
  } catch (e) {
    trace.push({ stage: "1-intelligence", fallbacks: [], error: e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e) });
    log("1-intelligence", `THROW: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }

  // =========================================================================
  // TAHAP 2 — quant package murni (persis panggilan tool planner)
  // =========================================================================
  const pure = buildQuantPackage(intel, TODAY);
  {
    const fb: string[] = [];
    const md = pure.shrunkParams.metadata;
    if (pure.vigOutput === null) fb.push("vig_stripping = null (tidak ada odds pasar lokal yang valid → model-only, sesuai desain)");
    if (pure.quantPackage.value_bets.length === 0) fb.push("value_bets lokal = 0 (konsekuensi odds lokal null — bukan odds karangan)");
    if (md?.homeSource !== "primary_league") fb.push(`homeSource = ${md?.homeSource}`);
    if (md?.awaySource !== "primary_league") fb.push(`awaySource = ${md?.awaySource}`);
    if ((md?.observedXgSamples?.home ?? 0) < 3) fb.push(`sampel xG kandang = ${md?.observedXgSamples?.home} (<3 → blend memakai gol)`);
    if ((md?.observedXgSamples?.away ?? 0) < 3) fb.push(`sampel xG tamu = ${md?.observedXgSamples?.away} (<3 → blend memakai gol)`);
    if (pure.homeTelem.sample_size === 0) fb.push("telemetri kandang sample_size 0");
    if (pure.awayTelem.sample_size === 0) fb.push("telemetri tamu sample_size 0");
    if (pure.quantPackage.special_markets === null) fb.push("special_markets = null (telemetri kedua tim 0)");
    trace.push({
      stage: "2-quant-murni",
      inputs: { today: TODAY },
      outputs: {
        lambda: pure.dcOutput.lambda,
        mu: pure.dcOutput.mu,
        probs: { home: pure.dcOutput.prob_home_win, draw: pure.dcOutput.prob_draw, away: pure.dcOutput.prob_away_win },
        shrunk_params: pure.shrunkParams,
        calibration_metadata: pure.quantPackage.calibration_metadata,
        gate: { status: md?.calibrationStatus ?? null, reason: md?.calibrationGate ?? null },
        value_bets: pure.quantPackage.value_bets.length,
        vig: pure.quantPackage.vig_stripping,
      },
      fallbacks: fb,
    });
    pkg.quant_pure = {
      quant_package: pure.quantPackage,
      shrunk_params: pure.shrunkParams,
      market_anchor_local: { home_last: pure.hLast, draw_last: pure.dLast, away_last: pure.aLast },
    };
    log("2-quant-murni", `λ=${pure.dcOutput.lambda} μ=${pure.dcOutput.mu} P(H/D/A)=${pure.dcOutput.prob_home_win}/${pure.dcOutput.prob_draw}/${pure.dcOutput.prob_away_win} gate=${md?.calibrationStatus} valueBets=${pure.quantPackage.value_bets.length}`);
  }

  // =========================================================================
  // TAHAP 3 — jalur wire Sportmonks, detail direkonstruksi OFFLINE
  // =========================================================================
  const newest = dsDb
    .prepare("SELECT captured_utc, capture_kind, source, payload_json FROM match_odds_history WHERE match_id = ? ORDER BY captured_utc DESC LIMIT 1")
    .get(MATCH_ID) as { captured_utc: string; capture_kind: string; source: string; payload_json: string };
  const envelope = JSON.parse(newest.payload_json) as { odds?: unknown[]; point?: string; late_entry?: boolean };
  let detail: ReturnType<typeof parseFixtureDetail> | null = null;
  let detailError: string | null = null;
  try {
    detail = parseFixtureDetail(FIXTURE_SM_ID, { data: { odds: envelope.odds ?? [] } });
  } catch (e) {
    detailError = e instanceof Error ? e.message : String(e);
  }
  let wired: ReturnType<typeof buildQuantPackageWithSportmonks> | null = null;
  let quotes: ReturnType<typeof pickSmQuotes> = null;
  let shin: ReturnType<typeof stripVigShin> | null = null;
  let shinError: string | null = null;
  if (detail) {
    quotes = pickSmQuotes(detail, newest.captured_utc);
    if (quotes && quotes.home_last && quotes.draw_last && quotes.away_last) {
      try {
        shin = stripVigShin(quotes.home_last, quotes.draw_last, quotes.away_last);
      } catch (e) {
        shinError = e instanceof Error ? e.message : String(e);
      }
    }
    wired = buildQuantPackageWithSportmonks(intel, TODAY, detail, { fetchedAt: newest.captured_utc });
  }
  {
    const fb: string[] = [];
    if (detailError) fb.push(`parseFixtureDetail THROW: ${detailError}`);
    if (detail) {
      if (detail.lineup_home === null && detail.lineup_away === null) fb.push("detail.lineup = null (payload odds lokal tidak memuat lineup — gap lineup TIDAK ditutup wire offline; lineup resmi ada di store expected_lineups, lihat context)");
      if (detail.predictions.length === 0) fb.push("detail.predictions kosong (payload odds tidak memuat prediksi — panel banding diambil dari predictions.db di context, bukan dari wire)");
      if (detail.sidelined.length === 0) fb.push("detail.sidelined kosong — gap cedera tidak ditutup wire offline");
      if (detail.skipped.length > 0) fb.push(`parseFixtureDetail skipped ${detail.skipped.length} entri (contoh: ${detail.skipped.slice(0, 3).join(" ; ")})`);
    }
    if (!quotes) fb.push("pickSmQuotes = null (tidak ada quote bookmaker utama/pembanding yang lengkap)");
    if (shinError) fb.push(`stripVigShin pada quote SM THROW: ${shinError}`);
    if (wired && wired.bundle.quantPackage.value_bets.length === 0) fb.push("value_bets gabungan (lokal+SM) = 0 — tidak ada sisi yang lolos evaluasi Kelly/edge");
    trace.push({
      stage: "3-wire-sportmonks-offline",
      inputs: {
        payload_captured_utc: newest.captured_utc,
        payload_capture_kind: newest.capture_kind,
        payload_point: envelope.point ?? null,
        payload_late_entry: envelope.late_entry ?? null,
        odds_entries: Array.isArray(envelope.odds) ? envelope.odds.length : 0,
      },
      outputs: {
        detail_odds_1x2: detail?.odds_1x2 ?? null,
        detail_odds_ou_2_5: (detail?.odds_ou ?? []).filter((l) => l.line === "2.5"),
        quotes,
        shin_implied_from_sm_primary: shin,
        wired_status: wired?.smStatus ?? null,
        wired_reason: wired?.smReason ?? null,
        wired_value_bets: wired?.bundle.quantPackage.value_bets ?? null,
        sm_context: wired?.bundle.quantPackage.sm_context ?? null,
      },
      fallbacks: fb,
      error: detailError ?? undefined,
    });
    pkg.quant_wired = wired
      ? {
          quant_package: wired.bundle.quantPackage,
          intel_merged_market_odds: (wired.intel.market_odds as unknown) ?? null,
          sm_status: wired.smStatus,
          sm_reason: wired.smReason,
        }
      : null;
    pkg.market_anchor_sm = {
      captured_utc: newest.captured_utc,
      capture_kind: newest.capture_kind,
      source: newest.source,
      quotes_primary_and_compare: quotes,
      shin_stripped: shin,
    };
    log("3-wire", `status=${wired?.smStatus} quotes=${quotes ? `${quotes.bookmaker} ${quotes.home_last}/${quotes.draw_last}/${quotes.away_last}` : "null"} valueBetsGabungan=${wired?.bundle.quantPackage.value_bets.length ?? "-"}`);
  }

  // =========================================================================
  // TAHAP 4 — context untuk lapisan verdict parent (semua dari store lokal)
  // =========================================================================
  const predRows = prDb
    .prepare("SELECT market, outcome, probability, predictability FROM sm_predictions WHERE fixture_sm_id = ? ORDER BY market, outcome")
    .all(FIXTURE_SM_ID) as Record<string, unknown>[];
  const smValueBets = prDb
    .prepare("SELECT market, outcome, bookmaker, odds, fair_odds, value_pct, captured_utc FROM sm_value_bets WHERE fixture_sm_id = ?")
    .all(FIXTURE_SM_ID) as Record<string, unknown>[];
  const predictability = prDb
    .prepare("SELECT market, score FROM sm_predictability WHERE league_id = 8 AND (market LIKE 'Model Predictability:%' OR market LIKE 'Model Hit Ratio:%') AND (market LIKE '%fulltime_result%' OR market LIKE '%over_under_2_5%' OR market LIKE '%both_teams_to_score%') ORDER BY market")
    .all() as Record<string, unknown>[];

  const homeTeamId = String(fixture.home_team_id);
  const awayTeamId = String(fixture.away_team_id);
  const standings = dsDb
    .prepare("SELECT team_id, position, points FROM standings WHERE league_id = ? AND team_id IN (?, ?) ORDER BY position")
    .all(COMPETITION_ID, homeTeamId, awayTeamId) as Record<string, unknown>[];

  const lineupRows = dsDb
    .prepare("SELECT side, payload_json, fetched_utc FROM expected_lineups WHERE fixture_sm_id = ?")
    .all(FIXTURE_SM_ID) as { side: string; payload_json: string; fetched_utc: string }[];
  const lineups = lineupRows.map((r) => {
    const players = JSON.parse(r.payload_json) as { player_name?: string; jersey_number?: number; formation_field?: string }[];
    return {
      side: r.side,
      fetched_utc: r.fetched_utc,
      players_count: Array.isArray(players) ? players.length : 0,
      players: Array.isArray(players) ? players.map((p) => p.player_name) : [],
    };
  });

  const pairA = `${homeTeamId}_${awayTeamId}`;
  const pairB = `${awayTeamId}_${homeTeamId}`;
  const h2hRow =
    (dsDb.prepare("SELECT pair_key, payload_json, fetched_utc FROM h2h_cache WHERE pair_key = ?").get(pairA) as
      | { pair_key: string; payload_json: string; fetched_utc: string }
      | undefined) ??
    (dsDb.prepare("SELECT pair_key, payload_json, fetched_utc FROM h2h_cache WHERE pair_key = ?").get(pairB) as
      | { pair_key: string; payload_json: string; fetched_utc: string }
      | undefined);
  let h2h: unknown = null;
  if (h2hRow) {
    const arr = JSON.parse(h2hRow.payload_json) as Record<string, unknown>[];
    h2h = {
      pair_key: h2hRow.pair_key,
      fetched_utc: h2hRow.fetched_utc,
      meetings: Array.isArray(arr) ? arr.length : 0,
      recent: Array.isArray(arr)
        ? arr.slice(0, 5).map((m) => ({ name: m.name, starting_at: m.starting_at, result_info: m.result_info }))
        : [],
    };
  }

  const byMarket = new Map<string, Record<string, unknown>[]>();
  for (const r of predRows) {
    const m = String(r.market);
    if (!byMarket.has(m)) byMarket.set(m, []);
    byMarket.get(m)!.push(r);
  }
  const context = {
    predictions_db: {
      total_rows: predRows.length,
      fulltime_result: byMarket.get("Fulltime Result Probability") ?? [],
      over_under_2_5: byMarket.get("Over/Under 2.5 Probability") ?? [],
      btts: byMarket.get("Both Teams To Score Probability") ?? [],
      double_chance: byMarket.get("Double Chance Probability") ?? [],
      all_markets: Object.fromEntries(byMarket),
    },
    sm_value_bets_db: smValueBets,
    predictability_league_8: predictability,
    standings_both_teams: standings,
    expected_lineups: lineups,
    h2h,
    telemetry_last6: {
      home: { team: fixture.home_team_name, telemetry: cap(pure.homeTelem) },
      away: { team: fixture.away_team_name, telemetry: cap(pure.awayTelem) },
    },
  };
  pkg.context = context;
  trace.push({
    stage: "4-context",
    outputs: {
      predictions_rows: predRows.length,
      sm_value_bets_rows: smValueBets.length,
      standings_found: standings.length,
      lineups_sides: lineups.map((l) => `${l.side}:${l.players_count}`),
      h2h: h2h ? (h2h as { meetings: number }).meetings : null,
    },
    fallbacks: [
      ...(smValueBets.length === 0 ? ["sm_value_bets di predictions.db untuk fixture ini = 0 baris"] : []),
      ...(standings.length < 2 ? [`standings hanya ${standings.length}/2 tim ditemukan`] : []),
      ...(h2h === null ? [`h2h_cache tidak punya pasangan ${pairA}/${pairB}`] : []),
    ],
  });
  log("4-context", `pred=${predRows.length} smVB=${smValueBets.length} standings=${standings.length} lineups=${lineups.length} h2h=${h2h ? "ada" : "null"}`);

  pkg.trace = trace;
  writeFileSync("tasks/e2e-run-1-package.json", JSON.stringify(pkg, null, 2));
  log("SELESAI", "paket ditulis ke tasks/e2e-run-1-package.json");
}

main().catch((e) => {
  console.error("E2E RUN GAGAL:", e);
  // Tetap tulis trace parsial agar kegagalan bisa diaudit.
  try {
    writeFileSync(
      "tasks/e2e-run-1-package.json",
      JSON.stringify({ meta: { run: "e2e-run-1", failed: true }, trace, error: e instanceof Error ? e.message : String(e) }, null, 2)
    );
  } catch {
    /* abaikan */
  }
  process.exit(1);
});
