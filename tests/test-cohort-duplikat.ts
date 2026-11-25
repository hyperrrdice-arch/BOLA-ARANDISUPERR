/**
 * SUITE A3 (keputusan pemilik 25 Nov 2026, opsi (a)) — pick termarking
 * `duplicate_of` KELUAR dari statistik akurasi utama.
 *
 * Yang dibuktikan:
 *  (i)  pick termarking keluar dari cohortStats — pembilang DAN penyebut
 *       (issued, settled, hits, overdue, prob_slice);
 *  (ii) pick tak termarking angkanya TIDAK berubah (miss tetap dihitung,
 *       pending tak termarking tetap jatuh tempo);
 *  (iii) flag `duplicate_of` tetap tersimpan & terbaca untuk audit, status
 *       pick tidak berubah (bukan void), dan resolver tetap memasukkan
 *       pick termarking yang belum dinilai ke daftar unresolved;
 *  (iv) penandaan (UPDATE di tempat, tanpa baris/outcome baru) langsung
 *       tercermin di cohortStats — tanda tangan cache memuat jumlah
 *       pick termarking, jadi statistik pra-tanda tidak disajikan basi.
 */
import {
  Suite,
  buildCoreSchemas,
  createFixtureEnv,
  settleFixtureEnv,
} from "./helpers/fixture-env";

const suite = new Suite("cohort-duplikat (A3)");

const NOW = "2026-11-21T00:00:00.000Z";
const SETTLED_KO = "2026-11-20T13:00:00.000Z";
const OVERDUE_KO = "2026-11-20T10:00:00.000Z";

async function main(): Promise<void> {
  const env = createFixtureEnv("cohortdup");
  process.chdir(env.root);
  const { ledger } = await buildCoreSchemas();
  const pub = await import("../lib/picks/publication");
  // Migrasi publikasi menambah kolom published_prob + duplicate_of.
  pub.ensurePublicationSchema(ledger.getPicksDb());
  const cohort = await import("../lib/picks/cohort");

  const seed = (
    kickoff: string,
    over: Partial<import("../lib/picks/ledger").PickInput> = {},
  ): number =>
    ledger.recordPick({
      match_id: `dup_${Math.random().toString(36).slice(2, 9)}`,
      kickoff_utc: kickoff,
      market: "dc",
      selection: "1x",
      model_prob: 0.8,
      source: "dup-test",
      ...over,
    });
  const setPublished = (id: number, p: number) => {
    ledger
      .getPicksDb()
      .prepare(
        "UPDATE picks SET published_prob = ?, probability_basis = 'effective' WHERE id = ?",
      )
      .run(p, id);
  };

  // Populasi: 3 dinilai (2 hit, 1 miss) + 2 pending jatuh tempo.
  const canonHit = seed(SETTLED_KO);
  setPublished(canonHit, 0.8);
  ledger.recordOutcome(canonHit, 2, 0); // hit
  const dupHit = seed(SETTLED_KO);
  setPublished(dupHit, 0.8);
  ledger.recordOutcome(dupHit, 1, 0); // hit — kembaran canonHit
  const plainMiss = seed(SETTLED_KO);
  setPublished(plainMiss, 0.8);
  ledger.recordOutcome(plainMiss, 0, 2); // miss (dc/1x kalah)
  const dupPending = seed(OVERDUE_KO);
  setPublished(dupPending, 0.8);
  const plainPending = seed(OVERDUE_KO);
  setPublished(plainPending, 0.8);
  void plainMiss;
  void plainPending;

  const base = cohort.cohortStats({
    now_utc: NOW,
    filter: { source: "dup-test" },
  });
  suite.eq("basis: issued 5", base.issued, 5);
  suite.eq("basis: settled 3", base.settled, 3);
  suite.eq("basis: hits 2", base.hits, 2);
  suite.eq("basis: misses 1", base.misses, 1);
  suite.check(
    "basis: hit_ratio 2/3",
    base.hit_ratio !== null && Math.abs(base.hit_ratio - 2 / 3) < 1e-9,
    String(base.hit_ratio),
  );
  suite.eq("basis: overdue 2", base.overdue_pending, 2);
  suite.eq("basis: due 5", base.due, 5);
  suite.eq("basis: irisan prob n=3", base.prob_slice.n, 3);

  // Tandai kembarannya — persis pola marking produksi 25 Nov:
  // UPDATE duplicate_of di tempat, tanpa baris/outcome/status baru.
  ledger
    .getPicksDb()
    .prepare("UPDATE picks SET duplicate_of = ? WHERE id IN (?, ?)")
    .run(canonHit, dupHit, dupPending);

  const after = cohort.cohortStats({
    now_utc: NOW,
    filter: { source: "dup-test" },
  });
  // (i) termarking keluar dari pembilang DAN penyebut.
  suite.eq("A3: issued 3 (2 termarking keluar)", after.issued, 3);
  suite.eq("A3: settled 2", after.settled, 2);
  suite.eq("A3: hits 1 (hit kembaran tidak digandakan)", after.hits, 1);
  suite.eq("A3: due 3", after.due, 3);
  suite.eq("A3: irisan prob n=2", after.prob_slice.n, 2);
  suite.check(
    "A3: hit_ratio 1/2",
    after.hit_ratio !== null && Math.abs(after.hit_ratio - 0.5) < 1e-9,
    String(after.hit_ratio),
  );
  // (ii) tak termarking tidak berubah.
  suite.eq("A3: misses tetap 1", after.misses, 1);
  suite.eq("A3: overdue tetap 1 (pending tak termarking)", after.overdue_pending, 1);
  // (iv) angka berubah tanpa baris/outcome baru → cache tidak basi.
  suite.check(
    "A3: statistik pasca-tanda != pra-tanda (tanda tangan cache memuat n_dup)",
    after.settled !== base.settled && after.issued !== base.issued,
  );

  // (iii) flag tetap terbaca untuk audit; status bukan void.
  const flagRow = ledger
    .getPicksDb()
    .prepare("SELECT duplicate_of FROM picks WHERE id = ?")
    .get(dupHit) as unknown as { duplicate_of: number | null };
  suite.eq("A3: flag duplicate_of terbaca (audit)", flagRow.duplicate_of, canonHit);
  suite.eq("A3: voids tetap 0 (bukan void)", after.voids, 0);
  // Resolver tetap menilai: pending termarking tetap di daftar unresolved.
  const unresolvedIds = ledger.listUnresolved().map((r) => r.id);
  suite.check(
    "A3: pending termarking tetap unresolved (resolver menilai seperti biasa)",
    unresolvedIds.includes(dupPending),
  );
  suite.check(
    "A3: pending tak termarking juga unresolved",
    unresolvedIds.includes(plainPending),
  );

  settleFixtureEnv(env, suite.failedCount > 0);
  suite.finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
