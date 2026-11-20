import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

// ============================================================================
// PICK LEDGER — store pengukuran safe-bet (Phase A)
// ----------------------------------------------------------------------------
// Satu baris = satu pick yang dicatat SEBELUM / saat dibuat, lengkap dengan
// probabilitas model + pembanding (pasar Shin-stripped, panel Sportmonks) dan
// status gate kalibrasi liga saat itu. Outcome di-resolve belakangan dari skor
// final lokal (scripts/resolve-pick-outcomes.ts) supaya hit-rate per band
// probabilitas bisa diukur jujur, bukan diklaim.
// DB terpisah `data/picks.db` (runtime, gitignored) — TIDAK menyentuh
// analysis_snapshots.db dan TIDAK mencampur predictions Sportmonks ke odds.
// ============================================================================

export type PickMarket =
  | "1x2"
  | "dc"
  | "ou15"
  | "ou25"
  | "ou35"
  | "btts"
  | "team_over05_home"
  | "team_over05_away";

export interface PickInput {
  match_id: string;
  competition_canonical_id?: string | null;
  kickoff_utc?: string | null;
  market: PickMarket;
  selection: string; // '1'|'x'|'2' | '1x'|'12'|'x2' | 'over'|'under' | 'yes'|'no'
  model_prob: number; // 0..1
  market_prob?: number | null; // Shin-stripped market prob if available
  sm_prob?: number | null; // Sportmonks panel prob if available
  effective_prob?: number | null; // Probabilitas terkoreksi lab (dari engine); null = tak ada koreksi
  effective_source?: string | null; // 'lab-band' | 'stated-fallback'
  gate_status?: string | null; // canonical status at pick time
  grade?: string | null; // null in Phase A
  source: string; // 'lab' | 'live-run' | 'verdict' | 'smoke'
  notes?: string | null;
  created_utc?: string; // default: now ISO
  /** Baris packages (lib/picks/packages.ts) asal pick ini diturunkan; null bila tak ada. */
  package_id?: number | null;
}

export interface PickRow extends Required<PickInput> {
  id: number;
  agreement_spread: number | null;
}

export interface BandRow {
  market: string;
  band: string;
  n: number;
  meanProb: number;
  hitRate: number;
  gap: number;
}

interface RawPickRow {
  id: number;
  created_utc: string;
  match_id: string;
  competition_canonical_id: string | null;
  kickoff_utc: string | null;
  market: string;
  selection: string;
  model_prob: number;
  market_prob: number | null;
  sm_prob: number | null;
  effective_prob: number | null;
  effective_source: string | null;
  agreement_spread: number | null;
  gate_status: string | null;
  grade: string | null;
  source: string;
  notes: string | null;
  package_id: number | null;
}

let dbInstance: DatabaseSync | null = null;

export function getPicksDbPath(): string {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return path.join(dataDir, "picks.db");
}

