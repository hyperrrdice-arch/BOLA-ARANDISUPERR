/**
 * Seed sandbox untuk reproduksi brief redesain (Langkah 1) — dipakai
 * suite tests/test-redesain-repro.ts dan penyemai panggung render
 * (tests/helpers/redesain-stage-seed.ts). Semua data berasal dari
 * fixture NYATA yang diekstrak read-only dari DB checkout utama
 * (tests/fixtures/redesain-repro/*.json) — nilai peluang, baris
 * katalog, dan entri registry disalin apa adanya, tidak dihitung ulang.
 *
 * TIDAK menyentuh DB checkout: semua seed masuk ke sandbox fixture-env.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { FixtureEnv } from "./fixture-env";

const FIX = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "redesain-repro",
);

export function bacaFixture<T>(nama: string): T {
  return JSON.parse(fs.readFileSync(path.join(FIX, nama), "utf8")) as T;
}

export interface BarisKatalog {
  match_id: string;
  competition_id: string | null;
  competition_name: string | null;
  competition_country: string | null;
  utc_date: string;
  status: string;
  stage_name: string | null;
  home_team_id: string | null;
  home_team_name: string;
  away_team_id: string | null;
  away_team_name: string;
  venue: string | null;
  is_neutral: number | null;
  odds_available: number | null;
  xg_available: number | null;
  fetched_utc: string | null;
}

const KOLOM_KATALOG = [
  "match_id", "competition_id", "competition_name", "competition_country",
  "utc_date", "status", "stage_name", "home_team_id", "home_team_name",
  "away_team_id", "away_team_name", "venue", "is_neutral",
  "odds_available", "xg_available", "fetched_utc",
] as const;

export function seedKatalog(env: FixtureEnv, rows: BarisKatalog[]): void {
  const db = new DatabaseSync(path.join(env.dataDir, "upcoming_fixtures.db"));
  const stmt = db.prepare(
    `INSERT INTO upcoming_fixtures (${KOLOM_KATALOG.join(", ")})
     VALUES (${KOLOM_KATALOG.map(() => "?").join(", ")})`,
  );
  for (const r of rows) {
    stmt.run(...KOLOM_KATALOG.map((k) => (r[k] ?? null) as never));
  }
  db.close();
}

export function seedRegistry(env: FixtureEnv, teams: unknown[]): void {
  fs.writeFileSync(
    path.join(env.dataDir, "team-canonical.json"),
    JSON.stringify({ version: 1, generated_utc: "2026-11-21T00:00:00.000Z", teams }, null, 1),
  );
}

/** Sisipkan payload paket verbatim; kembalikan map match_id → package id. */
export function seedPaket(env: FixtureEnv, payloadFiles: string[]): Map<string, number> {
  const db = new DatabaseSync(path.join(env.dataDir, "analysis_snapshots.db"));
  const out = new Map<string, number>();
  for (const f of payloadFiles) {
    const payload = bacaFixture<{
      fixture: { match_id: string; kickoff_utc: string; competition_id?: string };
    }>(f);
    const info = db
      .prepare(
        `INSERT INTO packages (match_id, competition_canonical_id, kickoff_utc,
           computed_utc, trigger, payload_json)
         VALUES (?, ?, ?, ?, 'manual', ?)`,
      )
      .run(
        payload.fixture.match_id,
        payload.fixture.competition_id ?? null,
        payload.fixture.kickoff_utc,
        "2026-11-20T09:56:00.000Z",
        JSON.stringify(payload),
      );
    out.set(payload.fixture.match_id, Number(info.lastInsertRowid));
  }
  db.close();
  return out;
}

/** Sisipkan payload paket dari objek langsung (seed sintetis arsip). */
export function seedPaketObjek(
  env: FixtureEnv,
  payloads: Record<string, unknown>[],
): Map<string, number> {
  const db = new DatabaseSync(path.join(env.dataDir, "analysis_snapshots.db"));
  const out = new Map<string, number>();
  for (const payload of payloads) {
    const fx = payload.fixture as { match_id: string; kickoff_utc: string; competition_id?: string };
    const info = db
      .prepare(
        `INSERT INTO packages (match_id, competition_canonical_id, kickoff_utc,
           computed_utc, trigger, payload_json)
         VALUES (?, ?, ?, ?, 'manual', ?)`,
      )
      .run(fx.match_id, fx.competition_id ?? null, fx.kickoff_utc, "2026-11-18T09:00:00.000Z", JSON.stringify(payload));
    out.set(fx.match_id, Number(info.lastInsertRowid));
  }
  db.close();
  return out;
}

export interface PickSeed {
  match_id: string;
  market: string;
  selection: string;
  line: string;
  model_prob: number;
  market_prob: number | null;
  sm_prob: number | null;
  published_prob: number;
  probability_basis: string;
  published_at_utc: string;
  grade: string;
  gate_status: string;
  pick_uid: string;
  competition_canonical_id: string | null;
  kickoff_utc: string;
  package_id: number | null;
  fixture_uid?: string | null;
}

