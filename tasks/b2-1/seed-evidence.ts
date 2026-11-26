/**
 * SEED BUKTI RENDER B2.1 — menanam keputusan Fix-4 untuk TANGGAL WIB
 * HARI INI (jam berjalan) ke direktori DB terpisah, untuk screenshot
 * kartu "Keputusan tiket hari ini" di server lokal.
 *
 * Pakai: npx tsx tasks/b2-1/seed-evidence.ts <dir-db-absolut> <abstain|terbit>
 * Idempoten: baris Fix-4 + pick/paket bukti dihapus lalu ditanam ulang.
 * Tidak menyentuh data produksi (target wajib di luar data/).
 */
import fs from "node:fs";
import path from "node:path";

async function main(): Promise<void> {
  const dir = process.argv[2];
  const state = process.argv[3];
  if (!dir || (state !== "abstain" && state !== "terbit")) {
    console.error("usage: seed-evidence.ts <dir-db-absolut> <abstain|terbit>");
    process.exit(2);
  }
  const abs = path.resolve(dir);
  if (abs.includes(`${path.sep}app-football${path.sep}data`) || abs.endsWith(`${path.sep}data`)) {
    console.error("target terlihat seperti direktori data repo — ditolak");
    process.exit(2);
  }
  fs.mkdirSync(abs, { recursive: true });
  process.env.DB_DIR = abs;

  const { DatabaseSync } = await import("node:sqlite");
  const { dbPath } = await import("../../lib/db/paths");
  const ledger = await import("../../lib/picks/ledger");
  const fix4 = await import("../../lib/picks/fix4-tickets");
  const policy = await import("../../lib/picks/fix4-policy");
  const packages = await import("../../lib/picks/packages");

  const db = ledger.getPicksDb();
  fix4.ensureFix4Schema(db);

  const nowIso = new Date().toISOString();
  const dateWib = policy.fix4DateWibOf(nowIso);
  const w = policy.fix4WindowForDate(dateWib);
  const created = new Date(Date.parse(w.decision_ts_utc) + 4_000).toISOString();

  db.exec(
    "DELETE FROM fix4_ticket_legs; DELETE FROM fix4_tickets; DELETE FROM fix4_daily_decisions; DELETE FROM picks WHERE match_id LIKE 'b21_%'",
  );
  const snap = new DatabaseSync(dbPath("analysis_snapshots.db"));
  packages.ensurePackagesSchema(snap);
  snap.exec("DELETE FROM packages WHERE match_id LIKE 'b21_%'");

  if (state === "abstain") {
    db.prepare(
      `INSERT INTO fix4_daily_decisions
         (date_wib, status, decision_ts, eligible_count, reason, ticket_uid, policy_version, created_utc)
       VALUES (?, 'ABSTAIN', ?, 1, ?, NULL, ?, ?)`,
    ).run(
      dateWib,
      w.decision_ts_utc,
      "kandidat layak 1 < 4 (ambang published_prob >= 0.72, kompetisi berfeed, maks 1 per laga)",
      policy.FIX4_POLICY_VERSION,
      created,
    );
    console.log(`SEEDED abstain ${dateWib} created=${created}`);
    return;
  }

  /* terbit — 4 pilihan, nama panjang realistis untuk uji bungkus 320px */
  const fixtures = [
    { m: "b21_a", home: "Wolverhampton Wanderers", away: "Aston Villa", comp: "Premier League", market: "1x2", sel: "1", prob: 0.9 },
    { m: "b21_b", home: "Real Madrid", away: "FC Barcelona", comp: "La Liga", market: "dc", sel: "1x", prob: 0.88 },
    { m: "b21_c", home: "Borussia Dortmund", away: "RB Leipzig", comp: "Bundesliga", market: "ou25", sel: "over", prob: 0.85 },
    { m: "b21_d", home: "Inter", away: "Juventus", comp: "Serie A", market: "team_over05_away", sel: "yes", prob: 0.8 },
  ];
  const insPaket = snap.prepare(
    `INSERT INTO packages (match_id, computed_utc, trigger, payload_json)
     VALUES (?, '2026-11-25T02:00:00.000Z', 'slate', ?)`,
  );
  const insPick = db.prepare(
    `INSERT INTO picks (created_utc, match_id, competition_canonical_id, kickoff_utc,
                        market, selection, model_prob, source, published_prob, package_id)
     VALUES ('2026-11-25T02:00:00.000Z', ?, 'liga_b21', ?, ?, ?, ?, 'live-run', ?, ?)`,
  );
  const pickIds: number[] = [];
  fixtures.forEach((f, i) => {
    const pkgId = Number(
      insPaket.run(
        f.m,
        JSON.stringify({
          fixture: { home: f.home, away: f.away, competition_name: f.comp },
        }),
      ).lastInsertRowid,
    );
    const kickoff = new Date(Date.parse(w.decision_ts_utc) + (6 + i) * 3_600_000).toISOString();
    pickIds.push(
      Number(insPick.run(f.m, kickoff, f.market, f.sel, f.prob, f.prob, pkgId).lastInsertRowid),
    );
  });
  snap.close();
  const uid = "fx4_b21_evidence";
  const expected = fixtures.reduce((a, f) => a * f.prob, 1);
  db.prepare(
    `INSERT INTO fix4_tickets
       (ticket_uid, date_wib, decision_ts, expected_hit_prob, ticket_hash, policy_version, created_utc)
     VALUES (?, ?, ?, ?, 'hash-bukti-b21', ?, ?)`,
  ).run(uid, dateWib, w.decision_ts_utc, expected, policy.FIX4_POLICY_VERSION, created);
  const insLeg = db.prepare(
    `INSERT INTO fix4_ticket_legs
       (ticket_uid, position, pick_id, match_id, market, selection, published_prob)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  fixtures.forEach((f, i) => {
    insLeg.run(uid, i + 1, pickIds[i], f.m, f.market, f.sel, f.prob);
  });
  db.prepare(
    `INSERT INTO fix4_daily_decisions
       (date_wib, status, decision_ts, eligible_count, reason, ticket_uid, policy_version, created_utc)
     VALUES (?, 'PUBLISHED', ?, 6, NULL, ?, ?, ?)`,
  ).run(dateWib, w.decision_ts_utc, uid, policy.FIX4_POLICY_VERSION, created);
  console.log(`SEEDED terbit ${dateWib} created=${created} expected=${expected}`);
}

main().catch((e) => {
  console.error("SEED GAGAL:", e);
  process.exit(1);
});
