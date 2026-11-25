/**
 * SUITE ML1 — UJI INJEKSI MASA DEPAN EKSTRAKTOR FITUR (Fase 1, design
 * tasks/ml1/design.md §7). Tepat 22 cek:
 *  A1–A10: ekstraktor ML1-A (form/Elo/rest/promoted) — invarians terhadap
 *          penanaman masa depan ekstrem, kepekaan terhadap masa lalu yang
 *          sah, batas strictly-before, flag missing, paritas Q1, determinisme.
 *  B1–B12: ekstraktor ML1-B (shots/SoT as-of dari log kanonik) — invarians
 *          masa depan (log & laga), kepekaan masa lalu, syarat ≥3 log,
 *          jendela 10, batas tanggal-sama, log null, isolasi per tim,
 *          ML1-B ⊃ ML1-A, determinisme.
 *
 * Semua data sintetis di memori — suite ini tidak menyentuh DB.
 */
import type { EvalMatchRow } from "../lib/eval/chronological-evaluator";
import { Q1FeatureExtractor } from "../lib/eval/kandidat-q1-poisson";
import { Ml1FeatureExtractor, type Ml1CanonicalLogRow } from "../lib/eval/ml1-features";
import { eloExpected } from "../lib/eval/q0-baselines";

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) pass++;
  else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function approx(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}
const eq = (a: number[], b: number[]): boolean => JSON.stringify(a) === JSON.stringify(b);

// Indeks kolom (design §4)
const C = {
  formGf5Home: 0, formGa5Home: 1, formGf10Home: 2, formGa10Home: 3,
  formGf5Away: 4, formGa5Away: 5, eloHome: 8, eloAway: 9, eloDiff: 10,
  restAdv: 11, venueNeutral: 12, promotedHome: 13, promotedAway: 14,
  missRest: 15, missFormHome: 16, missFormAway: 17, nPriorHome: 18, nPriorAway: 19,
  shotsForHome: 20, shotsAgainstHome: 21, sotForHome: 22, sotAgainstHome: 23,
  nPriorShotsHome: 28, nPriorShotsAway: 29, hasPriorShotsHome: 30, hasPriorShotsAway: 31,
} as const;

const mkMatch = (id: string, date: string, h: string, a: string, hs: number, as: number): EvalMatchRow => ({
  match_id: id, competition_id: "comp_t", utc_date: `${date}T15:00:00.000Z`,
  home_team_id: h, away_team_id: a, home_score: hs, away_score: as,
});
const mkLog = (team: string, date: string, sf: number | null, sa: number | null, sotf: number | null, sota: number | null): Ml1CanonicalLogRow => ({
  team_id: team, match_date: date, shots_for: sf, shots_against: sa,
  shots_on_target_for: sotf, shots_on_target_against: sota,
});

// Universe sintetis: X, Y, Z di comp_t.
const m1 = mkMatch("m1", "2026-01-03", "X", "Y", 2, 0);
const m2 = mkMatch("m2", "2026-01-10", "Y", "Z", 1, 1);
const m3 = mkMatch("m3", "2026-01-17", "Z", "X", 0, 3);
const m4 = mkMatch("m4", "2026-01-24", "X", "Z", 1, 2); // target utama
const m5 = mkMatch("m5", "2026-01-31", "Y", "X", 0, 0);
const base = [m1, m2, m3, m4, m5];
const noSeasons = new Map<string, string>();

const logsX: Ml1CanonicalLogRow[] = [
  mkLog("X", "2026-01-03", 10, 8, 4, 3),
  mkLog("X", "2026-01-10", 12, 6, 5, 2),
  mkLog("X", "2026-01-17", 14, 9, 6, 4),
  mkLog("X", "2026-01-24", 20, 5, 8, 1), // tanggal sama dengan m4 → harus terlarang
];
const logsY: Ml1CanonicalLogRow[] = [
  mkLog("Y", "2026-01-03", 9, 11, 3, 5),
  mkLog("Y", "2026-01-10", 11, 9, 4, 4),
];
const baseLogs = [...logsX, ...logsY];

const exBase = new Ml1FeatureExtractor(base, base, noSeasons, baseLogs);
const a4 = exBase.featuresA(m4);
const b4 = exBase.featuresB(m4);

