/**
 * MANIFEST MODEL BERVERSI (K4 · paritas lab/produksi).
 *
 * Satu artefak manifest mendeskripsikan model rating yang AKTIF:
 * konfigurasi fit (κ/kfit, half-life, mode rho, blend James-Stein),
 * cakupan + jendela data latih, ringkasan status kalibrasi, dan hash
 * artefak rating yang dideskripsikannya. Manifest dihasilkan jalur fit
 * sebagai KANDIDAT (model-manifest.candidate.json) dan hanya menjadi
 * AKTIF (model-manifest.json) lewat gerbang promosi eksplisit
 * (lib/quant/promotion-gate.ts + scripts/promote-model.ts). Refresh/fit
 * biasa TIDAK PERNAH menulis manifest aktif.
 *
 * Kedua jalur — produksi (scripts/pick-slate.ts) dan lab/evaluasi
 * (scripts/evaluate-model.ts) — memuat manifest aktif dari modul ini.
 * Manifest hilang/rusak/terubah → run berhenti dengan ModelManifestError
 * berkode nama yang jelas; TIDAK ada fallback diam-diam ke identitas
 * karangan (praktik lama: konstanta "quant-package-v1" di slate).
 *
 * contentHash = sha256 atas serialisasi kanonis manifest TANPA field
 * contentHash dan generatedAt — regenerasi dari artefak + konfigurasi
 * yang sama menghasilkan hash yang sama (Q04).
 *
 * ARTEFAK IMMUTABLE + POINTER (fix-5, review K8 §5): bobot rating hidup
 * sebagai artefak immutable per hash di data/model-artifacts/
 * (ratings-<sha256 penuh>.json, content-addressed, tidak pernah
 * ditimpa). Manifest AKTIF adalah satu-satunya POINTER ke artefak yang
 * melayani: jalur saji (loadServingModel) membaca pointer satu kali,
 * memvalidasi hash artefak terhadap manifest, dan memakai bobot yang
 * dirujuk pointer itu — file lepas data/calibrated_ratings.json BUKAN
 * lagi sumber bobot saji (ia hanya salinan kerja jalur fit/lab).
 * Refit menulis artefak BARU + manifest kandidat; pointer hanya
 * berpindah di dalam operasi promosi atomik (gerbang K4,
 * scripts/promote-model.ts, tulis-temp + rename). Hash tidak cocok →
 * kegagalan bernama SEBELUM penerbitan apa pun; tidak ada fallback
 * diam-diam ke file lepas.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CalibratedRatingsFile } from "./ratings-loader";

export const ACTIVE_MANIFEST_FILENAME = "model-manifest.json";
export const CANDIDATE_MANIFEST_FILENAME = "model-manifest.candidate.json";
export const RATINGS_FILENAME = "calibrated_ratings.json";

export type ModelManifestErrorCode =
  | "manifest_missing"
  | "manifest_corrupt"
  | "manifest_field_missing"
  | "manifest_hash_mismatch"
  | "manifest_ratings_mismatch"
  | "artifact_missing"
  | "artifact_conflict"
  | "point_in_time_violation";

export class ModelManifestError extends Error {
  readonly code: ModelManifestErrorCode;
  constructor(code: ModelManifestErrorCode, message: string) {
    super(message);
    this.name = "ModelManifestError";
    this.code = code;
  }
}

export interface ModelConfig {
  /** κ shrinkage fit (penamaan scripts/calibrate-ratings.ts: --shrink-kappa). */
  kappa: number;
  /** Nama parameter yang sama di harness lab (backtest-walkforward: kfit). */
  kfit: number;
  halfLifeDays: number;
  rhoMode: string;
  blend: { kind: "james-stein"; kappaScale: number };
}

/**
 * Konfigurasi champion produksi pada commit acuan PRD: fit IPF half-life
 * 365, rho zero, κ/kfit 10, blend James-Stein telemetri κ×2 (tervalidasi
 * walk-forward, tasks/oos-results.json — Level B κ×2 LL 1,0092).
 */
export const PRODUCTION_MODEL_CONFIG: ModelConfig = {
  kappa: 10,
  kfit: 10,
  halfLifeDays: 365,
  rhoMode: "zero",
  blend: { kind: "james-stein", kappaScale: 2 },
};

