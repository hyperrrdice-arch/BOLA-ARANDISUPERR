/**
 * RUNNABLE CHECK (DB SNAPSHOT T1) — DB snapshot append-only.
 * Tanpa LLM: membuktikan round-trip, isolasi key, TTL, skema idempotent,
 * VIEW evaluasi (Brier/log-loss/pl), penjaga leakage, dan upsert outcome.
 *
 * Pakai match_id sintetis ber-prefix "__snapcheck_" lalu dibersihkan di akhir
 * (satu-satunya DELETE yang sah: cleanup data test, bukan data produksi).
 *
 * Jalankan: npx tsx scripts/test-snapshot-db.ts
 */
import {
  getSnapshotDb,
  ensureSnapshotSchema,
  ensureSnapshotColumns,
  insertSnapshot,
  getFreshSnapshot,
  getSnapshotMetrics,
  upsertOutcome,
  getOutcome,
} from "../lib/db/analysis-snapshot";

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
  }
}

const PREFIX = "__snapcheck_";
const TTL = 10 * 60 * 1000;
const db = getSnapshotDb();

function cleanup() {
  db.prepare("DELETE FROM analysis_snapshots WHERE match_id LIKE ?").run(`${PREFIX}%`);
  db.prepare("DELETE FROM match_outcomes WHERE match_id LIKE ?").run(`${PREFIX}%`);
}

console.log("=== TEST SNAPSHOT DB ===\n");
cleanup();

// 1. Skema idempotent: dipanggil ulang pada DB yang sama tidak error.
try {
  ensureSnapshotSchema(db);
  ensureSnapshotColumns(db);
  assert(true, "skema idempotent (ensureSnapshotSchema + ensureSnapshotColumns dipanggil 2x tidak error)");
} catch (e) {
  assert(false, `skema idempotent: ${e}`);
}

// 2. Round-trip snapshot.
const kickoffPre = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2 jam lagi
const snapshotId = insertSnapshot({
  match_id: `${PREFIX}A`,
  competition_id: "comp_1",
  competition_name: "Liga Uji",
  home_team: "Kandang FC",
  away_team: "Tamu FC",
  kickoff_utc: kickoffPre,
  cache_key_hint: "hint_1",
  verdict: "PASS",
  confidence: "HIGH",
  recommended_market: "Kandang FC Menang (1X2)",
  recommended_market_key: "1X2_HOME",
  panel_market: "Both Teams to Score (BTTS) Yes @ 1.88, sizing kecil",
  panel_market_key: "BTTS_YES",
  recommended_odds: 2.1,
  recommended_ev_pct: 8.5,
  stake_pct: 1.0,
  prob_home: 0.5,
  prob_draw: 0.3,
  prob_away: 0.2,
  fair_odds_home: 2.0,
  fair_odds_draw: 3.33,
  fair_odds_away: 5.0,
  prob_btts: 0.55,
  prob_over_2_5: 0.52,
  value_bets_json: JSON.stringify([
    { market_name: "1X2", selection: "Kandang FC Menang", bookmaker_odds: 2.1, fair_odds: 2.0, expected_value: 0.05, ev_percentage: "+5%", is_positive_ev: true, recommended_stake_percentage: 1.0, rationale: "uji" },
    { market_name: "Over/Under 2.5", selection: "Over 2.5 Goals", bookmaker_odds: 1.95, fair_odds: 1.92, expected_value: 0.015, ev_percentage: "+1.5%", is_positive_ev: true, recommended_stake_percentage: 0.5, rationale: "uji" },
    { market_name: "Both Teams to Score", selection: "BTTS No", bookmaker_odds: 2.0, fair_odds: 2.2, expected_value: -0.1, ev_percentage: "-10%", is_positive_ev: false, recommended_stake_percentage: 0, rationale: "EV negatif tetap disimpan" },
  ]),
  planner_model: "test-model",
  app_version: "test-1.0.0",
  duration_ms: 476000,
  view_json: JSON.stringify({ match: { id: `${PREFIX}A` }, ringkasan: { verdict: "PASS" } }),
  trace_json: JSON.stringify({ planner: { loop_ms: 100, tool_ms: 400, planner_overhead_ms: 5, step_timings: [] } }),
});
assert(snapshotId > 0, `insertSnapshot mengembalikan snapshot_id (${snapshotId})`);

const hit = getFreshSnapshot(`${PREFIX}A`, "hint_1", TTL);
assert(hit !== null, "baris segar terbaca kembali");
assert(
  hit !== null && (JSON.parse(hit.view_json) as { ringkasan: { verdict: string } }).ringkasan.verdict === "PASS",
  "view_json round-trip utuh (bukan terpotong)"
);
assert(hit?.duration_ms === 476000, "duration_ms tersimpan apa adanya");
assert(hit !== null && hit.lead_time_minutes !== null && hit.lead_time_minutes > 100, "lead_time_minutes positif untuk kickoff 2 jam lagi");