export function getPicksDb(): DatabaseSync {
  if (dbInstance) {
    return dbInstance;
  }

  const db = new DatabaseSync(getPicksDbPath());

  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS picks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_utc TEXT NOT NULL,
      match_id TEXT NOT NULL,
      competition_canonical_id TEXT,
      kickoff_utc TEXT,
      market TEXT NOT NULL,
      selection TEXT NOT NULL,
      model_prob REAL NOT NULL,
      market_prob REAL,
      sm_prob REAL,
      effective_prob REAL,
      effective_source TEXT,
      agreement_spread REAL,
      gate_status TEXT,
      grade TEXT,
      source TEXT NOT NULL DEFAULT 'lab',
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS pick_outcomes (
      pick_id INTEGER PRIMARY KEY REFERENCES picks(id),
      resolved_utc TEXT NOT NULL,
      home_goals INTEGER NOT NULL,
      away_goals INTEGER NOT NULL,
      hit INTEGER NOT NULL CHECK (hit IN (0,1))
    );
    CREATE TABLE IF NOT EXISTS pick_voids (
      pick_id INTEGER PRIMARY KEY REFERENCES picks(id),
      fixture_uid TEXT,
      voided_utc TEXT NOT NULL,
      reason TEXT NOT NULL,
      policy_version TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_picks_lab_unique
      ON picks(match_id, market, selection, source) WHERE source = 'lab';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_picks_live_unique
      ON picks(match_id, market, selection, source) WHERE source = 'live-run';
    CREATE INDEX IF NOT EXISTS idx_picks_match ON picks(match_id);
    CREATE INDEX IF NOT EXISTS idx_picks_market_band ON picks(market, model_prob);
    -- Indeks covering untuk agregat cohort (Fix-6 butir 6): SUM atas
    -- hit/gol oleh cohortStats + tanda tangan keadaan dibaca dari indeks
    -- sempit ini, bukan memindai tabel yang memuat resolved_utc TEXT.
    CREATE INDEX IF NOT EXISTS idx_pick_outcomes_agg
      ON pick_outcomes(hit, home_goals, away_goals);
  `);

  // Migrasi aditif: kolom package_id pada DB yang sudah ada (CREATE TABLE
  // IF NOT EXISTS tidak menambah kolom). Idempoten via PRAGMA table_info,
  // pola yang sama dengan ensureSnapshotColumns di modul snapshot warisan.
  const pickCols = new Set(
    (db.prepare("PRAGMA table_info(picks)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!pickCols.has("package_id")) {
    db.exec("ALTER TABLE picks ADD COLUMN package_id INTEGER");
    db.exec("CREATE INDEX IF NOT EXISTS idx_picks_package ON picks(package_id)");
  }
  // Migrasi aditif (audit T3, 2026-11-09): probabilitas efektif terkoreksi
  // lab sebagai kolom terstruktur. Sebelumnya koreksi ini hanya hidup
  // sebagai teks di notes ("eff=0.8720 lab-band") dan tak pernah sampai
  // ke builder/UI — model_prob mentah yang tampil di sana.
  if (!pickCols.has("effective_prob")) {
    db.exec("ALTER TABLE picks ADD COLUMN effective_prob REAL");
  }
  if (!pickCols.has("effective_source")) {
    db.exec("ALTER TABLE picks ADD COLUMN effective_source TEXT");
  }
  // Backfill satu kali dari notes warisan pick-slate. Baris yang notes-nya
  // tak memuat pola eff= tetap NULL — artinya memang tak ada koreksi lab
  // untuk baris itu; pembaca wajib menampilkannya sebagai model mentah.
  const legacyEff = db
    .prepare(
      "SELECT id, notes FROM picks WHERE source = 'live-run' AND effective_prob IS NULL AND notes LIKE '%eff=%'",
    )
    .all() as { id: number; notes: string }[];
  if (legacyEff.length > 0) {
    const upd = db.prepare(
      "UPDATE picks SET effective_prob = ?, effective_source = ? WHERE id = ?",
    );
    for (const r of legacyEff) {
      const m = /eff=(\d+(?:\.\d+)?)\s+(lab-band|stated-fallback)/.exec(r.notes);
      if (m) upd.run(Number(m[1]), m[2], r.id);
    }
  }

  dbInstance = db;
  return dbInstance;
}

// Spread kesepakatan antar-sumber: max − min dari prob yang tersedia.
// Null bila sumber pembanding kurang dari 2 (tidak ada yang bisa dibandingkan).
export function computeAgreementSpread(p: PickInput): number | null {
  const probs = [p.model_prob, p.market_prob ?? null, p.sm_prob ?? null].filter(
    (v): v is number => v !== null && v !== undefined,
  );
  if (probs.length < 2) return null;
  return Math.max(...probs) - Math.min(...probs);
}

function toPickRow(r: RawPickRow): PickRow {
  return {
    id: r.id,
    created_utc: r.created_utc,
    match_id: r.match_id,
    competition_canonical_id: r.competition_canonical_id,
    kickoff_utc: r.kickoff_utc,
    market: r.market as PickMarket,
    selection: r.selection,
    model_prob: r.model_prob,
    market_prob: r.market_prob,
    sm_prob: r.sm_prob,
    effective_prob: r.effective_prob,
    effective_source: r.effective_source,
    agreement_spread: r.agreement_spread,
    gate_status: r.gate_status,
    grade: r.grade,
    source: r.source,
    notes: r.notes,
    package_id: r.package_id,
  };
}

const PICK_COLUMNS =
  "created_utc, match_id, competition_canonical_id, kickoff_utc, market, selection, " +
  "model_prob, market_prob, sm_prob, agreement_spread, gate_status, grade, source, notes, package_id, " +
  "effective_prob, effective_source";

function insertPick(db: DatabaseSync, p: PickInput): { id: number; inserted: boolean } {
  const createdUtc = p.created_utc ?? new Date().toISOString();
  const spread = computeAgreementSpread(p);
  const values: (string | number | null)[] = [
    createdUtc,
    p.match_id,
    p.competition_canonical_id ?? null,
    p.kickoff_utc ?? null,
    p.market,
    p.selection,
    p.model_prob,
    p.market_prob ?? null,
    p.sm_prob ?? null,
    spread,
    p.gate_status ?? null,
    p.grade ?? null,
    p.source,
    p.notes ?? null,
    p.package_id ?? null,
    p.effective_prob ?? null,
    p.effective_source ?? null,
  ];

  if (p.source === "lab" || p.source === "live-run") {
    const result = db
      .prepare(`INSERT OR IGNORE INTO picks (${PICK_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(...values);
    if (Number(result.changes) > 0) {
      return { id: Number(result.lastInsertRowid), inserted: true };
    }
    // Konflik unik: kembalikan id baris yang sudah ada (idempoten).
    const existing = db
      .prepare("SELECT id FROM picks WHERE match_id = ? AND market = ? AND selection = ? AND source = ?")
      .get(p.match_id, p.market, p.selection, p.source) as { id: number } | undefined;
    if (!existing) {
      throw new Error(`recordPick: INSERT OR IGNORE gagal tanpa baris existing untuk ${p.match_id}/${p.market}/${p.selection}`);
    }
    return { id: existing.id, inserted: false };
  }

  const result = db
    .prepare(`INSERT INTO picks (${PICK_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(...values);
  return { id: Number(result.lastInsertRowid), inserted: true };
}

export function recordPick(p: PickInput): number {
  return insertPick(getPicksDb(), p).id;
}

export function recordPicks(ps: PickInput[]): number {
  const db = getPicksDb();
  db.exec("BEGIN");
  try {
    let inserted = 0;
    for (const p of ps) {
      if (insertPick(db, p).inserted) inserted++;
    }
    db.exec("COMMIT");
    return inserted;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function listUnresolved(limit?: number): PickRow[] {
  const db = getPicksDb();
  const sql = `
    SELECT p.* FROM picks p
    LEFT JOIN pick_outcomes o ON o.pick_id = p.id
    WHERE o.pick_id IS NULL
    ORDER BY p.kickoff_utc ASC, p.id ASC
    ${limit !== undefined ? "LIMIT ?" : ""}
  `;
  const rows = (
    limit !== undefined ? db.prepare(sql).all(limit) : db.prepare(sql).all()
  ) as unknown as RawPickRow[];
  return rows.map(toPickRow);
}

// ============================================================================
// EVALUASI OUTCOME — aturan hit per market. Fail-fast: market/selection tak
// dikenal = throw, BUKAN diam-diam 0 (0 palsu meracuni statistik band).
// ============================================================================
export function evaluatePick(market: string, selection: string, homeGoals: number, awayGoals: number): 0 | 1 {
  const total = homeGoals + awayGoals;
  switch (market) {
    case "1x2":
      if (selection === "1") return homeGoals > awayGoals ? 1 : 0;
      if (selection === "x") return homeGoals === awayGoals ? 1 : 0;
      if (selection === "2") return homeGoals < awayGoals ? 1 : 0;
      break;
    case "dc":
      if (selection === "1x") return homeGoals >= awayGoals ? 1 : 0;
      if (selection === "12") return homeGoals !== awayGoals ? 1 : 0;
      if (selection === "x2") return homeGoals <= awayGoals ? 1 : 0;
      break;
    case "ou15":
      if (selection === "over") return total >= 2 ? 1 : 0;
      if (selection === "under") return total <= 1 ? 1 : 0;
      break;
    case "ou25":
      if (selection === "over") return total >= 3 ? 1 : 0;
      if (selection === "under") return total <= 2 ? 1 : 0;
      break;
    case "ou35":
      if (selection === "over") return total >= 4 ? 1 : 0;
      if (selection === "under") return total <= 3 ? 1 : 0;
      break;
    case "btts":
      if (selection === "yes") return homeGoals >= 1 && awayGoals >= 1 ? 1 : 0;
      if (selection === "no") return homeGoals >= 1 && awayGoals >= 1 ? 0 : 1;
      break;
    case "team_over05_home":
      if (selection === "yes") return homeGoals >= 1 ? 1 : 0;
      if (selection === "no") return homeGoals >= 1 ? 0 : 1;
      break;
    case "team_over05_away":
      if (selection === "yes") return awayGoals >= 1 ? 1 : 0;
      if (selection === "no") return awayGoals >= 1 ? 0 : 1;
      break;
    default:
      throw new Error(`evaluatePick: market tidak dikenal: ${market}`);
  }
  throw new Error(`evaluatePick: selection tidak dikenal untuk market ${market}: ${selection}`);
}

export function recordOutcome(
  pickId: number,
  homeGoals: number,
  awayGoals: number,
  resolvedUtc?: string,
): { hit: 0 | 1 } {
  const db = getPicksDb();
  const pick = db.prepare("SELECT market, selection FROM picks WHERE id = ?").get(pickId) as
    | { market: string; selection: string }
    | undefined;
  if (!pick) {
    throw new Error(`recordOutcome: pick id tidak ditemukan: ${pickId}`);
  }
  const hit = evaluatePick(pick.market, pick.selection, homeGoals, awayGoals);
  db.prepare(
    `
    INSERT INTO pick_outcomes (pick_id, resolved_utc, home_goals, away_goals, hit)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(pick_id) DO UPDATE SET
      resolved_utc = excluded.resolved_utc,
      home_goals = excluded.home_goals,
      away_goals = excluded.away_goals,
      hit = excluded.hit
  `,
  ).run(pickId, resolvedUtc ?? new Date().toISOString(), homeGoals, awayGoals, hit);
  return { hit };
}

// ============================================================================
// VOID — pick yang batal demi aturan settlement (PRD D2: laga dibatalkan
// provider, atau dijadwalkan ulang ke hari kalender WIB berbeda sesudah
// publikasi). Void BUKAN hit dan BUKAN miss: pick tidak masuk penyebut
// menang/kalah, jadi ia dicatat di tabel terpisah (pick_voids), bukan
// sebagai outcome. Idempoten per pick.
// ============================================================================
export function markPickVoid(
  pickId: number,
  opts: { fixtureUid?: string | null; reason: string; policyVersion: string; voidedUtc?: string },
): { voided: boolean } {
  const db = getPicksDb();
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO pick_voids (pick_id, fixture_uid, voided_utc, reason, policy_version)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      pickId,
      opts.fixtureUid ?? null,
      opts.voidedUtc ?? new Date().toISOString(),
      opts.reason,
      opts.policyVersion,
    );
  return { voided: Number(result.changes) > 0 };
}

export function listVoidedPickIds(): Set<number> {
  const db = getPicksDb();
  const rows = db.prepare("SELECT pick_id FROM pick_voids").all() as { pick_id: number }[];
  return new Set(rows.map((r) => r.pick_id));
}

export interface PickVoidRow {
  pick_id: number;
  fixture_uid: string | null;
  voided_utc: string;
  reason: string;
  policy_version: string;
}

export function getPickVoid(pickId: number): PickVoidRow | null {
  const db = getPicksDb();
  const row = db
    .prepare("SELECT pick_id, fixture_uid, voided_utc, reason, policy_version FROM pick_voids WHERE pick_id = ?")
    .get(pickId) as PickVoidRow | undefined;
  return row ?? null;
}

// ============================================================================
// HIT-RATE PER BAND PROBABILITAS — hanya pick yang sudah resolved.
// gap = hitRate − meanProb (positif = model under-confident di band itu).
// ============================================================================
const BANDS: { lo: number; hi: number; label: string }[] = [
  { lo: 0.55, hi: 0.6, label: "55–60" },
  { lo: 0.6, hi: 0.65, label: "60–65" },
  { lo: 0.65, hi: 0.7, label: "65–70" },
  { lo: 0.7, hi: 0.75, label: "70–75" },
  { lo: 0.75, hi: 0.8, label: "75–80" },
  { lo: 0.8, hi: 0.85, label: "80–85" },
  { lo: 0.85, hi: 1.01, label: "85+" },
];

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

export function hitRateByBand(opts?: { market?: string; source?: string }): BandRow[] {
  const db = getPicksDb();
  const clauses: string[] = [];
  const params: string[] = [];
  if (opts?.market) {
    clauses.push("p.market = ?");
    params.push(opts.market);
  }
  if (opts?.source) {
    clauses.push("p.source = ?");
    params.push(opts.source);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `
      SELECT p.market AS market, p.model_prob AS model_prob, o.hit AS hit
      FROM picks p
      JOIN pick_outcomes o ON o.pick_id = p.id
      ${where}
    `,
    )
    .all(...params) as unknown as { market: string; model_prob: number; hit: number }[];

  // Agregasi per (market, band) di TS: definisi band satu tempat (BANDS).
  const groups = new Map<string, { market: string; band: string; n: number; probSum: number; hitSum: number }>();
  for (const r of rows) {
    const band = BANDS.find((b) => r.model_prob >= b.lo && r.model_prob < b.hi);
    if (!band) continue; // di luar 0.55–1.0: bukan wilayah safe-bet, tak diukur di sini
    const key = `${r.market}|${band.label}`;
    const g = groups.get(key) ?? { market: r.market, band: band.label, n: 0, probSum: 0, hitSum: 0 };
    g.n++;
    g.probSum += r.model_prob;
    g.hitSum += r.hit;
    groups.set(key, g);
  }

  const bandOrder = new Map(BANDS.map((b, i) => [b.label, i]));
  return [...groups.values()]
    .sort((a, b) => a.market.localeCompare(b.market) || (bandOrder.get(a.band) ?? 0) - (bandOrder.get(b.band) ?? 0))
    .map((g) => {
      const meanProb = g.probSum / g.n;
      const hitRate = g.hitSum / g.n;
      return {
        market: g.market,
        band: g.band,
        n: g.n,
        meanProb: round4(meanProb),
        hitRate: round4(hitRate),
        gap: round4(hitRate - meanProb),
      };
    });
}
