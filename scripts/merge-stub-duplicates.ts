/**
 * Audit (+ opsional apply) penggabungan stub tm_master_* ke entitas tm_* asli.
 *
 * Default = DRY-RUN audit: petakan tiap stub via normalizeTeamName ke tim
 * non-stub; tulis data/stub-merge-audit.json (counts sebelum/sesudah identik).
 * TIDAK ada baris yang diubah, TIDAK ada tim yang dihapus.
 *
 * Apply (hanya bila kandidat terverifikasi ada):
 *   npx.cmd tsx scripts/merge-stub-duplicates.ts --apply --allow tm_master_x=tm_yyyy,tm_master_z=tm_wwww
 * Aturan apply: target wajib ada di teams; hanya baris source='master' yang
 * dipindah (legacy source NULL tak tersentuh — abort bila stub dirujuk legacy);
 * transaksi tunggal; backup counts di JSON audit.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getTheStatsDb } from "../lib/db/thestats-dataset";
import { normalizeTeamName } from "../lib/quant/team-normalizer";

const APPLY = process.argv.includes("--apply");
const allowArg = process.argv.find((a) => a.startsWith("--allow="));
const ALLOW = new Map<string, string>(
  (allowArg ? allowArg.slice("--allow=".length).split(",") : [])
    .filter((p) => p.includes("="))
    .map((p) => p.split("=") as [string, string])
);
const AUDIT_PATH = path.join(process.cwd(), "data", "stub-merge-audit.json");

const db = getTheStatsDb();
const stubs = db.prepare(
  "SELECT team_id, name FROM teams WHERE team_id LIKE 'tm\\_master\\_%' ESCAPE '\\' ORDER BY name"
).all() as { team_id: string; name: string }[];
const existing = db.prepare(
  "SELECT team_id, name FROM teams WHERE team_id NOT LIKE 'tm\\_master\\_%' ESCAPE '\\'"
).all() as { team_id: string; name: string }[];
const normToId = new Map<string, string>();
for (const t of existing) {
  const n = normalizeTeamName(t.name);
  if (!normToId.has(n)) normToId.set(n, t.team_id);
}
const countLogs = (tid: string) =>
  (db.prepare("SELECT count(*) c FROM team_match_logs WHERE team_id=?").get(tid) as any).c as number;

const candidates = stubs
  .map((s) => ({ stub: s, target: normToId.get(normalizeTeamName(s.name)) ?? null }))
  .filter((c) => c.target !== null) as { stub: { team_id: string; name: string }; target: string }[];

console.log(`=== AUDIT STUB-DUPLICATES (dry_run=${!APPLY}) ===`);
console.log(`  stub tm_master_*: ${stubs.length}, kandidat merge: ${candidates.length}`);
for (const c of candidates) {
  console.log(`    ~ ${c.stub.team_id} (${c.stub.name}, ${countLogs(c.stub.team_id)} log) → ${c.target}`);
}

const audit = {
  generated_at: new Date().toISOString(),
  dry_run: !APPLY,
  stub_count: stubs.length,
  thin_before: (db.prepare(
    "SELECT count(*) c FROM (SELECT t.team_id FROM teams t LEFT JOIN team_match_logs l ON l.team_id=t.team_id GROUP BY t.team_id HAVING count(l.log_id)<6)"
  ).get() as any).c as number,
  candidates: candidates.map((c) => ({
    stub: c.stub.team_id, stub_name: c.stub.name,
    stub_logs: countLogs(c.stub.team_id), target: c.target,
    target_logs: countLogs(c.target),
  })),
  merged: [] as unknown[],
};

if (!APPLY) {
  audit.thin_before = audit.thin_before; // sesudah = sebelum (tak ada tulis)
  fs.writeFileSync(AUDIT_PATH, JSON.stringify({ ...audit, thin_after: audit.thin_before }, null, 2));
  console.log(`  audit ditulis: ${path.basename(AUDIT_PATH)} (0 baris diubah)`);
  process.exit(0);
}

// ── APPLY (transaksi; hanya kandidat yg di---allow eksplisit) ──
const wanted = candidates.filter((c) => ALLOW.get(c.stub.team_id) === c.target);
if (wanted.length === 0) {
  console.error("  APPLY ditolak: tidak ada pasangan --allow yang cocok dengan kandidat terverifikasi.");
  process.exit(1);
}
const legacyRefs = db.prepare(
  "SELECT count(*) c FROM team_match_logs WHERE source IS NULL AND (team_id LIKE 'tm\\_master\\_%' ESCAPE '\\' OR opponent_id LIKE 'tm\\_master\\_%' ESCAPE '\\')"
).get() as any;
if ((legacyRefs.c as number) > 0) {
  console.error("  APPLY abort: ada baris legacy (source NULL) merujuk stub — tak tersentuh.");
  process.exit(1);
}
const move = db.transaction(() => {
  for (const c of wanted) {
    const tgt = db.prepare("SELECT 1 FROM teams WHERE team_id=?").get(c.target);
    if (!tgt) throw new Error(`target hilang: ${c.target}`);
    const logs = db.prepare("SELECT * FROM team_match_logs WHERE team_id=?").all(c.stub.team_id) as any[];
    for (const l of logs) {
      if (l.source !== "master") throw new Error(`bukan baris master: ${l.log_id}`);
      const newId = `${l.match_id}_${c.target}`;
      db.prepare("DELETE FROM team_match_logs WHERE log_id=?").run(l.log_id);
      db.prepare("INSERT OR IGNORE INTO team_match_logs (log_id, match_id, team_id, opponent_id, venue, match_date, season, result, goals_for, goals_against, xg_for, xg_against, shots_for, shots_against, shots_on_target_for, shots_on_target_against, raw_stats_json, source, data_tier) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
        newId, l.match_id, c.target, l.opponent_id === c.stub.team_id ? c.target : l.opponent_id,
        l.venue, l.match_date, l.season, l.result, l.goals_for, l.goals_against,
        l.xg_for, l.xg_against, l.shots_for, l.shots_against,
        l.shots_on_target_for, l.shots_on_target_against, l.raw_stats_json, l.source, l.data_tier
      );
    }
    db.prepare("UPDATE matches SET home_team_id=? WHERE home_team_id=?").run(c.target, c.stub.team_id);
    db.prepare("UPDATE matches SET away_team_id=? WHERE away_team_id=?").run(c.target, c.stub.team_id);
    db.prepare("UPDATE team_match_logs SET opponent_id=? WHERE opponent_id=?").run(c.target, c.stub.team_id);
    if (countLogs(c.stub.team_id) === 0) db.prepare("DELETE FROM teams WHERE team_id=?").run(c.stub.team_id);
    (audit.merged as unknown[]).push({ stub: c.stub.team_id, target: c.target, moved: logs.length });
  }
});
move();
(audit as any).thin_after = (db.prepare(
  "SELECT count(*) c FROM (SELECT t.team_id FROM teams t LEFT JOIN team_match_logs l ON l.team_id=t.team_id GROUP BY t.team_id HAVING count(l.log_id)<6)"
).get() as any).c as number;
fs.writeFileSync(AUDIT_PATH, JSON.stringify(audit, null, 2));
console.log(`  merged: ${(audit.merged as unknown[]).length}, thin ${audit.thin_before}→${(audit as any).thin_after}`);
