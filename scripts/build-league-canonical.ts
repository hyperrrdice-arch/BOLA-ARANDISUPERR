/**
 * BUILD LEAGUE CANONICAL REGISTRY — menyatukan identitas liga dari semua
 * sumber jadi SATU struktur kanonik (data/league-canonical.json).
 *
 * Masalah yang diselesaikan: nama liga datang dari beberapa sumber dengan
 * struktur berbeda — Sportmonks `sm:<leagueId>` (nama polos + negara
 * terpisah), TheStats `comp_*` (nama + negara, kadang NULL), divisi legacy
 * football-data (E0, SP1, … dengan nama berprefix negara "English Premier
 * League"), dan kunci file ratings (`SM8` / `E0`). Resolusi berbasis nama
 * polos bertabrakan antar negara ("Premier League" = 6 liga) dan pernah
 * menyajikan fixture Sportmonks dengan ratings legacy hanya karena nama.
 *
 * Struktur kanonik: identitas = `canonical_id`; referensi tampil =
 * `name` + `country` (TIDAK PERNAH nama polos sendirian). Setiap identitas
 * sumber yang menunjuk liga dunia-nyata yang sama digabung jadi SATU
 * entri dengan semua alias + fit ratings yang ada.
 *
 * Metode penggabungan: join eksak atas (nama ternormalisasi + negara).
 * Yang tidak tertangkap join itu TIDAK ditebak diam-diam — diputuskan
 * tangan di OVERRIDES di bawah (berkomentar), atau tetap jadi entri
 * sendiri dan tercatat di ringkasan.
 *
 * Offline murni: membaca store lokal saja (mode read-only), nol API.
 * Pakai: npx tsx scripts/build-league-canonical.ts
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");

// ---------------------------------------------------------------------------
// OVERRIDES — keputusan tangan untuk gabungan yang tidak tertangkap join
// (nama + negara) ternormalisasi. Format: pasangan kunci seed
// "<system>:<id>" yang grupnya WAJIB digabung / dilarang digabung.
// Setiap entri berkomentar alasannya. JANGAN tambah entri tanpa bukti
// dari store (nama/negara/isi liga yang sama di dunia nyata).
// ---------------------------------------------------------------------------
const FORCE_MERGE: [string, string][] = [
  // SP2: legacy/TheStats menyebutnya "Segunda Division", Sportmonks
  // mengganti nama dagangnya jadi "La Liga 2" — liga Spanyol kasta 2 yang sama.
  ["legacy-div:SP2", "sportmonks:sm:567"],
  // P1: legacy "Primeira Liga", Sportmonks "Liga Portugal" — liga Portugal
  // kasta 1 yang sama (nama dagang berubah, negaranya sama).
  ["legacy-div:P1", "sportmonks:sm:462"],
  // B1: legacy "Belgian First Division A", Sportmonks "Pro League" —
  // liga Belgia kasta 1 yang sama.
  ["legacy-div:B1", "sportmonks:sm:208"],
  // Nama dagang/sponsor di satu sumber, nama polos di sumber lain — liga
  // yang sama (negara + kasta sama, dibuktikan dari isi katalog kedua sumber):
  ["thestats:comp_1941", "sportmonks:sm:244"], // "HNL" (TheStats) = "1. HNL" Kroasia
  ["thestats:comp_4893", "sportmonks:sm:181"], // "Austrian Bundesliga" = "Admiral Bundesliga" (sponsor)
  ["thestats:comp_4008", "sportmonks:sm:325"], // "Stoiximan Super League" (sponsor) = Super League Yunani
  ["thestats:comp_5878", "sportmonks:sm:17"], // "National League" = "Enterprise National League" Inggris (sponsor)
  ["thestats:comp_6059", "sportmonks:sm:1073"], // "V-League 1" = "V-League" Vietnam (kasta 1)
  ["thestats:comp_7712", "sportmonks:sm:989"], // "CFA Super League" = Super League Tiongkok
  ["thestats:comp_8385", "sportmonks:sm:462"], // "Liga Portugal Betclic" (sponsor) = "Liga Portugal"
  ["thestats:comp_8448", "sportmonks:sm:603"], // "Trendyol 1.Lig" (sponsor) = "1. Lig" Turki
  ["thestats:comp_29967", "sportmonks:sm:1082"], // "International Friendly Games" = "Friendly International"
  // Liga MX: TheStats memecah per turnamen (Apertura/Clausura), Sportmonks
  // memperlakukan Liga MX sebagai SATU liga — tim & fit-nya sama.
  ["thestats:comp_137103", "sportmonks:sm:743"], // Liga MX, Clausura
  ["thestats:comp_298265", "sportmonks:sm:743"], // Liga MX, Apertura
];

const FORCE_SEPARATE: [string, string][] = [
  // (kosong untuk sekarang — join nama+negara tidak menghasilkan gabungan
  // salah pada data 2026-11-04; isi di sini bila panen berikutnya berubah.)
];

// ---------------------------------------------------------------------------
// Normalisasi
// ---------------------------------------------------------------------------
const COUNTRY_ALIASES: Record<string, string> = {
  usa: "united states",
  holland: "netherlands",
  "türkiye": "turkey",
  czechia: "czech republic",
  "korea republic": "south korea",
};

function normCountry(country: string | null | undefined): string | null {
  if (!country) return null;
  const c = country.trim().toLowerCase().replace(/\s+/g, " ");
  return COUNTRY_ALIASES[c] ?? c;
}

// Token awal nama yang boleh dibuang saat membentuk nama inti: awalan
// konfederasi + demonym/nama negara (nama legacy berprefix negara:
// "English Premier League" → inti "premier league").
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

/** Nama inti untuk join: nama ternormalisasi minus awalan negara/konfederasi, tanpa spasi. */
function coreNameKey(name: string): string {
  const tokens = normNameRaw(name).split(" ").filter(Boolean);
  while (tokens.length > 1 && LEAD_STOP_TOKENS.has(tokens[0])) tokens.shift();
  return tokens.join("");
}

