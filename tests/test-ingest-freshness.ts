/**
 * SUITE ITEM 6 (Sprint A+B) — instrumentasi available_at / ingest_status.
 *
 * Memverifikasi pada DB fixture in-memory: skema aditif idempoten,
 * available_at terisi hanya untuk baris baru (historis tetap NULL —
 * tidak ada backfill), last_successful_ingest tercatat, statistik lag
 * p50/p95 terhitung dari baris ber-cap (null jujur saat kosong), dan
 * umur hasil per tim.
 */
import { DatabaseSync } from "node:sqlite";
import { Suite } from "./helpers/fixture-env";
import {
  ensureIngestSchema,
  getIngestStatus,
  perTeamResultAge,
  recordIngestAttempt,
  recordSuccessfulIngest,
  resultLagStats,
} from "../lib/feeds/ingest-freshness";

const suite = new Suite("ingest-freshness (Item 6)");

const db = new DatabaseSync(":memory:");
db.exec(
  `CREATE TABLE matches (
     match_id TEXT PRIMARY KEY, competition_id TEXT NOT NULL, season TEXT NOT NULL,
     utc_date TEXT NOT NULL, status TEXT NOT NULL,
     home_team_id TEXT NOT NULL, away_team_id TEXT NOT NULL,
     home_score INTEGER, away_score INTEGER, referee_name TEXT,
     updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
   )`,
);
// Baris historis pra-instrumentasi.
db.prepare(
  "INSERT INTO matches (match_id, competition_id, season, utc_date, status, home_team_id, away_team_id, home_score, away_score) VALUES ('sm_old', 'sm:x', '2526', '2026-10-01T19:00:00Z', 'finished', 'T1', 'T2', 2, 1)",
).run();

ensureIngestSchema(db);
ensureIngestSchema(db); // idempoten — tidak boleh melempar / menggandakan kolom
const cols = db.prepare("PRAGMA table_info(matches)").all() as unknown as { name: string }[];
suite.eq("skema: tepat satu kolom available_at", cols.filter((c) => c.name === "available_at").length, 1);
const oldRow = db.prepare("SELECT available_at FROM matches WHERE match_id = 'sm_old'").get() as unknown as { available_at: string | null };
suite.eq("historis: available_at tetap NULL (tanpa backfill)", oldRow.available_at, null);

// Statistik lag saat belum ada baris ber-cap: null jujur.
suite.eq("lag kosong: {n:0, null, null}", resultLagStats(db), { n: 0, p50_hours: null, p95_hours: null });

// Baris baru pasca-instrumentasi dengan cap ketersediaan.
// Lag (jam): m1 = 26, m2 = 50, m3 = 74, m4 = 122 → p50 = indeks floor(0.5*4)=2 → 74; p95 = indeks 3 → 122.
const ins = db.prepare(
  "INSERT INTO matches (match_id, competition_id, season, utc_date, status, home_team_id, away_team_id, home_score, away_score, available_at) VALUES (?, 'fd:E0', '2627', ?, 'finished', ?, ?, 1, 0, ?)",
);
ins.run("fd_1", "2026-11-20T20:00:00Z", "T1", "T3", "2026-11-21T22:00:00Z");
ins.run("fd_2", "2026-11-20T20:00:00Z", "T2", "T3", "2026-11-22T22:00:00Z");
ins.run("fd_3", "2026-11-21T20:00:00Z", "T1", "T2", "2026-11-24T22:00:00Z");
ins.run("fd_4", "2026-11-19T20:00:00Z", "T3", "T1", "2026-11-24T22:00:00Z");
const lag = resultLagStats(db);
suite.eq("lag: n=4 (baris NULL tidak ikut)", lag.n, 4);
suite.check("lag: p50 = 74 jam", Math.abs((lag.p50_hours ?? -1) - 74) < 1e-6, `${lag.p50_hours}`);
suite.check("lag: p95 = 122 jam", Math.abs((lag.p95_hours ?? -1) - 122) < 1e-6, `${lag.p95_hours}`);

// Status ingest: attempt lalu success.
suite.eq("status awal: null", getIngestStatus(db, "football-data"), null);
recordIngestAttempt(db, "football-data", "2026-11-24T16:21:00Z");
suite.eq("attempt tercatat, success masih null", getIngestStatus(db, "football-data")?.last_successful_ingest_utc, null);
recordSuccessfulIngest(db, "football-data", "2026-11-24T16:21:05Z", "results_inserted=4");
const st = getIngestStatus(db, "football-data");
suite.eq("success tercatat", st?.last_successful_ingest_utc, "2026-11-24T16:21:05Z");
suite.eq("detail tercatat", st?.detail, "results_inserted=4");

// Umur hasil per tim pada now = 2026-11-25T20:00Z.
// Hasil terbaru: T1 → fd_3 2026-11-21T20:00 (96 jam); T2 → fd_3 juga (96 jam); T3 → fd_2 2026-11-20T20:00 (120 jam).
const ages = perTeamResultAge(db, "2026-11-25T20:00:00Z");
const ageOf = (t: string): number | undefined => ages.find((a) => a.team_id === t)?.age_hours;
suite.check("umur T3 = 120 jam (paling tua, urutan pertama)", Math.abs((ageOf("T3") ?? -1) - 120) < 1e-6 && ages[0].team_id === "T3", JSON.stringify(ages));
suite.check("umur T1 = 96 jam", Math.abs((ageOf("T1") ?? -1) - 96) < 1e-6, `${ageOf("T1")}`);

db.close();
suite.finish();
