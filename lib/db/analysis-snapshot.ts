/**
 * DB SNAPSHOT — riwayat analisis permanen sebagai data pribadi (append-only).
 *
 * File DB terpisah: `data/analysis_snapshots.db` (di-gitignore). TIDAK bisa
 * di-rebuild tanpa menjalankan ulang LLM — jangan pernah DELETE/DROP di jalur
 * produksi. Kontrak lengkap: `docs/db-snapshot.md`.
 *
 * - `analysis_snapshots`: hasil pipeline kita, append-only, superset dari
 *   mantan tabel `analysis_runs` (cache + korpus evaluasi).
 * - `match_outcomes`: data eksternal per match, boleh di-refresh (upsert).
 * - `v_snapshot_eval` / `v_snapshot_eval_market`: VIEW perbandingan
 *   prediksi vs hasil. Pemetaan market → hasil aktual hidup di sini
 *   (CASE): market baru = ubah VIEW, bukan migrasi data.
 * - Kolom `recommended_market_key` sengaja TANPA CHECK constraint: key
 *   di luar konvensi tetap disimpan apa adanya (string ternormalisasi).
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

let snapshotDbInstance: DatabaseSync | null = null;

export function getSnapshotDbPath(): string {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return path.join(dataDir, "analysis_snapshots.db");
}

export function getSnapshotDb(): DatabaseSync {
  if (snapshotDbInstance) {
    return snapshotDbInstance;
  }

  const db = new DatabaseSync(getSnapshotDbPath());

  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  ensureSnapshotSchema(db);
  ensureSnapshotColumns(db);

  snapshotDbInstance = db;
  return snapshotDbInstance;
}

/**
 * Tambah kolom baru ke tabel yang SUDAH ada (CREATE TABLE IF NOT EXISTS
 * nggak menambah kolom ke DB lama). Idempotent via PRAGMA table_info.
 */
export function ensureSnapshotColumns(db: DatabaseSync): void {
  const cols = new Set(
    (db.prepare("PRAGMA table_info(analysis_snapshots)").all() as { name: string }[]).map((c) => c.name)
  );
  if (!cols.has("panel_market")) {
    db.exec("ALTER TABLE analysis_snapshots ADD COLUMN panel_market TEXT");
  }
  if (!cols.has("panel_market_key")) {
    db.exec("ALTER TABLE analysis_snapshots ADD COLUMN panel_market_key TEXT");
  }
}

/**
 * DDL idempotent (semua IF NOT EXISTS). Diekspor agar test bisa memanggil
 * dua kali untuk membuktikan "dibuka dua kali tidak error".
 */
