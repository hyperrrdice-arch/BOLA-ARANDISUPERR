/**
 * TEST:MODEL-ARTIFACTS — suite fix-5 (review K8 §5): bobot artefak
 * immutable per hash + pointer manifest + penjaga point-in-time.
 *
 * Penerimaan review, persis seperti tertulis:
 *  A. Champion A aktif → buat kandidat B yang DITOLAK gerbang promosi →
 *     jalur saji: prediksi, hash paket, dan versi tercatat HARUS tetap
 *     milik A semua (padahal file lepas sudah berisi B).
 *  B. Promosikan B (yang sah) lewat jalur resmi → ketiganya berpindah
 *     bersama ke B.
 *  C. Hash artefak dirusak → kegagalan EKSPLISIT bernama sebelum
 *     penerbitan apa pun (loader saji + evaluator berhenti bernama).
 *  D. Penjaga point-in-time evaluator: keputusan sebelum akhir jendela
 *     latih artefak → point_in_time_violation; izin eksplisit →
 *     hasil tercap BUKAN point-in-time; keputusan sesudah jendela →
 *     pointInTime true.
 *  E. Unit store: immutable (isi sama = no-op terverifikasi, isi beda =
 *     file baru), artifact_conflict pada store rusak, artifact_missing
 *     pada store kosong, batas PIT (window.end == tanggal keputusan =
 *     pelanggaran).
 *
 * "Jalur saji" diuji pada jahitan yang sama persis dengan yang dipakai
 * scripts/pick-slate.ts (loadServingModel → override ratings-loader →
 * identitas manifest dicap ke paket) dan evaluator subprocess — pola
 * yang sama dengan sandbox paritas K4 di tests/test-model.ts.
 *
 * Pakai: npm run test:quant (suite ini dirantai di dalamnya)
 */
import fs from "node:fs";
import path from "node:path";
import {
  REPO_ROOT,
  Suite,
  createFixtureEnv,
  runScript,
  settleFixtureEnv,
  type FixtureEnv,
} from "./helpers/fixture-env";
import {
  ModelManifestError,
  artifactPath,
  buildManifest,
  loadActiveManifest,
  loadServingModel,
  pointInTimeViolations,
  ratingsFullHashOf,
  ratingsHashOf,
  storeRatingsArtifact,
  writeActiveManifest,
} from "../lib/quant/model-manifest";

