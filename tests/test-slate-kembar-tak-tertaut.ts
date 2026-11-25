/**
 * LANJUT-5 — slate/ledger menghitung laga kembar TAK TERTAUT dua kali
 * (branch fix/lanjut-5-kembar-tak-tertaut).
 *
 * Temuan produksi (terverifikasi Hikari di VPS US 22 Nov 2026 ±17.22
 * WIB): slate refresh 16.21 WIB lolos uji kembar TERTAUT Lanjut-4
 * (0 pasang), tapi masih memuat 4 pasang kembar yang TIDAK tertaut di
 * data/fixture-links.json — 187 rated ternyata 183 laga unik, 1.327
 * pick ternyata 1.301 unik (26 dobel), dan kedua baris keempat pasang
 * sudah tercatat di picks.db produksi:
 *
 *   1. Beveren vs Gent (sm_19726013 + fd_B1_20261122_beveren_gent) —
 *      belahan registry: "SK Beveren" sm:1272 vs "Beveren" sm:6723.
 *   2. Osasuna vs Málaga (sm_19732617 + mt_377354841) — kickoff mt_
 *      meleset +90 menit.
 *   3. Lommel SK vs Standard (sm_19726005 + fd_B1_20261122_lommel-sk_
 *      standard) — belahan registry: sm:700 vs fd_standard.
 *   4. Getafe vs Atlético Madrid (mt_466492726 + sm_19732619) —
 *      kickoff mt_ meleset −60 menit.
 *
 * Akar: builder tautan menuntut kickoff persis + tim kanonik persis,
 * tanpa konteks liga — ia juga menautkan secara KELIRU dua pasang
 * baris placeholder "Nth ranked" dari liga berbeda (Liga MX vs
 * Serie B) yang kini dibekukan di fixture sebagai kontrol negatif.
 *
 * Perbaikan yang diuji di sini:
 *   FASE PRA  — kunci builder lama (verbatim @ 3431908) atas baris
 *               beku: 0 dari 4 pasang tertaut (defek terlihat) DAN
 *               2 tautan palsu "ranked" terbentuk (defek kedua).
 *   FASE PASCA builder — lib/identity/link-matching.ts + registry &
 *               alias repo sebenarnya: tepat 4 klaster, wakil selalu
 *               baris sm_, jenis exact/tolerant tepat; baris "ranked"
 *               TIDAK membentuk klaster (konteks liga memisahkan).
 *   FASE PASCA penjaga — penjaga cadangan slate (lib/picks/
 *               slate-identity.ts): kembar terblokir di titik tulis
 *               walau belum tertaut, wakil bebas terbit, baris tunggal
 *               tidak pernah terblokir (anti kehilangan cakupan).
 *
 * Jalankan: npx tsx tests/test-slate-kembar-tak-tertaut.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Suite } from "./helpers/fixture-env";
import {
  buildLinkTeamKeyFn,
  buildTeamResolver,
  clusterTwinRows,
  linkNameTokens,
  linkTeamKeyFn,
  loadLinkTeamAliases,
  parseLinkTeamAliases,
  resolveLinkRow,
  suffixVariantGroups,
  TWIN_KICKOFF_TOLERANCE_MIN,
  type LinkableFixtureRow,
  type ResolvedLinkRow,
  type TeamRegistryFile,
} from "../lib/identity/link-matching";
import {
  fallbackBlockReason,
  fallbackGroupKey,
  samePhysicalFallback,
  type FallbackFixtureRef,
} from "../lib/picks/slate-identity";

const suite = new Suite("slate-kembar-tak-tertaut");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, "..", "data");

/* ------------------------------------------------------------ fixture */

interface PasanganBeku {
  nama: string;
  jenis: "exact-alias" | "tolerant-drift";
  canonical_id: string;
  anggota: LinkableFixtureRow[];
}

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(HERE, "fixtures", "slate-kembar-tak-tertaut.json"),
    "utf8",
  ),
) as {
  pairs: PasanganBeku[];
  positif_palsu_lama: { anggota: LinkableFixtureRow[] }[];
};

const pairs = fixture.pairs;
suite.eq("fixture beku memuat 4 pasang produksi", pairs.length, 4);
suite.eq(
  "fixture beku memuat 2 pasang positif-palsu kunci lama",
  fixture.positif_palsu_lama.length,
  2,
);
const semuaBaris: LinkableFixtureRow[] = pairs.flatMap((p) => p.anggota);
suite.eq("fixture beku memuat 8 baris katalog", semuaBaris.length, 8);
const barisRanked: LinkableFixtureRow[] =
  fixture.positif_palsu_lama.flatMap((p) => p.anggota);

