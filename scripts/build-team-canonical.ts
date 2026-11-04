/**
 * BUILD TEAM CANONICAL — membangun acuan pakem identitas tim
 * (data/team-canonical.json), pasangan dari data/league-canonical.json.
 *
 * Perintah owner 2026-11-05: beresin KESELURUHAN database jadi satu acuan
 * pakem permanen — satu identitas resmi per tim; semua baris dari sumber
 * mana pun ngacunya ke situ; sumber masa depan wajib lewat acuan ini.
 *
 * Prinsip penggabungan (KONSERVATIF — gabung hanya bukti kuat):
 *   - Nama ternormalisasi sama (normalizeTeamName proyek, termasuk kamus
 *     alias) DAN negara tidak bertentangan → satu tim kanonik.
 *   - Nama yang muncul di ≥2 negara berbeda = nama sengketa: baris tanpa
 *     negara TIDAK ikut digabung (ditandai, diputuskan di fase resolusi).
 *   - TANPA gabung fuzzy/jarak-edit di sini. Pasangan mirip dicatat sebagai
 *     KANDIDAT di laporan (tasks/team-canonical-report.md) untuk diputuskan
 *     di fase resolusi — nama benar diputuskan dari bukti (web bila perlu).
 *
 * Id kanonik: anggota Sportmonks menang (`sm:<angka>`); selain itu id
 * sumber tertua yang ada (tm_* lalu fd_*). Nama kanonik: nama tersimpan
 * anggota SM, dinormalisasi lewat kamus alias proyek; fallback nama
 * tersimpan terbanyak.
 *
 * Pakai: npx tsx scripts/build-team-canonical.ts
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { normalizeTeamName, sanitizeString } from "../lib/quant/team-normalizer";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "data/team-canonical.json");
const REPORT = path.join(ROOT, "tasks/team-canonical-report.md");

type System = "sportmonks" | "thestats" | "football-data" | "other";
interface Member { system: System; team_id: string; name_as_stored: string }
interface CanonTeam {
  canonical_id: string;
  name: string;
  country: string | null;
  members: Member[];
  aliases: string[];
  contested_name: boolean;
  resolution_notes?: string[];
  distinct_from?: { canonical_id: string; reason: string }[];
  name_unknown?: boolean;
}

/**
 * KEPUTUSAN RESOLUSI FASE 3 (2026-11-05) — diputuskan dari bukti terukur
 * (volume matches/logs/fixtures per id + kompetisi yang dimainkan) dan,
 * untuk identitas klub yang ambigu, web search. Bukan tebak-tebakan:
 * setiap pasangan membawa alasannya. Berlaku sebagai data di builder ini
 * supaya registry bisa dibangun ulang kapan pun dengan hasil sama.
 */
