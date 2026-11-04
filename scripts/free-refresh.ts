/**
 * FREE REFRESH — ritme mode bebas (pengganti jalur Sportmonks setelah
 * langganan dibatalkan 9 Nov 2026). Tanpa token apa pun:
 *   1. import-free-feed.ts  — hasil + odds closing + telemetri fd +
 *      fixture + odds pra-laga dari football-data.co.uk
 *   2. calibrate-ratings.ts — refit rating dari store lokal (offline)
 *   3. pick-slate.ts --hours=72 — slate pick dari store lokal (offline)
 *
 * Setiap langkah spawnSync npx tsx dengan stdio inherit; ringkasan satu
 * baris per langkah (nama + exit code + durasi); exit non-nol bila ada
 * langkah yang gagal (rantai berhenti di langkah itu).
 *
 * Pakai: npx tsx scripts/free-refresh.ts
 */
import { spawnSync } from "node:child_process";

interface Step {
  name: string;
  script: string;
  scriptArgs: string[];
}

const STEPS: Step[] = [
  { name: "import-free-feed", script: "scripts/import-free-feed.ts", scriptArgs: [] },
  { name: "calibrate-ratings", script: "scripts/calibrate-ratings.ts", scriptArgs: [] },
  // pick-slate mem-parse "--hours <n>" (bentuk spasi), bukan "--hours=<n>".
  { name: "pick-slate", script: "scripts/pick-slate.ts", scriptArgs: ["--hours", "72"] },
];

function main() {
  let failed: string | null = null;
  for (const step of STEPS) {
    const t0 = Date.now();
    const res = spawnSync("npx", ["tsx", step.script, ...step.scriptArgs], {
      stdio: "inherit",
      env: process.env,
      cwd: process.cwd(),
    });
    const durS = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[free-refresh] ${step.name}: exit=${res.status ?? "null"} durasi=${durS}s`);
    if (res.status !== 0) {
      failed = step.name;
      break;
    }
  }
  if (failed) {
    console.log(`[free-refresh] SELESAI DENGAN KEGAGALAN di langkah ${failed}.`);
    process.exit(1);
  }
  console.log("[free-refresh] SELESAI: semua langkah sukses (mode bebas, tanpa Sportmonks).");
}

main();
