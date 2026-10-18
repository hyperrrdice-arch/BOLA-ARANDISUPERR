/**
 * TASK 5 — plan-data-coverage.md: BULK STATS MATCH HISTORIS (spend utama).
 *
 * Tarik `/football/matches/{id}/stats` untuk semua match finished yang belum ada
 * di `team_match_logs` — sisa 26/27 dulu, lalu musim 25/26. TANPA lineups historis.
 *
 * Guardrail (WAJIB):
 *   - mapStatsToTelemetry return null saat skor/status absen → SKIP + warning,
 *     JANGAN dibypass, JANGAN ada 0-0 karangan.
 *   - Idempotent: match yang sudah punya log → skip tanpa fetch.
 *   - Listing kandidat dari vault `hist_list_{comp}_p{n}` (ditarik Task 1) → 0 request listing.
 *   - Payload stats mentah otomatis ke vault (`stats_{matchId}`) via statsFetch.
 *   - Transaksi per match (BEGIN IMMEDIATE/COMMIT/ROLLBACK).
 *   - Budget: statsFetch stop bersih saat sisa < 100.
 *
 * Jalankan: npx tsx scripts/bulk-stats-history.ts
 */
try {
  if (typeof (process as any).loadEnvFile === "function") {
    (process as any).loadEnvFile(".env.local");
  }
} catch {}

import { TARGET_COMPETITIONS } from "../lib/thestats-competitions";
import {
  getTheStatsDb,
  upsertTeam,
  upsertMatch,
  upsertTeamMatchLog,
} from "../lib/db/thestats-dataset";
import { getRawPayload } from "../lib/db/thestats-vault";
import { mapStatsToTelemetry } from "../lib/stats-log-mapper";
import { statsFetch } from "../lib/stats-fetch";
import { remainingBudget, API_BUDGET_TOTAL } from "../lib/api-budget";

const SEASON_2526_START = "2025-08-01";
const SEASON_2627_START = "2026-08-01";
const RATE_PAUSE_MS = 0; // pacing dipegang statsFetch (limit nyata 12 req/menit)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const seasonOf = (utc: string) => (utc >= SEASON_2627_START ? "2026/2027" : "2025/2026");

interface Cand {
  id: string;
  utc_date: string;
  compId: string;
  raw: any;
}