const suite = new Suite("test:model-artifacts");
const throwsCode = (fn: () => unknown, code: string): boolean => {
  try {
    fn();
    return false;
  } catch (err) {
    return err instanceof ModelManifestError && err.code === code;
  }
};
const shiftDate = (yyyyMmDd: string, days: number): string => {
  const d = new Date(`${yyyyMmDd}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
};

function main(): void {
  // -------------------------------------------------------------------------
  // E. Unit store artefak + batas penjaga point-in-time
  // -------------------------------------------------------------------------
  console.log("\nE. unit: store immutable, konflik, missing, batas PIT");
  const unit = createFixtureEnv("artifacts-unit");
  let unitFailed = false;
  try {
    const rawX = JSON.stringify({ version: "unit-x", compiledAt: "2026-11-20T00:00:00.000Z", totalLeagues: 0, totalTeams: 0, leagues: {} });
    const rawY = JSON.stringify({ version: "unit-y", compiledAt: "2026-11-20T00:00:00.000Z", totalLeagues: 0, totalTeams: 0, leagues: {} });
    const s1 = storeRatingsArtifact(unit.dataDir, rawX);
    suite.check("store: artefak pertama dibuat (created=true)", s1.created === true && fs.existsSync(s1.file));
    const bytesBefore = fs.readFileSync(s1.file, "utf8");
    const s2 = storeRatingsArtifact(unit.dataDir, rawX);
    suite.check(
      "store: isi sama disimpan lagi = no-op terverifikasi, byte tidak berubah (immutable)",
      s2.created === false && fs.readFileSync(s1.file, "utf8") === bytesBefore && bytesBefore === rawX,
    );
    const s3 = storeRatingsArtifact(unit.dataDir, rawY);
    suite.check(
      "store: isi beda = file BARU content-addressed, artefak lama utuh",
      s3.created === true && s3.file !== s1.file && fs.existsSync(s1.file) && fs.existsSync(s3.file),
    );

    // Store rusak: file bernama hash X tetapi isinya diganti manual.
    fs.writeFileSync(s1.file, rawY);
    suite.check(
      "store: file bernama hash dengan isi asing → artifact_conflict",
      throwsCode(() => storeRatingsArtifact(unit.dataDir, rawX), "artifact_conflict"),
    );

    // Manifest menunjuk artefak yang tidak pernah disimpan → missing.
    const orphan = createFixtureEnv("artifacts-orphan");
    try {
      const mOrphan = buildManifest({ ratingsRaw: rawX, generatedBy: "test:model-artifacts" });
      writeActiveManifest(orphan.dataDir, mOrphan);
      suite.check(
        "resolve: pointer tanpa artefak di store → artifact_missing (bukan fallback file lepas)",
        throwsCode(() => loadServingModel(orphan.dataDir), "artifact_missing"),
      );
    } finally {
      settleFixtureEnv(orphan, suite.failedCount > 0);
    }

    // Batas PIT pada level fungsi murni.
    const mPit = buildManifest({
      ratingsRaw: rawX,
      generatedBy: "test:model-artifacts",
      window: { start: "2025-08-01", end: "2026-11-16", basis: "match_dates" },
    });
    suite.check(
      "PIT: keputusan sesudah akhir jendela (21 Nov > 16 Nov) sah",
      pointInTimeViolations(mPit, ["2026-11-21T12:00:00.000Z"]).length === 0,
    );
    suite.check(
      "PIT: keputusan pada tanggal akhir jendela (16 Nov) = pelanggaran (konservatif)",
      pointInTimeViolations(mPit, ["2026-11-16T00:00:00.000Z"]).length === 1,
    );
    suite.check(
      "PIT: keputusan 1 Nov dengan latih s.d. 16 Nov = pelanggaran (contoh review)",
      pointInTimeViolations(mPit, ["2026-11-01T12:00:00.000Z"]).length === 1,
    );
    suite.check(
      "PIT: campuran — hanya keputusan yang melanggar yang dihitung",
      pointInTimeViolations(mPit, ["2026-11-21T12:00:00.000Z", "2026-11-01T12:00:00.000Z", "2026-10-01T12:00:00.000Z"]).length === 2,
    );
  } catch (err) {
    unitFailed = true;
    console.error("FATAL unit:", err);
    suite.check("unit selesai tanpa exception", false, err instanceof Error ? err.message : String(err));
  } finally {
    settleFixtureEnv(unit, unitFailed || suite.failedCount > 0);
  }

  // -------------------------------------------------------------------------
  // A–D. Sandbox naratif: champion A → B ditolak → saji tetap A →
  //      PIT guard → B sah dipromosikan → semua pindah → artefak rusak.
  // -------------------------------------------------------------------------
  console.log("\nA–D. sandbox: pointer saji, penolakan, promosi, kerusakan, PIT");
  const env: FixtureEnv = createFixtureEnv("artifacts");
  let envFailed = false;
  try {
    for (const f of ["calibrated_ratings.json", "league-canonical.json", "team-canonical.json", "fixture-links.json"]) {
      fs.copyFileSync(path.join(REPO_ROOT, "data", f), path.join(env.dataDir, f));
    }
    const loosePath = path.join(env.dataDir, "calibrated_ratings.json");
    const rawA = fs.readFileSync(loosePath, "utf8");
    const hashA = ratingsHashOf(rawA);
    const labEnv = { TSX_TSCONFIG_PATH: path.join(REPO_ROOT, "tsconfig.json") };
    const parityPath = path.join(env.root, "parity.json");
    fs.writeFileSync(parityPath, JSON.stringify({ sampleSize: 20, sumAbsDelta: 0 }));

    // 1) Bootstrap champion A (builder --activate menyimpan artefak A).
    const boot = runScript(env, "scripts/build-model-manifest.ts", ["--activate", `--data-dir=${env.dataDir}`]);
    suite.check("bootstrap: builder --activate exit 0", boot.code === 0, boot.stderr.slice(0, 300));
    const artifactA = artifactPath(env.dataDir, ratingsFullHashOf(rawA));
    suite.check("bootstrap: artefak champion A tersimpan di store immutable", fs.existsSync(artifactA));
    const manifestA = loadActiveManifest(env.dataDir);
    const servingA = loadServingModel(env.dataDir);
    suite.check(
      "bootstrap: loadServingModel mengembalikan identitas A (versi + hash + artefak A)",
      servingA.manifest.modelVersion === manifestA.modelVersion &&
        servingA.manifest.ratingsHash === hashA &&
        servingA.artifactFile === artifactA,
    );
    const windowEnd = manifestA.training.window.end;
    const decisionOk = shiftDate(windowEnd, 5);
    const decisionPit = shiftDate(windowEnd, -15);

    const samples = [
      { id: "s1", homeTeam: "Arsenal", awayTeam: "Chelsea", leagueHint: "English Premier League", decisionAt: decisionOk },
      { id: "s2", homeTeam: "Liverpool", awayTeam: "Arsenal", leagueHint: "English Premier League", decisionAt: decisionOk },
    ];
    const samplesPath = path.join(env.root, "samples.json");
    fs.writeFileSync(samplesPath, JSON.stringify({ samples }));
    const runEval = (outName: string, extra: string[] = [], samplesFile = samplesPath) =>
      runScript(env, "scripts/evaluate-model.ts", [
        `--samples=${samplesFile}`, `--data-dir=${env.dataDir}`, `--out=${path.join(env.root, outName)}`, ...extra,
      ], labEnv);
    const readOut = (outName: string) =>
      JSON.parse(fs.readFileSync(path.join(env.root, outName), "utf8")) as {
        modelVersion: string; ratingsHash: string; pointInTime?: boolean; pointInTimeWarning?: string;
        rows: { id: string; probHome: number; probDraw: number; probAway: number }[];
      };

    // 2) Prediksi dasar dari A.
    const evA = runEval("labA.json");
    suite.check("A: evaluator exit 0 pada champion A", evA.code === 0, evA.stderr.slice(0, 300));
    const outA = readOut("labA.json");
    suite.check(
      "A: baris evaluator membawa identitas A + pointInTime true",
      outA.modelVersion === manifestA.modelVersion && outA.ratingsHash === hashA && outA.pointInTime === true,
    );
    const probsA = JSON.stringify(outA.rows);

    // 3) Refit B yang DITOLAK: liga B1 dibuang → latih menyusut.
    const objReject = JSON.parse(rawA) as { leagues: Record<string, unknown>; compiledAt: string };
    delete objReject.leagues.B1;
    objReject.compiledAt = "2026-11-21T00:00:00.000Z";
    const rawReject = JSON.stringify(objReject, null, 2);
    fs.writeFileSync(loosePath, rawReject);
    const activeBefore = fs.readFileSync(path.join(env.dataDir, "model-manifest.json"), "utf8");
    const candBuild = runScript(env, "scripts/build-model-manifest.ts", [`--data-dir=${env.dataDir}`]);
    suite.check("B-tolak: builder kandidat exit 0", candBuild.code === 0, candBuild.stderr.slice(0, 300));
    suite.check(
      "B-tolak: artefak kandidat tersimpan + manifest aktif TIDAK berubah oleh refit",
      fs.existsSync(artifactPath(env.dataDir, ratingsFullHashOf(rawReject))) &&
        fs.readFileSync(path.join(env.dataDir, "model-manifest.json"), "utf8") === activeBefore,
    );
    const promoteReject = runScript(env, "scripts/promote-model.ts", [
      `--data-dir=${env.dataDir}`, `--parity-file=${parityPath}`,
    ]);
    suite.check(
      "B-tolak: gerbang promosi MENOLAK (exit 2, candidate_training_smaller)",
      promoteReject.code === 2 && promoteReject.stdout.includes("candidate_training_smaller"),
      `code=${promoteReject.code} out=${promoteReject.stdout.slice(0, 200)}`,
    );

    // 4) Jalur saji SESUDAH penolakan: file lepas = B, saji tetap A semua.
    suite.check(
      "A-tetap: file lepas kini berisi B (hash-nya B), bukan A",
      ratingsHashOf(fs.readFileSync(loosePath, "utf8")) === ratingsHashOf(rawReject) &&
        ratingsHashOf(rawReject) !== hashA,
    );
    const servingAfterReject = loadServingModel(env.dataDir);
    suite.check(
      "A-tetap: versi + hash yang dicap paket tetap milik A",
      servingAfterReject.manifest.modelVersion === manifestA.modelVersion &&
        servingAfterReject.manifest.ratingsHash === hashA,
    );
    const evAfterReject = runEval("labA2.json");
    const outA2 = readOut("labA2.json");
    suite.check(
      "A-tetap: prediksi evaluator identik dengan dasar A (bobot A, bukan file lepas B)",
      evAfterReject.code === 0 && JSON.stringify(outA2.rows) === probsA && outA2.ratingsHash === hashA,
      `code=${evAfterReject.code} err=${evAfterReject.stderr.slice(0, 200)}`,
    );

    // 5) Penjaga point-in-time pada champion A.
    const samplesPitPath = path.join(env.root, "samples-pit.json");
    fs.writeFileSync(samplesPitPath, JSON.stringify({
      samples: samples.map((s) => ({ ...s, decisionAt: decisionPit })),
    }));
    const evPit = runEval("labPit.json", [], samplesPitPath);
    suite.check(
      "PIT: keputusan sebelum akhir jendela latih → evaluator berhenti point_in_time_violation",
      evPit.code !== 0 && evPit.stderr.includes("point_in_time_violation"),
      `code=${evPit.code} err=${evPit.stderr.slice(0, 240)}`,
    );
    const evPitAllowed = runEval("labPitAllowed.json", ["--allow-non-point-in-time"], samplesPitPath);
    const outPitAllowed = readOut("labPitAllowed.json");
    suite.check(
      "PIT: izin eksplisit → jalan, tetapi tercap BUKAN point-in-time (field + banner)",
      evPitAllowed.code === 0 &&
        outPitAllowed.pointInTime === false &&
        typeof outPitAllowed.pointInTimeWarning === "string" &&
        evPitAllowed.stderr.includes("BUKAN POINT-IN-TIME"),
      `code=${evPitAllowed.code} err=${evPitAllowed.stderr.slice(0, 200)}`,
    );

    // 6) B sah: serangan Arsenal diubah di SEMUA fit liga yang memuatnya
    // (resolusi saji EPL memakai fit SM8, bukan E0 — keduanya diubah agar
    // perubahan bobot pasti terasa di jalur saji) + versi artefak baru.
    const objB = JSON.parse(rawA) as {
      version: string; compiledAt: string;
      leagues: Record<string, { teams: Record<string, { attack: number }> }>;
    };
    objB.version = "2.0-dixon-coles-mle-b";
    objB.compiledAt = "2026-11-21T01:00:00.000Z";
    let arsenalFits = 0;
    for (const lg of Object.values(objB.leagues)) {
      const t = lg.teams?.Arsenal;
      if (t) {
        t.attack = Math.round(t.attack * 1.6 * 10000) / 10000;
        arsenalFits++;
      }
    }
    suite.check("B-promosi: fit Arsenal ditemukan untuk diubah (>= 1 liga)", arsenalFits >= 1, `fits=${arsenalFits}`);
    const rawB = JSON.stringify(objB, null, 2);
    const hashB = ratingsHashOf(rawB);
    fs.writeFileSync(loosePath, rawB);
    runScript(env, "scripts/build-model-manifest.ts", [`--data-dir=${env.dataDir}`]);
    const promoteOk = runScript(env, "scripts/promote-model.ts", [
      `--data-dir=${env.dataDir}`, `--parity-file=${parityPath}`,
    ]);
    suite.check(
      "B-promosi: gerbang resmi mempromosikan B (exit 0)",
      promoteOk.code === 0 && promoteOk.stdout.includes('"decision": "promote"'),
      `code=${promoteOk.code} out=${promoteOk.stdout.slice(0, 200)} err=${promoteOk.stderr.slice(0, 200)}`,
    );
    const servingB = loadServingModel(env.dataDir);
    suite.check(
      "B-promosi: pointer saji berpindah ke B (versi + hash + artefak B)",
      servingB.manifest.ratingsHash === hashB &&
        servingB.manifest.modelVersion.includes("mle-b") &&
        servingB.artifactFile === artifactPath(env.dataDir, ratingsFullHashOf(rawB)),
    );
    const evB = runEval("labB.json");
    const outB = readOut("labB.json");
    const rowB1 = outB.rows.find((r) => r.id === "s1");
    const rowA1 = outA.rows.find((r) => r.id === "s1");
    suite.check(
      "B-promosi: prediksi + identitas evaluator berpindah bersama ke B",
      evB.code === 0 &&
        outB.ratingsHash === hashB &&
        outB.modelVersion === servingB.manifest.modelVersion &&
        rowB1 !== undefined && rowA1 !== undefined &&
        Math.abs(rowB1.probHome - rowA1.probHome) > 1e-6,
      `code=${evB.code} err=${evB.stderr.slice(0, 200)}`,
    );

    // 7) Artefak aktif dirusak → kegagalan eksplisit sebelum penerbitan.
    const artifactB = artifactPath(env.dataDir, ratingsFullHashOf(rawB));
    const rawBCorrupt = fs.readFileSync(artifactB, "utf8").replace("2026-11-21T01:00:00.000Z", "2026-11-21T09:00:00.000Z");
    suite.check("rusak: byte artefak B benar-benar berubah", rawBCorrupt !== rawB);
    fs.writeFileSync(artifactB, rawBCorrupt);
    suite.check(
      "rusak: loadServingModel (jahitan slate, sebelum publikasi) → manifest_ratings_mismatch",
      throwsCode(() => loadServingModel(env.dataDir), "manifest_ratings_mismatch"),
    );
    const evCorrupt = runEval("labCorrupt.json");
    suite.check(
      "rusak: evaluator berhenti bernama manifest_ratings_mismatch, nol baris terbit",
      evCorrupt.code !== 0 && evCorrupt.stderr.includes("manifest_ratings_mismatch") &&
        !fs.existsSync(path.join(env.root, "labCorrupt.json")),
      `code=${evCorrupt.code} err=${evCorrupt.stderr.slice(0, 200)}`,
    );
  } catch (err) {
    envFailed = true;
    console.error("FATAL sandbox:", err);
    suite.check("sandbox selesai tanpa exception", false, err instanceof Error ? err.message : String(err));
  } finally {
    settleFixtureEnv(env, envFailed || suite.failedCount > 0);
  }

  // -------------------------------------------------------------------------
  // Wiring statis: slate memakai pointer; promosi memverifikasi store.
  // -------------------------------------------------------------------------
  console.log("\nW. wiring statis jalur saji + promosi");
  const slateSrc = fs.readFileSync(path.join(REPO_ROOT, "scripts", "pick-slate.ts"), "utf8");
  suite.check(
    "wiring: pick-slate tidak lagi membaca file lepas (tidak ada literal \"calibrated_ratings.json\" di kode)",
    !slateSrc.includes('"calibrated_ratings.json"'),
  );
  suite.check(
    "wiring: model saji dimuat (loadServingModel) sebelum pemanggilan publishPicks pertama",
    slateSrc.indexOf("loadServingModel(path.join(process.cwd()") >= 0 &&
      slateSrc.indexOf("loadServingModel(path.join(process.cwd()") < slateSrc.indexOf("publishPicks("),
  );
  const promoteSrc = fs.readFileSync(path.join(REPO_ROOT, "scripts", "promote-model.ts"), "utf8");
  suite.check(
    "wiring: promote-model memverifikasi artefak store (verifyManifestArtifact), bukan file lepas",
    promoteSrc.includes("verifyManifestArtifact") && !promoteSrc.includes("readRatingsRaw"),
  );

  suite.finish();
}

main();
