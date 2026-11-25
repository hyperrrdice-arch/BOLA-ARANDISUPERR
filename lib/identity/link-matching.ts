/**
 * lib/identity/link-matching.ts — pencocokan laga kembar TOLERAN untuk
 * builder tautan katalog (scripts/build-fixture-links.ts) dan penjaga
 * cadangan slate (lib/picks/slate-identity.ts). Lanjut-5, branch
 * fix/lanjut-5-kembar-tak-tertaut.
 *
 * Masalah yang diperbaiki (terverifikasi produksi 22 Nov 2026): builder
 * tautan lama menuntut kickoff PERSIS + tim kanonik PERSIS, sehingga 4
 * pasangan laga fisik yang sama lolos tak tertaut dan slate/ledger
 * mencatatnya dua kali (187 rated = 183 unik; 26 pick dobel):
 *
 *   1. Beveren vs Gent — lolos lewat BELAHAN REGISTRY: "SK Beveren"
 *      ter-resolusi ke sm:1272, "Beveren" ke sm:6723 (dua entri untuk
 *      klub yang sama; registry sengaja TIDAK digabung — tersangka
 *      over-merge tertahan sejak redesain).
 *   2. Lommel SK vs Standard — belahan yang sama: sm:700
 *      ("Standard Liege") vs fd_standard ("Standard").
 *   3. Osasuna vs Málaga — tim sama persis, kickoff baris mt_ meleset
 *      +90 menit dari baris sm_.
 *   4. Getafe vs Atlético Madrid — tim sama persis, kickoff mt_
 *      meleset −60 menit.
 *
 * Modul ini SATU-SATUNYA sumber kebenaran pencocokan toleran:
 *
 *   - Alias tim LEVEL TAUTAN (data/link-team-aliases.json): memetakan
 *     canonical_id registry yang merujuk klub yang sama ke satu kunci
 *     identitas tautan. Dipakai HANYA untuk pencocokan tautan —
 *     registry tim tidak pernah diubah oleh modul ini.
 *   - Klaster kembar: baris katalog dikelompokkan oleh konteks liga +
 *     kunci tautan kandang/tamu, lalu dirangkai (chain) bila jarak
 *     kickoff antar baris berurutan ≤ TWIN_KICKOFF_TOLERANCE_MIN.
 *     Konteks liga = canonical_id liga (lib/quant/league-identity);
 *     bila salah satu sisi tak ter-resolusi, nama liga ternormalisasi
 *     yang memutuskan. Orientasi kandang/tamu ketat (baris tertukar
 *     bukan kembar).
 *   - Wakil klaster: baris sm_ (kickoff paling awal, lalu match_id)
 *     bila ada; selain itu baris paling awal — aturan yang sama dengan
 *     builder lama (sm_ selalu kanonik).
 *
 * Toleransi 120 menit: drift yang terbukti di produksi ≤ 90 menit;
 * toleransi memberi ruang di atasnya sambil tetap jauh di bawah jarak
 * antar dua laga BERBEDA antara tim yang sama (selalu ≥ 1 hari).
 *
 * Perluasan Kembar-Free-Mode (25 Nov 2026, branch fix/kembar-free-mode):
 * kelas belahan registry BARU — entri kanonik fd_ yang dibuat builder
 * registry dari feed CSV ("Aldershot", "Solihull", "Kidderminster",
 * "Doncaster") TIDAK menyatu dengan entri sm: klub yang sama
 * ("Aldershot Town", "Solihull Moors", "Kidderminster Harriers",
 * "Doncaster Rovers"), sementara entri fd_ lain (fd_hartlepool,
 * fd_harrogate) sudah jadi member entri sm:. Baris fd_ ter-resolusi
 * lewat team_id ke canonical fd_-nya sendiri → kunci tautan beda →
 * 4 pasangan lolos builder DAN penjaga cadangan slate (produksi
 * 25 Nov 2026: 59 pick ledger untuk 4 laga fisik). Perbaikannya di
 * LEVEL TAUTAN juga: aturan varian-akhiran nama (lihat
 * suffixVariantGroups) menyatukan kunci entri fd_ yang namanya adalah
 * awalan-token PERSIS dari TEPAT SATU nama kanonik non-fd_ — ambigu
 * (≥2 kandidat, mis. "Bradford" → City/Town/Park Avenue) menolak
 * menyatu dan tetap urusan alias manual berbasis bukti per laga.
 * Penyatuan KUNCI bukan tautan: klaster tetap menuntut lawan sama +
 * konteks liga cocok + kickoff ≤120 menit, jadi kunci yang menyatu
 * tidak pernah menautkan laga yang berbeda (mis. "Queens Park" →
 * kandidat tunggal "Queens Park Rangers" adalah klub LAIN, tetapi
 * keduanya tidak pernah berbagi lawan/liga/kickoff yang sama).
 */

