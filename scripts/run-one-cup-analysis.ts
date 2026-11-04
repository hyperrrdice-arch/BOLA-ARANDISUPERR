/**
 * E2E PIALA — satu analisis kuant end-to-end untuk fixture UEFA Champions
 * League lewat MODEL OFFSET GLOBAL (fase kalibrasi piala).
 *
 * Saudara ramping dari run-one-analysis.ts (Everton, liga domestik):
 *   Tahap 0 — seleksi PROGRAMATIK: fixture sm:2 mendatang pertama yang
 *     kedua timnya ter-rate lewat jalur offset DAN kedua liga domestiknya
 *     berstatus calibrated (bukti seleksi per kandidat dicatat).
 *   Tahap 1 — fetchAndValidateMatchIntelligence (jalur offline).
 *   Tahap 2 — buildQuantPackage (planner 🔒 apa adanya): transformasi δ
 *     harus terlihat di shrunkParams.metadata.cupOffset.
 *
 * Offline murni: tanpa STATS_API_KEY, nol panggilan API, nol tulis ke
 * analysis_snapshots.db, nol modifikasi file 🔒.
 * Output: tasks/e2e-cup-package.json.
 *
 * Pakai: npx tsx scripts/run-one-cup-analysis.ts
 */
import { writeFileSync } from "node:fs";
import { fetchAndValidateMatchIntelligence } from "../lib/stats-fetcher-agent";
import { buildQuantPackage } from "../lib/agent/planner";
import {
  loadCalibratedRatings,
  getShrunkMatchParameters,
} from "../lib/quant/ratings-loader";
import { getLeagueGate } from "../lib/quant/league-gate";
import { getUpcomingDb } from "../lib/db/upcoming-fixtures";

const COMPETITION_ID = "sm:2";
const TODAY = new Date().toISOString().slice(0, 10);

type TraceEntry = { stage: string; inputs?: unknown; outputs?: unknown; fallbacks: string[]; error?: string };
const trace: TraceEntry[] = [];
function log(stage: string, msg: string) {
  console.log(`[${stage}] ${msg}`);
}

interface CandidateRow {
  match_id: string;
  utc_date: string;
  home_team_name: string;
  away_team_name: string;
  is_neutral: number | null;
}

