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
 *
 * Penjaga cutoff (koreksi 27 Nov 2026): generator hanya boleh membekukan
 * pada/sesudah cutoff 14:00 WIB tanggalnya, jadi semua panggilan generate
 * di suite ini memakai now pada/sesudah cutoff masing-masing. Bagian D7
 * menguji penjaganya sendiri: T−1 ms menunggu tanpa menulis, tepat T
 * boleh membekukan, T+1 ms retry idempoten, dan calon yang terbit pukul
 * 13:50 WIB (sebelum cutoff) ikut terhitung saat generasi berjalan.
 *
 * Regresi audit produksi 27 Nov 2026 §1 (tes ditulis GAGAL dulu):
 *  - D8: leg berkickoff 14:05 WIB tersaring pada dispatch 14:10 (kickoff
 *    aktual dicek ulang pada saat keputusan ditulis); kontrol D8b pada
 *    14:04 membuktikan leg yang sama tetap layak sebelum kickoff-nya.
 *  - D9: dedupe laga fisik memakai fixture_uid persisten — dua pick pasar
 *    berbeda ber-UID sama tanpa tautan fixture-links adalah SATU laga
 *    (4 baris / 3 laga fisik → ABSTAIN); kontrol D9b: 4 laga fisik →
 *    PUBLISHED.
 *  - D10: kandidat layak yang commit dari koneksi lain sesudah selektor
 *    membaca tetapi sebelum transaksi tulis tidak boleh terlewat —
 *    kandidat diambil di dalam transaksi keputusan (state sesudah lock).
 *
 * Regresi revisi PR #12 (brief revisi pemilik 27 Nov 2026; tes ditulis
 * GAGAL dulu di head 149e241):
 *  - D11 (R1): jam penerbitan mengikuti lock yang benar-benar didapat.
 *    Proses lain menahan BEGIN IMMEDIATE; jam masuk CLI 07:15:12.756Z,
 *    leg kickoff 07:15:15.460Z, lock lepas dan jam pasca-lock
 *    07:15:16.669Z. Head lama memakai jam pra-lock untuk seleksi DAN
 *    created_utc → tiket tampak terbit sebelum kickoff. Sesudah patch:
 *    jam dibaca ulang sesudah lock (clock terinjeksi), leg yang mencapai
 *    kickoff sejak seleksi tersaring, created_utc = jam pasca-lock.
 *  - D12 (R2): selektor membaca bukti jadwal/status dari
 *    thestats_dataset.db (read-only): (a) UID cancelled di dataset tanpa
 *    pick_voids; (b) kickoff kanonik terkoreksi maju melewati jam
 *    penerbitan; (c) void provider_cancelled ber-UID menahan SELURUH
 *    laga (dua market), bukan cuma pick-nya; (d) dua pick warisan
 *    ber-UID kosong digabung alias dataset; (e) kontrol warisan tanpa
 *    data kanonik tetap PUBLISHED (fallback lama).
 *  - D13 (R3): retry keputusan yang sudah ada cukup MEMBACA — di bawah
 *    lock writer lain + busy_timeout 0, head lama melempar SQLITE_BUSY
 *    (DDL/BEGIN IMMEDIATE), basis lama mengembalikan UID yang sama.
 *    Kontrol D13b: sebelum cutoff generator tidak menyentuh DB sama
 *    sekali (penjaga WAITING_CUTOFF murni jam).
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
    nowOverride?: string,
    fixtureUid?: string,
  ): number[] => {
    seq++;
    const input: import("../lib/picks/publication").PublishFixtureInput = {
      series: "live-run",
      source_match_id: matchId,
      fixture_uid: fixtureUid ?? `uid-fx4-${seq}`,
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
      now: () => nowOverride ?? PUBLISH_NOW,
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
  // Tepat pada cutoff (T) — batas inklusif: generasi SUDAH boleh jalan.
  const decD = fix4.generateFix4Ticket(db, "2026-11-26", "2026-11-26T07:00:00.000Z");
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
  const decD2x = fix4.generateFix4Ticket(db, "2026-11-28", "2026-11-28T07:00:00.000Z");
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
  const decD3 = fix4.generateFix4Ticket(db, "2026-11-30", "2026-11-30T07:00:00.000Z");
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
  const decD4 = fix4.generateFix4Ticket(db, "2026-12-02", "2026-12-02T07:00:00.000Z");
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
  const decD5 = fix4.generateFix4Ticket(db, "2026-12-04", "2026-12-04T07:00:00.000Z");
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
  const decD6 = fix4.generateFix4Ticket(db, "2026-12-06", "2026-12-06T07:00:00.000Z");
  suite.eq("D6: status PUBLISHED", decD6.status, "PUBLISHED");
  suite.check("D6: tiket hanya memuat satu sisi kembar",
    decD6.legs.filter((l) => l.match_id === "sm_9102" || l.match_id === "fd_9102").length === 1 &&
    !decD6.legs.some((l) => l.pick_id === d6sm));

  // --- D7 = 2026-12-08: penjaga cutoff (koreksi 27 Nov 2026) -----------------
  // Produksi 26–27 Nov membekukan keputusan pukul 13:25 WIB (dispatch cron
  // lebih awal dari jadwal nominal 13:30). Penjaga memastikan pembekuan
  // hanya terjadi pada/sesudah cutoff 14:00 WIB = 07:00:00.000Z.
  publishFixture("fx_p1", "2026-12-08T13:00:00.000Z", "liga_berfeed", L1(0.9));
  publishFixture("fx_p2", "2026-12-08T14:00:00.000Z", "liga_berfeed", L1(0.88));
  publishFixture("fx_p3", "2026-12-08T15:00:00.000Z", "liga_berfeed", L1(0.86));
  // Calon ke-4 terbit pukul 13:50 WIB hari keputusan (06:50Z) — sebelum
  // cutoff, jadi WAJIB ikut terhitung saat generasi berjalan pada cutoff.
  const pickLate = publishFixture(
    "fx_p4", "2026-12-08T16:00:00.000Z", "liga_berfeed", L1(0.84),
    "2026-12-08T06:50:00.000Z",
  )[0];

  // T−1 ms: menunggu, dan TIDAK menulis apa pun (tak ada ABSTAIN dini).
  const waitD7 = fix4.generateFix4Ticket(db, "2026-12-08", "2026-12-08T06:59:59.999Z");
  suite.eq("D7: T−1 ms → WAITING_CUTOFF", waitD7.status, "WAITING_CUTOFF");
  suite.check("D7: alasan memuat 'Menunggu batas penilaian'",
    (waitD7.reason ?? "").includes("Menunggu batas penilaian"));
  const nDecD7pre = (db.prepare(
    "SELECT COUNT(*) AS n FROM fix4_daily_decisions WHERE date_wib = '2026-12-08'",
  ).get() as { n: number }).n;
  suite.eq("D7: T−1 ms tidak menulis baris keputusan", nDecD7pre, 0);
  const nTickD7pre = (db.prepare(
    "SELECT COUNT(*) AS n FROM fix4_tickets WHERE date_wib = '2026-12-08'",
  ).get() as { n: number }).n;
  suite.eq("D7: T−1 ms tidak menulis baris tiket", nTickD7pre, 0);

  // Tepat T: generasi boleh jalan; calon terbit 13:50 ikut masuk tiket.
  const decD7 = fix4.generateFix4Ticket(db, "2026-12-08", "2026-12-08T07:00:00.000Z");
  suite.eq("D7: tepat T → PUBLISHED", decD7.status, "PUBLISHED");
  suite.eq("D7: kandidat layak = 4 (termasuk terbitan 13:50)", decD7.eligible_count, 4);
  suite.check("D7: tiket memuat pick yang terbit pukul 13:50 WIB",
    decD7.legs.some((l) => l.pick_id === pickLate));

  // T+1 ms: retry idempoten — keputusan yang sama, tetap satu baris/hari.
  const decD7retry = fix4.generateFix4Ticket(db, "2026-12-08", "2026-12-08T07:00:00.001Z");
  suite.check("D7: retry T+1 ms → already_existed", decD7retry.already_existed === true);
  suite.eq("D7: retry ticket_uid sama", decD7retry.ticket_uid, decD7.ticket_uid);
  const nDecD7 = (db.prepare(
    "SELECT COUNT(*) AS n FROM fix4_daily_decisions WHERE date_wib = '2026-12-08'",
  ).get() as { n: number }).n;
  suite.eq("D7: tepat satu keputusan tercatat per hari", nDecD7, 1);

  // --- D8 = 2026-12-10: kickoff sudah lewat saat terbit (audit §1 cacat A) ---
  // Selektor lama hanya memastikan kickoff > cutoff 14:00 WIB. Pada
  // dispatch 14:10 WIB, leg berkickoff 14:05 WIB (07:05Z) LOLOS jendela
  // dan masuk tiket padahal laganya sudah mulai 5 menit.
  const d8early = publishFixture("fx_q0", "2026-12-10T07:05:00.000Z", "liga_berfeed", L1(0.9))[0];
  publishFixture("fx_q1", "2026-12-10T13:00:00.000Z", "liga_berfeed", L1(0.88));
  publishFixture("fx_q2", "2026-12-10T14:00:00.000Z", "liga_berfeed", L1(0.86));
  publishFixture("fx_q3", "2026-12-10T15:00:00.000Z", "liga_berfeed", L1(0.84));
  const decD8 = fix4.generateFix4Ticket(db, "2026-12-10", "2026-12-10T07:10:00.000Z");
  suite.eq("D8: dispatch 14:10, leg kickoff 14:05 tersaring → ABSTAIN", decD8.status, "ABSTAIN");
  suite.eq("D8: kandidat layak = 3 (leg awal tidak terhitung)", decD8.eligible_count, 3);
  suite.check("D8: leg awal tidak muncul di hasil", !decD8.legs.some((l) => l.pick_id === d8early));
  const nTickD8 = (db.prepare(
    "SELECT COUNT(*) AS n FROM fix4_tickets WHERE date_wib = '2026-12-10'",
  ).get() as { n: number }).n;
  suite.eq("D8: tidak ada tiket terbit", nTickD8, 0);

  // Kontrol D8b = 2026-12-12: pola identik, generasi pukul 14:04 WIB
  // (07:04Z) — leg 14:05 BELUM kickoff saat keputusan ditulis → layak.
  const d8bEarly = publishFixture("fx_r0", "2026-12-12T07:05:00.000Z", "liga_berfeed", L1(0.9))[0];
  publishFixture("fx_r1", "2026-12-12T13:00:00.000Z", "liga_berfeed", L1(0.88));
  publishFixture("fx_r2", "2026-12-12T14:00:00.000Z", "liga_berfeed", L1(0.86));
  publishFixture("fx_r3", "2026-12-12T15:00:00.000Z", "liga_berfeed", L1(0.84));
  const decD8b = fix4.generateFix4Ticket(db, "2026-12-12", "2026-12-12T07:04:00.000Z");
  suite.eq("D8b: generasi 14:04 → PUBLISHED", decD8b.status, "PUBLISHED");
  suite.eq("D8b: kandidat layak = 4", decD8b.eligible_count, 4);
  suite.check("D8b: leg kickoff 14:05 ikut masuk (belum mulai saat ditulis)",
    decD8b.legs.some((l) => l.pick_id === d8bEarly));

  // --- D9 = 2026-12-14: dedupe via fixture_uid persisten (audit §1 cacat B) --
  // Dua pick dari pasar berbeda, fixture_uid SAMA, match_id provider
  // berbeda, dan TIDAK ada tautan fixture-links untuk keduanya saat
  // generator berjalan → satu laga fisik, bukan dua.
  const d9a = publishFixture(
    "px_a1", "2026-12-14T13:00:00.000Z", "liga_berfeed",
    [{ market: "1x2", selection: "1", prob: 0.9 }],
    undefined, "uid-fx4-sama",
  )[0];
  publishFixture(
    "px_a2", "2026-12-14T13:00:00.000Z", "liga_berfeed",
    [{ market: "dc", selection: "1x", prob: 0.88 }],
    undefined, "uid-fx4-sama",
  );
  publishFixture("fx_s1", "2026-12-14T14:00:00.000Z", "liga_berfeed", L1(0.85));
  publishFixture("fx_s2", "2026-12-14T15:00:00.000Z", "liga_berfeed", L1(0.83));
  const candD9 = fix4.selectFix4Candidates(db, "2026-12-14");
  suite.eq("D9: 4 baris kandidat / 3 laga fisik → 3 kandidat", candD9.length, 3);
  suite.eq("D9: wakil laga ber-UID sama = probabilitas tertinggi (1x2 0,90)",
    candD9.map((c) => c.pick_id).includes(d9a) && candD9[0].pick_id === d9a, true);
  const decD9 = fix4.generateFix4Ticket(db, "2026-12-14", "2026-12-14T07:00:00.000Z");
  suite.eq("D9: 3 laga fisik → ABSTAIN", decD9.status, "ABSTAIN");
  suite.eq("D9: eligible_count = 3", decD9.eligible_count, 3);

  // Kontrol D9b = 2026-12-16: 4 laga fisik berbeda → PUBLISHED.
  publishFixture("fx_vv1", "2026-12-16T13:00:00.000Z", "liga_berfeed", L1(0.9));
  publishFixture("fx_vv2", "2026-12-16T14:00:00.000Z", "liga_berfeed", L1(0.88));
  publishFixture("fx_vv3", "2026-12-16T15:00:00.000Z", "liga_berfeed", L1(0.86));
  publishFixture("fx_vv4", "2026-12-16T16:00:00.000Z", "liga_berfeed", L1(0.84));
  const decD9b = fix4.generateFix4Ticket(db, "2026-12-16", "2026-12-16T07:00:00.000Z");
  suite.eq("D9b: 4 laga fisik → PUBLISHED", decD9b.status, "PUBLISHED");
  suite.eq("D9b: tiket memuat 4 pilihan", decD9b.legs.length, 4);

  // --- D10 = 2026-12-18: race snapshot WAL (audit §1 cacat C) ----------------
  // Kandidat layak ke-4 commit dari koneksi LAIN sesudah selektor membaca
  // kandidat tetapi sebelum generator memperoleh transaksi tulis.
  // Simulasi deterministik sederajat (bukan dua proses bertiming acak):
  // pembungkus DB menyisipkan commit kandidat ke-4 dari koneksi kedua
  // tepat saat generator pertama kali meminta BEGIN IMMEDIATE — persis
  // batas jendela race pada audit. Pada kode lama kandidat sudah telanjur
  // terbaca (3) → ABSTAIN keliru; pada kode baru kandidat diambil di
  // dalam transaksi sesudah lock → state sesudah lock yang terhitung.
  publishFixture("fx_uu1", "2026-12-18T13:00:00.000Z", "liga_berfeed", L1(0.9));
  publishFixture("fx_uu2", "2026-12-18T14:00:00.000Z", "liga_berfeed", L1(0.88));
  const uu3 = publishFixture("fx_uu3", "2026-12-18T15:00:00.000Z", "liga_berfeed", L1(0.86))[0];

  const { DatabaseSync } = await import("node:sqlite");
  const dbRace = new DatabaseSync(path.join(env.dataDir, "picks.db"));
  let raceInserted = false;
  const insertRaceCandidate = (): void => {
    const src = dbRace.prepare("SELECT * FROM picks WHERE id = ?").get(uu3) as unknown as Record<string, unknown>;
    src.match_id = "fx_uu4";
    src.market = "dc";
    src.selection = "1x";
    src.fixture_uid = "uid-fx4-race4";
    src.pick_uid = "pick-uid-fx4-race4";
    src.kickoff_utc = "2026-12-18T16:00:00.000Z";
    src.kickoff_at_issue_utc = "2026-12-18T16:00:00.000Z";
    src.model_prob = 0.84;
    src.effective_prob = 0.84;
    src.published_prob = 0.84;
    const cols = Object.keys(src).filter((c) => c !== "id");
    dbRace
      .prepare(`INSERT INTO picks (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
      .run(...cols.map((c) => src[c] as never));
  };
  const wrappedDb = {
    prepare: (sql: string) => db.prepare(sql),
    exec: (sql: string) => {
      if (sql === "BEGIN IMMEDIATE" && !raceInserted) {
        raceInserted = true;
        insertRaceCandidate();
      }
      return db.exec(sql);
    },
  };
  const decD10 = fix4.generateFix4Ticket(
    wrappedDb as unknown as import("node:sqlite").DatabaseSync,
    "2026-12-18",
    "2026-12-18T07:00:00.000Z",
  );
  suite.check("D10: sisipan race benar-benar terjadi", raceInserted);
  suite.eq("D10: kandidat commit sebelum kunci tulis ikut terhitung → PUBLISHED", decD10.status, "PUBLISHED");
  suite.eq("D10: eligible_count = 4", decD10.eligible_count, 4);
  suite.check("D10: tiket memuat kandidat hasil race (fx_uu4)",
    decD10.legs.some((l) => l.match_id === "fx_uu4"));
  dbRace.close();
  // Retry sesudah keputusan tercatat: append-only, keputusan yang sama.
  const decD10retry = fix4.generateFix4Ticket(db, "2026-12-18", "2026-12-18T07:05:00.000Z");
  suite.check("D10: retry → already_existed", decD10retry.already_existed === true);
  suite.eq("D10: retry ticket_uid sama", decD10retry.ticket_uid, decD10.ticket_uid);

  // --- D11 (R1) = 2026-12-20: jam penerbitan mengikuti lock ------------------
  // Reproduksi brief revisi §1 (CLI dua proses, diskala ke fixture
  // deterministik): proses lain menahan BEGIN IMMEDIATE; jam masuk
  // 07:15:12.756Z; leg pertama kickoff 07:15:15.460Z; lock lepas pada
  // 07:15:16.669Z. Head 149e241 memakai jam pra-lock untuk seleksi dan
  // created_utc → leg itu TERBIT dengan created_utc sebelum kickoff-nya,
  // padahal barisnya tertulis sesudah kickoff. Simulasi sederajat D10:
  // pembungkus DB melepas lock koneksi lain tepat saat generator meminta
  // BEGIN IMMEDIATE, dan clock terinjeksi bergeser pada momen yang sama.
  const d11t0 = publishFixture("fx_j0", "2026-12-20T07:15:15.460Z", "liga_berfeed", L1(0.9))[0];
  publishFixture("fx_j1", "2026-12-20T07:15:16.669Z", "liga_berfeed", L1(0.88));
  publishFixture("fx_j2", "2026-12-20T13:00:00.000Z", "liga_berfeed", L1(0.86));
  publishFixture("fx_j3", "2026-12-20T14:00:00.000Z", "liga_berfeed", L1(0.84));
  publishFixture("fx_j4", "2026-12-20T15:00:00.000Z", "liga_berfeed", L1(0.82));
  const ENTRY_R1 = "2026-12-20T07:15:12.756Z";
  const AFTER_R1 = "2026-12-20T07:15:16.669Z";
  const lockR1 = new DatabaseSync(path.join(env.dataDir, "picks.db"));
  lockR1.exec("BEGIN IMMEDIATE");
  let lockR1Released = false;
  const clockR1 = (): string => (lockR1Released ? AFTER_R1 : ENTRY_R1);
  const wrappedR1 = {
    prepare: (sql: string) => db.prepare(sql),
    exec: (sql: string) => {
      if (sql === "BEGIN IMMEDIATE" && !lockR1Released) {
        lockR1.exec("COMMIT");
        lockR1Released = true;
      }
      return db.exec(sql);
    },
  };
  const decD11 = fix4.generateFix4Ticket(
    wrappedR1 as unknown as import("node:sqlite").DatabaseSync,
    "2026-12-20",
    ENTRY_R1,
    { now: clockR1, datasetDb: null },
  );
  suite.check("D11: lock writer lain benar-benar terlepas di BEGIN generator", lockR1Released);
  suite.eq("D11: leg mencapai kickoff selama menunggu lock tersaring → ABSTAIN", decD11.status, "ABSTAIN");
  suite.eq("D11: kandidat aman tersisa = 3", decD11.eligible_count, 3);
  suite.check("D11: tidak ada leg terbit", decD11.legs.length === 0 && !decD11.legs.some((l) => l.pick_id === d11t0));
  const d11Row = db.prepare(
    "SELECT created_utc FROM fix4_daily_decisions WHERE date_wib = '2026-12-20'",
  ).get() as { created_utc: string } | undefined;
  suite.eq("D11: created_utc keputusan = jam pasca-lock (bukan jam masuk)", d11Row?.created_utc, AFTER_R1);
  const nTickD11 = (db.prepare(
    "SELECT COUNT(*) AS n FROM fix4_tickets WHERE date_wib = '2026-12-20'",
  ).get() as { n: number }).n;
  suite.eq("D11: tidak ada baris tiket", nTickD11, 0);
  lockR1.close();

  // Kontrol D11b = 2026-12-22: 4 leg aman — peluang + urutan tidak berubah,
  // hanya cap waktunya yang kini jam pasca-lock di KEDUA tabel.
  publishFixture("fx_u20", "2026-12-22T13:00:00.000Z", "liga_berfeed", L1(0.9));
  publishFixture("fx_u21", "2026-12-22T14:00:00.000Z", "liga_berfeed", L1(0.88));
  publishFixture("fx_u22", "2026-12-22T15:00:00.000Z", "liga_berfeed", L1(0.86));
  publishFixture("fx_u23", "2026-12-22T16:00:00.000Z", "liga_berfeed", L1(0.84));
  const ENTRY_R1B = "2026-12-22T07:15:12.756Z";
  const AFTER_R1B = "2026-12-22T07:15:16.669Z";
  const lockR1b = new DatabaseSync(path.join(env.dataDir, "picks.db"));
  lockR1b.exec("BEGIN IMMEDIATE");
  let lockR1bReleased = false;
  const wrappedR1b = {
    prepare: (sql: string) => db.prepare(sql),
    exec: (sql: string) => {
      if (sql === "BEGIN IMMEDIATE" && !lockR1bReleased) {
        lockR1b.exec("COMMIT");
        lockR1bReleased = true;
      }
      return db.exec(sql);
    },
  };
  const decD11b = fix4.generateFix4Ticket(
    wrappedR1b as unknown as import("node:sqlite").DatabaseSync,
    "2026-12-22",
    ENTRY_R1B,
    { now: () => (lockR1bReleased ? AFTER_R1B : ENTRY_R1B), datasetDb: null },
  );
  suite.eq("D11b: 4 leg aman → PUBLISHED", decD11b.status, "PUBLISHED");
  suite.eq("D11b: urutan leg tidak berubah", decD11b.legs.map((l) => l.match_id),
    ["fx_u20", "fx_u21", "fx_u22", "fx_u23"]);
  suite.eq("D11b: peluang leg tidak berubah", decD11b.legs.map((l) => l.published_prob),
    [0.9, 0.88, 0.86, 0.84]);
  const d11bTicket = db.prepare(
    "SELECT created_utc FROM fix4_tickets WHERE date_wib = '2026-12-22'",
  ).get() as { created_utc: string } | undefined;
  const d11bDec = db.prepare(
    "SELECT created_utc FROM fix4_daily_decisions WHERE date_wib = '2026-12-22'",
  ).get() as { created_utc: string } | undefined;
  suite.eq("D11b: created_utc tiket = jam pasca-lock", d11bTicket?.created_utc, AFTER_R1B);
  suite.eq("D11b: created_utc keputusan = jam pasca-lock (sama dengan tiket)", d11bDec?.created_utc, AFTER_R1B);
  lockR1b.close();

  // --- D12 (R2): bukti jadwal/status dari thestats_dataset.db -----------------
  // Dataset fixture: tabel identitas dibuat dengan skema repo asli, baris
  // kanonik/alias ditanam per kasus. Selektor head 149e241 tidak membaca
  // DB ini sama sekali → semua kasus a–d lolos masuk PUBLISHED secara
  // keliru.
  const identityMod = await import("../lib/identity/fixture-resolver");
  const dsDb = new DatabaseSync(path.join(env.dataDir, "thestats_dataset.db"));
  identityMod.ensureIdentitySchema(dsDb);
  const putCanonical = (uid: string, state: string, kickoff: string | null): void => {
    dsDb.prepare(
      `INSERT INTO canonical_fixtures
         (fixture_uid, competition_id, kickoff_utc, kickoff_precision, state, created_at, updated_at)
       VALUES (?, 'liga_berfeed', ?, 'exact', ?, ?, ?)`,
    ).run(uid, kickoff, state, PUBLISH_NOW, PUBLISH_NOW);
  };
  const putAlias = (matchId: string, uid: string): void => {
    dsDb.prepare(
      `INSERT INTO fixture_aliases
         (source, source_match_id, fixture_uid, match_basis, first_seen_utc, last_seen_utc)
       VALUES (?, ?, ?, 'test', ?, ?)`,
    ).run(identityMod.sourceOfMatchId(matchId), matchId, uid, PUBLISH_NOW, PUBLISH_NOW);
  };

  // D12a = 2026-12-24: UID cancelled di dataset, resolver belum membuat
  // pick_voids → leg tetap harus ditahan.
  const d12aBad = publishFixture("fx_c1", "2026-12-24T13:00:00.000Z", "liga_berfeed", L1(0.9), undefined, "uid-d12-batal")[0];
  publishFixture("fx_c2", "2026-12-24T14:00:00.000Z", "liga_berfeed", L1(0.88));
  publishFixture("fx_c3", "2026-12-24T15:00:00.000Z", "liga_berfeed", L1(0.86));
  publishFixture("fx_c4", "2026-12-24T16:00:00.000Z", "liga_berfeed", L1(0.84));
  putCanonical("uid-d12-batal", "cancelled", "2026-12-24T13:00:00.000Z");
  const candD12a = fix4.selectFix4Candidates(db, "2026-12-24", undefined, "2026-12-24T07:10:00.000Z", { datasetDb: dsDb });
  suite.eq("D12a: selektor berbukti dataset → 3 kandidat (cancelled tertahan)", candD12a.length, 3);
  suite.check("D12a: leg cancelled tidak termasuk kandidat", !candD12a.some((c) => c.pick_id === d12aBad));
  const candD12aLegacy = fix4.selectFix4Candidates(db, "2026-12-24", undefined, "2026-12-24T07:10:00.000Z", { datasetDb: null });
  suite.eq("D12a: kontrol tanpa bukti dataset → 4 kandidat (fallback lama)", candD12aLegacy.length, 4);
  const decD12a = fix4.generateFix4Ticket(db, "2026-12-24", "2026-12-24T07:10:00.000Z", { datasetDb: dsDb });
  suite.eq("D12a: cancelled tanpa void → ABSTAIN", decD12a.status, "ABSTAIN");
  suite.eq("D12a: kandidat layak = 3", decD12a.eligible_count, 3);

  // D12b = 2026-12-26: kickoff pick beku 16:00 WIB (09:00Z) dikoreksi di
  // fixture kanonik menjadi 14:05 WIB (07:05Z); penerbitan 14:10 WIB.
  const d12bBad = publishFixture("fx_k1", "2026-12-26T09:00:00.000Z", "liga_berfeed", L1(0.9), undefined, "uid-d12-maju")[0];
  publishFixture("fx_k2", "2026-12-26T13:00:00.000Z", "liga_berfeed", L1(0.88));
  publishFixture("fx_k3", "2026-12-26T14:00:00.000Z", "liga_berfeed", L1(0.86));
  publishFixture("fx_k4", "2026-12-26T15:00:00.000Z", "liga_berfeed", L1(0.84));
  putCanonical("uid-d12-maju", "scheduled", "2026-12-26T07:05:00.000Z");
  const decD12b = fix4.generateFix4Ticket(db, "2026-12-26", "2026-12-26T07:10:00.000Z", { datasetDb: dsDb });
  suite.eq("D12b: kickoff kanonik sudah lewat jam penerbitan → ABSTAIN", decD12b.status, "ABSTAIN");
  suite.eq("D12b: kandidat layak = 3", decD12b.eligible_count, 3);
  suite.check("D12b: leg terkoreksi tidak masuk hasil", !decD12b.legs.some((l) => l.pick_id === d12bBad));

  // D12c = 2026-12-28: void provider_cancelled ber-UID pada SATU market
  // menahan SELURUH laga — market lain ber-UID sama tidak boleh masuk.
  const d12c1 = publishFixture("px_c1", "2026-12-28T13:00:00.000Z", "liga_berfeed",
    [{ market: "1x2", selection: "1", prob: 0.9 }], undefined, "uid-d12-pc")[0];
  const d12c2 = publishFixture("px_c2", "2026-12-28T13:00:00.000Z", "liga_berfeed",
    [{ market: "dc", selection: "1x", prob: 0.88 }], undefined, "uid-d12-pc")[0];
  publishFixture("fx_pc1", "2026-12-28T14:00:00.000Z", "liga_berfeed", L1(0.86));
  publishFixture("fx_pc2", "2026-12-28T15:00:00.000Z", "liga_berfeed", L1(0.84));
  publishFixture("fx_pc3", "2026-12-28T16:00:00.000Z", "liga_berfeed", L1(0.82));
  db.prepare(
    "INSERT INTO pick_voids (pick_id, fixture_uid, voided_utc, reason, policy_version) VALUES (?, ?, ?, ?, ?)",
  ).run(d12c2, "uid-d12-pc", PUBLISH_NOW, "provider_cancelled", "test");
  const decD12c = fix4.generateFix4Ticket(db, "2026-12-28", "2026-12-28T07:00:00.000Z", { datasetDb: dsDb });
  suite.eq("D12c: provider_cancelled satu market menahan seluruh laga → ABSTAIN", decD12c.status, "ABSTAIN");
  suite.eq("D12c: kandidat layak = 3", decD12c.eligible_count, 3);
  suite.check("D12c: kedua pick laga yang sama tertahan",
    !decD12c.legs.some((l) => l.pick_id === d12c1 || l.pick_id === d12c2));

  // D12d = 2026-12-30: dua pick warisan ber-UID kosong — alias dataset
  // menunjuk ke SATU UID; tanpa JSON tautan keduanya satu laga fisik.
  const d12d1 = publishFixture("mt_d1", "2026-12-30T13:00:00.000Z", "liga_berfeed", L1(0.9))[0];
  const d12d2 = publishFixture("fd_d1", "2026-12-30T13:00:00.000Z", "liga_berfeed", DC1X(0.88))[0];
  db.prepare("UPDATE picks SET fixture_uid = NULL WHERE id IN (?, ?)").run(d12d1, d12d2);
  publishFixture("fx_dd1", "2026-12-30T14:00:00.000Z", "liga_berfeed", L1(0.86));
  publishFixture("fx_dd2", "2026-12-30T15:00:00.000Z", "liga_berfeed", L1(0.84));
  putAlias("mt_d1", "uid-d12-alias");
  putAlias("fd_d1", "uid-d12-alias");
  putCanonical("uid-d12-alias", "scheduled", "2026-12-30T13:00:00.000Z");
  const decD12d = fix4.generateFix4Ticket(db, "2026-12-30", "2026-12-30T07:00:00.000Z", { datasetDb: dsDb });
  suite.eq("D12d: alias dataset menggabung dua pick ber-UID kosong → ABSTAIN", decD12d.status, "ABSTAIN");
  suite.eq("D12d: kandidat layak = 3 (alias + 2 laga lain)", decD12d.eligible_count, 3);

  // D12e = 2027-01-01: kontrol warisan — dataset terbuka tetapi TANPA
  // baris kanonik untuk keempat laga → fallback lama utuh, PUBLISHED.
  publishFixture("fx_e1", "2027-01-01T13:00:00.000Z", "liga_berfeed", L1(0.9));
  publishFixture("fx_e2", "2027-01-01T14:00:00.000Z", "liga_berfeed", L1(0.88));
  publishFixture("fx_e3", "2027-01-01T15:00:00.000Z", "liga_berfeed", L1(0.86));
  publishFixture("fx_e4", "2027-01-01T16:00:00.000Z", "liga_berfeed", L1(0.84));
  const decD12e = fix4.generateFix4Ticket(db, "2027-01-01", "2027-01-01T07:00:00.000Z", { datasetDb: dsDb });
  suite.eq("D12e: tanpa data kanonik → PUBLISHED (fallback lama)", decD12e.status, "PUBLISHED");
  suite.eq("D12e: tiket memuat 4 pilihan", decD12e.legs.length, 4);
  dsDb.close();

  // --- D13 (R3) = retry 2026-11-26 di bawah lock writer lain ------------------
  // Keputusan 2026-11-26 sudah tercatat (kasus D). Koneksi lain memegang
  // BEGIN IMMEDIATE; koneksi retry memakai busy_timeout 0. Head 149e241
  // menjalankan DDL + BEGIN IMMEDIATE sebelum membaca keputusan →
  // SQLITE_BUSY. Sesudah patch: pembacaan cepat lebih dulu → UID sama
  // tanpa meminta lock.
  const lockR3 = new DatabaseSync(path.join(env.dataDir, "picks.db"));
  lockR3.exec("BEGIN IMMEDIATE");
  const busyConn = new DatabaseSync(path.join(env.dataDir, "picks.db"));
  busyConn.exec("PRAGMA busy_timeout = 0");
  let decR3: import("../lib/picks/fix4-tickets").Fix4GenerationResult | null = null;
  let r3Err: unknown = null;
  try {
    decR3 = fix4.generateFix4Ticket(busyConn, "2026-11-26", NOW_LATE);
  } catch (e) {
    r3Err = e;
  }
  lockR3.exec("COMMIT");
  lockR3.close();
  busyConn.close();
  suite.check("D13: retry di bawah lock writer tidak melempar", r3Err === null, String(r3Err));
  suite.check("D13: retry → already_existed", decR3?.already_existed === true);
  suite.eq("D13: retry ticket_uid sama dengan keputusan awal", decR3?.ticket_uid, decD.ticket_uid);
  const nDecR3 = (db.prepare(
    "SELECT COUNT(*) AS n FROM fix4_daily_decisions WHERE date_wib = '2026-11-26'",
  ).get() as { n: number }).n;
  suite.eq("D13: tepat satu baris keputusan untuk tanggal itu", nDecR3, 1);

  // Kontrol D13b: sebelum cutoff, generator TIDAK menyentuh DB sama
  // sekali — handle yang melempar pada sentuhan apa pun tetap menerima
  // WAITING_CUTOFF (penjaga murni jam, jalur CLI tanpa membuka DB).
  const noTouchDb = {
    prepare: (): never => { throw new Error("DB disentuh (prepare)"); },
    exec: (): never => { throw new Error("DB disentuh (exec)"); },
  };
  const waitD13 = fix4.generateFix4Ticket(
    noTouchDb as unknown as import("node:sqlite").DatabaseSync,
    "2027-01-03",
    "2027-01-03T06:59:00.000Z",
  );
  suite.eq("D13b: sebelum cutoff → WAITING_CUTOFF tanpa menyentuh DB", waitD13.status, "WAITING_CUTOFF");

  settleFixtureEnv(env, suite.failedCount > 0);
  suite.finish();
}

main().catch((e) => {
  console.error("GAGAL BESAR:", e);
  process.exit(1);
});