// 3. Isolasi key.
assert(getFreshSnapshot(`${PREFIX}B`, "hint_1", TTL) === null, "match_id berbeda tidak menerima hasil");
assert(getFreshSnapshot(`${PREFIX}A`, "hint_2", TTL) === null, "cache_key_hint berbeda tidak menerima hasil");

// 4. TTL: snapshot basi tidak dilayani cache, tapi barisnya tetap ada (append-only).
const snapshotIdOld = insertSnapshot({
  match_id: `${PREFIX}OLD`,
  kickoff_utc: kickoffPre,
  cache_key_hint: "hint_1",
  view_json: JSON.stringify({ ringkasan: { verdict: "BASI" } }),
});
assert(snapshotIdOld > 0, "insertSnapshot tanpa kolom opsional berhasil (kolom ringkas boleh NULL)");
db.prepare("UPDATE analysis_snapshots SET captured_utc = ? WHERE snapshot_id = ?")
  .run(new Date(Date.now() - 20 * 60 * 1000).toISOString(), snapshotIdOld);
assert(getFreshSnapshot(`${PREFIX}OLD`, "hint_1", TTL) === null, "baris lebih tua dari TTL tidak dilayani cache");
const oldRow = db.prepare("SELECT snapshot_id FROM analysis_snapshots WHERE match_id = ?").get(`${PREFIX}OLD`);
assert(oldRow !== undefined, "baris basi tetap ada di DB (append-only, tidak dihapus)");

// 5. Skenario leakage: kickoff di masa lampau -> lead_time negatif.
const snapshotIdLive = insertSnapshot({
  match_id: `${PREFIX}LIVE`,
  kickoff_utc: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  cache_key_hint: "hint_1",
  view_json: JSON.stringify({ ringkasan: { verdict: "LIVE" } }),
});
assert(snapshotIdLive > 0, "snapshot live tetap disimpan (jujur)");
const liveRow = db.prepare("SELECT lead_time_minutes FROM analysis_snapshots WHERE snapshot_id = ?")
  .get(snapshotIdLive) as { lead_time_minutes: number };
assert(liveRow.lead_time_minutes < 0, "lead_time_minutes negatif untuk kickoff sudah lewat (penjaga leakage)");

// 6. Outcome + VIEW evaluasi per snapshot.
upsertOutcome({
  match_id: `${PREFIX}A`,
  status: "finished",
  home_goals: 2,
  away_goals: 1,
  ht_home_goals: 1,
  ht_away_goals: 0,
  ftr: "H",
  xg_home: 1.8,
  xg_away: 0.9,
  closing_odds_home: 2.0,
  closing_odds_draw: 3.4,
  closing_odds_away: 4.0,
  closing_over_2_5: 1.9,
  source: "local_sqlite",
  closing_source: "snapshot",
});
upsertOutcome({
  match_id: `${PREFIX}LIVE`,
  status: "finished",
  home_goals: 0,
  away_goals: 0,
  ftr: "D",
  source: "local_sqlite",
});
assert(getOutcome(`${PREFIX}A`) !== null, "outcome tersimpan dan terbaca");

const evalA = db.prepare(`
  SELECT * FROM v_snapshot_eval WHERE match_id = ?
`).get(`${PREFIX}A`) as any;
assert(evalA !== undefined, "snapshot pre-match + finished masuk VIEW evaluasi");
assert(evalA?.actual_result === "H", "actual_result = H (2-1)");
assert(evalA?.actual_btts === 1, "actual_btts = 1 (kedua tim gol)");
assert(evalA?.actual_over_2_5 === 1, "actual_over_2_5 = 1 (3 gol)");
assert(evalA?.hit_recommended === 1, "hit_recommended = 1 (1X2_HOME menang)");
// Panel rekomendasikan BTTS Yes sementara EV-teratas 1X2: dua key harus dinilai terpisah.
assert(evalA?.panel_market_key === "BTTS_YES", "panel_market_key terpisah dari recommended_market_key");
assert(evalA?.hit_panel === 1, "hit_panel dihitung sendiri (BTTS Yes: 2-1 = hit)");
assert(evalA?.pl_result_pct !== null && Math.abs(evalA.pl_result_pct - 1.1) < 1e-9, "pl_result_pct = stake*(odds-1) = 1.1");
// Brier multiclass: (0.5-1)^2 + (0.3-0)^2 + (0.2-0)^2 = 0.25+0.09+0.04 = 0.38
assert(evalA?.brier_1x2 !== null && Math.abs(evalA.brier_1x2 - 0.38) < 1e-9, `brier_1x2 = 0.38 (dapat ${evalA?.brier_1x2})`);
// Log-loss: -(1*ln(0.5)) = 0.693147...
assert(evalA?.log_loss_1x2 !== null && Math.abs(evalA.log_loss_1x2 - -Math.log(0.5)) < 1e-9, "log_loss_1x2 = -ln(0.5)");
// Divergence: (|0.5-1/2| + |0.3-1/3.4| + |0.2-1/4|)/3 = (0 + 0.005882 + 0.05)/3
const expDiv = (0 + Math.abs(0.3 - 1 / 3.4) + Math.abs(0.2 - 1 / 4)) / 3;
assert(evalA?.model_divergence !== null && Math.abs(evalA.model_divergence - expDiv) < 1e-9, "model_divergence vs implied closing");

