/**
 * LAPORAN PERBANDINGAN (DB SNAPSHOT T4) — prediksi vs hasil aktual.
 *
 * READ-ONLY: hanya SELECT, tidak menulis apa pun ke DB snapshot. Aman
 * dijalankan berulang, termasuk saat korpus masih sedikit (semua metrik
 * dihitung dengan penjaga nol-pembagian dan nilai NULL ditampilkan sebagai
 * "belum tersedia", bukan dianggap 0).
 *
 * Aturan yang dijaga di sini:
 * - Snapshot live/pasca-kickoff (lead_time <= 0) DIHITUNG TERPISAH, tidak
 *   masuk angka akurasi (leakage — lihat docs/backtest0.1.md Track C).
 * - Market tanpa pemetaan = "belum dipetakan", bukan "salah".
 * - Statistik dipisah per versi model/commit supaya riwayat tidak tercampur.
 *
 * Jalankan: npx tsx scripts/snapshot-report.ts
 */
import { getSnapshotDb } from "../lib/db/analysis-snapshot";

const db = getSnapshotDb();

function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}
function num(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}
function section(title: string) {
  console.log(`\n${title}\n${"=".repeat(title.length)}`);
}

section("RINGKASAN KORPUS");
const total = (db.prepare("SELECT count(*) AS c FROM analysis_snapshots").get() as any).c as number;
const outcomes = (db.prepare("SELECT count(*) AS c FROM match_outcomes").get() as any).c as number;
const evaluable = (db.prepare("SELECT count(*) AS c FROM v_snapshot_eval").get() as any).c as number;
const liveSnaps = (
  db.prepare("SELECT count(*) AS c FROM analysis_snapshots WHERE lead_time_minutes IS NULL OR lead_time_minutes <= 0").get() as any
).c as number;
console.log(`Total snapshot:            ${total}`);
console.log(`Outcome tersedia:          ${outcomes} match`);
console.log(`Snapshot evaluable:        ${evaluable} (pre-match + finished)`);
console.log(`Snapshot live/lead NULL:   ${liveSnaps} (TIDAK masuk angka akurasi)`);

section("SNAPSHOT PER VERSI MODEL / COMMIT");
const byVersion = db
  .prepare(`
    SELECT COALESCE(planner_model, '—') AS planner_model,
           COALESCE(app_version, '—') AS app_version,
           count(*) AS snapshots,
           sum(CASE WHEN match_id IN (SELECT match_id FROM v_snapshot_eval) THEN 1 ELSE 0 END) AS evaluable
    FROM analysis_snapshots
    GROUP BY planner_model, app_version
    ORDER BY snapshots DESC
  `)
  .all() as any[];
for (const r of byVersion) {
  console.log(`- planner=${r.planner_model} app=${r.app_version}: ${r.snapshots} snapshot, ${r.evaluable} evaluable`);
}
if (byVersion.length === 0) console.log("—");

section("HIT RATE PER MARKET (SEMUA market, termasuk EV negatif)");
const perMarket = db
  .prepare(`
    SELECT market_key,
           count(*) AS bets,
           sum(CASE WHEN market_hit = 1 THEN 1 ELSE 0 END) AS hits,
           sum(CASE WHEN market_hit = 0 THEN 1 ELSE 0 END) AS misses,
           sum(CASE WHEN market_hit = 0.5 THEN 1 ELSE 0 END) AS pushes,
           sum(CASE WHEN market_hit IS NULL THEN 1 ELSE 0 END) AS unmapped
    FROM v_snapshot_eval_market
    GROUP BY market_key
    ORDER BY bets DESC
  `)
  .all() as any[];
for (const r of perMarket) {
  const label = r.market_key ?? "⚠️ belum dipetakan";
  const decided = r.hits + r.misses;
  const rate = decided > 0 ? `${((r.hits / decided) * 100).toFixed(1)}%` : "—";
  console.log(`- ${label}: ${r.bets} bet (${decided} diputuskan) · hit ${r.hits} / miss ${r.misses} / push ${r.pushes} · hit rate ${rate}${r.unmapped > 0 ? ` · belum dipetakan ${r.unmapped}` : ""}`);
}
if (perMarket.length === 0) console.log("— (belum ada snapshot evaluable)");

section("DUA DEFINISI REKOMENDASI (EV-teratas vs PANEL)");
const dual = db
  .prepare(`
    SELECT
      count(*) AS evaluable,
      sum(CASE WHEN hit_recommended IS NOT NULL THEN 1 ELSE 0 END) AS ev_decided,
      sum(CASE WHEN hit_recommended = 1 THEN 1 ELSE 0 END) AS ev_hits,
      sum(CASE WHEN hit_panel IS NOT NULL THEN 1 ELSE 0 END) AS panel_decided,
      sum(CASE WHEN hit_panel = 1 THEN 1 ELSE 0 END) AS panel_hits,
      sum(CASE WHEN recommended_market_key = panel_market_key THEN 1 ELSE 0 END) AS same_key,
      sum(CASE WHEN panel_market_key IS NULL THEN 1 ELSE 0 END) AS panel_unmapped
    FROM v_snapshot_eval
  `)
  .get() as any;