import fs from "node:fs";
import path from "node:path";
import { getCanonicalBySourceId, leagueNameKey } from "../quant/league-identity";

/** Toleransi drift kickoff antar baris kembar (menit). Bukti: ≤ 90. */
export const TWIN_KICKOFF_TOLERANCE_MIN = 120;

/* ------------------------------------------------ alias tim level tautan */

export interface LinkTeamAliasGroup {
  link_id: string;
  canonical_ids: string[];
  names?: string[];
  reason?: string;
}

export interface LinkTeamAliases {
  version: number;
  groups: LinkTeamAliasGroup[];
}

const ALIASES_KOSONG: LinkTeamAliases = { version: 1, groups: [] };

/**
 * Parse isi data/link-team-aliases.json secara gagal-lembut: berkas
 * rusak / bentuk tak dikenal → tanpa alias (perilaku builder lama:
 * kunci registry mentah), bukan tebakan.
 */
export function parseLinkTeamAliases(text: string): LinkTeamAliases {
  try {
    const parsed = JSON.parse(text) as { groups?: unknown };
    if (!Array.isArray(parsed.groups)) return ALIASES_KOSONG;
    const groups = parsed.groups.filter(
      (g): g is LinkTeamAliasGroup =>
        typeof g === "object" &&
        g !== null &&
        typeof (g as LinkTeamAliasGroup).link_id === "string" &&
        Array.isArray((g as LinkTeamAliasGroup).canonical_ids) &&
        (g as LinkTeamAliasGroup).canonical_ids.every(
          (c) => typeof c === "string",
        ),
    );
    return { version: 1, groups };
  } catch {
    return ALIASES_KOSONG;
  }
}

/** Muat alias level tautan dari direktori data (gagal-lembut). */
export function loadLinkTeamAliases(dataDir: string): LinkTeamAliases {
  const p = path.join(dataDir, "link-team-aliases.json");
  if (!fs.existsSync(p)) return ALIASES_KOSONG;
  return parseLinkTeamAliases(fs.readFileSync(p, "utf8"));
}

/**
 * Fungsi kunci tautan: canonical_id yang termasuk grup alias → link_id
 * grupnya; canonical_id lain → dirinya sendiri (identitas registry).
 */
export function linkTeamKeyFn(
  aliases: LinkTeamAliases,
): (canonicalId: string) => string {
  const map = new Map<string, string>();
  for (const g of aliases.groups) {
    for (const cid of g.canonical_ids) map.set(cid, g.link_id);
  }
  return (cid: string) => map.get(cid) ?? cid;
}

/* ------------------------------------- varian akhiran nama (kelas fd_) */

/** Token nama ternormalisasi untuk perbandingan awalan (huruf kecil, tanpa diakritik/tanda baca). */
export function linkNameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 0);
}

export interface SuffixVariantGroup {
  /** canonical_id entri fd_ bernama pendek. */
  short_id: string;
  /** canonical_id entri non-fd_ bernama panjang (target penyatuan). */
  long_id: string;
  short_name: string;
  long_name: string;
}

/**
 * Grup varian-akhiran dari registry: entri kanonik ber-namespace fd_
 * yang nama ternormalisasinya adalah AWALAN TOKEN PERSIS (proper
 * prefix — token lebih sedikit, semua token cocok berurutan) dari
 * nama TEPAT SATU entri kanonik non-fd_. Tepat-satu adalah syarat
 * keras: 0 kandidat → bukan kelas ini; ≥2 kandidat → AMBIGU dan
 * ditolak (penyatuan ditebak dari nama semata bisa menggabung klub
 * berbeda — "Bradford" adalah awalan City, Town, dan Park Avenue).
 * Nama yang IDENTIK antar-namespace (token sama persis, bukan awalan
 * sejati) TIDAK disatukan di sini: belahan nama-identik (mis. dua
 * "Everton" beda negara) tetap urusan alias manual berbasis bukti.
 *
 * Bukti kelas (registry produksi 25 Nov 2026): 38 entri fd_; 30
 * berelasi awalan; 22 unik (termasuk 4 penyebab bug: fd_aldershot →
 * sm:194, fd_solihull → sm:1030, fd_kidderminster → sm:832,
 * fd_doncaster → sm:235); 8 ambigu ditolak.
 */
