/**
 * RESOLVE PICK OUTCOMES — isi outcome pick ledger dari skor final LOKAL.
 *
 * Sumber skor REGULASI / 90 menit (semua read-only, tanpa API call),
 * urut prioritas (review K8 butir 3B):
 *  1. Lapisan identitas K1: revisi skor ber-basis 'regulation' yang
 *     terverifikasi pada fixture kanonik (result_revisions) — satu-satunya
 *     sumber yang membedakan skor 90 menit dari skor perpanjangan
 *     waktu/penalti. Fixture ber-basis 'pending_score_basis' TIDAK dinilai
 *     dari sumber mana pun: pick tetap pending dengan penanda basis itu
 *     (penanda tersimpan di canonical_fixtures.score_basis).
 *  2. Baris dataset `matches` (id pick, saudara identitas, bridge
 *     sm_id_map, registry tautan fixture-links.json) — HANYA bila status
 *     mentahnya full-time polos. Baris berstatus AET/PEN membawa skor
 *     sesudah 90 menit: tidak pernah dipakai menilai; keberadaannya
 *     (tanpa skor regulasi lain) menandai pending_score_basis.
 *  3. Tidak ketemu → biarkan unresolved (JANGAN tebak skor).
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
  getRegulationScore,
  getSiblingIds,
  getUidForMatchId,
  identityTablesExist,
  isFinishedStatus,
  isPostRegulationStatus,
  linkSiblingsOf,
  loadFixtureLinkGroups,
  type FixtureLinkGroup,
} from "../lib/identity/fixture-resolver";
import { dbPath } from "../lib/db/paths";

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
if (limit !== undefined && (!Number.isFinite(limit) || limit < 0)) {
  throw new Error(`--limit tidak valid: ${limitArg}`);
}

function openRo(file: string): DatabaseSync | null {
  const p = dbPath(file);
  if (!fs.existsSync(p)) return null;
  return new DatabaseSync(p, { readOnly: true });
}

interface ScoreRow {
  home_score: number;
  away_score: number;
}

/**
 * Hasil pencarian skor regulasi untuk satu match_id:
 *  - 'score' — skor 90 menit terverifikasi, boleh dipakai menilai.
 *  - 'pending_score_basis' — laga selesai tetapi hanya hasil sesudah
 *    90 menit (ET/penalti) yang diketahui; skor regulasi belum ada.
 *    Pick TETAP pending: tidak dinilai, tidak divoid.
 *  - 'none' — belum ada hasil apa pun yang bisa dipakai.
 */
type ScoreLookup =
  | { kind: "score"; score: ScoreRow }
  | { kind: "pending_score_basis" }
  | { kind: "none" };

/**
 * Skor regulasi dari lapisan identitas (K1) untuk satu match_id: revisi
 * 'regulation' fixture kanoniknya. Basis 'pending_score_basis' bersifat
 * OTORITATIF — fixture yang basisnya tertunda tidak boleh dinilai dari
 * baris mentah mana pun, jadi nilai itu dikembalikan apa adanya dan
 * pemanggil tidak melanjutkan ke jalur baris mentah.
 */
function identityLookup(
  dataset: DatabaseSync,
  matchId: string,
): ScoreLookup | null {
  if (!identityTablesExist(dataset)) return null;
  for (const id of getSiblingIds(dataset, matchId)) {
    const uid = getUidForMatchId(dataset, id);
    if (!uid) continue;
    const fx = getFixtureByUid(dataset, uid);
    if (!fx || fx.state !== "finished") continue;
    if (fx.score_basis === "pending_score_basis") {
      return { kind: "pending_score_basis" };
    }
    const reg = getRegulationScore(dataset, uid);
    if (reg) {
      return {
        kind: "score",
        score: { home_score: reg.home, away_score: reg.away },
      };
    }
    // Basis 'regulation' tanpa revisi tersimpan (keadaan warisan ganjil):
    // identitas tidak memutuskan — jalur baris mentah yang memutuskan.
    return null;
  }
  return null;
}

/**
 * Skor regulasi dari baris dataset mentah: hanya status full-time POLOS
 * yang diterima. Baris AET/PEN membawa skor sesudah 90 menit — dilewati
 * selalu, dan dicatat keberadaannya (sawPostRegulation) supaya pemanggil
 * tahu laga ini selesai tanpa skor regulasi yang diketahui.
 */
function rawRowScore(
  db: DatabaseSync,
  matchId: string,
): { score: ScoreRow } | { postRegulation: true } | null {
  const row = db
    .prepare(
      `SELECT home_score, away_score, status FROM matches WHERE match_id = ?`,
    )
    .get(matchId) as
    | { home_score: number | null; away_score: number | null; status: string }
    | undefined;
  if (!row) return null;
  if (row.home_score === null || row.away_score === null) return null;
  if (isPostRegulationStatus(row.status)) return { postRegulation: true };
  if (!isFinishedStatus(row.status)) return null;
  return { score: { home_score: row.home_score, away_score: row.away_score } };
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

function findRegulationScore(
  dataset: DatabaseSync | null,
  upcoming: DatabaseSync | null,
  linkGroups: FixtureLinkGroup[],
  matchId: string,
): ScoreLookup {
  if (!dataset) return { kind: "none" };
  const viaIdentity = identityLookup(dataset, matchId);
  if (viaIdentity) return viaIdentity;
  let sawPostRegulation = false;
  for (const id of candidateIds(dataset, upcoming, linkGroups, matchId)) {
    const found = rawRowScore(dataset, id);
    if (!found) continue;
    if ("postRegulation" in found) {
      sawPostRegulation = true;
      continue;
    }
    return { kind: "score", score: found.score };
  }
  return sawPostRegulation ? { kind: "pending_score_basis" } : { kind: "none" };
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
  let pendingBasis = 0;
  try {
    // --- Jalur utama: pick belum ber-outcome.
    const stillOpen: typeof unresolved = [];
    for (const pick of unresolved) {
      const found = findRegulationScore(dataset, upcoming, linkGroups, pick.match_id);
      if (found.kind === "pending_score_basis") {
        // Laga selesai hanya sampai ET/penalti; skor 90 menit belum
        // diketahui. Pick tetap pending dengan penanda basis ini —
        // TIDAK dinilai dari skor sesudah 90 menit, TIDAK divoid.
        pendingBasis++;
        stillOpen.push(pick);
        continue;
      }
      if (found.kind !== "score") {
        stillOpen.push(pick);
        continue;
      }
      recordOutcome(pick.id, found.score.home_score, found.score.away_score);
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
      const found = findRegulationScore(dataset, upcoming, linkGroups, row.match_id);
      if (found.kind !== "score") continue;
      if (found.score.home_score !== row.hg || found.score.away_score !== row.ag) {
        recordOutcome(row.id, found.score.home_score, found.score.away_score);
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
  console.log(`pending-score-basis: ${pendingBasis}`);
  console.log(`still-unresolved: ${unresolved.length - resolved - voided}`);
}

main();
