/**
 * SKENARIO FIXTURE — pembangunan sandbox untuk kasus D01 (baseline) dan
 * kasus jalur-hijau (kembar katalog). Data sintetis; tidak ada baris di
 * sini yang boleh masuk data nyata (bab QA).
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  buildCoreSchemas,
  createFixtureEnv,
  runScript,
  seedDatasetTeams,
  writeCsv,
  writeTeamRegistry,
  type FixtureEnv,
  type FixtureTeam,
  type RunResult,
} from "./fixture-env";

// ---------------------------------------------------------------------------
// D01 — impor ulang (fixtures/acceptance.json, blok import_replay)
// ---------------------------------------------------------------------------

export const D01_TEAMS: FixtureTeam[] = [
  { team_id: "tm_alpha", name: "Alpha Athletic" },
  { team_id: "tm_beta", name: "Beta Town" },
  { team_id: "tm_gamma", name: "Gamma FC" },
  { team_id: "tm_delta", name: "Delta United" },
];

export const D01_IDS = {
  sm901: "sm_901",
  sm902: "sm_902",
  fdAlpha: "fd_E0_20261118_alpha-athletic_beta-town",
  fdGamma: "fd_E0_20261118_gamma-fc_delta-united",
  kickAlpha: "2026-11-18T15:00:00.000Z",
  kickGamma: "2026-11-18T16:00:00.000Z",
} as const;

const D01_RESULTS_CSV = [
  "Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,HxG,AxG,HS,AS,HST,AST,Referee,PPCH,PPCD,PPCA,B365CH,B365CD,B365CA",
  "E0,18/11/2026,15:00,Alpha Athletic,Beta Town,2,1,H,1.80,0.90,12,8,5,3,Fixture Ref,2.10,3.40,3.60,2.05,3.35,3.55",
  "E0,18/11/2026,16:00,Gamma FC,Delta United,0,1,A,0.70,1.40,9,11,2,6,Fixture Ref,2.60,3.20,2.90,2.55,3.15,2.85",
  "",
].join("\n");

const D01_FIXTURES_CSV = [
  "Div,Date,Time,HomeTeam,AwayTeam,PPH,PPD,PPA,B365H,B365D,B365A",
  "E0,18/11/2026,15:00,Alpha Athletic,Beta Town,2.05,3.35,3.55,2.00,3.30,3.50",
  "E0,18/11/2026,16:00,Gamma FC,Delta United,2.55,3.15,2.85,2.50,3.10,2.80",
  "",
].join("\n");

/**
 * Sandbox D01 persis seperti deskripsi acceptance.json:
 *  - sm_901 hanya ada di katalog upcoming (catalog only);
 *  - sm_902 sudah ada di tabel pertandingan dataset berstatus scheduled;
 *  - 2 pick 1x2 kandang (selection '1' — kosakata ledger untuk "home")
 *    seri live-run di picks.db;
 *  - CSV hasil E0 berisi kedua laga final (2–1 dan 0–1) + telemetri xG.
 */
export async function buildD01Sandbox(): Promise<FixtureEnv> {
  const env = createFixtureEnv("d01");
  process.chdir(env.root);
  const { ledger } = await buildCoreSchemas();
  seedDatasetTeams(env, D01_TEAMS);
  writeTeamRegistry(env, D01_TEAMS);

  const ds = new DatabaseSync(path.join(env.dataDir, "thestats_dataset.db"));
  ds.prepare(
    `INSERT INTO matches (match_id, competition_id, season, utc_date, status,
       home_team_id, away_team_id, home_score, away_score, referee_name, updated_at)
     VALUES (?, 'E0', '2026-2027', ?, 'scheduled', 'tm_gamma', 'tm_delta', NULL, NULL, NULL, ?)`,
  ).run(D01_IDS.sm902, D01_IDS.kickGamma, "2026-11-18T00:00:00.000Z");
  ds.close();

  const up = new DatabaseSync(path.join(env.dataDir, "upcoming_fixtures.db"));
  up.prepare(
    `INSERT INTO upcoming_fixtures (match_id, competition_id, competition_name,
       competition_country, utc_date, status, home_team_id, home_team_name,
       away_team_id, away_team_name, fetched_utc)
     VALUES (?, 'E0', 'English Premier League', 'England', ?, 'scheduled',
       'tm_alpha', 'Alpha Athletic', 'tm_beta', 'Beta Town', ?)`,
  ).run(D01_IDS.sm901, D01_IDS.kickAlpha, "2026-11-18T00:00:00.000Z");
  up.close();

  ledger.recordPick({
    match_id: D01_IDS.sm901,
    competition_canonical_id: "E0",
    kickoff_utc: "2026-11-18T15:00:00Z",
    market: "1x2",
    selection: "1",
    model_prob: 0.55,
    source: "live-run",
    created_utc: "2026-11-18T10:00:00.000Z",
  });
  ledger.recordPick({
    match_id: D01_IDS.sm902,
    competition_canonical_id: "E0",
    kickoff_utc: "2026-11-18T16:00:00Z",
    market: "1x2",
    selection: "1",
    model_prob: 0.52,
    source: "live-run",
    created_utc: "2026-11-18T10:00:00.000Z",
  });

  writeCsv(env, path.join("mmz4281", "2627", "E0.csv"), D01_RESULTS_CSV);
  writeCsv(env, "fixtures.csv", D01_FIXTURES_CSV);
  return env;
}

