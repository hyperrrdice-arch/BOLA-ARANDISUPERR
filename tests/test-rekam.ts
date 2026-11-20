/**
 * TEST:REKAM — suite K7 (U04–U08) di atas sandbox fixture.
 *
 * U04 · Gerbang waktu: backend K2 menolak terbit pada T (dibuktikan K2);
 *   di lapisan UI, `sudahMulai` mengunci tepat pada T (T−1 masih
 *   terbuka) dan keadaan baris rekam tidak pernah menebak hasil —
 *   laga lewat kickoff tanpa outcome tetap menunggu/jatuh tempo.
 * U05 · Dua edisi/paket: rekam mengacu pada snapshot TERBIT (paket B
 *   yang lebih baru tidak mengubah angka baris maupun rata-rata);
 *   draf pribadi tidak muncul (hanya slip published_slips yang
 *   terdaftar); tabel, ringkasan, dan SQL mentah memakai filter dan
 *   penyebut yang identik (spot-check terprogram).
 * U03 (bagian builder) · Contoh dokumen: 75% → irisan matriks 51% →
 *   tambah laga 69% → 35,2%; alias duplikat ter-dedup di umpan builder.
 * U06/U07 · Bukti browser dijalankan terpisah (build + Chromium);
 *   suite ini menguji logika murni + lapisan baca yang direndernya.
 * U08 · Literal lama tidak ada di file UI K7; contoh rekam dokumen
 *   (6 dari 8 tepat = 75%, rata-rata peluang terbit 71,3%) cocok
 *   dengan baris sumbernya.
 *
 * Pakai: npm run test:web (suite ini dirantai sesudah test-ui.ts)
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  Suite,
  buildCoreSchemas,
  createFixtureEnv,
  runScript,
  settleFixtureEnv,
  type FixtureEnv,
  type RunResult,
} from "./helpers/fixture-env";
import { pct } from "../lib/web/format";
import { combineSlip, sudahMulai, type SlipPick } from "../lib/web/parlay";
import {
  bulatkanTampil,
  cohortFilterOf,
  keadaanPilihan,
  parseFilterRekam,
  queryRekam,
} from "../lib/web/rekam";

/* ------------------------------------------------------------ probe types */

interface BarisProbe {
  pick_id: number;
  match_id: string;
  keadaan: string;
  alasan_jatuh_tempo: string | null;
  published_display: number | string;
  probability_basis: string | null;
}
interface RekamProbe {
  issued: number;
  settled: number;
  hits: number;
  misses: number;
  hit_ratio: number | null;
  empty: boolean;
  due: number;
  coverage: [number, number] | null;
  voids: number;
  not_started: number;
  awaiting_window: number;
  overdue_pending: number;
  overdue_by_reason: Record<string, number>;
  prob_slice: {
    n: number;
    avg_published_prob: number | null;
    avg_hit: number | null;
    legacy_hitmiss_only: number;
  };
  laga_dinilai_unik: number;
  baris: BarisProbe[];
  tiket_stats: {
    slips: number;
    hit: number;
    miss: number;
    void: number;
    pending: number;
    hit_ratio: number | null;
    unique_fixtures: number;
    total_legs: number;
  };
  tiket_uids: string[];
}
interface Probe {
  utama: RekamProbe;
  pasar: RekamProbe;
  lain: RekamProbe;
  meleset: RekamProbe;
  kosong: RekamProbe;
  sql: { issued: number; settled: number; hits: number; avg_prob: number; legacy: number };
  tiketA: {
    state: string;
    has_missed_leg: boolean;
    combined_prob: number | null;
    legs: { state: string; home: string; frozen_prob: number | null }[];
  } | null;
  tiketB: {
    state: string;
    has_missed_leg: boolean;
    combined_prob: number | null;
    legs: { state: string; home: string; frozen_prob: number | null }[];
  } | null;
  tiketHantu: unknown;
  praLaga: { pick_uid: string; fixture_uid: string; published_prob: number }[];
}

function runRekamProbe(env: FixtureEnv): Probe {
  const res: RunResult = runScript(env, "tests/helpers/rekam-probe.ts");
  const line = res.stdout.split("\n").find((l) => l.startsWith("PROBE_JSON "));
  if (!line) {
    throw new Error(
      `rekam-probe tidak menghasilkan PROBE_JSON (exit=${res.code}): ${res.stdout} ${res.stderr}`,
    );
  }
  return JSON.parse(line.slice("PROBE_JSON ".length)) as Probe;
}

/* ------------------------------------------------------------------ seed */

const NOW = "2026-11-21T12:00:00.000Z";
const TERBIT = "2026-11-17T12:00:00.000Z";

