/**
 * BACKFILL SATU KALI (O2 panel market) — isi kolom `panel_market` /
 * `panel_market_key` untuk baris yang sudah tertulis SEBELUM kolom itu ada.
 *
 * Sumbernya `view_json` milik baris itu sendiri (rekomendasi arbiter ada
 * di `$.debat.supreme.recommended_market`, atau `$.ringkasan.verdict`).
 * Tidak menebak: kalau teksnya tidak cocok dengan market yang dipetakan,
 * key dibiarkan NULL ("belum dipetakan").
 *
 * Idempotent: hanya baris dengan panel_market_key IS NULL yang disentuh.
 * Jalankan: npx tsx scripts/backfill-panel-market.ts [--dry-run]
 */
import { getSnapshotDb, deriveMarketKey } from "../lib/db/analysis-snapshot";

const DRY_RUN = process.argv.includes("--dry-run");
const db = getSnapshotDb();

const rows = db
  .prepare(`
    SELECT snapshot_id, view_json, panel_market
    FROM analysis_snapshots
    WHERE panel_market_key IS NULL AND view_json IS NOT NULL
    ORDER BY snapshot_id
  `)
  .all() as Array<{ snapshot_id: number; view_json: string; panel_market: string | null }>;

/** Cocokkan teks panel ke value_bets; key NULL kalau tak ada yang cocok. */
function panelKeyOf(view: any, panelText: string): string | null {
  const bets: Array<{ market_name: string; selection: string }> =
    view?.kuantitatif?.detail?.kelly?.tabel ?? [];
  const homeTeam = view?.match?.home ?? null;
  const awayTeam = view?.match?.away ?? null;
  const hay = panelText.toLowerCase();
  let best: { market_name: string; selection: string } | null = null;
  let bestPos = Infinity;
  for (const vb of bets) {
    const pos = [vb.selection, vb.market_name]
      .filter(Boolean)
      .map((s) => hay.indexOf(String(s).toLowerCase()))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b)[0];
    if (pos !== undefined && pos < bestPos) {
      bestPos = pos;
      best = vb;
    }
  }
  return best ? deriveMarketKey(best.market_name, best.selection, homeTeam, awayTeam) : null;
}

let updated = 0;
for (const row of rows) {
  let view: any = null;
  try {
    view = JSON.parse(row.view_json);
  } catch {
    console.warn(`[backfill] snapshot ${row.snapshot_id}: view_json rusak — dilewati.`);
    continue;
  }
  const panelText =
    row.panel_market ||
    view?.debat?.supreme?.recommended_market ||
    view?.ringkasan?.verdict ||
    null;
  if (!panelText) {
    console.log(`[backfill] snapshot ${row.snapshot_id}: teks rekomendasi panel tidak ada — NULL.`);
    continue;
  }
  const key = panelKeyOf(view, String(panelText));
  if (DRY_RUN) {
    console.log(`[dry-run] snapshot ${row.snapshot_id}: panel="${String(panelText).slice(0, 60)}..." key=${key}`);
    updated++;
    continue;
  }
  db.prepare("UPDATE analysis_snapshots SET panel_market = ?, panel_market_key = ? WHERE snapshot_id = ?")
    .run(String(panelText), key, row.snapshot_id);
  updated++;
  console.log(`[backfill] snapshot ${row.snapshot_id}: key=${key} (panel="${String(panelText).slice(0, 60)}...")`);
}

console.log(`\n[backfill] ${updated} baris${DRY_RUN ? " (dry-run, belum ditulis)" : " di-update"}.`);