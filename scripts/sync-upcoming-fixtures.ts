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
import { upsertUpcomingFixtures, countUpcoming, type UpcomingFixture } from "../lib/db/upcoming-fixtures";

const DO_MIGRATE = process.argv.includes("--migrate");
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const DAYS_AHEAD = Number(positional[0]) || 30;
const HORIZON_DAYS = 30; // endpoint list tidak punya filter tanggal → tarik 30, potong lokal
const API_BASE = "https://api.thestatsapi.com/api";
const PER_PAGE = 100;
const RATE_PAUSE_MS = 600; // ≈100 req/menit, di bawah limit 120/menit

const db = getTheStatsDb();
const apiKey = process.env.STATS_API_KEY;
if (!apiKey) {
  console.error("[CRITICAL] STATS_API_KEY tidak ada di .env.local — sync dibatalkan.");
  process.exit(1);
}

const now = Date.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let requests = 0;

async function fetchList(competitionId: string, page: number): Promise<any[]> {
  const url =
    `${API_BASE}/football/matches?competition_id=${competitionId}` +
    `&status=scheduled&per_page=${PER_PAGE}&page=${page}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    requests++;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (res.status === 429) {
      const waitMs = 2000 * attempt;
      console.warn(`⚠️ 429 — tunggu ${waitMs / 1000}s (percobaan ${attempt}/4)`);
      await sleep(waitMs);
      continue;
    }
    if (!res.ok) {
      console.warn(`⚠️ HTTP ${res.status} untuk ${competitionId} — dilewati.`);
      return [];
    }
    const json: any = await res.json();
    return Array.isArray(json?.data) ? json.data : [];
  }
  return [];
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

async function main() {
  if (DO_MIGRATE) {
    migrateFromDataset();
  }

  console.log(`🔮 [FIXTURE UPCOMING] Jadwal ${DAYS_AHEAD} hari ke depan → upcoming_fixtures.db`);
  let total = 0;
  let outside = 0;

  for (const comp of Object.values(TARGET_COMPETITIONS)) {
    const batch: UpcomingFixture[] = [];
    let page = 1;
    while (page <= 3) {
      const matches = await fetchList(comp.id, page);
      if (matches.length === 0) break;
      for (const m of matches) {
        const utc = m.utc_date ?? null;
        if (!utc) continue;
        const ms = Date.parse(utc);
        if (Number.isNaN(ms)) continue;
        if (ms < now || ms > now + DAYS_AHEAD * 24 * 60 * 60 * 1000) {
          outside++;
          continue;
        }
        batch.push({
          match_id: String(m.id),
          competition_id: comp.id,
          competition_name: m.competition_name ?? comp.name,
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
  console.log(`- Total Request API    : ${requests}`);
  console.log(`- Di dataset utama    : ${(db.prepare("SELECT count(*) AS c FROM matches WHERE status != 'finished'").get() as any).c} baris scheduled (harus 0)`);
}

main().catch((err) => {
  console.error("[fixture-sync] gagal:", err);
  process.exit(1);
});