// ---------------------------------------------------------------------------
// A. ML1-A
// ---------------------------------------------------------------------------
{
  // A1: laga masa depan ekstrem tidak mengubah fitur laga lama (vektor A penuh).
  const future = [...base, mkMatch("mF", "2026-02-07", "X", "Y", 15, 14), mkMatch("mF2", "2026-02-14", "Z", "X", 9, 9)];
  const exF = new Ml1FeatureExtractor(future, future, noSeasons, baseLogs);
  check("A1 injeksi masa depan: vektor ML1-A m4 identik", eq(exF.featuresA(m4), a4));

  // A2: Elo semua laga lama invarian terhadap masa depan (sekuensial = jalur paling rawan bocor).
  const eloSame = base.every((m) => {
    const x = exBase.featuresA(m);
    const y = exF.featuresA(m);
    return x[C.eloHome] === y[C.eloHome] && x[C.eloAway] === y[C.eloAway] && x[C.eloDiff] === y[C.eloDiff];
  });
  check("A2 injeksi masa depan: Elo pra-laga semua laga lama identik", eloSame);

  // A3: rest/promoted/konteks laga terakhir (m5) invarian terhadap masa depan.
  check("A3 injeksi masa depan: vektor ML1-A m5 identik", eq(exF.featuresA(m5), exBase.featuresA(m5)));

  // A4: penanaman masa lalu yang sah MENGUBAH form (kepekaan) — X menang 4-1 atas Z sebelum m1.
  const past = [mkMatch("m0", "2025-12-27", "X", "Z", 4, 1), ...base];
  const exP = new Ml1FeatureExtractor(past, past, noSeasons, baseLogs);
  const a4p = exP.featuresA(m4);
  check(
    "A4 injeksi masa lalu sah: form X berubah sesuai hitung tangan",
    approx(a4p[C.formGf5Home], 3.0, 1e-12) && a4p[C.nPriorHome] === 3 && a4p[C.missFormHome] === 0,
    `gf5=${a4p[C.formGf5Home]} n=${a4p[C.nPriorHome]} miss=${a4p[C.missFormHome]}`,
  );

  // A5: Elo predict-then-update sesuai hitung tangan konstruksi Q0-Elo
  // (rantai penuh m1 -> m2 -> m3, lalu rating pra-laga m4 dibaca).
  const dM1 = 20 * (1 - eloExpected(65)); // X menang kandang, gap awal = HFA 65
  const xAfterM1 = 1500 + dM1;
  const yAfterM1 = 1500 - dM1;
  const dM2 = 20 * (0.5 - eloExpected(yAfterM1 + 65 - 1500)); // Y vs Z seri
  const zAfterM2 = 1500 - dM2;
  const dM3 = 20 * (0 - eloExpected(zAfterM2 + 65 - xAfterM1)); // Z kalah kandang dari X
  const xPreM4 = xAfterM1 - dM3;
  const zPreM4 = zAfterM2 + dM3;
  check(
    "A5 Elo: rating pra-laga m4 = hitung tangan rantai Q0-Elo (X 1519,82 / Z 1489,95)",
    approx(a4[C.eloHome], xPreM4, 1e-9) && approx(a4[C.eloAway], zPreM4, 1e-9) &&
      approx(a4[C.eloHome], 1519.82, 0.01) && approx(a4[C.eloAway], 1489.95, 0.01),
    `home=${a4[C.eloHome]} away=${a4[C.eloAway]} expected=${xPreM4}/${zPreM4}`,
  );

  // A6: laga di tanggal yang sama TIDAK masuk jendela form (strictly-before tanggal).
  const sameDate = [...base, mkMatch("mS", "2026-01-24", "Z", "Y", 7, 0)];
  const exS = new Ml1FeatureExtractor(sameDate, sameDate, noSeasons, baseLogs);
  const a4s = exS.featuresA(m4);
  check(
    "A6 batas tanggal-sama: form/n_prior Z untuk m4 tidak berubah",
    a4s[C.formGf5Away] === a4[C.formGf5Away] && a4s[C.formGa5Away] === a4[C.formGa5Away] && a4s[C.nPriorAway] === a4[C.nPriorAway],
    `gf5a=${a4s[C.formGf5Away]} vs ${a4[C.formGf5Away]}, n=${a4s[C.nPriorAway]} vs ${a4[C.nPriorAway]}`,
  );

  // A7: laga pertama sebuah tim → flag missing + nilai nol.
  const a1 = exBase.featuresA(m1);
  check(
    "A7 tim tanpa riwayat: miss_form=1, miss_rest=1, n_prior=0, form=0",
    a1[C.missFormHome] === 1 && a1[C.missFormAway] === 1 && a1[C.missRest] === 1 &&
      a1[C.nPriorHome] === 0 && a1[C.nPriorAway] === 0 && a1[C.formGf5Home] === 0,
  );

  // A8: rest_adv hitung tangan — m5: Y istirahat 21 hari, X 7 hari → (21−7)/7 = 2.
  const a5 = exBase.featuresA(m5);
  check("A8 rest_adv m5 = 2 (hitung tangan)", approx(a5[C.restAdv], 2, 1e-12), `rest=${a5[C.restAdv]}`);

  // A9: paritas konteks dengan Q1FeatureExtractor (rest/venue/promoted/miss_rest) di semua laga.
  const q1 = new Q1FeatureExtractor(base, base, noSeasons);
  const parity = base.every((m) => {
    const a = exBase.featuresA(m);
    const q = q1.featuresFor(m);
    return (
      a[C.restAdv] === q.home.restAdv && a[C.venueNeutral] === q.home.venueNeutral &&
      a[C.promotedHome] === q.home.promoted && a[C.promotedAway] === q.away.promoted &&
      a[C.missRest] === q.home.missRest
    );
  });
  check("A9 paritas konteks ML1-A vs Q1 di semua laga", parity);

  // A10: determinisme ekstraksi A — dua instans, masukan sama → identik.
  const ex2 = new Ml1FeatureExtractor(base, base, noSeasons, baseLogs);
  check("A10 determinisme ML1-A: dua instans identik", base.every((m) => eq(ex2.featuresA(m), exBase.featuresA(m))));
}

