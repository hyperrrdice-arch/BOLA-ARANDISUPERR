/**
 * BERANDA SEED (PR 1B) — dijalankan sebagai subprocess dengan cwd =
 * sandbox. Membangun skema inti dengan kode repo sebenarnya lalu
 * menanam data fixture per skenario (env BERANDA_SEED_SKENARIO):
 *   utama    — paket Beranda (prediksi, kickoff direvisi keluar/masuk
 *              jendela, tanpa angka terbit) + cohort pick untuk parity
 *              ringkasan rekam;
 *   cadangan — paket tanpa pick (tanpa-prediksi), paket jauh di masa
 *              depan (berikutnya), dan laga selesai relatif terhadap
 *              jam asli FIKTIF yang dibekukan (BERANDA_JAM_ASLI):
 *              hasil-terakhir membaca listFinished yang memakai
 *              Date.now() proses, bukan jam beku probe — probe
 *              menambatkan Date.now()-nya ke nilai yang sama;
 *   kosong   — skema saja.
 * Mencetak "SEED_OK" bila selesai.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BERANDA_JAM_ASLI, buildCoreSchemas } from "./fixture-env";
import { dbPath } from "../../lib/db/paths";

const TERBIT = "2026-11-17T12:00:00.000Z";
const TERBIT_PAKET = "2026-11-24T08:00:00.000Z";

function tulisRegistryDasar(): void {
  const dataDir = path.join(process.cwd(), "data");
  fs.writeFileSync(
    path.join(dataDir, "league-canonical.json"),
    JSON.stringify({
      version: 1,
      generated_at: "2026-11-18T00:00:00.000Z",
      generator: "tests/helpers/beranda-seed.ts (PR 1B fixture)",
      leagues: [
        { canonical_id: "comp_pr1b", name: "Liga Uji PR1B", country: "Indonesia", fits: [], aliases: [] },
      ],
    }),
  );
  fs.writeFileSync(
    path.join(dataDir, "fixture-links.json"),
    JSON.stringify({ links: [] }),
  );
  fs.writeFileSync(
    path.join(dataDir, "team-canonical.json"),
    JSON.stringify({
      version: 1,
      generated_at: "2026-11-18T00:00:00.000Z",
      generator: "tests/helpers/beranda-seed.ts (PR 1B fixture)",
      teams: [],
    }),
  );
}

interface LegSeed {
  market: string;
  selection: string;
  eff: number;
  grade?: string;
}

function payloadPaket(
  match: string,
  home: string,
  away: string,
  kickoff: string,
  legs: LegSeed[] = [],
): string {
  return JSON.stringify({
    fixture: {
      match_id: match,
      competition_name: "Liga Uji PR1B",
      home,
      away,
      kickoff_utc: kickoff,
    },
    gate_status: "partial",
    population: "domestic",
    lambda: 1.5,
    mu: 1.0,
    rho: 0,
    probabilities: { "1": 0.52, x: 0.27, "2": 0.21 },
    top_scores: [],
    score_matrix: [
      [0.08, 0.12, 0.05],
      [0.13, 0.16, 0.06],
      [0.09, 0.11, 0.04],
    ],
    market: null,
    sm_panel: null,
    legs: legs.map((l) => ({
      market: l.market,
      selection: l.selection,
      model_prob: l.eff,
      effective_prob: l.eff,
      effective_source: "model",
      band: null,
      band_n: null,
      grade: l.grade ?? "A",
      market_prob: null,
      sm_prob: null,
      agreement_spread: null,
    })),
  });
}

type InsPkg = ReturnType<DatabaseSync["prepare"]>;
function paket(
  ins: InsPkg,
  match: string,
  kickoff: string,
  computed: string,
  home: string,
  away: string,
  legs: LegSeed[] = [],
): number {
  const r = ins.run(
    match,
    "comp_pr1b",
    kickoff,
    computed,
    payloadPaket(match, home, away, kickoff, legs),
  );
  return Number(r.lastInsertRowid);
}

async function seedUtama(): Promise<void> {
  const { ledger } = await buildCoreSchemas();
  const publication = await import("../../lib/picks/publication");
  const tickets = await import("../../lib/picks/tickets");
  const pdb = ledger.getPicksDb();
  publication.ensurePublicationSchema(pdb);
  tickets.ensureTicketSchema(pdb);
  tulisRegistryDasar();

  /* ---- paket Beranda ---- */
  const snap = new DatabaseSync(dbPath("analysis_snapshots.db"));
  const insPkg = snap.prepare(
    `INSERT INTO packages (match_id, competition_canonical_id, kickoff_utc,
       computed_utc, trigger, fit_source, gate_status, payload_json)
     VALUES (?, ?, ?, ?, 'manual', 'fixture', 'partial', ?)`,
  );
  // E: kickoff 30 menit SEBELUM jam beku utama — tak boleh tampil.
  paket(insPkg, "sm_p1b_e", "2026-11-24T09:00:00.000Z", "2026-11-24T06:00:00.000Z", "Tim Pagi", "Tim Siang", [
    { market: "1x2", selection: "1", eff: 0.66, grade: "B" },
  ]);
  // D: tanpa pick resmi — dilewati sorotan, tampil di jadwal.
  paket(insPkg, "fd_p1b_d", "2026-11-25T10:00:00.000Z", "2026-11-24T06:00:00.000Z", "Tim Sepuluh", "Tim Sebelas", [
    { market: "dc", selection: "1x", eff: 0.9 },
  ]);
  // A: sorotan prediksi (pick resmi terbit sebelum kickoff).
  const pkgA = paket(insPkg, "sm_p1b_a", "2026-11-25T18:00:00.000Z", "2026-11-24T06:00:00.000Z", "Tim Satu", "Tim Dua", [
    { market: "1x2", selection: "1", eff: 0.7 },
    { market: "dc", selection: "1x", eff: 0.88 },
  ]);
  // B: edisi lama di dalam jendela, edisi BARU memindahkan kickoff ke
  // LUAR jendela — laga tidak boleh tampil sama sekali (kasus P01).
  paket(insPkg, "sm_p1b_b", "2026-11-25T08:00:00.000Z", "2026-11-24T06:00:00.000Z", "Tim Geser", "Tim Pindah", [
    { market: "1x2", selection: "1", eff: 0.77 },
  ]);
  paket(insPkg, "sm_p1b_b", "2026-11-30T18:00:00.000Z", "2026-11-24T07:00:00.000Z", "Tim Geser", "Tim Pindah", [
    { market: "1x2", selection: "1", eff: 0.77 },
  ]);
  // C: edisi lama di luar jendela (lampau), edisi BARU masuk jendela —
  // yang tampil adalah edisi baru.
  paket(insPkg, "sm_p1b_c", "2026-11-20T18:00:00.000Z", "2026-11-24T06:30:00.000Z", "Tim Masuk", "Tim Datang", [
    { market: "1x2", selection: "1", eff: 0.6, grade: "B" },
  ]);
  paket(insPkg, "sm_p1b_c", "2026-11-27T10:00:00.000Z", "2026-11-24T07:30:00.000Z", "Tim Masuk", "Tim Datang", [
    { market: "1x2", selection: "1", eff: 0.64, grade: "B" },
  ]);
  snap.close();

  /* ---- pick resmi untuk sorotan ---- */
  const pk = new DatabaseSync(dbPath("picks.db"));
  const insPick = pk.prepare(
    `INSERT INTO picks (created_utc, match_id, competition_canonical_id, kickoff_utc,
       market, selection, model_prob, effective_prob, gate_status, grade, source,
       package_id, pick_uid, fixture_uid, line, series, published_prob,
       probability_basis, published_at_utc, decision_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'partial', ?, ?, ?, ?, ?, '', 'live-run', ?, ?, ?, ?)`,
  );
  const insOutcome = pk.prepare(
    `INSERT INTO pick_outcomes (pick_id, resolved_utc, home_goals, away_goals, hit)
     VALUES (?, '2026-11-24T00:00:00.000Z', ?, ?, ?)`,
  );
  function pick(o: {
    match: string;
    uid: string | null;
    kickoff: string;
    market: string;
    selection: string;
    prob: number | null;
    basis: string | null;
    grade: string;
    pkg: number | null;
    pickUid: string | null;
    source?: string;
    terbit?: string | null;
    hit?: number;
    skor?: [number, number];
  }): number {
    const r = insPick.run(
      TERBIT,
      o.match,
      "comp_pr1b",
      o.kickoff,
      o.market,
      o.selection,
      o.prob ?? 0.5,
      o.prob,
      o.grade,
      o.source ?? "live-run",
      o.pkg,
      o.pickUid,
      o.uid,
      o.prob,
      o.basis,
      o.terbit === undefined ? (o.prob === null ? null : TERBIT) : o.terbit,
      TERBIT,
    );
    const id = Number(r.lastInsertRowid);
    if (o.hit !== undefined && o.skor) insOutcome.run(id, o.skor[0], o.skor[1], o.hit);
    return id;
  }
  // Pick resmi sorotan A (terbit < kickoff) + pick E tanpa angka terbit.
  pick({ match: "sm_p1b_a", uid: "fx_p1b_a", kickoff: "2026-11-25T18:00:00.000Z", market: "dc", selection: "1x", prob: 0.88, basis: "effective", grade: "A", pkg: pkgA, pickUid: "pick_p1b_a", terbit: TERBIT_PAKET });
  pick({ match: "sm_p1b_e", uid: "fx_p1b_e", kickoff: "2026-11-24T09:00:00.000Z", market: "1x2", selection: "1", prob: 0.66, basis: "effective", grade: "B", pkg: null, pickUid: "pick_p1b_e", terbit: null });

  /* ---- cohort rekam (comp_pr1b) ---- */
  // Dinilai: r1 dua tepat; r2 (UID NULL → alias) meleset; r3 (UID NULL →
  // alias laga fisik yang SAMA dengan r2) tepat; r4 warisan tanpa angka
  // terbit tepat; r5 tepat tetapi VOID — tidak dihitung.
  pick({ match: "sm_p1b_r1", uid: "fx_p1b_r1", kickoff: "2026-11-20T18:00:00.000Z", market: "1x2", selection: "1", prob: 0.8, basis: "effective", grade: "A", pkg: null, pickUid: "pick_p1b_s1", hit: 1, skor: [2, 0] });
  pick({ match: "sm_p1b_r1", uid: "fx_p1b_r1", kickoff: "2026-11-20T18:00:00.000Z", market: "dc", selection: "1x", prob: 0.85, basis: "effective", grade: "A", pkg: null, pickUid: "pick_p1b_s2", hit: 1, skor: [2, 0] });
  pick({ match: "fd_p1b_r2", uid: null, kickoff: "2026-11-21T18:00:00.000Z", market: "1x2", selection: "1", prob: 0.7, basis: "effective", grade: "B", pkg: null, pickUid: "pick_p1b_s3", hit: 0, skor: [0, 1] });
  pick({ match: "fd_p1b_r3", uid: null, kickoff: "2026-11-21T20:00:00.000Z", market: "ou25", selection: "over", prob: 0.66, basis: "effective", grade: "B", pkg: null, pickUid: "pick_p1b_s4", hit: 1, skor: [3, 1] });
  pick({ match: "sm_p1b_r4", uid: "fx_p1b_r4", kickoff: "2026-11-22T18:00:00.000Z", market: "1x2", selection: "1", prob: null, basis: "unknown_legacy", grade: "A", pkg: null, pickUid: "pick_p1b_s5", hit: 1, skor: [1, 0] });
  const s6 = pick({ match: "sm_p1b_r5", uid: "fx_p1b_r5", kickoff: "2026-11-22T20:00:00.000Z", market: "btts", selection: "yes", prob: 0.6, basis: "effective", grade: "B", pkg: null, pickUid: "pick_p1b_s6", hit: 0, skor: [0, 0] });
  pk.prepare(
    `INSERT INTO pick_voids (pick_id, fixture_uid, voided_utc, reason, policy_version)
     VALUES (?, 'fx_p1b_r5', '2026-11-22T21:00:00.000Z', 'provider_cancelled', 'k1-2026-11')`,
  ).run(s6);
  // Menunggu: belum mulai, menunggu jendela, jatuh tempo konflik, jatuh
  // tempo tanpa alasan.
  pick({ match: "sm_p1b_r6", uid: "fx_p1b_r6", kickoff: "2026-11-25T18:00:00.000Z", market: "1x2", selection: "1", prob: 0.81, basis: "effective", grade: "A", pkg: null, pickUid: "pick_p1b_p1" });
  pick({ match: "sm_p1b_r7", uid: "fx_p1b_r7", kickoff: "2026-11-24T10:00:00.000Z", market: "1x2", selection: "1", prob: 0.71, basis: "effective", grade: "B", pkg: null, pickUid: "pick_p1b_p2" });
  pick({ match: "sm_p1b_r8", uid: "fx_p1b_r8", kickoff: "2026-11-20T10:00:00.000Z", market: "ou25", selection: "over", prob: 0.73, basis: "effective", grade: "B", pkg: null, pickUid: "pick_p1b_p3" });
  pick({ match: "sm_p1b_r9", uid: "fx_p1b_r9", kickoff: "2026-11-19T10:00:00.000Z", market: "btts", selection: "yes", prob: 0.69, basis: "effective", grade: "B", pkg: null, pickUid: "pick_p1b_p4" });
  // Baris lab dinilai — tidak masuk cohort resmi mana pun.
  pick({ match: "sm_p1b_r1", uid: "fx_p1b_r1", kickoff: "2026-11-20T18:00:00.000Z", market: "ou35", selection: "over", prob: 0.55, basis: "model", grade: "C", pkg: null, pickUid: null, source: "lab", hit: 1, skor: [2, 0] });
  pk.close();

  /* ---- store identitas: alias laga fisik + antrean konflik ---- */
  const identity = await import("../../lib/identity/fixture-resolver");
  const ds = new DatabaseSync(dbPath("thestats_dataset.db"));
  identity.ensureIdentitySchema(ds);
  const insAlias = ds.prepare(
    `INSERT INTO fixture_aliases (source, source_match_id, fixture_uid, match_basis, first_seen_utc, last_seen_utc)
     VALUES ('football-data', ?, 'fx_p1b_fisik2', 'fixture', ?, ?)`,
  );
  insAlias.run("fd_p1b_r2", TERBIT, TERBIT);
  insAlias.run("fd_p1b_r3", TERBIT, TERBIT);
  ds.prepare(
    `INSERT INTO fixture_identity_queue (source, source_match_id, reason, detail_json, created_at)
     VALUES ('sportmonks', 'sm_p1b_r8', 'identity_ambiguous', '{}', '2026-11-20T21:00:00.000Z')`,
  ).run();
  ds.close();
}

