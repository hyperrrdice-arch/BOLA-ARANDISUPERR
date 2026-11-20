/**
 * TEST:REDESAIN-JADWAL — Langkah 4 brief redesain: jadwal §3B +
 * detail §3C (jalur data).
 *
 * Murni (jam beku): semantik pintasan Sekarang/Malam ini/Besok,
 * filter URL bermode + pencarian pulih utuh, lipatan aksen ("koge"
 * menemukan "Køge"), urutan tampil (selesai paling baru dulu) dan
 * urutan Sekarang (live terkonfirmasi dulu).
 *
 * Probe sandbox (waktu relatif terhadap jam jalan, pola stage L3):
 * pencarian mencakup seluruh himpunan terfilter lintas tanggal;
 * detail memasangkan edisi terbit dengan skor regulasi — hasil 2–1
 * menilai BTTS 68% Tepat; koreksi skor resmi menjadi 2–0 membalik
 * vonis ke Meleset dengan angka terbit tetap 68%; baris AET dilabeli
 * pasca-regulasi dan skor 90 menit hanya dari hasil resolver.
 *
 * Pakai: npx tsx tests/test-redesain-jadwal.ts (dirantai di test:web)
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
import { seedKatalog, seedPaketObjek, seedPicks, type BarisKatalog } from "./helpers/redesain-seeds";
import {
  cocokPencarian,
  jendelaPintasan,
  lipatTeks,
  parseFilterJadwal,
  queryJadwal,
  urutSekarang,
  urutTampilJadwal,
} from "../lib/web/jadwal";
import type { StatusTampil } from "../lib/web/status";

const suite = new Suite("redesain-jadwal");

function runProbe<T>(env: FixtureEnv, args: string[]): T {
  const res: RunResult = runScript(env, "tests/helpers/redesain4-probe.ts", args);
  const line = res.stdout.split("\n").find((l) => l.startsWith("PROBE_JSON "));
  if (!line) {
    throw new Error(`probe ${args[0]} gagal (code ${res.code}): ${res.stderr.slice(-800)}`);
  }
  return JSON.parse(line.slice("PROBE_JSON ".length)) as T;
}

/* ==================================================== murni: pintasan */
const SABTU_20WIB = new Date("2026-11-21T13:00:00.000Z");
suite.eq(
  "pintasan: malam ini pada 20.00 WIB = 18.00 s.d. 06.00 WIB",
  jendelaPintasan("malam-ini", "Asia/Jakarta", SABTU_20WIB),
  { dariUtc: "2026-11-21T11:00:00.000Z", sampaiUtc: "2026-11-21T23:00:00.000Z" },
);
suite.eq(
  "pintasan: malam ini pada 00.30 WIB berawal hari sebelumnya",
  jendelaPintasan("malam-ini", "Asia/Jakarta", new Date("2026-11-21T17:30:00.000Z")),
  { dariUtc: "2026-11-21T11:00:00.000Z", sampaiUtc: "2026-11-21T23:00:00.000Z" },
);
suite.eq(
  "pintasan: malam ini pada 05.00 WIB berawal hari sebelumnya",
  jendelaPintasan("malam-ini", "Asia/Jakarta", new Date("2026-11-20T22:00:00.000Z")),
  { dariUtc: "2026-11-20T11:00:00.000Z", sampaiUtc: "2026-11-20T23:00:00.000Z" },
);
suite.eq(
  "pintasan: malam ini pada 10.00 WIB menunjuk malam tanggal aktif",
  jendelaPintasan("malam-ini", "Asia/Jakarta", new Date("2026-11-21T03:00:00.000Z")),
  { dariUtc: "2026-11-21T11:00:00.000Z", sampaiUtc: "2026-11-21T23:00:00.000Z" },
);
suite.eq(
  "pintasan: besok = tanggal kalender berikutnya sehari penuh",
  jendelaPintasan("besok", "Asia/Jakarta", SABTU_20WIB),
  { dariUtc: "2026-11-21T17:00:00.000Z", sampaiUtc: "2026-11-22T17:00:00.000Z" },
);
suite.eq(
  "pintasan: sekarang = jendela lebar di sekitar kini",
  jendelaPintasan("sekarang", "Asia/Jakarta", SABTU_20WIB),
  { dariUtc: "2026-11-21T07:00:00.000Z", sampaiUtc: "2026-11-24T13:00:00.000Z" },
);

