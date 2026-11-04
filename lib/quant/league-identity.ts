/**
 * LEAGUE IDENTITY — resolusi liga lewat registry kanonik
 * (data/league-canonical.json, dibangun scripts/build-league-canonical.ts).
 *
 * Struktur tunggal: identitas liga = `canonical_id`; referensi =
 * name + country — TIDAK PERNAH nama polos sendirian, karena nama liga
 * datang dari beberapa sumber dengan struktur berbeda dan bertabrakan
 * antar negara ("Premier League" = 6 liga di 6 negara).
 *
 * Urutan resolusi (resolveServingForMatch):
 *   1. ID sumber (sm:<id> / SM<id> / comp_* / master_<DIV> / kode divisi)
 *      → entri kanonik → fit.
 *   2. Baris fixture tersimpan (nama tim kandang/tamu persis) → ID
 *      kompetisi baris itu → entri kanonik → fit. Inilah jalur yang
 *      memulihkan identitas yang hilang di batas intel: planner hanya
 *      meneruskan NAMA kompetisi, tapi nama tim berasal dari baris
 *      fixture itu sendiri, jadi ID-nya bisa dipulihkan dari store.
 *      Bila pasangan yang sama terdaftar sebagai kembaran mt_/sm_
 *      (pertandingan sama, kickoff identik), ID sm: yang menang —
 *      Sportmonks katalog live; baris mt_ hanya jembatan identitas.
 *   3. Nama + negara (bila negara diberikan) → entri kanonik.
 *   4. Nama polos: hanya bila tepat SATU entri kanonik cocok; bila
 *      beberapa, disaring keanggotaan kedua tim di fit kandidat; tetap
 *      ambigu → null EKSPLISIT (tidak ada tebak-tebakan diam-diam).
 *
 * Aturan fit yang melayani: fit yang sistemnya sama dengan sistem sumber
 * fixture (fixture sm: → fit Sportmonks; fixture legacy/TheStats → fit
 * legacy). Bila entri hanya punya satu fit, fit itu yang melayani. Bila
 * sumber tidak diketahui dan kedua fit ada: fit yang memuat kedua tim;
 * bila keduanya memuat / tidak memuat, fit Sportmonks didahulukan
 * (sumber live, fit paling segar) — pilihan selalu tercatat di `note`.
 *
 * Pengecualian tercatat: entri Champions League Eropa membawa
 * `loader_special: "UCL"` — parameter pseudo hardcoded di ratings-loader
 * (penskalaan koefisien UEFA) yang sudah melayani jalur nama sejak era
 * legacy. Registry menandai sm:2 uncalibrated by design; jalur pseudo
 * ini dipertahankan apa adanya (perilaku produksi saat ini) dan dicatat
 * di sini + laporan, menunggu keputusan owner.
 */
import path from "node:path";
import fs from "node:fs";
import { getUpcomingDb } from "../db/upcoming-fixtures";
import { normalizeTeamName } from "./team-normalizer";

export type LeagueSourceSystem = "sportmonks" | "thestats" | "legacy-div" | "ratings-key";
export type FitSystem = "sportmonks" | "legacy-div";

export interface CanonicalFit {
  system: FitSystem;
  ratings_key: string;
  status: string;
}

export interface CanonicalAlias {
  system: LeagueSourceSystem;
  id: string;
  name_as_stored: string | null;
}

export interface CanonicalLeague {
  canonical_id: string;
  name: string;
  country: string | null;
  aliases: CanonicalAlias[];
  fits: CanonicalFit[];
  loader_special?: string;
}

export type ResolutionVia =
  | "source-id"
  | "fixture-row"
  | "name-country"
  | "name-unambiguous"
  | "name-teams"
  | "legacy-fallback"
  | "none";

export interface ServingResolution {
  canonical: CanonicalLeague | null;
  /** Kunci ratings yang melayani (mis. 'E0' | 'SM8' | 'UCL'), atau null. */
  div: string | null;
  fitSystem: FitSystem | "special" | null;
  via: ResolutionVia;
  sourceSystem: LeagueSourceSystem | null;
  /** true bila nama cocok ke >1 liga kanonik dan tidak ada penentu — div pasti null. */
  ambiguous: boolean;
  /** Alasan manusiawi atas pilihan ini (audit). */
  note: string;
}

