/**
 * SUITE LANGKAH 5 REDESAIN — Pilihan (§3D) + Rekam hasil (§3E).
 *
 * Tiga lapisan bukti:
 * - M (matematika): regresi brief §3D.5 pada fixture matriks sintetis
 *   berlabel — Bengaluru 76,1% + Maksimal tiga gol 74,9% → irisan
 *   52,9%; + Shabab 87,2% → gabungan 46,1%. Nilai matriks dicatat di
 *   MATRIKS_REGRESI di bawah dan di laporan langkah 5.
 * - D (draf): aturan murni lib/web/draf.ts — serial/parse/pulih dua
 *   tingkat (pick_uid → kunci semantik), entri hilang terhitung.
 * - R (rekam): kalimatRingkasan persis pola §3E.2 + partisi tab
 *   kelompokkanTabRekam (tab hanya mengatur daftar).
 * - S (sandbox): adapter nyata (umpan builder + ambilRekam) lewat
 *   probe subproses pada data terisolasi — termasuk keadaan 0/74.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  createFixtureEnv,
  buildCoreSchemas,
  runScript,
  settleFixtureEnv,
  Suite,
  type FixtureEnv,
} from "./helpers/fixture-env";
import { seedPaketObjek, seedPicks, picksArsip19Nov, paketArsip, type PickSeed } from "./helpers/redesain-seeds";
import { combineSlip, evaluateSelection, type SlipPick } from "../lib/web/parlay";
import {
  KUNCI_DRAF,
  VERSI_DRAF,
  kunciSemantikPilihan,
  parseDraf,
  pulihkanDraf,
  serialDraf,
  type EntriDraf,
} from "../lib/web/draf";
import { pct } from "../lib/web/format";
import {
  kalimatRingkasan,
  kelompokkanTabRekam,
  type BarisRekam,
} from "../lib/web/rekam";
import type { CohortStats } from "../lib/picks/cohort";

const suite = new Suite("redesain-pilihan-rekam");
let gagal = false;
const dekat = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

/* ============================================================= M — matematika */

/**
 * Matriks regresi sintetis (fixture berlabel, brief §3D.5): baris =
 * gol Bengaluru (kandang), kolom = gol Mumbai City (tamu). Dibangun
 * supaya marginal + irisannya persis angka audit:
 *   P(kandang ≥1)            = 0,761
 *   P(total ≤3)              = 0,749
 *   P(kandang ≥1 ∧ total ≤3) = 0,529
 *   total seluruh sel        = 1,000
 */
const MATRIKS_REGRESI: number[][] = [
  [0.06, 0.07, 0.055, 0.035, 0.012, 0.007],
  [0.15, 0.14, 0.07, 0.045, 0.02, 0.008],
  [0.09, 0.05, 0.048, 0.026, 0.011, 0.004],
  [0.029, 0.028, 0.016, 0.009, 0.004, 0.001],
  [0.006, 0.003, 0.0015, 0.0005, 0.0003, 0.0002],
  [0.0003, 0.0001, 0.00005, 0.00003, 0.00001, 0.00001],
];