const MERGE_PAIRS: [string, string, string][] = [
  ["fd_andorra", "238115", "Satu klub: FC Andorra (Spanyol); baris fd cangkang nama pendek CSV."],
  ["fd_bayer-leverkusen", "tm_20832", "Satu klub: Bayer 04 Leverkusen; fd nama pendek CSV, tm pembawa data (145 match)."],
  ["fd_cambuur", "tm_10474", "Satu klub: SC Cambuur (Belanda); fd nama pendek CSV."],
  ["fd_groningen", "tm_26302", "Satu klub: FC Groningen (Belanda); fd nama pendek CSV."],
  ["fd_heerenveen", "tm_04732", "Satu klub: SC Heerenveen (Belanda); fd nama pendek CSV."],
  ["fd_sv-darmstadt-98", "482", "Satu klub: Darmstadt 98 (Jerman); fd nama pendek CSV."],
  ["fd_telstar", "tm_91047", "Satu klub: SC Telstar (Belanda); fd nama pendek CSV."],
  ["fd_tsg-1899-hoffenheim", "tm_73909", "Satu klub: TSG Hoffenheim (Jerman); fd nama pendek CSV."],
  ["254165", "605", "PECAHAN ENTITAS SM, bukan klub lain: id 254165 (nama tersimpan 'CF Benfica') membawa match Eropa SL Benfica (UCL 26, UEL 9) + sebagian domestik; id 605 membawa domestik (Liga Portugal 68). Digabung ke 605, nama pakem 'SL Benfica'. BUKAN Clube Futebol Benfica."],
  ["tm_master_sl_benfica", "605", "Nama persis 'SL Benfica'; sisa master 2 match, digabung ke pembawa utama 605."],
  ["17837", "9908", "Satu klub: Al-Ahli Saudi. Kedua id main di kompetisi yang sama (Saudi Pro sm:944 + ACL Elite sm:1085); 17837 cuma pecahan berlabel negara 'Asia'."],
  ["230422", "7780", "Cangkang 1 match tanpa telemetri, nama 'Al-Ain' = Al Ain (UEA, id 7780 pembawa 77 match). Label negara 'Saudi Arabia' di cangkang itu keliru konteks."],
  // Gelombang 3b: pasangan SM <-> TheStats nama sama, beda imbuhan saja
  // (FC/AC/AFC/huruf miring) — klub khas yang tidak mungkin tertukar,
  // negara sama, muncul dari permukaan standings/fixture.
  ["10655", "tm_02219", "Thun = FC Thun (Swiss); imbuhan FC saja."],
  ["132649", "tm_7937035", "Ararat-Armenia = FC Ararat-Armenia (Armenia); imbuhan FC saja."],
  ["1433", "tm_10419", "Almere City = Almere City FC (Belanda); imbuhan FC saja."],
  ["1668", "tm_6686", "Bodø/Glimt — beda ejaan garis miring saja (SM 'Bodø / Glimt')."],
  ["2727", "tm_89295", "Sparta Praha = AC Sparta Praha (Ceko); imbuhan AC saja."],
  ["353", "tm_64315", "St. Pauli = FC St. Pauli (Jerman); imbuhan FC saja."],
  ["3546", "tm_8366658", "Riga = Riga FC (Latvia); imbuhan FC saja."],
  ["496", "tm_master_st_mirren", "St. Mirren = St Mirren (Skotlandia); beda titik saja."],
  ["52", "tm_1772", "AFC Bournemouth = Bournemouth; bentuk pendek TheStats."],
  ["591", "tm_01119", "Paris Saint-Germain — beda tanda hubung saja."],
  ["734", "tm_master_st_johnstone", "St. Johnstone = St Johnstone (Skotlandia); beda titik saja."],
  ["83", "tm_37445", "FC Barcelona = Barcelona; imbuhan FC saja."],
  ["3608", "8364", "Racing Club: baris sintetis standings (Copa Sudamericana sm:1116) = id 8364 'Racing' yang membawa 237 match di sm:636/sm:770/sm:1116 — Racing Club de Avellaneda."],
  ["4508", "tm_11910", "'Paris' (id 4508) di fixture + standings Ligue 1 = Paris FC — PSG entitasnya terpisah di SM (id 591) dan ikut Ligue 1 yang sama, jadi 'Paris' bukan PSG."],
  ["fd_goztep", "3897", "Nama CSV football-data 'Goztep' adalah Göztepe yang terpotek diakritiknya (Turki, id SM 3897 'Göztepe') — ketahuan dari baris form 31 Okt: lawan Fenerbahçe tercatat dua kali karena dua id ini tidak tergabung."],
];

/** Pasangan yang TERBUKTI klub berbeda — jangan pernah digabung otomatis. */
const DISTINCT_PAIRS: [string, string, string][] = [
  ["10002", "2837", "River Plate Argentina vs River Plate Uruguay — dua klub berbeda (negara + volume data masing-masing besar)."],
  ["132434", "94617", "Ourense CF vs UD Ourense — dua klub berbeda dari kota yang sama (UD bubar 2014, Ourense CF klub terpisah)."],
  ["2079", "28207", "San Fernando CD (Cádiz, Andalusia) vs UD San Fernando (Maspalomas, Canarias) — klub berbeda."],
  ["26423", "28245", "Coria CF = Coria del Río, Andalusia (berdiri 1923) vs CD Coria = Coria, Cáceres, Extremadura (berdiri 1960) — terverifikasi web (Wikipedia kedua klub)."],
  ["277303", "278222", "Celoricense (entitas Campeonato de Portugal) vs SC Celoricense = Sporting Clube Celoricense, Celorico da Beira (berdiri 1948, liga distrik Guarda) — terverifikasi web (soccerzz/playmakerstats)."],
  ["10016", "238136", "Melilla vs Melilla CD — bukti belum cukup dan keduanya cangkang nyaris kosong (3+1 match, 0 log); dibiarkan terpisah sampai ada bukti."],
  ["4701", "82", "'VfL Bremen' (id 4701, 1 match) BUKAN Werder Bremen (id 82, pembawa 106 match) — kandidat ini artefak kunci longgar, bukan kemiripan klub."],
  ["18544", "84", "Qatar (tim NASIONAL, id 18544) vs Qatar SC (klub) — entitas berbeda kategori."],
];

