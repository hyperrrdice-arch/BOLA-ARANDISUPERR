import { getPicksDb } from "./ledger";
import { ensurePublicationSchema } from "./publication";

// ============================================================================
// STATISTIK COHORT LEDGER (PRD bab Data D4, kartu K2)
// ----------------------------------------------------------------------------
// Semua ukuran cohort dihitung dari SAMPEL YANG SAMA (satu filter), bukan
// campuran query dengan populasi berbeda:
//   - akurasi = hit / (hit + miss) atas baris yang sudah dinilai;
//   - cakupan = dinilai / (dinilai + pending yang sudah jatuh tempo);
//     jatuh tempo = 6 jam sesudah kickoff (final terverifikasi lebih awal
//     langsung layak karena barisnya sudah punya outcome);
//   - pending dibedakan: belum mulai / menunggu jendela hasil / jatuh
//     tempo; void dilaporkan terpisah dan TIDAK masuk penyebut;
//   - peluang terbit vs kenyataan = AVG(published_prob) vs AVG(hit) atas
//     irisan terselesaikan yang punya published_prob, plus jumlah irisan
//     dan jumlah baris warisan (hit/miss-saja, tanpa published_prob);
//   - tanpa penyebut → hit_ratio NULL (tampilan: "Belum ada hasil");
//     0% hanya muncul bila minimal satu observasi sudah dinilai.
//
// Alasan pending jatuh tempo (sumber tak mencakup / konflik identitas)
// tidak disimpan di ledger; pemanggil yang tahu boleh menyerahkan peta
// pick_id → alasan lewat `pending_reasons` untuk sub-klasifikasi.
// ============================================================================

export const SETTLEMENT_WINDOW_MS = 6 * 3_600_000;
export const EMPTY_COHORT_LABEL = "Belum ada hasil";

export interface CohortFilter {
  source?: string;
  grade?: string;
  gate_status?: string;
  market?: string;
  competition_canonical_id?: string;
  /** Rentang kickoff inklusif (ISO UTC). */
  from_utc?: string;
  to_utc?: string;
}

export interface CohortStats {
  filter: CohortFilter;
  /** Semua baris terbit dalam filter (termasuk void). */
  issued: number;
  settled: number;
  hits: number;
  misses: number;
  /** NULL bila belum ada yang dinilai — jangan ditampilkan sebagai 0%. */
  hit_ratio: number | null;
  empty: boolean;
  /** Penyebut cakupan: dinilai + pending jatuh tempo. */
  due: number;
  coverage: [number, number] | null;
  coverage_ratio: number | null;
  voids: number;
  not_started: number;
  awaiting_window: number;
  overdue_pending: number;
  overdue_by_reason: Record<string, number>;
  prob_slice: {
    /** Baris terselesaikan dengan published_prob tercatat. */
    n: number;
    avg_published_prob: number | null;
    avg_hit: number | null;
    /** Baris terselesaikan tanpa published_prob (warisan hit/miss-saja). */
    legacy_hitmiss_only: number;
  };
}

interface CohortRow {
  id: number;
  kickoff_utc: string | null;
  published_prob: number | null;
  hit: number | null;
  voided: number | null;
}

export function cohortStats(opts: {
  now_utc: string;
  filter?: CohortFilter;
  pending_reasons?: Map<number, string>;
}): CohortStats {
  const db = getPicksDb();
  ensurePublicationSchema(db);
  const f = opts.filter ?? {};
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.source) {
    where.push("p.source = ?");
    params.push(f.source);
  }
  if (f.grade) {
    where.push("p.grade = ?");
    params.push(f.grade);
  }
  if (f.gate_status) {
    where.push("p.gate_status = ?");
    params.push(f.gate_status);
  }
  if (f.market) {
    where.push("p.market = ?");
    params.push(f.market);
  }
  if (f.competition_canonical_id) {
    where.push("p.competition_canonical_id = ?");
    params.push(f.competition_canonical_id);
  }
  if (f.from_utc) {
    where.push("p.kickoff_utc >= ?");
    params.push(f.from_utc);
  }
  if (f.to_utc) {
    where.push("p.kickoff_utc <= ?");
    params.push(f.to_utc);
  }
  const rows = db
    .prepare(
      `SELECT p.id, p.kickoff_utc, p.published_prob, o.hit AS hit, v.pick_id AS voided
       FROM picks p
       LEFT JOIN pick_outcomes o ON o.pick_id = p.id
       LEFT JOIN pick_voids v ON v.pick_id = p.id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`,
    )
    .all(...(params as never[])) as unknown as CohortRow[];

  const nowMs = Date.parse(opts.now_utc);
  let settled = 0;
  let hits = 0;
  let misses = 0;
  let voids = 0;
  let notStarted = 0;
  let awaitingWindow = 0;
  let overdue = 0;
  const overdueByReason: Record<string, number> = {};
  let sliceN = 0;
  let sliceProbSum = 0;
  let sliceHitSum = 0;
  let legacyOnly = 0;

  for (const r of rows) {
    if (r.voided !== null && r.voided !== undefined) {
      voids++;
      continue;
    }
    if (r.hit !== null && r.hit !== undefined) {
      settled++;
      if (r.hit === 1) hits++;
      else misses++;
      if (r.published_prob !== null && r.published_prob !== undefined) {
        sliceN++;
        sliceProbSum += r.published_prob;
        sliceHitSum += r.hit;
      } else {
        legacyOnly++;
      }
      continue;
    }
    // Belum dinilai: klasifikasikan menurut jam.
    const ko = r.kickoff_utc ? Date.parse(r.kickoff_utc) : NaN;
    if (Number.isFinite(ko) && ko > nowMs) {
      notStarted++;
    } else if (Number.isFinite(ko) && nowMs < ko + SETTLEMENT_WINDOW_MS) {
      awaitingWindow++;
    } else {
      // Kickoff tak terbaca juga dihitung jatuh tempo: tidak bisa dibuktikan
      // masih masa depan, dan menahannya dari penyebut menyembunyikan utang.
      overdue++;
      const reason = opts.pending_reasons?.get(r.id) ?? "unspecified";
      overdueByReason[reason] = (overdueByReason[reason] ?? 0) + 1;
    }
  }

  const due = settled + overdue;
  return {
    filter: f,
    issued: rows.length,
    settled,
    hits,
    misses,
    hit_ratio: settled > 0 ? hits / settled : null,
    empty: settled === 0,
    due,
    coverage: due > 0 ? [settled, due] : null,
    coverage_ratio: due > 0 ? settled / due : null,
    voids,
    not_started: notStarted,
    awaiting_window: awaitingWindow,
    overdue_pending: overdue,
    overdue_by_reason: overdueByReason,
    prob_slice: {
      n: sliceN,
      avg_published_prob: sliceN > 0 ? sliceProbSum / sliceN : null,
      avg_hit: sliceN > 0 ? sliceHitSum / sliceN : null,
      legacy_hitmiss_only: legacyOnly,
    },
  };
}