// --- Normalisasi nama/negara: CERMINAN generator (build-league-canonical.ts).
// Ubah di satu tempat = wajib ubah di tempat lain, lalu regenerasi registry.
const COUNTRY_ALIASES: Record<string, string> = {
  usa: "united states",
  holland: "netherlands",
  "türkiye": "turkey",
  czechia: "czech republic",
  "korea republic": "south korea",
};

export function normalizeLeagueCountry(country: string | null | undefined): string | null {
  if (!country) return null;
  const c = country.trim().toLowerCase().replace(/\s+/g, " ");
  return COUNTRY_ALIASES[c] ?? c;
}

const LEAD_STOP_TOKENS = new Set([
  "uefa", "caf", "afc", "conmebol", "concacaf", "fifa",
  "english", "england", "spanish", "spain", "german", "germany",
  "french", "france", "italian", "italy", "dutch", "netherlands", "holland",
  "portuguese", "portugal", "belgian", "belgium", "scottish", "scotland",
  "turkish", "turkey", "greek", "greece", "austrian", "austria",
  "swiss", "switzerland", "danish", "denmark", "swedish", "sweden",
  "norwegian", "norway", "finnish", "finland", "polish", "poland",
  "croatian", "croatia", "czech", "bulgarian", "bulgaria", "romanian", "romania",
  "ukrainian", "ukraine", "russian", "russia", "egyptian", "egypt",
  "moroccan", "morocco", "israeli", "israel", "iranian", "iran",
  "qatari", "qatar", "saudi", "arabia", "japanese", "japan", "korean", "korea", "south",
  "chinese", "china", "indian", "india", "vietnamese", "vietnam",
  "australian", "australia", "canadian", "canada", "mexican", "mexico",
  "brazilian", "brazil", "argentinian", "argentina", "chilean", "chile",
  "colombian", "colombia", "uruguayan", "uruguay", "american",
]);

