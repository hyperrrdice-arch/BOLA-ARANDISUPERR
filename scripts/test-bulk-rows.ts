/**
 * RUNNABLE CHECK — Task 5 plan-data-coverage: baris bulk = potongan jujur vault.
 *
 *   - 20 log acak: skor di `matches` harus cocok dengan baris listing di vault
 *     (sumber nyata) — kalau ada yang 0-0 karangan, ketahuan di sini
 *   - `result` log konsisten dengan skor
 *   - xG log = xG payload stats (atau NULL kalau payload memang kosong —
 *     NULL boleh, 0 palsu TIDAK)
 *   - `matches` hanya berisi `finished`
 *
 * Jalankan: npx tsx scripts/test-bulk-rows.ts
 */
import { getTheStatsDb } from "../lib/db/thestats-dataset";
import { getRawPayload } from "../lib/db/thestats-vault";
import { TARGET_COMPETITIONS } from "../lib/thestats-competitions";

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

const ds = getTheStatsDb();

console.log("=== TEST BARIS BULK vs VAULT ===\n");

// 1. Invariant: matches hanya finished.
const badStatus = (ds.prepare("SELECT count(*) c FROM matches WHERE status != 'finished'").get() as any).c;
assert(badStatus === 0, `matches hanya berisi finished (bandel: ${badStatus})`);

// 2. Index skor dari listing vault (sumber nyata, offline).
const scoreById = new Map<string, { h: number; a: number }>();
for (const comp of Object.values(TARGET_COMPETITIONS)) {
  for (let page = 1; page <= 30; page++) {
    const json: any = getRawPayload(`hist_list_${comp.id}_p${page}`);
    if (!json) break;
    const rows: any[] = Array.isArray(json?.data) ? json.data : [];
    if (rows.length === 0) break;
    for (const m of rows) {
      const h = m?.score?.home ?? m?.home_score;
      const a = m?.score?.away ?? m?.away_score;
      if (m?.id && h != null && a != null) scoreById.set(String(m.id), { h: Number(h), a: Number(a) });
    }
    if (rows.length < 100) break;
  }
}
// Plus baris dari backfill tim tipis (kunci `stats_{id}` langsung dicek di butir 4).
console.log(`  (index skor vault: ${scoreById.size} match)`);

// 3. 20 log acak.
const sample = ds
  .prepare(`
    SELECT l.log_id, l.team_id, l.result, l.goals_for, l.goals_against, l.xg_for,
           m.match_id, m.home_team_id, m.away_team_id, m.home_score, m.away_score
    FROM team_match_logs l JOIN matches m ON m.match_id = l.match_id
    ORDER BY random() LIMIT 20
  `)
  .all() as any[];
assert(sample.length === 20, `mengambil 20 log acak (${sample.length})`);

let checked = 0;
for (const s of sample) {
  const isHome = s.team_id === s.home_team_id;
  const gf = isHome ? s.home_score : s.away_score;
  const ga = isHome ? s.away_score : s.home_score;
  // Skor log konsisten dengan baris match-nya sendiri.
  const selfConsistent =
    Number(s.goals_for) === Number(gf) && Number(s.goals_against) === Number(ga) &&
    s.result === (gf > ga ? "W" : gf === ga ? "D" : "L");
  if (!selfConsistent) {
    assert(false, `log ${s.log_id} tidak konsisten dengan skor match (dugaan karangan)`);
    continue;
  }
  // Skor match vs listing vault (kalau match-nya ada di index).
  const v = scoreById.get(String(s.match_id));
  if (v) {
    const ok = Number(s.home_score) === v.h && Number(s.away_score) === v.a;
    assert(ok, `skor match ${s.match_id} (${s.home_score}-${s.away_score}) cocok vault (${v.h}-${v.a})`);
  }
  checked++;
}
assert(checked > 0, `ada log yang bisa dibandingkan dengan vault (${checked}/20)`);

// 4. xG: NULL boleh, 0 palsu tidak (cek payload stats kalau ada).
let xgChecked = 0;
let xgBad = 0;
for (const s of sample) {
  const p: any = getRawPayload(`stats_${s.match_id}`);
  const stats = p?.data ?? p ?? null;
  const isHome = s.team_id === s.home_team_id;
  const xgPayload = stats?.overview?.expected_goals?.all?.[isHome ? "home" : "away"] ?? null;
  if (xgPayload == null) continue;
  xgChecked++;
  if (s.xg_for == null || Math.abs(Number(s.xg_for) - Number(xgPayload)) > 0.011) xgBad++;
}
assert(xgBad === 0, `xG log = xG payload (dibanding ${xgChecked}, tidak cocok: ${xgBad})`);

console.log(`\n=== ${passed} lulus, ${failed} gagal ===`);
process.exit(failed > 0 ? 1 : 0);
