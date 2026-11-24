/**
 * INSTRUMENTASI KESEGARAN INGEST (Item 6, Sprint A+B).
 *
 * Masalah yang ditutup: rantai tidak mencatat KAPAN sebuah hasil pertama
 * kali tersedia di store lokal, jadi lag publikasi sumber → lokal tidak
 * bisa diukur (brief P0 butir 4 mewajibkan available_at per hasil +
 * last_successful_ingest per sumber + umur hasil per tim).
 *
 * Kontrak kejujuran data:
 *  - Kolom matches.available_at hanya diisi untuk baris yang di-ingest
 *    SESUDAH instrumentasi ini aktif (cap waktu run importer). Baris
 *    historis tetap NULL — cap waktu masa lalu TIDAK PERNAH direka.
 *  - Skema aditif & idempoten: ALTER TABLE ADD COLUMN (SQLite, tanpa
 *    rewrite tabel) + tabel ingest_status baru. Kode lama yang tidak
 *    mengenal kolom ini tidak terpengaruh.
 *  - Statistik lag mengembalikan null (bukan 0 / bukan tebakan) selama
 *    belum ada baris ber-available_at — sesudah ingest pertama pasca-
 *    instrumentasi, p50/p95 terhitung dari data nyata.
 */
import type { DatabaseSync } from "node:sqlite";

export const INGEST_SOURCE_FOOTBALL_DATA = "football-data";

/** Pastikan kolom available_at + tabel ingest_status ada (idempoten). */
export function ensureIngestSchema(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(matches)").all() as unknown as { name: string }[];
  if (!cols.some((c) => c.name === "available_at")) {
    db.exec("ALTER TABLE matches ADD COLUMN available_at TEXT");
  }
  db.exec(
    `CREATE TABLE IF NOT EXISTS ingest_status (
       source TEXT PRIMARY KEY,
       last_attempt_utc TEXT,
       last_successful_ingest_utc TEXT,
       detail TEXT
     )`,
  );
}

export function recordIngestAttempt(db: DatabaseSync, source: string, atUtc: string): void {
  db.prepare(
    `INSERT INTO ingest_status (source, last_attempt_utc) VALUES (?, ?)
     ON CONFLICT(source) DO UPDATE SET last_attempt_utc = excluded.last_attempt_utc`,
  ).run(source, atUtc);
}

export function recordSuccessfulIngest(
  db: DatabaseSync,
  source: string,
  atUtc: string,
  detail?: string,
): void {
  db.prepare(
    `INSERT INTO ingest_status (source, last_attempt_utc, last_successful_ingest_utc, detail)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(source) DO UPDATE SET
       last_attempt_utc = excluded.last_attempt_utc,
       last_successful_ingest_utc = excluded.last_successful_ingest_utc,
       detail = excluded.detail`,
  ).run(source, atUtc, atUtc, detail ?? null);
}

export interface IngestStatus {
  source: string;
  last_attempt_utc: string | null;
  last_successful_ingest_utc: string | null;
  detail: string | null;
}

export function getIngestStatus(db: DatabaseSync, source: string): IngestStatus | null {
  const row = db
    .prepare(
      "SELECT source, last_attempt_utc, last_successful_ingest_utc, detail FROM ingest_status WHERE source = ?",
    )
    .get(source) as unknown as IngestStatus | undefined;
  return row ?? null;
}

export interface ResultLagStats {
  /** Jumlah baris hasil dengan available_at terisi (dasar perhitungan). */
  n: number;
  /** Lag = available_at − kickoff (utc_date), jam. null selama n = 0. */
  p50_hours: number | null;
  p95_hours: number | null;
}

/** Statistik lag publikasi→lokal dari baris yang ber-available_at saja. */
export function resultLagStats(db: DatabaseSync): ResultLagStats {
  const rows = db
    .prepare(
      `SELECT (julianday(available_at) - julianday(utc_date)) * 24 AS lag_h
       FROM matches
       WHERE status = 'finished' AND available_at IS NOT NULL
       ORDER BY lag_h`,
    )
    .all() as unknown as { lag_h: number }[];
  if (rows.length === 0) return { n: 0, p50_hours: null, p95_hours: null };
  const lags = rows.map((r) => r.lag_h);
  const pct = (p: number): number => lags[Math.min(lags.length - 1, Math.floor(p * lags.length))];
  return { n: lags.length, p50_hours: pct(0.5), p95_hours: pct(0.95) };
}

export interface TeamResultAge {
  team_id: string;
  last_result_utc: string;
  age_hours: number;
}

/** Umur hasil terbaru per tim (dari utc_date — berlaku untuk semua baris). */
export function perTeamResultAge(db: DatabaseSync, nowUtc: string): TeamResultAge[] {
  const rows = db
    .prepare(
      `SELECT team_id, MAX(utc_date) AS last_result_utc FROM (
         SELECT home_team_id AS team_id, utc_date FROM matches WHERE status = 'finished'
         UNION ALL
         SELECT away_team_id AS team_id, utc_date FROM matches WHERE status = 'finished'
       ) GROUP BY team_id`,
    )
    .all() as unknown as { team_id: string; last_result_utc: string }[];
  const now = Date.parse(nowUtc);
  return rows
    .map((r) => ({
      team_id: r.team_id,
      last_result_utc: r.last_result_utc,
      age_hours: (now - Date.parse(r.last_result_utc)) / 3_600_000,
    }))
    .sort((a, b) => b.age_hours - a.age_hours);
}