export interface TrainingWindow {
  /** Tanggal (YYYY-MM-DD) pertandingan latih paling awal. */
  start: string;
  /** Tanggal (YYYY-MM-DD) pertandingan latih paling akhir. */
  end: string;
  /**
   * match_dates      = dihitung dari baris hasil final di store dataset.
   * artifact-derived = diturunkan dari artefak rating (calibrationDate
   *                    tertua s.d. lastMatchDate tim terbaru) karena store
   *                    dataset tidak tersedia saat pembangunan manifest.
   */
  basis: "match_dates" | "artifact-derived";
}

export interface ModelManifest {
  manifestVersion: 1;
  /** Identitas model yang dicap ke paket/pilihan resmi (kolom model_version K2). */
  modelVersion: string;
  engine: { ratingsVersion: string; implementation: string };
  config: ModelConfig;
  training: {
    totalMatches: number;
    leagueCount: number;
    teamCount: number;
    window: TrainingWindow;
    perLeague: { div: string; matches: number }[];
    /**
     * Catatan populasi (Item 10 sprint A+B, dari rekonsiliasi PR 1A A6):
     * label definisi totalMatches — metadata dokumentasi saja, TIDAK
     * dibaca mesin inferensi dan tidak mengubah angka/parameter apa pun.
     */
    populationNote?: string;
  };
  calibration: { calibrated: number; partial: number; uncalibrated: number; unknown: number };
  /** Hash artefak rating yang dideskripsikan — konvensi sama dengan ratings_marker slate. */
  ratingsHash: string;
  generatedAt: string;
  generatedBy: string;
  codeSha: string | null;
  contentHash: string;
}

// ---------------------------------------------------------------------------
// Hash & serialisasi kanonis
// ---------------------------------------------------------------------------

/** Konvensi hash artefak rating yang sudah dipakai pick-slate (ratings_marker). */
export function ratingsHashOf(ratingsRaw: string): string {
  return `sha256:${createHash("sha256").update(ratingsRaw).digest("hex").slice(0, 16)}`;
}

/** Hash sha256 PENUH artefak — kunci content-addressed store artefak immutable. */
export function ratingsFullHashOf(ratingsRaw: string): string {
  return `sha256:${createHash("sha256").update(ratingsRaw).digest("hex")}`;
}

/** Tulis file secara atomik: temp di direktori yang sama + rename. */
export function writeFileAtomicSync(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`).join(",")}}`;
}

/** Hash isi manifest: semua field kecuali contentHash dan generatedAt. */
export function computeContentHash(manifest: Omit<ModelManifest, "contentHash" | "generatedAt">): string {
  const { ...rest } = manifest as unknown as Record<string, unknown>;
  delete rest.contentHash;
  delete rest.generatedAt;
  return `sha256:${createHash("sha256").update(canonicalStringify(rest)).digest("hex")}`;
}

export function modelVersionFor(config: ModelConfig, ratingsVersion: string): string {
  return `${ratingsVersion}+kfit${config.kfit}+hl${config.halfLifeDays}+rho:${config.rhoMode}+js${config.blend.kappaScale}`;
}

