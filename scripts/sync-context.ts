/**
 * KONTEKS PERTANDINGAN (BLOK F) → tabel baru di thestats_dataset.db:
 *   standings        — klasemen musim berjalan semua liga katalog aktif
 *   prematch_news    — berita pra-pertandingan untuk fixture ≤7 hari
 *   expected_lineups — susunan pemain (include=lineups) fixture ≤7 hari
 *   h2h_cache        — head-to-head pasangan yang bertanding ≤7 hari
 * Semua payload berlabel sumber Sportmonks + fetched_utc. Idempoten
 * (INSERT OR REPLACE). Yang kosong disimpan apa adanya (berita/lineup/H2H
 * memang bisa belum terbit — itu dicatat sebagai tidak adanya baris,
 * tidak pernah dikarang).
 *
 * Pakai: SPORTMONKS_API_TOKEN=... npx tsx scripts/sync-context.ts [--days=7]
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { smGet, smGetAllPages } from "./sm-fetch";

const args = process.argv.slice(2);
const DAYS = (() => {
  const hit = args.find((a) => a.startsWith("--days="));
  return hit ? Number(hit.split("=")[1]) : 7;
})();

function dataPath(file: string): string {
  const dir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, file);
}

interface SmSeason { id: number; league_id: number; is_current?: boolean }
interface StandingRow { participant_id: number; position?: number; points?: number }
interface NewsItem { fixture_id: number }
interface LineupEntry { team_id?: number; participant_id?: number }
async function main() {
  const db = new DatabaseSync(dataPath("thestats_dataset.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 30000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS standings (
      league_id TEXT NOT NULL, season_id INTEGER NOT NULL, team_id TEXT NOT NULL,
      position INTEGER, points INTEGER, payload_json TEXT NOT NULL, fetched_utc TEXT NOT NULL,
      PRIMARY KEY (league_id, season_id, team_id)
    );
    CREATE TABLE IF NOT EXISTS prematch_news (
      fixture_sm_id INTEGER PRIMARY KEY, payload_json TEXT NOT NULL, fetched_utc TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS expected_lineups (
      fixture_sm_id INTEGER NOT NULL, side TEXT NOT NULL,
      payload_json TEXT NOT NULL, fetched_utc TEXT NOT NULL,
      PRIMARY KEY (fixture_sm_id, side)
    );
    CREATE TABLE IF NOT EXISTS h2h_cache (
      pair_key TEXT PRIMARY KEY, payload_json TEXT NOT NULL, fetched_utc TEXT NOT NULL
    );
  `);
  const nowIso = new Date().toISOString();

  const up = new DatabaseSync(dataPath("upcoming_fixtures.db"), { readOnly: true });
  const leagues = up
    .prepare("SELECT competition_id FROM competition_catalog WHERE competition_id LIKE 'sm:%'")
    .all() as { competition_id: string }[];

  // ── Standings: musim berjalan per liga ──
  const seasons = await smGetAllPages<SmSeason>("/seasons?per_page=100");
  const currentByLeague = new Map<number, number>();
  for (const s of seasons) if (s.is_current) currentByLeague.set(s.league_id, s.id);
  const insStanding = db.prepare(
    `INSERT OR REPLACE INTO standings (league_id, season_id, team_id, position, points, payload_json, fetched_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  let standingRows = 0;
  let standingLeagues = 0;
  for (const l of leagues) {
    const leagueId = Number(l.competition_id.slice(3));
    const seasonId = currentByLeague.get(leagueId);
    if (!seasonId) continue;
    try {
      const body = await smGet<StandingRow>(`/standings/seasons/${seasonId}`);
      const rows = body.data ?? [];
      if (rows.length === 0) continue;
      db.prepare("BEGIN").run();
      try {
        for (const r of rows) {
          insStanding.run(l.competition_id, seasonId, String(r.participant_id),
            r.position ?? null, r.points ?? null, JSON.stringify(r), nowIso);
          standingRows += 1;
        }
        db.prepare("COMMIT").run();
      } catch (e) { db.prepare("ROLLBACK").run(); throw e; }
      standingLeagues += 1;
    } catch (e) {
      console.warn(`  standings ${l.competition_id} gagal: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`Standings: ${standingRows} baris dari ${standingLeagues} liga.`);

  // ── Fixture ≤DAYS hari (jendela konteks) ──
  const now = Date.now();
  const horizon = now + DAYS * 86400_000;
  const fixtures = (
    up.prepare(
      `SELECT match_id, home_team_id, away_team_id, utc_date FROM upcoming_fixtures
       WHERE match_id LIKE 'sm_%' ORDER BY utc_date`,
    ).all() as { match_id: string; home_team_id: string | null; away_team_id: string | null; utc_date: string }[]
  )
    .map((f) => ({
      match_id: f.match_id,
      sm_id: Number(f.match_id.slice(3)),
      league_sm: 0,
      home_team_id: f.home_team_id,
      away_team_id: f.away_team_id,
      kickoff_utc: f.utc_date,
    }))
    .filter((f) => {
      const t = Date.parse(f.kickoff_utc);
      return t >= now - 3 * 3600_000 && t <= horizon;
    });
  console.log(`Fixture jendela ${DAYS} hari: ${fixtures.length}`);

  // ── Berita pra-pertandingan (endpoint global, difilter lokal) ──
  const fixtureIds = new Set(fixtures.map((f) => f.sm_id));
  const news = await smGetAllPages<NewsItem>("/news/pre-match?per_page=100");
  const newsByFixture = new Map<number, NewsItem[]>();
  for (const n of news) {
    if (!fixtureIds.has(n.fixture_id)) continue;
    const arr = newsByFixture.get(n.fixture_id) ?? [];
    arr.push(n);
    newsByFixture.set(n.fixture_id, arr);
  }
  const insNews = db.prepare(
    "INSERT OR REPLACE INTO prematch_news (fixture_sm_id, payload_json, fetched_utc) VALUES (?, ?, ?)",
  );
  for (const [fid, items] of newsByFixture) insNews.run(fid, JSON.stringify(items), nowIso);
  console.log(`Berita: ${newsByFixture.size} fixture punya berita (dari ${news.length} item global).`);

  // ── Lineup + H2H per fixture ──
  const insLineup = db.prepare(
    "INSERT OR REPLACE INTO expected_lineups (fixture_sm_id, side, payload_json, fetched_utc) VALUES (?, ?, ?, ?)",
  );
  const insH2h = db.prepare(
    "INSERT OR REPLACE INTO h2h_cache (pair_key, payload_json, fetched_utc) VALUES (?, ?, ?)",
  );
  let lineupFixtures = 0;
  let h2hPairs = 0;
  const donePairs = new Set<string>();
  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i];
    try {
      const body = await smGet<LineupEntry>(`/fixtures/${f.sm_id}?include=lineups`);
      const entries = ((body.data as unknown as { lineups?: LineupEntry[] } | undefined)?.lineups) ?? [];
      if (entries.length > 0) {
        const bySide = new Map<string, LineupEntry[]>();
        for (const e of entries) {
          const tid = String(e.team_id ?? e.participant_id ?? "");
          const side = tid === f.home_team_id ? "home" : tid === f.away_team_id ? "away" : "unknown";
          const arr = bySide.get(side) ?? [];
          arr.push(e);
          bySide.set(side, arr);
        }
        for (const [side, arr] of bySide) insLineup.run(f.sm_id, side, JSON.stringify(arr), nowIso);
        lineupFixtures += 1;
      }
    } catch (e) {
      console.warn(`  lineup ${f.sm_id} gagal: ${e instanceof Error ? e.message : e}`);
    }
    if (f.home_team_id && f.away_team_id) {
      const [a, b] = [f.home_team_id, f.away_team_id].sort();
      const pairKey = `${a}_${b}`;
      if (!donePairs.has(pairKey)) {
        donePairs.add(pairKey);
        try {
          const body = await smGet<unknown>(`/fixtures/head-to-head/${f.home_team_id}/${f.away_team_id}`);
          insH2h.run(pairKey, JSON.stringify(body.data ?? []), nowIso);
          h2hPairs += 1;
        } catch (e) {
          console.warn(`  h2h ${pairKey} gagal: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
    if ((i + 1) % 100 === 0) console.log(`  konteks progres: ${i + 1}/${fixtures.length} fixture`);
  }
  console.log(`Lineup: ${lineupFixtures} fixture; H2H: ${h2hPairs} pasangan.`);
  console.log("SELESAI sync-context.");
}

main().catch((e) => {
  console.error("GAGAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
