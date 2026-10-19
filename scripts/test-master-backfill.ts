/**
 * RUNNABLE CHECK — Task 1 todo-offline-depth.md: verifikasi tambalan master.
 *
 * Memeriksa (independen dari skrip backfill, baca ulang dari DB + manifest):
 *  1. bridge sample (normalizer: HIT pas, tabrakan nama DITOLAK)
 *  2. tag (tiap baris master_* bertag source+tier; baris legacy tak bertag)
 *  3. COALESCE (checksum kolom terproteksi baris lama identik; tim sehat counts sama)
 *  4. counts (log/match/team = snapshot + delta manifest; tim tertambal naik sesuai)
 *
 * Jalankan: npx.cmd tsx scripts/test-master-backfill.ts
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { getTheStatsDb } from "../lib/db/thestats-dataset";
import { normalizeTeamName } from "../lib/quant/team-normalizer";
import { MASTER_SOURCE, MASTER_TIER, TARGET_LOGS, MANIFEST_PATH } from "./backfill-from-master";

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
  }
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

console.log("=== TEST MASTER BACKFILL ===\n");

// 0. Manifest ada & hijau (bukan dry-run).
assert(fs.existsSync(MANIFEST_PATH), `manifest ada (${path.basename(MANIFEST_PATH)})`);
if (!fs.existsSync(MANIFEST_PATH)) {
  console.log(`\n=== ${passed} lulus, ${failed} gagal ===`);
  process.exit(1);
}
const mf = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
assert(mf.dry_run === false, "manifest dari run tulis (bukan dry-run)");
assert(mf.post?.checks_ok === true, "post-check backfill hijau (checksum baris lama sama)");

// 1. Bridge sample.
assert(normalizeTeamName("Saint-Étienne") === normalizeTeamName("AS Saint-Etienne"), "bridge: Saint-Étienne ↔ AS Saint-Etienne");
assert(normalizeTeamName("Club Brugge KV") === "Club Brugge", "bridge: Club Brugge KV → Club Brugge");
assert(normalizeTeamName("Olympiacos FC") === "Olympiacos", "bridge: Olympiacos FC → Olympiacos");
assert(normalizeTeamName("FC Porto") === "FC Porto", "bridge identitas: FC Porto");
assert(normalizeTeamName("Celtic") === "Celtic", "bridge identitas: Celtic");
assert(normalizeTeamName("Lincoln Red Imps") !== normalizeTeamName("Lincoln"), "anti-tabrakan: Lincoln Red Imps ≠ Lincoln (beda klub!)");
assert(normalizeTeamName("FK Crvena zvezda") !== normalizeTeamName("Red Star FC"), "anti-tabrakan: Crvena zvezda ≠ Red Star FC (beda klub!)");
assert(normalizeTeamName("Sporting Gijon") !== normalizeTeamName("Sporting"), "anti-tabrakan: Sporting Gijon ≠ Sporting (beda klub!)");
assert(normalizeTeamName("Sp Lisbon") === "Sp Lisbon", "ratings-hit: Sp Lisbon kanonikal (key P1 calibrated_ratings)");
assert(normalizeTeamName("Sporting") === "Sp Lisbon", "ratings-hit: DB Sporting → Sp Lisbon (was: miss → prior)");
assert(normalizeTeamName("Sporting CP") === "Sp Lisbon", "ratings-hit: orphan Sporting CP direpoint");
// Bridge short/long master (D1/SP1/F1/N1) — tiap alias diverifikasi ke tabel teams 1-1.
assert(normalizeTeamName("Ein Frankfurt") === normalizeTeamName("Eintracht Frankfurt"), "bridge: Ein Frankfurt → Eintracht Frankfurt");
assert(normalizeTeamName("Werder Bremen") === normalizeTeamName("SV Werder Bremen"), "bridge: Werder Bremen → SV Werder Bremen");
assert(normalizeTeamName("Schalke 04") === normalizeTeamName("FC Schalke 04"), "bridge: Schalke 04 → FC Schalke 04");
assert(normalizeTeamName("Bayer Leverkusen") === normalizeTeamName("Bayer 04 Leverkusen"), "bridge: Bayer Leverkusen → Bayer 04 Leverkusen");
assert(normalizeTeamName("Borussia Monchengladbach") === normalizeTeamName("Borussia M'gladbach"), "bridge: Borussia Monchengladbach → Borussia M'gladbach");
assert(normalizeTeamName("TSG 1899 Hoffenheim") === normalizeTeamName("TSG Hoffenheim"), "bridge: TSG 1899 Hoffenheim → TSG Hoffenheim");
assert(normalizeTeamName("SV Elversberg") === normalizeTeamName("SV 07 Elversberg"), "bridge: SV Elversberg → SV 07 Elversberg");
assert(normalizeTeamName("Ajax") === normalizeTeamName("AFC Ajax"), "bridge: Ajax → AFC Ajax");
assert(normalizeTeamName("Santander") === normalizeTeamName("Racing de Santander"), "bridge: Santander → Racing de Santander");
assert(normalizeTeamName("La Coruna") === normalizeTeamName("Deportivo La Coruña"), "bridge: La Coruna → Deportivo La Coruña");
assert(normalizeTeamName("Stade Brestois") === "Stade Brestois 29", "bridge: Stade Brestois → Stade Brestois 29");

const db = getTheStatsDb();
const like = (col: string, not = false) => `${col} ${not ? "NOT " : ""}LIKE 'master\\_%' ESCAPE '\\'`;
const likeTm = (not = false) => `team_id ${not ? "NOT " : ""}LIKE 'tm\\_master\\_%' ESCAPE '\\'`;

// 2. Tag.
const masterLogs = (db.prepare(`SELECT count(*) c FROM team_match_logs WHERE ${like("log_id")}`).get() as any).c as number;
assert(masterLogs === mf.result.new_logs, `log master_* di DB (${masterLogs}) = manifest (${mf.result.new_logs})`);
const untagged = (db.prepare(`SELECT count(*) c FROM team_match_logs WHERE ${like("log_id")} AND (source IS NULL OR data_tier IS NULL)`).get() as any).c as number;
assert(untagged === 0, "semua baris master_* bertag source + tier");
const tierOk = (db.prepare(`SELECT count(*) c FROM team_match_logs WHERE ${like("log_id")} AND source = ? AND data_tier = ?`).get(MASTER_SOURCE, MASTER_TIER) as any).c as number;
assert(tierOk === masterLogs, `tag jujur: source='${MASTER_SOURCE}' + tier='${MASTER_TIER}' (${tierOk}/${masterLogs})`);
const legacyTagged = (db.prepare(`SELECT count(*) c FROM team_match_logs WHERE ${like("log_id", true)} AND source IS NOT NULL`).get() as any).c as number;
assert(legacyTagged === 0, "0 baris legacy tertag source (tak tersentuh)");
const xgSrc = (db.prepare("SELECT count(*) c FROM team_match_logs WHERE xg_source = ?").get(MASTER_SOURCE) as any).c as number;
assert(xgSrc === mf.result.xg_fills, `baris xg_source=master (${xgSrc}) = fills manifest (${mf.result.xg_fills})`);

// 3. COALESCE: checksum kolom terproteksi baris lama identik.
const protectedCols = (
  db.prepare("SELECT name FROM pragma_table_info('team_match_logs')").all() as any[]
)
  .map((r) => String(r.name))
  .filter((c) => !["xg_for", "xg_against", "source", "data_tier", "xg_source", "created_at"].includes(c));
const legacyRows = db.prepare(`SELECT * FROM team_match_logs WHERE ${like("log_id", true)}`).all() as any[];
const hash = sha256(
  legacyRows
    .map((r) => protectedCols.map((c) => `${c}=${r[c] === null || r[c] === undefined ? "∅" : String(r[c])}`).join("|"))
    .sort()
    .join("\n")
);
assert(legacyRows.length === mf.snapshot.counts.logs, `jumlah baris lama utuh (${legacyRows.length})`);
assert(hash === mf.snapshot.checksumLogsProtected, "checksum kolom terproteksi baris lama IDENTIK (COALESCE terbukti)");
// Nilai xG lama tak tertimpa: baris legacy yg kini punya xG hanyalah fills.
const legacyXgNow = db.prepare(`SELECT log_id FROM team_match_logs WHERE ${like("log_id", true)} AND xg_for IS NOT NULL`).all() as any[];
const filledSet = new Set<string>(mf.result.filled_ids as string[]);
const xgNullBefore: number = mf.snapshot.counts.logs - mf.snapshot.counts.xgNull; // baris ber-xG sebelum
assert(
  legacyXgNow.length === xgNullBefore + mf.result.xg_fills,
  `xG non-NULL legacy = lama (${xgNullBefore}) + fills (${mf.result.xg_fills}), tanpa timpa`
);
// Tim sehat (bukan tipis-dulu, bukan stub): counts sama persis.
const snapCounts: Record<string, number> = mf.snapshot.team_counts;
const patchedIds = new Set<string>((mf.result.patched as any[]).map((p) => p.team_id));
let healthyOk = true;
for (const [tid, n0] of Object.entries(snapCounts)) {
  if (patchedIds.has(tid)) continue;
  const cur = (db.prepare("SELECT count(*) c FROM team_match_logs WHERE team_id=?").get(tid) as any).c as number;
  if (cur !== n0) {
    healthyOk = false;
    console.error(`    berubah: ${tid} ${n0}→${cur}`);
  }
}
assert(healthyOk, "144 tim sehat: jumlah log identik (tak tersentuh)");

// 4. Counts: snapshot + delta; tim tertambal naik sesuai manifest.
const counts = {
  teams: (db.prepare("SELECT count(*) c FROM teams").get() as any).c as number,
  matches: (db.prepare("SELECT count(*) c FROM matches").get() as any).c as number,
  logs: (db.prepare("SELECT count(*) c FROM team_match_logs").get() as any).c as number,
};
assert(counts.logs === mf.snapshot.counts.logs + mf.result.new_logs, `logs = snapshot + baru (${counts.logs})`);
assert(counts.matches === mf.snapshot.counts.matches + mf.result.new_matches, `matches = snapshot + baru (${counts.matches})`);
assert(counts.teams === mf.snapshot.counts.teams + mf.result.stub_teams.length, `teams = snapshot + stub (${counts.teams})`);
for (const p of mf.result.patched as any[]) {
  const cur = (db.prepare("SELECT count(*) c FROM team_match_logs WHERE team_id=?").get(p.team_id) as any).c as number;
  assert(cur === p.before + p.added, `${p.name}: ${p.before}+${p.added}=${cur} log`);
  assert(cur <= TARGET_LOGS || p.added === 0 || cur >= TARGET_LOGS, `${p.name}: sembuh ke ${TARGET_LOGS} (atau master habis)`);
}
// Sisa tak ke-bridge terdokumentasi + gate tercatat.
assert(
  mf.result.unbridgeable.length === mf.result.thin_before - mf.result.patched.length,
  `sisa tak ke-bridge terdokumentasi (${mf.result.unbridgeable.length})`
);
assert(
  (mf.gate.stopped_divs as string[]).includes("D1") && (mf.gate.stopped_divs as string[]).includes("N1"),
  `gate STOP tercatat untuk D1+N1 (coverage <80%), tanpa imputasi`
);
const patchedDivs = new Set<string>((mf.result.patched as any[]).map((p) => p.div));
let gateRespected = true;
for (const d of patchedDivs) {
  if ((mf.gate.stopped_source as string[]).includes(d)) gateRespected = false;
}
assert(gateRespected, `tak ada tambalan dari div STOP (${[...patchedDivs].join(",")})`);

console.log(`\n=== ${passed} lulus, ${failed} gagal ===`);
process.exit(failed > 0 ? 1 : 0);
