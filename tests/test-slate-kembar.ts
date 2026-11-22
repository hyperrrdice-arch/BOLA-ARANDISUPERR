/**
 * LANJUT-4 — slate menghitung laga kembar DUA KALI (branch fix/lanjut-verifikasi).
 *
 * Temuan pemilik (terverifikasi Hikari di PRODUKSI 22 Nov 2026 ±09.25 WIB
 * dari slate + ledger VPS US, bukan cuma VM): slate hasil refresh 04.21 WIB
 * (210 rated) memuat TEPAT 14 pasangan tertaut fixture-links yang KEDUA
 * barisnya masuk rated sebagai dua laga terpisah. Gejala paling jelas:
 * contoh parlay "Alternatif" berisi DUA unit dari laga fisik yang sama —
 * "Ajax vs ADO Den Haag — dc/1x" DAN "Ajax vs Den Haag — dc/1x" — sehingga
 * angka gabungan contoh itu tidak sah. Ledger produksi mencatat kedua sisi
 * pasangan hari yang sama (Ajax fd 9 baris / sm 8 baris; Kasımpaşa 6/6; dst).
 *
 * Akar: scripts/pick-slate.ts mengelompokkan laga dengan
 * group_key = nama tim ternormalisasi + kickoff; normalizer tidak
 * menyatukan ejaan alias ("ADO Den Haag" vs "Den Haag", "Dynamo Dresden"
 * vs "Dresden", "Union Saint-Gilloise" vs "St. Gilloise", "Göztepe" vs
 * "Goztep") — padahal data/fixture-links.json SUDAH menautkan ke-14
 * pasangan itu. Saringan kembar yang ada (Fase 0 R-03) hanya mencakup
 * kelas mt_; pasangan fd_/sm_ lolos, di-rate dua kali, menulis paket +
 * pick dua kali (idempotensi driver hanya per match_id).
 *
 * Keputusan pemilik: samakan grouping slate ke fixture-links + cegah
 * pencatatan dobel — BUKAN sekadar menambah alias nama. Baris yang
 * bertahan = baris kanonik (canonical_id di fixture-links; preseden
 * R-03: kembar tidak menulis, kanonik mewakili). Tampilan publik TIDAK
 * disentuh (pengelompokan UI sudah memakai fixture-links/identitas K1).
 *
 * Suite ini membekukan pola produksi (tests/fixtures/slate-kembar.json —
 * ekstrak verbatim rated kedua baris dari slate VM run
 * 2026-11-21T21:50:53Z, identik dengan slate produksi untuk 14 pasangan
 * ini) dalam dua fase:
 *   FASE PRA  — formula group_key pra-perbaikan (verbatim dari
 *               pick-slate.ts @ 06396ac baris 767) + semantik
 *               takeDistinct lama: defek harus TERLIHAT (28 entri untuk
 *               14 laga fisik; kedua unit Ajax lolos seleksi distinct).
 *   FASE PASCA — modul lib/picks/slate-identity.ts yang dipakai
 *               pick-slate.ts: satu entri per laga fisik, contoh parlay
 *               bersih, titik tulis ledger berbasis kunci fisik,
 *               kontrol negatif tidak ikut runtuh.
 *
 * Jalankan: npx tsx tests/test-slate-kembar.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Suite } from "./helpers/fixture-env";
import { normalizeTeamName } from "../lib/quant/team-normalizer";
import {
  SlateIdentity,
  decideSlateFixture,
  parseSlateLinks,
  slateGroupKey,
  takeDistinctByGroup,
  type SlateFixtureLink,
} from "../lib/picks/slate-identity";

const suite = new Suite("slate-kembar");
const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------ fixture */

interface BarisSlate {
  match_id: string;
  utc_date: string;
  competition_name: string;
  home: string;
  away: string;
  gate_status: string;
  legs: Array<{
    market: string;
    selection: string;
    grade: string;
    model_prob: number;
    effective_prob: number;
  }>;
}

