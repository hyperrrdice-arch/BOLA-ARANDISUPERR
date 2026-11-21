/**
 * LANJUT-1 — perhitungan gabungan /pilihan SADAR EDISI PAKET.
 *
 * Temuan pemilik (Bola-Tindak-Lanjut-Verifikasi-22-November.md §1,
 * terverifikasi di produksi pada build lqc0DrOX): draf Marseille–
 * Le Mans, dua pilihan resmi yang sama dari SATU laga fisik —
 * "Olympique Marseille menang" 62,9% (paket 7816, sm_19715544, 1x2)
 * dan "Minimal dua gol" 85,5% (paket 7815, mt_022917440, ou15) —
 * menampilkan 57,7% bila ditambah A→B dan 51% bila B→A. Akarnya:
 * ParlayBuilder mengambil matriks per packageId, tetapi combineSlip
 * membuang identitas paket dan memakai matriks PERTAMA yang ketemu
 * di grup (`group.find((g) => g.matrix)`) — urutan klik menentukan
 * edisi yang menjadi dasar irisan.
 *
 * Suite ini membekukan kasusnya dari data tetap
 * (tests/fixtures/pilihan-edisi-marseille.json — matriks lengkap
 * kedua paket diekstrak dari salinan DB lokal; paket lokal 7536/7537
 * terverifikasi isi-identik dengan paket produksi 7815/7816 lewat
 * tiga angka irisan pemilik) dan mengunci kontrak perbaikannya:
 * - irisan satu laga HANYA dari matriks paket yang SAMA untuk semua
 *   pilihan grup; lintas paket → "Peluang gabungan belum tersedia"
 *   + alasan persis pemilik, total draf tertahan, grup lain tetap
 *   terhitung;
 * - hasil tidak bergantung urutan klik / urutan pulih / urutan
 *   kedatangan matriks; matriks parsial tidak pernah menerbitkan
 *   angka;
 * - kontrol positif satu edisi (paket 7815) ≈ 89,2% dari matriks
 *   mentah — TIDAK dipotong memakai persentase individual
 *   terkalibrasi;
 * - dedupe kejadian identik lintas alias, kombinasi lintas laga,
 *   dan jalur pemanggil lama tanpa identitas edisi tetap utuh.
 *
 * Jalankan: npx tsx tests/test-pilihan-edisi.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Suite } from "./helpers/fixture-env";
import {
  combineSlip,
  selectionPredicate,
  type SlipPick,
} from "../lib/web/parlay";

const suite = new Suite("pilihan-edisi");
const dekat = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

const ALASAN_EDISI = "Dua pilihan ini berasal dari edisi prediksi yang berbeda";

/* ------------------------------------------------------------ fixture */

interface FixtureEdisi {
  fixtureUid: string;
  paket: Record<
    string,
    { matchId: string; matriks: number[][] }
  >;
  pilihan: Array<{
    pickUid: string;
    matchId: string;
    market: string;
    selection: string;
    line: string;
    publishedProb: number;
    basis: string;
    grade: string;
    packageId: number;
  }>;
  harapan: {
    irisanMenangDanTotal2Pada7816: number;
    irisanMenangDanTotal2Pada7815: number;
    kontrolPositifSatuEdisi7815: number;
  };
}

const fx = JSON.parse(
  fs.readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "fixtures",
      "pilihan-edisi-marseille.json",
    ),
    "utf8",
  ),
) as FixtureEdisi;

const M7815 = fx.paket["7815"].matriks;
const M7816 = fx.paket["7816"].matriks;
const pik = (uid: string) => {
  const p = fx.pilihan.find((x) => x.pickUid === uid);
  if (!p) throw new Error(`pilihan fixture hilang: ${uid}`);
  return p;
};
const P_MENANG = pik("pk_5098409ec60afb0cce640c21e3bdec67"); // 1x2 "1", paket 7816
const P_OU15 = pik("pk_0a736651fc728ee263eb86c934b8267b"); // ou15 over, paket 7815
const P_CETAK = pik("pk_f0809c37a0f93c11e9c0135f2fe40b8e"); // team_over05_home, paket 7815

/** Jumlah sel matriks yang memenuhi semua predikat (pasar, pilihan). */
function irisan(m: number[][], ...pasangan: Array<[string, string]>): number {
  const preds = pasangan.map(([market, selection]) => {
    const p = selectionPredicate(market, selection);
    if (!p) throw new Error(`predikat tak dikenal: ${market}/${selection}`);
    return p;
  });
  let s = 0;
  for (let h = 0; h < m.length; h++)
    for (let a = 0; a < m[h].length; a++) if (preds.every((p) => p(h, a))) s += m[h][a];
  return s;
}

