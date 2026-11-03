/**
 * KALIBRASI RATING LIGA BARU (BLOK E) — fit IPF attack/defense dengan
 * time-decay dari store hasil Sportmonks (dataset.matches, match_id sm_*),
 * memperluas data/calibrated_ratings.json TANPA mengubah 16 liga legacy,
 * dan menulis registry `league_calibration` di thestats_dataset.db.
 *
 * Parameterisasi sama persis dengan yang dibaca lib/quant/ratings-loader.ts:
 *   λ_home = leagueAvgGoals × attack_home × defense_away × homeAdvantage
 *   λ_away = leagueAvgGoals × attack_away × defense_home
 *   dengan leagueAvgGoals = rata-rata gol tim AWAY, homeAdvantage = μH/μA,
 *   attack & defense ternormalisasi ke rata-rata 1.
 * Bobot time-decay: w = 0.5^(umur_hari/365).
 *
 * Gerbang kualitas (keputusan PRD): status 'calibrated' hanya bila fit lolos
 * uji skala (Σλ vs Σ gol aktual, toleransi 2%) DAN cakupan telemetri musim
 * berjalan ≥80%. Fit yang gagal gerbang → 'partial'. Piala/lintas-negara dan
 * liga data-tipis → 'uncalibrated' (tetap tercatat eksplisit di registry).
 *
 * Pakai: npx tsx scripts/calibrate-ratings.ts [--min-matches=30]
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

const args = process.argv.slice(2);
const MIN_MATCHES = (() => {
  const hit = args.find((a) => a.startsWith("--min-matches="));
  return hit ? Number(hit.split("=")[1]) : 30;
})();

function dataPath(file: string): string {
  return path.join(process.cwd(), "data", file);
}

interface MatchRow {
  competition_id: string; season: string; utc_date: string;
  home_team_id: string; away_team_id: string; home_score: number; away_score: number;
}

interface FitResult {
  leagueAvgGoals: number; homeAdvantage: number;
  attack: Map<string, number>; defense: Map<string, number>;
  scaleRatio: number; nMatches: number;
}

/** IPF dengan bobot waktu; parameterisasi identik ratings-loader. */
function fitLeague(matches: MatchRow[], nowMs: number): FitResult | null {
  const teams = new Set<string>();
  for (const m of matches) { teams.add(m.home_team_id); teams.add(m.away_team_id); }
  if (teams.size < 4) return null;
  const w = matches.map((m) => Math.pow(0.5, (nowMs - Date.parse(m.utc_date)) / (365 * 86400_000)));
  let wSum = 0, hSum = 0, aSum = 0;
  matches.forEach((m, i) => { wSum += w[i]; hSum += w[i] * m.home_score; aSum += w[i] * m.away_score; });
  const muH = hSum / wSum;
  const muA = aSum / wSum;
  if (!(muA > 0) || !(muH > 0)) return null;
  const lgAvg = muA;
  const ha = muH / muA;
  const attack = new Map<string, number>();
  const defense = new Map<string, number>();
  for (const t of teams) { attack.set(t, 1); defense.set(t, 1); }

  const lamHome = (m: MatchRow) => lgAvg * (attack.get(m.home_team_id) ?? 1) * (defense.get(m.away_team_id) ?? 1) * ha;
  const lamAway = (m: MatchRow) => lgAvg * (attack.get(m.away_team_id) ?? 1) * (defense.get(m.home_team_id) ?? 1);

  for (let iter = 0; iter < 200; iter++) {
    let maxDelta = 0;
    // Serangan: untuk tiap tim, gol dicetak (home: λ_home; away: λ_away tanpa HA)
    for (const t of teams) {
      let num = 0, den = 0;
      matches.forEach((m, i) => {
        if (m.home_team_id === t) { num += w[i] * m.home_score; den += w[i] * (lamHome(m) / (attack.get(t) ?? 1)); }
        if (m.away_team_id === t) { num += w[i] * m.away_score; den += w[i] * (lamAway(m) / (attack.get(t) ?? 1)); }
      });
      if (den > 0 && num >= 0) {
        const next = num / den;
        maxDelta = Math.max(maxDelta, Math.abs(next - (attack.get(t) ?? 1)));
        attack.set(t, next);
      }
    }
    // Pertahanan: gol kemasukan
    for (const t of teams) {
      let num = 0, den = 0;
      matches.forEach((m, i) => {
        if (m.away_team_id === t) { num += w[i] * m.home_score; den += w[i] * (lamHome(m) / (defense.get(t) ?? 1)); }
        if (m.home_team_id === t) { num += w[i] * m.away_score; den += w[i] * (lamAway(m) / (defense.get(t) ?? 1)); }
      });
      if (den > 0 && num >= 0) {
        const next = num / den;
        maxDelta = Math.max(maxDelta, Math.abs(next - (defense.get(t) ?? 1)));
        defense.set(t, next);
      }
    }
    // Normalisasi rata-rata 1 (produk λ tidak berubah: att×c, def÷c).
    const mean = (mp: Map<string, number>) => [...mp.values()].reduce((s, v) => s + v, 0) / mp.size;
    const ma = mean(attack), md = mean(defense);
    if (ma > 0) for (const t of teams) attack.set(t, (attack.get(t) ?? 1) / ma);
    if (md > 0) for (const t of teams) defense.set(t, (defense.get(t) ?? 1) / md);
    if (maxDelta < 1e-7) break;
  }
  // Uji skala: Σλ (tanpa bobot, seluruh match) vs Σ gol aktual.
  let lam = 0, goals = 0;
  for (const m of matches) { lam += lamHome(m) + lamAway(m); goals += m.home_score + m.away_score; }
  return { leagueAvgGoals: lgAvg, homeAdvantage: ha, attack, defense, scaleRatio: goals > 0 ? lam / goals : 0, nMatches: matches.length };
}