export function ensureSnapshotSchema(db: DatabaseSync): void {
  // VIEW selalu DROP + CREATE: definisi VIEW bisa saja tertinggal versi lama
  // (CREATE VIEW IF NOT EXISTS nggak memperbarui). View itu derived — nol
  // data user di dalamnya, jadi rebuild aman. Urutan: dependent dulu.
  db.exec(`
    DROP VIEW IF EXISTS v_snapshot_eval_market;
    DROP VIEW IF EXISTS v_snapshot_eval;
  `);
  db.exec(`
    -- ======================================================================
    -- Tabel 1: hasil analisis kita (append-only, TANPA DELETE di produksi)
    -- ======================================================================
    CREATE TABLE IF NOT EXISTS analysis_snapshots (
      snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id TEXT NOT NULL,
      competition_id TEXT,
      competition_name TEXT,
      home_team TEXT,
      away_team TEXT,
      kickoff_utc TEXT,
      captured_utc TEXT NOT NULL,
      lead_time_minutes INTEGER,
      cache_key_hint TEXT NOT NULL DEFAULT '',
      verdict TEXT,
      confidence TEXT,
      recommended_market TEXT,
      recommended_market_key TEXT,
      -- Rekomendasi PANEL (arbiter/supreme), beda dari "EV teratas" di atas:
      -- dua definisi sengaja dipisah supaya evaluasi bisa menghitung keduanya.
      panel_market TEXT,
      panel_market_key TEXT,
      recommended_odds REAL,
      recommended_ev_pct REAL,
      stake_pct REAL,
      prob_home REAL,
      prob_draw REAL,
      prob_away REAL,
      fair_odds_home REAL,
      fair_odds_draw REAL,
      fair_odds_away REAL,
      lambda_home REAL,
      mu_away REAL,
      expected_total_goals REAL,
      prob_btts REAL,
      prob_over_2_5 REAL,
      value_bets_json TEXT,
      planner_model TEXT,
      syndicate_models TEXT,
      editorial_model TEXT,
      app_version TEXT,
      is_grounded INTEGER,
      is_fallback INTEGER,
      duration_ms INTEGER,
      view_json TEXT NOT NULL,
      trace_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_lookup
      ON analysis_snapshots(match_id, cache_key_hint, snapshot_id DESC);
    CREATE INDEX IF NOT EXISTS idx_snapshots_kickoff ON analysis_snapshots(kickoff_utc);
    CREATE INDEX IF NOT EXISTS idx_snapshots_match ON analysis_snapshots(match_id);

    -- ======================================================================
    -- Tabel 2: hasil aktual per match (1 baris, boleh di-refresh)
    -- ======================================================================
    CREATE TABLE IF NOT EXISTS match_outcomes (
      match_id TEXT PRIMARY KEY,
      fetched_utc TEXT NOT NULL,
      status TEXT,
      home_goals INTEGER,
      away_goals INTEGER,
      ht_home_goals INTEGER,
      ht_away_goals INTEGER,
      ftr TEXT,
      xg_home REAL,
      xg_away REAL,
      npxg_home REAL,
      npxg_away REAL,
      shots_home INTEGER,
      shots_away INTEGER,
      sot_home INTEGER,
      sot_away INTEGER,
      corners_home INTEGER,
      corners_away INTEGER,
      cards_home INTEGER,
      cards_away INTEGER,
      possession_home REAL,
      closing_odds_home REAL,
      closing_odds_draw REAL,
      closing_odds_away REAL,
      closing_over_2_5 REAL,
      closing_under_2_5 REAL,
      stats_json TEXT,
      source TEXT,
      closing_source TEXT
    );

    -- ======================================================================
    -- VIEW evaluasi per snapshot.
    -- Penjaga leakage: hanya lead_time_minutes > 0 (pre-match) dan
    -- status = 'finished'. Snapshot tanpa outcome tidak lolos filter
    -- status ini — daftar "belum ada outcome" dihitung report dari
    -- analysis_snapshots minus VIEW.
    -- Brier = multiclass sum over 3 outcomes (konvensi docs/backtest0.1.md,
    -- range 0-2). log_loss = -sum(y_i * ln(p_i)). model_divergence =
    -- rata-rata |prob model - 1/odds closing| 1X2 (implied, belum vig-strip).
    -- ======================================================================
    CREATE VIEW IF NOT EXISTS v_snapshot_eval AS
    SELECT
      base.*,
      CASE
        WHEN base.stake_pct IS NULL OR base.recommended_odds IS NULL THEN NULL
        WHEN base.hit_recommended = 1 THEN base.stake_pct * (base.recommended_odds - 1)
        WHEN base.hit_recommended = 0.5 THEN 0
        WHEN base.hit_recommended = 0 THEN -base.stake_pct
        ELSE NULL
      END AS pl_result_pct,
      CASE
        WHEN base.actual_result IS NULL OR base.prob_home IS NULL
          OR base.prob_draw IS NULL OR base.prob_away IS NULL THEN NULL
        ELSE
          (base.prob_home - (base.actual_result = 'H')) * (base.prob_home - (base.actual_result = 'H')) +
          (base.prob_draw - (base.actual_result = 'D')) * (base.prob_draw - (base.actual_result = 'D')) +
          (base.prob_away - (base.actual_result = 'A')) * (base.prob_away - (base.actual_result = 'A'))
      END AS brier_1x2,
      CASE
        WHEN base.actual_result IS NULL OR base.prob_home IS NULL
          OR base.prob_draw IS NULL OR base.prob_away IS NULL THEN NULL
        ELSE -(
          (base.actual_result = 'H') * ln(MAX(base.prob_home, 1e-12)) +
          (base.actual_result = 'D') * ln(MAX(base.prob_draw, 1e-12)) +
          (base.actual_result = 'A') * ln(MAX(base.prob_away, 1e-12))
        )
      END AS log_loss_1x2,
      CASE
        WHEN base.prob_home IS NULL OR base.prob_draw IS NULL OR base.prob_away IS NULL
          OR base.closing_odds_home IS NULL OR base.closing_odds_draw IS NULL OR base.closing_odds_away IS NULL
          OR base.closing_odds_home <= 0 OR base.closing_odds_draw <= 0 OR base.closing_odds_away <= 0 THEN NULL
        ELSE (
          ABS(base.prob_home - 1.0 / base.closing_odds_home) +
          ABS(base.prob_draw - 1.0 / base.closing_odds_draw) +
          ABS(base.prob_away - 1.0 / base.closing_odds_away)
        ) / 3.0
      END AS model_divergence
    FROM (
      SELECT
        s.snapshot_id,
        s.match_id,
        s.competition_id,
        s.competition_name,
        s.home_team,
        s.away_team,
        s.kickoff_utc,
        s.captured_utc,
        s.lead_time_minutes,
        s.verdict,
        s.confidence,
        s.recommended_market,
        s.recommended_market_key,
        s.panel_market,
        s.panel_market_key,
        s.recommended_odds,
        s.recommended_ev_pct,
        s.stake_pct,
        s.prob_home,
        s.prob_draw,
        s.prob_away,
        s.fair_odds_home,
        s.fair_odds_draw,
        s.fair_odds_away,
        s.lambda_home,
        s.mu_away,
        s.expected_total_goals,
        s.prob_btts,
        s.prob_over_2_5,
        s.value_bets_json,
        s.planner_model,
        s.syndicate_models,
        s.editorial_model,
        s.app_version,
        s.is_grounded,
        s.is_fallback,
        s.duration_ms,
        s.view_json,
        s.trace_json,
        o.status AS outcome_status,
        o.home_goals,
        o.away_goals,
        o.ht_home_goals,
        o.ht_away_goals,
        o.ftr,
        o.xg_home,
        o.xg_away,
        o.npxg_home,
        o.npxg_away,
        o.closing_odds_home,
        o.closing_odds_draw,
        o.closing_odds_away,
        o.closing_over_2_5,
        o.closing_under_2_5,
        o.source AS outcome_source,
        o.closing_source,
        CASE WHEN o.home_goals IS NULL OR o.away_goals IS NULL THEN NULL
             WHEN o.home_goals > o.away_goals THEN 'H'
             WHEN o.home_goals = o.away_goals THEN 'D'
             ELSE 'A'
        END AS actual_result,
        CASE WHEN o.home_goals IS NULL OR o.away_goals IS NULL THEN NULL
             WHEN o.home_goals > 0 AND o.away_goals > 0 THEN 1 ELSE 0
        END AS actual_btts,
        CASE WHEN o.home_goals IS NULL OR o.away_goals IS NULL THEN NULL
             WHEN o.home_goals + o.away_goals > 2.5 THEN 1 ELSE 0
        END AS actual_over_2_5,
        -- NULL = key belum dipetakan (BUKAN salah); 0.5 = push (AH DNB imbang).
        -- Skor NULL → NULL (jangan dihitung menang/kalah — audit 2026-10-18).
        CASE
          WHEN o.home_goals IS NULL OR o.away_goals IS NULL THEN NULL
          WHEN s.recommended_market_key IS NULL OR s.recommended_market_key = '' THEN NULL
          WHEN s.recommended_market_key = '1X2_HOME' THEN CASE WHEN o.home_goals > o.away_goals THEN 1 ELSE 0 END
          WHEN s.recommended_market_key = '1X2_DRAW' THEN CASE WHEN o.home_goals = o.away_goals THEN 1 ELSE 0 END
          WHEN s.recommended_market_key = '1X2_AWAY' THEN CASE WHEN o.home_goals < o.away_goals THEN 1 ELSE 0 END
          WHEN s.recommended_market_key = 'BTTS_YES' THEN CASE WHEN o.home_goals > 0 AND o.away_goals > 0 THEN 1 ELSE 0 END
          WHEN s.recommended_market_key = 'BTTS_NO' THEN CASE WHEN o.home_goals = 0 OR o.away_goals = 0 THEN 1 ELSE 0 END
          WHEN s.recommended_market_key = 'O25' THEN CASE WHEN o.home_goals + o.away_goals > 2.5 THEN 1 ELSE 0 END
          WHEN s.recommended_market_key = 'U25' THEN CASE WHEN o.home_goals + o.away_goals <= 2.5 THEN 1 ELSE 0 END
          WHEN s.recommended_market_key = 'AH_DNB_HOME' THEN CASE WHEN o.home_goals = o.away_goals THEN 0.5 WHEN o.home_goals > o.away_goals THEN 1 ELSE 0 END
          WHEN s.recommended_market_key = 'AH_DNB_AWAY' THEN CASE WHEN o.home_goals = o.away_goals THEN 0.5 WHEN o.home_goals < o.away_goals THEN 1 ELSE 0 END
          ELSE NULL
        END AS hit_recommended,
        -- Sama seperti hit_recommended, tapi untuk rekomendasi PANEL (arbiter).
        -- NULL = key belum dipetakan / panel tidak menyebut market yang dikenal.
        CASE
          WHEN o.home_goals IS NULL OR o.away_goals IS NULL THEN NULL
          WHEN s.panel_market_key IS NULL OR s.panel_market_key = '' THEN NULL
          WHEN s.panel_market_key = '1X2_HOME' THEN CASE WHEN o.home_goals > o.away_goals THEN 1 ELSE 0 END
          WHEN s.panel_market_key = '1X2_DRAW' THEN CASE WHEN o.home_goals = o.away_goals THEN 1 ELSE 0 END
          WHEN s.panel_market_key = '1X2_AWAY' THEN CASE WHEN o.home_goals < o.away_goals THEN 1 ELSE 0 END
          WHEN s.panel_market_key = 'BTTS_YES' THEN CASE WHEN o.home_goals > 0 AND o.away_goals > 0 THEN 1 ELSE 0 END
          WHEN s.panel_market_key = 'BTTS_NO' THEN CASE WHEN o.home_goals = 0 OR o.away_goals = 0 THEN 1 ELSE 0 END
          WHEN s.panel_market_key = 'O25' THEN CASE WHEN o.home_goals + o.away_goals > 2.5 THEN 1 ELSE 0 END
          WHEN s.panel_market_key = 'U25' THEN CASE WHEN o.home_goals + o.away_goals <= 2.5 THEN 1 ELSE 0 END
          WHEN s.panel_market_key = 'AH_DNB_HOME' THEN CASE WHEN o.home_goals = o.away_goals THEN 0.5 WHEN o.home_goals > o.away_goals THEN 1 ELSE 0 END
          WHEN s.panel_market_key = 'AH_DNB_AWAY' THEN CASE WHEN o.home_goals = o.away_goals THEN 0.5 WHEN o.home_goals < o.away_goals THEN 1 ELSE 0 END
          ELSE NULL
        END AS hit_panel
      FROM analysis_snapshots s
      LEFT JOIN match_outcomes o ON o.match_id = s.match_id
      WHERE s.lead_time_minutes IS NOT NULL
        AND s.lead_time_minutes > 0
        AND o.status = 'finished'
    ) base;

    -- ======================================================================
    -- VIEW evaluasi per market: SEMUA market di value_bets_json (termasuk
    -- EV negatif), diekspansi via json_each. Market tanpa pemetaan ->
    -- market_hit NULL ("belum dipetakan"), bukan dihitung benar.
    -- ======================================================================
    CREATE VIEW IF NOT EXISTS v_snapshot_eval_market AS
    SELECT
      e.snapshot_id,
      e.match_id,
      e.app_version,
      e.planner_model,
      e.home_team,
      e.away_team,
      je.key AS market_index,
      json_extract(je.value, '$.market_name') AS market_name,
      json_extract(je.value, '$.selection') AS selection,
      json_extract(je.value, '$.bookmaker_odds') AS odds,
      json_extract(je.value, '$.fair_odds') AS fair_odds,
      json_extract(je.value, '$.expected_value') AS expected_value,
      json_extract(je.value, '$.ev_percentage') AS ev_percentage,
      json_extract(je.value, '$.is_positive_ev') AS is_positive_ev,
      json_extract(je.value, '$.recommended_stake_percentage') AS stake_pct,
      e.actual_result,
      e.actual_btts,
      e.actual_over_2_5,
      e.home_goals,
      e.away_goals,
      -- Key konvensi untuk agregasi lintas match (longgar; tak dikenal = NULL)
      CASE
        WHEN json_extract(je.value, '$.market_name') = '1X2'
          AND json_extract(je.value, '$.selection') = e.home_team || ' Menang' THEN '1X2_HOME'
        WHEN json_extract(je.value, '$.market_name') = '1X2'
          AND json_extract(je.value, '$.selection') = 'Hasil Imbang (Draw)' THEN '1X2_DRAW'
        WHEN json_extract(je.value, '$.market_name') = '1X2'
          AND json_extract(je.value, '$.selection') = e.away_team || ' Menang' THEN '1X2_AWAY'
        WHEN json_extract(je.value, '$.market_name') = 'Over/Under 2.5'
          AND json_extract(je.value, '$.selection') LIKE 'Over%' THEN 'O25'
        WHEN json_extract(je.value, '$.market_name') = 'Over/Under 2.5'
          AND json_extract(je.value, '$.selection') LIKE 'Under%' THEN 'U25'
        WHEN json_extract(je.value, '$.market_name') = 'Both Teams to Score'
          AND json_extract(je.value, '$.selection') LIKE '%Yes' THEN 'BTTS_YES'
        WHEN json_extract(je.value, '$.market_name') = 'Both Teams to Score'
          AND json_extract(je.value, '$.selection') LIKE '%No' THEN 'BTTS_NO'
        WHEN json_extract(je.value, '$.market_name') LIKE '%DNB%'
          AND json_extract(je.value, '$.selection') = e.home_team || ' Draw No Bet' THEN 'AH_DNB_HOME'
        WHEN json_extract(je.value, '$.market_name') LIKE '%DNB%'
          AND json_extract(je.value, '$.selection') = e.away_team || ' Draw No Bet' THEN 'AH_DNB_AWAY'
        ELSE NULL
      END AS market_key,
      CASE
        WHEN e.home_goals IS NULL OR e.away_goals IS NULL THEN NULL
        WHEN json_extract(je.value, '$.market_name') = '1X2'
          AND json_extract(je.value, '$.selection') = e.home_team || ' Menang'
          THEN CASE WHEN e.home_goals > e.away_goals THEN 1 ELSE 0 END
        WHEN json_extract(je.value, '$.market_name') = '1X2'
          AND json_extract(je.value, '$.selection') = 'Hasil Imbang (Draw)'
          THEN CASE WHEN e.home_goals = e.away_goals THEN 1 ELSE 0 END
        WHEN json_extract(je.value, '$.market_name') = '1X2'
          AND json_extract(je.value, '$.selection') = e.away_team || ' Menang'
          THEN CASE WHEN e.home_goals < e.away_goals THEN 1 ELSE 0 END
        WHEN json_extract(je.value, '$.market_name') = 'Over/Under 2.5'
          AND json_extract(je.value, '$.selection') LIKE 'Over%'
          THEN CASE WHEN e.home_goals + e.away_goals > 2.5 THEN 1 ELSE 0 END
        WHEN json_extract(je.value, '$.market_name') = 'Over/Under 2.5'
          AND json_extract(je.value, '$.selection') LIKE 'Under%'
          THEN CASE WHEN e.home_goals + e.away_goals <= 2.5 THEN 1 ELSE 0 END
        WHEN json_extract(je.value, '$.market_name') = 'Both Teams to Score'
          AND json_extract(je.value, '$.selection') LIKE '%Yes'
          THEN CASE WHEN e.home_goals > 0 AND e.away_goals > 0 THEN 1 ELSE 0 END
        WHEN json_extract(je.value, '$.market_name') = 'Both Teams to Score'
          AND json_extract(je.value, '$.selection') LIKE '%No'
          THEN CASE WHEN e.home_goals = 0 OR e.away_goals = 0 THEN 1 ELSE 0 END
        WHEN json_extract(je.value, '$.market_name') LIKE '%DNB%'
          AND json_extract(je.value, '$.selection') = e.home_team || ' Draw No Bet'
          THEN CASE WHEN e.home_goals = e.away_goals THEN 0.5 WHEN e.home_goals > e.away_goals THEN 1 ELSE 0 END
        WHEN json_extract(je.value, '$.market_name') LIKE '%DNB%'
          AND json_extract(je.value, '$.selection') = e.away_team || ' Draw No Bet'
          THEN CASE WHEN e.home_goals = e.away_goals THEN 0.5 WHEN e.home_goals < e.away_goals THEN 1 ELSE 0 END
        ELSE NULL
      END AS market_hit
    FROM v_snapshot_eval e,
         json_each(CASE WHEN e.value_bets_json IS NOT NULL AND json_valid(e.value_bets_json)
                        THEN e.value_bets_json ELSE '[]' END) je;
  `);
}

