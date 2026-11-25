// ============================================================================
// KONTRAK MARKETSNAPSHOT (Item 3) + DEVIG + SELECTOR KETAT (Sprint C Fase 2)
// ----------------------------------------------------------------------------
// Fondasi bebas-bocor untuk kandidat berbasis pasar (Q3 dst.):
//  - Penyimpanan APPEND-ONLY di data/market_snapshots.db: baris snapshot
//    lama TIDAK PERNAH ditimpa. Tangkapan ulang quote yang sama menambah
//    `revision` baru; first_observed quote yang odds-nya tidak berubah
//    diteruskan dari observasi pertama (bukan di-reset ke waktu tangkap
//    ulang), dan quote yang berubah mendapat first_observed baru.
//  - Devig deterministik memakai implementasi repo yang sudah teruji
//    (lib/quant/vig-stripping.ts): Shin untuk 1X2, dua-arah untuk O/U.
//    Fungsi repo membulatkan ke 4 desimal untuk tampilan; snapshot wajib
//    menyimpan presisi penuh yang berjumlah tepat 1,0 — jadi vektor Shin
//    yang sama di-renormalisasi eksak di sini (faktor ~1±0,0002, bentuk
//    dan monotonisitas Shin dipertahankan).
//  - Selector quote ketat untuk keputusan pada decision_ts:
//      first_observed <= decision_ts < kickoff_ts  DAN
//      decision_ts - first_observed <= 12 jam.
//    Tidak ada quote yang memenuhi → null + alasan abstain pasar yang
//    eksplisit. Quote pasca-keputusan / in-play / usang TIDAK PERNAH
//    diambil diam-diam.
//  - Sumber selalu berlabel: "api-football" (primer, Item 20) atau
//    "1xbet" (fallback sekunder) — tidak dicampur.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dbPath } from "../db/paths";
import { stripVigShin, stripVigTwoWay } from "../quant/vig-stripping";

export type MarketSnapshotSource = "api-football" | "1xbet";
export type MarketKind = "1x2" | "ou";

/** Usia maksimum snapshot terhadap decision_ts (12 jam). */
export const MARKET_MAX_AGE_MS = 12 * 3_600_000;

export function getMarketSnapshotDbPath(): string {
  return dbPath("market_snapshots.db");
}

