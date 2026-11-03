/**
 * SYNC KATALOG SPORTMONKS → upcoming_fixtures.db
 *
 * Ditulis ulang oleh Spark (3 Nov 2026) karena file asli tidak ada di snapshot
 * proyek. Mengikuti kontrak yang sudah ada:
 * - Token HANYA dari env SPORTMONKS_API_TOKEN (tidak pernah ditulis ke file/log).
 * - Fixture SM masuk dengan match_id `sm_<fixtureId>`, competition_id `sm:<leagueId>`,
 *   team id = id numerik Sportmonks (string) — pola yang sama dengan 42 baris SM
 *   hasil sync 27 Okt 2026.
 * - Tulis lewat upsertUpcomingFixtures / upsertCompetitions (lib/db/upcoming-fixtures.ts)
 *   + baris sm_id_map per fixture (jembatan resolveSmFixtureId).
 * - Hanya fixture belum mulai (state_id 1) dengan kickoff >= sekarang.
 * - Menghormati rate_limit per respons: berhenti sopan (exit 2) bila sisa < 100
 *   agar bisa dilanjutkan sesudah reset — script ini idempoten, aman diulang.
 *
 * Pakai:
 *   SPORTMONKS_API_TOKEN=... npx tsx scripts/sync-sportmonks-fixtures.ts [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--dry-run]
 */
import {
  getUpcomingDb,
  upsertCompetitions,
  upsertUpcomingFixtures,
  type UpcomingFixture,
} from "../lib/db/upcoming-fixtures";

const BASE = "https://api.sportmonks.com/v3/football";
const TOKEN = process.env.SPORTMONKS_API_TOKEN ?? "";
if (!TOKEN) {
  console.error("SPORTMONKS_API_TOKEN belum di-set. Berhenti.");
  process.exit(1);
}

const args = process.argv.slice(2);
const argVal = (k: string, dflt: string) => {
  const hit = args.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split("=")[1] : dflt;
};
const DRY = args.includes("--dry-run");
const FROM = argVal("from", new Date().toISOString().slice(0, 10));
const TO = argVal("to", "2026-12-31");

