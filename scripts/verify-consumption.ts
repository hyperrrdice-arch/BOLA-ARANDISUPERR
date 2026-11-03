/**
 * VERIFIKASI KONSUMSI STORE BARU (Fase 1 overhaul backend).
 *
 * Mengukur, atas SELURUH katalog upcoming_fixtures:
 *  - berapa fixture yang kompetisinya ter-resolve ke divisi ratings,
 *  - berapa yang kedua timnya ditemukan di ratings divisi itu
 *    (matched penuh / satu sisi / nol),
 *  - status gerbang kalibrasi divisinya (registry league_calibration).
 * Dan audit kunci tim di calibrated_ratings.json: kunci harus stabil
 * terhadap normalizeTeamName (loader mencari dengan nama ternormalisasi).
 *
 * Read-only. Pakai: npx tsx scripts/verify-consumption.ts
 */
import { loadCalibratedRatings, findTeamRating, resolveDivForMatch } from "../lib/quant/ratings-loader";
import { normalizeTeamName } from "../lib/quant/team-normalizer";
import { getUpcomingDb } from "../lib/db/upcoming-fixtures";
import { getLeagueGate } from "../lib/quant/league-gate";

function main() {
  const data = loadCalibratedRatings();
  if (!data) {
    console.error("calibrated_ratings.json tidak terbaca.");
    process.exit(1);
  }

  // --- Audit kunci tim JSON ---
  let keyMismatch = 0,
    keyTotal = 0;
  const examples: string[] = [];
  for (const [div, lg] of Object.entries(data.leagues)) {
    for (const key of Object.keys(lg.teams)) {
      keyTotal++;
      if (normalizeTeamName(key) !== key) {
        keyMismatch++;
        if (examples.length < 10) examples.push(`${div}: "${key}" -> "${normalizeTeamName(key)}"`);
      }
    }
  }
  console.log(`[kunci JSON] total ${keyTotal} tim, berubah saat dinormalisasi: ${keyMismatch}`);
  examples.forEach((e) => console.log("   ", e));

  // --- Cakupan per fixture ---
  const db = getUpcomingDb();
  const rows = db
    .prepare(
      "SELECT match_id, competition_id, competition_name, home_team_name, away_team_name FROM upcoming_fixtures ORDER BY competition_id"
    )
    .all() as {
    match_id: string;
    competition_id: string | null;
    competition_name: string | null;
    home_team_name: string | null;
    away_team_name: string | null;
  }[];

  let both = 0,
    one = 0,
    none = 0,
    noDiv = 0;
  const perComp = new Map<string, { name: string; n: number; ok: number; div: string | null; gate: string }>();
  for (const r of rows) {
    const div = resolveDivForMatch(data, r.competition_name, r.home_team_name ?? "", r.away_team_name ?? "");
    const key = r.competition_id ?? "?";
    const pc =
      perComp.get(key) ??
      ({ name: r.competition_name ?? "?", n: 0, ok: 0, div, gate: div ? (getLeagueGate(div)?.status ?? "unknown") : "-" } as const);
    pc.n++;
    if (!div) {
      noDiv++;
      perComp.set(key, pc);
      continue;
    }
    const h = findTeamRating(data, div, normalizeTeamName(r.home_team_name ?? ""));
    const a = findTeamRating(data, div, normalizeTeamName(r.away_team_name ?? ""));
    if (h && a) {
      both++;
      pc.ok++;
    } else if (h || a) one++;
    else none++;
    perComp.set(key, pc);
  }
  console.log(
    `[fixture] total ${rows.length}: div-gagal ${noDiv}, kedua tim ketemu ${both}, satu sisi ${one}, nol ${none}`
  );
  const bad = [...perComp.entries()]
    .filter(([, v]) => v.ok < v.n)
    .sort((a, b) => b[1].n - b[1].ok - (a[1].n - a[1].ok));
  console.log(`[fixture] kompetisi tak ter-cover penuh: ${bad.length} dari ${perComp.size}`);
  for (const [k, v] of bad.slice(0, 25)) {
    console.log(`    ${k} (${v.name}) div=${v.div ?? "-"} gerbang=${v.gate}: ${v.ok}/${v.n}`);
  }
  const full = [...perComp.values()].filter((v) => v.ok === v.n).length;
  console.log(`[fixture] kompetisi ter-cover penuh: ${full}/${perComp.size}`);
}

main();