function bagianMatematika(): void {
  console.log("\n== M — regresi matematika §3D.5 (matriks sintetis) ==");
  const total = MATRIKS_REGRESI.flat().reduce((a, b) => a + b, 0);
  suite.check("M0 matriks berjumlah 1", dekat(total, 1), String(total));
  suite.check(
    "M1 marginal Bengaluru mencetak gol = 76,1%",
    dekat(evaluateSelection(MATRIKS_REGRESI, "team_over05_home", "yes") ?? -1, 0.761),
  );
  suite.check(
    "M2 marginal Maksimal tiga gol = 74,9%",
    dekat(evaluateSelection(MATRIKS_REGRESI, "ou35", "under") ?? -1, 0.749),
  );
  const b1: SlipPick = {
    key: "b1", matchId: "fx_bengaluru", market: "team_over05_home", selection: "yes",
    prob: 0.761, probBasis: "lab", matrix: MATRIKS_REGRESI,
  };
  const b2: SlipPick = {
    key: "b2", matchId: "fx_bengaluru", market: "ou35", selection: "under",
    prob: 0.749, probBasis: "lab", matrix: MATRIKS_REGRESI,
  };
  const s1: SlipPick = {
    key: "s1", matchId: "fx_shabab", market: "team_over05_home", selection: "yes",
    prob: 0.872, probBasis: "lab", matrix: null,
  };
  const dua = combineSlip([b1, b2]);
  suite.check("M3 dua pilihan satu laga → irisan 52,9%", dekat(dua.combined ?? -1, 0.529), String(dua.combined));
  suite.eq("M3 irisan ditandai eksak", dua.groups[0]?.exact, true);
  suite.eq("M3 tampil 52,9%", pct(dua.combined, 1), "52,9%");
  const tiga = combineSlip([b1, b2, s1]);
  suite.check("M4 tambah Shabab 87,2% → gabungan 46,1%", dekat(tiga.combined ?? -1, 0.461288), String(tiga.combined));
  suite.eq("M4 tampil 46,1%", pct(tiga.combined, 1), "46,1%");
  suite.eq("M4 dua kelompok laga", tiga.groups.length, 2);

  console.log("\n== M — gabungan tidak tersedia (§3D.4) ==");
  const tanpaMatriks = combineSlip([
    { ...b1, matrix: null },
    { ...b2, matrix: null },
  ]);
  suite.eq("M5 satu laga dua pilihan tanpa matriks → combined null", tanpaMatriks.combined, null);
  suite.check(
    "M5 alasan menyebut matriks tidak tersedia",
    (tanpaMatriks.alasanGabungan ?? "").includes("matriks skor tidak tersedia"),
    tanpaMatriks.alasanGabungan ?? "",
  );
  suite.eq("M5 grup ditandai unavailable", tanpaMatriks.groups[0]?.unavailable, true);
  const campur = combineSlip([{ ...b1, matrix: null }, { ...b2, matrix: null }, s1]);
  suite.eq("M6 satu grup unavailable → gabungan keseluruhan null", campur.combined, null);
  const pasarAsing = combineSlip([
    b1,
    { key: "x", matchId: "fx_bengaluru", market: "pasar_asing", selection: "yes", prob: 0.5, probBasis: "lab", matrix: MATRIKS_REGRESI },
  ]);
  suite.eq("M7 pasar tak dikenal matriks → combined null", pasarAsing.combined, null);
  const tunggal = combineSlip([{ ...b1, matrix: null }]);
  suite.check("M8 pilihan tunggal tanpa matriks tetap angka tersimpan", dekat(tunggal.combined ?? -1, 0.761));
}

/* ============================================================= D — draf murni */