interface Pasangan {
  twin_id: string;
  canonical_id: string;
  kickoff_utc: string;
  twin: BarisSlate;
  canonical: BarisSlate;
}

const fixture = JSON.parse(
  fs.readFileSync(path.join(HERE, "fixtures", "slate-kembar.json"), "utf8"),
) as { generated_at: string; pairs: Pasangan[] };

const pairs = fixture.pairs;
suite.eq("fixture beku memuat 14 pasangan produksi", pairs.length, 14);

const links: SlateFixtureLink[] = pairs.map((p) => ({
  twin_id: p.twin_id,
  canonical_id: p.canonical_id,
  kickoff_utc: p.kickoff_utc,
}));
const identity = new SlateIdentity(links);

const semuaBaris: BarisSlate[] = pairs.flatMap((p) => [p.twin, p.canonical]);
const scannedIds = new Set(semuaBaris.map((b) => b.match_id));

const bentukFx = (b: BarisSlate) => ({
  match_id: b.match_id,
  home_team_name: b.home,
  away_team_name: b.away,
  utc_date: b.utc_date,
});

/* ------------------------------------------- FASE PRA — reproduksi beku */

/** Formula group_key pra-perbaikan, verbatim dari pick-slate.ts @ 06396ac. */
const legacyGroupKey = (b: BarisSlate) =>
  `${normalizeTeamName(b.home)}|${normalizeTeamName(b.away)}|${b.utc_date}`;

/** Semantik takeDistinct pra-perbaikan (pick-slate.ts @ 06396ac). */
function legacyTakeDistinct<T extends { group_key: string }>(
  pool: T[],
  n: number,
  excludeGroups = new Set<string>(),
): T[] {
  const used = new Set(excludeGroups);
  const picked: T[] = [];
  for (const item of pool) {
    if (used.has(item.group_key)) continue;
    used.add(item.group_key);
    picked.push(item);
    if (picked.length === n) break;
  }
  return picked;
}

{
  // 28 baris → 28 group_key berbeda: tidak ada yang runtuh.
  const keys = new Set(semuaBaris.map(legacyGroupKey));
  suite.eq(
    "PRA: formula lama memberi 28 kunci grup untuk 14 laga fisik",
    keys.size,
    28,
  );

  // Pool contoh parlay (urut grade lalu efektif, seperti pick-slate):
  // kedua kaki dc/1x Ajax — dari DUA baris berbeda — lolos seleksi distinct.
  const gradeRank: Record<string, number> = { A: 3, B: 2, C: 1 };
  const flat = semuaBaris.flatMap((r) =>
    r.legs.map((leg) => ({
      r,
      leg,
      group_key: legacyGroupKey(r),
    })),
  );
  const byGradeEff = [...flat].sort(
    (x, y) =>
      (gradeRank[y.leg.grade] ?? 0) - (gradeRank[x.leg.grade] ?? 0) ||
      y.leg.effective_prob - x.leg.effective_prob,
  );
  const picked = legacyTakeDistinct(byGradeEff, byGradeEff.length);
  const ajaxUnits = picked.filter(
    (u) =>
      (u.r.match_id === "fd_N1_20261122_afc-ajax_den-haag" ||
        u.r.match_id === "sm_19714592") &&
      u.leg.market === "dc" &&
      u.leg.selection === "1x",
  );
  suite.eq(
    "PRA: seleksi distinct lama meloloskan KEDUA unit dc/1x Ajax (defek produksi)",
    ajaxUnits.map((u) => u.r.match_id).sort(),
    ["fd_N1_20261122_afc-ajax_den-haag", "sm_19714592"],
  );
}

/* ------------------------------------- FASE PASCA — keputusan per fixture */

