/**
 * TEST:UI — suite K6 (U01–U03) di atas sandbox fixture.
 *
 * U01 · Pengelompokan & zona: laga 00.30 WIB masuk kelompok tanggal
 *   WIB-nya (bukan tanggal UTC); urutan stabil kickoff → prioritas
 *   liga → nama kompetisi → id; filter jadwal pulih dari query URL
 *   dengan default terdokumentasi; label "Hari ini" mengikuti zona.
 * U02 · Tujuh status tampil dengan label Indonesia yang berbeda-beda;
 *   cancelled TIDAK PERNAH menampilkan skor walau baris sumber
 *   membawanya; abandoned menampilkan skor parsial; postponed
 *   mempertahankan jadwal asal + jadwal ulang; unknown tidak ditebak.
 * U03 · Detail: identitas mengikuti fixture_uid (K1); pilihan yang
 *   tertaut hanya pilihan RESMI K2 (pick_uid, peluang terbit beku);
 *   tiket yang tertaut hanya slip RESMI K3; laga katalog tanpa paket
 *   tetap punya info (detail paket null, bukan 404 data).
 *
 * Fungsi murni (format/jadwal/status) dinilai langsung; perilaku
 * adapter dinilai lewat probe subprocess di sandbox (pola web-probe).
 *
 * Pakai: npm run test:web (suite ini dirantai sesudah test-web.ts)
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  Suite,
  buildCoreSchemas,
  createFixtureEnv,
  runScript,
  seedDatasetTeams,
  settleFixtureEnv,
  type FixtureEnv,
  type RunResult,
} from "./helpers/fixture-env";
import { displayStatus, STATUS_LABEL_ID, skorTerlihat } from "../lib/web/status";
import {
  int,
  judulBeranda,
  kunciTanggal,
  labelHari,
  labelPilihan,
  num,
  pct,
  tanggalJamWib,
  tanggalZona,
} from "../lib/web/format";
import {
  jendelaTanggalUtc,
  kelompokPerTanggal,
  parseFilterJadwal,
  queryJadwal,
} from "../lib/web/jadwal";

/* ------------------------------------------------------------ probe types */

interface JadwalProbe {
  match_id: string;
  fixture_uid: string | null;
  competition_name: string;
  kickoff_utc: string;
  status: string;
  home_goals: number | null;
  away_goals: number | null;
  jadwal_asal_utc: string | null;
  jadwal_ulang_utc: string | null;
  package_id: number | null;
}
interface UiProbe {
  schedule: JadwalProbe[];
  states: Record<string, { status: string; home_goals: number | null; away_goals: number | null } | null>;
  packDetail: {
    fixtureUid: string | null;
    officialPicks: {
      pick_uid: string;
      published_prob: number | null;
      probability_basis: string | null;
    }[];
    officialTickets: { slip_uid: string; combined_prob: number | null }[];
  } | null;
  detailCatalogOnly: unknown;
  infoCatalogOnly: { home: string; away: string; status: string } | null;
  infoUnknown: unknown;
  cakupan: { dariUtc: string; sampaiUtc: string } | null;
}

function runUiProbe(env: FixtureEnv): UiProbe {
  const res: RunResult = runScript(env, "tests/helpers/ui-probe.ts");
  const line = res.stdout.split("\n").find((l) => l.startsWith("PROBE_JSON "));
  if (!line) {
    throw new Error(
      `ui-probe tidak menghasilkan PROBE_JSON (exit=${res.code}): ${res.stdout} ${res.stderr}`,
    );
  }
  return JSON.parse(line.slice("PROBE_JSON ".length)) as UiProbe;
}

/* ------------------------------------------------------------------ seed */

const KICK = {
  dinihari: "2026-11-20T17:30:00.000Z", // 00.30 WIB 21 Nov
  pagi: "2026-11-21T02:00:00.000Z",
  pack: "2026-11-21T04:00:00.000Z",
  seri: "2026-11-21T05:00:00.000Z",
  abandoned: "2026-11-21T06:00:00.000Z",
  live: "2026-11-21T07:00:00.000Z",
  postponed: "2026-11-21T08:00:00.000Z",
  cancelled: "2026-11-21T10:00:00.000Z",
  unknown: "2026-11-21T12:00:00.000Z",
  ulang: "2026-11-25T08:00:00.000Z",
} as const;

