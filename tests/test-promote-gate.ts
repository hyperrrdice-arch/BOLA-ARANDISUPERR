/**
 * SUITE ITEM 24 (Sprint A+B) — gate promosi fail-closed + celah --no-ledger.
 *
 * A. Unit: validatePromotionEvidence menolak per jalur (decision gagal /
 *    hilang, hash run-manifest tak cocok, hash input hilang, cakupan
 *    turun, persetujuan pemilik hilang / hash tak cocok, paritas hilang,
 *    rollback hilang) dan meloloskan bukti yang lengkap & cocok.
 * B. CLI: scripts/promote-model.ts di sandbox data-dir —
 *    tanpa bukti → exit 2 dan manifest aktif TIDAK berubah byte-nya;
 *    decision "retain" → exit 2, tidak berubah;
 *    bukti lengkap → exit 0 dan pointer aktif berpindah ke kandidat.
 * C. CLI: scripts/pick-slate.ts --no-ledger → exit 1 dengan pesan
 *    penolakan eksplisit dan tidak ada DB paket yang dibuat.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  REPO_ROOT,
  Suite,
  createFixtureEnv,
  runScript,
  settleFixtureEnv,
} from "./helpers/fixture-env";
import {
  buildManifest,
  serializeManifest,
  storeRatingsArtifact,
  writeActiveManifest,
  writeFileAtomicSync,
  type ModelManifest,
} from "../lib/quant/model-manifest";
import { validatePromotionEvidence } from "../lib/quant/promotion-evidence";

const suite = new Suite("promote-gate (Item 24)");

function synthRatings(e0: number, sp1: number): string {
  const league = (div: string, matches: number, status: string) => ({
    div,
    leagueName: `Liga ${div}`,
    country: "Testland",
    seasonCount: 2,
    totalMatches: matches,
    leagueAvgGoals: 1.33,
    homeAdvantage: 1.21,
    rho: -0.05,
    calibrationDate: "2026-11-01",
    calibrationStatus: status,
    teams: Object.fromEntries(
      [0, 1, 2, 3].map((i) => [
        `${div}-T${i}`,
        {
          name: `${div}-T${i}`,
          attack: 1.1,
          defense: 0.9,
          matchesCount: 40,
          goalsScored: 50,
          goalsConceded: 40,
          lastMatchDate: "2026-11-14",
        },
      ]),
    ),
  });
  return JSON.stringify({
    version: "2.0-dixon-coles-mle",
    compiledAt: "2026-11-20T00:00:00.000Z",
    totalLeagues: 2,
    totalTeams: 8,
    leagues: { E0: league("E0", e0, "calibrated"), SP1: league("SP1", sp1, "partial") },
  });
}

const WINDOW = { start: "2025-08-01", end: "2026-11-14", basis: "match_dates" as const };
const candidate: ModelManifest = buildManifest({
  ratingsRaw: synthRatings(700, 400),
  generatedBy: "test:promote-gate",
  generatedAt: "2026-11-24T00:00:00.000Z",
  window: WINDOW,
});

function decisionOk(): Record<string, unknown> {
  return {
    decision: "eligible_for_shadow",
    gate_checks: [
      { id: "sample_floor", observed: 1.65, threshold: 1, pass: true },
      { id: "mean_delta", observed: -0.006, threshold: -0.005, pass: true },
      { id: "bootstrap_upper", observed: -0.001, threshold: 0, pass: true },
      { id: "coverage_drop", observed: 0, threshold: 0.02, pass: true },
      { id: "brier_increase", observed: 0.0001, threshold: 0.002, pass: true },
    ],
    headline: { n: 6708, coverage_champion: 1, coverage_candidate: 1 },
    promotion_performed: false,
  };
}
function runManifestOk(): Record<string, unknown> {
  return {
    tool: "scripts/evaluate-kandidat-test.ts",
    promotion: {
      candidate_content_hash: candidate.contentHash,
      candidate_ratings_hash: candidate.ratingsHash,
      candidate_model_version: candidate.modelVersion,
      input_hashes: { matches: "sha256:a9ce4587", logs: "sha256:7c3b3068" },
      coverage: { candidate: 1, champion: 1 },
    },
  };
}
function approvalOk(): Record<string, unknown> {
  return {
    approved: true,
    approved_by: "Arandi (pemilik)",
    approved_at_utc: "2026-11-24T15:00:00.000Z",
    candidate_content_hash: candidate.contentHash,
  };
}
const PARITY_OK = { sampleSize: 100, sumAbsDelta: 0.001 };
const ROLLBACK_OK = { path: "rollback.md", sha256: "sha256:deadbeef" };

function validate(over: Partial<Parameters<typeof validatePromotionEvidence>[0]>) {
  return validatePromotionEvidence({
    candidate,
    decision: decisionOk(),
    runManifest: runManifestOk(),
    approval: approvalOk(),
    parity: PARITY_OK,
    rollbackPlan: ROLLBACK_OK,
    ...over,
  });
}
const hasReason = (r: { reasons: string[] }, prefix: string): boolean =>
  r.reasons.some((x) => x.startsWith(prefix));

// ---------------------------------------------------------------- A. unit
console.log("\nA. validator bukti promosi (unit)");
{
  suite.check("bukti lengkap & cocok → ok", validate({}).ok);
  const retain = validate({ decision: { ...decisionOk(), decision: "retain" } });
  suite.check("decision retain → tolak", !retain.ok && hasReason(retain, "decision_not_pass"));
  const noDecision = validate({ decision: null, decisionError: "tidak ada" });
  suite.check("decision hilang → tolak", !noDecision.ok && hasReason(noDecision, "decision_missing"));
  const badCheck = decisionOk();
  (badCheck.gate_checks as { pass: boolean }[])[1].pass = false;
  const rBadCheck = validate({ decision: badCheck });
  suite.check(
    "satu gate check gagal → tolak",
    !rBadCheck.ok && hasReason(rBadCheck, "decision_gate_check_failed"),
  );
  const badHash = runManifestOk();
  (badHash.promotion as Record<string, unknown>).candidate_content_hash = "sha256:lain";
  const rBadHash = validate({ runManifest: badHash });
  suite.check(
    "hash kandidat run-manifest ≠ kandidat → tolak",
    !rBadHash.ok && hasReason(rBadHash, "run_manifest_candidate_hash_mismatch"),
  );
  const noInputs = runManifestOk();
  (noInputs.promotion as Record<string, unknown>).input_hashes = {};
  const rNoInputs = validate({ runManifest: noInputs });
  suite.check(
    "hash input kosong → tolak",
    !rNoInputs.ok && hasReason(rNoInputs, "run_manifest_input_hashes_missing"),
  );
  const dropCov = runManifestOk();
  (dropCov.promotion as Record<string, unknown>).coverage = { candidate: 0.9, champion: 1 };
  const rDrop = validate({ runManifest: dropCov });
  suite.check(
    "cakupan turun 0,10 → tolak",
    !rDrop.ok && hasReason(rDrop, "run_manifest_coverage_drop"),
  );
  const noApproval = validate({ approval: null, approvalError: "tidak ada" });
  suite.check(
    "persetujuan pemilik hilang → tolak",
    !noApproval.ok && hasReason(noApproval, "owner_approval_missing"),
  );
  const badApproval = validate({
    approval: { ...approvalOk(), candidate_content_hash: "sha256:lain" },
  });
  suite.check(
    "persetujuan menyebut kandidat lain → tolak",
    !badApproval.ok && hasReason(badApproval, "owner_approval_hash_mismatch"),
  );
  const noParity = validate({ parity: null });
  suite.check("paritas hilang → tolak", !noParity.ok && hasReason(noParity, "parity_missing"));
  const noRollback = validate({ rollbackPlan: null, rollbackError: "tidak ada" });
  suite.check(
    "rollback hilang → tolak",
    !noRollback.ok && hasReason(noRollback, "rollback_plan_missing"),
  );
}

// ---------------------------------------------------------------- B. CLI
console.log("\nB. promote-model.ts CLI (sandbox)");
{
  const env = createFixtureEnv("promote");
  const dataDir = env.dataDir;
  const rawChampion = synthRatings(600, 400);
  const rawCandidate = synthRatings(700, 400);
  storeRatingsArtifact(dataDir, rawChampion);
  storeRatingsArtifact(dataDir, rawCandidate);
  const champion = buildManifest({
    ratingsRaw: rawChampion,
    generatedBy: "test:promote-gate",
    generatedAt: "2026-11-20T00:00:00.000Z",
    window: WINDOW,
  });
  const cand = buildManifest({
    ratingsRaw: rawCandidate,
    generatedBy: "test:promote-gate",
    generatedAt: "2026-11-24T00:00:00.000Z",
    window: WINDOW,
  });
  writeActiveManifest(dataDir, champion);
  writeFileAtomicSync(
    path.join(dataDir, "model-manifest.candidate.json"),
    serializeManifest(cand),
  );
  const activePath = path.join(dataDir, "model-manifest.json");
  const activeBefore = fs.readFileSync(activePath, "utf8");

  const evDir = path.join(env.root, "evidence");
  fs.mkdirSync(evDir, { recursive: true });
  const w = (name: string, obj: unknown) => {
    const p = path.join(evDir, name);
    fs.writeFileSync(p, JSON.stringify(obj));
    return p;
  };
  const decisionFile = w("decision.json", {
    decision: "eligible_for_shadow",
    gate_checks: decisionOk().gate_checks,
    headline: { n: 6708, coverage_champion: 1, coverage_candidate: 1 },
    promotion_performed: false,
  });
  const retainFile = w("decision-retain.json", {
    decision: "retain",
    gate_checks: decisionOk().gate_checks,
    headline: { n: 6708, coverage_champion: 1, coverage_candidate: 1 },
    promotion_performed: false,
  });
  const runManifestFile = w("run-manifest.json", {
    tool: "test",
    promotion: {
      candidate_content_hash: cand.contentHash,
      candidate_ratings_hash: cand.ratingsHash,
      candidate_model_version: cand.modelVersion,
      input_hashes: { matches: "sha256:a9ce4587" },
      coverage: { candidate: 1, champion: 1 },
    },
  });
  const approvalFile = w("approval.json", {
    approved: true,
    approved_by: "Arandi (pemilik)",
    approved_at_utc: "2026-11-24T15:00:00.000Z",
    candidate_content_hash: cand.contentHash,
  });
  const parityFile = w("parity.json", PARITY_OK);
  const rollbackFile = path.join(evDir, "rollback.md");
  fs.writeFileSync(rollbackFile, "# Rencana rollback: pulihkan manifest champion dari backup predeploy.\n");

  const runPromote = (extra: string[]) =>
    spawnSync(
      "npx",
      [
        "--no-install",
        "tsx",
        path.join(REPO_ROOT, "scripts/promote-model.ts"),
        `--data-dir=${dataDir}`,
        ...extra,
      ],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );

  const noEvidence = runPromote([]);
  suite.eq("CLI tanpa bukti: exit 2", noEvidence.status, 2);
  suite.eq(
    "CLI tanpa bukti: manifest aktif tidak berubah",
    fs.readFileSync(activePath, "utf8"),
    activeBefore,
  );
  suite.check(
    "CLI tanpa bukti: alasan decision_missing terbaca",
    (noEvidence.stdout ?? "").includes("decision_missing"),
    noEvidence.stdout,
  );

  const retainRun = runPromote([
    `--decision-file=${retainFile}`,
    `--run-manifest=${runManifestFile}`,
    `--owner-approval=${approvalFile}`,
    `--parity-file=${parityFile}`,
    `--rollback-plan=${rollbackFile}`,
  ]);
  suite.eq("CLI decision retain: exit 2", retainRun.status, 2);
  suite.eq(
    "CLI decision retain: manifest aktif tidak berubah",
    fs.readFileSync(activePath, "utf8"),
    activeBefore,
  );

  const fullRun = runPromote([
    `--decision-file=${decisionFile}`,
    `--run-manifest=${runManifestFile}`,
    `--owner-approval=${approvalFile}`,
    `--parity-file=${parityFile}`,
    `--rollback-plan=${rollbackFile}`,
  ]);
  suite.eq("CLI bukti lengkap: exit 0", fullRun.status, 0);
  const activeAfter = JSON.parse(fs.readFileSync(activePath, "utf8")) as ModelManifest;
  suite.eq(
    "CLI bukti lengkap: pointer aktif = kandidat",
    activeAfter.contentHash,
    cand.contentHash,
  );
  settleFixtureEnv(env, suite.failedCount > 0);
}

// ---------------------------------------------------------------- C. CLI
console.log("\nC. pick-slate --no-ledger (sandbox)");
{
  const env = createFixtureEnv("noledger");
  // runScript memakai executable tsx absolut dari REPO_ROOT — pola lama
  // spawnSync("npx", { cwd: env.root }) bergantung pada cache _npx lokal:
  // di mesin bersih (CI) npx gagal menemukan tsx dan exit 1 karena alasan
  // yang salah, sehingga assert exit sempat lolos tanpa CLI benar-benar
  // berjalan (B0.1, Brief Temuan Terakhir 26 Nov 2026).
  const run = runScript(env, "scripts/pick-slate.ts", ["--no-ledger"], {
    DB_DIR: env.dataDir,
  });
  suite.eq("pick-slate --no-ledger: exit 1", run.code, 1);
  suite.check(
    "pick-slate --no-ledger: pesan penolakan eksplisit",
    run.stderr.includes("--no-ledger ditolak"),
    run.stderr,
  );
  suite.check(
    "pick-slate --no-ledger: tidak ada DB paket ditulis",
    !fs.existsSync(path.join(env.dataDir, "analysis_snapshots.db")),
  );
  settleFixtureEnv(env, suite.failedCount > 0);
}

suite.finish();
