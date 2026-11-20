/**
 * RESOLVE PICK OUTCOMES — isi outcome pick ledger dari skor final LOKAL.
 *
 * Sumber skor (semua read-only, tanpa API call), urut prioritas:
 *  1. data/thestats_dataset.db `matches` by exact match_id — status final
 *     dinormalisasi lewat lib/identity/fixture-resolver (kosakata dataset
 *     'finished' maupun 'FT' sumber lain sama-sama final) + skor non-null.
 *  2. Store identitas persisten (K1): seluruh alias satu UID dengan
 *     match_id pick (fixture_aliases di dataset) → skor di baris saudara.
 *  3. Bridge sm_id_map: match_id → sm_fixture_id → 'sm_<id>' di dataset.
 *  4. Bridge kembar katalog: data/fixture-links.json lewat parser
 *     tervalidasi yang sama dengan pembaca lain (bentuk `links`).
 *  5. Tidak ketemu → biarkan unresolved (JANGAN tebak skor).
 *
 * Koreksi hasil (PRD D2): pick yang sudah ter-resolve diperiksa ulang —
 * bila skor final lokal saat ini berbeda dari skor outcome tersimpan
 * (koreksi resmi sumber), outcome dinilai ulang dari skor terbaru.
 *
 * Batal (PRD D2): pick yang fixture-nya berstatus cancelled di store
 * identitas ditandai void (pick_voids di ledger, versi aturan
 * SETTLEMENT_POLICY_VERSION) — bukan hit, bukan miss, dan tidak
 * diperiksa lagi pada run berikutnya.
 *
 * Idempoten: pick yang sudah punya outcome tidak diperiksa lagi di jalur
 * utama (listUnresolved), jadi run kedua me-resolve 0 pick baru.
 *
 * Pakai:
 *   npx tsx scripts/resolve-pick-outcomes.ts [--limit=N]
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import {
  getPicksDb,
  listUnresolved,
  listVoidedPickIds,
  markPickVoid,
  recordOutcome,
} from "../lib/picks/ledger";
import {
  SETTLEMENT_POLICY_VERSION,
  getFixtureByUid,
  getSiblingIds,
  getUidForMatchId,
  identityTablesExist,
  isFinishedStatus,
  linkSiblingsOf,
  loadFixtureLinkGroups,
  type FixtureLinkGroup,
} from "../lib/identity/fixture-resolver";

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
      `SELECT home_score, away_score, status FROM matches WHERE match_id = ?`,
    )
    .get(matchId) as
    | { home_score: number | null; away_score: number | null; status: string }
    | undefined;
  if (!row) return null;
  if (row.home_score === null || row.away_score === null) return null;
  if (!isFinishedStatus(row.status)) return null;
  return { home_score: row.home_score, away_score: row.away_score };
}

/** Kandidat id untuk satu match_id, urut prioritas, tanpa duplikat. */
function candidateIds(
  dataset: DatabaseSync | null,
  upcoming: DatabaseSync | null,
  linkGroups: FixtureLinkGroup[],
  matchId: string,
): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (id: string | null | undefined) => {
    if (id && !seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  };
  push(matchId);
  if (dataset) {
    for (const id of getSiblingIds(dataset, matchId)) push(id);
  }
  if (dataset && upcoming) {
    try {
      const bridge = upcoming
        .prepare("SELECT sm_fixture_id FROM sm_id_map WHERE match_id = ?")
        .get(matchId) as { sm_fixture_id: number } | undefined;
      if (bridge) push(`sm_${bridge.sm_fixture_id}`);
    } catch {
      // sm_id_map boleh tidak ada di store lama — jalur lain tetap jalan.
    }
  }
  for (const id of linkSiblingsOf(linkGroups, matchId)) push(id);
  return ordered;
}

function findScore(
  dataset: DatabaseSync | null,
  upcoming: DatabaseSync | null,
  linkGroups: FixtureLinkGroup[],
  matchId: string,
): ScoreRow | null {
  if (!dataset) return null;
  for (const id of candidateIds(dataset, upcoming, linkGroups, matchId)) {
    const score = finishedScore(dataset, id);
    if (score) return score;
  }
  return null;
}

/** State fixture menurut store identitas (null = tidak diketahui). */
function fixtureState(dataset: DatabaseSync | null, matchId: string): string | null {
  if (!dataset || !identityTablesExist(dataset)) return null;
  const uid = getUidForMatchId(dataset, matchId);
  if (!uid) return null;
  return getFixtureByUid(dataset, uid)?.state ?? null;
}

function main(): void {
  const voidedBefore = listVoidedPickIds();
  const unresolved = listUnresolved(limit).filter((p) => !voidedBefore.has(p.id));
  const dataset = openRo("thestats_dataset.db");
  const upcoming = openRo("upcoming_fixtures.db");
  const linkGroups = loadFixtureLinkGroups(path.join(process.cwd(), "data"));

  let resolved = 0;
  let voided = 0;
  let corrected = 0;
  try {
    // --- Jalur utama: pick belum ber-outcome.
    const stillOpen: typeof unresolved = [];
    for (const pick of unresolved) {
      const score = findScore(dataset, upcoming, linkGroups, pick.match_id);
      if (!score) {
        stillOpen.push(pick);
        continue;
      }
      recordOutcome(pick.id, score.home_score, score.away_score);
      resolved++;
    }

    // --- Void: fixture dibatalkan → pick batal demi aturan settlement.
    for (const pick of stillOpen) {
      if (fixtureState(dataset, pick.match_id) === "cancelled") {
        const uid = dataset ? getUidForMatchId(dataset, pick.match_id) : null;
        const r = markPickVoid(pick.id, {
          fixtureUid: uid,
          reason: "provider_cancelled",
          policyVersion: SETTLEMENT_POLICY_VERSION,
        });
        if (r.voided) voided++;
      }
    }

    // --- Koreksi: pick ter-resolve yang skor tersimpan ≠ skor lokal kini.
    const picksDb = getPicksDb();
    const resolvedRows = picksDb
      .prepare(
        `SELECT p.id AS id, p.match_id AS match_id, o.home_goals AS hg, o.away_goals AS ag
         FROM picks p JOIN pick_outcomes o ON o.pick_id = p.id`,
      )
      .all() as unknown as { id: number; match_id: string; hg: number; ag: number }[];
    for (const row of resolvedRows) {
      const score = findScore(dataset, upcoming, linkGroups, row.match_id);
      if (!score) continue;
      if (score.home_score !== row.hg || score.away_score !== row.ag) {
        recordOutcome(row.id, score.home_score, score.away_score);
        corrected++;
      }
    }
  } finally {
    dataset?.close();
    upcoming?.close();
  }

  console.log(`examined: ${unresolved.length}`);
  console.log(`resolved: ${resolved}`);
  console.log(`corrected: ${corrected}`);
  console.log(`voided: ${voided}`);
  console.log(`still-unresolved: ${unresolved.length - resolved - voided}`);
}

main();
