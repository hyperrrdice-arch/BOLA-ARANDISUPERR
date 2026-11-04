/**
 * CUP OFFSET FIT — inti offline model offset global untuk kompetisi piala.
 *
 * Model (disetujui owner, fase kalibrasi piala): per benua (graf) setiap
 * liga domestik kanonik mendapat SATU offset kekuatan δ (skala log) yang
 * di-fit maximum-likelihood (Poisson atas gol) dari SEMUA hasil lintas
 * liga yang tersedia di store — kompetisi piala kontinental graf itu +
 * piala domestik lintas divisi — dengan attack/defense tim DIKUNCI ke fit
 * domestik pasca-rekalibrasi (parameter tershrink yang dikonsumsi jalur
 * kuant). Bobot time-decay half-life 365 hari, konsisten fit domestik.
 *
 *   λ_home = G × HA_cup × att_home × e^{δ_Lhome} × def_away × e^{−δ_Laway}
 *   μ_away = G × att_away × e^{δ_Laway} × def_home × e^{−δ_Lhome}
 *
 * δ hanya teridentifikasi sebagai SELISIH antar-liga → satu liga referensi
 * per graf di-clamp δ=0 (liga dengan laga jangkar terbanyak). Liga tanpa
 * laga jangkar = δ TIDAK teridentifikasi (delta null) — tidak ditebak.
 * Prior ridge lemah pada δ menahan liga berjangkar tipis ke arah 0.
 *
 * Modul ini dipakai scripts/backtest-cup-offsets.ts (walk-forward OOS →
 * tasks/cup-oos.json) dan scripts/fit-global-offsets.ts (fit produksi →
 * registry kanonik + blok canonical di calibrated_ratings.json + registry
 * league_calibration). Penyajian runtime ada di lib/quant/global-offsets.ts.
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { normalizeTeamName } from "./team-normalizer";
import { normalizeLeagueCountry, type CanonicalLeague } from "./league-identity";
import { calculateDixonColes } from "./dixon-coles";

// ---------------------------------------------------------------------------
// Definisi graf + kompetisi piala
// ---------------------------------------------------------------------------
export type GraphId = "europe" | "conmebol" | "afc";

const EUROPE_COUNTRIES = new Set([
  "england", "scotland", "wales", "northern ireland", "ireland", "spain", "germany", "italy",
  "france", "netherlands", "belgium", "portugal", "turkey", "greece", "austria", "switzerland",
  "denmark", "sweden", "norway", "finland", "poland", "croatia", "czech republic", "bulgaria",
  "romania", "ukraine", "russia", "israel", "cyprus", "serbia", "hungary", "slovakia", "iceland",
  "kazakhstan", "azerbaijan", "georgia", "armenia", "belarus", "lithuania", "latvia", "estonia",
  "moldova", "slovenia", "bosnia and herzegovina", "montenegro", "north macedonia", "albania",
  "kosovo", "luxembourg", "malta", "faroe islands", "gibraltar", "andorra", "san marino", "liechtenstein",
]);
const CONMEBOL_COUNTRIES = new Set([
  "argentina", "brazil", "chile", "colombia", "uruguay", "paraguay", "peru", "ecuador", "bolivia", "venezuela",
]);
const AFC_COUNTRIES = new Set([
  "saudi arabia", "japan", "south korea", "china", "united arab emirates", "qatar", "iran", "india",
  "vietnam", "australia", "thailand", "indonesia", "malaysia", "uzbekistan", "iraq", "jordan", "kuwait",
  "oman", "bahrain", "lebanon", "syria", "hong kong", "philippines", "singapore", "tajikistan",
  "kyrgyzstan", "turkmenistan", "yemen", "palestine", "north korea", "myanmar", "cambodia", "laos",
  "brunei", "maldives", "sri lanka", "bangladesh", "pakistan", "nepal", "bhutan", "afghanistan",
  "mongolia", "taiwan", "guam", "macau",
]);
const CAF_COUNTRIES = new Set([
  "egypt", "morocco", "south africa", "tunisia", "algeria", "nigeria", "ghana", "cameroon", "senegal",
  "ivory coast", "dr congo", "mali", "burkina faso", "zambia", "angola", "tanzania", "sudan", "libya",
  "ethiopia", "kenya", "uganda", "mozambique", "guinea", "congo", "gabon", "benin", "zimbabwe", "togo",
  "rwanda", "botswana", "namibia", "malawi", "mauritania", "niger", "sierra leone", "liberia",
  "madagascar", "mauritius", "eswatini", "lesotho", "gambia", "guinea-bissau", "equatorial guinea",
  "central african republic", "chad", "comoros", "djibouti", "eritrea", "somalia", "south sudan",
  "burundi", "cape verde", "sao tome and principe", "seychelles",
]);

/** Negara → graf offset; null = di luar tiga graf yang disetujui (CAF hanya dienumerasi). */
export function graphForCountry(country: string | null | undefined): GraphId | "caf" | null {
  const c = normalizeLeagueCountry(country);
  if (!c) return null;
  if (EUROPE_COUNTRIES.has(c)) return "europe";
  if (CONMEBOL_COUNTRIES.has(c)) return "conmebol";
  if (AFC_COUNTRIES.has(c)) return "afc";
  if (CAF_COUNTRIES.has(c)) return "caf";
  return null;
}