function bagianDraf(): void {
  console.log("\n== D — draf persisten (§3D.3) ==");
  suite.eq("D0 kunci penyimpanan", KUNCI_DRAF, "bola:draf-pilihan");
  const entri: EntriDraf[] = [
    { pickUid: "pk_1", kunciSemantik: "uidA|ou15|1.5|over" },
    { pickUid: "pk_2", kunciSemantik: "uidB|btts||yes" },
  ];
  const bulat = parseDraf(serialDraf(entri));
  suite.eq("D1 serial→parse pulih utuh", bulat, entri);
  suite.eq("D2 versi asing ditolak", parseDraf(JSON.stringify({ versi: VERSI_DRAF + 1, entri })), null);
  suite.eq("D3 JSON rusak → null (tanpa draf)", parseDraf("{bukan json"), null);
  suite.eq("D4 string kosong → null", parseDraf(""), null);
  const duplikat = parseDraf(
    serialDraf([entri[0], { pickUid: "pk_9", kunciSemantik: entri[0].kunciSemantik }]),
  );
  suite.eq("D5 kunci semantik ganda ter-dedupe saat simpan", duplikat?.length, 1);
  const banyak: EntriDraf[] = Array.from({ length: 15 }, (_, i) => ({
    pickUid: `pk_${i}`,
    kunciSemantik: `uid${i}|ou15|1.5|over`,
  }));
  suite.eq("D6 simpanan dipotong pada batas 12", parseDraf(serialDraf(banyak))?.length, 12);

  const umpan = [
    { key: "pk_1", kunciSemantik: "uidA|ou15|1.5|over" },
    { key: "pk_2b", kunciSemantik: "uidB|btts||yes" }, // perwakilan edisi berganti
    { key: "pk_3", kunciSemantik: "uidC|dc||1x" },
  ];
  const r1 = pulihkanDraf(entri, umpan);
  suite.eq("D7 pulih lewat uid + lewat kunci semantik", r1.pulih.map((p) => p.key), ["pk_1", "pk_2b"]);
  suite.eq("D7 tidak ada yang hilang", r1.hilang, 0);
  const r2 = pulihkanDraf(
    [...entri, { pickUid: "pk_hilang", kunciSemantik: "uidZ|1x2||1" }],
    umpan,
  );
  suite.eq("D8 entri tak tersedia terhitung hilang", r2.hilang, 1);
  suite.eq("D8 yang pulih tetap dua", r2.pulih.length, 2);
  suite.eq(
    "D9 kunci semantik sejalan bentuk umpan rekam",
    kunciSemantikPilihan("uidA", "ou15", "1.5", "over"),
    "uidA|ou15|1.5|over",
  );
}

/* ============================================================= R — rekam murni */

function statsFabrikasi(over: Partial<CohortStats>): CohortStats {
  return {
    filter: {},
    issued: 0, settled: 0, hits: 0, misses: 0, hit_ratio: null, empty: true,
    due: 0, coverage: null, coverage_ratio: null, voids: 0,
    not_started: 0, awaiting_window: 0, overdue_pending: 0, overdue_by_reason: {},
    prob_slice: { n: 0, avg_published_prob: null, avg_hit: null, legacy_hitmiss_only: 0 },
    ...over,
  };
}

function barisFabrikasi(over: Partial<BarisRekam>): BarisRekam {
  return {
    pick_id: 1, pick_uid: "pk", match_id: "m1", fixture_uid: "uid1",
    home: "Kandang FC", away: "Tamu FC", competition_name: "Liga Uji",
    competition_canonical_id: "sm:1", kickoff_utc: "2026-11-20T12:00:00.000Z",
    market: "ou15", selection: "over", line: "1.5", grade: "A",
    gate_status: "calibrated", published_prob: 0.8, probability_basis: "effective",
    published_display: 0.8, published_at_utc: "2026-11-19T10:00:00.000Z",
    model_version: null, package_id: null, home_goals: 2, away_goals: 1,
    keadaan: "tepat", alasan_jatuh_tempo: null,
    ...over,
  };
}

