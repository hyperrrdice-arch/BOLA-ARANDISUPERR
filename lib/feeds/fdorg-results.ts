// ============================================================================
// ADAPTER HASIL football-data.org API v4 (Item 7, Sprint C Fase 3)
// ----------------------------------------------------------------------------
// Menambal lubang settlement dari sisi sumber kedua: hasil FINISHED untuk
// kompetisi yang terpetakan ke divisi proyek, ditarik dari
// https://api.football-data.org/v4 dengan header X-Auth-Token dan guard
// <= 9 req/menit + hormati HTTP 429 (Retry-After, satu kali ulang).
//
// Aturan yang dikunci di sini (sesuai brief Fase 3):
//  - Basis skor = 90 menit waktu reguler: score.regularTime bila ada;
//    bila tidak ada dan duration REGULAR → score.fullTime. Laga yang
//    hanya punya skor pasca-90 tanpa regularTime TIDAK ditebak skornya
//    (dilewati + dihitung sebagai skipped_basis).
//  - ID tidak pernah dikarang: tim/kompetisi dipetakan ke registry
//    kanonik (team-canonical.json / league-canonical.json via divisi).
//    Yang tak terpetakan masuk antrean identitas repo
//    (fixture_identity_queue, source "football-data-org") dan TIDAK
//    ditulis sebagai baris hasil.
//  - Nama tim fdorg membawa imbuhan badan hukum ("Arsenal FC",
//    "Hull City AFC", "Sunderland AFC") yang tidak ada di nama registry.
//    Normalizer repo hanya memakai bentuk terlucuti untuk pencarian
//    kamus alias dan mengembalikan bentuk berimbuhan pada fallback,
//    jadi kunci nama adapter tidak pernah bertemu kunci registry
//    (terbukti live 25 Nov 2026: 181 baris antrean, 36 dari 37 nama
//    khas hanya berbeda imbuhan). Pemetaan adapter karena itu mencoba
//    kunci nama persis lebih dulu, lalu kunci terlucuti-imbuhan yang
//    dibangun dari nama registry yang sama — kunci terlucuti yang
//    menunjuk >1 tim kanonik dibuang sebagai ambigu (mis. "Everton"
//    memang ambigu: sm:13 Inggris vs sm:15064 Chili, tetap di antrean).
//  - Baris hasil fdorg hidup di namespace-nya sendiri (match_id fo_…,
//    format yang sama dengan importer fixture fdorg) — pola yang sama
//    dengan fd_ milik football-data.co.uk.
//  - Precedence sumber kedua: jangkar primer (baris non-fo_ untuk laga
//    fisik yang sama) yang SUDAH finished berskor selalu menang —
//    observasi fdorg yang berbeda dicatat di fdorg_result_revisions
//    (resolution 'primary_kept') dan jangkar tidak diubah. Bila jangkar
//    belum finished / tidak ada jangkar primer, observasi diterapkan
//    lewat mesin D2 repo (resolveFixtureIdentity +
//    applyResultObservation) sehingga revisi skor tercatat di
//    result_revisions dengan jejak penuh.
//  - available_at / ingested_at + last_successful_ingest memakai
//    instrumentasi Item 6 (source "football-data-org"); cap waktu masa
//    lalu tidak pernah direka — available_at = momen ingest ini.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { normalizeTeamName } from "../quant/team-normalizer";
import { getCanonicalBySourceId } from "../quant/league-identity";
import { teamSlug, yyyymmdd } from "./football-data";
import {
  applyResultObservation,
  ensureIdentitySchema,
  linkAlias,
  resolveFixtureIdentity,
  sourceOfMatchId,
  type ObservationAction,
} from "../identity/fixture-resolver";
import {
  ensureIngestSchema,
  recordSuccessfulIngest,
} from "./ingest-freshness";

export const FDORG_SOURCE = "football-data-org";
export const FDORG_BASE_URL = "https://api.football-data.org/v4";
export const FDORG_MAX_REQ_PER_MINUTE = 9;

/** Kode kompetisi v4 → divisi proyek (sama dengan importer fixture fdorg). */
export const FDORG_CODE_TO_DIV: Record<string, string> = {
  PL: "E0",
  ELC: "E1",
  PD: "SP1",
  BL1: "D1",
  SA: "I1",
  FL1: "F1",
  DED: "N1",
  PPL: "P1",
};

