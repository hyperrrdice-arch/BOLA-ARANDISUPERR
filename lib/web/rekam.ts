/**
 * REKAM — lapisan baca halaman Pilihan & Rekam hasil (K7, U04–U08).
 *
 * Satu pintu baca untuk dua halaman:
 * - `/bukti` — daftar pilihan RESMI (jalur publikasi K2, seri produksi
 *   `live-run`) + ringkasan cohort dari `cohortStats` (K2) dengan FILTER
 *   YANG SAMA persis dengan daftarnya: filter mengubah ANGGOTA cohort,
 *   bukan DEFINISI ukuran (D4). Halaman tidak menghitung ulang dengan
 *   rumus sendiri.
 * - `/bukti?tiket=<uid>` — detail tiket RESMI K3 lewat `getOfficialSlip`;
 *   slip draf browser tidak hidup di tabel itu dan tidak pernah tampil.
 * - `/pilihan` — umpan builder: pilihan resmi pra-laga (pick_uid terisi,
 *   peluang terbit tercatat, belum sepak mula), ter-dedup per laga fisik.
 *
 * Alasan pending jatuh tempo: ledger tidak menyimpan alasan per baris
 * (catatan K2). Yang dipakai di sini hanya yang benar-benar ada datanya:
 * antrean konflik identitas K1 (`fixture_identity_queue`, alasan
 * `identity_ambiguous` yang belum selesai) → "konflik". Sejak PR 2 ada
 * satu alasan struktural lagi yang sama-sama terbukti dari data:
 * kompetisi yang terdaftar di registri liga tetapi tidak terpetakan ke
 * divisi feed hasil aktif mana pun (`lib/picks/feed-coverage.ts`) →
 * "tanpa-feed": barisnya terminal "tidak-dapat-dinilai", bukan menunggu.
 * Sisanya tetap jujur "unspecified" — ditampilkan sebagai menunggu
 * hasil dari sumber data, tidak dikarang menjadi "sumber tidak
 * mencakup" tanpa bukti registri.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dbPath } from "../db/paths";
import { cohortStats, SETTLEMENT_WINDOW_MS, type CohortFilter, type CohortStats } from "../picks/cohort";
import { statusFeedKompetisi } from "../picks/feed-coverage";
import { UNRECORDED_PROB_LABEL } from "../picks/publication";
import {
  getOfficialSlip,
  listOfficialSlips,
  slipRecordStats,
  type OfficialSlipView,
  type SlipLegView,
  type SlipRecordStats,
} from "../picks/tickets";
import { MARKET_LABEL, ZONA_BAKU, int, labelPilihan, pct, zonaValid } from "./format";
import {
  FIX4_TICKET_SIZE,
  fix4DateWibOf,
  fix4WindowForDate,
} from "../picks/fix4-policy";
import { FREE_REFRESH_LAST_SUCCESS_KEY } from "../picks/packages";
import { jendelaTanggalUtc } from "./jadwal";

/** Seri produksi ledger — kolom `source` baris terbit diisi dari seri ini. */
export const SERI_PRODUKSI = "live-run";

/* ------------------------------------------------------------ akses DB */

type Db = DatabaseSync;
const g = globalThis as unknown as { __rekamDbs?: Map<string, Db> };
function dbRo(file: string): Db | null {
  if (!g.__rekamDbs) g.__rekamDbs = new Map();
  const key = `ro:${file}`;
  const ada = g.__rekamDbs.get(key);
  if (ada) return ada;
  const p = dbPath(file);
  if (!fs.existsSync(p)) return null;
  try {
    const h = new DatabaseSync(p, { readOnly: true });
    g.__rekamDbs.set(key, h);
    return h;
  } catch {
    return null;
  }
}

function kolomAda(d: Db, table: string, kolom: string): boolean {
  try {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return cols.some((c) => c.name === kolom);
  } catch {
    return false;
  }
}

/* ------------------------------------------- nama laga dari paket asal */

interface NamaLaga {
  home: string;
  away: string;
  competition_name: string;
}

const namaCache = new Map<number, NamaLaga | null>();

/** Parse nama laga dari payload_json paket — tiga bentuk warisan yang dikenal. */
function parseNamaPayload(payloadJson: string): NamaLaga | null {
  try {
    const raw = JSON.parse(payloadJson) as Record<string, unknown>;
    const fx = raw.fixture as
      | { home?: string; away?: string; competition_name?: string }
      | undefined;
    if (fx && typeof fx.home === "string" && typeof fx.away === "string") {
      return { home: fx.home, away: fx.away, competition_name: fx.competition_name ?? "" };
    }
    if (typeof raw.home === "string" && typeof raw.away === "string") {
      return {
        home: raw.home,
        away: raw.away,
        competition_name: (raw.competition_name as string) ?? "",
      };
    }
    const sel = raw.selection as
      | { fixture?: { home_team_name?: string; away_team_name?: string; competition_name?: string } }
      | undefined;
    if (sel?.fixture?.home_team_name && sel?.fixture?.away_team_name) {
      return {
        home: sel.fixture.home_team_name,
        away: sel.fixture.away_team_name,
        competition_name: sel.fixture.competition_name ?? "",
      };
    }
  } catch {
    /* payload tak terbaca → null */
  }
  return null;
}

/** Nama laga dari payload paket penerbit (cache per id — payload immutable). */
export function namaDariPaket(packageId: number | null): NamaLaga | null {
  if (packageId === null || packageId === undefined) return null;
  const hit = namaCache.get(packageId);
  if (hit !== undefined) return hit;
  let val: NamaLaga | null = null;
  const d = dbRo("analysis_snapshots.db");
  if (d) {
    try {
      const row = d
        .prepare("SELECT payload_json FROM packages WHERE id = ?")
        .get(packageId) as { payload_json: string } | undefined;
      if (row) val = parseNamaPayload(row.payload_json);
    } catch {
      val = null;
    }
  }
  namaCache.set(packageId, val);
  return val;
}

/**
 * Muat massal nama laga (Fix-6 butir 6): satu statement IN(...) per 900
 * id mengisi cache yang sama dengan `namaDariPaket`, menggantikan satu
 * kueri per paket pada daftar panjang (terukur 77 SQL untuk 75 laga →
 * 1 statement batch). Id yang tidak ditemukan di-cache sebagai null —
 * semantik yang sama dengan jalur tunggal.
 */
export function muatNamaPaketBatch(packageIds: (number | null | undefined)[]): void {
  const perlu = [
    ...new Set(
      packageIds.filter(
        (x): x is number => x !== null && x !== undefined && !namaCache.has(x),
      ),
    ),
  ];
  if (perlu.length === 0) return;
  const d = dbRo("analysis_snapshots.db");
  if (!d) {
    for (const id of perlu) namaCache.set(id, null);
    return;
  }
  try {
    for (let i = 0; i < perlu.length; i += 900) {
      const c = perlu.slice(i, i + 900);
      const rows = d
        .prepare(
          `SELECT id, payload_json FROM packages WHERE id IN (${c.map(() => "?").join(",")})`,
        )
        .all(...(c as never[])) as unknown as { id: number; payload_json: string }[];
      const terlihat = new Set<number>();
      for (const row of rows) {
        terlihat.add(row.id);
        namaCache.set(row.id, parseNamaPayload(row.payload_json));
      }
      for (const id of c) if (!terlihat.has(id)) namaCache.set(id, null);
    }
  } catch {
    /* gagal batch → jalur tunggal per id tetap bekerja */
  }
}

