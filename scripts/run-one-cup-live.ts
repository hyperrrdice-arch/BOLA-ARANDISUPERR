/**
 * E2E PIALA LIVE — analisis kuant end-to-end untuk SATU fixture UCL yang
 * SUDAH DITENTUKAN: Fenerbahçe vs Liverpool (sm_19872622, kickoff
 * 2026-11-04T17:45:00Z). Perpanjangan minimal dari dua driver yang ada:
 *   - run-one-cup-analysis.ts → tahap quant murni lewat MODEL OFFSET GLOBAL
 *     (buildQuantPackage planner 🔒 apa adanya, metadata.cupOffset);
 *   - run-one-analysis.ts     → tahap wire Sportmonks OFFLINE (detail
 *     direkonstruksi dari payload tangkapan odds tersegar di
 *     match_odds_history — fungsi fetch live TIDAK dipanggil) + panel
 *     konteks lengkap (predictions.db, lineups, news, standings, telemetri).
 *
 * Offline murni: env dimuat dari .env.local HANYA agar impor planner tidak
 * throw di scope modul (NineRouter base URL), dengan STATS_API_KEY dan
 * SPORTMONKS_API_TOKEN dikosongkan paksa → nol panggilan API, nol tulis ke
 * analysis_snapshots.db, nol modifikasi file 🔒, nol commit.
 * Output: tasks/e2e-cup-package-live.json (TIDAK menimpa e2e-cup-package.json).
 *
 * Pakai: STATS_API_KEY= SPORTMONKS_API_TOKEN= NODE_OPTIONS="--env-file=.env.local" npx tsx scripts/run-one-cup-live.ts
 */
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fetchAndValidateMatchIntelligence } from "../lib/stats-fetcher-agent";
import { buildQuantPackage, buildQuantPackageWithSportmonks } from "../lib/agent/planner";
import {
  loadCalibratedRatings,
  getShrunkMatchParameters,
} from "../lib/quant/ratings-loader";
import { getLeagueGate } from "../lib/quant/league-gate";
import { getUpcomingDb } from "../lib/db/upcoming-fixtures";
import { parseFixtureDetail } from "../lib/odds/sportmonks-adapter";
import { pickSmQuotes } from "../lib/odds/sportmonks-wire";
import { stripVigShin } from "../lib/quant/vig-stripping";
import { dbPath } from "../lib/db/paths";