function bagianRekamMurni(): void {
  console.log("\n== R — kalimat ringkasan §3E.2 ==");
  const contoh = kalimatRingkasan(
    statsFabrikasi({
      issued: 5142, settled: 1321, hits: 995, misses: 326,
      hit_ratio: 995 / 1321, empty: false, due: 5142,
      coverage: [1321, 5142], coverage_ratio: 1321 / 5142,
      not_started: 100, awaiting_window: 50, overdue_pending: 3821,
    }),
    175,
  );
  suite.eq("R1 kalimat utama contoh brief", contoh.utama, "995 dari 1.321 pilihan tepat (75,3%) di 175 laga");
  suite.eq(
    "R1 kalimat cakupan contoh brief",
    contoh.cakupan,
    "Dari 5.142 pilihan yang sudah waktunya dinilai, 1.321 sudah memiliki hasil (25,7%).",
  );
  const nol74 = kalimatRingkasan(
    statsFabrikasi({ issued: 74, due: 74, coverage: [0, 74], coverage_ratio: 0, overdue_pending: 74 }),
    0,
  );
  suite.eq("R2 0/74: utama = keterangan kosong §5", nol74.utama, "Belum ada pilihan yang sudah dinilai untuk periode ini.");
  suite.eq(
    "R2 0/74: cakupan menyebut 0 dari 74 (cakupan, bukan akurasi)",
    nol74.cakupan,
    "Dari 74 pilihan yang sudah waktunya dinilai, 0 sudah memiliki hasil (0%).",
  );
  const semuaMeleset = kalimatRingkasan(
    statsFabrikasi({ settled: 5, hits: 0, misses: 5, hit_ratio: 0, empty: false, due: 5, coverage: [5, 5], coverage_ratio: 1 }),
    3,
  );
  suite.eq("R3 0% sah bila ada yang dinilai dan semua meleset", semuaMeleset.utama, "0 dari 5 pilihan tepat (0%) di 3 laga");
  const belumJatuhTempo = kalimatRingkasan(statsFabrikasi({ issued: 6, not_started: 6 }), 0);
  suite.eq("R4 belum ada jatuh tempo → kalimat cakupan null", belumJatuhTempo.cakupan, null);
  suite.eq("R4 menunggu terhitung", belumJatuhTempo.menunggu, 6);

  console.log("\n== R — partisi tab kelompokkanTabRekam ==");
  const baris: BarisRekam[] = [
    barisFabrikasi({ pick_id: 1, keadaan: "tepat", fixture_uid: "uidA", match_id: "sm_a" }),
    barisFabrikasi({ pick_id: 2, keadaan: "meleset", fixture_uid: "uidA", match_id: "mt_a", home_goals: 2, away_goals: 1 }),
    barisFabrikasi({ pick_id: 3, keadaan: "tepat", fixture_uid: "uidB", match_id: "sm_b", kickoff_utc: "2026-11-19T12:00:00.000Z" }),
    barisFabrikasi({ pick_id: 4, keadaan: "belum-mulai", home_goals: null, away_goals: null }),
    barisFabrikasi({ pick_id: 5, keadaan: "menunggu-jendela", home_goals: null, away_goals: null }),
    barisFabrikasi({ pick_id: 6, keadaan: "jatuh-tempo", home_goals: null, away_goals: null }),
    barisFabrikasi({ pick_id: 7, keadaan: "batal", home_goals: null, away_goals: null }),
  ];
  const tab = kelompokkanTabRekam(baris);
  suite.eq("R5 dua alias satu laga fisik → satu kelompok dinilai", tab.dinilai.length, 2);
  suite.eq("R5 kelompok pertama berisi dua baris alias", tab.dinilai[0]?.baris.length, 2);
  suite.eq("R5 kelompok mempertahankan urutan baris (terbaru dulu)", tab.dinilai[0]?.kunci, "uidA");
  suite.eq("R5 menunggu mendatang terpisah", tab.menungguMendatang.length, 1);
  suite.eq("R5 menunggu lewat (jendela + jatuh tempo) terpisah", tab.menungguLewat.length, 2);
  suite.eq("R5 batal terpisah", tab.batal.length, 1);
  suite.eq(
    "R5 partisi lengkap (dinilai + menunggu + batal = semua baris)",
    tab.hitungan.dinilai + tab.hitungan.menunggu + tab.hitungan.batal,
    baris.length,
  );
}

/* ============================================================= S — sandbox */

function runProbe<T>(env: FixtureEnv, aksi: string): T {
  const res = runScript(env, "tests/helpers/redesain5-probe.ts", [aksi]);
  const line = res.stdout.split("\n").find((l) => l.startsWith("PROBE_JSON "));
  if (!line) {
    throw new Error(`probe ${aksi} gagal (code ${res.code}): ${res.stderr.slice(-800)}`);
  }
  return JSON.parse(line.slice("PROBE_JSON ".length)) as T;
}