/* ====================================================== murni: filter */
const fMode = parseFilterJadwal(
  { mode: "malam-ini", q: " koge ", tanggal: "2026-11-21" },
  SABTU_20WIB,
);
suite.eq("filter: mode pintasan terbaca", fMode.mode, "malam-ini");
suite.eq("filter: kueri di-trim", fMode.q, "koge");
suite.eq(
  "filter: mode + kueri pulih utuh dari query kanonik",
  parseFilterJadwal(Object.fromEntries(new URLSearchParams(queryJadwal(fMode))), SABTU_20WIB),
  fMode,
);
const fBaku = parseFilterJadwal({}, SABTU_20WIB);
suite.eq("filter: query baku tetap bentuk lama (tanggal saja)", queryJadwal(fBaku), "tanggal=2026-11-21");
suite.eq("filter: mode tak dikenal → tanggal", parseFilterJadwal({ mode: "lusa" }, SABTU_20WIB).mode, "tanggal");

/* =================================================== murni: pencarian */
suite.eq("lipat: Køge → koge", lipatTeks("Køge"), "koge");
suite.eq("lipat: Næstved → naestved", lipatTeks("Næstved"), "naestved");
suite.eq("lipat: São Paulo → sao paulo", lipatTeks("São Paulo"), "sao paulo");
suite.check("cari: 'koge' menemukan 'Køge'", cocokPencarian(["Køge", "Næstved"], "koge"));
suite.check("cari: 'KOGE' menemukan 'Køge'", cocokPencarian(["Køge"], "KOGE"));
suite.check("cari: liga ikut dicari", cocokPencarian(["Persada FC", "Liga Contoh"], "liga contoh"));
suite.check("cari: tak cocok → false", !cocokPencarian(["Køge"], "brondby"));

/* ===================================================== murni: urutan */
type ItemUji = { status: StatusTampil; kickoff_utc: string; id: string };
const campur: ItemUji[] = [
  { status: "finished", kickoff_utc: "2026-11-21T10:00:00.000Z", id: "selesai-lama" },
  { status: "scheduled", kickoff_utc: "2026-11-21T14:00:00.000Z", id: "nanti-2" },
  { status: "finished", kickoff_utc: "2026-11-21T12:00:00.000Z", id: "selesai-baru" },
  { status: "scheduled", kickoff_utc: "2026-11-21T13:00:00.000Z", id: "nanti-1" },
];
suite.eq(
  "urutan tampil: akan datang menaik, lalu selesai paling baru dulu",
  urutTampilJadwal(campur).map((i) => i.id),
  ["nanti-1", "nanti-2", "selesai-baru", "selesai-lama"],
);
const campurSekarang: ItemUji[] = [
  { status: "scheduled", kickoff_utc: "2026-11-21T15:00:00.000Z", id: "jadwal" },
  { status: "finished", kickoff_utc: "2026-11-21T10:00:00.000Z", id: "selesai" },
  { status: "live", kickoff_utc: "2026-11-21T12:30:00.000Z", id: "live" },
  { status: "menunggu-pembaruan", kickoff_utc: "2026-11-21T12:00:00.000Z", id: "menunggu" },
];
suite.eq(
  "urutan sekarang: live → menunggu → terjadwal; selesai dikeluarkan",
  urutSekarang(campurSekarang).map((i) => i.id),
  ["live", "menunggu", "jadwal"],
);

