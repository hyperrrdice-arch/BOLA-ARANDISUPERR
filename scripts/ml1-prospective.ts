/**
 * ML1 PROSPEKTIF — jalur pengamatan harian kandidat ML1-B (Item 19).
 *
 * SHADOW-ONLY, READ-ONLY terhadap produksi:
 *  - Champion λ/μ + probabilitas 1X2 dibaca dari paket kuant resmi yang
 *    ditulis generator pick (analysis_snapshots.db, trigger 'slate',
 *    paket terbaru per fixture) — TIDAK dihitung ulang di sini.
 *  - Fitur ML1-B dihitung as-of dari thestats_dataset.db (mode read-only)
 *    memakai ekstraktor sprint yang sama (lib/eval/ml1-features.ts,
 *    disiplin strictly-before tanggal fixture; Elo = keadaan akhir
 *    kompetisi dari riwayat selesai). Inferensi booster terserialisasi
 *    (tasks/ml1/model/) lewat scripts/ml1-predict.py di venv ML1.
 *  - Hasil ditulis HANYA ke DB bayangan data/ml1_prospective.db.
 *  - Grading memakai sumber hasil + aturan yang sama persis dengan
 *    resolver produksi (scripts/resolve-pick-outcomes.ts): lapisan
 *    identitas K1 (skor regulasi) → baris dataset mentah berstatus
 *    full-time polos; basis pending_score_basis tidak pernah dinilai;
 *    fixture cancelled → void. Koreksi skor resmi menilai ulang grading.
 *
 * ATURAN EVALUASI PRA-REGISTRASI (ditanam, TANPA promosi otomatis):
 *  status READY_TO_PROPOSE hanya bila graded irisan KOMPETITIF
 *  n >= 500 DAN Δ LL kompetitif <= -0,005 DAN UB CI bootstrap < 0.
 *  Selain itu COLLECTING. Job ini hanya menandai; promosi = keputusan
 *  pemilik terpisah (promote-model.ts), tidak pernah dari sini.
 *
 * Irisan mengikuti definisi sprint persis (tasks/ml1/design.md §6):
 *  kompetitif = status registry league_calibration calibrated|partial;
 *  friendlies = uncalibrated atau tanpa baris registry.
 *  Bacaan utama = kompetitif.
 *
 * Pakai:
 *   npx tsx scripts/ml1-prospective.ts [--now=<ISO>] [--limit=N]
 *   npx tsx scripts/ml1-prospective.ts --pit-a [--limit=N]
 *     (mode eksperimen ML1-PIT A — lihat lib/eval/ml1-pit-a.ts; menulis
 *      HANYA ke ml1_prospective_pit_a.db; --now ditolak pada mode ini)
 *
 * Keluaran terakhir stdout = satu baris JSON ringkasan run (dipakai cron).
 * Exit 3 bila penjaga isolasi gagal (berkas saji/DB produksi berubah).
 */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isoWeekKey,
  logLossClamped,
  matrixProbs,
  outcomeIndex,
  type EvalMatchRow,
} from "../lib/eval/chronological-evaluator";
import {
  Ml1FeatureExtractor,
  type Ml1CanonicalLogRow,
} from "../lib/eval/ml1-features";
import {
  getFixtureByUid,
  getRegulationScore,
  getSiblingIds,
  getUidForMatchId,
  identityTablesExist,
  isFinishedStatus,
  isPostRegulationStatus,
  linkSiblingsOf,
  loadFixtureLinkGroups,
  type FixtureLinkGroup,
} from "../lib/identity/fixture-resolver";
import {
  canonicalIdForTeamId,
  canonicalIdForTeamName,
  loadCanonicalTeams,
} from "../lib/quant/team-identity";
import { blockBootstrapDelta, type PairedDeltaRow } from "../lib/quant/experiment-stats";
import { dataDir, dbPath } from "../lib/db/paths";
import {
  createPythonInferenceExecutor,
  runMl1PitA,
} from "../lib/eval/ml1-pit-a";

const args = process.argv.slice(2);
const PIT_A_MODE = args.includes("--pit-a");
const argVal = (name: string, dflt: string): string => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const NOW_ISO = argVal("now", new Date().toISOString());
const LIMIT = Number(argVal("limit", "0")) || 0;
const MODEL_DIR = path.join(process.cwd(), "tasks/ml1/model");
const PYTHON = "/home/hatch/workspace/tools/ml1-venv/bin/python";
const BOOTSTRAP_SEED = 20261124; // sama dengan PR 3/PR 4/sprint ML1
const RULE = { minCompetitiveN: 500, maxDelta: -0.005 };