async function main() {
  const pkg: Record<string, unknown> = {
    meta: {
      run: "e2e-cup-ucl",
      generated_at: new Date().toISOString(),
      today_cutoff: TODAY,
      competition_id: COMPETITION_ID,
      offline_only: true,
      model: "global-offset (fase kalibrasi piala): att*=att×e^δ, def*=def÷e^δ, basis globalAvg graf + cupHA graf",
      notes: [
        "Seleksi programatik: fixture sm:2 mendatang pertama yang lolos jalur offset dengan kedua liga domestik calibrated.",
        "Status kompetisi sm:2 sendiri = partial (bukti OOS tasks/cup-oos.json) — tersaji ber-flag lewat metadata.calibrationStatus, bukan disembunyikan.",
      ],
    },
  };

  // =========================================================================
  // TAHAP 0 — seleksi programatik + bukti per kandidat
  // =========================================================================
  const ratings = loadCalibratedRatings();
  if (!ratings) throw new Error("calibrated_ratings.json tidak terbaca");
  const upDb = getUpcomingDb();
  const rows = upDb
    .prepare(
      `SELECT match_id, utc_date, home_team_name, away_team_name, is_neutral
       FROM upcoming_fixtures
       WHERE competition_id = ? AND utc_date >= datetime('now')
       ORDER BY utc_date ASC LIMIT 40`,
    )
    .all(COMPETITION_ID) as unknown as CandidateRow[];

  const attempts: Record<string, unknown>[] = [];
  let chosen: { row: CandidateRow; cup: NonNullable<ReturnType<typeof getShrunkMatchParameters>["metadata"]>["cupOffset"] } | null = null;
  let chosenParams: ReturnType<typeof getShrunkMatchParameters> | null = null;
  for (const r of rows) {
    const params = getShrunkMatchParameters({
      leagueHint: COMPETITION_ID,
      homeTeam: r.home_team_name,
      awayTeam: r.away_team_name,
      isNeutralVenue: r.is_neutral === 1,
      matchDateCutoff: TODAY,
    });
    const cup = params.metadata?.cupOffset;
    if (!cup) {
      attempts.push({
        match_id: r.match_id, home: r.home_team_name, away: r.away_team_name,
        verdict: "ditolak", reason: params.metadata?.leagueResolution?.note ?? "tanpa metadata cupOffset (fallback/blokir gerbang)",
        gate: params.metadata?.calibrationStatus ?? null,
      });
      continue;
    }
    const homeGate = getLeagueGate(cup.homeLeagueCanonicalId)?.status ?? "unknown";
    const awayGate = getLeagueGate(cup.awayLeagueCanonicalId)?.status ?? "unknown";
    const ok = homeGate === "calibrated" && awayGate === "calibrated";
    attempts.push({
      match_id: r.match_id, home: r.home_team_name, away: r.away_team_name,
      verdict: ok ? "TERPILIH" : "ditolak",
      home_league: cup.homeLeagueCanonicalId, home_delta: cup.homeDelta, home_gate: homeGate,
      away_league: cup.awayLeagueCanonicalId, away_delta: cup.awayDelta, away_gate: awayGate,
      reason: ok ? "kedua liga domestik calibrated" : "satu/kedua liga domestik bukan calibrated",
    });
    if (ok) {
      chosen = { row: r, cup };
      chosenParams = params;
      break;
    }
  }
  trace.push({ stage: "0-seleksi", outputs: { candidates_examined: attempts.length, attempts }, fallbacks: chosen ? [] : ["tidak ada kandidat lolos kriteria seleksi"] });
  pkg.selection = { attempts, chosen_match_id: chosen?.row.match_id ?? null };
  if (!chosen || !chosenParams) throw new Error("Tidak ada fixture UCL mendatang yang lolos kriteria seleksi (jalur offset + dua liga domestik calibrated).");
  log("0-seleksi", `${chosen.row.home_team_name} vs ${chosen.row.away_team_name} (${chosen.row.match_id}) — kandang ${chosen.cup.homeLeagueCanonicalId} δ=${chosen.cup.homeDelta}, tamu ${chosen.cup.awayLeagueCanonicalId} δ=${chosen.cup.awayDelta}`);

  // =========================================================================
  // TAHAP 1 — intelligence (jalur offline planner)
  // =========================================================================
  const fetched = await fetchAndValidateMatchIntelligence(chosen.row.match_id, COMPETITION_ID);
  const intel = fetched.intelligence;
  const fb1: string[] = [];
  if (!intel.market_odds || intel.market_odds.home_last == null) fb1.push("market_odds 1X2 lokal = null (model-only, sesuai desain)");
  if ((intel.missing_data_registry ?? []).length > 0) fb1.push(`missing_data_registry: ${(intel.missing_data_registry ?? []).join(" | ")}`);
  trace.push({
    stage: "1-intelligence",
    inputs: { matchId: chosen.row.match_id, competitionIdHint: COMPETITION_ID },
    outputs: { pertandingan: intel.pertandingan, market_odds: intel.market_odds, form_split: intel.form_split },
    fallbacks: fb1,
  });
  pkg.intel_pertandingan = intel.pertandingan;
  log("1-intelligence", `kompetisi="${intel.pertandingan.kompetisi}" kickoff=${intel.pertandingan.tanggal ?? "?"}`);

  // =========================================================================
  // TAHAP 2 — quant package murni lewat planner 🔒
  // =========================================================================
  const pure = buildQuantPackage(intel, TODAY);
  const md = pure.shrunkParams.metadata;
  const fb2: string[] = [];
  if (!md?.cupOffset) fb2.push("PERINGATAN: metadata.cupOffset TIDAK ada di paket planner — jalur offset tidak tersaji lewat buildQuantPackage");
  if (pure.vigOutput === null) fb2.push("vig_stripping = null (tidak ada odds pasar lokal valid → model-only)");
  trace.push({
    stage: "2-quant-murni",
    inputs: { today: TODAY },
    outputs: {
      lambda: pure.dcOutput.lambda,
      mu: pure.dcOutput.mu,
      probs: { home: pure.dcOutput.prob_home_win, draw: pure.dcOutput.prob_draw, away: pure.dcOutput.prob_away_win },
      shrunk_params: pure.shrunkParams,
      calibration_metadata: pure.quantPackage.calibration_metadata,
    },
    fallbacks: fb2,
  });
  pkg.quant_pure = {
    dixon_coles: pure.quantPackage.dixon_coles,
    shrunk_params: pure.shrunkParams,
    calibration_metadata: pure.quantPackage.calibration_metadata,
    cup_offset_metadata: md?.cupOffset ?? null,
  };
  pkg.trace = trace;
  writeFileSync("tasks/e2e-cup-package.json", JSON.stringify(pkg, null, 2));
  log("2-quant", `λ=${pure.dcOutput.lambda} μ=${pure.dcOutput.mu} | H ${(pure.dcOutput.prob_home_win * 100).toFixed(2)}% / D ${(pure.dcOutput.prob_draw * 100).toFixed(2)}% / A ${(pure.dcOutput.prob_away_win * 100).toFixed(2)}%`);
  log("selesai", "tasks/e2e-cup-package.json tertulis.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