{
  let skipLinked = 0;
  let ratedCanonical = 0;
  for (const p of pairs) {
    const dTwin = decideSlateFixture(p.twin_id, identity, scannedIds);
    suite.check(
      `PASCA: kembar ${p.twin_id} dilewati → kanonik ${p.canonical_id}`,
      dTwin.action === "skip" &&
        dTwin.kind === "linked" &&
        dTwin.canonical_id === p.canonical_id,
      JSON.stringify(dTwin),
    );
    if (dTwin.action === "skip") skipLinked++;
    const dCanon = decideSlateFixture(p.canonical_id, identity, scannedIds);
    suite.check(
      `PASCA: baris kanonik ${p.canonical_id} tetap di-rate`,
      dCanon.action === "rate",
      JSON.stringify(dCanon),
    );
    if (dCanon.action === "rate") ratedCanonical++;
  }
  suite.eq("PASCA: 14 kembar dilewati (linked)", skipLinked, 14);
  suite.eq("PASCA: 14 baris kanonik di-rate", ratedCanonical, 14);

  // Runtuhnya slate: menerapkan keputusan ke 28 baris menyisakan tepat
  // 14 entri — satu per laga fisik — dan yang bertahan selalu kanonik.
  const survivors = semuaBaris.filter(
    (b) => decideSlateFixture(b.match_id, identity, scannedIds).action === "rate",
  );
  suite.eq("PASCA: slate runtuh 28 baris → 14 entri", survivors.length, 14);
  suite.eq(
    "PASCA: entri yang bertahan = himpunan canonical_id",
    survivors.map((b) => b.match_id).sort(),
    pairs.map((p) => p.canonical_id).sort(),
  );

  // Kedua id lama tetap ter-resolve ke laga fisik yang sama.
  for (const p of pairs) {
    suite.eq(
      `PASCA: kunci fisik ${p.twin_id} = kunci fisik ${p.canonical_id}`,
      identity.physicalKey(p.twin_id),
      identity.physicalKey(p.canonical_id),
    );
  }
}

/* ------------------------------------------ FASE PASCA — group_key fisik */

{
  const survivors = pairs.map((p) => p.canonical);
  const keys = survivors.map((b) => slateGroupKey(bentukFx(b), identity));
  suite.eq(
    "PASCA: group_key 14 entri bertahan saling berbeda",
    new Set(keys).size,
    14,
  );
  suite.check(
    "PASCA: group_key entri bertahan berbasis identitas fisik (fx:<canonical_id>)",
    keys.every((k, i) => k === `fx:${pairs[i].canonical_id}`),
    keys.join(","),
  );
  // Pertahanan lapis kedua: ANDAI kembar ikut ter-rate, kunci grupnya
  // sama dengan kanoniknya → seleksi distinct tidak bisa mengambil dua.
  for (const p of pairs) {
    suite.eq(
      `PASCA: group_key kembar ${p.twin_id} = group_key kanoniknya`,
      slateGroupKey(bentukFx(p.twin), identity),
      slateGroupKey(bentukFx(p.canonical), identity),
    );
  }
}

/* ------------------------------------------ FASE PASCA — contoh parlay */

interface Unit {
  r: BarisSlate;
  leg: BarisSlate["legs"][number];
  group_key: string;
}

function bangunParlay(ratedRows: BarisSlate[]) {
  const gradeRank: Record<string, number> = { A: 3, B: 2, C: 1 };
  const flat: Unit[] = ratedRows.flatMap((r) =>
    r.legs.map((leg) => ({
      r,
      leg,
      group_key: slateGroupKey(bentukFx(r), identity),
    })),
  );
  const byGradeEff = [...flat].sort(
    (x, y) =>
      (gradeRank[y.leg.grade] ?? 0) - (gradeRank[x.leg.grade] ?? 0) ||
      y.leg.effective_prob - x.leg.effective_prob,
  );
  const byEff = [...flat].sort(
    (x, y) => y.leg.effective_prob - x.leg.effective_prob,
  );
  const utama = takeDistinctByGroup(byGradeEff, 4, (u) => u.group_key);
  const aman = takeDistinctByGroup(
    byEff.filter((u) => u.leg.grade !== "C"),
    3,
    (u) => u.group_key,
  );
  const alternatif = takeDistinctByGroup(
    byGradeEff,
    3,
    (u) => u.group_key,
    new Set(utama.map((u) => u.group_key)),
  );
  return { utama, aman, alternatif };
}

