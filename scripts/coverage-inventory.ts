/**
 * TASK 1 — plan-data-coverage.md: INVENTARIS + UJI HORIZON FIXTURE.
 *
 * Listing murah (1 req/100 baris), 3 bagian:
 *   A. Inventaris offline (0 request): dataset, upcoming store, vault.
 *   B. Horizon fixture: paginasi `status=scheduled` per kompetisi → TANGGAL BATAS
 *      (kickoff terjauh yang API berikan). Kunci vault `upc_list_*` DIPAKAI BERSAMA
 *      dengan `sync-upcoming-fixtures.ts` → run berikutnya 0 request.
 *   C. Kedalaman historis: listing `status=finished` per kompetisi → apakah musim
 *      25/26 tersedia + jumlah kandidat stats historis per kompetisi/musim.
 *      Kunci vault `hist_list_*` dipakai lagi oleh bulk stats (Task 5).
 *
 * Jalankan: npx tsx scripts/coverage-inventory.ts
 */
try {
  if (typeof (process as any).loadEnvFile === "function") {
    (process as any).loadEnvFile(".env.local");
  }
} catch {}

import { TARGET_COMPETITIONS } from "../lib/thestats-competitions";
import { getTheStatsDb } from "../lib/db/thestats-dataset";
import { getUpcomingDb } from "../lib/db/upcoming-fixtures";
import { statsFetch } from "../lib/stats-fetch";
import { remainingBudget, API_BUDGET_TOTAL } from "../lib/api-budget";

