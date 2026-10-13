import fs from "node:fs";
import path from "node:path";
import { getMasterDb } from "../lib/db/sqlite-master";

export interface TeamRating {
  name: string;
  attack: number;   // alpha_i (mean = 1.0)
  defense: number;  // beta_i (mean = 1.0, lower is better)
  matchesCount: number;
  goalsScored: number;
  goalsConceded: number;
  lastMatchDate: string;
}

export interface LeagueCalibratedParameters {
  div: string;
  leagueName: string;
  country: string;
  seasonCount: number;
  totalMatches: number;
  leagueAvgGoals: number; // bar{G}
  homeAdvantage: number;  // gamma
  rho: number;            // low-score dependency parameter
  calibrationDate: string;
  teams: Record<string, TeamRating>;
}

export interface CalibratedRatingsFile {
  version: string;
  compiledAt: string;
  totalLeagues: number;
  totalTeams: number;
  leagues: Record<string, LeagueCalibratedParameters>;
}

const LEAGUE_METADATA: Record<string, { name: string; country: string }> = {
  E0: { name: "English Premier League", country: "England" },
  E1: { name: "English Championship", country: "England" },
  SP1: { name: "Spanish La Liga", country: "Spain" },
  SP2: { name: "Spanish Segunda Division", country: "Spain" },
  I1: { name: "Italian Serie A", country: "Italy" },
  I2: { name: "Italian Serie B", country: "Italy" },
  D1: { name: "German Bundesliga", country: "Germany" },
  D2: { name: "German 2. Bundesliga", country: "Germany" },
  F1: { name: "French Ligue 1", country: "France" },
  F2: { name: "French Ligue 2", country: "France" },
  N1: { name: "Dutch Eredivisie", country: "Netherlands" },
  B1: { name: "Belgian First Division A", country: "Belgium" },
  P1: { name: "Portuguese Primeira Liga", country: "Portugal" },
  SC0: { name: "Scottish Premiership", country: "Scotland" },
  T1: { name: "Turkish Super Lig", country: "Turkey" },
  G1: { name: "Greek Super League", country: "Greece" },
};

// Dixon-Coles half-life ~ 200 hari (xi = 0.0035/hari)
const XI = 0.0035;

function computeTimeWeight(matchDateStr: string, refDateStr: string): number {
  const matchDate = new Date(matchDateStr).getTime();
  const refDate = new Date(refDateStr).getTime();
  const diffDays = Math.max(0, (refDate - matchDate) / (1000 * 60 * 60 * 24));
  return Math.exp(-XI * diffDays);
}