const fisikDari = (u: Unit) => identity.physicalKey(u.r.match_id);
const tanpaGanda = (units: Unit[]) =>
  new Set(units.map(fisikDari)).size === units.length;

{
  // Jalur normal pasca-perbaikan: slate sudah runtuh (14 entri).
  const survivors = semuaBaris.filter(
    (b) => decideSlateFixture(b.match_id, identity, scannedIds).action === "rate",
  );
  const { utama, aman, alternatif } = bangunParlay(survivors);
  suite.check("PASCA: Utama tanpa laga fisik ganda", tanpaGanda(utama));
  suite.check("PASCA: Aman tanpa laga fisik ganda", tanpaGanda(aman));
  suite.check(
    "PASCA: Alternatif tanpa laga fisik ganda",
    tanpaGanda(alternatif),
  );
  const ajaxAlt = alternatif.filter(
    (u) => fisikDari(u) === "sm_19714592",
  );
  suite.check(
    "PASCA: Alternatif memuat paling banyak SATU unit Ajax",
    ajaxAlt.length <= 1,
    `unit Ajax di Alternatif: ${ajaxAlt.length}`,
  );

  // Pertahanan lapis kedua: ANDAI grouping regresi dan 28 baris lolos,
  // kunci fisik tetap mencegah dua unit satu laga dalam satu parlay.
  const regresi = bangunParlay(semuaBaris);
  suite.check(
    "PASCA: parlay tetap bersih walau 28 baris lolos (kunci fisik)",
    tanpaGanda(regresi.utama) &&
      tanpaGanda(regresi.aman) &&
      tanpaGanda(regresi.alternatif),
  );
}

/* --------------------------------- FASE PASCA — titik tulis ledger fisik */

{
  // Dedupe titik tulis: himpunan kunci fisik yang sudah tercatat.
  // Tercatat lewat id kembar → kanonik terblokir, dan sebaliknya.
  for (const p of pairs.slice(0, 4)) {
    const dariKembar = identity.physicalKeySet([p.twin_id]);
    suite.check(
      `PASCA: tercatat via kembar ${p.twin_id} memblokir tulis kanoniknya`,
      dariKembar.has(identity.physicalKey(p.canonical_id)),
    );
    const dariKanonik = identity.physicalKeySet([p.canonical_id]);
    suite.check(
      `PASCA: tercatat via kanonik ${p.canonical_id} memblokir tulis kembarnya`,
      dariKanonik.has(identity.physicalKey(p.twin_id)),
    );
  }
  const asing = identity.physicalKeySet(["sm_99999999"]);
  suite.check(
    "PASCA: id tak terkait tidak memblokir pasangan mana pun",
    pairs.every((p) => !asing.has(identity.physicalKey(p.canonical_id))),
  );
  suite.eq(
    "PASCA: himpunan kunci fisik kosong tidak memblokir apa pun",
    identity.physicalKeySet([]).size,
    0,
  );
}

/* ------------------------------------------------------ kontrol negatif */