/* ---------------------------------------------------------------- filter */

export interface FilterRekam {
  /** Kode pasar ledger (1x2, dc, ou25, …) atau null = semua pasar. */
  pasar: string | null;
  /** Kelas A/B/C atau null = semua kelas. */
  kelas: string | null;
  /** competition_canonical_id atau null = semua liga. */
  liga: string | null;
  /** Tanggal lokal awal "YYYY-MM-DD" (zona `tz`) atau null. */
  dari: string | null;
  /** Tanggal lokal akhir inklusif atau null. */
  sampai: string | null;
  tz: string;
}

const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

function tanggalSah(s: string): boolean {
  if (!POLA_TANGGAL.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function teks(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== "string") return null;
  const t = s.trim().slice(0, 80);
  return t === "" ? null : t;
}

/**
 * Baca filter rekam dari searchParams. Nilai tak dikenal → null
 * (terdokumentasi: filter itu tidak diterapkan), zona → zona baku.
 * Rentang terbalik (dari > sampai) ditukar, bukan mengosongkan cohort.
 */
export function parseFilterRekam(
  params: Record<string, string | string[] | undefined>,
): FilterRekam {
  const tz = zonaValid(teks(params.tz) ?? undefined);
  const pasarMentah = teks(params.pasar);
  const pasar = pasarMentah && pasarMentah in MARKET_LABEL ? pasarMentah : null;
  const kelasMentah = teks(params.kelas);
  const kelas = kelasMentah && /^[ABC]$/.test(kelasMentah) ? kelasMentah : null;
  const liga = teks(params.liga);
  let dari = teks(params.dari);
  let sampai = teks(params.sampai);
  if (dari && !tanggalSah(dari)) dari = null;
  if (sampai && !tanggalSah(sampai)) sampai = null;
  if (dari && sampai && dari > sampai) [dari, sampai] = [sampai, dari];
  return { pasar, kelas, liga, dari, sampai, tz };
}

/** Query string kanonik filter — tautan/form menyimpannya apa adanya. */
export function queryRekam(f: FilterRekam): string {
  const q = new URLSearchParams();
  if (f.pasar) q.set("pasar", f.pasar);
  if (f.kelas) q.set("kelas", f.kelas);
  if (f.liga) q.set("liga", f.liga);
  if (f.dari) q.set("dari", f.dari);
  if (f.sampai) q.set("sampai", f.sampai);
  if (f.tz !== ZONA_BAKU) q.set("tz", f.tz);
  return q.toString();
}

/**
 * Filter cohort (K2) untuk filter UI ini. Periode tanggal lokal diubah
 * ke jendela UTC [dari 00.00 lokal, sampai 24.00 lokal); batas atas
 * cohort inklusif, jadi dipakai ujung jendela −1 ms.
 */
export function cohortFilterOf(f: FilterRekam): CohortFilter {
  const c: CohortFilter = { source: SERI_PRODUKSI };
  if (f.pasar) c.market = f.pasar;
  if (f.kelas) c.grade = f.kelas;
  if (f.liga) c.competition_canonical_id = f.liga;
  if (f.dari) c.from_utc = jendelaTanggalUtc(f.dari, f.tz).dariUtc;
  if (f.sampai) {
    const ujung = Date.parse(jendelaTanggalUtc(f.sampai, f.tz).sampaiUtc) - 1;
    c.to_utc = new Date(ujung).toISOString();
  }
  return c;
}

/** Nama liga dari registry kanonik (id → nama); absen → peta kosong. */
let namaLigaCache: Map<string, string> | null = null;
function namaLigaKanonik(): Map<string, string> {
  if (namaLigaCache) return namaLigaCache;
  const map = new Map<string, string>();
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "data", "league-canonical.json"), "utf8"),
    ) as { leagues?: { canonical_id: string; name: string }[] };
    for (const lg of raw.leagues ?? []) if (lg.name) map.set(lg.canonical_id, lg.name);
  } catch {
    /* tanpa registry: nama = id apa adanya */
  }
  namaLigaCache = map;
  return map;
}

/* ------------------------------------------------------- keadaan pilihan */

export type KeadaanPilihan =
  | "tepat"
  | "meleset"
  | "batal"
  | "belum-mulai"
  | "menunggu-jendela"
  | "jatuh-tempo"
  | "tidak-dapat-dinilai";

/**
 * Keadaan satu baris rekam — klasifikasi yang sama dengan cohortStats:
 * vonis hanya dari outcome/void backend; sisanya jam (belum mulai /
 * menunggu jendela 6 jam / jatuh tempo). Tidak pernah menebak hasil.
 * Baris jatuh tempo yang kompetisinya terbukti tanpa feed hasil
 * (`tanpa_feed`, PR 2) berkeadaan terminal "tidak-dapat-dinilai" —
 * pemanggil yang tahu (konflik identitas terbukti) menahan bendera itu,
 * sejalan dengan preseden alasan di cohortStats.
 */
export function keadaanPilihan(
  row: {
    hit: number | null;
    voided: boolean;
    kickoff_utc: string | null;
    tanpa_feed?: boolean;
  },
  nowMs: number,
): KeadaanPilihan {
  if (row.voided) return "batal";
  if (row.hit === 1) return "tepat";
  if (row.hit === 0) return "meleset";
  const ko = row.kickoff_utc ? Date.parse(row.kickoff_utc) : NaN;
  if (Number.isFinite(ko) && ko > nowMs) return "belum-mulai";
  if (Number.isFinite(ko) && nowMs < ko + SETTLEMENT_WINDOW_MS) return "menunggu-jendela";
  if (row.tanpa_feed) return "tidak-dapat-dinilai";
  return "jatuh-tempo";
}

/** Label keadaan untuk tampilan (kamus U5/U6). */
export const KEADAAN_LABEL: Record<KeadaanPilihan, string> = {
  tepat: "Tepat",
  meleset: "Meleset",
  batal: "Dibatalkan",
  "belum-mulai": "Belum mulai",
  "menunggu-jendela": "Menunggu hasil",
  "jatuh-tempo": "Sudah jatuh tempo",
  "tidak-dapat-dinilai": "Tidak dapat dinilai",
};

/* ------------------------------------------- alasan jatuh tempo (K1) */

/**
 * ID pertandingan yang masih mengantre sebagai konflik identitas
 * (`identity_ambiguous`, belum selesai) di store K1. DB/queue absen →
 * himpunan kosong (tidak ada alasan yang dikarang).
 */