/* ------------------------------------------- registry + alias repo asli */

const reg = JSON.parse(
  fs.readFileSync(path.join(DATA, "team-canonical.json"), "utf8"),
) as TeamRegistryFile;
const resolver = buildTeamResolver(reg);
const aliases = loadLinkTeamAliases(DATA);
const linkKeyOf = linkTeamKeyFn(aliases);

suite.eq("alias level tautan repo memuat 2 grup", aliases.groups.length, 2);
suite.eq("kunci tautan sm:1272 (SK Beveren)", linkKeyOf("sm:1272"), "beveren");
suite.eq("kunci tautan sm:6723 (Beveren)", linkKeyOf("sm:6723"), "beveren");
suite.eq(
  "kunci tautan sm:700 (Standard Liege)",
  linkKeyOf("sm:700"),
  "standard-liege",
);
suite.eq(
  "kunci tautan fd_standard (Standard)",
  linkKeyOf("fd_standard"),
  "standard-liege",
);
suite.eq(
  "kunci tautan tim tanpa alias = canonical_id sendiri",
  linkKeyOf("sm:459"),
  "sm:459",
);
suite.eq(
  "parse alias rusak → tanpa alias (gagal-lembut)",
  parseLinkTeamAliases("{rusak").groups.length,
  0,
);
suite.eq(
  "parse alias tanpa field groups → tanpa alias",
  parseLinkTeamAliases("{}").groups.length,
  0,
);

/* ------------------------------------------- FASE PRA — reproduksi beku */

