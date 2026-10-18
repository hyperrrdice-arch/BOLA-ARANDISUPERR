/**
 * TASK 4 — plan-data-coverage.md: PRE-PULL ODDS + LINEUPS (bertahan hidup saat API mati).
 *
 *   (a) Odds untuk SEMUA fixture di `upcoming_fixtures.db` → tabel
 *       `match_odds_history` + vault `odds_{matchId}`. `captured_utc` = anchor
 *       harga saat ditarik — BUKAN closing odds.
 *   (b) Lineups laga hari ini → vault `lineups_{matchId}`. 404 = belum rilis →
 *       TIDAK disimpan, ULANGI script ini menjelang kickoff (dedupe vault hanya
 *       menyimpan yang sukses, jadi yang tadi kosong akan dicoba lagi).
 *   (c) `--historical` (Task 8): odds match backtest window (season 26/27 di
 *       `matches`) yang belum punya baris. Dilewati TOTAL kalau sisa budget
 *       tidak cukup (jangan setengah-setengah).
 *   Idempotent: baris odds yang sudah punya has_odds=1 → skip tanpa fetch.
 *
 * Jalankan: npx tsx scripts/prepull-match-odds.ts [--historical]
 */
try {
  if (typeof (process as any).loadEnvFile === "function") {
    (process as any).loadEnvFile(".env.local");
  }
} catch {}

import { getUpcomingDb } from "../lib/db/upcoming-fixtures";
import {
  insertMatchOdds,
  hasMatchOdds,
  hasMatchOddsRow,
  countMatchOdds,
  getTheStatsDb,
} from "../lib/db/thestats-dataset";
import { statsFetch } from "../lib/stats-fetch";
import { remainingBudget, API_BUDGET_TOTAL } from "../lib/api-budget";

const HISTORICAL = process.argv.includes("--historical");
const RATE_PAUSE_MS = 1000;
const BUDGET_HEADROOM = 500; // Task 8: sisa harus tetap ≥ ini setelah run
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TODAY = new Date().toISOString().slice(0, 10); // hari UTC sekarang

/** Payload odds dianggap berisi kalau `data` ada dan bukan array/kosong. */
function oddsFilled(payload: any): boolean {
  const d = payload?.data;
  if (d == null) return false;
  if (Array.isArray(d)) return d.length > 0;
  if (typeof d === "object") return Object.keys(d).length > 0;
  return true;
}

/** Tarik odds untuk daftar match → `match_odds_history` + vault (idempoten). */
async function pullOdds(items: { match_id: string; label: string }[]): Promise<void> {
  let fetched = 0;
  let skipped = 0;
  let empty = 0;
  let done = 0;
  for (const it of items) {
    if (hasMatchOdds(it.match_id)) {
      skipped++;
      done++;
      continue;
    }
    const payload = await statsFetch(`/football/matches/${it.match_id}/odds`, null, `odds_${it.match_id}`, "odds", {
      retries: 6,
    });
    const filled = oddsFilled(payload);
    if (!filled && hasMatchOddsRow(it.match_id)) {
      // Sudah pernah dinyatakan kosong — jangan tambah baris 0 berulang.
      empty++;
    } else {
      insertMatchOdds(it.match_id, payload ?? null, filled);
      if (filled) fetched++;
      else empty++;
    }
    done++;
    if (done % 25 === 0) {
      console.log(`  -> progress ${done}/${items.length} | dapat ${fetched} | kosong ${empty} | sisa budget ${remainingBudget()}`);
    }
    await sleep(RATE_PAUSE_MS);
  }
  const oddsStats = countMatchOdds();
  console.log(`\n✅ Odds: ${fetched} baris baru terisi, ${empty} dinyatakan kosong, ${skipped} sudah ada sebelumnya`);
  console.log(`   match_odds_history: ${oddsStats.rows} baris, ${oddsStats.withOdds} dengan odds`);
}

async function main() {
  const up = getUpcomingDb();

  // ───────────── (c) Mode historis: odds window backtest (Task 8) ─────────────
  if (HISTORICAL) {
    const ds = getTheStatsDb();
    const cands = ds
      .prepare(`
        SELECT m.match_id FROM matches m
        WHERE m.season = '2026/2027' AND m.status = 'finished'
          AND NOT EXISTS (SELECT 1 FROM match_odds_history o WHERE o.match_id = m.match_id)
        ORDER BY m.utc_date DESC
      `)
      .all() as any[];
    console.log(`📜 [ODDS HISTORIS] ${cands.length} match backtest window tanpa baris odds`);
    const budgetNow = remainingBudget();
    if (budgetNow - cands.length < BUDGET_HEADROOM) {
      // Dilewati TOTAL dengan alasan tercatat — jangan setengah-setengah.
      console.log(
        `⏭️ DILEWATI TOTAL: butuh ${cands.length} request, sisa ${budgetNow} — ` +
          `menyisakan kurang dari headroom ${BUDGET_HEADROOM}.`
      );
      return;
    }
    await pullOdds(cands.map((r: any) => ({ match_id: String(r.match_id), label: String(r.match_id) })));
    return;
  }

  const fixtures = up
    .prepare("SELECT match_id, utc_date, home_team_name, away_team_name FROM upcoming_fixtures ORDER BY utc_date")
    .all() as any[];
  console.log(`🎟️  [PRE-PULL ODDS] ${fixtures.length} fixture di store`);

  // ───────────────────────── (a) Odds semua fixture ─────────────────────────
  await pullOdds(fixtures.map((f: any) => ({ match_id: String(f.match_id), label: `${f.home_team_name} vs ${f.away_team_name}` })));

  // ───────────────────── (b) Lineups laga hari ini ─────────────────────
  const todayFixtures = fixtures.filter((f) => String(f.utc_date).startsWith(TODAY));
  console.log(`\n📋 [LINEUPS HARI INI] ${todayFixtures.length} laga (${TODAY})`);
  let lineupOk = 0;
  let lineupPending = 0;
  for (const f of todayFixtures) {
    const payload = await statsFetch(
      `/football/matches/${f.match_id}/lineups`,
      null,
      `lineups_${f.match_id}`,
      "lineups",
      { retries: 4 }
    );
    if (payload) lineupOk++;
    else lineupPending++;
    await sleep(RATE_PAUSE_MS);
  }
  console.log(`✅ Lineups: ${lineupOk} tersimpan, ${lineupPending} BELUM RILIS (404 — run ulang menjelang kickoff, mereka tidak ikut ter-cache)`);

  console.log(`\nSisa budget: ${remainingBudget()} dari ${API_BUDGET_TOTAL}`);
}

main().catch((err) => {
  console.error("[prepull-match-odds] gagal:", err);
  process.exit(1);
});