async function buildSandbox(): Promise<FixtureEnv> {
  const env = createFixtureEnv("k6ui");
  process.chdir(env.root);
  const { ledger } = await buildCoreSchemas();

  // Skema K2/K3 pada picks.db sandbox (kolom beku + tabel slip).
  const publication = await import("../lib/picks/publication");
  const tickets = await import("../lib/picks/tickets");
  const pdb = ledger.getPicksDb();
  publication.ensurePublicationSchema(pdb);
  tickets.ensureTicketSchema(pdb);

  // Registry liga fixture: "Liga Prioritas" punya fit, "Liga Zeta" tidak.
  fs.writeFileSync(
    path.join(env.dataDir, "league-canonical.json"),
    JSON.stringify({
      version: 1,
      generated_at: "2026-11-18T00:00:00.000Z",
      generator: "tests/test-ui.ts (K6 fixture)",
      leagues: [
        { canonical_id: "comp_k6_a", name: "Liga Prioritas", country: "Indonesia", fits: [{ system: "legacy-div" }], aliases: [] },
        { canonical_id: "comp_k6_b", name: "Liga Zeta", country: "Indonesia", fits: [], aliases: [] },
      ],
    }),
  );
  fs.writeFileSync(path.join(env.dataDir, "fixture-links.json"), JSON.stringify({ links: [] }));

  // Store identitas K1: pasangan tunda/jadwal-ulang + laga berpaket.
  const identity = await import("../lib/identity/fixture-resolver");
  const ds = new DatabaseSync(path.join(env.dataDir, "thestats_dataset.db"));
  identity.ensureIdentitySchema(ds);
  const insFixture = ds.prepare(
    `INSERT INTO canonical_fixtures (fixture_uid, competition_id, home_name, away_name,
       kickoff_utc, created_at, updated_at) VALUES (?, 'comp_k6_a', ?, ?, ?, ?, ?)`,
  );
  insFixture.run("fx_k6_post", "Tim Tunda", "Tim Geser", KICK.postponed, "2026-11-18T00:00:00.000Z", "2026-11-18T00:00:00.000Z");
  insFixture.run("fx_k6_pack", "Persada FC", "Rawa United", KICK.pack, "2026-11-18T00:00:00.000Z", "2026-11-18T00:00:00.000Z");
  const insAlias = ds.prepare(
    `INSERT INTO fixture_aliases (source, source_match_id, fixture_uid, match_basis,
       first_seen_utc, last_seen_utc) VALUES ('sportmonks', ?, ?, 'k6-fixture', ?, ?)`,
  );
  insAlias.run("sm_k6_postponed", "fx_k6_post", "2026-11-18T00:00:00.000Z", "2026-11-18T00:00:00.000Z");
  insAlias.run("sm_k6_rescheduled", "fx_k6_post", "2026-11-18T00:00:00.000Z", "2026-11-18T00:00:00.000Z");
  insAlias.run("sm_k6_pack", "fx_k6_pack", "2026-11-18T00:00:00.000Z", "2026-11-18T00:00:00.000Z");
  ds.close();

  // Katalog jadwal.
  const up = new DatabaseSync(path.join(env.dataDir, "upcoming_fixtures.db"));
  const insUp = up.prepare(
    `INSERT INTO upcoming_fixtures (match_id, competition_id, competition_name,
       competition_country, utc_date, status, home_team_name, away_team_name, fetched_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-11-18T00:00:00.000Z')`,
  );
  insUp.run("sm_k6_dinihari", "smc_1", "Bundesliga", "Germany", KICK.dinihari, "scheduled", "Borussia Mönchengladbach", "1. FC Heidenheim 1846");
  insUp.run("sm_k6_pagi", "smc_2", "Liga Prioritas", "Indonesia", KICK.pagi, "scheduled", "Persada FC", "Rawa United");
  insUp.run("sm_k6_pack", "smc_2", "Liga Prioritas", "Indonesia", KICK.pack, "scheduled", "Persada FC", "Rawa United");
  insUp.run("sm_k6_tie_z", "smc_2", "Liga Prioritas", "Indonesia", KICK.seri, "scheduled", "Tim Zulu", "Tim Yankee");
  insUp.run("sm_k6_tie_a", "smc_3", "Liga Zeta", "Indonesia", KICK.seri, "scheduled", "Tim Alpha", "Tim Bravo");
  insUp.run("sm_k6_tie_c", "smc_3", "Liga Zeta", "Indonesia", KICK.seri, "scheduled", "Tim Charlie", "Tim Delta");
  insUp.run("sm_k6_live", "smc_3", "Liga Zeta", "Indonesia", KICK.live, "LIVE", "Tim Langsung", "Tim Berjalan");
  insUp.run("sm_k6_postponed", "smc_2", "Liga Prioritas", "Indonesia", KICK.postponed, "POSTPONED", "Tim Tunda", "Tim Geser");
  insUp.run("sm_k6_rescheduled", "smc_2", "Liga Prioritas", "Indonesia", KICK.ulang, "scheduled", "Tim Tunda", "Tim Geser");
  insUp.run("sm_k6_cancelled", "smc_3", "Liga Zeta", "Indonesia", KICK.cancelled, "CANCELLED", "Tim Batal", "Tim Urung");
  insUp.run("sm_k6_unknown", "smc_3", "Liga Zeta", "Indonesia", KICK.unknown, "DIALIHOFF", "Tim Aneh", "Tim Misteri");
  up.close();

  // Baris dataset: batal beracun (punya skor), dihentikan, live.
  seedDatasetTeams(env, [
    { team_id: "tm_batal", name: "Tim Batal" },
    { team_id: "tm_urung", name: "Tim Urung" },
    { team_id: "tm_sri", name: "Sriwijaya FC" },
    { team_id: "tm_psis", name: "PSIS Semarang" },
    { team_id: "tm_lang", name: "Tim Langsung" },
    { team_id: "tm_jalan", name: "Tim Berjalan" },
  ]);
  const dsm = new DatabaseSync(path.join(env.dataDir, "thestats_dataset.db"));
  const insMatch = dsm.prepare(
    `INSERT INTO matches (match_id, competition_id, season, utc_date, status,
       home_team_id, away_team_id, home_score, away_score, updated_at)
     VALUES (?, 'E0', '2026-2027', ?, ?, ?, ?, ?, ?, '2026-11-21T13:00:00.000Z')`,
  );
  insMatch.run("sm_k6_cancelled", KICK.cancelled, "cancelled", "tm_batal", "tm_urung", 3, 3);
  insMatch.run("sm_k6_abandoned", KICK.abandoned, "abandoned", "tm_sri", "tm_psis", 2, 1);
  insMatch.run("sm_k6_live", KICK.live, "live", "tm_lang", "tm_jalan", 1, 0);
  dsm.close();

  // Paket analisis untuk sm_k6_pack (angka interface_demo PRD).
  const snap = new DatabaseSync(path.join(env.dataDir, "analysis_snapshots.db"));
  const payload = {
    fixture: {
      match_id: "sm_k6_pack",
      competition_name: "Liga Prioritas",
      home: "Persada FC",
      away: "Rawa United",
      kickoff_utc: KICK.pack,
    },
    gate_status: "partial",
    population: "domestic",
    lambda: 1.46,
    mu: 1.13,
    rho: -0.08,
    probabilities: { "1x2:1": 0.46, "1x2:x": 0.29, "1x2:2": 0.25, "dc:1x": 0.75 },
    top_scores: [{ home_goals: 2, away_goals: 1, prob: 0.16 }],
    score_matrix: [[0.12]],
    market: {
      probs: { "1x2:1": 0.44 },
      captured_utc: "2026-11-21T01:30:00.000Z",
      bookmakers: ["FixtureBook"],
    },
    sm_panel: { probs: { "1x2:1": 0.5 }, batch_utc: "2026-11-10T00:00:00.000Z" },
    legs: [],
  };
  const pkgRes = snap
    .prepare(
      `INSERT INTO packages (match_id, competition_canonical_id, kickoff_utc,
         computed_utc, trigger, fit_source, gate_status, payload_json)
       VALUES ('sm_k6_pack', 'comp_k6_a', ?, '2026-11-21T01:00:00.000Z', 'manual', 'fixture', 'partial', ?)`,
    )
    .run(KICK.pack, JSON.stringify(payload));
  snap.close();
  const packageId = Number(pkgRes.lastInsertRowid);

  // Pilihan: satu RESMI (pick_uid + angka terbit beku) + satu bukan resmi.
  const pk = new DatabaseSync(path.join(env.dataDir, "picks.db"));
  const resmi = pk
    .prepare(
      `INSERT INTO picks (created_utc, match_id, competition_canonical_id, kickoff_utc,
         market, selection, model_prob, effective_prob, gate_status, grade, source,
         package_id, pick_uid, fixture_uid, line, series, published_prob,
         probability_basis, published_at_utc, decision_at_utc)
       VALUES ('2026-11-21T01:00:00.000Z', 'sm_k6_pack', 'comp_k6_a', ?, '1x2', '1',
         0.79, 0.74, 'partial', 'A', 'live-run', ?, 'pick_k6_1', 'fx_k6_pack', '', 'live-run',
         0.74, 'effective', '2026-11-21T01:05:00.000Z', '2026-11-21T01:00:00.000Z')`,
    )
    .run(KICK.pack, packageId);
  pk.prepare(
    `INSERT INTO picks (created_utc, match_id, competition_canonical_id, kickoff_utc,
       market, selection, model_prob, gate_status, grade, source, package_id)
     VALUES ('2026-11-21T01:00:00.000Z', 'sm_k6_pack', 'comp_k6_a', ?, 'ou25', 'over',
       0.66, 'partial', 'B', 'live-run', ?)`,
  ).run(KICK.pack, packageId);
  const resmiId = Number(resmi.lastInsertRowid);
  // Tiket RESMI memuat pilihan resmi; tiket umpan memuat pick_uid hantu.
  pk.prepare(
    `INSERT INTO published_slips (slip_uid, edition_key, slot, series, source,
       published_utc, policy_version, combined_prob, combined_basis, state, created_utc)
     VALUES ('slip_k6_1', '2026-11-21', 'utama', 'live-run', 'official',
       '2026-11-21T01:06:00.000Z', 'slip-status-2026-11', 0.56, 'independence', 'pending',
       '2026-11-21T01:06:00.000Z')`,
  ).run();
  pk.prepare(
    `INSERT INTO slip_legs (slip_uid, position, pick_uid, pick_id, fixture_uid, frozen_prob)
     VALUES ('slip_k6_1', 0, 'pick_k6_1', ?, 'fx_k6_pack', 0.74)`,
  ).run(resmiId);
  pk.prepare(
    `INSERT INTO published_slips (slip_uid, edition_key, slot, series, source,
       published_utc, policy_version, combined_prob, combined_basis, state, created_utc)
     VALUES ('slip_k6_umpan', '2026-11-21', 'cadangan', 'live-run', 'official',
       '2026-11-21T01:07:00.000Z', 'slip-status-2026-11', 0.5, 'independence', 'pending',
       '2026-11-21T01:07:00.000Z')`,
  ).run();
  pk.prepare(
    `INSERT INTO slip_legs (slip_uid, position, pick_uid, pick_id, fixture_uid, frozen_prob)
     VALUES ('slip_k6_umpan', 0, 'pick_hantu', ?, 'fx_k6_pack', 0.5)`,
  ).run(resmiId);
  pk.close();

  return env;
}

