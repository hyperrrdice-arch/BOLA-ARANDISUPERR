/**
 * RUNNABLE CHECK (plan-perf Task 2) — cache + riwayat analisis di SQLite.
 * Tanpa LLM: hanya membuktikan round-trip, isolasi key, dan filter freshness.
 *
 * Pakai match_id sintetis ber-prefix "__perfcheck_" lalu dibersihkan di akhir,
 * supaya riwayat produksi tidak tercemar baris palsu.
 *
 * Jalankan: npx tsx scripts/test-analysis-cache.ts
 */
import {
  getTheStatsDb,
  getFreshAnalysisRun,
  getAnalysisRunMetrics,
  saveAnalysisRun,
} from "../lib/db/thestats-dataset";

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

const PREFIX = "__perfcheck_";
const TTL = 10 * 60 * 1000;
const db = getTheStatsDb();

function cleanup() {
  db.prepare("DELETE FROM analysis_runs WHERE match_id LIKE ?").run(`${PREFIX}%`);
}

console.log("=== TEST ANALYSIS CACHE (SQLite) ===\n");
cleanup();
const baseline = getAnalysisRunMetrics();

// 1. Round-trip: tulis lalu baca kembali apa adanya.
saveAnalysisRun({
  match_id: `${PREFIX}A`,
  competition_id_hint: "comp_1",
  home_team: "Kandang FC",
  away_team: "Tamu FC",
  duration_ms: 476000,
  view_json: JSON.stringify({ match: { id: `${PREFIX}A` }, ringkasan: { verdict: "PASS" } }),
  planner_trace_json: JSON.stringify({ steps: [{ step: 1, action: "check_data_integrity" }] }),
});

const hit = getFreshAnalysisRun(`${PREFIX}A`, "comp_1", TTL);
assert(hit !== null, "baris segar terbaca kembali");
assert(
  hit !== null && (JSON.parse(hit.view_json) as { ringkasan: { verdict: string } }).ringkasan.verdict === "PASS",
  "view_json round-trip utuh (bukan terpotong)"
);
assert(hit?.duration_ms === 476000, "duration_ms tersimpan apa adanya");

// 2. Isolasi key: match lain TIDAK boleh menerima hasil match ini.
assert(getFreshAnalysisRun(`${PREFIX}B`, "comp_1", TTL) === null, "match_id berbeda tidak menerima hasil");
assert(getFreshAnalysisRun(`${PREFIX}A`, "comp_2", TTL) === null, "competition_id_hint berbeda tidak menerima hasil");

// 3. Riwayat, bukan sekadar cache: baris lama tetap ada, hanya TIDAK dilayani sebagai cache.
db.prepare(`
  INSERT INTO analysis_runs (match_id, competition_id_hint, created_at, duration_ms, view_json)
  VALUES (?, ?, datetime('now', '-20 minutes'), 1234, ?)
`).run(`${PREFIX}OLD`, "comp_1", JSON.stringify({ ringkasan: { verdict: "BASI" } }));

assert(getFreshAnalysisRun(`${PREFIX}OLD`, "comp_1", TTL) === null, "baris lebih tua dari TTL tidak dilayani cache");
const oldRows = db.prepare("SELECT count(*) AS c FROM analysis_runs WHERE match_id = ?").get(`${PREFIX}OLD`) as { c: number };
assert(oldRows.c === 1, "baris lama tidak dihapus (tetap jadi riwayat/backtest)");

// 4. Baris terbaru menang saat ada beberapa run untuk match yang sama.
saveAnalysisRun({
  match_id: `${PREFIX}A`,
  competition_id_hint: "comp_1",
  duration_ms: 100,
  view_json: JSON.stringify({ ringkasan: { verdict: "TERBARU" } }),
});
const latest = getFreshAnalysisRun(`${PREFIX}A`, "comp_1", TTL);
assert(
  latest !== null && (JSON.parse(latest.view_json) as { ringkasan: { verdict: string } }).ringkasan.verdict === "TERBARU",
  "run terbaru yang dilayani, bukan yang pertama"
);

// 5. Ratakan: kunci sepenuhnya dari kolom, bukan dari durasi tulis.
assert(getFreshAnalysisRun(`${PREFIX}A`, "", TTL) === null, "hint kosong tidak mengambil baris ber-hint");

// 6. Metrik pertumbuhan berfungsi (dipakai Task 8 sebagai baseline).
const after = getAnalysisRunMetrics();
assert(after.runsCount >= baseline.runsCount + 3, "metrik menghitung baris baru");
assert(after.bytes > baseline.bytes, "metrik menghitung ukuran view_json");

cleanup();
const cleaned = getAnalysisRunMetrics();
assert(cleaned.runsCount === baseline.runsCount, "cleanup mengembalikan jumlah baris ke baseline");

console.log(`\n${passed} lulus, ${failed} gagal`);
if (failed > 0) {
  console.error("=== ADA YANG GAGAL ===");
  process.exit(1);
}
console.log("=== SEMUA PENGUJIAN CACHE ANALISIS LOLOS ===");
