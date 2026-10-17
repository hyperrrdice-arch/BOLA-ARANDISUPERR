/**
 * MIGRASI SATU KALI (DB SNAPSHOT T2b) — pensiunkan tabel `analysis_runs`.
 *
 * Alur: salin 2 baris riwayat lama dari `data/thestats_dataset.db` ke
 * `data/analysis_snapshots.db`, THEN DROP `analysis_runs`. TIDAK ada
 * dual-write: route sudah dialihkan ke snapshot sebelum script ini jalan.
 *
 * Kolom ringkas migrated di-backfill dari `view_json` (yang dibawa utuh),
 * hanya jika ada — nilai karangan lebih buruk dari NULL. `captured_utc` dan
 * `lead_time_minutes` dihitung dari `created_at` lama + kickoff asli,
 * BUKAN dari jam sekarang (artinya analisis saat itu, bukan analisis live).
 *
 * Jalankan: npx tsx scripts/migrate-analysis-runs.ts [--dry-run]
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { deriveMarketKey, getSnapshotDb } from "../lib/db/analysis-snapshot";

const DRY_RUN = process.argv.includes("--dry-run");
const LEGACY_DB = path.join(process.cwd(), "data", "thestats_dataset.db");
const LEGACY_TABLE = "analysis_runs";

if (!fs.existsSync(LEGACY_DB)) {
  console.error(`[migrate] ${LEGACY_DB} tidak ada — tidak ada yang dimigrasi.`);
  process.exit(0);
}

const legacy = new DatabaseSync(LEGACY_DB, { readOnly: true });
/** Koneksi terpisah hanya untuk DROP di akhir (koneksi baca sengaja readOnly). */
let legacyRw: DatabaseSync | null = null;
const hasLegacy = !!legacy
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
  .get(LEGACY_TABLE);
if (!hasLegacy) {
  console.log("[migrate] Tabel analysis_runs sudah tidak ada — migrasi selesai sebelumnya.");
  legacy.close();
  process.exit(0);
}

interface LegacyRow {
  run_id: number;
  match_id: string;
  competition_id_hint: string;
  home_team: string | null;
  away_team: string | null;
  created_at: string;
  duration_ms: number | null;
  view_json: string;
  planner_trace_json: string | null;
}

const rows = legacy
  .prepare(`SELECT run_id, match_id, competition_id_hint, home_team, away_team, created_at, duration_ms, view_json, planner_trace_json FROM ${LEGACY_TABLE} ORDER BY run_id`)
  .all() as LegacyRow[];

/** Kickoff asli dari tabel matches (analisis lama dibuat pre-match). */
function lookupKickoff(matchId: string): string | null {
  const r = legacy.prepare("SELECT utc_date FROM matches WHERE match_id = ?").get(matchId) as { utc_date?: string } | undefined;
  return r?.utc_date ?? null;
}

