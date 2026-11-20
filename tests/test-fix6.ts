/**
 * TEST:FIX6 — bukti terprogram butir 6 review K8 (npm run test:web).
 *
 * Tiga kelompok:
 *  A. Cache statistik cohort (sub-bagian 3): koreksi skor TANPA
 *     penambahan baris WAJIB mengubah statistik (invalidasi tanda
 *     tangan keadaan), dan cache harus PERSIS selama belum ada
 *     transisi klasifikasi jam, lalu dihitung ulang sesudahnya.
 *  B. Biaya halaman (sub-bagian 3): eksekusi SQL terukur untuk
 *     listSchedule + cakupanJadwal (halaman jadwal) dan
 *     daftarPilihanPraLaga (halaman pilihan) — kontrak PRD ≤ 8.
 *  C. Beranda jujur + sorotan (sub-bagian 1): lab_resolved_matches
 *     menghitung laga UNIK (bukan baris pilihan).
 *     DIPERBARUI Langkah 3 redesain (brief §3A.2 + §6 "ganti pemilihan
 *     sorotan"): todaySpotlight (laga hari ini + tiga peluang payload)
 *     digantikan sorotanBeranda — laga mendatang TERDEKAT yang punya
 *     pilihan RESMI terbit sebelum kickoff; asersi di bawah menilai
 *     kontrak baru itu pada seed yang sama (10 paket jadwal + pilihan
 *     resmi terbit 0,8), bukan melonggarkan gerbang Fix-6: kejujuran
 *     penyebut lab_resolved_matches tetap dinilai persis seperti dulu.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  Suite,
  buildCoreSchemas,
  createFixtureEnv,
  settleFixtureEnv,
  writeTeamRegistry,
} from "./helpers/fixture-env";

async function main(): Promise<void> {
  const suite = new Suite("test:fix6 (review K8 butir 6)");
  const env = createFixtureEnv("fix6");
  process.chdir(env.root);
  const { ledger } = await buildCoreSchemas();
  writeTeamRegistry(env, [
    { team_id: "t1", name: "Arsenal" },
    { team_id: "t2", name: "Chelsea" },
  ]);
  fs.writeFileSync(path.join(env.dataDir, "league-canonical.json"), JSON.stringify({ version: 1, leagues: [] }));
  fs.writeFileSync(path.join(env.dataDir, "fixture-links.json"), JSON.stringify({}));

  const db = ledger.getPicksDb();
  const insPick = db.prepare(
    `INSERT INTO picks (created_utc, match_id, competition_canonical_id, kickoff_utc, market, selection, model_prob, grade, source)
     VALUES ('2026-11-01T00:00:00.000Z', ?, 'sm:8', ?, '1x2', '1', 0.8, 'A', ?)`,
  );
  const insOut = db.prepare(
    `INSERT INTO pick_outcomes (pick_id, resolved_utc, home_goals, away_goals, hit) VALUES (?, '2026-11-11T00:00:00.000Z', ?, ?, ?)`,
  );

  // ---------------------------------------------------------- A. cohort cache
  const { cohortStats } = await import("../lib/picks/cohort");
  const p1 = Number(insPick.run("sm_f6_a", "2026-11-10T20:00:00.000Z", "live-run").lastInsertRowid);
  insOut.run(p1, 2, 1, 1);
  const p2 = Number(insPick.run("sm_f6_b", "2026-11-10T20:00:00.000Z", "live-run").lastInsertRowid);
  insOut.run(p2, 0, 2, 0);
  insPick.run("sm_f6_c", "2026-11-25T20:00:00.000Z", "live-run"); // pending
  const filter = { source: "live-run" };

  const s1 = cohortStats({ now_utc: "2026-11-20T00:00:00.000Z", filter });
  suite.eq("cohort awal: settled 2", s1.settled, 2);
  suite.eq("cohort awal: hits 1 / misses 1", [s1.hits, s1.misses], [1, 1]);
  suite.eq("cohort awal: 1 belum mulai", s1.not_started, 1);
  const s1b = cohortStats({ now_utc: "2026-11-20T00:00:00.000Z", filter });
  suite.check("cohort: panggilan ulang identik (cache konsisten)", JSON.stringify(s1b) === JSON.stringify(s1));

  const nOutBefore = (db.prepare("SELECT COUNT(*) n FROM pick_outcomes").get() as { n: number }).n;
  // KOREKSI SKOR di tempat: baris outcome yang sama ditulis ulang
  // (skor 0-2 miss → 3-2 hit) — TIDAK ada baris baru di tabel mana pun.
  db.prepare("UPDATE pick_outcomes SET hit = 1, home_goals = 3, away_goals = 2 WHERE pick_id = ?").run(p2);
  const nOutAfter = (db.prepare("SELECT COUNT(*) n FROM pick_outcomes").get() as { n: number }).n;
  suite.eq("koreksi skor: jumlah baris outcome TIDAK berubah", nOutAfter, nOutBefore);
  const s2 = cohortStats({ now_utc: "2026-11-20T00:00:00.000Z", filter });
  suite.eq("koreksi skor: statistik berubah (hits 2 / misses 0)", [s2.hits, s2.misses], [2, 0]);
  suite.check("koreksi skor: hit_ratio ikut berubah 0.5 → 1", s1.hit_ratio === 0.5 && s2.hit_ratio === 1);

  // Ketepatan cache lintas transisi jam: sebelum kickoff P3 hasilnya
  // persis sama dari cache; sesudah kickoff WAJIB dihitung ulang.
  const t1 = cohortStats({ now_utc: "2026-11-25T19:00:00.000Z", filter });
  suite.eq("transisi: sebelum kickoff not_started 1", [t1.not_started, t1.awaiting_window], [1, 0]);
  const t1b = cohortStats({ now_utc: "2026-11-25T19:30:00.000Z", filter });
  suite.check("transisi: di dalam jendela cache hasilnya persis", JSON.stringify(t1b) === JSON.stringify(t1));
  const t2 = cohortStats({ now_utc: "2026-11-25T21:00:00.000Z", filter });
  suite.eq("transisi: sesudah kickoff dihitung ulang (awaiting 1)", [t2.not_started, t2.awaiting_window], [0, 1]);

  // ------------------------------------------------------------- B. biaya SQL
  // Paket uji: 10 laga pada jendela satu hari UTC (21 Nov 2026).
  const snap = new DatabaseSync(path.join(env.dataDir, "analysis_snapshots.db"));
  const payload = (i: number, kickoff: string) => ({
    fixture: {
      match_id: `sm_fix6_j${i}`,
      competition_name: "Liga Uji",
      home: `Kandang ${i}`,
      away: `Tamu ${i}`,
      kickoff_utc: kickoff,
    },
    gate_status: "calibrated",
    population: "league",
    lambda: 1.5,
    mu: 1.1,
    rho: 0,
    probabilities: { "1x2:1": 0.4 + i * 0.01, "1x2:x": 0.28, "1x2:2": 0.32 - i * 0.01 },
    top_scores: [{ home_goals: 1, away_goals: 0, prob: 0.14 }],
    score_matrix: Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 0.03)),
    legs: [],
  });
  const insPkg = snap.prepare(
    `INSERT INTO packages (match_id, competition_canonical_id, kickoff_utc, computed_utc, trigger, fit_source, gate_status, payload_json)
     VALUES (?, 'sm:8', ?, '2026-11-20T00:00:00.000Z', 'slate', 'free', 'calibrated', ?)`,
  );
  const jamKick = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  jamKick.forEach((h, i) => {
    const ko = `2026-11-21T${String(h).padStart(2, "0")}:00:00.000Z`;
    insPkg.run(`sm_fix6_j${i}`, ko, JSON.stringify(payload(i, ko)));
  });
  snap.close();

  // Pilihan pra-laga: 10 pick live-run terbit menunjuk paket di atas.
  const { ensurePublicationSchema } = await import("../lib/picks/publication");
  ensurePublicationSchema(db);
  const pkgIds = (new DatabaseSync(path.join(env.dataDir, "analysis_snapshots.db"), { readOnly: true })
    .prepare("SELECT id, match_id FROM packages ORDER BY id")
    .all() as { id: number; match_id: string }[]);
  pkgIds.forEach((p, i) => {
    const pid = Number(
      insPick.run(p.match_id, "2026-11-22T20:00:00.000Z", "live-run").lastInsertRowid,
    );
    db.prepare(
      `UPDATE picks SET pick_uid = ?, published_prob = 0.8, package_id = ?, published_at_utc = '2026-11-20T00:00:00.000Z', probability_basis = 'model' WHERE id = ?`,
    ).run(`uid-fix6-${i}`, p.id, pid);
  });

  // Penghitung eksekusi SQL pada prototipe DatabaseSync.
  let sqlCount = 0;
  let counting = false;
  const proto = DatabaseSync.prototype as unknown as Record<string, unknown>;
  const origPrepare = proto.prepare as (...a: unknown[]) => unknown;
  const origExec = proto.exec as (...a: unknown[]) => unknown;
  proto.prepare = function (...a: unknown[]) {
    if (counting) sqlCount++;
    return origPrepare.apply(this, a);
  };
  proto.exec = function (...a: unknown[]) {
    if (counting) sqlCount++;
    return origExec.apply(this, a);
  };
  const hitungSql = <T>(fn: () => T): { hasil: T; sql: number } => {
    sqlCount = 0;
    counting = true;
    try {
      return { hasil: fn(), sql: sqlCount };
    } finally {
      counting = false;
    }
  };

  const web = await import("../lib/web/data");
  const rekam = await import("../lib/web/rekam");
  // Pemanasan (registry & cache modul) di luar hitungan.
  web.listSchedule("2026-11-21T00:00:00.000Z", "2026-11-21T23:59:59.000Z");
  rekam.daftarPilihanPraLaga("2026-11-20T00:00:00.000Z");

  const jadwal = hitungSql(() => {
    const items = web.listSchedule("2026-11-21T00:00:00.000Z", "2026-11-21T23:59:59.000Z");
    const cakupan = web.cakupanJadwal();
    return { items, cakupan };
  });
  suite.eq("jadwal: 10 item tampil", jadwal.hasil.items.length, 10);
  suite.check(
    `jadwal: total SQL halaman ≤ 8 (terukur ${jadwal.sql})`,
    jadwal.sql <= 8,
    `sql=${jadwal.sql}`,
  );
  const feed = hitungSql(() => rekam.daftarPilihanPraLaga("2026-11-20T00:00:00.000Z"));
  suite.eq("pilihan: 10 pilihan tampil", feed.hasil.length, 10);
  suite.check(
    `pilihan: total SQL halaman ≤ 8 (terukur ${feed.sql})`,
    feed.sql <= 8,
    `sql=${feed.sql}`,
  );
  proto.prepare = origPrepare;
  proto.exec = origExec;

  // ------------------------------------------------------- C. beranda & sorotan
  for (const [mid, market, sel] of [
    ["sm_lab_a", "1x2", "1"],
    ["sm_lab_a", "ou25", "over"],
    ["sm_lab_b", "1x2", "1"],
  ] as const) {
    const pid = Number(
      db
        .prepare(
          `INSERT INTO picks (created_utc, match_id, kickoff_utc, market, selection, model_prob, grade, source)
           VALUES ('2026-10-01T00:00:00.000Z', ?, '2026-10-02T20:00:00.000Z', ?, ?, 0.7, 'A', 'lab')`,
        )
        .run(mid, market, sel).lastInsertRowid,
    );
    insOut.run(pid, 2, 1, 1);
  }
  const stats = web.landingStats();
  suite.eq("beranda: lab_resolved = 3 baris pilihan", stats.lab_resolved, 3);
  suite.eq("beranda: lab_resolved_matches = 2 laga UNIK", stats.lab_resolved_matches, 2);

  // Sorotan kontrak baru (brief §3A.2): seed di atas memuat 10 laga
  // 21 Nov (kickoff ganjil 01.00–19.00Z) dan untuk SETIAP laga satu
  // pilihan resmi (pick_uid, published_prob 0,8, terbit 20 Nov).
  const sorotan = web.sorotanBeranda(new Date("2026-11-21T02:00:00.000Z"));
  suite.check("sorotan: ada laga berprediksi resmi", sorotan !== null);
  suite.eq("sorotan: jenis prediksi", sorotan?.jenis, "prediksi");
  suite.eq(
    "sorotan: laga mendatang terdekat berprediksi (j1, 03:00Z; j0 sudah mulai 01:00Z)",
    sorotan?.match_id,
    "sm_fix6_j1",
  );
  suite.eq("sorotan: peluang utama = peluang RESMI terbit", sorotan?.prob, 0.8);
  suite.eq(
    "sorotan: label kejadian utama terbaca",
    sorotan?.label_prediksi,
    "Kandang 1 menang",
  );
  suite.eq(
    "sorotan: waktu terbit = published_at_utc pilihan",
    sorotan?.published_at_utc,
    "2026-11-20T00:00:00.000Z",
  );
  const awal = web.sorotanBeranda(new Date("2026-11-20T00:00:00.000Z"));
  suite.eq(
    "sorotan: sebelum semua kickoff, yang terdekat menang (j0)",
    awal?.match_id,
    "sm_fix6_j0",
  );
  const berikut = web.jadwalBerikutnya(sorotan, new Date("2026-11-21T02:00:00.000Z"), 5);
  suite.check(
    "jadwal berikutnya: sorotan dikeluarkan, urutan kickoff",
    berikut.length === 5 &&
      berikut[0].pkg.match_id === "sm_fix6_j2" &&
      berikut.every((b) => b.pkg.match_id !== "sm_fix6_j1"),
    `aktual=${JSON.stringify(berikut.map((b) => b.pkg.match_id))}`,
  );
  const kosong = web.sorotanBeranda(new Date("2026-12-25T02:00:00.000Z"));
  suite.check("sorotan: tanpa laga mendatang/hasil → null", kosong === null);

  settleFixtureEnv(env, suite.failedCount > 0);
  suite.finish();
}

main().catch((err) => {
  console.error("[test:fix6] crash:", err);
  process.exit(1);
});
