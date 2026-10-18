/**
 * SYNC FIXTURE UPCOMING (Plan B) — taruh jadwal 30 hari ke depan ke `matches`.
 *
 * Kenapa ada: `sync:weekly` cuma menarik `status=finished`, jadi tabel
 * `matches` tidak pernah punya fixture yang belum main. Akibatnya analisis
 * pre-match tidak bisa relies pada jadwal lokal.
 *
 * Keamanannya (WAJIB, jangan dibalik):
 * - Script ini TIDAK menulis `team_match_logs` (belum ada statistik pasca-laga).
 * - Semua pembaca `matches` untuk konteks analisis memfilter
 *   `status='finished' AND home_score IS NOT NULL` + cutoff tanggal
 *   (lihat `getLocalRecentMatches` / `getLocalH2HMatches`), jadi baris
 *   `scheduled` tidak pernah sampai ke model quant maupun ke LLM.
 *
 * Idempotent (upsert). Aman dijalankan berulang.
 * Jalankan: npx tsx scripts/sync-upcoming-fixtures.ts [hari]  (default 30)
 */
try {
  if (typeof (process as any).loadEnvFile === "function") {
    (process as any).loadEnvFile(".env.local");
  }
} catch {}

try {
  if (typeof (process as any).loadEnvFile === "function") {
    (process as any).loadEnvFile(".env.local");
  }
} catch {}

import { TARGET_COMPETITIONS } from "../lib/thestats-competitions";
import { getTheStatsDb, upsertTeam, upsertMatch } from "../lib/db/thestats-dataset";

const DAYS_AHEAD = Number(process.argv[2]) || 30;
const HORIZON_DAYS = 30; // TheStatsAPI tidak punya filter tanggal di endpoint list → tarik 30, potong lokal
const API_BASE = "https://api.thestatsapi.com/api";
const PER_PAGE = 100;
const RATE_PAUSE_MS = 600; // ≈100 request/menit, di bawah limit 120/menit

const db = getTheStatsDb();
const apiKey = process.env.STATS_API_KEY;
if (!apiKey) {
  console.error("[CRITICAL] STATS_API_KEY tidak ada di .env.local — sync dibatalkan.");
  process.exit(1);
}

const now = Date.now();
const cutoff = new Date(now + HORIZON_DAYS * 24 * 60 * 60 * 1000).toISOString();
let inserted = 0;
let skippedPast = 0;
let requests = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

async function main() {
  console.log(`🔮 [FIXTURE UPCOMING] Jadwal ${DAYS_AHEAD} hari ke depan (tarik ${HORIZON_DAYS} hari, potong lokal)`);

  for (const comp of Object.values(TARGET_COMPETITIONS)) {
    let page = 1;
    let compInserted = 0;
    while (page <= 3) {
      const matches = await fetchList(comp.id, page);
      if (matches.length === 0) break;
      for (const m of matches) {
        const utc = m.utc_date ?? null;
        if (!utc) continue;
        const ms = Date.parse(utc);
        if (Number.isNaN(ms)) continue;
        // Hanya masa depan, dan hanya dalam horizon yang diminta.
        if (ms < now) { skippedPast++; continue; }
        if (ms > now + DAYS_AHEAD * 24 * 60 * 60 * 1000) { skippedPast++; continue; }

        const home = m.home_team;
        const away = m.away_team;
        if (!home?.id || !away?.id) continue;

        // Tim harus ada lebih dulu (FK matches → teams).
        upsertTeam({ team_id: String(home.id), name: home.name ?? String(home.id) });
        upsertTeam({ team_id: String(away.id), name: away.name ?? String(away.id) });
        upsertMatch({
          match_id: String(m.id),
          competition_id: comp.id,
          season: String(m.season_id ?? comp.seasonName ?? comp.seasonName),
          utc_date: utc,
          status: String(m.status ?? "scheduled"),
          home_team_id: String(home.id),
          away_team_id: String(away.id),
        });
        compInserted++;
      }
      if (matches.length < PER_PAGE) break;
      page++;
      await sleep(RATE_PAUSE_MS);
    }
    inserted += compInserted;
    console.log(`-> ${comp.name}: ${compInserted} fixture masuk (total ${inserted})`);
    await sleep(RATE_PAUSE_MS);
  }

  const total = (db.prepare("SELECT count(*) AS c FROM matches").get() as any).c as number;
  const upcoming = (
    db.prepare("SELECT count(*) AS c FROM matches WHERE utc_date > datetime('now') AND status != 'finished'").get() as any
  ).c as number;
  console.log(`\n🎉 [FIXTURE SYNC SELESAI]`);
  console.log(`- Fixture Dipasang      : ${inserted}`);
  console.log(`- Dilewati (di luar ${DAYS_AHEAD} hari): ${skippedPast}`);
  console.log(`- Total Request API    : ${requests}`);
  console.log(`- Total match di DB    : ${total} (${upcoming} akan datang)`);
  console.log(`\nCatatan: baris scheduled TIDAK punya team_match_logs, dan pembaca konteks`);
  console.log(`memfilter status='finished' — jadi tidak bisa bocor ke model/LLM.`);
}

main().catch((err) => {
  console.error("[fixture-sync] gagal:", err);
  process.exit(1);
});