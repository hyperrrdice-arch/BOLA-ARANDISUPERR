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

/* ------------------------------------------------- cache statistik (Fix-6) */

// Statistik cohort adalah agregat atas seluruh ledger (170 ribu baris):
// walau agregasinya sudah di SQL, satu hitungan penuh tetap memindai
// tabel pada VM bersama (terukur ±170–340 ms). Halaman rekam memanggil
// fungsi ini per request, jadi hasilnya di-cache per (filter, sidik
// alasan) dengan DUA penjaga kesegaran yang eksak — bukan TTL buta:
//
// 1. TANDA TANGAN KEADAAN — satu kueri agregat sempit (indeks covering
//    idx_pick_outcomes_agg) atas jumlah baris picks/voids/outcomes dan
//    SUM(hit, home_goals, away_goals). Koreksi skor TANPA penambahan
//    baris (baris outcome yang sama ditulis ulang resolver: hit berbalik
//    dan/atau gol berubah) mengubah tanda tangan → cache gugur dan
//    statistik dihitung ulang. Penambahan/penghapusan baris mengubah
//    hitungan/MAX(id). published_prob bersifat beku sesudah terbit
//    (kontrak K2), jadi mutasi di tempat pada kolom itu bukan jalur
//    koreksi yang sah dan tidak perlu ditandatangani.
// 2. KEDALUWARSA TRANSISI JAM — klasifikasi pending hanya berubah saat
//    `now` melintasi kickoff sebuah baris pending (belum-mulai →
//    menunggu) atau kickoff+6 jam (menunggu → jatuh tempo). Entri cache
//    menyimpan instant transisi terdekat; hit hanya sah untuk
//    now < instant itu, jadi statistik yang disajikan dari cache PERSIS
//    sama dengan hasil hitung ulang pada now tersebut.

interface EntriCacheCohort {
  sig: string;
  validUntilMs: number;
  stats: CohortStats;
}

const cacheCohort = new Map<string, EntriCacheCohort>();
const BATAS_ENTRI_CACHE = 64;

type DbCohort = ReturnType<typeof getPicksDb>;

function tandaTanganKeadaan(db: DbCohort): string {
  const r = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM picks) AS n_picks,
         (SELECT COALESCE(MAX(id), 0) FROM picks) AS max_pick,
         (SELECT COUNT(*) FROM pick_voids) AS n_voids,
         (SELECT COUNT(*) FROM pick_outcomes) AS n_out,
         (SELECT COALESCE(SUM(hit), 0) FROM pick_outcomes) AS sum_hit,
         (SELECT COALESCE(SUM(home_goals), 0) FROM pick_outcomes) AS sum_hg,
         (SELECT COALESCE(SUM(away_goals), 0) FROM pick_outcomes) AS sum_ag`,
    )
    .get() as unknown as {
    n_picks: number;
    max_pick: number;
    n_voids: number;
    n_out: number;
    sum_hit: number;
    sum_hg: number;
    sum_ag: number;
  };
  return [r.n_picks, r.max_pick, r.n_voids, r.n_out, r.sum_hit, r.sum_hg, r.sum_ag].join("|");
}

/** Sidik peta alasan pending (bagian dari kunci cache; FNV-1a atas entri terurut). */
function sidikAlasan(m: Map<number, string> | undefined): string {
  if (!m || m.size === 0) return "-";
  const s = [...m.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, v]) => `${k}:${v}`)
    .join(",");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${m.size}:${(h >>> 0).toString(36)}`;
}

function kunciCacheCohort(f: CohortFilter, alasan: Map<number, string> | undefined): string {
  return [
    f.source ?? "",
    f.grade ?? "",
    f.gate_status ?? "",
    f.market ?? "",
    f.competition_canonical_id ?? "",
    f.from_utc ?? "",
    f.to_utc ?? "",
    sidikAlasan(alasan),
  ].join("|");
}

export function cohortStats(opts: {
  now_utc: string;
  filter?: CohortFilter;
  pending_reasons?: Map<number, string>;
}): CohortStats {
  const db = getPicksDb();
  ensurePublicationSchema(db);
  const f = opts.filter ?? {};
  const nowMs = Date.parse(opts.now_utc);
  const kunci = kunciCacheCohort(f, opts.pending_reasons);
  const sig = tandaTanganKeadaan(db);
  const entri = cacheCohort.get(kunci);
  if (entri && entri.sig === sig && Number.isFinite(nowMs) && nowMs < entri.validUntilMs) {
    return { ...entri.stats, filter: f };
  }
  const { stats, validUntilMs } = hitungCohort(db, opts);
  if (cacheCohort.size >= BATAS_ENTRI_CACHE) {
    const tertua = cacheCohort.keys().next().value;
    if (tertua !== undefined) cacheCohort.delete(tertua);
  }
  cacheCohort.set(kunci, { sig, validUntilMs, stats });
  return stats;
}

