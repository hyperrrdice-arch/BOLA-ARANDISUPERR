/**
 * SUITE TIKET RESMI — D09 + Q01/Q04 relevan (PRD bab QA, kartu K3).
 *
 * Semua skenario lewat jalur produksi sebenarnya (publishPicks K2 →
 * publishSlip / getOfficialSlip / slipRecordStats K3 → recordOutcome /
 * markPickVoid ledger) dengan jam terinjeksi:
 *   D09 satu tiket per slot/edisi, status final-tertunda, koreksi
 *       mengubah vonis tanpa mengubah komposisi, tiket tak menyentuh
 *       statistik pilihan;
 *   Q04 alias 80% dihitung satu kali, dua laga 80%×70% = 56% dengan
 *       asumsi independensi, satu laga tanpa matriks → joint_unavailable;
 *   Q01 irisan matriks (1 ∩ 1X = 0,47; 1 ∩ 2 = 0), irisan U03 51% dan
 *       dua laga 35,2%, probabilitas tersimpan apa adanya.
 */
import fs from "node:fs";
import path from "node:path";
import {
  REPO_ROOT,
  Suite,
  buildCoreSchemas,
  createFixtureEnv,
  openRo,
  settleFixtureEnv,
} from "./helpers/fixture-env";

const ACCEPTANCE = JSON.parse(
  fs.readFileSync(
    path.join(
      REPO_ROOT,
      "docs/plans/peningkatan-aplikasi-bola/fixtures/acceptance.json",
    ),
    "utf8",
  ),
) as {
  interface_demo: { score_cells_percent: [number, number, number][] };
  ticket_settlement: { vectors: { legs: string[]; expected: string }[] };
};

const suite = new Suite("tickets D09/Q01/Q04");

const PUBLISH_NOW = "2026-11-20T10:40:00.000Z";
const DECISION = "2026-11-20T10:30:00.000Z";
const CUTOFF = "2026-11-20T10:00:00.000Z";
const KO = "2026-11-21T13:00:00.000Z";

function approx(name: string, actual: number | null, expected: number, tol = 1e-9): void {
  suite.check(
    name,
    actual !== null && Math.abs(actual - expected) < tol,
    `aktual=${actual} harapan=${expected}`,
  );
}

