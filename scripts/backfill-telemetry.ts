/**
 * BACKFILL HASIL + TELEMETRI SPORTMONKS → thestats_dataset.db
 *
 * Blok D PRD ekspansi DB. Urutan tier (keputusan PRD §10.2):
 * Eropa kasta 1 → 2 → 3 → piala Eropa → Amerika/LatAm → Asia → lainnya.
 *
 * - Hasil (fixtures + skor) untuk 3 jendela musim (Eropa: 2024/25, 2025/26,
 *   2026/27; kalender: 2024, 2025, 2026) → tabel `matches` (match_id sm_*).
 * - Telemetri statistik untuk musim berjalan + 1 musim sebelumnya →
 *   `team_match_logs` (source='sportmonks', xg_source='sportmonks', xG dari
 *   include xGFixture type 5304 — pola yang sama dengan sync SM 27 Okt).
 * - Aturan anti-karangan: hanya match FINISHED (state_id 5) dengan skor valid;
 *   statistik yang tidak disediakan API = NULL, tidak pernah 0 karangan.
 *   Skor NULL tidak pernah disimpan sebagai 0-0.
 * - Baris legacy tidak ditimpa: fixture SM yang jembatannya (sm_id_map) menuju
 *   match mt_* yang sudah punya team_match_logs dilewati untuk telemetri.
 * - Idempoten: INSERT OR REPLACE berbasis match_id / log_id.
 *
 * Endpoint kunci (terverifikasi probe 3 Nov 2026):
 *   GET /fixtures?filters=fixtureSeasons:{seasonId}&include=participants;scores[;statistics.type;xGFixture]
 *
 * Pakai:
 *   SPORTMONKS_API_TOKEN=... npx tsx scripts/backfill-telemetry.ts [--tier=EU1] [--league=8] [--max-leagues=3]
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { smGet } from "./sm-fetch";
import { normalizeTeamName } from "../lib/odds/sportmonks-wire";

const args = process.argv.slice(2);
const argVal = (k: string): string | null => {
  const hit = args.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split("=")[1] : null;
};
const TIER_FILTER = argVal("tier");
const LEAGUE_FILTER = argVal("league") ? Number(argVal("league")) : null;
const MAX_LEAGUES = argVal("max-leagues") ? Number(argVal("max-leagues")) : null;
const CURRENT_ONLY = args.includes("--current-only");

// ───────────────────────── Klasifikasi tier ─────────────────────────
const EUROPE = new Set([
  "England", "Scotland", "Wales", "Ireland", "Northern Ireland", "Spain", "Italy",
  "Germany", "France", "Netherlands", "Belgium", "Portugal", "Turkey", "Greece",
  "Poland", "Czech Republic", "Romania", "Denmark", "Sweden", "Norway", "Finland",
  "Austria", "Switzerland", "Croatia", "Serbia", "Ukraine", "Russia", "Israel",
  "Cyprus", "Hungary", "Slovakia", "Slovenia", "Bulgaria", "Bosnia and Herzegovina",
  "Montenegro", "North Macedonia", "Albania", "Kosovo", "Iceland", "Estonia",
  "Latvia", "Lithuania", "Belarus", "Moldova", "Georgia", "Armenia", "Azerbaijan",
  "Kazakhstan", "Malta", "Luxembourg", "Faroe Islands", "Gibraltar", "Andorra",
  "San Marino", "Europe",
]);
const AMERICAS = new Set([
  "United States", "USA", "Canada", "Mexico", "Brazil", "Argentina", "Colombia",
  "Chile", "Peru", "Ecuador", "Venezuela", "Uruguay", "Paraguay", "Bolivia",
  "Costa Rica", "Honduras", "Panama", "Guatemala", "Jamaica", "Haiti",
  "Dominican Republic", "Trinidad and Tobago", "El Salvador", "Nicaragua", "Cuba",
]);
const ASIA = new Set([
  "Saudi Arabia", "Japan", "United Arab Emirates", "Qatar", "South Korea",
  "Korea Republic", "China", "India", "Vietnam", "Thailand", "Indonesia",
  "Malaysia", "Singapore", "Philippines", "Hong Kong", "Bahrain", "Kuwait",
  "Oman", "Jordan", "Lebanon", "Iraq", "Iran", "Uzbekistan", "Australia", "Asia",
]);

export type Tier = "EU1" | "EU2" | "EU3" | "EUCUP" | "AM" | "AS" | "OTHER";
const TIER_ORDER: Record<Tier, number> = { EU1: 0, EU2: 1, EU3: 2, EUCUP: 3, AM: 4, AS: 5, OTHER: 6 };

const CUP_RE = /cup|beker|pokal|coupe|coppa|copa|ta[çc]a|kupa|trofeo|play-?offs?|friendl|shield|trophy/i;
export function classifyTier(name: string, country: string | null): { tier: Tier; compClass: "league" | "cup" } {
  const isCup = CUP_RE.test(name);
  const region = country && EUROPE.has(country) ? "EU" : country && AMERICAS.has(country) ? "AM" : country && ASIA.has(country) ? "AS" : "OTHER";
  if (region === "EU") {
    if (isCup) return { tier: "EUCUP", compClass: "cup" };
    let level = 1;
    if (country === "England") {
      if (/Championship/i.test(name)) level = 2;
      else if (/League One|League Two|National League/i.test(name)) level = 3;
    } else if (/1\. HNL/i.test(name)) level = 1;
    else if (/Serie B|La Liga 2|2\. Bundesliga|Ligue 2|Eerste Divisie|Challenger|Liga Portugal 2|Segunda|Division 2|1\. Lig|2\. Liga|Championship|First Division B|Superettan|1\. Division|OBOS/i.test(name)) level = 2;
    else if (/Serie C|3\. Liga|League Two|National League|Division 3|Primera Federaci|Second Division|2\. Division/i.test(name)) level = 3;
    else if (/\s2$|\sII$|\sB$/i.test(name)) level = 2;
    const tier = (level === 1 ? "EU1" : level === 2 ? "EU2" : "EU3") as Tier;
    return { tier, compClass: "league" };
  }
  if (region === "AM") return { tier: "AM", compClass: isCup ? "cup" : "league" };
  if (region === "AS") return { tier: "AS", compClass: isCup ? "cup" : "league" };
  return { tier: "OTHER", compClass: isCup ? "cup" : "league" };
}

// ───────────────────────── Tipe payload SM ─────────────────────────
interface SmParticipant { id: number; name: string; meta?: { location?: string } }
interface SmScore { participant_id: number; description?: string; score?: { goals?: number } }
interface SmStat { participant_id: number; type?: { name?: string }; data?: { value?: number | null } }
interface SmXg { participant_id: number; type_id: number; data?: { value?: number } }
interface SmFixture {
  id: number; league_id: number; season_id: number; state_id: number;
  starting_at: string;
  participants?: SmParticipant[]; scores?: SmScore[]; statistics?: SmStat[]; xgfixture?: SmXg[];
}
interface SmSeason { id: number; league_id: number; name: string; is_current?: boolean; ending_at?: string }

function dataPath(file: string): string {
  const dir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, file);
}

function extractGoals(f: SmFixture): { home: number; away: number; homeId: number; awayId: number } | null {
  const home = f.participants?.find((p) => p.meta?.location === "home");
  const away = f.participants?.find((p) => p.meta?.location === "away");
  if (!home || !away) return null;
  let hg: number | null = null;
  let ag: number | null = null;
  for (const s of f.scores ?? []) {
    if (s.description === "CURRENT" && typeof s.score?.goals === "number") {
      if (s.participant_id === home.id) hg = s.score.goals;
      if (s.participant_id === away.id) ag = s.score.goals;
    }
  }
  if (hg == null || ag == null) return null;
  return { home: hg, away: ag, homeId: home.id, awayId: away.id };
}

async function fetchSeasonFixtures(seasonId: number, full: boolean): Promise<SmFixture[]> {
  const include = full ? "participants;scores;statistics.type;xGFixture" : "participants;scores";
  const out: SmFixture[] = [];
  let page = 1;
  for (;;) {
    const body = await smGet<SmFixture>(
      `/fixtures?filters=fixtureSeasons:${seasonId}&include=${include}&per_page=100&page=${page}`,
    );
    out.push(...(body.data ?? []));
    if (!body.pagination?.has_more) break;
    page += 1;
  }
  return out;
}

async function main() {
  const db = new DatabaseSync(dataPath("thestats_dataset.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 30000;");

  // Pemetaan nama tim → id legacy (tm_*) bila ada; fallback id SM numerik.
  const teamRows = db.prepare("SELECT team_id, name FROM teams").all() as { team_id: string; name: string }[];
  const tmByNorm = new Map<string, string>();
  for (const t of teamRows) tmByNorm.set(normalizeTeamName(t.name), t.team_id);
  const resolveTeam = (smId: number, name: string): string =>
    tmByNorm.get(normalizeTeamName(name)) ?? String(smId);

  // Fixture SM yang sudah terwakili logs legacy (lewat jembatan mt_) → skip telemetri.
  const up = new DatabaseSync(dataPath("upcoming_fixtures.db"), { readOnly: true });
  const mapRows = up.prepare("SELECT match_id, sm_fixture_id FROM sm_id_map").all() as {
    match_id: string; sm_fixture_id: number;
  }[];
  const loggedMatches = new Set(
    (db.prepare("SELECT DISTINCT match_id FROM team_match_logs").all() as { match_id: string }[]).map((r) => r.match_id),
  );
  const skipTelemetryFor = new Set<number>();
  for (const m of mapRows) {
    if (!m.match_id.startsWith("sm_") && loggedMatches.has(m.match_id)) skipTelemetryFor.add(m.sm_fixture_id);
  }

  // Katalog liga SM.
  const leagues = up
    .prepare("SELECT competition_id, name, country FROM competition_catalog WHERE competition_id LIKE 'sm:%'")
    .all() as { competition_id: string; name: string; country: string | null }[];

  // Semua musim, dikelompokkan per liga.
  const seasons: SmSeason[] = [];
  {
    let page = 1;
    for (;;) {
      const body = await smGet<SmSeason>(`/seasons?per_page=100&page=${page}`);
      seasons.push(...(body.data ?? []));
      if (!body.pagination?.has_more) break;
      page += 1;
    }
  }
  const seasonsByLeague = new Map<number, SmSeason[]>();
  for (const s of seasons) {
    const arr = seasonsByLeague.get(s.league_id) ?? [];
    arr.push(s);
    seasonsByLeague.set(s.league_id, arr);
  }
  console.log(`Musim terambil: ${seasons.length}; liga katalog: ${leagues.length}`);

  const EU_WINDOWS = ["2024/2025", "2025/2026", "2026/2027"];
  const CAL_WINDOWS = ["2024", "2025", "2026"];

  interface Job { leagueId: number; name: string; country: string | null; tier: Tier; compClass: string; season: SmSeason; telemetry: boolean }
  const jobs: Job[] = [];
  for (const l of leagues) {
    const leagueId = Number(l.competition_id.slice(3));
    if (LEAGUE_FILTER != null && leagueId !== LEAGUE_FILTER) continue;
    const { tier, compClass } = classifyTier(l.name, l.country);
    if (TIER_FILTER && tier !== TIER_FILTER) continue;
    const lseasons = seasonsByLeague.get(leagueId) ?? [];
    const european = lseasons.some((s) => s.name.includes("/"));
    const windows = european ? EU_WINDOWS : CAL_WINDOWS;
    const chosen = windows
      .map((w) => lseasons.find((s) => s.name === w))
      .filter((s): s is SmSeason => !!s);
    chosen.forEach((s, i) => {
      jobs.push({
        leagueId, name: l.name, country: l.country, tier, compClass,
        season: s, telemetry: i >= chosen.length - 2, // 2 jendela terakhir
      });
    });
  }
  if (CURRENT_ONLY) {
    // Ritme harian: hanya jendela musim terakhir per liga (hasil + telemetri).
    const lastByLeague = new Map<number, Job>();
    for (const j of jobs) lastByLeague.set(j.leagueId, j);
    const keep = new Set(lastByLeague.values());
    for (let i = jobs.length - 1; i >= 0; i--) if (!keep.has(jobs[i])) jobs.splice(i, 1);
    for (const j of jobs) j.telemetry = true;
  }
  jobs.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.leagueId - b.leagueId);
  const leagueOrder: number[] = [];
  for (const j of jobs) if (!leagueOrder.includes(j.leagueId)) leagueOrder.push(j.leagueId);
  const limitedLeagues = MAX_LEAGUES != null ? new Set(leagueOrder.slice(0, MAX_LEAGUES)) : null;
  console.log(`Job liga-musim: ${jobs.length} untuk ${leagueOrder.length} liga${limitedLeagues ? ` (dibatasi ${MAX_LEAGUES} liga pertama)` : ""}`);

  // FK: matches/logs mereferensikan teams(team_id) — tim SM yang belum ada
  // harus didaftarkan dulu (aditif, dari data API; tidak menimpa baris lama).
  const insTeam = db.prepare(
    `INSERT OR IGNORE INTO teams (team_id, name, short_name, country, stadium, updated_at)
     VALUES (?, ?, NULL, ?, NULL, ?)`,
  );
  const knownTeams = new Set(
    (db.prepare("SELECT team_id FROM teams").all() as { team_id: string }[]).map((r) => r.team_id),
  );
  const ensureTeam = (teamId: string, name: string, country: string | null) => {
    if (knownTeams.has(teamId) || !name) return;
    insTeam.run(teamId, name, country, new Date().toISOString());
    knownTeams.add(teamId);
  };

  const insMatch = db.prepare(
    `INSERT OR REPLACE INTO matches (match_id, competition_id, season, utc_date, status, home_team_id, away_team_id, home_score, away_score, referee_name, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  );
  const insLog = db.prepare(
    `INSERT OR REPLACE INTO team_match_logs (
      log_id, match_id, team_id, opponent_id, venue, match_date, season, result,
      goals_for, goals_against, xg_for, xg_against,
      shots_for, shots_against, shots_on_target_for, shots_on_target_against,
      shots_off_target_for, shots_off_target_against, blocked_shots_for, blocked_shots_against,
      shots_inside_box_for, shots_inside_box_against, shots_outside_box_for, shots_outside_box_against,
      offsides_for, offsides_against, possession_pct,
      passes_total_for, passes_total_against, passes_accurate_for, passes_accurate_against,
      pass_accuracy_pct_for, pass_accuracy_pct_against,
      accurate_crosses_for, accurate_crosses_against, accurate_long_balls_for, accurate_long_balls_against,
      final_third_entries_for, final_third_entries_against,
      throw_ins_for, throw_ins_against, tackles_for, tackles_against,
      interceptions_for, interceptions_against, saves_for, saves_against,
      goal_kicks_for, goal_kicks_against, corners_for, corners_against,
      fouls_committed, yellow_cards, red_cards,
      big_chances_for, big_chances_against, big_chances_missed_for, big_chances_missed_against,
      raw_stats_json, created_at, source, data_tier, xg_source
    ) VALUES (${Array(63).fill("?").join(",")})`,
  );

  let totalMatches = 0;
  let totalLogs = 0;
  let totalSkippedLegacy = 0;
  for (const job of jobs) {
    if (limitedLeagues && !limitedLeagues.has(job.leagueId)) continue;
    // Fast-path: musim yang SUDAH SELESAI (ending_at lampau) dan datanya
    // sudah lengkap di store dilewati tanpa fetch — membuat restart murah.
    // Musim berjalan selalu di-fetch ulang (hasil baru masuk tiap hari).
    const seasonEnded = job.season.ending_at ? Date.parse(job.season.ending_at) < Date.now() : false;
    if (seasonEnded) {
      const existing = (
        db.prepare("SELECT COUNT(*) AS n FROM matches WHERE competition_id = ? AND season = ?")
          .get(`sm:${job.leagueId}`, job.season.name) as { n: number }
      ).n;
      if (existing > 0) {
        if (!job.telemetry) {
          console.log(`  [${job.tier}] ${job.name} ${job.season.name}: lewati (hasil sudah tersimpan ${existing})`);
          continue;
        }
        const logged = (
          db.prepare(
            `SELECT COUNT(DISTINCT match_id) AS n FROM team_match_logs
             WHERE source = 'sportmonks' AND match_id IN
               (SELECT match_id FROM matches WHERE competition_id = ? AND season = ?)`,
          ).get(`sm:${job.leagueId}`, job.season.name) as { n: number }
        ).n;
        if (logged >= 0.95 * existing) {
          console.log(`  [${job.tier}] ${job.name} ${job.season.name}: lewati (telemetri sudah ${logged}/${existing})`);
          continue;
        }
      }
    }
    let fixtures: SmFixture[];
    try {
      fixtures = await fetchSeasonFixtures(job.season.id, job.telemetry);
    } catch (e) {
      console.warn(`  [${job.tier}] ${job.name} ${job.season.name} GAGAL: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    let mCount = 0;
    let lCount = 0;
    db.prepare("BEGIN").run();
    try {
      for (const f of fixtures) {
        if (f.state_id !== 5) continue;
        const g = extractGoals(f);
        if (!g) continue; // skor tidak valid → tidak disimpan (anti-karangan)
        const matchId = `sm_${f.id}`;
        const homeName = f.participants?.find((p) => p.id === g.homeId)?.name ?? "";
        const awayName = f.participants?.find((p) => p.id === g.awayId)?.name ?? "";
        const homeTeamId = resolveTeam(g.homeId, homeName);
        const awayTeamId = resolveTeam(g.awayId, awayName);
        ensureTeam(homeTeamId, homeName, job.country);
        ensureTeam(awayTeamId, awayName, job.country);
        insMatch.run(
          matchId, `sm:${job.leagueId}`, job.season.name,
          new Date(f.starting_at.replace(" ", "T") + "Z").toISOString(),
          "finished", homeTeamId, awayTeamId, g.home, g.away, new Date().toISOString(),
        );
        mCount += 1;
        if (!job.telemetry) continue;
        if (skipTelemetryFor.has(f.id)) { totalSkippedLegacy += 1; continue; }
        // Statistik per partisipan berdasarkan NAMA type (bukti probe).
        const statBy = new Map<number, Map<string, number>>();
        for (const s of f.statistics ?? []) {
          if (!s.type?.name || typeof s.data?.value !== "number") continue;
          const m = statBy.get(s.participant_id) ?? new Map<string, number>();
          m.set(s.type.name, s.data.value);
          statBy.set(s.participant_id, m);
        }
        const xgBy = new Map<number, number>();
        for (const x of f.xgfixture ?? []) {
          if (x.type_id === 5304 && typeof x.data?.value === "number") xgBy.set(x.participant_id, x.data.value);
        }
        const rawJson = JSON.stringify({ sm_fixture_id: f.id, statistics: f.statistics ?? [], xgfixture: f.xgfixture ?? [] });
        const sides = [
          { pid: g.homeId, team: homeTeamId, opp: awayTeamId, venue: "HOME", gf: g.home, ga: g.away },
          { pid: g.awayId, team: awayTeamId, opp: homeTeamId, venue: "AWAY", gf: g.away, ga: g.home },
        ];
        for (const side of sides) {
          const own = statBy.get(side.pid) ?? new Map<string, number>();
          const oppId = side.venue === "HOME" ? g.awayId : g.homeId;
          const opp = statBy.get(oppId) ?? new Map<string, number>();
          const v = (m: Map<string, number>, k: string) => (m.has(k) ? (m.get(k) as number) : null);
          const result = side.gf > side.ga ? "W" : side.gf < side.ga ? "L" : "D";
          insLog.run(
            `smlog_${f.id}_${side.venue === "HOME" ? "h" : "a"}`, matchId, side.team, side.opp,
            side.venue, f.starting_at.slice(0, 10), job.season.name, result,
            side.gf, side.ga,
            xgBy.has(side.pid) ? (xgBy.get(side.pid) as number) : null,
            xgBy.has(oppId) ? (xgBy.get(oppId) as number) : null,
            v(own, "Shots Total"), v(opp, "Shots Total"),
            v(own, "Shots On Target"), v(opp, "Shots On Target"),
            v(own, "Shots Off Target"), v(opp, "Shots Off Target"),
            v(own, "Shots Blocked"), v(opp, "Shots Blocked"),
            v(own, "Shots Insidebox"), v(opp, "Shots Insidebox"),
            v(own, "Shots Outsidebox"), v(opp, "Shots Outsidebox"),
            v(own, "Offsides"), v(opp, "Offsides"),
            v(own, "Ball Possession %"),
            v(own, "Passes"), v(opp, "Passes"),
            v(own, "Successful Passes"), v(opp, "Successful Passes"),
            v(own, "Successful Passes Percentage"), v(opp, "Successful Passes Percentage"),
            v(own, "Accurate Crosses"), v(opp, "Accurate Crosses"),
            v(own, "Successful Long Passes"), v(opp, "Successful Long Passes"),
            v(own, "Final Third Entries"), v(opp, "Final Third Entries"),
            v(own, "Throwins"), v(opp, "Throwins"),
            v(own, "Tackles"), v(opp, "Tackles"),
            v(own, "Interceptions"), v(opp, "Interceptions"),
            v(own, "Saves"), v(opp, "Saves"),
            v(own, "Goal Kicks"), v(opp, "Goal Kicks"),
            v(own, "Corners"), v(opp, "Corners"),
            v(own, "Fouls"),
            v(own, "Yellowcards"), v(own, "Redcards"),
            v(own, "Big Chances Created"), v(opp, "Big Chances Created"),
            v(own, "Big Chances Missed"), v(opp, "Big Chances Missed"),
            rawJson, new Date().toISOString(), "sportmonks", "sportmonks_backfill", "sportmonks",
          );
          lCount += 1;
        }
      }
      db.prepare("COMMIT").run();
    } catch (e) {
      db.prepare("ROLLBACK").run();
      throw e;
    }
    totalMatches += mCount;
    totalLogs += lCount;
    console.log(`  [${job.tier}] ${job.name} (${job.country}) ${job.season.name}: ${mCount} hasil, ${lCount} logs${job.telemetry ? "" : " (hasil saja)"}`);
  }
  console.log(`SELESAI backfill: ${totalMatches} hasil, ${totalLogs} baris telemetri, ${totalSkippedLegacy} fixture dilewati (sudah terwakili legacy).`);
}

main().catch((e) => {
  console.error("GAGAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