// ============================================================================
// SNAPSHOT (append-only)
// ============================================================================

export interface AnalysisSnapshotInput {
  match_id: string;
  competition_id?: string | null;
  competition_name?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  /** ISO UTC dari TheStatsAPI, mis. "2026-10-17T19:00:00Z". */
  kickoff_utc?: string | null;
  cache_key_hint?: string;
  verdict?: string | null;
  confidence?: string | null;
  recommended_market?: string | null;
  recommended_market_key?: string | null;
  /** Rekomendasi panel (arbiter/supreme) — teks mentah, buat audit. */
  panel_market?: string | null;
  /** Key konvensi untuk panel_market; NULL kalau panel tidak menyebut market yang dipetakan. */
  panel_market_key?: string | null;
  recommended_odds?: number | null;
  recommended_ev_pct?: number | null;
  stake_pct?: number | null;
  prob_home?: number | null;
  prob_draw?: number | null;
  prob_away?: number | null;
  fair_odds_home?: number | null;
  fair_odds_draw?: number | null;
  fair_odds_away?: number | null;
  lambda_home?: number | null;
  mu_away?: number | null;
  expected_total_goals?: number | null;
  prob_btts?: number | null;
  prob_over_2_5?: number | null;
  value_bets_json?: string | null;
  planner_model?: string | null;
  syndicate_models?: string | null;
  editorial_model?: string | null;
  app_version?: string | null;
  is_grounded?: number | null;
  is_fallback?: number | null;
  duration_ms?: number | null;
  view_json: string;
  trace_json?: string | null;
}