export function ensureMarketSnapshotSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_id TEXT NOT NULL,
      source TEXT NOT NULL,
      bookmaker TEXT NOT NULL,
      market TEXT NOT NULL,
      line REAL,
      odds_raw_json TEXT NOT NULL,
      devig_probs_json TEXT NOT NULL,
      devig_method TEXT NOT NULL,
      first_observed TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      revision INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ms_fixture_market
      ON market_snapshots(fixture_id, market, line, first_observed);
  `);
}

export function openMarketSnapshotDb(): DatabaseSync {
  const db = new DatabaseSync(getMarketSnapshotDbPath());
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 60000;");
  ensureMarketSnapshotSchema(db);
  return db;
}

// ---------------------------------------------------------------------------
// Devig (presisi penuh di atas implementasi repo)
// ---------------------------------------------------------------------------

function renormalizeExact(probs: number[]): number[] {
  const sum = probs.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(sum) || sum <= 0) {
    throw new Error("devig: jumlah probabilitas tidak valid");
  }
  const out = probs.map((p) => p / sum);
  for (const p of out) {
    if (!(p > 0 && p < 1)) throw new Error(`devig: probabilitas di luar (0,1): ${p}`);
  }
  return out;
}

/** Devig Shin 3-arah untuk 1X2 → [home, draw, away], jumlah tepat 1,0. */
export function devig1x2(home: number, draw: number, away: number): {
  probs: [number, number, number];
  method: string;
} {
  const r = stripVigShin(home, draw, away);
  const probs = renormalizeExact([r.fair_prob.home, r.fair_prob.draw, r.fair_prob.away]);
  return { probs: probs as [number, number, number], method: `shin+renorm` };
}

/** Devig dua-arah untuk O/U → [probA, probB], jumlah tepat 1,0. */
export function devigTwoWay(oddA: number, oddB: number): {
  probs: [number, number];
  method: string;
} {
  const r = stripVigTwoWay(oddA, oddB);
  const probs = renormalizeExact([r.fair_prob.optionA, r.fair_prob.optionB]);
  return { probs: probs as [number, number], method: `twoway-proportional+renorm` };
}

function devigFor(market: MarketKind, odds: Record<string, number>): {
  probs: Record<string, number>;
  method: string;
} {
  if (market === "1x2") {
    const { probs, method } = devig1x2(odds.home, odds.draw, odds.away);
    return { probs: { home: probs[0], draw: probs[1], away: probs[2] }, method };
  }
  const { probs, method } = devigTwoWay(odds.over, odds.under);
  return { probs: { over: probs[0], under: probs[1] }, method };
}

// ---------------------------------------------------------------------------
// Append (append-only + riwayat revisi + first_observed diteruskan)
// ---------------------------------------------------------------------------

export interface MarketSnapshotInput {
  fixture_id: string;
  source: MarketSnapshotSource;
  bookmaker: string;
  market: MarketKind;
  line: number | null;
  odds_raw: Record<string, number>;
  /** Bila null: diteruskan dari observasi pertama bila odds identik dengan revisi terakhir; selain itu = captured_at. */
  first_observed?: string | null;
  captured_at: string;
}

export interface MarketSnapshotRow {
  id: number;
  fixture_id: string;
  source: MarketSnapshotSource;
  bookmaker: string;
  market: MarketKind;
  line: number | null;
  odds_raw: Record<string, number>;
  devig_probs: Record<string, number>;
  devig_method: string;
  first_observed: string;
  captured_at: string;
  revision: number;
}

interface RawRow {
  id: number;
  fixture_id: string;
  source: string;
  bookmaker: string;
  market: string;
  line: number | null;
  odds_raw_json: string;
  devig_probs_json: string;
  devig_method: string;
  first_observed: string;
  captured_at: string;
  revision: number;
}

function toRow(r: RawRow): MarketSnapshotRow {
  return {
    id: r.id,
    fixture_id: r.fixture_id,
    source: r.source as MarketSnapshotSource,
    bookmaker: r.bookmaker,
    market: r.market as MarketKind,
    line: r.line,
    odds_raw: JSON.parse(r.odds_raw_json) as Record<string, number>,
    devig_probs: JSON.parse(r.devig_probs_json) as Record<string, number>,
    devig_method: r.devig_method,
    first_observed: r.first_observed,
    captured_at: r.captured_at,
    revision: r.revision,
  };
}

const KEY_WHERE =
  "fixture_id = ? AND source = ? AND bookmaker = ? AND market = ? AND line IS ?";

/** Tambah satu revisi snapshot. Baris lama tidak pernah diubah. */
export function appendMarketSnapshot(
  db: DatabaseSync,
  input: MarketSnapshotInput,
): MarketSnapshotRow {
  ensureMarketSnapshotSchema(db);
  const oddsJson = JSON.stringify(input.odds_raw);
  const keyParams = [input.fixture_id, input.source, input.bookmaker, input.market, input.line];
  const last = db
    .prepare(
      `SELECT * FROM market_snapshots WHERE ${KEY_WHERE} ORDER BY revision DESC LIMIT 1`,
    )
    .get(...keyParams) as unknown as RawRow | undefined;

  let firstObserved = input.first_observed ?? null;
  if (firstObserved == null) {
    firstObserved =
      last && last.odds_raw_json === oddsJson ? last.first_observed : input.captured_at;
  }
  const revision = (last?.revision ?? 0) + 1;
  const { probs, method } = devigFor(input.market, input.odds_raw);
  const res = db
    .prepare(
      `INSERT INTO market_snapshots
         (fixture_id, source, bookmaker, market, line, odds_raw_json, devig_probs_json,
          devig_method, first_observed, captured_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.fixture_id,
      input.source,
      input.bookmaker,
      input.market,
      input.line,
      oddsJson,
      JSON.stringify(probs),
      method,
      firstObserved,
      input.captured_at,
      revision,
    );
  const row = db
    .prepare("SELECT * FROM market_snapshots WHERE id = ?")
    .get(Number(res.lastInsertRowid)) as unknown as RawRow;
  return toRow(row);
}

