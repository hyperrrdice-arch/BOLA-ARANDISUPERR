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
 *
 * Regresi finalisasi PR #12 (brief finalisasi pemilik 27 Nov 2026; tes
 * ditulis GAGAL dulu di head 6bdd732):
 *  - D14 (F1): batas kickoff yang sama sampai menjelang COMMIT. Batas
 *    penerbitan internal = paling awal dari kickoff ledger dan kickoff
 *    kanonik presisi 'exact'. (a) kickoff kanonik 07:10:01 terlewati
 *    oleh jam akhir 07:10:02 SELAGI transaksi menulis (jam digeser tepat
 *    pada INSERT tiket) → percobaan ter-rollback, evaluasi ulang →
 *    ABSTAIN tanpa tiket/leg. (b) pola sama dengan laga pengganti →
 *    PUBLISHED dari 4 laga aman. (c) kontrol: kickoff belum tercapai
 *    saat commit → terbit persis baseline. (d) jam melompat pada setiap
 *    percobaan tulis → guard retry habis, kegagalan jelas, nol baris.
 *  - D15 (F2): bukti pembatalan dari LEDGER walau dataset absen. Void
 *    provider_cancelled ber-UID di picks.db menahan SELURUH laga walau
 *    (a) thestats_dataset.db absen dan (b) DB dataset tanpa tabel
 *    identitas. Kontrol (c): void per-pick biasa tetap per-pick —
 *    market lain ber-UID sama yang sah boleh dipilih.
 *  - D16 (F3): retry lewat CLI ASLI (scripts/generate-fix4-ticket.ts,
 *    proses OS terpisah) saat proses lain memegang lock writer
 *    (lock-holder-signal, barrier berkas) dan picks.db memuat baris
 *    legacy belum ter-backfill: CLI wajib mengembalikan UID yang sama
 *    SELAGI lock masih dipegang, tanpa mengubah baris legacy dan tanpa
 *    keputusan baru. Head 6bdd732 membuka getPicksDb() lebih dulu →
 *    menunggu lock lalu menjalankan backfill sebelum menjawab.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  REPO_ROOT,
  Suite,
  buildCoreSchemas,
  createFixtureEnv,
  runScript,
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

  // --- D14 (F1): batas kickoff yang sama sampai menjelang COMMIT -------------
  // Dataset dibuka lagi (handle D12 sudah ditutup) untuk menanam fixture
  // kanonik kasus-kasus ini pada berkas yang sama.
  const dsDb2 = new DatabaseSync(path.join(env.dataDir, "thestats_dataset.db"));
  const putCanonical2 = (uid: string, kickoff: string | null): void => {
    dsDb2.prepare(
      `INSERT INTO canonical_fixtures
         (fixture_uid, competition_id, kickoff_utc, kickoff_precision, state, created_at, updated_at)
       VALUES (?, 'liga_berfeed', ?, 'exact', 'scheduled', ?, ?)`,
    ).run(uid, kickoff, PUBLISH_NOW, PUBLISH_NOW);
  };
  // Pembungkus DB yang menggeser jam terinjeksi tepat saat statement
  // INSERT tiket pertama dieksekusi — kickoff terlewati SELAGI transaksi
  // menulis, bukan sebelum seleksi dimulai.
  const makeFlipDb = (flip: () => void): import("node:sqlite").DatabaseSync => {
    let flipped = false;
    const wrapped = {
      prepare: (sql: string) => {
        const stmt = db.prepare(sql);
        if (!sql.includes("INSERT INTO fix4_tickets")) return stmt;
        return {
          run: (...a: never[]) => {
            if (!flipped) {
              flipped = true;
              flip();
            }
            return stmt.run(...a);
          },
          get: (...a: never[]) => stmt.get(...a),
          all: (...a: never[]) => stmt.all(...a),
        };
      },
      exec: (sql: string) => db.exec(sql),
    };
    return wrapped as unknown as import("node:sqlite").DatabaseSync;
  };
  const countDate = (table: string, date: string): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE date_wib = ?`).get(date) as { n: number }).n;

  // D14a = 2027-01-05 (kasus tabel brief): kickoff ledger 13:00Z (20:00
  // WIB), kickoff kanonik exact 07:10:01Z; jam seleksi 07:10:00, jam
  // akhir 07:10:02. Head 6bdd732 menerbitkan laga ini karena cek akhir
  // hanya membaca kickoff ledger dari snapshot pick.
  const d14aBad = publishFixture("fx_ba1", "2027-01-05T13:00:00.000Z", "liga_berfeed", L1(0.9), undefined, "uid-d14-batas")[0];
  publishFixture("fx_ba2", "2027-01-05T14:00:00.000Z", "liga_berfeed", L1(0.88));
  publishFixture("fx_ba3", "2027-01-05T15:00:00.000Z", "liga_berfeed", L1(0.86));
  publishFixture("fx_ba4", "2027-01-05T16:00:00.000Z", "liga_berfeed", L1(0.84));
  putCanonical2("uid-d14-batas", "2027-01-05T07:10:01.000Z");
  let d14aNow = "2027-01-05T07:10:00.000Z";
  const decD14a = fix4.generateFix4Ticket(
    makeFlipDb(() => {
      d14aNow = "2027-01-05T07:10:02.000Z";
    }),
    "2027-01-05",
    "2027-01-05T07:10:00.000Z",
    { now: () => d14aNow, datasetDb: dsDb2 },
  );
  suite.eq("D14a: kickoff kanonik terlewati saat menulis → ABSTAIN", decD14a.status, "ABSTAIN");
  suite.eq("D14a: kandidat aman tersisa = 3", decD14a.eligible_count, 3);
  suite.check("D14a: leg batas tidak masuk hasil", !decD14a.legs.some((l) => l.pick_id === d14aBad));
  const d14aDec = db.prepare(
    "SELECT created_utc FROM fix4_daily_decisions WHERE date_wib = '2027-01-05'",
  ).get() as { created_utc: string } | undefined;
  suite.eq("D14a: created_utc keputusan = jam evaluasi ulang pasca-rollback", d14aDec?.created_utc, "2027-01-05T07:10:02.000Z");
  suite.eq("D14a: nol tiket dari percobaan ter-rollback", countDate("fix4_tickets", "2027-01-05"), 0);
  const nLegD14a = (db.prepare(
    `SELECT COUNT(*) AS n FROM fix4_ticket_legs l JOIN fix4_tickets t ON t.ticket_uid = l.ticket_uid
     WHERE t.date_wib = '2027-01-05'`,
  ).get() as { n: number }).n;
  suite.eq("D14a: nol leg dari percobaan ter-rollback", nLegD14a, 0);

  // D14b = 2027-01-07: pola D14a + satu laga pengganti aman → percobaan
  // pertama ter-rollback, evaluasi ulang menerbitkan 4 laga aman.
  const d14bBad = publishFixture("fx_bb1", "2027-01-07T13:00:00.000Z", "liga_berfeed", L1(0.9), undefined, "uid-d14-ganti")[0];
  publishFixture("fx_bb2", "2027-01-07T13:00:00.000Z", "liga_berfeed", L1(0.88));
  publishFixture("fx_bb3", "2027-01-07T14:00:00.000Z", "liga_berfeed", L1(0.86));
  publishFixture("fx_bb4", "2027-01-07T15:00:00.000Z", "liga_berfeed", L1(0.84));
  publishFixture("fx_bb5", "2027-01-07T16:00:00.000Z", "liga_berfeed", L1(0.82));
  putCanonical2("uid-d14-ganti", "2027-01-07T07:10:01.000Z");
  let d14bNow = "2027-01-07T07:10:00.000Z";
  const decD14b = fix4.generateFix4Ticket(
    makeFlipDb(() => {
      d14bNow = "2027-01-07T07:10:02.000Z";
    }),
    "2027-01-07",
    "2027-01-07T07:10:00.000Z",
    { now: () => d14bNow, datasetDb: dsDb2 },
  );
  suite.eq("D14b: evaluasi ulang sesudah rollback → PUBLISHED", decD14b.status, "PUBLISHED");
  suite.eq("D14b: leg = 4 laga aman pengganti, urutan ranking",
    decD14b.legs.map((l) => l.match_id), ["fx_bb2", "fx_bb3", "fx_bb4", "fx_bb5"]);
  suite.check("D14b: leg batas tidak masuk tiket", !decD14b.legs.some((l) => l.pick_id === d14bBad));
  suite.eq("D14b: tepat satu tiket (percobaan pertama ter-rollback)", countDate("fix4_tickets", "2027-01-07"), 1);
  suite.eq("D14b: tepat satu keputusan", countDate("fix4_daily_decisions", "2027-01-07"), 1);
  const d14bTicket = db.prepare(
    "SELECT created_utc FROM fix4_tickets WHERE date_wib = '2027-01-07'",
  ).get() as { created_utc: string } | undefined;
  suite.eq("D14b: created_utc tiket = jam evaluasi ulang", d14bTicket?.created_utc, "2027-01-07T07:10:02.000Z");

  // D14c = 2027-01-09 (kontrol): kickoff kanonik exact = kickoff ledger,
  // jam tetap — kickoff belum tercapai saat commit → terbit persis
  // baseline (urutan + peluang beku + cap waktu seleksi).
  publishFixture("fx_bc1", "2027-01-09T13:00:00.000Z", "liga_berfeed", L1(0.9), undefined, "uid-d14-c1");
  publishFixture("fx_bc2", "2027-01-09T14:00:00.000Z", "liga_berfeed", L1(0.88), undefined, "uid-d14-c2");
  publishFixture("fx_bc3", "2027-01-09T15:00:00.000Z", "liga_berfeed", L1(0.86), undefined, "uid-d14-c3");
  publishFixture("fx_bc4", "2027-01-09T16:00:00.000Z", "liga_berfeed", L1(0.84), undefined, "uid-d14-c4");
  putCanonical2("uid-d14-c1", "2027-01-09T13:00:00.000Z");
  putCanonical2("uid-d14-c2", "2027-01-09T14:00:00.000Z");
  putCanonical2("uid-d14-c3", "2027-01-09T15:00:00.000Z");
  putCanonical2("uid-d14-c4", "2027-01-09T16:00:00.000Z");
  const decD14c = fix4.generateFix4Ticket(db, "2027-01-09", "2027-01-09T07:10:00.000Z", { datasetDb: dsDb2 });
  suite.eq("D14c: kickoff belum tercapai saat commit → PUBLISHED", decD14c.status, "PUBLISHED");
  suite.eq("D14c: urutan leg sesuai baseline", decD14c.legs.map((l) => l.match_id),
    ["fx_bc1", "fx_bc2", "fx_bc3", "fx_bc4"]);
  suite.eq("D14c: peluang leg beku sesuai baseline", decD14c.legs.map((l) => l.published_prob),
    [0.9, 0.88, 0.86, 0.84]);
  const d14cTicket = db.prepare(
    "SELECT created_utc FROM fix4_tickets WHERE date_wib = '2027-01-09'",
  ).get() as { created_utc: string } | undefined;
  const d14cDec = db.prepare(
    "SELECT created_utc FROM fix4_daily_decisions WHERE date_wib = '2027-01-09'",
  ).get() as { created_utc: string } | undefined;
  suite.eq("D14c: created_utc tiket = jam seleksi", d14cTicket?.created_utc, "2027-01-09T07:10:00.000Z");
  suite.eq("D14c: created_utc keputusan = jam seleksi (sama dengan tiket)", d14cDec?.created_utc, "2027-01-09T07:10:00.000Z");
  dsDb2.close();

  // D14d = 2027-01-10: jam melompat +60 dtk pada SETIAP sampel. Lima
  // laga dekat berkickoff berjenjang (T0+30..T0+270) selalu mencapai
  // kickoff tepat pada pemeriksaan akhir salah satu percobaan; empat
  // laga jauh aman. Tiga percobaan tulis habis → kegagalan jelas dan
  // TIDAK ada baris apa pun yang tertinggal.
  const d14dNear: [string, number][] = [
    ["2027-01-10T07:10:30.000Z", 0.95],
    ["2027-01-10T07:11:30.000Z", 0.94],
    ["2027-01-10T07:12:30.000Z", 0.93],
    ["2027-01-10T07:13:30.000Z", 0.92],
    ["2027-01-10T07:14:30.000Z", 0.91],
  ];
  d14dNear.forEach(([k, p], i) => publishFixture(`fx_bd${i + 1}`, k, "liga_berfeed", L1(p)));
  publishFixture("fx_bd6", "2027-01-10T13:00:00.000Z", "liga_berfeed", L1(0.9));
  publishFixture("fx_bd7", "2027-01-10T14:00:00.000Z", "liga_berfeed", L1(0.88));
  publishFixture("fx_bd8", "2027-01-10T15:00:00.000Z", "liga_berfeed", L1(0.86));
  publishFixture("fx_bd9", "2027-01-10T16:00:00.000Z", "liga_berfeed", L1(0.84));
  const d14dSamples = [
    "2027-01-10T07:10:00.000Z",
    "2027-01-10T07:11:00.000Z",
    "2027-01-10T07:12:00.000Z",
    "2027-01-10T07:13:00.000Z",
    "2027-01-10T07:14:00.000Z",
    "2027-01-10T07:15:00.000Z",
  ];
  let d14dIdx = 0;
  let d14dErr: unknown = null;
  try {
    fix4.generateFix4Ticket(db, "2027-01-10", d14dSamples[0], {
      now: () => d14dSamples[Math.min(d14dIdx++, d14dSamples.length - 1)],
      datasetDb: null,
    });
  } catch (e) {
    d14dErr = e;
  }
  suite.check("D14d: guard retry habis → kegagalan jelas menyebut kickoff",
    d14dErr instanceof Error && /kickoff/i.test(d14dErr.message), String(d14dErr));
  suite.eq("D14d: nol keputusan tertinggal", countDate("fix4_daily_decisions", "2027-01-10"), 0);
  suite.eq("D14d: nol tiket tertinggal", countDate("fix4_tickets", "2027-01-10"), 0);

  // --- D15 (F2): bukti pembatalan dari ledger walau dataset absen ------------
  const insertVoid = (pickId: number, uid: string, reason: string): void => {
    db.prepare(
      "INSERT INTO pick_voids (pick_id, fixture_uid, voided_utc, reason, policy_version) VALUES (?, ?, ?, ?, ?)",
    ).run(pickId, uid, PUBLISH_NOW, reason, "test");
  };

  // D15a = 2027-01-11: dataset ABSEN (datasetDb: null). Void
  // provider_cancelled ber-UID hanya ada di picks.db — market kedua
  // ber-UID sama tetap harus tertahan. Head 6bdd732: loader jatuh ke
  // fallback, void hanya menyaring pick-nya → market kedua masuk.
  const d15a1 = publishFixture("px_b1", "2027-01-11T13:00:00.000Z", "liga_berfeed",
    [{ market: "1x2", selection: "1", prob: 0.9 }], undefined, "uid-d15-pc")[0];
  const d15a2 = publishFixture("px_b2", "2027-01-11T13:00:00.000Z", "liga_berfeed",
    [{ market: "dc", selection: "1x", prob: 0.88 }], undefined, "uid-d15-pc")[0];
  publishFixture("fx_be1", "2027-01-11T14:00:00.000Z", "liga_berfeed", L1(0.86));
  publishFixture("fx_be2", "2027-01-11T15:00:00.000Z", "liga_berfeed", L1(0.84));
  publishFixture("fx_be3", "2027-01-11T16:00:00.000Z", "liga_berfeed", L1(0.82));
  insertVoid(d15a1, "uid-d15-pc", "provider_cancelled");
  const decD15a = fix4.generateFix4Ticket(db, "2027-01-11", "2027-01-11T07:10:00.000Z", { datasetDb: null });
  suite.eq("D15a: dataset absen, provider_cancelled di ledger menahan seluruh laga → ABSTAIN", decD15a.status, "ABSTAIN");
  suite.eq("D15a: kandidat layak = 3", decD15a.eligible_count, 3);
  suite.check("D15a: kedua pick laga batal tertahan",
    !decD15a.legs.some((l) => l.pick_id === d15a1 || l.pick_id === d15a2));
  suite.eq("D15a: nol tiket", countDate("fix4_tickets", "2027-01-11"), 0);

  // D15b = 2027-01-13: dataset ADA sebagai berkas tetapi TANPA tabel
  // identitas — loader mengembalikan null; bukti ledger tetap berlaku.
  const d15b1 = publishFixture("px_b3", "2027-01-13T13:00:00.000Z", "liga_berfeed",
    [{ market: "1x2", selection: "1", prob: 0.9 }], undefined, "uid-d15b-pc")[0];
  const d15b2 = publishFixture("px_b4", "2027-01-13T13:00:00.000Z", "liga_berfeed",
    [{ market: "dc", selection: "1x", prob: 0.88 }], undefined, "uid-d15b-pc")[0];
  publishFixture("fx_bf1", "2027-01-13T14:00:00.000Z", "liga_berfeed", L1(0.86));
  publishFixture("fx_bf2", "2027-01-13T15:00:00.000Z", "liga_berfeed", L1(0.84));
  publishFixture("fx_bf3", "2027-01-13T16:00:00.000Z", "liga_berfeed", L1(0.82));
  insertVoid(d15b1, "uid-d15b-pc", "provider_cancelled");
  const emptyDsDb = new DatabaseSync(path.join(env.dataDir, "dataset-tanpa-identitas.db"));
  const decD15b = fix4.generateFix4Ticket(db, "2027-01-13", "2027-01-13T07:10:00.000Z", { datasetDb: emptyDsDb });
  suite.eq("D15b: DB tanpa tabel identitas, provider_cancelled di ledger menahan seluruh laga → ABSTAIN", decD15b.status, "ABSTAIN");
  suite.eq("D15b: kandidat layak = 3", decD15b.eligible_count, 3);
  suite.check("D15b: kedua pick laga batal tertahan",
    !decD15b.legs.some((l) => l.pick_id === d15b1 || l.pick_id === d15b2));
  suite.eq("D15b: nol tiket", countDate("fix4_tickets", "2027-01-13"), 0);
  emptyDsDb.close();

  // D15c = 2027-01-15 (kontrol): void per-pick BUKAN provider_cancelled
  // + fixture tanpa bukti pembatalan → void individual tersaring,
  // market lain ber-UID sama yang sah mewakili laga.
  const d15c1 = publishFixture("px_b5", "2027-01-15T13:00:00.000Z", "liga_berfeed",
    [{ market: "1x2", selection: "1", prob: 0.9 }], undefined, "uid-d15c")[0];
  const d15c2 = publishFixture("px_b6", "2027-01-15T13:00:00.000Z", "liga_berfeed",
    [{ market: "dc", selection: "1x", prob: 0.88 }], undefined, "uid-d15c")[0];
  publishFixture("fx_bg1", "2027-01-15T14:00:00.000Z", "liga_berfeed", L1(0.86));
  publishFixture("fx_bg2", "2027-01-15T15:00:00.000Z", "liga_berfeed", L1(0.84));
  publishFixture("fx_bg3", "2027-01-15T16:00:00.000Z", "liga_berfeed", L1(0.82));
  insertVoid(d15c1, "uid-d15c", "pasar_ditutup");
  const decD15c = fix4.generateFix4Ticket(db, "2027-01-15", "2027-01-15T07:10:00.000Z", { datasetDb: null });
  suite.eq("D15c: void per-pick biasa → PUBLISHED", decD15c.status, "PUBLISHED");
  suite.eq("D15c: kandidat layak = 4", decD15c.eligible_count, 4);
  suite.check("D15c: pick void tersaring, market lain yang sah mewakili laga",
    !decD15c.legs.some((l) => l.pick_id === d15c1) && decD15c.legs.some((l) => l.pick_id === d15c2));

  // --- D16 (F3): retry lewat CLI asli di bawah lock writer proses lain -------
  // Baris legacy live-run dengan notes eff= yang BELUM ter-backfill
  // (effective_prob NULL) ditanam langsung — getter writable mana pun
  // yang membuka picks.db akan mengubahnya lewat backfill ledger.
  const srcLegacy = db.prepare("SELECT * FROM picks WHERE id = ?").get(pickA) as unknown as Record<string, unknown>;
  const legacyRow: Record<string, unknown> = { ...srcLegacy };
  delete legacyRow.id;
  legacyRow.match_id = "fx_legacy_cli";
  legacyRow.fixture_uid = "uid-legacy-cli";
  legacyRow.pick_uid = "pick-uid-legacy-cli";
  legacyRow.kickoff_utc = "2027-02-01T13:00:00.000Z";
  legacyRow.kickoff_at_issue_utc = "2027-02-01T13:00:00.000Z";
  legacyRow.notes = "warisan uji CLI eff=0.85 lab-band";
  legacyRow.effective_prob = null;
  legacyRow.effective_source = null;
  legacyRow.published_prob = null;
  const legacyCols = Object.keys(legacyRow);
  db.prepare(
    `INSERT INTO picks (${legacyCols.join(", ")}) VALUES (${legacyCols.map(() => "?").join(", ")})`,
  ).run(...legacyCols.map((c) => legacyRow[c] as never));

  // Proses terpisah menahan BEGIN IMMEDIATE sampai file pelepas ditulis
  // (barrier berkas lock-holder-signal — tanpa tebakan waktu).
  const picksPath = path.join(env.dataDir, "picks.db");
  const readyFile = path.join(env.root, "d16-lock-ready");
  const releaseFile = path.join(env.root, "d16-lock-release");
  const tsxBin = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
  const holder = spawn(
    tsxBin,
    [path.join(REPO_ROOT, "tests/helpers/lock-holder-signal.ts"), picksPath, readyFile, releaseFile, "60000"],
    { cwd: env.root, stdio: ["ignore", "pipe", "pipe"] },
  );
  let holderCode: number | null = null;
  const holderDone = new Promise<void>((resolve) => {
    holder.on("close", (code) => {
      holderCode = code;
      resolve();
    });
  });
  let holderReady = false;
  for (let i = 0; i < 400 && !holderReady; i++) {
    if (fs.existsSync(readyFile)) holderReady = true;
    else await new Promise((r) => setTimeout(r, 50));
  }
  suite.check("D16: proses lain benar-benar memegang lock writer", holderReady);

  const tCli = Date.now();
  const cliRes = runScript(env, "scripts/generate-fix4-ticket.ts", ["--date=2026-11-26"]);
  const cliElapsedMs = Date.now() - tCli;
  suite.eq("D16: CLI retry keluar 0", cliRes.code, 0);
  suite.check("D16: CLI mengembalikan UID tiket yang sama",
    cliRes.stdout.includes(decD.ticket_uid ?? "—"), cliRes.stdout.slice(0, 200));
  suite.check("D16: CLI kembali SELAGI lock masih dipegang (pelepas belum ditulis, < 30 dtk)",
    cliElapsedMs < 30000 && !fs.existsSync(releaseFile), `elapsed=${cliElapsedMs}ms`);
  const legacyAfter = db.prepare(
    "SELECT effective_prob FROM picks WHERE match_id = 'fx_legacy_cli'",
  ).get() as { effective_prob: number | null } | undefined;
  suite.eq("D16: baris legacy TIDAK ter-backfill oleh retry CLI", legacyAfter?.effective_prob, null);
  suite.eq("D16: jumlah keputusan 2026-11-26 tetap 1", countDate("fix4_daily_decisions", "2026-11-26"), 1);
  fs.writeFileSync(releaseFile, "release");
  await Promise.race([holderDone, new Promise((r) => setTimeout(r, 15000))]);
  if (holderCode === null) holder.kill();
  suite.eq("D16: holder melepas lock lewat barrier berkas (exit 0)", holderCode, 0);

  settleFixtureEnv(env, suite.failedCount > 0);
  suite.finish();
}

main().catch((e) => {
  console.error("GAGAL BESAR:", e);
  process.exit(1);
});
