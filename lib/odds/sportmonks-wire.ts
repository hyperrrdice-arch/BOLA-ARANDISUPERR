/**
 * SPORTMONKS WIRING — Track B Task SM-2 (wire ke pipeline, backend only).
 *
 * Fungsi murni + orkestrasi aman (never-throw) untuk menyambung output
 * `lib/odds/sportmonks-adapter.ts` ke pipeline existing:
 *  1. Mapping SM fixture ↔ laga kita (`sm_id_map`, 3 kunci). Tanpa mapping
 *     → status "absent" → pipeline jalan offline seperti sebelumnya (0 call).
 *  2. Odds SM (1xBet id 35 utama, Pinnacle 20 pembanding) → value bets
 *     TAMBAHAN berlabel `odds_source: "sportmonks"`. Harga lokal TIDAK
 *     disentuh (disimpan terpisah di `market_odds.sm_odds`). Prob/fair/EV
 *     dihitung code yang sama (`evaluateValueBet`) — angka model tak berubah.
 *  3. Lineup/sidelined SM → tutup gap intel HANYA bila lokal absen
 *     (hormati data lokal; label sumber + tanggal).
 *  4. Predictions SM → panel banding additive (`sm_predictions`, berlabel
 *     "Sportmonks AI, bukan model kita") — angka kita tak tersentuh.
 *  5. Log akurasi JSONL (`data/sm_prediction_log.jsonl`) — ditulis HANYA via
 *     `appendSmPredictionLog` dari script/test, TIDAK PERNAH dari hot path
 *     pipeline (test mengassert ini secara statis).
 *
 * Aturan budget: modul ini TIDAK menambah call selain 1
 * `fetchFixtureDetail` per laga shortlist, dan HANYA bila mapping ada.
 * Tanpa key / key mati / over-budget → "degraded" (pesan "pantau"),
 * pipeline tetap selesai dengan angka lokal.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dbPath } from "../db/paths";
import {
  fetchFixtureDetail,
  isSportmonksDegraded,
  smCallsUsed,
  type SmFixtureDetail,
} from "./sportmonks-adapter";
import {
  evaluateValueBet,
  type ValueBetEvaluation,
} from "../quant/kelly";
import type { VerifiedMatchIntelligence } from "../stats-validator";

export const SM_SOURCE_LABEL = "sportmonks";
export const SM_PRIMARY_BOOKMAKER_ID = 35; // 1xBet (utama)
export const SM_COMPARE_BOOKMAKER_ID = 20; // Pinnacle (pembanding)

// ---------- tipe ----------

export interface SmOddsQuote {
  home_last: number | null;
  draw_last: number | null;
  away_last: number | null;
  total_goals_over_2_5: number | null;
  under_2_5: number | null;
  bookmaker: string;
  bookmaker_id: number;
  /** Perbandingan jujur vs Pinnacle bila utama = 1xBet (atau sebaliknya). */
  compare_note: string | null;
  fetched_at: string;
  source: "sportmonks";
}

export interface SmPredictionPanelItem {
  type: string;
  detail: string;
  source: "sportmonks";
  fetched_at: string | null;
}

export type SmWireStatus = "ok" | "degraded" | "absent";

export interface SmQuantContext {
  status: SmWireStatus;
  fixture_id: number | null;
  bookmaker: string | null;
  bookmaker_id: number | null;
  fetched_at: string | null;
  predictions: SmPredictionPanelItem[];
  gaps_closed: string[];
  notes: string[];
  degraded_reason: string | null;
}

export interface SmMergeResult {
  intel: VerifiedMatchIntelligence;
  smOdds: SmOddsQuote | null;
  predictions: SmPredictionPanelItem[];
  gapsClosed: string[];
  notes: string[];
}

// ---------- 1. normalisasi nama tim (mapping 3 kunci: tim + tanggal + liga) ----------

const SM_NAME_STOPWORDS = new Set([
  "fc", "ac", "sc", "as", "cf", "afc", "rc", "ssc", "ss", "us", "ud",
  "calcio", "club", "deportivo",
]);