/** "2026-10-17 16:50:37" (UTC) → ISO 8601. */
function sqliteUtcToIso(s: string): string | null {
  if (!s) return null;
  const iso = s.includes("T") ? s : `${s.replace(" ", "T")}Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

const db = getSnapshotDb();
let migrated = 0;

for (const row of rows) {
  let view: any = null;
  try {
    view = JSON.parse(row.view_json);
  } catch {
    console.warn(`[migrate] run ${row.run_id} (${row.match_id}): view_json bukan JSON valid — kolom ringkas dilewati.`);
  }

  const capturedIso = sqliteUtcToIso(row.created_at);
  const kickoff = lookupKickoff(row.match_id);
  let leadTimeMinutes: number | null = null;
  if (capturedIso && kickoff) {
    const delta = Date.parse(kickoff) - Date.parse(capturedIso);
    if (!Number.isNaN(delta)) leadTimeMinutes = Math.round(delta / 60000);
  }

  // Backfill ringan dari view (opsional — hanya kalau ada).
  const hero = view?.kuantitatif?.hero ?? {};
  const evTop = hero.ev_teratas ?? null;
  const dc = view?.kuantitatif?.detail?.metode?.dixon_coles ?? {};
  const kellyTabel = view?.kuantitatif?.detail?.kelly?.tabel;
  const homeTeam = view?.match?.home ?? row.home_team;
  const awayTeam = view?.match?.away ?? row.away_team;
  const evPct = evTop?.ev_percentage != null ? parseFloat(String(evTop.ev_percentage).replace(",", ".")) : null;

  const payload = {
    match_id: row.match_id,
    competition_name: view?.match?.competition ?? null,
    home_team: homeTeam ?? null,
    away_team: awayTeam ?? null,
    kickoff_utc: kickoff,
    captured_utc: capturedIso ?? new Date().toISOString(),
    lead_time_minutes: leadTimeMinutes,
    cache_key_hint: row.competition_id_hint ?? "",
    verdict: view?.ringkasan?.verdict ?? null,
    confidence: view?.ringkasan?.keyakinan ?? null,
    recommended_market: evTop ? `${evTop.market} — ${evTop.selection}` : null,
    recommended_market_key: evTop ? deriveMarketKey(evTop.market, evTop.selection, homeTeam, awayTeam) : null,
    recommended_odds: num(evTop?.odds),
    recommended_ev_pct: Number.isFinite(evPct) ? evPct : null,
    stake_pct: null, // versi view lama tidak menyimpan stake per market
    prob_home: num(hero.prob?.home),
    prob_draw: num(hero.prob?.draw),
    prob_away: num(hero.prob?.away),
    fair_odds_home: num(hero.fair_odds?.home),
    fair_odds_draw: num(hero.fair_odds?.draw),
    fair_odds_away: num(hero.fair_odds?.away),
    lambda_home: num(dc.lambda),
    mu_away: num(dc.mu),
    expected_total_goals: num(dc.expected_total_goals),
    prob_btts: num(dc.btts?.yes),
    prob_over_2_5: num(dc.over_under?.line_2_5?.over),
    value_bets_json: Array.isArray(kellyTabel) && kellyTabel.length > 0 ? JSON.stringify(kellyTabel) : null,
    planner_model: null, // model planner tidak direkam di analysis_runs lama
    syndicate_models: null,
    editorial_model: null,
    app_version: null,
    is_grounded: null,
    is_fallback: null,
    duration_ms: row.duration_ms ?? null,
    view_json: row.view_json,
    trace_json: row.planner_trace_json ?? null,
  };

  if (DRY_RUN) {
    console.log(`[dry-run] run ${row.run_id} → ${row.match_id} (lead ${leadTimeMinutes} menit)`);
    migrated++;
    continue;
  }

  // Idempoten: kalau baris yang sama sudah pernah termigrasi (run script
  // terputus sebelum DROP), jangan insert dua kali.
  const already = db.prepare(`
    SELECT 1 AS dup FROM analysis_snapshots
    WHERE match_id = ? AND captured_utc = ? AND duration_ms IS ? AND length(view_json) = ?
    LIMIT 1
  `).get(row.match_id, payload.captured_utc, row.duration_ms ?? null, row.view_json.length);
  if (already) {
    console.log(`[migrate] run ${row.run_id} → sudah ada di snapshot (skip, idempoten).`);
    migrated++;
    continue;
  }

  db.prepare(`
    INSERT INTO analysis_snapshots (
      match_id, competition_name, home_team, away_team, kickoff_utc, captured_utc,
      lead_time_minutes, cache_key_hint, verdict, confidence, recommended_market,
      recommended_market_key, recommended_odds, recommended_ev_pct, stake_pct,
      prob_home, prob_draw, prob_away,
      fair_odds_home, fair_odds_draw, fair_odds_away,
      lambda_home, mu_away, expected_total_goals, prob_btts, prob_over_2_5,
      value_bets_json, planner_model, syndicate_models, editorial_model,
      app_version, is_grounded, is_fallback, duration_ms, view_json, trace_json
    ) VALUES (
      :match_id, :competition_name, :home_team, :away_team, :kickoff_utc, :captured_utc,
      :lead_time_minutes, :cache_key_hint, :verdict, :confidence, :recommended_market,
      :recommended_market_key, :recommended_odds, :recommended_ev_pct, :stake_pct,
      :prob_home, :prob_draw, :prob_away,
      :fair_odds_home, :fair_odds_draw, :fair_odds_away,
      :lambda_home, :mu_away, :expected_total_goals, :prob_btts, :prob_over_2_5,
      :value_bets_json, :planner_model, :syndicate_models, :editorial_model,
      :app_version, :is_grounded, :is_fallback, :duration_ms, :view_json, :trace_json
    )
  `).run(payload as Record<string, unknown>);
  migrated++;
  console.log(`[migrate] run ${row.run_id} → snapshot ${row.match_id} (lead ${leadTimeMinutes} menit)`);
}

if (DRY_RUN) {
  console.log(`\n[migrate] DRY RUN: ${migrated} baris akan dimigrasi. Tabel ${LEGACY_TABLE} belum disentuh.`);
  legacy.close();
  process.exit(0);
}

// Baru DROP setelah semua baris tersalin.
legacyRw = new DatabaseSync(LEGACY_DB);
legacyRw.exec(`DROP TABLE IF EXISTS ${LEGACY_TABLE};`);
legacyRw.close();
legacy.close();

const remaining = db.prepare("SELECT count(*) AS c FROM analysis_snapshots").get() as { c: number };
console.log(`\n[migrate] Selesai: ${migrated} baris dimigrasi, ${LEGACY_TABLE} di-DROP, total snapshot = ${remaining.c}.`);