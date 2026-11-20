/**
 * TEST:IDENTITY — suite K1 untuk PRD D02, D03, D04 (acceptance.json).
 * (D01 hidup sebagai regresi hijau di test:baseline:d01.)
 *
 *  D02 — dua grup registry audit (sm_19735411, sm_19735118): skor 2–1
 *        fixture HANYA di baris dataset alias fd_; 4 pick lama lintas id
 *        harus 4/4 tertelusur ke 2 fixture unik; adapter web membaca skor
 *        yang sama dari SETIAP id lama per grup.
 *  D03 — algoritme pencocokan D1 di level modul: dua leg tidak digabung;
 *        sisi tertukar / banyak kandidat / tanggal tanpa jam / konflik
 *        babak → antrean `identity_ambiguous` tanpa UID; reschedule pada
 *        alias yang sama mempertahankan UID; resolusi idempoten lintas
 *        koneksi (proses) baru.
 *  D04 — aturan hasil D2 ujung-ke-ujung: observasi FT 1–0 → hit; duplikat
 *        finished 1–0 tanpa revisi baru; koreksi FT 0–0 → revisi 2 +
 *        resolver menilai ulang pick menjadi miss (histori [hit, miss],
 *        skor revisi 1 utuh); polling scheduled/null lama tidak
 *        menurunkan final; piala diselesaikan dari skor 90 menit (ET
 *        terpisah; ET saja → pending_score_basis); cancelled → void
 *        sesuai SETTLEMENT_POLICY_VERSION.
 *
 * Pakai: npm run test:data (suite ini dirangkai sesudah test-data.ts)
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import {
  Suite,
  createFixtureEnv,
  openRo,
  runScript,
  settleFixtureEnv,
  type FixtureEnv,
} from "./helpers/fixture-env";
import { D02_IDS, buildD02Sandbox, readSandboxJson, runProbe } from "./helpers/scenarios";
import {
  SETTLEMENT_POLICY_VERSION,
  applyResultObservation,
  ensureIdentitySchema,
  getAliasesForUid,
  getFixtureByUid,
  getResultRevisions,
  getUidForMatchId,
  resolveFixtureIdentity,
} from "../lib/identity/fixture-resolver";

const NOW = "2026-11-20T00:00:00.000Z";

function resolverNumbers(stdout: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of ["examined", "resolved", "corrected", "voided"]) {
    const m = new RegExp(`${key}: (\\d+)`).exec(stdout);
    out[key] = m ? Number(m[1]) : -1;
  }
  return out;
}

// ============================================================================
// D02
// ============================================================================

async function blockD02(suite: Suite, env: FixtureEnv): Promise<void> {
  console.log("\n[D02] alias lama registry audit");

  const bld = runScript(env, "scripts/build-fixture-links.ts");
  suite.check("D02 builder: exit 0", bld.code === 0, bld.stderr.slice(0, 300));
  const linksFile = readSandboxJson<{
    links: { twin_id: string; canonical_id: string }[];
    stats: { fixtures: number };
  }>(env, "fixture-links.json");
  suite.eq("D02 builder: katalog memuat 5 baris fixture", linksFile.stats.fixtures, 5);
  suite.eq("D02 builder: 3 tautan kembar (1 grup-1 + 2 grup-2)", linksFile.links.length, 3);

  const ds = openRo(env, "thestats_dataset.db");
  const uidOf = (id: string) =>
    (
      ds
        .prepare("SELECT fixture_uid AS uid FROM fixture_aliases WHERE source_match_id = ?")
        .get(id) as { uid: string } | undefined
    )?.uid ?? null;
  const nFixtures = (ds.prepare("SELECT COUNT(*) AS n FROM canonical_fixtures").get() as { n: number }).n;
  const nAliases = (ds.prepare("SELECT COUNT(*) AS n FROM fixture_aliases").get() as { n: number }).n;
  suite.eq("D02 identitas: tepat 2 fixture kanonik", nFixtures, 2);
  suite.eq("D02 identitas: 5 alias terdaftar (2 + 3)", nAliases, 5);
  suite.check(
    "D02 identitas: grup 1 satu UID",
    uidOf(D02_IDS.g1Canonical) !== null && uidOf(D02_IDS.g1Canonical) === uidOf(D02_IDS.g1Fd),
  );
  suite.check(
    "D02 identitas: grup 2 satu UID untuk sm_/fd_/mt_",
    uidOf(D02_IDS.g2Canonical) !== null &&
      uidOf(D02_IDS.g2Canonical) === uidOf(D02_IDS.g2Fd) &&
      uidOf(D02_IDS.g2Canonical) === uidOf(D02_IDS.g2Mt),
  );
  suite.check(
    "D02 identitas: UID antar grup berbeda",
    uidOf(D02_IDS.g1Canonical) !== uidOf(D02_IDS.g2Canonical),
  );
  ds.close();

  const res = runScript(env, "scripts/resolve-pick-outcomes.ts");
  const nums = resolverNumbers(res.stdout);
  suite.check("D02 resolver: exit 0", res.code === 0, res.stderr.slice(0, 300));
  suite.eq("D02 resolver: examined 4 pick lama", nums.examined, 4);
  suite.eq("D02 resolver: 4/4 pick lama tertelusur (resolved)", nums.resolved, 4);

  const pk = openRo(env, "picks.db");
  const outcomes = pk
    .prepare(
      `SELECT p.match_id AS mid, o.home_goals AS hg, o.away_goals AS ag, o.hit AS hit
       FROM pick_outcomes o JOIN picks p ON p.id = o.pick_id ORDER BY p.id ASC`,
    )
    .all() as unknown as { mid: string; hg: number; ag: number; hit: number }[];
  pk.close();
  suite.eq("D02 ledger: 4 outcome tertulis", outcomes.length, 4);
  suite.check(
    "D02 ledger: semua outcome skor 2–1 dan hit (2 keputusan headline unik)",
    outcomes.every((o) => o.hg === 2 && o.ag === 1 && o.hit === 1),
    JSON.stringify(outcomes),
  );

  const probe = runProbe(env, [
    D02_IDS.g1Canonical,
    D02_IDS.g1Fd,
    D02_IDS.g2Canonical,
    D02_IDS.g2Fd,
    D02_IDS.g2Mt,
  ]);
  const expected = { home_goals: 2, away_goals: 1, finished: true };
  for (const id of [D02_IDS.g1Canonical, D02_IDS.g1Fd, D02_IDS.g2Canonical, D02_IDS.g2Fd, D02_IDS.g2Mt]) {
    suite.eq(`D02 web: getResult(${id}) = 2–1 finished`, probe.perId[id].result, expected);
  }
}

// ============================================================================
// D03
// ============================================================================

function blockD03(suite: Suite): void {
  console.log("\n[D03] algoritme pencocokan identitas (level modul)");
  const env = createFixtureEnv("d03mod");
  const file = path.join(env.dataDir, "identity-d03.db");
  let db = new DatabaseSync(file);
  ensureIdentitySchema(db);

  const base = {
    competitionId: "CUPX",
    homeCid: "tm_x",
    awayCid: "tm_y",
    homeName: "X FC",
    awayName: "Y FC",
    kickoffPrecision: "exact" as const,
  };

  // Dua leg tim sama dalam dua hari TIDAK digabung.
  const leg1 = resolveFixtureIdentity(db, {
    ...base, source: "sportmonks", sourceMatchId: "sm_leg1",
    kickoffUtc: "2026-11-10T19:00:00.000Z", stageOrLeg: "leg1",
  }, NOW);
  const leg2 = resolveFixtureIdentity(db, {
    ...base, source: "sportmonks", sourceMatchId: "sm_leg2",
    kickoffUtc: "2026-11-12T19:00:00.000Z", stageOrLeg: "leg2",
  }, NOW);
  suite.check("D03: leg 1 terbuat", leg1.kind === "created");
  suite.check("D03: leg 2 TIDAK digabung ke leg 1", leg2.kind === "created" && leg2.fixtureUid !== leg1.fixtureUid);

  // Babak berbeda pada hari yang sama → ambigu (stage_or_leg_mismatch).
  const stageClash = resolveFixtureIdentity(db, {
    ...base, source: "football-data", sourceMatchId: "fd_leg2same",
    kickoffUtc: "2026-11-10T19:00:00.000Z", stageOrLeg: "leg2",
  }, NOW);
  suite.check(
    "D03: babak berbeda → ambigu stage_or_leg_mismatch",
    stageClash.kind === "ambiguous" && stageClash.reason === "stage_or_leg_mismatch",
    JSON.stringify(stageClash),
  );
  suite.eq("D03: id ambigu tidak mendapat UID", getUidForMatchId(db, "fd_leg2same"), null);

  // Sisi tertukar (venue netral) → ambigu.
  const swapped = resolveFixtureIdentity(db, {
    ...base, source: "thestats", sourceMatchId: "mt_swap",
    homeCid: "tm_y", awayCid: "tm_x", homeName: "Y FC", awayName: "X FC",
    kickoffUtc: "2026-11-10T19:00:00.000Z", stageOrLeg: null,
  }, NOW);
  suite.check(
    "D03: sisi tertukar → ambigu sides_swapped",
    swapped.kind === "ambiguous" && swapped.reason === "sides_swapped",
    JSON.stringify(swapped),
  );

  // Dua kandidat tak terbedakan di store → ambigu multiple_candidates.
  const insFx = db.prepare(
    `INSERT INTO canonical_fixtures (fixture_uid, competition_id, season, home_cid, away_cid,
       home_name, away_name, stage_or_leg, kickoff_utc, kickoff_precision, state, neutral,
       score_basis, current_revision, created_at, updated_at)
     VALUES (?, 'L9', '2026-2027', 'tm_p', 'tm_q', 'P FC', 'Q FC', NULL,
             '2026-11-15T18:00:00.000Z', 'exact', 'scheduled', NULL, 'regulation', 0, ?, ?)`,
  );
  insFx.run("fx_test_multi_1", NOW, NOW);
  insFx.run("fx_test_multi_2", NOW, NOW);
  const multi = resolveFixtureIdentity(db, {
    source: "sportmonks", sourceMatchId: "sm_multi", competitionId: "L9",
    homeCid: "tm_p", awayCid: "tm_q", homeName: "P FC", awayName: "Q FC",
    kickoffUtc: "2026-11-15T18:00:00.000Z", kickoffPrecision: "exact",
  }, NOW);
  suite.check(
    "D03: dua kandidat → ambigu multiple_candidates",
    multi.kind === "ambiguous" && multi.reason === "multiple_candidates",
    JSON.stringify(multi),
  );
  suite.eq("D03: id multi-kandidat tidak mendapat UID", getUidForMatchId(db, "sm_multi"), null);

  // Tanggal tanpa jam terhadap kandidat yang ada → ambigu date_only_kickoff.
  const g = resolveFixtureIdentity(db, {
    source: "sportmonks", sourceMatchId: "sm_g", competitionId: "L8",
    homeCid: "tm_r", awayCid: "tm_s", homeName: "R FC", awayName: "S FC",
    kickoffUtc: "2026-11-16T20:00:00.000Z", kickoffPrecision: "exact",
  }, NOW);
  suite.check("D03: fixture pembanding tanggal-only terbuat", g.kind === "created");
  const dateOnly = resolveFixtureIdentity(db, {
    source: "football-data", sourceMatchId: "fd_g", competitionId: "L8",
    homeCid: "tm_r", awayCid: "tm_s", homeName: "R FC", awayName: "S FC",
    kickoffUtc: "2026-11-16T00:00:00.000Z", kickoffPrecision: "date_only",
  }, NOW);
  suite.check(
    "D03: tanggal tanpa jam → ambigu date_only_kickoff",
    dateOnly.kind === "ambiguous" && dateOnly.reason === "date_only_kickoff",
    JSON.stringify(dateOnly),
  );
  suite.eq("D03: id tanggal-only tidak mendapat UID", getUidForMatchId(db, "fd_g"), null);

  // Reschedule terkonfirmasi pada alias yang sama → UID bertahan.
  const h1 = resolveFixtureIdentity(db, {
    source: "sportmonks", sourceMatchId: "sm_h", competitionId: "L7",
    homeCid: "tm_u", awayCid: "tm_v", homeName: "U FC", awayName: "V FC",
    kickoffUtc: "2026-11-20T18:00:00.000Z", kickoffPrecision: "exact",
  }, NOW);
  const h2 = resolveFixtureIdentity(db, {
    source: "sportmonks", sourceMatchId: "sm_h", competitionId: "L7",
    homeCid: "tm_u", awayCid: "tm_v", homeName: "U FC", awayName: "V FC",
    kickoffUtc: "2026-11-22T18:00:00.000Z", kickoffPrecision: "exact",
  }, NOW);
  suite.check(
    "D03: reschedule mempertahankan UID + ID lama",
    h1.kind === "created" && h2.kind === "known" && h2.fixtureUid === h1.fixtureUid,
    `${JSON.stringify(h1)} vs ${JSON.stringify(h2)}`,
  );
  if (h1.kind === "created") {
    suite.eq(
      "D03: kickoff fixture diperbarui oleh reschedule",
      getFixtureByUid(db, h1.fixtureUid)?.kickoff_utc,
      "2026-11-22T18:00:00.000Z",
    );
    suite.eq("D03: tetap tepat 1 alias untuk UID reschedule", getAliasesForUid(db, h1.fixtureUid).length, 1);
  }

  // Antrean: 4 kasus ambigu tercatat dengan alasan identity_ambiguous.
  const queued = (db
    .prepare("SELECT COUNT(*) AS n FROM fixture_identity_queue WHERE reason = 'identity_ambiguous' AND resolved_at IS NULL")
    .get() as { n: number }).n;
  suite.eq("D03: 4 kasus ambigu masuk antrean peninjauan", queued, 4);

  // Idempoten lintas koneksi (proses) baru: resolusi ulang tidak berubah.
  const countBefore = (db.prepare("SELECT COUNT(*) AS n FROM canonical_fixtures").get() as { n: number }).n;
  db.close();
  db = new DatabaseSync(file);
  const h3 = resolveFixtureIdentity(db, {
    source: "sportmonks", sourceMatchId: "sm_h", competitionId: "L7",
    homeCid: "tm_u", awayCid: "tm_v", homeName: "U FC", awayName: "V FC",
    kickoffUtc: "2026-11-22T18:00:00.000Z", kickoffPrecision: "exact",
  }, NOW);
  const countAfter = (db.prepare("SELECT COUNT(*) AS n FROM canonical_fixtures").get() as { n: number }).n;
  suite.check(
    "D03: koneksi baru → UID sama, tanpa fixture baru (idempoten)",
    h3.kind === "known" && h1.kind === "created" && h3.fixtureUid === h1.fixtureUid && countAfter === countBefore,
  );
  db.close();
  settleFixtureEnv(env, suite.failedCount > 0);
}

// ============================================================================
// D04
// ============================================================================

async function blockD04(suite: Suite, env: FixtureEnv): Promise<void> {
  console.log("\n[D04] koreksi hasil, piala, dan pembatalan");
  const ledger = await import("../lib/picks/ledger");
  const ds = new DatabaseSync(path.join(env.dataDir, "thestats_dataset.db"));
  ensureIdentitySchema(ds);
  const insMatch = ds.prepare(
    `INSERT INTO matches (match_id, competition_id, season, utc_date, status,
       home_team_id, away_team_id, home_score, away_score, referee_name, updated_at)
     VALUES (?, ?, '2026-2027', ?, 'scheduled', ?, ?, NULL, NULL, NULL, '2026-11-18T00:00:00.000Z')`,
  );
  insMatch.run("sm_555", "L1", "2026-11-18T19:00:00.000Z", "tm_nurnberg", "tm_darmstadt");
  insMatch.run("sm_777", "CUP", "2026-11-18T20:00:00.000Z", "tm_koln", "tm_leverkusen");
  insMatch.run("sm_778", "CUP", "2026-11-19T20:00:00.000Z", "tm_koln", "tm_leverkusen");
  insMatch.run("sm_999", "L1", "2026-11-19T19:00:00.000Z", "tm_nurnberg", "tm_koln");

  const resolve = (id: string, comp: string, home: string, away: string, kickoff: string) => {
    const r = resolveFixtureIdentity(ds, {
      source: "sportmonks", sourceMatchId: id, competitionId: comp,
      homeCid: home, awayCid: away, kickoffUtc: kickoff, kickoffPrecision: "exact",
    }, NOW);
    if (r.kind === "ambiguous") throw new Error(`resolusi ${id} ambigu: ${r.reason}`);
    return r.fixtureUid;
  };
  const anchorOf = (id: string) =>
    ds.prepare("SELECT status, home_score, away_score FROM matches WHERE match_id = ?")
      .get(id) as { status: string; home_score: number | null; away_score: number | null };
  const outcomeOf = (matchId: string) => {
    const pk = openRo(env, "picks.db");
    const row = pk.prepare(
      `SELECT o.home_goals AS hg, o.away_goals AS ag, o.hit AS hit
       FROM pick_outcomes o JOIN picks p ON p.id = o.pick_id WHERE p.match_id = ?`,
    ).get(matchId) as { hg: number; ag: number; hit: number } | undefined;
    pk.close();
    return row ?? null;
  };

  // --- Koreksi: FT 1–0 → duplikat 1–0 → koreksi 0–0 → polling lama.
  const uid555 = resolve("sm_555", "L1", "tm_nurnberg", "tm_darmstadt", "2026-11-18T19:00:00.000Z");
  ledger.recordPick({
    match_id: "sm_555", competition_canonical_id: "L1",
    kickoff_utc: "2026-11-18T19:00:00Z", market: "1x2", selection: "1",
    model_prob: 0.6, source: "live-run", created_utc: "2026-11-18T10:00:00.000Z",
  });
  const history: string[] = [];

  const o1 = applyResultObservation(ds, {
    fixtureUid: uid555, anchorMatchId: "sm_555", statusRaw: "FT",
    homeScore: 1, awayScore: 0, source: "test", observedAt: "2026-11-18T21:00:00.000Z",
  });
  suite.check("D04: FT 1–0 diterapkan sebagai revisi 1", o1.action === "applied" && o1.revision === 1, JSON.stringify(o1));
  const r1 = runScript(env, "scripts/resolve-pick-outcomes.ts");
  suite.eq("D04: resolver sesudah FT 1–0 → resolved 1", resolverNumbers(r1.stdout).resolved, 1);
  const oc1 = outcomeOf("sm_555");
  if (oc1) history.push(oc1.hit === 1 ? "hit" : "miss");
  suite.eq("D04: outcome pertama = 1–0 hit", oc1, { hg: 1, ag: 0, hit: 1 });

  const o2 = applyResultObservation(ds, {
    fixtureUid: uid555, anchorMatchId: "sm_555", statusRaw: "finished",
    homeScore: 1, awayScore: 0, source: "test", observedAt: "2026-11-18T21:05:00.000Z",
  });
  suite.check("D04: duplikat finished 1–0 → tanpa revisi baru", o2.action === "duplicate" && o2.revision === 1, JSON.stringify(o2));
  suite.eq("D04: tetap 1 revisi sesudah duplikat", getResultRevisions(ds, uid555).length, 1);

  const o3 = applyResultObservation(ds, {
    fixtureUid: uid555, anchorMatchId: "sm_555", statusRaw: "FT",
    homeScore: 0, awayScore: 0, source: "test", observedAt: "2026-11-18T22:00:00.000Z",
  });
  suite.check(
    "D04: koreksi resmi 0–0 → revisi 2 dengan skor lama terungkap",
    o3.action === "corrected" && o3.revision === 2 && o3.previousScore?.home === 1 && o3.previousScore?.away === 0,
    JSON.stringify(o3),
  );
  const r2 = runScript(env, "scripts/resolve-pick-outcomes.ts");
  suite.eq("D04: resolver menilai ulang pick yang terkoreksi (corrected 1)", resolverNumbers(r2.stdout).corrected, 1);
  const oc2 = outcomeOf("sm_555");
  if (oc2) history.push(oc2.hit === 1 ? "hit" : "miss");
  suite.eq("D04: histori pick kandang = [hit, miss]", history, ["hit", "miss"]);
  const revs = getResultRevisions(ds, uid555);
  suite.check(
    "D04: jejak revisi utuh — rev1 1–0 tersimpan, rev2 0–0",
    revs.length === 2 && revs[0].home_score === 1 && revs[0].away_score === 0 &&
      revs[1].home_score === 0 && revs[1].away_score === 0,
    JSON.stringify(revs),
  );

  const o4 = applyResultObservation(ds, {
    fixtureUid: uid555, anchorMatchId: "sm_555", statusRaw: "scheduled",
    homeScore: null, awayScore: null, source: "test", observedAt: "2026-11-18T22:05:00.000Z",
  });
  suite.check("D04: polling lama scheduled/null → stale_ignored", o4.action === "stale_ignored" && o4.revision === 2, JSON.stringify(o4));
  const a555 = anchorOf("sm_555");
  suite.check(
    "D04: status final tidak mundur (jangkar tetap finished 0–0)",
    a555.status === "finished" && a555.home_score === 0 && a555.away_score === 0,
    JSON.stringify(a555),
  );
  const r3 = runScript(env, "scripts/resolve-pick-outcomes.ts");
  const n3 = resolverNumbers(r3.stdout);
  suite.check("D04: resolver sesudah polling lama → 0 resolved, 0 corrected", n3.resolved === 0 && n3.corrected === 0, r3.stdout.trim());

  // --- Piala: settlement dari skor 90 menit; ET disimpan terpisah.
  const uid777 = resolve("sm_777", "CUP", "tm_koln", "tm_leverkusen", "2026-11-18T20:00:00.000Z");
  const oc = applyResultObservation(ds, {
    fixtureUid: uid777, anchorMatchId: "sm_777", statusRaw: "FT",
    homeScore: 1, awayScore: 1, homeScoreEt: 2, awayScoreEt: 1,
    source: "test", observedAt: "2026-11-18T23:00:00.000Z",
  });
  suite.check("D04 piala: observasi 1–1 (90') + 2–1 (AET) diterapkan", oc.action === "applied", JSON.stringify(oc));
  const a777 = anchorOf("sm_777");
  suite.check(
    "D04 piala: jangkar memakai skor 90 menit 1–1",
    a777.status === "finished" && a777.home_score === 1 && a777.away_score === 1,
    JSON.stringify(a777),
  );
  const rev777 = getResultRevisions(ds, uid777);
  suite.check(
    "D04 piala: skor AET 2–1 tersimpan terpisah di revisi",
    rev777.length === 1 && rev777[0].home_score_et === 2 && rev777[0].away_score_et === 1,
    JSON.stringify(rev777),
  );
  suite.eq("D04 piala: 1X2 dari 1–1 → selection 'x' hit", ledger.evaluatePick("1x2", "x", 1, 1), 1);
  suite.eq("D04 piala: 1X2 dari 1–1 → selection '1' miss", ledger.evaluatePick("1x2", "1", 1, 1), 0);

  // --- Piala tanpa skor 90 menit → pending_score_basis, jangkar tak berskor.
  const uid778 = resolve("sm_778", "CUP", "tm_koln", "tm_leverkusen", "2026-11-19T20:00:00.000Z");
  const op = applyResultObservation(ds, {
    fixtureUid: uid778, anchorMatchId: "sm_778", statusRaw: "FT",
    homeScore: null, awayScore: null, homeScoreEt: 2, awayScoreEt: 1,
    source: "test", observedAt: "2026-11-19T23:00:00.000Z",
  });
  suite.check("D04 piala: hanya skor AET → pending_score_basis", op.action === "pending_score_basis", JSON.stringify(op));
  const a778 = anchorOf("sm_778");
  suite.check(
    "D04 piala: jangkar pending tidak diberi skor",
    a778.home_score === null && a778.away_score === null,
    JSON.stringify(a778),
  );
  suite.eq(
    "D04 piala: basis skor fixture tercatat pending_score_basis",
    getFixtureByUid(ds, uid778)?.score_basis,
    "pending_score_basis",
  );

  // --- Cancelled → void sesuai versi aturan settlement.
  const uid999 = resolve("sm_999", "L1", "tm_nurnberg", "tm_koln", "2026-11-19T19:00:00.000Z");
  ledger.recordPick({
    match_id: "sm_999", competition_canonical_id: "L1",
    kickoff_utc: "2026-11-19T19:00:00Z", market: "1x2", selection: "1",
    model_prob: 0.55, source: "live-run", created_utc: "2026-11-19T10:00:00.000Z",
  });
  const ox = applyResultObservation(ds, {
    fixtureUid: uid999, anchorMatchId: "sm_999", statusRaw: "cancelled",
    homeScore: null, awayScore: null, source: "test", observedAt: "2026-11-19T18:00:00.000Z",
  });
  suite.check("D04 batal: observasi cancelled tercatat", ox.action === "cancelled", JSON.stringify(ox));
  const r4 = runScript(env, "scripts/resolve-pick-outcomes.ts");
  suite.eq("D04 batal: resolver menandai 1 pick void", resolverNumbers(r4.stdout).voided, 1);
  const pk = openRo(env, "picks.db");
  const pickRow = pk.prepare("SELECT id FROM picks WHERE match_id = 'sm_999'").get() as { id: number };
  const voidRow = pk.prepare(
    "SELECT fixture_uid, reason, policy_version FROM pick_voids WHERE pick_id = ?",
  ).get(pickRow.id) as { fixture_uid: string; reason: string; policy_version: string } | undefined;
  const outcomeCount = (pk.prepare(
    "SELECT COUNT(*) AS n FROM pick_outcomes WHERE pick_id = ?",
  ).get(pickRow.id) as { n: number }).n;
  pk.close();
  suite.check(
    "D04 batal: baris void berisi UID + alasan + versi aturan saat ini",
    voidRow !== undefined && voidRow.fixture_uid === uid999 &&
      voidRow.reason === "provider_cancelled" && voidRow.policy_version === SETTLEMENT_POLICY_VERSION,
    JSON.stringify(voidRow),
  );
  suite.eq("D04 batal: pick batal tidak punya outcome hit/miss", outcomeCount, 0);
  const r5 = runScript(env, "scripts/resolve-pick-outcomes.ts");
  const n5 = resolverNumbers(r5.stdout);
  suite.check(
    "D04 batal: pick void tidak diperiksa ulang (examined 0, voided 0)",
    n5.examined === 0 && n5.voided === 0,
    r5.stdout.trim(),
  );
  ds.close();
}

// ============================================================================

async function main(): Promise<void> {
  const suite = new Suite("test:identity");
  const env = await buildD02Sandbox();
  await blockD02(suite, env);
  blockD03(suite);
  await blockD04(suite, env);
  settleFixtureEnv(env, suite.failedCount > 0);
  suite.finish();
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
