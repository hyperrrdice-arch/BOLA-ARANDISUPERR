/**
 * PR 2 — probe ukur sebelum/sesudah pada SALINAN produksi.
 * Dijalankan sebagai subprocess dengan cwd = tasks/pr2/staging (root data
 * salinan), jam beku NOW. Mencetak satu baris "PROBE_JSON " berisi:
 *  - cohort: cohortStats seri live-run (filter baku halaman /bukti),
 *  - per_kelas: cohortStats per grade (irisan prob_slice basis terbit),
 *  - ledger: ledgerStats().by_grade + live_by_grade_gate (permukaan data.ts),
 *  - rekam: ambilRekam filter baku (statistik + hitungan tab + baris terminal).
 * Probe tidak menilai; angka dibandingkan di luar.
 */
import { cohortStats } from "../../lib/picks/cohort";
import { ledgerStats } from "../../lib/web/data";
import {
  ambilRekam,
  kelompokkanTabRekam,
  parseFilterRekam,
} from "../../lib/web/rekam";

const NOW = "2026-11-24T08:45:00.000Z"; // ±15:45 WIB, selaras ukur PR 1A

function main(): void {
  const cohort = cohortStats({ now_utc: NOW, filter: { source: "live-run" } });
  const perKelas: Record<string, unknown> = {};
  for (const g of ["A", "B", "C"]) {
    const cs = cohortStats({
      now_utc: NOW,
      filter: { source: "live-run", grade: g },
    });
    perKelas[g] = {
      settled: cs.settled,
      hits: cs.hits,
      due: cs.due,
      overdue_pending: cs.overdue_pending,
      unresolvable: (cs as unknown as Record<string, unknown>).unresolvable ?? null,
      overdue_by_reason: cs.overdue_by_reason,
      prob_slice: cs.prob_slice,
    };
  }
  const led = ledgerStats();
  const rekam = ambilRekam(parseFilterRekam({}), NOW);
  const tab = kelompokkanTabRekam(rekam.baris);
  const out = {
    now: NOW,
    cohort: {
      issued: cohort.issued,
      settled: cohort.settled,
      hits: cohort.hits,
      hit_ratio: cohort.hit_ratio,
      due: cohort.due,
      coverage: cohort.coverage,
      coverage_ratio: cohort.coverage_ratio,
      voids: cohort.voids,
      not_started: cohort.not_started,
      awaiting_window: cohort.awaiting_window,
      overdue_pending: cohort.overdue_pending,
      unresolvable:
        (cohort as unknown as Record<string, unknown>).unresolvable ?? null,
      overdue_by_reason: cohort.overdue_by_reason,
      prob_slice: cohort.prob_slice,
    },
    per_kelas: perKelas,
    ledger_by_grade: led.by_grade,
    ledger_by_grade_gate: led.live_by_grade_gate,
    rekam_stats_due: rekam.stats.due,
    rekam_tab_hitungan: tab.hitungan,
    rekam_tab_tak_dinilai:
      (tab as unknown as Record<string, unknown>).takDinilai !== undefined
        ? (tab.takDinilai as unknown[]).length
        : null,
  };
  console.log(`PROBE_JSON ${JSON.stringify(out)}`);
}

main();