export function suffixVariantGroups(reg: TeamRegistryFile): SuffixVariantGroup[] {
  const out: SuffixVariantGroup[] = [];
  const others = reg.teams.filter((t) => !t.canonical_id.startsWith("fd_"));
  const otherTokens = others.map((t) => ({ t, toks: linkNameTokens(t.name) }));
  for (const f of reg.teams) {
    if (!f.canonical_id.startsWith("fd_")) continue;
    const ft = linkNameTokens(f.name);
    if (ft.length === 0) continue;
    const hits = otherTokens.filter(
      ({ toks }) =>
        toks.length > ft.length && ft.every((tok, i) => tok === toks[i]),
    );
    if (hits.length !== 1) continue;
    out.push({
      short_id: f.canonical_id,
      long_id: hits[0].t.canonical_id,
      short_name: f.name,
      long_name: hits[0].t.name,
    });
  }
  return out;
}

/**
 * Fungsi kunci tautan KOMPOSIT (dipakai builder tautan + penjaga
 * cadangan slate): pertama entri fd_ varian-akhiran dipetakan ke
 * canonical_id panjangnya, lalu alias manual diterapkan atas hasil
 * itu (alias manual selalu menang dan tetap satu-satunya jalur untuk
 * belahan nama-identik / lintas-namespace non-fd_). Registry tidak
 * pernah diubah — ini murni fungsi kunci pencocokan.
 */
export function buildLinkTeamKeyFn(
  reg: TeamRegistryFile,
  aliases: LinkTeamAliases,
): (canonicalId: string) => string {
  const base = linkTeamKeyFn(aliases);
  const variant = new Map<string, string>();
  for (const g of suffixVariantGroups(reg)) {
    variant.set(g.short_id, g.long_id);
    if (!variant.has(g.long_id)) variant.set(g.long_id, g.long_id);
  }
  return (cid: string) => base(variant.get(cid) ?? cid);
}

/* ------------------------------------------------------- resolusi tim katalog */

export interface TeamRegistryFile {
  teams: {
    canonical_id: string;
    name: string;
    members: { team_id: string }[];
    aliases: string[];
  }[];
}

export interface TeamResolver {
  /** id tim sumber → canonical_id (null bila tak dikenal). */
  byTeamId(id: string): string | null;
  /** nama fixture → canonical_id (nama kanonik dulu, lalu alias). */
  byName(name: string): string | null;
  /** Resolusi baris katalog: id dulu, nama sebagai cadangan (aturan builder lama). */
  resolve(teamId: string, teamName: string): string | null;
}

export function buildTeamResolver(reg: TeamRegistryFile): TeamResolver {
  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const t of reg.teams) {
    for (const m of t.members) byId.set(m.team_id, t.canonical_id);
    byName.set(t.name, t.canonical_id);
    for (const a of t.aliases) if (!byName.has(a)) byName.set(a, t.canonical_id);
  }
  return {
    byTeamId: (id) => byId.get(id) ?? null,
    byName: (name) => byName.get(name) ?? null,
    resolve: (id, name) => byId.get(id) ?? byName.get(name) ?? null,
  };
}

/* ------------------------------------------------------------- konteks liga */

export interface LeagueContext {
  /** canonical_id liga (lib/quant/league-identity); null bila tak ter-resolusi. */
  canonical: string | null;
  /** Kunci nama liga ternormalisasi (cadangan bila canonical tak ada). */
  name_key: string;
}

export function leagueContext(
  competitionId: string | null | undefined,
  competitionName: string | null | undefined,
): LeagueContext {
  return {
    canonical: competitionId
      ? (getCanonicalBySourceId(competitionId)?.canonical_id ?? null)
      : null,
    name_key: leagueNameKey(competitionName ?? ""),
  };
}

/**
 * Dua konteks liga cocok bila: kedua canonical ada → harus sama; selain
 * itu (salah satu tak ter-resolusi) → kunci nama harus sama. Mencegah
 * tautan lintas kompetisi (liga vs piala) untuk pasangan tim yang sama.
 */
export function leagueContextsCompatible(
  a: LeagueContext,
  b: LeagueContext,
): boolean {
  if (a.canonical && b.canonical) return a.canonical === b.canonical;
  return a.name_key !== "" && a.name_key === b.name_key;
}