function normNameRaw(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Kunci nama inti (sama seperti generator): tanpa awalan negara/konfederasi, tanpa spasi. */
export function leagueNameKey(name: string): string {
  const tokens = normNameRaw(name).split(" ").filter(Boolean);
  while (tokens.length > 1 && LEAD_STOP_TOKENS.has(tokens[0])) tokens.shift();
  return tokens.join("");
}

// ---------------------------------------------------------------------------
// Registry (cache per proses)
// ---------------------------------------------------------------------------
interface CanonicalFile {
  version: number;
  leagues: CanonicalLeague[];
}

let cached: CanonicalFile | null = null;
let cacheFailed = false;
let byAlias: Map<string, CanonicalLeague> | null = null;
let byNameKey: Map<string, CanonicalLeague[]> | null = null;

export function loadCanonicalLeagues(): CanonicalLeague[] {
  if (cached) return cached.leagues;
  if (cacheFailed) return [];
  try {
    const p = path.join(process.cwd(), "data", "league-canonical.json");
    cached = JSON.parse(fs.readFileSync(p, "utf-8")) as CanonicalFile;
    byAlias = new Map();
    byNameKey = new Map();
    for (const e of cached.leagues) {
      for (const a of e.aliases) byAlias.set(`${a.system}:${a.id}`, e);
      const keys = new Set<string>([leagueNameKey(e.name)]);
      for (const a of e.aliases) if (a.name_as_stored) keys.add(leagueNameKey(a.name_as_stored));
      for (const k of keys) byNameKey.set(k, [...(byNameKey.get(k) ?? []), e]);
    }
    return cached.leagues;
  } catch {
    cacheFailed = true;
    return [];
  }
}

/** Parse string ID apa pun dari sumber mana pun → (sistem, id alias). */
export function parseSourceId(raw: string): { system: LeagueSourceSystem; id: string } | null {
  const s = raw.trim();
  let m = s.match(/^sm:(\d+)$/i);
  if (m) return { system: "sportmonks", id: `sm:${m[1]}` };
  m = s.match(/^SM(\d+)$/);
  if (m) return { system: "ratings-key", id: `SM${m[1]}` };
  if (/^comp_/i.test(s)) return { system: "thestats", id: s };
  m = s.match(/^master_([A-Z0-9]+)$/i);
  if (m) return { system: "legacy-div", id: `master_${m[1].toUpperCase()}` };
  if (/^[A-Z]{1,3}\d$/i.test(s)) return { system: "legacy-div", id: s.toUpperCase() };
  return null;
}

/** Entri kanonik dari string ID sumber mana pun ('sm:8', 'SM8', 'comp_3039', 'E0', 'master_E0'). */
export function getCanonicalBySourceId(raw: string | null | undefined): CanonicalLeague | null {
  if (!raw) return null;
  loadCanonicalLeagues();
  if (!byAlias) return null;
  const parsed = parseSourceId(raw);
  if (parsed) {
    const hit = byAlias.get(`${parsed.system}:${parsed.id}`);
    if (hit) return hit;
    // Kunci ratings legacy == kode divisi: coba kedua sistem.
    if (parsed.system === "legacy-div") return byAlias.get(`ratings-key:${parsed.id}`) ?? null;
    if (parsed.system === "ratings-key") return byAlias.get(`legacy-div:${parsed.id}`) ?? null;
    return null;
  }
  // canonical_id itu sendiri (mis. 'sm:8' sudah tertangani di atas; jaga-jaga bentuk lain)
  return loadCanonicalLeagues().find((e) => e.canonical_id === raw.trim()) ?? null;
}

/** Semua entri kanonik yang nama/alias-nya cocok dengan nama ini (inti ternormalisasi). */
export function getCanonicalsByName(name: string | null | undefined): CanonicalLeague[] {
  if (!name) return [];
  loadCanonicalLeagues();
  if (!byNameKey) return [];
  return byNameKey.get(leagueNameKey(name)) ?? [];
}

/** Tepat satu entri dari nama + negara; null bila tidak ada / ambigu. */
export function getCanonicalByNameCountry(
  name: string | null | undefined,
  country: string | null | undefined
): CanonicalLeague | null {
  const ctry = normalizeLeagueCountry(country);
  if (!name || !ctry) return null;
  const hits = getCanonicalsByName(name).filter((e) => normalizeLeagueCountry(e.country) === ctry);
  return hits.length === 1 ? hits[0] : null;
}

// ---------------------------------------------------------------------------
// Pilihan fit + resolusi penuh
// ---------------------------------------------------------------------------
export interface ResolveOptions {
  /** Hint mentah dari pemanggil: bisa ID sumber ATAU nama kompetisi. */
  hint?: string | null;
  homeTeam?: string | null;
  awayTeam?: string | null;
  country?: string | null;
  /** Tanggal acuan (YYYY-MM-DD) untuk memilih baris fixture terdekat. */
  asOf?: string | null;
  /** Uji keanggotaan tim di sebuah div ratings (diinjeksikan ratings-loader; menghindari siklus impor). */
  hasTeam?: (div: string, normalizedTeamName: string) => boolean;
}

function pickFit(
  entry: CanonicalLeague,
  sourceSystem: LeagueSourceSystem | null,
  via: ResolutionVia,
  opts: ResolveOptions
): ServingResolution {
  if (entry.loader_special) {
    return {
      canonical: entry,
      div: entry.loader_special,
      fitSystem: "special",
      via,
      sourceSystem,
      ambiguous: false,
      note: `Jalur khusus loader '${entry.loader_special}' (parameter pseudo + penskalaan UEFA) — dipertahankan dari era legacy; registry menandai ${entry.canonical_id} uncalibrated by design.`,
    };
  }
  if (entry.fits.length === 0) {
    return {
      canonical: entry,
      div: null,
      fitSystem: null,
      via,
      sourceSystem,
      ambiguous: false,
      note: `Liga kanonik ${entry.canonical_id} (${entry.name}, ${entry.country ?? "?"}) dikenal tapi TIDAK punya fit ratings — tanpa divisi (jujur), bukan tebakan.`,
    };
  }
  const want: FitSystem | null =
    sourceSystem === "sportmonks" || sourceSystem === "ratings-key"
      ? "sportmonks"
      : sourceSystem === "thestats" || sourceSystem === "legacy-div"
        ? "legacy-div"
        : null;
  if (want) {
    const fit = entry.fits.find((f) => f.system === want);
    if (fit) {
      return {
        canonical: entry,
        div: fit.ratings_key,
        fitSystem: fit.system,
        via,
        sourceSystem,
        ambiguous: false,
        note: `Fit ${fit.system} (${fit.ratings_key}, status ${fit.status}) melayani karena sumber fixture = ${sourceSystem}.`,
      };
    }
    const only = entry.fits[0];
    return {
      canonical: entry,
      div: only.ratings_key,
      fitSystem: only.system,
      via,
      sourceSystem,
      ambiguous: false,
      note: `Entri hanya punya fit ${only.system} (${only.ratings_key}) — fit itu yang melayani walau sumber = ${sourceSystem}.`,
    };
  }
  // Sumber tidak diketahui.
  if (entry.fits.length === 1) {
    const only = entry.fits[0];
    return {
      canonical: entry,
      div: only.ratings_key,
      fitSystem: only.system,
      via,
      sourceSystem,
      ambiguous: false,
      note: `Satu-satunya fit entri ini: ${only.ratings_key} (${only.system}).`,
    };
  }
  // Dua fit, sumber asing: keanggotaan kedua tim memutuskan; seri → Sportmonks (sumber live).
  if (opts.hasTeam && opts.homeTeam && opts.awayTeam) {
    const nh = normalizeTeamName(opts.homeTeam);
    const na = normalizeTeamName(opts.awayTeam);
    const full = entry.fits.filter((f) => opts.hasTeam!(f.ratings_key, nh) && opts.hasTeam!(f.ratings_key, na));
    if (full.length === 1) {
      return {
        canonical: entry,
        div: full[0].ratings_key,
        fitSystem: full[0].system,
        via: "name-teams",
        sourceSystem,
        ambiguous: false,
        note: `Sumber tak diketahui; fit ${full[0].ratings_key} dipilih karena memuat kedua tim.`,
      };
    }
  }
  const smFit = entry.fits.find((f) => f.system === "sportmonks") ?? entry.fits[0];
  return {
    canonical: entry,
    div: smFit.ratings_key,
    fitSystem: smFit.system,
    via,
    sourceSystem,
    ambiguous: false,
    note: `Sumber tak diketahui dan kedua fit sama-sama layak — fit Sportmonks (${smFit.ratings_key}) didahulukan sebagai sumber live.`,
  };
}

/** Pulihkan ID kompetisi dari baris fixture tersimpan (nama tim persis seperti di store). */
function recoverCompetitionIdFromFixtureRow(opts: ResolveOptions): { id: string; via: "fixture-row" } | null {
  if (!opts.homeTeam || !opts.awayTeam || !opts.hint) return null;
  const hintKey = leagueNameKey(opts.hint);
  try {
    const db = getUpcomingDb();
    const rows = db
      .prepare(
        "SELECT competition_id, competition_name, utc_date FROM upcoming_fixtures WHERE home_team_name = ? AND away_team_name = ? AND competition_id IS NOT NULL ORDER BY utc_date"
      )
      .all(opts.homeTeam, opts.awayTeam) as { competition_id: string; competition_name: string | null; utc_date: string | null }[];
    const matching = rows.filter((r) => {
      const entry = getCanonicalBySourceId(r.competition_id);
      if (!entry) return false;
      if (leagueNameKey(entry.name) === hintKey) return true;
      return entry.aliases.some((a) => a.name_as_stored && leagueNameKey(a.name_as_stored) === hintKey);
    });
    if (matching.length === 0) return null;
    const ids = [...new Set(matching.map((r) => r.competition_id))];
    if (ids.length === 1) return { id: ids[0], via: "fixture-row" };
    // Pasangan yang sama terdaftar di >1 katalog (kembaran mt_/sm_ untuk
    // pertandingan yang sama persis — kickoff identik, dijembatani
    // sm_id_map): Sportmonks adalah katalog live yang aktif dipelihara,
    // baris mt_ hanya jembatan identitas → ID sm: yang menang. Sisa
    // ambiguitas (sesama sm: / sesama non-sm:): kickoff >= asOf paling
    // awal; bila tidak ada, yang paling akhir lewat.
    const smIds = ids.filter((i) => i.startsWith("sm:"));
    const pool = smIds.length > 0 ? matching.filter((r) => r.competition_id.startsWith("sm:")) : matching;
    const poolIds = [...new Set(pool.map((r) => r.competition_id))];
    if (poolIds.length === 1) return { id: poolIds[0], via: "fixture-row" };
    const asOf = opts.asOf ?? "";
    const chosen = pool.find((r) => (r.utc_date ?? "") >= asOf) ?? pool[pool.length - 1];
    return { id: chosen.competition_id, via: "fixture-row" };
  } catch {
    return null;
  }
}

/**
 * Resolusi penuh: hint (ID atau nama) + konteks tim → entri kanonik + fit
 * yang melayani. Mengembalikan canonical=null & via='none' bila registry
 * tidak mengenal hint sama sekali (pemanggil boleh jatuh ke jalur warisan
 * untuk string eksotik); canonical!=null & div=null berarti liga DIKENAL
 * tapi tidak bisa dilayani (tanpa fit / ambigu) — itu jawaban final, bukan
 * undangan menebak.
 */
export function resolveServingForMatch(opts: ResolveOptions): ServingResolution {
  const none: ServingResolution = {
    canonical: null, div: null, fitSystem: null, via: "none",
    sourceSystem: null, ambiguous: false, note: "Registry kanonik tidak mengenal hint ini.",
  };
  const hint = opts.hint?.trim();
  if (!hint) return none;

  // 1) Hint berbentuk ID sumber.
  const parsed = parseSourceId(hint);
  if (parsed) {
    const entry = getCanonicalBySourceId(hint);
    if (entry) {
      const src: LeagueSourceSystem =
        parsed.system === "ratings-key" ? "sportmonks" : parsed.system;
      return pickFit(entry, src, "source-id", opts);
    }
    return none;
  }

  // 2) Nama + negara eksplisit.
  if (opts.country) {
    const entry = getCanonicalByNameCountry(hint, opts.country);
    if (entry) return pickFit(entry, null, "name-country", opts);
  }

  // 3) Pulihkan ID dari baris fixture tersimpan.
  const recovered = recoverCompetitionIdFromFixtureRow(opts);
  if (recovered) {
    const entry = getCanonicalBySourceId(recovered.id);
    if (entry) {
      const p = parseSourceId(recovered.id);
      const src: LeagueSourceSystem | null = p ? (p.system === "ratings-key" ? "sportmonks" : p.system) : null;
      return pickFit(entry, src, "fixture-row", opts);
    }
  }

  // 4) Nama polos.
  const candidates = getCanonicalsByName(hint);
  if (candidates.length === 0) return none;
  if (candidates.length === 1) return pickFit(candidates[0], null, "name-unambiguous", opts);

  // Ambigu: saring dengan keanggotaan kedua tim di fit kandidat.
  if (opts.hasTeam && opts.homeTeam && opts.awayTeam) {
    const nh = normalizeTeamName(opts.homeTeam);
    const na = normalizeTeamName(opts.awayTeam);
    const survivors = candidates.filter((e) =>
      e.fits.some((f) => opts.hasTeam!(f.ratings_key, nh) && opts.hasTeam!(f.ratings_key, na))
    );
    if (survivors.length === 1) {
      const res = pickFit(survivors[0], null, "name-teams", opts);
      return { ...res, via: "name-teams" };
    }
  }
  return {
    canonical: null,
    div: null,
    fitSystem: null,
    via: "none",
    sourceSystem: null,
    ambiguous: true,
    note: `Nama "${hint}" cocok ke ${candidates.length} liga kanonik (${candidates.map((c) => c.canonical_id).join(", ")}) dan tidak ada penentu (ID/negara/tim) — resolusi ditolak, bukan ditebak.`,
  };
}