export function serializeManifest(manifest: ModelManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Pembangunan manifest dari artefak rating
// ---------------------------------------------------------------------------

export interface BuildManifestArgs {
  ratingsRaw: string;
  config?: ModelConfig;
  generatedBy: string;
  generatedAt?: string;
  codeSha?: string | null;
  window?: TrainingWindow;
}

export function buildManifest(args: BuildManifestArgs): ModelManifest {
  let ratings: CalibratedRatingsFile;
  try {
    ratings = JSON.parse(args.ratingsRaw) as CalibratedRatingsFile;
  } catch {
    throw new ModelManifestError(
      "manifest_corrupt",
      `${RATINGS_FILENAME} tidak dapat di-parse — manifest tidak dapat dibangun dari artefak rusak.`,
    );
  }
  const config = args.config ?? PRODUCTION_MODEL_CONFIG;
  const leagues = Object.values(ratings.leagues ?? {});
  const perLeague = leagues
    .map((lg) => ({ div: lg.div, matches: lg.totalMatches ?? 0 }))
    .sort((a, b) => a.div.localeCompare(b.div));
  const calibration = { calibrated: 0, partial: 0, uncalibrated: 0, unknown: 0 };
  for (const lg of leagues) {
    const st = lg.calibrationStatus;
    if (st === "calibrated") calibration.calibrated++;
    else if (st === "partial") calibration.partial++;
    else if (st === "uncalibrated") calibration.uncalibrated++;
    else calibration.unknown++;
  }
  const base: Omit<ModelManifest, "contentHash" | "generatedAt"> = {
    manifestVersion: 1,
    modelVersion: modelVersionFor(config, ratings.version),
    engine: { ratingsVersion: ratings.version, implementation: "dixon-coles-ipf" },
    config,
    training: {
      totalMatches: perLeague.reduce((s, l) => s + l.matches, 0),
      leagueCount: perLeague.length,
      teamCount: leagues.reduce((s, lg) => s + Object.keys(lg.teams ?? {}).length, 0),
      window: args.window ?? trainingWindowFromArtifact(ratings),
      perLeague,
      populationNote:
        "totalMatches adalah Σ hitungan per fit — jumlah totalMatches yang tersimpan di tiap fit liga (fit warisan dapat membawa korpus multi-musim), BUKAN cacah baris unik dataset dalam jendela latih.",
    },
    calibration,
    ratingsHash: ratingsHashOf(args.ratingsRaw),
    generatedBy: args.generatedBy,
    codeSha: args.codeSha ?? null,
  };
  return {
    ...base,
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    contentHash: computeContentHash(base),
  };
}

/** Jendela latih dari store dataset (baris hasil final) bila tersedia. */
export function trainingWindowFromDataset(dataDir: string): TrainingWindow | null {
  const dbPath = path.join(dataDir, "thestats_dataset.db");
  if (!fs.existsSync(dbPath)) return null;
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db
        .prepare(
          `SELECT MIN(utc_date) AS s, MAX(utc_date) AS e FROM matches
           WHERE status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL`,
        )
        .get() as { s: string | null; e: string | null } | undefined;
      if (row?.s && row?.e) {
        return { start: row.s.slice(0, 10), end: row.e.slice(0, 10), basis: "match_dates" };
      }
      return null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/** Jendela turunan artefak: calibrationDate tertua → lastMatchDate terbaru. */
export function trainingWindowFromArtifact(ratings: CalibratedRatingsFile): TrainingWindow {
  const leagues = Object.values(ratings.leagues ?? {});
  const calDates = leagues.map((lg) => lg.calibrationDate).filter(Boolean).sort();
  let lastMatch = "";
  for (const lg of leagues) {
    for (const t of Object.values(lg.teams ?? {})) {
      const d = (t.lastMatchDate ?? "").slice(0, 10);
      if (d > lastMatch) lastMatch = d;
    }
  }
  const start = (calDates[0] ?? ratings.compiledAt ?? "").slice(0, 10);
  const end = lastMatch || (calDates[calDates.length - 1] ?? ratings.compiledAt ?? "").slice(0, 10);
  return { start, end, basis: "artifact-derived" };
}

// ---------------------------------------------------------------------------
// Baca + validasi (berhenti bernama — tidak ada fallback diam-diam)
// ---------------------------------------------------------------------------

const REQUIRED_PATHS: [string, (m: unknown) => unknown][] = [
  ["manifestVersion", (m) => (m as ModelManifest).manifestVersion],
  ["modelVersion", (m) => (m as ModelManifest).modelVersion],
  ["engine.ratingsVersion", (m) => (m as ModelManifest).engine?.ratingsVersion],
  ["engine.implementation", (m) => (m as ModelManifest).engine?.implementation],
  ["config.kappa", (m) => (m as ModelManifest).config?.kappa],
  ["config.kfit", (m) => (m as ModelManifest).config?.kfit],
  ["config.halfLifeDays", (m) => (m as ModelManifest).config?.halfLifeDays],
  ["config.rhoMode", (m) => (m as ModelManifest).config?.rhoMode],
  ["config.blend.kind", (m) => (m as ModelManifest).config?.blend?.kind],
  ["config.blend.kappaScale", (m) => (m as ModelManifest).config?.blend?.kappaScale],
  ["training.totalMatches", (m) => (m as ModelManifest).training?.totalMatches],
  ["training.leagueCount", (m) => (m as ModelManifest).training?.leagueCount],
  ["training.teamCount", (m) => (m as ModelManifest).training?.teamCount],
  ["training.window.start", (m) => (m as ModelManifest).training?.window?.start],
  ["training.window.end", (m) => (m as ModelManifest).training?.window?.end],
  ["training.window.basis", (m) => (m as ModelManifest).training?.window?.basis],
  ["training.perLeague", (m) => (m as ModelManifest).training?.perLeague],
  ["calibration.calibrated", (m) => (m as ModelManifest).calibration?.calibrated],
  ["calibration.partial", (m) => (m as ModelManifest).calibration?.partial],
  ["calibration.uncalibrated", (m) => (m as ModelManifest).calibration?.uncalibrated],
  ["calibration.unknown", (m) => (m as ModelManifest).calibration?.unknown],
  ["ratingsHash", (m) => (m as ModelManifest).ratingsHash],
  ["generatedAt", (m) => (m as ModelManifest).generatedAt],
  ["generatedBy", (m) => (m as ModelManifest).generatedBy],
  ["contentHash", (m) => (m as ModelManifest).contentHash],
];

export function parseManifest(raw: string, source: string): ModelManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ModelManifestError("manifest_corrupt", `Manifest di ${source} bukan JSON valid.`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new ModelManifestError("manifest_corrupt", `Manifest di ${source} bukan objek JSON.`);
  }
  for (const [field, get] of REQUIRED_PATHS) {
    const v = get(parsed);
    if (v === undefined || v === null) {
      throw new ModelManifestError(
        "manifest_field_missing",
        `Manifest di ${source} kehilangan field wajib: ${field}.`,
      );
    }
  }
  const manifest = parsed as ModelManifest;
  if (manifest.manifestVersion !== 1) {
    throw new ModelManifestError(
      "manifest_corrupt",
      `Versi skema manifest tidak didukung: ${String(manifest.manifestVersion)} (harapan 1).`,
    );
  }
  const expect = computeContentHash(manifest);
  if (expect !== manifest.contentHash) {
    throw new ModelManifestError(
      "manifest_hash_mismatch",
      `contentHash manifest di ${source} tidak cocok (isi berubah sejak dibangun). Harapan ${expect}, tercatat ${manifest.contentHash}.`,
    );
  }
  return manifest;
}

export function loadManifestFile(filePath: string): ModelManifest {
  if (!fs.existsSync(filePath)) {
    throw new ModelManifestError(
      "manifest_missing",
      `Manifest model tidak ditemukan: ${filePath}. Bangun lewat scripts/build-model-manifest.ts (kandidat) dan promosikan lewat scripts/promote-model.ts — tidak ada fallback identitas model.`,
    );
  }
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    throw new ModelManifestError(
      "manifest_corrupt",
      `Manifest di ${filePath} tidak dapat dibaca: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return parseManifest(raw, filePath);
}

export function loadActiveManifest(dataDir: string): ModelManifest {
  return loadManifestFile(path.join(dataDir, ACTIVE_MANIFEST_FILENAME));
}

export function loadCandidateManifest(dataDir: string): ModelManifest {
  return loadManifestFile(path.join(dataDir, CANDIDATE_MANIFEST_FILENAME));
}

/** Verifikasi ketat: manifest harus mendeskripsikan PERSIS artefak rating ini. */
export function verifyManifestRatings(manifest: ModelManifest, ratingsRaw: string): void {
  const actual = ratingsHashOf(ratingsRaw);
  if (actual !== manifest.ratingsHash) {
    throw new ModelManifestError(
      "manifest_ratings_mismatch",
      `Hash artefak rating tidak cocok dengan manifest ${manifest.modelVersion}: manifest mencatat ${manifest.ratingsHash}, artefak saat ini ${actual}.`,
    );
  }
}

export function readRatingsRaw(dataDir: string): string {
  const p = path.join(dataDir, RATINGS_FILENAME);
  if (!fs.existsSync(p)) {
    throw new ModelManifestError("manifest_missing", `Artefak rating tidak ditemukan: ${p}.`);
  }
  return fs.readFileSync(p, "utf8");
}

// ---------------------------------------------------------------------------
// Store artefak immutable (fix-5) — bobot per hash, tidak pernah ditimpa
// ---------------------------------------------------------------------------

export const ARTIFACTS_DIRNAME = "model-artifacts";
const ARTIFACT_FILE_RE = /^ratings-([0-9a-f]{64})\.json$/;

export function artifactsDir(dataDir: string): string {
  return path.join(dataDir, ARTIFACTS_DIRNAME);
}

export function artifactFileName(fullHash: string): string {
  return `ratings-${fullHash.replace(/^sha256:/, "")}.json`;
}

export function artifactPath(dataDir: string, fullHash: string): string {
  return path.join(artifactsDir(dataDir), artifactFileName(fullHash));
}

export interface StoredArtifact {
  /** Path file artefak di store. */
  file: string;
  /** sha256 penuh isi artefak ("sha256:<64 hex>"). */
  fullHash: string;
  /** Konvensi hash pendek manifest/ratings_marker ("sha256:<16 hex>"). */
  ratingsHash: string;
  /** true bila file baru dibuat; false bila artefak identik sudah ada. */
  created: boolean;
}

/**
 * Simpan bobot sebagai artefak immutable content-addressed. Isi yang
 * sama → file yang sama (no-op terverifikasi); file bernama hash yang
 * isinya tidak cocok dengan hash-nya = store rusak → artifact_conflict.
 * Artefak yang sudah ada TIDAK PERNAH ditimpa.
 */
export function storeRatingsArtifact(dataDir: string, ratingsRaw: string): StoredArtifact {
  try {
    JSON.parse(ratingsRaw);
  } catch {
    throw new ModelManifestError(
      "manifest_corrupt",
      `${RATINGS_FILENAME} tidak dapat di-parse — artefak tidak disimpan.`,
    );
  }
  const fullHash = ratingsFullHashOf(ratingsRaw);
  const file = artifactPath(dataDir, fullHash);
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, "utf8");
    if (ratingsFullHashOf(existing) !== fullHash) {
      throw new ModelManifestError(
        "artifact_conflict",
        `Artefak ${file} sudah ada tetapi isinya tidak cocok dengan hash namanya — store artefak rusak/diubah manual.`,
      );
    }
    return { file, fullHash, ratingsHash: ratingsHashOf(ratingsRaw), created: false };
  }
  fs.mkdirSync(artifactsDir(dataDir), { recursive: true });
  writeFileAtomicSync(file, ratingsRaw);
  return { file, fullHash, ratingsHash: ratingsHashOf(ratingsRaw), created: true };
}

export interface ResolvedArtifact {
  raw: string;
  file: string;
  fullHash: string;
}

/**
 * Resolusi pointer: temukan artefak yang dirujuk manifest (ratingsHash)
 * di store dan VALIDASI isinya (hash pendek cocok dengan manifest DAN
 * hash penuh cocok dengan nama file). Artefak tidak ada →
 * artifact_missing; berkas ber-prefix cocok tapi isi berubah →
 * manifest_ratings_mismatch. Tidak ada fallback ke file lepas.
 */
export function resolveRatingsArtifact(dataDir: string, manifest: ModelManifest): ResolvedArtifact {
  const dir = artifactsDir(dataDir);
  const prefix = manifest.ratingsHash.replace(/^sha256:/, "");
  let names: string[] = [];
  if (fs.existsSync(dir)) {
    names = fs.readdirSync(dir).filter((n) => {
      const m = ARTIFACT_FILE_RE.exec(n);
      return m !== null && m[1].startsWith(prefix);
    });
  }
  if (names.length === 0) {
    throw new ModelManifestError(
      "artifact_missing",
      `Artefak rating untuk ${manifest.modelVersion} (${manifest.ratingsHash}) tidak ada di store ${dir}. ` +
        `Jalur fit/build-model-manifest menyimpan artefak saat membangun manifest — store kosong/rusak tidak pernah digantikan file lepas.`,
    );
  }
  for (const name of names.sort()) {
    const file = path.join(dir, name);
    const raw = fs.readFileSync(file, "utf8");
    const fullHash = ratingsFullHashOf(raw);
    if (ratingsHashOf(raw) === manifest.ratingsHash && artifactFileName(fullHash) === name) {
      return { raw, file, fullHash };
    }
  }
  throw new ModelManifestError(
    "manifest_ratings_mismatch",
    `Artefak untuk ${manifest.modelVersion} di store tidak lolos validasi hash terhadap manifest (${manifest.ratingsHash}) — isi artefak berubah sejak disimpan.`,
  );
}

/** Verifikasi ketat berbasis store (pengganti cek file lepas untuk promosi). */
export function verifyManifestArtifact(dataDir: string, manifest: ModelManifest): void {
  resolveRatingsArtifact(dataDir, manifest);
}

export interface ServingModel {
  manifest: ModelManifest;
  ratingsRaw: string;
  ratings: CalibratedRatingsFile;
  artifactFile: string;
  fullHash: string;
}

/**
 * PEMBACAAN POINTER SAJI — satu-satunya pintu bobot untuk jalur saji
 * (pick-slate) dan evaluator. Membaca manifest aktif SATU KALI,
 * menyelesaikan artefak yang dirujuknya dari store immutable,
 * memvalidasi hash, dan mengembalikan identitas + bobot sebagai satu
 * kesatuan: versi dan hash yang dicap ke paket SELALU milik artefak
 * yang sama dengan bobot yang dipakai menghitung. Kegagalan apa pun
 * melempar ModelManifestError berkode SEBELUM penerbitan apa pun.
 */
export function loadServingModel(dataDir: string): ServingModel {
  const manifest = loadActiveManifest(dataDir);
  const resolved = resolveRatingsArtifact(dataDir, manifest);
  let ratings: CalibratedRatingsFile;
  try {
    ratings = JSON.parse(resolved.raw) as CalibratedRatingsFile;
  } catch {
    throw new ModelManifestError(
      "manifest_corrupt",
      `Artefak rating ${resolved.file} tidak dapat di-parse.`,
    );
  }
  return {
    manifest,
    ratingsRaw: resolved.raw,
    ratings,
    artifactFile: resolved.file,
    fullHash: resolved.fullHash,
  };
}

// ---------------------------------------------------------------------------
// Penjaga point-in-time (fix-5) — jendela latih artefak vs jam keputusan
// ---------------------------------------------------------------------------

export interface PointInTimeViolation {
  decisionAt: string;
  decisionDate: string;
  trainingWindowEnd: string;
}

/**
 * Keputusan pada tanggal D hanya point-in-time bila SELURUH data latih
 * artefak berasal dari laga bertanggal < D: jendela latih berakhir pada
 * tanggal laga terakhir yang masuk fit, dan tanggal saja tidak
 * membuktikan jam ketersediaan hasil hari yang sama — maka pelanggaran
 * iff window.end >= tanggal keputusan (konservatif, dinyatakan terbuka).
 */
export function pointInTimeViolations(
  manifest: ModelManifest,
  decisionAts: readonly string[],
): PointInTimeViolation[] {
  const end = manifest.training.window.end;
  const out: PointInTimeViolation[] = [];
  for (const decisionAt of decisionAts) {
    const decisionDate = String(decisionAt).slice(0, 10);
    if (decisionDate && end >= decisionDate) {
      out.push({ decisionAt, decisionDate, trainingWindowEnd: end });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tulis kandidat / aktif
// ---------------------------------------------------------------------------

export interface WriteCandidateOptions {
  config?: ModelConfig;
  generatedBy?: string;
  codeSha?: string | null;
}

/**
 * Jalur fit memanggil ini SETIAP selesai menulis artefak rating: bobot
 * disimpan sebagai artefak IMMUTABLE di store (fix-5), lalu manifest
 * kandidat dibangun dari byte yang sama persis sehingga selalu
 * mendeskripsikan artefak yang tersimpan. Manifest AKTIF tidak disentuh
 * di sini — promosi hanya lewat gerbang (scripts/promote-model.ts).
 * Konfigurasi diambil dari opsi, atau diwarisi dari kandidat/aktif yang
 * ada, atau default produksi.
 */
export function writeCandidateManifest(dataDir: string, opts: WriteCandidateOptions = {}): ModelManifest {
  const ratingsRaw = readRatingsRaw(dataDir);
  storeRatingsArtifact(dataDir, ratingsRaw);
  let inherited: ModelConfig | undefined;
  let inheritedWindow: TrainingWindow | undefined;
  for (const loader of [loadCandidateManifest, loadActiveManifest]) {
    try {
      const prev = loader(dataDir);
      inherited = prev.config;
      inheritedWindow = prev.training.window;
      break;
    } catch {
      /* belum ada manifest — lanjut ke default */
    }
  }
  const window =
    trainingWindowFromDataset(dataDir) ??
    (inheritedWindow?.basis === "match_dates" ? inheritedWindow : undefined);
  const manifest = buildManifest({
    ratingsRaw,
    config: opts.config ?? inherited ?? PRODUCTION_MODEL_CONFIG,
    generatedBy: opts.generatedBy ?? "fit-path",
    codeSha: opts.codeSha ?? null,
    window,
  });
  writeFileAtomicSync(path.join(dataDir, CANDIDATE_MANIFEST_FILENAME), serializeManifest(manifest));
  return manifest;
}

/**
 * Satu-satunya penulis manifest aktif selain bootstrap builder: gerbang
 * promosi. Pointer berpindah ATOMIK (tulis temp + rename di direktori
 * yang sama) — pembaca pointer tidak pernah melihat manifest setengah
 * tertulis, dan artefak yang dirujuk pointer baru sudah tersimpan di
 * store sebelum flip (diverifikasi gerbang).
 */
export function writeActiveManifest(dataDir: string, manifest: ModelManifest): void {
  writeFileAtomicSync(path.join(dataDir, ACTIVE_MANIFEST_FILENAME), serializeManifest(manifest));
}