/** Normalisasi kasar untuk pencocokan lintas ID space (SM vs TheStatsAPI). */
export function normalizeTeamName(s: string | null | undefined): string {
  if (!s) return "";
  const ascii = s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const tokens = ascii
    .split(/[^a-z0-9]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !SM_NAME_STOPWORDS.has(t));
  return tokens.join(" ");
}

/**
 * Cocok longgar dua nama tim: sama persis, atau salah satu mengandung yang
 * lain (mis. "inter" ⊂ "internazionale", "shakhtar" ⊂ "shakhtar donetsk").
 * Guard panjang ≥4 cegah "as roma" vs "roma"... (tetap cocok — benar),
 * dan cegah singkatan 1–3 huruf yang rawan false positive.
 */
export function teamNamesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  const shortFlat = short.replace(/ /g, "");
  if (shortFlat.length < 4) return false;
  const longFlat = long.replace(/ /g, "");
  return longFlat.includes(shortFlat);
}

// ---------- 2. mapping sm_id_map (read-only; SM-4 pemilik tulis) ----------

function openUpcomingReadOnly(): DatabaseSync | null {
  try {
    const p = dbPath("upcoming_fixtures.db");
    if (!fs.existsSync(p)) return null;
    return new DatabaseSync(p, { readOnly: true } as unknown as { readOnly: boolean });
  } catch {
    return null;
  }
}

/**
 * Resolve SM fixture id untuk match_id kita. Read-only; tabel `sm_id_map`
 * ditulis Task SM-4 (belum jalan → selalu null → degradasi "pantau").
 */
export function resolveSmFixtureId(matchId: string): number | null {
  if (!matchId) return null;
  const db = openUpcomingReadOnly();
  if (!db) return null;
  try {
    const row = db
      .prepare("SELECT sm_fixture_id FROM sm_id_map WHERE match_id = ? LIMIT 1")
      .get(matchId) as { sm_fixture_id?: unknown } | undefined;
    const n = Number(row?.sm_fixture_id);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  } catch {
    // Tabel belum ada (SM-4) atau schema beda → tanpa mapping = pantau.
    return null;
  } finally {
    try {
      db.close();
    } catch {
      /* abaikan */
    }
  }
}

// ---------- 3. kutip odds SM (1xBet utama, Pinnacle pembanding; tanpa campur bandar) ----------

/** Pilih quote 1X2 + O/U garis 2.5. Tanpa baris bookie yang dikenal → null. */
export function pickSmQuotes(detail: SmFixtureDetail, fetchedAt: string): SmOddsQuote | null {
  const row12 =
    detail.odds_1x2.find((o) => o.bookmaker_id === SM_PRIMARY_BOOKMAKER_ID) ??
    detail.odds_1x2.find((o) => o.bookmaker_id === SM_COMPARE_BOOKMAKER_ID) ??
    null;
  const ouRows = detail.odds_ou.filter((o) => o.line === "2.5");
  const rowOu =
    ouRows.find((o) => o.bookmaker_id === (row12?.bookmaker_id ?? SM_PRIMARY_BOOKMAKER_ID)) ??
    ouRows.find((o) => o.bookmaker_id === SM_PRIMARY_BOOKMAKER_ID) ??
    ouRows.find((o) => o.bookmaker_id === SM_COMPARE_BOOKMAKER_ID) ??
    null;
  if (!row12 && !rowOu) return null;

  const primaryId = row12?.bookmaker_id ?? rowOu?.bookmaker_id ?? SM_PRIMARY_BOOKMAKER_ID;
  const primaryName =
    row12?.bookmaker ?? rowOu?.bookmaker ?? "Sportmonks";

  // Pembanding: bandar dikenal lain yang punya baris 1X2 di laga ini.
  let compareNote: string | null = null;
  const other12 = detail.odds_1x2.find(
    (o) =>
      o.bookmaker_id !== primaryId &&
      (o.bookmaker_id === SM_PRIMARY_BOOKMAKER_ID || o.bookmaker_id === SM_COMPARE_BOOKMAKER_ID)
  );
  if (row12 && other12) {
    compareNote =
      `1X2 ${row12.bookmaker} ${row12.home ?? "?"} / ${row12.draw ?? "?"} / ${row12.away ?? "?"} ` +
      `vs ${other12.bookmaker} ${other12.home ?? "?"} / ${other12.draw ?? "?"} / ${other12.away ?? "?"}`;
  }

  return {
    home_last: row12?.home ?? null,
    draw_last: row12?.draw ?? null,
    away_last: row12?.away ?? null,
    total_goals_over_2_5: rowOu?.over ?? null,
    under_2_5: rowOu?.under ?? null,
    bookmaker: primaryName,
    bookmaker_id: primaryId,
    compare_note: compareNote,
    fetched_at: fetchedAt,
    source: SM_SOURCE_LABEL,
  };
}

