/**
 * SUITE FIX-4 (Item 23, Sprint C) — kebijakan slot tiket resmi harian.
 *
 * Keputusan pemilik 25 Nov 2026 yang diverifikasi di sini:
 *  - tepat 4 pilihan per tiket, maks 1 tiket/hari, cutoff 14:00 WIB;
 *  - published_prob >= 0,72 per pilihan; WAJIB ABSTAIN bila layak < 4;
 *  - maks 1 pilihan per laga (fixture dengan 2 pick resmi → 1 terpilih,
 *    yang probabilitasnya tertinggi);
 *  - hanya kompetisi berfeed (klasifikasi PR 2) — pick 0,95 di kompetisi
 *    tanpa feed TIDAK dihitung;
 *  - jendela (cutoff, cutoff+24j]: laga sebelum cutoff dan sesudah
 *    jendela tidak masuk; ranking published_prob desc, match_id asc;
 *  - snapshot append-only: generate ulang tanggal sama → keputusan sama,
 *    tidak ada baris baru;
 *  - settlement tiket utuh WIN / LOSS / VOID_OR_UNRESOLVABLE + metrik
 *    pembuktian (hit-rate, expected, abstain_days, coverage, Wilson 95%);
 *  - regresi kembar fd_ vs sm_ (pasca tiket pertama 25 Nov 2026): pick
 *    termarking duplicate_of tidak pernah terpilih, dan dua pick tak
 *    termarking dari match_id kembar tertaut hanya menyumbang 1 pilihan.
 *
 * Pola sandbox sama dengan test-slip-stats-pr2.ts (fixture-env K0):
 * registri mini ditulis ke sandbox — liga_berfeed (legacy-div E0) dan
 * liga_tanpa_feed (alias sm saja). Semua pick diterbitkan via publishPicks
 * asli dengan jam terbit 2026-11-25T02:00Z (sebelum semua cutoff Fix-4).
 */
import fs from "node:fs";
import path from "node:path";
import {
  Suite,
  buildCoreSchemas,
  createFixtureEnv,
  settleFixtureEnv,
} from "./helpers/fixture-env";

const suite = new Suite("fix4 (Item 23)");

const PUBLISH_NOW = "2026-11-25T02:00:00.000Z";
const PUB_CUTOFF = "2026-11-25T00:00:00.000Z";
const PUB_DECISION = "2026-11-25T01:00:00.000Z";
const NOW_LATE = "2026-12-05T00:00:00.000Z";

interface LegSpec {
  market: import("../lib/picks/ledger").PickMarket;
  selection: string;
  prob: number;
}

