/**
 * FIXTURE ENV — helper pengujian K0 (bab QA, kartu K0).
 *
 * Setiap suite berjalan di direktori sandbox unik di os.tmpdir():
 *   <root>/data/     — DB + registry fixture (BUKAN data produksi)
 *   <root>/tasks/    — artefak keluaran skrip (mis. laporan unmatched)
 *   <root>/fd-csv/   — CSV football-data lokal (FOOTBALL_DATA_CSV_DIR)
 *
 * Skema DB dibangun dengan kode repo sebenarnya (getter di lib/db/* dan
 * lib/picks/* yang memang membuat skemanya sendiri saat pertama dibuka),
 * dibuka SETELAH process.chdir() ke sandbox — semua modul repo membaca
 * path data relatif terhadap process.cwd().
 *
 * Produser (importer, builder alias, resolver) dijalankan sebagai
 * subprocess dengan cwd = sandbox, jadi tidak ada state modul yang bocor
 * antar-suite dan checkout kerja tidak pernah tersentuh.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dbPath } from "../../lib/db/paths";

/** Root worktree — ditangkap saat proses suite mulai (npm run dari root). */
export const REPO_ROOT = process.cwd();

/**
 * Jam "asli" fiktif yang DIBEKUKAN untuk fixture Beranda PR 1B: pembaca
 * `listFinished` (lib/web/data.ts) memakai `Date.now()` proses, bukan jam
 * beku probe, jadi laga selesai fixture harus relatif terhadap satu jam
 * asli yang sama di seed dan di probe. beranda-seed menanam kickoff laga
 * selesai relatif terhadap nilai ini; beranda-probe menambatkan
 * `Date.now()` prosesnya ke nilai ini juga. Tanpa tambatan ini fixture
 * bergeser mengikuti jam dinding mesin dan assertion jendela beku
 * berubah makna seiring waktu (bom waktu B0.1: laga F menyusup ke
 * jadwal NOW_T begitu jam asli melewati 25 Nov 07:00 UTC).
 * Nilai dipilih di dalam jendela penulisan fixture: cukup sesudah
 * kickoff laga F (nilai ini − 26 jam) untuk jendela listFinished
 * [−720 jam, −3 jam], tetapi sebelum kickoff laga T (24 Nov 06:00 UTC)
 * + 3 jam agar laga T tidak ikut masuk jendela selesai.
 */
export const BERANDA_JAM_ASLI = "2026-11-24T08:00:00.000Z";

export interface FixtureEnv {
  label: string;
  root: string;
  dataDir: string;
  tasksDir: string;
  csvDir: string;
}

export function createFixtureEnv(label: string): FixtureEnv {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `bola-k0-${label}-`));
  const dataDir = path.join(root, "data");
  const tasksDir = path.join(root, "tasks");
  const csvDir = path.join(root, "fd-csv");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(csvDir, { recursive: true });
  return { label, root, dataDir, tasksDir, csvDir };
}