/**
 * Simpan satu snapshot analisis. Append-only: tidak ada upsert/delete.
 * `captured_utc` diisi di sini (ISO UTC) dan `lead_time_minutes` dihitung
 * dari `kickoff_utc` — negatif berarti live/pasca-kickoff (dikecualikan
 * dari evaluasi oleh VIEW). Return: snapshot_id baris baru.
 */
export function insertSnapshot(input: AnalysisSnapshotInput): number {
  const db = getSnapshotDb();
  const capturedUtc = new Date().toISOString();

  let leadTimeMinutes: number | null = null;
  if (input.kickoff_utc) {
    const kickoffMs = Date.parse(input.kickoff_utc);
    if (!Number.isNaN(kickoffMs)) {
      leadTimeMinutes = Math.round((kickoffMs - Date.now()) / 60000);
    }
  }

  const result = db.prepare(`
    INSERT INTO analysis_snapshots (
      match_id, competition_id, competition_name, home_team, away_team,
      kickoff_utc, captured_utc, lead_time_minutes, cache_key_hint,
      verdict, confidence, recommended_market, recommended_market_key,
      panel_market, panel_market_key,
      recommended_odds, recommended_ev_pct, stake_pct,
      prob_home, prob_draw, prob_away,
      fair_odds_home, fair_odds_draw, fair_odds_away,
      lambda_home, mu_away, expected_total_goals, prob_btts, prob_over_2_5,
      value_bets_json, planner_model, syndicate_models, editorial_model,
      app_version, is_grounded, is_fallback, duration_ms, view_json, trace_json
    ) VALUES (
      :match_id, :competition_id, :competition_name, :home_team, :away_team,
      :kickoff_utc, :captured_utc, :lead_time_minutes, :cache_key_hint,
      :verdict, :confidence, :recommended_market, :recommended_market_key,
      :panel_market, :panel_market_key,
      :recommended_odds, :recommended_ev_pct, :stake_pct,
      :prob_home, :prob_draw, :prob_away,
      :fair_odds_home, :fair_odds_draw, :fair_odds_away,
      :lambda_home, :mu_away, :expected_total_goals, :prob_btts, :prob_over_2_5,
      :value_bets_json, :planner_model, :syndicate_models, :editorial_model,
      :app_version, :is_grounded, :is_fallback, :duration_ms, :view_json, :trace_json
    )
  `).run({
    ...input,
    competition_id: input.competition_id ?? null,
    competition_name: input.competition_name ?? null,
    home_team: input.home_team ?? null,
    away_team: input.away_team ?? null,
    kickoff_utc: input.kickoff_utc ?? null,
    captured_utc: capturedUtc,
    lead_time_minutes: leadTimeMinutes,
    cache_key_hint: input.cache_key_hint ?? "",
    verdict: input.verdict ?? null,
    confidence: input.confidence ?? null,
    recommended_market: input.recommended_market ?? null,
    recommended_market_key: input.recommended_market_key ?? null,
    panel_market: input.panel_market ?? null,
    panel_market_key: input.panel_market_key ?? null,
    recommended_odds: input.recommended_odds ?? null,
    recommended_ev_pct: input.recommended_ev_pct ?? null,
    stake_pct: input.stake_pct ?? null,
    prob_home: input.prob_home ?? null,
    prob_draw: input.prob_draw ?? null,
    prob_away: input.prob_away ?? null,
    fair_odds_home: input.fair_odds_home ?? null,
    fair_odds_draw: input.fair_odds_draw ?? null,
    fair_odds_away: input.fair_odds_away ?? null,
    lambda_home: input.lambda_home ?? null,
    mu_away: input.mu_away ?? null,
    expected_total_goals: input.expected_total_goals ?? null,
    prob_btts: input.prob_btts ?? null,
    prob_over_2_5: input.prob_over_2_5 ?? null,
    value_bets_json: input.value_bets_json ?? null,
    planner_model: input.planner_model ?? null,
    syndicate_models: input.syndicate_models ?? null,
    editorial_model: input.editorial_model ?? null,
    app_version: input.app_version ?? null,
    is_grounded: input.is_grounded ?? null,
    is_fallback: input.is_fallback ?? null,
    duration_ms: input.duration_ms ?? null,
    trace_json: input.trace_json ?? null,
  } as Record<string, unknown>);

  return Number(result.lastInsertRowid);
}