async function main() {
  const db = getTheStatsDb();
  const knownLogs = new Set(
    (db.prepare("SELECT DISTINCT match_id FROM team_match_logs").all() as any[]).map((r) => String(r.match_id))
  );
  const knownTeams = new Set((db.prepare("SELECT team_id FROM teams").all() as any[]).map((r) => String(r.team_id)));

  // ── Kumpulkan kandidat dari listing vault (0 request) ──
  const cands: Cand[] = [];
  let listingRows = 0;
  for (const comp of Object.values(TARGET_COMPETITIONS)) {
    for (let page = 1; page <= 30; page++) {
      const json: any = getRawPayload(`hist_list_${comp.id}_p${page}`);
      if (!json) break;
      const rows: any[] = Array.isArray(json?.data) ? json.data : [];
      if (rows.length === 0) break;
      listingRows += rows.length;
      for (const m of rows) {
        // Guardrail: hanya finished; skor/status absen → mapper akan menolak (skip + warning).
        if (m?.status !== "finished") continue;
        const utc = m.utc_date;
        if (!utc || utc < SEASON_2526_START) continue;
        if (knownLogs.has(String(m.id))) continue;
        cands.push({ id: String(m.id), utc_date: utc, compId: comp.id, raw: m });
      }
      if (rows.length < 100) break;
    }
  }

  const c2627 = cands.filter((c) => c.utc_date >= SEASON_2627_START).sort((a, b) => Date.parse(b.utc_date) - Date.parse(a.utc_date));
  const c2526 = cands.filter((c) => c.utc_date < SEASON_2627_START).sort((a, b) => Date.parse(b.utc_date) - Date.parse(a.utc_date));
  const queue = [...c2627, ...c2526]; // sisa 26/27 dulu, lalu 25/26

  console.log(`🧮 [BULK STATS] listing vault: ${listingRows} baris`);
  console.log(`🎯 Kandidat tanpa log: ${queue.length} (sisa 26/27: ${c2627.length} | 25/26: ${c2526.length})`);
  console.log(`💳 Sisa budget sebelum run: ${remainingBudget()} dari ${API_BUDGET_TOTAL}\n`);

  let ok = 0;
  let skippedNull = 0;
  const failedIds: string[] = [];
  for (const cand of queue) {
    if (knownLogs.has(cand.id)) continue; // idempoten ganda (jaga-jaga)

    let raw: any = null;
    try {
      raw = await statsFetch(`/football/matches/${cand.id}/stats`, null, `stats_${cand.id}`, "stats", { retries: 6 });
    } catch (err: any) {
      // Retry gigih sudah di dalam statsFetch. Gagal total → catat keras + lanjut;
      // baris tidak dibuat → run berikutnya otomatis mencoba lagi (jangan skip diam-diam).
      failedIds.push(cand.id);
      console.error(`  ❌ ${cand.id}: ${err?.message ?? err}`);
      continue;
    }
    const statsData = raw?.data ?? raw ?? null;

    const mapped = mapStatsToTelemetry({
      m: cand.raw,
      stats: statsData,
      competitionId: cand.compId,
      seasonName: seasonOf(cand.utc_date),
    });
    if (!mapped) {
      // Skor/status absen → data memang tidak cukup. DILARANG mengarang 0-0.
      skippedNull++;
      console.warn(`  ⚠️ skip ${cand.id} (${cand.raw.home_team?.name} vs ${cand.raw.away_team?.name}) — skor/status absen, TIDAK dikarang`);
      continue;
    }

    const homeId = String(mapped.homeLog.team_id);
    const awayId = String(mapped.awayLog.team_id);
    const tx = db.prepare("BEGIN IMMEDIATE");
    const commit = db.prepare("COMMIT");
    const rollback = db.prepare("ROLLBACK");
    tx.run();
    try {
      if (!knownTeams.has(homeId)) {
        upsertTeam({ team_id: homeId, name: cand.raw.home_team?.name ?? homeId });
        knownTeams.add(homeId);
      }
      if (!knownTeams.has(awayId)) {
        upsertTeam({ team_id: awayId, name: cand.raw.away_team?.name ?? awayId });
        knownTeams.add(awayId);
      }
      upsertMatch(mapped.match);
      upsertTeamMatchLog(mapped.homeLog);
      upsertTeamMatchLog(mapped.awayLog);
      commit.run();
      ok++;
    } catch (err) {
      rollback.run();
      throw err;
    }

    if (ok % 25 === 0) {
      console.log(`  -> ${ok}/${queue.length} match | skip ${skippedNull} | sisa budget ${remainingBudget()}`);
    }
    await sleep(RATE_PAUSE_MS);
  }

  console.log(`\n🎉 [BULK STATS SELESAI]`);
  console.log(`- Match ditulis : ${ok} (masing-masing 2 log)`);
  console.log(`- Dilewati (skor/status absen, TIDAK dikarang): ${skippedNull}`);
  console.log(`- Gagal fetch (akan dicoba lagi di run berikutnya): ${failedIds.length}`);
  if (failedIds.length > 0) console.error(`   contoh gagal: ${failedIds.slice(0, 10).join(", ")}`);
  const byStatus = db.prepare("SELECT status, count(*) c FROM matches GROUP BY status").all();
  console.log(`- matches per status: ${JSON.stringify(byStatus)} (harus hanya finished)`);
  console.log(`- team_match_logs: ${(db.prepare("SELECT count(*) c FROM team_match_logs").get() as any).c}`);
  console.log(`- Sisa budget: ${remainingBudget()} dari ${API_BUDGET_TOTAL}`);
  if (failedIds.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[bulk-stats-history] gagal:", err);
  process.exit(1);
});
