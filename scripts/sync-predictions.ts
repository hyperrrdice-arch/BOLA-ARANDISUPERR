/**
 * SYNC PREDICTIONS SPORTMONKS → data/predictions.db (DB terpisah, PRD §5.5)
 *
 * Blok C PRD ekspansi DB. Aturan keras:
 * - Predictions TIDAK PERNAH masuk match_odds_history / jalur odds pasar.
 *   File ini satu-satunya penulis predictions.db dan tidak menyentuh DB lain
 *   selain membaca katalog fixture (read-only).
 * - Tarikan PER-FIXTURE (/predictions/probabilities/fixtures/{id} dan
 *   /predictions/value-bets/fixtures/{id}), terurut kickoff. Endpoint global
 *   paginated TIDAK dipakai: terbukti (probe 3 Nov) terurut fixture_id
 *   menaik dari arsip lama (~3,5 fixture/halaman dari id 18,39 jt) sehingga
 *   fixture katalog (id ~19,6 jt) praktis tak terjangkau.
 * - Hanya fixture yang ada di katalog lokal yang disimpan.
 * - Upsert berbasis PK → idempoten; captured_utc diperbarui tiap sync.
 *
 * Pakai:
 *   SPORTMONKS_API_TOKEN=... npx tsx scripts/sync-predictions.ts [--skip-predictability] [--days=14]
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { smGet, smGetAllPages, SM_ROOT } from "./sm-fetch";
import { dbPath } from "../lib/db/paths";

const args = process.argv.slice(2);
const SKIP_PREDICTABILITY = args.includes("--skip-predictability");
const DAYS = (() => {
  const hit = args.find((a) => a.startsWith("--days="));
  return hit ? Number(hit.split("=")[1]) : null;
})();

function dataPath(file: string): string {
  return dbPath(file);
}

function openPredictions(): DatabaseSync {
  const db = new DatabaseSync(dataPath("predictions.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 30000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sm_predictions (
      fixture_sm_id INTEGER NOT NULL,
      market TEXT NOT NULL,
      outcome TEXT NOT NULL,
      probability REAL,
      predictability REAL,
      captured_utc TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'sportmonks',
      PRIMARY KEY (fixture_sm_id, market, outcome)
    );
    CREATE TABLE IF NOT EXISTS sm_value_bets (
      fixture_sm_id INTEGER NOT NULL,
      market TEXT NOT NULL,
      outcome TEXT,
      bookmaker TEXT,
      odds REAL,
      fair_odds REAL,
      value_pct REAL,
      captured_utc TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'sportmonks',
      PRIMARY KEY (fixture_sm_id, market, outcome, bookmaker, odds)
    );
    CREATE TABLE IF NOT EXISTS sm_predictability (
      league_id INTEGER NOT NULL,
      market TEXT NOT NULL,
      score REAL,
      updated_utc TEXT NOT NULL,
      PRIMARY KEY (league_id, market)
    );
    CREATE INDEX IF NOT EXISTS idx_smp_fixture ON sm_predictions(fixture_sm_id);
    CREATE INDEX IF NOT EXISTS idx_smvb_fixture ON sm_value_bets(fixture_sm_id);
  `);
  return db;
}

function catalogFixtures(): { smIds: Set<number>; leagueByFixture: Map<number, number> } {
  const up = new DatabaseSync(dataPath("upcoming_fixtures.db"), { readOnly: true });
  const rows = up
    .prepare(
      "SELECT match_id, competition_id FROM upcoming_fixtures WHERE match_id LIKE 'sm_%' AND competition_id LIKE 'sm:%'",
    )
    .all() as { match_id: string; competition_id: string }[];
  const smIds = new Set<number>();
  const leagueByFixture = new Map<number, number>();
  for (const r of rows) {
    const fid = Number(r.match_id.slice(3));
    smIds.add(fid);
    leagueByFixture.set(fid, Number(r.competition_id.slice(3)));
  }
  // Fixture mt_* terpetakan ikut diwakili oleh id SM-nya.
  const mapped = up.prepare("SELECT DISTINCT sm_fixture_id FROM sm_id_map").all() as {
    sm_fixture_id: number;
  }[];
  for (const m of mapped) smIds.add(m.sm_fixture_id);
  return { smIds, leagueByFixture };
}

async function typeNames(): Promise<Map<number, string>> {
  const types = await smGetAllPages<{ id: number; name: string }>(`${SM_ROOT}/core/types`);
  return new Map(types.map((t) => [t.id, t.name]));
}

function flattenNumeric(
  obj: Record<string, unknown>,
  prefix = "",
): { outcome: string; value: number }[] {
  const out: { outcome: string; value: number }[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "number") out.push({ outcome: prefix ? `${prefix}.${k}` : k, value: v });
    else if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...flattenNumeric(v as Record<string, unknown>, prefix ? `${prefix}.${k}` : k));
    }
  }
  return out;
}

async function main() {
  const db = openPredictions();
  const { smIds, leagueByFixture } = catalogFixtures();
  console.log(`Fixture katalog (SM id unik): ${smIds.size}`);
  const types = await typeNames();
  const typeName = (id: number) => types.get(id) ?? `type_${id}`;
  const now = () => new Date().toISOString();

  // 1) Predictability per liga (109) — juga jadi gate di sm_predictions.
  const ftPredictability = new Map<number, number>();
  if (!SKIP_PREDICTABILITY) {
    const up = new DatabaseSync(dataPath("upcoming_fixtures.db"), { readOnly: true });
    const leagues = up
      .prepare("SELECT competition_id FROM competition_catalog WHERE competition_id LIKE 'sm:%'")
      .all() as { competition_id: string }[];
    const insPred = db.prepare(
      `INSERT INTO sm_predictability (league_id, market, score, updated_utc)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(league_id, market) DO UPDATE SET score = excluded.score, updated_utc = excluded.updated_utc`,
    );
    let done = 0;
    for (const l of leagues) {
      const leagueId = Number(l.competition_id.slice(3));
      try {
        const body = await smGet<{ type_id: number; data: Record<string, number> }>(
          `/predictions/predictability/leagues/${leagueId}`,
        );
        for (const row of body.data ?? []) {
          for (const [market, score] of Object.entries(row.data ?? {})) {
            insPred.run(leagueId, `${typeName(row.type_id)}:${market}`, score, now());
            if (market === "fulltime_result") ftPredictability.set(leagueId, score);
          }
        }
      } catch (e) {
        console.warn(`  predictability liga ${leagueId} gagal: ${e instanceof Error ? e.message : e}`);
      }
      done += 1;
      if (done % 25 === 0) console.log(`  predictability: ${done}/${leagues.length} liga`);
    }
    console.log(`Predictability selesai: ${leagues.length} liga dicoba.`);
  }

  // 2) Probabilities + value bets PER FIXTURE, terurut kickoff (perishable
  // lebih dulu). Target = semua id SM di sm_id_map (mencakup fixture sm_ dan
  // jembatan mt_), kickoff dari baris katalog pasangannya.
  const insProb = db.prepare(
    `INSERT INTO sm_predictions (fixture_sm_id, market, outcome, probability, predictability, captured_utc, source)
     VALUES (?, ?, ?, ?, ?, ?, 'sportmonks')
     ON CONFLICT(fixture_sm_id, market, outcome) DO UPDATE SET
       probability = excluded.probability, predictability = excluded.predictability, captured_utc = excluded.captured_utc`,
  );
  const insVb = db.prepare(
    `INSERT INTO sm_value_bets (fixture_sm_id, market, outcome, bookmaker, odds, fair_odds, value_pct, captured_utc, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sportmonks')
     ON CONFLICT(fixture_sm_id, market, outcome, bookmaker, odds) DO UPDATE SET
       fair_odds = excluded.fair_odds, value_pct = excluded.value_pct, captured_utc = excluded.captured_utc`,
  );
  const up2 = new DatabaseSync(dataPath("upcoming_fixtures.db"), { readOnly: true });
  const targets = (
    up2
      .prepare(
        `SELECT m.sm_fixture_id AS fid, f.utc_date AS ko
         FROM sm_id_map m JOIN upcoming_fixtures f ON f.match_id = m.match_id
         GROUP BY m.sm_fixture_id ORDER BY f.utc_date`,
      )
      .all() as { fid: number; ko: string }[]
  ).filter((t) => {
    if (!smIds.has(t.fid)) return false;
    if (DAYS == null) return true;
    const tms = Date.parse(t.ko);
    return tms >= Date.now() - 86400_000 && tms <= Date.now() + DAYS * 86400_000;
  });
  console.log(`Target per-fixture: ${targets.length} fixture${DAYS != null ? ` (≤${DAYS} hari)` : ""}, terurut kickoff.`);
  // Lewati fixture yang probability-nya masih segar (<20 jam) — ritme harian
  // tidak perlu menarik ulang; run kedua di hari yang sama ≈ nol panggilan.
  const freshCutoff = new Date(Date.now() - 20 * 3600_000).toISOString();
  const freshFixtures = new Set(
    (
      db
        .prepare("SELECT DISTINCT fixture_sm_id FROM sm_predictions WHERE captured_utc >= ?")
        .all(freshCutoff) as { fixture_sm_id: number }[]
    ).map((r) => r.fixture_sm_id),
  );
  let probValues = 0;
  let vbStored = 0;
  let covered = 0;
  let skippedFresh = 0;
  for (let i = 0; i < targets.length; i++) {
    const fid = targets[i].fid;
    if (freshFixtures.has(fid)) {
      skippedFresh += 1;
      covered += 1;
      continue;
    }
    const leagueId = leagueByFixture.get(fid);
    const pred = leagueId != null ? ftPredictability.get(leagueId) ?? null : null;
    try {
      let page = 1;
      let got = 0;
      for (;;) {
        const body = await smGet<{
          fixture_id: number;
          type_id: number;
          predictions: Record<string, unknown>;
        }>(`/predictions/probabilities/fixtures/${fid}?per_page=100&page=${page}`);
        const rows = body.data ?? [];
        for (const r of rows) {
          for (const leaf of flattenNumeric(r.predictions ?? {})) {
            insProb.run(fid, typeName(r.type_id), leaf.outcome, leaf.value, pred, now());
            probValues += 1;
            got += 1;
          }
        }
        if (!body.pagination?.has_more || rows.length === 0) break;
        page += 1;
      }
      if (got > 0) covered += 1;
    } catch (e) {
      console.warn(`  probabilities ${fid} gagal: ${e instanceof Error ? e.message : e}`);
    }
    try {
      let page = 1;
      for (;;) {
        const body = await smGet<{
          fixture_id: number;
          type_id: number;
          predictions: {
            bet?: string;
            bookmaker?: string;
            fair_odd?: number;
            odd?: number;
            is_value?: boolean;
          };
        }>(`/predictions/value-bets/fixtures/${fid}?per_page=100&page=${page}`);
        const rows = body.data ?? [];
        for (const r of rows) {
          const p = r.predictions ?? {};
          const valuePct =
            p.odd != null && p.fair_odd != null && p.fair_odd > 0
              ? Math.round((p.odd / p.fair_odd - 1) * 10000) / 100
              : null;
          insVb.run(fid, typeName(r.type_id), p.bet ?? null, p.bookmaker ?? null, p.odd ?? null, p.fair_odd ?? null, valuePct, now());
          vbStored += 1;
        }
        if (!body.pagination?.has_more || rows.length === 0) break;
        page += 1;
      }
    } catch (e) {
      console.warn(`  value-bets ${fid} gagal: ${e instanceof Error ? e.message : e}`);
    }
    if ((i + 1) % 100 === 0) console.log(`  progres: ${i + 1}/${targets.length} fixture (${covered} ber-probability)`);
  }
  console.log(`Probabilities: ${probValues} nilai tersimpan, ${covered}/${targets.length} fixture ter-cover (${skippedFresh} dilewati, masih segar). Value bets: ${vbStored} baris.`);
  console.log("SELESAI sync predictions.");
}

main().catch((e) => {
  console.error("GAGAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
