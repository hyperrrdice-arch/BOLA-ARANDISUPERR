/**
 * MEASURE TELEMETRY FRESHNESS — kriteria (c) gerbang pra-terdaftar di
 * tasks/telemetry-combined-arm-report.md §0.
 *
 * Untuk setiap tim-fixture di dua populasi, bandingkan tanggal laga
 * terbaru di jendela SM-only vs jendela gabungan SM ∪ football-data
 * (keduanya strictly-before kickoff fixture; jendela last-6 selalu
 * memuat laga terbaru, jadi "gain" ⟺ tanggal terbaru gabungan >
 * tanggal terbaru SM-only, atau SM kosong & gabungan non-kosong).
 *
 * Populasi:
 *   (i)  fixture rated di tasks/pick-slate-latest.json (slate terakhir);
 *        id tim dari upcoming_fixtures via match_id.
 *   (ii) fixture upcoming_fixtures 2026-11-20 → 2026-11-25 (akhir pekan
 *        klub pertama pasca jeda internasional).
 *
 * Ambang pra-terdaftar: manfaat ~nol (adopsi gugur) bila gainers
 * gabungan (i)+(ii) < 10, atau gainers < 5% dari tim-fixture populasi (ii).
 *
 * Output: tasks/telemetry-freshness.json. Offline, baca-saja.
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

const ds = new DatabaseSync(path.join(process.cwd(), "data", "thestats_dataset.db"), { readOnly: true });
const uf = new DatabaseSync(path.join(process.cwd(), "data", "upcoming_fixtures.db"), { readOnly: true });

// Pool tanggal per tim: SM-only dan gabungan (SM ∪ fd; dedupe tak mengubah
// tanggal maksimum, jadi pool tanggal mentah per definisi sumber cukup).
const smDates = new Map<string, string[]>();
const combDates = new Map<string, string[]>();
for (const r of ds.prepare(
  `SELECT team_id, match_date, source FROM team_match_logs WHERE source IN ('sportmonks', 'football-data')`,
).all() as unknown as { team_id: string; match_date: string; source: string }[]) {
  const d = r.match_date.slice(0, 10);
  const c = combDates.get(r.team_id) ?? [];
  c.push(d); combDates.set(r.team_id, c);
  if (r.source === "sportmonks") {
    const s = smDates.get(r.team_id) ?? [];
    s.push(d); smDates.set(r.team_id, s);
  }
}
for (const m of [smDates, combDates]) for (const arr of m.values()) arr.sort();

function newestBefore(dates: string[] | undefined, cutoff: string): string | null {
  if (!dates || !dates.length) return null;
  let lo = 0, hi = dates.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (dates[mid] < cutoff) lo = mid + 1; else hi = mid; }
  return lo > 0 ? dates[lo - 1] : null;
}

interface FixtureTeam { match_id: string; kickoff: string; competition_id: string | null; team_id: string; side: string }
interface PopResult {
  fixtures: number; team_fixtures: number; unresolved: number;
  gainers: number; gainers_share: number | null;
  gainers_from_empty_sm: number;
  examples: { match_id: string; team_id: string; kickoff: string; sm_newest: string | null; combined_newest: string | null }[];
}
function measure(name: string, fts: FixtureTeam[], unresolved: number, fixtureCount: number): PopResult {
  let gainers = 0, fromEmpty = 0;
  const examples: PopResult["examples"] = [];
  for (const ft of fts) {
    const sm = newestBefore(smDates.get(ft.team_id), ft.kickoff);
    const cb = newestBefore(combDates.get(ft.team_id), ft.kickoff);
    const gain = cb !== null && (sm === null || cb > sm);
    if (gain) {
      gainers++;
      if (sm === null) fromEmpty++;
      if (examples.length < 12) examples.push({ match_id: ft.match_id, team_id: ft.team_id, kickoff: ft.kickoff, sm_newest: sm, combined_newest: cb });
    }
  }
  const res: PopResult = {
    fixtures: fixtureCount, team_fixtures: fts.length, unresolved,
    gainers, gainers_share: fts.length ? Number((gainers / fts.length).toFixed(4)) : null,
    gainers_from_empty_sm: fromEmpty, examples,
  };
  console.log(`[freshness] ${name}: fixture=${fixtureCount} tim-fixture=${fts.length} tak-teresolusi=${unresolved} gainers=${gainers} (${res.gainers_share}) dari-SM-kosong=${fromEmpty}`);
  return res;
}

function main(): void {
  // Populasi (i): slate terakhir
  const slate = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tasks", "pick-slate-latest.json"), "utf8")) as {
    generated_at: string;
    rated: { match_id: string; utc_date: string }[];
  };
  const pop1: FixtureTeam[] = [];
  let unres1 = 0;
  const lookup = uf.prepare(`SELECT home_team_id, away_team_id, competition_id FROM upcoming_fixtures WHERE match_id = ?`);
  for (const f of slate.rated) {
    const row = lookup.get(f.match_id) as unknown as { home_team_id: string; away_team_id: string; competition_id: string | null } | undefined;
    if (!row) { unres1 += 2; continue; }
    const kickoff = f.utc_date.slice(0, 10);
    pop1.push({ match_id: f.match_id, kickoff, competition_id: row.competition_id, team_id: row.home_team_id, side: "home" });
    pop1.push({ match_id: f.match_id, kickoff, competition_id: row.competition_id, team_id: row.away_team_id, side: "away" });
  }
  const r1 = measure(`(i) slate terakhir ${slate.generated_at}`, pop1, unres1, slate.rated.length);

  // Populasi (ii): akhir pekan klub 20–24 Nov 2026
  const rows2 = uf.prepare(
    `SELECT match_id, utc_date, competition_id, home_team_id, away_team_id FROM upcoming_fixtures
     WHERE utc_date >= '2026-11-20' AND utc_date < '2026-11-25' ORDER BY utc_date`,
  ).all() as unknown as { match_id: string; utc_date: string; competition_id: string | null; home_team_id: string; away_team_id: string }[];
  const pop2: FixtureTeam[] = [];
  for (const f of rows2) {
    const kickoff = f.utc_date.slice(0, 10);
    pop2.push({ match_id: f.match_id, kickoff, competition_id: f.competition_id, team_id: f.home_team_id, side: "home" });
    pop2.push({ match_id: f.match_id, kickoff, competition_id: f.competition_id, team_id: f.away_team_id, side: "away" });
  }
  const r2 = measure("(ii) upcoming 20–24 Nov 2026", pop2, 0, rows2.length);

  const totalGainers = r1.gainers + r2.gainers;
  const share2 = r2.gainers_share ?? 0;
  const pass = totalGainers >= 10 && share2 >= 0.05;
  console.log(`[freshness] GATE (c): gainers total=${totalGainers} (≥10), share populasi (ii)=${share2} (≥0,05) → ${pass ? "MANFAAT NYATA" : "~NOL — ADOPSI GUGUR"}`);

  const out = {
    generated_at: new Date().toISOString(),
    rule: "tasks/telemetry-combined-arm-report.md §0 kriteria (c)",
    populations: { slate_latest: r1, upcoming_2026_11_20_24: r2 },
    gate_c: { total_gainers: totalGainers, share_population_ii: share2, thresholds: { min_total_gainers: 10, min_share_ii: 0.05 }, benefit_real: pass },
  };
  fs.writeFileSync(path.join(process.cwd(), "tasks", "telemetry-freshness.json"), JSON.stringify(out, null, 2));
  console.log(`[freshness] → tasks/telemetry-freshness.json`);
}

main();