async function siapkanSkema(env: FixtureEnv): Promise<void> {
  process.chdir(env.root);
  const { ledger } = await buildCoreSchemas();
  const publication = await import("../lib/picks/publication");
  const tickets = await import("../lib/picks/tickets");
  publication.ensurePublicationSchema(ledger.getPicksDb());
  tickets.ensureTicketSchema(ledger.getPicksDb());
  const identity = await import("../lib/identity/fixture-resolver");
  const ds = new DatabaseSync(path.join(env.dataDir, "thestats_dataset.db"));
  identity.ensureIdentitySchema(ds);
  ds.close();
  fs.writeFileSync(path.join(env.dataDir, "fixture-links.json"), JSON.stringify({ links: [] }));
}

interface ProbeRekam {
  semua: {
    issued: number; settled: number; hits: number; due: number; voids: number;
    kalimatUtama: string; kalimatCakupan: string | null;
    tab: {
      dinilaiPilihan: number; menungguPilihan: number; batalPilihan: number;
      kelompokDinilai: { kunci: string; n: number }[];
      menungguLewat: number; menungguMendatang: number; partisi: boolean;
    };
  };
  f19: {
    issued: number; settled: number; hitRatio: number | null;
    kalimatUtama: string; kalimatCakupan: string | null;
    tab: { dinilaiPilihan: number; menungguLewat: number; batalPilihan: number; partisi: boolean };
  };
}