export function seedPicks(env: FixtureEnv, picks: PickSeed[]): void {
  const db = new DatabaseSync(path.join(env.dataDir, "picks.db"));
  const stmt = db.prepare(
    `INSERT INTO picks (created_utc, match_id, competition_canonical_id,
       kickoff_utc, market, selection, model_prob, market_prob, sm_prob,
       gate_status, grade, source, package_id, pick_uid, fixture_uid, line,
       published_at_utc, kickoff_at_issue_utc, published_prob,
       probability_basis, effective_prob)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live-run', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const p of picks) {
    stmt.run(
      p.published_at_utc, p.match_id, p.competition_canonical_id,
      p.kickoff_utc, p.market, p.selection, p.model_prob, p.market_prob,
      p.sm_prob, p.gate_status, p.grade, p.package_id, p.pick_uid,
      p.fixture_uid ?? null, p.line, p.published_at_utc, p.kickoff_utc,
      p.published_prob, p.probability_basis, p.published_prob,
    );
  }
  db.close();
}

/** 16 pick Marseille NYATA dari ledger hasil migrasi K1/K2 (rehearsal). */
export function picksMarseille(packageIds: Map<string, number>): PickSeed[] {
  const rows = bacaFixture<Array<Omit<PickSeed, "kickoff_utc" | "package_id"> & { model_version: string | null }>>(
    "picks-marseille.json",
  );
  const kickoff: Record<string, string> = {
    sm_19715544: "2026-11-22T19:45:00.000Z",
    mt_022917440: "2026-11-22T19:45:00.000Z",
  };
  return rows.map((r) => ({
    ...r,
    kickoff_utc: kickoff[r.match_id],
    package_id: packageIds.get(r.match_id) ?? null,
    fixture_uid: null, // persis keadaan ledger nyata: 16/16 NULL
  }));
}

/**
 * Seed arsip 19 Nov: 74 pick live-run jatuh tempo (kickoff tersebar di
 * jendela WIB 19 Nov 2026 = 18 Nov 17:00Z – 19 Nov 17:00Z), 0 dinilai,
 * + 6 pick masa depan (22 Nov) untuk bukti urutan daftar default.
 * Nama tim sintetis berlabel jelas; keadaan (74/0) direplikasi dari
 * hitungan ledger nyata pada jendela yang sama.
 */
export function picksArsip19Nov(): PickSeed[] {
  const markets: Array<[string, string, string]> = [
    ["ou15", "over", "1.5"],
    ["ou25", "over", "2.5"],
    ["dc", "1x", ""],
    ["team_over05_home", "yes", ""],
    ["btts", "yes", ""],
    ["ou35", "under", "3.5"],
    ["dc", "x2", ""],
    ["1x2", "1", ""],
  ];
  const picks: PickSeed[] = [];
  let n = 0;
  for (let m = 0; m < 10 && n < 74; m++) {
    const jam = 18 + m * 2; // 18:00Z 18 Nov … 12:00Z 19 Nov — semua di dalam jendela WIB 19 Nov
    const ko = jam < 24
      ? `2026-11-18T${String(jam).padStart(2, "0")}:00:00.000Z`
      : `2026-11-19T${String(jam - 24).padStart(2, "0")}:00:00.000Z`;
    for (const [market, selection, line] of markets) {
      if (n >= 74) break;
      n += 1;
      picks.push({
        match_id: `rd_arsip_${m + 1}`,
        market, selection, line,
        model_prob: 0.8,
        market_prob: null,
        sm_prob: null,
        published_prob: 0.8,
        probability_basis: "effective",
        published_at_utc: "2026-11-18T10:00:00.000Z",
        grade: "A",
        gate_status: "calibrated",
        pick_uid: `pk_rdarsip${String(n).padStart(3, "0")}`,
        competition_canonical_id: "sm:9999",
        kickoff_utc: ko,
        package_id: null,
      });
    }
  }
  for (let i = 0; i < 6; i++) {
    picks.push({
      match_id: "rd_masa_depan_1",
      market: markets[i][0], selection: markets[i][1], line: markets[i][2],
      model_prob: 0.8, market_prob: null, sm_prob: null,
      published_prob: 0.8, probability_basis: "effective",
      published_at_utc: "2026-11-20T10:00:00.000Z",
      grade: "A", gate_status: "calibrated",
      pick_uid: `pk_rdfuture${i + 1}`,
      competition_canonical_id: "sm:9999",
      kickoff_utc: "2026-11-22T12:00:00.000Z",
      package_id: null,
    });
  }
  return picks;
}

/** Paket sintetis bernama untuk seed arsip (nama laga di /bukti dari paket). */
export function paketArsip(matchId: string, kickoff: string): Record<string, unknown> {
  const idx = matchId.replace(/\D/g, "") || "0";
  return {
    fixture: {
      match_id: matchId,
      competition_id: "sm:9999",
      competition_name: "Liga Uji Arsip",
      home: `Arsip Home ${idx}`,
      away: `Arsip Away ${idx}`,
      kickoff_utc: kickoff,
    },
    model: { probs: { "1x2": { home: 0.5, draw: 0.3, away: 0.2 } } },
    score_matrix: [[1]],
    market: null,
    sm_panel: null,
  };
}
