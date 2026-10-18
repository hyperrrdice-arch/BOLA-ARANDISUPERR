/**
 * SYNC FIXTURE UPCOMING → `data/upcoming_fixtures.db` (store TERPISAH).
 *
 * Rancangan: fixture punya umur pendek (laga selesai → dibuang), sementara
 * `thestats_dataset.db` akumulatif. Jadi upcoming TIDAK masuk ke dataset utama.
 *
 *   1. script ini mengisi store upcoming (7 request, horizon 30 hari)
 *   2. katalog `/api/matches` membaca store ini, API hanya fallback
 *   3. `scripts/promote-upcoming-to-telemetry.ts` memindahkan match yang selesai
 *      ke dataset utama sebagai telemetry, lalu menghapus baris upcoming
 *
 * `--migrate`: memindahkan baris `status != 'finished'` yang terlanjur ada di
 * `matches` (dari versi lama rancangan) ke store baru, lalu menghapusnya dari
 * dataset utama. Sekali jalan.
 *
 * Jalankan: npx tsx scripts/sync-upcoming-fixtures.ts [hari] [--migrate]
 */
try {
  if (typeof (process as any).loadEnvFile === "function") {
    (process as any).loadEnvFile(".env.local");
  }
} catch {}

import { TARGET_COMPETITIONS } from "../lib/thestats-competitions";
import { getTheStatsDb } from "../lib/db/thestats-dataset";
import {
  upsertUpcomingFixtures,
  countUpcoming,
  upsertCompetitions,
  countCompetitions,
  type UpcomingFixture,
} from "../lib/db/upcoming-fixtures";
import { statsFetch } from "../lib/stats-fetch";
import { remainingBudget, API_BUDGET_TOTAL } from "../lib/api-budget";

const DO_MIGRATE = process.argv.includes("--migrate");
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const DAYS_AHEAD = Number(positional[0]) || 30;
const PER_PAGE = 100;
const RATE_PAUSE_MS = 1000; // pacing aman (~60 req/menit, jauh di bawah limit)
const LISTING_MAX_AGE = 6 * 3600 * 1000; // listing boleh di-cache 6 jam (dedupe vault)
const MAX_PAGES = 30; // pagar: 3.000 fixture per kompetisi lebih dari cukup

const db = getTheStatsDb();

const now = Date.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Listing satu halaman — vault-dedupe + retry gigih (throw kalau benar-benar gagal). */
async function fetchList(competitionId: string, page: number): Promise<any[]> {
  const json = await statsFetch(
    "/football/matches",
    { competition_id: competitionId, status: "scheduled", per_page: PER_PAGE, page },
    `upc_list_${competitionId}_p${page}`,
    "matches",
    { maxAgeMs: LISTING_MAX_AGE }
  );
  return Array.isArray(json?.data) ? json.data : [];
}

/** Migrasi sekali: pindahkan fixture lama dari dataset utama ke store baru. */
function migrateFromDataset() {
  const rows = db
    .prepare(`
      SELECT m.match_id, m.competition_id, m.utc_date, m.status,
             m.home_team_id, m.away_team_id, ht.name AS home_name, at.name AS away_name
      FROM matches m
      LEFT JOIN teams ht ON ht.team_id = m.home_team_id
      LEFT JOIN teams at ON at.team_id = m.away_team_id
      WHERE m.status != 'finished'
    `)
    .all() as any[];

  if (rows.length === 0) {
    console.log("[migrate] Tidak ada baris scheduled di dataset utama — migrasi tidak perlu.");
    return;
  }

  const payload: UpcomingFixture[] = rows.map((r) => ({
    match_id: r.match_id,
    competition_id: r.competition_id ?? null,
    competition_name: TARGET_COMPETITIONS[r.competition_id ?? ""]?.name ?? null,
    utc_date: r.utc_date,
    status: r.status ?? null,
    home_team_id: r.home_team_id ?? null,
    home_team_name: r.home_name ?? null,
    away_team_id: r.away_team_id ?? null,
    away_team_name: r.away_name ?? null,
  }));
  upsertUpcomingFixtures(payload);

  // Dataset utama harus bebas fixture: hapus setelah tersalin.
  const del = db.prepare("DELETE FROM matches WHERE match_id = ? AND status != 'finished'");
  let removed = 0;
  for (const r of rows) removed += Number(del.run(r.match_id).changes);

  console.log(`[migrate] ${payload.length} fixture dipindah ke upcoming_fixtures.db, ${removed} baris dihapus dari dataset utama.`);
}