// ---------------------------------------------------------------------------
// Jalur hijau — kembar katalog sm_ ↔ fd_ (kasus non-D01 yang memang benar
// di kode saat ini): pick di id sm_, hasil tiba sebagai baris fd_ kembarnya.
// ---------------------------------------------------------------------------

export const GREEN_TEAMS: FixtureTeam[] = [
  { team_id: "tm_epsilon", name: "Epsilon Rovers" },
  { team_id: "tm_zeta", name: "Zeta City" },
];

export const GREEN_IDS = {
  sm: "sm_777",
  fd: "fd_E0_20261118_epsilon-rovers_zeta-city",
  kickoff: "2026-11-18T18:00:00.000Z",
} as const;

const GREEN_RESULTS_CSV = [
  "Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,HxG,AxG,HS,AS,HST,AST,Referee,PPCH,PPCD,PPCA",
  "E0,18/11/2026,18:00,Epsilon Rovers,Zeta City,3,1,H,2.10,0.80,14,7,6,2,Fixture Ref,1.90,3.50,4.20",
  "",
].join("\n");

/**
 * Sandbox jalur hijau: katalog upcoming memuat DUA baris untuk laga fisik
 * yang sama (sm_777 + kembar fd_-nya, timestamp kickoff persis sama) —
 * keadaan nyata setelah impor fixture; dataset belum punya baris laga;
 * satu pick live-run 1x2 kandang di sm_777.
 */
export async function buildGreenSandbox(): Promise<FixtureEnv> {
  const env = createFixtureEnv("green");
  process.chdir(env.root);
  const { ledger } = await buildCoreSchemas();
  seedDatasetTeams(env, GREEN_TEAMS);
  writeTeamRegistry(env, GREEN_TEAMS);

  const up = new DatabaseSync(path.join(env.dataDir, "upcoming_fixtures.db"));
  const ins = up.prepare(
    `INSERT INTO upcoming_fixtures (match_id, competition_id, competition_name,
       competition_country, utc_date, status, home_team_id, home_team_name,
       away_team_id, away_team_name, fetched_utc)
     VALUES (?, 'E0', 'English Premier League', 'England', ?, 'scheduled',
       'tm_epsilon', 'Epsilon Rovers', 'tm_zeta', 'Zeta City', ?)`,
  );
  ins.run(GREEN_IDS.sm, GREEN_IDS.kickoff, "2026-11-17T00:00:00.000Z");
  ins.run(GREEN_IDS.fd, GREEN_IDS.kickoff, "2026-11-17T00:00:00.000Z");
  up.close();

  ledger.recordPick({
    match_id: GREEN_IDS.sm,
    competition_canonical_id: "E0",
    kickoff_utc: "2026-11-18T18:00:00Z",
    market: "1x2",
    selection: "1",
    model_prob: 0.6,
    source: "live-run",
    created_utc: "2026-11-18T10:00:00.000Z",
  });

  writeCsv(env, path.join("mmz4281", "2627", "E0.csv"), GREEN_RESULTS_CSV);
  return env;
}

// ---------------------------------------------------------------------------
// D02 — alias lama (fixtures/acceptance.json, blok existing_aliases).
// Dua grup registry menyalin ID dari audit; skor rekaan 2–1 fixture hanya
// hidup di baris dataset alias fd_; katalog memuat SELURUH id grup; empat
// pick lama 1x2 kandang tersebar lintas id (2 keputusan headline unik).
// ---------------------------------------------------------------------------

export const D02_TEAMS: FixtureTeam[] = [
  { team_id: "tm_nurnberg", name: "1. FC Nürnberg", country: "Germany" },
  { team_id: "tm_darmstadt", name: "SV Darmstadt 98", country: "Germany" },
  { team_id: "tm_koln", name: "1. FC Köln", country: "Germany" },
  { team_id: "tm_leverkusen", name: "Bayer Leverkusen", country: "Germany" },
];

export const D02_IDS = {
  g1Canonical: "sm_19735411",
  g1Fd: "fd_D2_20261107_1-fc-nurnberg_sv-darmstadt-98",
  g1Kickoff: "2026-11-07T17:30:00.000Z",
  g2Canonical: "sm_19735118",
  g2Fd: "fd_D1_20261108_1-fc-koln_bayer-leverkusen",
  g2Mt: "mt_466402698",
  g2Kickoff: "2026-11-08T17:30:00.000Z",
} as const;

