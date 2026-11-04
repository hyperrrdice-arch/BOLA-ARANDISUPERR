import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

// ============================================================================
// QUANT PACKAGE STORE — paket hasil run model kuant, berversi, di DB.
// ----------------------------------------------------------------------------
// File: `data/analysis_snapshots.db` — NAMA & PATH LAMA, SKEMA BARU.
//
// Keputusan owner (Arandi, 2026-11-05): status terkunci store snapshot
// warisan DICABUT ("hapus atau ganti aja gapapa, itu hasil app lama") dan
// hasil run kuant wajib tinggal di store DB sebagai paket berversi. Store
// ini MENGGANTIKAN isi file lama di path yang sama:
//   - 21 baris `analysis_snapshots` warisan (era app lama, Okt 2026) +
//     81 baris `match_outcomes` diarsipkan losslessly ke
//     `archive/analysis_snapshots-legacy-2026-10.db` SEBELUM penggantian
//     (lihat scripts/migrate-snapshots-to-packages.ts). Arsip itulah satu-
//     satunya rumah korpus lama sekarang.
//   - Tabel lama TIDAK dibawa ke store baru. Konsekuensi yang disengaja
//     dan terlihat (bukan senyap): modul warisan `lib/db/analysis-snapshot.ts`
//     (dipakai jalur planner dorman di app/api/agent/route.tsx) bila suatu
//     hari dipanggil lagi akan membuat ulang tabel lamanya dalam keadaan
//     KOSONG di file ini via CREATE TABLE IF NOT EXISTS-nya sendiri —
//     korpus lama tidak akan "kembali"; ia ada di file arsip. Tabel `meta`
//     di store ini mendokumentasikan penggantian itu di dalam DB sendiri.
//
// Satu baris `packages` = satu fixture × satu versi komputasi. Versi
// diidentifikasi (match_id, trigger, computed_utc) — menulis ulang impor
// yang sama tidak menduplikasi; komputasi yang genuinely baru (timestamp
// baru) adalah baris versi baru. Pick di ledger (lib/picks/ledger.ts)
// merujuk baris asalnya lewat picks.package_id.
//
// Kolom `cup_delta`: untuk fixture piala ada δ per tim (kandang/tandang);
// kolom ini menyimpan δ tim KANDANG, pasangan lengkapnya ada di
// provenance_json. Untuk fixture domestik selalu NULL.
// ============================================================================

export type PackageTrigger =
  | "baseline"
  | "t-24h"
  | "t-6h"
  | "t-1h"
  | "t-15m"
  | "slate"
  | "manual"
  | "legacy-import";

export const PACKAGE_TRIGGERS: readonly PackageTrigger[] = [
  "baseline",
  "t-24h",
  "t-6h",
  "t-1h",
  "t-15m",
  "slate",
  "manual",
  "legacy-import",
];

export interface PackageInput {
  match_id: string;
  competition_canonical_id?: string | null;
  kickoff_utc?: string | null;
  /** ISO UTC waktu komputasi SELESAI. Bagian dari identitas versi. */
  computed_utc: string;
  trigger: PackageTrigger;
  /** Sumber fit yang melayani, mis. 'primary_league', 'cup-offset'. */
  fit_source?: string | null;
  gate_status?: string | null;
  /** δ tim kandang untuk jalur offset piala; null di luar piala. */
  cup_delta?: number | null;
  /** Hash/penanda versi artefak ratings yang dipakai komputasi. */
  ratings_marker?: string | null;
  /** Waktu tangkapan odds yang masuk paket (freshness input). */
  odds_captured_utc?: string | null;
  /** Nama bookmaker pada tangkapan odds itu. */
  bookmakers?: string[] | null;
  /** Waktu batch predictions Sportmonks yang masuk paket. */
  predictions_batch_utc?: string | null;
  lambda?: number | null;
  mu?: number | null;
  rho?: number | null;
  /** Paket lengkap (probabilitas semua pasar, top skor, merge pasar, panel SM). */
  payload: unknown;
  /** Catatan provenance bebas (sumber artefak, ekstraksi, yang absen & kenapa). */
  provenance?: Record<string, unknown> | null;
}