interface SeedPick {
  match: string;
  uid: string;
  comp: string;
  kickoff: string;
  market: string;
  selection: string;
  prob: number | null;
  basis: string | null;
  grade: string;
  pkg: number;
  hit?: number;
  skor?: [number, number];
  pickUid: string | null;
  source?: string;
}

async function buildSandbox(): Promise<{
  env: FixtureEnv;
  slipA: string;
  slipB: string;
  ids: Record<string, number>;
}> {
  const env = createFixtureEnv("k7rekam");
  process.chdir(env.root);
  const { ledger } = await buildCoreSchemas();
  const publication = await import("../lib/picks/publication");
  const tickets = await import("../lib/picks/tickets");
  const pdb = ledger.getPicksDb();
  publication.ensurePublicationSchema(pdb);
  tickets.ensureTicketSchema(pdb);

  fs.writeFileSync(
    path.join(env.dataDir, "league-canonical.json"),
    JSON.stringify({
      version: 1,
      generated_at: "2026-11-18T00:00:00.000Z",
      generator: "tests/test-rekam.ts (K7 fixture)",
      leagues: [
        { canonical_id: "comp_k7_rekam", name: "Liga Rekam", country: "Indonesia", fits: [], aliases: [] },
        { canonical_id: "comp_k7_lain", name: "Liga Lain", country: "Indonesia", fits: [], aliases: [] },
        { canonical_id: "comp_k7_meleset", name: "Liga Meleset", country: "Indonesia", fits: [], aliases: [] },
        { canonical_id: "comp_k7_builder", name: "Liga Builder", country: "Indonesia", fits: [], aliases: [] },
      ],
    }),
  );
  fs.writeFileSync(path.join(env.dataDir, "fixture-links.json"), JSON.stringify({ links: [] }));

  // Antrean konflik identitas K1: laga m8 belum selesai ditinjau.
  const identity = await import("../lib/identity/fixture-resolver");
  const ds = new DatabaseSync(path.join(env.dataDir, "thestats_dataset.db"));
  identity.ensureIdentitySchema(ds);
  ds.prepare(
    `INSERT INTO fixture_identity_queue (source, source_match_id, reason, detail_json, created_at)
     VALUES ('sportmonks', 'sm_k7_m8', 'identity_ambiguous', '{}', '2026-11-20T21:00:00.000Z')`,
  ).run();
  ds.close();

  // Paket-paket analisis (nama laga hidup di payload).
  const snap = new DatabaseSync(path.join(env.dataDir, "analysis_snapshots.db"));
  const insPkg = snap.prepare(
    `INSERT INTO packages (match_id, competition_canonical_id, kickoff_utc,
       computed_utc, trigger, fit_source, gate_status, payload_json)
     VALUES (?, ?, ?, ?, 'manual', 'fixture', 'partial', ?)`,
  );
  const MATRIX_M1 = [
    [0.05, 0.04, 0.01],
    [0.1, 0.08, 0.02],
    [0.3, 0.25, 0.15],
  ];
  function paket(
    match: string,
    comp: string,
    kickoff: string,
    home: string,
    away: string,
    computed = "2026-11-17T10:00:00.000Z",
    matrix: number[][] = [],
  ): number {
    const payload = {
      fixture: { match_id: match, competition_name: "Liga Rekam", home, away, kickoff_utc: kickoff },
      gate_status: "partial",
      population: "domestic",
      lambda: 1.4,
      mu: 1.1,
      rho: -0.08,
      probabilities: {},
      top_scores: [],
      score_matrix: matrix,
      market: null,
      sm_panel: null,
      legs: [],
    };
    const r = insPkg.run(match, comp, kickoff, computed, JSON.stringify(payload));
    return Number(r.lastInsertRowid);
  }
  const pkg: Record<string, number> = {
    m1: paket("sm_k7_m1", "comp_k7_rekam", "2026-11-18T18:00:00.000Z", "Persada FC", "Rawa United", "2026-11-17T10:00:00.000Z", MATRIX_M1),
    m2a: paket("sm_k7_m2", "comp_k7_rekam", "2026-11-19T18:00:00.000Z", "Tim Dua", "Tim Tiga", "2026-11-18T10:00:00.000Z"),
    // Paket B (analisis terbaru) untuk laga yang sama — TIDAK boleh mengubah rekam.
    m2b: paket("sm_k7_m2", "comp_k7_rekam", "2026-11-19T18:00:00.000Z", "Tim Dua", "Tim Tiga", "2026-11-19T09:00:00.000Z"),
    m3: paket("sm_k7_m3", "comp_k7_rekam", "2026-11-20T15:00:00.000Z", "Tim Empat", "Tim Lima"),
    m4: paket("sm_k7_m4", "comp_k7_rekam", "2026-11-20T19:00:00.000Z", "Tim Enam", "Tim Tujuh"),
    m5: paket("sm_k7_m5", "comp_k7_rekam", "2026-11-22T18:00:00.000Z", "Tim Delapan", "Tim Sembilan"),
    m6: paket("sm_k7_m6", "comp_k7_rekam", "2026-11-23T18:00:00.000Z", "Tim Sepuluh", "Tim Sebelas"),
    m7: paket("sm_k7_m7", "comp_k7_rekam", "2026-11-21T09:00:00.000Z", "Tim Dua Belas", "Tim Tiga Belas"),
    m8: paket("sm_k7_m8", "comp_k7_rekam", "2026-11-20T20:00:00.000Z", "Tim Empat Belas", "Tim Lima Belas"),
    v1: paket("sm_k7_v1", "comp_k7_lain", "2026-11-19T18:00:00.000Z", "Tim Batal", "Tim Urung"),
    o1: paket("sm_k7_o1", "comp_k7_lain", "2026-11-19T10:00:00.000Z", "Tim Tua", "Tim Lama"),
    g1: paket("sm_k7_g1", "comp_k7_lain", "2026-11-18T15:00:00.000Z", "Tim Warisan", "Tim Klasik"),
    dup: paket("sm_k7_d1", "comp_k7_builder", "2026-11-24T18:00:00.000Z", "Tim Ganda", "Tim Kembar"),
    x1: paket("sm_k7_x1", "comp_k7_builder", "2026-11-24T20:00:00.000Z", "Tim Rusak", "Tim Cacat"),
    l1: paket("sm_k7_l1", "comp_k7_meleset", "2026-11-18T18:00:00.000Z", "Tim Sial", "Tim Apes"),
    l2: paket("sm_k7_l2", "comp_k7_meleset", "2026-11-19T18:00:00.000Z", "Tim Malang", "Tim Buntung"),
    l3: paket("sm_k7_l3", "comp_k7_meleset", "2026-11-20T18:00:00.000Z", "Tim Kalah", "Tim Tumbang"),
  };
  snap.close();

  const pk = new DatabaseSync(path.join(env.dataDir, "picks.db"));
  const insPick = pk.prepare(
    `INSERT INTO picks (created_utc, match_id, competition_canonical_id, kickoff_utc,
       market, selection, model_prob, effective_prob, gate_status, grade, source,
       package_id, pick_uid, fixture_uid, line, series, published_prob,
       probability_basis, published_at_utc, decision_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'partial', ?, ?, ?, ?, ?, '', 'live-run', ?, ?, ?, ?)`,
  );
  const insOutcome = pk.prepare(
    `INSERT INTO pick_outcomes (pick_id, resolved_utc, home_goals, away_goals, hit)
     VALUES (?, '2026-11-21T00:00:00.000Z', ?, ?, ?)`,
  );
  const ids: Record<string, number> = {};
  function seedPick(key: string, s: SeedPick): number {
    const source = s.source ?? "live-run";
    const r = insPick.run(
      TERBIT,
      s.match,
      s.comp,
      s.kickoff,
      s.market,
      s.selection,
      s.prob ?? 0.5,
      s.prob,
      s.grade,
      source,
      s.pkg,
      s.pickUid,
      s.uid,
      s.prob,
      s.basis,
      s.prob === null ? null : TERBIT,
      TERBIT,
    );
    const id = Number(r.lastInsertRowid);
    ids[key] = id;
    if (s.hit !== undefined && s.skor) insOutcome.run(id, s.skor[0], s.skor[1], s.hit);
    return id;
  }

  /* Cohort utama (contoh dokumen): 8 dinilai — 6 tepat di 4 laga. */
  seedPick("m1p1", { match: "sm_k7_m1", uid: "fx_k7_m1", comp: "comp_k7_rekam", kickoff: "2026-11-18T18:00:00.000Z", market: "1x2", selection: "1", prob: 0.78, basis: "effective", grade: "A", pkg: pkg.m1, hit: 1, skor: [2, 1], pickUid: "pick_k7_m1p1" });
  seedPick("m1p2", { match: "sm_k7_m1", uid: "fx_k7_m1", comp: "comp_k7_rekam", kickoff: "2026-11-18T18:00:00.000Z", market: "dc", selection: "1x", prob: 0.62, basis: "effective", grade: "A", pkg: pkg.m1, hit: 1, skor: [2, 1], pickUid: "pick_k7_m1p2" });
  seedPick("m2p1", { match: "sm_k7_m2", uid: "fx_k7_m2", comp: "comp_k7_rekam", kickoff: "2026-11-19T18:00:00.000Z", market: "1x2", selection: "1", prob: 0.7, basis: "effective", grade: "B", pkg: pkg.m2a, hit: 1, skor: [2, 1], pickUid: "pick_k7_m2p1" });
  seedPick("m2p2", { match: "sm_k7_m2", uid: "fx_k7_m2", comp: "comp_k7_rekam", kickoff: "2026-11-19T18:00:00.000Z", market: "ou25", selection: "over", prob: 0.76, basis: "effective", grade: "A", pkg: pkg.m2a, hit: 1, skor: [2, 1], pickUid: "pick_k7_m2p2" });
  seedPick("m3p1", { match: "sm_k7_m3", uid: "fx_k7_m3", comp: "comp_k7_rekam", kickoff: "2026-11-20T15:00:00.000Z", market: "1x2", selection: "1", prob: 0.72, basis: "effective", grade: "B", pkg: pkg.m3, hit: 0, skor: [1, 1], pickUid: "pick_k7_m3p1" });
  seedPick("m3p2", { match: "sm_k7_m3", uid: "fx_k7_m3", comp: "comp_k7_rekam", kickoff: "2026-11-20T15:00:00.000Z", market: "dc", selection: "1x", prob: 0.7, basis: "effective", grade: "A", pkg: pkg.m3, hit: 1, skor: [1, 1], pickUid: "pick_k7_m3p2" });
  seedPick("m4p1", { match: "sm_k7_m4", uid: "fx_k7_m4", comp: "comp_k7_rekam", kickoff: "2026-11-20T19:00:00.000Z", market: "ou25", selection: "over", prob: 0.74, basis: "effective", grade: "B", pkg: pkg.m4, hit: 1, skor: [1, 2], pickUid: "pick_k7_m4p1" });
  seedPick("m4p2", { match: "sm_k7_m4", uid: "fx_k7_m4", comp: "comp_k7_rekam", kickoff: "2026-11-20T19:00:00.000Z", market: "1x2", selection: "1", prob: 0.68, basis: "effective", grade: "A", pkg: pkg.m4, hit: 0, skor: [1, 2], pickUid: "pick_k7_m4p2" });
  /* 4 menunggu: 2 belum mulai, 1 menunggu jendela, 1 jatuh tempo konflik. */
  seedPick("p1", { match: "sm_k7_m5", uid: "fx_k7_m5", comp: "comp_k7_rekam", kickoff: "2026-11-22T18:00:00.000Z", market: "1x2", selection: "1", prob: 0.8, basis: "effective", grade: "A", pkg: pkg.m5, pickUid: "pick_k7_p1" });
  seedPick("p2", { match: "sm_k7_m6", uid: "fx_k7_m6", comp: "comp_k7_rekam", kickoff: "2026-11-23T18:00:00.000Z", market: "dc", selection: "1x", prob: 0.77, basis: "effective", grade: "A", pkg: pkg.m6, pickUid: "pick_k7_p2" });
  seedPick("p3", { match: "sm_k7_m7", uid: "fx_k7_m7", comp: "comp_k7_rekam", kickoff: "2026-11-21T09:00:00.000Z", market: "1x2", selection: "1", prob: 0.71, basis: "effective", grade: "B", pkg: pkg.m7, pickUid: "pick_k7_p3" });
  seedPick("p4", { match: "sm_k7_m8", uid: "fx_k7_m8", comp: "comp_k7_rekam", kickoff: "2026-11-20T20:00:00.000Z", market: "ou25", selection: "over", prob: 0.73, basis: "effective", grade: "B", pkg: pkg.m8, pickUid: "pick_k7_p4" });

  /* Liga lain: void + jatuh tempo tanpa alasan + warisan tanpa angka terbit. */
  const v1 = seedPick("v1", { match: "sm_k7_v1", uid: "fx_k7_v1", comp: "comp_k7_lain", kickoff: "2026-11-19T18:00:00.000Z", market: "1x2", selection: "1", prob: 0.66, basis: "effective", grade: "B", pkg: pkg.v1, pickUid: "pick_k7_v1" });
  pk.prepare(
    `INSERT INTO pick_voids (pick_id, fixture_uid, voided_utc, reason, policy_version)
     VALUES (?, 'fx_k7_v1', '2026-11-19T19:00:00.000Z', 'provider_cancelled', 'k1-2026-11')`,
  ).run(v1);
  seedPick("o1", { match: "sm_k7_o1", uid: "fx_k7_o1", comp: "comp_k7_lain", kickoff: "2026-11-19T10:00:00.000Z", market: "btts", selection: "yes", prob: 0.69, basis: "effective", grade: "B", pkg: pkg.o1, pickUid: "pick_k7_o1" });
  seedPick("g1", { match: "sm_k7_g1", uid: "fx_k7_g1", comp: "comp_k7_lain", kickoff: "2026-11-18T15:00:00.000Z", market: "1x2", selection: "1", prob: null, basis: "unknown_legacy", grade: "A", pkg: pkg.g1, hit: 1, skor: [2, 0], pickUid: "pick_k7_g1" });

  /* Liga meleset: 5 dinilai, 0 tepat. */
  seedPick("l1", { match: "sm_k7_l1", uid: "fx_k7_l1", comp: "comp_k7_meleset", kickoff: "2026-11-18T18:00:00.000Z", market: "1x2", selection: "1", prob: 0.61, basis: "model", grade: "C", pkg: pkg.l1, hit: 0, skor: [0, 1], pickUid: "pick_k7_l1" });
  seedPick("l2", { match: "sm_k7_l1", uid: "fx_k7_l1", comp: "comp_k7_meleset", kickoff: "2026-11-18T18:00:00.000Z", market: "ou25", selection: "over", prob: 0.63, basis: "model", grade: "C", pkg: pkg.l1, hit: 0, skor: [0, 1], pickUid: "pick_k7_l2" });
  seedPick("l3", { match: "sm_k7_l2", uid: "fx_k7_l2", comp: "comp_k7_meleset", kickoff: "2026-11-19T18:00:00.000Z", market: "1x2", selection: "1", prob: 0.6, basis: "model", grade: "C", pkg: pkg.l2, hit: 0, skor: [1, 1], pickUid: "pick_k7_l3" });
  seedPick("l4", { match: "sm_k7_l2", uid: "fx_k7_l2", comp: "comp_k7_meleset", kickoff: "2026-11-19T18:00:00.000Z", market: "dc", selection: "1x", prob: 0.66, basis: "model", grade: "C", pkg: pkg.l2, hit: 0, skor: [0, 2], pickUid: "pick_k7_l4" });
  seedPick("l5", { match: "sm_k7_l3", uid: "fx_k7_l3", comp: "comp_k7_meleset", kickoff: "2026-11-20T18:00:00.000Z", market: "1x2", selection: "1", prob: 0.64, basis: "model", grade: "C", pkg: pkg.l3, hit: 0, skor: [1, 2], pickUid: "pick_k7_l5" });

  /* Umpan builder: satu laga fisik + basis rusak + baris lab. Duplikat
     resmi untuk kombinasi yang sama mustahil di ledger — indeks unik
     K2 (fixture_uid, market, line, selection, series) menolaknya; itu
     sebabnya dedup alias hidup di computeCombined K3 (level tiket) dan
     umpan builder cukup memagar dengan kunci laga fisik yang sama. */
  seedPick("d1", { match: "sm_k7_d1", uid: "fx_k7_dup", comp: "comp_k7_builder", kickoff: "2026-11-24T18:00:00.000Z", market: "1x2", selection: "1", prob: 0.81, basis: "effective", grade: "A", pkg: pkg.dup, pickUid: "pick_k7_d1" });
  seedPick("x1", { match: "sm_k7_x1", uid: "fx_k7_x1", comp: "comp_k7_builder", kickoff: "2026-11-24T20:00:00.000Z", market: "1x2", selection: "1", prob: null, basis: "invalid_effective", grade: "B", pkg: pkg.x1, pickUid: "pick_k7_x1" });
  seedPick("x2", { match: "sm_k7_x2", uid: "fx_k7_x2", comp: "comp_k7_builder", kickoff: "2026-11-24T21:00:00.000Z", market: "1x2", selection: "1", prob: 0.9, basis: "effective", grade: "A", pkg: pkg.x1, pickUid: null, source: "lab" });
  /* Satu baris lab dinilai — tidak boleh masuk rekam resmi mana pun. */
  seedPick("lab1", { match: "sm_k7_m1", uid: "fx_k7_m1", comp: "comp_k7_rekam", kickoff: "2026-11-18T18:00:00.000Z", market: "ou35", selection: "over", prob: 0.55, basis: "model", grade: "C", pkg: pkg.m1, hit: 1, skor: [2, 1], pickUid: null, source: "lab" });
  pk.close();

  /* Tiket resmi lewat jalur K3 sebenarnya (U05: dua edisi). */
  const slipA = tickets.publishSlip({
    edition_key: "k7-edisi-a",
    slot: "utama",
    series: "live-run",
    published_utc: "2026-11-18T00:00:00.000Z",
    pick_ids: [ids.m1p1, ids.m1p2],
  });
  const slipB = tickets.publishSlip({
    edition_key: "k7-edisi-b",
    slot: "utama",
    series: "live-run",
    published_utc: "2026-11-18T00:00:00.000Z",
    pick_ids: [ids.m3p1, ids.p1],
  });

  return { env, slipA: slipA.status, slipB: slipB.status, ids };
}