/** Nama eksternal tanpa baris teams yang sudah diputuskan pemiliknya. */
const EXTRA_ALIASES: { name: string; member_id: string; reason: string }[] = [
  { name: "KV Mechelen", member_id: "2938", reason: "Nama CSV football-data (divisi B1) untuk klub yang di SM tersimpan sebagai 'Mechelen' (id 2938, Belgia). Satu-satunya nama tak ter-resolve di tasks/free-import-unmatched.json run terakhir." },
  // Nama bentuk CSV football-data di fit legacy (data/calibrated_ratings.json)
  // yang tidak sama persis dengan nama kanonik — diputuskan dari identitas
  // klub (divisi + negara + keunikan nama), diukur 2026-11-05: 41 nama,
  // 36 berjangkar di sini, 5 jadi entri legacy-only (LEGACY_ONLY_TEAMS).
  { name: "Seraing", member_id: "1674", reason: "Bentuk pendek CSV untuk RFC Seraing (B1 Belgia)." },
  { name: "Eupen", member_id: "2412", reason: "CSV 'Eupen' di B1 (kasta tertinggi) = KAS Eupen, bukan FC Eupen (entitas lain)." },
  { name: "Beerschot VA", member_id: "2432", reason: "Bentuk CSV untuk K. Beerschot V.A. (B1)." },
  { name: "RWD Molenbeek", member_id: "8307", reason: "RWD Molenbeek = RWDM Brussels (nama kini klub yang sama, B1)." },
  { name: "TSG 1899 Hoffenheim", member_id: "2726", reason: "Bentuk CSV dengan tahun berdiri; kanonik TSG Hoffenheim." },
  { name: "Bayer Leverkusen", member_id: "3321", reason: "Bentuk CSV tanpa '04'; kanonik Bayer 04 Leverkusen." },
  { name: "Ein Frankfurt", member_id: "366", reason: "Singkatan CSV 'Ein' = Eintracht Frankfurt (bukan FSV Frankfurt)." },
  { name: "SV Darmstadt 98", member_id: "482", reason: "Bentuk CSV dengan 'SV'; kanonik Darmstadt 98." },
  { name: "Wehen", member_id: "3519", reason: "Bentuk pendek CSV untuk Wehen Wiesbaden." },
  { name: "Huddersfield", member_id: "251", reason: "Bentuk pendek CSV untuk Huddersfield Town." },
  { name: "Peterboro", member_id: "254", reason: "Singkatan CSV untuk Peterborough United." },
  { name: "Rotherham", member_id: "138", reason: "Bentuk pendek CSV untuk Rotherham United." },
  { name: "Wigan", member_id: "17", reason: "Bentuk pendek CSV untuk Wigan Athletic." },
  { name: "Sheffield Weds", member_id: "56", reason: "Bentuk CSV untuk Sheffield Wednesday." },
  { name: "Giannina", member_id: "542", reason: "Bentuk pendek CSV untuk PAS Giannina (G1 Yunani)." },
  { name: "Athens Kallithea", member_id: "5406", reason: "Athens Kallithea FC = Kallithea (G1)." },
  { name: "Larisa", member_id: "1089", reason: "Bentuk CSV untuk Larissa / AEL (G1)." },
  { name: "Spal", member_id: "394", reason: "Ejaan CSV untuk SPAL (I2 Italia)." },
  { name: "SSC Bari", member_id: "445", reason: "SSC Bari = entitas Bari 1908 di SM (I2)." },
  { name: "Waalwijk", member_id: "814", reason: "Bentuk pendek CSV untuk RKC Waalwijk (N1)." },
  { name: "Heracles", member_id: "1403", reason: "Bentuk pendek CSV untuk Heracles Almelo (N1)." },
  { name: "Volendam", member_id: "2396", reason: "FC Volendam (N1) — bukan RKAV Volendam (amatir)." },
  { name: "Portimonense", member_id: "1658", reason: "Portimonense kasta tertinggi = Portimonense SAD (P1). Entitas SC terpisah di divisi bawah." },
  { name: "Belenenses", member_id: "258659", reason: "Nama CSV lintas era dijangkar ke CF Os Belenenses; era Belenenses SAD (2018+) tercatat sebagai ambiguitas nama yang sama di CSV." },
  { name: "Pacos Ferreira", member_id: "1122", reason: "Ejaan CSV tanpa cedilla untuk Pacos de Ferreira (P1)." },
  { name: "Santander", member_id: "9818", reason: "Bentuk pendek CSV untuk Racing de Santander (bukan tim II)." },
  { name: "La Coruna", member_id: "tm_98394", reason: "Bentuk CSV untuk Deportivo La Coruna (bukan tim II)." },
  { name: "Ibiza", member_id: "132590", reason: "Bentuk pendek CSV untuk UD Ibiza (SP2)." },
  { name: "Amorebieta", member_id: "2055", reason: "Bentuk pendek CSV untuk SD Amorebieta (SP2)." },
  { name: "Ferrol", member_id: "8396", reason: "Bentuk pendek CSV untuk Racing de Ferrol (SP2)." },
  { name: "Karagumruk", member_id: "3990", reason: "Ejaan CSV tanpa diakritik untuk Fatih Karagumruk (T1)." },
  { name: "Ad. Demirspor", member_id: "1039", reason: "Singkatan CSV untuk Adana Demirspor (T1) — bukan Adanaspor." },
  { name: "Bodrumspor", member_id: "13924", reason: "Bodrumspor = Bodrum FK (nama kini klub yang sama, T1)." },
];