// ---------- 4. merge intel (tutup gap; hormati lokal) ----------

function summarizePredictionValues(values: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(values)) {
    if (parts.length >= 4) break;
    if (v === null || v === undefined) continue;
    if (typeof v === "object") continue;
    parts.push(`${k} ${String(v)}`);
  }
  return (parts.join(" · ") || "—").slice(0, 160);
}

export function summarizeSmPredictions(
  detail: SmFixtureDetail,
  fetchedAt: string | null
): SmPredictionPanelItem[] {
  return detail.predictions.map((p) => ({
    type: p.type_name,
    detail: summarizePredictionValues(p.values ?? {}),
    source: SM_SOURCE_LABEL,
    fetched_at: fetchedAt,
  }));
}

function sideOfSidelined(
  teamId: number | null,
  detail: SmFixtureDetail
): "home" | "away" | null {
  if (teamId === null) return null;
  if (detail.lineup_home?.team_id !== null && detail.lineup_home?.team_id === teamId) return "home";
  if (detail.lineup_away?.team_id !== null && detail.lineup_away?.team_id === teamId) return "away";
  return null;
}

/**
 * Gabung detail SM ke salinan intel. TIDAK PERNAH menyentuh:
 * - `market_odds.home_last/draw_last/away_last/total_goals_over_2_5` (harga lokal),
 * - lineup/cedera lokal yang sudah tersedia,
 * - angka apa pun (prob/fair/EV bukan ranah fungsi ini).
 */
