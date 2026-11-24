/**
 * SUITE Item 7 (Sprint C Fase 3) — adapter hasil football-data.org v4.
 *
 * Yang diverifikasi (kewajiban brief Fase 3):
 *  - Parser v4: FINISHED regular → skor fullTime; laga adu penalti →
 *    skor 90 menit dari regularTime (BUKAN fullTime pasca-ET); laga ET
 *    tanpa regularTime dilewati (skor tidak ditebak); non-FINISHED
 *    dikeluarkan.
 *  - HTTP 429 dihormati (Retry-After + satu kali ulang; 429 berulang →
 *    lempar). Rate limiter <= 9 req/menit menunggu lewat jam suntik.
 *  - Pemetaan ID kanonik: tim/kompetisi tak terpetakan → antrean
 *    identitas repo (fixture_identity_queue), ID tidak pernah dikarang,
 *    tidak ada baris hasil yang ditulis untuknya.
 *  - Precedence sumber kedua: jangkar primer finished berskor selalu
 *    menang (konflik dicatat di fdorg_result_revisions, jangkar utuh);
 *    jangkar belum finished diisi; tanpa jangkar primer baris fo_
 *    menjadi jangkar lewat mesin D2.
 *  - Revisi skor fdorg-vs-fdorg tercatat di result_revisions D2
 *    (revisi lama tidak hilang).
 *  - available_at terisi saat ingest pertama dan TIDAK ditimpa ulang;
 *    last_successful_ingest tercatat untuk source "football-data-org".
 */
import fs from "node:fs";
import path from "node:path";
import {
  Suite,
  createFixtureEnv,
  buildCoreSchemas,
  seedDatasetTeams,
  settleFixtureEnv,
} from "./helpers/fixture-env";
import {
  FDORG_SOURCE,
  FdorgRateLimiter,
  applyFdorgResults,
  fetchFdorgFinishedMatches,
  parseFdorgFinishedMatches,
  type FdorgFetchLike,
  type FdorgFinishedResult,
} from "../lib/feeds/fdorg-results";
import { getIngestStatus } from "../lib/feeds/ingest-freshness";
import { getResultRevisions, getUidForMatchId } from "../lib/identity/fixture-resolver";

const suite = new Suite("fdorg-results (Item 7)");
const NOW1 = "2026-11-25T02:00:00.000Z";
const NOW2 = "2026-11-25T03:00:00.000Z";

function result(over: Partial<FdorgFinishedResult>): FdorgFinishedResult {
  return {
    api_match_id: 9001,
    competition_code: "PL",
    kickoff_utc: "2026-11-22T17:30:00.000Z",
    home_name: "Arsenal",
    away_name: "Chelsea",
    home_goals: 2,
    away_goals: 1,
    score_basis: "fullTime",
    home_goals_et: null,
    away_goals_et: null,
    home_goals_pen: null,
    away_goals_pen: null,
    ...over,
  };
}

