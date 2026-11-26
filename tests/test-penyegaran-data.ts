/**
 * SUITE PENYEGARAN DATA (B2.2a) — marker refresh sukses terakhir.
 *
 * Yang diverifikasi (kriteria brief B2.2):
 *  - SIKLUS ASLI: `scripts/free-refresh.ts` yang sebenarnya dijalankan
 *    di env fixture dengan sembilan langkahnya diganti stub di
 *    `<env>/scripts/` (npx/tsx menyelesaikan stub dari cwd fixture;
 *    node_modules env adalah symlink ke node_modules repo). Stub tidak
 *    menghasilkan pick apa pun — larian sukses NOL pick baru tetap
 *    menggeser marker, dan marker tertulis SESUDAH baris log resolver
 *    sukses, SEBELUM checkpoint WAL.
 *  - Langkah data gagal (resolver, lalu impor) → exit non-nol dan
 *    marker sukses lama tetap utuh + tetap terbaca pembaca web.
 *  - Penulis marker monoton: cap yang lebih lama dari yang tersimpan
 *    tidak memundurkan marker (larian lama berakhir belakangan).
 *  - Pembaca render (`ambilWaktuRefreshTerakhir`): marker sah terbaca;
 *    hilang / rusak / di masa depan → null ("Waktu pembaruan belum
 *    tersedia"); DB tanpa tabel meta dan DB absen → null.
 *  - Salinan restore (VACUUM INTO, pola uji backup): marker yang sama
 *    terbaca dari generasi salinan tersebut.
 *
 * Suite terdaftar di test:data — penulis marker + rantai refresh hidup
 * di lapisan data/skrip (pola yang sama dengan test-wal-checkpoint).
 *
 * Pakai: npm run test:data (atau langsung: npx tsx tests/test-penyegaran-data.ts)
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  REPO_ROOT,
  Suite,
  createFixtureEnv,
  runScript,
  settleFixtureEnv,
  type FixtureEnv,
  type RunResult,
} from "./helpers/fixture-env";
import {
  FREE_REFRESH_LAST_SUCCESS_KEY,
  ensurePackagesSchema,
} from "../lib/picks/packages";

const suite = new Suite("penyegaran-data (B2.2a)");

const LANGKAH = [
  "import-free-feed",
  "build-team-canonical",
  "build-fixture-links",
  "calibrate-ratings",
  "fit-global-offsets",
  "build-canonical-telemetry",
  "pick-slate",
  "resolve-pick-outcomes",
  "wal-checkpoint",
];

/** Env fixture yang bisa menjalankan free-refresh asli dengan stub. */
function buatEnvStub(label: string, markerAwal: string | null): FixtureEnv {
  const env = createFixtureEnv(label);
  const scriptsDir = path.join(env.root, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const nama of LANGKAH) {
    fs.writeFileSync(
      path.join(scriptsDir, `${nama}.ts`),
      `console.log("[stub] ${nama} jalan");\n`,
    );
  }
  fs.symlinkSync(
    path.join(REPO_ROOT, "node_modules"),
    path.join(env.root, "node_modules"),
    "dir",
  );
  const db = new DatabaseSync(path.join(env.dataDir, "analysis_snapshots.db"));
  ensurePackagesSchema(db);
  if (markerAwal !== null) {
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(
      FREE_REFRESH_LAST_SUCCESS_KEY,
      markerAwal,
    );
  }
  db.close();
  return env;
}

function tulisStub(env: FixtureEnv, nama: string, isi: string): void {
  fs.writeFileSync(path.join(env.root, "scripts", `${nama}.ts`), isi);
}

function jalanRefresh(env: FixtureEnv): RunResult {
  return runScript(env, "scripts/free-refresh.ts", [], {
    PATH: `${path.join(REPO_ROOT, "node_modules", ".bin")}:${process.env.PATH ?? ""}`,
  });
}

function bacaMarkerMentah(env: FixtureEnv): string | null {
  const db = new DatabaseSync(path.join(env.dataDir, "analysis_snapshots.db"), {
    readOnly: true,
  });
  try {
    const row = db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get(FREE_REFRESH_LAST_SUCCESS_KEY) as { value: string } | undefined;
    return row?.value ?? null;
  } finally {
    db.close();
  }
}

