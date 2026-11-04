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
 *        [--no-oos-gate]
 *
 * Rekalibrasi kanonik (2026-11-04):
 *   (a) --no-oos-gate: lewati gerbang OOS (tasks/oos-gate.json tidak dibaca).
 *   (b) Registry liga kanonik (data/league-canonical.json) dimuat di awal;
 *       peta alias `${system}:${id}` → canonical_id dibangun dari situ.
 *   (c) Registry league_calibration punya kolom canonical_id (ALTER
 *       idempoten) yang diisi di SETIAP baris dari peta alias.
 *   (d) Baris status kanonik (source='canonical') dibangun ulang tiap run
 *       untuk liga kanonik ber-fixture/ber-fit yang belum punya baris
 *       league_id = canonical_id — status 'uncalibrated', tanpa fit.
 *   (e) Setiap entri JSON dapat field canonicalId + blok metadata
 *       top-level `canonical`; totalTeams kini TERMASUK alias bentuk-nama
 *       (lihat (f)), jadi jumlah tim bisa lebih besar dari tim ter-fit.
 *   (f) Roster tiap liga (SM calibrated/partial + legacy) ditambah alias
 *       bentuk-nama dari fixture upcoming (jembatan token prefix/suffix)
 *       agar nama fixture yang divergen dari kunci roster tetap ketemu.
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
import { normalizeTeamName } from "../lib/quant/team-normalizer";

const args = process.argv.slice(2);
const NO_OOS_GATE = args.includes("--no-oos-gate");
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

// ---------------------------------------------------------------------------
// Registry kanonik (data/league-canonical.json) — dimuat sekali di main().
// ---------------------------------------------------------------------------
interface CanonicalAliasEntry { system: string; id: string; name_as_stored: string | null }
interface CanonicalEntry {
  canonical_id: string;
  name: string;
  country: string | null;
  aliases: CanonicalAliasEntry[];
  fits: { system: string; ratings_key: string; status: string }[];
}
interface CanonicalFileShape { version?: number; generated_at?: string; leagues: CanonicalEntry[] }

let canonicalFile: CanonicalFileShape | null = null;
/** Peta alias `${system}:${id}` → canonical_id. */
const canonicalAliasMap = new Map<string, string>();
/** Peta canonical_id → entri kanonik. */
const canonicalById = new Map<string, CanonicalEntry>();
/** Nama tim per liga kanonik dari fixture upcoming (diisi di main()). */
const fixtureNamesByCanonical = new Map<string, Set<string>>();

function loadCanonicalRegistry(): void {
  try {
    canonicalFile = JSON.parse(
      fs.readFileSync(dataPath("league-canonical.json"), "utf8"),
    ) as CanonicalFileShape;
    for (const e of canonicalFile.leagues) {
      canonicalById.set(e.canonical_id, e);
      for (const a of e.aliases) canonicalAliasMap.set(`${a.system}:${a.id}`, e.canonical_id);
    }
  } catch {
    canonicalFile = null; /* tanpa registry kanonik: canonicalId null, tanpa baris kanonik/alias nama */
  }
}

function canonicalIdVia(...pairs: [string, string][]): string | null {
  for (const [system, id] of pairs) {
    const hit = canonicalAliasMap.get(`${system}:${id}`);
    if (hit) return hit;
  }
  return null;
}

/** canonical_id untuk baris/entri divisi legacy: alias legacy-div, fallback ratings-key. */
function canonicalIdForLegacyDiv(div: string): string | null {
  return canonicalIdVia(["legacy-div", div], ["ratings-key", div]);
}

/** canonical_id untuk satu kunci ratings (SM<n> atau divisi legacy). */
function canonicalIdForRatingsKey(key: string): string | null {
  if (/^SM\d+$/i.test(key)) {
    return canonicalIdVia(["ratings-key", key], ["sportmonks", `sm:${key.slice(2)}`]);
  }
  return canonicalIdForLegacyDiv(key);
}

// ---------------------------------------------------------------------------
// Alias bentuk-nama roster (butir f): jembatan token antara nama fixture
// dan kunci roster. normalizeTeamName(x) → lowercase → tanda [-/.'’] jadi
// spasi → buang token awalan {afc,fc,sc,ac,cf,sv} dan token akhiran
// {fc,sc,cf,club} berulang → gabung satu spasi.
// ---------------------------------------------------------------------------
const BRIDGE_LEAD_TOKENS = new Set(["afc", "fc", "sc", "ac", "cf", "sv"]);
const BRIDGE_TRAIL_TOKENS = new Set(["fc", "sc", "cf", "club"]);