interface SmParticipant {
  id: number;
  name: string;
  meta?: { location?: string };
}
interface SmFixture {
  id: number;
  league_id: number;
  starting_at: string;
  state_id: number;
  venue_id?: number | null;
  participants?: SmParticipant[];
  league?: { id: number; name: string; country_id?: number };
  venue?: { name?: string | null };
}
interface SmPage<T> {
  data: T[];
  pagination?: { has_more?: boolean; current_page?: number };
  rate_limit?: { remaining?: number; resets_in_seconds?: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function smGet<T>(path: string): Promise<SmPage<T>> {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  // Retry jaringan: koneksi API bisa putus di tengah respons — timeout 60 dtk
  // + mundur berjenjang, maksimal 5 percobaan (selaras scripts/sm-fetch.ts).
  let res: Response | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 60_000);
      try {
        res = await fetch(url, {
          headers: { Authorization: TOKEN, Accept: "application/json" },
          signal: ctl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      break;
    } catch (e) {
      if (attempt === 4) throw e;
      await sleep(5000 * (attempt + 1));
    }
  }
  res = res as Response;
  if (res.status === 429) {
    console.error("Kena 429 — berhenti sopan. Jalankan ulang sesudah reset.");
    process.exit(2);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} pada ${path}`);
  const body = (await res.json()) as SmPage<T>;
  const sisa = body.rate_limit?.remaining;
  if (typeof sisa === "number") {
    if (sisa < 100) {
      console.error(`Sisa kuota entity ${sisa} (<100) — berhenti sopan, aman dilanjutkan lagi.`);
      process.exit(2);
    }
  }
  await sleep(120);
  return body;
}

async function fetchAllPages<T>(pathNoPage: string): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  for (;;) {
    const sep = pathNoPage.includes("?") ? "&" : "?";
    const body = await smGet<T>(`${pathNoPage}${sep}per_page=100&page=${page}`);
    out.push(...body.data);
    if (!body.pagination?.has_more) break;
    page += 1;
  }
  return out;
}

function toIsoUtc(startingAt: string): string {
  // Sportmonks: "2026-11-03 20:00:00" (UTC) → "2026-11-03T20:00:00.000Z"
  return new Date(startingAt.replace(" ", "T") + "Z").toISOString();
}

async function main() {
  // 1) Liga langganan (My Leagues) — batas cakupan sync. Endpoint ini di luar
  // prefix /football, jadi di-fetch langsung (satu halaman, tanpa pagination).
  const myLeaguesBody = await smGet<{
    id: number;
    name: string;
    country_id?: number;
  }>("https://api.sportmonks.com/v3/my/leagues?per_page=100");
  const myLeagues = myLeaguesBody.data;
  const leagueById = new Map(myLeagues.map((l) => [l.id, l]));
  console.log(`Liga langganan: ${myLeagues.length}`);

  // 2) Nama negara untuk competition_country.
  const countries = await fetchAllPages<{ id: number; name: string }>(
    "https://api.sportmonks.com/v3/core/countries",
  );
  const countryById = new Map(countries.map((c) => [c.id, c.name]));

  // 3) Katalog kompetisi SM (aditif ke competition_catalog, id `sm:<leagueId>`).
  if (!DRY) {
    const n = upsertCompetitions(
      myLeagues.map((l) => ({
        competition_id: `sm:${l.id}`,
        name: l.name,
        country: l.country_id ? countryById.get(l.country_id) ?? null : null,
        payload: { source: "sportmonks", ...l },
      })),
    );
    console.log(`Katalog kompetisi SM ter-upsert: ${n}`);
  }

  // 4) Fixtures per potongan 7 hari.
  const now = Date.now();
  let kept = 0;
  let skipped = 0;
  let mapNew = 0;
  let mapExisting = 0;
  const perLeague = new Map<string, number>();
  const fromMs = new Date(FROM + "T00:00:00Z").getTime();
  const toMs = new Date(TO + "T23:59:59Z").getTime();
  for (let chunkStart = fromMs; chunkStart <= toMs; chunkStart += 7 * 86400_000) {
    const cFrom = new Date(chunkStart).toISOString().slice(0, 10);
    const cTo = new Date(Math.min(chunkStart + 6 * 86400_000, toMs)).toISOString().slice(0, 10);
    const fixtures = await fetchAllPages<SmFixture>(
      `/fixtures/between/${cFrom}/${cTo}?include=participants;league;venue`,
    );
    const rows: UpcomingFixture[] = [];
    const mapRows: {
      match_id: string;
      sm_fixture_id: number;
      home: string;
      away: string;
      date: string;
      league: string;
    }[] = [];
    for (const f of fixtures) {
      const league = leagueById.get(f.league_id) ?? f.league;
      if (!league || !leagueById.has(f.league_id)) {
        skipped += 1;
        continue;
      }
      if (f.state_id !== 1) {
        skipped += 1;
        continue;
      }
      const utc = toIsoUtc(f.starting_at);
      if (new Date(utc).getTime() < now) {
        skipped += 1;
        continue;
      }
      const home = f.participants?.find((p) => p.meta?.location === "home");
      const away = f.participants?.find((p) => p.meta?.location === "away");
      if (!home || !away) {
        skipped += 1;
        continue;
      }
      const country = league.country_id ? countryById.get(league.country_id) ?? null : null;
      rows.push({
        match_id: `sm_${f.id}`,
        competition_id: `sm:${f.league_id}`,
        competition_name: league.name,
        competition_country: country,
        utc_date: utc,
        status: "scheduled",
        stage_name: null,
        home_team_id: String(home.id),
        home_team_name: home.name,
        away_team_id: String(away.id),
        away_team_name: away.name,
        venue: f.venue?.name ?? null,
        is_neutral: null,
        odds_available: null,
        xg_available: null,
      });
      mapRows.push({
        match_id: `sm_${f.id}`,
        sm_fixture_id: f.id,
        home: home.name,
        away: away.name,
        date: utc.slice(0, 10),
        league: league.name,
      });
      perLeague.set(league.name, (perLeague.get(league.name) ?? 0) + 1);
    }
    if (!DRY && rows.length > 0) {
      upsertUpcomingFixtures(rows);
      const db = getUpcomingDb();
      const del = db.prepare("DELETE FROM sm_id_map WHERE match_id = ?");
      const exists = db.prepare("SELECT 1 AS x FROM sm_id_map WHERE sm_fixture_id = ?");
      const ins = db.prepare(
        "INSERT INTO sm_id_map (match_id, sm_fixture_id, home_norm, away_norm, kickoff_date, league, created_utc) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      const nowIso = new Date().toISOString();
      db.prepare("BEGIN").run();
      try {
        for (const m of mapRows) {
          del.run(m.match_id);
          // sm_fixture_id itu UNIQUE: bila fixture ini sudah terpetakan ke
          // match katalog lama (mt_*), mapping lama yang menang — jangan dobel.
          if (!exists.get(m.sm_fixture_id)) {
            ins.run(m.match_id, m.sm_fixture_id, m.home, m.away, m.date, m.league, nowIso);
            mapNew += 1;
          } else {
            mapExisting += 1;
          }
        }
        db.prepare("COMMIT").run();
      } catch (e) {
        db.prepare("ROLLBACK").run();
        throw e;
      }
    }
    kept += rows.length;
    console.log(`${cFrom} s/d ${cTo}: ${fixtures.length} fixture mentah, ${rows.length} disimpan (total ${kept})`);
  }

  console.log(
    `\nSELESAI${DRY ? " (dry-run)" : ""}: disimpan ${kept}, dilewati ${skipped}, sm_id_map baru ${mapNew}, sudah terpetakan ${mapExisting}`,
  );
  console.log("Per liga (top 15):");
  [...perLeague.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([k, v]) => console.log(`  ${k}: ${v}`));
}

main().catch((e) => {
  console.error("GAGAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
