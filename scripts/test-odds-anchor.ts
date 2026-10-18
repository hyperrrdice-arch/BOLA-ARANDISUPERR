/**
 * RUNNABLE CHECK — Task 4 plan-data-coverage: anchor odds tersimpan & jujur.
 *
 *   - SETIAP fixture di store punya baris odds (terisi atau dinyatakan kosong)
 *   - 5 baris acak = potongan jujur dari payload vault (bukan hasil karangan)
 *   - `captured_utc` ada di semua baris (anchor waktu, bukan closing)
 *
 * Jalankan: npx tsx scripts/test-odds-anchor.ts
 */
import { getUpcomingDb } from "../lib/db/upcoming-fixtures";
import { getTheStatsDb } from "../lib/db/thestats-dataset";
import { getRawPayload } from "../lib/db/thestats-vault";

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

const up = getUpcomingDb();
const ds = getTheStatsDb();

console.log("=== TEST ODDS ANCHOR ===\n");

const fixtureIds = (up.prepare("SELECT match_id FROM upcoming_fixtures").all() as any[]).map((r) => String(r.match_id));
const declared = new Set(
  (ds.prepare("SELECT match_id FROM match_odds_history").all() as any[]).map((r) => String(r.match_id))
);
const missing = fixtureIds.filter((id) => !declared.has(id));
assert(missing.length === 0, `semua ${fixtureIds.length} fixture punya baris odds (terisi/kosong) — hilang: ${missing.length}`);

const noTime = (ds.prepare("SELECT count(*) c FROM match_odds_history WHERE captured_utc IS NULL OR captured_utc = ''").get() as any).c;
assert(noTime === 0, `semua baris punya captured_utc (tanpa waktu: ${noTime})`);

// 5 baris acak yang terisi harus potongan jujur dari payload vault.
const sample = ds
  .prepare(`
    SELECT o.match_id, o.payload_json FROM match_odds_history o
    WHERE o.has_odds = 1 ORDER BY random() LIMIT 5
  `)
  .all() as any[];
assert(sample.length > 0, `ada baris odds terisi untuk di-spot-check (${sample.length} diambil)`);
for (const s of sample) {
  const vaultPayload: any = getRawPayload(`odds_${s.match_id}`);
  const rowPayload = JSON.parse(s.payload_json);
  const vaultData = JSON.stringify(vaultPayload?.data ?? vaultPayload ?? null);
  const rowData = JSON.stringify(rowPayload?.data ?? rowPayload ?? null);
  assert(vaultData === rowData, `odds ${s.match_id} cocok dengan payload vault`);
}

const stats = ds.prepare("SELECT count(*) c, COALESCE(sum(has_odds),0) w FROM match_odds_history").get() as any;
console.log(`\n(match_odds_history: ${stats.c} baris, ${stats.w} terisi odds)`);

console.log(`\n=== ${passed} lulus, ${failed} gagal ===`);
process.exit(failed > 0 ? 1 : 0);