// ---------------------------------------------------------------------------
// Rate limiter + fetch dengan penghormatan 429
// ---------------------------------------------------------------------------

export class FdorgRateLimiter {
  private stamps: number[] = [];
  constructor(
    private readonly opts: {
      maxPerMinute?: number;
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
    } = {},
  ) {}

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  async sleepMs(ms: number): Promise<void> {
    if (this.opts.sleep) return this.opts.sleep(ms);
    return new Promise((r) => setTimeout(r, ms));
  }

  async acquire(): Promise<void> {
    const max = this.opts.maxPerMinute ?? FDORG_MAX_REQ_PER_MINUTE;
    for (;;) {
      const t = this.now();
      this.stamps = this.stamps.filter((s) => t - s < 60_000);
      if (this.stamps.length < max) break;
      await this.sleepMs(Math.max(25, 60_000 - (t - this.stamps[0]) + 25));
    }
    this.stamps.push(this.now());
  }
}

export type FdorgFetchLike = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

export interface FdorgMatchesPayload {
  matches?: FdorgMatchRaw[];
}

export interface FdorgMatchRaw {
  id?: number;
  utcDate?: string;
  status?: string;
  homeTeam?: { id?: number; name?: string };
  awayTeam?: { id?: number; name?: string };
  score?: {
    duration?: string;
    fullTime?: { home?: number | null; away?: number | null };
    regularTime?: { home?: number | null; away?: number | null };
    extraTime?: { home?: number | null; away?: number | null };
    penalties?: { home?: number | null; away?: number | null };
  };
}

/** Batas ulang untuk kegagalan level jaringan (fetch melempar, mis. "fetch failed"). */
export const FDORG_MAX_NETWORK_RETRIES = 2;
/** Backoff antar-ulangan jaringan (ms) — lewat limiter.sleepMs agar terinjeksi di uji. */
export const FDORG_NETWORK_BACKOFF_MS = [2_000, 4_000];

/**
 * Ambil laga satu kompetisi (status FINISHED).
 *  - HTTP 429 dihormati: Retry-After + tepat 1× ulang (perilaku asal,
 *    tidak diubah); 429 berulang → lempar.
 *  - Kegagalan level jaringan (fetch melempar sebelum ada respons):
 *    diulang terbatas maks FDORG_MAX_NETWORK_RETRIES kali dengan
 *    backoff — kegagalan sesaat satu kompetisi tidak lagi membunuh
 *    seluruh larian (terbukti live 25 Nov 2026: "fetch failed" pada
 *    kompetisi ke-3 menghentikan 10 kompetisi sisanya). Setelah batas
 *    ulang habis, error dilempar agar pemanggil mencatat kompetisi itu
 *    gagal dan melanjutkan kompetisi berikutnya.
 */