/* ------------------------------------------------------------------ main */

async function main(): Promise<void> {
  const suite = new Suite("test:rekam (K7 U04–U08)");
  const T = Date.parse("2026-11-21T13:00:00.000Z");

  /* ---- U04: gerbang waktu murni ---- */
  suite.eq("U04: T−1 ms masih terbuka", sudahMulai("2026-11-21T13:00:00.000Z", T - 1), false);
  suite.eq("U04: tepat T terkunci", sudahMulai("2026-11-21T13:00:00.000Z", T), true);
  suite.eq("U04: T+1 ms terkunci", sudahMulai("2026-11-21T13:00:00.000Z", T + 1), true);
  suite.eq("U04: waktu rusak → terkunci (tidak menebak)", sudahMulai("bukan-tanggal", T), true);
  suite.eq(
    "U04: keadaan — kickoff lewat tanpa outcome = menunggu jendela",
    keadaanPilihan({ hit: null, voided: false, kickoff_utc: "2026-11-21T09:00:00.000Z" }, Date.parse(NOW)),
    "menunggu-jendela",
  );
  suite.eq(
    "U04: keadaan — batas jendela 6 jam persis = jatuh tempo",
    keadaanPilihan({ hit: null, voided: false, kickoff_utc: "2026-11-21T06:00:00.000Z" }, Date.parse(NOW)),
    "jatuh-tempo",
  );
  suite.eq(
    "U04: keadaan — void mengalahkan jam",
    keadaanPilihan({ hit: null, voided: true, kickoff_utc: "2026-11-22T00:00:00.000Z" }, Date.parse(NOW)),
    "batal",
  );

  /* ---- filter rekam: parse + query + cohort ---- */
  const fDef = parseFilterRekam({});
  suite.eq("filter: default semua null, zona baku", [fDef.pasar, fDef.kelas, fDef.liga, fDef.dari, fDef.sampai, fDef.tz], [null, null, null, null, null, "Asia/Jakarta"]);
  const fInvalid = parseFilterRekam({ pasar: "aneh", kelas: "Z", dari: "2026-13-01", tz: "Mars/Olympus" });
  suite.eq("filter: nilai tak dikenal → tidak diterapkan", [fInvalid.pasar, fInvalid.kelas, fInvalid.dari, fInvalid.tz], [null, null, null, "Asia/Jakarta"]);
  const fBalik = parseFilterRekam({ dari: "2026-11-20", sampai: "2026-11-18" });
  suite.eq("filter: rentang terbalik ditukar", [fBalik.dari, fBalik.sampai], ["2026-11-18", "2026-11-20"]);
  const fPenuh = parseFilterRekam({ pasar: "1x2", kelas: "A", liga: "comp_k7_rekam", dari: "2026-11-18", sampai: "2026-11-20", tz: "UTC" });
  suite.eq(
    "filter: query kanonik pulih utuh",
    parseFilterRekam(Object.fromEntries(new URLSearchParams(queryRekam(fPenuh)))),
    fPenuh,
  );
  const cf = cohortFilterOf(fPenuh);
  suite.eq(
    "filter: cohort — seri produksi + pasar + kelas + liga",
    [cf.source, cf.market, cf.grade, cf.competition_canonical_id],
    ["live-run", "1x2", "A", "comp_k7_rekam"],
  );
  suite.eq(
    "filter: cohort — jendela UTC untuk periode UTC",
    [cf.from_utc, cf.to_utc],
    ["2026-11-18T00:00:00.000Z", "2026-11-20T23:59:59.999Z"],
  );
  const cfWib = cohortFilterOf(parseFilterRekam({ dari: "2026-11-18", sampai: "2026-11-18" }));
  suite.eq(
    "filter: cohort — satu tanggal WIB = 17.00Z–16.59.59.999Z",
    [cfWib.from_utc, cfWib.to_utc],
    ["2026-11-17T17:00:00.000Z", "2026-11-18T16:59:59.999Z"],
  );

  /* ---- U03: contoh gabungan dokumen lewat combineSlip ---- */
  const MATRIX_U03: number[][] = [
    [0.06, 0.03, 0.02, 0],
    [0.1, 0.05, 0.04, 0],
    [0.14, 0.2, 0.05, 0],
    [0.11, 0.12, 0.08, 0],
  ];
  const pick1: SlipPick = { key: "a", matchId: "fx_u03", market: "1x2", selection: "1", prob: 0.75, probBasis: "model", matrix: MATRIX_U03 };
  const pick2: SlipPick = { key: "b", matchId: "fx_u03", market: "ou25", selection: "over", prob: 0.6, probBasis: "model", matrix: MATRIX_U03 };
  const pick3: SlipPick = { key: "c", matchId: "fx_lain", market: "1x2", selection: "1", prob: 0.69, probBasis: "model", matrix: null };
  const dekat = (a: number, b: number) => Math.abs(a - b) <= 1e-9;
  suite.check("U03: satu pilihan = 75%", dekat(combineSlip([pick1]).combined, 0.75), String(combineSlip([pick1]).combined));
  const dua = combineSlip([pick1, pick2]);
  suite.check("U03: dua pilihan satu laga = irisan matriks 51%", dekat(dua.combined, 0.51), String(dua.combined));
  suite.eq("U03: irisan ditandai eksak", dua.exactSameMatch, true);
  const tiga = combineSlip([pick1, pick2, pick3]);
  suite.check("U03: tambah laga 69% = 35,19%", dekat(tiga.combined, 0.3519), String(tiga.combined));
  suite.eq("U03: tampilan satu desimal = 35,2%", pct(tiga.combined, 1), "35,2%");

  /* ---- U08: contoh dokumen + literal lama ---- */
  suite.eq(
    "U08: rata-rata contoh 0,7125 tampil 71,3%",
    pct(bulatkanTampil(0.7124999999999999), 1),
    "71,3%",
  );
  const fileUi = [
    "app/(terminal)/bukti/page.tsx",
    "app/(terminal)/pilihan/page.tsx",
    "components/pilihan/ParlayBuilder.tsx",
    "lib/web/rekam.ts",
  ];
  const literalLama = [
    "Know your odds",
    "Three sources",
    "Promised",
    "Your slip",
    "Loading the ball",
    "Build your parlay",
    "Live picks",
    "The record",
    "45.866",
    "163.008",
  ];
  for (const rel of fileUi) {
    const isi = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
    for (const lit of literalLama) {
      suite.check(`U08: '${lit}' absen dari ${rel}`, !isi.includes(lit));
    }
  }

  /* ---- sandbox + probe ---- */
  const { env, slipA, slipB } = await buildSandbox();
  suite.eq("U05: tiket edisi A terbit lewat jalur K3", slipA, "published");
  suite.eq("U05: tiket edisi B terbit lewat jalur K3", slipB, "published");
  const probe = runRekamProbe(env);

  /* U05 + contoh dokumen: cohort utama */
  const u = probe.utama;
  suite.eq("U05: terbit 12", u.issued, 12);
  suite.eq("U05: dinilai 8", u.settled, 8);
  suite.eq("U05: tepat 6", u.hits, 6);
  suite.eq("U05: meleset 2", u.misses, 2);
  suite.eq("U05: rasio tepat 0,75", u.hit_ratio, 0.75);
  suite.eq("U05: kalimat contoh — 6 dari 8 tepat (75%)", pct(u.hit_ratio), "75%");
  suite.eq("U05: contoh di 4 laga", u.laga_dinilai_unik, 4);
  suite.eq("U05: menunggu — belum mulai 2", u.not_started, 2);
  suite.eq("U05: menunggu — jendela 1", u.awaiting_window, 1);
  suite.eq("U05: jatuh tempo 1 beralasan konflik", [u.overdue_pending, u.overdue_by_reason], [1, { konflik: 1 }]);
  suite.eq("U05: cakupan 8 dari 9", u.coverage, [8, 9]);
  suite.eq("U05: irisan peluang n=8", u.prob_slice.n, 8);
  suite.check(
    "U05: rata-rata peluang terbit = 0,7125 (snapshot, bukan paket B)",
    u.prob_slice.avg_published_prob !== null && dekat(u.prob_slice.avg_published_prob, 0.7125),
    String(u.prob_slice.avg_published_prob),
  );
  suite.eq(
    "U08: rata-rata contoh tampil 71,3% dari baris sumber",
    pct(bulatkanTampil(u.prob_slice.avg_published_prob), 1),
    "71,3%",
  );
  suite.eq("U05: irisan tanpa warisan", u.prob_slice.legacy_hitmiss_only, 0);
  const barisM2 = u.baris.find((b) => b.match_id === "sm_k7_m2" && b.published_display === 0.7);
  suite.check("U05: baris m2 membaca snapshot terbit 0,70 (bukan 0,85 paket B)", Boolean(barisM2), JSON.stringify(u.baris.map((b) => b.published_display)));
  const keadaanUtama = u.baris.map((b) => b.keadaan).sort();
  suite.eq(
    "U04: keadaan cohort utama lengkap",
    keadaanUtama,
    ["belum-mulai", "belum-mulai", "jatuh-tempo", "meleset", "meleset", "menunggu-jendela", "tepat", "tepat", "tepat", "tepat", "tepat", "tepat"].sort(),
  );
  const barisP4 = u.baris.find((b) => b.match_id === "sm_k7_m8");
  suite.eq("U04: baris jatuh tempo membawa alasan konflik", barisP4?.alasan_jatuh_tempo, "konflik");

  /* Spot-check: ringkasan == SQL mentah pada filter yang sama */
  suite.eq("spotcheck: issued halaman == SQL", u.issued, probe.sql.issued);
  suite.eq("spotcheck: settled halaman == SQL", u.settled, probe.sql.settled);
  suite.eq("spotcheck: hits halaman == SQL", u.hits, probe.sql.hits);
  suite.check(
    "spotcheck: rata-rata peluang halaman == SQL",
    probe.sql.avg_prob !== null &&
      u.prob_slice.avg_published_prob !== null &&
      dekat(probe.sql.avg_prob, u.prob_slice.avg_published_prob),
    `${probe.sql.avg_prob} vs ${u.prob_slice.avg_published_prob}`,
  );
  suite.eq("spotcheck: warisan halaman == SQL", u.prob_slice.legacy_hitmiss_only, probe.sql.legacy);

  /* Filter mengubah anggota, bukan definisi */
  suite.eq("filter pasar 1x2: dinilai 4", probe.pasar.settled, 4);
  suite.eq("filter pasar 1x2: tepat 2 dari 4 = 50%", [probe.pasar.hits, probe.pasar.hit_ratio], [2, 0.5]);
  suite.eq("filter pasar 1x2: terbit 6", probe.pasar.issued, 6);

  /* Liga lain: void, jatuh tempo polos, warisan */
  const l = probe.lain;
  suite.eq("lain: terbit 3", l.issued, 3);
  suite.eq("lain: batal 1", l.voids, 1);
  suite.eq("lain: jatuh tempo 1 tanpa alasan khusus", [l.overdue_pending, l.overdue_by_reason], [1, { unspecified: 1 }]);
  suite.eq("lain: irisan peluang kosong, warisan 1", [l.prob_slice.n, l.prob_slice.legacy_hitmiss_only], [0, 1]);
  const barisWarisan = l.baris.find((b) => b.match_id === "sm_k7_g1");
  suite.eq("lain: baris warisan berlabel tidak tercatat", barisWarisan?.published_display, "Peluang terbit tidak tercatat");
  const barisVoid = l.baris.find((b) => b.match_id === "sm_k7_v1");
  suite.eq("lain: baris void berkeadaan batal", barisVoid?.keadaan, "batal");

  /* Keadaan kosong & nol yang jujur */
  suite.eq("kosong: cohort tanpa baris = empty, rasio null", [probe.kosong.issued, probe.kosong.empty, probe.kosong.hit_ratio], [0, true, null]);
  suite.eq("kosong: cakupan null tanpa penyebut", probe.kosong.coverage, null);
  suite.eq("meleset: 0 dari 5 = rasio 0, bukan empty", [probe.meleset.settled, probe.meleset.hits, probe.meleset.hit_ratio, probe.meleset.empty], [5, 0, 0, false]);
  suite.eq("meleset: tampilan 0%", pct(probe.meleset.hit_ratio), "0%");

  /* Tiket resmi: dua edisi, status independen */
  suite.eq("tiket: tepat 2 tiket terdaftar", u.tiket_uids.length, 2);
  suite.eq(
    "tiket: statistik — 1 tepat, 1 menunggu, rasio 1",
    [u.tiket_stats.slips, u.tiket_stats.hit, u.tiket_stats.pending, u.tiket_stats.hit_ratio],
    [2, 1, 1, 1],
  );
  suite.eq("tiket: laga unik 3, anggota 4", [u.tiket_stats.unique_fixtures, u.tiket_stats.total_legs], [3, 4]);
  suite.eq("tiket A: status tepat", probe.tiketA?.state, "hit");
  suite.check(
    "tiket A: gabungan irisan matriks 0,65",
    probe.tiketA?.combined_prob !== null &&
      probe.tiketA !== null &&
      dekat(probe.tiketA.combined_prob ?? NaN, 0.65),
    String(probe.tiketA?.combined_prob),
  );
  suite.eq("tiket A: nama anggota terbaca", probe.tiketA?.legs[0]?.home, "Persada FC");
  suite.eq("tiket B: status akhir tertunda walau ada meleset", probe.tiketB?.state, "pending");
  suite.eq("tiket B: has_missed_leg terpisah", probe.tiketB?.has_missed_leg, true);
  suite.check(
    "tiket B: gabungan independensi 0,576",
    probe.tiketB !== null &&
      probe.tiketB.combined_prob !== null &&
      dekat(probe.tiketB.combined_prob, 0.576),
    String(probe.tiketB?.combined_prob),
  );
  suite.eq("tiket: ID tak dikenal → null (Tiket tidak ditemukan)", probe.tiketHantu, null);

  /* Umpan builder: saringan resmi + satu baris per laga fisik */
  suite.eq(
    "builder: tepat 3 pilihan resmi pra-laga (p1, p2, d1)",
    probe.praLaga.map((p) => p.pick_uid).sort(),
    ["pick_k7_d1", "pick_k7_p1", "pick_k7_p2"],
  );
  const dup = probe.praLaga.find((p) => p.fixture_uid === "fx_k7_dup");
  suite.eq("builder: laga fisik tampil sekali dengan peluang terbit 0,81", dup?.published_prob, 0.81);

  settleFixtureEnv(env, suite.failedCount > 0);
  suite.finish();
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
