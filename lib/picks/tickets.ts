import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { getPicksDb } from "./ledger";
import { getPackagesDb } from "./packages";
import { ensurePublicationSchema } from "./publication";
import {
  getFixtureByUid,
  getUidForMatchId,
  identityTablesExist,
} from "../identity/fixture-resolver";
import { getTheStatsDb } from "../db/thestats-dataset";
import { selectionPredicate } from "../web/parlay";
import { statusFeedKompetisi } from "./feed-coverage";
import { SETTLEMENT_WINDOW_MS } from "./cohort";

// ============================================================================
// TIKET RESMI — slip yang diterbitkan server (PRD bab Data D4, kartu K3)
// ----------------------------------------------------------------------------
// Tiket resmi berbeda dari slip yang disusun sendiri di browser: ia hanya
// berisi pilihan RESMI (baris ledger berkomitmen K2, pick_uid terisi),
// diterbitkan dalam SATU transaksi ledger bersama seluruh anggotanya, dan
// komposisinya BEKU sejak terbit. Mengganti satu anggota berarti tiket
// baru (slot/edisi lain) — tiket lama tidak pernah ditulis ulang.
//
// Status tiket DITURUNKAN dari hasil anggota (bukan disimpan sebagai
// vonis): selama masih ada anggota yang belum terminal, status evaluasi
// akhir tetap 'pending' — halaman boleh tahu "sudah ada pilihan yang
// meleset", tetapi vonis akhir tidak diputuskan lebih awal agar waktu
// inklusi adil. Saat semua anggota terminal: ada kekalahan → 'miss';
// semua menang → 'hit'; mengandung void tanpa kekalahan → 'void'.
// Hasil tiket TIDAK masuk statistik pilihan (cohort K2 tidak berubah).
//
// Peluang gabungan (Q01/Q04 + kartu K3):
//   - Alias ganda (laga + pasar + garis + pilihan yang sama) dihitung
//     SATU kali — pilihan 80% yang sama tetap 80%, bukan 64%.
//   - Dua predikat dari laga yang sama digabung PERSIS dari irisan
//     matriks skor paket asal (metode yang sama dengan lib/web/parlay.ts).
//     Matriks hilang → gabungan TIDAK bisa dihitung: combined_prob NULL
//     dengan alasan 'joint_unavailable'. Tidak ada perkalian diam-diam.
//   - Laga berbeda digabung dengan asumsi independensi (produk).
//   - Tim yang sama bermain dua kali dalam jendela singkat (≤ 72 jam,
//     keputusan implementasi K3 — dokumen tidak menyebut angka) adalah
//     ketergantungan yang tidak dimodelkan matriks: gabungan tampil
//     sebagai RENTANG antara skenario independensi dan skenario gabungan
//     penuh (kelompok = probabilitas anggota terlemahnya). Tiket tidak
//     diblokir; ketergantungannya ditandai dan yang terkuat disorot.
// ============================================================================

/** Versi kebijakan status tiket (aturan final-tertunda D4). */
export const SLIP_POLICY_VERSION = "slip-status-2026-11";

/** Jendela "tim sama bermain dua kali" untuk penanda ketergantungan. */
export const SAME_TEAM_WINDOW_MS = 72 * 3_600_000;

// ---------------------------------------------------------------------------
// Skema aditif (D4) — idempoten.
// ---------------------------------------------------------------------------