/* ------------------------------------- validasi fixture (angka pemilik) */

function jumlahSemua(m: number[][]): number {
  let s = 0;
  for (const row of m) for (const v of row) s += v;
  return s;
}

suite.check("fixture: matriks 7815 berjumlah 1", dekat(jumlahSemua(M7815), 1));
suite.check("fixture: matriks 7816 berjumlah 1", dekat(jumlahSemua(M7816), 1));
suite.check(
  "fixture: irisan(menang ∧ total≥2) pada 7816 = 0,576516711 pemilik",
  dekat(irisan(M7816, ["1x2", "1"], ["ou15", "over"]), fx.harapan.irisanMenangDanTotal2Pada7816),
  String(irisan(M7816, ["1x2", "1"], ["ou15", "over"])),
);
suite.check(
  "fixture: irisan(menang ∧ total≥2) pada 7815 = 0,509662234 pemilik",
  dekat(irisan(M7815, ["1x2", "1"], ["ou15", "over"]), fx.harapan.irisanMenangDanTotal2Pada7815),
  String(irisan(M7815, ["1x2", "1"], ["ou15", "over"])),
);
suite.check(
  "fixture: kontrol positif 7815 (cetak gol ∧ total≥2) ≈ 89,2%",
  dekat(
    irisan(M7815, ["team_over05_home", "yes"], ["ou15", "over"]),
    fx.harapan.kontrolPositifSatuEdisi7815,
  ),
  String(irisan(M7815, ["team_over05_home", "yes"], ["ou15", "over"])),
);

/* ------------------------------------------------- konstruksi SlipPick */

/** SlipPick persis konstruksi ParlayBuilder: matriks = cache paket pilihan itu. */
function keSlip(
  p: (typeof fx.pilihan)[number],
  matriksPerPaket: Record<number, number[][] | null>,
  kunci = p.pickUid,
): SlipPick {
  return {
    key: kunci,
    matchId: fx.fixtureUid,
    market: p.market,
    selection: p.selection,
    prob: p.publishedProb,
    probBasis: "lab",
    packageId: p.packageId,
    matrix: matriksPerPaket[p.packageId] ?? null,
  };
}

const KEDUA_MATRIKS: Record<number, number[][] | null> = { 7815: M7815, 7816: M7816 };

/** Bentuk hasil yang dibandingkan antar urutan: angka/status/alasan. */
function bentuk(r: ReturnType<typeof combineSlip>): string {
  return JSON.stringify({
    combined: r.combined,
    alasanGabungan: r.alasanGabungan,
    groups: r.groups.map((g) => ({
      prob: g.prob,
      unavailable: g.unavailable,
      alasan: g.alasan,
      count: g.count,
    })),
  });
}

/* ------------------------------------------- lintas edisi: A→B dan B→A */

const ab = combineSlip([keSlip(P_MENANG, KEDUA_MATRIKS), keSlip(P_OU15, KEDUA_MATRIKS)]);
suite.check("lintas edisi A→B: gabungan tertahan (null)", ab.combined === null);
suite.check(
  "lintas edisi A→B: alasan gabungan persis pemilik",
  ab.alasanGabungan === ALASAN_EDISI,
  String(ab.alasanGabungan),
);
suite.check(
  "lintas edisi A→B: grup unavailable + alasan persis + kedua pilihan dipertahankan (count 2)",
  ab.groups.length === 1 &&
    ab.groups[0].unavailable &&
    ab.groups[0].alasan === ALASAN_EDISI &&
    ab.groups[0].count === 2 &&
    ab.groups[0].prob === null,
);

const ba = combineSlip([keSlip(P_OU15, KEDUA_MATRIKS), keSlip(P_MENANG, KEDUA_MATRIKS)]);
suite.check(
  "lintas edisi B→A: hasil IDENTIK dengan A→B",
  bentuk(ba) === bentuk(ab),
  bentuk(ba),
);

/* --------------------------- urutan pulih draf (urutan umpan, bukan klik) */