export interface FreshSnapshot {
  snapshot_id: number;
  view_json: string;
  duration_ms: number | null;
  captured_utc: string;
  lead_time_minutes: number | null;
}

/**
 * Cache hit: baris terbaru untuk match + hint dalam jendela TTL.
 * Freshness dihitung di JS dari `captured_utc` (ISO) supaya konsisten
 * dengan cara `lead_time_minutes` dihitung.
 */
export function getFreshSnapshot(
  matchId: string,
  cacheKeyHint: string,
  maxAgeMs: number
): FreshSnapshot | null {
  const db = getSnapshotDb();
  // Hanya sajikan run yang grounded dan TIDAK fallback: view template/jalur degradasi
  // tetap tersimpan (history/audit), tapi tidak boleh jadi sumber cache.
  const row = db.prepare(`
    SELECT snapshot_id, view_json, duration_ms, captured_utc, lead_time_minutes
    FROM analysis_snapshots
    WHERE match_id = ? AND cache_key_hint = ?
      AND is_fallback = 0 AND is_grounded = 1
    ORDER BY snapshot_id DESC
    LIMIT 1
  `).get(matchId, cacheKeyHint) as
    | { snapshot_id: number; view_json: string; duration_ms: number | null; captured_utc: string; lead_time_minutes: number | null }
    | undefined;
  if (!row) return null;

  const capturedMs = Date.parse(row.captured_utc);
  if (Number.isNaN(capturedMs) || Date.now() - capturedMs > Math.max(0, maxAgeMs)) {
    return null;
  }
  return row;
}