function probeReader(env: FixtureEnv, nowUtc: string): string | null {
  const res = runScript(env, "tests/helpers/b22-reader-probe.ts", [nowUtc]);
  const line = res.stdout.split("\n").find((l) => l.startsWith("PROBE_JSON "));
  if (!line) {
    throw new Error(
      `b22-reader-probe tidak menghasilkan PROBE_JSON (exit=${res.code}): ${res.stdout} ${res.stderr}`,
    );
  }
  return (JSON.parse(line.slice("PROBE_JSON ".length)) as { marker: string | null }).marker;
}

function probeWriter(
  env: FixtureEnv,
  cap: string,
): { bergerak: boolean; tersimpan: string | null } {
  const res = runScript(env, "tests/helpers/b22-marker-probe.ts", [cap]);
  const line = res.stdout.split("\n").find((l) => l.startsWith("PROBE_JSON "));
  if (!line) {
    throw new Error(
      `b22-marker-probe tidak menghasilkan PROBE_JSON (exit=${res.code}): ${res.stdout} ${res.stderr}`,
    );
  }
  return JSON.parse(line.slice("PROBE_JSON ".length)) as {
    bergerak: boolean;
    tersimpan: string | null;
  };
}

async function main(): Promise<void> {
  /* ------------------------------------------- siklus sukses nol pick */
  const MARKER_LAMA = "2026-11-20T00:00:00.000Z";
  const env = buatEnvStub("penyegaran-siklus", MARKER_LAMA);
  const t0 = new Date().toISOString();
  const sukses = jalanRefresh(env);
  const t1 = new Date().toISOString();
  suite.eq("siklus sukses: exit 0", sukses.code, 0);
  const markerBaru = bacaMarkerMentah(env);
  suite.check(
    "siklus sukses: marker bergerak dari nilai lama",
    markerBaru !== null && markerBaru > MARKER_LAMA,
    `marker=${markerBaru}`,
  );
  suite.check(
    "siklus sukses: marker = cap waktu larian ini (bukan jam lain)",
    markerBaru !== null && markerBaru >= t0 && markerBaru <= t1,
    `marker=${markerBaru} jendela=${t0}..${t1}`,
  );
  const iResolver = sukses.stdout.indexOf("resolve-pick-outcomes: exit=0");
  const iMarker = sukses.stdout.indexOf("marker refresh sukses:");
  const iWal = sukses.stdout.indexOf("wal-checkpoint: exit=0");
  suite.check(
    "siklus sukses: urutan log resolver → marker → checkpoint WAL",
    iResolver >= 0 && iMarker > iResolver && iWal > iMarker,
    `resolver=${iResolver} marker=${iMarker} wal=${iWal}`,
  );
  suite.check(
    "siklus sukses: ringkasan SELESAI tanpa kegagalan",
    sukses.stdout.includes("SELESAI: semua langkah sukses"),
  );

  /* --------------------------------------- langkah data gagal: resolver */
  tulisStub(
    env,
    "resolve-pick-outcomes",
    'console.log("[stub] resolver gagal");\nprocess.exit(3);\n',
  );
  const gagalResolver = jalanRefresh(env);
  suite.eq("resolver gagal: exit non-nol", gagalResolver.code, 1);
  suite.eq(
    "resolver gagal: marker sukses lama utuh",
    bacaMarkerMentah(env),
    markerBaru,
  );
  suite.eq(
    "resolver gagal: marker lama tetap terbaca pembaca web",
    probeReader(env, new Date(Date.now() + 3_600_000).toISOString()),
    markerBaru,
  );

  /* ------------------------------------------ langkah data gagal: impor */
  tulisStub(env, "resolve-pick-outcomes", 'console.log("[stub] resolver jalan");\n');
  tulisStub(
    env,
    "import-free-feed",
    'console.log("[stub] impor gagal");\nprocess.exit(2);\n',
  );
  const gagalImpor = jalanRefresh(env);
  suite.eq("impor gagal: exit non-nol", gagalImpor.code, 1);
  suite.eq("impor gagal: marker sukses lama utuh", bacaMarkerMentah(env), markerBaru);
  settleFixtureEnv(env, suite.failedCount > 0);

  /* ---------------------------------------------------------- monoton */
  const envMono = buatEnvStub("penyegaran-monoton", "2026-11-26T10:00:00.000Z");
  const mundur = probeWriter(envMono, "2026-11-26T09:00:00.000Z");
  suite.eq("monoton: cap lebih lama ditolak (bergerak=false)", mundur.bergerak, false);
  suite.eq(
    "monoton: nilai tersimpan tidak mundur",
    mundur.tersimpan,
    "2026-11-26T10:00:00.000Z",
  );
  const maju = probeWriter(envMono, "2026-11-26T11:00:00.000Z");
  suite.eq("monoton: cap lebih baru diterima", maju.bergerak, true);
  suite.eq("monoton: nilai tersimpan maju", maju.tersimpan, "2026-11-26T11:00:00.000Z");
  const sama = probeWriter(envMono, "2026-11-26T11:00:00.000Z");
  suite.eq("monoton: cap sama = tetap tertulis (idempoten)", sama.bergerak, true);
  settleFixtureEnv(envMono, suite.failedCount > 0);

  /* ------------------------------------------------- pembaca: fallback */
  const NOW = "2026-11-26T12:00:00.000Z";
  const envBaca = buatEnvStub("penyegaran-baca", "2026-11-26T09:47:00.000Z");
  suite.eq(
    "pembaca: marker sah terbaca apa adanya",
    probeReader(envBaca, NOW),
    "2026-11-26T09:47:00.000Z",
  );
  const dbBaca = new DatabaseSync(path.join(envBaca.dataDir, "analysis_snapshots.db"));
  dbBaca
    .prepare("UPDATE meta SET value = ? WHERE key = ?")
    .run("bukan-tanggal-sama-sekali", FREE_REFRESH_LAST_SUCCESS_KEY);
  suite.eq("pembaca: marker rusak → null", probeReader(envBaca, NOW), null);
  dbBaca
    .prepare("UPDATE meta SET value = ? WHERE key = ?")
    .run("2026-11-26T14:00:00.000Z", FREE_REFRESH_LAST_SUCCESS_KEY);
  suite.eq(
    "pembaca: marker di masa depan terhadap jam baca → null",
    probeReader(envBaca, NOW),
    null,
  );
  suite.eq(
    "pembaca: marker yang sama sah begitu jam baca melewatinya",
    probeReader(envBaca, "2026-11-26T15:00:00.000Z"),
    "2026-11-26T14:00:00.000Z",
  );
  dbBaca.prepare("DELETE FROM meta WHERE key = ?").run(FREE_REFRESH_LAST_SUCCESS_KEY);
  suite.eq("pembaca: key hilang → null", probeReader(envBaca, NOW), null);
  dbBaca.close();
  // envBaca belum di-settle: masih jadi sumber salinan restore di bawah.

  const envPolos = createFixtureEnv("penyegaran-polos");
  const dbPolos = new DatabaseSync(path.join(envPolos.dataDir, "analysis_snapshots.db"));
  dbPolos.close();
  suite.eq(
    "pembaca: DB ada tanpa tabel meta → null",
    probeReader(envPolos, NOW),
    null,
  );
  settleFixtureEnv(envPolos, suite.failedCount > 0);

  const envNihil = createFixtureEnv("penyegaran-nihil");
  suite.eq("pembaca: DB absen → null", probeReader(envNihil, NOW), null);
  settleFixtureEnv(envNihil, suite.failedCount > 0);

  /* ------------------------------------------- salinan restore (backup) */
  const envRestore = createFixtureEnv("penyegaran-restore");
  {
    // Kembalikan marker sah pada sumber, lalu salin sebagai "backup".
    const tulis = new DatabaseSync(path.join(envBaca.dataDir, "analysis_snapshots.db"));
    tulis
      .prepare(
        `INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(FREE_REFRESH_LAST_SUCCESS_KEY, "2026-11-26T09:47:00.000Z");
    tulis.close();
    const salin = new DatabaseSync(path.join(envBaca.dataDir, "analysis_snapshots.db"), {
      readOnly: true,
    });
    const dst = path.join(envRestore.dataDir, "analysis_snapshots.db");
    salin.exec(`VACUUM INTO '${dst.replace(/'/g, "''")}'`);
    salin.close();
  }
  suite.eq(
    "restore: marker yang sama terbaca dari salinan backup",
    probeReader(envRestore, NOW),
    "2026-11-26T09:47:00.000Z",
  );
  settleFixtureEnv(envRestore, suite.failedCount > 0);
  settleFixtureEnv(envBaca, suite.failedCount > 0);

  suite.finish();
}

main().catch((e) => {
  console.error("GAGAL BESAR:", e);
  process.exit(1);
});