export interface CupCompetitionDef {
  canonicalId: string;
  graph: GraphId;
  kind: "continental" | "domestic";
  /** ID kompetisi ekstra di store yang merupakan kompetisi yang sama (ruang ID lain). */
  extraStoreIds?: string[];
}

/** 17 kompetisi piala dalam sistem offset (antrean miss list + 2 kontinental AFC yang sempat ter-fit sebagai liga). */
export const CUP_COMPETITIONS: CupCompetitionDef[] = [
  { canonicalId: "sm:2", graph: "europe", kind: "continental", extraStoreIds: ["comp_3498"] },
  { canonicalId: "sm:5", graph: "europe", kind: "continental" },
  { canonicalId: "sm:2286", graph: "europe", kind: "continental" },
  { canonicalId: "sm:1122", graph: "conmebol", kind: "continental" },
  { canonicalId: "sm:1116", graph: "conmebol", kind: "continental" },
  { canonicalId: "sm:1085", graph: "afc", kind: "continental" },
  { canonicalId: "sm:1088", graph: "afc", kind: "continental" },
  { canonicalId: "sm:24", graph: "europe", kind: "domestic" },
  { canonicalId: "sm:27", graph: "europe", kind: "domestic" },
  { canonicalId: "sm:307", graph: "europe", kind: "domestic" },
  { canonicalId: "sm:468", graph: "europe", kind: "domestic" },
  { canonicalId: "sm:78", graph: "europe", kind: "domestic" },
  { canonicalId: "sm:570", graph: "europe", kind: "domestic" },
  { canonicalId: "sm:109", graph: "europe", kind: "domestic" },
  { canonicalId: "sm:390", graph: "europe", kind: "domestic" },
  { canonicalId: "sm:654", graph: "conmebol", kind: "domestic" },
  { canonicalId: "sm:950", graph: "afc", kind: "domestic" },
];

export const CUP_COMP_IDS = new Set(CUP_COMPETITIONS.map((c) => c.canonicalId));

const NON_LEAGUE_NAME = /cup|beker|pokal|coupe|coppa|copa|ta[çc]a|kupa|trofeo|friendl|women|play-?offs?|shield|trophy|super cup|champions league|europa|libertadores|sudamericana|intercontinental/i;

/**
 * Entri kanonik yang merupakan LIGA DOMESTIK (bukan piala/friendly/wanita/
 * kontinental): punya negara nyata yang terpetakan ke graf (atau CAF) dan
 * nama yang bukan kompetisi non-liga. Dipakai membangun peta keanggotaan
 * tim dan himpunan liga per graf.
 */