/** Baseline pertumbuhan korpus snapshot (pengganti getAnalysisRunMetrics). */
export function getSnapshotMetrics(): { snapshotsCount: number; bytes: number } {
  const db = getSnapshotDb();
  const row = db.prepare(`
    SELECT
      count(*) AS runs,
      COALESCE(SUM(
        LENGTH(view_json) +
        COALESCE(LENGTH(trace_json), 0) +
        COALESCE(LENGTH(value_bets_json), 0)
      ), 0) AS bytes
    FROM analysis_snapshots
  `).get() as { runs: number; bytes: number } | undefined;
  return { snapshotsCount: row?.runs ?? 0, bytes: row?.bytes ?? 0 };
}

// ============================================================================
// MATCH OUTCOMES (1 baris per match, boleh di-refresh via upsert)
// ============================================================================

export interface MatchOutcomeInput {
  match_id: string;
  status?: string | null;
  home_goals?: number | null;
  away_goals?: number | null;
  ht_home_goals?: number | null;
  ht_away_goals?: number | null;
  ftr?: string | null;
  xg_home?: number | null;
  xg_away?: number | null;
  npxg_home?: number | null;
  npxg_away?: number | null;
  shots_home?: number | null;
  shots_away?: number | null;
  sot_home?: number | null;
  sot_away?: number | null;
  corners_home?: number | null;
  corners_away?: number | null;
  cards_home?: number | null;
  cards_away?: number | null;
  possession_home?: number | null;
  closing_odds_home?: number | null;
  closing_odds_draw?: number | null;
  closing_odds_away?: number | null;
  closing_over_2_5?: number | null;
  closing_under_2_5?: number | null;
  stats_json?: string | null;
  /** 'local_sqlite' | 'online_api' */
  source?: string | null;
  closing_source?: string | null;
}