const PER_PAGE = 100;
const SEASON_2526_START = "2025-08-01";
const SEASON_2627_START = "2026-08-01";
const RATE_PAUSE_MS = 1000; // pacing aman (~60 req/menit, jauh di bawah limit)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const ds = getTheStatsDb();
  const up = getUpcomingDb();

  // ───────────────────────── A. Inventaris offline ─────────────────────────
  console.log("=== A. INVENTARIS OFFLINE (0 request) ===");
  const byStatus = ds.prepare("SELECT status, count(*) c FROM matches GROUP BY status").all() as any[];
  console.log("dataset.matches :", JSON.stringify(byStatus));
  console.log("dataset.logs    :", (ds.prepare("SELECT count(*) c FROM team_match_logs").get() as any).c);
  console.log("dataset.teams   :", (ds.prepare("SELECT count(*) c FROM teams").get() as any).c);
  const thinTeams = ds
    .prepare(`
      SELECT t.team_id, t.name, count(l.log_id) AS n
      FROM teams t LEFT JOIN team_match_logs l ON l.team_id = t.team_id
      GROUP BY t.team_id HAVING n < 6
      ORDER BY n ASC
    `)
    .all() as any[];
  console.log(`tim <6 log      : ${thinTeams.length} → ${thinTeams.map((t) => `${t.name}(${t.n})`).join(", ") || "-"}`);
  const noXg = (ds.prepare("SELECT count(*) c FROM team_match_logs WHERE xg_for IS NULL").get() as any).c;
  console.log("log tanpa xG    :", noXg);
  const upStats = up
    .prepare(`
      SELECT competition_id, count(*) c, min(utc_date) lo, max(utc_date) hi
      FROM upcoming_fixtures GROUP BY competition_id
    `)
    .all() as any[];
  console.log("upcoming store  :", (up.prepare("SELECT count(*) c FROM upcoming_fixtures").get() as any).c, "fixture");
  for (const r of upStats) console.log(`   ${r.competition_id}: ${r.c} fixture (${r.lo?.slice(0, 10)} → ${r.hi?.slice(0, 10)})`);

  const knownIds = new Set(
    (ds.prepare("SELECT match_id FROM matches").all() as any[]).map((r) => String(r.match_id))
  );

  // ───────────────────── B. Horizon fixture (scheduled) ─────────────────────
  console.log("\n=== B. HORIZON FIXTURE UPCOMING (listing scheduled) ===");
  let globalHorizon: string | null = null;
  let scheduledTotal = 0;
  const perMonth = new Map<string, number>();

  for (const comp of Object.values(TARGET_COMPETITIONS)) {
    let page = 1;
    let compCount = 0;
    let compMax: string | null = null;
    while (page <= 30) {
      const json: any = await statsFetch(
        "/football/matches",
        { competition_id: comp.id, status: "scheduled", per_page: PER_PAGE, page },
        `upc_list_${comp.id}_p${page}`,
        "matches",
        { maxAgeMs: 6 * 3600 * 1000 }
      );
      const rows: any[] = Array.isArray(json?.data) ? json.data : [];
      if (rows.length === 0) break;
      for (const m of rows) {
        const utc = m.utc_date;
        if (!utc || Number.isNaN(Date.parse(utc))) continue;
        compCount++;
        perMonth.set(utc.slice(0, 7), (perMonth.get(utc.slice(0, 7)) ?? 0) + 1);
        if (!compMax || utc > compMax) compMax = utc;
      }
      if (rows.length < PER_PAGE) break;
      page++;
      await sleep(RATE_PAUSE_MS);
    }
    scheduledTotal += compCount;
    if (compMax && (!globalHorizon || compMax > globalHorizon)) globalHorizon = compMax;
    console.log(` ${comp.name}: ${compCount} scheduled, kickoff terjauh = ${compMax?.slice(0, 10) ?? "-"}`);
    await sleep(RATE_PAUSE_MS);
  }
  console.log(`\n>>> TANGGAL BATAS FIXTURE: ${globalHorizon ?? "(n/a)"}  (total ${scheduledTotal} scheduled)`);
  console.log(">>> Sebaran bulan:", JSON.stringify(Object.fromEntries([...perMonth.entries()].sort())));

  // ─────────────── C. Kedalaman historis + kandidat stats ───────────────
  console.log("\n=== C. HISTORIS FINISHED (kandidat stats per kompetisi/musim) ===");
  const report: any[] = [];
  for (const comp of Object.values(TARGET_COMPETITIONS)) {
    // Halaman 1 — sekaligus deteksi arah urutan + meta total.
    const p1: any = await statsFetch(
      "/football/matches",
      { competition_id: comp.id, status: "finished", per_page: PER_PAGE, page: 1 },
      `hist_list_${comp.id}_p1`,
      "matches"
    );
    const rows1: any[] = Array.isArray(p1?.data) ? p1.data : [];
    const meta = p1?.meta ?? {};
    if (rows1.length === 0) {
      report.push({ comp: comp.name, total: 0, note: "tidak ada finished di API" });
      console.log(` ${comp.name}: 0 finished`);
      continue;
    }
    const descending = Date.parse(rows1[0].utc_date) >= Date.parse(rows1[rows1.length - 1].utc_date);
    let oldest = rows1[rows1.length - 1].utc_date as string;
    let newest = rows1[0].utc_date as string;
    const collected: any[] = [...rows1];
    let page = 1;

    if (descending) {
      // Paginasi maju (newest → lama) sampai masuk musim 24/25 atau halaman habis.
      while (oldest >= SEASON_2526_START && page < (meta.total_pages ?? 30)) {
        page++;
        const json: any = await statsFetch(
          "/football/matches",
          { competition_id: comp.id, status: "finished", per_page: PER_PAGE, page },
          `hist_list_${comp.id}_p${page}`,
          "matches"
        );
        const rows: any[] = Array.isArray(json?.data) ? json.data : [];
        if (rows.length === 0) break;
        collected.push(...rows);
        oldest = rows[rows.length - 1].utc_date;
        await sleep(RATE_PAUSE_MS);
      }
    } else {
      // Ascending (jarang): halaman terakhir = terbaru.
      const last = meta.total_pages ?? 1;
      if (last > 1) {
        const json: any = await statsFetch(
          "/football/matches",
          { competition_id: comp.id, status: "finished", per_page: PER_PAGE, page: last },
          `hist_list_${comp.id}_p${last}`,
          "matches"
        );
        const rows: any[] = Array.isArray(json?.data) ? json.data : [];
        if (rows.length) {
          collected.push(...rows);
          newest = rows[rows.length - 1].utc_date;
          oldest = rows1[0].utc_date;
        }
      }
    }

    const seen = new Set<string>();
    const uniq = collected.filter((m) => {
      const id = String(m?.id);
      if (!m?.id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    const c2627 = uniq.filter((m) => m.utc_date >= SEASON_2627_START);
    const c2526 = uniq.filter((m) => m.utc_date >= SEASON_2526_START && m.utc_date < SEASON_2627_START);
    const missing2627 = c2627.filter((m) => !knownIds.has(String(m.id)));
    const missing2526 = c2526.filter((m) => !knownIds.has(String(m.id)));
    report.push({
      comp: comp.name,
      id: comp.id,
      total_finished_api: meta.total ?? uniq.length,
      oldest_seen: oldest.slice(0, 10),
      newest_seen: newest.slice(0, 10),
      "26/27": c2627.length,
      "25/26": c2526.length,
      kandidat_baru_2627: missing2627.length,
      kandidat_baru_2526: missing2526.length,
    });
    console.log(
      ` ${comp.name}: total_api=${meta.total ?? "?"} | terlama terlihat=${oldest.slice(0, 10)} | ` +
        `26/27=${c2627.length} (baru ${missing2627.length}) | 25/26=${c2526.length} (baru ${missing2526.length})`
    );
    await sleep(RATE_PAUSE_MS);
  }

  console.log("\n=== RINGKAS TASK 1 ===");
  console.table(report);
  const kandidatTotal = report.reduce((a: number, r: any) => a + (r.kandidat_baru_2627 ?? 0) + (r.kandidat_baru_2526 ?? 0), 0);
  console.log(`Kandidat stats historis (baru, 25/26+26/27): ${kandidatTotal} match → ±${kandidatTotal} request stats`);
  console.log(`Musim 25/26 tersedia di API: ${report.some((r: any) => (r["25/26"] ?? 0) > 0) ? "YA" : "TIDAK"}`);
  console.log(`Sisa budget: ${remainingBudget()} dari ${API_BUDGET_TOTAL}`);
}

main().catch((err) => {
  console.error("[coverage-inventory] gagal:", err);
  process.exit(1);
});