async function bagianSandboxRekam(): Promise<void> {
  console.log("\n== S — sandbox rekam (0/74 + campuran) ==");
  const env = createFixtureEnv("rdl5rekam");
  try {
    await siapkanSkema(env);
    const picks = picksArsip19Nov();
    const paketIds = new Map<string, number>();
    {
      const perMatch = new Map<string, string>();
      for (const p of picks) perMatch.set(p.match_id, p.kickoff_utc);
      const ids = seedPaketObjek(env, [...perMatch.entries()].map(([m, ko]) => paketArsip(m, ko)));
      for (const [m, id] of ids) paketIds.set(m, id);
    }
    // Skenario campuran: dua laga selesai (3 pilihan dinilai) + 1 batal.
    const ekstra: PickSeed[] = [
      {
        match_id: "rd_l5_x", market: "ou15", selection: "over", line: "1.5",
        model_prob: 0.8, market_prob: null, sm_prob: null, published_prob: 0.8,
        probability_basis: "effective", published_at_utc: "2026-11-19T10:00:00.000Z",
        grade: "A", gate_status: "calibrated", pick_uid: "pk_l5x1",
        competition_canonical_id: "sm:9999", kickoff_utc: "2026-11-20T12:00:00.000Z",
        package_id: null, fixture_uid: "uid-l5-x",
      },
      {
        match_id: "rd_l5_x", market: "1x2", selection: "2", line: "",
        model_prob: 0.3, market_prob: null, sm_prob: null, published_prob: 0.3,
        probability_basis: "effective", published_at_utc: "2026-11-19T10:00:00.000Z",
        grade: "B", gate_status: "calibrated", pick_uid: "pk_l5x2",
        competition_canonical_id: "sm:9999", kickoff_utc: "2026-11-20T12:00:00.000Z",
        package_id: null, fixture_uid: "uid-l5-x",
      },
      {
        match_id: "rd_l5_y", market: "dc", selection: "1x", line: "",
        model_prob: 0.9, market_prob: null, sm_prob: null, published_prob: 0.9,
        probability_basis: "effective", published_at_utc: "2026-11-19T10:00:00.000Z",
        grade: "A", gate_status: "calibrated", pick_uid: "pk_l5y1",
        competition_canonical_id: "sm:9999", kickoff_utc: "2026-11-20T15:00:00.000Z",
        package_id: null, fixture_uid: "uid-l5-y",
      },
      {
        match_id: "rd_l5_z", market: "btts", selection: "yes", line: "",
        model_prob: 0.7, market_prob: null, sm_prob: null, published_prob: 0.7,
        probability_basis: "effective", published_at_utc: "2026-11-19T10:00:00.000Z",
        grade: "A", gate_status: "calibrated", pick_uid: "pk_l5z1",
        competition_canonical_id: "sm:9999", kickoff_utc: "2026-11-20T18:00:00.000Z",
        package_id: null, fixture_uid: "uid-l5-z",
      },
    ];
    const idsEkstra = seedPaketObjek(env, [
      paketArsip("rd_l5_x", "2026-11-20T12:00:00.000Z"),
      paketArsip("rd_l5_y", "2026-11-20T15:00:00.000Z"),
      paketArsip("rd_l5_z", "2026-11-20T18:00:00.000Z"),
    ]);
    seedPicks(env, [
      ...picks.map((p) => ({ ...p, package_id: paketIds.get(p.match_id) ?? null })),
      ...ekstra.map((p) => ({ ...p, package_id: idsEkstra.get(p.match_id) ?? null })),
    ]);
    {
      const db = new DatabaseSync(path.join(env.dataDir, "picks.db"));
      const idDari = (uid: string) =>
        (db.prepare("SELECT id FROM picks WHERE pick_uid = ?").get(uid) as { id: number }).id;
      const ins = db.prepare(
        "INSERT INTO pick_outcomes (pick_id, resolved_utc, home_goals, away_goals, hit) VALUES (?, ?, ?, ?, ?)",
      );
      ins.run(idDari("pk_l5x1"), "2026-11-20T20:00:00.000Z", 2, 1, 1); // OU1.5 over, 2–1 → tepat
      ins.run(idDari("pk_l5x2"), "2026-11-20T20:00:00.000Z", 2, 1, 0); // tamu menang → meleset
      ins.run(idDari("pk_l5y1"), "2026-11-20T22:00:00.000Z", 1, 0, 1); // DC 1X, 1–0 → tepat
      db.prepare(
        "INSERT INTO pick_voids (pick_id, fixture_uid, voided_utc, reason, policy_version) VALUES (?, ?, ?, ?, ?)",
      ).run(idDari("pk_l5z1"), "uid-l5-z", "2026-11-20T19:00:00.000Z", "laga dibatalkan", "v1");
      db.close();
    }

    const a = runProbe<ProbeRekam>(env, "rekam");
    suite.eq("S1 semua: 84 terbit", a.semua.issued, 84);
    suite.eq("S1 semua: 3 dinilai, 2 tepat", [a.semua.settled, a.semua.hits], [3, 2]);
    suite.eq("S1 kalimat utama campuran", a.semua.kalimatUtama, "2 dari 3 pilihan tepat (66,7%) di 2 laga");
    suite.eq(
      "S1 kalimat cakupan campuran (due = 3 dinilai + 74 jatuh tempo)",
      a.semua.kalimatCakupan,
      "Dari 77 pilihan yang sudah waktunya dinilai, 3 sudah memiliki hasil (3,9%).",
    );
    suite.eq("S1 tab dinilai = 3 pilihan dalam 2 kelompok", [a.semua.tab.dinilaiPilihan, a.semua.tab.kelompokDinilai.length], [3, 2]);
    suite.eq("S1 kelompok terbaru dulu (laga Y 15.00 sebelum X 12.00)", a.semua.tab.kelompokDinilai[0]?.kunci, "uid-l5-y");
    suite.eq("S1 tab menunggu = 74 lewat + 6 mendatang", [a.semua.tab.menungguLewat, a.semua.tab.menungguMendatang], [74, 6]);
    suite.eq("S1 tab batal = 1", a.semua.tab.batalPilihan, 1);
    suite.eq("S1 partisi tab lengkap", a.semua.tab.partisi, true);

    suite.eq("S2 19 Nov: 74 terbit, 0 dinilai", [a.f19.issued, a.f19.settled], [74, 0]);
    suite.eq("S2 19 Nov: hit_ratio null (0% akurasi tidak tercetak)", a.f19.hitRatio, null);
    suite.eq("S2 19 Nov: kalimat utama = keterangan kosong", a.f19.kalimatUtama, "Belum ada pilihan yang sudah dinilai untuk periode ini.");
    suite.eq(
      "S2 19 Nov: kalimat cakupan 0/74",
      a.f19.kalimatCakupan,
      "Dari 74 pilihan yang sudah waktunya dinilai, 0 sudah memiliki hasil (0%).",
    );
    suite.eq("S2 19 Nov: tab dinilai kosong, 74 menunggu lewat, 0 batal",
      [a.f19.tab.dinilaiPilihan, a.f19.tab.menungguLewat, a.f19.tab.batalPilihan], [0, 74, 0]);
    suite.eq("S2 19 Nov: partisi tab lengkap", a.f19.tab.partisi, true);
  } catch (e) {
    gagal = true;
    suite.check("S sandbox rekam berjalan", false, e instanceof Error ? e.message : String(e));
  } finally {
    settleFixtureEnv(env, gagal || suite.failedCount > 0);
  }
}

