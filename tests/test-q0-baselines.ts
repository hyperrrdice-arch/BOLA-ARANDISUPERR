/**
 * SUITE Q0 (Item 1, Sprint A+B) — unit baseline pembanding.
 *
 * Memverifikasi: frekuensi empiris, NaivePoisson (rerata venue + fallback
 * liga), Elo sekuensial (predict-then-update; mapper terbin kalibrasi
 * latih; bin kosong → frekuensi keseluruhan), sifat point-in-time
 * (prediksi/gap tidak berubah oleh laga masa depan; berubah oleh laga
 * masa lalu — jebakan peka), dan determinisme byte.
 */
import { Suite } from "./helpers/fixture-env";
import type { EvalMatchRow } from "../lib/eval/chronological-evaluator";
import {
  eloBinIndex,
  eloExpected,
  eloGapsSequential,
  eloMapProbs,
  fitEloMapper,
  fitNaivePoisson,
  leagueFrequencies,
  predictNaivePoisson,
} from "../lib/eval/q0-baselines";

const suite = new Suite("q0-baselines (Item 1)");

const M = (
  id: string,
  date: string,
  h: string,
  a: string,
  hs: number,
  as: number,
): EvalMatchRow => ({
  match_id: id,
  competition_id: "sm:test",
  utc_date: date,
  home_team_id: h,
  away_team_id: a,
  home_score: hs,
  away_score: as,
});

const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) < tol;

// --- Freq -------------------------------------------------------------------
{
  const train = [
    M("1", "2026-01-01", "A", "B", 2, 0),
    M("2", "2026-01-02", "A", "B", 1, 0),
    M("3", "2026-01-03", "B", "A", 1, 1),
    M("4", "2026-01-04", "B", "A", 0, 3),
  ];
  const f = leagueFrequencies(train);
  suite.check("freq: [0.5, 0.25, 0.25]", near(f[0], 0.5) && near(f[1], 0.25) && near(f[2], 0.25), JSON.stringify(f));
  suite.eq("freq: latih kosong → uniform", leagueFrequencies([]), [1 / 3, 1 / 3, 1 / 3]);
}

// --- NaivePoisson -------------------------------------------------------------
{
  const train = [
    M("1", "2026-01-01", "A", "B", 2, 1),
    M("2", "2026-01-02", "A", "C", 4, 0),
    M("3", "2026-01-03", "B", "A", 1, 3),
  ];
  const model = fitNaivePoisson(train);
  suite.check("naive: rerata kandang tim A = 3", near(model.homeMeanByTeam.get("A")!, 3));
  suite.check("naive: rerata tandang tim A = 3", near(model.awayMeanByTeam.get("A")!, 3));
  suite.check("naive: rerata kandang liga = 7/3", near(model.leagueHomeMean, 7 / 3));
  const pred = predictNaivePoisson(model, M("x", "2026-02-01", "A", "B", 0, 0));
  suite.check("naive: λ=3 (A kandang), μ=1 (B tandang)", near(pred.lam, 3) && near(pred.mu, 1), `${pred.lam}/${pred.mu}`);
  suite.check(
    "naive: probabilitas jumlah 1",
    near(pred.p[0] + pred.p[1] + pred.p[2], 1, 1e-9),
    JSON.stringify(pred.p),
  );
  const predUnknown = predictNaivePoisson(model, M("y", "2026-02-01", "ZZ", "B", 0, 0));
  suite.check(
    "naive: tim asing → fallback rerata liga",
    near(predUnknown.lam, model.leagueHomeMean),
    `${predUnknown.lam} vs ${model.leagueHomeMean}`,
  );
}

// --- Elo ----------------------------------------------------------------------
{
  suite.check("elo: expected(0) = 0.5", near(eloExpected(0), 0.5));
  suite.check("elo: expected(400) ≈ 0.909", near(eloExpected(400), 1 / 1.1, 1e-12));
  suite.eq("elo: bin gap 0 di tengah grid", eloBinIndex(0), 12);
  suite.eq("elo: bin gap ekstrem terjepit", [eloBinIndex(-5000), eloBinIndex(5000)], [0, 23]);

  const seq = [
    M("1", "2026-01-01", "A", "B", 2, 0), // A menang kandang
    M("2", "2026-01-08", "B", "A", 1, 0), // B menang kandang
    M("3", "2026-01-15", "A", "B", 0, 0),
  ];
  const gaps = eloGapsSequential(seq);
  suite.check("elo: gap laga pertama = HFA 65", near(gaps[0].gap, 65), `${gaps[0].gap}`);
  // Sesudah A menang: rating A naik → gap laga 2 (B kandang vs A) turun di bawah 65.
  suite.check("elo: gap laga 2 mencerminkan update laga 1", gaps[1].gap < 65, `${gaps[1].gap}`);

  // Jebakan point-in-time: mengubah skor laga 3 (masa depan laga 2) TIDAK
  // mengubah gap laga 1–2; mengubah skor laga 1 MENGUBAH gap laga 2.
  const seqFutureChanged = [...seq.slice(0, 2), M("3", "2026-01-15", "A", "B", 9, 9)];
  const gapsFuture = eloGapsSequential(seqFutureChanged);
  suite.check(
    "elo PIT: skor masa depan tidak mengubah gap sebelumnya",
    near(gapsFuture[0].gap, gaps[0].gap) && near(gapsFuture[1].gap, gaps[1].gap),
  );
  const seqPastChanged = [M("1", "2026-01-01", "A", "B", 0, 5), ...seq.slice(1)];
  const gapsPast = eloGapsSequential(seqPastChanged);
  suite.check(
    "elo PIT: skor masa lalu mengubah gap berikutnya (jebakan peka)",
    !near(gapsPast[1].gap, gaps[1].gap),
    `${gapsPast[1].gap} vs ${gaps[1].gap}`,
  );

  // Mapper: catatan terkonsentrasi di bin gap 0 → bin itu empiris; bin jauh kosong → overall.
  const records = [
    { gap: 10, y: 0 as const },
    { gap: 20, y: 0 as const },
    { gap: 15, y: 1 as const },
    { gap: -10, y: 2 as const },
  ];
  const mapper = fitEloMapper(records);
  const pMid = eloMapProbs(mapper, 12);
  suite.check(
    "elo mapper: bin berpenghuni = frekuensi Laplace (3,2,1)/6",
    near(pMid[0], 3 / 6) && near(pMid[1], 2 / 6) && near(pMid[2], 1 / 6),
    JSON.stringify(pMid),
  );
  const pFar = eloMapProbs(mapper, 590);
  suite.check(
    "elo mapper: bin kosong → frekuensi keseluruhan (3,2,2)/7",
    near(pFar[0], 3 / 7) && near(pFar[1], 2 / 7) && near(pFar[2], 2 / 7),
    JSON.stringify(pFar),
  );

  // Determinisme byte: dua run identik.
  const run1 = JSON.stringify(eloGapsSequential(seq).map((g) => g.gap));
  const run2 = JSON.stringify(eloGapsSequential(seq).map((g) => g.gap));
  suite.eq("elo: determinisme byte-identik", run1, run2);
}

suite.finish();