function main() {
  const ds = new DatabaseSync(dataPath("thestats_dataset.db"));
  ds.exec("PRAGMA journal_mode = WAL;");
  ds.exec("PRAGMA busy_timeout = 120000;");
  ds.exec(
    `CREATE TABLE IF NOT EXISTS league_calibration (
      league_id TEXT PRIMARY KEY,
      league_name TEXT,
      country TEXT,
      tier TEXT,
      status TEXT NOT NULL,
      n_matches INTEGER NOT NULL DEFAULT 0,
      n_teams INTEGER NOT NULL DEFAULT 0,
      telemetry_coverage REAL,
      scale_ratio REAL,
      fitted_at TEXT,
      source TEXT NOT NULL,
      notes TEXT
    )`,
  );
  const up = new DatabaseSync(dataPath("upcoming_fixtures.db"), { readOnly: true });
  const catalog = up
    .prepare("SELECT competition_id, name, country FROM competition_catalog WHERE competition_id LIKE 'sm:%'")
    .all() as { competition_id: string; name: string; country: string | null }[];

  const teamName = new Map<string, string>();
  for (const t of ds.prepare("SELECT team_id, name FROM teams").all() as { team_id: string; name: string }[]) {
    teamName.set(t.team_id, t.name);
  }

  const ratingsPath = dataPath("calibrated_ratings.json");
  const ratings = JSON.parse(fs.readFileSync(ratingsPath, "utf8")) as {
    version: string; compiledAt: string; totalLeagues: number; totalTeams: number;
    leagues: Record<string, Record<string, unknown>>;
  };

  // Tabel tier resmi sprint (tasks/tier-table.json, dari classifyTier yang
  // sama dengan backfill-telemetry.ts) untuk kolom tier registry.
  const tierByLeague = new Map<string, string>();
  try {
    const tt = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "tasks", "tier-table.json"), "utf8"),
    ) as { league_id: string; tier: string }[];
    for (const r of tt) tierByLeague.set(r.league_id, r.tier);
  } catch { /* tier dikosongkan bila tabel belum dibuat */ }

  const insReg = ds.prepare(
    `INSERT OR REPLACE INTO league_calibration
     (league_id, league_name, country, tier, status, n_matches, n_teams, telemetry_coverage, scale_ratio, fitted_at, source, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = new Date();
  const nowIso = now.toISOString();
  let nCal = 0, nPart = 0, nUncal = 0, addedTeams = 0;

  // Liga legacy: tercatat sebagai calibrated dari file rating yang sudah ada.
  for (const [div, lg] of Object.entries(ratings.leagues)) {
    if (div.startsWith("SM")) continue;
    insReg.run(
      div, String(lg.leagueName ?? div), String(lg.country ?? ""), null, "calibrated",
      Number(lg.totalMatches ?? 0), Object.keys((lg.teams as object) ?? {}).length,
      null, null, String(lg.calibrationDate ?? ""), "legacy-csv-fit", "Rating warisan (football-data) yang sudah terpasang sebelum sprint.",
    );
  }

  for (const cat of catalog) {
    const leagueId = cat.competition_id;
    const isCup = /cup|beker|pokal|coupe|coppa|copa|ta[çc]a|kupa|trofeo|play-?offs?|friendl|shield|trophy/i.test(cat.name) || cat.country === "Europe";
    const matches = ds
      .prepare(
        `SELECT competition_id, season, utc_date, home_team_id, away_team_id, home_score, away_score
         FROM matches WHERE competition_id = ? AND status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL
         ORDER BY utc_date`,
      )
      .all(leagueId) as MatchRow[];
    const teamSet = new Set<string>();
    for (const m of matches) { teamSet.add(m.home_team_id); teamSet.add(m.away_team_id); }

    // Cakupan telemetri musim berjalan: logs SM / (2 × match selesai musim ini).
    const seasons = [...new Set(matches.map((m) => m.season))].sort();
    const currentSeason = seasons[seasons.length - 1];
    let coverage: number | null = null;
    if (currentSeason) {
      const cur = matches.filter((m) => m.season === currentSeason);
      if (cur.length > 0) {
        const logged = (
          ds.prepare(
            `SELECT COUNT(*) AS n FROM team_match_logs
             WHERE source = 'sportmonks' AND season = ? AND match_id IN
               (SELECT match_id FROM matches WHERE competition_id = ?)`,
          ).get(currentSeason, leagueId) as { n: number }
        ).n;
        coverage = Math.min(1, logged / (2 * cur.length));
      }
    }

    if (isCup) {
      insReg.run(leagueId, cat.name, cat.country, tierByLeague.get(leagueId) ?? null, "uncalibrated", matches.length, teamSet.size,
        coverage, null, null, "sportmonks-fit", "Kompetisi piala/lintas-negara — tidak difit per-liga (di luar parameterisasi rating liga).");
      nUncal += 1;
      continue;
    }
    if (matches.length < MIN_MATCHES) {
      insReg.run(leagueId, cat.name, cat.country, tierByLeague.get(leagueId) ?? null, "uncalibrated", matches.length, teamSet.size,
        coverage, null, null, "sportmonks-fit", `Data hasil belum cukup untuk fit (n=${matches.length} < ${MIN_MATCHES}).`);
      nUncal += 1;
      continue;
    }
    const fit = fitLeague(matches, now.getTime());
    if (!fit) {
      insReg.run(leagueId, cat.name, cat.country, tierByLeague.get(leagueId) ?? null, "uncalibrated", matches.length, teamSet.size,
        coverage, null, null, "sportmonks-fit", "Fit gagal (tim/gol tidak memadai).");
      nUncal += 1;
      continue;
    }
    const scalePass = Math.abs(fit.scaleRatio - 1) <= 0.02;
    const covPass = coverage != null && coverage >= 0.8;
    const status = scalePass && covPass ? "calibrated" : "partial";
    if (status === "calibrated") nCal += 1; else nPart += 1;

    // Hanya liga 'calibrated' yang masuk JSON (himpunan yang boleh disajikan
    // tanpa flag). Fit 'partial' hidup di registry sebagai audit dan bisa
    // direproduksi kapan pun dengan menjalankan ulang skrip ini.
    const key = `SM${leagueId.slice(3)}`;
    const perTeam = new Map<string, { matchesCount: number; goalsScored: number; goalsConceded: number; lastMatchDate: string }>();
    for (const m of matches) {
      for (const [tid, gf, ga] of [[m.home_team_id, m.home_score, m.away_score], [m.away_team_id, m.away_score, m.home_score]] as const) {
        const cur2 = perTeam.get(tid) ?? { matchesCount: 0, goalsScored: 0, goalsConceded: 0, lastMatchDate: "" };
        cur2.matchesCount += 1; cur2.goalsScored += gf; cur2.goalsConceded += ga;
        if (m.utc_date > cur2.lastMatchDate) cur2.lastMatchDate = m.utc_date;
        perTeam.set(tid, cur2);
      }
    }
    const teamsJson: Record<string, unknown> = {};
    for (const [tid, agg] of perTeam) {
      const name = teamName.get(tid) ?? tid;
      teamsJson[name] = {
        name,
        attack: Number((fit.attack.get(tid) ?? 1).toFixed(4)),
        defense: Number((fit.defense.get(tid) ?? 1).toFixed(4)),
        matchesCount: agg.matchesCount,
        goalsScored: agg.goalsScored,
        goalsConceded: agg.goalsConceded,
        lastMatchDate: agg.lastMatchDate.slice(0, 10),
      };
      if (status === "calibrated") addedTeams += 1;
    }
    if (status === "calibrated") ratings.leagues[key] = {
      div: key,
      leagueName: cat.name,
      country: cat.country ?? "",
      seasonCount: seasons.length,
      totalMatches: matches.length,
      leagueAvgGoals: Number(fit.leagueAvgGoals.toFixed(4)),
      homeAdvantage: Number(fit.homeAdvantage.toFixed(4)),
      rho: 0,
      calibrationDate: nowIso.slice(0, 10),
      source: "sportmonks-fit",
      calibrationStatus: status,
      fitMethod: "ipf-time-decay-half-life-365d",
      teams: teamsJson,
    };
    insReg.run(leagueId, cat.name, cat.country, tierByLeague.get(leagueId) ?? null, status, matches.length, teamSet.size,
      coverage, Number(fit.scaleRatio.toFixed(4)), nowIso, "sportmonks-fit",
      status === "calibrated" ? "Lolos uji skala + cakupan telemetri ≥80%." : `Gerbang gagal: skala=${fit.scaleRatio.toFixed(3)} cakupan=${coverage == null ? "n/a" : coverage.toFixed(2)}.`);
  }

  ratings.totalLeagues = Object.keys(ratings.leagues).length;
  ratings.totalTeams = Object.values(ratings.leagues).reduce(
    (s, lg) => s + Object.keys((lg.teams as object) ?? {}).length, 0,
  );
  ratings.compiledAt = nowIso;
  fs.writeFileSync(ratingsPath, JSON.stringify(ratings, null, 2));
  console.log(`Registry: calibrated+partial baru=${nCal + nPart} (calibrated ${nCal}, partial ${nPart}), uncalibrated ${nUncal}; entri tim tertulis ${addedTeams}.`);
  console.log(`calibrated_ratings.json: ${ratings.totalLeagues} liga, ${ratings.totalTeams} tim.`);
}

main();
