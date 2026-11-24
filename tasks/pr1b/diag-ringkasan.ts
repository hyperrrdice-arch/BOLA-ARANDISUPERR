// Diagnostik komponen ambilRingkasanRekam (cwd = worktree pr1b).
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { cohortStats } from "../../lib/picks/cohort";
import { parseFilterRekam, ambilRingkasanRekam } from "../../lib/web/rekam";

const nowIso = new Date().toISOString();
function t(label: string, fn: () => unknown, reps = 5) {
  const ts: number[] = [];
  for (let i = 0; i < reps; i++) {
    const a = performance.now();
    fn();
    ts.push(performance.now() - a);
  }
  ts.sort((a, b) => a - b);
  console.log(label, "cold", ts[0].toFixed(1), "median", ts[Math.floor(ts.length / 2)].toFixed(1));
}

t("cohortStats(default) saja", () =>
  cohortStats({ now_utc: nowIso, filter: { source: "live-run" } }),
);
t("ambilRingkasanRekam penuh", () =>
  ambilRingkasanRekam(parseFilterRekam({}), nowIso),
);

// Kueri mentah di atas salinan staging yang sama.
const db = new DatabaseSync("data/picks.db", { readOnly: true });
t("kueri pending (sempit)", () =>
  db
    .prepare(
      `SELECT p.id, p.match_id FROM picks p
       LEFT JOIN pick_outcomes o ON o.pick_id = p.id
       LEFT JOIN pick_voids v ON v.pick_id = p.id
       WHERE p.source = ? AND o.hit IS NULL AND v.pick_id IS NULL`,
    )
    .all("live-run"),
);
t("kueri settled (sempit)", () =>
  db
    .prepare(
      `SELECT p.match_id, p.fixture_uid FROM picks p
       LEFT JOIN pick_outcomes o ON o.pick_id = p.id
       LEFT JOIN pick_voids v ON v.pick_id = p.id
       WHERE p.source = ? AND o.hit IN (0, 1) AND v.pick_id IS NULL`,
    )
    .all("live-run"),
);
console.log(
  "plan pending:",
  JSON.stringify(
    db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT p.id, p.match_id FROM picks p
         LEFT JOIN pick_outcomes o ON o.pick_id = p.id
         LEFT JOIN pick_voids v ON v.pick_id = p.id
         WHERE p.source = ? AND o.hit IS NULL AND v.pick_id IS NULL`,
      )
      .all("live-run"),
  ),
);