/** Kunci builder lama, verbatim dari build-fixture-links.ts @ 3431908. */
function tautanLama(rows: LinkableFixtureRow[]) {
  const groups = new Map<string, string[]>();
  for (const f of rows) {
    const ch = resolver.resolve(f.home_team_id, f.home_team_name);
    const ca = resolver.resolve(f.away_team_id, f.away_team_name);
    if (!ch || !ca) continue;
    const key = `${f.utc_date}|${ch}|${ca}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f.match_id);
  }
  const links: { twin_id: string; canonical_id: string }[] = [];
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const canonical = ids.find((i) => i.startsWith("sm_")) ?? ids[0];
    for (const id of ids) {
      if (id !== canonical) links.push({ twin_id: id, canonical_id: canonical });
    }
  }
  return links;
}

{
  const links = tautanLama(semuaBaris);
  suite.eq(
    "PRA: kunci lama menautkan 0 dari 4 pasang produksi (defek)",
    links.length,
    0,
  );
  const linksRanked = tautanLama(barisRanked);
  suite.eq(
    "PRA: kunci lama membentuk 2 tautan PALSU 'ranked' lintas liga (defek)",
    linksRanked.map((l) => l.twin_id).sort(),
    ["sm_19674574", "sm_19674575"],
  );
}

/* ------------------------------------- FASE PASCA — resolusi + klaster */

const resolved = new Map<string, ResolvedLinkRow>();
for (const row of semuaBaris) {
  const r = resolveLinkRow(row, resolver, linkKeyOf);
  if (r) resolved.set(r.match_id, r);
}
suite.eq("PASCA: ke-8 baris beku ter-resolusi", resolved.size, 8);

{
  const bSm = resolved.get("sm_19726013")!;
  const bFd = resolved.get("fd_B1_20261122_beveren_gent")!;
  suite.eq("PASCA: cid registry SK Beveren tetap sm:1272", bSm.home_cid, "sm:1272");
  suite.eq("PASCA: cid registry Beveren tetap sm:6723", bFd.home_cid, "sm:6723");
  suite.check(
    "PASCA: kunci tautan Beveren kedua baris sama (registry TIDAK digabung)",
    bSm.home_key === bFd.home_key && bSm.home_key === "beveren",
  );
  const lSm = resolved.get("sm_19726005")!;
  const lFd = resolved.get("fd_B1_20261122_lommel-sk_standard")!;
  suite.check(
    "PASCA: kunci tautan Standard kedua baris sama",
    lSm.away_key === lFd.away_key && lSm.away_key === "standard-liege",
  );
  const oMt = resolved.get("mt_377354841")!;
  suite.check(
    "PASCA: Osasuna mt_ ter-resolusi ke cid yang sama dengan sm_",
    oMt.home_cid === "sm:459" && oMt.away_cid === "sm:126",
  );
  const gMt = resolved.get("mt_466492726")!;
  suite.check(
    "PASCA: Getafe/Atlético mt_ ter-resolusi ke cid yang sama dengan sm_",
    gMt.home_cid === "sm:106" && gMt.away_cid === "sm:7980",
  );
}

const clusters = clusterTwinRows([...resolved.values()]);
suite.eq("PASCA: tepat 4 klaster dari 8 baris beku", clusters.length, 4);
{
  const byCanon = new Map(clusters.map((c) => [c.canonical.match_id, c]));
  for (const p of pairs) {
    const c = byCanon.get(p.canonical_id);
    suite.check(
      `PASCA: klaster ${p.nama} berwakil ${p.canonical_id}`,
      !!c,
    );
    if (!c) continue;
    suite.eq(
      `PASCA: anggota klaster ${p.nama} = kedua barisnya`,
      c.rows.map((r) => r.match_id).sort(),
      p.anggota.map((a) => a.match_id).sort(),
    );
    suite.eq(
      `PASCA: jenis klaster ${p.nama}`,
      c.kind,
      p.jenis === "exact-alias" ? "exact" : "tolerant",
    );
  }
  // Tautan turunan (bentuk data/fixture-links.json): 4 twin → kanonik.
  const links = clusters.flatMap((c) =>
    c.rows
      .filter((r) => r.match_id !== c.canonical.match_id)
      .map((r) => `${r.match_id}->${c.canonical.match_id}`),
  ).sort();
  suite.eq("PASCA: tautan turunan = 4 pasang target", links, [
    "fd_B1_20261122_beveren_gent->sm_19726013",
    "fd_B1_20261122_lommel-sk_standard->sm_19726005",
    "mt_377354841->sm_19732617",
    "mt_466492726->sm_19732619",
  ]);
}

{
  // Baris "ranked": tim placeholder sama, kickoff sama — konteks liga
  // (Liga MX vs Serie B) WAJIB memisahkan; tidak ada klaster.
  const resRanked = barisRanked
    .map((r) => resolveLinkRow(r, resolver, linkKeyOf))
    .filter((r): r is ResolvedLinkRow => r !== null);
  suite.eq("PASCA: ke-4 baris 'ranked' ter-resolusi", resRanked.length, 4);
  suite.eq(
    "PASCA: baris 'ranked' lintas liga TIDAK membentuk klaster",
    clusterTwinRows(resRanked).length,
    0,
  );
  suite.eq(
    "PASCA: kolam campuran (8 beku + 4 ranked) tetap tepat 4 klaster",
    clusterTwinRows([...resolved.values(), ...resRanked]).length,
    4,
  );
}

/* ------------------------------------------------------ kontrol negatif */

{
  const clone = (
    row: LinkableFixtureRow,
    over: Partial<LinkableFixtureRow>,
  ): LinkableFixtureRow => ({ ...row, ...over });
  const pool = [...resolved.values()];
  const n0 = clusters.length;

  // (a) Tim sama, TANGGAL berbeda jauh (rematch pekan berikutnya).
  const rematch = resolveLinkRow(
    clone(semuaBaris[0], { utc_date: "2026-11-29T12:30:00.000Z" }),
    resolver,
    linkKeyOf,
  )!;
  suite.eq(
    "NEG: rematch tanggal berbeda tidak ikut klaster Beveren",
    clusterTwinRows([...pool, rematch]).length,
    n0,
  );

  // (b) Drift 300 menit (> toleransi 120) → bukan kembar.
  const jauh = resolveLinkRow(
    clone(semuaBaris[3], { utc_date: "2026-11-22T22:30:00.000Z" }),
    resolver,
    linkKeyOf,
  )!;
  const klasterJauh = clusterTwinRows([
    resolved.get("sm_19732617")!,
    jauh,
  ]);
  suite.eq("NEG: drift 300 menit tidak membentuk klaster", klasterJauh.length, 0);

  // (c) Tim + kickoff berdekatan tapi kompetisi BERBEDA (liga vs piala).
  const bedaLiga = resolveLinkRow(
    clone(semuaBaris[3], {
      competition_id: "sm:208",
      competition_name: "Pro League",
    }),
    resolver,
    linkKeyOf,
  )!;
  suite.eq(
    "NEG: konteks liga berbeda tidak membentuk klaster",
    clusterTwinRows([resolved.get("sm_19732617")!, bedaLiga]).length,
    0,
  );

  // (d) Orientasi kandang/tamu tertukar → bukan kembar.
  const tertukar = resolveLinkRow(
    clone(semuaBaris[0], {
      home_team_id: "2402",
      home_team_name: "Gent",
      away_team_id: "6723",
      away_team_name: "Beveren",
    }),
    resolver,
    linkKeyOf,
  )!;
  suite.eq(
    "NEG: orientasi tertukar tidak ikut klaster",
    clusterTwinRows([...pool, tertukar]).length,
    n0,
  );

  // (e) Tim tak dikenal → baris di luar pencocokan (null, bukan tebakan).
  suite.eq(
    "NEG: tim tak ter-resolusi → resolveLinkRow null",
    resolveLinkRow(
      clone(semuaBaris[0], {
        home_team_id: "zzz_404",
        home_team_name: "Klub Fiktif XYZ",
      }),
      resolver,
      linkKeyOf,
    ),
    null,
  );

  // (f) Semantik rantai terdokumentasi: 0 / +100 / +200 menit = satu
  // klaster (jarak antar tetangga ≤ toleransi); wakil = baris sm_.
  const rantai = ([
    { ...semuaBaris[2], match_id: "fd_X1_rantai-a", utc_date: "2026-11-22T17:30:00.000Z" },
    { ...semuaBaris[2], match_id: "sm_900000001", utc_date: "2026-11-22T19:10:00.000Z" },
    { ...semuaBaris[3], match_id: "mt_900000002", utc_date: "2026-11-22T20:50:00.000Z" },
  ] as LinkableFixtureRow[])
    .map((r) => resolveLinkRow(r, resolver, linkKeyOf))
    .filter((r): r is ResolvedLinkRow => r !== null);
  const klasterRantai = clusterTwinRows(rantai);
  suite.eq("NEG: rantai 0/+100/+200 membentuk 1 klaster", klasterRantai.length, 1);
  suite.eq(
    "NEG: wakil klaster rantai = baris sm_ (bukan yang paling awal)",
    klasterRantai[0]?.canonical.match_id,
    "sm_900000001",
  );
}

/* ------------------------------------- FASE PASCA — penjaga cadangan */

const repOf = new Map<string, string>();
for (const c of clusters) {
  for (const r of c.rows) repOf.set(r.match_id, c.canonical.match_id);
}
const ref = (id: string): FallbackFixtureRef => resolved.get(id)!;
const ctxKosong = {
  representativeOf: repOf,
  recordedRefs: [] as FallbackFixtureRef[],
  writtenRefs: [] as FallbackFixtureRef[],
};

{
  for (const p of pairs) {
    const twinId = p.anggota.find((a) => a.match_id !== p.canonical_id)!.match_id;
    suite.eq(
      `GUARD: kembar ${twinId} terblokir sebagai bukan-wakil`,
      fallbackBlockReason(ref(twinId), ctxKosong),
      "bukan-wakil-klaster",
    );
    suite.eq(
      `GUARD: wakil ${p.canonical_id} bebas terbit`,
      fallbackBlockReason(ref(p.canonical_id), ctxKosong),
      null,
    );
  }

  // Urutan proses tidak menentukan: mt_ Getafe kickoff-nya LEBIH AWAL
  // dari sm_, tapi tetap terblokir; dan kunci cadangan simetris —
  // andaikan mt_ terbit duluan, sm_ yang terblokir (lapis kedua).
  suite.check(
    "GUARD: samePhysicalFallback Getafe simetris (60 menit, arah terbalik)",
    samePhysicalFallback(ref("sm_19732619"), ref("mt_466492726")) &&
      samePhysicalFallback(ref("mt_466492726"), ref("sm_19732619")),
  );
  suite.eq(
    "GUARD: wakil terblokir bila laga sudah tercatat lewat id mt_",
    fallbackBlockReason(ref("sm_19732617"), {
      representativeOf: repOf,
      recordedRefs: [ref("mt_377354841")],
      writtenRefs: [],
    }),
    "sudah-tercatat",
  );
  suite.eq(
    "GUARD: wakil terblokir bila laga sudah terbit run ini lewat id lain",
    fallbackBlockReason(ref("sm_19732619"), {
      representativeOf: repOf,
      recordedRefs: [],
      writtenRefs: [ref("mt_466492726")],
    }),
    "sudah-terbit-run-ini",
  );
  suite.check(
    "GUARD: baris bukan kembar dirinya sendiri",
    !samePhysicalFallback(ref("sm_19732617"), ref("sm_19732617")),
  );

  // Anti kehilangan cakupan: baris TUNGGAL (klaster tidak terbentuk
  // karena wakilnya tidak ikut terpindai) tidak pernah terblokir.
  const repTunggal = new Map<string, string>();
  suite.eq(
    "GUARD: baris fd_ tunggal tanpa wakil terpindai TIDAK terblokir",
    fallbackBlockReason(ref("fd_B1_20261122_beveren_gent"), {
      representativeOf: repTunggal,
      recordedRefs: [],
      writtenRefs: [],
    }),
    null,
  );

  // Batas toleransi persis: 120 menit lolos, 121 menit tidak.
  const dasar: FallbackFixtureRef = {
    match_id: "sm_1",
    home_key: "a",
    away_key: "b",
    league: { canonical: "sm:1", name_key: "liga" },
    kickoff_ms: Date.parse("2026-11-22T17:30:00.000Z"),
    utc_date: "2026-11-22T17:30:00.000Z",
  };
  const geser = (menit: number): FallbackFixtureRef => ({
    ...dasar,
    match_id: "mt_2",
    kickoff_ms: dasar.kickoff_ms + menit * 60_000,
  });
  suite.check(
    `GUARD: jarak tepat ${TWIN_KICKOFF_TOLERANCE_MIN} menit masih kembar`,
    samePhysicalFallback(dasar, geser(TWIN_KICKOFF_TOLERANCE_MIN)),
  );
  suite.check(
    `GUARD: jarak ${TWIN_KICKOFF_TOLERANCE_MIN + 1} menit bukan kembar`,
    !samePhysicalFallback(dasar, geser(TWIN_KICKOFF_TOLERANCE_MIN + 1)),
  );
  suite.check(
    "GUARD: liga berbeda (canonical beda) bukan kembar walau kickoff sama",
    !samePhysicalFallback(dasar, {
      ...geser(0),
      league: { canonical: "sm:2", name_key: "liga" },
    }),
  );

  // Kunci grup cadangan: anggota klaster berbagi kunci wakilnya.
  for (const p of pairs) {
    const c = clusters.find((k) => k.canonical.match_id === p.canonical_id)!;
    const kunciWakil = fallbackGroupKey(c.canonical);
    suite.check(
      `GUARD: kunci grup klaster ${p.nama} berawalan fb: dan stabil`,
      kunciWakil.startsWith("fb:") &&
        fallbackGroupKey(c.canonical) === kunciWakil,
      kunciWakil,
    );
  }
  suite.check(
    "GUARD: kunci grup 4 klaster saling berbeda",
    new Set(clusters.map((c) => fallbackGroupKey(c.canonical))).size === 4,
  );
}

/* ------------------------- KEMBAR FREE-MODE (25 Nov 2026) — kelas fd_
 * Belahan registry fd_: entri kanonik fd_ bernama pendek ("Aldershot")
 * tidak menyatu dengan entri sm: klub yang sama ("Aldershot Town").
 * Produksi 25 Nov 2026: 4 pasang lolos builder DAN penjaga cadangan —
 * 59 pick ledger untuk 4 laga fisik (kedua sisi sudah tercatat):
 *   1. Boreham Wood vs Aldershot Town (sm_19748115 +
 *      fd_EC_20261125_boreham-wood_aldershot) — fd_aldershot belah.
 *   2. Hartlepool United vs Solihull Moors (sm_19748113 +
 *      fd_EC_20261125_hartlepool_solihull) — fd_solihull belah
 *      (fd_hartlepool sudah member sm:310).
 *   3. Harrogate Town vs Kidderminster Harriers (sm_19748114 +
 *      fd_EC_20261125_harrogate_kidderminster) — fd_kidderminster
 *      belah (fd_harrogate sudah member sm:382).
 *   4. Doncaster Rovers vs Huddersfield Town (sm_19728143 +
 *      fd_E2_20261126_doncaster_huddersfield) — fd_doncaster belah.
 * Baris katalog di bawah VERBATIM dari upcoming_fixtures produksi
 * 25 Nov 2026 (team_id + nama + kompetisi + kickoff persis).
 */

const barisFreeMode: LinkableFixtureRow[] = [
  { match_id: "sm_19748115", competition_id: "sm:17", competition_name: "Enterprise National League", utc_date: "2026-11-25T19:00:00.000Z", home_team_id: "998", home_team_name: "Boreham Wood", away_team_id: "194", away_team_name: "Aldershot Town" },
  { match_id: "fd_EC_20261125_boreham-wood_aldershot", competition_id: "EC", competition_name: "Enterprise National League", utc_date: "2026-11-25T19:00:00.000Z", home_team_id: "998", home_team_name: "Boreham Wood", away_team_id: "fd_aldershot", away_team_name: "Aldershot" },
  { match_id: "sm_19748113", competition_id: "sm:17", competition_name: "Enterprise National League", utc_date: "2026-11-25T19:45:00.000Z", home_team_id: "310", home_team_name: "Hartlepool United", away_team_id: "1030", away_team_name: "Solihull Moors" },
  { match_id: "fd_EC_20261125_hartlepool_solihull", competition_id: "EC", competition_name: "Enterprise National League", utc_date: "2026-11-25T19:45:00.000Z", home_team_id: "fd_hartlepool", home_team_name: "Hartlepool", away_team_id: "fd_solihull", away_team_name: "Solihull" },
  { match_id: "sm_19748114", competition_id: "sm:17", competition_name: "Enterprise National League", utc_date: "2026-11-25T19:45:00.000Z", home_team_id: "382", home_team_name: "Harrogate Town", away_team_id: "832", away_team_name: "Kidderminster Harriers" },
  { match_id: "fd_EC_20261125_harrogate_kidderminster", competition_id: "EC", competition_name: "Enterprise National League", utc_date: "2026-11-25T19:45:00.000Z", home_team_id: "fd_harrogate", home_team_name: "Harrogate", away_team_id: "fd_kidderminster", away_team_name: "Kidderminster" },
  { match_id: "sm_19728143", competition_id: "sm:12", competition_name: "League One", utc_date: "2026-11-26T20:00:00.000Z", home_team_id: "235", home_team_name: "Doncaster Rovers", away_team_id: "251", away_team_name: "Huddersfield Town" },
  { match_id: "fd_E2_20261126_doncaster_huddersfield", competition_id: "E2", competition_name: "League One", utc_date: "2026-11-26T20:00:00.000Z", home_team_id: "fd_doncaster", home_team_name: "Doncaster", away_team_id: "251", away_team_name: "Huddersfield" },
];

const keyKomposit = buildLinkTeamKeyFn(reg, aliases);
const grupVarian = suffixVariantGroups(reg);

suite.eq("FM: grup varian-akhiran registry repo = 22", grupVarian.length, 22);
{
  const peta = new Map(grupVarian.map((g) => [g.short_id, g.long_id]));
  for (const [pendek, panjang] of [
    ["fd_aldershot", "sm:194"],
    ["fd_solihull", "sm:1030"],
    ["fd_kidderminster", "sm:832"],
    ["fd_doncaster", "sm:235"],
  ] as const) {
    suite.eq(`FM: grup varian ${pendek} → ${panjang}`, peta.get(pendek), panjang);
  }
  // Ambigu = ditolak: nama pendek yang jadi awalan ≥2 klub berbeda
  // TIDAK disatukan (kunci tetap canonical_id-nya sendiri).
  for (const ambigu of [
    "fd_bradford",
    "fd_cambridge",
    "fd_carlisle",
    "fd_grimsby",
    "fd_hamilton",
    "fd_northampton",
    "fd_sutton",
    "fd_swindon",
  ]) {
    suite.check(`FM: ${ambigu} ambigu → tidak masuk grup varian`, !peta.has(ambigu), ambigu);
    suite.eq(`FM: kunci komposit ${ambigu} = dirinya sendiri`, keyKomposit(ambigu), ambigu);
  }
  // Nama IDENTIK antar entri (bukan awalan sejati) tidak disatukan:
  // dua "Everton" beda klub tetap belah — urusan alias manual.
  const regMini: TeamRegistryFile = {
    teams: [
      { canonical_id: "sm:13", name: "Everton", members: [{ team_id: "13" }], aliases: [] },
      { canonical_id: "sm:15064", name: "Everton", members: [{ team_id: "15064" }], aliases: [] },
      { canonical_id: "fd_everton", name: "Everton", members: [{ team_id: "fd_everton" }], aliases: [] },
    ],
  };
  suite.eq(
    "FM: nama identik (Everton) TIDAK membentuk grup varian",
    suffixVariantGroups(regMini).length,
    0,
  );
  suite.eq(
    "FM: token nama melucuti diakritik",
    linkNameTokens("Atlético Madrid"),
    ["atletico", "madrid"],
  );
  // Alias manual tetap menang & utuh di kunci komposit.
  suite.eq("FM: kunci komposit sm:1272 tetap alias manual", keyKomposit("sm:1272"), "beveren");
  suite.eq("FM: kunci komposit fd_standard tetap alias manual", keyKomposit("fd_standard"), "standard-liege");
}

const resFmLama = new Map<string, ResolvedLinkRow>();
const resFm = new Map<string, ResolvedLinkRow>();
for (const row of barisFreeMode) {
  const lama = resolveLinkRow(row, resolver, linkKeyOf);
  if (lama) resFmLama.set(row.match_id, lama);
  const r = resolveLinkRow(row, resolver, keyKomposit);
  if (r) resFm.set(row.match_id, r);
}
suite.eq("FM: ke-8 baris produksi ter-resolusi (kunci lama)", resFmLama.size, 8);
suite.eq("FM: ke-8 baris produksi ter-resolusi (kunci komposit)", resFm.size, 8);
suite.eq(
  "FM PRA: kunci lama (alias manual saja) membentuk 0 klaster dari 4 pasang (defek)",
  clusterTwinRows([...resFmLama.values()]).length,
  0,
);
{
  // Registry TIDAK digabung: cid baris fd_ tetap entri fd_-nya; yang
  // menyatu hanya KUNCI tautan.
  const fdBoreham = resFm.get("fd_EC_20261125_boreham-wood_aldershot")!;
  suite.eq("FM: cid registry Aldershot baris fd_ tetap fd_aldershot", fdBoreham.away_cid, "fd_aldershot");
  suite.eq("FM: kunci tautan Aldershot baris fd_ = sm:194", fdBoreham.away_key, "sm:194");
  suite.eq(
    "FM: kunci tautan Doncaster baris fd_ = sm:235",
    resFm.get("fd_E2_20261126_doncaster_huddersfield")!.home_key,
    "sm:235",
  );
}
const klasterFm = clusterTwinRows([...resFm.values()]);
suite.eq("FM PASCA: tepat 4 klaster dari 8 baris produksi", klasterFm.length, 4);
{
  const linksFm = klasterFm
    .flatMap((c) =>
      c.rows
        .filter((r) => r.match_id !== c.canonical.match_id)
        .map((r) => `${r.match_id}->${c.canonical.match_id}`),
    )
    .sort();
  suite.eq("FM PASCA: tautan turunan = 4 pasang target produksi", linksFm, [
    "fd_E2_20261126_doncaster_huddersfield->sm_19728143",
    "fd_EC_20261125_boreham-wood_aldershot->sm_19748115",
    "fd_EC_20261125_harrogate_kidderminster->sm_19748114",
    "fd_EC_20261125_hartlepool_solihull->sm_19748113",
  ]);
  suite.check(
    "FM PASCA: ke-4 klaster berjenis exact (kickoff persis sama)",
    klasterFm.every((c) => c.kind === "exact"),
  );
}
{
  // Penjaga cadangan dengan kunci komposit: skenario produksi malam
  // 25 Nov — sisi sm_ SUDAH tercatat di ledger (fixture_uid baris
  // ledger sm_ NULL tidak relevan di sini: penjaga mencocokkan lewat
  // baris katalog dari match_id, bukan fixture_uid).
  const repFm = new Map<string, string>();
  for (const c of klasterFm) {
    for (const r of c.rows) repFm.set(r.match_id, c.canonical.match_id);
  }
  const refFm = (id: string): FallbackFixtureRef => resFm.get(id)!;
  for (const [fdId, smId] of [
    ["fd_EC_20261125_boreham-wood_aldershot", "sm_19748115"],
    ["fd_EC_20261125_hartlepool_solihull", "sm_19748113"],
    ["fd_EC_20261125_harrogate_kidderminster", "sm_19748114"],
    ["fd_E2_20261126_doncaster_huddersfield", "sm_19728143"],
  ] as const) {
    suite.eq(
      `FM GUARD: ${fdId} terblokir sebagai bukan-wakil`,
      fallbackBlockReason(refFm(fdId), {
        representativeOf: repFm,
        recordedRefs: [],
        writtenRefs: [],
      }),
      "bukan-wakil-klaster",
    );
    suite.eq(
      `FM GUARD: ${fdId} terblokir walau tanpa peta wakil — laga sudah tercatat lewat ${smId}`,
      fallbackBlockReason(refFm(fdId), {
        representativeOf: new Map<string, string>(),
        recordedRefs: [refFm(smId)],
        writtenRefs: [],
      }),
      "sudah-tercatat",
    );
    suite.eq(
      `FM GUARD: ${smId} terblokir bila laga sudah tercatat lewat ${fdId}`,
      fallbackBlockReason(refFm(smId), {
        representativeOf: repFm,
        recordedRefs: [refFm(fdId)],
        writtenRefs: [],
      }),
      "sudah-tercatat",
    );
    suite.eq(
      `FM GUARD: wakil ${smId} bebas terbit pada konteks kosong`,
      fallbackBlockReason(refFm(smId), {
        representativeOf: repFm,
        recordedRefs: [],
        writtenRefs: [],
      }),
      null,
    );
  }
  // Kunci menyatu BUKAN tautan: "Queens Park" (Skotlandia) vs
  // "Queens Park Rangers" (Inggris) berbagi kunci kandang sm:47,
  // tetapi lawan + liga + konteks berbeda → TIDAK ada klaster.
  const qpFd = resolveLinkRow(
    { match_id: "fd_SP1_20261125_queens-park_arbroath", competition_id: "SP1", competition_name: "Scottish League One", utc_date: "2026-11-25T19:45:00.000Z", home_team_id: "fd_queens-park", home_team_name: "Queens Park", away_team_id: "x-arbroath", away_team_name: "Arbroath" },
    resolver,
    keyKomposit,
  )!;
  const qpSm = resolveLinkRow(
    { match_id: "sm_900000047", competition_id: "sm:10", competition_name: "Championship", utc_date: "2026-11-25T19:45:00.000Z", home_team_id: "47", home_team_name: "Queens Park Rangers", away_team_id: "x-coventry", away_team_name: "Coventry City" },
    resolver,
    keyKomposit,
  )!;
  suite.eq("FM NEG: kunci kandang Queens Park menyatu (sm:47)", qpFd.home_key, "sm:47");
  suite.eq(
    "FM NEG: Queens Park vs QPR TIDAK membentuk klaster (klub berbeda)",
    clusterTwinRows([qpFd, qpSm]).length,
    0,
  );
}

/* -------------------------------------------------- kontrak pengawatan */

{
  const builderSrc = fs.readFileSync(
    path.join(HERE, "..", "scripts", "build-fixture-links.ts"),
    "utf8",
  );
  suite.check(
    "KAWAT: builder mengimpor clusterTwinRows dari lib/identity/link-matching",
    builderSrc.includes('from "../lib/identity/link-matching"') &&
      builderSrc.includes("clusterTwinRows"),
  );
  suite.check(
    "KAWAT: builder memakai kunci komposit buildLinkTeamKeyFn (Kembar-Free-Mode)",
    builderSrc.includes("buildLinkTeamKeyFn(reg, aliases)"),
  );
  suite.check(
    "KAWAT: kunci persis lama tidak lagi dibangun di builder",
    !builderSrc.includes("${f.utc_date}|${ch}|${ca}"),
  );
  const slateSrc = fs.readFileSync(
    path.join(HERE, "..", "scripts", "pick-slate.ts"),
    "utf8",
  );
  for (const sym of [
    "clusterTwinRows",
    "fallbackBlockReason",
    "fallbackGroupKey",
    "buildLinkTeamKeyFn(reg, loadLinkTeamAliases(dataDir))",
    "unlinked_twin_fixtures_skipped: unlinkedTwinsSkipped",
  ]) {
    suite.check(`KAWAT: pick-slate memakai ${sym}`, slateSrc.includes(sym));
  }
  const identitySrc = fs.readFileSync(
    path.join(HERE, "..", "lib", "picks", "slate-identity.ts"),
    "utf8",
  );
  suite.check(
    "KAWAT: slate-identity mengekspor penjaga cadangan Lanjut-5",
    identitySrc.includes("export function fallbackBlockReason") &&
      identitySrc.includes("export function samePhysicalFallback"),
  );
  suite.check(
    "KAWAT: API Lanjut-4 utuh di slate-identity (perluas, bukan ganti)",
    identitySrc.includes("export function decideSlateFixture") &&
      identitySrc.includes("export function slateGroupKey") &&
      identitySrc.includes("export class SlateIdentity"),
  );
}

suite.finish();
