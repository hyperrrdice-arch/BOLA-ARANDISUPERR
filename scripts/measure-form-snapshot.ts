/**
 * MEASURE FORM SNAPSHOT — potret form terakhir-6 semua tim bernama di
 * data/calibrated_ratings.json lewat jalur saji ASLI
 * (getTeamRollingTelemetry), untuk bukti sebelum/sesudah fase 5 pakem
 * (peralihan saji ke tabel telemetri kanonik).
 *
 * Pakai: npx tsx scripts/measure-form-snapshot.ts <label>
 * Tulis: tasks/form-snapshot-<label>.json
 */
import fs from "node:fs";
import path from "node:path";
import { getTeamRollingTelemetry } from "../lib/db/team-telemetry";

const ROOT = process.cwd();
const label = process.argv[2];
if (!label) {
  console.error("usage: measure-form-snapshot.ts <label>");
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
  const t = getTeamRollingTelemetry(name, 6);
  out.push({
    team: name,
    sample_size: t.sample_size,
    goals_for: t.rolling_goals_for,
    goals_against: t.rolling_goals_against,
    xg_for: t.rolling_xg_for,
    xg_against: t.rolling_xg_against,
    xg_samples: t.observed_xg_samples,
    form: t.form_sequence,
  });
}
const file = path.join(ROOT, `tasks/form-snapshot-${label}.json`);
fs.writeFileSync(file, JSON.stringify({ label, generated_at: new Date().toISOString(), teams: out }, null, 2));
const withData = out.filter((t) => (t.sample_size as number) > 0).length;
console.log(`snapshot '${label}': ${out.length} tim, ${withData} dengan sampel > 0 -> ${file}`);