// ---------------------------------------------------------------------------
// Seeds — satu per identitas sumber
// ---------------------------------------------------------------------------
type System = "sportmonks" | "thestats" | "legacy-div" | "ratings-key";
interface Seed {
  system: System;
  id: string;
  name: string | null;
  country: string | null;
  origin: string; // store asal (untuk prioritas nama saat id yang sama muncul di beberapa store)
}

const seedKey = (s: Seed) => `${s.system}:${s.id}`;

function collectSeeds(): { seeds: Seed[]; registryStatus: Map<string, string>; jsonStatus: Map<string, string> } {
  const seeds: Seed[] = [];
  const registryStatus = new Map<string, string>();
  const jsonStatus = new Map<string, string>();

  const upDb = new DatabaseSync(path.join(DATA_DIR, "upcoming_fixtures.db"), { readOnly: true });
  const dsDb = new DatabaseSync(path.join(DATA_DIR, "thestats_dataset.db"), { readOnly: true });
  const masterDb = new DatabaseSync(path.join(DATA_DIR, "football_master.db"), { readOnly: true });

  // 1) Registry kalibrasi — sumber kebenaran status; id sm: = Sportmonks, selain itu divisi legacy.
  //    Baris turunan source='canonical' (ditulis calibrate-ratings.ts) BUKAN
  //    identitas sumber — dilewati sepenuhnya (seed maupun peta status).
  const regRows = dsDb
    .prepare("SELECT league_id, league_name, country, status, source FROM league_calibration")
    .all() as { league_id: string; league_name: string | null; country: string | null; status: string; source: string }[];
  for (const r of regRows) {
    if (r.source === "canonical") continue;
    registryStatus.set(r.league_id, r.status);
    seeds.push({
      system: r.league_id.startsWith("sm:") ? "sportmonks" : "legacy-div",
      id: r.league_id,
      name: r.league_name,
      country: r.country,
      origin: "registry",
    });
  }

  // 2) Katalog kompetisi (TheStats comp_* + Sportmonks sm:).
  const catRows = upDb
    .prepare("SELECT competition_id, name, country FROM competition_catalog")
    .all() as { competition_id: string; name: string | null; country: string | null }[];
  for (const r of catRows) {
    seeds.push({
      system: r.competition_id.startsWith("sm:") ? "sportmonks" : "thestats",
      id: r.competition_id,
      name: r.name,
      country: r.country,
      origin: "catalog",
    });
  }

  // 3) Kompetisi yang benar-benar punya fixture upcoming (nama/negara versi store fixture).
  const fixRows = upDb
    .prepare("SELECT DISTINCT competition_id, competition_name, competition_country FROM upcoming_fixtures WHERE competition_id IS NOT NULL")
    .all() as { competition_id: string; competition_name: string | null; competition_country: string | null }[];
  for (const r of fixRows) {
    seeds.push({
      system: r.competition_id.startsWith("sm:") ? "sportmonks" : "thestats",
      id: r.competition_id,
      name: r.competition_name,
      country: r.competition_country,
      origin: "fixtures",
    });
  }

  // 4) Kompetisi di store hasil (dataset.matches): sm:/comp_ menumpang seed yang ada;
  //    master_<DIV> adalah konvensi internal dataset untuk divisi legacy.
  const matchRows = dsDb.prepare("SELECT DISTINCT competition_id FROM matches WHERE competition_id IS NOT NULL").all() as {
    competition_id: string;
  }[];
  for (const r of matchRows) {
    const m = r.competition_id.match(/^master_([A-Z0-9]+)$/);
    if (m) {
      const reg = regRows.find((x) => x.league_id === m[1]);
      seeds.push({
        system: "legacy-div",
        id: r.competition_id,
        name: reg?.league_name ?? m[1],
        country: reg?.country ?? null,
        origin: "dataset-matches",
      });
    }
  }

  // 5) Divisi football_master (semua sudah ada di registry; ini jaring pengaman cakupan).
  const divRows = masterDb.prepare("SELECT DISTINCT div FROM matches").all() as { div: string }[];
  for (const r of divRows) {
    const reg = regRows.find((x) => x.league_id === r.div);
    seeds.push({ system: "legacy-div", id: r.div, name: reg?.league_name ?? r.div, country: reg?.country ?? null, origin: "master" });
  }

  // 6) Kunci file ratings: SM<n> = fit Sportmonks, selainnya fit legacy.
  const ratings = JSON.parse(readFileSync(path.join(DATA_DIR, "calibrated_ratings.json"), "utf-8")) as {
    leagues: Record<string, { leagueName?: string; country?: string; calibrationStatus?: string }>;
  };
  for (const [key, lg] of Object.entries(ratings.leagues)) {
    if (lg.calibrationStatus) jsonStatus.set(key, lg.calibrationStatus);
    seeds.push({
      system: "ratings-key",
      id: key,
      name: lg.leagueName ?? null,
      country: lg.country ?? null,
      origin: "ratings-json",
    });
  }

  upDb.close(); dsDb.close(); masterDb.close();
  return { seeds, registryStatus, jsonStatus };
}

