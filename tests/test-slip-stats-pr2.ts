/**
 * SUITE ITEM 9 (Sprint A+B) — slipRecordStats × klasifikasi terminal PR 2.
 *
 * Memverifikasi penyatuan statistik tiket dengan /bukti (cohortStats):
 * tiket menunggu yang salah satu pilihan anggotanya sudah jatuh tempo di
 * kompetisi yang terbukti TANPA feed hasil tidak akan pernah selesai —
 * ia keluar dari `pending` dan tampil sebagai hitungan terpisah
 * `unresolvable`, persis perlakuan cohort terhadap pilihan.
 *
 * Kasus yang dicakup:
 *  - tanpa-feed + jatuh tempo + belum dinilai  → unresolvable;
 *  - tanpa-feed + BELUM jatuh tempo            → tetap pending;
 *  - berfeed + jatuh tempo                     → tetap pending (utang biasa);
 *  - kompetisi asing / NULL (tidak-diketahui)  → tetap pending (konservatif);
 *  - tiket dengan anggota miss + anggota tanpa-feed menggantung
 *                                              → unresolvable (tidak pernah
 *                                                bisa selesai dinilai);
 *  - konsistensi angka dengan cohortStats pada populasi yang sama.
 *
 * Registri liga ditulis sebagai fixture mini ke sandbox (pola PR 2):
 *   liga_berfeed     — alias legacy-div E0 (divisi aktif);
 *   liga_tanpa_feed  — alias sm saja (bersumber, tanpa jalur hasil).
 * slipRecordStats memakai jam riil; kickoff DUE (2026-11-01) selalu
 * jatuh tempo pada jam riil, FUTURE (2027-06-01) selalu belum.
 */
import fs from "node:fs";
import path from "node:path";
import {
  Suite,
  buildCoreSchemas,
  createFixtureEnv,
  settleFixtureEnv,
} from "./helpers/fixture-env";

const suite = new Suite("slip-stats-pr2 (Item 9)");

const PUBLISH_NOW = "2026-10-30T10:40:00.000Z";
const DECISION = "2026-10-30T10:30:00.000Z";
const CUTOFF = "2026-10-30T10:00:00.000Z";
const DUE = "2026-11-01T13:00:00.000Z";
const FUTURE = "2027-06-01T13:00:00.000Z";

