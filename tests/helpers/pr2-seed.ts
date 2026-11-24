/**
 * PR 2 SEED — dijalankan sebagai subprocess dengan cwd = sandbox.
 * Menanam fixture untuk uji data & publikasi (PR 2):
 *
 *  - Registri liga fixture: `comp_pr2_feed` terpetakan ke divisi hasil
 *    aktif (alias legacy-div E0) → berfeed; `comp_pr2_nofeed` terdaftar
 *    tanpa alias divisi → tanpa-feed; `comp_pr2_asing` SENGAJA tidak
 *    didaftarkan → tidak-diketahui. Varian env PR2_SEED_VARIANT=
 *    "tanpa-registri" melewati penulisan registri sama sekali.
 *  - Pick live-run pada jam beku probe (2026-11-24T12:00Z): settled
 *    ber-published_prob (model != published supaya basis terbaca),
 *    settled warisan tanpa published_prob, jatuh tempo dari tiap kelas
 *    feed, konflik identitas di kompetisi tanpa feed (preseden alasan),
 *    belum mulai, menunggu jendela, dan satu void.
 *  - L01: pick resmi terbit p=0,78 dari paket A; paket B (lebih baru)
 *    membawa angka model berbeda untuk laga yang sama.
 *  - Antrean konflik K1 berisi match_id pick konflik di dataset sandbox.
 *
 * Mencetak "SEED_OK" bila selesai.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildCoreSchemas } from "./fixture-env";

const TERBIT = "2026-11-19T12:00:00.000Z";

function tulisRegistri(): void {
  const dataDir = path.join(process.cwd(), "data");
  fs.writeFileSync(
    path.join(dataDir, "league-canonical.json"),
    JSON.stringify({
      version: 1,
      generated_at: "2026-11-24T00:00:00.000Z",
      generator: "tests/helpers/pr2-seed.ts (PR 2 fixture)",
      leagues: [
        {
          canonical_id: "comp_pr2_feed",
          name: "Liga Berfeed",
          country: "Uji",
          fits: [],
          aliases: [
            { system: "legacy-div", id: "E0", name_as_stored: "English Premier League" },
          ],
        },
        {
          canonical_id: "comp_pr2_nofeed",
          name: "Liga Tanpa Feed",
          country: "Uji",
          fits: [],
          aliases: [
            { system: "thestats", id: "comp_pr2_nofeed", name_as_stored: "Liga Tanpa Feed" },
          ],
        },
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
      generated_at: "2026-11-24T00:00:00.000Z",
      generator: "tests/helpers/pr2-seed.ts (PR 2 fixture)",
      teams: [],
    }),
  );
}

function payloadPaket(
  match: string,
  home: string,
  away: string,
  kickoff: string,
  trio: { a: number; x: number; b: number },
  effDc: number,
): string {
  return JSON.stringify({
    fixture: {
      match_id: match,
      competition_name: "Liga Berfeed",
      home,
      away,
      kickoff_utc: kickoff,
    },
    gate_status: "partial",
    population: "domestic",
    lambda: 1.5,
    mu: 1.0,
    rho: 0,
    probabilities: { "1": trio.a, x: trio.x, "2": trio.b },
    top_scores: [],
    score_matrix: [
      [0.08, 0.12, 0.05],
      [0.13, 0.16, 0.06],
      [0.09, 0.11, 0.04],
    ],
    market: null,
    sm_panel: null,
    legs: [
      {
        market: "dc",
        selection: "1x",
        model_prob: effDc,
        effective_prob: effDc,
        effective_source: "model",
        band: null,
        band_n: null,
        grade: "A",
        market_prob: null,
        sm_prob: null,
        agreement_spread: null,
      },
    ],
  });
}

async function main(): Promise<void> {
  const { ledger } = await buildCoreSchemas();
  const publication = await import("../../lib/picks/publication");
  const pdb = ledger.getPicksDb();
  publication.ensurePublicationSchema(pdb);

  if (process.env.PR2_SEED_VARIANT !== "tanpa-registri") tulisRegistri();

  /* ---- antrean konflik identitas (dataset sandbox) ---- */
  const ds = new DatabaseSync(path.join(process.cwd(), "data", "thestats_dataset.db"));
  ds.exec(
    `CREATE TABLE IF NOT EXISTS fixture_identity_queue (
       id INTEGER PRIMARY KEY, source_match_id TEXT, reason TEXT, resolved_at TEXT
     )`,
  );
  ds.prepare(
    `INSERT INTO fixture_identity_queue (source_match_id, reason, resolved_at)
     VALUES ('mt_pr2_konflik', 'identity_ambiguous', NULL)`,
  ).run();
  ds.close();

  /* ---- paket L01: A (penerbit) lalu B (edisi terbaru) ---- */
  const snap = new DatabaseSync(path.join(process.cwd(), "data", "analysis_snapshots.db"));
  const insPkg = snap.prepare(
    `INSERT INTO packages (match_id, competition_canonical_id, kickoff_utc,
       computed_utc, trigger, fit_source, gate_status, payload_json)
     VALUES (?, ?, ?, ?, 'manual', 'fixture', 'partial', ?)`,
  );
  const KO_L01 = "2026-11-26T10:00:00.000Z";
  const pkgA = Number(
    insPkg.run(
      "sm_pr2_l01", "comp_pr2_feed", KO_L01, "2026-11-24T06:00:00.000Z",
      payloadPaket("sm_pr2_l01", "Tim Terbit", "Tim Tamu", KO_L01, { a: 0.55, x: 0.25, b: 0.2 }, 0.78),
    ).lastInsertRowid,
  );
  insPkg.run(
    "sm_pr2_l01", "comp_pr2_feed", KO_L01, "2026-11-24T09:00:00.000Z",
    payloadPaket("sm_pr2_l01", "Tim Terbit", "Tim Tamu", KO_L01, { a: 0.62, x: 0.22, b: 0.16 }, 0.84),
  );
  snap.close();

  /* ---- picks ---- */
  const pk = new DatabaseSync(path.join(process.cwd(), "data", "picks.db"));
  const insPick = pk.prepare(
    `INSERT INTO picks (created_utc, match_id, competition_canonical_id, kickoff_utc,
       market, selection, model_prob, effective_prob, gate_status, grade, source,
       package_id, pick_uid, fixture_uid, line, series, published_prob,
       probability_basis, published_at_utc, decision_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'partial', ?, 'live-run', ?, ?, ?, '', 'live-run', ?, ?, ?, ?)`,
  );
  const insOutcome = pk.prepare(
    `INSERT INTO pick_outcomes (pick_id, resolved_utc, home_goals, away_goals, hit)
     VALUES (?, '2026-11-21T00:00:00.000Z', ?, ?, ?)`,
  );
  const insVoid = pk.prepare(
    `INSERT INTO pick_voids (pick_id, voided_utc, reason, policy_version)
     VALUES (?, '2026-11-22T00:00:00.000Z', 'cancelled', 'fixture')`,
  );

  function pick(o: {
    match: string;
    comp: string;
    kickoff: string;
    market?: string;
    model: number;
    pub: number | null;
    basis: string | null;
    grade: string;
    pkg?: number | null;
    uid?: string | null;
    hit?: number;
    skor?: [number, number];
    batal?: boolean;
  }): void {
    const r = insPick.run(
      TERBIT, o.match, o.comp, o.kickoff,
      o.market ?? "dc", "1x", o.model, o.model, o.grade,
      o.pkg ?? null, o.uid ?? null, o.match, o.pub, o.basis,
      o.pub !== null ? TERBIT : null, o.pub !== null ? TERBIT : null,
    );
    const id = Number(r.lastInsertRowid);
    if (o.hit !== undefined && o.skor) {
      insOutcome.run(id, o.skor[0], o.skor[1], o.hit);
    }
    if (o.batal) insVoid.run(id);
  }

  // Settled — irisan terbit (model != published agar basis terbaca).
  pick({ match: "sm_pr2_s1", comp: "comp_pr2_feed", kickoff: "2026-11-20T10:00:00.000Z", model: 0.9, pub: 0.8, basis: "effective", grade: "A", hit: 1, skor: [2, 0] });
  pick({ match: "sm_pr2_s2", comp: "comp_pr2_feed", kickoff: "2026-11-20T12:00:00.000Z", model: 0.7, pub: 0.6, basis: "effective", grade: "A", hit: 0, skor: [0, 1] });
  // Settled — warisan tanpa published_prob.
  pick({ match: "sm_pr2_s3", comp: "comp_pr2_feed", kickoff: "2026-11-20T14:00:00.000Z", model: 0.66, pub: null, basis: "unknown_legacy", grade: "A", hit: 1, skor: [1, 0] });
  // Settled kelas B.
  pick({ match: "sm_pr2_s4", comp: "comp_pr2_feed", kickoff: "2026-11-20T16:00:00.000Z", market: "ou25", model: 0.75, pub: 0.65, basis: "effective", grade: "B", hit: 1, skor: [3, 1] });
  // Jatuh tempo — kompetisi berfeed (lag publikasi biasa).
  pick({ match: "sm_pr2_o1", comp: "comp_pr2_feed", kickoff: "2026-11-23T10:00:00.000Z", model: 0.88, pub: 0.88, basis: "effective", grade: "A" });
  // Jatuh tempo — kompetisi tanpa feed (terminal).
  pick({ match: "sm_pr2_o2", comp: "comp_pr2_nofeed", kickoff: "2026-11-23T10:00:00.000Z", model: 0.87, pub: 0.87, basis: "effective", grade: "A" });
  // Jatuh tempo — tanpa feed TETAPI di antrean konflik (alasan menang).
  pick({ match: "mt_pr2_konflik", comp: "comp_pr2_nofeed", kickoff: "2026-11-23T09:00:00.000Z", model: 0.86, pub: 0.86, basis: "effective", grade: "A" });
  // Jatuh tempo — kompetisi tidak terdaftar (tidak boleh ditebak terminal).
  pick({ match: "sm_pr2_o4", comp: "comp_pr2_asing", kickoff: "2026-11-23T08:00:00.000Z", model: 0.85, pub: 0.85, basis: "effective", grade: "A" });
  // Belum mulai di kompetisi tanpa feed (belum jatuh tempo → bukan terminal).
  pick({ match: "sm_pr2_n1", comp: "comp_pr2_nofeed", kickoff: "2026-11-25T10:00:00.000Z", model: 0.9, pub: 0.9, basis: "effective", grade: "A" });
  // Menunggu jendela di kompetisi tanpa feed (belum jatuh tempo → bukan terminal).
  pick({ match: "sm_pr2_w1", comp: "comp_pr2_nofeed", kickoff: "2026-11-24T08:00:00.000Z", model: 0.9, pub: 0.9, basis: "effective", grade: "A" });
  // Void di kompetisi tanpa feed.
  pick({ match: "sm_pr2_v1", comp: "comp_pr2_nofeed", kickoff: "2026-11-22T10:00:00.000Z", model: 0.9, pub: 0.9, basis: "effective", grade: "A", batal: true });
  // L01 — pick resmi dari paket A.
  pick({
    match: "sm_pr2_l01", comp: "comp_pr2_feed", kickoff: KO_L01,
    model: 0.78, pub: 0.78, basis: "effective", grade: "A",
    pkg: pkgA, uid: "pk_pr2_l01",
  });
  pk.close();

  console.log("SEED_OK");
}

main();
