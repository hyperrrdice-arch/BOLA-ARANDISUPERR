/**
 * SEED BUKTI RENDER B2.2 — menanam data fixture ke direktori DB
 * terpisah (DB_DIR) untuk screenshot Beranda / Detail / Pilihan:
 *  - marker `free_refresh_last_success_utc` ±35 menit yang lalu
 *    (ditulis lewat `catatRefreshSukses`, penulis yang sama dengan
 *    rantai refresh) → footer Beranda menampilkannya;
 *  - satu laga "b22_derby" dengan DUA pilihan resmi pra-laga:
 *      a. 1x2 basis model, evidence model-only → "Peluang model saat
 *         terbit" + "Model saja";
 *      b. ou25 basis effective lab-band + quote Bet365 prematch valid
 *         → "Peluang saat terbit" + "Disesuaikan dari uji historis" +
 *         "Pembanding pasar · Bet365 · Tercatat … WIB";
 *  - dua paket untuk laga itu: edisi terbit (sumber pilihan resmi) dan
 *    paket terbaru (payload penuh untuk Sumber angka + Panel arsip).
 *
 * Pakai: npx tsx tasks/b2-2/seed-evidence.ts <dir-db-absolut>
 * Idempoten: baris b22_* dibersihkan lalu ditanam ulang. Target wajib
 * di luar data/ repo — data produksi tidak pernah disentuh.
 */
import fs from "node:fs";
import path from "node:path";

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: seed-evidence.ts <dir-db-absolut>");
    process.exit(2);
  }
  const abs = path.resolve(dir);
  if (abs.includes(`${path.sep}app-football`) && abs.includes(`${path.sep}data`)) {
    console.error("target terlihat seperti direktori data repo — ditolak");
    process.exit(2);
  }
  fs.mkdirSync(abs, { recursive: true });
  process.env.DB_DIR = abs;

  const { DatabaseSync } = await import("node:sqlite");
  const { dbPath } = await import("../../lib/db/paths");
  const dataset = await import("../../lib/db/thestats-dataset");
  dataset.getTheStatsDb();
  const upcoming = await import("../../lib/db/upcoming-fixtures");
  upcoming.getUpcomingDb();
  const packages = await import("../../lib/picks/packages");
  const ledger = await import("../../lib/picks/ledger");
  const publication = await import("../../lib/picks/publication");

  const db = ledger.getPicksDb();
  publication.ensurePublicationSchema(db);
  db.exec("DELETE FROM picks WHERE match_id LIKE 'b22_%'");

  const snap = new DatabaseSync(dbPath("analysis_snapshots.db"));
  packages.ensurePackagesSchema(snap);
  snap.exec("DELETE FROM packages WHERE match_id LIKE 'b22_%'");
  snap.exec("DELETE FROM meta WHERE key = 'free_refresh_last_success_utc'");
  snap.close();

  /* Marker: ±35 menit sebelum seed berjalan. */
  const marker = new Date(Date.now() - 35 * 60_000).toISOString();
  packages.catatRefreshSukses(marker);

  /* Jam fixture relatif terhadap jam berjalan supaya laga pra-laga. */
  const now = Date.now();
  const decision = new Date(now - 30 * 60_000).toISOString();
  const captured = new Date(now - 45 * 60_000).toISOString();
  const kickoff = new Date(now + 26 * 3_600_000).toISOString();

  const probs: Record<string, number> = {
    "1x2:1": 0.8, "1x2:x": 0.12, "1x2:2": 0.08,
    "dc:1x": 0.92, "dc:12": 0.88, "dc:x2": 0.2,
    "ou15:over": 0.9, "ou15:under": 0.1,
    "ou25:over": 0.77, "ou25:under": 0.23,
    "ou35:over": 0.45, "ou35:under": 0.55,
    "btts:yes": 0.6, "btts:no": 0.4,
    "team_over05_home:yes": 0.88, "team_over05_away:yes": 0.71,
  };
  const marketProbs: Record<string, number> = {
    "1x2:1": 0.78, "1x2:x": 0.13, "1x2:2": 0.09,
    "ou25:over": 0.74, "ou25:under": 0.26,
  };
  const fixture = {
    home: "Wolverhampton Wanderers",
    away: "Brighton & Hove Albion",
    competition_name: "Premier League",
    kickoff_utc: kickoff,
  };
  const snap2 = new DatabaseSync(dbPath("analysis_snapshots.db"));
  const insPaket = snap2.prepare(
    `INSERT INTO packages (match_id, computed_utc, trigger, payload_json)
     VALUES ('b22_derby', ?, 'slate', ?)`,
  );
  const pkgTerbit = Number(
    insPaket.run(
      decision,
      JSON.stringify({ fixture, probabilities: probs }),
    ).lastInsertRowid,
  );
  insPaket.run(
    new Date(now - 10 * 60_000).toISOString(),
    JSON.stringify({
      fixture,
      probabilities: probs,
      market: { probs: marketProbs, captured_utc: captured, bookmakers: ["Bet365"] },
      sm_panel: {
        probs: { "1x2:1": 0.76, "1x2:x": 0.14, "1x2:2": 0.1, "ou25:over": 0.72 },
        batch_utc: new Date(now - 24 * 3_600_000).toISOString(),
      },
      score_matrix: [],
    }),
  );
  snap2.close();

  const insPick = db.prepare(
    `INSERT INTO picks (created_utc, match_id, competition_canonical_id, kickoff_utc,
                        market, selection, model_prob, market_prob, sm_prob, gate_status,
                        grade, source, package_id, effective_prob, effective_source,
                        pick_uid, fixture_uid, line, decision_at_utc, published_at_utc,
                        kickoff_at_issue_utc, published_prob, probability_basis,
                        evidence_source, odds_bookmaker, odds_period, odds_line,
                        odds_decimal, odds_captured_utc)
     VALUES (?, 'b22_derby', 'liga_b22', ?, ?, ?, ?, ?, ?, 'calibrated', ?, 'live-run',
             ?, ?, ?, ?, 'fx-b22-derby', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // a. model-only
  insPick.run(
    decision, kickoff, "1x2", "1", 0.8, null, null, "A", pkgTerbit, null, null,
    "pk_b22_derby_model", "", decision, decision, kickoff, 0.8, "model",
    "model-only", null, null, null, null, null,
  );
  // b. lab-band + quote valid
  insPick.run(
    decision, kickoff, "ou25", "over", 0.75, 0.74, null, "A", pkgTerbit, 0.77,
    "lab-band", "pk_b22_derby_lab", "2.5", decision, decision, kickoff, 0.77,
    "effective", "market", "Bet365", "prematch", "2.5", 1.95, captured,
  );
  console.log(
    `SEEDED b22 marker=${marker} decision=${decision} captured=${captured} kickoff=${kickoff}`,
  );
}

main().catch((e) => {
  console.error("SEED GAGAL:", e);
  process.exit(1);
});
