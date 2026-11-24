/**
 * PR 2 PROBE — dijalankan sebagai subprocess dengan cwd = sandbox.
 * Memanggil pembaca sebenarnya pada jam beku NOW dan mencetak satu
 * baris "PROBE_JSON ":
 *  - cohortLangsung: cohortStats TANPA peta alasan (klasifikasi
 *    struktural murni),
 *  - rekam: ambilRekam filter baku (statistik + baris ringkas),
 *  - ringkasan: ambilRingkasanRekam (paritas Beranda vs /bukti),
 *  - tab: kelompokkanTabRekam atas baris rekam,
 *  - ledger: ledgerStats().by_grade (permukaan data.ts),
 *  - detail: getMatchDetail laga L01 (edisi terbit vs terbaru).
 * Probe tidak menilai apa pun; suite yang menilai.
 */
import { cohortStats, type CohortStats } from "../../lib/picks/cohort";
import { getMatchDetail, ledgerStats } from "../../lib/web/data";
import {
  ambilRekam,
  ambilRingkasanRekam,
  kelompokkanTabRekam,
  parseFilterRekam,
} from "../../lib/web/rekam";

export const NOW = "2026-11-24T12:00:00.000Z";

function ringkasStats(s: CohortStats) {
  return {
    issued: s.issued,
    settled: s.settled,
    hits: s.hits,
    misses: s.misses,
    hit_ratio: s.hit_ratio,
    due: s.due,
    coverage: s.coverage,
    coverage_ratio: s.coverage_ratio,
    voids: s.voids,
    not_started: s.not_started,
    awaiting_window: s.awaiting_window,
    overdue_pending: s.overdue_pending,
    unresolvable: s.unresolvable,
    overdue_by_reason: s.overdue_by_reason,
    prob_slice: s.prob_slice,
  };
}

function main(): void {
  const cohortLangsung = cohortStats({
    now_utc: NOW,
    filter: { source: "live-run" },
  });
  const rekam = ambilRekam(parseFilterRekam({}), NOW);
  const ringkasan = ambilRingkasanRekam(parseFilterRekam({}), NOW);
  const tab = kelompokkanTabRekam(rekam.baris);
  const ledger = ledgerStats();
  const detail = getMatchDetail("sm_pr2_l01");
  const out = {
    cohortLangsung: ringkasStats(cohortLangsung),
    rekam: {
      stats: ringkasStats(rekam.stats),
      baris: rekam.baris.map((b) => ({
        match_id: b.match_id,
        keadaan: b.keadaan,
        alasan_jatuh_tempo: b.alasan_jatuh_tempo,
        published_display: b.published_display,
      })),
    },
    ringkasan: ringkasStats(ringkasan.stats),
    tab: {
      hitungan: tab.hitungan,
      takDinilai: tab.takDinilai.map((b) => b.match_id),
      menungguLewat: tab.menungguLewat.map((b) => b.match_id),
    },
    ledgerByGrade: ledger.by_grade.map((g) => ({
      grade: g.grade,
      n: g.n,
      resolved: g.resolved,
      hits: g.hits,
      hit_rate: g.hit_rate,
      claimed: g.claimed,
      prob_n: g.prob_n,
      gap_pp: g.gap_pp,
    })),
    detail: detail
      ? {
          pkg_id: detail.pkg.id,
          paket_terbit_id: detail.paketTerbit?.id ?? null,
          official: detail.officialPicks.map((p) => ({
            published_prob: p.published_prob,
            package_id: p.package_id,
          })),
          trio_terbaru: detail.pkg.payload.probabilities,
          trio_terbit: detail.paketTerbit?.payload.probabilities ?? null,
        }
      : null,
  };
  console.log(`PROBE_JSON ${JSON.stringify(out)}`);
}

main();