export function mergeSmDetailIntoIntel(
  intel: VerifiedMatchIntelligence,
  detail: SmFixtureDetail,
  fetchedAt: string = new Date().toISOString()
): SmMergeResult {
  const out: VerifiedMatchIntelligence = structuredClone(intel);
  const gapsClosed: string[] = [];
  const notes: string[] = [];

  // --- odds: catat terpisah, jangan timpa lokal ---
  const smOdds = pickSmQuotes(detail, fetchedAt);
  if (smOdds) {
    (out.market_odds as VerifiedMatchIntelligence["market_odds"] & { sm_odds?: SmOddsQuote | null }).sm_odds = smOdds;
    notes.push(
      `odds SM ${smOdds.bookmaker} 1X2 ${smOdds.home_last ?? "?"} / ${smOdds.draw_last ?? "?"} / ${smOdds.away_last ?? "?"} ` +
        `+ O/U 2.5 ${smOdds.total_goals_over_2_5 ?? "?"}/${smOdds.under_2_5 ?? "?"} — gabung, harga lokal dipertahankan`
    );
    if (smOdds.compare_note) notes.push(`pembanding: ${smOdds.compare_note}`);
  } else {
    notes.push("odds SM kosong/tak terurai untuk laga ini — value bet SM nihil");
  }
  notes.push("BTTS: tanpa harga SM (filter markets 1,80) — tidak dinilai dari SM");

  // --- lineup: isi HANYA sisi yang kosong ---
  const smHomeXi = (detail.lineup_home?.players ?? []).map((p) => ({
    name: p.name,
    pos: p.position ?? "M",
    num: p.number ?? null,
  }));
  const smAwayXi = (detail.lineup_away?.players ?? []).map((p) => ({
    name: p.name,
    pos: p.position ?? "M",
    num: p.number ?? null,
  }));
  const localLineups = out.lineups;
  if (!localLineups.is_available) {
    let filled = 0;
    if (smHomeXi.length >= 7) {
      localLineups.home_starting_xi = smHomeXi;
      if (detail.lineup_home?.formation) localLineups.home_formation = detail.lineup_home.formation;
      filled++;
    }
    if (smAwayXi.length >= 7) {
      localLineups.away_starting_xi = smAwayXi;
      if (detail.lineup_away?.formation) localLineups.away_formation = detail.lineup_away.formation;
      filled++;
    }
    if (filled > 0) {
      localLineups.is_available = localLineups.home_starting_xi.length >= 7 && localLineups.away_starting_xi.length >= 7;
      localLineups.confirmed = false;
      localLineups.status_label = "prediksi";
      (localLineups as typeof localLineups & { lineup_source?: string | null; lineup_fetched_at?: string | null }).lineup_source = SM_SOURCE_LABEL;
      (localLineups as typeof localLineups & { lineup_source?: string | null; lineup_fetched_at?: string | null }).lineup_fetched_at = fetchedAt;
      if (localLineups.is_available) {
        out.missing_data_registry = out.missing_data_registry.filter((g) => !/lineup/i.test(g));
        gapsClosed.push(`lineup (Sportmonks, prediksi, ${fetchedAt.slice(0, 10)})`);
      } else {
        notes.push("lineup SM parsial (<7 pemain di satu sisi) — gap lineup dipertahankan");
      }
    } else {
      notes.push("lineup SM kosong — gap lineup dipertahankan");
    }
  } else {
    notes.push(
      `lineup lokal dipertahankan (${localLineups.status_label}, kandang ${localLineups.home_starting_xi.length}/tamu ${localLineups.away_starting_xi.length}) — SM tidak menimpa`
    );
  }

  // --- cedera: isi HANYA bila lokal absen ---
  const localInj = out.injuries;
  if (!localInj.is_available && detail.sidelined.length > 0) {
    const home: string[] = [];
    const away: string[] = [];
    let unattributed = 0;
    for (const s of detail.sidelined) {
      const label = s.reason ? `${s.player_name} (${s.reason})` : s.player_name;
      const side = sideOfSidelined(s.team_id, detail);
      if (side === "home") home.push(label);
      else if (side === "away") away.push(label);
      else unattributed++;
    }
    if (home.length + away.length > 0) {
      localInj.home_injuries = home;
      localInj.away_injuries = away;
      localInj.is_available = true;
      (localInj as typeof localInj & { injury_source?: string | null; injury_fetched_at?: string | null }).injury_source = SM_SOURCE_LABEL;
      (localInj as typeof localInj & { injury_source?: string | null; injury_fetched_at?: string | null }).injury_fetched_at = fetchedAt;
      out.missing_data_registry = out.missing_data_registry.filter(
        (g) => !/cedera|suspensi|kekuatan penuh/i.test(g)
      );
      gapsClosed.push(`cedera (Sportmonks, ${home.length + away.length} pemain, ${fetchedAt.slice(0, 10)})`);
      if (unattributed > 0) notes.push(`${unattributed} sidelined SM tak teratribusi tim (lineup SM absen) — tidak dikarang`);
    } else {
      notes.push("sidelined SM ada tapi tak teratribusi tim — gap cedera dipertahankan (jujur)");
    }
  } else if (localInj.is_available) {
    notes.push(
      `cedera lokal dipertahankan (${localInj.home_injuries.length + localInj.away_injuries.length} entri) — SM (${detail.sidelined.length} sidelined) tidak menimpa`
    );
  } else {
    notes.push("sidelined SM kosong — gap cedera dipertahankan");
  }

  const predictions = summarizeSmPredictions(detail, fetchedAt);
  (out as VerifiedMatchIntelligence & { sm_predictions?: SmPredictionPanelItem[] | null }).sm_predictions = predictions;

  return { intel: out, smOdds, predictions, gapsClosed, notes };
}

// ---------- 5. value bets SM (prob/fair model SAMA, harga SM) ----------

export interface SmModelProbs {
  prob_home_win: number;
  prob_draw: number;
  prob_away_win: number;
  over_2_5_over: number;
  fair_odds: { home: number; draw: number; away: number };
}

