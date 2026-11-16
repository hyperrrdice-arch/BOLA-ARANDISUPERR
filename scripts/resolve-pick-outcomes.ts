/**
 * RESOLVE PICK OUTCOMES — isi outcome pick ledger dari skor final LOKAL.
 *
 * Sumber skor (semua read-only, tanpa API call):
 *  1. data/thestats_dataset.db `matches` by exact match_id,
 *     hanya status='finished' + skor non-null. (Store yang sama kini juga
 *     menampung hasil era bebas: baris fd_ dari importer football-data.)
 *  2. Fallback bridge: data/upcoming_fixtures.db `sm_id_map`
 *     (match_id → sm_fixture_id) → cari 'sm_' || sm_fixture_id di dataset.
 *  3. Bridge kembar katalog: data/fixture-links.json (twin_id ↔ canonical_id,
 *     dua arah) → cari skor finished milik id kembarnya di dataset. Ini yang
 *     menjangkau pick sm_ yang hasil fisiknya tiba sebagai baris fd_ (dan
 *     sebaliknya) setelah Sportmonks berhenti.
 *  4. Tidak ketemu → biarkan unresolved (JANGAN tebak skor).
 *
 * Idempoten: pick yang sudah punya outcome tidak diperiksa lagi
 * (listUnresolved), jadi run kedua me-resolve 0 pick baru.
 *
 * Pakai:
 *   npx tsx scripts/resolve-pick-outcomes.ts [--limit=N]
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { listUnresolved, recordOutcome } from "../lib/picks/ledger";

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
if (limit !== undefined && (!Number.isFinite(limit) || limit < 0)) {
  throw new Error(`--limit tidak valid: ${limitArg}`);
}

function openRo(file: string): DatabaseSync | null {
  const p = path.join(process.cwd(), "data", file);
  if (!fs.existsSync(p)) return null;
  return new DatabaseSync(p, { readOnly: true });
}

interface ScoreRow {
  home_score: number;
  away_score: number;
}

function finishedScore(db: DatabaseSync, matchId: string): ScoreRow | null {
  const row = db
    .prepare(
      `SELECT home_score, away_score FROM matches
       WHERE match_id = ? AND status = 'finished'
         AND home_score IS NOT NULL AND away_score IS NOT NULL`,
    )
    .get(matchId) as ScoreRow | undefined;
  return row ?? null;
}

/** Peta kembar dua arah dari data/fixture-links.json (boleh tidak ada). */
function loadTwinMap(): Map<string, string> {
  const map = new Map<string, string>();
  const p = path.join(process.cwd(), "data", "fixture-links.json");
  if (!fs.existsSync(p)) return map;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as {
      links?: { twin_id: string; canonical_id: string }[];
    };
    for (const link of parsed.links ?? []) {
      map.set(link.canonical_id, link.twin_id);
      map.set(link.twin_id, link.canonical_id);
    }
  } catch {
    // File rusak → jembatan kembar dilewati, jalur lain tetap jalan.
  }
  return map;
}

function main(): void {
  const unresolved = listUnresolved(limit);
  const dataset = openRo("thestats_dataset.db");
  const upcoming = openRo("upcoming_fixtures.db");
  const twinMap = loadTwinMap();

  let resolved = 0;
  try {
    for (const pick of unresolved) {
      let score: ScoreRow | null = null;

      // 1. Exact match_id di dataset.
      if (dataset) score = finishedScore(dataset, pick.match_id);

      // 2. Bridge via sm_id_map: match_id → sm_fixture_id → 'sm_<id>'.
      if (!score && dataset && upcoming) {
        const bridge = upcoming
          .prepare("SELECT sm_fixture_id FROM sm_id_map WHERE match_id = ?")
          .get(pick.match_id) as { sm_fixture_id: number } | undefined;
        if (bridge) score = finishedScore(dataset, `sm_${bridge.sm_fixture_id}`);
      }

      // 3. Bridge kembar katalog: id kembar (fd_ ↔ sm_/mt_) di fixture-links.
      if (!score && dataset) {
        const twinId = twinMap.get(pick.match_id);
        if (twinId) score = finishedScore(dataset, twinId);
      }

      // 4. Tidak ada skor final lokal → tetap unresolved.
      if (!score) continue;

      recordOutcome(pick.id, score.home_score, score.away_score);
      resolved++;
    }
  } finally {
    dataset?.close();
    upcoming?.close();
  }

  console.log(`examined: ${unresolved.length}`);
  console.log(`resolved: ${resolved}`);
  console.log(`still-unresolved: ${unresolved.length - resolved}`);
}

main();