async function main(): Promise<void> {
  const env = createFixtureEnv("fix4");
  process.chdir(env.root);
  const { ledger } = await buildCoreSchemas();
  const pub = await import("../lib/picks/publication");
  const fix4 = await import("../lib/picks/fix4-tickets");
  const policy = await import("../lib/picks/fix4-policy");

  fs.writeFileSync(
    path.join(env.dataDir, "league-canonical.json"),
    JSON.stringify({
      version: 1,
      generated_at: "2026-11-25T00:00:00.000Z",
      generator: "tests/test-fix4.ts (fixture Sprint C)",
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

  // --- Unit kebijakan murni -------------------------------------------------
  const w = policy.fix4WindowForDate("2026-11-26");
  suite.eq("policy: decision_ts = 14:00 WIB = 07:00 UTC", w.decision_ts_utc, "2026-11-26T07:00:00.000Z");
  suite.eq("policy: window end = cutoff + 24j", w.window_end_utc, "2026-11-27T07:00:00.000Z");
  suite.eq("policy: tanggal WIB dari 17:30 UTC = besok", policy.fix4DateWibOf("2026-11-26T17:30:00.000Z"), "2026-11-27");
  suite.eq("policy: ukuran tiket 4", policy.FIX4_TICKET_SIZE, 4);
  suite.eq("policy: ambang 0,72", policy.FIX4_MIN_PUBLISHED_PROB, 0.72);
  suite.eq("wilson: n=0 → null", fix4.wilsonInterval95(0, 0), null);
  const wci = fix4.wilsonInterval95(5, 10);
  suite.check("wilson: CI 5/10 memuat 0,5 dan di dalam [0,1]",
    wci !== null && wci.low < 0.5 && wci.high > 0.5 && wci.low >= 0 && wci.high <= 1);

  // --- Penerbit pick resmi ---------------------------------------------------
  let seq = 0;
  const publishFixture = (
    matchId: string,
    kickoff: string,
    comp: string,
    legs: LegSpec[],
  ): number[] => {
    seq++;
    const input: import("../lib/picks/publication").PublishFixtureInput = {
      series: "live-run",
      source_match_id: matchId,
      fixture_uid: `uid-fx4-${seq}`,
      competition_canonical_id: comp,
      kickoff_utc: kickoff,
      scheduled_cutoff_utc: PUB_CUTOFF,
      decision_at_utc: PUB_DECISION,
      model_version: "quant-package-v1",
      package: {
        trigger: "slate",
        gate_status: "calibrated",
        payload: {
          kind: "quant-package",
          version: 1,
          legs: legs.map((l) => ({
            market: l.market,
            selection: l.selection,
            model_prob: l.prob,
            effective_prob: l.prob,
          })),
        },
      },
      legs: legs.map((l) => ({
        market: l.market,
        selection: l.selection,
        model_prob: l.prob,
        effective_prob: l.prob,
        effective_source: "lab-band",
        grade: "A",
        gate_status: "calibrated",
      })),
    };
    const r = pub.publishPicks(input, {
      now: () => PUBLISH_NOW,
      fixture_state: () => ({ status: "scheduled", kickoff_utc: kickoff }),
    });
    if (r.status !== "published") {
      throw new Error(`publishFixture ${matchId} gagal: ${r.status} ${r.reason ?? ""}`);
    }
    return r.pick_ids;
  };
  const L1 = (prob: number): LegSpec[] => [{ market: "1x2", selection: "1", prob }];

  // --- Tanggal D = 2026-11-26: jendela (26T07:00Z, 27T07:00Z] ---------------
  const pickA = publishFixture("fx_a", "2026-11-26T13:00:00.000Z", "liga_berfeed", L1(0.9))[0];
  const pickB = publishFixture("fx_b", "2026-11-26T14:00:00.000Z", "liga_berfeed", L1(0.85))[0];
  const picksC = publishFixture("fx_c", "2026-11-26T15:00:00.000Z", "liga_berfeed", [
    { market: "1x2", selection: "1", prob: 0.8 },
    { market: "dc", selection: "1x", prob: 0.88 },
  ]);
  publishFixture("fx_d", "2026-11-26T16:00:00.000Z", "liga_berfeed", L1(0.75));
  publishFixture("fx_e", "2026-11-26T17:00:00.000Z", "liga_berfeed", L1(0.71)); // di bawah ambang
  publishFixture("fx_f", "2026-11-26T18:00:00.000Z", "liga_tanpa_feed", L1(0.95)); // tanpa feed
  publishFixture("fx_g", "2026-11-26T06:00:00.000Z", "liga_berfeed", L1(0.99)); // sebelum cutoff
  const pickH = publishFixture("fx_h", "2026-11-27T06:30:00.000Z", "liga_berfeed", L1(0.84))[0];
  publishFixture("fx_i", "2026-11-27T08:00:00.000Z", "liga_berfeed", L1(0.99)); // sesudah jendela

  const db = ledger.getPicksDb();
  const decD = fix4.generateFix4Ticket(db, "2026-11-26", PUBLISH_NOW);
  suite.eq("D: status PUBLISHED", decD.status, "PUBLISHED");
  suite.eq("D: kandidat layak = 5 (A, B, C, D, H)", decD.eligible_count, 5);
  suite.eq(
    "D: 4 pilihan teratas berurutan A, C, B, H",
    decD.legs.map((l) => l.match_id),
    ["fx_a", "fx_c", "fx_b", "fx_h"],
  );
  suite.eq("D: laga C hanya 1 pilihan — yang 0,88 (dc)", decD.legs[1].pick_id, picksC[1]);
  suite.check(
    "D: expected = 0,90×0,88×0,85×0,84",
    Math.abs((decD.expected_hit_prob ?? 0) - 0.9 * 0.88 * 0.85 * 0.84) < 1e-12,
  );
  suite.check("D: pick A/B/H sesuai terbitan",
    decD.legs[0].pick_id === pickA && decD.legs[2].pick_id === pickB && decD.legs[3].pick_id === pickH);

  // Append-only: generate ulang → keputusan sama, tanpa baris baru.
  const decD2 = fix4.generateFix4Ticket(db, "2026-11-26", NOW_LATE);
  suite.check("D: generate ulang → already_existed", decD2.already_existed === true);
  suite.eq("D: ticket_uid sama", decD2.ticket_uid, decD.ticket_uid);
  const nLegs = (db.prepare("SELECT COUNT(*) AS n FROM fix4_ticket_legs").get() as { n: number }).n;
  suite.eq("D: total baris legs tetap 4", nLegs, 4);

  // --- Tanggal D2 = 2026-11-28: tie-break match_id asc -----------------------
  publishFixture("fx_t2", "2026-11-28T13:00:00.000Z", "liga_berfeed", L1(0.8));
  publishFixture("fx_t1", "2026-11-28T14:00:00.000Z", "liga_berfeed", L1(0.8));
  const d2top = publishFixture("fx_u1", "2026-11-28T15:00:00.000Z", "liga_berfeed", L1(0.9));
  const d2mid = publishFixture("fx_u2", "2026-11-28T16:00:00.000Z", "liga_berfeed", L1(0.85));
  const decD2x = fix4.generateFix4Ticket(db, "2026-11-28", PUBLISH_NOW);
  suite.eq(
    "D2: seri 0,80 → tie-break match_id asc (fx_t1 sebelum fx_t2)",
    decD2x.legs.map((l) => l.match_id),
    ["fx_u1", "fx_u2", "fx_t1", "fx_t2"],
  );

  // --- Tanggal D3 = 2026-11-30: ABSTAIN wajib --------------------------------
  publishFixture("fx_v1", "2026-11-30T13:00:00.000Z", "liga_berfeed", L1(0.9));
  publishFixture("fx_v2", "2026-11-30T14:00:00.000Z", "liga_berfeed", L1(0.85));
  publishFixture("fx_v3", "2026-11-30T15:00:00.000Z", "liga_berfeed", L1(0.8));
  publishFixture("fx_v4", "2026-11-30T16:00:00.000Z", "liga_tanpa_feed", L1(0.99));
  const decD3 = fix4.generateFix4Ticket(db, "2026-11-30", PUBLISH_NOW);
  suite.eq("D3: hanya 3 layak → ABSTAIN", decD3.status, "ABSTAIN");
  suite.eq("D3: eligible_count = 3", decD3.eligible_count, 3);
  suite.check("D3: alasan tercatat memuat jumlah kandidat",
    (decD3.reason ?? "").includes("kandidat layak 3"));
  const nTicketD3 = (db.prepare(
    "SELECT COUNT(*) AS n FROM fix4_tickets WHERE date_wib = '2026-11-30'",
  ).get() as { n: number }).n;
  suite.eq("D3: tidak ada tiket parsial terbit", nTicketD3, 0);

  // --- Tanggal D4 = 2026-12-02: tiket untuk kasus VOID ------------------------
  const d4picks = [
    publishFixture("fx_w1", "2026-12-02T13:00:00.000Z", "liga_berfeed", L1(0.9))[0],
    publishFixture("fx_w2", "2026-12-02T14:00:00.000Z", "liga_berfeed", L1(0.88))[0],
    publishFixture("fx_w3", "2026-12-02T15:00:00.000Z", "liga_berfeed", L1(0.86))[0],
    publishFixture("fx_w4", "2026-12-02T16:00:00.000Z", "liga_berfeed", L1(0.84))[0],
  ];
  const decD4 = fix4.generateFix4Ticket(db, "2026-12-02", PUBLISH_NOW);
  suite.eq("D4: PUBLISHED", decD4.status, "PUBLISHED");

  // --- Settlement -------------------------------------------------------------
  // D → LOSS: A hit, C(dc 1x) hit, B miss, H belum dinilai.
  ledger.recordOutcome(pickA, 2, 0);
  ledger.recordOutcome(picksC[1], 2, 0);
  ledger.recordOutcome(pickB, 0, 2);
  const stD = fix4.fix4TicketStatus(db, decD.ticket_uid!, NOW_LATE);
  suite.eq("D: 1 miss → LOSS", stD?.status, "LOSS");
  suite.eq("D: leg states hit,hit,miss,pending", stD?.leg_states, ["hit", "hit", "miss", "pending"]);

  // D2 → WIN: keempatnya menang kandang.
  for (const pid of [...d2top, ...d2mid]) ledger.recordOutcome(pid, 1, 0);
  const d2legPickIds = (db.prepare(
    "SELECT pick_id FROM fix4_ticket_legs WHERE ticket_uid = ? ORDER BY position",
  ).all(decD2x.ticket_uid) as { pick_id: number }[]).map((r) => r.pick_id);
  for (const pid of d2legPickIds) {
    const has = db.prepare("SELECT pick_id FROM pick_outcomes WHERE pick_id = ?").get(pid);
    if (!has) ledger.recordOutcome(pid, 3, 1);
  }
  const stD2 = fix4.fix4TicketStatus(db, decD2x.ticket_uid!, NOW_LATE);
  suite.eq("D2: 4/4 hit → WIN", stD2?.status, "WIN");

  // D4 → VOID_OR_UNRESOLVABLE: 3 hit + 1 void.
  ledger.recordOutcome(d4picks[0], 2, 0);
  ledger.recordOutcome(d4picks[1], 2, 0);
  ledger.recordOutcome(d4picks[2], 2, 0);
  db.prepare(
    "INSERT INTO pick_voids (pick_id, fixture_uid, voided_utc, reason, policy_version) VALUES (?, ?, ?, ?, ?)",
  ).run(d4picks[3], "uid-fx4-void", NOW_LATE, "laga dibatalkan (fixture uji)", "test");
  const stD4 = fix4.fix4TicketStatus(db, decD4.ticket_uid!, NOW_LATE);
  suite.eq("D4: 3 hit + 1 void → VOID_OR_UNRESOLVABLE", stD4?.status, "VOID_OR_UNRESOLVABLE");

  // --- Metrik pembuktian -------------------------------------------------------
  const m = fix4.fix4ProofMetrics(db, {}, NOW_LATE);
  suite.eq("metrik: ticket_count (WIN+LOSS) = 2", m.ticket_count, 2);
  suite.eq("metrik: wins 1, losses 1", [m.wins, m.losses], [1, 1]);
  suite.eq("metrik: ticket_hit_rate = 0,5", m.ticket_hit_rate, 0.5);
  suite.check("metrik: Wilson CI memuat 0,5",
    m.ticket_hit_rate_ci95 !== null && m.ticket_hit_rate_ci95.low < 0.5 && m.ticket_hit_rate_ci95.high > 0.5);
  const expD = 0.9 * 0.88 * 0.85 * 0.84;
  const expD2 = 0.9 * 0.85 * 0.8 * 0.8;
  suite.check("metrik: expected_hit_rate = rerata expected tiket terminal",
    Math.abs((m.expected_hit_rate ?? 0) - (expD + expD2) / 2) < 1e-12);
  suite.eq("metrik: void_or_unresolvable = 1", m.void_or_unresolvable, 1);
  suite.eq("metrik: abstain_days = 1", m.abstain_days, 1);
  suite.eq("metrik: published_days = 3", m.published_days, 3);
  suite.eq("metrik: coverage = 3/4", m.coverage, 0.75);

  // --- Regresi kembar fd_ vs sm_ (perbaikan pasca tiket pertama 25 Nov) -----
  // Produksi: tiket fx4_74f7455229fa1abb0164f623 memuat Boreham Wood–
  // Aldershot dua kali — pick fd_ termarking duplicate_of → pick sm_
  // kembarnya, seleksi (dc/1x) dan published_prob (0,8910) identik, dan
  // generator lama tidak menyaring duplicate_of sama sekali; aturan
  // 1-per-laga per match_id tidak menolong karena match_id-nya beda.
  // Dua pertahanan yang diuji di sini:
  //   D5: pick termarking TIDAK PERNAH terpilih (saringan duplicate_of).
  //   D6: dua pick TAK termarking dari dua match_id kembar TERTAUT
  //       (fixture-links) tetap hanya satu yang masuk (kunci fixture
  //       kanonik) — yang probabilitasnya tertinggi mewakili laga fisik.
  fs.writeFileSync(
    path.join(env.dataDir, "fixture-links.json"),
    JSON.stringify({
      links: [
        { twin_id: "fd_9101", canonical_id: "sm_9101" },
        { twin_id: "fd_9102", canonical_id: "sm_9102" },
      ],
    }),
  );
  const DC1X = (prob: number): LegSpec[] => [{ market: "dc", selection: "1x", prob }];

  // D5 = 2026-12-04: kembar termarking (reproduksi kasus produksi).
  const d5sm = publishFixture("sm_9101", "2026-12-04T13:00:00.000Z", "liga_berfeed", DC1X(0.891))[0];
  const d5fd = publishFixture("fd_9101", "2026-12-04T13:00:00.000Z", "liga_berfeed", DC1X(0.891))[0];
  db.prepare("UPDATE picks SET duplicate_of = ? WHERE id = ?").run(d5sm, d5fd);
  publishFixture("fx_m1", "2026-12-04T14:00:00.000Z", "liga_berfeed", L1(0.85));
  publishFixture("fx_m2", "2026-12-04T15:00:00.000Z", "liga_berfeed", L1(0.83));
  publishFixture("fx_m3", "2026-12-04T16:00:00.000Z", "liga_berfeed", L1(0.8));
  const candD5 = fix4.selectFix4Candidates(db, "2026-12-04");
  suite.check("D5: pick fd_ termarking tidak pernah jadi kandidat",
    !candD5.some((c) => c.pick_id === d5fd));
  suite.eq("D5: pasangan kembar menyumbang tepat 1 kandidat (sisi sm_)",
    candD5.filter((c) => c.match_id === "sm_9101" || c.match_id === "fd_9101").map((c) => c.pick_id),
    [d5sm]);
  suite.eq("D5: total kandidat layak = 4", candD5.length, 4);
  const decD5 = fix4.generateFix4Ticket(db, "2026-12-04", PUBLISH_NOW);
  suite.eq("D5: status PUBLISHED", decD5.status, "PUBLISHED");
  suite.check("D5: tiket memuat pick sm_ dan BUKAN pick fd_ termarking",
    decD5.legs.some((l) => l.pick_id === d5sm) && !decD5.legs.some((l) => l.pick_id === d5fd));
  suite.eq("D5: laga kembar hanya 1 pilihan di tiket",
    decD5.legs.filter((l) => l.match_id === "sm_9101" || l.match_id === "fd_9101").length, 1);

  // D6 = 2026-12-06: kembar tertaut TANPA marking — dedupe kunci kanonik.
  const d6fd = publishFixture("fd_9102", "2026-12-06T13:00:00.000Z", "liga_berfeed", DC1X(0.9))[0];
  const d6sm = publishFixture("sm_9102", "2026-12-06T13:00:00.000Z", "liga_berfeed", DC1X(0.88))[0];
  publishFixture("fx_n1", "2026-12-06T14:00:00.000Z", "liga_berfeed", L1(0.84));
  publishFixture("fx_n2", "2026-12-06T15:00:00.000Z", "liga_berfeed", L1(0.82));
  publishFixture("fx_n3", "2026-12-06T16:00:00.000Z", "liga_berfeed", L1(0.8));
  const candD6 = fix4.selectFix4Candidates(db, "2026-12-06");
  suite.eq("D6: dua match_id kembar tertaut → tepat 1 kandidat",
    candD6.filter((c) => c.match_id === "sm_9102" || c.match_id === "fd_9102").length, 1);
  suite.eq("D6: wakil laga fisik = pick probabilitas tertinggi (fd_ 0,90)",
    candD6.filter((c) => c.match_id === "sm_9102" || c.match_id === "fd_9102").map((c) => c.pick_id),
    [d6fd]);
  suite.eq("D6: total kandidat layak = 4", candD6.length, 4);
  const decD6 = fix4.generateFix4Ticket(db, "2026-12-06", PUBLISH_NOW);
  suite.eq("D6: status PUBLISHED", decD6.status, "PUBLISHED");
  suite.check("D6: tiket hanya memuat satu sisi kembar",
    decD6.legs.filter((l) => l.match_id === "sm_9102" || l.match_id === "fd_9102").length === 1 &&
    !decD6.legs.some((l) => l.pick_id === d6sm));

  settleFixtureEnv(env, suite.failedCount > 0);
  suite.finish();
}

main().catch((e) => {
  console.error("GAGAL BESAR:", e);
  process.exit(1);
});