interface ProbeUmpan {
  total: number;
  baris: { pick_uid: string; match_id: string; fixture_uid: string; market: string; selection: string; line: string; kunciSemantik: string }[];
}

async function bagianSandboxUmpan(): Promise<void> {
  console.log("\n== S — sandbox umpan builder (dedupe alias + garis) ==");
  const env = createFixtureEnv("rdl5umpan");
  try {
    await siapkanSkema(env);
    const KO = "2026-11-22T14:00:00.000Z";
    const paket = (matchId: string, home: string, away: string) => ({
      fixture: {
        match_id: matchId, competition_id: "sm:1", competition_name: "Liga Uji L5",
        home, away, kickoff_utc: KO,
      },
      score_matrix: MATRIKS_REGRESI,
      market: null,
      sm_panel: null,
    });
    const ids = seedPaketObjek(env, [
      paket("rd_l5_beng", "Bengaluru FC", "Mumbai City"),
      paket("rd_l5_sha", "Shabab Al Ahli Dubai", "Ajman"),
      paket("rd_l5_sm", "Olympique Marseille", "Le Mans"),
      paket("rd_l5_mt", "Olympique de Marseille", "Le Mans"),
    ]);
    const dasar: Omit<PickSeed, "match_id" | "market" | "selection" | "line" | "published_prob" | "pick_uid" | "fixture_uid"> = {
      model_prob: 0.8, market_prob: null, sm_prob: null, probability_basis: "effective",
      published_at_utc: "2026-11-21T10:00:00.000Z", grade: "A", gate_status: "calibrated",
      competition_canonical_id: "sm:1", kickoff_utc: KO, package_id: null,
    };
    seedPicks(env, [
      { ...dasar, match_id: "rd_l5_beng", market: "team_over05_home", selection: "yes", line: "", published_prob: 0.761, pick_uid: "pk_l5b1", fixture_uid: "uid-l5-beng", package_id: ids.get("rd_l5_beng") ?? null },
      { ...dasar, match_id: "rd_l5_beng", market: "ou35", selection: "under", line: "3.5", published_prob: 0.749, pick_uid: "pk_l5b2", fixture_uid: "uid-l5-beng", package_id: ids.get("rd_l5_beng") ?? null },
      { ...dasar, match_id: "rd_l5_sha", market: "team_over05_home", selection: "yes", line: "", published_prob: 0.872, pick_uid: "pk_l5s1", fixture_uid: "uid-l5-sha", package_id: ids.get("rd_l5_sha") ?? null },
      { ...dasar, match_id: "rd_l5_sm", market: "ou15", selection: "over", line: "1.5", published_prob: 0.855, pick_uid: "pk_l5a_sm", fixture_uid: "uid-l5-alias", package_id: ids.get("rd_l5_sm") ?? null },
      { ...dasar, match_id: "rd_l5_mt", market: "ou15", selection: "over", line: "1.5", published_prob: 0.855, pick_uid: "pk_l5a_mt", fixture_uid: "uid-l5-alias", package_id: ids.get("rd_l5_mt") ?? null },
    ]);
    const u = runProbe<ProbeUmpan>(env, "umpan");
    suite.eq("S3 umpan: alias melebur — 4 kejadian unik dari 5 baris", u.total, 4);
    const alias = u.baris.filter((b) => b.fixture_uid === "uid-l5-alias");
    suite.eq("S3 kejadian alias tampil SATU kali", alias.length, 1);
    suite.eq("S3 kunci semantik alias utuh", alias[0]?.kunciSemantik, "uid-l5-alias|ou15|1.5|over");
    suite.check("S3 semua baris membawa garis (kunci semantik lengkap)", u.baris.every((b) => typeof b.line === "string"));
    const beng = u.baris.filter((b) => b.fixture_uid === "uid-l5-beng");
    suite.eq("S3 dua kejadian Bengaluru utuh", beng.length, 2);
    // Draf yang disimpan lewat perwakilan lama pulih lewat kunci semantik.
    const pulih = pulihkanDraf(
      [{ pickUid: "pk_ SUDAH-TIDAK-ADA", kunciSemantik: "uid-l5-alias|ou15|1.5|over" }],
      u.baris.map((b) => ({ key: b.pick_uid, kunciSemantik: b.kunciSemantik })),
    );
    suite.eq("S4 draf pulih lewat kunci semantik pada umpan nyata", pulih.pulih.length, 1);
    suite.eq("S4 tidak ada yang hilang", pulih.hilang, 0);
  } catch (e) {
    gagal = true;
    suite.check("S sandbox umpan berjalan", false, e instanceof Error ? e.message : String(e));
  } finally {
    settleFixtureEnv(env, gagal || suite.failedCount > 0);
  }
}