// ---------------------------------------------------------------------------
// Penggabungan grup
// ---------------------------------------------------------------------------
const ORIGIN_PRIORITY = ["registry", "catalog", "fixtures", "ratings-json", "master", "dataset-matches"];

function main() {
  const { seeds, registryStatus, jsonStatus } = collectSeeds();

  // Dedup per (system,id): nama/negara diambil dari origin berprioritas tertinggi.
  const byKey = new Map<string, Seed>();
  for (const s of seeds) {
    const k = seedKey(s);
    const cur = byKey.get(k);
    if (!cur) { byKey.set(k, s); continue; }
    if (ORIGIN_PRIORITY.indexOf(s.origin) < ORIGIN_PRIORITY.indexOf(cur.origin)) byKey.set(k, s);
    else if (!cur.name && s.name) byKey.set(k, { ...cur, name: s.name });
    if (byKey.get(k)!.country == null && s.country != null) byKey.set(k, { ...byKey.get(k)!, country: s.country });
  }
  const uniq = [...byKey.values()];

  // Grup awal: (nama inti, negara). Seed tanpa negara menempel ke grup
  // bernama sama HANYA bila kandidatnya tunggal; selain itu grup sendiri.
  const groups = new Map<string, Seed[]>();
  const gkey = (nameKey: string, country: string | null) => `${nameKey}|${country ?? "?"}`;
  const noCountry: Seed[] = [];
  for (const s of uniq) {
    if (!s.name) continue;
    const ck = coreNameKey(s.name);
    const ctry = normCountry(s.country);
    if (ctry == null) { noCountry.push(s); continue; }
    const k = gkey(ck, ctry);
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  for (const s of noCountry) {
    const ck = coreNameKey(s.name!);
    const candidates = [...groups.keys()].filter((k) => k.startsWith(`${ck}|`));
    if (candidates.length === 1) groups.get(candidates[0])!.push(s);
    else groups.set(gkey(ck, null), [...(groups.get(gkey(ck, null)) ?? []), s]);
  }
  // Seed tanpa nama sama sekali (seharusnya tidak ada) → grup sendiri per id.
  for (const s of uniq) {
    if (s.name) continue;
    groups.set(`__noname__${seedKey(s)}`, [s]);
  }

  // Union-find atas grup untuk FORCE_MERGE.
  const groupOf = new Map<string, string>(); // seedKey -> groupKey
  for (const [gk, members] of groups) for (const s of members) groupOf.set(seedKey(s), gk);
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  for (const [gk] of groups) parent.set(gk, gk);
  for (const [a, b] of FORCE_MERGE) {
    const ga = groupOf.get(a), gb = groupOf.get(b);
    if (!ga || !gb) { console.error(`OVERRIDE FORCE_MERGE yatim: ${a} / ${b} (seed/grup tidak ditemukan)`); process.exitCode = 1; continue; }
    union(ga, gb);
  }
  const merged = new Map<string, Seed[]>();
  for (const [gk, members] of groups) {
    const root = find(gk);
    merged.set(root, [...(merged.get(root) ?? []), ...members]);
  }
  // FORCE_SEPARATE: pisahkan seed kedua dari grupnya bila masih menyatu.
  for (const [a, b] of FORCE_SEPARATE) {
    const root = find(groupOf.get(a)!);
    const members = merged.get(root) ?? [];
    const bSeed = members.find((s) => seedKey(s) === b);
    if (bSeed && members.some((s) => seedKey(s) === a)) {
      merged.set(root, members.filter((s) => seedKey(s) !== b));
      merged.set(`__split__${b}`, [bSeed]);
    }
  }

  // -------------------------------------------------------------------------
  // Susun entri kanonik
  // -------------------------------------------------------------------------
  interface Fit { system: "sportmonks" | "legacy-div"; ratings_key: string; status: string }
  interface Alias { system: System; id: string; name_as_stored: string | null }
  interface Entry {
    canonical_id: string;
    name: string;
    country: string | null;
    aliases: Alias[];
    fits: Fit[];
    loader_special?: string;
  }

  const entries: Entry[] = [];
  const fitConflicts: string[] = [];
  for (const members of merged.values()) {
    const sm = members.find((s) => s.system === "sportmonks");
    const legacyDiv = members.find((s) => s.system === "legacy-div" && !s.id.startsWith("master_"));
    const thestats = members.find((s) => s.system === "thestats");
    const canonical_id = sm ? sm.id : legacyDiv ? legacyDiv.id : thestats ? thestats.id : members[0].id;
    const name =
      sm?.name ?? thestats?.name ?? legacyDiv?.name ?? members.find((s) => s.name)?.name ?? canonical_id;
    // Negara disimpan dengan ejaan sumber (mis. "England", sama seperti
    // store lain) — normalisasi hanya dipakai saat membandingkan.
    const country = sm?.country ?? members.find((s) => s.country)?.country ?? null;

    const fits: Fit[] = [];
    for (const s of members) {
      if (s.system !== "ratings-key") continue;
      const isSm = /^SM\d+$/.test(s.id);
      const regId = isSm ? `sm:${s.id.slice(2)}` : s.id;
      const regStatus = registryStatus.get(regId);
      const jStatus = jsonStatus.get(s.id);
      if (regStatus && jStatus && regStatus !== jStatus) {
        fitConflicts.push(`${s.id}: registry=${regStatus} vs json=${jStatus} (registry dipakai)`);
      }
      fits.push({
        system: isSm ? "sportmonks" : "legacy-div",
        ratings_key: s.id,
        status: regStatus ?? jStatus ?? "unknown",
      });
    }
    fits.sort((a, b) => a.ratings_key.localeCompare(b.ratings_key));

    const entry: Entry = {
      canonical_id,
      name,
      country,
      aliases: members
        .map((s) => ({ system: s.system, id: s.id, name_as_stored: s.name }))
        .sort((a, b) => `${a.system}:${a.id}`.localeCompare(`${b.system}:${b.id}`)),
      fits,
    };
    // Liga pseudo UCL di loader (parameter hardcoded + penskalaan koefisien
    // UEFA) menempel pada entri Champions League Eropa ini.
    if (canonical_id === "sm:2") entry.loader_special = "UCL";
    entries.push(entry);
  }
  entries.sort((a, b) => a.canonical_id.localeCompare(b.canonical_id));

  const out = {
    version: 1,
    generated_at: new Date().toISOString(),
    generator: "scripts/build-league-canonical.ts",
    note: "Identitas = canonical_id. Referensi liga = name + country, tidak pernah nama polos sendirian. Regenerasi: npx tsx scripts/build-league-canonical.ts",
    leagues: entries,
  };
  writeFileSync(path.join(DATA_DIR, "league-canonical.json"), JSON.stringify(out, null, 2) + "\n");

  // -------------------------------------------------------------------------
  // Ringkasan + diagnostik (untuk laporan verifikasi)
  // -------------------------------------------------------------------------
  const perSystem = new Map<System, number>();
  for (const s of uniq) perSystem.set(s.system, (perSystem.get(s.system) ?? 0) + 1);
  const mapped = new Map<System, number>();
  for (const e of entries) for (const a of e.aliases) mapped.set(a.system, (mapped.get(a.system) ?? 0) + 1);
  console.log(`seed unik per sistem: ${[...perSystem.entries()].map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`entri kanonik: ${entries.length}`);
  console.log(`alias terpetakan per sistem: ${[...mapped.entries()].map(([k, v]) => `${k}=${v}`).join(" ")}`);
  const multi = entries.filter((e) => e.fits.length > 1);
  console.log(`entri dengan >1 fit (gabungan lintas sistem): ${multi.length}`);
  for (const e of multi) console.log(`  ${e.canonical_id} (${e.name}, ${e.country}): fits ${e.fits.map((f) => `${f.ratings_key}=${f.status}`).join(", ")}`);
  const withFit = entries.filter((e) => e.fits.length > 0);
  console.log(`entri ber-fit: ${withFit.length}; tanpa fit: ${entries.length - withFit.length}`);
  const noCountryEntries = entries.filter((e) => !e.country);
  console.log(`entri tanpa negara: ${noCountryEntries.length}${noCountryEntries.length ? " -> " + noCountryEntries.map((e) => e.canonical_id).join(", ") : ""}`);
  if (fitConflicts.length) { console.log("konflik status registry vs JSON:"); fitConflicts.forEach((c) => console.log("  " + c)); }

  // Kandidat duplikat yang TIDAK digabung: negara sama + nama inti berbagi token.
  const tokenSet = (e: Entry) => new Set(normNameRaw(e.name).split(" ").filter((t) => !LEAD_STOP_TOKENS.has(t)));
  console.log("kandidat duplikat tak-tergabung (negara sama, token nama tumpang tindih):");
  let dupCount = 0;
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j];
      if (!a.country || a.country !== b.country) continue;
      const ta = tokenSet(a), tb = tokenSet(b);
      const inter = [...ta].filter((t) => tb.has(t)).length;
      const unionN = new Set([...ta, ...tb]).size;
      if (unionN > 0 && inter / unionN >= 0.5) {
        console.log(`  ${a.canonical_id} "${a.name}" <-> ${b.canonical_id} "${b.name}" (${a.country})`);
        dupCount++;
      }
    }
  }
  if (!dupCount) console.log("  (tidak ada)");
}

main();
