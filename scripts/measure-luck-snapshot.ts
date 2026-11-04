/**
 * MEASURE LUCK SNAPSHOT — potret metrik keberuntungan/regresi xG semua
 * tim bernama di data/calibrated_ratings.json lewat fungsi ASLI
 * calculateTeamLuckMetrics, untuk bukti sebelum/sesudah peralihan
 * luck-regression ke telemetri kanonik (tindak lanjut audit pakem).
 *
 * Pakai: npx tsx scripts/measure-luck-snapshot.ts <label>
 * Tulis: tasks/luck-snapshot-<label>.json
 */
import fs from "node:fs";
import path from "node:path";
import { calculateTeamLuckMetrics } from "../lib/quant/luck-regression";

const ROOT = process.cwd();
const label = process.argv[2];
if (!label) {
  console.error("usage: measure-luck-snapshot.ts <label>");
  process.exit(1);
}

const ratings = JSON.parse(fs.readFileSync(path.join(ROOT, "data/calibrated_ratings.json"), "utf8")) as {
  leagues: Record<string, { teams?: Record<string, unknown> }>;
};
const names = new Set<string>();
for (const lg of Object.values(ratings.leagues)) {
  for (const n of Object.keys(lg.teams ?? {})) names.add(n);
}

const out: Record<string, unknown>[] = [];
for (const name of [...names].sort()) {
  const m = calculateTeamLuckMetrics(name, 6);
  out.push({
    team: name,
    sample_size: m.sample_size,
    goals_for: m.total_goals_for,
    xg_for: m.total_xg_for,
    finishing_luck: m.finishing_luck_per_match,
    goals_against: m.total_goals_against,
    xg_against: m.total_xg_against,
    defensive_luck: m.defensive_luck_per_match,
    net_luck: m.net_luck_rating,
    status: m.status,
  });
}
const file = path.join(ROOT, `tasks/luck-snapshot-${label}.json`);
fs.writeFileSync(file, JSON.stringify({ label, generated_at: new Date().toISOString(), teams: out }, null, 2));
const withData = out.filter((t) => t.status !== "INSUFFICIENT_DATA").length;
console.log(`luck snapshot '${label}': ${out.length} tim, ${withData} dengan metrik xG -> ${file}`);