async function main(): Promise<void> {
  // --- Parser (murni) ---------------------------------------------------------
  const p1 = parseFdorgFinishedMatches(
    {
      matches: [
        {
          id: 1, utcDate: "2026-11-22T17:30:00Z", status: "FINISHED",
          homeTeam: { name: "Arsenal" }, awayTeam: { name: "Chelsea" },
          score: { duration: "REGULAR", fullTime: { home: 2, away: 1 } },
        },
        {
          id: 2, utcDate: "2026-11-21T20:00:00Z", status: "FINISHED",
          homeTeam: { name: "Liverpool" }, awayTeam: { name: "Everton" },
          score: {
            duration: "PENALTY_SHOOTOUT",
            regularTime: { home: 1, away: 1 },
            fullTime: { home: 2, away: 2 },
            extraTime: { home: 2, away: 2 },
            penalties: { home: 4, away: 3 },
          },
        },
        {
          id: 3, utcDate: "2026-11-21T18:00:00Z", status: "FINISHED",
          homeTeam: { name: "Arsenal" }, awayTeam: { name: "Liverpool" },
          score: { duration: "EXTRA_TIME", fullTime: { home: 2, away: 1 } },
        },
        {
          id: 4, utcDate: "2026-11-26T20:00:00Z", status: "TIMED",
          homeTeam: { name: "Arsenal" }, awayTeam: { name: "Everton" },
          score: { duration: "REGULAR", fullTime: { home: null, away: null } },
        },
      ],
    },
    "PL",
  );
  suite.eq("parser: 2 hasil lolos", p1.results.length, 2);
  suite.eq("parser: regular → fullTime 2-1", [p1.results[0].home_goals, p1.results[0].away_goals, p1.results[0].score_basis], [2, 1, "fullTime"]);
  suite.eq("parser: penalti → skor 90 menit regularTime 1-1", [p1.results[1].home_goals, p1.results[1].away_goals, p1.results[1].score_basis], [1, 1, "regularTime"]);
  suite.eq("parser: penalti terbawa terpisah 4-3", [p1.results[1].home_goals_pen, p1.results[1].away_goals_pen], [4, 3]);
  suite.eq("parser: ET tanpa regularTime dilewati (tidak ditebak)", p1.skipped_basis, 1);
  suite.eq("parser: non-FINISHED dikeluarkan", p1.skipped_status, 1);

  // --- Fetch: 429 dihormati ---------------------------------------------------
  {
    let calls = 0;
    const sleeps: number[] = [];
    const limiter = new FdorgRateLimiter({ sleep: async (ms) => { sleeps.push(ms); } });
    const fetchFn: FdorgFetchLike = async () => {
      calls++;
      if (calls === 1) {
        return {
          ok: false, status: 429,
          headers: { get: (n) => (n === "Retry-After" ? "0" : null) },
          json: async () => ({}),
        };
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ matches: [] }) };
    };
    const payload = await fetchFdorgFinishedMatches(fetchFn, "token-uji", "PL", limiter);
    suite.eq("fetch: 429 → ulang sekali lalu sukses", calls, 2);
    suite.check("fetch: menunggu Retry-After sebelum ulang", sleeps.length >= 1, `sleeps=${JSON.stringify(sleeps)}`);
    suite.eq("fetch: payload diteruskan", Array.isArray(payload.matches), true);

    let calls2 = 0;
    const fetch429: FdorgFetchLike = async () => {
      calls2++;
      return {
        ok: false, status: 429,
        headers: { get: () => "0" },
        json: async () => ({}),
      };
    };
    let threw = false;
    try {
      await fetchFdorgFinishedMatches(fetch429, "token-uji", "PL", new FdorgRateLimiter({ sleep: async () => {} }));
    } catch {
      threw = true;
    }
    suite.check("fetch: 429 berulang → lempar (berhenti)", threw && calls2 === 2, `calls=${calls2}`);
  }

  // --- Rate limiter: jendela menit ---------------------------------------------
  {
    let now = 1_000_000;
    const sleeps: number[] = [];
    const limiter = new FdorgRateLimiter({
      maxPerMinute: 2,
      now: () => now,
      sleep: async (ms) => { sleeps.push(ms); now += ms; },
    });
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    suite.check("limiter: req ke-3 dalam semenit menunggu", sleeps.length >= 1, `sleeps=${JSON.stringify(sleeps)}`);
  }

  // --- Penerapan ke dataset (sandbox) -------------------------------------------
  const env = createFixtureEnv("fdorg");
  const prevCwd = process.cwd();
  process.chdir(env.root);
  try {
    await buildCoreSchemas();
    fs.writeFileSync(
      path.join(env.dataDir, "team-canonical.json"),
      JSON.stringify({
        version: 1,
        generated_at: "2026-11-25T00:00:00.000Z",
        generator: "tests/test-fdorg-results.ts (fixture Sprint C)",
        teams: [
          { canonical_id: "tim_arsenal", name: "Arsenal", members: [{ team_id: "sm:1" }, { team_id: "fd_arsenal" }], aliases: [] },
          { canonical_id: "tim_chelsea", name: "Chelsea", members: [{ team_id: "sm:2" }, { team_id: "fd_chelsea" }], aliases: [] },
          { canonical_id: "tim_liverpool", name: "Liverpool", members: [{ team_id: "sm:3" }, { team_id: "fd_liverpool" }], aliases: [] },
          { canonical_id: "tim_everton", name: "Everton", members: [{ team_id: "sm:4" }, { team_id: "fd_everton" }], aliases: [] },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(env.dataDir, "league-canonical.json"),
      JSON.stringify({
        version: 1,
        generated_at: "2026-11-25T00:00:00.000Z",
        generator: "tests/test-fdorg-results.ts (fixture Sprint C)",
        leagues: [
          {
            canonical_id: "liga_inggris",
            name: "Premier League",
            country: "England",
            fits: [],
            aliases: [{ system: "legacy-div", id: "E0" }],
          },
        ],
      }),
    );
    seedDatasetTeams(env, [
      { team_id: "sm:1", name: "Arsenal" },
      { team_id: "sm:2", name: "Chelsea" },
      { team_id: "sm:3", name: "Liverpool" },
      { team_id: "sm:4", name: "Everton" },
    ]);

    const dataset = await import("../lib/db/thestats-dataset");
    const ds = dataset.getTheStatsDb();
    const insMatch = ds.prepare(
      `INSERT INTO matches (match_id, competition_id, season, utc_date, status, home_team_id, away_team_id, home_score, away_score, referee_name, updated_at)
       VALUES (?, 'E0', '2026-27', ?, ?, ?, ?, ?, ?, NULL, ?)`,
    );
    // Jangkar primer SUDAH finished 1-0 (Arsenal vs Chelsea, 15 Nov).
    insMatch.run("sm_19730001", "2026-11-15T16:00:00.000Z", "finished", "sm:1", "sm:2", 1, 0, NOW1);
    // Jangkar katalog belum finished (Liverpool vs Everton, 21 Nov).
    insMatch.run("sm_19730002", "2026-11-21T17:30:00.000Z", "scheduled", "sm:3", "sm:4", null, null, NOW1);

    const getMatch = (id: string) =>
      ds.prepare("SELECT * FROM matches WHERE match_id = ?").get(id) as unknown as
        | { status: string; home_score: number | null; away_score: number | null; available_at: string | null }
        | undefined;

    // (a) Tanpa jangkar primer → baris fo_ jadi jangkar, applied.
    const a = applyFdorgResults(ds, [result({})], NOW1);
    suite.eq("apply(a): applied=1", a.applied, 1);
    const foA = getMatch("fo_E0_20261122_arsenal_chelsea");
    suite.check("apply(a): baris fo_ finished 2-1", foA?.status === "finished" && foA?.home_score === 2 && foA?.away_score === 1);
    suite.eq("apply(a): available_at = momen ingest pertama", foA?.available_at, NOW1);
    const st = getIngestStatus(ds, FDORG_SOURCE);
    suite.eq("apply(a): last_successful_ingest tercatat", st?.last_successful_ingest_utc, NOW1);

    // (b) Duplikat persis → duplicate, available_at tidak ditimpa.
    const b = applyFdorgResults(ds, [result({})], NOW2);
    suite.eq("apply(b): duplicate=1", b.duplicates, 1);
    suite.eq("apply(b): available_at tetap NOW1", getMatch("fo_E0_20261122_arsenal_chelsea")?.available_at, NOW1);

    // (c) Koreksi skor fdorg-vs-fdorg → corrected + jejak revisi D2.
    const c = applyFdorgResults(ds, [result({ home_goals: 3 })], NOW2);
    suite.eq("apply(c): corrected=1", c.corrected, 1);
    suite.eq("apply(c): baris fo_ kini 3-1", getMatch("fo_E0_20261122_arsenal_chelsea")?.home_score, 3);
    const uid = getUidForMatchId(ds, "fo_E0_20261122_arsenal_chelsea");
    const revs = uid ? getResultRevisions(ds, uid) : [];
    suite.eq("apply(c): 2 revisi tersimpan (2-1 lalu 3-1)", revs.map((r) => [r.revision, r.home_score]), [[1, 2], [2, 3]]);

    // (d) Konflik dengan jangkar primer → primer menang, konflik tercatat.
    const d = applyFdorgResults(
      ds,
      [result({ api_match_id: 9002, kickoff_utc: "2026-11-15T16:00:00.000Z", home_goals: 2, away_goals: 1 })],
      NOW2,
    );
    suite.eq("apply(d): conflicts_primary_kept=1", d.conflicts_primary_kept, 1);
    const anchorD = getMatch("sm_19730001");
    suite.check("apply(d): jangkar primer tetap 1-0", anchorD?.home_score === 1 && anchorD?.away_score === 0);
    const revRow = ds
      .prepare("SELECT * FROM fdorg_result_revisions WHERE anchor_match_id = 'sm_19730001'")
      .get() as unknown as { primary_home: number; fdorg_home: number; resolution: string } | undefined;
    suite.check("apply(d): revisi konflik tercatat primary_kept", revRow?.resolution === "primary_kept" && revRow?.primary_home === 1 && revRow?.fdorg_home === 2);

    // (e) Jangkar belum finished → diisi lewat D2.
    const e = applyFdorgResults(
      ds,
      [result({
        api_match_id: 9003, kickoff_utc: "2026-11-21T17:30:00.000Z",
        home_name: "Liverpool", away_name: "Everton", home_goals: 3, away_goals: 1,
      })],
      NOW2,
    );
    suite.eq("apply(e): applied=1", e.applied, 1);
    const anchorE = getMatch("sm_19730002");
    suite.check("apply(e): jangkar kini finished 3-1", anchorE?.status === "finished" && anchorE?.home_score === 3 && anchorE?.away_score === 1);

    // (f) Tim tak terpetakan → antrean identitas, tanpa baris hasil.
    const f = applyFdorgResults(
      ds,
      [result({ api_match_id: 9004, home_name: "Wolverhampton Wanderers", kickoff_utc: "2026-11-20T20:00:00.000Z" })],
      NOW2,
    );
    suite.eq("apply(f): unmapped_team=1, rows_written=0", [f.unmapped_team, f.rows_written], [1, 0]);
    const q1 = ds
      .prepare("SELECT reason FROM fixture_identity_queue WHERE source = ? AND source_match_id = 'fo_match_9004' AND resolved_at IS NULL")
      .get(FDORG_SOURCE) as unknown as { reason: string } | undefined;
    suite.eq("apply(f): antrean fdorg_unmapped_team", q1?.reason, "fdorg_unmapped_team");

    // (g) Kompetisi tak terpetakan → antrean identitas.
    const g = applyFdorgResults(ds, [result({ api_match_id: 9005, competition_code: "CL" })], NOW2);
    suite.eq("apply(g): unmapped_competition=1", g.unmapped_competition, 1);
    const q2 = ds
      .prepare("SELECT reason FROM fixture_identity_queue WHERE source = ? AND source_match_id = 'fo_match_9005' AND resolved_at IS NULL")
      .get(FDORG_SOURCE) as unknown as { reason: string } | undefined;
    suite.eq("apply(g): antrean fdorg_unmapped_competition", q2?.reason, "fdorg_unmapped_competition");
  } finally {
    process.chdir(prevCwd);
    settleFixtureEnv(env, suite.failedCount > 0);
  }
  suite.finish();
}

main().catch((e) => {
  console.error("[fdorg-results] suite crash:", e);
  process.exit(1);
});