/** Idempotent: jalankan ulang tidak menambah baris, hanya refresh nilai. */
export function upsertOutcome(input: MatchOutcomeInput): void {
  const db = getSnapshotDb();
  db.prepare(`
    INSERT INTO match_outcomes (
      match_id, fetched_utc, status, home_goals, away_goals,
      ht_home_goals, ht_away_goals, ftr,
      xg_home, xg_away, npxg_home, npxg_away,
      shots_home, shots_away, sot_home, sot_away,
      corners_home, corners_away, cards_home, cards_away,
      possession_home,
      closing_odds_home, closing_odds_draw, closing_odds_away,
      closing_over_2_5, closing_under_2_5,
      stats_json, source, closing_source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(match_id) DO UPDATE SET
      fetched_utc = excluded.fetched_utc,
      status = excluded.status,
      home_goals = excluded.home_goals,
      away_goals = excluded.away_goals,
      ht_home_goals = excluded.ht_home_goals,
      ht_away_goals = excluded.ht_away_goals,
      ftr = excluded.ftr,
      -- Kolom statistik/enrichment: refresh yang lebih miskin TIDAK boleh menimpa
      -- data terisi dengan NULL (audit 2026-10-18). Goals/status tetap authoritative.
      xg_home = COALESCE(excluded.xg_home, xg_home),
      xg_away = COALESCE(excluded.xg_away, xg_away),
      npxg_home = COALESCE(excluded.npxg_home, npxg_home),
      npxg_away = COALESCE(excluded.npxg_away, npxg_away),
      shots_home = COALESCE(excluded.shots_home, shots_home),
      shots_away = COALESCE(excluded.shots_away, shots_away),
      sot_home = COALESCE(excluded.sot_home, sot_home),
      sot_away = COALESCE(excluded.sot_away, sot_away),
      corners_home = COALESCE(excluded.corners_home, corners_home),
      corners_away = COALESCE(excluded.corners_away, corners_away),
      cards_home = COALESCE(excluded.cards_home, cards_home),
      cards_away = COALESCE(excluded.cards_away, cards_away),
      possession_home = COALESCE(excluded.possession_home, possession_home),
      closing_odds_home = COALESCE(excluded.closing_odds_home, closing_odds_home),
      closing_odds_draw = COALESCE(excluded.closing_odds_draw, closing_odds_draw),
      closing_odds_away = COALESCE(excluded.closing_odds_away, closing_odds_away),
      closing_over_2_5 = COALESCE(excluded.closing_over_2_5, closing_over_2_5),
      closing_under_2_5 = COALESCE(excluded.closing_under_2_5, closing_under_2_5),
      stats_json = COALESCE(excluded.stats_json, stats_json),
      source = excluded.source,
      closing_source = COALESCE(excluded.closing_source, closing_source)
  `).run(
    input.match_id,
    new Date().toISOString(),
    input.status ?? null,
    input.home_goals ?? null,
    input.away_goals ?? null,
    input.ht_home_goals ?? null,
    input.ht_away_goals ?? null,
    input.ftr ?? null,
    input.xg_home ?? null,
    input.xg_away ?? null,
    input.npxg_home ?? null,
    input.npxg_away ?? null,
    input.shots_home ?? null,
    input.shots_away ?? null,
    input.sot_home ?? null,
    input.sot_away ?? null,
    input.corners_home ?? null,
    input.corners_away ?? null,
    input.cards_home ?? null,
    input.cards_away ?? null,
    input.possession_home ?? null,
    input.closing_odds_home ?? null,
    input.closing_odds_draw ?? null,
    input.closing_odds_away ?? null,
    input.closing_over_2_5 ?? null,
    input.closing_under_2_5 ?? null,
    input.stats_json ?? null,
    input.source ?? null,
    input.closing_source ?? null
  );
}