{
  // (a) Laga BERBEDA bernama mirip, TIDAK tertaut → tidak ikut runtuh.
  const idLepas = new SlateIdentity([]);
  const a1 = {
    match_id: "fd_X1_20261122_ajax_den-haag",
    home_team_name: "Ajax",
    away_team_name: "Den Haag",
    utc_date: "2026-11-22T13:30:00.000Z",
  };
  const a2 = {
    match_id: "sm_20000001",
    home_team_name: "Ajax",
    away_team_name: "ADO Den Haag",
    utc_date: "2026-11-29T13:30:00.000Z",
  };
  const scanLepas = new Set([a1.match_id, a2.match_id]);
  suite.check(
    "NEG: tanpa tautan, baris bernama mirip tetap di-rate (1)",
    decideSlateFixture(a1.match_id, idLepas, scanLepas).action === "rate",
  );
  suite.check(
    "NEG: tanpa tautan, baris bernama mirip tetap di-rate (2)",
    decideSlateFixture(a2.match_id, idLepas, scanLepas).action === "rate",
  );
  suite.check(
    "NEG: tanpa tautan, group_key = formula nama warisan (perilaku lama)",
    slateGroupKey(a1, idLepas) ===
      `${normalizeTeamName("Ajax")}|${normalizeTeamName("Den Haag")}|2026-11-22T13:30:00.000Z`,
  );
  suite.check(
    "NEG: dua laga berbeda (tanggal beda) kunci grupnya berbeda",
    slateGroupKey(a1, idLepas) !== slateGroupKey(a2, idLepas),
  );

  // (b) Kembar fd_ yang kanoniknya TIDAK ikut terpindai → tetap di-rate
  // (tidak ada kehilangan cakupan; kanonik tidak hadir untuk mewakili).
  const p0 = pairs[0];
  const scanTanpaKanonik = new Set([p0.twin_id]);
  suite.check(
    "NEG: kembar fd_ tanpa kanonik terpindai tetap di-rate",
    decideSlateFixture(p0.twin_id, identity, scanTanpaKanonik).action ===
      "rate",
  );

  // (c) Preseden R-03 utuh: kembar mt_ dilewati TANPA syarat kehadiran
  // kanonik di pindaian.
  const idMt = new SlateIdentity([
    { twin_id: "mt_022917440", canonical_id: "sm_19715544" },
  ]);
  const dMt = decideSlateFixture("mt_022917440", idMt, new Set(["mt_022917440"]));
  suite.check(
    "NEG: kembar mt_ tetap dilewati ala R-03 walau kanonik tak terpindai",
    dMt.action === "skip" && dMt.kind === "mt-r03",
    JSON.stringify(dMt),
  );

  // (d) Kembar sm_ (belah internal satu sumber) juga runtuh ke kanoniknya.
  const idSm = new SlateIdentity([
    { twin_id: "sm_19902643", canonical_id: "sm_19674574" },
  ]);
  const dSm = decideSlateFixture(
    "sm_19902643",
    idSm,
    new Set(["sm_19902643", "sm_19674574"]),
  );
  suite.check(
    "NEG: kembar sm_ runtuh ke kanonik sm_ (linked)",
    dSm.action === "skip" && dSm.kind === "linked",
    JSON.stringify(dSm),
  );

  // (e) Berkas tautan rusak/absen → parse gagal-lembut, perilaku warisan.
  suite.eq("NEG: parse tautan rusak → daftar kosong", parseSlateLinks("{rusak").length, 0);
  suite.eq(
    "NEG: parse tanpa field links → daftar kosong",
    parseSlateLinks("{}").length,
    0,
  );
  suite.eq(
    "NEG: parse tautan valid terbaca utuh",
    parseSlateLinks(JSON.stringify({ links })).length,
    14,
  );
}

/* -------------------------------------------------- kontrak pengawatan */

{
  // pick-slate.ts harus benar-benar memakai modul yang diuji di sini —
  // bukan salinan logika kedua yang bisa menyimpang diam-diam.
  const src = fs.readFileSync(
    path.join(HERE, "..", "scripts", "pick-slate.ts"),
    "utf8",
  );
  suite.check(
    "KAWAT: pick-slate mengimpor lib/picks/slate-identity",
    src.includes('from "../lib/picks/slate-identity"'),
  );
  for (const sym of [
    "decideSlateFixture",
    "slateGroupKey",
    "takeDistinctByGroup",
    "physicalKeySet",
  ]) {
    suite.check(
      `KAWAT: pick-slate memakai ${sym}`,
      src.includes(sym),
    );
  }
  suite.check(
    "KAWAT: formula group_key nama mentah tidak lagi dibangun inline di pick-slate",
    !src.includes("group_key: `${normalizeTeamName(fx.home_team_name)}"),
  );
}

suite.finish();
