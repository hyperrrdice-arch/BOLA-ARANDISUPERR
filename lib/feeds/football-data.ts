/**
 * FOOTBALL-DATA.CO.UK FEED — workhorse mode bebas (tanpa Sportmonks).
 *
 * Sumber riset: tasks/free-feed-research.md (§A). Tanpa API key; unduh
 * sopan meniru script warisan archive/legacy-scripts/download-historical-data.mjs
 * (jeda 400 ms antar-fetch + User-Agent browser).
 *
 * Kontrak kejujuran:
 *  - Kolom dibaca BERDASARKAN NAMA HEADER; kolom absen / sel kosong = null,
 *    tidak pernah dikarang.
 *  - Label bookmaker selalu buku yang benar-benar tertulis di kolomnya:
 *    PP* = Pinnacle, B365* = Bet365. Blok closing = blok polos + sufiks C.
 *  - OU 2.5 di CSV ini hanya punya kolom Bet365 (B365>2.5 / B365<2.5 dan
 *    versi closing-nya) — jadi ou25 hanya pernah terisi pada buku Bet365,
 *    tidak pernah ditempelkan ke buku Pinnacle.
 */

import fs from "node:fs";
import path from "node:path";

export interface FdDivision {
  code: string;
  name: string;
  country: string;
}

/**
 * 16 divisi warisan — persis daftar script unduh historis proyek.
 * Ekspansi 2026-11-16 (tasks/free-divisions-expansion-report.md): +6 divisi
 * mmz4281 yang memang diterbitkan situsnya untuk musim berjalan — E2/E3/EC
 * (Inggris kasta 3/4/5) dan SC1/SC2/SC3 (Skotlandia kasta 2/3/4). Semua
 * membawa odds closing Pinnacle; xG hanya E2/E3 (divisi lain: tembakan saja).
 * Liga ekstra dunia (file new/<KODE>.csv) TIDAK dimasukkan: skema kolomnya
 * berbeda total (Home/Away/HG/AG, multi-musim per file) sehingga tidak
 * ter-parse oleh pola importer ini.
 */
export const FD_DIVISIONS: FdDivision[] = [
  { code: "E0", name: "English Premier League", country: "England" },
  { code: "SP1", name: "Spanish La Liga", country: "Spain" },
  { code: "I1", name: "Italian Serie A", country: "Italy" },
  { code: "D1", name: "German Bundesliga", country: "Germany" },
  { code: "F1", name: "French Ligue 1", country: "France" },
  { code: "E1", name: "English Championship", country: "England" },
  { code: "SP2", name: "Spanish Segunda Division", country: "Spain" },
  { code: "I2", name: "Italian Serie B", country: "Italy" },
  { code: "D2", name: "German 2. Bundesliga", country: "Germany" },
  { code: "F2", name: "French Ligue 2", country: "France" },
  { code: "N1", name: "Dutch Eredivisie", country: "Netherlands" },
  { code: "B1", name: "Belgian First Division A", country: "Belgium" },
  { code: "P1", name: "Portuguese Primeira Liga", country: "Portugal" },
  { code: "SC0", name: "Scottish Premiership", country: "Scotland" },
  { code: "T1", name: "Turkish Super Lig", country: "Turkey" },
  { code: "G1", name: "Greek Super League", country: "Greece" },
  { code: "E2", name: "English League One", country: "England" },
  { code: "E3", name: "English League Two", country: "England" },
  { code: "EC", name: "English National League", country: "England" },
  { code: "SC1", name: "Scottish Championship", country: "Scotland" },
  { code: "SC2", name: "Scottish League One", country: "Scotland" },
  { code: "SC3", name: "Scottish League Two", country: "Scotland" },
];

export const FD_DIVISION_CODES: string[] = FD_DIVISIONS.map((d) => d.code);