/** Semua revisi untuk satu kunci quote, urut revisi menaik (untuk audit/test). */
export function listMarketSnapshots(
  db: DatabaseSync,
  fixtureId: string,
  market: MarketKind,
  line: number | null,
): MarketSnapshotRow[] {
  ensureMarketSnapshotSchema(db);
  const rows = db
    .prepare(
      `SELECT * FROM market_snapshots
       WHERE fixture_id = ? AND market = ? AND line IS ?
       ORDER BY source, bookmaker, revision ASC`,
    )
    .all(fixtureId, market, line) as unknown as RawRow[];
  return rows.map(toRow);
}

// ---------------------------------------------------------------------------
// Selector quote ketat (terkunci pada decision_ts)
// ---------------------------------------------------------------------------

export type MarketAbstainReason =
  | "no_snapshot"
  | "future_quote"
  | "in_play_quote"
  | "stale_quote";

export interface MarketQuoteSelection {
  quote: MarketSnapshotRow | null;
  reason: MarketAbstainReason | null;
  /** Usia quote terpilih terhadap decision_ts (ms); null bila abstain. */
  age_ms: number | null;
}

export function selectMarketQuote(
  db: DatabaseSync,
  q: {
    fixture_id: string;
    market: MarketKind;
    line: number | null;
    decision_ts: string;
    kickoff_ts: string;
    max_age_ms?: number;
    /** Bila diisi, hanya quote dari sumber ini yang dipertimbangkan. */
    source?: MarketSnapshotSource;
  },
): MarketQuoteSelection {
  ensureMarketSnapshotSchema(db);
  const maxAge = q.max_age_ms ?? MARKET_MAX_AGE_MS;
  const decisionMs = Date.parse(q.decision_ts);
  const kickoffMs = Date.parse(q.kickoff_ts);
  let rows = db
    .prepare(
      `SELECT * FROM market_snapshots
       WHERE fixture_id = ? AND market = ? AND line IS ?
       ORDER BY first_observed ASC, revision ASC, id ASC`,
    )
    .all(q.fixture_id, q.market, q.line) as unknown as RawRow[];
  if (q.source) rows = rows.filter((r) => r.source === q.source);
  if (rows.length === 0) return { quote: null, reason: "no_snapshot", age_ms: null };

  const eligible = rows.filter((r) => Date.parse(r.first_observed) <= decisionMs);
  if (eligible.length === 0) return { quote: null, reason: "future_quote", age_ms: null };

  const preKickoff = eligible.filter((r) => Date.parse(r.first_observed) < kickoffMs);
  if (preKickoff.length === 0) return { quote: null, reason: "in_play_quote", age_ms: null };

  const fresh = preKickoff.filter(
    (r) => decisionMs - Date.parse(r.first_observed) <= maxAge,
  );
  if (fresh.length === 0) return { quote: null, reason: "stale_quote", age_ms: null };

  // Quote yang dilihat pengambil keputusan = observasi SAH terakhir
  // pada/saat decision_ts (first_observed terbesar; seri → revisi terbesar).
  const chosen = fresh[fresh.length - 1];
  return {
    quote: toRow(chosen),
    reason: null,
    age_ms: decisionMs - Date.parse(chosen.first_observed),
  };
}