const dualEvDecided = (dual?.ev_decided ?? 0) as number;
const panelDecided = (dual?.panel_decided ?? 0) as number;
console.log(`Rekomendasi EV-teratas: ${dual?.ev_hits ?? 0}/${dualEvDecided} ${dualEvDecided > 0 ? pct((dual?.ev_hits ?? 0) / dualEvDecided) : "—"}`);
console.log(`Rekomendasi PANEL:      ${dual?.panel_hits ?? 0}/${panelDecided} ${panelDecided > 0 ? pct((dual?.panel_hits ?? 0) / panelDecided) : "—"}`);
console.log(`Key identik (keduanya sama): ${dual?.same_key ?? 0}/${dual?.evaluable ?? 0} snapshot`);
console.log(`Panel key belum dipetakan: ${dual?.panel_unmapped ?? 0} (ditandai, tidak dihitung)`);
const keyPairs = db
  .prepare(`
    SELECT recommended_market_key AS ev_key, panel_market_key AS panel_key, count(*) AS n
    FROM v_snapshot_eval
    GROUP BY recommended_market_key, panel_market_key
    ORDER BY n DESC
  `)
  .all() as any[];
for (const r of keyPairs) {
  console.log(`- EV ${r.ev_key ?? "—"} → PANEL ${r.panel_key ?? "—"}: ${r.n} snapshot`);
}

section("EV DIKLAIM vs HASIL NYATA (rekomendasi utama per snapshot)");
const evSummary = db
  .prepare(`
    SELECT
      count(*) AS snapshots,
      sum(CASE WHEN hit_recommended IS NOT NULL THEN 1 ELSE 0 END) AS decided,
      sum(CASE WHEN hit_recommended = 1 THEN 1 ELSE 0 END) AS hits,
      sum(CASE WHEN hit_recommended = 0 THEN 1 ELSE 0 END) AS misses,
      sum(CASE WHEN hit_recommended = 0.5 THEN 1 ELSE 0 END) AS pushes,
      sum(CASE WHEN hit_recommended IS NULL THEN 1 ELSE 0 END) AS unmapped,
      avg(recommended_ev_pct) AS avg_claimed_ev,
      sum(pl_result_pct) AS total_pl,
      avg(pl_result_pct) AS avg_pl
    FROM v_snapshot_eval
  `)
  .get() as any;
const evDecided = (evSummary.decided ?? 0) as number;
console.log(`Snapshot evaluable:        ${evSummary.snapshots}`);
console.log(`Diputuskan:                ${evDecided} · hit ${evSummary.hits ?? 0} · miss ${evSummary.misses ?? 0} · push ${evSummary.pushes ?? 0} · belum dipetakan ${evSummary.unmapped ?? 0}`);
console.log(`Hit rate rekomendasi:      ${evDecided > 0 ? pct((evSummary.hits ?? 0) / evDecided) : "— (belum ada keputusan)"}`);
console.log(`Rata-rata EV diklaim:       ${num(evSummary.avg_claimed_ev)}%`);
console.log(`Total P/L (% bankroll):    ${num(evSummary.total_pl)}%`);
console.log(`Rata-rata P/L per snapshot:${num(evSummary.avg_pl)}%`);

section("KALIBRASI 1X2 (model vs closing odds)");
const calib = db
  .prepare(`
    SELECT
      count(*) AS evaluable,
      count(brier_1x2) AS with_brier,
      avg(brier_1x2) AS brier,
      count(log_loss_1x2) AS with_logloss,
      avg(log_loss_1x2) AS logloss,
      count(model_divergence) AS with_div,
      avg(model_divergence) AS divergence
    FROM v_snapshot_eval
  `)
  .get() as any;
console.log(`Evaluable:                 ${calib.evaluable}`);
console.log(`Brier 1X2 (multiclass):    ${num(calib.brier, 4)} (dari ${calib.with_brier ?? 0} snapshot) — lebih kecil lebih baik, acak ≈ 0.67`);
console.log(`Log-loss 1X2:              ${num(calib.logloss, 4)} (dari ${calib.with_logloss ?? 0} snapshot)`);
console.log(`Model divergence vs odds:  ${num(calib.divergence, 4)} (dari ${calib.with_div ?? 0} snapshot punya closing odds)`);

section("SNAPSHOT BELUM PUNYA OUTCOME (jangan dianggap benar)");
const missing = db
  .prepare(`
    SELECT s.match_id, s.captured_utc,
           CAST(julianday('now') - julianday(s.captured_utc) AS INTEGER) AS age_days
    FROM analysis_snapshots s
    LEFT JOIN match_outcomes o ON o.match_id = s.match_id
    WHERE o.match_id IS NULL
    GROUP BY s.match_id
    ORDER BY s.captured_utc DESC
  `)
  .all() as any[];
for (const r of missing) {
  console.log(`- ${r.match_id}: captured ${r.captured_utc} (umur ${r.age_days ?? "?"} hari)`);
}
if (missing.length === 0) console.log("— semua snapshot punya outcome");

section("MARKET BELUM DIPETAKAN (dilaporkan, tidak dihitung)");
const unmappedRows = db
  .prepare(`
    SELECT DISTINCT market_name, selection
    FROM v_snapshot_eval_market
    WHERE market_key IS NULL
  `)
  .all() as any[];
for (const r of unmappedRows) {
  console.log(`- ${r.market_name} / ${r.selection}`);
}
if (unmappedRows.length === 0) console.log("— semua market sudah dipetakan");

console.log("\n(report read-only, tidak mengubah DB)");