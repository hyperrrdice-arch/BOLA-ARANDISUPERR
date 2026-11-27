/**
 * SUITE D05-BUSY — pembukaan koneksi writable saat DB terkunci (brief
 * validasi rilis 2026-11-27 §3).
 *
 * Latar: CI push-main 45892149087 pernah gagal "D05 publikasi paralel"
 * (worker B exit 1) tanpa stderr worker. Hipotesis kuat (stderr lama
 * tidak tersedia, jadi BUKAN kepastian): getPicksDb / getPackagesDb
 * membuka DatabaseSync lalu menjalankan PRAGMA + inisialisasi skema
 * TANPA busy_timeout — bila koneksi lain sedang memegang BEGIN
 * IMMEDIATE, langkah init pertama yang butuh lock tulis gagal seketika
 * dengan "database is locked" (errcode 5).
 *
 * Langkah init yang butuh lock tulis, terverifikasi pada DB temporer:
 *   - file BARU: CREATE TABLE skema (kedua getter);
 *   - file yang belum WAL: konversi `PRAGMA journal_mode = WAL`
 *     (getPackagesDb pada file hasil restore/buatan mentah);
 *   - migrasi aditif / backfill warisan di getPicksDb bila ada baris
 *     yang harus ditulis.
 * Sebaliknya, pada file yang skemanya sudah lengkap dan sudah WAL,
 * semua pernyataan init terdegradasi menjadi baca/no-op dan pembukaan
 * bisa lolos walau ada lock — jadi fixture di sini SENGAJA memakai
 * file DB kosong (belum berskema) supaya jalur tulis init yang
 * sebenarnya teruji, bukan jalan pintas no-op-nya.
 *
 * Perbaikan yang diuji (lib/db/writable-open.ts, dipakai kedua
 * getter): `PRAGMA busy_timeout = 10000` sebagai pernyataan PERTAMA
 * sesudah konstruktor — nilai yang sama dengan yang sudah dipakai
 * publication.ts / tickets.ts pada file yang sama — DITAMBAH retry
 * terbatas pada seluruh urutan buka+init (tiap 250 ms, tenggat total
 * 20 detik). Retry wajib ada karena konversi journal_mode pada file
 * yang belum WAL terbukti MENGABAIKAN busy_timeout dan gagal seketika
 * saat ada lock; busy_timeout menanggung pernyataan init lainnya
 * (CREATE/migrasi/backfill). Lock yang dilepas dalam jendela itu →
 * buka berhasil; lock yang lebih lama → error jelas sesudah tenggat
 * (tidak menggantung, tidak dilewati diam-diam).
 *
 * Semua sinkronisasi antar-proses memakai barrier berkas (ready /
 * release), bukan tebakan tidur: holder menulis readyFile saat lock
 * benar-benar dipegang dan melepas hanya saat releaseFile muncul.
 * Jendela observasi 4 detik pada kasus "dilepas" hanya MEMBUKTIKAN
 * opener masih terblokir (belum keluar) sebelum pelepas ditulis —
 * opener yang benar tidak mungkin selesai sebelum pelepas karena
 * busy_timeout (10 dtk) lebih panjang dari jendela observasi.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  REPO_ROOT,
  Suite,
  createFixtureEnv,
  settleFixtureEnv,
  type FixtureEnv,
} from "./helpers/fixture-env";

const suite = new Suite("D05 sqlite busy_timeout");

interface ChildResult {
  code: number;
  stdout: string;
  stderr: string;
  elapsedMs: number;
}

interface RunningChild {
  child: ChildProcess;
  done: Promise<ChildResult>;
  exited: () => boolean;
}

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, TZ: "UTC" };
  delete env.DB_DIR;
  return env;
}

function spawnHelper(env: FixtureEnv, helperRel: string, args: string[]): RunningChild {
  const tsx = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
  const t0 = Date.now();
  const child = spawn(tsx, [path.join(REPO_ROOT, helperRel), ...args], {
    cwd: env.root,
    env: childEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  let isExited = false;
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const done = new Promise<ChildResult>((resolve) => {
    child.on("close", (code) => {
      isExited = true;
      resolve({ code: code ?? 1, stdout: out, stderr: err, elapsedMs: Date.now() - t0 });
    });
  });
  return { child, done, exited: () => isExited };
}

async function waitForFile(file: string, timeoutMs: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fs.existsSync(file)) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return fs.existsSync(file);
}

function parseOpenerJson(r: ChildResult): Record<string, unknown> | null {
  try {
    return JSON.parse(r.stdout.trim().split("\n").pop() ?? "") as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Env segar per kasus: file DB target BELUM ada sama sekali (holder
 * yang membuatnya sebagai file kosong terkunci), jadi opener wajib
 * menjalankan seluruh init tulis (konversi WAL + CREATE skema).
 */