export function ensureTicketSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS published_slips (
      slip_uid TEXT PRIMARY KEY,
      edition_key TEXT NOT NULL,
      slot TEXT NOT NULL,
      series TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'official',
      published_utc TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      combined_prob REAL,
      combined_low REAL,
      combined_high REAL,
      combined_basis TEXT NOT NULL,
      combined_reason TEXT,
      combined_detail TEXT,
      state TEXT NOT NULL DEFAULT 'pending',
      created_utc TEXT NOT NULL,
      UNIQUE (series, edition_key, slot)
    );
    CREATE TABLE IF NOT EXISTS slip_legs (
      slip_uid TEXT NOT NULL REFERENCES published_slips(slip_uid),
      position INTEGER NOT NULL,
      pick_uid TEXT NOT NULL,
      pick_id INTEGER NOT NULL REFERENCES picks(id),
      fixture_uid TEXT,
      package_ref TEXT,
      frozen_prob REAL,
      PRIMARY KEY (slip_uid, position),
      UNIQUE (slip_uid, pick_uid)
    );
    CREATE INDEX IF NOT EXISTS idx_slip_legs_pick ON slip_legs(pick_id);
    CREATE INDEX IF NOT EXISTS idx_slip_legs_fixture ON slip_legs(fixture_uid);
  `);
}

// ---------------------------------------------------------------------------
// Util transaksi (pola yang sama dengan publication.ts): BEGIN IMMEDIATE
// dengan retry terbatas atas SQLITE_BUSY.
// ---------------------------------------------------------------------------

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isBusy(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("database is locked") || msg.includes("SQLITE_BUSY");
}

function beginImmediate(db: DatabaseSync): void {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      db.exec("BEGIN IMMEDIATE");
      return;
    } catch (err) {
      if (!isBusy(err) || attempt === 199) throw err;
      sleepSync(25);
    }
  }
}

function safeRollback(db: DatabaseSync): void {
  try {
    db.exec("ROLLBACK");
  } catch {
    /* transaksi sudah tertutup — error asli yang berlaku */
  }
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function slipUidOf(series: string, editionKey: string, slot: string): string {
  return `sl_${sha256(`${series}|${editionKey}|${slot}`).slice(0, 32)}`;
}

// ---------------------------------------------------------------------------
// Peluang gabungan — fungsi murni (diexport agar bisa diuji langsung).
// ---------------------------------------------------------------------------

export interface CombinedLegInput {
  pick_uid: string;
  /** Kunci laga fisik: fixture_uid, atau match_id bila UID belum ada. */
  fixture_key: string;
  market: string;
  line: string;
  selection: string;
  /** Peluang beku saat terbit (published_prob pilihan resmi). */
  frozen_prob: number | null;
  /** Matriks skor paket asal leg ini, bila paket menyimpannya. */
  matrix?: number[][] | null;
  kickoff_utc: string | null;
  home_cid?: string | null;
  away_cid?: string | null;
}

export type CombinedBasis =
  | "independence"
  | "matrix_intersection"
  | "dependency_range"
  | "joint_unavailable";

export interface DependencyGroup {
  kind: "same_fixture" | "same_team_window";
  fixture_keys: string[];
  pick_uids: string[];
  /** Tim bersama (kind same_team_window). */
  teams?: string[];
  /** Selisih skenario: seberapa besar ketergantungan menggeser angka. */
  impact: number | null;
  note: string;
}

export interface CombinedResult {
  /** Nilai skenario independensi (matriks eksak di dalam satu laga). */
  combined_prob: number | null;
  combined_low: number | null;
  combined_high: number | null;
  basis: CombinedBasis;
  /** Alasan bila combined_prob NULL ('joint_unavailable' | 'leg_prob_unrecorded'). */
  reason: string | null;
  scenarios: { independence: number | null; full_joint: number | null };
  groups: DependencyGroup[];
  strongest_dependency: DependencyGroup | null;
  dropped_duplicates: {
    pick_uid: string;
    fixture_key: string;
    market: string;
    selection: string;
    reason: "alias_duplicate";
  }[];
  /** Leg yang benar-benar dihitung (sesudah dedup alias). */
  effective_legs: CombinedLegInput[];
}

function validProb(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
}

/** Irisan matriks: jumlah sel yang memenuhi SEMUA predikat sekaligus. */
function matrixIntersection(
  matrix: number[][],
  legs: CombinedLegInput[],
): number | null {
  const preds = legs.map((l) => selectionPredicate(l.market, l.selection));
  if (preds.some((p) => p === null)) return null;
  let sum = 0;
  for (let h = 0; h < matrix.length; h++) {
    const row = matrix[h];
    if (!row) continue;
    for (let a = 0; a < row.length; a++) {
      if (preds.every((p) => p!(h, a))) sum += row[a] ?? 0;
    }
  }
  return sum;
}

interface FixtureGroupCalc {
  fixture_key: string;
  legs: CombinedLegInput[];
  /** Joint titik grup ini; null bila tidak bisa dihitung. */
  joint: number | null;
  basis: "frozen_prob" | "matrix_intersection" | "joint_unavailable";
  reason: string | null;
  product_of_marginals: number | null;
}

export function computeCombined(legs: CombinedLegInput[]): CombinedResult {
  // --- Dedup alias: laga + pasar + garis + pilihan yang sama = satu leg.
  const seen = new Map<string, CombinedLegInput>();
  const dropped: CombinedResult["dropped_duplicates"] = [];
  for (const leg of legs) {
    const key = `${leg.fixture_key}|${leg.market}|${leg.line}|${leg.selection}`;
    if (seen.has(key)) {
      dropped.push({
        pick_uid: leg.pick_uid,
        fixture_key: leg.fixture_key,
        market: leg.market,
        selection: leg.selection,
        reason: "alias_duplicate",
      });
      continue;
    }
    seen.set(key, leg);
  }
  const effective = [...seen.values()];

  // --- Grup per laga.
  const byFixture = new Map<string, CombinedLegInput[]>();
  for (const leg of effective) {
    const arr = byFixture.get(leg.fixture_key);
    if (arr) arr.push(leg);
    else byFixture.set(leg.fixture_key, [leg]);
  }
  const fixtureGroups: FixtureGroupCalc[] = [];
  for (const [fixtureKey, gLegs] of byFixture) {
    const marginals = gLegs.map((l) => l.frozen_prob);
    const product = marginals.every(validProb)
      ? marginals.reduce((acc, v) => acc * (v as number), 1)
      : null;
    if (gLegs.length === 1) {
      const p = gLegs[0].frozen_prob;
      fixtureGroups.push({
        fixture_key: fixtureKey,
        legs: gLegs,
        joint: validProb(p) ? p : null,
        basis: "frozen_prob",
        reason: validProb(p) ? null : "leg_prob_unrecorded",
        product_of_marginals: product,
      });
      continue;
    }
    // Multi-leg satu laga: HANYA irisan matriks yang sah (Q04).
    const matrix = gLegs.find((l) => l.matrix)?.matrix ?? null;
    const joint = matrix ? matrixIntersection(matrix, gLegs) : null;
    fixtureGroups.push({
      fixture_key: fixtureKey,
      legs: gLegs,
      joint,
      basis: joint !== null ? "matrix_intersection" : "joint_unavailable",
      reason: joint !== null ? null : "joint_unavailable",
      product_of_marginals: product,
    });
  }

  const groups: DependencyGroup[] = [];
  for (const g of fixtureGroups) {
    if (g.legs.length < 2) continue;
    groups.push({
      kind: "same_fixture",
      fixture_keys: [g.fixture_key],
      pick_uids: g.legs.map((l) => l.pick_uid),
      impact:
        g.joint !== null && g.product_of_marginals !== null
          ? Math.abs(g.product_of_marginals - g.joint)
          : null,
      note:
        g.joint !== null
          ? "Dua predikat satu laga digabung persis dari irisan matriks skor."
          : "Matriks skor tidak tersedia — peluang gabungan laga ini tidak bisa dihitung (joint_unavailable).",
    });
  }

  // Ada grup yang tidak bisa dihitung → seluruh gabungan tidak terbit angka.
  const unavailable = fixtureGroups.find((g) => g.joint === null);
  if (unavailable) {
    return {
      combined_prob: null,
      combined_low: null,
      combined_high: null,
      basis: "joint_unavailable",
      reason: unavailable.reason ?? "joint_unavailable",
      scenarios: { independence: null, full_joint: null },
      groups,
      strongest_dependency: null,
      dropped_duplicates: dropped,
      effective_legs: effective,
    };
  }

  // --- Kelompok tim-sama-jendela-singkat antar laga (graf keterhubungan).
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const g of fixtureGroups) parent.set(g.fixture_key, g.fixture_key);
  const teamsOf = (g: FixtureGroupCalc): Set<string> => {
    const s = new Set<string>();
    for (const l of g.legs) {
      if (l.home_cid) s.add(l.home_cid);
      if (l.away_cid) s.add(l.away_cid);
    }
    return s;
  };
  const sharedTeams = new Map<string, Set<string>>(); // root -> tim bersama
  for (let i = 0; i < fixtureGroups.length; i++) {
    for (let j = i + 1; j < fixtureGroups.length; j++) {
      const a = fixtureGroups[i];
      const b = fixtureGroups[j];
      const shared = [...teamsOf(a)].filter((t) => teamsOf(b).has(t));
      if (shared.length === 0) continue;
      const ka = a.legs[0].kickoff_utc ? Date.parse(a.legs[0].kickoff_utc) : NaN;
      const kb = b.legs[0].kickoff_utc ? Date.parse(b.legs[0].kickoff_utc) : NaN;
      if (!Number.isFinite(ka) || !Number.isFinite(kb)) continue;
      if (Math.abs(ka - kb) > SAME_TEAM_WINDOW_MS) continue;
      const ra = find(a.fixture_key);
      const rb = find(b.fixture_key);
      if (ra !== rb) {
        parent.set(ra, rb);
        const acc = sharedTeams.get(rb) ?? new Set<string>();
        for (const t of shared) acc.add(t);
        sharedTeams.set(rb, acc);
        if (sharedTeams.has(ra)) {
          for (const t of sharedTeams.get(ra)!) acc.add(t);
          sharedTeams.delete(ra);
        }
      } else {
        const acc = sharedTeams.get(ra) ?? new Set<string>();
        for (const t of shared) acc.add(t);
        sharedTeams.set(ra, acc);
      }
    }
  }
  const components = new Map<string, FixtureGroupCalc[]>();
  for (const g of fixtureGroups) {
    const r = find(g.fixture_key);
    const arr = components.get(r);
    if (arr) arr.push(g);
    else components.set(r, [g]);
  }

  // --- Skenario per komponen, lalu gabungan tiket.
  let independence = 1;
  let fullJoint = 1;
  let hasRange = false;
  let hasMatrix = false;
  for (const comp of components.values()) {
    const joints = comp.map((g) => g.joint as number);
    const compIndep = joints.reduce((acc, v) => acc * v, 1);
    independence *= compIndep;
    if (comp.length === 1) {
      fullJoint *= compIndep;
      if (comp[0].basis === "matrix_intersection") hasMatrix = true;
      continue;
    }
    const compFull = Math.min(...joints);
    fullJoint *= compFull;
    hasRange = true;
    const root = find(comp[0].fixture_key);
    groups.push({
      kind: "same_team_window",
      fixture_keys: comp.map((g) => g.fixture_key),
      pick_uids: comp.flatMap((g) => g.legs.map((l) => l.pick_uid)),
      teams: [...(sharedTeams.get(root) ?? new Set<string>())],
      impact: Math.abs(compFull - compIndep),
      note: "Tim yang sama bermain dua kali dalam ≤72 jam — ketergantungan tidak dimodelkan; gabungan ditampilkan sebagai rentang skenario independensi…gabungan penuh.",
    });
  }

  const low = Math.min(independence, fullJoint);
  const high = Math.max(independence, fullJoint);
  const basis: CombinedBasis = hasRange
    ? "dependency_range"
    : hasMatrix
      ? "matrix_intersection"
      : "independence";
  const strongest =
    groups.length > 0
      ? [...groups].sort((a, b) => (b.impact ?? -1) - (a.impact ?? -1))[0]
      : null;

  return {
    combined_prob: independence,
    combined_low: low,
    combined_high: high,
    basis,
    reason: null,
    scenarios: { independence, full_joint: fullJoint },
    groups,
    strongest_dependency: strongest,
    dropped_duplicates: dropped,
    effective_legs: effective,
  };
}

// ---------------------------------------------------------------------------
// Jalur terbit — satu transaksi ledger.
// ---------------------------------------------------------------------------

export interface PublishSlipInput {
  edition_key: string;
  slot: string;
  series: string;
  /** Waktu terbit server (ISO UTC); harus mendahului kickoff setiap leg. */
  published_utc: string;
  /** Id baris picks anggota, berurutan (posisi = urutan array). */
  pick_ids: number[];
  source?: string;
  policy_version?: string;
}

export type PublishSlipStatus = "published" | "already_published" | "rejected";

export interface PublishSlipResult {
  status: PublishSlipStatus;
  slip_uid: string | null;
  reason?: string;
  combined?: CombinedResult;
}

interface PickSlipRow {
  id: number;
  pick_uid: string | null;
  fixture_uid: string | null;
  match_id: string;
  market: string;
  line: string | null;
  selection: string;
  kickoff_utc: string | null;
  published_prob: number | null;
  published_at_utc: string | null;
  package_id: number | null;
  package_key: string | null;
  duplicate_of: number | null;
}

/** Matriks skor dari payload paket asal leg (null bila paket tak menyimpan). */
function matrixOfPackage(packageId: number | null): number[][] | null {
  if (packageId === null) return null;
  try {
    const row = getPackagesDb()
      .prepare("SELECT payload_json FROM packages WHERE id = ?")
      .get(packageId) as { payload_json: string } | undefined;
    if (!row) return null;
    const payload = JSON.parse(row.payload_json) as {
      score_matrix?: unknown;
    };
    return Array.isArray(payload.score_matrix)
      ? (payload.score_matrix as number[][])
      : null;
  } catch {
    return null;
  }
}

/** Metadata tim dari store identitas K1 (degrade diam-diam bila belum ada). */
function teamMetaOf(
  fixtureUid: string | null,
  matchId: string,
): { home_cid: string | null; away_cid: string | null } {
  try {
    const ds = getTheStatsDb();
    if (!identityTablesExist(ds)) return { home_cid: null, away_cid: null };
    const uid = fixtureUid ?? getUidForMatchId(ds, matchId);
    if (!uid) return { home_cid: null, away_cid: null };
    const fx = getFixtureByUid(ds, uid);
    return {
      home_cid: fx?.home_cid ?? null,
      away_cid: fx?.away_cid ?? null,
    };
  } catch {
    return { home_cid: null, away_cid: null };
  }
}

export function publishSlip(input: PublishSlipInput): PublishSlipResult {
  if (input.pick_ids.length === 0) {
    throw new Error("publishSlip: pick_ids kosong — tiket tanpa anggota tidak sah");
  }
  const db = getPicksDb();
  ensurePublicationSchema(db);
  ensureTicketSchema(db);
  db.exec("PRAGMA busy_timeout = 10000");

  const slipUid = slipUidOf(input.series, input.edition_key, input.slot);
  const policyVersion = input.policy_version ?? SLIP_POLICY_VERSION;

  beginImmediate(db);
  try {
    // Slot/edisi dalam satu seri hanya boleh diisi SATU tiket resmi.
    const existing = db
      .prepare(
        "SELECT slip_uid FROM published_slips WHERE series = ? AND edition_key = ? AND slot = ?",
      )
      .get(input.series, input.edition_key, input.slot) as
      | { slip_uid: string }
      | undefined;

    // Muat + validasi anggota: hanya pilihan resmi berkomitmen K2.
    const loadPick = db.prepare("SELECT * FROM picks WHERE id = ?");
    const legs: { pick: PickSlipRow; combined: CombinedLegInput }[] = [];
    for (const pickId of input.pick_ids) {
      const pick = loadPick.get(pickId) as PickSlipRow | undefined;
      if (!pick) {
        db.exec("COMMIT");
        return { status: "rejected", slip_uid: null, reason: "leg_not_found" };
      }
      if (!pick.pick_uid || pick.duplicate_of !== null) {
        db.exec("COMMIT");
        return { status: "rejected", slip_uid: null, reason: "leg_not_official" };
      }
      if (!pick.kickoff_utc || !(input.published_utc < pick.kickoff_utc)) {
        db.exec("COMMIT");
        return {
          status: "rejected",
          slip_uid: null,
          reason: "leg_kickoff_reached",
        };
      }
      const meta = teamMetaOf(pick.fixture_uid, pick.match_id);
      legs.push({
        pick,
        combined: {
          pick_uid: pick.pick_uid,
          fixture_key: pick.fixture_uid ?? pick.match_id,
          market: pick.market,
          line: pick.line ?? "",
          selection: pick.selection,
          frozen_prob: pick.published_prob,
          matrix: matrixOfPackage(pick.package_id),
          kickoff_utc: pick.kickoff_utc,
          home_cid: meta.home_cid,
          away_cid: meta.away_cid,
        },
      });
    }

    const combined = computeCombined(legs.map((l) => l.combined));
    const effectiveUids = combined.effective_legs.map((l) => l.pick_uid);

    if (existing) {
      const existingLegs = db
        .prepare(
          "SELECT pick_uid FROM slip_legs WHERE slip_uid = ? ORDER BY position ASC",
        )
        .all(existing.slip_uid) as unknown as { pick_uid: string }[];
      const sameMembers =
        JSON.stringify(existingLegs.map((r) => r.pick_uid)) ===
        JSON.stringify(effectiveUids);
      db.exec("COMMIT");
      if (sameMembers) {
        return {
          status: "already_published",
          slip_uid: existing.slip_uid,
          combined,
        };
      }
      return { status: "rejected", slip_uid: null, reason: "slot_taken" };
    }

    const detail = {
      groups: combined.groups,
      strongest_dependency: combined.strongest_dependency,
      scenarios: combined.scenarios,
      dropped_duplicates: combined.dropped_duplicates,
    };
    db.prepare(
      `INSERT INTO published_slips
         (slip_uid, edition_key, slot, series, source, published_utc,
          policy_version, combined_prob, combined_low, combined_high,
          combined_basis, combined_reason, combined_detail, state, created_utc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    ).run(
      slipUid,
      input.edition_key,
      input.slot,
      input.series,
      input.source ?? "official",
      input.published_utc,
      policyVersion,
      combined.combined_prob,
      combined.combined_low,
      combined.combined_high,
      combined.basis,
      combined.reason,
      JSON.stringify(detail),
      input.published_utc,
    );
    const insertLeg = db.prepare(
      `INSERT INTO slip_legs
         (slip_uid, position, pick_uid, pick_id, fixture_uid, package_ref, frozen_prob)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    combined.effective_legs.forEach((leg, i) => {
      const src = legs.find((l) => l.combined.pick_uid === leg.pick_uid)!.pick;
      insertLeg.run(
        slipUid,
        i,
        leg.pick_uid,
        src.id,
        src.fixture_uid,
        src.package_key ?? (src.package_id !== null ? String(src.package_id) : null),
        leg.frozen_prob,
      );
    });
    db.exec("COMMIT");
    return { status: "published", slip_uid: slipUid, combined };
  } catch (err) {
    safeRollback(db);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Status turunan + jalur baca.
// ---------------------------------------------------------------------------

export type SlipLegState = "hit" | "miss" | "void" | "pending";
export type SlipState = "hit" | "miss" | "void" | "pending";

/**
 * Aturan status D4: vonis akhir TERTUNDA selama ada anggota belum
 * terminal. Semua terminal: ada miss → 'miss'; semua hit → 'hit';
 * ada void tanpa miss → 'void'.
 */
export function slipStateOf(legStates: SlipLegState[]): SlipState {
  if (legStates.length === 0) return "pending";
  if (legStates.some((s) => s === "pending")) return "pending";
  if (legStates.some((s) => s === "miss")) return "miss";
  if (legStates.some((s) => s === "void")) return "void";
  return "hit";
}

export interface SlipLegView {
  position: number;
  pick_uid: string;
  pick_id: number;
  fixture_uid: string | null;
  package_ref: string | null;
  frozen_prob: number | null;
  market: string;
  selection: string;
  state: SlipLegState;
  home_goals: number | null;
  away_goals: number | null;
}

export interface OfficialSlipView {
  slip_uid: string;
  edition_key: string;
  slot: string;
  series: string;
  source: string;
  published_utc: string;
  policy_version: string;
  combined_prob: number | null;
  combined_low: number | null;
  combined_high: number | null;
  combined_basis: string;
  combined_reason: string | null;
  combined_detail: {
    groups: DependencyGroup[];
    strongest_dependency: DependencyGroup | null;
    scenarios: { independence: number | null; full_joint: number | null };
    dropped_duplicates: CombinedResult["dropped_duplicates"];
  } | null;
  /** Status turunan TERKINI dari hasil anggota (bukan kolom tersimpan). */
  state: SlipState;
  /** Info tampilan: sudah ada anggota meleset walau vonis akhir tertunda. */
  has_missed_leg: boolean;
  legs: SlipLegView[];
}

interface SlipRow {
  slip_uid: string;
  edition_key: string;
  slot: string;
  series: string;
  source: string;
  published_utc: string;
  policy_version: string;
  combined_prob: number | null;
  combined_low: number | null;
  combined_high: number | null;
  combined_basis: string;
  combined_reason: string | null;
  combined_detail: string | null;
}

function legStatesFor(db: DatabaseSync, slipUid: string): SlipLegView[] {
  const rows = db
    .prepare(
      `SELECT l.position, l.pick_uid, l.pick_id, l.fixture_uid, l.package_ref,
              l.frozen_prob, p.market, p.selection,
              o.home_goals, o.away_goals, o.hit, v.pick_id AS voided
       FROM slip_legs l
       JOIN picks p ON p.id = l.pick_id
       LEFT JOIN pick_outcomes o ON o.pick_id = l.pick_id
       LEFT JOIN pick_voids v ON v.pick_id = l.pick_id
       WHERE l.slip_uid = ?
       ORDER BY l.position ASC`,
    )
    .all(slipUid) as unknown as Record<string, unknown>[];
  return rows.map((r) => {
    const voided = r.voided !== null && r.voided !== undefined;
    const hit = r.hit as number | null;
    const state: SlipLegState = voided
      ? "void"
      : hit === null || hit === undefined
        ? "pending"
        : hit === 1
          ? "hit"
          : "miss";
    return {
      position: r.position as number,
      pick_uid: r.pick_uid as string,
      pick_id: r.pick_id as number,
      fixture_uid: (r.fixture_uid as string | null) ?? null,
      package_ref: (r.package_ref as string | null) ?? null,
      frozen_prob: (r.frozen_prob as number | null) ?? null,
      market: r.market as string,
      selection: r.selection as string,
      state,
      home_goals: (r.home_goals as number | null) ?? null,
      away_goals: (r.away_goals as number | null) ?? null,
    };
  });
}

function toSlipView(db: DatabaseSync, row: SlipRow): OfficialSlipView {
  const legs = legStatesFor(db, row.slip_uid);
  return {
    slip_uid: row.slip_uid,
    edition_key: row.edition_key,
    slot: row.slot,
    series: row.series,
    source: row.source,
    published_utc: row.published_utc,
    policy_version: row.policy_version,
    combined_prob: row.combined_prob,
    combined_low: row.combined_low,
    combined_high: row.combined_high,
    combined_basis: row.combined_basis,
    combined_reason: row.combined_reason,
    combined_detail: row.combined_detail
      ? (JSON.parse(row.combined_detail) as OfficialSlipView["combined_detail"])
      : null,
    state: slipStateOf(legs.map((l) => l.state)),
    has_missed_leg: legs.some((l) => l.state === "miss"),
    legs,
  };
}

/** Baca satu tiket resmi beserta hasil setiap leg (jalur /bukti?tiket=…). */
export function getOfficialSlip(slipUid: string): OfficialSlipView | null {
  const db = getPicksDb();
  ensurePublicationSchema(db);
  ensureTicketSchema(db);
  const row = db
    .prepare("SELECT * FROM published_slips WHERE slip_uid = ?")
    .get(slipUid) as SlipRow | undefined;
  return row ? toSlipView(db, row) : null;
}

export function listOfficialSlips(filter?: {
  series?: string;
  edition_key?: string;
}): OfficialSlipView[] {
  const db = getPicksDb();
  ensurePublicationSchema(db);
  ensureTicketSchema(db);
  const where: string[] = [];
  const params: string[] = [];
  if (filter?.series) {
    where.push("series = ?");
    params.push(filter.series);
  }
  if (filter?.edition_key) {
    where.push("edition_key = ?");
    params.push(filter.edition_key);
  }
  const rows = db
    .prepare(
      `SELECT * FROM published_slips ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY published_utc ASC, slip_uid ASC`,
    )
    .all(...params) as unknown as SlipRow[];
  return rows.map((r) => toSlipView(db, r));
}

// ---------------------------------------------------------------------------
// Ukuran "Tepat per tiket" (D4) — hanya tiket resmi; slip browser tidak
// pernah masuk tabel ini sehingga tidak masuk penyebut.
// ---------------------------------------------------------------------------

export interface SlipRecordStats {
  slips: number;
  finished: number;
  hit: number;
  miss: number;
  void: number;
  pending: number;
  /**
   * Tiket menunggu yang TIDAK akan pernah selesai (Item 9 sprint A+B):
   * ≥1 pilihan anggotanya sudah jatuh tempo di kompetisi yang terbukti
   * tanpa feed hasil — klasifikasi terminal PR 2, aturan yang sama
   * dengan `unresolvable` di cohort. Dihitung terpisah dan TIDAK
   * termasuk `pending`.
   */
  unresolvable: number;
  /** hit / (hit + miss); NULL bila belum ada tiket selesai bernilai. */
  hit_ratio: number | null;
  unique_fixtures: number;
  total_legs: number;
}

export function slipRecordStats(filter?: {
  series?: string;
  edition_key?: string;
}): SlipRecordStats {
  const views = listOfficialSlips(filter);
  let hit = 0;
  let miss = 0;
  let voids = 0;
  let pending = 0;
  let totalLegs = 0;
  const fixtures = new Set<string>();
  for (const v of views) {
    totalLegs += v.legs.length;
    for (const l of v.legs) {
      fixtures.add(l.fixture_uid ?? `pick:${l.pick_id}`);
    }
    if (v.state === "hit") hit++;
    else if (v.state === "miss") miss++;
    else if (v.state === "void") voids++;
    else pending++;
  }
  // Klasifikasi terminal PR 2 di level tiket (Item 9 sprint A+B): tiket
  // berstatus pending yang punya ≥1 pilihan anggota yang belum dinilai,
  // sudah jatuh tempo (kickoff + jendela settlement lewat; kickoff tak
  // terbaca dihitung jatuh tempo — persis aturan cohort), dan kompetisinya
  // terbukti "tanpa-feed" tidak akan pernah selesai. Keluarkan dari
  // `pending`, tampilkan sebagai hitungan terpisah `unresolvable` —
  // konsisten dengan penyebut /bukti (cohortStats).
  let unresolvable = 0;
  if (pending > 0) {
    const db = getPicksDb();
    const pendingUids = views
      .filter((v) => v.state === "pending")
      .map((v) => v.slip_uid);
    const rows = db
      .prepare(
        `SELECT l.slip_uid AS slip_uid, p.kickoff_utc AS kickoff_utc,
                p.competition_canonical_id AS competition_canonical_id
         FROM slip_legs l
         JOIN picks p ON p.id = l.pick_id
         LEFT JOIN pick_outcomes o ON o.pick_id = l.pick_id
         LEFT JOIN pick_voids v ON v.pick_id = l.pick_id
         WHERE l.slip_uid IN (${pendingUids.map(() => "?").join(",")})
           AND o.hit IS NULL AND v.pick_id IS NULL`,
      )
      .all(...pendingUids) as unknown as {
      slip_uid: string;
      kickoff_utc: string | null;
      competition_canonical_id: string | null;
    }[];
    const nowMs = Date.now();
    const stuck = new Set<string>();
    for (const r of rows) {
      const ko = r.kickoff_utc ? Date.parse(r.kickoff_utc) : NaN;
      const due = !Number.isFinite(ko) || nowMs >= ko + SETTLEMENT_WINDOW_MS;
      if (due && statusFeedKompetisi(r.competition_canonical_id) === "tanpa-feed") {
        stuck.add(r.slip_uid);
      }
    }
    unresolvable = stuck.size;
    pending -= unresolvable;
  }
  const denom = hit + miss;
  return {
    slips: views.length,
    finished: hit + miss + voids,
    hit,
    miss,
    void: voids,
    pending,
    unresolvable,
    hit_ratio: denom > 0 ? hit / denom : null,
    unique_fixtures: fixtures.size,
    total_legs: totalLegs,
  };
}