async function main(): Promise<void> {
  const env = createFixtureEnv("tix");
  process.chdir(env.root);
  const { ledger } = await buildCoreSchemas();
  const pub = await import("../lib/picks/publication");
  const tickets = await import("../lib/picks/tickets");
  const cohort = await import("../lib/picks/cohort");
  const resolver = await import("../lib/identity/fixture-resolver");
  const dataset = await import("../lib/db/thestats-dataset");

  const scheduled = () => "scheduled";
  let seq = 0;

  interface LegSpec {
    market: import("../lib/picks/publication").PublishLegInput["market"];
    selection: string;
    eff: number;
  }
  /** Terbitkan pilihan resmi lewat jalur K2; kembalikan id pick per leg. */
  const publishLegs = (
    fixtureUid: string,
    kickoff: string,
    legs: LegSpec[],
    opts: { matrix?: number[][] | null; comp?: string } = {},
  ): number[] => {
    seq++;
    const input: import("../lib/picks/publication").PublishFixtureInput = {
      series: "live-run",
      source_match_id: `fx_t${seq}`,
      fixture_uid: fixtureUid,
      competition_canonical_id: opts.comp ?? "eng-premier",
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
          ...(opts.matrix ? { score_matrix: opts.matrix } : {}),
          legs: legs.map((l) => ({
            market: l.market,
            selection: l.selection,
            model_prob: l.eff,
            effective_prob: l.eff,
          })),
        },
      },
      legs: legs.map((l) => ({
        market: l.market,
        selection: l.selection,
        model_prob: l.eff,
        effective_prob: l.eff,
        effective_source: "lab-band",
        grade: "A",
        gate_status: "calibrated",
      })),
    };
    const r = pub.publishPicks(input, {
      now: () => PUBLISH_NOW,
      fixture_state: () => ({ status: scheduled(), kickoff_utc: input.kickoff_utc }),
    });
    if (r.status !== "published") {
      throw new Error(`publishLegs gagal untuk ${fixtureUid}: ${r.status} ${r.reason ?? ""}`);
    }
    return r.pick_ids;
  };
  const publishOne = (
    fixtureUid: string,
    kickoff: string,
    leg: LegSpec,
    opts: { matrix?: number[][] | null; comp?: string } = {},
  ): number => publishLegs(fixtureUid, kickoff, [leg], opts)[0];

  const slipsCount = (): number =>
    (
      openRo(env, "picks.db")
        .prepare("SELECT COUNT(*) AS n FROM published_slips")
        .get() as { n: number }
    ).n;

  // ======================================================================
  console.log("\n— Q04: alias ganda 80% dihitung SATU kali —");
  // ======================================================================
  {
    const p1 = publishOne("uid-a1", KO, { market: "1x2", selection: "1", eff: 0.8 });
    const r = tickets.publishSlip({
      edition_key: "q04",
      slot: "alias",
      series: "live-run",
      published_utc: PUBLISH_NOW,
      pick_ids: [p1, p1],
    });
    suite.eq("Q04 alias: tiket terbit", r.status, "published");
    const view = tickets.getOfficialSlip(r.slip_uid!);
    suite.eq("Q04 alias: tepat 1 leg efektif", view?.legs.length, 1);
    approx("Q04 alias: gabungan tetap 0.8", view?.combined_prob ?? null, 0.8);
    suite.eq(
      "Q04 alias: duplikat tercatat sebagai alias_duplicate",
      view?.combined_detail?.dropped_duplicates.length,
      1,
    );
    suite.eq("Q04 alias: frozen_prob tersimpan apa adanya", view?.legs[0].frozen_prob, 0.8);
  }

  // ======================================================================
  console.log("\n— Q04: dua laga berbeda 80% × 70% = 56% (independensi) —");
  // ======================================================================
  {
    const p2 = publishOne("uid-b1", KO, { market: "1x2", selection: "1", eff: 0.8 });
    const p3 = publishOne("uid-b2", KO, { market: "1x2", selection: "1", eff: 0.7 });
    const r = tickets.publishSlip({
      edition_key: "q04",
      slot: "distinct",
      series: "live-run",
      published_utc: PUBLISH_NOW,
      pick_ids: [p2, p3],
    });
    const view = tickets.getOfficialSlip(r.slip_uid!);
    approx("Q04 distinct: gabungan 0.56", view?.combined_prob ?? null, 0.56);
    suite.eq("Q04 distinct: basis independence", view?.combined_basis, "independence");
    approx("Q04 distinct: low = 0.56", view?.combined_low ?? null, 0.56);
    approx("Q04 distinct: high = 0.56", view?.combined_high ?? null, 0.56);
    suite.check(
      "Q01 distinct: gabungan sah [0,1] dan finite",
      view !== null &&
        Number.isFinite(view.combined_prob) &&
        view.combined_prob! >= 0 &&
        view.combined_prob! <= 1,
    );
  }

  // ======================================================================
  console.log("\n— Q01: irisan matriks satu laga (1∩1X = 0,47; 1∩2 = 0) —");
  // ======================================================================
  const Q01_MATRIX = [
    [0.1, 0.08, 0.02],
    [0.12, 0.1, 0.03],
    [0.2, 0.15, 0.2],
  ];
  {
    const [c1, c2] = publishLegs(
      "uid-c1",
      KO,
      [
        { market: "1x2", selection: "1", eff: 0.47 },
        { market: "dc", selection: "1x", eff: 0.87 },
      ],
      { matrix: Q01_MATRIX },
    );
    const r = tickets.publishSlip({
      edition_key: "q01",
      slot: "intersection",
      series: "live-run",
      published_utc: PUBLISH_NOW,
      pick_ids: [c1, c2],
    });
    const view = tickets.getOfficialSlip(r.slip_uid!);
    approx("Q01 irisan 1∩1X = 0.47", view?.combined_prob ?? null, 0.47, 1e-8);
    suite.eq("Q01 irisan: basis matrix_intersection", view?.combined_basis, "matrix_intersection");

    const [c3, c4] = publishLegs(
      "uid-c2",
      KO,
      [
        { market: "1x2", selection: "1", eff: 0.47 },
        { market: "1x2", selection: "2", eff: 0.13 },
      ],
      { matrix: Q01_MATRIX },
    );
    const r2 = tickets.publishSlip({
      edition_key: "q01",
      slot: "exclusive",
      series: "live-run",
      published_utc: PUBLISH_NOW,
      pick_ids: [c3, c4],
    });
    const view2 = tickets.getOfficialSlip(r2.slip_uid!);
    approx("Q01 irisan 1∩2 = 0 (saling meniadakan)", view2?.combined_prob ?? null, 0, 1e-8);
  }

  // ======================================================================
  console.log("\n— K3/U03: irisan 51% dan dua laga 35,2% —");
  // ======================================================================
  {
    const demo = ACCEPTANCE;
    const size = 4;
    const matrix: number[][] = Array.from({ length: size }, () =>
      Array.from({ length: size }, () => 0),
    );
    for (const [h, a, pct] of demo.interface_demo.score_cells_percent) {
      matrix[h][a] = pct / 100;
    }
    const [d1, d2] = publishLegs(
      "uid-d1",
      KO,
      [
        { market: "dc", selection: "1x", eff: 0.75 },
        { market: "ou15", selection: "over", eff: 0.68 },
      ],
      { matrix },
    );
    const r1 = tickets.publishSlip({
      edition_key: "u03",
      slot: "joint",
      series: "live-run",
      published_utc: PUBLISH_NOW,
      pick_ids: [d1, d2],
    });
    approx(
      "U03 irisan 1X∩O1.5 = 0.51",
      tickets.getOfficialSlip(r1.slip_uid!)?.combined_prob ?? null,
      0.51,
    );
    const d3 = publishOne("uid-d2", KO, { market: "dc", selection: "1x", eff: 0.69 });
    const r2 = tickets.publishSlip({
      edition_key: "u03",
      slot: "two-fixture",
      series: "live-run",
      published_utc: PUBLISH_NOW,
      pick_ids: [d1, d2, d3],
    });
    approx(
      "U03 dua laga: 0.51 × 0.69 = 0.3519",
      tickets.getOfficialSlip(r2.slip_uid!)?.combined_prob ?? null,
      0.3519,
    );
  }

  // ======================================================================
  console.log("\n— Q04: satu laga tanpa matriks → joint_unavailable —");
  // ======================================================================
  {
    const [e1, e2] = publishLegs("uid-e1", KO, [
      { market: "1x2", selection: "1", eff: 0.5 },
      { market: "dc", selection: "1x", eff: 0.75 },
    ]);
    const r = tickets.publishSlip({
      edition_key: "q04",
      slot: "no-matrix",
      series: "live-run",
      published_utc: PUBLISH_NOW,
      pick_ids: [e1, e2],
    });
    suite.eq("Q04 tanpa matriks: tiket tetap terbit", r.status, "published");
    const view = tickets.getOfficialSlip(r.slip_uid!);
    suite.eq("Q04 tanpa matriks: combined NULL", view?.combined_prob, null);
    suite.eq("Q04 tanpa matriks: basis joint_unavailable", view?.combined_basis, "joint_unavailable");
    suite.eq("Q04 tanpa matriks: alasan joint_unavailable", view?.combined_reason, "joint_unavailable");
    suite.eq("Q04 tanpa matriks: 2 leg tersimpan", view?.legs.length, 2);
  }

  // ======================================================================
  console.log("\n— Ketergantungan: tim sama dua kali dalam ≤72 jam → rentang —");
  // ======================================================================
  {
    const dsDb = dataset.getTheStatsDb();
    resolver.ensureIdentitySchema(dsDb);
    const ins = dsDb.prepare(
      `INSERT OR REPLACE INTO canonical_fixtures
         (fixture_uid, competition_id, home_cid, away_cid, home_name, away_name,
          kickoff_utc, created_at, updated_at)
       VALUES (?, 'eng-premier', ?, ?, ?, ?, ?, '2026-11-20T09:00:00.000Z', '2026-11-20T09:00:00.000Z')`,
    );
    ins.run("uid-f1", "teamX", "teamY", "Team X", "Team Y", "2026-11-21T13:00:00.000Z");
    ins.run("uid-f2", "teamZ", "teamX", "Team Z", "Team X", "2026-11-22T13:00:00.000Z");
    ins.run("uid-f3", "teamX", "teamW", "Team X", "Team W", "2026-11-26T13:00:00.000Z");

    const pf1 = publishOne("uid-f1", "2026-11-21T13:00:00.000Z", {
      market: "1x2",
      selection: "1",
      eff: 0.8,
    });
    const pf2 = publishOne("uid-f2", "2026-11-22T13:00:00.000Z", {
      market: "1x2",
      selection: "1",
      eff: 0.7,
    });
    const r = tickets.publishSlip({
      edition_key: "dep",
      slot: "same-team",
      series: "live-run",
      published_utc: PUBLISH_NOW,
      pick_ids: [pf1, pf2],
    });
    const view = tickets.getOfficialSlip(r.slip_uid!);
    suite.eq("DEP: basis dependency_range", view?.combined_basis, "dependency_range");
    approx("DEP: skenario independensi 0.56", view?.combined_detail?.scenarios.independence ?? null, 0.56);
    approx("DEP: skenario gabungan penuh 0.7", view?.combined_detail?.scenarios.full_joint ?? null, 0.7);
    approx("DEP: low 0.56", view?.combined_low ?? null, 0.56);
    approx("DEP: high 0.7", view?.combined_high ?? null, 0.7);
    suite.eq(
      "DEP: kelompok same_team_window tertanda",
      view?.combined_detail?.groups.some((g) => g.kind === "same_team_window"),
      true,
    );
    suite.eq(
      "DEP: tim bersama = teamX",
      view?.combined_detail?.groups.find((g) => g.kind === "same_team_window")?.teams,
      ["teamX"],
    );
    suite.eq(
      "DEP: ketergantungan terkuat disorot",
      view?.combined_detail?.strongest_dependency?.kind,
      "same_team_window",
    );

    // Kontrol: laga ketiga berjarak >72 jam → tidak ada rentang.
    const pf3 = publishOne("uid-f3", "2026-11-26T13:00:00.000Z", {
      market: "1x2",
      selection: "1",
      eff: 0.6,
    });
    const rCtl = tickets.publishSlip({
      edition_key: "dep",
      slot: "far-apart",
      series: "live-run",
      published_utc: PUBLISH_NOW,
      pick_ids: [pf1, pf3],
    });
    const viewCtl = tickets.getOfficialSlip(rCtl.slip_uid!);
    suite.eq("DEP kontrol >72 jam: basis independence", viewCtl?.combined_basis, "independence");
    approx("DEP kontrol: gabungan 0.48", viewCtl?.combined_prob ?? null, 0.48);
  }

  // ======================================================================
  console.log("\n— D09: aturan penerbitan tiket resmi —");
  // ======================================================================
  let ticketA = "";
  {
    const g1 = publishOne("uid-g1", KO, { market: "1x2", selection: "1", eff: 0.8 });
    const g2 = publishOne("uid-g2", KO, { market: "dc", selection: "1x", eff: 0.75 });
    const before = slipsCount();
    const r = tickets.publishSlip({
      edition_key: "d09",
      slot: "utama",
      series: "live-run",
      published_utc: PUBLISH_NOW,
      pick_ids: [g1, g2],
    });
    suite.eq("D09 tiket A terbit", r.status, "published");
    ticketA = r.slip_uid!;
    suite.eq("D09 satu tiket resmi per slot/edisi", slipsCount(), before + 1);

    // Ulang edisi yang sama, anggota sama → idempoten.
    const rSame = tickets.publishSlip({
      edition_key: "d09",
      slot: "utama",
      series: "live-run",
      published_utc: PUBLISH_NOW,
      pick_ids: [g1, g2],
    });
    suite.eq("D09 ulang edisi sama: already_published", rSame.status, "already_published");
    suite.eq("D09 ulang edisi sama: slip_uid sama", rSame.slip_uid, ticketA);
    suite.eq("D09 ulang edisi sama: tetap 1 tiket", slipsCount(), before + 1);

    // Slot sama, anggota berbeda → ditolak (ganti anggota = tiket baru).
    const g3 = publishOne("uid-g3", KO, { market: "1x2", selection: "1", eff: 0.66 });
    const rDiff = tickets.publishSlip({
      edition_key: "d09",
      slot: "utama",
      series: "live-run",
      published_utc: PUBLISH_NOW,
      pick_ids: [g1, g3],
    });
    suite.eq("D09 slot sama anggota beda: rejected", rDiff.status, "rejected");
    suite.eq("D09 slot sama anggota beda: alasan slot_taken", rDiff.reason, "slot_taken");
    suite.eq("D09 slot_taken: tetap 1 tiket", slipsCount(), before + 1);

    // Anggota bukan pilihan resmi (baris lab tanpa pick_uid) → ditolak.
    const labId = ledger.recordPick({
      match_id: "fx_lab_d09",
      kickoff_utc: KO,
      market: "1x2",
      selection: "1",
      model_prob: 0.9,
      source: "lab",
    });
    const rLab = tickets.publishSlip({
      edition_key: "d09",
      slot: "lab-member",
      series: "live-run",
      published_utc: PUBLISH_NOW,
      pick_ids: [labId],
    });
    suite.eq("D09 anggota lab: rejected leg_not_official", rLab.reason, "leg_not_official");

    // Anggota yang kickoff-nya sudah lewat pada waktu terbit → ditolak.
    const late = publishOne("uid-g4", "2026-11-20T13:00:00.000Z", {
      market: "1x2",
      selection: "1",
      eff: 0.8,
    });
    const rLate = tickets.publishSlip({
      edition_key: "d09",
      slot: "late",
      series: "live-run",
      published_utc: "2026-11-20T13:30:00.000Z",
      pick_ids: [late],
    });
    suite.eq("D09 anggota lewat kickoff: rejected", rLate.reason, "leg_kickoff_reached");

    // Anggota tidak ada → ditolak.
    const rGhost = tickets.publishSlip({
      edition_key: "d09",
      slot: "ghost",
      series: "live-run",
      published_utc: PUBLISH_NOW,
      pick_ids: [999999],
    });
    suite.eq("D09 anggota hantu: rejected leg_not_found", rGhost.reason, "leg_not_found");
  }

  // ======================================================================
  console.log("\n— D09: vektor status dari acceptance.json (unit murni) —");
  // ======================================================================
  {
    for (const v of ACCEPTANCE.ticket_settlement.vectors) {
      suite.eq(
        `D09 vektor [${v.legs.join(",")}] → ${v.expected}`,
        tickets.slipStateOf(v.legs as import("../lib/picks/tickets").SlipLegState[]),
        v.expected,
      );
    }
  }

  // ======================================================================
  console.log("\n— D09: status turunan lewat resolver ledger sebenarnya —");
  // ======================================================================
  const vectorSlips: string[] = [];
  {
    const mk = async (
      slot: string,
      settle: (ids: number[]) => void,
    ): Promise<string> => {
      const a = publishOne(`uid-v-${slot}-a`, KO, { market: "1x2", selection: "1", eff: 0.8 });
      const b = publishOne(`uid-v-${slot}-b`, KO, { market: "1x2", selection: "1", eff: 0.7 });
      const r = tickets.publishSlip({
        edition_key: "d09-vectors",
        slot,
        series: "live-run",
        published_utc: PUBLISH_NOW,
        pick_ids: [a, b],
      });
      settle([a, b]);
      return r.slip_uid!;
    };
    const hit = (id: number) => ledger.recordOutcome(id, 2, 0);
    const miss = (id: number) => ledger.recordOutcome(id, 0, 2);
    const voided = (id: number) =>
      ledger.markPickVoid(id, {
        reason: "provider membatalkan laga (fixture D09)",
        policyVersion: resolver.SETTLEMENT_POLICY_VERSION,
      });

    vectorSlips.push(await mk("hh", ([a, b]) => { hit(a); hit(b); }));
    vectorSlips.push(await mk("hm", ([a, b]) => { hit(a); miss(b); }));
    vectorSlips.push(await mk("hv", ([a, b]) => { hit(a); voided(b); }));
    vectorSlips.push(await mk("mv", ([a, b]) => { miss(a); voided(b); }));
    vectorSlips.push(await mk("mp", ([a]) => { miss(a); }));

    const states = vectorSlips.map((s) => tickets.getOfficialSlip(s)?.state);
    suite.eq("D09 status berturut: hit, miss, void, miss, pending", states, [
      "hit",
      "miss",
      "void",
      "miss",
      "pending",
    ]);
    suite.eq(
      "D09 miss/pending: info 'sudah ada yang meleset' tampil",
      tickets.getOfficialSlip(vectorSlips[4])?.has_missed_leg,
      true,
    );
    suite.eq(
      "D09 tiket A (belum ada hasil): pending",
      tickets.getOfficialSlip(ticketA)?.state,
      "pending",
    );

    // Tepat per tiket atas edisi vektor (sebelum koreksi).
    const stats = tickets.slipRecordStats({ edition_key: "d09-vectors" });
    suite.eq("D09 stats: 5 tiket", stats.slips, 5);
    suite.eq("D09 stats: selesai 4", stats.finished, 4);
    suite.eq("D09 stats: hit 1", stats.hit, 1);
    suite.eq("D09 stats: miss 2", stats.miss, 2);
    suite.eq("D09 stats: void 1", stats.void, 1);
    suite.eq("D09 stats: pending 1", stats.pending, 1);
    approx("D09 stats: tepat per tiket 1/3", stats.hit_ratio, 1 / 3);
    suite.eq("D09 stats: 10 pertandingan unik", stats.unique_fixtures, 10);
    suite.eq("D09 stats: 10 leg", stats.total_legs, 10);
  }

  // ======================================================================
  console.log("\n— D09: koreksi hasil mengubah vonis; komposisi tetap —");
  // ======================================================================
  {
    const beforeView = tickets.getOfficialSlip(vectorSlips[0])!;
    suite.eq("D09 koreksi: status awal hit", beforeView.state, "hit");
    const leg0 = beforeView.legs[0];
    // Koreksi resmi: skor leg pertama dibalik (recordOutcome = upsert
    // versi terbaru, jalur yang sama dengan resolver K1).
    ledger.recordOutcome(leg0.pick_id, 0, 3);
    const afterView = tickets.getOfficialSlip(vectorSlips[0])!;
    suite.eq("D09 koreksi: status berubah ke miss", afterView.state, "miss");
    suite.eq(
      "D09 koreksi: komposisi leg tetap",
      afterView.legs.map((l) => l.pick_uid),
      beforeView.legs.map((l) => l.pick_uid),
    );
    suite.eq(
      "D09 koreksi: combined_prob tetap",
      afterView.combined_prob,
      beforeView.combined_prob,
    );
    suite.eq(
      "D09 koreksi: frozen_prob tetap",
      afterView.legs.map((l) => l.frozen_prob),
      beforeView.legs.map((l) => l.frozen_prob),
    );
    const stats = tickets.slipRecordStats({ edition_key: "d09-vectors" });
    suite.eq("D09 koreksi: stats hit turun ke 0", stats.hit, 0);
    approx("D09 koreksi: tepat per tiket 0/3", stats.hit_ratio, 0);
  }

  // ======================================================================
  console.log("\n— D09: hasil tiket TIDAK mengubah statistik pilihan —");
  // ======================================================================
  {
    const isoComp = "d09-isolated";
    const i1 = publishOne("uid-i1", KO, { market: "1x2", selection: "1", eff: 0.8 }, { comp: isoComp });
    const i2 = publishOne("uid-i2", KO, { market: "dc", selection: "1x", eff: 0.75 }, { comp: isoComp });
    ledger.recordOutcome(i1, 2, 0);
    ledger.recordOutcome(i2, 0, 1);
    const before = cohort.cohortStats({
      now_utc: "2026-11-22T00:00:00.000Z",
      filter: { competition_canonical_id: isoComp },
    });
    suite.eq("D09 isolasi: cohort 2 dinilai", before.settled, 2);
    const r = tickets.publishSlip({
      edition_key: "d09-iso",
      slot: "iso",
      series: "live-run",
      published_utc: PUBLISH_NOW,
      pick_ids: [i1, i2],
    });
    suite.eq("D09 isolasi: tiket terbit", r.status, "published");
    const after = cohort.cohortStats({
      now_utc: "2026-11-22T00:00:00.000Z",
      filter: { competition_canonical_id: isoComp },
    });
    suite.eq(
      "D09 isolasi: cohort identik sesudah tiket ada",
      JSON.stringify(after),
      JSON.stringify(before),
    );
    suite.eq(
      "D09 isolasi: status tiket terbaca dari hasil leg",
      tickets.getOfficialSlip(r.slip_uid!)?.state,
      "miss",
    );
  }

  settleFixtureEnv(env, suite.failedCount > 0);
  suite.finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