// ---------------------------------------------------------------------------
// B. ML1-B
// ---------------------------------------------------------------------------
{
  // B1: log masa depan ekstrem tidak mengubah fitur shots laga lama.
  const futureLogs = [...baseLogs, mkLog("X", "2026-02-01", 99, 99, 99, 99), mkLog("Y", "2026-02-01", 99, 99, 99, 99)];
  const exF = new Ml1FeatureExtractor(base, base, noSeasons, futureLogs);
  check("B1 injeksi log masa depan: vektor ML1-B m4 identik", eq(exF.featuresB(m4), b4));

  // B2: laga masa depan + log-nya tidak mengubah fitur shots laga lama.
  const futureMatches = [...base, mkMatch("mF", "2026-02-07", "X", "Y", 15, 14)];
  const futureLogs2 = [...baseLogs, mkLog("X", "2026-02-07", 99, 99, 99, 99), mkLog("Y", "2026-02-07", 99, 99, 99, 99)];
  const exF2 = new Ml1FeatureExtractor(futureMatches, futureMatches, noSeasons, futureLogs2);
  check("B2 injeksi laga+log masa depan: vektor ML1-B m4 identik", eq(exF2.featuresB(m4), b4));

  // B3: log masa lalu yang sah mengubah rata-rata shots sesuai hitung tangan.
  const pastLogs = [...baseLogs, mkLog("X", "2025-12-27", 6, 12, 2, 6)];
  const exP = new Ml1FeatureExtractor(base, base, noSeasons, pastLogs);
  const b4p = exP.featuresB(m4);
  check(
    "B3 injeksi log masa lalu sah: shots_for_home m4 = (6+10+12+14)/4 = 10,5",
    approx(b4p[C.shotsForHome], 10.5, 1e-12) && b4p[C.nPriorShotsHome] === 4,
    `sf=${b4p[C.shotsForHome]} n=${b4p[C.nPriorShotsHome]}`,
  );

  // B4: riwayat < 3 log → flag 0 + fitur shots nol (Y cuma punya 2 log sebelum m5).
  const b5 = exBase.featuresB(m5);
  check(
    "B4 syarat >=3 log: Y di m5 has=0, shots=0, n_prior_shots=2",
    b5[C.hasPriorShotsHome] === 0 && b5[C.nPriorShotsHome] === 2 && b5[C.shotsForHome] === 0,
    `has=${b5[C.hasPriorShotsHome]} n=${b5[C.nPriorShotsHome]}`,
  );

  // B5: tepat 3 log → flag 1 + rata-rata hitung tangan (X sebelum m4).
  check(
    "B5 tepat 3 log: X di m4 has=1, sf=12, sa=23/3, sotf=5, sota=3",
    b4[C.hasPriorShotsHome] === 1 && approx(b4[C.shotsForHome], 12, 1e-12) &&
      approx(b4[C.shotsAgainstHome], 23 / 3, 1e-12) && approx(b4[C.sotForHome], 5, 1e-12) &&
      approx(b4[C.sotAgainstHome], 3, 1e-12),
    `sf=${b4[C.shotsForHome]} sa=${b4[C.shotsAgainstHome]}`,
  );

  // Dataset jendela: 12 log X (sf = 1..12) + target m6.
  const m6 = mkMatch("m6", "2026-03-07", "X", "Y", 1, 0);
  const logs12: Ml1CanonicalLogRow[] = [];
  for (let i = 1; i <= 12; i++) {
    const d = new Date(Date.UTC(2025, 10, 1) + (i - 1) * 7 * 86400_000).toISOString().slice(0, 10);
    logs12.push(mkLog("X", d, i, 2 * i, i, i));
  }
  const exW = new Ml1FeatureExtractor([...base, m6], [...base, m6], noSeasons, logs12);
  const b6 = exW.featuresB(m6);

  // B6: jendela rolling shots = 10 log terakhir (sf 3..12 → mean 7,5).
  check("B6 jendela 10: shots_for_home m6 = mean(3..12) = 7,5", approx(b6[C.shotsForHome], 7.5, 1e-12), `sf=${b6[C.shotsForHome]}`);

  // B7: log di tanggal yang sama dengan laga TIDAK terhitung (L4 X di 2026-01-24 vs m4).
  check("B7 batas tanggal-sama: n_prior_shots X untuk m4 = 3 (bukan 4)", b4[C.nPriorShotsHome] === 3, `n=${b4[C.nPriorShotsHome]}`);

  // B8: log dengan shots_for null tidak terhitung & tidak mengubah rata-rata.
  const nullLogs = [...baseLogs, mkLog("X", "2026-01-05", null, null, null, null)];
  const exN = new Ml1FeatureExtractor(base, base, noSeasons, nullLogs);
  const b4n = exN.featuresB(m4);
  check(
    "B8 log null diabaikan: n tetap 3, sf tetap 12",
    b4n[C.nPriorShotsHome] === 3 && approx(b4n[C.shotsForHome], 12, 1e-12),
  );

  // B9: ML1-B memuat ML1-A persis di 20 kolom pertama, untuk semua laga.
  check("B9 ML1-B superset ML1-A (20 kolom pertama identik)", base.every((m) => eq(exBase.featuresB(m).slice(0, 20), exBase.featuresA(m))));

  // B10: log besar milik lawan tidak mencemari blok shots tim kandang.
  const oppLogs = [...baseLogs, mkLog("Z", "2026-01-20", 50, 50, 50, 50), mkLog("Z", "2026-01-21", 50, 50, 50, 50), mkLog("Z", "2026-01-22", 50, 50, 50, 50)];
  const exO = new Ml1FeatureExtractor(base, base, noSeasons, oppLogs);
  const b4o = exO.featuresB(m4);
  check(
    "B10 isolasi per tim: blok home m4 utuh walau log Z besar ditanam",
    approx(b4o[C.shotsForHome], 12, 1e-12) && b4o[C.nPriorShotsHome] === 3 && b4o[C.shotsForHome] === b4[C.shotsForHome],
  );

  // B11: determinisme ekstraksi B — dua instans identik.
  const ex2 = new Ml1FeatureExtractor(base, base, noSeasons, baseLogs);
  check("B11 determinisme ML1-B: dua instans identik", base.every((m) => eq(ex2.featuresB(m), exBase.featuresB(m))));

  // B12: n_prior_shots menghitung SEMUA log lampau ber-stat (12), walau jendela mean cuma 10.
  check("B12 n_prior_shots tanpa cap: m6 = 12", b6[C.nPriorShotsHome] === 12 && b6[C.hasPriorShotsHome] === 1, `n=${b6[C.nPriorShotsHome]}`);
}

// ---------------------------------------------------------------------------
console.log(`ML1-FEATURES-INJECTION: ${pass}/${pass + fail} PASS`);
if (failures.length) {
  console.log("GAGAL:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
