/**
 * TASK 1 — todo-offline-depth.md: tambal tim tipis + sel xG kosong dari football_master.db.
 *
 * ATURAN (ditegakkan skrip ini):
 *  1. HANYA tim <6 log + sel xG NULL yang disentuh. 144 tim sehat + nilai lama:
 *     UPDATE xG pakai COALESCE (tak pernah timpa non-NULL); INSERT hanya log baru
 *     untuk tim tipis. Checksum baris lama diverifikasi sebelum & sesudah.
 *  2. Bridge via lib/quant/team-normalizer. Coverage <80% per liga = STOP untuk
 *     liga itu + dokumentasi di manifest, BUKAN imputasi.
 *  3. Tiap baris tambalan bertag source='master' + data_tier='MASTER_PARTIAL'
 *     (kolom nullable baru; kolom lama tak diubah; skema log tak berubah bentuk).
 *  4. Idempotent: eksekusi ulang melewatkan yang sudah ada tanpa menulis ulang.
 *
 * Jalankan: npx.cmd tsx scripts/backfill-from-master.ts [--dry-run]
 * Output: data/backfill-master-manifest.json (bukti counts + checksum + gate)
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { getTheStatsDb } from "../lib/db/thestats-dataset";
import { normalizeTeamName } from "../lib/quant/team-normalizer";
import { TARGET_COMPETITIONS } from "../lib/thestats-competitions";

export const MASTER_SOURCE = "master";
export const MASTER_TIER = "MASTER_PARTIAL";
export const TARGET_LOGS = 6;
export const COVERAGE_GATE = 0.8;
export const MANIFEST_PATH = path.join(process.cwd(), "data", "backfill-master-manifest.json");

const DRY = process.argv.includes("--dry-run");

interface MasterRow {
  id: number;
  div: string;
  season: string;
  date: string;
  time: string | null;
  home_team: string;
  away_team: string;
  fthg: number;
  ftag: number;
  hs: number | null;
  as_shots: number | null;
  hst: number | null;
  ast: number | null;
  h_xg: number | null;
  a_xg: number | null;
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "unk";

function isoDate(date: string, time: string | null): string {
  return `${date}T${time ?? "12:00"}:00.000Z`;
}

function resultOf(gf: number, ga: number): "W" | "D" | "L" {
  return gf > ga ? "W" : gf < ga ? "L" : "D";
}

function main() {
  const db = getTheStatsDb();
  const masterPath = path.join(process.cwd(), "data", "football_master.db");
  if (!fs.existsSync(masterPath)) {
    console.error("[backfill-master] data/football_master.db tidak ada — STOP.");
    process.exit(1);
  }
  const master = new DatabaseSync(masterPath, { readOnly: true });

  // ── 0. Snapshot bukti (counts + checksum baris lama) ──────────────────────
  const countsBefore = {
    teams: (db.prepare("SELECT count(*) c FROM teams").get() as any).c as number,
    matches: (db.prepare("SELECT count(*) c FROM matches").get() as any).c as number,
    logs: (db.prepare("SELECT count(*) c FROM team_match_logs").get() as any).c as number,
    xgNull: (db.prepare("SELECT count(*) c FROM team_match_logs WHERE xg_for IS NULL").get() as any).c as number,
  };
  // Kolom terproteksi = semua kolom LAMA kecuali xg_for/xg_against (boleh COALESCE NULL→nilai).
  const protectedCols = (
    db.prepare("SELECT name FROM pragma_table_info('team_match_logs')").all() as any[]
  )
    .map((r) => String(r.name))
    .filter((c) => !["xg_for", "xg_against", "source", "data_tier", "xg_source", "created_at"].includes(c));
  const hashRows = (rows: any[], cols: string[]) =>
    sha256(
      rows
        .map((r) => cols.map((c) => `${c}=${r[c] === null || r[c] === undefined ? "∅" : String(r[c])}`).join("|"))
        .sort()
        .join("\n")
    );
  const logsBefore = db.prepare("SELECT * FROM team_match_logs").all() as any[];
  const checksumLogsProtected = hashRows(logsBefore, protectedCols);
  const matchesBefore = db.prepare("SELECT * FROM matches").all() as any[];
  const checksumMatches = hashRows(matchesBefore, ["match_id", "competition_id", "season", "utc_date", "status", "home_team_id", "away_team_id", "home_score", "away_score"]);
  const teamsBefore = db.prepare("SELECT team_id, name FROM teams").all() as any[];
  const checksumTeams = hashRows(teamsBefore, ["team_id", "name"]);
  const preExistingLogIds = new Set(logsBefore.map((r) => String(r.log_id)));
  const preExistingMatchIds = new Set(matchesBefore.map((r) => String(r.match_id)));
  const preExistingTeamIds = new Set(teamsBefore.map((r) => String(r.team_id)));
  const teamCountsBefore = new Map<string, number>(
    (db.prepare("SELECT team_id, count(*) c FROM team_match_logs GROUP BY team_id").all() as any[]).map((r) => [String(r.team_id), Number(r.c)])
  );

  // ── 1. Bridge coverage per liga (dataset comp ↔ master div) ───────────────
  const compToDiv: Record<string, string> = {};
  for (const c of Object.values(TARGET_COMPETITIONS)) {
    if (c.divCode !== "UCL") compToDiv[c.id] = c.divCode;
  }
  const coverage: Record<string, { dataset: number; hit: number; cov: number; misses: string[] }> = {};
  for (const [comp, div] of Object.entries(compToDiv)) {
    const tids = new Set<string>(
      (db.prepare("SELECT home_team_id AS t FROM matches WHERE competition_id=? UNION SELECT away_team_id FROM matches WHERE competition_id=?").all(comp, comp) as any[]).map((r) => String(r.t))
    );
    const dnames: string[] = [];
    for (const t of tids) {
      const row = db.prepare("SELECT name FROM teams WHERE team_id=?").get(t) as any;
      if (row) dnames.push(String(row.name));
    }
    const mnames = (
      master.prepare("SELECT home_team AS t FROM matches WHERE div=? GROUP BY home_team UNION SELECT away_team FROM matches WHERE div=? GROUP BY away_team").all(div, div) as any[]
    ).map((r) => String(r.t));
    const mNorm = new Set(mnames.map((n) => normalizeTeamName(n)));
    const misses: string[] = [];
    let hit = 0;
    for (const n of dnames) {
      if (mNorm.has(normalizeTeamName(n))) hit++;
      else misses.push(n);
    }
    coverage[div] = { dataset: dnames.length, hit, cov: dnames.length ? hit / dnames.length : 1, misses };
  }
  const stoppedDivs = Object.entries(coverage)
    .filter(([, v]) => v.cov < COVERAGE_GATE)
    .map(([div]) => div);
  // Keluarga yang terbukti lemah di bridge (nama terpotong/singkat di master
  // yg tak teralias: "Ein Frankfurt", "For Sittard", prefix FC/SC/AFC, …).
  const STOP_SOURCE = new Set<string>([...stoppedDivs, ...stoppedDivs.flatMap((d) => (d === "D1" ? ["D2"] : []))]);

  console.log("=== BRIDGE COVERAGE (gate ≥80%) ===");
  for (const [div, v] of Object.entries(coverage)) {
    const verdict = v.cov >= COVERAGE_GATE ? "LANJUT" : "STOP";
    console.log(`  ${div}: ${v.hit}/${v.dataset} = ${(v.cov * 100).toFixed(1)}% → ${verdict}`);
    if (verdict === "STOP") console.log(`    miss: ${v.misses.join(" | ")}`);
  }
  if (stoppedDivs.length > 0) {
    console.log(`  STOP sumber: ${[...STOP_SOURCE].join(", ")} (terdokumentasi, tanpa imputasi)`);
  }

  // ── 2. Peta bridge: dataset team ↔ master ──────────────────────────────────
  const dsNormToId = new Map<string, string>();
  for (const r of db.prepare("SELECT team_id, name FROM teams").all() as any[]) {
    const nn = normalizeTeamName(String(r.name));
    if (!dsNormToId.has(nn)) dsNormToId.set(nn, String(r.team_id));
  }
  const masterXgRows = master.prepare("SELECT * FROM matches WHERE h_xg IS NOT NULL AND a_xg IS NOT NULL").all() as MasterRow[];
  const masterByNorm = new Map<string, MasterRow[]>();
  for (const r of masterXgRows) {
    for (const side of [r.home_team, r.away_team]) {
      const nn = normalizeTeamName(String(side));
      if (!masterByNorm.has(nn)) masterByNorm.set(nn, []);
      if (!masterByNorm.get(nn)!.some((x) => x.id === r.id)) masterByNorm.get(nn)!.push(r);
    }
  }

  // ── 3a. UPDATE: sel xG kosong via COALESCE (HANYA NULL→nilai) ──────────────
  const xgNullLogs = db.prepare("SELECT * FROM team_match_logs WHERE xg_for IS NULL").all() as any[];
  const masterByKey = new Map<string, MasterRow>();
  for (const r of masterXgRows) {
    const hn = normalizeTeamName(String(r.home_team));
    const an = normalizeTeamName(String(r.away_team));
    const key = [hn, an].sort().join("‖") + "‖" + String(r.date) + `‖${r.fthg}-${r.ftag}`;
    if (!masterByKey.has(key)) masterByKey.set(key, r);
  }
  const teamNameById = new Map<string, string>(
    (db.prepare("SELECT team_id, name FROM teams").all() as any[]).map((r) => [String(r.team_id), String(r.name)])
  );
  let xgFills = 0;
  const filledIds: string[] = [];
  if (!DRY) {
    const upd = db.prepare(
      "UPDATE team_match_logs SET xg_for = COALESCE(xg_for, ?), xg_against = COALESCE(xg_against, ?), xg_source = ? WHERE log_id = ? AND xg_for IS NULL"
    );
    for (const l of xgNullLogs) {
      const tn = normalizeTeamName(teamNameById.get(String(l.team_id)) ?? String(l.team_id));
      const on = normalizeTeamName(teamNameById.get(String(l.opponent_id)) ?? String(l.opponent_id));
      const key = [tn, on].sort().join("‖") + "‖" + String(l.match_date).slice(0, 10) + `‖${l.goals_for}-${l.goals_against}`;
      const mrow = masterByKey.get(key);
      if (!mrow) continue; // beda laga/kompetisi/musim → dibiarkan kosong, TANPA imputasi
      const isHome = normalizeTeamName(String(mrow.home_team)) === tn;
      const vFor = isHome ? mrow.h_xg : mrow.a_xg;
      const vAg = isHome ? mrow.a_xg : mrow.h_xg;
      if (vFor === null || vAg === null) continue;
      upd.run(vFor, vAg, MASTER_SOURCE, String(l.log_id));
      xgFills++;
      filledIds.push(String(l.log_id));
    }
  }
  console.log(`\n[XG-COALESCE] log xG-NULL: ${xgNullLogs.length}, terisi dari master: ${xgFills} (ekspektasi ~0: beda musim/kompetisi)`);

  // ── 3b. INSERT: tim tipis (<6 log) yg ke-bridge, dari laga master 26/27 ───
  // Stub tm_master_* dikecualikan: mereka artefak FK, bukan tim tipis betulan
  // (mencegah kaskade: stub berlog 1-2 ikut "ditambal" di run berikutnya).
  const thin = db.prepare(
    "SELECT t.team_id AS team_id, t.name AS name, count(l.log_id) AS n FROM teams t LEFT JOIN team_match_logs l ON l.team_id=t.team_id WHERE t.team_id NOT LIKE 'tm#_master#_%' ESCAPE '#' GROUP BY t.team_id HAVING n < 6 ORDER BY n ASC"
  ).all() as any[];
  const patched: { team_id: string; name: string; before: number; added: number; div: string }[] = [];
  const unbridgeable: { team_id: string; name: string; before: number; reason: string }[] = [];
  const stubTeams = new Map<string, string>(); // team_id -> name
  let newLogs = 0;
  let newMatches = 0;

  const ensureTeam = (teamId: string, name: string) => {
    if (DRY) return;
    db.prepare("INSERT OR IGNORE INTO teams (team_id, name) VALUES (?, ?)").run(teamId, name);
  };
  const ensureMatch = (mrow: MasterRow, homeId: string, awayId: string) => {
    const matchId = `master_${mrow.id}`;
    if (DRY) return matchId;
    const exists = db.prepare("SELECT 1 FROM matches WHERE match_id=?").get(matchId);
    if (!exists) {
      db.prepare(
        "INSERT INTO matches (match_id, competition_id, season, utc_date, status, home_team_id, away_team_id, home_score, away_score, referee_name) VALUES (?, ?, ?, ?, 'finished', ?, ?, ?, ?, ?)"
      ).run(matchId, `master_${mrow.div}`, mrow.season, isoDate(mrow.date, mrow.time), homeId, awayId, mrow.fthg, mrow.ftag, null);
      newMatches++;
    }
    return matchId;
  };
  const insertLog = (
    matchId: string, teamId: string, oppId: string, venue: "HOME" | "AWAY",
    mrow: MasterRow, rawJson: string
  ) => {
    const logId = `${matchId}_${teamId}`;
    if (!DRY && db.prepare("SELECT 1 FROM team_match_logs WHERE log_id=?").get(logId)) return false;
    const home = venue === "HOME";
    const gf = home ? mrow.fthg : mrow.ftag;
    const ga = home ? mrow.ftag : mrow.fthg;
    const xgF = home ? mrow.h_xg : mrow.a_xg;
    const xgA = home ? mrow.a_xg : mrow.h_xg;
    const shF = home ? mrow.hs : mrow.as_shots;
    const shA = home ? mrow.as_shots : mrow.hs;
    const stF = home ? mrow.hst : mrow.ast;
    const stA = home ? mrow.ast : mrow.hst;
    if (!DRY) {
      db.prepare(
        `INSERT INTO team_match_logs
          (log_id, match_id, team_id, opponent_id, venue, match_date, season, result,
           goals_for, goals_against, xg_for, xg_against, shots_for, shots_against,
           shots_on_target_for, shots_on_target_against, raw_stats_json, source, data_tier)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        logId, matchId, teamId, oppId, venue, isoDate(mrow.date, mrow.time), mrow.season,
        resultOf(gf, ga), gf, ga, xgF, xgA, shF, shA, stF, stA, rawJson, MASTER_SOURCE, MASTER_TIER
      );
      newLogs++;
    }
    return true;
  };

  for (const t of thin) {
    const teamId = String(t.team_id);
    const name = String(t.name);
    const before = Number(t.n);
    const nn = normalizeTeamName(name);
    const cands = (masterByNorm.get(nn) ?? []).filter((r) => !STOP_SOURCE.has(r.div));
    const blockedByStop = (masterByNorm.get(nn) ?? []).some((r) => STOP_SOURCE.has(r.div));
    if (cands.length === 0) {
      unbridgeable.push({
        team_id: teamId, name, before,
        reason: blockedByStop ? "bridge HIT tapi div sumber di-STOP (coverage <80%)" : "tak ada nama padan di 16 div master (liga kecil/kualifikasi)",
      });
      continue;
    }
    // Terbaru dulu; lewatkan laga yg sudah tertanam (idempotent).
    const fresh = cands
      .filter((r) => !db.prepare("SELECT 1 FROM team_match_logs WHERE log_id=?").get(`master_${r.id}_${teamId}`))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const need = TARGET_LOGS - before;
    const div = cands[0].div;
    let added = 0;
    for (const mrow of fresh) {
      if (added >= need) break;
      const isHome = normalizeTeamName(String(mrow.home_team)) === nn;
      const oppName = isHome ? String(mrow.away_team) : String(mrow.home_team);
      const oppNorm = normalizeTeamName(oppName);
      let oppId = dsNormToId.get(oppNorm);
      if (!oppId) {
        oppId = `tm_master_${slug(oppNorm)}`;
        // Guard tabrakan slug: id sudah dipakai nama lain → bubuhi div.
        const clash = !DRY && (db.prepare("SELECT name FROM teams WHERE team_id=?").get(oppId) as any);
        if (clash && clash.name !== oppName) oppId = `tm_master_${mrow.div.toLowerCase()}_${slug(oppNorm)}`;
        ensureTeam(oppId, oppName);
        if (!stubTeams.has(oppId)) stubTeams.set(oppId, oppName);
        dsNormToId.set(oppNorm, oppId);
      }
      const homeId = isHome ? teamId : oppId;
      const awayId = isHome ? oppId : teamId;
      const matchId = ensureMatch(mrow, homeId, awayId);
      const rawJson = JSON.stringify({ _source: "football_master.db", ...mrow });
      // Log sisi tim tipis (wajib). Sisi lawan HANYA bila stub tm_master_* (FK
      // simetris) — tim sehat/klasik TAK BOLEH dapat log baru (aturan 1).
      // Lawan sesama tim tipis menanam sisinya lewat loop-nya sendiri.
      if (insertLog(matchId, teamId, oppId, isHome ? "HOME" : "AWAY", mrow, rawJson)) added++;
      if (oppId.startsWith("tm_master_")) {
        insertLog(matchId, oppId, teamId, isHome ? "AWAY" : "HOME", mrow, rawJson);
      }
    }
    patched.push({ team_id: teamId, name, before, added, div });
  }

  // ── 4. Verifikasi pasca (counts + checksum baris lama) ─────────────────────
  // Acuan = himpunan id pra-run (bukan pola nama): run ulang no-op pun konsisten.
  const countsAfter = {
    teams: (db.prepare("SELECT count(*) c FROM teams").get() as any).c as number,
    matches: (db.prepare("SELECT count(*) c FROM matches").get() as any).c as number,
    logs: (db.prepare("SELECT count(*) c FROM team_match_logs").get() as any).c as number,
    xgNull: (db.prepare("SELECT count(*) c FROM team_match_logs WHERE xg_for IS NULL").get() as any).c as number,
  };
  const logsNow = db.prepare("SELECT * FROM team_match_logs").all() as any[];
  const legacyNow = logsNow.filter((r) => preExistingLogIds.has(String(r.log_id)));
  const legacyIdsOk = legacyNow.length === preExistingLogIds.size;
  const checksumLogsProtectedAfter = hashRows(legacyNow, protectedCols);
  const matchesNow = db.prepare("SELECT * FROM matches").all() as any[];
  const checksumMatchesAfter = hashRows(
    matchesNow.filter((r) => preExistingMatchIds.has(String(r.match_id))),
    ["match_id", "competition_id", "season", "utc_date", "status", "home_team_id", "away_team_id", "home_score", "away_score"]
  );
  const teamsNow = db.prepare("SELECT team_id, name FROM teams").all() as any[];
  const checksumTeamsAfter = hashRows(
    teamsNow.filter((r) => preExistingTeamIds.has(String(r.team_id))),
    ["team_id", "name"]
  );
  // Tim sehat (144): jumlah log identik.
  let healthyOk = true;
  for (const [tid, n0] of teamCountsBefore) {
    const cur = (db.prepare("SELECT count(*) c FROM team_match_logs WHERE team_id=?").get(tid) as any).c as number;
    const wasThin = thin.some((t) => String(t.team_id) === tid);
    const isStub = tid.startsWith("tm_master_");
    if (!wasThin && !isStub && cur !== n0) {
      healthyOk = false;
      console.error(`  ❌ tim sehat berubah: ${tid} ${n0} → ${cur}`);
    }
  }
  // Tag: semua baris master_* wajib source+ tier; baris legacy wajib source NULL.
  const untagged = (db.prepare("SELECT count(*) c FROM team_match_logs WHERE log_id LIKE 'master\\_%' ESCAPE '\\' AND (source IS NULL OR data_tier IS NULL)").get() as any).c as number;
  const legacyTagged = (db.prepare("SELECT count(*) c FROM team_match_logs WHERE log_id NOT LIKE 'master\\_%' ESCAPE '\\' AND source IS NOT NULL").get() as any).c as number;

  const checksOk = legacyIdsOk && checksumLogsProtectedAfter === checksumLogsProtected
    && checksumMatchesAfter === checksumMatches && checksumTeamsAfter === checksumTeams
    && healthyOk && untagged === 0 && legacyTagged === 0;

  const manifest = {
    generated_at: new Date().toISOString(),
    dry_run: DRY,
    gate: { threshold: COVERAGE_GATE, coverage, stopped_divs: stoppedDivs, stopped_source: [...STOP_SOURCE] },
    snapshot: { counts: countsBefore, checksumLogsProtected, checksumMatches, checksumTeams, team_counts: Object.fromEntries(teamCountsBefore) },
    result: {
      xg_null_before: countsBefore.xgNull, xg_fills: xgFills, filled_ids: filledIds,
      thin_before: thin.length,
      patched, unbridgeable,
      new_logs: newLogs, new_matches: newMatches,
      stub_teams: [...stubTeams].map(([team_id, name]) => ({ team_id, name })),
    },
    post: { counts: countsAfter, checks_ok: checksOk, untagged_master_logs: untagged, legacy_tagged: legacyTagged },
  };
  if (!DRY) {
    if (newLogs > 0 || xgFills > 0 || !fs.existsSync(MANIFEST_PATH)) {
      fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    } else {
      console.log("  (no-op: tak ada tulis — manifest dipertahankan)");
    }
  }

  console.log(`\n=== HASIL (dry_run=${DRY}) ===`);
  console.log(`  tim tipis: ${thin.length} → tertambal ${patched.length}, tak ke-bridge ${unbridgeable.length}`);
  for (const p of patched) console.log(`    + ${p.name}: ${p.before} → ${p.before + p.added} log (master ${p.div})`);
  console.log(`  log baru: ${newLogs} (+${newMatches} laga master_*, ${stubTeams.size} tim stub tm_master_*)`);
  console.log(`  sel xG terisi: ${xgFills} (sisa NULL: ${countsAfter.xgNull})`);
  console.log(`  counts: logs ${countsBefore.logs}→${countsAfter.logs}, matches ${countsBefore.matches}→${countsAfter.matches}, teams ${countsBefore.teams}→${countsAfter.teams}`);
  console.log(`  checksum baris lama sama: ${checksOk ? "YA ✅" : "TIDAK ❌"}`);
  if (!checksOk) process.exitCode = 1;
  master.close();
}

// Guard: jangan jalan saat di-import (test-master-backfill.ts mengimpor konstanta).
const invokedAsMain =
  typeof process.argv[1] === "string" && process.argv[1].replace(/\\/g, "/").endsWith("scripts/backfill-from-master.ts");
if (invokedAsMain) main();
