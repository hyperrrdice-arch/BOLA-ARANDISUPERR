/**
 * BUKTI SIKLUS FIXTURE B2.2a — menjalankan `scripts/free-refresh.ts`
 * ASLI di env sementara dengan sembilan langkahnya diganti stub:
 *   1. siklus SUKSES (stub tidak menghasilkan pick apa pun) → marker
 *      `free_refresh_last_success_utc` bergerak ke cap waktu larian;
 *   2. siklus GAGAL di resolver → exit 1, marker siklus 1 utuh.
 *
 * Keluaran lengkap (log kedua siklus + nilai marker sebelum/sesudah)
 * disimpan sebagai tasks/b2-2/siklus-fixture.txt oleh pemanggil.
 *
 * Pakai: npx tsx tasks/b2-2/siklus-fixture.ts
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  FREE_REFRESH_LAST_SUCCESS_KEY,
  ensurePackagesSchema,
} from "../../lib/picks/packages";

const REPO = path.resolve(__dirname, "..", "..");
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

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bola-b22-siklus-"));
fs.mkdirSync(path.join(root, "data"), { recursive: true });
fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
for (const nama of LANGKAH) {
  fs.writeFileSync(
    path.join(root, "scripts", `${nama}.ts`),
    `console.log("[stub] ${nama} jalan");\n`,
  );
}
fs.symlinkSync(path.join(REPO, "node_modules"), path.join(root, "node_modules"), "dir");

const dbFile = path.join(root, "data", "analysis_snapshots.db");
{
  const db = new DatabaseSync(dbFile);
  ensurePackagesSchema(db);
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(
    FREE_REFRESH_LAST_SUCCESS_KEY,
    "2026-11-20T00:00:00.000Z",
  );
  db.close();
}
const bacaMarker = (): string | null => {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const row = db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get(FREE_REFRESH_LAST_SUCCESS_KEY) as { value: string } | undefined;
    return row?.value ?? null;
  } finally {
    db.close();
  }
};
const jalan = (): { code: number; out: string } => {
  const res = spawnSync(
    path.join(REPO, "node_modules", ".bin", "tsx"),
    [path.join(REPO, "scripts", "free-refresh.ts")],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${path.join(REPO, "node_modules", ".bin")}:${process.env.PATH ?? ""}`,
      },
    },
  );
  return { code: res.status ?? 1, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
};

console.log(`env fixture: ${root}`);
console.log(`marker sebelum : ${bacaMarker()}`);
console.log("\n=== SIKLUS 1: semua langkah sukses, nol pick baru ===");
const s1 = jalan();
console.log(s1.out.trim());
console.log(`exit=${s1.code}`);
console.log(`marker sesudah : ${bacaMarker()}`);

fs.writeFileSync(
  path.join(root, "scripts", "resolve-pick-outcomes.ts"),
  'console.log("[stub] resolver gagal");\nprocess.exit(3);\n',
);
console.log("\n=== SIKLUS 2: resolver gagal (exit 3) ===");
const s2 = jalan();
console.log(s2.out.trim());
console.log(`exit=${s2.code}`);
console.log(`marker sesudah : ${bacaMarker()} (harus sama dengan sesudah siklus 1)`);

fs.rmSync(root, { recursive: true, force: true });