export function fdDivision(code: string): FdDivision | null {
  return FD_DIVISIONS.find((d) => d.code === code.toUpperCase()) ?? null;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const THROTTLE_MS = 400;
let lastFetchAt = 0;

async function fetchText(url: string): Promise<string | null> {
  // Retry meniru fetchWithRetry script warisan: 3 percobaan, jeda naik.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = lastFetchAt + THROTTLE_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastFetchAt = Date.now();
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "text/csv,text/plain,*/*" },
        redirect: "follow",
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`football-data fetch ${url} → HTTP ${res.status}`);
      const text = await res.text();
      return text.length > 0 ? text : null;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`football-data fetch ${url} gagal`);
}

// ---------------------------------------------------------------------------
// CSV parsing (header-name based; handles quoted fields + BOM)
// ---------------------------------------------------------------------------

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Baris CSV mentah: kunci = nama header persis seperti di file. */
export type FdRawRow = Record<string, string>;

export function parseCsv(text: string): FdRawRow[] {
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows: FdRawRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row: FdRawRow = {};
    headers.forEach((h, idx) => {
      row[h] = (cells[idx] ?? "").trim();
    });
    rows.push(row);
  }
  return rows;
}

/** Angka dari sel; kosong / bukan angka / kolom absen → null. */
export function num(row: FdRawRow, col: string): number | null {
  const v = row[col];
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function str(row: FdRawRow, col: string): string | null {
  const v = row[col];
  return v === undefined || v === "" ? null : v;
}

// ---------------------------------------------------------------------------
// Tanggal/waktu: Date dd/mm/yyyy|dd/mm/yy + Time HH:MM waktu UK (Europe/London)
// ---------------------------------------------------------------------------

/** Offset Europe/London terhadap UTC (ms) pada instant UTC tertentu. */
function londonOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Konversi tanggal + jam dinding Europe/London → ISO UTC.
 * dateStr: dd/mm/yyyy atau dd/mm/yy. timeStr: HH:MM (absen → 00:00).
 * Mengembalikan null bila tanggal tidak ter-parse.
 */
export function londonDateTimeToUtcIso(dateStr: string, timeStr?: string | null): string | null {
  const m = dateStr.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  let hour = 0;
  let minute = 0;
  if (timeStr) {
    const tm = timeStr.trim().match(/^(\d{1,2}):(\d{2})/);
    if (tm) {
      hour = Number(tm[1]);
      minute = Number(tm[2]);
    }
  }
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  // Iterasi dua kali: offset bisa berubah di sekitar transisi DST.
  let utc = wallAsUtc - londonOffsetMs(wallAsUtc);
  utc = wallAsUtc - londonOffsetMs(utc);
  return new Date(utc).toISOString();
}

export type FdStrictKickoff =
  | { ok: true; kickoffUtc: string }
  | {
      ok: false;
      reason:
        | "date_invalid"
        | "time_absent"
        | "time_invalid"
        | "time_out_of_range"
        | "conversion_mismatch";
    };

/**
 * Validasi kickoff KETAT untuk jalur KOREKSI jadwal (PR koreksi-kickoff,
 * audit §3) — terpisah dari londonDateTimeToUtcIso yang sengaja longgar
 * (kontraknya dipakai parser hasil/odds dan tidak diubah): parser longgar
 * mengimputasi jam absen menjadi 00:00 dan menormalkan nilai di luar
 * rentang lewat rollover Date.UTC, dan imputasi bukan bukti koreksi.
 * Di sini: Date harus tanggal kalender nyata; Time harus hadir, berbentuk
 * HH:MM persis, jam 0–23 / menit 0–59 (00:00 eksplisit SAH); dan hasil
 * konversi Europe/London harus terbaca balik persis sama dengan input.
 */
export function strictFixtureKickoffUtc(row: FdRawRow): FdStrictKickoff {
  const date = str(row, "Date");
  const time = str(row, "Time");
  if (!date) return { ok: false, reason: "date_invalid" };
  const dm = date.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!dm) return { ok: false, reason: "date_invalid" };
  const day = Number(dm[1]);
  const month = Number(dm[2]);
  let year = Number(dm[3]);
  if (year < 100) year += 2000;
  const cal = new Date(Date.UTC(year, month - 1, day));
  if (
    cal.getUTCFullYear() !== year ||
    cal.getUTCMonth() !== month - 1 ||
    cal.getUTCDate() !== day
  ) {
    return { ok: false, reason: "date_invalid" };
  }
  if (!time) return { ok: false, reason: "time_absent" };
  const tm = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!tm) return { ok: false, reason: "time_invalid" };
  const hour = Number(tm[1]);
  const minute = Number(tm[2]);
  if (hour > 23 || minute > 59) return { ok: false, reason: "time_out_of_range" };
  const iso = londonDateTimeToUtcIso(date, time);
  if (!iso) return { ok: false, reason: "date_invalid" };
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const part = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? -1);
  if (
    part("year") !== year ||
    part("month") !== month ||
    part("day") !== day ||
    part("hour") !== hour ||
    part("minute") !== minute
  ) {
    return { ok: false, reason: "conversion_mismatch" };
  }
  return { ok: true, kickoffUtc: iso };
}