/* ------------------------------------------------------------ baris katalog */

export interface LinkableFixtureRow {
  match_id: string;
  competition_id: string | null;
  competition_name: string | null;
  utc_date: string;
  home_team_id: string;
  home_team_name: string;
  away_team_id: string;
  away_team_name: string;
}

export interface ResolvedLinkRow extends LinkableFixtureRow {
  /** canonical_id registry kedua tim (identitas registry, bukan kunci tautan). */
  home_cid: string;
  away_cid: string;
  /** Kunci identitas LEVEL TAUTAN (alias diterapkan) untuk pencocokan. */
  home_key: string;
  away_key: string;
  league: LeagueContext;
  kickoff_ms: number;
}

/**
 * Resolusi satu baris katalog ke bentuk yang bisa dicocokkan; null bila
 * salah satu tim tak ter-resolusi (baris di luar pencocokan, dihitung
 * terpisah oleh pemanggil — perilaku builder lama).
 */
export function resolveLinkRow(
  row: LinkableFixtureRow,
  resolver: TeamResolver,
  linkKeyOf: (canonicalId: string) => string,
): ResolvedLinkRow | null {
  const homeCid = resolver.resolve(row.home_team_id, row.home_team_name);
  const awayCid = resolver.resolve(row.away_team_id, row.away_team_name);
  if (!homeCid || !awayCid) return null;
  const kickoffMs = Date.parse(row.utc_date);
  if (!Number.isFinite(kickoffMs)) return null;
  return {
    ...row,
    home_cid: homeCid,
    away_cid: awayCid,
    home_key: linkKeyOf(homeCid),
    away_key: linkKeyOf(awayCid),
    league: leagueContext(row.competition_id, row.competition_name),
    kickoff_ms: kickoffMs,
  };
}

/* ------------------------------------------------------------ klaster kembar */

export interface TwinCluster {
  /** Semua baris klaster, terurut kickoff lalu match_id. */
  rows: ResolvedLinkRow[];
  /** Baris wakil: sm_ paling awal bila ada, selain itu baris paling awal. */
  canonical: ResolvedLinkRow;
  /** 'exact' bila semua kickoff identik; 'tolerant' bila ada drift. */
  kind: "exact" | "tolerant";
}

function pickCanonical(rows: ResolvedLinkRow[]): ResolvedLinkRow {
  const sm = rows.filter((r) => r.match_id.startsWith("sm_"));
  return (sm.length > 0 ? sm : rows)[0];
}

/**
 * Bentuk klaster kembar dari baris-baris ter-resolusi: kelompok
 * (kunci tautan kandang|tamu) → urut kickoff → rangkai bila jarak
 * antar baris berurutan ≤ toleransi DAN konteks liga cocok dengan
 * baris sebelumnya dalam rantai. Klaster beranggota ≥ 2 yang kembali;
 * baris tunggal tidak membentuk klaster. Deterministik penuh.
 */
export function clusterTwinRows(
  rows: ResolvedLinkRow[],
  toleranceMin: number = TWIN_KICKOFF_TOLERANCE_MIN,
): TwinCluster[] {
  const tolMs = toleranceMin * 60_000;
  const groups = new Map<string, ResolvedLinkRow[]>();
  for (const r of rows) {
    const key = `${r.home_key}|${r.away_key}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const clusters: TwinCluster[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort(
      (a, b) =>
        a.kickoff_ms - b.kickoff_ms || a.match_id.localeCompare(b.match_id),
    );
    let chain: ResolvedLinkRow[] = [sorted[0]];
    const flush = () => {
      if (chain.length >= 2) {
        const exact = chain.every((r) => r.kickoff_ms === chain[0].kickoff_ms);
        clusters.push({
          rows: chain,
          canonical: pickCanonical(chain),
          kind: exact ? "exact" : "tolerant",
        });
      }
      chain = [];
    };
    for (let i = 1; i < sorted.length; i++) {
      const prev = chain[chain.length - 1];
      const gap = sorted[i].kickoff_ms - prev.kickoff_ms;
      if (gap <= tolMs && leagueContextsCompatible(prev.league, sorted[i].league)) {
        chain.push(sorted[i]);
      } else {
        flush();
        chain = [sorted[i]];
      }
    }
    flush();
  }
  clusters.sort((a, b) =>
    a.canonical.match_id.localeCompare(b.canonical.match_id),
  );
  return clusters;
}