export interface PackageRow {
  id: number;
  match_id: string;
  competition_canonical_id: string | null;
  kickoff_utc: string | null;
  computed_utc: string;
  trigger: PackageTrigger;
  fit_source: string | null;
  gate_status: string | null;
  cup_delta: number | null;
  ratings_marker: string | null;
  odds_captured_utc: string | null;
  bookmakers: string[] | null;
  predictions_batch_utc: string | null;
  lambda: number | null;
  mu: number | null;
  rho: number | null;
  payload: unknown;
  provenance: Record<string, unknown> | null;
}

interface RawPackageRow {
  id: number;
  match_id: string;
  competition_canonical_id: string | null;
  kickoff_utc: string | null;
  computed_utc: string;
  trigger: string;
  fit_source: string | null;
  gate_status: string | null;
  cup_delta: number | null;
  ratings_marker: string | null;
  odds_captured_utc: string | null;
  bookmakers_json: string | null;
  predictions_batch_utc: string | null;
  lambda: number | null;
  mu: number | null;
  rho: number | null;
  payload_json: string;
  provenance_json: string | null;
}

let dbInstance: DatabaseSync | null = null;

export function getPackagesDbPath(): string {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return path.join(dataDir, "analysis_snapshots.db");
}

/**
 * DDL store paket (idempotent). Diekspor agar script migrasi bisa membangun
 * file baru di path temporer dengan skema yang persis sama.
 */