/**
 * Nilai 1X2 (3 sisi) + Over 2.5 vs probabilitas MODEL. Under/BTTS tidak
 * dinilai (cermin konvensi pipeline: over-only; BTTS tanpa harga SM).
 * Tiap bet berlabel `odds_source: "sportmonks"` + sufiks rationale.
 */
export function buildSmValueBets(
  probs: SmModelProbs,
  quotes: SmOddsQuote,
  homeName = "Kandang",
  awayName = "Tamu"
): ValueBetEvaluation[] {
  const tag = ` (harga ${quotes.bookmaker} via Sportmonks)`;
  const out: ValueBetEvaluation[] = [];
  const push = (
    modelProb: number,
    odds: number | null,
    market: string,
    selection: string
  ) => {
    if (typeof odds !== "number" || !Number.isFinite(odds) || odds <= 1) return;
    const vb = evaluateValueBet(modelProb, odds, market, selection);
    vb.odds_source = SM_SOURCE_LABEL;
    vb.bookmaker = quotes.bookmaker;
    vb.rationale = `${vb.rationale}${tag}`;
    out.push(vb);
  };
  push(probs.prob_home_win, quotes.home_last, "1X2", `${homeName} Menang`);
  push(probs.prob_draw, quotes.draw_last, "1X2", "Hasil Imbang (Draw)");
  push(probs.prob_away_win, quotes.away_last, "1X2", `${awayName} Menang`);
  push(probs.over_2_5_over, quotes.total_goals_over_2_5, "Over/Under 2.5", "Over 2.5 Goals");
  return out;
}

// ---------- 6. orkestrasi aman: lookup + fetch, never-throw ----------

export interface SmFetchOutcome {
  detail: SmFixtureDetail | null;
  status: SmWireStatus;
  reason: string;
  fixture_id: number | null;
  calls_used: number;
}

/**
 * Ambil detail SM bila mapping ada. TIDAK PERNAH throw: tanpa mapping /
 * tanpa key / key mati / over-budget / network → { detail: null, status }.
 * Pemanggil (planner tool) lanjut dengan angka lokal apa adanya.
 */
export async function fetchSportmonksDetailIfMapped(matchId: string): Promise<SmFetchOutcome> {
  const before = smCallsUsed();
  const fixtureId = resolveSmFixtureId(matchId);
  if (fixtureId === null) {
    return {
      detail: null,
      status: "absent",
      reason: "tanpa sm_id_map → pantau (pipeline offline seperti sebelumnya, 0 call SM)",
      fixture_id: null,
      calls_used: 0,
    };
  }
  try {
    const detail = await fetchFixtureDetail(fixtureId);
    return {
      detail,
      status: "ok",
      reason: `detail SM ${fixtureId} masuk`,
      fixture_id: fixtureId,
      calls_used: smCallsUsed() - before,
    };
  } catch (e) {
    const reason = isSportmonksDegraded(e)
      ? (e as Error).message
      : `Sportmonks pantau dulu — gagal tarik fixture ${fixtureId} (${e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120)}). Tanpa data SM, jangan bet dari angka ini.`;
    return { detail: null, status: "degraded", reason, fixture_id: fixtureId, calls_used: smCallsUsed() - before };
  }
}

// ---------- 7. log akurasi predictions (ditulis script saja, BUKAN hot path) ----------

export interface SmPredictionLogEntry {
  captured_utc: string;
  sm_fixture_id: number;
  match: string;
  competition: string | null;
  kickoff_utc: string | null;
  predictions: SmPredictionPanelItem[];
  /** Diisi Task SM-3 saat laga selesai (null = belum resolved). */
  result: null;
  resolved: false;
}

export function smPredictionLogPath(): string {
  return path.join(process.cwd(), "data", "sm_prediction_log.jsonl");
}

/** Append satu baris JSONL. PURE I/O script — jangan panggil dari pipeline. */
export function appendSmPredictionLog(
  entry: SmPredictionLogEntry,
  filePath: string = smPredictionLogPath()
): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf-8");
}
