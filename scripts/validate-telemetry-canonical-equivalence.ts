/**
 * VALIDATE TELEMETRY CANONICAL EQUIVALENCE — tindak lanjut verdict PASS
 * gerbang lengan gabungan (tasks/telemetry-combined-arm-report.md §0/§5):
 * apakah jendela yang benar-benar disajikan lapisan kanonik live
 * (team_match_logs_canonical) sama dengan definisi `combined` yang lulus
 * gerbang (SM ∪ fd, dedupe kunci laga fisik, SM menang)?
 *
 * Populasi: seluruh team_id yang punya baris football-data (277 tim).
 * Cutoff: 2026-11-16 (jendela sebagaimana tersaji untuk fixture mendatang).
 * Kunci pembanding: tanggal(10)|opponent KANONIK|GF|GA (opponent pool
 * mentah dipetakan lewat registry supaya namespace sejajar).
 *
 * Klasifikasi selisih per tim:
 *   equal              — himpunan kunci identik.
 *   explained_extra    — kanonik memuat baris ekstra yang chosen_source-nya
 *                        thestats/master (sumber fallback terdokumentasi
 *                        builder, untuk laga tanpa baris SM/fd) dan tidak
 *                        kehilangan baris gabungan mana pun.
 *   material           — kanonik kehilangan baris gabungan, atau memuat
 *                        baris ekstra yang bukan fallback terdokumentasi.
 * Untuk tim `equal`, rata-rata GF/GA kedua jendela juga dibandingkan
 * (harus identik); selisih xG pada keanggotaan sama dicatat terpisah
 * (efek xg_filled_from builder — terdokumentasi, bukan divergensi
 * keanggotaan).
 *
 * Spot-check jalur lib asli (getTeamRollingTelemetry, fungsi saji) untuk
 * 3 tim gainer dari tasks/telemetry-freshness.json: jendela saji harus
 * memuat laga fd November.
 *
 * Output: tasks/telemetry-canonical-equivalence.json. Baca-saja.
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { getTeamRollingTelemetry, getPreMatchLogs } from "../lib/db/team-telemetry";

const CUTOFF = "2026-11-16";
const ds = new DatabaseSync(path.join(process.cwd(), "data", "thestats_dataset.db"), { readOnly: true });

const member2Canon = new Map<string, string>();
{
  const reg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "team-canonical.json"), "utf8")) as {
    teams: { canonical_id: string; members: { team_id: string }[] }[];
  };
  for (const t of reg.teams) for (const m of t.members) member2Canon.set(m.team_id, t.canonical_id);
}
const canonOf = (id: string): string => member2Canon.get(id) ?? id;

interface WinRow { key: string; gf: number; ga: number; xgf: number | null; chosen?: string }
function combinedWindow(teamId: string): WinRow[] {
  const rows = ds.prepare(
    `SELECT match_date, opponent_id, goals_for, goals_against, xg_for, source
     FROM team_match_logs WHERE team_id = ? AND source IN ('sportmonks', 'football-data')
       AND substr(match_date, 1, 10) < ? ORDER BY match_date`,
  ).all(teamId, CUTOFF) as unknown as { match_date: string; opponent_id: string; goals_for: number; goals_against: number; xg_for: number | null; source: string }[];
  const byKey = new Map<string, WinRow & { prio: number }>();
  for (const r of rows) {
    const key = `${r.match_date.slice(0, 10)}|${canonOf(r.opponent_id)}|${r.goals_for}|${r.goals_against}`;
    const prio = r.source === "sportmonks" ? 0 : 1;
    const prev = byKey.get(key);
    if (!prev || prio < prev.prio) byKey.set(key, { key, gf: r.goals_for, ga: r.goals_against, xgf: r.xg_for, prio });
  }
  return [...byKey.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(-6)
    .map(({ key, gf, ga, xgf }) => ({ key, gf, ga, xgf }));
}
function canonicalWindow(teamId: string): WinRow[] {
  const canon = member2Canon.get(teamId);
  if (!canon) return [];
  const rows = ds.prepare(
    `SELECT match_date, canonical_opponent_id, goals_for, goals_against, xg_for, chosen_source
     FROM team_match_logs_canonical WHERE canonical_team_id = ? AND substr(match_date, 1, 10) < ?
     ORDER BY match_date DESC LIMIT 12`,
  ).all(canon, CUTOFF) as unknown as { match_date: string; canonical_opponent_id: string; goals_for: number; goals_against: number; xg_for: number | null; chosen_source: string }[];
  const seen = new Set<string>();
  const out: WinRow[] = [];
  for (const r of rows) {
    const key = `${r.match_date.slice(0, 10)}|${r.canonical_opponent_id}|${r.goals_for}|${r.goals_against}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, gf: r.goals_for, ga: r.goals_against, xgf: r.xg_for, chosen: r.chosen_source });
    if (out.length >= 6) break;
  }
  return out.reverse();
}

function main(): void {
  const fdTeams = (ds.prepare(
    `SELECT DISTINCT team_id FROM team_match_logs WHERE source = 'football-data'`,
  ).all() as unknown as { team_id: string }[]).map((r) => r.team_id);
  let equal = 0, explained = 0;
  const material: { team_id: string; combined_only: string[]; canonical_only: { key: string; chosen?: string }[] }[] = [];
  let goalsMismatchOnEqual = 0, xgDiffOnEqual = 0;
  for (const t of fdTeams) {
    const cw = combinedWindow(t);
    const kw = canonicalWindow(t);
    const cKeys = new Set(cw.map((r) => r.key));
    const kKeys = new Set(kw.map((r) => r.key));
    const combinedOnly = [...cKeys].filter((k) => !kKeys.has(k));
    const canonicalOnly = kw.filter((r) => !cKeys.has(r.key));
    if (combinedOnly.length === 0 && canonicalOnly.length === 0) {
      equal++;
      const mean = (arr: WinRow[], f: (r: WinRow) => number) => (arr.length ? arr.reduce((s, r) => s + f(r), 0) / arr.length : 0);
      if (Math.abs(mean(cw, (r) => r.gf) - mean(kw, (r) => r.gf)) > 1e-9 || Math.abs(mean(cw, (r) => r.ga) - mean(kw, (r) => r.ga)) > 1e-9) goalsMismatchOnEqual++;
      const xgMean = (arr: WinRow[]) => {
        const xs = arr.map((r) => r.xgf).filter((v): v is number => v !== null);
        return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;
      };
      const a = xgMean(cw), b = xgMean(kw);
      if (a !== null && b !== null && Math.abs(a - b) > 1e-9) xgDiffOnEqual++;
    } else if (combinedOnly.length === 0 && canonicalOnly.every((r) => r.chosen === "thestats" || r.chosen === "master")) {
      explained++;
    } else {
      material.push({ team_id: t, combined_only: combinedOnly, canonical_only: canonicalOnly.map((r) => ({ key: r.key, chosen: r.chosen })) });
    }
  }
  console.log(`[equiv] tim fd=${fdTeams.length} equal=${equal} explained_extra=${explained} material=${material.length}`);
  console.log(`[equiv] equal tapi GF/GA beda=${goalsMismatchOnEqual}; equal tapi xG beda (xg_filled_from)=${xgDiffOnEqual}`);
  for (const m of material.slice(0, 8)) console.log(`[equiv] MATERIAL ${m.team_id}: combined_only=${JSON.stringify(m.combined_only)} canonical_only=${JSON.stringify(m.canonical_only)}`);

  // Spot-check fungsi saji asli untuk 3 gainer dari pengukuran kesegaran.
  const fresh = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tasks", "telemetry-freshness.json"), "utf8")) as {
    populations: { upcoming_2026_11_20_24: { examples: { team_id: string }[] } };
  };
  const spotIds = [...new Set(fresh.populations.upcoming_2026_11_20_24.examples.map((e) => e.team_id))].slice(0, 3);
  const nameOf = ds.prepare(`SELECT name FROM teams WHERE team_id = ?`);
  const spots: unknown[] = [];
  for (const id of spotIds) {
    const t = getTeamRollingTelemetry(id, 6, "2026-11-20");
    const logs = getPreMatchLogs(id, 6, "2026-11-20");
    const name = (nameOf.get(id) as unknown as { name: string } | undefined)?.name ?? id;
    const newest = logs.length ? String(logs[0].match_date).slice(0, 10) : null;
    const sources = [...new Set(logs.map((l) => (l as unknown as { source: string | null }).source ?? "thestats"))];
    console.log(`[spot] ${name} (${id}): n=${t.sample_size} GF=${t.rolling_goals_for} GA=${t.rolling_goals_against} xGF=${t.rolling_xg_for} terbaru=${newest} sumber=${sources.join(",")}`);
    spots.push({ team_id: id, name, sample_size: t.sample_size, rolling_goals_for: t.rolling_goals_for, rolling_goals_against: t.rolling_goals_against, rolling_xg_for: t.rolling_xg_for, newest_match: newest, sources });
  }

  const out = {
    generated_at: new Date().toISOString(),
    cutoff: CUTOFF,
    fd_teams: fdTeams.length,
    equal, explained_extra: explained, material_count: material.length,
    material_examples: material.slice(0, 25),
    goals_mismatch_on_equal: goalsMismatchOnEqual,
    xg_diff_on_equal: xgDiffOnEqual,
    lib_spot_checks: spots,
  };
  fs.writeFileSync(path.join(process.cwd(), "tasks", "telemetry-canonical-equivalence.json"), JSON.stringify(out, null, 2));
  console.log(`[equiv] → tasks/telemetry-canonical-equivalence.json`);
}

main();