export async function fetchFdorgFinishedMatches(
  fetchFn: FdorgFetchLike,
  token: string,
  competitionCode: string,
  limiter: FdorgRateLimiter,
): Promise<FdorgMatchesPayload> {
  const url = `${FDORG_BASE_URL}/competitions/${encodeURIComponent(competitionCode)}/matches?status=FINISHED`;
  let rateLimitRetries = 0;
  let networkRetries = 0;
  for (;;) {
    await limiter.acquire();
    let res: Awaited<ReturnType<FdorgFetchLike>>;
    try {
      res = await fetchFn(url, { headers: { "X-Auth-Token": token } });
    } catch (e) {
      if (networkRetries >= FDORG_MAX_NETWORK_RETRIES) {
        throw new Error(
          `fdorg: kegagalan jaringan untuk ${competitionCode} setelah ${networkRetries} pengulangan: ` +
            (e instanceof Error ? e.message : String(e)),
        );
      }
      await limiter.sleepMs(FDORG_NETWORK_BACKOFF_MS[networkRetries] ?? 4_000);
      networkRetries++;
      continue;
    }
    if (res.status === 429) {
      if (rateLimitRetries >= 1) {
        throw new Error(`fdorg: HTTP 429 berulang untuk ${competitionCode} — berhenti, hormati batas`);
      }
      rateLimitRetries++;
      const retryAfter = Number(res.headers.get("Retry-After") ?? "60");
      await limiter.sleepMs(Math.max(1, Number.isFinite(retryAfter) ? retryAfter : 60) * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`fdorg: HTTP ${res.status} untuk ${competitionCode}`);
    return (await res.json()) as FdorgMatchesPayload;
  }
}

// ---------------------------------------------------------------------------
// Parsing (fungsi murni) — basis skor 90 menit
// ---------------------------------------------------------------------------

export interface FdorgFinishedResult {
  api_match_id: number;
  competition_code: string;
  kickoff_utc: string;
  home_name: string;
  away_name: string;
  home_goals: number;
  away_goals: number;
  score_basis: "regularTime" | "fullTime";
  home_goals_et: number | null;
  away_goals_et: number | null;
  home_goals_pen: number | null;
  away_goals_pen: number | null;
}

export interface FdorgParseOutcome {
  results: FdorgFinishedResult[];
  /** Laga FINISHED yang skor 90 menitnya tidak bisa ditentukan (tidak ditebak). */
  skipped_basis: number;
  /** Laga non-FINISHED (diabaikan oleh desain). */
  skipped_status: number;
}

function pair(v: { home?: number | null; away?: number | null } | undefined): [number, number] | null {
  if (!v || typeof v.home !== "number" || typeof v.away !== "number") return null;
  return [v.home, v.away];
}

export function parseFdorgFinishedMatches(
  payload: FdorgMatchesPayload,
  competitionCode: string,
): FdorgParseOutcome {
  const results: FdorgFinishedResult[] = [];
  let skippedBasis = 0;
  let skippedStatus = 0;
  for (const m of payload.matches ?? []) {
    if (m.status !== "FINISHED") {
      skippedStatus++;
      continue;
    }
    if (m.id == null || !m.utcDate || !m.homeTeam?.name || !m.awayTeam?.name) {
      skippedBasis++;
      continue;
    }
    const reg = pair(m.score?.regularTime);
    const full = pair(m.score?.fullTime);
    let goals: [number, number] | null = null;
    let basis: "regularTime" | "fullTime" | null = null;
    if (reg) {
      goals = reg;
      basis = "regularTime";
    } else if (full && (m.score?.duration === "REGULAR" || m.score?.duration == null)) {
      goals = full;
      basis = "fullTime";
    }
    if (!goals || !basis) {
      skippedBasis++;
      continue;
    }
    const et = pair(m.score?.extraTime);
    const pen = pair(m.score?.penalties);
    results.push({
      api_match_id: m.id,
      competition_code: competitionCode,
      kickoff_utc: new Date(m.utcDate).toISOString(),
      home_name: m.homeTeam.name,
      away_name: m.awayTeam.name,
      home_goals: goals[0],
      away_goals: goals[1],
      score_basis: basis,
      home_goals_et: et?.[0] ?? null,
      away_goals_et: et?.[1] ?? null,
      home_goals_pen: pen?.[0] ?? null,
      away_goals_pen: pen?.[1] ?? null,
    });
  }
  return { results, skipped_basis: skippedBasis, skipped_status: skippedStatus };
}

// ---------------------------------------------------------------------------
// Pemetaan kanonik (registry dibaca dari data/ cwd — pola repo)
// ---------------------------------------------------------------------------

interface TeamRegistryFile {
  teams: {
    canonical_id: string;
    name: string;
    members: { team_id: string }[];
  }[];
}

export interface FdorgMapping {
  /** team row id (sumber mana pun) → canonical_id. */
  cidOfTeamRow: Map<string, string>;
  /** nama tim ternormalisasi → canonical_id (hanya yang TIDAK ambigu). */
  cidByTeamName: Map<string, string>;
  /**
   * Kunci nama terlucuti-imbuhan → canonical_id, dibangun dari entri
   * cidByTeamName final (pasca-pembersihan ambiguitas). Kunci yang
   * menunjuk >1 canonical_id dibuang (ambigu) — fallback ini tidak
   * pernah menebak di antara dua tim berbeda.
   */
  cidByStrippedTeamName: Map<string, string>;
}

/** Token imbuhan badan hukum yang dilucuti untuk kunci perbandingan longgar. */
const FDORG_AFFIX_TOKENS =
  /\b(fc|afc|cf|ac|as|sc|sv|cd|ud|rc|rcd|ssc|vfb|vfl|spvgg|ogc|losc|aj)\b/g;

/**
 * Kunci perbandingan longgar sebuah nama ternormalisasi: huruf kecil
 * tanpa imbuhan badan hukum (FC/AFC/CF/...). Dipakai HANYA sebagai
 * fallback sesudah kunci persis — lihat resolveFdorgTeamCid.
 */
export function fdorgStrippedTeamKey(normalizedName: string): string {
  return normalizedName
    .toLowerCase()
    .replace(FDORG_AFFIX_TOKENS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolusi nama tim fdorg → canonical_id. Urutan: (1) nama ternormalisasi
 * persis (perilaku asal — semua yang dulu terpetakan tetap terpetakan);
 * (2) kunci terlucuti-imbuhan, untuk nama fdorg berimbuhan badan hukum
 * ("Arsenal FC" → Arsenal). Tidak ketemu keduanya → undefined (antrean).
 */
export function resolveFdorgTeamCid(
  mapping: FdorgMapping,
  rawName: string,
): string | undefined {
  const normalized = normalizeTeamName(rawName);
  return (
    mapping.cidByTeamName.get(normalized) ??
    mapping.cidByStrippedTeamName.get(fdorgStrippedTeamKey(normalized))
  );
}

export function buildFdorgMapping(ds: DatabaseSync): FdorgMapping {
  const cidOfTeamRow = new Map<string, string>();
  const cidByTeamName = new Map<string, string>();
  const ambiguousNames = new Set<string>();
  const regPath = path.join(process.cwd(), "data", "team-canonical.json");
  if (fs.existsSync(regPath)) {
    const reg = JSON.parse(fs.readFileSync(regPath, "utf8")) as TeamRegistryFile;
    for (const t of reg.teams ?? []) {
      cidOfTeamRow.set(t.canonical_id, t.canonical_id);
      for (const m of t.members ?? []) cidOfTeamRow.set(m.team_id, t.canonical_id);
      const key = normalizeTeamName(t.name);
      const prev = cidByTeamName.get(key);
      if (prev && prev !== t.canonical_id) ambiguousNames.add(key);
      else cidByTeamName.set(key, t.canonical_id);
    }
  }
  // Nama dari baris teams dataset (nama sumber) → cid lewat member map.
  try {
    const rows = ds
      .prepare("SELECT team_id, name FROM teams")
      .all() as unknown as { team_id: string; name: string }[];
    for (const r of rows) {
      const cid = cidOfTeamRow.get(r.team_id);
      if (!cid) continue;
      const key = normalizeTeamName(r.name);
      const prev = cidByTeamName.get(key);
      if (prev && prev !== cid) ambiguousNames.add(key);
      else cidByTeamName.set(key, cid);
    }
  } catch {
    /* tabel teams belum ada — pemetaan nama hanya dari registry */
  }
  for (const k of ambiguousNames) cidByTeamName.delete(k);
  // Peta fallback terlucuti-imbuhan, diturunkan dari peta nama final.
  const cidByStrippedTeamName = new Map<string, string>();
  const strippedAmbiguous = new Set<string>();
  for (const [name, cid] of cidByTeamName) {
    const key = fdorgStrippedTeamKey(name);
    if (!key) continue;
    const prev = cidByStrippedTeamName.get(key);
    if (prev && prev !== cid) strippedAmbiguous.add(key);
    else cidByStrippedTeamName.set(key, cid);
  }
  for (const k of strippedAmbiguous) cidByStrippedTeamName.delete(k);
  return { cidOfTeamRow, cidByTeamName, cidByStrippedTeamName };
}

// ---------------------------------------------------------------------------
// Antrean identitas (tabel repo fixture_identity_queue — pola enqueueAmbiguous)
// ---------------------------------------------------------------------------

function enqueueIdentity(
  ds: DatabaseSync,
  sourceMatchId: string,
  reason: string,
  detail: Record<string, unknown>,
  nowUtc: string,
): void {
  ensureIdentitySchema(ds);
  const open = ds
    .prepare(
      "SELECT id FROM fixture_identity_queue WHERE source = ? AND source_match_id = ? AND reason = ? AND resolved_at IS NULL LIMIT 1",
    )
    .get(FDORG_SOURCE, sourceMatchId, reason);
  if (open) return;
  ds.prepare(
    "INSERT INTO fixture_identity_queue (source, source_match_id, reason, detail_json, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(FDORG_SOURCE, sourceMatchId, reason, JSON.stringify(detail), nowUtc);
}

// ---------------------------------------------------------------------------
// Penerapan hasil ke dataset (precedence + revisi + Item 6)
// ---------------------------------------------------------------------------

export interface FdorgApplySummary {
  applied: number;
  duplicates: number;
  corrected: number;
  conflicts_primary_kept: number;
  identity_ambiguous: number;
  unmapped_competition: number;
  unmapped_team: number;
  rows_written: number;
}

interface MatchRow {
  match_id: string;
  competition_id: string;
  season: string;
  utc_date: string;
  status: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
}

function seasonLabelOf(kickoffUtc: string): string {
  const d = new Date(kickoffUtc);
  const y = d.getUTCFullYear();
  const start = d.getUTCMonth() >= 6 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

export function ensureFdorgRevisionSchema(ds: DatabaseSync): void {
  ds.exec(`
    CREATE TABLE IF NOT EXISTS fdorg_result_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anchor_match_id TEXT NOT NULL,
      fo_match_id TEXT NOT NULL,
      primary_home INTEGER,
      primary_away INTEGER,
      fdorg_home INTEGER NOT NULL,
      fdorg_away INTEGER NOT NULL,
      resolution TEXT NOT NULL,
      observed_utc TEXT NOT NULL
    );
  `);
}

/**
 * Terapkan sekumpulan hasil FINISHED fdorg ke dataset. Mengembalikan
 * ringkasan tindakan — tidak ada angka yang disembunyikan.
 */
export function applyFdorgResults(
  ds: DatabaseSync,
  results: FdorgFinishedResult[],
  nowUtc: string,
): FdorgApplySummary {
  ensureIdentitySchema(ds);
  ensureIngestSchema(ds);
  ensureFdorgRevisionSchema(ds);
  const mapping = buildFdorgMapping(ds);
  const sum: FdorgApplySummary = {
    applied: 0,
    duplicates: 0,
    corrected: 0,
    conflicts_primary_kept: 0,
    identity_ambiguous: 0,
    unmapped_competition: 0,
    unmapped_team: 0,
    rows_written: 0,
  };

  const getMatch = ds.prepare("SELECT * FROM matches WHERE match_id = ?");
  const insTeam = ds.prepare(
    "INSERT OR IGNORE INTO teams (team_id, name, short_name, country, stadium, updated_at) VALUES (?, ?, NULL, ?, NULL, ?)",
  );
  const insMatch = ds.prepare(
    `INSERT OR IGNORE INTO matches (match_id, competition_id, season, utc_date, status, home_team_id, away_team_id, home_score, away_score, referee_name, updated_at, available_at)
     VALUES (?, ?, ?, ?, 'finished', ?, ?, ?, ?, NULL, ?, ?)`,
  );
  const updFoMatch = ds.prepare(
    "UPDATE matches SET home_score = ?, away_score = ?, updated_at = ? WHERE match_id = ?",
  );
  const insRevision = ds.prepare(
    `INSERT INTO fdorg_result_revisions
       (anchor_match_id, fo_match_id, primary_home, primary_away, fdorg_home, fdorg_away, resolution, observed_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const r of results) {
    const div = FDORG_CODE_TO_DIV[r.competition_code];
    const sourceMatchId = `fo_match_${r.api_match_id}`;
    if (!div) {
      enqueueIdentity(ds, sourceMatchId, "fdorg_unmapped_competition", {
        competition_code: r.competition_code,
        home: r.home_name,
        away: r.away_name,
      }, nowUtc);
      sum.unmapped_competition++;
      continue;
    }
    const homeCid = resolveFdorgTeamCid(mapping, r.home_name);
    const awayCid = resolveFdorgTeamCid(mapping, r.away_name);
    if (!homeCid || !awayCid) {
      enqueueIdentity(ds, sourceMatchId, "fdorg_unmapped_team", {
        competition_code: r.competition_code,
        div,
        home: r.home_name,
        away: r.away_name,
        home_mapped: Boolean(homeCid),
        away_mapped: Boolean(awayCid),
      }, nowUtc);
      sum.unmapped_team++;
      continue;
    }

    const canonical = getCanonicalBySourceId(div);
    const homeNorm = normalizeTeamName(r.home_name);
    const awayNorm = normalizeTeamName(r.away_name);
    const foId = `fo_${div}_${yyyymmdd(r.kickoff_utc)}_${teamSlug(homeNorm)}_${teamSlug(awayNorm)}`;
    const homeRowId = `fo_${teamSlug(homeNorm)}`;
    const awayRowId = `fo_${teamSlug(awayNorm)}`;
    insTeam.run(homeRowId, r.home_name, canonical?.country ?? null, nowUtc);
    insTeam.run(awayRowId, r.away_name, canonical?.country ?? null, nowUtc);

    // Baris namespace fdorg sendiri (pola fd_): tulis bila belum ada.
    // Penyegaran skor baris fo_ yang sudah ada ditunda sampai jangkar
    // diketahui: bila baris fo_ adalah jangkarnya sendiri, perubahan
    // skor WAJIB lewat applyResultObservation agar tercatat sebagai
    // revisi D2 — update manual lebih dulu akan terbaca "duplicate".
    const existingFo = getMatch.get(foId) as unknown as MatchRow | undefined;
    if (!existingFo) {
      insMatch.run(
        foId, div, seasonLabelOf(r.kickoff_utc), r.kickoff_utc,
        homeRowId, awayRowId, r.home_goals, r.away_goals, nowUtc, nowUtc,
      );
      sum.rows_written++;
    }

    // Jangkar primer: baris non-fo_ pada tanggal + cid yang sama.
    const date10 = r.kickoff_utc.slice(0, 10);
    const candidates = (ds
      .prepare(
        "SELECT * FROM matches WHERE match_id NOT LIKE 'fo_%' AND substr(utc_date, 1, 10) = ?",
      )
      .all(date10) as unknown as MatchRow[]).filter(
      (c) =>
        mapping.cidOfTeamRow.get(c.home_team_id) === homeCid &&
        mapping.cidOfTeamRow.get(c.away_team_id) === awayCid,
    );
    const anchor = candidates.length === 1 ? candidates[0] : undefined;
    const anchorId = anchor?.match_id ?? foId;
    const anchorRow = (anchor ?? (getMatch.get(foId) as unknown as MatchRow)) as MatchRow;

    // Ada jangkar primer terpisah → baris fo_ murni catatan namespace
    // fdorg; segarkan skornya langsung (jangkar diatur precedence/D2).
    if (
      anchor &&
      existingFo &&
      (existingFo.home_score !== r.home_goals || existingFo.away_score !== r.away_goals)
    ) {
      updFoMatch.run(r.home_goals, r.away_goals, nowUtc, foId);
      sum.rows_written++;
    }

    // Precedence: jangkar primer yang sudah finished berskor selalu menang.
    if (
      anchor &&
      anchor.status === "finished" &&
      anchor.home_score != null &&
      anchor.away_score != null &&
      (anchor.home_score !== r.home_goals || anchor.away_score !== r.away_goals)
    ) {
      insRevision.run(
        anchor.match_id, foId, anchor.home_score, anchor.away_score,
        r.home_goals, r.away_goals, "primary_kept", nowUtc,
      );
      sum.conflicts_primary_kept++;
      continue;
    }

    // Terapkan lewat mesin D2 (resolusi identitas dari baris jangkar,
    // pola yang sama persis dengan import-free-feed).
    const resolved = resolveFixtureIdentity(
      ds,
      {
        source: anchor ? sourceOfMatchId(anchorId) : FDORG_SOURCE,
        sourceMatchId: anchorId,
        competitionId: anchorRow.competition_id,
        season: anchorRow.season,
        // cid dari pemetaan nama fdorg — untuk jangkar primer nilainya
        // identik dengan cid baris jangkar (kandidat memang disaring
        // dengan kesetaraan cid), dan untuk jangkar fo_ ini satu-satunya
        // sumber yang benar (id baris fo_ bukan member registry).
        homeCid,
        awayCid,
        homeName: r.home_name,
        awayName: r.away_name,
        kickoffUtc: anchorRow.utc_date,
        kickoffPrecision: "exact",
      },
      nowUtc,
    );
    if (resolved.kind === "ambiguous") {
      sum.identity_ambiguous++;
      continue;
    }
    if (foId !== anchorId) {
      linkAlias(ds, resolved.fixtureUid, FDORG_SOURCE, foId, "result_bridge", nowUtc);
    }
    const outcome = applyResultObservation(ds, {
      fixtureUid: resolved.fixtureUid,
      anchorMatchId: anchorId,
      statusRaw: "finished",
      homeScore: r.home_goals,
      awayScore: r.away_goals,
      homeScoreEt: r.home_goals_et,
      awayScoreEt: r.away_goals_et,
      homeScorePen: r.home_goals_pen,
      awayScorePen: r.away_goals_pen,
      source: FDORG_SOURCE,
      observedAt: nowUtc,
    });
    const action: ObservationAction = outcome.action;
    if (action === "applied") sum.applied++;
    else if (action === "duplicate") sum.duplicates++;
    else if (action === "corrected") sum.corrected++;
  }

  recordSuccessfulIngest(
    ds,
    FDORG_SOURCE,
    nowUtc,
    `applied=${sum.applied} dup=${sum.duplicates} corrected=${sum.corrected} ` +
      `conflict_primary_kept=${sum.conflicts_primary_kept} unmapped_team=${sum.unmapped_team} ` +
      `unmapped_comp=${sum.unmapped_competition} ambiguous=${sum.identity_ambiguous}`,
  );
  return sum;
}

// ---------------------------------------------------------------------------
// Larian multi-kompetisi dengan isolasi kegagalan per kompetisi
// ---------------------------------------------------------------------------

export interface FdorgImportRunResult {
  totals: FdorgApplySummary;
  skipped_basis: number;
  skipped_status: number;
  /** Kompetisi yang gagal total (fetch/apply melempar) — larian TIDAK mati karenanya. */
  failures: { code: string; error: string }[];
}

/**
 * Jalankan impor untuk daftar kode kompetisi dengan SATU rate limiter
 * bersama. Kegagalan satu kompetisi dicatat di `failures` + dilog, lalu
 * larian MELANJUTKAN kompetisi berikutnya — kegagalan sebagian dilaporkan
 * apa adanya, tidak pernah menyamar sebagai sukses penuh (pemanggil
 * memutuskan kode exit dari `failures`).
 */
export async function runFdorgCompetitions(
  ds: DatabaseSync,
  fetchFn: FdorgFetchLike,
  token: string,
  codes: string[],
  nowUtc: () => string,
  log: (line: string) => void = () => {},
  limiter: FdorgRateLimiter = new FdorgRateLimiter(),
): Promise<FdorgImportRunResult> {
  const totals: FdorgApplySummary = {
    applied: 0, duplicates: 0, corrected: 0, conflicts_primary_kept: 0,
    identity_ambiguous: 0, unmapped_competition: 0, unmapped_team: 0, rows_written: 0,
  };
  let skippedBasis = 0;
  let skippedStatus = 0;
  const failures: { code: string; error: string }[] = [];
  for (const code of codes) {
    try {
      const payload = await fetchFdorgFinishedMatches(fetchFn, token, code, limiter);
      const parsed = parseFdorgFinishedMatches(payload, code);
      skippedBasis += parsed.skipped_basis;
      skippedStatus += parsed.skipped_status;
      const s = applyFdorgResults(ds, parsed.results, nowUtc());
      for (const k of Object.keys(totals) as (keyof FdorgApplySummary)[]) {
        totals[k] += s[k];
      }
      log(
        `[fdorg-results] ${code}: parsed=${parsed.results.length} applied=${s.applied} dup=${s.duplicates} ` +
          `corrected=${s.corrected} conflict_primary_kept=${s.conflicts_primary_kept} ` +
          `unmapped_team=${s.unmapped_team} ambiguous=${s.identity_ambiguous}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push({ code, error: msg });
      log(`[fdorg-results] ${code}: GAGAL — ${msg} — kompetisi dilewati, larian berlanjut.`);
    }
  }
  return { totals, skipped_basis: skippedBasis, skipped_status: skippedStatus, failures };
}
