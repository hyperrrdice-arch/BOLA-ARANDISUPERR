// ============================================================================
// ADAPTER ODDS PRA-LAGA API-FOOTBALL (API-Sports v3) — Item 20, Sprint C
// ----------------------------------------------------------------------------
// Keputusan pemilik (25 Nov 2026): sumber odds pra-laga PRIMER adalah
// API-Football v3 (free plan 100 req/hari, 10 req/menit) untuk pasar 1X2
// (Match Winner) dan Over/Under (Goals Over/Under), diambil pada 2 jendela
// tetap harian 09:00 & 18:00 WIB agar usia snapshot selalu < 12 jam.
// 1xbet tetap fallback sekunder BERLABEL sumber terpisah (lihat kontrak
// MarketSnapshot) — tidak pernah dicampur sebagai sumber primer.
//
// Guard keras di modul ini:
//  - <= 9 req/menit (di bawah limit 10/menit free plan);
//  - <= 80 req/hari per proses (pengaman di bawah kuota 100/hari);
//  - sisa kuota dari header respons (x-ratelimit-requests-remaining)
//    dicatat dan dipakai menghentikan larian sebelum kuota habis.
//  - HALAMAN <= 3: free plan menolak parameter Page > 3 (terbukti live
//    25 Nov 2026: payload errors {"plan":"Free plans are limited to a
//    maximum value of 3 for the Page parameter"}). Klien TIDAK PERNAH
//    membangun request di luar 1..3; halaman selebihnya dilaporkan
//    eksplisit sebagai skipped-due-to-plan-cap — tidak ada pemotongan
//    diam-diam.
//
// Token dibaca dari env APIFOOTBALL_API_KEY oleh skrip pemanggil dan
// diteruskan sebagai argumen — modul ini tidak membaca env dan tidak
// pernah mencetak token. Tanpa token, skrip berhenti dengan status
// WAITING_OWNER_TOKEN (pola dorman yang sama dengan importer fdorg).
// ============================================================================

export const APIFOOTBALL_BASE_URL = "https://v3.football.api-sports.io";
export const APIFOOTBALL_MAX_REQ_PER_MINUTE = 9;
export const APIFOOTBALL_MAX_REQ_PER_DAY = 80;
/** Berhenti bila sisa kuota harian dari header <= angka ini. */
export const APIFOOTBALL_MIN_REMAINING = 20;
/** Batas keras parameter Page pada free plan (API menolak Page > 3). */
export const APIFOOTBALL_FREE_PLAN_MAX_PAGE = 3;

// ---------------------------------------------------------------------------
// Rate limiter (jam + sleep terinjeksi agar teruji deterministik)
// ---------------------------------------------------------------------------