export async function buildD02Sandbox(): Promise<FixtureEnv> {
  const env = createFixtureEnv("identity");
  process.chdir(env.root);
  const { ledger } = await buildCoreSchemas();
  seedDatasetTeams(env, D02_TEAMS);
  writeTeamRegistry(env, D02_TEAMS);

  const up = new DatabaseSync(path.join(env.dataDir, "upcoming_fixtures.db"));
  const insFx = up.prepare(
    `INSERT INTO upcoming_fixtures (match_id, competition_id, competition_name,
       competition_country, utc_date, status, home_team_id, home_team_name,
       away_team_id, away_team_name, fetched_utc)
     VALUES (?, ?, ?, 'Germany', ?, 'scheduled', ?, ?, ?, ?, '2026-11-06T00:00:00.000Z')`,
  );
  // Grup 1 — 2. Bundesliga: sm_ + fd_.
  insFx.run(D02_IDS.g1Canonical, "D2", "2. Bundesliga", D02_IDS.g1Kickoff,
    "tm_nurnberg", "1. FC Nürnberg", "tm_darmstadt", "SV Darmstadt 98");
  insFx.run(D02_IDS.g1Fd, "D2", "2. Bundesliga", D02_IDS.g1Kickoff,
    "tm_nurnberg", "1. FC Nürnberg", "tm_darmstadt", "SV Darmstadt 98");
  // Grup 2 — Bundesliga: sm_ + fd_ + mt_.
  insFx.run(D02_IDS.g2Canonical, "D1", "Bundesliga", D02_IDS.g2Kickoff,
    "tm_koln", "1. FC Köln", "tm_leverkusen", "Bayer Leverkusen");
  insFx.run(D02_IDS.g2Fd, "D1", "Bundesliga", D02_IDS.g2Kickoff,
    "tm_koln", "1. FC Köln", "tm_leverkusen", "Bayer Leverkusen");
  insFx.run(D02_IDS.g2Mt, "D1", "Bundesliga", D02_IDS.g2Kickoff,
    "tm_koln", "1. FC Köln", "tm_leverkusen", "Bayer Leverkusen");
  up.close();

  // Skor HANYA di baris dataset alias fd_ (finished 2–1, skor rekaan fixture).
  const ds = new DatabaseSync(path.join(env.dataDir, "thestats_dataset.db"));
  const insMatch = ds.prepare(
    `INSERT INTO matches (match_id, competition_id, season, utc_date, status,
       home_team_id, away_team_id, home_score, away_score, referee_name, updated_at)
     VALUES (?, ?, '2026-2027', ?, 'finished', ?, ?, 2, 1, NULL, '2026-11-09T00:00:00.000Z')`,
  );
  insMatch.run(D02_IDS.g1Fd, "D2", D02_IDS.g1Kickoff, "tm_nurnberg", "tm_darmstadt");
  insMatch.run(D02_IDS.g2Fd, "D1", D02_IDS.g2Kickoff, "tm_koln", "tm_leverkusen");
  ds.close();

  const pick = (matchId: string, comp: string, kickoff: string) =>
    ledger.recordPick({
      match_id: matchId,
      competition_canonical_id: comp,
      kickoff_utc: kickoff,
      market: "1x2",
      selection: "1",
      model_prob: 0.6,
      source: "live-run",
      created_utc: "2026-11-06T10:00:00.000Z",
    });
  pick(D02_IDS.g1Canonical, "D2", D02_IDS.g1Kickoff);
  pick(D02_IDS.g1Fd, "D2", D02_IDS.g1Kickoff);
  pick(D02_IDS.g2Canonical, "D1", D02_IDS.g2Kickoff);
  pick(D02_IDS.g2Mt, "D1", D02_IDS.g2Kickoff);
  return env;
}

// ---------------------------------------------------------------------------
// Probe adapter web
// ---------------------------------------------------------------------------

export interface ProbeIdResult {
  detail: {
    home: string;
    away: string;
    picks: { market: string; selection: string; hit: number | null }[];
    result: { home_goals: number; away_goals: number; finished: boolean } | null;
  } | null;
  detailError: string | null;
  result: { home_goals: number; away_goals: number; finished: boolean } | null;
  resultError: string | null;
}

export interface ProbeOutput {
  perId: Record<string, ProbeIdResult>;
  stats: { lab_total: number; live_total: number; live_resolved: number } | { error: string };
}

export function runProbe(env: FixtureEnv, ids: string[]): ProbeOutput {
  const res: RunResult = runScript(env, "tests/helpers/web-probe.ts", ids);
  const line = res.stdout
    .split("\n")
    .find((l) => l.startsWith("PROBE_JSON "));
  if (!line) {
    throw new Error(
      `web-probe tidak menghasilkan PROBE_JSON (exit=${res.code}): ${res.stdout} ${res.stderr}`,
    );
  }
  return JSON.parse(line.slice("PROBE_JSON ".length)) as ProbeOutput;
}

/** Baca file JSON dari data sandbox (mis. fixture-links.json). */
export function readSandboxJson<T>(env: FixtureEnv, rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(env.dataDir, rel), "utf8")) as T;
}