/** Hapus sandbox bila suite lulus; pertahankan (dan cetak path) bila gagal. */
export function settleFixtureEnv(env: FixtureEnv, failed: boolean): void {
  if (failed || process.env.K0_FIXTURE_KEEP === "1") {
    console.log(`[fixture] sandbox dipertahankan untuk inspeksi: ${env.root}`);
    return;
  }
  fs.rmSync(env.root, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Kerangka assertion mini — exit code adalah kontraknya, bukan sekadar print.
// ---------------------------------------------------------------------------

export class Suite {
  private passed = 0;
  private failed = 0;
  private readonly failures: string[] = [];

  constructor(private readonly name: string) {}

  check(name: string, cond: boolean, detail = ""): void {
    if (cond) {
      this.passed++;
      console.log(`  OK  ${name}`);
    } else {
      this.failed++;
      this.failures.push(name);
      console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    }
  }

  eq(name: string, actual: unknown, expected: unknown): void {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    this.check(name, a === e, `aktual=${a} harapan=${e}`);
  }

  get failedCount(): number {
    return this.failed;
  }

  get passedCount(): number {
    return this.passed;
  }

  finish(): never {
    const total = this.passed + this.failed;
    console.log(
      `\n[${this.name}] ${this.passed}/${total} assertion lolos` +
        (this.failed ? ` — GAGAL: ${this.failures.join("; ")}` : ""),
    );
    process.exit(this.failed === 0 ? 0 : 1);
  }
}

// ---------------------------------------------------------------------------
// Subprocess produser/suite lain dengan cwd = sandbox.
// ---------------------------------------------------------------------------

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runScript(
  env: FixtureEnv,
  scriptRel: string,
  args: string[] = [],
  extraEnv: Record<string, string> = {},
): RunResult {
  const tsx = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
  const res = spawnSync(tsx, [path.join(REPO_ROOT, scriptRel), ...args], {
    cwd: env.root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      TZ: "UTC",
      FOOTBALL_DATA_CSV_DIR: env.csvDir,
      ...extraEnv,
    },
  });
  return {
    code: res.status ?? 1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

/** Buka file DB sandbox secara read-only (koneksi baru, bukan handle repo). */
export function openRo(env: FixtureEnv, file: string): DatabaseSync {
  return new DatabaseSync(path.join(env.dataDir, file), { readOnly: true });
}

// ---------------------------------------------------------------------------
// Pembangunan skema dengan kode repo + seed mentah.
// Wajib dipanggil SETELAH process.chdir(env.root).
// ---------------------------------------------------------------------------

export interface CoreModules {
  ledger: typeof import("../../lib/picks/ledger");
}

export async function buildCoreSchemas(): Promise<CoreModules> {
  const dataset = await import("../../lib/db/thestats-dataset");
  const dsDb = dataset.getTheStatsDb();
  // Migrasi aditif yang sama seperti yang dijalankan scripts/capture-odds.ts
  // di produksi (PRD §5.4): skema dasar match_odds_history di
  // thestats-dataset.ts belum memuat source/capture_kind, tetapi importer
  // feed gratis mengasumsikan keduanya ada — DB produksi memilikinya karena
  // migrasi ini pernah berjalan di sana. Fixture meniru keadaan itu persis.
  {
    const cols = dsDb.prepare("PRAGMA table_info(match_odds_history)").all() as {
      name: string;
    }[];
    const names = new Set(cols.map((c) => c.name));
    if (!names.has("source")) {
      dsDb.exec("ALTER TABLE match_odds_history ADD COLUMN source TEXT");
    }
    if (!names.has("capture_kind")) {
      dsDb.exec("ALTER TABLE match_odds_history ADD COLUMN capture_kind TEXT");
    }
    dsDb.exec(
      "CREATE INDEX IF NOT EXISTS idx_moh_match_captured ON match_odds_history(match_id, captured_utc)",
    );
  }
  const upcoming = await import("../../lib/db/upcoming-fixtures");
  const upDb = upcoming.getUpcomingDb();
  // sm_id_map tidak dibuat modul mana pun di repo saat ini; bentuk kolomnya
  // meniru persis INSERT di scripts/sync-sportmonks-fixtures.ts (pemilik
  // tulis tabel ini). Resolver membaca tabel ini — tanpa tabelnya resolver
  // crash, jadi fixture wajib menyediakannya seperti produksi.
  upDb.exec(`
    CREATE TABLE IF NOT EXISTS sm_id_map (
      match_id TEXT PRIMARY KEY,
      sm_fixture_id INTEGER NOT NULL,
      home_norm TEXT,
      away_norm TEXT,
      kickoff_date TEXT,
      league TEXT,
      created_utc TEXT
    );
  `);
  const packages = await import("../../lib/picks/packages");
  const snapDb = new DatabaseSync(
    dbPath("analysis_snapshots.db"),
  );
  packages.ensurePackagesSchema(snapDb);
  snapDb.close();
  const ledger = await import("../../lib/picks/ledger");
  ledger.getPicksDb();
  return { ledger };
}

export interface FixtureTeam {
  team_id: string;
  name: string;
  country?: string;
}

/** Seed baris teams di dataset fixture (koneksi mentah ke file sandbox). */
export function seedDatasetTeams(env: FixtureEnv, teams: FixtureTeam[]): void {
  const db = new DatabaseSync(path.join(env.dataDir, "thestats_dataset.db"));
  const ins = db.prepare(
    "INSERT OR IGNORE INTO teams (team_id, name, short_name, country, stadium, updated_at) VALUES (?, ?, NULL, ?, NULL, ?)",
  );
  for (const t of teams) {
    ins.run(t.team_id, t.name, t.country ?? "England", "2026-11-18T00:00:00.000Z");
  }
  db.close();
}

/** Registry tim kanonik fixture — bentuk file sama seperti data produksi. */
export function writeTeamRegistry(env: FixtureEnv, teams: FixtureTeam[]): void {
  const file = {
    version: 1,
    generated_at: "2026-11-18T00:00:00.000Z",
    generator: "tests/helpers/fixture-env.ts (K0 fixture)",
    teams: teams.map((t) => ({
      canonical_id: t.team_id,
      name: t.name,
      members: [{ team_id: t.team_id }],
      aliases: [] as string[],
    })),
  };
  fs.writeFileSync(
    path.join(env.dataDir, "team-canonical.json"),
    JSON.stringify(file, null, 2),
  );
}

/** Tulis file CSV fixture ke direktori sumber lokal (rel terhadap csvDir). */
export function writeCsv(env: FixtureEnv, rel: string, content: string): void {
  const p = path.join(env.csvDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