export function isDomesticLeagueEntry(entry: CanonicalLeague): boolean {
  if (CUP_COMP_IDS.has(entry.canonical_id)) return false;
  if (graphForCountry(entry.country) === null) return false;
  if (NON_LEAGUE_NAME.test(entry.name)) return false;
  return true;
}

/** Liga domestik kanonik milik satu graf. */
export function domesticLeaguesOfGraph(canonicals: CanonicalLeague[], graph: GraphId): CanonicalLeague[] {
  return canonicals.filter((e) => isDomesticLeagueEntry(e) && graphForCountry(e.country) === graph);
}

/** Semua ID store yang menjadi jangkar graf ini (kontinental + piala domestiknya). */
export function anchorStoreIds(graph: GraphId): string[] {
  const ids: string[] = [];
  for (const c of CUP_COMPETITIONS) {
    if (c.graph !== graph) continue;
    ids.push(c.canonicalId, ...(c.extraStoreIds ?? []));
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Store hasil (dataset.matches)
// ---------------------------------------------------------------------------
export interface StoreMatch {
  competition_id: string;
  season: string;
  utc_date: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
}

export function loadFinishedMatches(dbPath?: string): StoreMatch[] {
  const db = new DatabaseSync(dbPath ?? path.join(process.cwd(), "data", "thestats_dataset.db"), { readOnly: true });
  const rows = db
    .prepare(
      `SELECT competition_id, season, utc_date, home_team_id, away_team_id, home_score, away_score
       FROM matches WHERE status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL`,
    )
    .all() as unknown as StoreMatch[];
  db.close();
  return rows;
}

export function loadTeamNames(dbPath?: string): Map<string, string> {
  const db = new DatabaseSync(dbPath ?? path.join(process.cwd(), "data", "thestats_dataset.db"), { readOnly: true });
  const rows = db.prepare("SELECT team_id, name FROM teams").all() as unknown as { team_id: string; name: string }[];
  db.close();
  return new Map(rows.map((r) => [r.team_id, r.name]));
}

// ---------------------------------------------------------------------------
// Resolusi tim → liga domestik kanonik (dari keanggotaan hasil domestik)
// ---------------------------------------------------------------------------
/** ID store (sm:/comp_) milik entri kanonik ini. */
export function storeIdsOf(entry: CanonicalLeague): string[] {
  return entry.aliases.map((a) => a.id).filter((id) => id.startsWith("sm:") || id.startsWith("comp_"));
}

export interface TeamDomestic {
  canonicalId: string;
  via: "matches-modal" | "name-scan";
}

/**
 * Peta team_id → liga domestik kanonik: kompetisi domestik (bukan piala,
 * bukan friendlies) tempat tim paling sering bermain di store; seri →
 * musim terbaru. Tim yang tidak muncul di kompetisi domestik mana pun
 * tidak punya entri (tidak bisa dinilai).
 */
export function buildTeamDomesticMap(
  matches: StoreMatch[],
  canonicals: CanonicalLeague[],
  domesticStoreToCanonical: Map<string, string>,
): Map<string, TeamDomestic> {
  const counts = new Map<string, Map<string, { n: number; lastSeason: string }>>();
  for (const m of matches) {
    const cid = domesticStoreToCanonical.get(m.competition_id);
    if (!cid) continue;
    for (const tid of [m.home_team_id, m.away_team_id]) {
      let per = counts.get(tid);
      if (!per) counts.set(tid, (per = new Map()));
      const cur = per.get(cid) ?? { n: 0, lastSeason: "" };
      cur.n += 1;
      if (m.season > cur.lastSeason) cur.lastSeason = m.season;
      per.set(cid, cur);
    }
  }
  const out = new Map<string, TeamDomestic>();
  for (const [tid, per] of counts) {
    let best: string | null = null;
    let bestStat = { n: -1, lastSeason: "" };
    for (const [cid, s] of per) {
      if (s.n > bestStat.n || (s.n === bestStat.n && s.lastSeason > bestStat.lastSeason)) {
        best = cid;
        bestStat = s;
      }
    }
    if (best) out.set(tid, { canonicalId: best, via: "matches-modal" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Parameter tim dari fit domestik (JSON produksi) — kunci nama ternormalisasi
// ---------------------------------------------------------------------------
export interface RatingsLeagueLike {
  leagueName?: string;
  country?: string;
  leagueAvgGoals?: number;
  homeAdvantage?: number;
  calibrationStatus?: string;
  canonicalId?: string | null;
  teams: Record<string, { attack: number; defense: number; matchesCount?: number }>;
}
export interface RatingsFileLike {
  leagues: Record<string, RatingsLeagueLike>;
}

const normIndexCache = new WeakMap<object, Map<string, string>>();
function normIndex(league: RatingsLeagueLike): Map<string, string> {
  let per = normIndexCache.get(league as object);
  if (!per) {
    per = new Map();
    for (const k of Object.keys(league.teams)) {
      const nk = normalizeTeamName(k);
      if (!per.has(nk)) per.set(nk, k);
    }
    normIndexCache.set(league as object, per);
  }
  return per;
}

export function paramsFromLeague(
  league: RatingsLeagueLike | undefined,
  teamName: string,
): { attack: number; defense: number; matchesCount: number } | null {
  if (!league) return null;
  const nk = normalizeTeamName(teamName);
  const direct = league.teams[nk];
  if (direct) return { attack: direct.attack, defense: direct.defense, matchesCount: direct.matchesCount ?? 0 };
  const key = normIndex(league).get(nk);
  if (!key) return null;
  const t = league.teams[key];
  return { attack: t.attack, defense: t.defense, matchesCount: t.matchesCount ?? 0 };
}

/**
 * Pilih kunci fit yang melayani satu liga kanonik untuk satu ruang ID tim:
 * tim Sportmonks (id numerik) → fit sportmonks; tim TheStats (tm_) → fit
 * legacy; fallback ke fit lain entri yang sama bila nama ditemukan di sana.
 */
export function servingFitKey(entry: CanonicalLeague, teamId: string): { key: string; system: string } | null {
  if (entry.fits.length === 0) return null;
  const want = teamId.startsWith("tm_") ? "legacy-div" : "sportmonks";
  const hit = entry.fits.find((f) => f.system === want);
  if (hit) return { key: hit.ratings_key, system: hit.system };
  return { key: entry.fits[0].ratings_key, system: entry.fits[0].system };
}

// ---------------------------------------------------------------------------
// Laga jangkar ter-resolve
// ---------------------------------------------------------------------------
export interface AnchorMatch {
  competition_id: string;
  season: string;
  utc_date: string;
  homeLeague: string; // canonical_id liga domestik tim kandang
  awayLeague: string;
  attH: number; defH: number; attA: number; defA: number;
  homeGoals: number; awayGoals: number;
  weight: number; // time-decay vs refMs
  crossLeague: boolean;
}

export interface ResolvedTeam {
  domestic: string; // canonical_id
  attack: number;
  defense: number;
}

/** Resolver tim untuk fit produksi: team_id → (liga domestik, att, def) dari JSON produksi. */
export function makeProductionTeamResolver(
  ratings: RatingsFileLike,
  canonicalById: Map<string, CanonicalLeague>,
  teamDomestic: Map<string, TeamDomestic>,
  teamNames: Map<string, string>,
): (teamId: string) => ResolvedTeam | null {
  return (teamId: string) => {
    const dom = teamDomestic.get(teamId);
    if (!dom) return null;
    const entry = canonicalById.get(dom.canonicalId);
    if (!entry) return null;
    const name = teamNames.get(teamId);
    if (!name) return null;
    const fit = servingFitKey(entry, teamId);
    if (fit) {
      const p = paramsFromLeague(ratings.leagues[fit.key], name);
      if (p) return { domestic: dom.canonicalId, attack: p.attack, defense: p.defense };
    }
    // Fallback: fit lain dari entri yang sama (nama ditemukan di sana).
    for (const f of entry.fits) {
      if (fit && f.ratings_key === fit.key) continue;
      const p = paramsFromLeague(ratings.leagues[f.ratings_key], name);
      if (p) return { domestic: dom.canonicalId, attack: p.attack, defense: p.defense };
    }
    return null;
  };
}

export function resolveAnchors(
  matches: StoreMatch[],
  storeToCanonical: Map<string, string>,
  graphLeagues: Set<string>,
  resolveTeam: (teamId: string) => ResolvedTeam | null,
  refMs: number,
  halfLifeDays = 365,
): { anchors: AnchorMatch[]; skippedNoTeam: number; skippedLeagueOutsideGraph: number } {
  const anchors: AnchorMatch[] = [];
  let skippedNoTeam = 0;
  let skippedLeagueOutsideGraph = 0;
  for (const m of matches) {
    const comp = storeToCanonical.get(m.competition_id);
    if (!comp) continue;
    const h = resolveTeam(m.home_team_id);
    const a = resolveTeam(m.away_team_id);
    if (!h || !a) {
      skippedNoTeam += 1;
      continue;
    }
    if (!graphLeagues.has(h.domestic) || !graphLeagues.has(a.domestic)) {
      skippedLeagueOutsideGraph += 1;
      continue;
    }
    const ageDays = Math.max(0, (refMs - Date.parse(m.utc_date)) / 86400_000);
    anchors.push({
      competition_id: comp,
      season: m.season,
      utc_date: m.utc_date,
      homeLeague: h.domestic,
      awayLeague: a.domestic,
      attH: h.attack, defH: h.defense, attA: a.attack, defA: a.defense,
      homeGoals: m.home_score, awayGoals: m.away_score,
      weight: Math.pow(0.5, ageDays / halfLifeDays),
      crossLeague: h.domestic !== a.domestic,
    });
  }
  return { anchors, skippedNoTeam, skippedLeagueOutsideGraph };
}

// ---------------------------------------------------------------------------
// Fit δ — Adam atas log-likelihood Poisson (gradien analitik, deterministik)
// ---------------------------------------------------------------------------
export interface OffsetFitResult {
  reference: string;
  delta: Map<string, number>; // hanya liga teridentifikasi (referensi = 0 termasuk)
  globalAvg: number;
  cupHA: number;
  logLikPerMatch: number;
  anchorsPerLeague: Map<string, number>;
  iterations: number;
}

const RIDGE = 1.0; // prior L2 lemah pada δ (satuan log-likelihood)

export function fitOffsets(
  anchors: AnchorMatch[],
  leagues: string[],
  reference: string,
  iterations = 1500,
): OffsetFitResult | null {
  if (anchors.length === 0 || leagues.length === 0) return null;
  // δ hanya bermakna untuk liga yang MUNCUL di jangkar (+ referensi).
  // Liga lain yang dilewatkan pemanggil (mis. entri kanonik tanpa fit)
  // tidak boleh masuk peta delta — kehadiran di peta = teridentifikasi.
  const inAnchors = new Set<string>([reference]);
  for (const m of anchors) { inAnchors.add(m.homeLeague); inAnchors.add(m.awayLeague); }
  const free = leagues.filter((l) => l !== reference && inAnchors.has(l));
  const freeIdx = new Map(free.map((l, i) => [l, i]));
  const P = free.length + 2; // δ bebas + logG + logHA
  const LOGG = free.length;
  const LOGHA = free.length + 1;

  // Inisialisasi empiris: G = rata-rata gol per tim, HA = μH/μA jangkar.
  let gH = 0, gA = 0;
  for (const m of anchors) { gH += m.homeGoals; gA += m.awayGoals; }
  const theta = new Float64Array(P);
  theta[LOGG] = Math.log(Math.max(0.2, (gH + gA) / (2 * anchors.length)));
  theta[LOGHA] = Math.log(Math.max(0.8, gH / Math.max(1, gA)));

  const deltaOf = (league: string): number => {
    if (league === reference) return 0;
    const i = freeIdx.get(league);
    return i === undefined ? 0 : theta[i];
  };

  const adamM = new Float64Array(P);
  const adamV = new Float64Array(P);
  const grad = new Float64Array(P);
  const lr = 0.05, b1 = 0.9, b2 = 0.999, eps = 1e-8;
  let finalLL = 0;

  for (let iter = 1; iter <= iterations; iter++) {
    grad.fill(0);
    let ll = 0;
    const G = Math.exp(theta[LOGG]);
    const HA = Math.exp(theta[LOGHA]);
    for (const m of anchors) {
      const dH = deltaOf(m.homeLeague);
      const dA = deltaOf(m.awayLeague);
      const lam = Math.max(1e-6, G * HA * m.attH * Math.exp(dH) * m.defA * Math.exp(-dA));
      const mu = Math.max(1e-6, G * m.attA * Math.exp(dA) * m.defH * Math.exp(-dH));
      ll += m.weight * (m.homeGoals * Math.log(lam) - lam + m.awayGoals * Math.log(mu) - mu);
      const gD = m.weight * ((m.homeGoals - lam) - (m.awayGoals - mu)); // ∂LL/∂δ_homeLeague
      const iH = freeIdx.get(m.homeLeague);
      const iA = freeIdx.get(m.awayLeague);
      if (iH !== undefined) grad[iH] += gD;
      if (iA !== undefined) grad[iA] -= gD;
      grad[LOGG] += m.weight * ((m.homeGoals - lam) + (m.awayGoals - mu));
      grad[LOGHA] += m.weight * (m.homeGoals - lam);
    }
    // Prior ridge pada δ bebas.
    for (const i of freeIdx.values()) {
      ll -= RIDGE * theta[i] * theta[i];
      grad[i] -= 2 * RIDGE * theta[i];
    }
    finalLL = ll;
    // Adam (maksimisasi → naik searah gradien).
    const bc1 = 1 - Math.pow(b1, iter);
    const bc2 = 1 - Math.pow(b2, iter);
    for (let p = 0; p < P; p++) {
      adamM[p] = b1 * adamM[p] + (1 - b1) * grad[p];
      adamV[p] = b2 * adamV[p] + (1 - b2) * grad[p] * grad[p];
      const mHat = adamM[p] / bc1;
      const vHat = adamV[p] / bc2;
      theta[p] += (lr * mHat) / (Math.sqrt(vHat) + eps);
    }
  }

  const delta = new Map<string, number>();
  delta.set(reference, 0);
  for (const [league, i] of freeIdx) delta.set(league, Number(theta[i].toFixed(4)));
  const anchorsPerLeague = new Map<string, number>();
  for (const m of anchors) {
    anchorsPerLeague.set(m.homeLeague, (anchorsPerLeague.get(m.homeLeague) ?? 0) + 1);
    anchorsPerLeague.set(m.awayLeague, (anchorsPerLeague.get(m.awayLeague) ?? 0) + 1);
  }
  let wSum = 0;
  for (const m of anchors) wSum += m.weight;
  return {
    reference,
    delta,
    globalAvg: Number(Math.exp(theta[LOGG]).toFixed(4)),
    cupHA: Number(Math.exp(theta[LOGHA]).toFixed(4)),
    logLikPerMatch: Number((finalLL / Math.max(1, wSum)).toFixed(4)),
    anchorsPerLeague,
    iterations,
  };
}

/** Liga dengan laga jangkar terbanyak (referensi δ=0). */
export function pickReference(anchors: AnchorMatch[]): string | null {
  const counts = new Map<string, number>();
  for (const m of anchors) {
    counts.set(m.homeLeague, (counts.get(m.homeLeague) ?? 0) + 1);
    counts.set(m.awayLeague, (counts.get(m.awayLeague) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = -1;
  for (const [l, n] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (n > bestN) { bestN = n; best = l; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Prediksi + metrik OOS
// ---------------------------------------------------------------------------
export interface MatchPrediction {
  pHome: number; pDraw: number; pAway: number;
  outcome: "H" | "D" | "A";
  leg2: boolean;
}

export function predictMatch(
  m: AnchorMatch,
  delta: Map<string, number>,
  globalAvg: number,
  cupHA: number,
): { pHome: number; pDraw: number; pAway: number } | null {
  const dH = delta.get(m.homeLeague);
  const dA = delta.get(m.awayLeague);
  if (dH === undefined || dA === undefined) return null;
  const attH = m.attH * Math.exp(dH);
  const defH = m.defH * Math.exp(-dH);
  const attA = m.attA * Math.exp(dA);
  const defA = m.defA * Math.exp(-dA);
  // Rumus offset murni (basis = globalAvg graf untuk semua pasangan,
  // termasuk pasangan satu liga di piala domestik) — persis yang disajikan
  // runtime, agar bukti walk-forward berlaku untuk formula yang sama.
  const dc = calculateDixonColes({
    homeAttack: attH, homeDefense: defH, awayAttack: attA, awayDefense: defA,
    homeAdvantage: cupHA, leagueAvgGoals: globalAvg, rho: 0,
  });
  return { pHome: dc.prob_home_win, pDraw: dc.prob_draw, pAway: dc.prob_away_win };
}

export interface MetricSet {
  n: number;
  logLoss: number;
  brier: number;
  slope: number | null;
}

/** Slope kalibrasi: regresi logistik pooled logit(y) ~ a + b·logit(p) (Newton 2 parameter). */
export function calibrationSlope(preds: MatchPrediction[]): number | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of preds) {
    const probs = [p.pHome, p.pDraw, p.pAway];
    const outs = [p.outcome === "H" ? 1 : 0, p.outcome === "D" ? 1 : 0, p.outcome === "A" ? 1 : 0];
    for (let k = 0; k < 3; k++) {
      const pc = Math.min(0.999, Math.max(0.001, probs[k]));
      xs.push(Math.log(pc / (1 - pc)));
      ys.push(outs[k]);
    }
  }
  if (xs.length < 30) return null;
  let a = 0, b = 1;
  for (let iter = 0; iter < 60; iter++) {
    let gA = 0, gB = 0, hAA = 0, hAB = 0, hBB = 0;
    for (let i = 0; i < xs.length; i++) {
      const z = a + b * xs[i];
      const p = 1 / (1 + Math.exp(-z));
      const r = ys[i] - p;
      const w = Math.max(1e-9, p * (1 - p));
      gA += r; gB += r * xs[i];
      hAA += w; hAB += w * xs[i]; hBB += w * xs[i] * xs[i];
    }
    const det = hAA * hBB - hAB * hAB;
    if (Math.abs(det) < 1e-12) break;
    const da = (hBB * gA - hAB * gB) / det;
    const db = (hAA * gB - hAB * gA) / det;
    a += da; b += db;
    if (Math.abs(da) < 1e-8 && Math.abs(db) < 1e-8) break;
  }
  return Number(b.toFixed(3));
}

export function metricsOf(preds: MatchPrediction[]): MetricSet {
  if (preds.length === 0) return { n: 0, logLoss: 0, brier: 0, slope: null };
  let ll = 0, br = 0;
  for (const p of preds) {
    const probs = [p.pHome, p.pDraw, p.pAway];
    const outs = [p.outcome === "H" ? 1 : 0, p.outcome === "D" ? 1 : 0, p.outcome === "A" ? 1 : 0];
    const hit = p.outcome === "H" ? p.pHome : p.outcome === "D" ? p.pDraw : p.pAway;
    ll += -Math.log(Math.max(1e-9, hit));
    for (let k = 0; k < 3; k++) br += (probs[k] - outs[k]) * (probs[k] - outs[k]);
  }
  return {
    n: preds.length,
    logLoss: Number((ll / preds.length).toFixed(4)),
    brier: Number((br / preds.length).toFixed(4)),
    slope: calibrationSlope(preds),
  };
}

/** Tandai leg-2 (proksi): pertemuan kedua+ sepasang tim di kompetisi+musim yang sama dengan venue tertukar dari pertemuan sebelumnya. */
export function flagLeg2(matches: StoreMatch[]): Set<number> {
  const byPair = new Map<string, number[]>();
  matches.forEach((m, i) => {
    const key = `${m.competition_id}|${m.season}|${[m.home_team_id, m.away_team_id].sort().join("~")}`;
    const arr = byPair.get(key) ?? [];
    arr.push(i);
    byPair.set(key, arr);
  });
  const leg2 = new Set<number>();
  for (const idxs of byPair.values()) {
    if (idxs.length < 2) continue;
    const sorted = [...idxs].sort((x, y) => (matches[x].utc_date < matches[y].utc_date ? -1 : 1));
    const seenOrientations = new Set<string>([`${matches[sorted[0]].home_team_id}>${matches[sorted[0]].away_team_id}`]);
    for (let k = 1; k < sorted.length; k++) {
      const m = matches[sorted[k]];
      const rev = `${m.away_team_id}>${m.home_team_id}`;
      if (seenOrientations.has(rev)) leg2.add(sorted[k]);
      seenOrientations.add(`${m.home_team_id}>${m.away_team_id}`);
    }
  }
  return leg2;
}

// ---------------------------------------------------------------------------
// Fit domestik per lipatan (untuk walk-forward yang jujur) — resep identik
// scripts/calibrate-ratings.ts fitLeague (IPF + decay 365 + shrink κ=10),
// tapi berkunci team_id. Preseden duplikasi: scripts/backtest-walkforward.ts.
// ---------------------------------------------------------------------------
export interface DomesticFoldFit {
  leagueAvg: number;
  homeAdvantage: number;
  attack: Map<string, number>;
  defense: Map<string, number>;
}

export function fitDomesticFold(matches: StoreMatch[], refMs: number, halfLifeDays = 365, shrinkKappa = 10): DomesticFoldFit | null {
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
    w[i] = Math.pow(0.5, (refMs - Date.parse(m.utc_date)) / (halfLifeDays * 86400_000));
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
    let ma = 0, md = 0;
    for (let t = 0; t < T; t++) { ma += attack[t]; md += defense[t]; }
    ma /= T; md /= T;
    if (ma > 0) for (let t = 0; t < T; t++) attack[t] /= ma;
    if (md > 0) for (let t = 0; t < T; t++) defense[t] /= md;
    if (maxDelta < 1e-7) break;
  }
  if (shrinkKappa > 0) {
    const counts = new Float64Array(T);
    for (let i = 0; i < n; i++) { counts[hi[i]]++; counts[ai[i]]++; }
    const shrinkArr = (arr: Float64Array) => {
      let sum = 0;
      for (let t = 0; t < T; t++) {
        const wgt = counts[t] / (counts[t] + shrinkKappa);
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
  for (const [team, ix] of teamIdx) { attackMap.set(team, attack[ix]); defenseMap.set(team, defense[ix]); }
  return { leagueAvg: lgAvg, homeAdvantage: ha, attack: attackMap, defense: defenseMap };
}