export function ensurePackagesSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id TEXT NOT NULL,
      competition_canonical_id TEXT,
      kickoff_utc TEXT,
      computed_utc TEXT NOT NULL,
      trigger TEXT NOT NULL CHECK (trigger IN
        ('baseline','t-24h','t-6h','t-1h','t-15m','slate','manual','legacy-import')),
      fit_source TEXT,
      gate_status TEXT,
      cup_delta REAL,
      ratings_marker TEXT,
      odds_captured_utc TEXT,
      bookmakers_json TEXT,
      predictions_batch_utc TEXT,
      lambda REAL,
      mu REAL,
      rho REAL,
      payload_json TEXT NOT NULL,
      provenance_json TEXT,
      UNIQUE (match_id, trigger, computed_utc)
    );
    CREATE INDEX IF NOT EXISTS idx_packages_match ON packages(match_id);
    CREATE INDEX IF NOT EXISTS idx_packages_kickoff ON packages(kickoff_utc);
    CREATE INDEX IF NOT EXISTS idx_packages_computed ON packages(computed_utc);
  `);
}

export function getPackagesDb(): DatabaseSync {
  if (dbInstance) {
    return dbInstance;
  }
  const db = new DatabaseSync(getPackagesDbPath());
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  ensurePackagesSchema(db);
  dbInstance = db;
  return dbInstance;
}

function toPackageRow(r: RawPackageRow): PackageRow {
  return {
    id: r.id,
    match_id: r.match_id,
    competition_canonical_id: r.competition_canonical_id,
    kickoff_utc: r.kickoff_utc,
    computed_utc: r.computed_utc,
    trigger: r.trigger as PackageTrigger,
    fit_source: r.fit_source,
    gate_status: r.gate_status,
    cup_delta: r.cup_delta,
    ratings_marker: r.ratings_marker,
    odds_captured_utc: r.odds_captured_utc,
    bookmakers: r.bookmakers_json ? (JSON.parse(r.bookmakers_json) as string[]) : null,
    predictions_batch_utc: r.predictions_batch_utc,
    lambda: r.lambda,
    mu: r.mu,
    rho: r.rho,
    payload: JSON.parse(r.payload_json),
    provenance: r.provenance_json
      ? (JSON.parse(r.provenance_json) as Record<string, unknown>)
      : null,
  };
}

const PACKAGE_COLUMNS =
  "match_id, competition_canonical_id, kickoff_utc, computed_utc, trigger, " +
  "fit_source, gate_status, cup_delta, ratings_marker, odds_captured_utc, " +
  "bookmakers_json, predictions_batch_utc, lambda, mu, rho, payload_json, provenance_json";

/**
 * Tulis satu versi paket. Idempoten pada identitas versi
 * (match_id, trigger, computed_utc): bila baris itu sudah ada, id-nya
 * dikembalikan dengan inserted=false dan payload TIDAK ditimpa — versi
 * yang sudah tercatat tidak pernah ditulis ulang secara senyap.
 */
export function writePackage(p: PackageInput): { id: number; inserted: boolean } {
  if (!PACKAGE_TRIGGERS.includes(p.trigger)) {
    throw new Error(`writePackage: trigger tidak dikenal: ${p.trigger}`);
  }
  const db = getPackagesDb();
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO packages (${PACKAGE_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      p.match_id,
      p.competition_canonical_id ?? null,
      p.kickoff_utc ?? null,
      p.computed_utc,
      p.trigger,
      p.fit_source ?? null,
      p.gate_status ?? null,
      p.cup_delta ?? null,
      p.ratings_marker ?? null,
      p.odds_captured_utc ?? null,
      p.bookmakers ? JSON.stringify(p.bookmakers) : null,
      p.predictions_batch_utc ?? null,
      p.lambda ?? null,
      p.mu ?? null,
      p.rho ?? null,
      JSON.stringify(p.payload),
      p.provenance ? JSON.stringify(p.provenance) : null,
    );
  if (Number(result.changes) > 0) {
    return { id: Number(result.lastInsertRowid), inserted: true };
  }
  const existing = db
    .prepare(
      "SELECT id FROM packages WHERE match_id = ? AND trigger = ? AND computed_utc = ?",
    )
    .get(p.match_id, p.trigger, p.computed_utc) as { id: number } | undefined;
  if (!existing) {
    throw new Error(
      `writePackage: INSERT OR IGNORE gagal tanpa baris existing untuk ${p.match_id}/${p.trigger}/${p.computed_utc}`,
    );
  }
  return { id: existing.id, inserted: false };
}

/** Paket versi terbaru (computed_utc terbesar) untuk satu fixture. */
export function latestPackageFor(matchId: string): PackageRow | null {
  const db = getPackagesDb();
  const row = db
    .prepare(
      `SELECT * FROM packages WHERE match_id = ?
       ORDER BY computed_utc DESC, id DESC LIMIT 1`,
    )
    .get(matchId) as unknown as RawPackageRow | undefined;
  return row ? toPackageRow(row) : null;
}

/**
 * Daftar paket dalam jendela KICKOFF [fromUtc, toUtc) — jendela yang sama
 * dengan yang dipakai driver slate. Filter opsional per match / trigger.
 * Urutan: kickoff naik, lalu computed_utc naik (versi lama → baru).
 */
export function listPackages(opts?: {
  fromUtc?: string;
  toUtc?: string;
  matchId?: string;
  trigger?: PackageTrigger;
  limit?: number;
}): PackageRow[] {
  const db = getPackagesDb();
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (opts?.fromUtc) {
    clauses.push("kickoff_utc >= ?");
    params.push(opts.fromUtc);
  }
  if (opts?.toUtc) {
    clauses.push("kickoff_utc < ?");
    params.push(opts.toUtc);
  }
  if (opts?.matchId) {
    clauses.push("match_id = ?");
    params.push(opts.matchId);
  }
  if (opts?.trigger) {
    clauses.push("trigger = ?");
    params.push(opts.trigger);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const sql = `
    SELECT * FROM packages ${where}
    ORDER BY kickoff_utc ASC, computed_utc ASC, id ASC
    ${opts?.limit !== undefined ? "LIMIT ?" : ""}
  `;
  if (opts?.limit !== undefined) params.push(opts.limit);
  const rows = db.prepare(sql).all(...params) as unknown as RawPackageRow[];
  return rows.map(toPackageRow);
}

/** Baca satu entri meta store (schema_version, created_utc, …). */
export function getPackageStoreMeta(key: string): string | null {
  const db = getPackagesDb();
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}