async function main(): Promise<void> {
  const env = createFixtureEnv("slippr2");
  process.chdir(env.root);
  const { ledger } = await buildCoreSchemas();
  const pub = await import("../lib/picks/publication");
  const tickets = await import("../lib/picks/tickets");
  const cohort = await import("../lib/picks/cohort");

  fs.writeFileSync(
    path.join(env.dataDir, "league-canonical.json"),
    JSON.stringify({
      version: 1,
      generated_at: "2026-10-30T00:00:00.000Z",
      generator: "tests/test-slip-stats-pr2.ts (fixture Item 9)",
      leagues: [
        {
          canonical_id: "liga_berfeed",
          name: "Liga Berfeed",
          country: "X",
          fits: [],
          aliases: [{ system: "legacy-div", id: "E0" }],
        },
        {
          canonical_id: "liga_tanpa_feed",
          name: "Liga Tanpa Feed",
          country: "Y",
          fits: [],
          aliases: [{ system: "sm", id: "9999" }],
        },
      ],
    }),
  );
  fs.writeFileSync(
    path.join(env.dataDir, "fixture-links.json"),
    JSON.stringify({ links: [] }),
  );

  const scheduled = () => "scheduled";
  let seq = 0;
  const publishOne = (
    kickoff: string,
    comp: string,
  ): number => {
    seq++;
    const input: import("../lib/picks/publication").PublishFixtureInput = {
      series: "live-run",
      source_match_id: `fx_s9_${seq}`,
      fixture_uid: `uid-s9-${seq}`,
      competition_canonical_id: comp,
      kickoff_utc: kickoff,
      scheduled_cutoff_utc: CUTOFF,
      decision_at_utc: DECISION,
      model_version: "quant-package-v1",
      package: {
        trigger: "slate",
        gate_status: "calibrated",
        payload: {
          kind: "quant-package",
          version: 1,
          legs: [{ market: "1x2", selection: "1", model_prob: 0.8, effective_prob: 0.8 }],
        },
      },
      legs: [
        {
          market: "1x2",
          selection: "1",
          model_prob: 0.8,
          effective_prob: 0.8,
          effective_source: "lab-band",
          grade: "A",
          gate_status: "calibrated",
        },
      ],
    };
    const r = pub.publishPicks(input, {
      now: () => PUBLISH_NOW,
      fixture_state: () => ({ status: scheduled(), kickoff_utc: input.kickoff_utc }),
    });
    if (r.status !== "published") {
      throw new Error(`publishOne gagal (seq ${seq}): ${r.status} ${r.reason ?? ""}`);
    }
    return r.pick_ids[0];
  };

  const ED = "slip-pr2";
  const mkSlip = (slot: string, pickIds: number[]): string => {
    const r = tickets.publishSlip({
      edition_key: ED,
      slot,
      series: "live-run",
      published_utc: PUBLISH_NOW,
      pick_ids: pickIds,
    });
    if (r.status !== "published" || !r.slip_uid) {
      throw new Error(`publishSlip ${slot} gagal: ${r.status}`);
    }
    return r.slip_uid;
  };

  // U — tanpa-feed, jatuh tempo, belum dinilai → unresolvable.
  mkSlip("u", [publishOne(DUE, "liga_tanpa_feed")]);
  // P1 — berfeed, jatuh tempo → pending (utang settlement biasa).
  mkSlip("p1", [publishOne(DUE, "liga_berfeed")]);
  // P2 — tanpa-feed, belum jatuh tempo → pending.
  mkSlip("p2", [publishOne(FUTURE, "liga_tanpa_feed")]);
  // P3 — kompetisi asing (tidak dikenal registri) → pending.
  mkSlip("p3", [publishOne(DUE, "liga_asing")]);
  // P4 — baris warisan: competition_canonical_id NULL → pending.
  const p4pick = publishOne(DUE, "liga_berfeed");
  ledger
    .getPicksDb()
    .prepare("UPDATE picks SET competition_canonical_id = NULL WHERE id = ?")
    .run(p4pick);
  mkSlip("p4", [p4pick]);
  // H — selesai hit.
  const hPick = publishOne(DUE, "liga_berfeed");
  mkSlip("h", [hPick]);
  ledger.recordOutcome(hPick, 2, 0);
  // M — satu anggota miss, satu anggota tanpa-feed menggantung:
  // vonis akhir tidak akan pernah bisa dihitung → unresolvable.
  const mMiss = publishOne(DUE, "liga_berfeed");
  const mStuck = publishOne(DUE, "liga_tanpa_feed");
  mkSlip("m", [mMiss, mStuck]);
  ledger.recordOutcome(mMiss, 0, 2);

  const stats = tickets.slipRecordStats({ edition_key: ED });
  suite.eq("stats: 7 tiket", stats.slips, 7);
  suite.eq("stats: hit 1", stats.hit, 1);
  suite.eq("stats: miss 0 (M belum terminal)", stats.miss, 0);
  suite.eq("stats: void 0", stats.void, 0);
  suite.eq("stats: pending 4 (P1,P2,P3,P4)", stats.pending, 4);
  suite.eq("stats: unresolvable 2 (U,M)", stats.unresolvable, 2);
  suite.eq(
    "rekonsiliasi: slips = hit+miss+void+pending+unresolvable",
    stats.hit + stats.miss + stats.void + stats.pending + stats.unresolvable,
    stats.slips,
  );
  suite.eq("stats: finished hanya terminal", stats.finished, 1);

  // Konsistensi dengan /bukti: cohort pada kompetisi tanpa-feed yang sama.
  const nowIso = new Date().toISOString();
  const cTf = cohort.cohortStats({
    now_utc: nowIso,
    filter: { competition_canonical_id: "liga_tanpa_feed" },
  });
  suite.eq("cohort tanpa-feed: issued 3", cTf.issued, 3);
  suite.eq("cohort tanpa-feed: unresolvable 2 (U + anggota M)", cTf.unresolvable, 2);
  const cBf = cohort.cohortStats({
    now_utc: nowIso,
    filter: { competition_canonical_id: "liga_berfeed" },
  });
  suite.eq("cohort berfeed: unresolvable 0", cBf.unresolvable, 0);

  // Tiket U tampil berstatus pending di view (status turunan tidak
  // diubah — klasifikasi hanya di lapisan statistik, sama seperti
  // cohort tidak mengubah baris pick).
  const views = tickets.listOfficialSlips({ edition_key: ED });
  suite.eq(
    "view: semua tiket non-hit tetap pending (klasifikasi di statistik saja)",
    views.filter((v) => v.state === "pending").length,
    6,
  );

  settleFixtureEnv(env, suite.failedCount > 0);
  suite.finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