export function idKonflikIdentitas(): Set<string> {
  const out = new Set<string>();
  const d = dbRo("thestats_dataset.db");
  if (!d) return out;
  try {
    if (!kolomAda(d, "fixture_identity_queue", "source_match_id")) return out;
    const rows = d
      .prepare(
        `SELECT source_match_id FROM fixture_identity_queue
         WHERE reason = 'identity_ambiguous' AND resolved_at IS NULL`,
      )
      .all() as { source_match_id: string }[];
    for (const r of rows) out.add(r.source_match_id);
  } catch {
    /* queue tak terbaca → tanpa alasan konflik */
  }
  return out;
}

/* ------------------------------------------- resolusi UID fisik (L2) */

/**
 * Resolusi UID laga FISIK untuk baris ledger yang fixture_uid-nya NULL
 * (warisan pra-K1 / migrasi yang tak menjangkaunya): lewat store
 * identitas K1 (`fixture_aliases`) — mekanisme persisten yang sama
 * dengan pembaca detail (`fixtureUidOf`). Store absen/rusak → peta
 * kosong dan kunci jatuh ke match_id (perilaku lama). Tidak pernah
 * mengarang UID: hanya alias yang terdaftar yang dipakai.
 */
export function petaUidFisik(matchIds: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const unik = [...new Set(matchIds)];
  if (unik.length === 0) return out;
  const d = dbRo("thestats_dataset.db");
  if (!d) return out;
  try {
    for (let i = 0; i < unik.length; i += 500) {
      const potong = unik.slice(i, i + 500);
      const rows = d
        .prepare(
          `SELECT source_match_id, fixture_uid FROM fixture_aliases
           WHERE source_match_id IN (${potong.map(() => "?").join(",")})`,
        )
        .all(...(potong as never[])) as unknown as {
        source_match_id: string;
        fixture_uid: string;
      }[];
      for (const r of rows) {
        if (!out.has(r.source_match_id)) out.set(r.source_match_id, r.fixture_uid);
      }
    }
  } catch {
    /* store identitas belum ada → tanpa resolusi */
  }
  return out;
}

/** Kunci laga fisik satu baris: UID ledger → UID store identitas → match_id. */
function kunciFisik(
  row: { fixture_uid: string | null; match_id: string },
  uidMap: Map<string, string>,
): string {
  return row.fixture_uid ?? uidMap.get(row.match_id) ?? row.match_id;
}

/* ------------------------------------------------------------ baris rekam */

export interface BarisRekam {
  pick_id: number;
  pick_uid: string | null;
  match_id: string;
  fixture_uid: string | null;
  home: string;
  away: string;
  competition_name: string;
  competition_canonical_id: string | null;
  kickoff_utc: string;
  market: string;
  selection: string;
  line: string;
  grade: string | null;
  gate_status: string | null;
  published_prob: number | null;
  probability_basis: string | null;
  /** Angka terbit untuk tampilan; label K2 bila tak tercatat. */
  published_display: number | string;
  published_at_utc: string | null;
  model_version: string | null;
  package_id: number | null;
  home_goals: number | null;
  away_goals: number | null;
  keadaan: KeadaanPilihan;
  /**
   * Alasan baris belum dinilai padahal sudah lewat: 'konflik' bila
   * antrean K1 memuatnya (keadaan jatuh-tempo), 'tanpa-feed' bila
   * kompetisinya terbukti tanpa feed hasil (keadaan tidak-dapat-dinilai).
   */
  alasan_jatuh_tempo: "konflik" | "tanpa-feed" | null;
}

interface RekamRowDb {
  id: number;
  match_id: string;
  fixture_uid: string | null;
  pick_uid: string | null;
  competition_canonical_id: string | null;
  kickoff_utc: string;
  market: string;
  selection: string;
  line: string | null;
  model_prob: number;
  market_prob: number | null;
  sm_prob: number | null;
  gate_status: string | null;
  grade: string | null;
  package_id: number | null;
  published_prob: number | null;
  probability_basis: string | null;
  published_error: string | null;
  published_at_utc: string | null;
  model_version: string | null;
  hit: number | null;
  home_goals: number | null;
  away_goals: number | null;
  voided: number | null;
}