/**
 * Klub yang HANYA ada di data legacy (fit divisi lama) dan tidak punya
 * padanan di permukaan SM/TheStats/fixture mana pun — didaftarkan sebagai
 * entri kanonik legacy-only supaya nama fit-nya punya rumah resmi.
 */
const LEGACY_ONLY_TEAMS: { stored: string; display: string; reason: string }[] = [
  { stored: "Oostende", display: "KV Oostende", reason: "Hanya ada di fit legacy B1; tidak ada padanan 'Oostende' di permukaan lain." },
  { stored: "Ionikos", display: "Ionikos", reason: "Hanya ada di fit legacy G1 (Ionikos Nikaia); tidak ada padanan di permukaan lain." },
  { stored: "Pordenone", display: "Pordenone", reason: "Hanya ada di fit legacy I2; tidak ada padanan di permukaan lain." },
  { stored: "Giresunspor", display: "Giresunspor", reason: "Hanya ada di fit legacy T1; tidak ada padanan di permukaan lain." },
  { stored: "Villarreal B", display: "Villarreal B", reason: "Tim B Villarreal di fit legacy SP2; registry hanya punya tim utama Villarreal CF — TIDAK digabung ke tim utama." },
];

/** Nama pakem yang menimpa hasil normalisasi untuk kanonik tertentu. */
const NAME_OVERRIDES: Record<string, string> = {
  "605": "SL Benfica",
  "8364": "Racing Club",
};

/**
 * Id kanonik paksa untuk grup hasil gabungan: id PEMBAWA UTAMA (volume
 * data terbesar), bukan anggota SM pertama yang ketemu. Kunci = salah
 * satu member id di grup itu.
 */
const CANONICAL_ID_OVERRIDES: Record<string, string> = {
  "605": "sm:605", // SL Benfica: 605 pembawa domestik+utama, 254165 pecahan Eropa
  "9908": "sm:9908", // Al-Ahli Saudi: 9908 pembawa 94 match, 17837 pecahan 28
  "7780": "sm:7780", // Al Ain: 7780 pembawa 77 match, 230422 cangkang 1 match
  "8364": "sm:8364", // Racing Club: 8364 pembawa 237 match, 3608 baris standings saja
};

