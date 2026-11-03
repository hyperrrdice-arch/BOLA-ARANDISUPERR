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
 *        [--half-life-days=365] [--rho-mode=zero|global:<v>|fitted]
 *
 * Parameter fit (half-life decay + kebijakan rho) dipilih dari validasi
 * walk-forward out-of-sample (scripts/backtest-walkforward.ts, Fase 3
 * overhaul backend) — BUKAN dari performa in-sample. Gerbang status:
 * uji skala + cakupan telemetri (di bawah) DAN gerbang OOS bila
 * tasks/oos-gate.json tersedia (log-loss held-out harus mengalahkan
 * baseline naive liga, kalau tidak status diturunkan ke partial).
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { poissonLogProb, tauAdjustment } from "../lib/quant/dixon-coles";

const args = process.argv.slice(2);
const MIN_MATCHES = (() => {
  const hit = args.find((a) => a.startsWith("--min-matches="));
  return hit ? Number(hit.split("=")[1]) : 30;
})();
const HALF_LIFE_DAYS = (() => {
  const hit = args.find((a) => a.startsWith("--half-life-days="));
  const v = hit ? Number(hit.split("=")[1]) : 365;
  return Number.isFinite(v) && v > 0 ? v : 365;
})();
const RHO_MODE = (() => {
  const hit = args.find((a) => a.startsWith("--rho-mode="));
  return hit ? hit.split("=")[1] : "zero";
})();
/**
 * Shrinkage fit: attack/defense tiap tim di-shrink log-space menuju 1,0
 * dengan bobot n_tim/(n_tim+κ). Default κ=10 DIPILIH walk-forward
 * out-of-sample (Fase 3, tasks/oos-results.json): held-out log-loss
 * 1,0503 → 1,0298 dan ECE 0,0187 → 0,0096 vs tanpa shrinkage. Memperbaiki
 * ledakan skala IPF pada tim bermatch sedikit (promosi/degradasi).
 * --shrink-kappa=0 menonaktifkan (perilaku pra-Fase-3).
 */
const SHRINK_KAPPA = (() => {
  const hit = args.find((a) => a.startsWith("--shrink-kappa="));
  const v = hit ? Number(hit.split("=")[1]) : 10;
  return Number.isFinite(v) && v >= 0 ? v : 10;
})();

// Rumus Poisson-log + tau Dixon-Coles diambil dari modul kanonis
// lib/quant/dixon-coles.ts (poissonLogProb / tauAdjustment) — jangan
// diduplikasi di sini agar fit offline tidak pernah divergen dari produksi.

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
  /** Lambda per match (selaras urutan `matches`) untuk fit rho. */
  lamHome: number[]; lamAway: number[];
  /** Bobot decay per match (dipakai fit rho agar konsisten dengan fit IPF). */
  weights: number[];
}