/** sha256 berkas dibaca per potongan 8 MiB — aman untuk DB 3 GB. */
const sha256File = (p: string): string => {
  const h = createHash("sha256");
  const fd = fs.openSync(p, "r");
  try {
    const buf = Buffer.alloc(8 * 1024 * 1024);
    let n = 0;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest("hex");
};

function guardSnapshot(): Record<string, unknown> {
  const snap: Record<string, unknown> = {};
  for (const f of ["model-manifest.json", "calibrated_ratings.json"]) {
    const p = path.join(dataDir(), f);
    if (fs.existsSync(p)) snap[f] = { sha256: sha256File(p) };
  }
  for (const db of ["picks.db", "predictions.db", "market_snapshots.db", "thestats_dataset.db"]) {
    const p = dbPath(db);
    if (fs.existsSync(p)) snap[db] = { sha256: sha256File(p) };
  }
  return snap;
}

// ---------------------------------------------------------------------------
// Pemuatan data referensi (READ-ONLY; query identik ml1-extract-features.ts)
// ---------------------------------------------------------------------------
interface LoadedData {
  universe: EvalMatchRow[];
  compAvg: EvalMatchRow[];
  canonicalLogs: Ml1CanonicalLogRow[];
  registryStatus: Map<string, string>;
  seasonByMatchId: Map<string, string>;
}

function loadData(ds: DatabaseSync): LoadedData {
  const universe = ds
    .prepare(
      `SELECT match_id, competition_id, utc_date, home_team_id, away_team_id, home_score, away_score
       FROM matches
       WHERE competition_id LIKE 'sm:%' AND status = 'finished'
         AND home_score IS NOT NULL AND away_score IS NOT NULL
       ORDER BY competition_id, utc_date`,
    )
    .all() as unknown as EvalMatchRow[];
  const compAvg = ds
    .prepare(
      `SELECT match_id, competition_id, utc_date, home_team_id, away_team_id, home_score, away_score
       FROM matches
       WHERE status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL
       ORDER BY competition_id, utc_date`,
    )
    .all() as unknown as EvalMatchRow[];
  const seasonByMatchId = new Map<string, string>();
  for (const r of ds.prepare("SELECT match_id, season FROM matches").all() as unknown as { match_id: string; season: string }[]) {
    if (r.season) seasonByMatchId.set(r.match_id, r.season);
  }
  const canonicalLogs = ds
    .prepare(
      `SELECT team_id, match_date, shots_for, shots_against, shots_on_target_for, shots_on_target_against
       FROM team_match_logs_canonical ORDER BY team_id, match_date`,
    )
    .all() as unknown as Ml1CanonicalLogRow[];
  const registryStatus = new Map<string, string>();
  for (const r of ds.prepare("SELECT league_id, status FROM league_calibration").all() as unknown as { league_id: string; status: string }[]) {
    registryStatus.set(r.league_id, r.status);
  }
  return { universe, compAvg, canonicalLogs, registryStatus, seasonByMatchId };
}

// ---------------------------------------------------------------------------
// Resolusi kunci tim fixture → namespace dataset (thestats tm_*) lewat
// registry kanonik tim — namespace yang sama dengan baris `matches` terbaru
// dan `team_match_logs_canonical`. Fallback: id sumber apa adanya.
// ---------------------------------------------------------------------------
function resolveTeamKey(sourceId: string, name: string): string {
  const canon = canonicalIdForTeamId(sourceId) ?? canonicalIdForTeamName(name);
  if (canon) {
    const team = loadCanonicalTeams().find((t) => t.canonical_id === canon);
    const th = team?.members.find((m) => m.system === "thestats");
    if (th) return th.team_id;
  }
  return sourceId;
}

// ---------------------------------------------------------------------------
// Pencarian skor regulasi — SEMANTIK IDENTIK resolver produksi
// (scripts/resolve-pick-outcomes.ts): identitas K1 dulu (otoritatif),
// lalu baris mentah full-time polos lewat kandidat id (id sendiri,
// saudara identitas, bridge sm_id_map, saudara tautan fixture-links).
// ---------------------------------------------------------------------------
interface ScoreRow { home_score: number; away_score: number }
type ScoreLookup =
  | { kind: "score"; score: ScoreRow; source: "identity" | "raw" }
  | { kind: "pending_score_basis" }
  | { kind: "none" };

function identityLookup(dataset: DatabaseSync, matchId: string): ScoreLookup | null {
  if (!identityTablesExist(dataset)) return null;
  for (const id of getSiblingIds(dataset, matchId)) {
    const uid = getUidForMatchId(dataset, id);
    if (!uid) continue;
    const fx = getFixtureByUid(dataset, uid);
    if (!fx || fx.state !== "finished") continue;
    if (fx.score_basis === "pending_score_basis") return { kind: "pending_score_basis" };
    const reg = getRegulationScore(dataset, uid);
    if (reg) return { kind: "score", score: { home_score: reg.home, away_score: reg.away }, source: "identity" };
    return null;
  }
  return null;
}

function rawRowScore(db: DatabaseSync, matchId: string): { score: ScoreRow } | { postRegulation: true } | null {
  const row = db
    .prepare(`SELECT home_score, away_score, status FROM matches WHERE match_id = ?`)
    .get(matchId) as { home_score: number | null; away_score: number | null; status: string } | undefined;
  if (!row) return null;
  if (row.home_score === null || row.away_score === null) return null;
  if (isPostRegulationStatus(row.status)) return { postRegulation: true };
  if (!isFinishedStatus(row.status)) return null;
  return { score: { home_score: row.home_score, away_score: row.away_score } };
}

function candidateIds(
  dataset: DatabaseSync,
  upcoming: DatabaseSync | null,
  linkGroups: FixtureLinkGroup[],
  matchId: string,
): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (id: string | null | undefined) => {
    if (id && !seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  };
  push(matchId);
  for (const id of getSiblingIds(dataset, matchId)) push(id);
  if (upcoming) {
    try {
      const bridge = upcoming
        .prepare("SELECT sm_fixture_id FROM sm_id_map WHERE match_id = ?")
        .get(matchId) as { sm_fixture_id: number } | undefined;
      if (bridge) push(`sm_${bridge.sm_fixture_id}`);
    } catch {
      // sm_id_map boleh tidak ada di store lama.
    }
  }
  for (const id of linkSiblingsOf(linkGroups, matchId)) push(id);
  return ordered;
}

function findRegulationScore(
  dataset: DatabaseSync,
  upcoming: DatabaseSync | null,
  linkGroups: FixtureLinkGroup[],
  matchId: string,
): ScoreLookup {
  const viaIdentity = identityLookup(dataset, matchId);
  if (viaIdentity) return viaIdentity;
  let sawPostRegulation = false;
  for (const id of candidateIds(dataset, upcoming, linkGroups, matchId)) {
    const found = rawRowScore(dataset, id);
    if (!found) continue;
    if ("postRegulation" in found) {
      sawPostRegulation = true;
      continue;
    }
    return { kind: "score", score: found.score, source: "raw" };
  }
  return sawPostRegulation ? { kind: "pending_score_basis" } : { kind: "none" };
}

function fixtureState(dataset: DatabaseSync, matchId: string): string | null {
  if (!identityTablesExist(dataset)) return null;
  const uid = getUidForMatchId(dataset, matchId);
  if (!uid) return null;
  return getFixtureByUid(dataset, uid)?.state ?? null;
}

// ---------------------------------------------------------------------------
// DB bayangan
// ---------------------------------------------------------------------------
function openShadow(): DatabaseSync {
  const db = new DatabaseSync(dbPath("ml1_prospective.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS predictions (
      match_id TEXT PRIMARY KEY,
      competition_id TEXT NOT NULL,
      kickoff_utc TEXT NOT NULL,
      predicted_at TEXT NOT NULL,
      home_team_key TEXT NOT NULL,
      away_team_key TEXT NOT NULL,
      home_name TEXT,
      away_name TEXT,
      slice TEXT NOT NULL,
      registry_status TEXT,
      champ_lam REAL NOT NULL,
      champ_mu REAL NOT NULL,
      champ_p_h REAL NOT NULL,
      champ_p_d REAL NOT NULL,
      champ_p_a REAL NOT NULL,
      cand_lam REAL NOT NULL,
      cand_mu REAL NOT NULL,
      cand_p_h REAL NOT NULL,
      cand_p_d REAL NOT NULL,
      cand_p_a REAL NOT NULL,
      features_json TEXT NOT NULL,
      package_id INTEGER,
      package_computed_utc TEXT,
      model_manifest_sha256 TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE IF NOT EXISTS gradings (
      match_id TEXT PRIMARY KEY,
      graded_at TEXT NOT NULL,
      home_score INTEGER NOT NULL,
      away_score INTEGER NOT NULL,
      ll_champ REAL NOT NULL,
      ll_cand REAL NOT NULL,
      delta REAL NOT NULL,
      score_source TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_at TEXT NOT NULL,
      status TEXT NOT NULL,
      kompetitif_n INTEGER NOT NULL,
      kompetitif_delta REAL,
      kompetitif_ub REAL,
      pooled_n INTEGER NOT NULL,
      pooled_delta REAL,
      pooled_ub REAL,
      detail_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_at TEXT NOT NULL,
      predicted_new INTEGER NOT NULL,
      graded_new INTEGER NOT NULL,
      corrected INTEGER NOT NULL,
      voided_new INTEGER NOT NULL,
      guard_identical INTEGER NOT NULL
    );
  `);
  return db;
}

// ---------------------------------------------------------------------------
interface PkgRow {
  id: number;
  match_id: string;
  competition_canonical_id: string;
  kickoff_utc: string;
  computed_utc: string;
  lambda: number;
  mu: number;
  payload_json: string;
}

function main(): void {
  const guardBefore = guardSnapshot();
  const modelManifest = JSON.parse(fs.readFileSync(path.join(MODEL_DIR, "model-manifest.json"), "utf8")) as Record<string, unknown>;
  const modelManifestSha = sha256File(path.join(MODEL_DIR, "model-manifest.json"));

  const dataset = new DatabaseSync(dbPath("thestats_dataset.db"), { readOnly: true });
  const upcoming = new DatabaseSync(dbPath("upcoming_fixtures.db"), { readOnly: true });
  const snapshots = new DatabaseSync(dbPath("analysis_snapshots.db"), { readOnly: true });
  const shadow = openShadow();
  const linkGroups = loadFixtureLinkGroups(dataDir());

  // ------------------------------------------------------------- GRADING ---
  let gradedNew = 0;
  let corrected = 0;
  let voidedNew = 0;
  const pending = shadow
    .prepare(`SELECT match_id FROM predictions WHERE status = 'pending' ORDER BY kickoff_utc`)
    .all() as unknown as { match_id: string }[];
  for (const p of pending) {
    const found = findRegulationScore(dataset, upcoming, linkGroups, p.match_id);
    if (found.kind === "score") {
      const pred = shadow
        .prepare(`SELECT champ_p_h, champ_p_d, champ_p_a, cand_p_h, cand_p_d, cand_p_a FROM predictions WHERE match_id = ?`)
        .get(p.match_id) as unknown as Record<string, number>;
      const y = outcomeIndex(found.score.home_score, found.score.away_score);
      const llChamp = logLossClamped([pred.champ_p_h, pred.champ_p_d, pred.champ_p_a], y);
      const llCand = logLossClamped([pred.cand_p_h, pred.cand_p_d, pred.cand_p_a], y);
      shadow
        .prepare(
          `INSERT INTO gradings (match_id, graded_at, home_score, away_score, ll_champ, ll_cand, delta, score_source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(p.match_id, NOW_ISO, found.score.home_score, found.score.away_score, llChamp, llCand, llCand - llChamp, found.source);
      shadow.prepare(`UPDATE predictions SET status = 'graded' WHERE match_id = ?`).run(p.match_id);
      gradedNew++;
    } else if (found.kind === "none" && fixtureState(dataset, p.match_id) === "cancelled") {
      shadow.prepare(`UPDATE predictions SET status = 'void' WHERE match_id = ?`).run(p.match_id);
      voidedNew++;
    }
    // pending_score_basis / none: tetap pending (aturan resolver).
  }
  // Koreksi skor resmi (pola PRD D2 resolver): grading yang skornya berubah
  // dinilai ulang dari skor terbaru.
  const gradedRows = shadow
    .prepare(
      `SELECT g.match_id AS match_id, g.home_score AS hs, g.away_score AS as_, p.champ_p_h AS ch, p.champ_p_d AS cd, p.champ_p_a AS ca, p.cand_p_h AS kh, p.cand_p_d AS kd, p.cand_p_a AS ka
       FROM gradings g JOIN predictions p ON p.match_id = g.match_id`,
    )
    .all() as unknown as Record<string, number | string>[];
  for (const g of gradedRows) {
    const found = findRegulationScore(dataset, upcoming, linkGroups, String(g.match_id));
    if (found.kind !== "score") continue;
    if (found.score.home_score === g.hs && found.score.away_score === g.as_) continue;
    const y = outcomeIndex(found.score.home_score, found.score.away_score);
    const llChamp = logLossClamped([Number(g.ch), Number(g.cd), Number(g.ca)], y);
    const llCand = logLossClamped([Number(g.kh), Number(g.kd), Number(g.ka)], y);
    shadow
      .prepare(`UPDATE gradings SET graded_at = ?, home_score = ?, away_score = ?, ll_champ = ?, ll_cand = ?, delta = ?, score_source = ? WHERE match_id = ?`)
      .run(NOW_ISO, found.score.home_score, found.score.away_score, llChamp, llCand, llCand - llChamp, found.source, String(g.match_id));
    corrected++;
  }

  // ------------------------------------------------------------ PREDIKSI ---
  const data = loadData(dataset);
  const extractor = new Ml1FeatureExtractor(data.universe, data.compAvg, data.seasonByMatchId, data.canonicalLogs);

  const packages = snapshots
    .prepare(
      `SELECT p.id, p.match_id, p.competition_canonical_id, p.kickoff_utc, p.computed_utc, p.lambda, p.mu, p.payload_json
       FROM packages p
       WHERE p.trigger = 'slate' AND p.kickoff_utc > ?
         AND p.id = (SELECT p2.id FROM packages p2
                     WHERE p2.match_id = p.match_id AND p2.trigger = 'slate'
                     ORDER BY p2.computed_utc DESC, p2.id DESC LIMIT 1)
       ORDER BY p.kickoff_utc`,
    )
    .all(NOW_ISO) as unknown as PkgRow[];
  const already = new Set(
    (shadow.prepare(`SELECT match_id FROM predictions`).all() as unknown as { match_id: string }[]).map((r) => r.match_id),
  );
  const upcomingById = new Map<string, { home_team_id: string; away_team_id: string; home_team_name: string; away_team_name: string }>();
  for (const r of upcoming
    .prepare(`SELECT match_id, home_team_id, away_team_id, home_team_name, away_team_name FROM upcoming_fixtures`)
    .all() as unknown as { match_id: string; home_team_id: string; away_team_id: string; home_team_name: string; away_team_name: string }[]) {
    upcomingById.set(r.match_id, r);
  }

  interface ToPredict {
    pkg: PkgRow;
    champP: [number, number, number];
    featB: number[];
    homeKey: string;
    awayKey: string;
    homeName: string;
    awayName: string;
    slice: string;
    registryStatus: string | null;
  }
  const toPredict: ToPredict[] = [];
  const skipped: Record<string, number> = {};
  for (const pkg of packages) {
    if (already.has(pkg.match_id)) {
      skipped.already_predicted = (skipped.already_predicted ?? 0) + 1;
      continue;
    }
    if (LIMIT > 0 && toPredict.length >= LIMIT) break;
    const up = upcomingById.get(pkg.match_id);
    if (!up) {
      skipped.no_upcoming_row = (skipped.no_upcoming_row ?? 0) + 1;
      continue;
    }
    let payload: { fixture?: { home?: string; away?: string }; probabilities?: Record<string, number> };
    try {
      payload = JSON.parse(pkg.payload_json);
    } catch {
      skipped.bad_payload = (skipped.bad_payload ?? 0) + 1;
      continue;
    }
    const probs = payload.probabilities ?? {};
    const champP: [number, number, number] = [probs["1x2:1"], probs["1x2:x"], probs["1x2:2"]];
    if (champP.some((v) => typeof v !== "number" || !(v > 0))) {
      skipped.no_champion_probs = (skipped.no_champion_probs ?? 0) + 1;
      continue;
    }
    const homeKey = resolveTeamKey(String(up.home_team_id), up.home_team_name);
    const awayKey = resolveTeamKey(String(up.away_team_id), up.away_team_name);
    const row: EvalMatchRow = {
      match_id: pkg.match_id,
      competition_id: pkg.competition_canonical_id,
      utc_date: pkg.kickoff_utc,
      home_team_id: homeKey,
      away_team_id: awayKey,
      home_score: 0,
      away_score: 0,
    };
    const registryStatus = data.registryStatus.get(pkg.competition_canonical_id) ?? null;
    toPredict.push({
      pkg,
      champP,
      featB: extractor.prospectiveFeaturesB(row),
      homeKey,
      awayKey,
      homeName: up.home_team_name,
      awayName: up.away_team_name,
      slice: registryStatus === "calibrated" || registryStatus === "partial" ? "kompetitif" : "friendlies",
      registryStatus,
    });
  }

  let predictedNew = 0;
  if (toPredict.length > 0) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ml1-prosp-"));
    const inPath = path.join(tmp, "in.jsonl");
    const outPath = path.join(tmp, "out.jsonl");
    fs.writeFileSync(
      inPath,
      toPredict
        .map((t) =>
          JSON.stringify({ match: t.pkg.match_id, champLam: t.pkg.lambda, champMu: t.pkg.mu, champFallback: false, featB: t.featB }),
        )
        .join("\n") + "\n",
    );
    execFileSync(PYTHON, [path.join(process.cwd(), "scripts/ml1-predict.py"), `--model-dir=${MODEL_DIR}`, `--input=${inPath}`, `--output=${outPath}`], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    const preds = new Map(
      fs
        .readFileSync(outPath, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => {
          const r = JSON.parse(l) as { match: string; lam: number; mu: number };
          return [r.match, r] as const;
        }),
    );
    const insert = shadow.prepare(
      `INSERT OR IGNORE INTO predictions (
        match_id, competition_id, kickoff_utc, predicted_at, home_team_key, away_team_key,
        home_name, away_name, slice, registry_status,
        champ_lam, champ_mu, champ_p_h, champ_p_d, champ_p_a,
        cand_lam, cand_mu, cand_p_h, cand_p_d, cand_p_a,
        features_json, package_id, package_computed_utc, model_manifest_sha256, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    );
    for (const t of toPredict) {
      const pr = preds.get(t.pkg.match_id);
      if (!pr) continue;
      const mp = matrixProbs(pr.lam, pr.mu, 0);
      const res = insert.run(
        t.pkg.match_id, t.pkg.competition_canonical_id, t.pkg.kickoff_utc, NOW_ISO,
        t.homeKey, t.awayKey, t.homeName, t.awayName, t.slice, t.registryStatus,
        t.pkg.lambda, t.pkg.mu, t.champP[0], t.champP[1], t.champP[2],
        pr.lam, pr.mu, mp.p[0], mp.p[1], mp.p[2],
        JSON.stringify(t.featB), t.pkg.id, t.pkg.computed_utc, modelManifestSha,
      );
      if (Number(res.changes) > 0) predictedNew++;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ------------------------------------------------------------ EVALUASI ---
  const sliceStats = (slice: string | null): { n: number; llChamp: number | null; llCand: number | null; delta: number | null; ub: number | null } => {
    const rows = shadow
      .prepare(
        `SELECT p.kickoff_utc AS ko, g.ll_champ AS lc, g.ll_cand AS lk, g.delta AS d
         FROM gradings g JOIN predictions p ON p.match_id = g.match_id
         ${slice ? "WHERE p.slice = ?" : ""} ORDER BY p.kickoff_utc`,
      )
      .all(...(slice ? [slice] : [])) as unknown as { ko: string; lc: number; lk: number; d: number }[];
    if (rows.length === 0) return { n: 0, llChamp: null, llCand: null, delta: null, ub: null };
    const paired: PairedDeltaRow[] = rows.map((r) => ({ block: isoWeekKey(r.ko), delta: r.d }));
    const boot = blockBootstrapDelta(paired, { resamples: 5000, seed: BOOTSTRAP_SEED });
    return {
      n: rows.length,
      llChamp: rows.reduce((s, r) => s + r.lc, 0) / rows.length,
      llCand: rows.reduce((s, r) => s + r.lk, 0) / rows.length,
      delta: boot.meanDelta,
      ub: boot.upperOneSided95,
    };
  };
  const komp = sliceStats("kompetitif");
  const pooled = sliceStats(null);
  const status =
    komp.n >= RULE.minCompetitiveN && komp.delta !== null && komp.delta <= RULE.maxDelta && komp.ub !== null && komp.ub < 0
      ? "READY_TO_PROPOSE"
      : "COLLECTING";
  const totals = shadow
    .prepare(`SELECT COUNT(*) AS n, SUM(status = 'graded') AS g, SUM(status = 'void') AS v FROM predictions`)
    .get() as unknown as { n: number; g: number; v: number };

  const guardAfter = guardSnapshot();
  const guardIdentical = JSON.stringify(guardBefore) === JSON.stringify(guardAfter);

  shadow
    .prepare(`INSERT INTO evaluations (run_at, status, kompetitif_n, kompetitif_delta, kompetitif_ub, pooled_n, pooled_delta, pooled_ub, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(NOW_ISO, status, komp.n, komp.delta, komp.ub, pooled.n, pooled.delta, pooled.ub, JSON.stringify({ kompetitif: komp, pooled, rule: RULE, model: modelManifest.candidate_id ?? null }));
  shadow
    .prepare(`INSERT INTO runs (run_at, predicted_new, graded_new, corrected, voided_new, guard_identical) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(NOW_ISO, predictedNew, gradedNew, corrected, voidedNew, guardIdentical ? 1 : 0);

  dataset.close();
  upcoming.close();
  snapshots.close();
  shadow.close();

  console.log(
    JSON.stringify({
      tool: "ml1-prospective",
      run_at: NOW_ISO,
      predicted_new: predictedNew,
      graded_new: gradedNew,
      corrected,
      voided_new: voidedNew,
      skipped,
      totals: { predictions: totals.n, graded: Number(totals.g ?? 0), void: Number(totals.v ?? 0) },
      kompetitif: komp,
      pooled,
      status,
      guard_identical: guardIdentical,
    }),
  );
  if (!guardIdentical) {
    console.error("PERINGATAN PENJAGA: berkas saji/DB produksi berubah selama run — isolasi shadow GAGAL.");
    process.exitCode = 3;
  }
}

// ---------------------------------------------------------------------------
// MODE --pit-a (Brief ML1-PIT A): shadow ML1-B dengan seleksi paket as-of,
// dedupe UID kanonik sebelum inferensi/limit, dan provenance champion dari
// paket yang benar-benar dipakai. Implementasi di lib/eval/ml1-pit-a.ts
// (dapat diuji dengan clock + executor injeksi); di sini hanya perakitan
// dependensi produksi: DB masukan read-only via dbPath(), jam AKTUAL, dan
// executor Python produksi. Hasil HANYA ke ml1_prospective_pit_a.db.
// ---------------------------------------------------------------------------
function runPitACli(): void {
  if (args.some((a) => a === "--now" || a.startsWith("--now="))) {
    console.error(
      "ML1-PIT-A: --now tidak didukung bersama --pit-a — jam keputusan selalu jam aktual. " +
        "Untuk waktu buatan gunakan fixture uji tests/test-ml1-pit-a.ts (clock injeksi).",
    );
    process.exit(2);
  }
  let dataset: DatabaseSync | null = null;
  let upcoming: DatabaseSync | null = null;
  let snapshots: DatabaseSync | null = null;
  try {
    dataset = new DatabaseSync(dbPath("thestats_dataset.db"), { readOnly: true });
    upcoming = new DatabaseSync(dbPath("upcoming_fixtures.db"), { readOnly: true });
    snapshots = new DatabaseSync(dbPath("analysis_snapshots.db"), { readOnly: true });
    const summary = runMl1PitA({
      dataset,
      upcoming,
      snapshots,
      outputDbPath: dbPath("ml1_prospective_pit_a.db"),
      dataDirPath: dataDir(),
      modelDir: MODEL_DIR,
      clock: () => new Date(),
      executor: createPythonInferenceExecutor({
        pythonPath: PYTHON,
        predictScriptPath: path.join(process.cwd(), "scripts/ml1-predict.py"),
      }),
      limit: LIMIT,
    });
    console.log(JSON.stringify(summary));
  } catch (err) {
    console.error(
      `ML1-PIT-A GAGAL: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  } finally {
    dataset?.close();
    upcoming?.close();
    snapshots?.close();
  }
}

if (PIT_A_MODE) {
  runPitACli();
} else {
  main();
}