export interface RateLimiterOptions {
  maxPerMinute: number;
  maxPerDay: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class ApiFootballRateLimiter {
  private minuteStamps: number[] = [];
  private dayCount = 0;
  private dayKey = "";
  /** Sisa kuota harian terakhir yang dilaporkan header API (null = belum tahu). */
  lastRemaining: number | null = null;

  constructor(private readonly opts: RateLimiterOptions) {}

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private async sleep(ms: number): Promise<void> {
    if (this.opts.sleep) return this.opts.sleep(ms);
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Catat sisa kuota dari header respons terakhir. */
  noteRemaining(remaining: number | null): void {
    if (remaining != null && Number.isFinite(remaining)) {
      this.lastRemaining = remaining;
    }
  }

  /**
   * Minta satu slot request. Menunggu sampai jendela menit punya ruang;
   * MELEMPAR bila anggaran harian proses habis atau sisa kuota header
   * sudah di ambang pengaman — kuota tidak pernah diterobos diam-diam.
   */
  async acquire(): Promise<void> {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (day !== this.dayKey) {
      this.dayKey = day;
      this.dayCount = 0;
    }
    if (this.dayCount >= this.opts.maxPerDay) {
      throw new Error(
        `api-football: anggaran harian proses (${this.opts.maxPerDay} req) habis — berhenti sebelum melanggar kuota free plan`,
      );
    }
    if (this.lastRemaining != null && this.lastRemaining <= APIFOOTBALL_MIN_REMAINING) {
      throw new Error(
        `api-football: sisa kuota harian dari header = ${this.lastRemaining} <= ${APIFOOTBALL_MIN_REMAINING} — berhenti`,
      );
    }
    for (;;) {
      const t = this.now();
      this.minuteStamps = this.minuteStamps.filter((s) => t - s < 60_000);
      if (this.minuteStamps.length < this.opts.maxPerMinute) break;
      const waitMs = 60_000 - (t - this.minuteStamps[0]) + 25;
      await this.sleep(Math.max(25, waitMs));
    }
    this.minuteStamps.push(this.now());
    this.dayCount++;
  }

  get usedToday(): number {
    return this.dayCount;
  }
}

// ---------------------------------------------------------------------------
// Parsing payload v3 /odds → quote terstruktur (fungsi murni, teruji mock)
// ---------------------------------------------------------------------------

export interface ApiFootballOddsQuote {
  /** ID fixture menurut API-Football (BUKAN match_id repo — dijembatani skrip). */
  api_fixture_id: number;
  kickoff_utc: string;
  home_name: string;
  away_name: string;
  bookmaker: string;
  market: "1x2" | "ou";
  /** Garis O/U (mis. 2.5); null untuk 1X2. */
  line: number | null;
  /** Odds desimal mentah per sisi: 1X2 → {home, draw, away}; O/U → {over, under}. */
  odds: Record<string, number>;
}

interface AfValue {
  value?: string;
  odd?: string;
}
interface AfBet {
  id?: number;
  name?: string;
  values?: AfValue[];
}
interface AfBookmaker {
  id?: number;
  name?: string;
  bets?: AfBet[];
}
interface AfOddsEntry {
  fixture?: { id?: number; date?: string };
  teams?: { home?: { name?: string }; away?: { name?: string } };
  bookmakers?: AfBookmaker[];
}
export interface AfOddsPayload {
  response?: AfOddsEntry[];
  paging?: { current?: number; total?: number };
  errors?: unknown;
}

function parseOdd(s: string | undefined): number | null {
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 1 ? n : null;
}

/**
 * Ekstrak quote 1X2 + O/U dari satu halaman payload /odds.
 * Baris yang tidak lengkap (odds hilang/tidak valid) dilewati — tidak
 * pernah dilengkapi dengan angka karangan.
 */
export function parseApiFootballOdds(payload: AfOddsPayload): ApiFootballOddsQuote[] {
  const out: ApiFootballOddsQuote[] = [];
  for (const entry of payload.response ?? []) {
    const apiId = entry.fixture?.id;
    const kickoff = entry.fixture?.date;
    const home = entry.teams?.home?.name;
    const away = entry.teams?.away?.name;
    if (apiId == null || !kickoff || !home || !away) continue;
    const kickoffUtc = new Date(kickoff).toISOString();
    for (const bk of entry.bookmakers ?? []) {
      const bookmaker = bk.name ?? `bookmaker-${bk.id ?? "?"}`;
      for (const bet of bk.bets ?? []) {
        const name = (bet.name ?? "").toLowerCase();
        if (name === "match winner" || bet.id === 1) {
          const byLabel = new Map<string, number>();
          for (const v of bet.values ?? []) {
            const o = parseOdd(v.odd);
            if (o != null && v.value) byLabel.set(v.value.toLowerCase(), o);
          }
          const h = byLabel.get("home");
          const d = byLabel.get("draw");
          const a = byLabel.get("away");
          if (h != null && d != null && a != null) {
            out.push({
              api_fixture_id: apiId,
              kickoff_utc: kickoffUtc,
              home_name: home,
              away_name: away,
              bookmaker,
              market: "1x2",
              line: null,
              odds: { home: h, draw: d, away: a },
            });
          }
        } else if (name.startsWith("goals over/under") || bet.id === 5) {
          // Nilai berbentuk "Over 2.5" / "Under 2.5" — kelompokkan per garis.
          const byLine = new Map<number, { over?: number; under?: number }>();
          for (const v of bet.values ?? []) {
            const o = parseOdd(v.odd);
            if (o == null || !v.value) continue;
            const m = /^(over|under)\s+(\d+(?:\.\d+)?)$/i.exec(v.value.trim());
            if (!m) continue;
            const line = Number(m[2]);
            const slot = byLine.get(line) ?? {};
            if (m[1].toLowerCase() === "over") slot.over = o;
            else slot.under = o;
            byLine.set(line, slot);
          }
          for (const [line, slot] of [...byLine.entries()].sort((x, y) => x[0] - y[0])) {
            if (slot.over != null && slot.under != null) {
              out.push({
                api_fixture_id: apiId,
                kickoff_utc: kickoffUtc,
                home_name: home,
                away_name: away,
                bookmaker,
                market: "ou",
                line,
                odds: { over: slot.over, under: slot.under },
              });
            }
          }
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// HTTP (fetch terinjeksi agar teruji tanpa jaringan)
// ---------------------------------------------------------------------------

export interface AfFetchResult {
  payload: AfOddsPayload;
  remaining: number | null;
  page: number;
  totalPages: number;
}

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

/** Ambil satu halaman /odds untuk satu tanggal (YYYY-MM-DD, UTC API). */
export async function fetchApiFootballOddsPage(
  fetchFn: FetchLike,
  apiKey: string,
  date: string,
  page: number,
  limiter: ApiFootballRateLimiter,
): Promise<AfFetchResult> {
  // Guard batas free plan SEBELUM slot kuota diambil dan SEBELUM request
  // dibangun: Page di luar 1..APIFOOTBALL_FREE_PLAN_MAX_PAGE pasti ditolak
  // API dan hanya membakar kuota — request semacam itu tidak pernah dibuat.
  if (!Number.isInteger(page) || page < 1 || page > APIFOOTBALL_FREE_PLAN_MAX_PAGE) {
    throw new Error(
      `api-football: halaman ${page} di luar batas free plan (1..${APIFOOTBALL_FREE_PLAN_MAX_PAGE}) — request tidak dibuat`,
    );
  }
  await limiter.acquire();
  const url = `${APIFOOTBALL_BASE_URL}/odds?date=${encodeURIComponent(date)}&page=${page}`;
  const res = await fetchFn(url, { headers: { "x-apisports-key": apiKey } });
  const remainingRaw = res.headers.get("x-ratelimit-requests-remaining");
  const remaining = remainingRaw != null ? Number(remainingRaw) : null;
  limiter.noteRemaining(Number.isFinite(remaining) ? remaining : null);
  if (!res.ok) {
    throw new Error(`api-football: HTTP ${res.status} pada /odds?date=${date}&page=${page}`);
  }
  const payload = (await res.json()) as AfOddsPayload;
  if (payload.errors && Object.keys(payload.errors as object).length > 0) {
    throw new Error(`api-football: payload errors: ${JSON.stringify(payload.errors)}`);
  }
  return {
    payload,
    remaining: Number.isFinite(remaining) ? remaining : null,
    page: payload.paging?.current ?? page,
    totalPages: payload.paging?.total ?? page,
  };
}

export interface AfDateFetchResult {
  /** Halaman yang benar-benar diambil (selalu <= APIFOOTBALL_FREE_PLAN_MAX_PAGE). */
  pages: AfFetchResult[];
  /** Total halaman menurut paging API untuk query tanggal ini. */
  totalPages: number;
  fetchedPages: number;
  /** Halaman yang TIDAK diambil karena batas free plan (0 bila utuh). */
  skippedPages: number;
  /** true bila query punya lebih banyak halaman daripada yang boleh diambil. */
  truncated: boolean;
}

/**
 * Ambil odds satu tanggal dengan paginasi yang DIBATASI batas free plan.
 * Query /odds?date= mencakup SEMUA fixture dunia pada tanggal itu (10
 * entri/halaman), jadi totalPages pada tanggal nyata selalu jauh di atas
 * 3 — loop lama berjalan sampai API menolak Page 4 dan seluruh larian
 * mati. Fungsi ini berhenti di halaman 3 dan melaporkan sisanya lewat
 * skippedPages/truncated agar pemanggil WAJIB menampilkannya sebagai
 * skipped-due-to-plan-cap (pemotongan diam-diam dilarang).
 */
export async function fetchApiFootballOddsForDate(
  fetchFn: FetchLike,
  apiKey: string,
  date: string,
  limiter: ApiFootballRateLimiter,
): Promise<AfDateFetchResult> {
  const pages: AfFetchResult[] = [];
  let totalPages = 1;
  let page = 1;
  do {
    const res = await fetchApiFootballOddsPage(fetchFn, apiKey, date, page, limiter);
    pages.push(res);
    totalPages = res.totalPages;
    page++;
  } while (page <= Math.min(totalPages, APIFOOTBALL_FREE_PLAN_MAX_PAGE));
  const fetchedPages = pages.length;
  const skippedPages = Math.max(0, totalPages - fetchedPages);
  return { pages, totalPages, fetchedPages, skippedPages, truncated: skippedPages > 0 };
}

// ---------------------------------------------------------------------------
// Jendela pengambilan tetap (09:00 & 18:00 WIB)
// ---------------------------------------------------------------------------

/** Label jendela tetap untuk sebuah momen; null di luar kedua jendela. */
export function captureWindowForInstant(nowUtc: string): {
  date_wib: string;
  window: "09:00" | "18:00";
} | null {
  const t = Date.parse(nowUtc);
  if (!Number.isFinite(t)) return null;
  const wib = new Date(t + 7 * 3_600_000);
  const hh = wib.getUTCHours();
  const dateWib = wib.toISOString().slice(0, 10);
  if (hh === 9) return { date_wib: dateWib, window: "09:00" };
  if (hh === 18) return { date_wib: dateWib, window: "18:00" };
  return null;
}