function freshEnv(label: string): FixtureEnv {
  return createFixtureEnv(label);
}

/** Kasus 1: lock dipegang, lalu dilepas atas sinyal → opener berhasil. */
async function caseReleased(
  label: string,
  dbFile: string,
  which: "picks" | "packages",
): Promise<void> {
  const env = freshEnv(`d05rel-${which}`);
  const readyFile = path.join(env.root, "ready");
  const releaseFile = path.join(env.root, "release");
  const holder = spawnHelper(env, "tests/helpers/lock-holder-signal.ts", [
    path.join(env.dataDir, dbFile),
    readyFile,
    releaseFile,
    "60000",
  ]);
  const held = await waitForFile(readyFile, 30_000);
  suite.check(`${label}: lock penulis lain terpegang (ready file)`, held);
  if (!held) {
    holder.child.kill("SIGKILL");
    await holder.done;
    settleFixtureEnv(env, true);
    return;
  }
  const opener = spawnHelper(env, "tests/helpers/db-opener.ts", [which]);
  // Buktikan opener TERBLOKIR: ia tidak boleh keluar sebelum pelepas
  // ditulis. Jendela observasi 4 dtk < busy_timeout 10 dtk.
  const obs0 = Date.now();
  while (Date.now() - obs0 < 4_000 && !opener.exited()) {
    await new Promise((r) => setTimeout(r, 50));
  }
  suite.check(
    `${label}: opener masih menunggu lock sesudah 4 dtk (tidak gagal seketika)`,
    !opener.exited(),
  );
  fs.writeFileSync(releaseFile, "go");
  const res = await opener.done;
  const holderRes = await holder.done;
  suite.eq(`${label}: holder melepas bersih (exit 0)`, holderRes.code, 0);
  suite.eq(`${label}: opener exit 0 sesudah lock dilepas`, res.code, 0);
  const json = parseOpenerJson(res);
  suite.eq(`${label}: opener ok=true`, json?.ok, true);
  suite.eq(`${label}: journal_mode wal sesudah buka`, json?.journal_mode, "wal");
  settleFixtureEnv(env, suite.failedCount > 0);
}

/** Kasus 2: lock tidak pernah dilepas → error jelas, terbatas, tidak hang. */
async function caseProlonged(
  label: string,
  dbFile: string,
  which: "picks" | "packages",
): Promise<void> {
  const env = freshEnv(`d05long-${which}`);
  const readyFile = path.join(env.root, "ready");
  const releaseFile = path.join(env.root, "release");
  const holder = spawnHelper(env, "tests/helpers/lock-holder-signal.ts", [
    path.join(env.dataDir, dbFile),
    readyFile,
    releaseFile,
    "120000",
  ]);
  const held = await waitForFile(readyFile, 30_000);
  suite.check(`${label} (lock panjang): lock terpegang`, held);
  if (!held) {
    holder.child.kill("SIGKILL");
    await holder.done;
    settleFixtureEnv(env, true);
    return;
  }
  const opener = spawnHelper(env, "tests/helpers/db-opener.ts", [which]);
  const res = await opener.done;
  const json = parseOpenerJson(res);
  suite.check(`${label} (lock panjang): opener gagal (exit != 0)`, res.code !== 0, `code=${res.code}`);
  suite.eq(`${label} (lock panjang): ok=false`, json?.ok, false);
  suite.eq(`${label} (lock panjang): errcode 5 (SQLITE_BUSY)`, json?.errcode, 5);
  suite.check(
    `${label} (lock panjang): pesan jelas 'database is locked'`,
    String(json?.message ?? "").includes("database is locked"),
    String(json?.message ?? res.stderr),
  );
  suite.check(
    `${label} (lock panjang): benar-benar menunggu busy_timeout (>= 8 dtk)`,
    res.elapsedMs >= 8_000,
    `${res.elapsedMs}ms`,
  );
  suite.check(
    `${label} (lock panjang): terbatas, tidak menggantung (< 45 dtk)`,
    res.elapsedMs < 45_000,
    `${res.elapsedMs}ms`,
  );
  holder.child.kill("SIGKILL");
  await holder.done;
  settleFixtureEnv(env, suite.failedCount > 0);
}

async function main(): Promise<void> {
  console.log("\n— D05-BUSY: buka file baru saat terkunci, lock dilepas atas sinyal —");
  await caseReleased("picks.db", "picks.db", "picks");
  await caseReleased("analysis_snapshots.db", "analysis_snapshots.db", "packages");

  console.log("\n— D05-BUSY: lock berkepanjangan → error jelas terbatas —");
  await caseProlonged("picks.db", "picks.db", "picks");
  await caseProlonged("analysis_snapshots.db", "analysis_snapshots.db", "packages");

  suite.finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