function hitungCohort(
  db: DbCohort,
  opts: {
    now_utc: string;
    filter?: CohortFilter;
    pending_reasons?: Map<number, string>;
  },
): { stats: CohortStats; validUntilMs: number } {
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
  // Agregasi di SQL (Fix-6 butir 6): versi lama mengambil SELURUH baris
  // cohort (170 ribu pada data produksi) lalu mengagregasi di JS —
  // terukur median 343 ms. Semantik tidak berubah: void keluar dari
  // semua hitungan selain `voids`; settled = non-void ber-outcome;
  // irisan peluang hanya atas settled ber-published_prob. Klasifikasi
  // jam untuk baris pending tetap di JS (aturan Date.parse + peta
  // alasan per id tidak bisa dinyatakan setara di SQL), tetapi hanya
  // atas baris yang benar-benar pending — ribuan, bukan ratusan ribu.
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const issued = (
    db.prepare(`SELECT COUNT(*) AS n FROM picks p ${whereSql}`).get(
      ...(params as never[]),
    ) as unknown as { n: number }
  ).n;
  const voids = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM picks p JOIN pick_voids v ON v.pick_id = p.id ${whereSql}`,
      )
      .get(...(params as never[])) as unknown as { n: number }
  ).n;
  const agg = db
    .prepare(
      `SELECT
         COUNT(*) AS settled,
         COALESCE(SUM(CASE WHEN o.hit = 1 THEN 1 ELSE 0 END), 0) AS hits,
         COALESCE(SUM(CASE WHEN o.hit <> 1 THEN 1 ELSE 0 END), 0) AS misses,
         COALESCE(SUM(CASE WHEN p.published_prob IS NOT NULL THEN 1 ELSE 0 END), 0) AS slice_n,
         COALESCE(SUM(CASE WHEN p.published_prob IS NOT NULL THEN p.published_prob ELSE 0 END), 0) AS slice_prob_sum,
         COALESCE(SUM(CASE WHEN p.published_prob IS NOT NULL THEN o.hit ELSE 0 END), 0) AS slice_hit_sum,
         COALESCE(SUM(CASE WHEN p.published_prob IS NULL THEN 1 ELSE 0 END), 0) AS legacy_only
       FROM pick_outcomes o
       JOIN picks p ON p.id = o.pick_id
       ${where.length ? `WHERE ${where.join(" AND ")} AND` : "WHERE"}
         NOT EXISTS (SELECT 1 FROM pick_voids v WHERE v.pick_id = p.id)`,
    )
    .get(...(params as never[])) as unknown as {
    settled: number;
    hits: number;
    misses: number;
    slice_n: number;
    slice_prob_sum: number;
    slice_hit_sum: number;
    legacy_only: number;
  };

  const pending = db
    .prepare(
      `SELECT p.id, p.kickoff_utc
       FROM picks p
       LEFT JOIN pick_outcomes o ON o.pick_id = p.id
       LEFT JOIN pick_voids v ON v.pick_id = p.id
       ${where.length ? `WHERE ${where.join(" AND ")} AND` : "WHERE"} v.pick_id IS NULL AND o.hit IS NULL`,
    )
    .all(...(params as never[])) as unknown as Pick<CohortRow, "id" | "kickoff_utc">[];

  const nowMs = Date.parse(opts.now_utc);
  const settled = agg.settled;
  const hits = agg.hits;
  const misses = agg.misses;
  let notStarted = 0;
  let awaitingWindow = 0;
  let overdue = 0;
  const overdueByReason: Record<string, number> = {};
  const sliceN = agg.slice_n;
  const sliceProbSum = agg.slice_prob_sum;
  const sliceHitSum = agg.slice_hit_sum;
  const legacyOnly = agg.legacy_only;
  // Instant transisi klasifikasi terdekat sesudah now (kedaluwarsa cache).
  let validUntilMs = Number.POSITIVE_INFINITY;

  for (const r of pending) {
    // Belum dinilai: klasifikasikan menurut jam.
    const ko = r.kickoff_utc ? Date.parse(r.kickoff_utc) : NaN;
    if (Number.isFinite(ko) && ko > nowMs) {
      notStarted++;
      if (ko < validUntilMs) validUntilMs = ko;
    } else if (Number.isFinite(ko) && nowMs < ko + SETTLEMENT_WINDOW_MS) {
      awaitingWindow++;
      if (ko + SETTLEMENT_WINDOW_MS < validUntilMs) validUntilMs = ko + SETTLEMENT_WINDOW_MS;
    } else {
      // Kickoff tak terbaca juga dihitung jatuh tempo: tidak bisa dibuktikan
      // masih masa depan, dan menahannya dari penyebut menyembunyikan utang.
      overdue++;
      const reason = opts.pending_reasons?.get(r.id) ?? "unspecified";
      overdueByReason[reason] = (overdueByReason[reason] ?? 0) + 1;
    }
  }

  const due = settled + overdue;
  const stats: CohortStats = {
    filter: f,
    issued,
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
  return { stats, validUntilMs };
}