/* ------------------------------------------------------------------ main */

async function main(): Promise<void> {
  const suite = new Suite("test:ui (K6 U01–U03)");

  /* ---- fungsi murni: format Indonesia ---- */
  suite.eq("format: pct satu desimal koma", pct(0.725), "72,5%");
  suite.eq("format: pct bulat tanpa desimal", pct(0.75), "75%");
  suite.eq("format: odds dua desimal koma", num(2.1), "2,10");
  suite.eq("format: ribuan titik", int(45866), "45.866");
  suite.eq(
    "format: tanggal-jam WIB pola U1",
    tanggalJamWib("2026-11-20T13:00:00.000Z"),
    "Jumat, 20 November · 20.00 WIB",
  );
  suite.eq(
    "format: kunci tanggal 00.30 WIB = tanggal WIB",
    kunciTanggal(KICK.dinihari, "Asia/Jakarta"),
    "2026-11-21",
  );
  suite.eq(
    "format: kunci tanggal instant sama di UTC = tanggal UTC",
    kunciTanggal(KICK.dinihari, "UTC"),
    "2026-11-20",
  );
  const nowSabtu = new Date("2026-11-20T20:00:00.000Z"); // 03.00 WIB 21 Nov
  suite.eq("format: labelHari zona Jakarta", labelHari(KICK.dinihari, "Asia/Jakarta", nowSabtu), "Hari ini");
  suite.eq("format: labelHari mengikuti zona (laga pagi = Hari ini di WIB)", labelHari(KICK.pagi, "Asia/Jakarta", nowSabtu), "Hari ini");
  suite.eq("format: labelHari mengikuti zona (laga pagi = Besok di UTC)", labelHari(KICK.pagi, "UTC", nowSabtu), "Besok");

  /* ---- fungsi murni: judul beranda (brief §3A.1, jam dibekukan) ---- */
  suite.eq(
    "beranda: baris tanggal+zona",
    tanggalZona(new Date("2026-11-20T13:00:00.000Z")),
    "Jumat, 20 November 2026 · WIB",
  );
  suite.eq(
    "beranda: jam beku 20.00 WIB → Malam ini",
    judulBeranda(new Date("2026-11-20T13:00:00.000Z")),
    "Malam ini",
  );
  suite.eq(
    "beranda: jam beku 10.00 WIB → Pertandingan hari ini",
    judulBeranda(new Date("2026-11-20T03:00:00.000Z")),
    "Pertandingan hari ini",
  );
  suite.eq(
    "beranda: batas 18.00 WIB → Malam ini",
    judulBeranda(new Date("2026-11-20T11:00:00.000Z")),
    "Malam ini",
  );
  suite.eq(
    "beranda: batas 17.59 WIB → Pertandingan hari ini",
    judulBeranda(new Date("2026-11-20T10:59:00.000Z")),
    "Pertandingan hari ini",
  );
  suite.eq(
    "beranda: batas 05.59 WIB → Malam ini",
    judulBeranda(new Date("2026-11-20T22:59:00.000Z")),
    "Malam ini",
  );
  suite.eq(
    "beranda: batas 06.00 WIB → Pertandingan hari ini",
    judulBeranda(new Date("2026-11-20T23:00:00.000Z")),
    "Pertandingan hari ini",
  );
  suite.eq(
    "beranda: tengah malam 00.01 WIB → Malam ini",
    judulBeranda(new Date("2026-11-20T17:01:00.000Z")),
    "Malam ini",
  );

  /* ---- fungsi murni: kamus pilihan ---- */
  suite.eq("kamus: 1x2 kandang", labelPilihan("1x2", "1", "Persada FC", "Rawa United"), "Persada FC menang");
  suite.eq("kamus: seri", labelPilihan("1x2", "x", "Persada FC", "Rawa United"), "Seri");
  suite.eq("kamus: dc 1x", labelPilihan("dc", "1x", "Persada FC", "Rawa United"), "Persada FC menang atau seri");
  suite.eq("kamus: dc 12", labelPilihan("dc", "12", "Persada FC", "Rawa United"), "Salah satu tim menang");
  suite.eq("kamus: over 1.5", labelPilihan("ou15", "over", "A", "B"), "Minimal dua gol");
  suite.eq("kamus: under 2.5", labelPilihan("ou25", "under", "A", "B"), "Maksimal dua gol");
  suite.eq("kamus: btts no", labelPilihan("btts", "no", "A", "B"), "Setidaknya satu tim tidak mencetak gol");

  /* ---- fungsi murni: status (U02) ---- */
  const petaStatus: [string, string][] = [
    ["scheduled", "scheduled"],
    ["NS", "scheduled"],
    ["LIVE", "live"],
    ["FT", "finished"],
    ["finished", "finished"],
    ["POSTPONED", "postponed"],
    ["CANCELLED", "cancelled"],
    ["ABANDONED", "abandoned"],
    ["abd", "abandoned"],
    ["DIALIHOFF", "unknown"],
    ["", "unknown"],
  ];
  for (const [mentah, harap] of petaStatus) {
    suite.eq(`status: '${mentah}' → ${harap}`, displayStatus(mentah), harap);
  }
  suite.check(
    "status: tujuh label semuanya berbeda",
    new Set(Object.values(STATUS_LABEL_ID)).size === 7,
    JSON.stringify(STATUS_LABEL_ID),
  );
  suite.eq("status: label live resmi", STATUS_LABEL_ID.live, "Sedang berlangsung");
  suite.eq("skor: cancelled tidak terlihat", skorTerlihat("cancelled"), "tidak");
  suite.eq("skor: abandoned parsial", skorTerlihat("abandoned"), "parsial");
  suite.eq("skor: finished penuh", skorTerlihat("finished"), "penuh");

  /* ---- fungsi murni: filter + jendela + kelompok (U01) ---- */
  const fDefault = parseFilterJadwal({}, nowSabtu);
  suite.eq("filter: default tanggal = hari ini WIB", fDefault.tanggal, "2026-11-21");
  suite.eq("filter: default status semua", fDefault.status, "semua");
  suite.eq("filter: default zona baku", fDefault.tz, "Asia/Jakarta");
  const fInvalid = parseFilterJadwal(
    { tanggal: "2026-13-40", status: "aneh", tz: "Mars/Olympus" },
    nowSabtu,
  );
  suite.eq("filter: tanggal invalid → default", fInvalid.tanggal, "2026-11-21");
  suite.eq("filter: status invalid → semua", fInvalid.status, "semua");
  suite.eq("filter: zona invalid → baku", fInvalid.tz, "Asia/Jakarta");
  const fPenuh = parseFilterJadwal(
    { tanggal: "2026-11-22", status: "selesai", liga: " Liga Prioritas ", negara: "Indonesia", tz: "Asia/Makassar" },
    nowSabtu,
  );
  suite.eq("filter: nilai sah dipertahankan + trim", [fPenuh.tanggal, fPenuh.status, fPenuh.liga, fPenuh.negara, fPenuh.tz], ["2026-11-22", "selesai", "Liga Prioritas", "Indonesia", "Asia/Makassar"]);
  suite.eq(
    "filter: query kanonik pulih utuh",
    parseFilterJadwal(Object.fromEntries(new URLSearchParams(queryJadwal(fPenuh))), nowSabtu),
    fPenuh,
  );
  suite.eq(
    "jendela: 21 Nov WIB = 20 Nov 17.00Z s.d. 21 Nov 17.00Z",
    jendelaTanggalUtc("2026-11-21", "Asia/Jakarta"),
    { dariUtc: "2026-11-20T17:00:00.000Z", sampaiUtc: "2026-11-21T17:00:00.000Z" },
  );
  suite.eq(
    "jendela: 21 Nov UTC = tengah malam UTC",
    jendelaTanggalUtc("2026-11-21", "UTC"),
    { dariUtc: "2026-11-21T00:00:00.000Z", sampaiUtc: "2026-11-22T00:00:00.000Z" },
  );
  const duaItem = [{ kickoff_utc: KICK.dinihari }, { kickoff_utc: KICK.pagi }];
  const kelompokWib = kelompokPerTanggal(duaItem, "Asia/Jakarta", nowSabtu);
  suite.eq("kelompok: WIB satu kelompok 2026-11-21", kelompokWib.map((k) => k.kunci), ["2026-11-21"]);
  suite.eq("kelompok: label Hari ini", kelompokWib[0]?.label, "Hari ini");
  const kelompokUtc = kelompokPerTanggal(duaItem, "UTC", nowSabtu);
  suite.eq("kelompok: UTC dua kelompok", kelompokUtc.map((k) => k.kunci), ["2026-11-20", "2026-11-21"]);

  /* ---- adapter lewat probe (U01–U03) ---- */
  const env = await buildSandbox();
  const probe = runUiProbe(env);
  const byId = new Map(probe.schedule.map((i) => [i.match_id, i]));

  // U01: urutan stabil — seri kickoff sama: prioritas liga mengalahkan id,
  // lalu id di dalam liga yang sama.
  const urutanSeri = probe.schedule
    .filter((i) => i.kickoff_utc === KICK.seri)
    .map((i) => i.match_id);
  suite.eq("U01: urutan seri = prioritas liga lalu id", urutanSeri, ["sm_k6_tie_z", "sm_k6_tie_a", "sm_k6_tie_c"]);
  const urutanSemua = probe.schedule.map((i) => i.match_id);
  suite.check(
    "U01: daftar terurut kickoff menaik",
    urutanSemua.every((id, ix) => {
      const cur = byId.get(id)!;
      const prev = ix === 0 ? null : byId.get(urutanSemua[ix - 1])!;
      return !prev || prev.kickoff_utc <= cur.kickoff_utc;
    }),
    urutanSemua.join(","),
  );
  const kelompokProbe = kelompokPerTanggal(probe.schedule, "Asia/Jakarta", nowSabtu);
  const grup21 = kelompokProbe.find((k) => k.kunci === "2026-11-21");
  suite.check(
    "U01: laga 00.30 WIB berkelompok di tanggal 21",
    Boolean(grup21?.items.some((i) => i.match_id === "sm_k6_dinihari")),
    JSON.stringify(kelompokProbe.map((k) => k.kunci)),
  );
  suite.check("U01: cakupan jadwal terbaca", probe.cakupan !== null, JSON.stringify(probe.cakupan));

  // U02: status di daftar + keadaan.
  suite.eq("U02: batal di daftar tanpa skor", [byId.get("sm_k6_cancelled")?.status, byId.get("sm_k6_cancelled")?.home_goals], ["cancelled", null]);
  suite.eq("U02: keadaan batal menelan skor racun", probe.states["sm_k6_cancelled"], { status: "cancelled", home_goals: null, away_goals: null });
  suite.eq("U02: dihentikan berskor parsial", [byId.get("sm_k6_abandoned")?.status, byId.get("sm_k6_abandoned")?.home_goals, byId.get("sm_k6_abandoned")?.away_goals], ["abandoned", 2, 1]);
  suite.eq("U02: live berstatus + skor berjalan", [byId.get("sm_k6_live")?.status, byId.get("sm_k6_live")?.home_goals], ["live", 1]);
  const tunda = byId.get("sm_k6_postponed");
  suite.eq("U02: ditunda mempertahankan jadwal asal", tunda?.jadwal_asal_utc, KICK.postponed);
  suite.eq("U02: ditunda membawa jadwal ulang sibling", tunda?.jadwal_ulang_utc, KICK.ulang);
  suite.eq("U02: status asing tetap unknown", byId.get("sm_k6_unknown")?.status, "unknown");
  suite.eq("U02: dedup UID — jadwal ulang tidak menggandakan laga tunda", probe.schedule.filter((i) => i.fixture_uid === "fx_k6_post").length, 1);

  // U03: detail laga berpaket.
  suite.check("U03: detail berpaket ditemukan", probe.packDetail !== null, JSON.stringify(probe.packDetail));
  if (probe.packDetail) {
    suite.eq("U03: identitas mengikuti fixture_uid K1", probe.packDetail.fixtureUid, "fx_k6_pack");
    suite.eq(
      "U03: hanya pilihan resmi yang tertaut",
      probe.packDetail.officialPicks.map((p) => p.pick_uid),
      ["pick_k6_1"],
    );
    suite.eq(
      "U03: peluang terbit beku 0,74 basis effective",
      probe.packDetail.officialPicks[0]
        ? [probe.packDetail.officialPicks[0].published_prob, probe.packDetail.officialPicks[0].probability_basis]
        : null,
      [0.74, "effective"],
    );
    suite.eq(
      "U03: hanya tiket resmi yang tertaut (umpan gugur)",
      probe.packDetail.officialTickets.map((t) => t.slip_uid),
      ["slip_k6_1"],
    );
  }
  suite.eq("U03: laga katalog tanpa paket → detail paket null", probe.detailCatalogOnly, null);
  suite.check(
    "U03: laga katalog tanpa paket tetap punya info",
    probe.infoCatalogOnly !== null && probe.infoCatalogOnly.home === "Borussia Mönchengladbach",
    JSON.stringify(probe.infoCatalogOnly),
  );
  suite.eq("U03: ID asing → info null (404)", probe.infoUnknown, null);

  settleFixtureEnv(env, suite.failedCount > 0);
  suite.finish();
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