function tau(x: number, y: number, lambda: number, mu: number, rho: number): number {
  if (x === 0 && y === 0) return 1 - lambda * mu * rho;
  if (x === 0 && y === 1) return 1 + lambda * rho;
  if (x === 1 && y === 0) return 1 + mu * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

function calibrateDivision(db: any, div: string): LeagueCalibratedParameters | null {
  const meta = LEAGUE_METADATA[div] || { name: div, country: "Europe" };

  // Ambil semua match terurut tanggal
  const matches = db.prepare(`
    SELECT date, home_team, away_team, fthg, ftag 
    FROM matches 
    WHERE div = ? AND fthg IS NOT NULL AND ftag IS NOT NULL
    ORDER BY date ASC
  `).all(div) as { date: string; home_team: string; away_team: string; fthg: number; ftag: number }[];

  if (matches.length < 50) return null;

  const refDate = matches[matches.length - 1].date;

  // Kumpulkan list tim
  const teamSet = new Set<string>();
  let totalGoals = 0;
  for (const m of matches) {
    teamSet.add(m.home_team);
    teamSet.add(m.away_team);
    totalGoals += m.fthg + m.ftag;
  }
  const teams = Array.from(teamSet);
  const T = teams.length;
  const leagueAvgGoals = totalGoals / (matches.length * 2);

  // Inisialisasi parameter
  const alpha: Record<string, number> = {};
  const beta: Record<string, number> = {};
  const matchCount: Record<string, number> = {};
  const goalsScored: Record<string, number> = {};
  const goalsConceded: Record<string, number> = {};
  const lastDate: Record<string, string> = {};

  for (const t of teams) {
    alpha[t] = 1.0;
    beta[t] = 1.0;
    matchCount[t] = 0;
    goalsScored[t] = 0;
    goalsConceded[t] = 0;
    lastDate[t] = "";
  }

  // Pre-compute bobot waktu & metrik dasar per match
  const weightedMatches = matches.map((m) => {
    const w = computeTimeWeight(m.date, refDate);
    matchCount[m.home_team]++;
    matchCount[m.away_team]++;
    goalsScored[m.home_team] += m.fthg;
    goalsConceded[m.home_team] += m.ftag;
    goalsScored[m.away_team] += m.ftag;
    goalsConceded[m.away_team] += m.fthg;
    if (m.date > lastDate[m.home_team]) lastDate[m.home_team] = m.date;
    if (m.date > lastDate[m.away_team]) lastDate[m.away_team] = m.date;

    return {
      home: m.home_team,
      away: m.away_team,
      x: m.fthg,
      y: m.ftag,
      w,
    };
  });

  let gamma = 1.18; // Default home advantage

  // Iterasi Bivariate Poisson MLE (Coordinate Ascent)
  const MAX_ITER = 35;
  for (let iter = 0; iter < MAX_ITER; iter++) {
    // 1. Update Attack (alpha)
    for (const t of teams) {
      let num = 0;
      let den = 0;
      for (const m of weightedMatches) {
        if (m.home === t) {
          num += m.w * m.x;
          den += m.w * beta[m.away] * gamma / leagueAvgGoals;
        } else if (m.away === t) {
          num += m.w * m.y;
          den += m.w * beta[m.home] / leagueAvgGoals;
        }
      }
      alpha[t] = den > 0 ? (num + 0.1) / (den + 0.1) : 1.0;
    }

    // Normalisasi sum(alpha) = T
    let sumAlpha = 0;
    for (const t of teams) sumAlpha += alpha[t];
    const meanAlpha = sumAlpha / T;
    for (const t of teams) {
      alpha[t] /= meanAlpha;
    }

    // 2. Update Defense (beta)
    for (const t of teams) {
      let num = 0;
      let den = 0;
      for (const m of weightedMatches) {
        if (m.home === t) {
          num += m.w * m.y;
          den += m.w * alpha[m.away] / leagueAvgGoals;
        } else if (m.away === t) {
          num += m.w * m.x;
          den += m.w * alpha[m.home] * gamma / leagueAvgGoals;
        }
      }
      beta[t] = den > 0 ? (num + 0.1) / (den + 0.1) : 1.0;
    }

    // 3. Update Home Advantage (gamma)
    let homeNum = 0;
    let homeDen = 0;
    for (const m of weightedMatches) {
      homeNum += m.w * m.x;
      homeDen += m.w * (alpha[m.home] * beta[m.away] / leagueAvgGoals);
    }
    if (homeDen > 0) {
      gamma = Math.min(1.4, Math.max(1.05, homeNum / homeDen));
    }
  }

  // 4. Kalibrasi Rho (Grid Search atas -0.15 s/d 0.05)
  let bestRho = -0.04;
  let bestLogLik = -Infinity;

  for (let r = -0.12; r <= 0.02; r += 0.01) {
    let logLik = 0;
    for (const m of weightedMatches) {
      const lambda = (alpha[m.home] * beta[m.away] / leagueAvgGoals) * gamma;
      const mu = (alpha[m.away] * beta[m.home] / leagueAvgGoals);
      const adj = tau(m.x, m.y, lambda, mu, r);
      if (adj > 0) {
        logLik += m.w * Math.log(adj);
      }
    }
    if (logLik > bestLogLik) {
      bestLogLik = logLik;
      bestRho = Number(r.toFixed(3));
    }
  }

  // Siapkan map hasil
  const teamRatings: Record<string, TeamRating> = {};
  for (const t of teams) {
    teamRatings[t] = {
      name: t,
      attack: Number(alpha[t].toFixed(3)),
      defense: Number(beta[t].toFixed(3)),
      matchesCount: matchCount[t],
      goalsScored: goalsScored[t],
      goalsConceded: goalsConceded[t],
      lastMatchDate: lastDate[t],
    };
  }

  return {
    div,
    leagueName: meta.name,
    country: meta.country,
    seasonCount: 4,
    totalMatches: matches.length,
    leagueAvgGoals: Number(leagueAvgGoals.toFixed(3)),
    homeAdvantage: Number(gamma.toFixed(3)),
    rho: bestRho,
    calibrationDate: refDate,
    teams: teamRatings,
  };
}

async function run() {
  console.log("==================================================================");
  console.log("🧮 MEMULAI KALIBRASI MODEL KUANTITATIF DIXON-COLES (MLE)");
  console.log("==================================================================\n");

  const db = getMasterDb();
  const divsRow = db.prepare("SELECT DISTINCT div FROM matches ORDER BY div ASC").all() as { div: string }[];
  const targetDivs = divsRow.map((r) => r.div);

  console.log(`🔍 Memproses ${targetDivs.length} divisi sepak bola...\n`);

  const output: CalibratedRatingsFile = {
    version: "2.0-dixon-coles-mle",
    compiledAt: new Date().toISOString(),
    totalLeagues: 0,
    totalTeams: 0,
    leagues: {},
  };

  let grandTotalTeams = 0;

  for (const div of targetDivs) {
    process.stdout.write(`  [${div.padEnd(4)}] Kalibrasi parameter MLE... `);
    const result = calibrateDivision(db, div);

    if (!result) {
      console.log(`⚠️ Data tidak cukup (< 50 laga)`);
      continue;
    }

    const teamCount = Object.keys(result.teams).length;
    grandTotalTeams += teamCount;
    output.leagues[div] = result;
    output.totalLeagues++;

    // Tampilkan 2 tim teratas dan terbawah berdasarkan attack
    const sortedTeams = Object.values(result.teams).sort((a, b) => b.attack - a.attack);
    const topTeam = sortedTeams[0];
    const solidDefTeam = Object.values(result.teams).sort((a, b) => a.defense - b.defense)[0];

    console.log(`✅ OK (${result.totalMatches} match, ${teamCount} tim | γ=${result.homeAdvantage}, ρ=${result.rho})`);
    console.log(`       Top Serang: ${topTeam.name} (α=${topTeam.attack}) | Pertahanan Terbaik: ${solidDefTeam.name} (β=${solidDefTeam.defense})`);
  }

  output.totalTeams = grandTotalTeams;

  const outputPath = path.join(process.cwd(), "data", "calibrated_ratings.json");
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");

  const stats = fs.statSync(outputPath);

  console.log("\n==================================================================");
  console.log("🎉 KALIBRASI SELESAI!");
  console.log(`💾 File Output : ${outputPath}`);
  console.log(`📊 Ukuran File : ${(stats.size / 1024).toFixed(1)} KB`);
  console.log(`🏆 Total Liga  : ${output.totalLeagues} divisi`);
  console.log(`👥 Total Tim   : ${output.totalTeams} klub`);
  console.log("==================================================================\n");
}

run().catch((err) => {
  console.error("FATAL ERROR KALIBRASI:", err);
  process.exit(1);
});
