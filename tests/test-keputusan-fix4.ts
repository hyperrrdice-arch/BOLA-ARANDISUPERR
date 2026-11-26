/**
 * SUITE KEPUTUSAN FIX-4 HARI INI (B2.1) — kartu "Keputusan tiket hari
 * ini" di /bukti.
 *
 * Yang diverifikasi (kriteria brief B2.1):
 *  - cutoff: 06:59:59 UTC tanpa baris → "menunggu"; 07:00:00 UTC tanpa
 *    baris → "belum-tersedia"; baris yang tercatat SEBELUM cutoff tetap
 *    menang atas jam;
 *  - pergantian tanggal WIB di sekitar 17:00 UTC mengikuti
 *    fix4DateWibOf (16:59:59 → tanggal sama, 17:00:00 → besok);
 *  - ABSTAIN: eligible_count tampil apa adanya (1), label Dicatat dari
 *    created_utc baris, ukuran tiket dari kebijakan (4);
 *  - PUBLISHED utuh: 4 pilihan urut position (baris legs ditanam
 *    teracak), nilai published_prob BEKU dari fix4_ticket_legs — pick
 *    pertama sengaja diberi published_prob berbeda (0,55) di tabel
 *    picks untuk membuktikan snapshot legs yang dipakai; nama laga
 *    dari paket penerbit; pick tanpa paket → label pasar yang jujur;
 *  - referensi tak utuh (legs hanya 3; ticket_uid tanpa baris tiket)
 *    → "tercatat-tak-utuh", tanpa detail yang dikarang;
 *  - akses DB: pembaca berjalan lewat koneksi read-only (dbRo) —
 *    dibuktikan juga dengan berkas DB chmod 0444; picks.db kosong
 *    tanpa tabel dan picks.db absen → "data-belum-ada".
 *
 * Pola sandbox sama dengan test-rekam.ts: skema dibangun kode repo
 * (buildCoreSchemas + ensureFix4Schema), baris ditanam mentah, dan
 * pembaca dipanggil lewat subprocess probe (cache handle per proses
 * selalu bersih). Suite ini terdaftar di test:web karena pembacanya
 * hidup di lapisan web (lib/web/rekam.ts).
 *
 * Pakai: npm run test:web (atau langsung: npx tsx tests/test-keputusan-fix4.ts)
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  Suite,
  buildCoreSchemas,
  createFixtureEnv,
  runScript,
  settleFixtureEnv,
  type FixtureEnv,
} from "./helpers/fixture-env";
import type { KeputusanFix4HariIni } from "../lib/web/rekam";

const suite = new Suite("keputusan-fix4 (B2.1)");

function probe(env: FixtureEnv, nowUtc: string): KeputusanFix4HariIni {
  const res = runScript(env, "tests/helpers/keputusan-fix4-probe.ts", [nowUtc]);
  const line = res.stdout.split("\n").find((l) => l.startsWith("PROBE_JSON "));
  if (!line) {
    throw new Error(
      `keputusan-fix4-probe tidak menghasilkan PROBE_JSON (exit=${res.code}): ${res.stdout} ${res.stderr}`,
    );
  }
  return JSON.parse(line.slice("PROBE_JSON ".length)) as KeputusanFix4HariIni;
}

async function main(): Promise<void> {
  /* ---------------------------------------------------------- env utama */
  const env = createFixtureEnv("keputusan-fix4");
  process.chdir(env.root);
  const { ledger } = await buildCoreSchemas();
  const fix4 = await import("../lib/picks/fix4-tickets");
  const db = ledger.getPicksDb();
  fix4.ensureFix4Schema(db);

  /* Paket penerbit (analysis_snapshots.db) — sumber nama laga. */
  const snap = new DatabaseSync(path.join(env.dataDir, "analysis_snapshots.db"));
  const insPaket = snap.prepare(
    `INSERT INTO packages (match_id, computed_utc, trigger, payload_json)
     VALUES (?, '2026-11-25T02:00:00.000Z', 'slate', ?)`,
  );
  const pkgA = Number(
    insPaket.run(
      "fx_a",
      JSON.stringify({
        fixture: { home: "Alpha FC", away: "Beta United", competition_name: "Liga Uji" },
      }),
    ).lastInsertRowid,
  );
  const pkgB = Number(
    insPaket.run(
      "fx_b",
      JSON.stringify({
        fixture: { home: "Gamma City", away: "Delta Rovers", competition_name: "Liga Uji" },
      }),
    ).lastInsertRowid,
  );
  const pkgC = Number(
    insPaket.run(
      "fx_c",
      JSON.stringify({
        fixture: { home: "Epsilon", away: "Zeta", competition_name: "Piala Uji" },
      }),
    ).lastInsertRowid,
  );
  snap.close();

  /* Pick resmi. published_prob p1 di tabel picks SENGAJA 0,55 — berbeda
     dari snapshot legs (0,90) — untuk membuktikan pembaca memakai
     angka beku fix4_ticket_legs. */
  const insPick = db.prepare(
    `INSERT INTO picks (created_utc, match_id, competition_canonical_id, kickoff_utc,
                        market, selection, model_prob, source, published_prob, package_id)
     VALUES ('2026-11-25T02:00:00.000Z', ?, 'liga_uji', ?, ?, ?, ?, 'live-run', ?, ?)`,
  );
  const p1 = Number(
    insPick.run("fx_a", "2026-11-28T13:00:00.000Z", "1x2", "1", 0.9, 0.55, pkgA).lastInsertRowid,
  );
  const p2 = Number(
    insPick.run("fx_b", "2026-11-28T14:00:00.000Z", "dc", "1x", 0.88, 0.88, pkgB).lastInsertRowid,
  );
  const p3 = Number(
    insPick.run("fx_c", "2026-11-28T15:00:00.000Z", "ou25", "over", 0.85, 0.85, pkgC)
      .lastInsertRowid,
  );
  const p4 = Number(
    insPick.run("fx_d", "2026-11-28T16:00:00.000Z", "team_over05_away", "yes", 0.8, 0.8, null)
      .lastInsertRowid,
  );

  const insDec = db.prepare(
    `INSERT INTO fix4_daily_decisions
       (date_wib, status, decision_ts, eligible_count, reason, ticket_uid, policy_version, created_utc)
     VALUES (?, ?, ?, ?, ?, ?, 'fix4-2026-11-25', ?)`,
  );
  const insTicket = db.prepare(
    `INSERT INTO fix4_tickets
       (ticket_uid, date_wib, decision_ts, expected_hit_prob, ticket_hash, policy_version, created_utc)
     VALUES (?, ?, ?, ?, 'hash-uji', 'fix4-2026-11-25', ?)`,
  );
  const insLeg = db.prepare(
    `INSERT INTO fix4_ticket_legs
       (ticket_uid, position, pick_id, match_id, market, selection, published_prob)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  // 26 Nov — ABSTAIN, 1 kandidat, dicatat tepat sesudah cutoff.
  insDec.run(
    "2026-11-26", "ABSTAIN", "2026-11-26T07:00:00.000Z", 1,
    "kandidat layak 1 < 4 (ambang published_prob >= 0.72, kompetisi berfeed, maks 1 per laga)",
    null, "2026-11-26T07:00:04.000Z",
  );
  // 27 Nov — ABSTAIN yang dicatat SEBELUM cutoff tanggalnya.
  insDec.run(
    "2026-11-27", "ABSTAIN", "2026-11-27T07:00:00.000Z", 2,
    "kandidat layak 2 < 4", null, "2026-11-26T20:15:00.000Z",
  );
  // 28 Nov — PUBLISHED utuh; legs ditanam TERACAK (3,1,4,2).
  insTicket.run(
    "fx4_uji_utuh", "2026-11-28", "2026-11-28T07:00:00.000Z",
    0.9 * 0.88 * 0.85 * 0.8, "2026-11-28T07:00:03.000Z",
  );
  insLeg.run("fx4_uji_utuh", 3, p3, "fx_c", "ou25", "over", 0.85);
  insLeg.run("fx4_uji_utuh", 1, p1, "fx_a", "1x2", "1", 0.9);
  insLeg.run("fx4_uji_utuh", 4, p4, "fx_d", "team_over05_away", "yes", 0.8);
  insLeg.run("fx4_uji_utuh", 2, p2, "fx_b", "dc", "1x", 0.88);
  insDec.run(
    "2026-11-28", "PUBLISHED", "2026-11-28T07:00:00.000Z", 6, null,
    "fx4_uji_utuh", "2026-11-28T07:00:03.000Z",
  );
  // 29 Nov — PUBLISHED tetapi legs hanya 3.
  insTicket.run(
    "fx4_uji_sebagian", "2026-11-29", "2026-11-29T07:00:00.000Z",
    0.9 * 0.88 * 0.85, "2026-11-29T07:00:02.000Z",
  );
  insLeg.run("fx4_uji_sebagian", 1, p1, "fx_a", "1x2", "1", 0.9);
  insLeg.run("fx4_uji_sebagian", 2, p2, "fx_b", "dc", "1x", 0.88);
  insLeg.run("fx4_uji_sebagian", 3, p3, "fx_c", "ou25", "over", 0.85);
  insDec.run(
    "2026-11-29", "PUBLISHED", "2026-11-29T07:00:00.000Z", 4, null,
    "fx4_uji_sebagian", "2026-11-29T07:00:02.000Z",
  );
  // 30 Nov — PUBLISHED dengan ticket_uid tanpa baris tiket.
  insDec.run(
    "2026-11-30", "PUBLISHED", "2026-11-30T07:00:00.000Z", 5, null,
    "fx4_uji_hantu", "2026-11-30T07:00:02.000Z",
  );

  /* ------------------------------------------------------------ cutoff */
  const sebelum = probe(env, "2026-12-01T06:59:59.000Z");
  suite.eq("cutoff: 06:59:59 UTC tanpa baris → menunggu", sebelum.status, "menunggu");
  suite.eq("cutoff: tanggal kartu = 2026-12-01", sebelum.date_wib, "2026-12-01");
  suite.eq("cutoff: batas penilaian = 07:00 UTC", sebelum.batas_penilaian_utc, "2026-12-01T07:00:00.000Z");
  suite.eq("cutoff: belum ada Dicatat", sebelum.dicatat_utc, null);

  const tepat = probe(env, "2026-12-01T07:00:00.000Z");
  suite.eq("cutoff: 07:00:00 UTC tanpa baris → belum-tersedia", tepat.status, "belum-tersedia");

  const barisMenang = probe(env, "2026-11-27T05:30:00.000Z");
  suite.eq("cutoff: baris sebelum cutoff menang atas jam → abstain", barisMenang.status, "abstain");
  suite.eq("cutoff: eligible_count baris = 2", barisMenang.eligible_count, 2);
  suite.eq("cutoff: Dicatat dari created_utc baris", barisMenang.dicatat_utc, "2026-11-26T20:15:00.000Z");

  /* ------------------------------------------------- pergantian tanggal */
  const malam = probe(env, "2026-12-01T16:59:59.000Z");
  suite.eq("tanggal: 16:59:59 UTC → masih 2026-12-01 WIB", malam.date_wib, "2026-12-01");
  const tengahMalam = probe(env, "2026-12-01T17:00:00.000Z");
  suite.eq("tanggal: 17:00:00 UTC → 2026-12-02 WIB", tengahMalam.date_wib, "2026-12-02");
  suite.eq("tanggal: hari baru sebelum cutoff → menunggu", tengahMalam.status, "menunggu");

  /* -------------------------------------------------------------- abstain */
  const abs = probe(env, "2026-11-26T08:00:00.000Z");
  suite.eq("abstain: status", abs.status, "abstain");
  suite.eq("abstain: eligible_count apa adanya = 1", abs.eligible_count, 1);
  suite.eq("abstain: ukuran tiket dari kebijakan = 4", abs.ukuran_tiket, 4);
  suite.eq("abstain: Dicatat dari created_utc", abs.dicatat_utc, "2026-11-26T07:00:04.000Z");
  suite.eq("abstain: batas penilaian dari decision_ts", abs.batas_penilaian_utc, "2026-11-26T07:00:00.000Z");
  suite.eq("abstain: tanpa pilihan", abs.pilihan, []);

  /* --------------------------------------------------------------- terbit */
  const terbit = probe(env, "2026-11-28T09:00:00.000Z");
  suite.eq("terbit: status", terbit.status, "terbit");
  suite.eq("terbit: ticket_uid", terbit.ticket_uid, "fx4_uji_utuh");
  suite.eq("terbit: tepat 4 pilihan", terbit.pilihan.length, 4);
  suite.eq(
    "terbit: urutan position 1..4 walau ditanam teracak",
    terbit.pilihan.map((p) => p.position),
    [1, 2, 3, 4],
  );
  suite.eq(
    "terbit: peluang BEKU dari legs (bukan picks 0,55)",
    terbit.pilihan.map((p) => p.published_prob),
    [0.9, 0.88, 0.85, 0.8],
  );
  suite.check(
    "terbit: expected_hit_prob beku tiket",
    Math.abs((terbit.expected_hit_prob ?? 0) - 0.9 * 0.88 * 0.85 * 0.8) < 1e-12,
  );
  suite.eq("terbit: nama laga leg 1 dari paket", [terbit.pilihan[0].home, terbit.pilihan[0].away], ["Alpha FC", "Beta United"]);
  suite.eq("terbit: label leg 1", terbit.pilihan[0].label, "Alpha FC menang");
  suite.eq("terbit: label leg 2 (dc)", terbit.pilihan[1].label, "Gamma City menang atau seri");
  suite.eq("terbit: label leg 3 (ou25)", terbit.pilihan[2].label, "Minimal tiga gol");
  suite.eq("terbit: leg 4 tanpa paket → nama null", [terbit.pilihan[3].home, terbit.pilihan[3].away], [null, null]);
  suite.eq(
    "terbit: leg 4 label pasar jujur",
    terbit.pilihan[3].label,
    "Tim tamu mencetak gol · yes",
  );
  suite.eq("terbit: tautan detail laga leg 1", terbit.pilihan[0].href_detail, "/pertandingan/fx_a");

  /* ---------------------------------------------------------- tak utuh */
  const sebagian = probe(env, "2026-11-29T09:00:00.000Z");
  suite.eq("tak-utuh: legs hanya 3 → tercatat-tak-utuh", sebagian.status, "tercatat-tak-utuh");
  suite.eq("tak-utuh: detail tidak dikarang (pilihan kosong)", sebagian.pilihan, []);
  const hantu = probe(env, "2026-11-30T09:00:00.000Z");
  suite.eq("tak-utuh: ticket_uid tanpa baris tiket → tercatat-tak-utuh", hantu.status, "tercatat-tak-utuh");

  /* --------------------------------------- read-only (salinan chmod) */
  // Salin DB ke env terpisah, checkpoint + tutup semua handle supaya
  // WAL bersih, lalu chmod 0444: pembaca harus tetap lulus murni lewat
  // koneksi read-only (dbRo) tanpa bisa menulis apa pun ke berkas.
  const envRo = createFixtureEnv("keputusan-fix4-ro");
  for (const f of ["picks.db", "analysis_snapshots.db"]) {
    const src = path.join(env.dataDir, f);
    const dst = path.join(envRo.dataDir, f);
    const salin = new DatabaseSync(src, { readOnly: true });
    salin.exec(`VACUUM INTO '${dst.replace(/'/g, "''")}'`);
    salin.close();
    fs.chmodSync(dst, 0o444);
  }
  const ro = probe(envRo, "2026-11-28T09:00:00.000Z");
  suite.eq("read-only: berkas 0444 tetap terbaca penuh", ro.status, "terbit");
  suite.eq("read-only: 4 pilihan terbaca dari berkas 0444", ro.pilihan.length, 4);
  settleFixtureEnv(envRo, suite.failedCount > 0);

  /* ------------------------------------------------------- DB absen */
  const envKosong = createFixtureEnv("keputusan-fix4-kosong");
  const dbKosong = new DatabaseSync(path.join(envKosong.dataDir, "picks.db"));
  dbKosong.close();
  const tanpaTabel = probe(envKosong, "2026-11-28T09:00:00.000Z");
  suite.eq("absen: picks.db tanpa tabel Fix-4 → data-belum-ada", tanpaTabel.status, "data-belum-ada");
  suite.eq("absen: tanggal kartu tetap terhitung", tanpaTabel.date_wib, "2026-11-28");
  settleFixtureEnv(envKosong, suite.failedCount > 0);

  const envNihil = createFixtureEnv("keputusan-fix4-nihil");
  const tanpaDb = probe(envNihil, "2026-11-28T09:00:00.000Z");
  suite.eq("absen: picks.db tidak ada → data-belum-ada", tanpaDb.status, "data-belum-ada");
  settleFixtureEnv(envNihil, suite.failedCount > 0);

  settleFixtureEnv(env, suite.failedCount > 0);
  suite.finish();
}

main().catch((e) => {
  console.error("GAGAL BESAR:", e);
  process.exit(1);
});