// 7. Snapshot LIVE dikecualikan dari VIEW walau outcomenya ada.
const evalLive = db.prepare("SELECT * FROM v_snapshot_eval WHERE match_id = ?").get(`${PREFIX}LIVE`);
assert(evalLive === undefined, "snapshot live/pasca-kickoff DIKECUALIKAN dari VIEW (lead_time <= 0)");

// 8. View per market: semua market termasuk EV negatif.
const marketRows = db.prepare(`
  SELECT market_key, market_hit, expected_value, is_positive_ev
  FROM v_snapshot_eval_market WHERE match_id = ?
  ORDER BY market_index
`).all(`${PREFIX}A`) as any[];
assert(marketRows.length === 3, `3 value bets terekspansi (dapat ${marketRows.length})`);
const byKey = Object.fromEntries(marketRows.map((r) => [r.market_key, r]));
assert(byKey["1X2_HOME"]?.market_hit === 1, "1X2_HOME hit");
assert(byKey["O25"]?.market_hit === 1, "O25 hit");
assert(byKey["BTTS_NO"]?.market_hit === 0, "BTTS_NO miss (hit 0, EV negatif tetap dinilai)");
assert(byKey["BTTS_NO"]?.is_positive_ev === 0, "market EV negatif ikut dievaluasi, bukan disaring");
const unmappedRow = db.prepare(`
  SELECT count(*) AS c FROM v_snapshot_eval_market
  WHERE match_id = ? AND market_key IS NULL
`).get(`${PREFIX}A`) as { c: number };
assert(unmappedRow.c === 0, "tidak ada market belum-dipetakan di fixture ini");

// 9. Market yang TIDAK dikenal -> market_key/market_hit NULL (belum dipetakan, bukan salah).
insertSnapshot({
  match_id: `${PREFIX}MAP`,
  kickoff_utc: kickoffPre,
  cache_key_hint: "hint_1",
  recommended_market_key: "PASAR_MISTERIUS_XY",
  value_bets_json: JSON.stringify([
    { market_name: "Total Sudut", selection: "Over 9.5", bookmaker_odds: 1.9, fair_odds: 1.85, expected_value: 0.02, ev_percentage: "+2%", is_positive_ev: true, recommended_stake_percentage: 0.5 },
  ]),
  view_json: JSON.stringify({ ringkasan: { verdict: "UJI" } }),
});
upsertOutcome({ match_id: `${PREFIX}MAP`, status: "finished", home_goals: 1, away_goals: 0, source: "local_sqlite" });
const mapRow = db.prepare(`
  SELECT market_key, market_hit FROM v_snapshot_eval_market WHERE match_id = ?
`).get(`${PREFIX}MAP`) as any;
assert(mapRow?.market_key === null && mapRow?.market_hit === null,
  "market tak dikenal: key NULL + hit NULL (belum dipetakan, dilaporkan terpisah)");

// 10. Idempoten outcome: upsert ulang tidak menambah baris.
upsertOutcome({
  match_id: `${PREFIX}A`,
  status: "finished",
  home_goals: 2,
  away_goals: 1,
  source: "online_api",
});
const outcomeCount = (db.prepare("SELECT count(*) AS c FROM match_outcomes WHERE match_id LIKE ?").get(`${PREFIX}%`) as any).c;
assert(outcomeCount === 3, `upsert idempotent (3 baris outcome, dapat ${outcomeCount})`);
assert(getOutcome(`${PREFIX}A`)?.source === "online_api", "upsert me-refresh source (boleh di-refresh, beda dengan snapshot)");

// 11. Metrics.
const metrics = getSnapshotMetrics();
assert(metrics.snapshotsCount >= 4, `metrics menghitung snapshot (>=4, dapat ${metrics.snapshotsCount})`);
assert(metrics.bytes > 0, "metrics bytes terisi");

// 12. Bersihkan di akhir (baris test TIDAK boleh tinggal di korpus pribadi).
cleanup();
const after = getSnapshotMetrics();
console.log(`\n=== ${passed} lulus, ${failed} gagal (sisa baris test: ${after.snapshotsCount} total snapshot) ===`);
process.exit(failed > 0 ? 1 : 0);