// Pemulihan mengembalikan baris umpan (urut sepak mula lalu terbit) —
// untuk pasangan ini urutannya ou15 (A, 85,5%) mendahului 1x2 (B) di
// daftar terfilter kelas; hasil wajib sama dengan kedua urutan klik.
const pulih = combineSlip([keSlip(P_OU15, KEDUA_MATRIKS), keSlip(P_MENANG, KEDUA_MATRIKS)]);
suite.check("pulih sesudah muat ulang: hasil IDENTIK", bentuk(pulih) === bentuk(ab));

/* ------------------------------ kedatangan matriks tidak mengubah hasil */

// Matriks 7816 tiba, 7815 belum (atau sebaliknya): lintas edisi tetap
// tidak tersedia — angka TIDAK boleh lahir dari edisi mana pun yang
// kebetulan sudah termuat.
const sebagianSm = combineSlip([
  keSlip(P_MENANG, { 7816: M7816, 7815: null }),
  keSlip(P_OU15, { 7816: M7816, 7815: null }),
]);
suite.check(
  "baru matriks 7816 termuat: tetap belum tersedia + alasan edisi",
  sebagianSm.combined === null && sebagianSm.alasanGabungan === ALASAN_EDISI,
);
const sebagianMt = combineSlip([
  keSlip(P_MENANG, { 7816: null, 7815: M7815 }),
  keSlip(P_OU15, { 7816: null, 7815: M7815 }),
]);
suite.check(
  "baru matriks 7815 termuat: tetap belum tersedia + alasan edisi",
  sebagianMt.combined === null && sebagianMt.alasanGabungan === ALASAN_EDISI,
);
const belumAda = combineSlip([
  keSlip(P_MENANG, { 7816: null, 7815: null }),
  keSlip(P_OU15, { 7816: null, 7815: null }),
]);
suite.check(
  "belum ada matriks termuat: tidak ada angka gabungan terbit",
  belumAda.combined === null && belumAda.groups[0].unavailable,
);

/* -------------------------------------- kontrol positif satu edisi 7815 */

const positif = combineSlip([keSlip(P_CETAK, KEDUA_MATRIKS), keSlip(P_OU15, KEDUA_MATRIKS)]);
suite.check(
  "satu edisi 7815: irisan persis ≈ 89,2% dari matriks mentah",
  positif.combined !== null && dekat(positif.combined, fx.harapan.kontrolPositifSatuEdisi7815),
  String(positif.combined),
);
suite.check(
  "satu edisi 7815: grup exact + basis matrix (keterangan basis model dipertahankan)",
  positif.groups[0].exact && positif.groups[0].basis === "matrix" && positif.basis === "model",
);
const positifBalik = combineSlip([keSlip(P_OU15, KEDUA_MATRIKS), keSlip(P_CETAK, KEDUA_MATRIKS)]);
suite.check("satu edisi 7815 urutan terbalik: IDENTIK", bentuk(positifBalik) === bentuk(positif));

// Matriks edisi bersama belum termuat → angka ditahan, bukan diganti
// perkalian persentase individual terkalibrasi (0,8715 × 0,8553).
const positifMemuat = combineSlip([
  keSlip(P_CETAK, { 7815: null }),
  keSlip(P_OU15, { 7815: null }),
]);
suite.check(
  "satu edisi, matriks belum termuat: gabungan tertahan (bukan perkalian individual)",
  positifMemuat.combined === null && positifMemuat.groups[0].unavailable,
);

// Matriks edisi bersama dibawa baris mana pun dalam grup → tetap persis.
const positifSatuBaris = combineSlip([
  { ...keSlip(P_CETAK, KEDUA_MATRIKS), matrix: null },
  keSlip(P_OU15, KEDUA_MATRIKS),
]);
suite.check(
  "satu edisi, matriks hanya di satu baris grup: tetap persis 89,2%",
  positifSatuBaris.combined !== null &&
    dekat(positifSatuBaris.combined, fx.harapan.kontrolPositifSatuEdisi7815),
  String(positifSatuBaris.combined),
);

/* --------------------------------------- kejadian identik lewat alias */

const alias = combineSlip([
  keSlip(P_OU15, KEDUA_MATRIKS, "alias-mt"),
  keSlip(P_OU15, KEDUA_MATRIKS, "alias-sm"),
]);
suite.check(
  "pilihan identik via alias tetap SATU kejadian (bukan dikuadratkan)",
  alias.groups.length === 1 && alias.groups[0].count === 1 && alias.combined === P_OU15.publishedProb,
  bentuk(alias),
);