/* ============================================================ sandbox */
interface JadwalProbe {
  match_id: string;
  home: string;
  away: string;
  competition_name: string;
  kickoff_utc: string;
  status: string;
  home_goals: number | null;
  away_goals: number | null;
}
interface DetailProbe {
  pkgId: number;
  paketTerbitId: number | null;
  trioTerbit: { a: number | null; x: number | null; b: number | null } | null;
  keadaan: {
    status: string;
    home_goals: number | null;
    away_goals: number | null;
    pascaregulasi: string | null;
  } | null;
  picks: {
    market: string;
    selection: string;
    published_prob: number | null;
    probability_basis: string | null;
    package_id: number | null;
    hit: number | null;
    home_goals: number | null;
    away_goals: number | null;
  }[];
}

const JAM = 3_600_000;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

async function main(): Promise<void> {
  const env = createFixtureEnv("redesain4");
  let gagal = false;
  try {
    process.chdir(env.root);
    const { ledger } = await buildCoreSchemas();
    const publication = await import("../lib/picks/publication");
    const tickets = await import("../lib/picks/tickets");
    publication.ensurePublicationSchema(ledger.getPicksDb());
    tickets.ensureTicketSchema(ledger.getPicksDb());
    const identity = await import("../lib/identity/fixture-resolver");
    const ds0 = new DatabaseSync(path.join(env.dataDir, "thestats_dataset.db"));
    identity.ensureIdentitySchema(ds0);
    ds0.close();
    fs.writeFileSync(path.join(env.dataDir, "fixture-links.json"), JSON.stringify({ links: [] }));
    fs.writeFileSync(path.join(env.dataDir, "league-canonical.json"), JSON.stringify({ version: 1, leagues: [] }));
    fs.writeFileSync(path.join(env.dataDir, "team-canonical.json"), JSON.stringify({ teams: [] }));

    const katalog = (r: Partial<BarisKatalog> & { match_id: string }): BarisKatalog => ({
      competition_id: "sm:1",
      competition_name: "Liga Uji",
      competition_country: "Indonesia",
      utc_date: iso(now + 2 * JAM),
      status: "scheduled",
      stage_name: null,
      home_team_id: null,
      home_team_name: "?",
      away_team_id: null,
      away_team_name: "?",
      venue: null,
      is_neutral: null,
      odds_available: null,
      xg_available: null,
      fetched_utc: iso(now),
      ...r,
    });
    seedKatalog(env, [
      katalog({
        match_id: "sm_r4_koge",
        competition_name: "1. Division",
        competition_country: "Denmark",
        utc_date: iso(now + 50 * JAM),
        home_team_name: "Køge",
        away_team_name: "Næstved",
      }),
      katalog({
        match_id: "sm_r4_live",
        utc_date: iso(now - 0.5 * JAM),
        status: "live",
        home_team_name: "Live FC",
        away_team_name: "United Live",
      }),
      katalog({
        match_id: "sm_r4_next",
        utc_date: iso(now + 2 * JAM),
        home_team_name: "Persada FC",
        away_team_name: "Rawa United",
      }),
    ]);

    /* Laga selesai Persada–Rawa: paket terbit (demo) + paket terbaru. */
    const matriksDemo = [
      [56, 60, 33, 11, 3, 1],
      [82, 151, 73, 24, 7, 2],
      [48, 125, 73, 29, 9, 2],
      [18, 53, 42, 21, 6, 1],
      [6, 18, 12, 8, 3, 1],
      [2, 7, 6, 4, 2, 1],
    ].map((r) => r.map((v) => v / 1000));
    const koSelesai = now - 3 * JAM;
    const paketDasar = {
      gate_status: "calibrated",
      population: "league",
      lambda: 1.7,
      mu: 1.2,
      rho: 0,
      top_scores: [{ home_goals: 1, away_goals: 1, prob: 0.151 }],
      legs: [],
    };
    const payloadTerbit = {
      ...paketDasar,
      fixture: {
        match_id: "sm_r4_done",
        competition_id: "sm:1",
        competition_name: "Liga Uji",
        home: "Persada FC",
        away: "Rawa United",
        kickoff_utc: iso(koSelesai),
      },
      probabilities: { "1x2:1": 0.45, "1x2:x": 0.3, "1x2:2": 0.25, "btts:yes": 0.68 },
      score_matrix: matriksDemo,
      score_matrix_tail_mass: 0.000001,
    };
    const payloadTerbaru = {
      ...payloadTerbit,
      probabilities: { "1x2:1": 0.5, "1x2:x": 0.28, "1x2:2": 0.22, "btts:yes": 0.71 },
    };
    const ids = seedPaketObjek(env, [payloadTerbit]);
    const idPaketTerbit = ids.get("sm_r4_done")!;
    /* Paket kedua untuk laga yang sama: computed_utc berbeda (unik
       per (match_id, trigger, computed_utc)) dan id lebih besar →
       inilah "paket terbaru" yang dibaca getMatchDetail. */
    const dbPaket = new DatabaseSync(path.join(env.dataDir, "analysis_snapshots.db"));
    const infoTerbaru = dbPaket
      .prepare(
        `INSERT INTO packages (match_id, competition_canonical_id, kickoff_utc,
           computed_utc, trigger, payload_json)
         VALUES (?, ?, ?, ?, 'manual', ?)`,
      )
      .run(
        "sm_r4_done",
        "sm:1",
        iso(koSelesai),
        "2026-11-19T09:00:00.000Z",
        JSON.stringify(payloadTerbaru),
      );
    const idPaketTerbaru = Number(infoTerbaru.lastInsertRowid);
    dbPaket.close();

    seedPicks(env, [
      {
        match_id: "sm_r4_done",
        market: "btts",
        selection: "yes",
        line: "",
        model_prob: 0.68,
        market_prob: null,
        sm_prob: null,
        published_prob: 0.68,
        probability_basis: "effective",
        published_at_utc: iso(koSelesai - 2 * JAM),
        grade: "A",
        gate_status: "calibrated",
        pick_uid: "uid-r4-btts",
        competition_canonical_id: "sm:1",
        kickoff_utc: iso(koSelesai),
        package_id: idPaketTerbit,
        fixture_uid: null,
      },
    ]);

    /* Hasil dataset: Persada 2–1 Rawa (finished) + laga AET. */
    seedDatasetTeams(env, [
      { team_id: "tm_h", name: "Persada FC" },
      { team_id: "tm_a", name: "Rawa United" },
    ]);
    const ds = new DatabaseSync(path.join(env.dataDir, "thestats_dataset.db"));
    const insMatch = ds.prepare(
      `INSERT INTO matches (match_id, competition_id, season, utc_date, status,
         home_team_id, away_team_id, home_score, away_score, referee_name, updated_at)
       VALUES (?, 'sm:1', '2026-2027', ?, ?, 'tm_h', 'tm_a', ?, ?, NULL, ?)`,
    );
    insMatch.run("sm_r4_done", iso(koSelesai), "finished", 2, 1, iso(now));
    insMatch.run("sm_r4_aet", iso(now - 5 * JAM), "aet", 3, 1, iso(now));
    ds.close();

    const dbPicks = new DatabaseSync(path.join(env.dataDir, "picks.db"));
    const pickRow = dbPicks
      .prepare("SELECT id FROM picks WHERE pick_uid = 'uid-r4-btts'")
      .get() as unknown as { id: number };
    dbPicks
      .prepare(
        `INSERT INTO pick_outcomes (pick_id, resolved_utc, home_goals, away_goals, hit)
         VALUES (?, ?, 2, 1, 1)`,
      )
      .run(pickRow.id, iso(now - JAM));
    dbPicks.close();

    /* ---- pencarian lintas tanggal + keadaan jadwal ---- */
    const jadwal = runProbe<JadwalProbe[]>(env, ["jadwal"]);
    const koge = jadwal.find((i) => i.match_id === "sm_r4_koge");
    suite.check("probe jadwal: Køge ada di himpunan liputan penuh", koge?.home === "Køge");
    suite.check(
      "probe jadwal: pencarian halaman ('koge') menemukan Køge di luar tanggal tampil",
      koge !== undefined &&
        cocokPencarian([koge.home, koge.away, koge.competition_name], "koge"),
    );
    const live = jadwal.find((i) => i.match_id === "sm_r4_live");
    suite.eq("probe jadwal: status live terkonfirmasi dari katalog", live?.status, "live");
    const urut = urutSekarang(
      jadwal.map((i) => ({ ...i, status: i.status as StatusTampil })),
    );
    suite.eq("probe jadwal: Sekarang menaruh live paling depan", urut[0]?.match_id, "sm_r4_live");
    suite.check(
      "probe jadwal: Sekarang mengeluarkan laga selesai",
      !urut.some((i) => i.match_id === "sm_r4_done"),
    );
    const selesaiItem = jadwal.find((i) => i.match_id === "sm_r4_done");
    suite.check(
      "probe jadwal: laga selesai membawa skor 2–1",
      selesaiItem?.status === "finished" && selesaiItem?.home_goals === 2 && selesaiItem?.away_goals === 1,
    );

    /* ---- detail: edisi terbit vs terbaru + vonis ---- */
    const det = runProbe<DetailProbe>(env, ["detail", "sm_r4_done"]);
    suite.eq("probe detail: paket terbaru adalah paket kedua", det.pkgId, idPaketTerbaru);
    suite.eq("probe detail: paketTerbit = edisi penerbit pilihan resmi", det.paketTerbitId, idPaketTerbit);
    suite.eq(
      "probe detail: trio terbit dari edisi terbit (0,45/0,30/0,25), bukan terbaru",
      det.trioTerbit,
      { a: 0.45, x: 0.3, b: 0.25 },
    );
    const btts = det.picks.find((p) => p.market === "btts");
    suite.check(
      "probe detail: BTTS 68% Tepat pada skor 2–1",
      btts?.published_prob === 0.68 && btts?.hit === 1 && btts?.home_goals === 2 && btts?.away_goals === 1,
      JSON.stringify(btts),
    );
    suite.eq("probe detail: keadaan selesai tanpa penanda pasca-regulasi", det.keadaan?.pascaregulasi, null);

    /* ---- koreksi skor resmi 2–1 → 2–0: vonis berbalik, angka beku ---- */
    const dbKoreksi = new DatabaseSync(path.join(env.dataDir, "picks.db"));
    dbKoreksi
      .prepare("UPDATE pick_outcomes SET home_goals = 2, away_goals = 0, hit = 0 WHERE pick_id = ?")
      .run(pickRow.id);
    dbKoreksi.close();
    const det2 = runProbe<DetailProbe>(env, ["detail", "sm_r4_done"]);
    const btts2 = det2.picks.find((p) => p.market === "btts");
    suite.check(
      "probe koreksi: skor 2–0 → BTTS Meleset, angka terbit tetap 68%",
      btts2?.hit === 0 && btts2?.published_prob === 0.68 && btts2?.away_goals === 0,
      JSON.stringify(btts2),
    );

    /* ---- AET: label pasca-regulasi, skor dataset bukan skor 90 ---- */
    const keadaanAet = runProbe<DetailProbe["keadaan"]>(env, [
      "keadaan",
      "sm_r4_aet",
      String(now),
    ]);
    suite.eq("probe aet: status tampil selesai", keadaanAet?.status, "finished");
    suite.eq("probe aet: penanda pasca-regulasi terbaca", keadaanAet?.pascaregulasi, "aet");
    suite.check(
      "probe aet: skor tersimpan adalah skor AET (3–1), bukan tebakan regulasi",
      keadaanAet?.home_goals === 3 && keadaanAet?.away_goals === 1,
    );
  } catch (e) {
    gagal = true;
    console.error(e);
    suite.check("sandbox selesai tanpa pengecualian", false, String(e));
  } finally {
    settleFixtureEnv(env, gagal || suite.failedCount > 0);
  }
  suite.finish();
}

void main();
