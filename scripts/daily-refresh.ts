/**
 * RITME HARIAN (BLOK G) — satu entrypoint menjalankan seluruh rantai segar:
 *   1. katalog (horizon bergulir 60 hari)
 *   2. tangkapan odds yang jatuh tempo (baseline fixture baru + titik jadwal)
 *   3. predictions (probabilities + value bets + predictability)
 *   4. telemetri musim berjalan (hasil + statistik laga selesai terbaru)
 *   5. kalibrasi rating (refit dari store hasil; tanpa API)
 *   6. konteks (standings, berita, lineup, H2H ≤7 hari)
 *   7. laporan cakupan → tasks/coverage-latest.md
 * Semua langkah idempoten: menjalankan dua kali berturut tidak mengubah
 * jumlah baris (hanya fetched_utc/captured_utc yang bergerak).
 *
 * Pakai: SPORTMONKS_API_TOKEN=... npx tsx scripts/daily-refresh.ts [--skip=odds,context]
 */
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

const args = process.argv.slice(2);
const skip = new Set(
  (args.find((a) => a.startsWith("--skip="))?.split("=")[1] ?? "").split(",").filter(Boolean),
);

function run(label: string, script: string, scriptArgs: string[] = []) {
  if (skip.has(label)) {
    console.log(`\n=== ${label}: dilewati (--skip) ===`);
    return;
  }
  console.log(`\n=== ${label}: ${script} ${scriptArgs.join(" ")} ===`);
  const res = spawnSync("npx", ["tsx", `scripts/${script}`, ...scriptArgs], {
    stdio: "inherit",
    env: process.env,
    cwd: process.cwd(),
  });
  if (res.status !== 0) {
    console.error(`Langkah ${label} gagal (exit ${res.status}) — rantai dihentikan.`);
    process.exit(res.status ?? 1);
  }
}

function coverageReport(): string {
  const now = new Date();
  const in7d = new Date(now.getTime() + 7 * 86400_000).toISOString();
  const lines: string[] = [];
  lines.push(`# Laporan Cakupan Harian — ${now.toISOString()}`);
  lines.push("");
  const up = new DatabaseSync(path.join(process.cwd(), "data", "upcoming_fixtures.db"), { readOnly: true });
  const ds = new DatabaseSync(path.join(process.cwd(), "data", "thestats_dataset.db"), { readOnly: true });
  const one = (db: DatabaseSync, sql: string, ...p: unknown[]) =>
    (db.prepare(sql).get(...(p as never[])) as { v: number }).v;

  const smFixtures = one(up, "SELECT COUNT(*) AS v FROM upcoming_fixtures WHERE match_id LIKE 'sm_%'");
  const horizon = (up.prepare("SELECT MAX(utc_date) AS v FROM upcoming_fixtures WHERE match_id LIKE 'sm_%'").get() as { v: string }).v;
  const fixtures7d = one(
    up,
    "SELECT COUNT(*) AS v FROM upcoming_fixtures WHERE match_id LIKE 'sm_%' AND utc_date >= ? AND utc_date <= ?",
    now.toISOString(), in7d,
  );
  lines.push(`- Katalog: ${smFixtures} fixture SM, horizon s.d. ${horizon}; ${fixtures7d} fixture dalam 7 hari.`);

  const oddsRows = one(ds, "SELECT COUNT(*) AS v FROM match_odds_history WHERE source = 'sportmonks'");
  const oddsFixtures = one(ds, "SELECT COUNT(DISTINCT match_id) AS v FROM match_odds_history WHERE source = 'sportmonks'");
  lines.push(`- Odds: ${oddsRows} tangkapan Sportmonks atas ${oddsFixtures} fixture unik.`);

  let predLine = "- Predictions: DB belum ada.";
  const predPath = path.join(process.cwd(), "data", "predictions.db");
  if (fs.existsSync(predPath)) {
    const pd = new DatabaseSync(predPath, { readOnly: true });
    const pFix = one(pd, "SELECT COUNT(DISTINCT fixture_sm_id) AS v FROM sm_predictions");
    const pLeagues = one(pd, "SELECT COUNT(DISTINCT league_id) AS v FROM sm_predictability");
    predLine = `- Predictions: ${pFix} fixture ber-probability; predictability ${pLeagues} liga.`;
  }
  lines.push(predLine);

  const maxTele = (ds.prepare("SELECT MAX(match_date) AS v FROM team_match_logs WHERE source = 'sportmonks'").get() as { v: string }).v;
  const teleRows = one(ds, "SELECT COUNT(*) AS v FROM team_match_logs WHERE source = 'sportmonks'");
  lines.push(`- Telemetri Sportmonks: ${teleRows} baris, tanggal maks ${maxTele}.`);

  try {
    const reg = ds.prepare("SELECT status, COUNT(*) AS n FROM league_calibration GROUP BY status").all() as { status: string; n: number }[];
    lines.push(`- Registry kalibrasi: ${reg.map((r) => `${r.status}=${r.n}`).join(", ")}.`);
  } catch {
    lines.push("- Registry kalibrasi: belum dibuat.");
  }
  try {
    const st = one(ds, "SELECT COUNT(DISTINCT league_id) AS v FROM standings");
    const nw = one(ds, "SELECT COUNT(*) AS v FROM prematch_news");
    const lu = one(ds, "SELECT COUNT(DISTINCT fixture_sm_id) AS v FROM expected_lineups");
    const hh = one(ds, "SELECT COUNT(*) AS v FROM h2h_cache");
    lines.push(`- Konteks: standings ${st} liga, berita ${nw} fixture, lineup ${lu} fixture, H2H ${hh} pasangan.`);
  } catch {
    lines.push("- Konteks: tabel belum dibuat.");
  }
  return lines.join("\n") + "\n";
}

function main() {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const to = new Date(today.getTime() + 59 * 86400_000);
  run("catalog", "sync-sportmonks-fixtures.ts", [`--from=${fmt(today)}`, `--to=${fmt(to)}`]);
  run("odds", "capture-odds.ts");
  run("predictions", "sync-predictions.ts", ["--days=14"]);
  run("telemetry", "backfill-telemetry.ts", ["--current-only"]);
  run("calibrate", "calibrate-ratings.ts");
  run("context", "sync-context.ts");
  const report = coverageReport();
  const out = path.join(process.cwd(), "tasks", "coverage-latest.md");
  fs.writeFileSync(out, report);
  console.log("\n" + report);
  console.log(`Laporan ditulis ke ${out}`);
}

main();