function whereCohort(c: CohortFilter): { sql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (c.source) { where.push("p.source = ?"); params.push(c.source); }
  if (c.grade) { where.push("p.grade = ?"); params.push(c.grade); }
  if (c.gate_status) { where.push("p.gate_status = ?"); params.push(c.gate_status); }
  if (c.market) { where.push("p.market = ?"); params.push(c.market); }
  if (c.competition_canonical_id) {
    where.push("p.competition_canonical_id = ?");
    params.push(c.competition_canonical_id);
  }
  if (c.from_utc) { where.push("p.kickoff_utc >= ?"); params.push(c.from_utc); }
  if (c.to_utc) { where.push("p.kickoff_utc <= ?"); params.push(c.to_utc); }
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

export interface RekamData {
  filter: FilterRekam;
  cohort: CohortFilter;
  stats: CohortStats;
  /** Semua baris cohort (urut kickoff terbaru dulu) — halaman memotong. */
  baris: BarisRekam[];
  /** Jumlah laga fisik unik di antara baris yang sudah dinilai. */
  laga_dinilai_unik: number;
  /** Cap publikasi terakhir dalam cohort (published_at_utc maksimum). */
  diperbarui_utc: string | null;
  tiket_stats: SlipRecordStats;
  tiket: OfficialSlipView[];
  opsi_liga: { id: string; nama: string }[];
  opsi_pasar: string[];
}

/**
 * Ambil seluruh data halaman rekam untuk satu filter. Statistik berasal
 * dari `cohortStats` dengan objek filter yang sama dengan kueri daftar —
 * satu sampel, satu penyebut.
 */
export function ambilRekam(f: FilterRekam, nowUtc: string): RekamData {
  const cohort = cohortFilterOf(f);
  const nowMs = Date.parse(nowUtc);
  const konflik = idKonflikIdentitas();

  const d = dbRo("picks.db");
  let rows: RekamRowDb[] = [];
  let opsiLiga: { id: string; nama: string }[] = [];
  let opsiPasar: string[] = [];
  let stats: CohortStats;
  if (d) {
    const { sql, params } = whereCohort(cohort);
    const punyaUid = kolomAda(d, "picks", "pick_uid");
    rows = d
      .prepare(
        `SELECT p.id, p.match_id, ${punyaUid ? "p.fixture_uid" : "NULL AS fixture_uid"},
                ${punyaUid ? "p.pick_uid" : "NULL AS pick_uid"},
                p.competition_canonical_id, p.kickoff_utc, p.market, p.selection,
                ${punyaUid ? "p.line" : "'' AS line"},
                p.model_prob, p.market_prob, p.sm_prob, p.gate_status, p.grade,
                p.package_id,
                ${punyaUid ? "p.published_prob" : "NULL AS published_prob"},
                ${punyaUid ? "p.probability_basis" : "NULL AS probability_basis"},
                ${punyaUid ? "p.published_error" : "NULL AS published_error"},
                ${punyaUid ? "p.published_at_utc" : "NULL AS published_at_utc"},
                ${punyaUid ? "p.model_version" : "NULL AS model_version"},
                o.hit AS hit, o.home_goals, o.away_goals, v.pick_id AS voided
         FROM picks p
         LEFT JOIN pick_outcomes o ON o.pick_id = p.id
         LEFT JOIN pick_voids v ON v.pick_id = p.id
         ${sql}
         ORDER BY p.kickoff_utc DESC, p.id DESC`,
      )
      .all(...(params as never[])) as unknown as RekamRowDb[];

    // Peta alasan untuk cohortStats: hanya konflik yang terbukti di antrean.
    const alasan = new Map<number, string>();
    for (const r of rows) {
      if (r.hit === null && !r.voided && konflik.has(r.match_id)) {
        alasan.set(r.id, "konflik");
      }
    }
    stats = cohortStats({
      now_utc: nowUtc,
      filter: cohort,
      pending_reasons: alasan.size ? alasan : undefined,
    });

    // Opsi filter dari populasi seri produksi (bukan dari cohort terfilter,
    // supaya pilihan filter tidak hilang saat aktif).
    try {
      const ligaRows = d
        .prepare(
          `SELECT DISTINCT competition_canonical_id AS id FROM picks
           WHERE source = ? AND competition_canonical_id IS NOT NULL
           ORDER BY competition_canonical_id`,
        )
        .all(SERI_PRODUKSI) as { id: string }[];
      const namaLiga = namaLigaKanonik();
      opsiLiga = ligaRows.map((r) => ({ id: r.id, nama: namaLiga.get(r.id) ?? r.id }));
      opsiPasar = (
        d
          .prepare(
            `SELECT DISTINCT market FROM picks WHERE source = ? ORDER BY market`,
          )
          .all(SERI_PRODUKSI) as { market: string }[]
      )
        .map((r) => r.market)
        .filter((m) => m in MARKET_LABEL);
    } catch {
      /* opsi kosong — filter tetap bekerja lewat URL */
    }
  } else {
    stats = cohortStats({ now_utc: nowUtc, filter: cohort });
  }

  muatNamaPaketBatch(rows.map((r) => r.package_id));
  // Baris ber-UID NULL diselesaikan ke laga fisiknya lewat store
  // identitas — kunci yang sama dengan umpan builder (L2): satu laga
  // fisik tidak terbelah hanya karena barisnya belum termigrasi.
  const uidMap = petaUidFisik(
    rows.filter((r) => !r.fixture_uid).map((r) => r.match_id),
  );
  const baris: BarisRekam[] = rows.map((r) => {
    const nama = namaDariPaket(r.package_id);
    const konflikBaris = konflik.has(r.match_id);
    // Terminal tanpa-feed hanya bila tak ada alasan terbukti lain:
    // konflik identitas menang, persis preseden cohortStats (PR 2).
    const tanpaFeed =
      !konflikBaris &&
      statusFeedKompetisi(r.competition_canonical_id) === "tanpa-feed";
    const keadaan = keadaanPilihan(
      {
        hit: r.hit,
        voided: r.voided !== null && r.voided !== undefined,
        kickoff_utc: r.kickoff_utc,
        tanpa_feed: tanpaFeed,
      },
      nowMs,
    );
    return {
      pick_id: r.id,
      pick_uid: r.pick_uid,
      match_id: r.match_id,
      fixture_uid: r.fixture_uid ?? uidMap.get(r.match_id) ?? null,
      home: nama?.home ?? "?",
      away: nama?.away ?? "?",
      competition_name: nama?.competition_name ?? "",
      competition_canonical_id: r.competition_canonical_id,
      kickoff_utc: r.kickoff_utc,
      market: r.market,
      selection: r.selection,
      line: r.line ?? "",
      grade: r.grade,
      gate_status: r.gate_status,
      published_prob: r.published_prob,
      probability_basis: r.probability_basis,
      published_display:
        r.published_prob !== null && r.published_prob !== undefined
          ? r.published_prob
          : r.probability_basis === "unknown_legacy" || r.probability_basis === null
            ? UNRECORDED_PROB_LABEL
            : (r.published_error ?? UNRECORDED_PROB_LABEL),
      published_at_utc: r.published_at_utc,
      model_version: r.model_version,
      package_id: r.package_id,
      home_goals: r.home_goals,
      away_goals: r.away_goals,
      keadaan,
      alasan_jatuh_tempo:
        keadaan === "tidak-dapat-dinilai"
          ? "tanpa-feed"
          : keadaan === "jatuh-tempo" && konflikBaris
            ? "konflik"
            : null,
    };
  });

  const lagaDinilai = new Set<string>();
  let diperbarui: string | null = null;
  for (const r of rows) {
    if ((r.hit === 0 || r.hit === 1) && !(r.voided !== null && r.voided !== undefined)) {
      lagaDinilai.add(kunciFisik(r, uidMap));
    }
    if (r.published_at_utc && (!diperbarui || r.published_at_utc > diperbarui)) {
      diperbarui = r.published_at_utc;
    }
  }

  return {
    filter: f,
    cohort,
    stats,
    baris,
    laga_dinilai_unik: lagaDinilai.size,
    diperbarui_utc: diperbarui,
    tiket_stats: slipRecordStats(),
    tiket: listOfficialSlips(),
    opsi_liga: opsiLiga,
    opsi_pasar: opsiPasar,
  };
}

export interface RingkasanRekam {
  stats: CohortStats;
  /** Jumlah laga fisik unik di antara baris yang sudah dinilai. */
  laga_dinilai_unik: number;
}

/**
 * Pembaca RINGKASAN kohor (PR 1B, brief hal. 8): angka yang sama dengan
 * `ambilRekam` untuk permukaan yang hanya menampilkan ringkasan
 * (Beranda) — statistik cohort + jumlah laga unik yang dinilai — TANPA
 * memuat seluruh baris kohor, nama dari payload paket, opsi filter,
 * atau tiket resmi. Pada data produksi `ambilRekam` menghabiskan
 * ±97% biaya baca Beranda (audit PR 1A); pembaca ini menggantinya
 * tanpa mengubah satu pun angka yang tampil.
 *
 * Paritas dengan jalur penuh dijaga menurut konstruksi:
 * - statistik berasal dari `cohortStats` yang sama, dengan filter
 *   cohort yang sama (`cohortFilterOf`) DAN peta alasan pending yang
 *   sama — peta itu dibangun di sini dari kueri sempit atas baris
 *   pending saja (tanpa outcome, tidak void, laga di antrean konflik
 *   identitas K1), persis kondisi yang dipakai `ambilRekam` saat
 *   menyapu seluruh baris;
 * - `laga_dinilai_unik` menghitung kunci fisik yang sama (`kunciFisik`
 *   + `petaUidFisik`) atas baris yang sudah dinilai saja.
 * Basis probabilitas tidak disentuh: statistik tetap basis
 * `published_prob` lewat `cohortStats`, sama seperti `ambilRekam`.
 */
export function ambilRingkasanRekam(
  f: FilterRekam,
  nowUtc: string,
): RingkasanRekam {
  const cohort = cohortFilterOf(f);
  const konflik = idKonflikIdentitas();

  const d = dbRo("picks.db");
  if (!d) {
    return {
      stats: cohortStats({ now_utc: nowUtc, filter: cohort }),
      laga_dinilai_unik: 0,
    };
  }

  const { sql, params } = whereCohort(cohort);
  const sambung = sql ? "AND" : "WHERE";

  // Peta alasan pending — himpunan yang sama dengan yang dibangun
  // ambilRekam: baris tanpa outcome (hit NULL) dan tidak void yang
  // laga-nya berada di antrean konflik.
  const barisPending = d
    .prepare(
      `SELECT p.id, p.match_id
       FROM picks p
       LEFT JOIN pick_outcomes o ON o.pick_id = p.id
       LEFT JOIN pick_voids v ON v.pick_id = p.id
       ${sql}
       ${sambung} o.hit IS NULL AND v.pick_id IS NULL`,
    )
    .all(...(params as never[])) as unknown as {
    id: number;
    match_id: string;
  }[];
  const alasan = new Map<number, string>();
  for (const r of barisPending) {
    if (konflik.has(r.match_id)) alasan.set(r.id, "konflik");
  }
  const stats = cohortStats({
    now_utc: nowUtc,
    filter: cohort,
    pending_reasons: alasan.size ? alasan : undefined,
  });

  // Laga fisik unik yang sudah dinilai — baris settled saja. Bentuk
  // EXISTS/NOT EXISTS (bukan LEFT JOIN polos): perencana SQLite kalau
  // tidak digerakkan dari `picks` akan menyapu idx_pick_outcomes_agg
  // atas SEMUA seri (±160 rb baris) sebelum filter cohort diterapkan
  // (±195 ms terukur); bentuk ini menyapu cohort lewat indeks source
  // dan memeriksa outcome/void per baris via kunci primer (±13 ms),
  // dengan himpunan baris yang persis sama untuk keperluan Set kunci.
  const punyaUid = kolomAda(d, "picks", "pick_uid");
  const barisDinilai = d
    .prepare(
      `SELECT p.match_id, ${punyaUid ? "p.fixture_uid" : "NULL AS fixture_uid"}
       FROM picks p
       ${sql}
       ${sambung} EXISTS (SELECT 1 FROM pick_outcomes o
                          WHERE o.pick_id = p.id AND o.hit IN (0, 1))
         AND NOT EXISTS (SELECT 1 FROM pick_voids v WHERE v.pick_id = p.id)`,
    )
    .all(...(params as never[])) as unknown as {
    match_id: string;
    fixture_uid: string | null;
  }[];
  const uidMap = petaUidFisik(
    barisDinilai.filter((r) => !r.fixture_uid).map((r) => r.match_id),
  );
  const lagaDinilai = new Set<string>();
  for (const r of barisDinilai) lagaDinilai.add(kunciFisik(r, uidMap));

  return { stats, laga_dinilai_unik: lagaDinilai.size };
}

/* --------------------------------------------------------- detail tiket */

export interface LegTiket extends SlipLegView {
  home: string;
  away: string;
  competition_name: string;
  kickoff_utc: string | null;
}

export interface DetailTiket {
  slip: OfficialSlipView;
  legs: LegTiket[];
}

/** Detail satu tiket resmi; null bila slip_uid tidak dikenal (D4). */
export function ambilDetailTiket(slipUid: string): DetailTiket | null {
  const slip = getOfficialSlip(slipUid);
  if (!slip) return null;
  const d = dbRo("picks.db");
  const legs: LegTiket[] = slip.legs.map((leg) => {
    let home = "?";
    let away = "?";
    let competition_name = "";
    let kickoff_utc: string | null = null;
    if (d) {
      try {
        const row = d
          .prepare("SELECT package_id, kickoff_utc FROM picks WHERE id = ?")
          .get(leg.pick_id) as { package_id: number | null; kickoff_utc: string } | undefined;
        if (row) {
          kickoff_utc = row.kickoff_utc;
          const nama = namaDariPaket(row.package_id);
          if (nama) {
            home = nama.home;
            away = nama.away;
            competition_name = nama.competition_name;
          }
        }
      } catch {
        /* nama tetap penanda */
      }
    }
    return { ...leg, home, away, competition_name, kickoff_utc };
  });
  return { slip, legs };
}

/* ------------------------------------------------------ umpan builder */

/**
 * Jejak konflik edisi resmi (brief §4): dua edisi atau lebih mengaku
 * resmi untuk kejadian semantik yang sama dengan angka terbit yang
 * BERBEDA. Kejadiannya ditahan dari kombinasi sampai konflik selesai —
 * tidak ada angka yang dipilih diam-diam; semua nilai + asalnya
 * terbaca di sini.
 */
export interface KonflikPilihan {
  nilai: {
    published_prob: number;
    match_id: string;
    pick_uid: string;
    package_id: number | null;
    published_at_utc: string | null;
  }[];
}

export interface PilihanPraLaga {
  pick_uid: string;
  match_id: string;
  fixture_uid: string;
  kickoff_utc: string;
  home: string;
  away: string;
  competition_name: string;
  gate_status: string;
  grade: string;
  market: string;
  selection: string;
  line: string;
  /** Peluang RESMI saat terbit (beku K2) — bukan angka analisis terbaru. */
  published_prob: number;
  probability_basis: string | null;
  published_at_utc: string | null;
  model_prob: number;
  sources_agree: number;
  package_id: number | null;
  /**
   * Non-null bila kejadian ini diklaim >1 edisi resmi dengan angka
   * terbit berbeda (brief §4): pilihan DITAHAN dari kombinasi;
   * `published_prob` di baris ini hanya milik edisi perwakilan
   * (terbit pertama) dan tidak boleh dipakai menghitung gabungan.
   */
  konflik: KonflikPilihan | null;
}

/** Baris edisi resmi minimum untuk pengelompokan kejadian semantik. */
export interface BarisEdisiResmi {
  id: number;
  pick_uid: string;
  match_id: string;
  fixture_uid: string | null;
  market: string;
  selection: string;
  line: string | null;
  published_prob: number | null;
  published_at_utc: string | null;
  package_id: number | null;
}

/** Satu kejadian semantik hasil pengelompokan edisi-edisi resmi. */
export interface KelompokKejadianResmi<T extends BarisEdisiResmi> {
  /** Edisi perwakilan: terbit pertama (prinsip keputusan-pertama K2). */
  perwakilan: T;
  /** Semua edisi sumber, urut waktu terbit lalu id — jejak audit. */
  edisi: T[];
  /** Jejak konflik bila edisi berbeda angka terbit; null bila sepakat. */
  konflik: KonflikPilihan | null;
}

/**
 * ATURAN PENGELOMPOKAN KEJADIAN RESMI — satu-satunya, dipakai bersama
 * oleh umpan Pilihan (`daftarPilihanPraLaga`) dan bagian prediksi
 * detail laga (`kelompokkanPilihanResmi` di lib/web/data.ts), supaya
 * dua permukaan tidak pernah berbeda hitungan atas ledger yang sama.
 *
 * Kunci semantik (brief §4): identitas laga FISIK (fixture_uid ledger,
 * atau resolusi store identitas untuk baris ber-UID NULL, atau
 * match_id) + pasar + garis + pilihan. Alias provider dari laga yang
 * sama melebur jadi satu kejadian (U03):
 * - semua edisi sepakat pada angka terbit yang sama → satu kejadian,
 *   perwakilan = edisi terbit pertama (keputusan-pertama K2), edisi
 *   lain tetap tertelusur di `edisi`;
 * - edisi-edisi berbeda angka terbit → KONFLIK: perwakilan tetap
 *   edisi terbit pertama, dengan jejak lengkap di `konflik` (semua
 *   nilai + asal + waktu terbit); tidak ada angka yang dipilih
 *   diam-diam. Edisi tanpa angka terbit (null) tidak ikut menentukan
 *   konflik angka, tetapi tetap tercatat di `edisi`.
 */
export function kelompokkanKejadianResmi<T extends BarisEdisiResmi>(
  baris: T[],
  uidMap: Map<string, string>,
): KelompokKejadianResmi<T>[] {
  const grup = new Map<string, T[]>();
  for (const r of baris) {
    const kunci = `${kunciFisik(r, uidMap)}|${r.market}|${r.line ?? ""}|${r.selection}`;
    const arr = grup.get(kunci);
    if (arr) arr.push(r);
    else grup.set(kunci, [r]);
  }
  const out: KelompokKejadianResmi<T>[] = [];
  for (const anggota of grup.values()) {
    const urut = [...anggota].sort(
      (a, b) =>
        (a.published_at_utc ?? "").localeCompare(b.published_at_utc ?? "") ||
        a.id - b.id,
    );
    const angkaBerbeda = new Set(
      urut
        .map((b) => b.published_prob)
        .filter((v): v is number => v !== null),
    );
    const konflik: KonflikPilihan | null =
      angkaBerbeda.size > 1
        ? {
            nilai: urut
              .filter((b) => b.published_prob !== null)
              .map((b) => ({
                published_prob: b.published_prob as number,
                match_id: b.match_id,
                pick_uid: b.pick_uid,
                package_id: b.package_id,
                published_at_utc: b.published_at_utc,
              })),
          }
        : null;
    out.push({ perwakilan: urut[0], edisi: urut, konflik });
  }
  return out;
}

/**
 * Pilihan resmi pra-laga untuk builder: diterbitkan jalur K2 (pick_uid
 * terisi), peluang terbit tercatat, sepak mula masih di masa depan.
 * Pengelompokan memakai aturan bersama `kelompokkanKejadianResmi`:
 * kejadian berkonflik ditahan dari kombinasi.
 */
export function daftarPilihanPraLaga(nowUtc: string): PilihanPraLaga[] {
  const d = dbRo("picks.db");
  if (!d || !kolomAda(d, "picks", "pick_uid")) return [];
  const rows = d
    .prepare(
      `SELECT * FROM picks
       WHERE source = ? AND pick_uid IS NOT NULL AND published_prob IS NOT NULL
         AND kickoff_utc > ?
       ORDER BY kickoff_utc ASC, grade ASC, published_prob DESC`,
    )
    .all(SERI_PRODUKSI, nowUtc) as unknown as (RekamRowDb & { pick_uid: string })[];
  muatNamaPaketBatch(rows.map((r) => r.package_id));
  const uidMap = petaUidFisik(
    rows.filter((r) => !r.fixture_uid).map((r) => r.match_id),
  );

  const out: PilihanPraLaga[] = [];
  for (const g of kelompokkanKejadianResmi(rows, uidMap)) {
    const r = g.perwakilan;
    const konflik = g.konflik;
    const nama = namaDariPaket(r.package_id);
    const sources = [r.model_prob, r.market_prob, r.sm_prob].filter(
      (v) => v !== null && v !== undefined,
    ).length;
    out.push({
      pick_uid: r.pick_uid,
      match_id: r.match_id,
      fixture_uid: kunciFisik(r, uidMap),
      kickoff_utc: r.kickoff_utc,
      home: nama?.home ?? "?",
      away: nama?.away ?? "?",
      competition_name: nama?.competition_name ?? "",
      gate_status: r.gate_status ?? "uncalibrated",
      grade: r.grade ?? "C",
      market: r.market,
      selection: r.selection,
      line: r.line ?? "",
      published_prob: r.published_prob as number,
      probability_basis: r.probability_basis,
      published_at_utc: r.published_at_utc,
      model_prob: r.model_prob,
      sources_agree: sources,
      package_id: r.package_id,
      konflik,
    });
  }
  return out;
}

/* ------------------------------------- tab rekam hasil (redesain §3E) */

/** Satu laga fisik pada tab "Sudah dinilai" beserta pilihan-pilihannya. */
export interface KelompokLagaRekam {
  /** Kunci laga fisik (fixture_uid bila ada, jika tidak match_id). */
  kunci: string;
  /** match_id perwakilan untuk tautan detail (baris pertama kelompok). */
  match_id: string;
  fixture_uid: string | null;
  home: string;
  away: string;
  competition_name: string;
  kickoff_utc: string;
  home_goals: number | null;
  away_goals: number | null;
  baris: BarisRekam[];
}

export interface TabRekamData {
  /** Pilihan tepat/meleset, dikelompokkan per laga fisik. */
  dinilai: KelompokLagaRekam[];
  /** Lewat waktu tetapi belum dinilai: menunggu jendela + jatuh tempo. */
  menungguLewat: BarisRekam[];
  /** Belum mulai — dipisah dari yang lewat waktu (brief §3E.3). */
  menungguMendatang: BarisRekam[];
  /** Pilihan batal. */
  batal: BarisRekam[];
  /**
   * Terminal tanpa feed hasil (PR 2): ditampilkan sebagai bagian
   * tersendiri di panel Menunggu, TIDAK dihitung sebagai menunggu —
   * hasilnya tidak akan pernah masuk.
   */
  takDinilai: BarisRekam[];
  /** Hitungan baris per tab (untuk label tab + keadaan kosong). */
  hitungan: { dinilai: number; menunggu: number; batal: number; tak_dinilai: number };
}

/**
 * Bagi baris rekam ke tiga tab brief §3E. Murni atas `keadaan` yang
 * sudah dihitung `keadaanPilihan` — fungsi ini tidak menilai ulang dan
 * tidak menyentuh statistik cohort: tab hanya mengatur DAFTAR, jadi
 * mengganti tab tidak pernah mengubah pembilang/penyebut ringkasan.
 * Baris masuk sudah terurut kickoff terbaru dulu (dari `ambilRekam`);
 * kelompok "dinilai" mempertahankan urutan itu (laga paling baru
 * dengan skor final terverifikasi di depan).
 */
export function kelompokkanTabRekam(baris: BarisRekam[]): TabRekamData {
  const peta = new Map<string, KelompokLagaRekam>();
  const menungguLewat: BarisRekam[] = [];
  const menungguMendatang: BarisRekam[] = [];
  const batal: BarisRekam[] = [];
  const takDinilai: BarisRekam[] = [];
  let nDinilai = 0;
  for (const b of baris) {
    if (b.keadaan === "tepat" || b.keadaan === "meleset") {
      nDinilai++;
      const kunci = b.fixture_uid ?? b.match_id;
      let k = peta.get(kunci);
      if (!k) {
        k = {
          kunci,
          match_id: b.match_id,
          fixture_uid: b.fixture_uid,
          home: b.home,
          away: b.away,
          competition_name: b.competition_name,
          kickoff_utc: b.kickoff_utc,
          home_goals: b.home_goals,
          away_goals: b.away_goals,
          baris: [],
        };
        peta.set(kunci, k);
      }
      if (k.home_goals === null && b.home_goals !== null) {
        k.home_goals = b.home_goals;
        k.away_goals = b.away_goals;
      }
      k.baris.push(b);
    } else if (b.keadaan === "batal") {
      batal.push(b);
    } else if (b.keadaan === "belum-mulai") {
      menungguMendatang.push(b);
    } else if (b.keadaan === "tidak-dapat-dinilai") {
      takDinilai.push(b);
    } else {
      menungguLewat.push(b);
    }
  }
  return {
    dinilai: [...peta.values()],
    menungguLewat,
    menungguMendatang,
    batal,
    takDinilai,
    hitungan: {
      dinilai: nDinilai,
      menunggu: menungguLewat.length + menungguMendatang.length,
      batal: batal.length,
      tak_dinilai: takDinilai.length,
    },
  };
}

export interface KalimatRingkasan {
  /**
   * Kalimat utama "Ringkasan periode" (brief §3E.2): ketepatan atas
   * yang sudah dinilai — atau keterangan kosong §5 bila belum ada
   * satu pun yang dinilai. Akurasi 0% hanya muncul bila ada pilihan
   * dinilai dan semuanya meleset (hit_ratio cohort memang null pada
   * settled = 0, jadi 0% palsu tidak pernah tercetak).
   */
  utama: string;
  /**
   * Kalimat cakupan persis di bawah kalimat utama: penyebutnya SEMUA
   * pilihan yang sudah waktunya dinilai (due cohort). Null bila belum
   * ada yang jatuh tempo sama sekali.
   */
  cakupan: string | null;
  /** Total pilihan menunggu (belum mulai + jendela + jatuh tempo). */
  menunggu: number;
}

/** Susun dua kalimat "Ringkasan periode" dari statistik cohort apa adanya. */
export function kalimatRingkasan(s: CohortStats, lagaDinilaiUnik: number): KalimatRingkasan {
  const menunggu = s.not_started + s.awaiting_window + s.overdue_pending;
  const utama =
    s.settled > 0 && s.hit_ratio !== null
      ? `${int(s.hits)} dari ${int(s.settled)} pilihan tepat (${pct(s.hit_ratio)}) di ${int(lagaDinilaiUnik)} laga`
      : "Belum ada pilihan yang sudah dinilai untuk periode ini.";
  const cakupan =
    s.due > 0 && s.coverage_ratio !== null
      ? `Dari ${int(s.due)} pilihan yang sudah waktunya dinilai, ${int(s.settled)} sudah memiliki hasil (${pct(s.coverage_ratio)}).`
      : null;
  return { utama, cakupan, menunggu };
}

/**
 * Pembulatan TAMPILAN untuk rata-rata ringkasan: statistiknya tetap
 * angka cohort apa adanya; sebelum diformat satu desimal, rata-rata
 * dibulatkan ke 4 desimal supaya contoh terdokumentasi PRD
 * (rata-rata 0,7125 → "71,3%") tidak jatuh ke "71,2%" karena sisa
 * biner floating point pada digit ke-16.
 */
export function bulatkanTampil(x: number | null): number | null {
  if (x === null || x === undefined || !Number.isFinite(x)) return null;
  return Math.round(x * 10_000) / 10_000;
}

/* --------------------------------------- waktu refresh data terakhir */

/**
 * Marker refresh bebas terakhir yang selesai SUKSES (B2.2a), ditulis
 * `scripts/free-refresh.ts` ke `analysis_snapshots.db.meta` sesudah
 * langkah data terakhirnya berhasil.
 *
 * Jalur baca KHUSUS render: koneksi read-only (`dbRo`, menghormati
 * `DB_DIR`), SATU SELECT berdasarkan key, TANPA memastikan skema dan
 * tanpa menulis apa pun (getter store writer `getPackageStoreMeta`
 * memastikan skema — sengaja tidak dipakai di sini). DB/tabel absen,
 * key hilang, nilai tidak terbaca sebagai timestamp, atau cap di masa
 * depan terhadap `nowUtc` → null; pemanggil menampilkan "Waktu
 * pembaruan belum tersedia". Waktu yang dikembalikan HANYA dari
 * marker — bukan jam buka halaman, mtime berkas, tanggal ingest, atau
 * MAX(published_at_utc).
 */
export function ambilWaktuRefreshTerakhir(nowUtc: string): string | null {
  const d = dbRo("analysis_snapshots.db");
  if (!d) return null;
  try {
    if (!tabelAda(d, "meta")) return null;
    const row = d
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get(FREE_REFRESH_LAST_SUCCESS_KEY) as { value: string } | undefined;
    if (!row || typeof row.value !== "string") return null;
    const ms = Date.parse(row.value);
    if (!Number.isFinite(ms)) return null;
    const nowMs = Date.parse(nowUtc);
    if (Number.isFinite(nowMs) && ms > nowMs) return null;
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

/* ------------------------------------- keputusan tiket harian Fix-4 */

/**
 * Status kartu "Keputusan tiket hari ini" (B2.1) — selalu untuk tanggal
 * WIB dari `nowUtc`, TIDAK pernah digeser filter zona halaman:
 * - `menunggu`         belum ada baris keputusan dan cutoff belum tiba;
 * - `belum-tersedia`   belum ada baris keputusan dan cutoff sudah lewat;
 * - `abstain`          baris ABSTAIN tercatat (baris selalu menang atas jam);
 * - `terbit`           baris PUBLISHED dengan tiket + tepat
 *                      FIX4_TICKET_SIZE pilihan utuh;
 * - `tercatat-tak-utuh` baris PUBLISHED tercatat tetapi tiket/pilihannya
 *                      tidak utuh — detail tidak dikarang;
 * - `data-belum-ada`   picks.db atau tabel Fix-4 belum tersedia.
 */
export type StatusKeputusanFix4 =
  | "menunggu"
  | "belum-tersedia"
  | "abstain"
  | "terbit"
  | "tercatat-tak-utuh"
  | "data-belum-ada";

export interface PilihanKeputusanFix4 {
  position: number;
  pick_id: number;
  match_id: string;
  market: string;
  selection: string;
  /** published_prob BEKU dari fix4_ticket_legs — bukan angka picks kini. */
  published_prob: number;
  /** Nama laga dari paket penerbit pick; null bila paket/nama tak ada. */
  home: string | null;
  away: string | null;
  competition_name: string | null;
  /**
   * Label pilihan yang jujur: `labelPilihan` dengan nama tim bila nama
   * tersedia; label pasar + seleksi mentah bila tidak (tidak dikarang).
   */
  label: string;
  /** Tautan detail laga (pola yang sama dengan baris rekam lain). */
  href_detail: string;
}

export interface KeputusanFix4HariIni {
  /** Tanggal keputusan dalam WIB (YYYY-MM-DD) — tanggal kartu ini. */
  date_wib: string;
  status: StatusKeputusanFix4;
  /** Ukuran tiket dari kebijakan (untuk copy "dari N yang dibutuhkan"). */
  ukuran_tiket: number;
  /** Cutoff kebijakan tanggal ini (ISO UTC) — label UI "Batas penilaian". */
  batas_penilaian_utc: string;
  /** created_utc baris keputusan; null bila belum ada baris. */
  dicatat_utc: string | null;
  /** Kandidat layak dari baris keputusan; null bila belum ada baris. */
  eligible_count: number | null;
  ticket_uid: string | null;
  /** expected_hit_prob beku tiket; hanya terisi pada status `terbit`. */
  expected_hit_prob: number | null;
  /** Pilihan beku urut position; hanya terisi pada status `terbit`. */
  pilihan: PilihanKeputusanFix4[];
}

function tabelAda(d: Db, nama: string): boolean {
  try {
    return d.prepare(`PRAGMA table_info(${nama})`).all().length > 0;
  } catch {
    return false;
  }
}

/**
 * Proyeksi read-only keputusan Fix-4 untuk SATU tanggal WIB (hari ini
 * menurut `nowUtc`). SELECT dibatasi satu tanggal + satu tiket; skema
 * TIDAK dibuat dan tidak ada penulisan dari jalur web ini (pembaca
 * internal `readDecision` di fix4-tickets.ts memanggil ensureFix4Schema
 * lewat jalur generatornya — kartu ini sengaja tidak memakainya).
 * DB/tabel absen adalah keadaan data, bukan error: status
 * `data-belum-ada` dan halaman tetap berfungsi.
 */
export function ambilKeputusanFix4HariIni(nowUtc: string): KeputusanFix4HariIni {
  const date_wib = fix4DateWibOf(nowUtc);
  const w = fix4WindowForDate(date_wib);
  const dasar: KeputusanFix4HariIni = {
    date_wib,
    status: "data-belum-ada",
    ukuran_tiket: FIX4_TICKET_SIZE,
    batas_penilaian_utc: w.decision_ts_utc,
    dicatat_utc: null,
    eligible_count: null,
    ticket_uid: null,
    expected_hit_prob: null,
    pilihan: [],
  };
  const d = dbRo("picks.db");
  if (!d) return dasar;
  try {
    if (!tabelAda(d, "fix4_daily_decisions")) return dasar;
    const row = d
      .prepare(
        `SELECT status, decision_ts, eligible_count, ticket_uid, created_utc
         FROM fix4_daily_decisions WHERE date_wib = ?`,
      )
      .get(date_wib) as
      | {
          status: string;
          decision_ts: string;
          eligible_count: number;
          ticket_uid: string | null;
          created_utc: string;
        }
      | undefined;
    if (!row) {
      return {
        ...dasar,
        status:
          Date.parse(nowUtc) < Date.parse(w.decision_ts_utc)
            ? "menunggu"
            : "belum-tersedia",
      };
    }
    const tercatat: KeputusanFix4HariIni = {
      ...dasar,
      status: "tercatat-tak-utuh",
      batas_penilaian_utc: row.decision_ts,
      dicatat_utc: row.created_utc,
      eligible_count: row.eligible_count,
      ticket_uid: row.ticket_uid,
    };
    if (row.status === "ABSTAIN") return { ...tercatat, status: "abstain" };
    if (row.status !== "PUBLISHED") return tercatat;
    if (
      !row.ticket_uid ||
      !tabelAda(d, "fix4_tickets") ||
      !tabelAda(d, "fix4_ticket_legs")
    ) {
      return tercatat;
    }
    const tiket = d
      .prepare("SELECT expected_hit_prob FROM fix4_tickets WHERE ticket_uid = ?")
      .get(row.ticket_uid) as { expected_hit_prob: number } | undefined;
    if (!tiket) return tercatat;
    const legs = d
      .prepare(
        `SELECT position, pick_id, match_id, market, selection, published_prob
         FROM fix4_ticket_legs WHERE ticket_uid = ? ORDER BY position ASC`,
      )
      .all(row.ticket_uid) as unknown as {
      position: number;
      pick_id: number;
      match_id: string;
      market: string;
      selection: string;
      published_prob: number;
    }[];
    if (legs.length !== FIX4_TICKET_SIZE) return tercatat;

    /* Nama laga lewat package_id pick penerbit (batch, maks 4 id). */
    const pkgByPick = new Map<number, number | null>();
    if (kolomAda(d, "picks", "package_id")) {
      const ids = legs.map((l) => l.pick_id);
      const rows = d
        .prepare(
          `SELECT id, package_id FROM picks WHERE id IN (${ids.map(() => "?").join(",")})`,
        )
        .all(...(ids as never[])) as unknown as {
        id: number;
        package_id: number | null;
      }[];
      for (const r of rows) pkgByPick.set(r.id, r.package_id);
    }
    muatNamaPaketBatch(legs.map((l) => pkgByPick.get(l.pick_id) ?? null));
    const pilihan: PilihanKeputusanFix4[] = legs.map((l) => {
      const nama = namaDariPaket(pkgByPick.get(l.pick_id) ?? null);
      return {
        position: l.position,
        pick_id: l.pick_id,
        match_id: l.match_id,
        market: l.market,
        selection: l.selection,
        published_prob: l.published_prob,
        home: nama?.home ?? null,
        away: nama?.away ?? null,
        competition_name: nama?.competition_name ?? null,
        label: nama
          ? labelPilihan(l.market, l.selection, nama.home, nama.away)
          : `${MARKET_LABEL[l.market] ?? l.market} · ${l.selection}`,
        href_detail: `/pertandingan/${l.match_id}`,
      };
    });
    return {
      ...tercatat,
      status: "terbit",
      expected_hit_prob: tiket.expected_hit_prob,
      pilihan,
    };
  } catch {
    return dasar;
  }
}