/** Snapshot kamus kompetisi (4 halaman) → `competition_catalog` — nama liga hidup tanpa API. */
async function syncCompetitionCatalog(): Promise<number> {
  const rows: { competition_id: string; name: string | null; country: string | null; payload: unknown }[] = [];
  for (let page = 1; page <= 4; page++) {
    const json: any = await statsFetch(
      "/football/competitions",
      { per_page: 100, page },
      `compcat_p${page}`,
      "competitions",
      { maxAgeMs: 24 * 3600 * 1000 }
    );
    const data: any[] = Array.isArray(json?.data) ? json.data : [];
    if (data.length === 0) break;
    for (const c of data) {
      if (!c?.id) continue;
      rows.push({ competition_id: String(c.id), name: c.name ?? null, country: c.country ?? null, payload: c });
    }
    await sleep(RATE_PAUSE_MS);
  }
  return upsertCompetitions(rows);
}

async function main() {
  if (DO_MIGRATE) {
    migrateFromDataset();
  }

  const catCount = await syncCompetitionCatalog();
  console.log(`📚 [KATALOG KOMPETISI] ${catCount} kompetisi ditulis (total ${countCompetitions()} di catalog)`);

  console.log(`🔮 [FIXTURE UPCOMING] Jadwal ${DAYS_AHEAD} hari ke depan → upcoming_fixtures.db`);
  let total = 0;
  let outside = 0;
  let horizonDate: string | null = null; // tanggal kickoff paling jauh yang API berikan

  for (const comp of Object.values(TARGET_COMPETITIONS)) {
    const batch: UpcomingFixture[] = [];
    let page = 1;
    while (page <= MAX_PAGES) {
      const matches = await fetchList(comp.id, page);
      if (matches.length === 0) break;
      for (const m of matches) {
        const utc = m.utc_date ?? null;
        if (!utc) continue;
        const ms = Date.parse(utc);
        if (Number.isNaN(ms)) continue;
        if (!horizonDate || utc > horizonDate) horizonDate = utc;
        if (ms < now || ms > now + DAYS_AHEAD * 24 * 60 * 60 * 1000) {
          outside++;
          continue;
        }
        batch.push({
          match_id: String(m.id),
          competition_id: comp.id,
          competition_name: m.competition_name ?? comp.name,
          competition_country: comp.country,
          utc_date: utc,
          status: String(m.status ?? "scheduled"),
          stage_name: m.stage_name ?? null,
          home_team_id: m.home_team?.id != null ? String(m.home_team.id) : null,
          home_team_name: m.home_team?.name ?? null,
          away_team_id: m.away_team?.id != null ? String(m.away_team.id) : null,
          away_team_name: m.away_team?.name ?? null,
          venue: m.venue ?? null,
          is_neutral: m.is_neutral ? 1 : 0,
          odds_available: m.odds_available ? 1 : 0,
          xg_available: m.xg_available ? 1 : 0,
        });
      }
      if (matches.length < PER_PAGE) break;
      page++;
      await sleep(RATE_PAUSE_MS);
    }
    upsertUpcomingFixtures(batch);
    total += batch.length;
    console.log(`-> ${comp.name}: ${batch.length} fixture (total ${total})`);
    await sleep(RATE_PAUSE_MS);
  }

  console.log(`\n🎉 [FIXTURE SYNC SELESAI]`);
  console.log(`- Fixture di store     : ${total} ditulis, ${countUpcoming()} total tersimpan`);
  console.log(`- Dilewati (di luar ${DAYS_AHEAD} hari): ${outside}`);
  console.log(`- Horizon API          : kickoff terjauh = ${horizonDate ?? "(tidak ada)"}`);
  console.log(`- Sisa budget request  : ${remainingBudget()} dari ${API_BUDGET_TOTAL}`);
  console.log(`- Di dataset utama    : ${(db.prepare("SELECT count(*) AS c FROM matches WHERE status != 'finished'").get() as any).c} baris scheduled (harus 0)`);
}

main().catch((err) => {
  console.error("[fixture-sync] gagal:", err);
  process.exit(1);
});