/**
 * TEST:RESOLVER-SCORE — review K8 butir 3B: resolver menilai pilihan dari
 * skor REGULASI (90 menit) yang terverifikasi, bukan dari skor sesudah
 * perpanjangan waktu / adu penalti.
 *
 * Semua kasus berjalan lewat RESOLVER NORMAL (scripts/resolve-pick-
 * outcomes.ts sebagai subprocess pada sandbox fixture):
 *   (1) Laga piala seri 1–1 di 90 menit lalu 2–1 sesudah ET → pilihan
 *       seri dinilai dari 1–1 (HIT), walau baris mentah saudara pick
 *       masih membawa status AET berskor 2–1.
 *   (2) Adu penalti 5–4 tanpa skor regulasi → pick TETAP pending dengan
 *       penanda pending_score_basis (tidak dinilai, tidak divoid) —
 *       dibuktikan untuk fixture terdaftar di lapisan identitas DAN
 *       untuk baris PEN mentah tanpa identitas sama sekali.
 *   (3) Koreksi skor regulasi resmi sesudahnya → outcome pick dinilai
 *       ulang, tiket resmi yang memuatnya berubah vonis, dan riwayat
 *       revisi dipertahankan utuh.
 *
 * Pakai: npm run test:data (suite ini dirangkai paling akhir).
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import {
  Suite,
  buildCoreSchemas,
  createFixtureEnv,
  openRo,
  runScript,
  seedDatasetTeams,
  settleFixtureEnv,
} from "./helpers/fixture-env";
import {
  applyResultObservation,
  ensureIdentitySchema,
  getFixtureByUid,
  getResultRevisions,
  linkAlias,
  resolveFixtureIdentity,
} from "../lib/identity/fixture-resolver";

function resolverNumbers(stdout: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of ["examined", "resolved", "corrected", "voided"]) {
    const m = new RegExp(`${key}: (\\d+)`).exec(stdout);
    out[key] = m ? Number(m[1]) : -1;
  }
  const pb = /pending-score-basis: (\d+)/.exec(stdout);
  out.pendingBasis = pb ? Number(pb[1]) : -1;
  return out;
}

async function main(): Promise<void> {
  const suite = new Suite("resolver-score 3B");
  const env = createFixtureEnv("res");
  process.chdir(env.root);
  const { ledger } = await buildCoreSchemas();
  const pub = await import("../lib/picks/publication");
  const tickets = await import("../lib/picks/tickets");

  seedDatasetTeams(env, [
    { team_id: "tm_alpha", name: "Alpha" },
    { team_id: "tm_beta", name: "Beta" },
    { team_id: "tm_gamma", name: "Gamma" },
    { team_id: "tm_delta", name: "Delta" },
    { team_id: "tm_eta", name: "Eta" },
    { team_id: "tm_theta", name: "Theta" },
    { team_id: "tm_eps", name: "Epsilon" },
    { team_id: "tm_zeta", name: "Zeta" },
  ]);
  const ds = new DatabaseSync(path.join(env.dataDir, "thestats_dataset.db"));
  ensureIdentitySchema(ds);
  // Baris mentah sebagaimana ditulis sumber: laga piala membawa status
  // AET/PEN dengan skor SESUDAH 90 menit di kolom skor satu-satunya.
  const insMatch = ds.prepare(
    `INSERT INTO matches (match_id, competition_id, season, utc_date, status,
       home_team_id, away_team_id, home_score, away_score, referee_name, updated_at)
     VALUES (?, ?, '2026-2027', ?, ?, ?, ?, ?, ?, NULL, '2026-11-18T00:00:00.000Z')`,
  );
  insMatch.run("sm_r3a", "CUP", "2026-11-19T20:00:00.000Z", "AET", "tm_alpha", "tm_beta", 2, 1);
  insMatch.run("mt_r3a", "CUP", "2026-11-19T20:00:00.000Z", "AET", "tm_alpha", "tm_beta", 2, 1);
  insMatch.run("sm_r3b", "CUP", "2026-11-19T21:00:00.000Z", "PEN", "tm_gamma", "tm_delta", 5, 4);
  insMatch.run("sm_r3c", "CUP", "2026-11-19T22:00:00.000Z", "PEN", "tm_eta", "tm_theta", 5, 4);
  insMatch.run("sm_r3d", "CUP", "2026-11-22T20:00:00.000Z", "finished", "tm_eps", "tm_zeta", 2, 1);

  const resolve = (id: string, home: string, away: string, kickoff: string): string => {
    const r = resolveFixtureIdentity(
      ds,
      {
        source: "sportmonks",
        sourceMatchId: id,
        competitionId: "CUP",
        homeCid: home,
        awayCid: away,
        kickoffUtc: kickoff,
        kickoffPrecision: "exact",
      },
      "2026-11-19T00:00:00.000Z",
    );
    if (r.kind === "ambiguous") throw new Error(`resolusi ${id} ambigu: ${r.reason}`);
    return r.fixtureUid;
  };
  const outcomeOf = (matchId: string) => {
    const pk = openRo(env, "picks.db");
    const row = pk
      .prepare(
        `SELECT o.home_goals AS hg, o.away_goals AS ag, o.hit AS hit
         FROM pick_outcomes o JOIN picks p ON p.id = o.pick_id WHERE p.match_id = ?`,
      )
      .get(matchId) as { hg: number; ag: number; hit: number } | undefined;
    pk.close();
    return row ?? null;
  };
  const voidCountFor = (matchId: string): number => {
    const pk = openRo(env, "picks.db");
    const row = pk
      .prepare(
        `SELECT COUNT(*) AS n FROM pick_voids v JOIN picks p ON p.id = v.pick_id WHERE p.match_id = ?`,
      )
      .get(matchId) as { n: number };
    pk.close();
    return row.n;
  };

  // ======================================================================
  console.log("\n— 3B-1: seri 1–1 di 90 menit, 2–1 sesudah ET → seri HIT —");
  // ======================================================================
  const uidA = resolve("sm_r3a", "tm_alpha", "tm_beta", "2026-11-19T20:00:00.000Z");
  linkAlias(ds, uidA, "thestats", "mt_r3a", "test_twin", "2026-11-19T00:00:00.000Z");
  const oA = applyResultObservation(ds, {
    fixtureUid: uidA,
    anchorMatchId: "sm_r3a",
    statusRaw: "AET",
    homeScore: 1,
    awayScore: 1,
    homeScoreEt: 2,
    awayScoreEt: 1,
    source: "test",
    observedAt: "2026-11-19T23:30:00.000Z",
  });
  suite.check("3B-1 observasi AET tercatat sebagai revisi 1", oA.revision === 1, JSON.stringify(oA));
  // Pick menunjuk baris SAUDARA mentah (mt_) yang selamanya AET 2–1.
  ledger.recordPick({
    match_id: "mt_r3a",
    competition_canonical_id: "CUP",
    kickoff_utc: "2026-11-19T20:00:00Z",
    market: "1x2",
    selection: "x",
    model_prob: 0.3,
    source: "live-run",
    created_utc: "2026-11-19T10:00:00.000Z",
  });

  // ======================================================================
  console.log("\n— 3B-2: penalti 5–4 tanpa regulasi → pending + penanda —");
  // ======================================================================
  const uidB = resolve("sm_r3b", "tm_gamma", "tm_delta", "2026-11-19T21:00:00.000Z");
  const oB = applyResultObservation(ds, {
    fixtureUid: uidB,
    anchorMatchId: "sm_r3b",
    statusRaw: "PEN",
    homeScore: null,
    awayScore: null,
    homeScorePen: 5,
    awayScorePen: 4,
    source: "test",
    observedAt: "2026-11-19T23:40:00.000Z",
  });
  suite.eq("3B-2 observasi penalti saja → pending_score_basis", oB.action, "pending_score_basis");
  ledger.recordPick({
    match_id: "sm_r3b",
    competition_canonical_id: "CUP",
    kickoff_utc: "2026-11-19T21:00:00Z",
    market: "1x2",
    selection: "1",
    model_prob: 0.5,
    source: "live-run",
    created_utc: "2026-11-19T10:00:00.000Z",
  });
  // Baris PEN mentah TANPA identitas sama sekali — jebakan yang sama.
  ledger.recordPick({
    match_id: "sm_r3c",
    competition_canonical_id: "CUP",
    kickoff_utc: "2026-11-19T22:00:00Z",
    market: "1x2",
    selection: "1",
    model_prob: 0.5,
    source: "live-run",
    created_utc: "2026-11-19T10:00:00.000Z",
  });

  // ======================================================================
  console.log("\n— 3B-3: koreksi regulasi resmi → pick + tiket terbarui —");
  // ======================================================================
  const uidD = resolve("sm_r3d", "tm_eps", "tm_zeta", "2026-11-22T20:00:00.000Z");
  const oD1 = applyResultObservation(ds, {
    fixtureUid: uidD,
    anchorMatchId: "sm_r3d",
    statusRaw: "FT",
    homeScore: 2,
    awayScore: 1,
    source: "test",
    observedAt: "2026-11-22T23:00:00.000Z",
  });
  suite.check("3B-3 observasi awal 2–1 → revisi 1", oD1.revision === 1, JSON.stringify(oD1));
  const pubD = pub.publishPicks(
    {
      series: "live-run",
      source_match_id: "sm_r3d",
      fixture_uid: uidD,
      competition_canonical_id: "CUP",
      kickoff_utc: "2026-11-22T20:00:00.000Z",
      scheduled_cutoff_utc: "2026-11-21T09:00:00.000Z",
      decision_at_utc: "2026-11-21T10:00:00.000Z",
      package: {
        trigger: "slate",
        payload: {
          kind: "quant-package",
          version: 1,
          legs: [{ market: "1x2", selection: "x", model_prob: 0.31, effective_prob: 0.3 }],
        },
      },
      legs: [
        {
          market: "1x2",
          selection: "x",
          model_prob: 0.31,
          effective_prob: 0.3,
          grade: "B",
          gate_status: "uncalibrated",
        },
      ],
    },
    {
      now: () => "2026-11-21T11:00:00.000Z",
      fixture_state: () => ({ status: "scheduled", kickoff_utc: "2026-11-22T20:00:00.000Z" }),
    },
  );
  suite.eq("3B-3 pick resmi (seri) terbit", pubD.status, "published");
  const slip = tickets.publishSlip({
    edition_key: "r3",
    slot: "koreksi",
    series: "live-run",
    published_utc: "2026-11-21T11:05:00.000Z",
    pick_ids: pubD.pick_ids,
  });
  suite.eq("3B-3 tiket resmi terbit memuat pick itu", slip.status, "published");

  // --- Resolver run 1: menilai yang bisa dinilai, menahan yang basisnya
  // belum diketahui.
  const r1 = runScript(env, "scripts/resolve-pick-outcomes.ts");
  const n1 = resolverNumbers(r1.stdout);
  suite.eq("3B resolver run 1: exit 0", r1.code, 0);
  suite.eq("3B resolver run 1: resolved 2", n1.resolved, 2);
  suite.eq("3B resolver run 1: pending-score-basis 2", n1.pendingBasis, 2);
  suite.eq(
    "3B-1 pilihan seri HIT dari skor regulasi 1–1 (bukan AET 2–1)",
    outcomeOf("mt_r3a"),
    { hg: 1, ag: 1, hit: 1 },
  );
  suite.eq(
    "3B-3 outcome awal dari regulasi 2–1: pilihan seri meleset",
    outcomeOf("sm_r3d"),
    { hg: 2, ag: 1, hit: 0 },
  );
  suite.eq("3B-2 penalti (identitas): TANPA outcome", outcomeOf("sm_r3b"), null);
  suite.eq("3B-2 penalti (identitas): tidak divoid", voidCountFor("sm_r3b"), 0);
  suite.eq("3B-2b penalti (mentah): TANPA outcome", outcomeOf("sm_r3c"), null);
  suite.eq("3B-2b penalti (mentah): tidak divoid", voidCountFor("sm_r3c"), 0);
  suite.eq(
    "3B-2 penanda basis tersimpan di fixture kanonik",
    getFixtureByUid(ds, uidB)?.score_basis,
    "pending_score_basis",
  );
  suite.eq(
    "3B-3 tiket sebelum koreksi: miss",
    tickets.getOfficialSlip(slip.slip_uid!)?.state,
    "miss",
  );

  // --- Koreksi regulasi resmi: 2–1 → 1–1. Resolver run 2 menilai ulang.
  const oD2 = applyResultObservation(ds, {
    fixtureUid: uidD,
    anchorMatchId: "sm_r3d",
    statusRaw: "FT",
    homeScore: 1,
    awayScore: 1,
    source: "test",
    observedAt: "2026-11-23T09:00:00.000Z",
  });
  suite.eq("3B-3 koreksi regulasi → action corrected", oD2.action, "corrected");
  const r2 = runScript(env, "scripts/resolve-pick-outcomes.ts");
  const n2 = resolverNumbers(r2.stdout);
  suite.eq("3B resolver run 2: exit 0", r2.code, 0);
  suite.eq("3B resolver run 2: corrected 1", n2.corrected, 1);
  suite.eq(
    "3B-3 outcome terbarui 1–1 → pilihan seri HIT",
    outcomeOf("sm_r3d"),
    { hg: 1, ag: 1, hit: 1 },
  );
  const revs = getResultRevisions(ds, uidD);
  suite.check(
    "3B-3 riwayat revisi dipertahankan (2 revisi: 2–1 lalu 1–1)",
    revs.length === 2 &&
      revs[0].home_score === 2 &&
      revs[0].away_score === 1 &&
      revs[1].home_score === 1 &&
      revs[1].away_score === 1,
    JSON.stringify(revs),
  );
  suite.eq(
    "3B-3 tiket sesudah koreksi: hit",
    tickets.getOfficialSlip(slip.slip_uid!)?.state,
    "hit",
  );
  suite.eq(
    "3B-1 outcome laga piala lain tidak ikut berubah",
    outcomeOf("mt_r3a"),
    { hg: 1, ag: 1, hit: 1 },
  );

  ds.close();
  settleFixtureEnv(env, suite.failedCount > 0);
  suite.finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