export function getOutcome(matchId: string): Record<string, unknown> | null {
  const db = getSnapshotDb();
  const row = db.prepare("SELECT * FROM match_outcomes WHERE match_id = ?").get(matchId);
  return (row as Record<string, unknown>) ?? null;
}

// ============================================================================
// KONVENSI MARKET KEY (longgar)
// ============================================================================

/**
 * Turunkan market key dari (market_name, selection) pada value_bets.
 * MIRROR dari CASE `v_snapshot_eval_market` — kalau aturan diubah, ubah
 * KEDUA sisi. Market di luar konvensi tetap dapat key (string ternormalisasi,
 * TIDAK dipaksa NONE); pemetaan hasilnya tetap NULL di VIEW (belum dipetakan).
 */
export function deriveMarketKey(
  marketName: string | null | undefined,
  selection: string | null | undefined,
  homeTeam?: string | null,
  awayTeam?: string | null
): string | null {
  if (!marketName || !selection) return null;
  const m = marketName.trim();
  const sel = selection.trim();

  if (m === "1X2") {
    if (homeTeam && sel === `${homeTeam} Menang`) return "1X2_HOME";
    if (sel === "Hasil Imbang (Draw)") return "1X2_DRAW";
    if (awayTeam && sel === `${awayTeam} Menang`) return "1X2_AWAY";
  } else if (m === "Over/Under 2.5") {
    if (/^Over/i.test(sel)) return "O25";
    if (/^Under/i.test(sel)) return "U25";
  } else if (m === "Both Teams to Score") {
    if (/Yes$/i.test(sel)) return "BTTS_YES";
    if (/No$/i.test(sel)) return "BTTS_NO";
  } else if (m.includes("DNB")) {
    if (homeTeam && sel === `${homeTeam} Draw No Bet`) return "AH_DNB_HOME";
    if (awayTeam && sel === `${awayTeam} Draw No Bet`) return "AH_DNB_AWAY";
  }
  return `${m} ${sel}`
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