/**
 * Bagian sandbox berjalan sebagai PROSES TERPISAH (suite memanggil
 * dirinya sendiri): getter DB repo meng-cache koneksi per proses,
 * jadi dua sandbox dalam satu proses saling mengotori — pola yang
 * sama dengan suite reproduksi langkah 1. Tanpa argumen = bagian
 * murni di proses ini + kedua bagian sandbox sebagai subproses.
 */
async function main(): Promise<void> {
  const pilihan = process.argv[2];
  if (!pilihan) {
    bagianMatematika();
    bagianDraf();
    bagianRekamMurni();
    const { spawnSync } = await import("node:child_process");
    const { REPO_ROOT } = await import("./helpers/fixture-env");
    const pathMod = await import("node:path");
    let kode = suite.failedCount > 0 ? 1 : 0;
    for (const k of ["sandbox-rekam", "sandbox-umpan"]) {
      const res = spawnSync(
        pathMod.join(REPO_ROOT, "node_modules", ".bin", "tsx"),
        [pathMod.join(REPO_ROOT, "tests/test-redesain-pilihan-rekam.ts"), k],
        { cwd: REPO_ROOT, stdio: "inherit", env: { ...process.env } },
      );
      if ((res.status ?? 1) !== 0) kode = 1;
    }
    if (kode !== 0) gagal = true;
    suite.finish();
  }
  if (pilihan === "sandbox-rekam") await bagianSandboxRekam();
  else if (pilihan === "sandbox-umpan") await bagianSandboxUmpan();
  else {
    console.error(`bagian tidak dikenal: ${pilihan}`);
    process.exit(2);
  }
  suite.finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
