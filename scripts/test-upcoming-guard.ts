/**
 * RUNNABLE CHECK (Plan B3) — jaring pengaman fixture scheduled.
 *
 * Memastikan baris `scheduled` (fixture 30 hari ke depan) TIDAK PERNAH
 * sampai ke pembaca konteks yang jadi bahan model/LLM:
 *   - getLocalRecentMatches / getLocalH2HMatches → hanya status finished + skor terisi
 *   - cutoff `beforeDate` → hanya match sebelum tanggal itu
 *   - team_match_logs tidak punya baris untuk match scheduled
 *
 * Jalankan: npx tsx scripts/test-upcoming-guard.ts
 */
import {
  getTheStatsDb,
  getLocalRecentMatches,
  getLocalH2HMatches,
} from "../lib/db/thestats-dataset";
import { countUpcoming, getUpcomingDb } from "../lib/db/upcoming-fixtures";

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

const db = getTheStatsDb();

console.log("=== TEST GUARD FIXTURE UPCOMING ===\n");

// 0. Invariant: dataset utama bebas fixture; fixture hidup di store terpisah.
// (Setelah migrasi Plan-B final, matches lokal TIDAK menyimpan scheduled.)
const scheduledInDataset = db
  .prepare("SELECT count(*) AS c FROM matches WHERE status != 'finished'")
  .get() as { c: number };
assert(
  scheduledInDataset.c === 0,
  `dataset utama bebas fixture scheduled (ditemukan ${scheduledInDataset.c})`
);
assert(countUpcoming() > 0, `fixture ada di store terpisah (${countUpcoming()} baris)`);

// Helper tim uji: pilih dari store upcoming (tim dengan fixture terbanyak).
const upcoming = getUpcomingDb()
  .prepare(`
    SELECT home_team_id AS team_id, count(*) AS n
    FROM upcoming_fixtures
    WHERE utc_date > datetime('now')
    GROUP BY home_team_id ORDER BY n DESC LIMIT 1
  `)
  .get() as { team_id: string; n: number } | undefined;
assert(!!upcoming, `pilih tim uji dari store upcoming (${upcoming?.team_id})`);

// 1. team_match_logs TIDAK boleh punya baris untuk match scheduled.
const logLeak = db
  .prepare(`
    SELECT count(*) AS c FROM team_match_logs l
    JOIN matches m ON m.match_id = l.match_id
    WHERE m.status != 'finished'
  `)
  .get() as { c: number };
assert(logLeak.c === 0, `tidak ada team_match_logs untuk match scheduled (ditemukan ${logLeak.c})`);

// 2. getLocalRecentMatches: untuk tim yang punya fixture, output hanya finished + skor nyata.
const team = upcoming;
assert(!!team, `pilih tim uji dengan fixture terbanyak (${team?.team_id}, ${team?.n} fixture)`);

const recent = getLocalRecentMatches(team.team_id, 6);
assert(recent.length > 0, `form list tidak kosong untuk tim uji (${recent.length} match)`);
assert(
  recent.every((m) => m.status === "finished" && m.score.home !== null && m.score.away !== null),
  "SEMUA baris form berstatus finished + skor terisi (tidak ada 0-0 palsu dari fixture)"
);

// 3. Cutoff tanggal: sebelum tanggal pertama di DB → 0 baris (nanti baris muncul).
const earliest = db.prepare("SELECT min(utc_date) AS d FROM matches").get() as { d: string };
const tooEarly = getLocalRecentMatches(team.team_id, 6, "2000-01-01T00:00:00Z");
assert(tooEarly.length === 0, "cutoff sebelum seluruh riwayat → 0 baris (tidak ada leakage)");
const withCutoff = getLocalRecentMatches(team.team_id, 6, new Date().toISOString());
assert(
  withCutoff.length === recent.length,
  `cutoff 'sekarang' memberi hasil sama dengan tanpa cutoff (${withCutoff.length} = ${recent.length})`
);

// 4. H2H: pilih dua tim yang punya fixture, pastikan output tetap finished.
const pair = getUpcomingDb()
  .prepare(`
    SELECT home_team_id AS a, away_team_id AS b
    FROM upcoming_fixtures WHERE utc_date > datetime('now')
    LIMIT 1
  `)
  .get() as { a: string; b: string } | undefined;
if (pair) {
  const h2h = getLocalH2HMatches(pair.a, pair.b, 6);
  assert(
    h2h.every((m) => m.status === "finished"),
    `H2H hanya berisi match finished (${h2h.length} baris)`
  );
  const futureH2H = getLocalH2HMatches(pair.a, pair.b, 6, "2000-01-01T00:00:00Z");
  assert(futureH2H.length === 0, "H2H dengan cutoff awal → kosong");
} else {
  assert(false, "pagu pasangan fixture untuk uji H2H");
}

console.log(`\n=== ${passed} lulus, ${failed} gagal ===`);
process.exit(failed > 0 ? 1 : 0);