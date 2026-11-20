/**
 * REKAM PROBE (K7) — dijalankan sebagai subprocess dengan cwd = sandbox.
 *
 * Memanggil lapisan baca rekam sebenarnya (lib/web/rekam.ts) terhadap DB
 * fixture K7 pada jam beku NOW dan mencetak satu baris "PROBE_JSON ":
 *  - utama/pasar/lain/meleset/kosong: ambilRekam per filter (statistik +
 *    baris ringkas),
 *  - sql: agregat SQL mentah untuk spot-check filter utama,
 *  - tiketA/tiketB/tiketHantu: ambilDetailTiket,
 *  - praLaga: daftarPilihanPraLaga.
 * Probe tidak menilai apa pun; suite yang menilai.
 */
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  ambilDetailTiket,
  ambilRekam,
  daftarPilihanPraLaga,
  parseFilterRekam,
} from "../../lib/web/rekam";

export const NOW = "2026-11-21T12:00:00.000Z";

function ringkas(data: ReturnType<typeof ambilRekam>) {
  const s = data.stats;
  return {
    issued: s.issued,
    settled: s.settled,
    hits: s.hits,
    misses: s.misses,
    hit_ratio: s.hit_ratio,
    empty: s.empty,
    due: s.due,
    coverage: s.coverage,
    coverage_ratio: s.coverage_ratio,
    voids: s.voids,
    not_started: s.not_started,
    awaiting_window: s.awaiting_window,
    overdue_pending: s.overdue_pending,
    overdue_by_reason: s.overdue_by_reason,
    prob_slice: s.prob_slice,
    laga_dinilai_unik: data.laga_dinilai_unik,
    diperbarui_utc: data.diperbarui_utc,
    baris: data.baris.map((b) => ({
      pick_id: b.pick_id,
      match_id: b.match_id,
      keadaan: b.keadaan,
      alasan_jatuh_tempo: b.alasan_jatuh_tempo,
      published_display: b.published_display,
      probability_basis: b.probability_basis,
    })),
    tiket_stats: data.tiket_stats,
    tiket_uids: data.tiket.map((t) => t.slip_uid),
    opsi_liga: data.opsi_liga,
    opsi_pasar: data.opsi_pasar,
  };
}

function main(): void {
  const utama = ambilRekam(parseFilterRekam({ liga: "comp_k7_rekam" }), NOW);
  const pasar = ambilRekam(
    parseFilterRekam({ liga: "comp_k7_rekam", pasar: "1x2" }),
    NOW,
  );
  const lain = ambilRekam(parseFilterRekam({ liga: "comp_k7_lain" }), NOW);
  const meleset = ambilRekam(parseFilterRekam({ liga: "comp_k7_meleset" }), NOW);
  const kosong = ambilRekam(parseFilterRekam({ liga: "comp_tidak_ada" }), NOW);

  // Spot-check SQL mentah pada filter utama (sampel yang sama).
  const db = new DatabaseSync(path.join(process.cwd(), "data", "picks.db"), {
    readOnly: true,
  });
  const sql = db
    .prepare(
      `SELECT COUNT(*) AS issued,
              SUM(CASE WHEN o.hit IS NOT NULL AND v.pick_id IS NULL THEN 1 ELSE 0 END) AS settled,
              SUM(CASE WHEN o.hit = 1 AND v.pick_id IS NULL THEN 1 ELSE 0 END) AS hits,
              AVG(CASE WHEN o.hit IS NOT NULL AND v.pick_id IS NULL
                        AND p.published_prob IS NOT NULL THEN p.published_prob END) AS avg_prob,
              SUM(CASE WHEN o.hit IS NOT NULL AND v.pick_id IS NULL
                        AND p.published_prob IS NULL THEN 1 ELSE 0 END) AS legacy
       FROM picks p
       LEFT JOIN pick_outcomes o ON o.pick_id = p.id
       LEFT JOIN pick_voids v ON v.pick_id = p.id
       WHERE p.source = 'live-run' AND p.competition_canonical_id = 'comp_k7_rekam'`,
    )
    .get() as Record<string, unknown>;
  db.close();

  const uidA = utama.tiket.find((t) => t.edition_key === "k7-edisi-a")?.slip_uid;
  const uidB = utama.tiket.find((t) => t.edition_key === "k7-edisi-b")?.slip_uid;
  const tiketA = uidA ? ambilDetailTiket(uidA) : null;
  const tiketB = uidB ? ambilDetailTiket(uidB) : null;
  const tiketHantu = ambilDetailTiket("sl_tidak_ada");

  const out = {
    utama: ringkas(utama),
    pasar: ringkas(pasar),
    lain: ringkas(lain),
    meleset: ringkas(meleset),
    kosong: ringkas(kosong),
    sql: {
      issued: sql.issued,
      settled: sql.settled,
      hits: sql.hits,
      avg_prob: sql.avg_prob,
      legacy: sql.legacy,
    },
    tiketA: tiketA
      ? {
          state: tiketA.slip.state,
          has_missed_leg: tiketA.slip.has_missed_leg,
          combined_prob: tiketA.slip.combined_prob,
          legs: tiketA.legs.map((l) => ({ state: l.state, home: l.home, frozen_prob: l.frozen_prob })),
        }
      : null,
    tiketB: tiketB
      ? {
          state: tiketB.slip.state,
          has_missed_leg: tiketB.slip.has_missed_leg,
          combined_prob: tiketB.slip.combined_prob,
          legs: tiketB.legs.map((l) => ({ state: l.state, home: l.home, frozen_prob: l.frozen_prob })),
        }
      : null,
    tiketHantu,
    praLaga: daftarPilihanPraLaga(NOW).map((p) => ({
      pick_uid: p.pick_uid,
      fixture_uid: p.fixture_uid,
      published_prob: p.published_prob,
    })),
  };
  console.log(`PROBE_JSON ${JSON.stringify(out)}`);
}

main();