/**
 * Label benua/kategori dari Sportmonks yang BUKAN negara ("World" saja
 * menempel di 3.286 baris tim). Untuk logika grouping/sengketa label ini
 * diperlakukan sebagai negara tidak diketahui — kalau tidak, nama yang
 * sama terbelah hanya karena satu baris berlabel "World" dan baris lain
 * berlabel negara aslinya.
 */
const NON_COUNTRIES = new Set([
  "World", "Europe", "Asia", "Africa", "South America", "North America",
  "Oceania", "Antarctica",
]);
const realCountry = (c: string | null): string | null =>
  c && !NON_COUNTRIES.has(c) ? c : null;

function systemOf(teamId: string): System {
  if (/^\d+$/.test(teamId)) return "sportmonks";
  if (teamId.startsWith("tm_")) return "thestats";
  if (teamId.startsWith("fd_")) return "football-data";
  return "other";
}

/** Kunci nama longgar untuk kandidat: buang diakritik + token generik. */
function looseKey(name: string): string {
  return sanitizeString(name)
    .toLowerCase()
    .replace(/\b(fc|afc|sc|cf|club|sv|ssc|ac|as|cd|ud|rc|1899|1900|1904|04|05|09)\b/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function main() {
  const ds = new DatabaseSync(path.join(ROOT, "data/thestats_dataset.db"), { readOnly: true });
  const rows = ds.prepare("SELECT team_id, name, country FROM teams").all() as unknown as {
    team_id: string; name: string; country: string | null;
  }[];
  // Permukaan standings: 167 team_id dirujuk standings tapi tidak punya
  // baris di tabel teams (audit 2026-11-04). Nama untuk 164 di antaranya
  // ada di baris fixture upcoming (id yang sama tampil bernama di sana);
  // sisanya (3) didaftarkan id-only berflag name_unknown — jujur, bukan
  // nama karangan. Baris sintetis ikut aturan grouping yang sama.
  const standingsIds = (ds.prepare("SELECT DISTINCT team_id FROM standings").all() as unknown as { team_id: string }[])
    .map((r) => r.team_id);
  ds.close();
  const up = new DatabaseSync(path.join(ROOT, "data/upcoming_fixtures.db"), { readOnly: true });
  const nameById = new Map<string, string>();
  for (const r of up.prepare("SELECT home_team_id AS id, home_team_name AS nm FROM upcoming_fixtures UNION SELECT away_team_id, away_team_name FROM upcoming_fixtures").all() as unknown as { id: string; nm: string }[]) {
    if (r.id && r.nm && !nameById.has(r.id)) nameById.set(r.id, r.nm);
  }
  up.close();
  const knownIds = new Set(rows.map((r) => r.team_id));
  const nameUnknownIds: string[] = [];
  let standingsSurfaced = 0;
  for (const sid of standingsIds) {
    if (knownIds.has(sid)) continue;
    const nm = nameById.get(sid);
    if (nm) {
      rows.push({ team_id: sid, name: nm, country: null });
      knownIds.add(sid);
      standingsSurfaced += 1;
    } else {
      nameUnknownIds.push(sid);
    }
  }
  // Permukaan fixture: id tim yang tampil bernama di katalog upcoming tapi
  // tidak punya baris teams dan tidak dirujuk standings (kebanyakan tim
  // TheStats mt_ dari kompetisi yang timnya tidak pernah diimpor ke
  // dataset). Mereka tim nyata dengan fixture — didaftarkan dari bukti
  // fixture dengan aturan grouping yang sama.
  let fixtureSurfaced = 0;
  {
    const up2 = new DatabaseSync(path.join(ROOT, "data/upcoming_fixtures.db"), { readOnly: true });
    const fxRows = up2.prepare(
      "SELECT home_team_id AS id, home_team_name AS nm FROM upcoming_fixtures UNION SELECT away_team_id, away_team_name FROM upcoming_fixtures",
    ).all() as unknown as { id: string; nm: string }[];
    up2.close();
    for (const r of fxRows) {
      if (!r.id || !r.nm || knownIds.has(r.id)) continue;
      knownIds.add(r.id);
      rows.push({ team_id: r.id, name: r.nm, country: null });
      fixtureSurfaced += 1;
    }
  }

  // Negara yang diketahui per nama ternormalisasi (untuk deteksi sengketa).
  // Hanya negara ASLI yang dihitung; label benua diperlakukan tak diketahui.
  const countriesByName = new Map<string, Set<string>>();
  for (const r of rows) {
    const n = normalizeTeamName(r.name);
    if (!countriesByName.has(n)) countriesByName.set(n, new Set());
    const rc = realCountry(r.country);
    if (rc) countriesByName.get(n)!.add(rc);
  }

  // Kelompokkan: kunci = nama ternormalisasi + (negara asli bila sengketa).
  const groups = new Map<string, { name: string; members: (typeof rows)[number][]; contested: boolean }>();
  for (const r of rows) {
    const n = normalizeTeamName(r.name);
    const contested = (countriesByName.get(n)?.size ?? 0) >= 2;
    const key = contested ? `${n}||${realCountry(r.country) ?? "?"}` : n;
    if (!groups.has(key)) groups.set(key, { name: n, members: [], contested });
    groups.get(key)!.members.push(r);
  }

  const teams: CanonTeam[] = [];
  for (const g of groups.values()) {
    const seen = new Set<string>();
    const members: Member[] = [];
    for (const m of g.members) {
      if (seen.has(m.team_id)) continue;
      seen.add(m.team_id);
      members.push({ system: systemOf(m.team_id), team_id: m.team_id, name_as_stored: m.name });
    }
    const sm = members.find((m) => m.system === "sportmonks");
    const tm = members.find((m) => m.system === "thestats");
    const canonical_id = sm ? `sm:${sm.team_id}` : tm ? tm.team_id : members[0].team_id;
    const baseName = sm?.name_as_stored ?? members[0].name_as_stored;
    const country =
      g.members.find((m) => realCountry(m.country))?.country ??
      g.members.find((m) => m.country)?.country ??
      null;
    const aliases = [...new Set(members.map((m) => m.name_as_stored))].sort();
    teams.push({
      canonical_id,
      name: normalizeTeamName(baseName),
      country,
      members,
      aliases,
      contested_name: g.contested,
    });
  }
  // --- Fase 3: terapkan keputusan resolusi (gabung terbukti + beda terbukti).
  const byMember = () => {
    const m = new Map<string, CanonTeam>();
    for (const t of teams) for (const mb of t.members) m.set(mb.team_id, t);
    return m;
  };
  const pickCanonical = (members: Member[]): string => {
    for (const m of members) {
      const forced = CANONICAL_ID_OVERRIDES[m.team_id];
      if (forced) return forced;
    }
    const sm = members.find((m) => m.system === "sportmonks");
    const tm = members.find((m) => m.system === "thestats");
    return sm ? `sm:${sm.team_id}` : tm ? tm.team_id : members[0].team_id;
  };
  let mergesApplied = 0;
  const mergeTeams = (ta: CanonTeam, tb: CanonTeam, reason: string): void => {
    const members = [...ta.members, ...tb.members];
    const survivor: CanonTeam = {
      canonical_id: pickCanonical(members),
      name: ta.name,
      country: ta.country ?? tb.country,
      members,
      aliases: [...new Set([...ta.aliases, ...tb.aliases])].sort(),
      contested_name: ta.contested_name || tb.contested_name,
      resolution_notes: [...(ta.resolution_notes ?? []), ...(tb.resolution_notes ?? []), reason],
      distinct_from: [...(ta.distinct_from ?? []), ...(tb.distinct_from ?? [])],
    };
    // Nama pakem: nama tersimpan anggota yang jadi id kanonik, dinormalisasi.
    const canonMember =
      members.find((m) => `sm:${m.team_id}` === survivor.canonical_id || m.team_id === survivor.canonical_id) ??
      members.find((m) => m.system === "sportmonks");
    survivor.name = normalizeTeamName(canonMember?.name_as_stored ?? survivor.name);
    teams.splice(teams.indexOf(ta), 1);
    teams.splice(teams.indexOf(tb), 1);
    teams.push(survivor);
    mergesApplied += 1;
  };
  for (const [a, b, reason] of MERGE_PAIRS) {
    const idx = byMember();
    const ta = idx.get(a);
    const tb = idx.get(b);
    if (!ta || !tb || ta === tb) continue;
    mergeTeams(ta, tb, reason);
  }
  // Grup bayangan: tim kanonik LAIN yang namanya persis sama dengan alias
  // yang sudah diputuskan (lahir dari permukaan fixture/standings, mis.
  // fd_kv-mechelen bernama "KV Mechelen") harus ikut ke target alias —
  // kalau tidak, nama itu menunjuk dua kanonik sekaligus dan alias
  // keputusan kalah oleh urutan abjad.
  for (const ea of EXTRA_ALIASES) {
    const target = byMember().get(ea.member_id);
    if (!target) continue;
    const shadow = teams.find((t) => t !== target && t.name === ea.name);
    if (shadow) {
      mergeTeams(target, shadow, `Grup bayangan "${ea.name}" digabung ke target alias yang diputuskan (${ea.reason})`);
    }
  }
  for (const [memberId, display] of Object.entries(NAME_OVERRIDES)) {
    const t = byMember().get(memberId);
    if (t) t.name = display;
  }
  for (const [a, b, reason] of DISTINCT_PAIRS) {
    const idx = byMember();
    const ta = idx.get(a);
    const tb = idx.get(b);
    if (!ta || !tb || ta === tb) continue;
    (ta.distinct_from ??= []).push({ canonical_id: tb.canonical_id, reason });
    (tb.distinct_from ??= []).push({ canonical_id: ta.canonical_id, reason });
  }
  for (const ea of EXTRA_ALIASES) {
    const t = byMember().get(ea.member_id);
    if (t) {
      if (!t.aliases.includes(ea.name)) t.aliases.push(ea.name);
      (t.resolution_notes ??= []).push(`Alias eksternal diputuskan: "${ea.name}" — ${ea.reason}`);
    }
  }

  // Entri legacy-only: klub yang hanya hidup di fit divisi lama.
  for (const lt of LEGACY_ONLY_TEAMS) {
    teams.push({
      canonical_id: `legacy:${lt.stored.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: lt.display,
      country: null,
      members: [{ system: "other", team_id: `legacy-name:${lt.stored}`, name_as_stored: lt.stored }],
      aliases: [lt.stored],
      contested_name: false,
      resolution_notes: [lt.reason],
    });
  }

  // Entri id-only untuk id standings yang namanya tidak ditemukan di
  // permukaan lokal mana pun — tetap terdaftar supaya setiap referensi
  // punya rumah di registry, dengan flag jujur name_unknown.
  for (const sid of nameUnknownIds) {
    teams.push({
      canonical_id: `sm:${sid}`,
      name: `Sportmonks team ${sid} (nama belum diketahui)`,
      country: null,
      members: [{ system: "sportmonks", team_id: sid, name_as_stored: "" }],
      aliases: [],
      contested_name: false,
      resolution_notes: ["Id dirujuk standings tapi tidak bernama di permukaan lokal mana pun (0 match, 0 telemetri). Didaftarkan id-only; nama diisi bila tim ini kelak punya match/fixture bernama."],
      name_unknown: true,
    });
  }

  teams.sort((a, b) => a.canonical_id.localeCompare(b.canonical_id));

  // Kandidat pasangan mirip (TIDAK digabung): kunci longgar sama tapi beda grup.
  const byLoose = new Map<string, CanonTeam[]>();
  for (const t of teams) {
    const k = looseKey(t.name);
    if (!byLoose.has(k)) byLoose.set(k, []);
    byLoose.get(k)!.push(t);
  }
  const candidates: { loose: string; ids: string[]; names: string[] }[] = [];
  for (const [k, ts] of byLoose) {
    if (k.length >= 4 && ts.length > 1) {
      candidates.push({ loose: k, ids: ts.map((t) => t.canonical_id), names: ts.map((t) => t.name) });
    }
  }

  const merged = teams.filter((t) => t.members.length > 1);
  const multiSystem = teams.filter((t) => new Set(t.members.map((m) => m.system)).size > 1);
  const contested = teams.filter((t) => t.contested_name);
  const out = {
    version: 1,
    generated_at: new Date().toISOString(),
    generator: "scripts/build-team-canonical.ts",
    note: "Acuan pakem identitas tim: satu canonical_id per tim nyata. members = id per sistem sumber; aliases = semua bentuk nama tersimpan. Penggabungan konservatif (nama ternormalisasi sama + negara tidak bertentangan); pasangan kandidat yang belum digabung ada di tasks/team-canonical-report.md.",
    teams,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  const lines: string[] = [];
  lines.push("# Registry Kanonik Tim — Laporan Build");
  lines.push("");
  lines.push(`Dibangun: ${out.generated_at}`);
  lines.push("");
  lines.push("## Angka");
  lines.push("");
  lines.push(`- Baris tim sumber (tabel teams): **${rows.length}**`);
  lines.push(`- Tim kanonik hasil: **${teams.length}**`);
  lines.push(`- Grup tergabung (>1 baris sumber): **${merged.length}** (menyerap ${merged.reduce((s, t) => s + t.members.length - 1, 0)} baris ekstra)`);
  lines.push(`- Grup lintas sistem (>1 sumber): **${multiSystem.length}**`);
  lines.push(`- Tim bernama sengketa (≥2 negara): **${contested.length}** entri`);
  lines.push(`- Pasangan kandidat mirip BELUM digabung: **${candidates.length}**`);
  lines.push(`- Keputusan resolusi fase 3 diterapkan: **${mergesApplied} penggabungan terbukti**, **${DISTINCT_PAIRS.length} pasangan terbukti klub BERBEDA** (dicatat distinct_from, tidak akan digabung), **${EXTRA_ALIASES.length} alias eksternal**.`);
  lines.push(`- Permukaan standings: **${standingsSurfaced} id** tanpa baris teams didaftarkan dari nama fixture; **${nameUnknownIds.length} id** terdaftar id-only (name_unknown: ${nameUnknownIds.join(", ") || "-"}). Cakupan standings sekarang penuh.`);
  lines.push(`- Permukaan fixture: **${fixtureSurfaced} id** tim katalog tanpa baris teams didaftarkan dari bukti fixture (nama + id-nya sendiri).`);
  lines.push("");
  lines.push("## Keputusan resolusi fase 3 (bukti terukur + web untuk identitas ambigu)");
  lines.push("");
  for (const [a, b, r] of MERGE_PAIRS) lines.push(`- GABUNG \`${a}\` + \`${b}\` — ${r}`);
  for (const [a, b, r] of DISTINCT_PAIRS) lines.push(`- BEDA \`${a}\` + \`${b}\` — ${r}`);
  lines.push("");
  lines.push("## Contoh grup lintas sistem");
  lines.push("");
  for (const t of multiSystem.slice(0, 15)) {
    lines.push(`- \`${t.canonical_id}\` ${t.name} (${t.country ?? "?"}): ${t.members.map((m) => `${m.system}:${m.team_id}="${m.name_as_stored}"`).join(" · ")}`);
  }
  lines.push("");
  lines.push("## Kandidat mirip (keputusan fase resolusi)");
  lines.push("");
  for (const c of candidates.slice(0, 60)) {
    lines.push(`- kunci "${c.loose}": ${c.ids.map((id, i) => `\`${id}\` ${c.names[i]}`).join("  vs  ")}`);
  }
  if (candidates.length > 60) lines.push(`- …dan ${candidates.length - 60} lagi (lihat data/team-canonical.json untuk turunan penuh).`);
  lines.push("");
  fs.writeFileSync(REPORT, lines.join("\n"));

  console.log(`teams sumber=${rows.length} kanonik=${teams.length} grup-tergabung=${merged.length} lintas-sistem=${multiSystem.length} sengketa=${contested.length} kandidat=${candidates.length} resolusi-gabung=${mergesApplied}`);
  console.log(`tertulis: ${OUT} + ${REPORT}`);
}

main();