function bridgeTeamKey(raw: string): string {
  const tokens = normalizeTeamName(raw)
    .toLowerCase()
    .replace(/[-/.'’]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 0 && BRIDGE_LEAD_TOKENS.has(tokens[0])) tokens.shift();
  while (tokens.length > 0 && BRIDGE_TRAIL_TOKENS.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(" ");
}

const PLACEHOLDER_TEAM_RE = /^\d+(st|nd|rd|th) ranked$/i;

/**
 * Tambahkan alias bentuk-nama fixture ke objek teams satu liga (mutasi di
 * tempat; nilai alias = objek tim yang SAMA dengan kunci roster asal).
 * Mengembalikan jumlah alias yang ditambahkan.
 */
function augmentTeamNameAliases(
  leagueKey: string,
  teams: Record<string, unknown>,
  canonicalId: string | null,
): number {
  if (!canonicalId) return 0;
  const fixtureNames = fixtureNamesByCanonical.get(canonicalId);
  if (!fixtureNames || fixtureNames.size === 0) return 0;
  const originalKeys = Object.keys(teams);
  // Indeks ternormalisasi persis aturan ratings-loader (teamKeyIndex):
  // normalize(kunci) → kunci, yang pertama menang.
  const normalizedIndex = new Map<string, string>();
  for (const key of originalKeys) {
    const nk = normalizeTeamName(key);
    if (!normalizedIndex.has(nk)) normalizedIndex.set(nk, key);
  }
  // Peta jembatan dari kunci roster yang ada; tabrakan (dua kunci roster
  // berbagi kunci jembatan yang sama) dicatat dan dianggap ambigu.
  const bridgeMap = new Map<string, string>();
  const bridgeCollisions = new Set<string>();
  for (const key of originalKeys) {
    const b = bridgeTeamKey(key);
    if (!b) continue;
    const cur = bridgeMap.get(b);
    if (cur === undefined) bridgeMap.set(b, key);
    else if (cur !== key) bridgeCollisions.add(b);
  }
  const added: string[] = [];
  const ambiguous: string[] = [];
  for (const f of [...fixtureNames].sort()) {
    if (PLACEHOLDER_TEAM_RE.test(f)) continue; // "1st ranked" dst BUKAN tim nyata
    if (Object.prototype.hasOwnProperty.call(teams, f)) continue;
    const nf = normalizeTeamName(f);
    if (Object.prototype.hasOwnProperty.call(teams, nf) || normalizedIndex.has(nf)) continue;
    const b = bridgeTeamKey(f);
    if (!b) continue;
    if (bridgeCollisions.has(b)) { ambiguous.push(f); continue; }
    const targetKey = bridgeMap.get(b);
    if (!targetKey) continue;
    teams[f] = teams[targetKey];
    added.push(f);
  }
  if (added.length > 0) console.log(`${leagueKey} alias nama: +${added.length} (${added.join(", ")})`);
  if (ambiguous.length > 0) console.log(`${leagueKey} alias nama ambigu (dilewati): ${ambiguous.join(", ")}`);
  return added.length;
}

function main() {
  loadCanonicalRegistry();
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
      notes TEXT,
      canonical_id TEXT
    )`,
  );
  // Kolom canonical_id untuk registry yang sudah ada (idempoten).
  const regCols = ds.prepare("PRAGMA table_info(league_calibration)").all() as { name: string }[];
  if (!regCols.some((c) => c.name === "canonical_id")) {
    ds.exec("ALTER TABLE league_calibration ADD COLUMN canonical_id TEXT");
  }
  const up = new DatabaseSync(dataPath("upcoming_fixtures.db"), { readOnly: true });

  // Nama tim per liga kanonik dari fixture upcoming (untuk alias bentuk-nama,
  // butir f) + himpunan liga kanonik ber-fixture (untuk baris kanonik, butir d).
  const canonicalWithFixtures = new Set<string>();
  for (const r of up
    .prepare(
      "SELECT DISTINCT competition_id, home_team_name, away_team_name FROM upcoming_fixtures WHERE competition_id IS NOT NULL",
    )
    .all() as { competition_id: string; home_team_name: string | null; away_team_name: string | null }[]) {
    const system = r.competition_id.startsWith("sm:")
      ? "sportmonks"
      : r.competition_id.startsWith("comp_")
        ? "thestats"
        : null;
    if (!system) continue;
    const cid = canonicalAliasMap.get(`${system}:${r.competition_id}`);
    if (!cid) continue;
    canonicalWithFixtures.add(cid);
    const set = fixtureNamesByCanonical.get(cid) ?? new Set<string>();
    if (r.home_team_name) set.add(r.home_team_name);
    if (r.away_team_name) set.add(r.away_team_name);
    fixtureNamesByCanonical.set(cid, set);
  }
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
    canonical?: { registry: string; registryVersion?: number; registryGeneratedAt?: string; note: string };
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
  if (!NO_OOS_GATE) {
    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "tasks", "oos-gate.json"), "utf8"),
      ) as Record<string, { heldout_logloss: number; naive_logloss: number; n: number }>;
      for (const [k, v] of Object.entries(raw)) oosGate.set(k, v);
    } catch { /* tanpa file gerbang OOS, status murni dari gerbang skala+cakupan */ }
  }

  const insReg = ds.prepare(
    `INSERT OR REPLACE INTO league_calibration
     (league_id, league_name, country, tier, status, n_matches, n_teams, telemetry_coverage, scale_ratio, fitted_at, source, notes, canonical_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = new Date();
  const nowIso = now.toISOString();
  let nCal = 0, nPart = 0, nUncal = 0, addedTeams = 0, totalAliases = 0;
  const augmentedKeys = new Set<string>();

  // Liga legacy: tercatat sebagai calibrated dari file rating yang sudah ada.
  // (n_teams dihitung dari roster ASLI, sebelum alias bentuk-nama ditambah —
  // kolom itu menghitung tim ter-fit dari match, bukan kunci JSON.)
  for (const [div, lg] of Object.entries(ratings.leagues)) {
    if (div.startsWith("SM")) continue;
    insReg.run(
      div, String(lg.leagueName ?? div), String(lg.country ?? ""), null, "calibrated",
      Number(lg.totalMatches ?? 0), Object.keys((lg.teams as object) ?? {}).length,
      null, null, String(lg.calibrationDate ?? ""), "legacy-csv-fit", "Rating warisan (football-data) yang sudah terpasang sebelum sprint.",
      canonicalIdForLegacyDiv(div),
    );
  }

  // Entri legacy yang dipertahankan: tambah canonicalId + alias bentuk-nama
  // (parameter tim asli tidak diubah — alias menunjuk objek tim yang sama).
  for (const [div, lg] of Object.entries(ratings.leagues)) {
    if (div.startsWith("SM")) continue;
    const cid = canonicalIdForRatingsKey(div);
    lg.canonicalId = cid;
    totalAliases += augmentTeamNameAliases(div, (lg.teams ?? {}) as Record<string, unknown>, cid);
    augmentedKeys.add(div);
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
        coverage, null, null, "sportmonks-fit", "Kompetisi piala/lintas-negara — tidak difit per-liga (di luar parameterisasi rating liga).",
        canonicalIdVia(["sportmonks", leagueId]));
      nUncal += 1;
      continue;
    }
    if (matches.length < MIN_MATCHES) {
      delete ratings.leagues[`SM${leagueId.slice(3)}`];
      insReg.run(leagueId, cat.name, cat.country, tierByLeague.get(leagueId) ?? null, "uncalibrated", matches.length, teamSet.size,
        coverage, null, null, "sportmonks-fit", `Data hasil belum cukup untuk fit (n=${matches.length} < ${MIN_MATCHES}).`,
        canonicalIdVia(["sportmonks", leagueId]));
      nUncal += 1;
      continue;
    }
    const fit = fitLeague(matches, now.getTime(), HALF_LIFE_DAYS);
    if (!fit) {
      delete ratings.leagues[`SM${leagueId.slice(3)}`];
      insReg.run(leagueId, cat.name, cat.country, tierByLeague.get(leagueId) ?? null, "uncalibrated", matches.length, teamSet.size,
        coverage, null, null, "sportmonks-fit", "Fit gagal (tim/gol tidak memadai).",
        canonicalIdVia(["sportmonks", leagueId]));
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
        `Lolos gerbang skala/cakupan sebagai partial, gugur di gerbang bukti.` + oosNote,
        canonicalIdVia(["sportmonks", leagueId]));
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
    // Roster difinalkan: tambah alias bentuk-nama fixture (butir f) SEBELUM
    // entri ditulis — registry n_teams tetap teamSet (tim ter-fit), tidak
    // ikut membengkak oleh alias.
    const smCanonicalId = canonicalIdForRatingsKey(key);
    totalAliases += augmentTeamNameAliases(key, teamsJson, smCanonicalId);
    augmentedKeys.add(key);
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
      canonicalId: smCanonicalId,
      teams: teamsJson,
    };
    insReg.run(leagueId, cat.name, cat.country, tierByLeague.get(leagueId) ?? null, status, matches.length, teamSet.size,
      coverage, Number(fit.scaleRatio.toFixed(4)), nowIso, "sportmonks-fit",
      (status === "calibrated" ? "Lolos uji skala + cakupan telemetri ≥80%." : `Gerbang gagal: skala=${fit.scaleRatio.toFixed(3)} cakupan=${coverage == null ? "n/a" : coverage.toFixed(2)}.`) + oosNote,
      canonicalIdVia(["sportmonks", leagueId]));
  }

  // Entri yang dipertahankan tapi tidak tersentuh loop di atas (mis. kunci SM
  // di luar katalog berjalan): pastikan canonicalId + alias bentuk-nama juga.
  for (const [key, lg] of Object.entries(ratings.leagues)) {
    if (augmentedKeys.has(key)) continue;
    const cid = canonicalIdForRatingsKey(key);
    lg.canonicalId = cid;
    totalAliases += augmentTeamNameAliases(key, (lg.teams ?? {}) as Record<string, unknown>, cid);
    augmentedKeys.add(key);
  }

  // Baris status kanonik (butir d): baris turunan source='canonical' dibangun
  // ulang tiap run. Target = liga kanonik ber-fixture (dari upcoming_fixtures)
  // ∪ liga kanonik ber-fit. Bila baris league_id = canonical_id sudah ada
  // (baris utama SM/legacy), baris itulah baris kanoniknya — tidak disisipkan.
  ds.prepare("DELETE FROM league_calibration WHERE source = 'canonical'").run();
  const canonicalTargets = new Set<string>(canonicalWithFixtures);
  for (const e of canonicalById.values()) if (e.fits.length > 0) canonicalTargets.add(e.canonical_id);
  let nCanonicalRows = 0;
  const existingReg = ds.prepare("SELECT league_id FROM league_calibration WHERE league_id = ?");
  for (const cid of [...canonicalTargets].sort()) {
    const entry = canonicalById.get(cid);
    if (!entry) continue;
    if (existingReg.get(cid)) continue;
    // n_matches/n_teams dari match selesai di ruang-id matches (sm:* / comp_*).
    const matchIds = entry.aliases.map((a) => a.id).filter((id) => id.startsWith("sm:") || id.startsWith("comp_"));
    let nMatches = 0;
    const teamSet = new Set<string>();
    if (matchIds.length > 0) {
      const rows = ds
        .prepare(
          `SELECT home_team_id, away_team_id FROM matches
           WHERE competition_id IN (${matchIds.map(() => "?").join(",")})
             AND status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL`,
        )
        .all(...matchIds) as { home_team_id: string; away_team_id: string }[];
      nMatches = rows.length;
      for (const r of rows) { teamSet.add(r.home_team_id); teamSet.add(r.away_team_id); }
    }
    insReg.run(
      cid, entry.name, entry.country, null, "uncalibrated", nMatches, teamSet.size,
      null, null, null, "canonical",
      "Baris status kanonik: liga kanonik dengan fixture/fit terdaftar tapi tanpa baris fit utama — tidak ada fit ratings (no ratings fit — not served).",
      cid,
    );
    nCanonicalRows += 1;
  }

  // Metadata kanonik top-level (butir e).
  ratings.canonical = {
    registry: "data/league-canonical.json",
    registryVersion: canonicalFile?.version,
    registryGeneratedAt: canonicalFile?.generated_at,
    note: "keys are fit keys; canonicalId maps each fit to its canonical league",
  };

  ratings.totalLeagues = Object.keys(ratings.leagues).length;
  ratings.totalTeams = Object.values(ratings.leagues).reduce(
    (s, lg) => s + Object.keys((lg.teams as object) ?? {}).length, 0,
  );
  ratings.compiledAt = nowIso;
  fs.writeFileSync(ratingsPath, JSON.stringify(ratings, null, 2));
  console.log(`Registry: calibrated+partial baru=${nCal + nPart} (calibrated ${nCal}, partial ${nPart}), uncalibrated ${nUncal}; entri tim tertulis ${addedTeams}.`);
  console.log(`Baris status kanonik (source='canonical') disisipkan: ${nCanonicalRows}.`);
  console.log(`Total alias nama fixture ditambahkan: +${totalAliases}.`);
  console.log(`calibrated_ratings.json: ${ratings.totalLeagues} liga, ${ratings.totalTeams} tim.`);
}

main();