async function seedCadangan(): Promise<void> {
  await buildCoreSchemas();
  tulisRegistryDasar();

  const snap = new DatabaseSync(dbPath("analysis_snapshots.db"));
  const insPkg = snap.prepare(
    `INSERT INTO packages (match_id, competition_canonical_id, kickoff_utc,
       computed_utc, trigger, fit_source, gate_status, payload_json)
     VALUES (?, ?, ?, ?, 'manual', 'fixture', 'partial', ?)`,
  );
  // T: satu-satunya laga di jendela NOW_T, tanpa pick → tanpa-prediksi.
  paket(insPkg, "sm_p1b_t", "2026-11-24T06:00:00.000Z", "2026-11-24T01:00:00.000Z", "Tim Sunyi", "Tim Sepi", [
    { market: "1x2", selection: "1", eff: 0.58, grade: "B" },
  ]);
  // N: jauh sesudah jendela NOW_B → sorotan "berikutnya".
  paket(insPkg, "sm_p1b_n", "2027-06-10T18:00:00.000Z", "2027-05-30T01:00:00.000Z", "Tim Nanti", "Tim Kelak", [
    { market: "1x2", selection: "1", eff: 0.61, grade: "B" },
  ]);
  // F: laga selesai relatif terhadap jam asli fiktif BERANDA_JAM_ASLI
  // (listFinished membaca jendela [asli−720j, asli−3j] dari Date.now()
  // proses; probe menambatkan Date.now() ke nilai yang sama) →
  // sorotan "hasil-terakhir" di NOW_H. Kickoff ini juga selalu SEBELUM
  // NOW_T, jadi F tidak pernah menyusup ke jadwal beku tanpa-prediksi.
  const kickFin = new Date(Date.parse(BERANDA_JAM_ASLI) - 26 * 3_600_000).toISOString();
  paket(insPkg, "sm_p1b_f", kickFin, "2026-11-20T01:00:00.000Z", "Tim Akhir", "Tim Usai", []);
  snap.close();

  const ds = new DatabaseSync(dbPath("thestats_dataset.db"));
  const insTim = ds.prepare(
    "INSERT OR IGNORE INTO teams (team_id, name, short_name, country, stadium, updated_at) VALUES (?, ?, NULL, 'Indonesia', NULL, '2026-11-20T00:00:00.000Z')",
  );
  insTim.run("tm_akhir", "Tim Akhir");
  insTim.run("tm_usai", "Tim Usai");
  ds.prepare(
    `INSERT INTO matches (match_id, competition_id, season, utc_date, status,
       home_team_id, away_team_id, home_score, away_score, referee_name, updated_at)
     VALUES ('sm_p1b_f', 'X1', '2026-2027', ?, 'finished', 'tm_akhir', 'tm_usai', 2, 1, NULL, ?)`,
  ).run(kickFin, kickFin);
  ds.close();
}

async function main(): Promise<void> {
  const skenario = process.env.BERANDA_SEED_SKENARIO ?? "utama";
  if (skenario === "utama") await seedUtama();
  else if (skenario === "cadangan") await seedCadangan();
  else if (skenario === "kosong") {
    await buildCoreSchemas();
    tulisRegistryDasar();
  } else {
    throw new Error(`skenario tak dikenal: ${skenario}`);
  }
  console.log("SEED_OK");
}

main();