const MATCH_ID = "sm_19872622";
const COMPETITION_ID = "sm:2";
const FIXTURE_SM_ID = 19872622;
const LEAGUE_NUMERIC_ID = 2;
const TODAY = new Date().toISOString().slice(0, 10);
const OUTPUT = "tasks/e2e-cup-package-live.json";

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
  const runStartedUtc = new Date().toISOString();
  const pkg: Record<string, unknown> = {
    meta: {
      run: "e2e-cup-ucl-live",
      generated_at: runStartedUtc,
      today_cutoff: TODAY,
      match_id: MATCH_ID,
      competition_id: COMPETITION_ID,
      fixture_sm_id: FIXTURE_SM_ID,
      kickoff_utc: "2026-11-04T17:45:00Z",
      offline_only: true,
      model: "global-offset (fase kalibrasi piala): att*=att×e^δ, def*=def÷e^δ, basis globalAvg graf + cupHA graf",
      notes: [
        "Run LIVE pra-kickoff: daily-refresh cron sedang in-flight dan menulis bertahap ke store — tangkapan dibaca apa adanya pada waktu run ini; tidak menunggu cron, tidak mengulang run bila tangkapan baru mendarat di tengah.",
        "Status kompetisi sm:2 = partial (registry source='cup-offset', bukti OOS tasks/cup-oos.json) — tersaji ber-flag, bukan disembunyikan.",
        "sm_predictions.fixture_sm_id menyimpan id NUMERIK (19872622); bentuk ber-prefix 'sm_...' = 0 baris (diverifikasi pra-run). sm_predictability league_id = 2 (numerik). expected_lineups/prematch_news dikunci fixture_sm_id numerik yang sama.",
      ],
    },
  };

  // =========================================================================
  // TAHAP 0 — fixture, registry, inventaris tangkapan, bukti jalur offset
  // =========================================================================
  const upDb = getUpcomingDb();
  const fixture = upDb
    .prepare(
      "SELECT match_id, competition_id, competition_name, competition_country, utc_date, status, stage_name, home_team_id, home_team_name, away_team_id, away_team_name, venue, is_neutral, odds_available, xg_available, fetched_utc FROM upcoming_fixtures WHERE match_id = ?"
    )
    .get(MATCH_ID) as Record<string, unknown> | undefined;
  if (!fixture) throw new Error(`fixture ${MATCH_ID} tidak ditemukan di upcoming_fixtures`);

  const dsDb = openRo(dbPath("thestats_dataset.db"));
  const registry = dsDb
    .prepare("SELECT * FROM league_calibration WHERE league_id = ?")
    .get(COMPETITION_ID) as Record<string, unknown> | undefined;

  const captures = dsDb
    .prepare(
      "SELECT captured_utc, capture_kind, source, has_odds, length(payload_json) AS bytes FROM match_odds_history WHERE match_id = ? ORDER BY captured_utc ASC"
    )
    .all(MATCH_ID) as Record<string, unknown>[];

  const ratings = loadCalibratedRatings();
  if (!ratings) throw new Error("calibrated_ratings.json tidak terbaca");
  const params = getShrunkMatchParameters({
    leagueHint: COMPETITION_ID,
    homeTeam: String(fixture.home_team_name),
    awayTeam: String(fixture.away_team_name),
    isNeutralVenue: fixture.is_neutral === 1,
    matchDateCutoff: TODAY,
  });
  const cupMeta = params.metadata?.cupOffset ?? null;
  const homeGate = cupMeta ? getLeagueGate(cupMeta.homeLeagueCanonicalId) : null;
  const awayGate = cupMeta ? getLeagueGate(cupMeta.awayLeagueCanonicalId) : null;

  const fb0: string[] = [];
  if (!cupMeta) fb0.push("getShrunkMatchParameters TIDAK menghasilkan metadata.cupOffset untuk fixture ini (jalur offset tidak ter-resolve di tahap 0)");
  if (fixture.is_neutral == null) fb0.push("upcoming_fixtures.is_neutral = NULL → diperlakukan bukan venue netral (metadata.cupOffset.neutralVenue)");
  if (fixture.odds_available == null) fb0.push("upcoming_fixtures.odds_available = NULL (kolom katalog tidak terisi; tangkapan odds aktual tetap ada di match_odds_history)");
  if (registry?.status !== "partial") fb0.push(`registry sm:2 status = ${String(registry?.status)} (ekspektasi: partial)`);
  trace.push({
    stage: "0-seleksi-live",
    inputs: { matchId: MATCH_ID, competitionIdHint: COMPETITION_ID, run_started_utc: runStartedUtc },
    outputs: {
      fixture,
      kickoff_local_wib: "2026-11-05T00:45:00+07:00 (dari utc_date 2026-11-04T17:45:00.000Z)",
      registry_row: registry ?? null,
      cup_offset_metadata: cupMeta,
      home_domestic_gate: homeGate ? { league: cupMeta?.homeLeagueCanonicalId, status: homeGate.status, reason: homeGate.reason } : null,
      away_domestic_gate: awayGate ? { league: cupMeta?.awayLeagueCanonicalId, status: awayGate.status, reason: awayGate.reason } : null,
      odds_captures_inventory: captures,
    },
    fallbacks: fb0,
  });
  pkg.selection = trace[0].outputs;
  log("0-seleksi", `gate sm:2=${registry?.status} cupOffset=${cupMeta ? `${cupMeta.homeLeagueCanonicalId} δ=${cupMeta.homeDelta} vs ${cupMeta.awayLeagueCanonicalId} δ=${cupMeta.awayDelta}` : "NULL"} captures=${captures.length} (terbaru ${captures.length ? String(captures[captures.length - 1].captured_utc) : "-"})`);

  // =========================================================================
  // TAHAP 1 — intelligence (jalur offline planner)
  // =========================================================================
  const fetched = await fetchAndValidateMatchIntelligence(MATCH_ID, COMPETITION_ID);
  const intel = fetched.intelligence;
  const audit = fetched.audit;
  {
    const fb: string[] = [];
    if (!intel.market_odds || intel.market_odds.home_last == null) fb.push("market_odds 1X2 lokal = null (payload anchor berbentuk SM tidak ter-parse validator TheStats — model-only, sesuai desain)");
    if (!intel.lineups?.is_available) fb.push("lineups lokal di intel tidak tersedia (missing registry) — lineup resmi dibaca dari store expected_lineups di tahap konteks");
    if (!intel.injuries?.is_available) fb.push("injuries lokal di intel tidak tersedia");
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
  }
  pkg.intel = cap(intel);
  pkg.fetch_audit = audit;
  log("1-intelligence", `kompetisi="${intel.pertandingan.kompetisi}" home_last=${intel.market_odds?.home_last ?? "null"} formH=${intel.form_split?.home_form_sample_size} formA=${intel.form_split?.away_form_sample_size}`);

  // =========================================================================
  // TAHAP 2 — quant package murni lewat planner 🔒 (jalur offset global)
  // =========================================================================
  const pure = buildQuantPackage(intel, TODAY);
  const md = pure.shrunkParams.metadata;
  {
    const fb: string[] = [];
    if (!md?.cupOffset) fb.push("PERINGATAN: metadata.cupOffset TIDAK ada di paket planner — jalur offset tidak tersaji lewat buildQuantPackage");
    if (pure.vigOutput === null) fb.push("vig_stripping = null (tidak ada odds pasar lokal yang valid → model-only, sesuai desain)");
    if (pure.quantPackage.value_bets.length === 0) fb.push("value_bets lokal = 0 (konsekuensi odds lokal null — bukan odds karangan)");
    if ((md?.observedXgSamples?.home ?? 0) < 3) fb.push(`sampel xG kandang di metadata = ${md?.observedXgSamples?.home} (jalur piala: telemetry_source=${md?.telemetrySource?.home ?? "?"} — parameter dari prior makro domestik yang ditransformasi δ, bukan blend telemetri last-6)`);
    if ((md?.observedXgSamples?.away ?? 0) < 3) fb.push(`sampel xG tamu di metadata = ${md?.observedXgSamples?.away} (telemetry_source=${md?.telemetrySource?.away ?? "?"})`);
    if (pure.homeTelem.sample_size === 0) fb.push("telemetri kandang (objek planner) sample_size 0");
    if (pure.awayTelem.sample_size === 0) fb.push("telemetri tamu (objek planner) sample_size 0");
    trace.push({
      stage: "2-quant-murni",
      inputs: { today: TODAY },
      outputs: {
        lambda: pure.dcOutput.lambda,
        mu: pure.dcOutput.mu,
        probs: { home: pure.dcOutput.prob_home_win, draw: pure.dcOutput.prob_draw, away: pure.dcOutput.prob_away_win },
        dixon_coles: pure.quantPackage.dixon_coles,
        shrunk_params: pure.shrunkParams,
        calibration_metadata: pure.quantPackage.calibration_metadata,
        cup_offset_metadata: md?.cupOffset ?? null,
        gate: { status: md?.calibrationStatus ?? null, reason: md?.calibrationGate ?? null },
        value_bets: pure.quantPackage.value_bets.length,
        vig: pure.quantPackage.vig_stripping,
      },
      fallbacks: fb,
    });
  }
  pkg.quant_pure = {
    quant_package: pure.quantPackage,
    dixon_coles: pure.quantPackage.dixon_coles,
    shrunk_params: pure.shrunkParams,
    calibration_metadata: pure.quantPackage.calibration_metadata,
    cup_offset_metadata: md?.cupOffset ?? null,
    market_anchor_local: { home_last: pure.hLast, draw_last: pure.dLast, away_last: pure.aLast },
  };
  log("2-quant-murni", `λ=${pure.dcOutput.lambda} μ=${pure.dcOutput.mu} P(H/D/A)=${pure.dcOutput.prob_home_win}/${pure.dcOutput.prob_draw}/${pure.dcOutput.prob_away_win} gate=${md?.calibrationStatus}`);

  // =========================================================================
  // TAHAP 3 — jalur wire Sportmonks OFFLINE dari tangkapan TERSEGAR ber-odds
  // =========================================================================
  const newestWithOdds = dsDb
    .prepare("SELECT captured_utc, capture_kind, source, payload_json FROM match_odds_history WHERE match_id = ? AND has_odds = 1 ORDER BY captured_utc DESC LIMIT 1")
    .get(MATCH_ID) as { captured_utc: string; capture_kind: string; source: string; payload_json: string } | undefined;
  if (!newestWithOdds) throw new Error("tidak ada tangkapan odds ber-odds untuk fixture ini");
  const envelope = JSON.parse(newestWithOdds.payload_json) as { odds?: unknown[]; point?: string; late_entry?: boolean };
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
    quotes = pickSmQuotes(detail, newestWithOdds.captured_utc);
    if (quotes && quotes.home_last && quotes.draw_last && quotes.away_last) {
      try {
        shin = stripVigShin(quotes.home_last, quotes.draw_last, quotes.away_last);
      } catch (e) {
        shinError = e instanceof Error ? e.message : String(e);
      }
    }
    wired = buildQuantPackageWithSportmonks(intel, TODAY, detail, { fetchedAt: newestWithOdds.captured_utc });
  }
  {
    const fb: string[] = [];
    const absoluteNewest = captures.length ? captures[captures.length - 1] : null;
    if (absoluteNewest && String(absoluteNewest.captured_utc) !== newestWithOdds.captured_utc)
      fb.push(`tangkapan absolut tersegar (${String(absoluteNewest.captured_utc)}, kind=${String(absoluteNewest.capture_kind)}) BUKAN yang dipakai wire — yang dipakai: tersegar ber-odds ${newestWithOdds.captured_utc} (kind=${newestWithOdds.capture_kind})`);
    const dueT1h = "2026-11-04T16:45:00Z";
    if (newestWithOdds.captured_utc < dueT1h)
      fb.push(`pada waktu run, tangkapan T-1j (jatuh tempo ${dueT1h}) BELUM mendarat di store — harga pasar yang dipakai = tangkapan ${newestWithOdds.capture_kind} ${newestWithOdds.captured_utc} (titik terjadwal sebelumnya). Run TIDAK diulang menunggu tangkapan itu, sesuai instruksi.`);
    if (detailError) fb.push(`parseFixtureDetail THROW: ${detailError}`);
    if (detail) {
      if (detail.lineup_home === null && detail.lineup_away === null) fb.push("detail.lineup = null (payload odds tidak memuat lineup — lineup resmi ada di store expected_lineups, lihat konteks)");
      if (detail.predictions.length === 0) fb.push("detail.predictions kosong (payload odds tidak memuat prediksi — panel banding dari predictions.db di konteks)");
      if (detail.sidelined.length === 0) fb.push("detail.sidelined kosong — gap cedera tidak ditutup wire offline");
      if (detail.skipped.length > 0) fb.push(`parseFixtureDetail skipped ${detail.skipped.length} entri (contoh: ${detail.skipped.slice(0, 3).join(" ; ")})`);
    }
    if (!quotes) fb.push("pickSmQuotes = null (tidak ada quote bookmaker utama/pembanding yang lengkap)");
    if (shinError) fb.push(`stripVigShin pada quote SM THROW: ${shinError}`);
    if (wired && wired.bundle.quantPackage.value_bets.length === 0) fb.push("value_bets gabungan (lokal+SM) = 0 — tidak ada sisi yang lolos evaluasi Kelly/edge");
    trace.push({
      stage: "3-wire-sportmonks-offline",
      inputs: {
        payload_captured_utc: newestWithOdds.captured_utc,
        payload_capture_kind: newestWithOdds.capture_kind,
        payload_point: envelope.point ?? null,
        payload_late_entry: envelope.late_entry ?? null,
        odds_entries: Array.isArray(envelope.odds) ? envelope.odds.length : 0,
        all_captures: captures,
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
  }
  pkg.quant_wired = wired
    ? {
        quant_package: wired.bundle.quantPackage,
        intel_merged_market_odds: (wired.intel.market_odds as unknown) ?? null,
        sm_status: wired.smStatus,
        sm_reason: wired.smReason,
      }
    : null;
  pkg.market_anchor_sm = {
    used_capture: { captured_utc: newestWithOdds.captured_utc, capture_kind: newestWithOdds.capture_kind, source: newestWithOdds.source },
    all_captures: captures,
    quotes_primary_and_compare: quotes,
    shin_stripped: shin,
  };
  log("3-wire", `dipakai=${newestWithOdds.capture_kind}@${newestWithOdds.captured_utc} status=${wired?.smStatus} quotes=${quotes ? `${quotes.bookmaker} ${quotes.home_last}/${quotes.draw_last}/${quotes.away_last}` : "null"} valueBetsGabungan=${wired?.bundle.quantPackage.value_bets.length ?? "-"}`);

  // =========================================================================
  // TAHAP 4 — konteks untuk lapisan verdict parent (semua dari store lokal)
  // =========================================================================
  const prDb = openRo(dbPath("predictions.db"));
  const predRows = prDb
    .prepare("SELECT market, outcome, probability, predictability, captured_utc FROM sm_predictions WHERE fixture_sm_id = ? ORDER BY market, outcome")
    .all(FIXTURE_SM_ID) as Record<string, unknown>[];
  const smValueBets = prDb
    .prepare("SELECT market, outcome, bookmaker, odds, fair_odds, value_pct, captured_utc FROM sm_value_bets WHERE fixture_sm_id = ?")
    .all(FIXTURE_SM_ID) as Record<string, unknown>[];
  const predictability = prDb
    .prepare("SELECT market, score, updated_utc FROM sm_predictability WHERE league_id = ? ORDER BY market")
    .all(LEAGUE_NUMERIC_ID) as Record<string, unknown>[];

  const homeTeamId = String(fixture.home_team_id);
  const awayTeamId = String(fixture.away_team_id);
  const standings = dsDb
    .prepare("SELECT team_id, position, points, payload_json, fetched_utc FROM standings WHERE league_id = ? AND team_id IN (?, ?) ORDER BY position")
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
      players: Array.isArray(players) ? players : [],
    };
  });

  const newsRows = dsDb
    .prepare("SELECT payload_json, fetched_utc FROM prematch_news WHERE fixture_sm_id = ?")
    .all(FIXTURE_SM_ID) as { payload_json: string; fetched_utc: string }[];
  const news = newsRows.map((r) => {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(r.payload_json);
    } catch {
      parsed = r.payload_json;
    }
    return { fetched_utc: r.fetched_utc, payload: parsed };
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
      fixture_id_format: "fixture_sm_id NUMERIK (19872622) — 92 baris; bentuk ber-prefix = 0 baris",
      total_rows: predRows.length,
      fulltime_result: byMarket.get("Fulltime Result Probability") ?? [],
      over_under_2_5: byMarket.get("Over/Under 2.5 Probability") ?? [],
      btts: byMarket.get("Both Teams To Score Probability") ?? [],
      double_chance: byMarket.get("Double Chance Probability") ?? [],
      all_markets: Object.fromEntries(byMarket),
    },
    sm_value_bets_db: smValueBets,
    predictability_league_2: predictability,
    standings_both_teams: standings.map((s) => {
      let payload: Record<string, unknown> | null = null;
      try {
        payload = JSON.parse(String(s.payload_json)) as Record<string, unknown>;
      } catch {
        payload = null;
      }
      return { team_id: s.team_id, position: s.position, points: s.points, fetched_utc: s.fetched_utc, payload };
    }),
    expected_lineups: lineups,
    prematch_news: news,
    h2h,
    telemetry_last6: {
      home: { team: fixture.home_team_name, telemetry: cap(pure.homeTelem) },
      away: { team: fixture.away_team_name, telemetry: cap(pure.awayTelem) },
    },
    form_split_intel: intel.form_split ?? null,
  };
  pkg.context = context;
  {
    const fb: string[] = [];
    if (smValueBets.length === 0) fb.push("sm_value_bets di predictions.db untuk fixture ini = 0 baris");
    if (standings.length < 2) fb.push(`standings UCL fase liga hanya ${standings.length}/2 tim ditemukan (kunci league_id='sm:2', team_id dari upcoming_fixtures)`);
    if (h2h === null) fb.push(`h2h_cache tidak punya pasangan ${pairA}/${pairB}`);
    if (news.length === 0) fb.push("prematch_news kosong untuk fixture ini");
    if (lineups.length < 2) fb.push(`expected_lineups hanya ${lineups.length}/2 sisi`);
    trace.push({
      stage: "4-context",
      outputs: {
        predictions_rows: predRows.length,
        sm_value_bets_rows: smValueBets.length,
        standings_found: standings.length,
        lineups_sides: lineups.map((l) => `${l.side}:${l.players_count}`),
        news_rows: news.length,
        h2h: h2h ? (h2h as { meetings: number }).meetings : null,
      },
      fallbacks: fb,
    });
  }
  log("4-context", `pred=${predRows.length} smVB=${smValueBets.length} standings=${standings.length} lineups=${lineups.length} news=${news.length} h2h=${h2h ? "ada" : "null"}`);

  pkg.trace = trace;
  writeFileSync(OUTPUT, JSON.stringify(pkg, null, 2));
  log("SELESAI", `paket ditulis ke ${OUTPUT}`);
}

main().catch((e) => {
  console.error("E2E CUP LIVE GAGAL:", e);
  process.exit(1);
});