/** yyyymmdd dari ISO UTC (untuk kunci match fd_/fo_). */
export function yyyymmdd(isoUtc: string): string {
  return isoUtc.slice(0, 10).replace(/-/g, "");
}

/** Slug stabil dari nama ternormalisasi (untuk kunci match & id tim fd_). */
export function teamSlug(normalizedName: string): string {
  return normalizedName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export interface FdResultRow {
  div: string;
  homeTeam: string;
  awayTeam: string;
  kickoffUtc: string;
  homeGoals: number;
  awayGoals: number;
  referee: string | null;
  homeXg: number | null;
  awayXg: number | null;
  homeShots: number | null;
  awayShots: number | null;
  homeShotsOnTarget: number | null;
  awayShotsOnTarget: number | null;
  raw: FdRawRow;
}

export interface FdFixtureRow {
  div: string;
  homeTeam: string;
  awayTeam: string;
  kickoffUtc: string;
  raw: FdRawRow;
}

function baseRow(row: FdRawRow): { div: string; homeTeam: string; awayTeam: string; kickoffUtc: string } | null {
  const div = str(row, "Div");
  const homeTeam = str(row, "HomeTeam");
  const awayTeam = str(row, "AwayTeam");
  const date = str(row, "Date");
  if (!div || !homeTeam || !awayTeam || !date) return null;
  const kickoffUtc = londonDateTimeToUtcIso(date, str(row, "Time"));
  if (!kickoffUtc) return null;
  return { div, homeTeam, awayTeam, kickoffUtc };
}

export function toResultRow(row: FdRawRow): FdResultRow | null {
  const base = baseRow(row);
  if (!base) return null;
  const homeGoals = num(row, "FTHG");
  const awayGoals = num(row, "FTAG");
  if (homeGoals === null || awayGoals === null) return null;
  return {
    ...base,
    homeGoals,
    awayGoals,
    referee: str(row, "Referee"),
    homeXg: num(row, "HxG"),
    awayXg: num(row, "AxG"),
    homeShots: num(row, "HS"),
    awayShots: num(row, "AS"),
    homeShotsOnTarget: num(row, "HST"),
    awayShotsOnTarget: num(row, "AST"),
    raw: row,
  };
}

export function toFixtureRow(row: FdRawRow): FdFixtureRow | null {
  const base = baseRow(row);
  if (!base) return null;
  return { ...base, raw: row };
}

// ---------------------------------------------------------------------------
// Odds extraction — label jujur per buku
// ---------------------------------------------------------------------------

export type FdBookmaker = "Pinnacle" | "Bet365";

export interface FdOddsBook {
  bookmaker: FdBookmaker;
  h: number;
  d: number;
  a: number;
  ou25Over?: number | null;
  ou25Under?: number | null;
}

function bookFrom(
  row: FdRawRow,
  bookmaker: FdBookmaker,
  hCol: string,
  dCol: string,
  aCol: string,
  ouOverCol?: string,
  ouUnderCol?: string,
): FdOddsBook | null {
  const h = num(row, hCol);
  const d = num(row, dCol);
  const a = num(row, aCol);
  if (h === null || d === null || a === null) return null;
  const book: FdOddsBook = { bookmaker, h, d, a };
  if (ouOverCol && ouUnderCol) {
    book.ou25Over = num(row, ouOverCol);
    book.ou25Under = num(row, ouUnderCol);
  }
  return book;
}

/**
 * Buku pra-laga dari satu baris: Pinnacle (PP*) dan Bet365 (B365*) sebagai
 * entri TERPISAH. OU2.5 hanya ada kolomnya untuk Bet365.
 */
export function preMatchBooks(row: FdRawRow): FdOddsBook[] {
  const books: FdOddsBook[] = [];
  const pin = bookFrom(row, "Pinnacle", "PPH", "PPD", "PPA");
  if (pin) books.push(pin);
  const b365 = bookFrom(row, "Bet365", "B365H", "B365D", "B365A", "B365>2.5", "B365<2.5");
  if (b365) books.push(b365);
  return books;
}

/**
 * Buku closing dari satu baris hasil: Pinnacle closing (PPC*) didahulukan;
 * Bet365 closing (B365C*) hanya bila Pinnacle absen. Null bila keduanya absen.
 */
export function closingBook(row: FdRawRow): FdOddsBook | null {
  const pin = bookFrom(row, "Pinnacle", "PPCH", "PPCD", "PPCA");
  if (pin) return pin;
  return bookFrom(row, "Bet365", "B365CH", "B365CD", "B365CA", "B365C>2.5", "B365C<2.5");
}

/** True bila baris punya buku closing Pinnacle DAN Bet365 (untuk hitung preferensi). */
export function hasBothClosingBooks(row: FdRawRow): boolean {
  return (
    bookFrom(row, "Pinnacle", "PPCH", "PPCD", "PPCA") !== null &&
    bookFrom(row, "Bet365", "B365CH", "B365CD", "B365CA") !== null
  );
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

/**
 * Injeksi sumber CSV lokal untuk pengujian (K0): bila env
 * FOOTBALL_DATA_CSV_DIR di-set, CSV dibaca dari direktori itu dengan tata
 * letak yang sama seperti URL-nya — `<dir>/mmz4281/<season>/<DIV>.csv` dan
 * `<dir>/fixtures.csv`. File absen bersemantik sama seperti HTTP 404
 * (null). Bila env tidak di-set, fungsi ini mengembalikan undefined dan
 * jalur jaringan produksi dipakai persis seperti sebelumnya.
 */
function localCsvText(relPath: string): string | null | undefined {
  const dir = process.env.FOOTBALL_DATA_CSV_DIR;
  if (!dir) return undefined;
  try {
    return fs.readFileSync(path.join(dir, relPath), "utf8");
  } catch {
    return null;
  }
}

/** CSV hasil satu divisi satu musim (kode musim mis. '2627'). Null bila 404. */
export async function fetchSeasonCsv(div: string, season: string): Promise<FdRawRow[] | null> {
  const local = localCsvText(path.join("mmz4281", season, `${div.toUpperCase()}.csv`));
  const text =
    local !== undefined
      ? local
      : await fetchText(`https://www.football-data.co.uk/mmz4281/${season}/${div.toUpperCase()}.csv`);
  return text === null ? null : parseCsv(text);
}

/** CSV fixture semua divisi (jendela bergulir pendek). */
export async function fetchFixturesCsv(): Promise<FdRawRow[]> {
  const local = localCsvText("fixtures.csv");
  const text =
    local !== undefined ? local : await fetchText("https://www.football-data.co.uk/fixtures.csv");
  return text === null ? [] : parseCsv(text);
}
