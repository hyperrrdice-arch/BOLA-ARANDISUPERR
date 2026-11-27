/**
 * ML1-PIT B — jalur shadow ML1-B dengan BUKTI KETERSEDIAAN FITUR sebelum
 * keputusan (Brief ML1-PIT B). PIT A mengamankan edisi paket champion,
 * waktu pencatatan, dan UID laga; PIT B menutup celah berikutnya: fitur
 * (form/Elo/shots/rest) tidak lagi dibaca dari keadaan store TERKINI
 * sesudah keputusan, melainkan dari snapshot read-only yang DIPIN sebelum
 * `decision_at_utc` diambil — untuk tiga store sekaligus
 * (analysis_snapshots, thestats_dataset, upcoming_fixtures).
 *
 * Alur satu batch (satu keputusan):
 *  1. PIN: transaksi baca dibuka pada ketiga store dan snapshot SQLite
 *     ditetapkan lewat pembacaan tabel SUNGGUHAN (BEGIN/SELECT 1 tidak
 *     mem-pin apa pun). `snapshot_pinned_at_utc` dicatat per store dari
 *     clock yang sama. Byte registry tim + file tautan yang benar-benar
 *     akan dipakai dibaca pada jendela ini dan di-hash (registry di-parse
 *     dari byte itu sendiri — bukan dari cache modul team-identity, yang
 *     bisa berbeda dari file di disk).
 *  2. DECISION: `decision_at_utc` dibaca dari clock SESUDAH seluruh pin;
 *     semua pin wajib <= decision. Seleksi paket as-of, persiapan kandidat
 *     (identitas + pemenang + eligibility pra-limit), pemuatan input
 *     fitur, dan resolusi kunci tim berjalan DI DALAM transaksi terpin.
 *  3. PROYEKSI: input extractor yang lolos saringan ketersediaan (§3
 *     brief) dibekukan sebagai SATU proyeksi kompak deterministik per
 *     batch (JSONL → gzip, nama file = hash isi). File ditulis ATOMIK
 *     (staging + rename) SEBELUM baris mana pun mengacu padanya;
 *     `feature_snapshot_id` = SHA-256 isi JSONL. Transaksi baca dilepas
 *     sebelum konstruksi fitur berat dan inferensi Python.
 *  4. FITUR + INFERENSI: extractor dibangun dari proyeksi (fungsi yang
 *     sama persis dengan jalur replay), vektor 32 kolom dihitung dan
 *     di-hash per fixture.
 *  5. REVALIDASI + TULIS: status/UID/kickoff dicek ulang dengan bacaan
 *     BARU (bacaan baru hanya untuk skip; fitur tetap dari cutoff awal),
 *     lalu baris ditulis ke DB shadow `ml1_prospective_pit_b.db` dengan
 *     disiplin jam yang sama dengan PIT A (issued per baris sesudah lock,
 *     cek clock akhir sebelum commit). Status bukti input
 *     `snapshot_visible` disimpan TERPISAH dari status grading.
 *
 * SARINGAN KETERSEDIAAN (§3 brief) atas snapshot terpin:
 *  - Hasil: `finished` + skor valid; instant kickoff wajib mendahului
 *    keputusan; fixture target + seluruh aliasnya dikeluarkan dari
 *    histori; observasi eksplisit (`matches.available_at`) sesudah
 *    cutoff → dikeluarkan + dihitung sebagai konflik. Row lama bercap
 *    versi kosong (available_at NULL) yang terlihat di snapshot TETAP
 *    eligible untuk keputusan ini — itulah makna bukti `snapshot_visible`.
 *  - Shots: versi telemetry di snapshot; event time terpercaya → instant
 *    sebelum keputusan; row tanggal-saja → tanggal < tanggal keputusan
 *    UTC (tanggal sama = dikeluarkan, dihitung sebagai kehilangan
 *    coverage akibat presisi tanggal). Empat metrik + missing flags
 *    dipertahankan apa adanya untuk extractor.
 *  - Elo dibangun extractor dari hasil eligible yang terurut instant
 *    kickoff + tie-break ID stabil, atas SELURUH universe kompetisi
 *    (bukan hanya dua tim target); fixture yang timnya tidak punya
 *    riwayat di kompetisinya dihitung sebagai fallback Elo awal.
 *  - Form/shots/rest: extractor tetap menerapkan cutoff TANGGAL KICKOFF
 *    TARGET seperti sebelumnya, sesudah saringan ketersediaan lolos.
 *
 * REPLAY: `replayPitBProjectionFile()` membaca artefak terarsip,
 * memverifikasi hash isinya, dan mereproduksi vektor identik dari
 * proyeksi + input target beku — tanpa menyentuh store live. Proyeksi
 * rusak/hilang/berubah → gagal eksplisit; tidak ada status bukti valid
 * dari input rusak.
 *
 * ISOLASI: store masukan dibuka read-only oleh pemanggil dan tidak pernah
 * ditulis; DB pilot dan DB PIT A tidak disentuh. Mode ini shadow-only:
 * tanpa cron, tanpa grading, tanpa aktivasi produksi.
 *
 * PERBAIKAN BUKTI v2 (Brief Kohor §2, eval_version ml1-pit-b-v2):
 *  - §2A byte registry tim + fixture-links dibaca/dibekukan SEBELUM jam
 *    keputusan; waktu capture + hash tercatat di manifest snapshot.
 *  - §2B urutan shots dinormalisasi satu kali (comparePitBShotRows) dan
 *    dipakai serializer + komputasi + replay — seri di batas window
 *    tidak lagi mengubah subset antara issue dan replay.
 *  - §2C verifyPitBArtifacts() memverifikasi arsip terhadap manifest
 *    tercatat per proyeksi unik.
 *  - §2D fallback skema legacy memakai alias tunggal; ketiga transaksi
 *    baca dilepas sesudah materialisasi, sebelum serialisasi/kompresi.
 */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { matrixProbs, type EvalMatchRow } from "./chronological-evaluator";
import {
  Ml1FeatureExtractor,
  ML1_B_FEATURE_NAMES,
  type Ml1CanonicalLogRow,
} from "./ml1-features";
import {
  beginPinnedRead,
  checkPitEligibility,
  endPinnedRead,
  parseInstant,
  preparePitCandidates,
  selectPackagesAsOf,
  sha256Utf8,
  validateInferenceResults,
  type PitAClock,
  type PitAExecutorResult,
  type PitAInferenceExecutor,
  type PitPreparedFixture,
} from "./ml1-pit-a";
import {
  loadFixtureLinkGroups,
  parseFixtureLinks,
  type FixtureLinkGroup,
} from "../identity/fixture-resolver";
import type { CanonicalTeam } from "../quant/team-identity";

/**
 * Versi bukti AKTIF untuk baris baru. v2 menutup celah bukti Brief Kohor
 * §2: registry/link dibekukan SEBELUM jam keputusan (capture tercatat di
 * manifest) dan urutan input dinormalisasi satu kali untuk issue+replay.
 * Baris v1 yang sudah terlanjur tersimpan TIDAK otomatis memperoleh
 * status strict v2 — mereka tetap diagnostik.
 */
export const PIT_B_EVAL_VERSION = "ml1-pit-b-v2";
/** Versi bukti lama — diterima parser proyeksi untuk replay diagnostik. */
export const PIT_B_EVAL_VERSION_V1 = "ml1-pit-b-v1";
export const PIT_B_HORIZON_ID = "slate_pre_match";
export const PIT_B_DATA_STATUS = "PIT_B_STAGED";
export const PIT_B_FEATURE_TIME_STATUS = "snapshot_visible";
export const PIT_B_INPUT_EVIDENCE_STATUS = "snapshot_visible";
export const PIT_B_PROJECTION_SCHEMA_VERSION = 1;
/** Versi kode fitur beku yang menghasilkan vektor dari proyeksi. */
export const PIT_B_FEATURE_CODE_VERSION = "pit-b-feature-code-v2";
/** Versi runner inferensi (kontrak scripts/ml1-predict.py jalur PIT). */
export const PIT_B_RUNNER_VERSION = "ml1-predict.py:pit-v1";

// ============================================================================
// Registry tim dari BYTE yang dibaca (bukan cache modul)
// ============================================================================
export interface PitBTeamRegistry {
  present: boolean;
  sha256: string;
  teams: CanonicalTeam[];
  byMemberId: Map<string, string>;
  byName: Map<string, string>;
}

const sha256Buffer = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

/**
 * Baca + parse `team-canonical.json` dari direktori data statis. Hash
 * dihitung dari byte yang benar-benar di-parse di sini, sehingga hash
 * yang tercatat selalu cocok dengan pemetaan yang dipakai resolusi kunci
 * tim — perubahan file di tengah run tidak mengubah fitur batch ini.
 * File tidak ada → registry kosong (semua kunci jatuh ke id sumber,
 * perilaku fallback yang sama dengan jalur lama). File ada tetapi JSON
 * rusak → GAGAL eksplisit (sumber wajib tidak terbaca).
 */