/** IPF dengan bobot waktu; parameterisasi identik ratings-loader. */
function fitLeague(matches: MatchRow[], nowMs: number, halfLifeDays: number = HALF_LIFE_DAYS): FitResult | null {
  // IPF linear O(match) per iterasi (tim diindeks, array datar) — update
  // multiplikatifnya IDENTIK dengan implementasi lama yang memindai semua
  // match per tim per iterasi (O(tim × match)): λ/att_t menyisakan
  // lgAvg × def_lawan (× HA) sehingga den penyebut bisa diakumulasi satu
  // lintasan. Ekuivalensi terverifikasi 2026-11-04: selisih parameter
  // maksimum 4,4e-16 pada sm:8/sm:1034/sm:779, runtime 50–300× lebih cepat.
  const teamIdx = new Map<string, number>();
  for (const m of matches) {
    if (!teamIdx.has(m.home_team_id)) teamIdx.set(m.home_team_id, teamIdx.size);
    if (!teamIdx.has(m.away_team_id)) teamIdx.set(m.away_team_id, teamIdx.size);
  }
  const T = teamIdx.size;
  const n = matches.length;
  if (T < 4 || n === 0) return null;
  const hi = new Int32Array(n), ai = new Int32Array(n);
  const hs = new Float64Array(n), as = new Float64Array(n), w = new Float64Array(n);
  let wSum = 0, hSum = 0, aSum = 0;
  for (let i = 0; i < n; i++) {
    const m = matches[i];
    hi[i] = teamIdx.get(m.home_team_id)!;
    ai[i] = teamIdx.get(m.away_team_id)!;
    hs[i] = m.home_score; as[i] = m.away_score;
    w[i] = Math.pow(0.5, (nowMs - Date.parse(m.utc_date)) / (halfLifeDays * 86400_000));
    wSum += w[i]; hSum += w[i] * hs[i]; aSum += w[i] * as[i];
  }
  const muH = hSum / wSum;
  const muA = aSum / wSum;
  if (!(muA > 0) || !(muH > 0)) return null;
  const lgAvg = muA;
  const ha = muH / muA;
  const attack = new Float64Array(T).fill(1);
  const defense = new Float64Array(T).fill(1);
  const baseH = new Float64Array(n), baseA = new Float64Array(n);
  const num = new Float64Array(T), den = new Float64Array(T);
  for (let iter = 0; iter < 200; iter++) {
    let maxDelta = 0;
    // Serangan
    for (let i = 0; i < n; i++) { baseH[i] = lgAvg * defense[ai[i]] * ha; baseA[i] = lgAvg * defense[hi[i]]; }
    num.fill(0); den.fill(0);
    for (let i = 0; i < n; i++) {
      num[hi[i]] += w[i] * hs[i]; den[hi[i]] += w[i] * baseH[i];
      num[ai[i]] += w[i] * as[i]; den[ai[i]] += w[i] * baseA[i];
    }
    for (let t = 0; t < T; t++) {
      if (den[t] > 0) {
        const next = num[t] / den[t];
        const d = Math.abs(next - attack[t]);
        if (d > maxDelta) maxDelta = d;
        attack[t] = next;
      }
    }
    // Pertahanan
    for (let i = 0; i < n; i++) { baseH[i] = lgAvg * attack[hi[i]] * ha; baseA[i] = lgAvg * attack[ai[i]]; }
    num.fill(0); den.fill(0);
    for (let i = 0; i < n; i++) {
      num[ai[i]] += w[i] * hs[i]; den[ai[i]] += w[i] * baseH[i];
      num[hi[i]] += w[i] * as[i]; den[hi[i]] += w[i] * baseA[i];
    }
    for (let t = 0; t < T; t++) {
      if (den[t] > 0) {
        const next = num[t] / den[t];
        const d = Math.abs(next - defense[t]);
        if (d > maxDelta) maxDelta = d;
        defense[t] = next;
      }
    }
    // Normalisasi rata-rata 1
    let ma = 0, md = 0;
    for (let t = 0; t < T; t++) { ma += attack[t]; md += defense[t]; }
    ma /= T; md /= T;
    if (ma > 0) for (let t = 0; t < T; t++) attack[t] /= ma;
    if (md > 0) for (let t = 0; t < T; t++) defense[t] /= md;
    if (maxDelta < 1e-7) break;
  }
  // Shrinkage fit (lihat SHRINK_KAPPA): diterapkan SEBELUM uji skala dan
  // penulisan ratings — parameter yang diuji gerbang = parameter tersaji.
  if (SHRINK_KAPPA > 0) {
    const counts = new Float64Array(T);
    for (let i = 0; i < n; i++) { counts[hi[i]]++; counts[ai[i]]++; }
    const shrinkArr = (arr: Float64Array) => {
      let sum = 0;
      for (let t = 0; t < T; t++) {
        const wgt = counts[t] / (counts[t] + SHRINK_KAPPA);
        arr[t] = Math.exp(Math.log(Math.max(1e-6, arr[t])) * wgt);
        sum += arr[t];
      }
      const mean = sum / T;
      if (mean > 0) for (let t = 0; t < T; t++) arr[t] /= mean;
    };
    shrinkArr(attack);
    shrinkArr(defense);
  }
  const attackMap = new Map<string, number>();
  const defenseMap = new Map<string, number>();
  for (const [team, idx] of teamIdx) { attackMap.set(team, attack[idx]); defenseMap.set(team, defense[idx]); }
  const lamHome = (m: MatchRow) => lgAvg * (attackMap.get(m.home_team_id) ?? 1) * (defenseMap.get(m.away_team_id) ?? 1) * ha;
  const lamAway = (m: MatchRow) => lgAvg * (attackMap.get(m.away_team_id) ?? 1) * (defenseMap.get(m.home_team_id) ?? 1);
  // Uji skala: Σλ (tanpa bobot, seluruh match) vs Σ gol aktual.
  let lam = 0, goals = 0;
  for (const m of matches) { lam += lamHome(m) + lamAway(m); goals += m.home_score + m.away_score; }
  return {
    leagueAvgGoals: lgAvg, homeAdvantage: ha, attack: attackMap, defense: defenseMap,
    scaleRatio: goals > 0 ? lam / goals : 0, nMatches: n,
    lamHome: matches.map((m) => lamHome(m)), lamAway: matches.map((m) => lamAway(m)),
    weights: Array.from(w),
  };
}