/* ------------------------------------------------ kombinasi lintas laga */

const LAIN = "fx_laga_lain";
const tunggalLain: SlipPick = {
  key: "lain-1",
  matchId: LAIN,
  market: "1x2",
  selection: "1",
  prob: 0.8,
  probBasis: "lab",
  packageId: 9999,
  matrix: null,
};
const lintas = combineSlip([
  keSlip(P_CETAK, KEDUA_MATRIKS),
  keSlip(P_OU15, KEDUA_MATRIKS),
  tunggalLain,
]);
suite.check(
  "lintas laga: irisan satu edisi × pilihan laga lain (independen)",
  lintas.combined !== null &&
    dekat(lintas.combined, fx.harapan.kontrolPositifSatuEdisi7815 * 0.8),
  String(lintas.combined),
);

/* ------------------------- total tertahan, ringkasan grup lain tampil */

// Grup kedua yang BISA dihitung: pasangan satu edisi pada matriks
// regresi sintetis langkah 5 (irisan kandang ≥1 ∧ total ≤3 = 0,529).
const MATRIKS_REGRESI: number[][] = [
  [0.06, 0.07, 0.055, 0.035, 0.012, 0.007],
  [0.15, 0.14, 0.07, 0.045, 0.02, 0.008],
  [0.09, 0.05, 0.048, 0.026, 0.011, 0.004],
  [0.029, 0.028, 0.016, 0.009, 0.004, 0.001],
  [0.006, 0.003, 0.0015, 0.0005, 0.0003, 0.0002],
  [0.0003, 0.0001, 0.00005, 0.00003, 0.00001, 0.00001],
];
const grupLain: SlipPick[] = [
  {
    key: "reg-1", matchId: "fx_regresi", market: "team_over05_home", selection: "yes",
    prob: 0.761, probBasis: "lab", packageId: 777, matrix: MATRIKS_REGRESI,
  },
  {
    key: "reg-2", matchId: "fx_regresi", market: "ou35", selection: "under",
    prob: 0.749, probBasis: "lab", packageId: 777, matrix: MATRIKS_REGRESI,
  },
];
const tertahan = combineSlip([
  keSlip(P_MENANG, KEDUA_MATRIKS),
  keSlip(P_OU15, KEDUA_MATRIKS),
  ...grupLain,
]);
const gMars = tertahan.groups.find((g) => g.matchId === fx.fixtureUid);
const gReg = tertahan.groups.find((g) => g.matchId === "fx_regresi");
suite.check("total tertahan saat satu grup lintas edisi", tertahan.combined === null);
suite.check(
  "alasan gabungan = alasan edisi (grup pertama yang tertahan)",
  tertahan.alasanGabungan === ALASAN_EDISI,
  String(tertahan.alasanGabungan),
);
suite.check(
  "grup Marseille unavailable; grup regresi TETAP terhitung 52,9%",
  gMars?.unavailable === true &&
    gReg?.prob !== null &&
    gReg !== undefined &&
    dekat(gReg.prob ?? NaN, 0.529, 1e-3),
  JSON.stringify(tertahan.groups),
);

/* ------------------------------------------- pilihan tunggal tak berubah */

const tunggal = combineSlip([keSlip(P_MENANG, { 7816: null })]);
suite.check(
  "satu pilihan: peluang tersimpan dipakai, matriks tak diperlukan",
  tunggal.combined === P_MENANG.publishedProb && tunggal.groups[0].count === 1,
);

/* ------------------------- jalur warisan tanpa identitas edisi (pengaman) */

// Pemanggil lama (uji/probe yang menempelkan matriks langsung tanpa
// packageId) tidak berubah perilakunya: matriks bersama yang ditempel
// dipakai persis seperti sebelumnya.
const warisan: SlipPick[] = [
  { key: "w1", matchId: fx.fixtureUid, market: "team_over05_home", selection: "yes", prob: 0.8715, probBasis: "lab", matrix: M7815 },
  { key: "w2", matchId: fx.fixtureUid, market: "ou15", selection: "over", prob: 0.8553, probBasis: "lab", matrix: M7815 },
];
const gWarisan = combineSlip(warisan);
suite.check(
  "tanpa identitas edisi (pemanggil lama): irisan matriks bersama tetap persis",
  gWarisan.combined !== null && dekat(gWarisan.combined, fx.harapan.kontrolPositifSatuEdisi7815),
  String(gWarisan.combined),
);

suite.finish();