export function readPitBTeamRegistry(dataDirPath: string): PitBTeamRegistry {
  const p = path.join(dataDirPath, "team-canonical.json");
  let bytes: Buffer | null = null;
  try {
    bytes = fs.readFileSync(p);
  } catch {
    bytes = null;
  }
  if (bytes === null) {
    return {
      present: false,
      sha256: sha256Buffer(Buffer.alloc(0)),
      teams: [],
      byMemberId: new Map(),
      byName: new Map(),
    };
  }
  let parsed: { teams?: unknown };
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as { teams?: unknown };
  } catch (err) {
    throw new Error(
      `ML1-PIT-B: registry tim tidak terbaca (JSON rusak) di ${p}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const teams = (Array.isArray(parsed.teams) ? parsed.teams : []) as CanonicalTeam[];
  const byMemberId = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const t of teams) {
    for (const m of t.members ?? []) byMemberId.set(m.team_id, t.canonical_id);
    if (!byName.has(t.name)) byName.set(t.name, t.canonical_id);
    for (const a of t.aliases ?? []) if (!byName.has(a)) byName.set(a, t.canonical_id);
  }
  return { present: true, sha256: sha256Buffer(bytes), teams, byMemberId, byName };
}

/** Resolusi kunci tim — semantik IDENTIK resolveTeamKey() jalur pilot/PIT A. */
export function resolveTeamKeyPitB(reg: PitBTeamRegistry, sourceId: string, name: string): string {
  const canon = reg.byMemberId.get(sourceId) ?? reg.byName.get(name) ?? null;
  if (canon) {
    const team = reg.teams.find((t) => t.canonical_id === canon);
    const th = team?.members.find((m) => m.system === "thestats");
    if (th) return th.team_id;
  }
  return sourceId;
}

export interface PitBLinksInfo {
  present: boolean;
  sha256: string;
  groups: FixtureLinkGroup[];
}

/** Baca byte fixture-links.json sekali; hash + grup berasal dari byte yang sama. */
export function readPitBLinks(dataDirPath: string): PitBLinksInfo {
  const p = path.join(dataDirPath, "fixture-links.json");
  let bytes: Buffer | null = null;
  try {
    bytes = fs.readFileSync(p);
  } catch {
    bytes = null;
  }
  if (bytes === null) {
    return { present: false, sha256: sha256Buffer(Buffer.alloc(0)), groups: [] };
  }
  return {
    present: true,
    sha256: sha256Buffer(bytes),
    groups: parseFixtureLinks(bytes.toString("utf8")).groups,
  };
}

// ============================================================================
// Proyeksi batch — bentuk data, serialisasi deterministik, replay
// ============================================================================
export interface PitBResultRow {
  match_id: string;
  competition_id: string;
  utc_date: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  season: string | null;
}

export interface PitBShotRow {
  log_id: string | null;
  team_id: string;
  match_date: string;
  shots_for: number | null;
  shots_against: number | null;
  shots_on_target_for: number | null;
  shots_on_target_against: number | null;
  source: string | null;
}

export interface PitBFixtureInput {
  fixture_uid: string;
  source_match_id: string;
  kickoff_utc: string;
  competition_id: string | null;
  home_team_key: string;
  away_team_key: string;
  home_team_id: string;
  away_team_id: string;
  home_name: string | null;
  away_name: string | null;
  slice: string;
  registry_status: string | null;
}

export interface PitBPackageInfo {
  fixture_uid: string;
  package_id: number;
  package_computed_utc: string;
  package_payload_sha256: string;
  champion_ratings_marker: string | null;
  champ_lam: number;
  champ_mu: number;
  champ_p_h: number;
  champ_p_d: number;
  champ_p_a: number;
}

export interface PitBVisibilityCounts {
  results_in_snapshot: number;
  results_projected: number;
  results_excluded_target_component: number;
  results_excluded_event_not_before_decision: number;
  results_excluded_observation_after_cutoff: number;
  results_excluded_invalid_time: number;
  shots_in_snapshot: number;
  shots_projected: number;
  shots_excluded_date_precision: number;
  shots_excluded_event_not_before_decision: number;
  shots_excluded_invalid_time: number;
}

export interface PitBProjectionMeta {
  kind: "meta";
  schema_version: number;
  eval_version: string;
  horizon_id: string;
  decision_at_utc: string;
  cutoff_utc: string;
  snapshot_pinned_at_utc: { snapshots: string; dataset: string; upcoming: string };
  feature_code_version: string;
  runner_version: string;
  registry_team_canonical_sha256: string;
  registry_team_canonical_present: boolean;
  registry_fixture_links_sha256: string;
  registry_fixture_links_present: boolean;
  /**
   * Waktu baca SELESAI untuk byte registry/link yang dibekukan (Brief
   * Kohor §2A). Keduanya wajib <= decision_at_utc: byte ditangkap sebelum
   * jam keputusan diambil. Absen pada proyeksi v1 (diagnostik).
   */
  registry_captured_at_utc?: { team_canonical: string; fixture_links: string };
  counts: PitBVisibilityCounts & { fixtures: number; packages: number };
}

export interface PitBProjection {
  meta: PitBProjectionMeta;
  results: PitBResultRow[];
  shots: PitBShotRow[];
  fixtures: PitBFixtureInput[];
  packages: PitBPackageInfo[];
}

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const cmpNumNull = (a: number | null, b: number | null): number => {
  const x = a === null || a === undefined ? Number.NEGATIVE_INFINITY : a;
  const y = b === null || b === undefined ? Number.NEGATIVE_INFINITY : b;
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * Urutan shots KANONIK — dinormalisasi SATU kali dan dipakai serializer,
 * komputasi live, dan replay (Brief Kohor §2B). Tie-break total atas
 * kolom proyeksi: tim, tanggal, log_id (NULL sesudah non-NULL), source,
 * lalu keempat metrik — sehingga dua baris yang seri di batas window-10
 * selalu masuk/keluar window dengan cara yang sama di semua jalur.
 * Tanpa ini, urutan sisip SQLite yang berbeda mengubah subset window
 * (kasus audit: shots_for_home 6,8 saat issue vs 16,6 saat replay).
 */
export function comparePitBShotRows(a: PitBShotRow, b: PitBShotRow): number {
  return (
    cmpStr(a.team_id, b.team_id) ||
    cmpStr(a.match_date, b.match_date) ||
    (a.log_id === null || a.log_id === undefined ? 1 : 0) - (b.log_id === null || b.log_id === undefined ? 1 : 0) ||
    cmpStr(a.log_id ?? "", b.log_id ?? "") ||
    cmpStr(a.source ?? "", b.source ?? "") ||
    cmpNumNull(a.shots_for, b.shots_for) ||
    cmpNumNull(a.shots_against, b.shots_against) ||
    cmpNumNull(a.shots_on_target_for, b.shots_on_target_for) ||
    cmpNumNull(a.shots_on_target_against, b.shots_on_target_against)
  );
}

/**
 * Serialisasi JSONL deterministik: meta dulu, lalu hasil terurut
 * (kompetisi, utc_date, match_id), shots terurut (tim, tanggal, log_id),
 * fixture + paket terurut UID. Urutan kunci objek tetap mengikuti
 * konstruksi literal di sini — hash isi stabil untuk isi yang sama.
 */
export function serializePitBProjection(proj: PitBProjection): string {
  const lines: string[] = [JSON.stringify(proj.meta)];
  const results = [...proj.results].sort(
    (x, y) => cmpStr(x.competition_id, y.competition_id) || cmpStr(x.utc_date, y.utc_date) || cmpStr(x.match_id, y.match_id),
  );
  for (const r of results) lines.push(JSON.stringify({ kind: "result", ...r }));
  const shots = [...proj.shots].sort(comparePitBShotRows);
  for (const s of shots) lines.push(JSON.stringify({ kind: "shot", ...s }));
  const fixtures = [...proj.fixtures].sort((x, y) => cmpStr(x.fixture_uid, y.fixture_uid));
  for (const f of fixtures) lines.push(JSON.stringify({ kind: "fixture", ...f }));
  const packages = [...proj.packages].sort((x, y) => cmpStr(x.fixture_uid, y.fixture_uid));
  for (const p of packages) lines.push(JSON.stringify({ kind: "package", ...p }));
  return lines.join("\n") + "\n";
}

/** Parse + validasi proyeksi dari isi JSONL-nya; gagal eksplisit bila rusak. */
export function parsePitBProjection(jsonl: string): PitBProjection {
  const lines = jsonl.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error("ML1-PIT-B: proyeksi kosong — tidak ada baris meta.");
  let meta: PitBProjectionMeta;
  try {
    meta = JSON.parse(lines[0]) as PitBProjectionMeta;
  } catch {
    throw new Error("ML1-PIT-B: baris meta proyeksi bukan JSON valid.");
  }
  if (meta.kind !== "meta" || meta.schema_version !== PIT_B_PROJECTION_SCHEMA_VERSION) {
    throw new Error(
      `ML1-PIT-B: versi skema proyeksi tidak didukung (meta.schema_version=${String(meta.schema_version)}).`,
    );
  }
  if (meta.eval_version !== PIT_B_EVAL_VERSION && meta.eval_version !== PIT_B_EVAL_VERSION_V1) {
    throw new Error(`ML1-PIT-B: eval_version proyeksi tidak cocok (${String(meta.eval_version)}).`);
  }
  const proj: PitBProjection = { meta, results: [], shots: [], fixtures: [], packages: [] };
  for (const line of lines.slice(1)) {
    let row: { kind?: unknown } & Record<string, unknown>;
    try {
      row = JSON.parse(line) as typeof row;
    } catch {
      throw new Error("ML1-PIT-B: baris proyeksi bukan JSON valid — artefak rusak.");
    }
    if (row.kind === "result") proj.results.push(row as unknown as PitBResultRow);
    else if (row.kind === "shot") proj.shots.push(row as unknown as PitBShotRow);
    else if (row.kind === "fixture") proj.fixtures.push(row as unknown as PitBFixtureInput);
    else if (row.kind === "package") proj.packages.push(row as unknown as PitBPackageInfo);
    else throw new Error(`ML1-PIT-B: kind baris proyeksi tidak dikenal (${String(row.kind)}).`);
  }
  return proj;
}

/** Input extractor yang dibangun dari proyeksi — dipakai run DAN replay. */
export function extractorInputsFromProjection(proj: PitBProjection): {
  universe: EvalMatchRow[];
  compAvg: EvalMatchRow[];
  seasonByMatchId: Map<string, string>;
  canonicalLogs: Ml1CanonicalLogRow[];
} {
  const toRow = (r: PitBResultRow): EvalMatchRow => ({
    match_id: r.match_id,
    competition_id: r.competition_id,
    utc_date: r.utc_date,
    home_team_id: r.home_team_id,
    away_team_id: r.away_team_id,
    home_score: r.home_score,
    away_score: r.away_score,
  });
  const compAvg = [...proj.results]
    .sort((x, y) => cmpStr(x.competition_id, y.competition_id) || cmpStr(x.utc_date, y.utc_date) || cmpStr(x.match_id, y.match_id))
    .map(toRow);
  // Universe Elo: per kompetisi terurut INSTANT kickoff + tie-break ID
  // stabil (brief §3) — untuk timestamp seragam urutan ini identik dengan
  // urutan query warisan (competition_id, utc_date).
  const instantOf = (s: string): number => {
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
  };
  const universe = proj.results
    .filter((r) => r.competition_id.startsWith("sm:"))
    .sort(
      (x, y) =>
        cmpStr(x.competition_id, y.competition_id) ||
        instantOf(x.utc_date) - instantOf(y.utc_date) ||
        cmpStr(x.match_id, y.match_id),
    )
    .map(toRow);
  const seasonByMatchId = new Map<string, string>();
  for (const r of proj.results) if (r.season) seasonByMatchId.set(r.match_id, r.season);
  // Log kanonik dinormalisasi dengan komparator yang sama persis dengan
  // serializer — urutan yang diterima extractor identik saat issue dan
  // replay, apa pun urutan sisip SQLite asalnya (Brief Kohor §2B).
  const canonicalLogs: Ml1CanonicalLogRow[] = [...proj.shots].sort(comparePitBShotRows).map((s) => ({
    team_id: s.team_id,
    match_date: s.match_date,
    shots_for: s.shots_for,
    shots_against: s.shots_against,
    shots_on_target_for: s.shots_on_target_for,
    shots_on_target_against: s.shots_on_target_against,
  }));
  return { universe, compAvg, seasonByMatchId, canonicalLogs };
}

/** Baris extractor untuk satu input fixture beku (orientasi apa adanya). */
export function pitBFixtureRow(f: PitBFixtureInput): EvalMatchRow {
  return {
    match_id: f.source_match_id,
    competition_id: f.competition_id ?? "",
    utc_date: f.kickoff_utc,
    home_team_id: f.home_team_key,
    away_team_id: f.away_team_key,
    home_score: 0,
    away_score: 0,
  };
}

/** Hash vektor fitur: SHA-256 representasi JSON kanonik 32 angka. */
export function featureVectorHash(vec: number[]): string {
  return sha256Utf8(JSON.stringify(vec));
}

export interface PitBFeatureComputation {
  vector: number[];
  hash: string;
}

/**
 * Hitung vektor ML1-B untuk semua fixture dalam proyeksi. SATU extractor
 * per batch atas input tersaring; fungsi yang sama dipakai run live dan
 * replay, jadi kesamaan vektor adalah kesamaan jalur kode, bukan harapan.
 */
export function computePitBFeatures(proj: PitBProjection): Map<string, PitBFeatureComputation> {
  const inputs = extractorInputsFromProjection(proj);
  const extractor = new Ml1FeatureExtractor(
    inputs.universe,
    inputs.compAvg,
    inputs.seasonByMatchId,
    inputs.canonicalLogs,
  );
  const out = new Map<string, PitBFeatureComputation>();
  for (const f of proj.fixtures) {
    const vector = extractor.prospectiveFeaturesB(pitBFixtureRow(f));
    if (vector.length !== ML1_B_FEATURE_NAMES.length) {
      throw new Error(`ML1-PIT-B: vektor fitur berukuran ${vector.length}, diharapkan ${ML1_B_FEATURE_NAMES.length}.`);
    }
    out.set(f.fixture_uid, { vector, hash: featureVectorHash(vector) });
  }
  return out;
}

export interface PitBReplayResult {
  feature_snapshot_id: string;
  meta: PitBProjectionMeta;
  vectors: Map<string, number[]>;
  vectorHashes: Map<string, string>;
}

/**
 * Replay dari artefak terarsip: baca file, dekompresi, verifikasi hash
 * isi (bila `expectedSha256` diberikan), parse, lalu hitung ulang vektor
 * dari proyeksi + input target beku. File hilang/rusak/hash berubah →
 * gagal eksplisit; tidak ada vektor dari input yang tidak terverifikasi.
 */
export function replayPitBProjectionFile(
  projectionPath: string,
  opts: { expectedSha256?: string } = {},
): PitBReplayResult {
  if (!fs.existsSync(projectionPath)) {
    throw new Error(`ML1-PIT-B: file proyeksi tidak ditemukan: ${projectionPath}`);
  }
  let raw: Buffer;
  try {
    raw = fs.readFileSync(projectionPath);
  } catch (err) {
    throw new Error(
      `ML1-PIT-B: file proyeksi tidak terbaca: ${projectionPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let jsonl: string;
  try {
    jsonl = gunzipSync(raw).toString("utf8");
  } catch {
    throw new Error(`ML1-PIT-B: file proyeksi rusak (gzip tidak terbaca): ${projectionPath}`);
  }
  const sha = sha256Utf8(jsonl);
  if (opts.expectedSha256 !== undefined && sha !== opts.expectedSha256) {
    throw new Error(
      `ML1-PIT-B: hash proyeksi tidak cocok — isi berubah sesudah dibekukan (aktual ${sha}, diharapkan ${opts.expectedSha256}).`,
    );
  }
  const proj = parsePitBProjection(jsonl);
  const feats = computePitBFeatures(proj);
  const vectors = new Map<string, number[]>();
  const vectorHashes = new Map<string, string>();
  for (const [uid, c] of feats) {
    vectors.set(uid, c.vector);
    vectorHashes.set(uid, c.hash);
  }
  return { feature_snapshot_id: sha, meta: proj.meta, vectors, vectorHashes };
}

export interface PitBArtifactRejection {
  fixture_uid: string;
  feature_snapshot_id: string;
  reason: string;
  /** Baris prediksi spesifik yang ditolak (revisi tindak lanjut §3.2). */
  prediction_id?: number;
}

export interface PitBArtifactVerification {
  snapshots_checked: number;
  snapshots_ok: number;
  rows_checked: number;
  rows_ok: number;
  /** UID yang lolos SEMUA cek dan ber-versi bukti aktif (strict). */
  strict_uids: string[];
  /**
   * ID baris prediksi yang lolos SEMUA cek ikatan bukti per baris
   * (termasuk hash ulang features_json tersimpan + nilai champion dari
   * proyeksi). Grader kohor memakai himpunan per baris ini, bukan UID.
   */
  strict_prediction_ids: number[];
  rejected: PitBArtifactRejection[];
  snapshot_errors: { feature_snapshot_id: string; reason: string }[];
}

interface PitBVerifyRow {
  id: number;
  eval_version: string;
  fixture_uid: string;
  source_match_id: string;
  kickoff_utc: string;
  home_team_key: string;
  away_team_key: string;
  decision_at_utc: string;
  package_id: number;
  package_computed_utc: string;
  package_payload_sha256: string;
  champion_ratings_marker: string | null;
  champ_lam: number;
  champ_mu: number;
  champ_p_h: number;
  champ_p_d: number;
  champ_p_a: number;
  feature_snapshot_id: string;
  features_sha256: string;
  features_json: string;
}

/**
 * VERIFIKASI ARTEFAK TERIKAT MANIFEST TERCATAT (Brief Kohor §2C).
 * Join predictions.feature_snapshot_id → feature_snapshots, lalu per
 * proyeksi UNIK (bukan per baris): baca arsip, dekompresi, verifikasi
 * SHA-256 JSONL terhadap `projection_sha256` tercatat, cocokkan meta
 * (cutoff, versi feature code/runner, hash registry) terhadap baris
 * manifest, dan bandingkan hash vektor replay per UID terhadap
 * `features_sha256` baris prediksi + identitas fixture/paket di
 * proyeksi. Gzip valid yang isinya diedit tetap ditolak karena hash isi
 * JSONL berubah. Baris ber-versi bukti lama tidak masuk strict walau
 * arsipnya valid — mereka diagnostik.
 *
 * Revisi tindak lanjut §3.2: verifikasi juga MENGIKAT isi baris prediksi
 * tersimpan ke bukti beku — waktu keputusan baris vs snapshot, waktu
 * hitung paket vs proyeksi, intensitas (λ/μ) + peluang champion vs paket
 * proyeksi, dan hash ulang `features_json` tersimpan terhadap hash
 * tersimpan + hash replay. Hasil per baris tersedia sebagai
 * `strict_prediction_ids`; mutasi satu field tersimpan pun ditolak.
 */
export function verifyPitBArtifacts(shadowDb: DatabaseSync, projectionDir: string): PitBArtifactVerification {
  const out: PitBArtifactVerification = {
    snapshots_checked: 0,
    snapshots_ok: 0,
    rows_checked: 0,
    rows_ok: 0,
    strict_uids: [],
    strict_prediction_ids: [],
    rejected: [],
    snapshot_errors: [],
  };
  const snaps = shadowDb.prepare("SELECT * FROM feature_snapshots").all() as unknown as Record<string, unknown>[];
  const snapById = new Map<string, Record<string, unknown>>();
  for (const s of snaps) snapById.set(String(s.feature_snapshot_id), s);
  const rows = shadowDb.prepare("SELECT * FROM predictions").all() as unknown as PitBVerifyRow[];
  const bySnap = new Map<string, PitBVerifyRow[]>();
  for (const r of rows) {
    const arr = bySnap.get(r.feature_snapshot_id) ?? [];
    arr.push(r);
    bySnap.set(r.feature_snapshot_id, arr);
  }
  out.rows_checked = rows.length;

  for (const [snapId, snapRows] of bySnap) {
    const rejectAll = (reason: string): void => {
      for (const r of snapRows) {
        out.rejected.push({ fixture_uid: r.fixture_uid, feature_snapshot_id: snapId, reason, prediction_id: r.id });
      }
    };
    const snap = snapById.get(snapId);
    if (!snap) {
      out.snapshot_errors.push({ feature_snapshot_id: snapId, reason: "snapshot_manifest_missing" });
      rejectAll("snapshot_manifest_missing");
      continue;
    }
    out.snapshots_checked++;
    let replay: PitBReplayResult;
    try {
      replay = replayPitBProjectionFile(path.join(projectionDir, String(snap.projection_file)), {
        expectedSha256: String(snap.projection_sha256),
      });
    } catch (err) {
      const reason = `archive_verify_failed: ${err instanceof Error ? err.message : String(err)}`;
      out.snapshot_errors.push({ feature_snapshot_id: snapId, reason });
      rejectAll("archive_verify_failed");
      continue;
    }
    const meta = replay.meta;
    const metaMismatch =
      meta.decision_at_utc !== String(snap.decision_at_utc) ||
      meta.cutoff_utc !== String(snap.cutoff_utc) ||
      meta.feature_code_version !== String(snap.feature_code_version) ||
      meta.runner_version !== String(snap.runner_version) ||
      meta.registry_team_canonical_sha256 !== String(snap.registry_team_canonical_sha256) ||
      meta.registry_fixture_links_sha256 !== String(snap.registry_fixture_links_sha256);
    if (metaMismatch) {
      out.snapshot_errors.push({ feature_snapshot_id: snapId, reason: "manifest_meta_mismatch" });
      rejectAll("manifest_meta_mismatch");
      continue;
    }
    out.snapshots_ok++;
    // Parse ulang proyeksi untuk cek identitas fixture + paket per baris.
    const proj = parsePitBProjection(
      (() => {
        const raw = fs.readFileSync(path.join(projectionDir, String(snap.projection_file)));
        return gunzipSync(raw).toString("utf8");
      })(),
    );
    const fixtureByUid = new Map(proj.fixtures.map((f) => [f.fixture_uid, f]));
    const packageByUid = new Map(proj.packages.map((p) => [p.fixture_uid, p]));
    for (const r of snapRows) {
      const rejectRow = (reason: string): void => {
        out.rejected.push({ fixture_uid: r.fixture_uid, feature_snapshot_id: snapId, reason, prediction_id: r.id });
      };
      const replayHash = replay.vectorHashes.get(r.fixture_uid);
      if (replayHash === undefined) {
        rejectRow("uid_not_in_projection");
        continue;
      }
      if (replayHash !== r.features_sha256) {
        rejectRow("features_hash_mismatch");
        continue;
      }
      const fx = fixtureByUid.get(r.fixture_uid);
      if (
        !fx ||
        fx.source_match_id !== r.source_match_id ||
        fx.kickoff_utc !== r.kickoff_utc ||
        fx.home_team_key !== r.home_team_key ||
        fx.away_team_key !== r.away_team_key
      ) {
        rejectRow("fixture_identity_mismatch");
        continue;
      }
      const pk = packageByUid.get(r.fixture_uid);
      if (
        !pk ||
        pk.package_id !== r.package_id ||
        pk.package_payload_sha256 !== r.package_payload_sha256 ||
        (pk.champion_ratings_marker ?? null) !== (r.champion_ratings_marker ?? null)
      ) {
        rejectRow("package_identity_mismatch");
        continue;
      }
      // --- Ikatan bukti per baris (Brief Tindak Lanjut §3.2) -------------
      // Baris prediksi tersimpan harus sama persis dengan bukti beku di
      // proyeksi; mutasi satu field pun menolak baris dari grading ketat.
      // (a) Waktu keputusan baris == waktu keputusan snapshot/proyeksi.
      const rowDecisionMs = parseInstant(r.decision_at_utc);
      const snapDecisionMs = parseInstant(String(snap.decision_at_utc));
      if (rowDecisionMs === null || snapDecisionMs === null || rowDecisionMs !== snapDecisionMs) {
        rejectRow("decision_time_mismatch");
        continue;
      }
      // (b) Waktu hitung paket baris == paket di proyeksi.
      const rowComputedMs = parseInstant(r.package_computed_utc);
      const projComputedMs = parseInstant(pk.package_computed_utc);
      if (rowComputedMs === null || projComputedMs === null || rowComputedMs !== projComputedMs) {
        rejectRow("package_computed_mismatch");
        continue;
      }
      // (c) Intensitas + peluang champion baris == paket di proyeksi
      // (nilai disalin verbatim saat issue; toleransi hanya debu float).
      const nearEq = (a: number, b: number): boolean => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9;
      if (
        !nearEq(pk.champ_lam, r.champ_lam) ||
        !nearEq(pk.champ_mu, r.champ_mu) ||
        !nearEq(pk.champ_p_h, r.champ_p_h) ||
        !nearEq(pk.champ_p_d, r.champ_p_d) ||
        !nearEq(pk.champ_p_a, r.champ_p_a)
      ) {
        rejectRow("champion_values_mismatch");
        continue;
      }
      // (d) Hash ulang vektor fitur TERSIMPAN di baris: harus sama dengan
      // hash tersimpan (features_sha256) DAN hash replay dari arsip.
      let storedVector: unknown = null;
      try {
        storedVector = JSON.parse(r.features_json);
      } catch {
        storedVector = null;
      }
      if (
        !Array.isArray(storedVector) ||
        !storedVector.every((v) => typeof v === "number" && Number.isFinite(v)) ||
        featureVectorHash(storedVector as number[]) !== r.features_sha256 ||
        featureVectorHash(storedVector as number[]) !== replayHash
      ) {
        rejectRow("features_json_mismatch");
        continue;
      }
      out.rows_ok++;
      if (r.eval_version === PIT_B_EVAL_VERSION) {
        out.strict_uids.push(r.fixture_uid);
        out.strict_prediction_ids.push(r.id);
      }
    }
  }
  return out;
}

/**
 * Tulis artefak proyeksi secara ATOMIK: gzip (mtime 0) ke file staging di
 * direktori yang sama, lalu rename ke nama final berbasis hash isi.
 * Retry atas isi yang sama menghasilkan nama yang sama (idempoten); file
 * staging dibersihkan bila penulisan gagal, jadi retry tidak mewarisi
 * referensi rusak.
 */
export function writePitBProjectionAtomic(
  projectionDir: string,
  jsonl: string,
): { file: string; path: string; bytes: number; sha256: string } {
  const sha256 = sha256Utf8(jsonl);
  const gz = gzipSync(Buffer.from(jsonl, "utf8"));
  // Header gzip byte 4–7 = MTIME: nolkan agar byte artefak deterministik
  // untuk isi yang sama (hash resmi tetap atas isi JSONL, bukan byte gz).
  gz.writeUInt32LE(0, 4);
  fs.mkdirSync(projectionDir, { recursive: true });
  const file = `pitb-projection-${sha256}.jsonl.gz`;
  const finalPath = path.join(projectionDir, file);
  const staging = path.join(projectionDir, `.staging-${sha256}-${process.pid}.tmp`);
  try {
    fs.writeFileSync(staging, gz);
    fs.renameSync(staging, finalPath);
  } catch (err) {
    try {
      fs.rmSync(staging, { force: true });
    } catch {
      // staging sudah hilang — tidak ada yang dibersihkan.
    }
    throw err;
  }
  return { file, path: finalPath, bytes: gz.length, sha256 };
}

// ============================================================================
// DB shadow PIT B
// ============================================================================
export interface PitBPredictionRow {
  eval_version: string;
  horizon_id: string;
  feature_time_status: string;
  input_evidence_status: string;
  grading_status: string;
  status: string;
  fixture_uid: string;
  source_match_id: string;
  identity_method: string;
  aliases_json: string;
  competition_id: string | null;
  decision_at_utc: string;
  issued_at_utc: string;
  kickoff_utc: string;
  lead_seconds: number;
  package_id: number;
  package_computed_utc: string;
  package_payload_sha256: string;
  champion_ratings_marker: string | null;
  champion_provenance_status: string;
  candidate_id: string | null;
  candidate_manifest_sha256: string | null;
  feature_snapshot_id: string;
  features_sha256: string;
  elo_fallback_home: number;
  elo_fallback_away: number;
  home_team_key: string;
  away_team_key: string;
  home_name: string | null;
  away_name: string | null;
  slice: string;
  registry_status: string | null;
  champ_lam: number;
  champ_mu: number;
  champ_p_h: number;
  champ_p_d: number;
  champ_p_a: number;
  cand_lam: number;
  cand_mu: number;
  cand_p_h: number;
  cand_p_d: number;
  cand_p_a: number;
  features_json: string;
}

export function ensurePitBSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS feature_snapshots (
      feature_snapshot_id TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      eval_version TEXT NOT NULL,
      decision_at_utc TEXT NOT NULL,
      cutoff_utc TEXT NOT NULL,
      snapshot_pinned_at_utc_json TEXT NOT NULL,
      projection_file TEXT NOT NULL,
      projection_bytes INTEGER NOT NULL,
      projection_sha256 TEXT NOT NULL,
      registry_team_canonical_sha256 TEXT NOT NULL,
      registry_fixture_links_sha256 TEXT NOT NULL,
      registry_captures_json TEXT NOT NULL DEFAULT '',
      feature_code_version TEXT NOT NULL,
      runner_version TEXT NOT NULL,
      counts_json TEXT NOT NULL,
      created_utc TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      eval_version TEXT NOT NULL,
      horizon_id TEXT NOT NULL,
      feature_time_status TEXT NOT NULL,
      input_evidence_status TEXT NOT NULL,
      grading_status TEXT NOT NULL DEFAULT 'pending',
      status TEXT NOT NULL DEFAULT 'PIT_B_STAGED',
      fixture_uid TEXT NOT NULL,
      source_match_id TEXT NOT NULL,
      identity_method TEXT NOT NULL,
      aliases_json TEXT NOT NULL,
      competition_id TEXT,
      decision_at_utc TEXT NOT NULL,
      issued_at_utc TEXT NOT NULL,
      kickoff_utc TEXT NOT NULL,
      lead_seconds INTEGER NOT NULL,
      package_id INTEGER NOT NULL,
      package_computed_utc TEXT NOT NULL,
      package_payload_sha256 TEXT NOT NULL,
      champion_ratings_marker TEXT,
      champion_provenance_status TEXT NOT NULL,
      candidate_id TEXT,
      candidate_manifest_sha256 TEXT,
      feature_snapshot_id TEXT NOT NULL,
      features_sha256 TEXT NOT NULL,
      elo_fallback_home INTEGER NOT NULL DEFAULT 0,
      elo_fallback_away INTEGER NOT NULL DEFAULT 0,
      home_team_key TEXT NOT NULL,
      away_team_key TEXT NOT NULL,
      home_name TEXT,
      away_name TEXT,
      slice TEXT NOT NULL,
      registry_status TEXT,
      champ_lam REAL NOT NULL,
      champ_mu REAL NOT NULL,
      champ_p_h REAL NOT NULL,
      champ_p_d REAL NOT NULL,
      champ_p_a REAL NOT NULL,
      cand_lam REAL NOT NULL,
      cand_mu REAL NOT NULL,
      cand_p_h REAL NOT NULL,
      cand_p_d REAL NOT NULL,
      cand_p_a REAL NOT NULL,
      features_json TEXT NOT NULL,
      UNIQUE (eval_version, fixture_uid, horizon_id)
    );
    CREATE INDEX IF NOT EXISTS idx_pitb_uid ON predictions(fixture_uid);
    CREATE INDEX IF NOT EXISTS idx_pitb_snapshot ON predictions(feature_snapshot_id);
  `);
  // Migrasi aditif untuk DB shadow v1 yang sudah ada: kolom capture
  // registry (Brief Kohor §2A). DB baru sudah memilikinya dari CREATE.
  const fsCols = db.prepare("PRAGMA table_info(feature_snapshots)").all() as unknown as { name: string }[];
  if (!fsCols.some((c) => c.name === "registry_captures_json")) {
    db.exec("ALTER TABLE feature_snapshots ADD COLUMN registry_captures_json TEXT NOT NULL DEFAULT ''");
  }
}

const INSERT_PIT_B_SQL = `
  INSERT INTO predictions (
    eval_version, horizon_id, feature_time_status, input_evidence_status,
    grading_status, status,
    fixture_uid, source_match_id, identity_method, aliases_json,
    competition_id, decision_at_utc, issued_at_utc, kickoff_utc, lead_seconds,
    package_id, package_computed_utc, package_payload_sha256,
    champion_ratings_marker, champion_provenance_status,
    candidate_id, candidate_manifest_sha256,
    feature_snapshot_id, features_sha256, elo_fallback_home, elo_fallback_away,
    home_team_key, away_team_key, home_name, away_name, slice, registry_status,
    champ_lam, champ_mu, champ_p_h, champ_p_d, champ_p_a,
    cand_lam, cand_mu, cand_p_h, cand_p_d, cand_p_a,
    features_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(eval_version, fixture_uid, horizon_id) DO NOTHING
`;

/** Insert staging dengan conflict handler tertarget — semantik sama PIT A. */
export function insertPitBRow(db: DatabaseSync, row: PitBPredictionRow): boolean {
  const res = db.prepare(INSERT_PIT_B_SQL).run(
    row.eval_version, row.horizon_id, row.feature_time_status, row.input_evidence_status,
    row.grading_status, row.status,
    row.fixture_uid, row.source_match_id, row.identity_method, row.aliases_json,
    row.competition_id, row.decision_at_utc, row.issued_at_utc, row.kickoff_utc, row.lead_seconds,
    row.package_id, row.package_computed_utc, row.package_payload_sha256,
    row.champion_ratings_marker, row.champion_provenance_status,
    row.candidate_id, row.candidate_manifest_sha256,
    row.feature_snapshot_id, row.features_sha256, row.elo_fallback_home, row.elo_fallback_away,
    row.home_team_key, row.away_team_key, row.home_name, row.away_name, row.slice, row.registry_status,
    row.champ_lam, row.champ_mu, row.champ_p_h, row.champ_p_d, row.champ_p_a,
    row.cand_lam, row.cand_mu, row.cand_p_h, row.cand_p_d, row.cand_p_a,
    row.features_json,
  );
  return Number(res.changes) > 0;
}

// ============================================================================
// Pemuatan input dari snapshot terpin + saringan ketersediaan (§3 brief)
// ============================================================================
interface RawResultRow extends PitBResultRow {
  available_at: string | null;
}

function tableColumns(db: DatabaseSync, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function loadRawResults(dataset: DatabaseSync): RawResultRow[] {
  const cols = tableColumns(dataset, "matches");
  if (cols.size === 0) {
    throw new Error("ML1-PIT-B: tabel matches tidak ditemukan di dataset — store wajib tidak terbaca.");
  }
  // Kolom opsional absen → ekspresi NULL polos; alias ditulis SATU kali di
  // daftar SELECT (Brief Kohor §2D — versi lama menyisipkan alias dua kali
  // untuk skema legacy: "NULL AS available_at AS available_at").
  const avail = cols.has("available_at") ? "available_at" : "NULL";
  return dataset
    .prepare(
      `SELECT match_id, competition_id, utc_date, home_team_id, away_team_id,
              home_score, away_score, season, ${avail} AS available_at
       FROM matches
       WHERE status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL`,
    )
    .all() as unknown as RawResultRow[];
}

function loadRawShots(dataset: DatabaseSync): PitBShotRow[] {
  const cols = tableColumns(dataset, "team_match_logs_canonical");
  if (cols.size === 0) {
    throw new Error("ML1-PIT-B: tabel team_match_logs_canonical tidak ditemukan di dataset — store wajib tidak terbaca.");
  }
  const logId = cols.has("log_id") ? "log_id" : "NULL";
  const src = cols.has("chosen_source") ? "chosen_source" : "NULL";
  return dataset
    .prepare(
      `SELECT ${logId} AS log_id, team_id, match_date, shots_for, shots_against,
              shots_on_target_for, shots_on_target_against, ${src} AS source
       FROM team_match_logs_canonical`,
    )
    .all() as unknown as PitBShotRow[];
}

function loadRegistryStatus(dataset: DatabaseSync): Map<string, string> {
  const out = new Map<string, string>();
  if (tableColumns(dataset, "league_calibration").size === 0) {
    throw new Error("ML1-PIT-B: tabel league_calibration tidak ditemukan di dataset — store wajib tidak terbaca.");
  }
  for (const r of dataset.prepare("SELECT league_id, status FROM league_calibration").all() as unknown as { league_id: string; status: string }[]) {
    out.set(r.league_id, r.status);
  }
  return out;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Saring hasil menurut ketersediaan pada keputusan ini. Urutan aturan
 * menentukan hitungan: komponen target dulu, lalu event mendahului
 * keputusan, lalu observasi eksplisit sesudah cutoff.
 */
export function filterResultsByVisibility(
  rows: RawResultRow[],
  decisionMs: number,
  targetComponentIds: Set<string>,
  counts: PitBVisibilityCounts,
): PitBResultRow[] {
  const decisionDate = new Date(decisionMs).toISOString().slice(0, 10);
  const out: PitBResultRow[] = [];
  for (const r of rows) {
    counts.results_in_snapshot++;
    if (targetComponentIds.has(r.match_id)) {
      counts.results_excluded_target_component++;
      continue;
    }
    const kickoffMs = parseInstant(r.utc_date);
    if (kickoffMs === null) {
      // Tanggal-saja: konvensi yang sama dengan shots (tanggal < tanggal keputusan).
      if (DATE_ONLY_RE.test(r.utc_date) && r.utc_date < decisionDate) {
        // lolos cek event — lanjut ke cek observasi
      } else if (DATE_ONLY_RE.test(r.utc_date)) {
        counts.results_excluded_event_not_before_decision++;
        continue;
      } else {
        counts.results_excluded_invalid_time++;
        continue;
      }
    } else if (kickoffMs >= decisionMs) {
      counts.results_excluded_event_not_before_decision++;
      continue;
    }
    if (r.available_at !== null && r.available_at !== undefined) {
      const obsMs = parseInstant(r.available_at);
      if (obsMs !== null && obsMs > decisionMs) {
        counts.results_excluded_observation_after_cutoff++;
        continue;
      }
    }
    out.push({
      match_id: r.match_id,
      competition_id: r.competition_id,
      utc_date: r.utc_date,
      home_team_id: r.home_team_id,
      away_team_id: r.away_team_id,
      home_score: r.home_score,
      away_score: r.away_score,
      season: r.season,
    });
  }
  counts.results_projected = out.length;
  return out;
}

/** Saring shots menurut ketersediaan: instant terpercaya vs presisi tanggal. */
export function filterShotsByVisibility(
  rows: PitBShotRow[],
  decisionMs: number,
  counts: PitBVisibilityCounts,
): PitBShotRow[] {
  const decisionDate = new Date(decisionMs).toISOString().slice(0, 10);
  const out: PitBShotRow[] = [];
  for (const s of rows) {
    counts.shots_in_snapshot++;
    const md = typeof s.match_date === "string" ? s.match_date : "";
    if (md.includes("T")) {
      const ms = parseInstant(md);
      if (ms === null) {
        counts.shots_excluded_invalid_time++;
        continue;
      }
      if (ms >= decisionMs) {
        counts.shots_excluded_event_not_before_decision++;
        continue;
      }
      out.push(s);
      continue;
    }
    const d = md.slice(0, 10);
    if (!DATE_ONLY_RE.test(d)) {
      counts.shots_excluded_invalid_time++;
      continue;
    }
    if (d < decisionDate) {
      out.push(s);
    } else if (d === decisionDate) {
      // Tanggal sama dengan tanggal keputusan tanpa jam event: tidak bisa
      // dibuktikan mendahului keputusan → dikeluarkan, kehilangan coverage
      // ini DIHITUNG (bukan disembunyikan).
      counts.shots_excluded_date_precision++;
    } else {
      counts.shots_excluded_event_not_before_decision++;
    }
  }
  counts.shots_projected = out.length;
  return out;
}

// ============================================================================
// Inti run PIT B
// ============================================================================
export interface PitBDeps {
  dataset: DatabaseSync;
  upcoming: DatabaseSync;
  snapshots: DatabaseSync;
  outputDbPath: string;
  /** Direktori artefak proyeksi (di dalam direktori DB runtime). */
  projectionDir: string;
  dataDirPath: string;
  modelDir: string;
  clock: PitAClock;
  executor: PitAInferenceExecutor;
  limit?: number;
  /**
   * Batas lead maksimum (ms) untuk horizon kohor — diterapkan SEBELUM
   * dedupe permanen/insert (Brief Kohor §3): fixture yang kickoff-nya
   * masih lebih jauh dari batas ini TIDAK disimpan pada run ini, supaya
   * baris terlalu dini tidak mengunci kesempatan eligible berikutnya.
   * Undefined/0 = tanpa gerbang (perilaku PIT B dasar).
   */
  maxLeadMs?: number;
}

export interface PitBFeatureCoverage {
  fixtures: number;
  form_home_ready: number;
  form_away_ready: number;
  shots_home_ready: number;
  shots_away_ready: number;
  rest_ready: number;
  elo_fallback_fixtures: number;
}

export interface PitBRunSummary {
  tool: string;
  status: string;
  data_status: string;
  eval_version: string;
  horizon_id: string;
  decision_at_utc: string;
  issued_at_utc: string | null;
  snapshot_pinned_at_utc: { snapshots: string; dataset: string; upcoming: string };
  registry_captured_at_utc: { team_canonical: string; fixture_links: string };
  feature_snapshot_id: string | null;
  projection: { file: string; bytes: number; sha256: string } | null;
  candidates_by_source: Record<string, number>;
  unique_fixtures: number;
  attempted: number;
  predicted_new: number;
  skipped: Record<string, number>;
  visibility: PitBVisibilityCounts;
  feature_coverage: PitBFeatureCoverage;
  timings: { read_transaction_ms: number; batch_ms: number };
  peak_rss_mb: number | null;
}

interface PitBAttempt {
  prep: PitPreparedFixture;
  fixtureInput: PitBFixtureInput;
  packageInfo: PitBPackageInfo;
  frozenHomeTeamId: string;
  frozenAwayTeamId: string;
  eloFallbackHome: boolean;
  eloFallbackAway: boolean;
}

const emptyVisibility = (): PitBVisibilityCounts => ({
  results_in_snapshot: 0,
  results_projected: 0,
  results_excluded_target_component: 0,
  results_excluded_event_not_before_decision: 0,
  results_excluded_observation_after_cutoff: 0,
  results_excluded_invalid_time: 0,
  shots_in_snapshot: 0,
  shots_projected: 0,
  shots_excluded_date_precision: 0,
  shots_excluded_event_not_before_decision: 0,
  shots_excluded_invalid_time: 0,
});

export function runMl1PitB(deps: PitBDeps): PitBRunSummary {
  const batchStart = performance.now();
  const { dataset, upcoming, snapshots } = deps;
  const limit = deps.limit ?? 0;
  const skipped: Record<string, number> = {};
  const skip = (cat: string, n = 1) => {
    skipped[cat] = (skipped[cat] ?? 0) + n;
  };
  const counts = emptyVisibility();

  const out = new DatabaseSync(deps.outputDbPath);
  try {
    ensurePitBSchema(out);

    // ------------------------------------------------------------ PIN -----
    // Tiga store dipin lebih dulu; decision_at_utc diambil dari clock
    // SESUDAH seluruh pin. Kegagalan membuka store wajib = gagal eksplisit
    // (dibedakan dari fitur missing yang sah di fase saringan).
    const pins = { snapshots: "", dataset: "", upcoming: "" };
    const pinMs = { snapshots: Number.NaN, dataset: Number.NaN, upcoming: Number.NaN };
    const pinStore = (name: keyof typeof pins, db: DatabaseSync, probeSql: string): void => {
      try {
        beginPinnedRead(db, probeSql);
      } catch (err) {
        throw new Error(
          `ML1-PIT-B: store wajib tidak terbaca saat pin (${name}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      const t = deps.clock();
      const ms = t.getTime();
      if (!Number.isFinite(ms)) {
        throw new Error(`ML1-PIT-B: clock menghasilkan waktu tidak valid saat pin (${name}).`);
      }
      pins[name] = t.toISOString();
      pinMs[name] = ms;
    };

    let decisionMs = Number.NaN;
    let decision_at_utc = "";
    let projection: PitBProjection | null = null;
    let projectionFile: { file: string; path: string; bytes: number; sha256: string } | null = null;
    let attempts: PitBAttempt[] = [];
    let prepCandidatesBySource: Record<string, number> = {};
    let prepUniqueFixtures = 0;
    let identityReady = false;
    let matResults: PitBResultRow[] = [];
    let matShots: PitBShotRow[] = [];
    let frozenRegistrySha = { team: "", teamPresent: false, links: "", linksPresent: false };
    const registryCaptures = { team_canonical: "", fixture_links: "" };
    const registryCaptureMs = { team_canonical: Number.NaN, fixture_links: Number.NaN };
    const pinStart = performance.now();
    let readTxnMs = 0;
    try {
      // ---------------------------------------------------------- CAPTURE -
      // Brief Kohor §2A: byte registry tim + fixture-links DIBACA DAN
      // DIBEKUKAN sebelum jam keputusan diambil — dari byte yang sama
      // dengan yang diparse. Waktu baca selesai dicap dari clock dan
      // wajib <= decision_at_utc; perubahan file sesudah momen ini tidak
      // mengubah pemetaan keputusan (revalidasi pascainferensi tetap
      // memakai kondisi terbaru untuk menerima/menolak).
      const registry = readPitBTeamRegistry(deps.dataDirPath);
      {
        const t = deps.clock();
        if (!Number.isFinite(t.getTime())) {
          throw new Error("ML1-PIT-B: clock menghasilkan waktu tidak valid saat capture registry tim.");
        }
        registryCaptures.team_canonical = t.toISOString();
        registryCaptureMs.team_canonical = t.getTime();
      }
      const links = readPitBLinks(deps.dataDirPath);
      {
        const t = deps.clock();
        if (!Number.isFinite(t.getTime())) {
          throw new Error("ML1-PIT-B: clock menghasilkan waktu tidak valid saat capture fixture-links.");
        }
        registryCaptures.fixture_links = t.toISOString();
        registryCaptureMs.fixture_links = t.getTime();
      }

      pinStore("snapshots", snapshots, "SELECT COUNT(*) AS n FROM packages");
      pinStore("dataset", dataset, "SELECT COUNT(*) AS n FROM matches");
      pinStore("upcoming", upcoming, "SELECT COUNT(*) AS n FROM upcoming_fixtures");

      const decisionDate = deps.clock();
      decisionMs = decisionDate.getTime();
      if (!Number.isFinite(decisionMs)) {
        throw new Error("ML1-PIT-B: clock menghasilkan waktu tidak valid untuk decision_at_utc.");
      }
      decision_at_utc = decisionDate.toISOString();
      for (const k of ["snapshots", "dataset", "upcoming"] as const) {
        if (pinMs[k] > decisionMs) {
          throw new Error(
            `ML1-PIT-B: pin ${k} (${pins[k]}) melampaui decision_at_utc (${decision_at_utc}) — jam tidak konsisten.`,
          );
        }
      }
      for (const k of ["team_canonical", "fixture_links"] as const) {
        if (registryCaptureMs[k] > decisionMs) {
          throw new Error(
            `ML1-PIT-B: capture ${k} (${registryCaptures[k]}) melampaui decision_at_utc (${decision_at_utc}) — byte registry harus dibekukan sebelum keputusan.`,
          );
        }
      }

      // Seleksi paket as-of di dalam transaksi snapshots yang terpin.
      const sel = selectPackagesAsOf(snapshots, decisionMs, decision_at_utc);
      // Persiapan kandidat di bawah pin: identitas/eligibility membaca
      // snapshot dataset + upcoming yang sama.
      const prep = preparePitCandidates({
        dataset,
        upcoming,
        dataDirPath: deps.dataDirPath,
        linkGroups: links.groups,
        selectedRaw: sel.selectedRaw,
        unparseableComputed: sel.unparseableComputed,
        decisionMs,
        skip,
      });
      prepCandidatesBySource = prep.candidatesBySource;
      prepUniqueFixtures = prep.uniqueFixtures;
      identityReady = prep.identityReady;

      // Tersimpan + drift (DB shadow sendiri) lalu limit — pola PIT A.
      const storedRows = out
        .prepare("SELECT fixture_uid, aliases_json FROM predictions WHERE eval_version = ? AND horizon_id = ?")
        .all(PIT_B_EVAL_VERSION, PIT_B_HORIZON_ID) as unknown as { fixture_uid: string; aliases_json: string }[];
      const storedByUid = new Map<string, Set<string>>();
      const aliasOwner = new Map<string, string>();
      for (const r of storedRows) {
        let aliases: string[] = [];
        try {
          aliases = JSON.parse(r.aliases_json) as string[];
        } catch {
          aliases = [];
        }
        storedByUid.set(r.fixture_uid, new Set(aliases));
        for (const a of aliases) aliasOwner.set(a, r.fixture_uid);
      }
      const processable: PitPreparedFixture[] = [];
      for (const p of prep.eligible) {
        // Gerbang horizon kohor SEBELUM dedupe: terlalu dini → tidak
        // disimpan, tidak mengunci (Brief Kohor §3).
        if (deps.maxLeadMs !== undefined && deps.maxLeadMs > 0 && p.winner.kickoffMs - decisionMs > deps.maxLeadMs) {
          skip("lead_beyond_horizon");
          continue;
        }
        if (storedByUid.has(p.uid)) {
          skip("already_stored");
          continue;
        }
        let drift = false;
        for (const a of p.aliasSet) {
          const owner = aliasOwner.get(a);
          if (owner && owner !== p.uid) drift = true;
        }
        if (drift) {
          skip("identity_changed_since_issue");
          continue;
        }
        processable.push(p);
      }
      processable.sort((x, y) => {
        if (x.winner.kickoffMs !== y.winner.kickoffMs) return x.winner.kickoffMs - y.winner.kickoffMs;
        return x.uid.localeCompare(y.uid);
      });
      const limited = limit > 0 ? processable.slice(0, limit) : processable;

      // Input fitur dari snapshot dataset terpin (store rusak = gagal
      // eksplisit; baris absen = fitur missing yang sah, ditangani filter).
      let rawResults: RawResultRow[];
      let rawShots: PitBShotRow[];
      let registryStatus: Map<string, string>;
      try {
        rawResults = loadRawResults(dataset);
        rawShots = loadRawShots(dataset);
        registryStatus = loadRegistryStatus(dataset);
      } catch (err) {
        throw new Error(
          `ML1-PIT-B: store dataset tidak terbaca saat memuat input fitur: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // Input fixture beku per attempt — upcoming dibaca dari snapshot
      // terpin; kunci tim dari registry byte terpin.
      const built: PitBAttempt[] = [];
      for (const p of limited) {
        const up = upcoming
          .prepare(
            "SELECT match_id, home_team_id, away_team_id, home_team_name, away_team_name FROM upcoming_fixtures WHERE match_id = ?",
          )
          .get(p.winnerId) as
          | { match_id: string; home_team_id: string; away_team_id: string; home_team_name: string; away_team_name: string }
          | undefined;
        if (!up) {
          skip("fixture_state_ineligible");
          continue;
        }
        const homeKey = resolveTeamKeyPitB(registry, String(up.home_team_id), up.home_team_name);
        const awayKey = resolveTeamKeyPitB(registry, String(up.away_team_id), up.away_team_name);
        const compId = p.winner.raw.competition_canonical_id ?? null;
        const regStatus = registryStatus.get(compId ?? "") ?? null;
        built.push({
          prep: p,
          fixtureInput: {
            fixture_uid: p.uid,
            source_match_id: p.winnerId,
            kickoff_utc: new Date(p.winner.kickoffMs).toISOString(),
            competition_id: compId,
            home_team_key: homeKey,
            away_team_key: awayKey,
            home_team_id: String(up.home_team_id),
            away_team_id: String(up.away_team_id),
            home_name: up.home_team_name,
            away_name: up.away_team_name,
            slice: regStatus === "calibrated" || regStatus === "partial" ? "kompetitif" : "friendlies",
            registry_status: regStatus,
          },
          packageInfo: {
            fixture_uid: p.uid,
            package_id: p.winner.raw.id,
            package_computed_utc: new Date(p.winner.computedMs).toISOString(),
            package_payload_sha256: sha256Utf8(p.winner.raw.payload_json),
            champion_ratings_marker: p.winner.raw.ratings_marker,
            champ_lam: p.winner.raw.lambda as number,
            champ_mu: p.winner.raw.mu as number,
            champ_p_h: p.winner.champP[0],
            champ_p_d: p.winner.champP[1],
            champ_p_a: p.winner.champP[2],
          },
          frozenHomeTeamId: String(up.home_team_id),
          frozenAwayTeamId: String(up.away_team_id),
          eloFallbackHome: false,
          eloFallbackAway: false,
        });
      }

      // Saringan ketersediaan atas snapshot terpin.
      const targetComponentIds = new Set<string>();
      for (const p of limited) for (const a of p.aliasSet) targetComponentIds.add(a);
      const results = filterResultsByVisibility(rawResults, decisionMs, targetComponentIds, counts);
      const shots = filterShotsByVisibility(rawShots, decisionMs, counts);

      // Fallback Elo awal: kunci tim tanpa riwayat di universe eligible
      // kompetisinya (rating final extractor untuk tim itu = ELO_START).
      const compTeams = new Map<string, Set<string>>();
      for (const r of results) {
        if (!r.competition_id.startsWith("sm:")) continue;
        const set = compTeams.get(r.competition_id) ?? new Set<string>();
        set.add(r.home_team_id);
        set.add(r.away_team_id);
        compTeams.set(r.competition_id, set);
      }
      for (const b of built) {
        const set = compTeams.get(b.fixtureInput.competition_id ?? "");
        b.eloFallbackHome = !(set?.has(b.fixtureInput.home_team_key) ?? false);
        b.eloFallbackAway = !(set?.has(b.fixtureInput.away_team_key) ?? false);
      }
      attempts = built;
      matResults = results;
      matShots = shots;
      // Hash registry/link yang dibekukan disimpan untuk meta proyeksi
      // (objek proyeksi sendiri dibangun SESUDAH transaksi dilepas).
      frozenRegistrySha = { team: registry.sha256, teamPresent: registry.present, links: links.sha256, linksPresent: links.present };
    } finally {
      // Brief Kohor §2D: ketiga transaksi read-only DILEPAS sesudah
      // materialisasi, SEBELUM serialisasi/kompresi/I-O proyeksi —
      // snapshot tidak menahan WAL selama pekerjaan CPU/disk berjalan.
      endPinnedRead(snapshots);
      endPinnedRead(dataset);
      endPinnedRead(upcoming);
      readTxnMs = performance.now() - pinStart;
    }

    // Bekukan proyeksi dari materialisasi + tulis file atomik SEBELUM
    // baris mana pun mengacu padanya (penulisan tetap mendahului commit
    // referensi di fase tulis).
    if (attempts.length > 0) {
      projection = {
        meta: {
          kind: "meta",
          schema_version: PIT_B_PROJECTION_SCHEMA_VERSION,
          eval_version: PIT_B_EVAL_VERSION,
          horizon_id: PIT_B_HORIZON_ID,
          decision_at_utc,
          cutoff_utc: decision_at_utc,
          snapshot_pinned_at_utc: { ...pins },
          feature_code_version: PIT_B_FEATURE_CODE_VERSION,
          runner_version: PIT_B_RUNNER_VERSION,
          registry_team_canonical_sha256: frozenRegistrySha.team,
          registry_team_canonical_present: frozenRegistrySha.teamPresent,
          registry_fixture_links_sha256: frozenRegistrySha.links,
          registry_fixture_links_present: frozenRegistrySha.linksPresent,
          registry_captured_at_utc: { ...registryCaptures },
          counts: { ...counts, fixtures: attempts.length, packages: attempts.length },
        },
        results: matResults,
        shots: matShots,
        fixtures: attempts.map((a) => a.fixtureInput),
        packages: attempts.map((a) => a.packageInfo),
      };
      projectionFile = writePitBProjectionAtomic(deps.projectionDir, serializePitBProjection(projection));
    }

    // ---------------------------------------------------------- FITUR -----
    // Extractor dibangun dari PROYEKSI (jalur yang sama dengan replay).
    const coverage: PitBFeatureCoverage = {
      fixtures: attempts.length,
      form_home_ready: 0,
      form_away_ready: 0,
      shots_home_ready: 0,
      shots_away_ready: 0,
      rest_ready: 0,
      elo_fallback_fixtures: 0,
    };
    let feats = new Map<string, PitBFeatureComputation>();
    if (projection !== null && attempts.length > 0) {
      feats = computePitBFeatures(projection);
      const idx = (name: (typeof ML1_B_FEATURE_NAMES)[number]): number => ML1_B_FEATURE_NAMES.indexOf(name);
      for (const a of attempts) {
        const v = feats.get(a.prep.uid)?.vector ?? [];
        if (v[idx("miss_form_home")] === 0) coverage.form_home_ready++;
        if (v[idx("miss_form_away")] === 0) coverage.form_away_ready++;
        if (v[idx("has_prior_shots_home")] === 1) coverage.shots_home_ready++;
        if (v[idx("has_prior_shots_away")] === 1) coverage.shots_away_ready++;
        if (v[idx("miss_rest")] === 0) coverage.rest_ready++;
        if (a.eloFallbackHome || a.eloFallbackAway) coverage.elo_fallback_fixtures++;
      }
    }

    // ------------------------------------------------------- INFERENSI ----
    let execResult: PitAExecutorResult | null = null;
    if (attempts.length > 0) {
      execResult = deps.executor({
        modelDir: deps.modelDir,
        requests: attempts.map((a) => ({
          match_id: a.prep.winnerId,
          champLam: a.prep.winner.raw.lambda as number,
          champMu: a.prep.winner.raw.mu as number,
          featB: feats.get(a.prep.uid)?.vector ?? [],
        })),
      });
      validateInferenceResults(
        attempts.map((a) => ({
          match_id: a.prep.winnerId,
          champLam: a.prep.winner.raw.lambda as number,
          champMu: a.prep.winner.raw.mu as number,
          featB: feats.get(a.prep.uid)?.vector ?? [],
        })),
        execResult.results,
      );
    }

    // ------------------------------------------- REVALIDASI + TULIS -------
    // Disiplin jam yang sama dengan PIT A: issued per baris sesudah lock
    // tulis; cek clock akhir sebelum commit membuang baris yang kickoff-nya
    // sudah lewat; jam akhir invalid/mundur → rollback batch.
    let issued_at_utc: string | null = null;
    let predictedNew = 0;
    if (execResult !== null && attempts.length > 0 && projection !== null && projectionFile !== null) {
      const proj = projection;
      const projFile = projectionFile;
      out.exec("BEGIN IMMEDIATE");
      try {
        const freshStored = out
          .prepare("SELECT fixture_uid, aliases_json FROM predictions WHERE eval_version = ? AND horizon_id = ?")
          .all(PIT_B_EVAL_VERSION, PIT_B_HORIZON_ID) as unknown as { fixture_uid: string; aliases_json: string }[];
        const freshByUid = new Map<string, Set<string>>();
        const freshOwner = new Map<string, string>();
        for (const r of freshStored) {
          let aliases: string[] = [];
          try {
            aliases = JSON.parse(r.aliases_json) as string[];
          } catch {
            aliases = [];
          }
          freshByUid.set(r.fixture_uid, new Set(aliases));
          for (const a of aliases) freshOwner.set(a, r.fixture_uid);
        }

        const staged: { uid: string; kickoffMs: number }[] = [];
        let maxIssuedMs = Number.NEGATIVE_INFINITY;
        let batchRolledBack = false;
        let manifestWritten = false;

        for (const a of attempts) {
          const res = execResult.results.get(a.prep.winnerId);
          if (!res) continue; // sudah divalidasi ada — pertahanan terakhir.
          if (a.prep.winner.computedMs > decisionMs) {
            skip("clock_invalid");
            continue;
          }
          if (freshByUid.has(a.prep.uid)) {
            skip("already_stored");
            continue;
          }
          let drift = false;
          for (const al of a.prep.aliasSet) {
            const owner = freshOwner.get(al);
            if (owner && owner !== a.prep.uid) drift = true;
          }
          if (drift) {
            skip("identity_changed_since_issue");
            continue;
          }
          // Revalidasi titik kedua — semua lookup BARU (transaksi pin sudah
          // dilepas): upcoming, state/jadwal kanonik, komponen alias segar
          // penuh, ID tim beku dari snapshot.
          const reason = checkPitEligibility(
            { dataset, upcoming, dataDirPath: deps.dataDirPath, identityReady },
            {
              winnerId: a.prep.winnerId,
              uid: a.prep.uid,
              kickoffMs: a.prep.winner.kickoffMs,
              aliasSet: a.prep.aliasSet,
              frozenTeam: { homeId: a.frozenHomeTeamId, awayId: a.frozenAwayTeamId },
              freshIdentity: true,
            },
          );
          if (reason) {
            skip(reason);
            continue;
          }
          const issuedDate = deps.clock();
          const issuedMs = issuedDate.getTime();
          if (!Number.isFinite(issuedMs) || issuedMs < decisionMs) {
            out.exec("ROLLBACK");
            skip("clock_invalid", attempts.length);
            predictedNew = 0;
            batchRolledBack = true;
            break;
          }
          if (issuedMs >= a.prep.winner.kickoffMs) {
            skip("kickoff_passed");
            continue;
          }
          issued_at_utc = issuedDate.toISOString();
          if (issuedMs > maxIssuedMs) maxIssuedMs = issuedMs;
          if (!manifestWritten) {
            // Manifest snapshot ditulis di transaksi yang sama, sebelum
            // baris prediksi pertama mengacu padanya; file artefaknya
            // sendiri sudah final sejak fase proyeksi.
            out
              .prepare(
                `INSERT INTO feature_snapshots (
                   feature_snapshot_id, schema_version, eval_version, decision_at_utc, cutoff_utc,
                   snapshot_pinned_at_utc_json, projection_file, projection_bytes, projection_sha256,
                   registry_team_canonical_sha256, registry_fixture_links_sha256, registry_captures_json,
                   feature_code_version, runner_version, counts_json, created_utc
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(feature_snapshot_id) DO NOTHING`,
              )
              .run(
                projFile.sha256,
                PIT_B_PROJECTION_SCHEMA_VERSION,
                PIT_B_EVAL_VERSION,
                decision_at_utc,
                decision_at_utc,
                JSON.stringify(pins),
                projFile.file,
                projFile.bytes,
                projFile.sha256,
                proj.meta.registry_team_canonical_sha256,
                proj.meta.registry_fixture_links_sha256,
                JSON.stringify(proj.meta.registry_captured_at_utc ?? {}),
                PIT_B_FEATURE_CODE_VERSION,
                PIT_B_RUNNER_VERSION,
                JSON.stringify(proj.meta.counts),
                issued_at_utc,
              );
            manifestWritten = true;
          }
          const mp = matrixProbs(res.lam, res.mu, 0);
          const feat = feats.get(a.prep.uid);
          if (!feat) {
            skip("feature_missing");
            continue;
          }
          const marker = a.prep.winner.raw.ratings_marker;
          const inserted = insertPitBRow(out, {
            eval_version: PIT_B_EVAL_VERSION,
            horizon_id: PIT_B_HORIZON_ID,
            feature_time_status: PIT_B_FEATURE_TIME_STATUS,
            input_evidence_status: PIT_B_INPUT_EVIDENCE_STATUS,
            grading_status: "pending",
            status: PIT_B_DATA_STATUS,
            fixture_uid: a.prep.uid,
            source_match_id: a.prep.winnerId,
            identity_method: a.prep.method,
            aliases_json: JSON.stringify([...a.prep.aliasSet].sort()),
            competition_id: a.prep.winner.raw.competition_canonical_id,
            decision_at_utc,
            issued_at_utc,
            kickoff_utc: new Date(a.prep.winner.kickoffMs).toISOString(),
            lead_seconds: Math.round((a.prep.winner.kickoffMs - decisionMs) / 1000),
            package_id: a.packageInfo.package_id,
            package_computed_utc: a.packageInfo.package_computed_utc,
            package_payload_sha256: a.packageInfo.package_payload_sha256,
            champion_ratings_marker: marker,
            champion_provenance_status: marker !== null && marker !== "" ? "package_marker" : "unknown",
            candidate_id: execResult.candidateId,
            candidate_manifest_sha256: execResult.candidateManifestSha256,
            feature_snapshot_id: projFile.sha256,
            features_sha256: feat.hash,
            elo_fallback_home: a.eloFallbackHome ? 1 : 0,
            elo_fallback_away: a.eloFallbackAway ? 1 : 0,
            home_team_key: a.fixtureInput.home_team_key,
            away_team_key: a.fixtureInput.away_team_key,
            home_name: a.fixtureInput.home_name,
            away_name: a.fixtureInput.away_name,
            slice: a.fixtureInput.slice,
            registry_status: a.fixtureInput.registry_status,
            champ_lam: a.packageInfo.champ_lam,
            champ_mu: a.packageInfo.champ_mu,
            champ_p_h: a.packageInfo.champ_p_h,
            champ_p_d: a.packageInfo.champ_p_d,
            champ_p_a: a.packageInfo.champ_p_a,
            cand_lam: res.lam,
            cand_mu: res.mu,
            cand_p_h: mp.p[0],
            cand_p_d: mp.p[1],
            cand_p_a: mp.p[2],
            features_json: JSON.stringify(feat.vector),
          });
          if (inserted) {
            predictedNew++;
            staged.push({ uid: a.prep.uid, kickoffMs: a.prep.winner.kickoffMs });
            freshByUid.set(a.prep.uid, new Set(a.prep.aliasSet));
            for (const al of a.prep.aliasSet) freshOwner.set(al, a.prep.uid);
          } else {
            skip("already_stored");
          }
        }

        if (!batchRolledBack) {
          const finalDate = deps.clock();
          const finalMs = finalDate.getTime();
          if (
            !Number.isFinite(finalMs) ||
            finalMs < decisionMs ||
            (staged.length > 0 && finalMs < maxIssuedMs)
          ) {
            out.exec("ROLLBACK");
            skip("clock_invalid", attempts.length);
            predictedNew = 0;
            batchRolledBack = true;
          } else {
            for (const st of staged) {
              if (st.kickoffMs <= finalMs) {
                out
                  .prepare(
                    "DELETE FROM predictions WHERE eval_version = ? AND fixture_uid = ? AND horizon_id = ?",
                  )
                  .run(PIT_B_EVAL_VERSION, st.uid, PIT_B_HORIZON_ID);
                predictedNew--;
                skip("kickoff_passed");
              }
            }
            out.exec("COMMIT");
          }
        }
      } catch (err) {
        try {
          out.exec("ROLLBACK");
        } catch {
          // Transaksi sudah berakhir.
        }
        throw err;
      }
    }

    const rssRaw = process.resourceUsage?.() as unknown as { maxrss?: number; maxRSS?: number } | undefined;
    const rssKb = rssRaw?.maxrss ?? rssRaw?.maxRSS ?? 0;
    return {
      tool: "ml1-prospective-pit-b",
      status: "ok",
      data_status: PIT_B_DATA_STATUS,
      eval_version: PIT_B_EVAL_VERSION,
      horizon_id: PIT_B_HORIZON_ID,
      decision_at_utc,
      issued_at_utc,
      snapshot_pinned_at_utc: { ...pins },
      registry_captured_at_utc: { ...registryCaptures },
      feature_snapshot_id: projectionFile?.sha256 ?? null,
      projection: projectionFile
        ? { file: projectionFile.file, bytes: projectionFile.bytes, sha256: projectionFile.sha256 }
        : null,
      candidates_by_source: prepCandidatesBySource,
      unique_fixtures: prepUniqueFixtures,
      attempted: attempts.length,
      predicted_new: predictedNew,
      skipped,
      visibility: counts,
      feature_coverage: coverage,
      timings: {
        read_transaction_ms: Math.round(readTxnMs),
        batch_ms: Math.round(performance.now() - batchStart),
      },
      peak_rss_mb: rssKb > 0 ? Math.round(rssKb / 102.4) / 10 : null,
    };
  } finally {
    out.close();
  }
}
