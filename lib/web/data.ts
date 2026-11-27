/**
 * DATA WEB — lapis baca-saja untuk frontend.
 *
 * Semua angka yang tampil di web berasal dari artefak pipeline yang sudah
 * tersimpan (paket analisis, ledger pick, dataset hasil, telemetri kanonik).
 * File ini TIDAK menghitung model baru dan TIDAK menulis apa pun:
 * koneksi dibuka readOnly, query hanya SELECT.
 *
 * Dipakai hanya dari Server Component / route handler.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dbPath } from "../db/paths";
import {
  canonicalIdForTeamId,
  canonicalIdForTeamName,
  loadCanonicalTeams,
} from "../quant/team-identity";
import { MARKET_GRADE_THRESHOLDS } from "../picks/engine";
import {
  getSiblingIds,
  getUidForMatchId,
  identityTablesExist,
  isFinishedStatus,
  linkSiblingsOf,
  loadFixtureLinkGroups,
  type FixtureLinkGroup,
} from "../identity/fixture-resolver";
import {
  displayStatus,
  menitDariStatusMentah,
  skorTerlihat,
  terapkanWaktu,
  type StatusTampil,
} from "./status";
import { labelPilihan } from "./format";
import { urlLogoTim } from "./logo";
import { labelSumberPeluang } from "./sumber-peluang";
import {
  kelompokkanKejadianResmi,
  petaUidFisik,
  type KonflikPilihan,
} from "./rekam";

type Db = DatabaseSync;
const g = globalThis as unknown as { __webDbs?: Map<string, Db> };
function db(file: string): Db {
  if (!g.__webDbs) g.__webDbs = new Map();
  let h = g.__webDbs.get(file);
  if (!h) {
    // Path DB terpusat via lib/db/paths (DB_DIR-aware; default tetap
    // subfolder "data" yang statis agar tracing build tidak menyapu
    // seluruh proyek — peringatan NFT Turbopack).
    h = new DatabaseSync(dbPath(file), { readOnly: true });
    g.__webDbs.set(file, h);
  }
  return h;
}
const packagesDb = () => db("analysis_snapshots.db");
const picksDb = () => db("picks.db");
const datasetDb = () => db("thestats_dataset.db");
/** Katalog jadwal hidup di file terpisah dan boleh absen (degrade kosong). */
function upcomingDb(): Db | null {
  if (!fs.existsSync(dbPath("upcoming_fixtures.db"))) return null;
  try {
    return db("upcoming_fixtures.db");
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ types */

export interface PayloadFixture {
  match_id: string;
  competition_name: string;
  home: string;
  away: string;
  kickoff_utc: string;
}
export interface QuantPayload {
  fixture: PayloadFixture;
  gate_status: string;
  population: string;
  lambda: number;
  mu: number;
  rho: number;
  probabilities: Record<string, number>;
  top_scores: { home_goals: number; away_goals: number; prob: number }[];
  score_matrix: number[][];
  /** Massa di luar grid model SEBELUM normalisasi (besaran quant sendiri;
   *  bukan sisa tampilan peta — jangan dijumlahkan, brief §9). */
  score_matrix_tail_mass?: number | null;
  market?: { probs: Record<string, number>; captured_utc: string | null; bookmakers: string[] } | null;
  sm_panel?: { probs: Record<string, number>; batch_utc: string | null } | null;
  legs?: Leg[];
  shrunk_metadata?: {
    calibrationGate?: string;
    luckMetrics?: unknown;
    leagueResolution?: { note?: string; fitSystem?: string };
    [k: string]: unknown;
  };
}
export interface Leg {
  market: string;
  selection: string;
  model_prob: number;
  effective_prob: number;
  effective_source: string;
  band: string | null;
  band_n: number | null;
  grade: string;
  market_prob: number | null;
  sm_prob: number | null;
  agreement_spread: number | null;
}
export interface PackageRow {
  id: number;
  match_id: string;
  competition_canonical_id: string;
  kickoff_utc: string;
  computed_utc: string;
  fit_source: string;
  gate_status: string;
  cup_delta: number | null;
  odds_captured_utc: string | null;
  payload: QuantPayload;
}
export interface PickRow {
  id: number;
  match_id: string;
  kickoff_utc: string;
  market: string;
  selection: string;
  model_prob: number;
  market_prob: number | null;
  sm_prob: number | null;
  /** Koreksi lab terstruktur (kolom ledger, audit T3); null = tak ada koreksi. */
  effective_prob: number | null;
  effective_source: string | null;
  agreement_spread: number | null;
  gate_status: string;
  grade: string;
  source: string;
  package_id: number | null;
  /* Bukti terbit beku (K2, kolom aditif — absen/null pada baris warisan
     yang belum dimigrasi; basis 'unknown_legacy' sesudah migrasi). */
  published_prob: number | null;
  probability_basis: string | null;
  published_at_utc: string | null;
  hit: number | null;
  home_goals: number | null;
  away_goals: number | null;
}
export interface MatchResult {
  home_goals: number;
  away_goals: number;
  finished: boolean;
}
export interface FormEntry {
  date: string;
  opponent: string;
  venue: string;
  goals_for: number;
  goals_against: number;
  result: "W" | "D" | "L";
  xg_for: number | null;
  xg_against: number | null;
}

/* ---------------------------------------------------------------- helpers */

/**
 * Normalisasi field market satu paket (butir review 1). Tiga bentuk
 * terbukti ada di tabel packages produksi: (1) lengkap — probs terisi,
 * captured_utc string, bookmakers array; (2) warisan hadir-tapi-kosong —
 * probs {}, captured_utc null, bookmakers null (3.650 paket; bentuk ini
 * yang melempar TypeError di halaman detail karena komponen membaca
 * bookmakers.length dari null); (3) market null / field absen.
 *
 * Aturan adapter: harga pasar dianggap TERSEDIA hanya bila ada peluang
 * yang benar-benar tertangkap (probs tak kosong) — bentuk (2) menjadi
 * null, sehingga bagian pasar tampil "belum tersedia" dan tidak
 * menghitung sumber hantu. Bila harga memang ada, field pendamping yang
 * hilang terdegradasi sendiri-sendiri: bookmakers null/absen → []
 * (daftar nama hanyalah label), captured_utc non-string → null (waktu
 * tangkap memang tidak tercatat). Konsumen tidak pernah melihat bentuk
 * mentah — normalisasi hidup di sini, bukan penjaga tersebar di komponen.
 */
function normalizeMarket(raw: unknown): QuantPayload["market"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const m = raw as { probs?: unknown; captured_utc?: unknown; bookmakers?: unknown };
  const probs =
    m.probs && typeof m.probs === "object" && !Array.isArray(m.probs)
      ? (m.probs as Record<string, number>)
      : {};
  if (Object.keys(probs).length === 0) return null;
  return {
    probs,
    captured_utc:
      typeof m.captured_utc === "string" && m.captured_utc ? m.captured_utc : null,
    bookmakers: Array.isArray(m.bookmakers)
      ? m.bookmakers.filter((b): b is string => typeof b === "string")
      : [],
  };
}

/**
 * Normalisasi payload lintas generasi paket. Tabel packages menyimpan tiga
 * bentuk historis: (1) quant-package terkini dengan fixture bersarang;
 * (2) bentuk datar awal (fixture di level atas, hanya legs — tanpa
 * probabilitas/matriks); (3) paket manual e2e lama (bentuk bebas).
 * Semua konsumen web hanya melihat bentuk (1); bentuk lain dilengkapi
 * nilai kosong yang jujur, dan nama tim bentuk (3) dicari dari dataset.
 */
function normalizePayload(
  raw: Record<string, unknown>,
  rowMatchId: string,
  rowKickoff: string,
): QuantPayload {
  const base: QuantPayload = {
    fixture: {
      match_id: rowMatchId,
      competition_name: "",
      home: "?",
      away: "?",
      kickoff_utc: rowKickoff,
    },
    gate_status: (raw.gate_status as string) ?? "uncalibrated",
    population: (raw.population as string) ?? "unknown",
    lambda: (raw.lambda as number) ?? 0,
    mu: (raw.mu as number) ?? 0,
    rho: (raw.rho as number) ?? 0,
    probabilities: (raw.probabilities as Record<string, number>) ?? {},
    top_scores: (raw.top_scores as QuantPayload["top_scores"]) ?? [],
    score_matrix: (raw.score_matrix as number[][]) ?? [],
    market: normalizeMarket(raw.market),
    sm_panel: (raw.sm_panel as QuantPayload["sm_panel"]) ?? null,
    legs: (raw.legs as Leg[]) ?? [],
    shrunk_metadata: raw.shrunk_metadata as QuantPayload["shrunk_metadata"],
  };
  if (raw.fixture) {
    const merged = { ...base, ...(raw as unknown as QuantPayload) };
    // Spread membawa market mentah apa adanya — normalisasi ulang di
    // adapter (satu-satunya pintu) sebelum payload dilihat konsumen.
    merged.market = normalizeMarket(raw.market);
    return merged;
  }
  if (typeof raw.home === "string" && typeof raw.away === "string") {
    base.fixture = {
      match_id: (raw.match_id as string) ?? rowMatchId,
      competition_name: (raw.competition_name as string) ?? "",
      home: raw.home,
      away: raw.away,
      kickoff_utc: (raw.utc_date as string) ?? rowKickoff,
    };
    return base;
  }
  // Bentuk manual lama: nama tim dari selection.fixture bila ada…
  const sel = raw.selection as
    | { fixture?: { home_team_name?: string; away_team_name?: string; competition_name?: string; utc_date?: string } }
    | undefined;
  if (sel?.fixture?.home_team_name && sel?.fixture?.away_team_name) {
    base.fixture.home = sel.fixture.home_team_name;
    base.fixture.away = sel.fixture.away_team_name;
    base.fixture.competition_name = sel.fixture.competition_name ?? "";
    if (sel.fixture.utc_date) base.fixture.kickoff_utc = sel.fixture.utc_date;
    return base;
  }
  // …kalau tidak, dari baris dataset (id → nama kanonik).
  try {
    const m = datasetDb()
      .prepare(`SELECT home_team_id, away_team_id, competition_id FROM matches WHERE match_id = ?`)
      .get(rowMatchId) as
      | { home_team_id: string; away_team_id: string; competition_id: string }
      | undefined;
    if (m) {
      const nameOf = (tid: string) => {
        const cid = canonicalIdForTeamId(tid);
        return cid ? opponentName(cid) : tid;
      };
      base.fixture.home = nameOf(m.home_team_id);
      base.fixture.away = nameOf(m.away_team_id);
    }
  } catch {
    /* nama tetap "?" — halaman menampilkan apa adanya */
  }
  return base;
}

function parsePackage(r: Record<string, unknown>): PackageRow {
  return {
    id: r.id as number,
    match_id: r.match_id as string,
    competition_canonical_id: r.competition_canonical_id as string,
    kickoff_utc: r.kickoff_utc as string,
    computed_utc: r.computed_utc as string,
    fit_source: r.fit_source as string,
    gate_status: r.gate_status as string,
    cup_delta: (r.cup_delta as number | null) ?? null,
    odds_captured_utc: (r.odds_captured_utc as string | null) ?? null,
    payload: normalizePayload(
      JSON.parse(r.payload_json as string) as Record<string, unknown>,
      r.match_id as string,
      r.kickoff_utc as string,
    ),
  };
}

const LATEST_PER_MATCH = `
  SELECT p.* FROM packages p
  JOIN (SELECT match_id, MAX(id) AS mid FROM packages GROUP BY match_id) t
    ON t.mid = p.id
`;

/**
 * Bentuk kickoff-first (PR 1B, brief hal. 8): jendela kickoff disaring
 * lewat idx_packages_kickoff SEBELUM latest-per-match dipilih. Subquery
 * korelasi memeriksa id GLOBAL maksimum per match_id (tanpa filter
 * jendela di dalamnya), jadi semantiknya persis LATEST_PER_MATCH:
 * edisi terbaru yang kickoff-nya pindah keluar jendela tetap menyingkir-
 * kan laga itu, dan edisi lama di dalam jendela tidak hidup lagi.
 * Yang berubah hanya rencananya: tanpa grup atas seluruh tabel dan
 * tanpa temp B-tree untuk ORDER BY (urutan datang dari indeks kickoff).
 * Parameter: (dariUtc, sampaiUtc) inklusif — sama seperti bentuk lama.
 */
const LATEST_PER_MATCH_KICKOFF_FIRST = `
  SELECT p.* FROM packages p
  WHERE p.kickoff_utc >= ? AND p.kickoff_utc <= ?
    AND p.id = (SELECT MAX(q.id) FROM packages q WHERE q.match_id = p.match_id)
`;

/**
 * Seluruh id satu laga fisik dengan `matchId` — untuk hasil laga.
 *
 * K1: dua sumber tautan lewat resolver identitas yang sama dengan
 * produser: (1) registry katalog data/fixture-links.json dibaca dengan
 * parser tervalidasi bersama (bentuk sebenarnya `links[]`, bukan
 * `groups` yang dicari versi lama — itulah sebabnya hasil kembar dulu
 * tidak pernah terbaca web); (2) store identitas persisten di dataset
 * (fixture_aliases), yang menjangkau kembar yang tidak berbagi baris
 * katalog. DB pra-migrasi tanpa tabel identitas degrade ke (1) saja.
 */
let linkGroupsCache: FixtureLinkGroup[] | null = null;
function siblingsOf(matchId: string): string[] {
  if (!linkGroupsCache) {
    linkGroupsCache = loadFixtureLinkGroups(path.join(process.cwd(), "data"));
  }
  const ids = new Set<string>([matchId]);
  for (const id of linkSiblingsOf(linkGroupsCache, matchId)) ids.add(id);
  try {
    for (const id of getSiblingIds(datasetDb(), matchId)) ids.add(id);
  } catch {
    /* dataset belum tersedia / belum bermigrasi: tautan file tetap jalan */
  }
  return [...ids];
}

export function getResult(matchId: string): MatchResult | null {
  const d = datasetDb();
  for (const id of siblingsOf(matchId)) {
    const row = d
      .prepare(
        `SELECT home_score, away_score, status FROM matches WHERE match_id = ?`,
      )
      .get(id) as
      | { home_score: number | null; away_score: number | null; status: string }
      | undefined;
    if (row && row.home_score !== null && row.away_score !== null) {
      return {
        home_goals: row.home_score,
        away_goals: row.away_score,
        // Kosakata status dinormalisasi: dataset memakai 'finished',
        // sumber lain 'FT' — keduanya final (dulu flag ini selalu false
        // untuk baris dataset karena perbandingannya literal 'FT').
        finished: isFinishedStatus(row.status),
      };
    }
  }
  return null;
}

let teamNameByCanonical: Map<string, string> | null = null;
function opponentName(canonicalId: string): string {
  if (!teamNameByCanonical) {
    teamNameByCanonical = new Map(loadCanonicalTeams().map((t) => [t.canonical_id, t.name]));
  }
  return teamNameByCanonical.get(canonicalId) ?? canonicalId;
}

/**
 * Penjaga isolasi bagian (redesain L2, brief §3C.5): satu pembaca
 * bagian yang gagal (tabel bantu belum dibangun rantai refresh, DB
 * parsial, dst.) terdegradasi ke keadaan kosong MILIKNYA — tidak
 * meruntuhkan halaman yang memuatnya. Data inti laga tidak pernah
 * lewat penjaga ini; yang dijaga hanya bagian analisis/pendukung.
 */
function bagian<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * Form 6 laga terakhir dari telemetri KANONIK (satu baris per laga fisik).
 * Bagian pendukung: tabel telemetri yang belum ada (rantai refresh
 * belum membangunnya) menghasilkan form kosong, BUKAN pengecualian —
 * halaman detail tetap render dengan bagian form terdegradasi.
 */
export function getForm(teamName: string, beforeUtc: string, limit = 6): FormEntry[] {
  const cid = canonicalIdForTeamName(teamName);
  if (!cid) return [];
  const rows = bagian(
    () =>
      datasetDb()
        .prepare(
          `SELECT match_date, canonical_opponent_id, venue, goals_for, goals_against,
                  xg_for, xg_against
           FROM team_match_logs_canonical
           WHERE canonical_team_id = ? AND substr(match_date, 1, 10) < ?
           ORDER BY match_date DESC LIMIT ?`,
        )
        .all(cid, beforeUtc.slice(0, 10), limit) as Record<string, unknown>[],
    [] as Record<string, unknown>[],
  );
  return rows.map((r) => {
    const gf = r.goals_for as number;
    const ga = r.goals_against as number;
    return {
      date: r.match_date as string,
      opponent: opponentName(r.canonical_opponent_id as string),
      venue: r.venue as string,
      goals_for: gf,
      goals_against: ga,
      result: gf > ga ? "W" : gf < ga ? "L" : "D",
      xg_for: (r.xg_for as number | null) ?? null,
      xg_against: (r.xg_against as number | null) ?? null,
    } satisfies FormEntry;
  });
}

/* ------------------------------------------------------------- public API */

export interface FixtureListItem {
  pkg: PackageRow;
  pickCounts: { A: number; B: number; C: number };
  topLeg: Leg | null;
  result: MatchResult | null;
}

function enrich(pkg: PackageRow): FixtureListItem {
  const counts = { A: 0, B: 0, C: 0 };
  for (const leg of pkg.payload.legs ?? []) {
    if (leg.grade === "A") counts.A += 1;
    else if (leg.grade === "B") counts.B += 1;
    else if (leg.grade === "C") counts.C += 1;
  }
  const legs = [...(pkg.payload.legs ?? [])].sort((a, b) => {
    const rank = (gr: string) => (gr === "A" ? 0 : gr === "B" ? 1 : 2);
    return rank(a.grade) - rank(b.grade) || b.effective_prob - a.effective_prob;
  });
  return { pkg, pickCounts: counts, topLeg: legs[0] ?? null, result: getResult(pkg.match_id) };
}

/** Pertandingan mendatang (jendela jam) dari paket versi terbaru per laga. */
export function listUpcoming(hours = 72): FixtureListItem[] {
  return listUpcomingPada(Date.now(), hours);
}

/** Sama seperti listUpcoming, dengan acuan waktu eksplisit (untuk uji jam beku). */
function listUpcomingPada(nowMs: number, hours = 72): FixtureListItem[] {
  const rows = packagesDb()
    .prepare(`${LATEST_PER_MATCH_KICKOFF_FIRST} ORDER BY p.kickoff_utc ASC`)
    .all(
      new Date(nowMs - 3 * 3_600_000).toISOString(),
      new Date(nowMs + hours * 3_600_000).toISOString(),
    ) as Record<string, unknown>[];
  return rows.map((r) => enrich(parsePackage(r)));
}

/* ------------------------------------------- sorotan beranda (brief §3A) */

export interface SorotanBeranda {
  /**
   * prediksi      — laga punya pilihan RESMI terbit sebelum kickoff;
   * tanpa-prediksi— laga terdekat di jendela, belum ada prediksi resmi;
   * berikutnya    — jendela kosong, laga pertama sesudah jendela;
   * hasil-terakhir— tak ada laga mendatang sama sekali, hasil nyata terakhir.
   */
  jenis: "prediksi" | "tanpa-prediksi" | "berikutnya" | "hasil-terakhir";
  match_id: string;
  home: string;
  away: string;
  competition_name: string;
  kickoff_utc: string;
  gate_status: string;
  /** Hanya jenis "prediksi": kejadian utama dalam kata ("Bengaluru mencetak gol"). */
  label_prediksi: string | null;
  /** Hanya jenis "prediksi": peluang RESMI saat terbit (beku K2). */
  prob: number | null;
  /** Hanya jenis "prediksi": waktu terbit pilihan utama (published_at_utc). */
  published_at_utc: string | null;
  /** Hanya jenis "hasil-terakhir": skor regulasi terkonfirmasi. */
  home_goals: number | null;
  away_goals: number | null;
}

const JENDELA_SOROTAN_JAM = 72;

function dasarSorotan(item: FixtureListItem): Omit<SorotanBeranda, "jenis"> {
  const f = item.pkg.payload.fixture;
  return {
    match_id: item.pkg.match_id,
    home: f.home,
    away: f.away,
    competition_name: f.competition_name,
    kickoff_utc: item.pkg.kickoff_utc,
    gate_status: item.pkg.gate_status,
    label_prediksi: null,
    prob: null,
    published_at_utc: null,
    home_goals: null,
    away_goals: null,
  };
}

/**
 * Sorotan beranda (brief §3A.2): laga mendatang TERDEKAT dalam jendela
 * tampilan (72 jam) yang mempunyai prediksi pra-laga RESMI — pilihan
 * terbit jalur K2 (pick_uid) dengan published_at_utc sebelum kickoff.
 * Urutan kickoff menaik; seri dipecahkan identitas kanonik (fixture_uid,
 * lalu match_id). Prediksi utama = peluang terbit tertinggi laga itu
 * (seri: kelas lebih tinggi, lalu pick_uid) — satu kejadian yang bisa
 * dipahami, bukan tiga angka 1X2 (itu tempatnya di detail).
 *
 * Tangga fallback persis brief: tanpa prediksi resmi → laga terdekat
 * (aksi "Lihat jadwal laga"); jendela kosong → laga pertama sesudah
 * jendela (tanggal eksplisit di UI) atau hasil terakhir yang benar-
 * benar tersedia; keduanya kosong → null.
 */
export function sorotanBeranda(now: Date = new Date()): SorotanBeranda | null {
  const nowMs = now.getTime();
  const mendatang = listUpcomingPada(nowMs, JENDELA_SOROTAN_JAM).filter(
    (i) => Date.parse(i.pkg.kickoff_utc) >= nowMs,
  );
  return sorotanDariDaftar(mendatang, nowMs);
}

/**
 * Inti sorotan atas daftar mendatang yang SUDAH dibaca (PR 1B): dipisah
 * dari pembacaannya supaya pembaca gabungan Beranda memakai logika yang
 * persis sama atas satu lintasan baca — bukan salinan kedua yang bisa
 * menyimpang. Tangga fallback tetap di sini: jendela kosong → laga
 * pertama sesudah jendela → hasil terakhir → null.
 */
function sorotanDariDaftar(
  mendatang: FixtureListItem[],
  nowMs: number,
): SorotanBeranda | null {
  for (const item of mendatang) {
    const resmi = bagian(
      () => getOfficialPicks(item.pkg.match_id, fixtureUidOf(item.pkg.match_id)),
      [] as OfficialPick[],
    ).filter(
      (p) =>
        p.published_prob !== null &&
        p.published_at_utc !== null &&
        p.published_at_utc < item.pkg.kickoff_utc,
    );
    if (resmi.length === 0) continue;
    const peringkatKelas = (g: string) => (g === "A" ? 0 : g === "B" ? 1 : 2);
    const utama = [...resmi].sort(
      (a, b) =>
        (b.published_prob ?? 0) - (a.published_prob ?? 0) ||
        peringkatKelas(a.grade) - peringkatKelas(b.grade) ||
        a.pick_uid.localeCompare(b.pick_uid),
    )[0];
    const f = item.pkg.payload.fixture;
    return {
      ...dasarSorotan(item),
      jenis: "prediksi",
      label_prediksi: labelPilihan(utama.market, utama.selection, f.home, f.away),
      prob: utama.published_prob,
      published_at_utc: utama.published_at_utc,
    };
  }
  if (mendatang.length > 0) {
    return { ...dasarSorotan(mendatang[0]), jenis: "tanpa-prediksi" };
  }
  const sesudah = bagian(() => {
    const row = packagesDb()
      .prepare(
        // Sengaja tetap bentuk LATEST_PER_MATCH (bukan kickoff-first):
        // query LIMIT 1 ini jalur dingin (jendela 72 jam kosong), dan
        // pada kickoff yang SERI urutan kedua bentuk query terbukti
        // bisa berbeda di data produksi — bentuk lama dipertahankan
        // persis agar pilihan laga pada seri tidak berubah (PR 1B).
        `${LATEST_PER_MATCH} WHERE p.kickoff_utc > ? ORDER BY p.kickoff_utc ASC LIMIT 1`,
      )
      .get(new Date(nowMs + JENDELA_SOROTAN_JAM * 3_600_000).toISOString()) as
      | Record<string, unknown>
      | undefined;
    return row ? enrich(parsePackage(row)) : null;
  }, null);
  if (sesudah) return { ...dasarSorotan(sesudah), jenis: "berikutnya" };
  const selesai = bagian(() => listFinished(24 * 30, 1), [] as FixtureListItem[]);
  if (selesai.length > 0 && selesai[0].result) {
    return {
      ...dasarSorotan(selesai[0]),
      jenis: "hasil-terakhir",
      home_goals: selesai[0].result.home_goals,
      away_goals: selesai[0].result.away_goals,
    };
  }
  return null;
}

/**
 * Daftar "Jadwal berikutnya" di samping sorotan: laga mendatang pada
 * jendela yang sama, DENGAN laga sorotan dikeluarkan — pengeluaran
 * memakai identitas fisik (fixture_uid identitas K1, atau kelompok
 * sibling) supaya kembar lintas provider sorotan tidak muncul lagi
 * sebagai baris terpisah.
 */
export function jadwalBerikutnya(
  sorotan: SorotanBeranda | null,
  now: Date = new Date(),
  limit = 5,
): FixtureListItem[] {
  const nowMs = now.getTime();
  const mendatang = listUpcomingPada(nowMs, JENDELA_SOROTAN_JAM).filter(
    (i) => Date.parse(i.pkg.kickoff_utc) >= nowMs,
  );
  return jadwalDariDaftar(mendatang, sorotan, limit);
}

/**
 * Inti "Jadwal berikutnya" atas daftar mendatang yang SUDAH dibaca
 * (PR 1B) — pasangan `sorotanDariDaftar`: pengeluaran laga sorotan
 * memakai identitas fisik yang sama, atas lintasan baca yang sama.
 */
function jadwalDariDaftar(
  mendatang: FixtureListItem[],
  sorotan: SorotanBeranda | null,
  limit: number,
): FixtureListItem[] {
  let items = mendatang;
  if (sorotan && sorotan.jenis !== "hasil-terakhir") {
    const uidSorotan = fixtureUidOf(sorotan.match_id);
    const sibling = new Set(siblingsOf(sorotan.match_id));
    items = items.filter((i) => {
      if (sibling.has(i.pkg.match_id)) return false;
      const uid = fixtureUidOf(i.pkg.match_id);
      return !(uidSorotan && uid && uid === uidSorotan);
    });
  }
  return items.slice(0, limit);
}

/**
 * SATU pembaca Beranda (PR 1B, brief hal. 8): sorotan + jadwal
 * berikutnya dari SATU nilai nowUtc dan SATU lintasan baca jendela
 * 72 jam. Sebelumnya halaman memanggil `sorotanBeranda` dan
 * `jadwalBerikutnya` terpisah — masing-masing menjalankan query
 * latest-per-match + decode payload + pengayaan yang sama dua kali.
 * Keluaran identik dengan pasangan lama menurut konstruksi: kedua inti
 * di atas dipakai bersama, hanya sumber daftarnya yang disatukan.
 */
export function berandaSorotanDanJadwal(now: Date = new Date()): {
  sorotan: SorotanBeranda | null;
  berikut: FixtureListItem[];
} {
  const nowMs = now.getTime();
  const mendatang = listUpcomingPada(nowMs, JENDELA_SOROTAN_JAM).filter(
    (i) => Date.parse(i.pkg.kickoff_utc) >= nowMs,
  );
  const sorotan = sorotanDariDaftar(mendatang, nowMs);
  return { sorotan, berikut: jadwalDariDaftar(mendatang, sorotan, 5) };
}

/** Pertandingan yang baru selesai (untuk panel paket vs kenyataan). */
export function listFinished(hoursBack = 72, limit = 60): FixtureListItem[] {
  const now = Date.now();
  const rows = packagesDb()
    // Sengaja tetap bentuk LATEST_PER_MATCH (bukan kickoff-first):
    // himpunan baris kedua bentuk sama, tetapi urutan di antara
    // kickoff yang SERI berbeda pada data produksi (59 grup seri pada
    // jendela selesai staging) dan LIMIT memotong di tengah seri —
    // bentuk lama dipertahankan persis demi paritas (PR 1B).
    .prepare(`${LATEST_PER_MATCH} WHERE p.kickoff_utc < ? AND p.kickoff_utc >= ? ORDER BY p.kickoff_utc DESC LIMIT ?`)
    .all(
      new Date(now - 3 * 3_600_000).toISOString(),
      new Date(now - hoursBack * 3_600_000).toISOString(),
      limit,
    ) as Record<string, unknown>[];
  return rows.map((r) => enrich(parsePackage(r))).filter((f) => f.result?.finished);
}

export interface MatchDetail {
  pkg: PackageRow;
  picks: PickRow[];
  result: MatchResult | null;
  formHome: FormEntry[];
  formAway: FormEntry[];
  /** Identitas kanonik lintas provider (K1); null bila store identitas tak mengenal laga ini. */
  fixtureUid: string | null;
  /** Keadaan tampil laga (status + skor yang lolos gerbang visibilitas). */
  keadaan: KeadaanLaga | null;
  /** Pilihan RESMI terbit untuk laga ini (K2) — satu-satunya yang boleh ditautkan sebagai pilihan. */
  officialPicks: OfficialPick[];
  /**
   * Kejadian UNIK hasil pengelompokan officialPicks dengan aturan
   * Pilihan (satu baris per kejadian semantik + jejak konflik/edisi).
   * Inilah yang dirender bagian prediksi detail dan yang dihitung
   * label jumlah pilihan — bukan hitungan baris mentah.
   */
  kejadianResmi: KejadianResmi[];
  /** Tiket RESMI (K3) yang memuat pilihan resmi laga ini. */
  officialTickets: TiketResmiRef[];
  /**
   * Paket EDISI TERBIT (brief §3C.2): paket yang menjadi sumber pilihan
   * resmi (package_id terbanyak di antara pilihan resmi; seri → yang
   * dihitung paling akhir). Angka "saat terbit" dan peta skor penilaian
   * membaca edisi ini, bukan paket terbaru. Null bila tak ada pilihan
   * resmi atau paketnya tak terbaca.
   */
  paketTerbit: PackageRow | null;
}

export function getMatchDetail(matchId: string): MatchDetail | null {
  const row = packagesDb()
    .prepare(`SELECT * FROM packages WHERE match_id = ? ORDER BY id DESC LIMIT 1`)
    .get(matchId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const pkg = parsePackage(row);
  // Isolasi per bagian (brief §3C.5): paket = data inti dan tetap
  // syarat; setiap bagian pendukung (pick paket, hasil, form, keadaan,
  // pilihan/tiket resmi) gagal sebagai keadaan kosong miliknya sendiri.
  const picks = bagian(
    () =>
      picksDb()
        .prepare(
          `SELECT pk.*, po.hit, po.home_goals, po.away_goals
           FROM picks pk LEFT JOIN pick_outcomes po ON po.pick_id = pk.id
           WHERE pk.package_id = ? ORDER BY pk.grade ASC, pk.model_prob DESC`,
        )
        .all(pkg.id) as unknown as PickRow[],
    [] as PickRow[],
  );
  const f = pkg.payload.fixture;
  const fixtureUid = fixtureUidOf(matchId);
  const officialPicks = bagian(() => getOfficialPicks(matchId, fixtureUid), [] as OfficialPick[]);
  const paketTerbit = bagian(() => {
    const hitung = new Map<number, number>();
    for (const p of officialPicks) {
      if (p.package_id !== null && p.package_id !== undefined) {
        hitung.set(p.package_id, (hitung.get(p.package_id) ?? 0) + 1);
      }
    }
    let terpilih: number | null = null;
    let terbanyak = 0;
    for (const [id, n] of hitung) {
      if (n > terbanyak || (n === terbanyak && terpilih !== null && id > terpilih)) {
        terpilih = id;
        terbanyak = n;
      }
    }
    return terpilih === null ? null : getPackageRowById(terpilih);
  }, null);
  return {
    pkg,
    picks,
    result: bagian(() => getResult(matchId), null),
    formHome: getForm(f.home, f.kickoff_utc),
    formAway: getForm(f.away, f.kickoff_utc),
    fixtureUid,
    keadaan: bagian(() => getMatchState(matchId), null),
    officialPicks,
    kejadianResmi: bagian(
      () => kelompokkanPilihanResmi(officialPicks),
      [] as KejadianResmi[],
    ),
    officialTickets: bagian(
      () => getOfficialTickets(officialPicks.map((p) => p.pick_uid)),
      [] as TiketResmiRef[],
    ),
    paketTerbit,
  };
}

export interface SafePick extends PickRow {
  home: string;
  away: string;
  competition_name: string;
  sources_agree: number;
}

/** Pilihan live-run yang belum kickoff, grade A/B/C, dari ledger. */
export function listSafePicks(limit = 400): SafePick[] {
  const rows = picksDb()
    .prepare(
      `SELECT * FROM picks WHERE source = 'live-run' AND kickoff_utc >= ?
       ORDER BY kickoff_utc ASC, grade ASC, model_prob DESC LIMIT ?`,
    )
    .all(new Date(Date.now() - 3 * 3_600_000).toISOString(), limit) as Record<string, unknown>[];
  const out: SafePick[] = [];
  const pkgCache = new Map<number, PackageRow | null>();
  for (const r of rows) {
    const pid = (r.package_id as number | null) ?? null;
    let pkg = pid !== null ? pkgCache.get(pid) : null;
    if (pid !== null && pkg === undefined) {
      const prow = packagesDb()
        .prepare(`SELECT * FROM packages WHERE id = ?`)
        .get(pid) as Record<string, unknown> | undefined;
      pkg = prow ? parsePackage(prow) : null;
      pkgCache.set(pid, pkg);
    }
    const p = r as unknown as PickRow;
    const sources = [p.model_prob, p.market_prob, p.sm_prob].filter(
      (v) => v !== null && v !== undefined,
    ).length;
    out.push({
      ...p,
      home: pkg?.payload.fixture.home ?? "?",
      away: pkg?.payload.fixture.away ?? "?",
      competition_name: pkg?.payload.fixture.competition_name ?? "",
      sources_agree: sources,
    });
  }
  return out;
}

export interface GradeStat {
  grade: string;
  n: number;
  resolved: number;
  hits: number;
  hit_rate: number | null;
  /**
   * Rerata peluang KLAIM atas irisan yang peluangnya tercatat pada basis
   * resmi permukaan ini (PR 2): baris live memakai `published_prob`
   * (beku saat terbit — basis yang sama dengan `cohortStats`), baris lab
   * memakai `model_prob` karena populasi lab tidak pernah diterbitkan
   * sehingga peluang terbit memang tidak ada (UI melabelinya "peluang
   * model"). `gap_pp` membandingkan claimed dengan hit-rate IRISAN YANG
   * SAMA (`prob_n` baris), bukan dengan hit-rate seluruh settled —
   * perbandingan satu irisan, sesuai temuan basis ganda PR 1A F3.
   */
  claimed: number | null;
  /** Jumlah baris settled yang masuk irisan claimed di atas. */
  prob_n: number;
  gap_pp: number | null;
}
/** GradeStat live yang dipotong menurut gate_status pick (segmentasi R-01). */
export interface GradeGateStat extends GradeStat {
  gate_status: string;
}
export interface MarketStat {
  market: string;
  n: number;
  claimed: number | null;
  hits: number;
  hit_rate: number | null;
}
export interface LedgerStats {
  lab_total: number;
  live_total: number;
  live_resolved: number;
  by_grade: GradeStat[];
  /** Segmen by_grade menurut gate_status (calibrated/partial/uncalibrated). */
  live_by_grade_gate: GradeGateStat[];
  by_market: { market: string; n: number; hits: number; hit_rate: number | null }[];
  lab_by_grade: GradeStat[];
  lab_by_market: MarketStat[];
  recent_resolved: (PickRow & { home: string; away: string })[];
}

/**
 * Cache fixture (nama home/away) per package_id untuk ledgerStats().recent:
 * 40 baris terakhir biasanya hanya milik belasan paket — tanpa cache, paket
 * yang sama di-query + di-parse payload-nya berulang per pick. Payload paket
 * immutable per id, jadi cache proses ini aman.
 */
const fixtureNameCache = new Map<number, { home: string; away: string } | null>();
function packageFixtureNames(
  packageId: number,
  matchId: string,
  kickoffUtc: string,
): { home: string; away: string } | null {
  const hit = fixtureNameCache.get(packageId);
  if (hit !== undefined) return hit;
  const prow = packagesDb()
    .prepare(`SELECT payload_json FROM packages WHERE id = ?`)
    .get(packageId) as { payload_json: string } | undefined;
  const fx = prow
    ? normalizePayload(
        JSON.parse(prow.payload_json) as Record<string, unknown>,
        matchId,
        kickoffUtc,
      ).fixture
    : null;
  const val = fx ? { home: fx.home, away: fx.away } : null;
  fixtureNameCache.set(packageId, val);
  return val;
}

export function ledgerStats(): LedgerStats {
  const d = picksDb();
  const one = (sql: string) => (d.prepare(sql).get() as { n: number }).n;
  // Keputusan pemilik A3 (25 Nov 2026): pick termarking `duplicate_of`
  // keluar dari agregasi akurasi live di fungsi ini — pembilang dan
  // penyebut, selaras dengan cohortStats. Populasi lab tidak pernah
  // termarking; daftar `recent` di bawah adalah daftar tampil, bukan
  // statistik — keduanya sengaja tidak berubah. DB lama tanpa kolom
  // `duplicate_of`: predikat kosong (perilaku lama persis).
  const punyaDup = kolomAda(d, "picks", "duplicate_of");
  const dupPred = punyaDup ? " AND duplicate_of IS NULL" : "";
  const dupPredP = punyaDup ? " AND p.duplicate_of IS NULL" : "";
  const lab_total = one(`SELECT COUNT(*) n FROM picks WHERE source='lab'`);
  const live_total = one(`SELECT COUNT(*) n FROM picks WHERE source='live-run'${dupPred}`);
  const live_resolved = one(
    `SELECT COUNT(*) n FROM picks p JOIN pick_outcomes o ON o.pick_id=p.id WHERE p.source='live-run'${dupPredP}`,
  );
  const toGradeStat = (r: Record<string, unknown>): GradeStat => {
    const resolved = r.resolved as number;
    const hits = r.hits as number;
    const claimed = (r.claimed as number | null) ?? null;
    const hit_rate = resolved > 0 ? hits / resolved : null;
    const prob_n = (r.prob_n as number | null) ?? 0;
    const slice_hits = (r.slice_hits as number | null) ?? 0;
    const slice_hit_rate = prob_n > 0 ? slice_hits / prob_n : null;
    return {
      grade: r.grade as string,
      n: r.n as number,
      resolved,
      hits,
      hit_rate,
      claimed,
      prob_n,
      gap_pp:
        slice_hit_rate !== null && claimed !== null
          ? Math.round((slice_hit_rate - claimed) * 1000) / 10
          : null,
    };
  };
  // Basis claimed live = published_prob atas irisan settled yang
  // peluang terbitnya tercatat — persis irisan prob_slice cohortStats
  // (PR 2, menutup basis ganda PR 1A F3). AVG mengabaikan NULL, jadi
  // irisan terbentuk dari predikat yang sama; prob_n/slice_hits
  // menyatakan populasinya secara eksplisit. DB pra-K2 tanpa kolom
  // published_prob: claimed jujur NULL (tidak jatuh diam-diam ke basis
  // model — itu justru basis ganda yang ditutup PR ini).
  const punyaTerbit = kolomAda(d, "picks", "published_prob");
  const klaimEkspr = punyaTerbit
    ? "AVG(CASE WHEN o.pick_id IS NOT NULL THEN p.published_prob END)"
    : "NULL";
  const probNEkspr = punyaTerbit
    ? "SUM(CASE WHEN o.pick_id IS NOT NULL AND p.published_prob IS NOT NULL THEN 1 ELSE 0 END)"
    : "0";
  const sliceHitEkspr = punyaTerbit
    ? "SUM(CASE WHEN o.pick_id IS NOT NULL AND p.published_prob IS NOT NULL THEN COALESCE(o.hit,0) ELSE 0 END)"
    : "0";
  const by_grade = (d
    .prepare(
      `SELECT p.grade AS grade, COUNT(*) AS n,
              SUM(CASE WHEN o.pick_id IS NOT NULL THEN 1 ELSE 0 END) AS resolved,
              SUM(COALESCE(o.hit,0)) AS hits,
              ${klaimEkspr} AS claimed,
              ${probNEkspr} AS prob_n,
              ${sliceHitEkspr} AS slice_hits
       FROM picks p LEFT JOIN pick_outcomes o ON o.pick_id = p.id
       WHERE p.source='live-run'${dupPredP} GROUP BY p.grade ORDER BY p.grade`,
    )
    .all() as Record<string, unknown>[]).map(toGradeStat);
  // Segmentasi gate (R-01): potongan yang sama persis dengan by_grade,
  // hanya dikelompokkan juga menurut gate_status yang tersimpan di baris
  // pick itu sendiri — bukan klasifikasi baru. Urutan gate tetap:
  // calibrated, partial, uncalibrated.
  const live_by_grade_gate = (d
    .prepare(
      `SELECT p.grade AS grade, p.gate_status AS gate_status, COUNT(*) AS n,
              SUM(CASE WHEN o.pick_id IS NOT NULL THEN 1 ELSE 0 END) AS resolved,
              SUM(COALESCE(o.hit,0)) AS hits,
              ${klaimEkspr} AS claimed,
              ${probNEkspr} AS prob_n,
              ${sliceHitEkspr} AS slice_hits
       FROM picks p LEFT JOIN pick_outcomes o ON o.pick_id = p.id
       WHERE p.source='live-run'${dupPredP} GROUP BY p.grade, p.gate_status
       ORDER BY p.grade,
                CASE p.gate_status WHEN 'calibrated' THEN 0
                                   WHEN 'partial' THEN 1
                                   WHEN 'uncalibrated' THEN 2 ELSE 3 END`,
    )
    .all() as Record<string, unknown>[]).map((r) => ({
      ...toGradeStat(r),
      gate_status: (r.gate_status as string | null) ?? "unknown",
    }));
  const by_market = (d
    .prepare(
      `SELECT p.market AS market, COUNT(*) AS n, SUM(o.hit) AS hits
       FROM picks p JOIN pick_outcomes o ON o.pick_id = p.id
       WHERE p.source='live-run'${dupPredP} GROUP BY p.market ORDER BY n DESC`,
    )
    .all() as Record<string, unknown>[]).map((r) => ({
      market: r.market as string,
      n: r.n as number,
      hits: r.hits as number,
      hit_rate: (r.n as number) > 0 ? (r.hits as number) / (r.n as number) : null,
    }));
  // Populasi lab tidak menyimpan kolom grade (baris lab grade-nya NULL);
  // grade diturunkan ulang dari tabel ambang per-pasar milik engine
  // (MARKET_GRADE_THRESHOLDS — sumber kebenaran tunggal, sama dengan yang
  // memberi grade pick live). CASE SQL dibangun dari konstanta itu supaya
  // kalibrasi ulang ambang otomatis mengalir ke sini. Kandidat di bawah
  // lantai grade terendah memang tidak pernah diterbitkan sebagai pick,
  // jadi tidak masuk tabel per-grade.
  const gradeCase = Object.entries(MARKET_GRADE_THRESHOLDS)
    .map(([market, t]) => {
      const arms: string[] = [];
      if (t.A !== null) arms.push(`WHEN p.model_prob >= ${t.A} THEN 'A'`);
      if (t.B !== null) arms.push(`WHEN p.model_prob >= ${t.B} THEN 'B'`);
      if (t.C !== null) arms.push(`WHEN p.model_prob >= ${t.C} THEN 'C'`);
      return `WHEN p.market = '${market}' THEN CASE ${arms.join(" ")} END`;
    })
    .join(" ");
  const lab_by_grade = (d
    .prepare(
      `SELECT g AS grade, COUNT(*) AS n, AVG(model_prob) AS claimed, SUM(hit) AS hits
       FROM (
         SELECT p.model_prob AS model_prob, o.hit AS hit,
                CASE ${gradeCase} END AS g
         FROM picks p JOIN pick_outcomes o ON o.pick_id = p.id
         WHERE p.source='lab'
       )
       WHERE g IS NOT NULL GROUP BY g ORDER BY g`,
    )
    .all() as Record<string, unknown>[]).map((r) => {
      const n = r.n as number;
      const hits = r.hits as number;
      const claimed = (r.claimed as number | null) ?? null;
      const hit_rate = n > 0 ? hits / n : null;
      return {
        grade: r.grade as string,
        n,
        resolved: n,
        hits,
        hit_rate,
        claimed,
        // Populasi lab: claimed adalah rerata model_prob atas SEMUA
        // baris irisan ini (lab tak punya published_prob), jadi irisan
        // claimed = seluruh n dan gap tetap terhadap hit_rate yang sama.
        prob_n: n,
        gap_pp:
          hit_rate !== null && claimed !== null
            ? Math.round((hit_rate - claimed) * 1000) / 10
            : null,
      } satisfies GradeStat;
    });
  // Populasi sama persis dengan lab_by_grade: hanya kandidat ber-grade
  // (gradeCase yang sama, satu definisi). Tanpa filter ini, lab menyimpan
  // kandidat di KEDUA sisi tiap pasar (over+under, yes+no, ketiga hasil
  // 1X2) sehingga rata-rata mentahnya datar dan tidak bermakna.
  const lab_by_market = (d
    .prepare(
      `SELECT market, COUNT(*) AS n, AVG(model_prob) AS claimed, SUM(hit) AS hits
       FROM (
         SELECT p.market AS market, p.model_prob AS model_prob, o.hit AS hit,
                CASE ${gradeCase} END AS g
         FROM picks p JOIN pick_outcomes o ON o.pick_id = p.id
         WHERE p.source='lab'
       )
       WHERE g IS NOT NULL GROUP BY market ORDER BY n DESC`,
    )
    .all() as Record<string, unknown>[]).map((r) => {
      const n = r.n as number;
      const hits = r.hits as number;
      return {
        market: r.market as string,
        n,
        claimed: (r.claimed as number | null) ?? null,
        hits,
        hit_rate: n > 0 ? hits / n : null,
      } satisfies MarketStat;
    });
  const recent = (d
    .prepare(
      `SELECT p.*, o.hit, o.home_goals, o.away_goals FROM picks p
       JOIN pick_outcomes o ON o.pick_id = p.id
       WHERE p.source='live-run' ORDER BY p.kickoff_utc DESC LIMIT 40`,
    )
    .all() as Record<string, unknown>[])
    .map((r) => {
      const fx = r.package_id
        ? packageFixtureNames(
            r.package_id as number,
            r.match_id as string,
            r.kickoff_utc as string,
          )
        : null;
      return {
        ...(r as unknown as PickRow),
        home: fx?.home ?? "?",
        away: fx?.away ?? "?",
      };
    });
  return {
    lab_total,
    live_total,
    live_resolved,
    by_grade,
    live_by_grade_gate,
    by_market,
    lab_by_grade,
    lab_by_market,
    recent_resolved: recent,
  };
}

export interface LandingStats {
  lab_picks: number;
  lab_resolved: number;
  /** Laga UNIK di balik lab_resolved (satu laga punya banyak pilihan) —
   *  penyebut yang sah untuk kata "laga" di beranda (Fix-6 butir 6). */
  lab_resolved_matches: number;
  live_picks: number;
  leagues_fitted: number;
  leagues_calibrated: number;
  packages: number;
  upcoming: number;
}

/** Tanda tangan file (mtime+ukuran) untuk kunci cache statistik landing. */
function fileSig(p: string): string {
  try {
    const s = fs.statSync(p);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return "absen";
  }
}

let landingCache: { sig: string; stats: LandingStats } | null = null;

/**
 * Statistik landing di-cache per tanda tangan file sumber (ratings + ketiga
 * DB beserta WAL-nya): tanpa cache, setiap request membayar parse JSON
 * ratings 545 KB + ±6 agregat picks. Bucket waktu 5 menit ikut di kunci
 * karena hitungan `upcoming` bergantung jendela jam dinding — angka bisa
 * basi paling lama 5 menit, imbalan yang wajar untuk halaman depan.
 */
export function landingStats(): LandingStats {
  const dataDir = path.join(process.cwd(), "data");
  const sig = [
    fileSig(path.join(dataDir, "calibrated_ratings.json")),
    fileSig(dbPath("picks.db")),
    fileSig(dbPath("picks.db-wal")),
    fileSig(dbPath("analysis_snapshots.db")),
    fileSig(dbPath("analysis_snapshots.db-wal")),
    fileSig(dbPath("thestats_dataset.db")),
    fileSig(dbPath("thestats_dataset.db-wal")),
    String(Math.floor(Date.now() / 300_000)),
  ].join("|");
  if (landingCache && landingCache.sig === sig) return landingCache.stats;

  const d = picksDb();
  const one = (sql: string) => (d.prepare(sql).get() as { n: number }).n;
  let leagues_fitted = 0;
  let leagues_calibrated = 0;
  try {
    const ratings = JSON.parse(
      fs.readFileSync(path.join(dataDir, "calibrated_ratings.json"), "utf8"),
    ) as { leagues: Record<string, unknown> };
    leagues_fitted = Object.keys(ratings.leagues).length;
  } catch { /* angka tampil — bila file tidak ada */ }
  try {
    leagues_calibrated = (datasetDb()
      .prepare(`SELECT COUNT(*) n FROM league_calibration WHERE status = 'calibrated'`)
      .get() as { n: number }).n;
  } catch { /* tabel registry opsional */ }
  // Jumlah laga mendatang via COUNT — semantik sama dengan
  // listUpcoming(72).length (paket terbaru per laga, jendela sama) tapi
  // tanpa mengambil & mem-parse satu pun payload paket.
  const now = Date.now();
  const upcoming = (packagesDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM packages p
       JOIN (SELECT match_id, MAX(id) AS mid FROM packages GROUP BY match_id) t
         ON t.mid = p.id
       WHERE p.kickoff_utc >= ? AND p.kickoff_utc <= ?`,
    )
    .get(
      new Date(now - 3 * 3_600_000).toISOString(),
      new Date(now + 72 * 3_600_000).toISOString(),
    ) as { n: number }).n;
  const stats: LandingStats = {
    lab_picks: one(`SELECT COUNT(*) n FROM picks WHERE source='lab'`),
    lab_resolved: one(
      `SELECT COUNT(*) n FROM picks p JOIN pick_outcomes o ON o.pick_id=p.id WHERE p.source='lab'`,
    ),
    lab_resolved_matches: one(
      `SELECT COUNT(DISTINCT p.match_id) n FROM picks p JOIN pick_outcomes o ON o.pick_id=p.id WHERE p.source='lab'`,
    ),
    live_picks: one(`SELECT COUNT(*) n FROM picks WHERE source='live-run'`),
    leagues_fitted,
    leagues_calibrated,
    packages: (packagesDb().prepare(`SELECT COUNT(*) n FROM packages`).get() as { n: number }).n,
    upcoming,
  };
  landingCache = { sig, stats };
  return stats;
}

/** Pick ledger milik satu paket beserta hasil resolusinya (untuk daftar selesai). */
export function getPackagePicks(packageId: number): PickRow[] {
  return picksDb()
    .prepare(
      `SELECT pk.*, po.hit, po.home_goals, po.away_goals
       FROM picks pk LEFT JOIN pick_outcomes po ON po.pick_id = pk.id
       WHERE pk.package_id = ? ORDER BY pk.grade ASC, pk.model_prob DESC`,
    )
    .all(packageId) as unknown as PickRow[];
}

/* ============================ K6 · keadaan, jadwal, tautan resmi ====== */

/** UID kanonik laga dari store identitas K1; null bila tak dikenal/degrade. */
function fixtureUidOf(matchId: string): string | null {
  try {
    const d = datasetDb();
    if (!identityTablesExist(d)) return null;
    return getUidForMatchId(d, matchId);
  } catch {
    return null;
  }
}

export interface KeadaanLaga {
  /** Status tampil: status sumber + dimensi waktu (brief §4). */
  status: StatusTampil;
  /** Skor yang LOLOS gerbang visibilitas status (cancelled selalu null). */
  home_goals: number | null;
  away_goals: number | null;
  /** Menit berjalan bila sumber menyatakannya di string status; selain itu null. */
  menit: number | null;
  /**
   * Penanda skor pasca-regulasi (brief §3C.1): ejaan status sumber
   * menyatakan skor yang tersimpan adalah skor SETELAH perpanjangan
   * waktu ("aet") atau adu penalti ("penalti") — bukan skor 90 menit.
   * Skor regulasi tidak pernah ditebak dari skor ini; ia hanya boleh
   * datang dari revisi terautentikasi (hasil resolver pada pilihan).
   */
  pascaregulasi: "aet" | "penalti" | null;
}

/** Ejaan status mentah → penanda pasca-regulasi; selain itu null. */
function pascaregulasiDariStatus(raw: string | null | undefined): "aet" | "penalti" | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (/(^|[^a-z])(aet|after_extra_time|after extra time)([^a-z]|$)/.test(s)) return "aet";
  if (/(^|[^a-z])(pen|pens|penalties|penalty_shootout)([^a-z]|$)/.test(s)) return "penalti";
  return null;
}

/**
 * Keadaan tampil satu laga dari baris dataset + katalog (via sibling K1).
 * Dataset adalah otoritas skor/status final; katalog memberi status
 * penundaan/pembatalan untuk laga yang belum punya baris hasil. Skor
 * digerbang `skorTerlihat`: batal → tidak pernah tampil, dihentikan →
 * parsial, selesai → penuh.
 */
export function getMatchState(matchId: string, nowMs: number = Date.now()): KeadaanLaga | null {
  const ids = siblingsOf(matchId);
  let datasetRow: BarisDatasetMentah | null = null;
  try {
    const d = datasetDb();
    for (const id of ids) {
      const r = d
        .prepare(`SELECT status, home_score, away_score, utc_date FROM matches WHERE match_id = ?`)
        .get(id) as
        | { status: string; home_score: number | null; away_score: number | null; utc_date: string | null }
        | undefined;
      if (!r) continue;
      const cand: BarisDatasetMentah = {
        statusRaw: r.status,
        home: r.home_score,
        away: r.away_score,
        kickoffUtc: r.utc_date,
      };
      if (!datasetRow) datasetRow = cand;
      const st = displayStatus(r.status);
      if (st === "finished" || st === "abandoned") {
        datasetRow = cand;
        break;
      }
    }
  } catch {
    /* dataset tak tersedia */
  }
  let catalogStatus: string | null = null;
  let catalogAda = false;
  let catalogKickoff: string | null = null;
  const up = upcomingDb();
  if (up) {
    try {
      for (const id of ids) {
        const r = up
          .prepare(`SELECT status, utc_date FROM upcoming_fixtures WHERE match_id = ?`)
          .get(id) as { status: string | null; utc_date: string | null } | undefined;
        if (r) {
          catalogAda = true;
          catalogStatus = r.status;
          catalogKickoff = r.utc_date;
          break;
        }
      }
    } catch {
      /* tabel katalog tak ada */
    }
  }
  return keadaanDariBaris(
    datasetRow,
    catalogStatus,
    catalogAda,
    catalogKickoff ?? datasetRow?.kickoffUtc ?? null,
    nowMs,
  );
}

/** Baris dataset mentah untuk penggabungan keadaan (bentuk getMatchState). */
interface BarisDatasetMentah {
  statusRaw: string | null;
  home: number | null;
  away: number | null;
  /** Kickoff baris ini bila sumbernya menyediakannya (jalur tunggal). */
  kickoffUtc?: string | null;
}

/**
 * Penggabungan keadaan dari baris yang SUDAH diambil — logika ekor
 * getMatchState, dipakai bersama jalur batch listSchedule (Fix-6 butir 6):
 * baris dataset "terjadwal" polos kalah oleh status katalog yang lebih
 * informatif (ditunda/dibatalkan/berlangsung); final dataset selalu
 * menang; skor digerbang `skorTerlihat` (batal → tidak pernah tampil).
 */
function keadaanDariBaris(
  datasetRow: BarisDatasetMentah | null,
  catalogStatus: string | null,
  catalogAda: boolean,
  kickoffUtc: string | null,
  nowMs: number,
): KeadaanLaga | null {
  if (!datasetRow && !catalogAda) return null;
  let dasar = displayStatus(datasetRow?.statusRaw ?? catalogStatus);
  if (datasetRow && catalogAda) {
    const cs = displayStatus(catalogStatus);
    if (
      dasar === "scheduled" &&
      (cs === "postponed" || cs === "cancelled" || cs === "live" || cs === "abandoned")
    ) {
      dasar = cs;
    }
  }
  const vis = skorTerlihat(dasar);
  return {
    // Dimensi waktu (brief §4) diterapkan pada status gabungan: sumber
    // yang mengonfirmasi selalu menang; yang berubah hanya keadaan
    // terjadwal/tak-dikenal yang sepak mulanya sudah lewat.
    status: terapkanWaktu(dasar, kickoffUtc, nowMs),
    home_goals: vis === "tidak" ? null : (datasetRow?.home ?? null),
    away_goals: vis === "tidak" ? null : (datasetRow?.away ?? null),
    menit:
      dasar === "live"
        ? menitDariStatusMentah(datasetRow?.statusRaw ?? catalogStatus)
        : null,
    pascaregulasi: pascaregulasiDariStatus(datasetRow?.statusRaw),
  };
}

/**
 * Pilih baris dataset pemenang dari daftar id sibling BERURUT — semantik
 * loop getMatchState persis: baris pertama yang ditemukan menjadi
 * kandidat; baris berstatus final/dihentikan menggantikannya dan
 * menghentikan pencarian.
 */
function pilihBarisDataset(
  ids: string[],
  byId: Map<string, BarisDatasetMentah>,
): BarisDatasetMentah | null {
  let datasetRow: BarisDatasetMentah | null = null;
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) continue;
    if (!datasetRow) datasetRow = r;
    const st = displayStatus(r.statusRaw);
    if (st === "finished" || st === "abandoned") {
      datasetRow = r;
      break;
    }
  }
  return datasetRow;
}

/* ------------------------------------------------- batch jadwal (Fix-6) */

/**
 * Konteks batch untuk listSchedule: semua pencarian per-laga yang dulu
 * N+1 (siblingsOf ≈3 SQL + getMatchState ≈2–4 SQL + fixtureUidOf 2 SQL
 * per item; terukur 51 SQL/7 item dan 293 SQL/45 item) diganti muatan
 * massal — satu statement per sumber per potongan 900 id:
 *   1. alias self-join (UID + sibling store identitas per id),
 *   2. baris dataset untuk seluruh id sibling (UNION jendela dipisah
 *      pemanggil — lihat listSchedule),
 *   3. baris katalog untuk seluruh id sibling.
 * Semantik per item direplikasi persis dari jalur tunggal: urutan
 * sibling = [id, sibling file tautan, alias store terurut
 * source_match_id] (urutan sisip Set pada siblingsOf), baris dataset
 * dipilih `pilihBarisDataset`, katalog = baris sibling pertama yang ada.
 */
interface KonteksBatch {
  uidById: Map<string, string>;
  siblingsById: Map<string, string[]>;
  datasetById: Map<string, BarisDatasetMentah>;
  catalogById: Map<string, { status: string | null; utc_date: string }>;
}

const POTONG_ID = 900;

function potong<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function tandaTanya(n: number): string {
  return Array.from({ length: n }, () => "?").join(",");
}

/**
 * Muat peta alias (UID + sibling) untuk sekumpulan id dalam SATU
 * statement self-join per potongan. Store identitas absen/rusak →
 * peta kosong (degradasi yang sama dengan siblingsOf/fixtureUidOf:
 * sibling file tautan tetap berlaku, UID null).
 */
function muatAliasBatch(
  ids: string[],
  uidById: Map<string, string>,
  siblingsById: Map<string, string[]>,
): void {
  if (ids.length === 0) return;
  if (!linkGroupsCache) {
    linkGroupsCache = loadFixtureLinkGroups(path.join(process.cwd(), "data"));
  }
  const dariStore = new Map<string, string[]>();
  try {
    const d = datasetDb();
    for (const c of potong(ids, POTONG_ID)) {
      const rows = d
        .prepare(
          `SELECT a1.source_match_id AS id, a2.fixture_uid AS uid,
                  a2.source_match_id AS sibling
           FROM fixture_aliases a1
           JOIN fixture_aliases a2 ON a2.fixture_uid = a1.fixture_uid
           WHERE a1.source_match_id IN (${tandaTanya(c.length)})
           ORDER BY a2.source_match_id`,
        )
        .all(...c) as { id: string; uid: string; sibling: string }[];
      for (const r of rows) {
        uidById.set(r.id, r.uid);
        const arr = dariStore.get(r.id);
        if (arr) arr.push(r.sibling);
        else dariStore.set(r.id, [r.sibling]);
      }
    }
  } catch {
    /* store identitas belum ada → degrade seperti jalur tunggal */
  }
  for (const id of ids) {
    const set = new Set<string>([id]);
    for (const s of linkSiblingsOf(linkGroupsCache, id)) set.add(s);
    for (const s of dariStore.get(id) ?? []) set.add(s);
    siblingsById.set(id, [...set]);
  }
}

/** Muat baris dataset (status + skor) untuk sekumpulan id — 1 statement/potongan. */
function muatDatasetBatch(ids: string[], into: Map<string, BarisDatasetMentah>): void {
  if (ids.length === 0) return;
  try {
    const d = datasetDb();
    for (const c of potong(ids, POTONG_ID)) {
      const rows = d
        .prepare(
          `SELECT match_id, status, home_score, away_score FROM matches
           WHERE match_id IN (${tandaTanya(c.length)})`,
        )
        .all(...c) as {
        match_id: string;
        status: string | null;
        home_score: number | null;
        away_score: number | null;
      }[];
      for (const r of rows) {
        into.set(r.match_id, { statusRaw: r.status, home: r.home_score, away: r.away_score });
      }
    }
  } catch {
    /* dataset tak tersedia → peta tetap kosong */
  }
}

/** Muat baris katalog (status + utc_date) untuk sekumpulan id — 1 statement/potongan. */
function muatKatalogBatch(
  ids: string[],
  into: Map<string, { status: string | null; utc_date: string }>,
): void {
  if (ids.length === 0) return;
  const up = upcomingDb();
  if (!up) return;
  try {
    for (const c of potong(ids, POTONG_ID)) {
      const rows = up
        .prepare(
          `SELECT match_id, status, utc_date FROM upcoming_fixtures
           WHERE match_id IN (${tandaTanya(c.length)})`,
        )
        .all(...c) as { match_id: string; status: string | null; utc_date: string }[];
      for (const r of rows) {
        into.set(r.match_id, { status: r.status, utc_date: r.utc_date });
      }
    }
  } catch {
    /* tabel katalog tak ada → peta tetap kosong */
  }
}

/** Keadaan satu laga dari konteks batch — semantik getMatchState persis. */
function keadaanBatch(
  ctx: KonteksBatch,
  matchId: string,
  kickoffUtc: string,
  nowMs: number,
): KeadaanLaga | null {
  const ids = ctx.siblingsById.get(matchId) ?? [matchId];
  const datasetRow = pilihBarisDataset(ids, ctx.datasetById);
  let catalogStatus: string | null = null;
  let catalogAda = false;
  for (const id of ids) {
    const r = ctx.catalogById.get(id);
    if (r) {
      catalogAda = true;
      catalogStatus = r.status;
      break;
    }
  }
  return keadaanDariBaris(datasetRow, catalogStatus, catalogAda, kickoffUtc, nowMs);
}

/** Jadwal ulang untuk laga ditunda dari konteks batch — semantik jadwalUlangOf. */
function jadwalUlangBatch(
  ctx: KonteksBatch,
  matchId: string,
  kickoffUtc: string,
): string | null {
  const ids = ctx.siblingsById.get(matchId) ?? [matchId];
  for (const id of ids) {
    const r = ctx.catalogById.get(id);
    if (r && r.utc_date !== kickoffUtc && displayStatus(r.status) === "scheduled") {
      return r.utc_date;
    }
  }
  return null;
}

function kolomAda(d: Db, table: string, kolom: string): boolean {
  try {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return cols.some((c) => c.name === kolom);
  } catch {
    return false;
  }
}

export interface OfficialPick extends PickRow {
  pick_uid: string;
  /** Waktu hitung paket penerbit — pembanding "analisis terbaru" di detail. */
  package_computed_utc: string | null;
  /** Garis pasar (kolom ledger; "" untuk pasar tanpa garis). */
  line: string | null;
  /** UID laga fisik tersimpan di ledger; NULL pada baris pra-K1. */
  fixture_uid: string | null;
  /* Bukti quote beku (B2.2b) — kolom aditif ledger dari publikasi K2;
     opsional karena DB lama bisa belum memuat kolomnya (diisi null). */
  evidence_source?: string | null;
  odds_bookmaker?: string | null;
  odds_period?: string | null;
  odds_line?: string | null;
  odds_decimal?: number | null;
  odds_captured_utc?: string | null;
  decision_at_utc?: string | null;
  kickoff_at_issue_utc?: string | null;
}

/**
 * Pilihan RESMI laga ini: hanya baris ledger yang diterbitkan jalur
 * publikasi K2 (pick_uid terisi). Baris lab/warisan tanpa pick_uid tidak
 * pernah ditautkan sebagai pilihan (U03). DB pra-K2 tanpa kolom pick_uid
 * degrade ke daftar kosong.
 */
export function getOfficialPicks(matchId: string, fixtureUid: string | null): OfficialPick[] {
  const d = picksDb();
  if (!kolomAda(d, "picks", "pick_uid")) return [];
  const ids = siblingsOf(matchId);
  const marks = ids.map(() => "?").join(",");
  const rows = d
    .prepare(
      `SELECT pk.*, po.hit, po.home_goals, po.away_goals
       FROM picks pk LEFT JOIN pick_outcomes po ON po.pick_id = pk.id
       WHERE pk.pick_uid IS NOT NULL
         AND (pk.match_id IN (${marks})${fixtureUid ? " OR pk.fixture_uid = ?" : ""})
       ORDER BY pk.grade ASC, pk.published_prob DESC`,
    )
    .all(...(fixtureUid ? [...ids, fixtureUid] : ids)) as unknown as (PickRow & {
    pick_uid: string;
    line: string | null;
    fixture_uid: string | null;
    evidence_source?: string | null;
    odds_bookmaker?: string | null;
    odds_period?: string | null;
    odds_line?: string | null;
    odds_decimal?: number | null;
    odds_captured_utc?: string | null;
    decision_at_utc?: string | null;
    kickoff_at_issue_utc?: string | null;
  })[];
  const computedCache = new Map<number, string | null>();
  return rows.map((r) => {
    let computed: string | null = null;
    if (r.package_id !== null && r.package_id !== undefined) {
      const cached = computedCache.get(r.package_id);
      if (cached !== undefined) {
        computed = cached;
      } else {
        try {
          const prow = packagesDb()
            .prepare(`SELECT computed_utc FROM packages WHERE id = ?`)
            .get(r.package_id) as { computed_utc: string } | undefined;
          computed = prow?.computed_utc ?? null;
        } catch {
          computed = null;
        }
        computedCache.set(r.package_id, computed);
      }
    }
    return {
      ...r,
      package_computed_utc: computed,
      evidence_source: r.evidence_source ?? null,
      odds_bookmaker: r.odds_bookmaker ?? null,
      odds_period: r.odds_period ?? null,
      odds_line: r.odds_line ?? null,
      odds_decimal: r.odds_decimal ?? null,
      odds_captured_utc: r.odds_captured_utc ?? null,
      decision_at_utc: r.decision_at_utc ?? null,
      kickoff_at_issue_utc: r.kickoff_at_issue_utc ?? null,
    };
  });
}

/**
 * Satu KEJADIAN pilihan resmi untuk bagian prediksi detail — hasil
 * pengelompokan `officialPicks` mentah dengan aturan yang PERSIS sama
 * dengan umpan Pilihan (`kelompokkanKejadianResmi` di lib/web/rekam.ts):
 * kejadian unik tampil satu kali lewat edisi perwakilannya; edisi
 * sumber lain tetap tertelusur di `edisi` (audit); kejadian yang
 * edisi-edisinya berbeda angka terbit membawa jejak `konflik` dan
 * angkanya tidak dipilih diam-diam.
 */
export interface KejadianResmi {
  /** Edisi perwakilan (terbit pertama) — baris yang dibaca pengguna. */
  pick: OfficialPick;
  /** Semua edisi sumber kejadian ini, urut terbit (lapis audit). */
  edisi: OfficialPick[];
  /** Jejak konflik bila edisi berbeda angka terbit; null bila sepakat. */
  konflik: KonflikPilihan | null;
}

/**
 * Kelompokkan pilihan resmi mentah satu laga menjadi kejadian unik.
 * Resolusi UID fisik untuk baris ber-UID NULL memakai peta store
 * identitas yang sama dengan Pilihan. Vonis kejadian diambil dari
 * edisi mana pun yang sudah dinilai bila perwakilan belum (edisi satu
 * kejadian berbagi pasar+pilihan, jadi berbagi hasil).
 */
export function kelompokkanPilihanResmi(picks: OfficialPick[]): KejadianResmi[] {
  const uidMap = petaUidFisik(
    picks.filter((p) => !p.fixture_uid).map((p) => p.match_id),
  );
  return kelompokkanKejadianResmi(picks, uidMap).map((g) => {
    let pick = g.perwakilan;
    if (pick.hit === null) {
      const dinilai = g.edisi.find((e) => e.hit !== null);
      if (dinilai) {
        pick = {
          ...pick,
          hit: dinilai.hit,
          home_goals: dinilai.home_goals,
          away_goals: dinilai.away_goals,
        };
      }
    }
    return { pick, edisi: g.edisi, konflik: g.konflik };
  });
}

export interface TiketResmiRef {
  slip_uid: string;
  state: string;
  combined_prob: number | null;
  combined_low: number | null;
  combined_high: number | null;
  combined_basis: string | null;
  combined_reason: string | null;
  published_utc: string;
  pick_uids: string[];
}

/**
 * Tiket RESMI (K3) yang memuat salah satu pick_uid resmi yang diberikan.
 * Slip draf browser tidak hidup di tabel ini, jadi tidak akan pernah
 * tertaut dari sini.
 */
export function getOfficialTickets(pickUids: string[]): TiketResmiRef[] {
  if (pickUids.length === 0) return [];
  const d = picksDb();
  try {
    const ada = d
      .prepare(
        `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'
         AND name IN ('published_slips', 'slip_legs')`,
      )
      .get() as { n: number };
    if (ada.n < 2) return [];
  } catch {
    return [];
  }
  const marks = pickUids.map(() => "?").join(",");
  const rows = d
    .prepare(
      `SELECT s.slip_uid, s.state, s.combined_prob, s.combined_low, s.combined_high,
              s.combined_basis, s.combined_reason, s.published_utc,
              GROUP_CONCAT(l.pick_uid) AS uids
       FROM published_slips s JOIN slip_legs l ON l.slip_uid = s.slip_uid
       WHERE l.pick_uid IN (${marks})
       GROUP BY s.slip_uid ORDER BY s.published_utc DESC`,
    )
    .all(...pickUids) as Record<string, unknown>[];
  return rows.map((r) => ({
    slip_uid: r.slip_uid as string,
    state: r.state as string,
    combined_prob: (r.combined_prob as number | null) ?? null,
    combined_low: (r.combined_low as number | null) ?? null,
    combined_high: (r.combined_high as number | null) ?? null,
    combined_basis: (r.combined_basis as string | null) ?? null,
    combined_reason: (r.combined_reason as string | null) ?? null,
    published_utc: r.published_utc as string,
    pick_uids: String(r.uids ?? "")
      .split(",")
      .filter(Boolean),
  }));
}

/* ------------------------------------------------------- peta liga kanonik */

interface LigaKanonikFile {
  leagues: {
    canonical_id: string;
    name: string;
    country?: string | null;
    fits?: unknown[];
    aliases?: { id?: string; name_as_stored?: string }[];
  }[];
}

interface PetaLiga {
  prioritas: Map<string, number>;
  nama: Map<string, string>;
  /** ID alias namespace mana pun (sm:, comp_, kode divisi) → canonical_id. */
  kanonik: Map<string, string>;
  /** canonical_id → nama + negara kanonik dari registry. */
  perKanonik: Map<string, { nama: string; negara: string | null }>;
}

let petaLigaCache: PetaLiga | null = null;
function petaLiga(): PetaLiga {
  if (petaLigaCache) return petaLigaCache;
  const prioritas = new Map<string, number>();
  const nama = new Map<string, string>();
  const kanonik = new Map<string, string>();
  const perKanonik = new Map<string, { nama: string; negara: string | null }>();
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "data", "league-canonical.json"), "utf8"),
    ) as LigaKanonikFile;
    for (const lg of raw.leagues ?? []) {
      const p = (lg.fits?.length ?? 0) > 0 ? 0 : 1;
      prioritas.set(lg.canonical_id, p);
      nama.set(lg.canonical_id, lg.name);
      kanonik.set(lg.canonical_id, lg.canonical_id);
      perKanonik.set(lg.canonical_id, { nama: lg.name, negara: lg.country ?? null });
      if (lg.name) prioritas.set(`nama:${lg.name.toLowerCase()}`, p);
      for (const a of lg.aliases ?? []) {
        if (a.id) {
          prioritas.set(a.id, p);
          nama.set(a.id, lg.name);
          kanonik.set(a.id, lg.canonical_id);
        }
        if (a.name_as_stored) prioritas.set(`nama:${a.name_as_stored.toLowerCase()}`, p);
      }
    }
  } catch {
    /* tanpa registry: prioritas seragam, nama apa adanya */
  }
  petaLigaCache = { prioritas, nama, kanonik, perKanonik };
  return petaLigaCache;
}

/** ID kompetisi namespace mana pun → canonical_id registry; null bila tak terpetakan. */
export function kanonikKompetisi(idMentah: string | null | undefined): string | null {
  if (!idMentah) return null;
  return petaLiga().kanonik.get(idMentah) ?? null;
}

/**
 * URL crest tim dari NAMA tampil (untuk permukaan yang hanya membawa
 * nama, mis. daftar Beranda dari payload paket): nama → ID kanonik via
 * registry tim → resolver logo. Null = monogram.
 */
export function urlCrestTimNama(nama: string): string | null {
  return urlLogoTim(canonicalIdForTeamName(nama));
}

/**
 * Label sumber dari ID kompetisi mentah (namespace feed): dipakai hanya
 * bila identitas TIDAK terpetakan ke registry kanonik — brief addendum
 * mewajibkan label sumber + fallback untuk identitas ambigu, bukan
 * penggabungan diam-diam.
 */
export function labelSumberKompetisi(idMentah: string | null | undefined): string | null {
  if (!idMentah) return null;
  if (idMentah.startsWith("sm:")) return "Sportmonks";
  if (idMentah.startsWith("comp_")) return "TheStats";
  if (idMentah.startsWith("fd_") || /^[A-Z]{1,3}\d{1,2}$/.test(idMentah)) return "Football-Data";
  if (idMentah.startsWith("mt_")) return "MatchTracker";
  return null;
}

export interface IdentitasKompetisiTampil {
  /** Kunci grup stabil: kanonik bila terpetakan, selain itu ID mentah, terakhir nama+negara. */
  kunci: string;
  /** Nama tampil grup (nama kanonik bila terpetakan). */
  nama: string;
  /** Label negara pembeda (kanonik dulu, lalu tersimpan). */
  negara: string | null;
  /** Label sumber — hanya bila identitas tidak terpetakan kanonik (ambigu). */
  sumber: string | null;
  /** canonical_id hasil resolusi; null bila tak terpetakan. */
  canonical_id: string | null;
}

/**
 * Identitas kompetisi untuk pengelompokan Jadwal (Addendum Jadwal per
 * Liga): berbasis ID, BUKAN string nama. Dua namespace untuk liga yang
 * sama (mis. Serie A Italia = sm:384 + comp_5840) menyatu lewat alias
 * registry; nama yang sama dengan ID berbeda (Serie A Italia sm:384 vs
 * Serie A Brasil sm:648) tetap terpisah. Yang tak terpetakan memakai
 * label sumbernya sendiri dan TIDAK digabung dengan nama yang sama.
 */
export function identitasKompetisiTampil(
  canonicalId: string | null,
  idMentah: string | null,
  namaTersimpan: string,
  negaraTersimpan: string | null,
): IdentitasKompetisiTampil {
  const { kanonik, perKanonik } = petaLiga();
  const resolved =
    (canonicalId && (perKanonik.has(canonicalId) ? canonicalId : kanonik.get(canonicalId))) ||
    (idMentah ? kanonik.get(idMentah) : undefined) ||
    null;
  if (resolved) {
    const info = perKanonik.get(resolved);
    return {
      kunci: `k:${resolved}`,
      nama: info?.nama || namaTersimpan,
      negara: info?.negara ?? negaraTersimpan,
      sumber: null,
      canonical_id: resolved,
    };
  }
  if (idMentah) {
    return {
      kunci: `m:${idMentah}`,
      nama: namaTersimpan,
      negara: negaraTersimpan,
      sumber: labelSumberKompetisi(idMentah),
      canonical_id: null,
    };
  }
  return {
    kunci: `n:${namaTersimpan.toLowerCase()}|${negaraTersimpan ?? ""}`,
    nama: namaTersimpan,
    negara: negaraTersimpan,
    sumber: null,
    canonical_id: null,
  };
}

/**
 * Prioritas liga untuk urutan jadwal: 0 = liga yang punya fit rating
 * (universe yang benar-benar dinilai aplikasi), 1 = lainnya. Deterministik
 * dari registry kanonik, bukan tebakan nama.
 */
export function prioritasLiga(
  competitionCanonicalId: string | null,
  competitionName: string | null,
): number {
  const { prioritas } = petaLiga();
  if (competitionCanonicalId && prioritas.has(competitionCanonicalId)) {
    return prioritas.get(competitionCanonicalId)!;
  }
  if (competitionName) {
    const p = prioritas.get(`nama:${competitionName.toLowerCase()}`);
    if (p !== undefined) return p;
  }
  return 1;
}

/* ------------------------------------------------------------- jadwal */

export interface JadwalItem {
  match_id: string;
  fixture_uid: string | null;
  home: string;
  away: string;
  competition_name: string;
  competition_country: string | null;
  competition_canonical_id: string | null;
  /** ID kompetisi mentah namespace sumber (katalog/paket/dataset); null bila sumber tak memberinya. */
  competition_id_mentah: string | null;
  /** Identitas grup Jadwal per liga (Addendum): kunci stabil berbasis ID + label tampil. */
  grup_kunci: string;
  grup_nama: string;
  grup_negara: string | null;
  grup_sumber: string | null;
  /** ID kanonik tim untuk resolver crest; null bila ID sumber tak terpetakan. */
  home_canonical_id: string | null;
  away_canonical_id: string | null;
  kickoff_utc: string;
  status: StatusTampil;
  home_goals: number | null;
  away_goals: number | null;
  /** Menit berjalan laga live — pass-through dari keadaanBatch (sumber
      menyatakannya di string status); null bila sumber tak memberi. */
  menit: number | null;
  /** Untuk laga ditunda: jadwal asal (tanggal baris katalognya sendiri). */
  jadwal_asal_utc: string | null;
  /** Untuk laga ditunda: kickoff jadwal ulang bila baris sibling terjadwal ada. */
  jadwal_ulang_utc: string | null;
  package_id: number | null;
  gate_status: string | null;
  pickCounts: { A: number; B: number; C: number };
  topLeg: Leg | null;
  /**
   * Angka RESMI (ledger) untuk pilihan yang sama dengan topLeg, bila
   * pilihan resmi market+selection itu sudah terbit: probabilitas
   * terbit beku + label basis B2.2 yang diproyeksikan dari baris
   * ledger-nya sendiri (lib/web/sumber-peluang). Null = belum ada
   * pilihan resmi untuk pilihan itu — angka topLeg murni milik paket
   * terbaru dan wajib beridentitas paket, bukan angka resmi.
   */
  topLegResmi: {
    prob: number;
    label_basis: string;
    keterangan_basis: string | null;
  } | null;
}

function ringkasPaket(pkg: PackageRow): { pickCounts: { A: number; B: number; C: number }; topLeg: Leg | null } {
  const counts = { A: 0, B: 0, C: 0 };
  for (const leg of pkg.payload.legs ?? []) {
    if (leg.grade === "A") counts.A += 1;
    else if (leg.grade === "B") counts.B += 1;
    else if (leg.grade === "C") counts.C += 1;
  }
  const legs = [...(pkg.payload.legs ?? [])].sort((a, b) => {
    const rank = (gr: string) => (gr === "A" ? 0 : gr === "B" ? 1 : 2);
    return rank(a.grade) - rank(b.grade) || b.effective_prob - a.effective_prob;
  });
  return { pickCounts: counts, topLeg: legs[0] ?? null };
}



/**
 * Daftar jadwal kanonik untuk jendela UTC [dariUtc, sampaiUtc): sumbernya
 * katalog upcoming_fixtures (termasuk laga TANPA paket), diperkaya paket
 * analisis terbaru per laga dan keadaan hasil dari dataset. Urutan stabil:
 * kickoff, lalu prioritas liga, lalu nama kompetisi, lalu id pertandingan.
 */
export function listSchedule(dariUtc: string, sampaiUtc: string): JadwalItem[] {
  interface Mentah {
    match_id: string;
    home: string;
    away: string;
    competition_name: string;
    competition_country: string | null;
    competition_canonical_id: string | null;
    competition_id_mentah: string | null;
    home_team_id: string | null;
    away_team_id: string | null;
    kickoff_utc: string;
    statusRaw: string | null;
    dariKatalog: boolean;
  }
  const byId = new Map<string, Mentah>();
  const up = upcomingDb();
  if (up) {
    try {
      const rows = up
        .prepare(
          `SELECT * FROM upcoming_fixtures WHERE utc_date >= ? AND utc_date < ?`,
        )
        .all(dariUtc, sampaiUtc) as Record<string, unknown>[];
      for (const r of rows) {
        byId.set(r.match_id as string, {
          match_id: r.match_id as string,
          home: (r.home_team_name as string | null) ?? "?",
          away: (r.away_team_name as string | null) ?? "?",
          competition_name: (r.competition_name as string | null) ?? "",
          competition_country: (r.competition_country as string | null) ?? null,
          competition_canonical_id: null,
          competition_id_mentah: (r.competition_id as string | null) ?? null,
          home_team_id: (r.home_team_id as string | null) ?? null,
          away_team_id: (r.away_team_id as string | null) ?? null,
          kickoff_utc: r.utc_date as string,
          statusRaw: (r.status as string | null) ?? null,
          dariKatalog: true,
        });
      }
    } catch {
      /* tabel katalog belum ada di DB ini */
    }
  }
  const pkgById = new Map<string, PackageRow>();
  const pkgRows = packagesDb()
    .prepare(`${LATEST_PER_MATCH} WHERE p.kickoff_utc >= ? AND p.kickoff_utc < ?`)
    .all(dariUtc, sampaiUtc) as Record<string, unknown>[];
  for (const r of pkgRows) {
    const pkg = parsePackage(r);
    pkgById.set(pkg.match_id, pkg);
    if (!byId.has(pkg.match_id)) {
      const f = pkg.payload.fixture;
      byId.set(pkg.match_id, {
        match_id: pkg.match_id,
        home: f.home,
        away: f.away,
        competition_name: f.competition_name,
        competition_country: null,
        competition_canonical_id: pkg.competition_canonical_id,
        competition_id_mentah: null,
        home_team_id: null,
        away_team_id: null,
        kickoff_utc: pkg.kickoff_utc,
        statusRaw: null,
        dariKatalog: false,
      });
    } else {
      const m = byId.get(pkg.match_id)!;
      m.competition_canonical_id = pkg.competition_canonical_id;
      if (m.home === "?") m.home = pkg.payload.fixture.home;
      if (m.away === "?") m.away = pkg.payload.fixture.away;
      if (!m.competition_name) m.competition_name = pkg.payload.fixture.competition_name;
    }
  }
  // Sumber ketiga: baris dataset — laga selesai/tanpa paket yang sudah
  // tidak ada di katalog (katalog dibersihkan sesudah promosi telemetri)
  // tetap terdaftar di jadwal tanggal lampau.
  try {
    const d = datasetDb();
    // Nama tim diambil lewat JOIN dalam statement yang sama (Fix-6:
    // dulu satu kueri per tim per baris baru). Rantai fallback nama
    // tidak berubah: nama tabel teams → nama kanonik → id apa adanya.
    const rows = d
      .prepare(
        `SELECT m.match_id, m.competition_id, m.utc_date, m.status,
                m.home_team_id, m.away_team_id,
                ht.name AS home_name, at.name AS away_name
         FROM matches m
         LEFT JOIN teams ht ON ht.team_id = m.home_team_id
         LEFT JOIN teams at ON at.team_id = m.away_team_id
         WHERE m.utc_date >= ? AND m.utc_date < ?`,
      )
      .all(dariUtc, sampaiUtc) as Record<string, unknown>[];
    const namaTim = (tid: string, namaJoin: unknown) => {
      if (typeof namaJoin === "string" && namaJoin) return namaJoin;
      const cid = canonicalIdForTeamId(tid);
      return cid ? opponentName(cid) : tid;
    };
    for (const r of rows) {
      const mid = r.match_id as string;
      if (!byId.has(mid)) {
        byId.set(mid, {
          match_id: mid,
          home: namaTim(r.home_team_id as string, r.home_name),
          away: namaTim(r.away_team_id as string, r.away_name),
          competition_name:
            petaLiga().nama.get(r.competition_id as string) ?? (r.competition_id as string),
          competition_country: null,
          competition_canonical_id: r.competition_id as string,
          competition_id_mentah: r.competition_id as string,
          home_team_id: r.home_team_id as string,
          away_team_id: r.away_team_id as string,
          kickoff_utc: r.utc_date as string,
          statusRaw: r.status as string,
          dariKatalog: false,
        });
      }
    }
  } catch {
    /* dataset tak tersedia */
  }

  // Konteks batch (Fix-6 butir 6): UID, sibling, baris dataset dan
  // katalog untuk SELURUH id di jendela dimuat massal — menggantikan
  // getMatchState + fixtureUidOf + jadwalUlangOf per item (N+1).
  const ctx: KonteksBatch = {
    uidById: new Map(),
    siblingsById: new Map(),
    datasetById: new Map(),
    catalogById: new Map(),
  };
  const semuaId = [...byId.keys()];
  muatAliasBatch(semuaId, ctx.uidById, ctx.siblingsById);
  const semuaSibling = new Set<string>();
  for (const id of semuaId) {
    for (const s of ctx.siblingsById.get(id) ?? [id]) semuaSibling.add(s);
  }
  muatDatasetBatch([...semuaSibling], ctx.datasetById);
  muatKatalogBatch([...semuaSibling], ctx.catalogById);

  // Pilihan resmi (ledger) untuk seluruh jendela, dimuat massal (pola
  // konteks batch yang sama): Analisa menautkan angka topLeg dari paket
  // terbaru ke angka terbit resmi market+selection yang sama bila
  // pilihan itu sudah terbit, supaya angka paket terbaru tidak pernah
  // tampil seolah-olah angka resmi (brief tindak lanjut §2.3). Baris
  // resmi dipetakan ke item pemiliknya lewat id sibling atau UID laga.
  const resmiByItem = new Map<string, OfficialPick[]>();
  try {
    const d = picksDb();
    if (kolomAda(d, "picks", "pick_uid") && kolomAda(d, "picks", "published_prob")) {
      const punyaUid = kolomAda(d, "picks", "fixture_uid");
      const itemOf = new Map<string, string>();
      for (const id of semuaId) {
        for (const s of ctx.siblingsById.get(id) ?? [id]) itemOf.set(s, id);
        const uid = ctx.uidById.get(id);
        if (uid) itemOf.set(uid, id);
      }
      const kunci = [...itemOf.keys()];
      if (kunci.length > 0) {
        const marks = kunci.map(() => "?").join(",");
        const rows = (
          punyaUid
            ? d
                .prepare(
                  `SELECT * FROM picks WHERE pick_uid IS NOT NULL AND published_prob IS NOT NULL
                     AND (match_id IN (${marks}) OR fixture_uid IN (${marks}))`,
                )
                .all(...kunci, ...kunci)
            : d
                .prepare(
                  `SELECT * FROM picks WHERE pick_uid IS NOT NULL AND published_prob IS NOT NULL
                     AND match_id IN (${marks})`,
                )
                .all(...kunci)
        ) as unknown as OfficialPick[];
        for (const r of rows) {
          const pemilik =
            itemOf.get(r.match_id) ??
            (r.fixture_uid ? itemOf.get(r.fixture_uid) : undefined);
          if (!pemilik) continue;
          const arr = resmiByItem.get(pemilik);
          if (arr) arr.push(r);
          else resmiByItem.set(pemilik, [r]);
        }
      }
    }
  } catch {
    /* ledger tak tersedia di DB ini: semua item tanpa angka resmi */
  }

  const nowMs = Date.now();
  const items: JadwalItem[] = [];
  for (const m of byId.values()) {
    const pkg = pkgById.get(m.match_id) ?? null;
    const keadaan = keadaanBatch(ctx, m.match_id, m.kickoff_utc, nowMs);
    let status: StatusTampil;
    if (keadaan) {
      status = keadaan.status;
    } else if (m.dariKatalog) {
      const ds = displayStatus(m.statusRaw);
      status = terapkanWaktu(ds !== "unknown" ? ds : "scheduled", m.kickoff_utc, nowMs);
    } else {
      status = terapkanWaktu("scheduled", m.kickoff_utc, nowMs);
    }
    const ringkas = pkg ? ringkasPaket(pkg) : { pickCounts: { A: 0, B: 0, C: 0 }, topLeg: null };
    /* Angka resmi untuk topLeg: kandidat market+selection yang sama
       dari ledger; edisi yang sama dengan paket tampil didahulukan,
       lalu terbitan terakhir, lalu probabilitas terbit tertinggi —
       deterministik. Label basis diproyeksikan dari baris resmi itu
       sendiri lewat proyeksi bersama B2.2. */
    let topLegResmi: JadwalItem["topLegResmi"] = null;
    if (ringkas.topLeg) {
      const leg = ringkas.topLeg;
      const kandidat = (resmiByItem.get(m.match_id) ?? []).filter(
        (p) => p.market === leg.market && p.selection === leg.selection,
      );
      kandidat.sort(
        (a, b) =>
          (b.package_id === pkg?.id ? 1 : 0) - (a.package_id === pkg?.id ? 1 : 0) ||
          String(b.published_at_utc ?? "").localeCompare(String(a.published_at_utc ?? "")) ||
          (b.published_prob ?? 0) - (a.published_prob ?? 0),
      );
      const resmi = kandidat[0];
      if (resmi && resmi.published_prob !== null) {
        const label = labelSumberPeluang(resmi);
        topLegResmi = {
          prob: resmi.published_prob,
          label_basis: label.label_basis,
          keterangan_basis: label.keterangan_basis,
        };
      }
    }
    const identitas = identitasKompetisiTampil(
      m.competition_canonical_id,
      m.competition_id_mentah,
      m.competition_name,
      m.competition_country,
    );
    items.push({
      match_id: m.match_id,
      fixture_uid: ctx.uidById.get(m.match_id) ?? null,
      home: m.home,
      away: m.away,
      competition_name: m.competition_name,
      competition_country: m.competition_country,
      competition_canonical_id: identitas.canonical_id ?? m.competition_canonical_id,
      competition_id_mentah: m.competition_id_mentah,
      grup_kunci: identitas.kunci,
      grup_nama: identitas.nama,
      grup_negara: identitas.negara,
      grup_sumber: identitas.sumber,
      home_canonical_id:
        (m.home_team_id ? canonicalIdForTeamId(m.home_team_id) : null) ??
        canonicalIdForTeamName(m.home),
      away_canonical_id:
        (m.away_team_id ? canonicalIdForTeamId(m.away_team_id) : null) ??
        canonicalIdForTeamName(m.away),
      kickoff_utc: m.kickoff_utc,
      status,
      home_goals: keadaan?.home_goals ?? null,
      away_goals: keadaan?.away_goals ?? null,
      menit: keadaan?.menit ?? null,
      jadwal_asal_utc: status === "postponed" ? m.kickoff_utc : null,
      jadwal_ulang_utc: status === "postponed" ? jadwalUlangBatch(ctx, m.match_id, m.kickoff_utc) : null,
      package_id: pkg?.id ?? null,
      gate_status: pkg?.gate_status ?? null,
      pickCounts: ringkas.pickCounts,
      topLeg: ringkas.topLeg,
      topLegResmi,
    });
  }
  // Dedup per UID kanonik: alias provider untuk laga fisik yang sama
  // hanya menghasilkan satu baris — yang berpaket menang, lalu yang
  // berkatalog.
  const perUid = new Map<string, JadwalItem>();
  const tanpaUid: JadwalItem[] = [];
  for (const it of items) {
    if (!it.fixture_uid) {
      tanpaUid.push(it);
      continue;
    }
    const cur = perUid.get(it.fixture_uid);
    if (!cur || (it.package_id !== null && cur.package_id === null)) {
      perUid.set(it.fixture_uid, it);
    }
  }
  const dedup = [...tanpaUid, ...perUid.values()];
  dedup.sort(
    (a, b) =>
      a.kickoff_utc.localeCompare(b.kickoff_utc) ||
      prioritasLiga(a.competition_canonical_id, a.competition_name) -
        prioritasLiga(b.competition_canonical_id, b.competition_name) ||
      a.competition_name.localeCompare(b.competition_name) ||
      a.match_id.localeCompare(b.match_id),
  );
  return dedup;
}

/** Jendela liputan jadwal yang benar-benar diketahui (katalog ∪ paket). */
export function cakupanJadwal(): { dariUtc: string; sampaiUtc: string } | null {
  const bounds: { a: string; b: string }[] = [];
  const up = upcomingDb();
  if (up) {
    try {
      const r = up
        .prepare(`SELECT MIN(utc_date) AS a, MAX(utc_date) AS b FROM upcoming_fixtures`)
        .get() as { a: string | null; b: string | null };
      if (r.a && r.b) bounds.push({ a: r.a, b: r.b });
    } catch {
      /* abaikan */
    }
  }
  try {
    const r = packagesDb()
      .prepare(`SELECT MIN(kickoff_utc) AS a, MAX(kickoff_utc) AS b FROM packages`)
      .get() as { a: string | null; b: string | null };
    if (r.a && r.b) bounds.push({ a: r.a, b: r.b });
  } catch {
    /* abaikan */
  }
  if (bounds.length === 0) return null;
  return {
    dariUtc: bounds.map((x) => x.a).sort()[0],
    sampaiUtc: bounds.map((x) => x.b).sort()[bounds.length - 1],
  };
}

export interface InfoFixture {
  match_id: string;
  fixture_uid: string | null;
  home: string;
  away: string;
  competition_name: string;
  competition_country: string | null;
  kickoff_utc: string;
  status: StatusTampil;
}

/**
 * Info dasar satu laga TANPA syarat paket — detail laga terjadwal tanpa
 * paket tetap bisa dibuka (U3.6). Urutan sumber: katalog, dataset, paket.
 * Null hanya untuk ID yang benar-benar asing.
 */
export function getFixtureInfo(matchId: string): InfoFixture | null {
  const ids = siblingsOf(matchId);
  const fixtureUid = fixtureUidOf(matchId);
  const up = upcomingDb();
  if (up) {
    try {
      for (const id of ids) {
        const r = up
          .prepare(`SELECT * FROM upcoming_fixtures WHERE match_id = ?`)
          .get(id) as Record<string, unknown> | undefined;
        if (r) {
          const keadaan = getMatchState(matchId);
          return {
            match_id: matchId,
            fixture_uid: fixtureUid,
            home: (r.home_team_name as string | null) ?? "?",
            away: (r.away_team_name as string | null) ?? "?",
            competition_name: (r.competition_name as string | null) ?? "",
            competition_country: (r.competition_country as string | null) ?? null,
            kickoff_utc: r.utc_date as string,
            status:
              keadaan?.status ??
              terapkanWaktu(displayStatus(r.status as string | null), r.utc_date as string, Date.now()),
          };
        }
      }
    } catch {
      /* lanjut ke sumber berikutnya */
    }
  }
  try {
    const d = datasetDb();
    for (const id of ids) {
      const r = d
        .prepare(`SELECT * FROM matches WHERE match_id = ?`)
        .get(id) as Record<string, unknown> | undefined;
      if (r) {
        const namaTim = (tid: string) => {
          const t = d
            .prepare(`SELECT name FROM teams WHERE team_id = ?`)
            .get(tid) as { name: string } | undefined;
          if (t?.name) return t.name;
          const cid = canonicalIdForTeamId(tid);
          return cid ? opponentName(cid) : tid;
        };
        const keadaan = getMatchState(matchId);
        return {
          match_id: matchId,
          fixture_uid: fixtureUid,
          home: namaTim(r.home_team_id as string),
          away: namaTim(r.away_team_id as string),
          competition_name:
            petaLiga().nama.get(r.competition_id as string) ?? (r.competition_id as string),
          competition_country: null,
          kickoff_utc: r.utc_date as string,
          status:
            keadaan?.status ??
            terapkanWaktu(displayStatus(r.status as string), r.utc_date as string, Date.now()),
        };
      }
    }
  } catch {
    /* lanjut */
  }
  try {
    for (const id of ids) {
      const row = packagesDb()
        .prepare(`SELECT * FROM packages WHERE match_id = ? ORDER BY id DESC LIMIT 1`)
        .get(id) as Record<string, unknown> | undefined;
      if (row) {
        const pkg = parsePackage(row);
        const f = pkg.payload.fixture;
        return {
          match_id: matchId,
          fixture_uid: fixtureUid,
          home: f.home,
          away: f.away,
          competition_name: f.competition_name,
          competition_country: null,
          kickoff_utc: pkg.kickoff_utc,
          status:
            getMatchState(matchId)?.status ??
            terapkanWaktu("scheduled", pkg.kickoff_utc, Date.now()),
        };
      }
    }
  } catch {
    /* tak ada sumber yang mengenal id ini */
  }
  return null;
}

/** Satu baris paket utuh menurut id — pembaca edisi terbit di detail. */
export function getPackageRowById(packageId: number): PackageRow | null {
  const row = packagesDb()
    .prepare(`SELECT * FROM packages WHERE id = ?`)
    .get(packageId) as Record<string, unknown> | undefined;
  return row ? parsePackage(row) : null;
}

/** Matriks skor paket untuk halaman analisis + pembangun parlay (client-safe data). */
export function getPackageMatrix(packageId: number): number[][] | null {
  const row = packagesDb()
    .prepare(`SELECT payload_json FROM packages WHERE id = ?`)
    .get(packageId) as { payload_json: string } | undefined;
  if (!row) return null;
  return (JSON.parse(row.payload_json) as QuantPayload).score_matrix ?? null;
}