/**
 * Fit rho per liga: grid search memaksimalkan log-likelihood skor eksak
 * (terbobot decay yang sama dengan fit IPF) atas λ/μ hasil fit.
 * Kebijakan pemakaiannya (zero/global/fitted) dipilih via validasi OOS.
 */
function fitRho(matches: MatchRow[], fit: FitResult): number {
  let bestRho = 0;
  let bestLL = -Infinity;
  for (let rho = -0.20; rho <= 0.0501; rho += 0.005) {
    let ll = 0;
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const lam = fit.lamHome[i], mu = fit.lamAway[i];
      const tau = tauAdjustment(m.home_score, m.away_score, lam, mu, rho);
      if (tau <= 0) { ll = -Infinity; break; }
      ll += fit.weights[i] * (poissonLogProb(lam, m.home_score) + poissonLogProb(mu, m.away_score) + Math.log(tau));
    }
    if (ll > bestLL) { bestLL = ll; bestRho = rho; }
  }
  return Number(bestRho.toFixed(3));
}

function rhoForLeague(fit: FitResult, matches: MatchRow[]): number {
  if (RHO_MODE === "fitted") return fitRho(matches, fit);
  if (RHO_MODE.startsWith("global:")) {
    const v = Number(RHO_MODE.slice("global:".length));
    return Number.isFinite(v) ? v : 0;
  }
  return 0;
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

  // Gerbang OOS (Fase 3): hasil walk-forward held-out per liga, bila tersedia.
  // Liga yang log-loss held-out-nya TIDAK mengalahkan baseline naive tidak
  // boleh duduk di 'calibrated' — diturunkan ke 'partial' dengan catatan.
  const oosGate = new Map<string, { heldout_logloss: number; naive_logloss: number; n: number }>();
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "tasks", "oos-gate.json"), "utf8"),
    ) as Record<string, { heldout_logloss: number; naive_logloss: number; n: number }>;
    for (const [k, v] of Object.entries(raw)) oosGate.set(k, v);
  } catch { /* tanpa file gerbang OOS, status murni dari gerbang skala+cakupan */ }

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
      delete ratings.leagues[`SM${leagueId.slice(3)}`];
      insReg.run(leagueId, cat.name, cat.country, tierByLeague.get(leagueId) ?? null, "uncalibrated", matches.length, teamSet.size,
        coverage, null, null, "sportmonks-fit", "Kompetisi piala/lintas-negara — tidak difit per-liga (di luar parameterisasi rating liga).");
      nUncal += 1;
      continue;
    }
    if (matches.length < MIN_MATCHES) {
      delete ratings.leagues[`SM${leagueId.slice(3)}`];
      insReg.run(leagueId, cat.name, cat.country, tierByLeague.get(leagueId) ?? null, "uncalibrated", matches.length, teamSet.size,
        coverage, null, null, "sportmonks-fit", `Data hasil belum cukup untuk fit (n=${matches.length} < ${MIN_MATCHES}).`);
      nUncal += 1;
      continue;
    }
    const fit = fitLeague(matches, now.getTime(), HALF_LIFE_DAYS);
    if (!fit) {
      delete ratings.leagues[`SM${leagueId.slice(3)}`];
      insReg.run(leagueId, cat.name, cat.country, tierByLeague.get(leagueId) ?? null, "uncalibrated", matches.length, teamSet.size,
        coverage, null, null, "sportmonks-fit", "Fit gagal (tim/gol tidak memadai).");
      nUncal += 1;
      continue;
    }
    const scalePass = Math.abs(fit.scaleRatio - 1) <= 0.02;
    const covPass = coverage != null && coverage >= 0.8;
    let status: "calibrated" | "partial" = scalePass && covPass ? "calibrated" : "partial";
    let oosNote = "";
    const oos = oosGate.get(leagueId);
    // Lantai sampel gerbang OOS: demosi hanya bila bukti held-out cukup
    // (n >= 20) — sampel lebih kecil tidak cukup kuat untuk menjatuhkan
    // status, dan dicatat sebagai belum teruji, bukan lolos/gagal.
    // Kebijakan tangga: calibrated yang gagal OOS → partial; partial yang
    // gagal OOS → uncalibrated (diblokir) — model yang tidak mengalahkan
    // baseline naive secara out-of-sample tidak boleh tersaji sama sekali.
    const oosFail = !!oos && oos.n >= 20 && oos.heldout_logloss >= oos.naive_logloss;
    if (oosFail && status === "calibrated") {
      status = "partial";
      oosNote = ` Gerbang OOS gagal: log-loss held-out ${oos.heldout_logloss.toFixed(4)} >= naive ${oos.naive_logloss.toFixed(4)} (n=${oos.n}) → diturunkan ke partial.`;
    } else if (oosFail) {
      oosNote = ` Gerbang OOS gagal: log-loss held-out ${oos.heldout_logloss.toFixed(4)} >= naive ${oos.naive_logloss.toFixed(4)} (n=${oos.n}) → DIBLOKIR (uncalibrated).`;
      delete ratings.leagues[`SM${leagueId.slice(3)}`];
      insReg.run(leagueId, cat.name, cat.country, tierByLeague.get(leagueId) ?? null, "uncalibrated", matches.length, teamSet.size,
        coverage, Number(fit.scaleRatio.toFixed(4)), nowIso, "sportmonks-fit",
        `Lolos gerbang skala/cakupan sebagai partial, gugur di gerbang bukti.` + oosNote);
      nUncal += 1;
      continue;
    } else if (oos && oos.n >= 20) {
      oosNote = ` Gerbang OOS lolos: log-loss held-out ${oos.heldout_logloss.toFixed(4)} < naive ${oos.naive_logloss.toFixed(4)} (n=${oos.n}).`;
    } else if (oos) {
      oosNote = ` Gerbang OOS belum teruji: n held-out=${oos.n} < 20 (lantai sampel).`;
    }
    if (status === "calibrated") nCal += 1; else nPart += 1;

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
    // Calibrated DAN partial ditulis ke JSON (Fase 1): partial tersaji
    // HANYA lewat gerbang loader dengan flag eksplisit; uncalibrated
    // tidak pernah ditulis. (Semantik lama "JSON = tanpa flag" digantikan
    // registry sebagai sumber kebenaran status.)
    ratings.leagues[key] = {
      div: key,
      leagueName: cat.name,
      country: cat.country ?? "",
      seasonCount: seasons.length,
      totalMatches: matches.length,
      leagueAvgGoals: Number(fit.leagueAvgGoals.toFixed(4)),
      homeAdvantage: Number(fit.homeAdvantage.toFixed(4)),
      rho: rhoForLeague(fit, matches),
      calibrationDate: nowIso.slice(0, 10),
      source: "sportmonks-fit",
      calibrationStatus: status,
      fitMethod: `ipf-time-decay-half-life-${HALF_LIFE_DAYS}d+rho-${RHO_MODE}+shrink-${SHRINK_KAPPA}`,
      teams: teamsJson,
    };
    insReg.run(leagueId, cat.name, cat.country, tierByLeague.get(leagueId) ?? null, status, matches.length, teamSet.size,
      coverage, Number(fit.scaleRatio.toFixed(4)), nowIso, "sportmonks-fit",
      (status === "calibrated" ? "Lolos uji skala + cakupan telemetri ≥80%." : `Gerbang gagal: skala=${fit.scaleRatio.toFixed(3)} cakupan=${coverage == null ? "n/a" : coverage.toFixed(2)}.`) + oosNote);
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
