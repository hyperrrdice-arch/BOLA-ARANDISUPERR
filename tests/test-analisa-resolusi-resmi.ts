/**
 * TEST:ANALISA-RESOLUSI-RESMI — brief validasi rilis §2 (PR #8).
 *
 * Analisa WAJIB memakai resolusi per kejadian yang sama dengan Detail
 * (`kelompokkanKejadianResmi` di lib/web/rekam.ts): cocokkan identitas
 * laga fisik + market + line kanonik publikasi + selection. Kasus
 * pemicu = arsip BTTS Marseille dua alias: edisi resmi 0,6276 (mt_)
 * vs 0,7727 (sm_) pada kejadian yang sama. Detail mendeteksi KONFLIK;
 * resolver Analisa lama menyaring hanya market+selection lalu mengurut
 * (paket tampil → terbit terakhir → prob tertinggi) sehingga memilih
 * 0,7727 diam-diam dan melabelinya angka resmi.
 *
 * Kasus:
 *  A. dua alias, dua angka resmi berbeda → konflik, TANPA angka tunggal;
 *     silang-periksa: pengelompokan Detail atas ledger yang sama juga
 *     konflik dengan nilai yang sama persis.
 *  B. dua garis pasar berbeda (ou25 line 2.5 vs 3.5) → angka dipecah
 *     per garis kanonik leg; garis lain tidak tercampur, tidak konflik.
 *  C. kontrol: satu angka resmi → tampil seperti sebelumnya + label
 *     basis B2.2 dari baris ledger itu sendiri.
 *  D. kontrol: paket-saja tanpa terbitan → tanpa angka resmi, tanpa
 *     konflik (label "Paket terbaru" tetap milik jalur render).
 *  E. budget SQL lengkapiTopLegResmi terukur (query batch dipertahankan:
 *     PRAGMA + alias batch + satu SELECT ledger).
 *
 * Jalankan: npx tsx tests/test-analisa-resolusi-resmi.ts
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  Suite,
  buildCoreSchemas,
  createFixtureEnv,
  settleFixtureEnv,
  type FixtureEnv,
} from "./helpers/fixture-env";
import { seedPicks, type PickSeed } from "./helpers/redesain-seeds";
import type { JadwalItem, Leg } from "../lib/web/data";

const KO = "2026-11-22T19:45:00.000Z";

function pick(over: Partial<PickSeed> & { match_id: string }): PickSeed {
  return {
    market: "btts",
    selection: "yes",
    line: "",
    model_prob: 0.7,
    market_prob: null,
    sm_prob: null,
    published_prob: 0.7,
    probability_basis: "effective",
    published_at_utc: "2026-11-20T09:00:00.000Z",
    grade: "A",
    gate_status: "calibrated",
    pick_uid: `uid-${over.match_id}`,
    competition_canonical_id: "sm:1",
    kickoff_utc: KO,
    package_id: null,
    fixture_uid: null,
    ...over,
  };
}

async function main(): Promise<void> {
  const suite = new Suite("analisa-resolusi-resmi");
  const env: FixtureEnv = createFixtureEnv("analisa-resolusi");
  let gagal = false;
  try {
    process.chdir(env.root);
    const { ledger } = await buildCoreSchemas();
    const publication = await import("../lib/picks/publication");
    publication.ensurePublicationSchema(ledger.getPicksDb());
    const identity = await import("../lib/identity/fixture-resolver");
    const ds = new DatabaseSync(path.join(env.dataDir, "thestats_dataset.db"));
    identity.ensureIdentitySchema(ds);
    /* Dua alias, satu laga fisik — pola arsip Marseille (fixture_uid
       pick NULL; tautan hidup di store identitas). */
    const insAlias = ds.prepare(
      `INSERT INTO fixture_aliases (source, source_match_id, fixture_uid, match_basis, first_seen_utc, last_seen_utc)
       VALUES ('seed', ?, 'uid-fisik-konflik', 'seed', '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z')`,
    );
    insAlias.run("sm_konflik");
    insAlias.run("mt_konflik");
    const insAliasGaris = ds.prepare(
      `INSERT INTO fixture_aliases (source, source_match_id, fixture_uid, match_basis, first_seen_utc, last_seen_utc)
       VALUES ('seed', ?, 'uid-fisik-garis', 'seed', '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z')`,
    );
    insAliasGaris.run("sm_garis");
    insAliasGaris.run("mt_garis");
    ds.close();
    fs.writeFileSync(path.join(env.dataDir, "fixture-links.json"), JSON.stringify({ links: [] }));
    fs.writeFileSync(
      path.join(env.dataDir, "league-canonical.json"),
      JSON.stringify({ version: 1, leagues: [] }),
    );

    seedPicks(env, [
      /* A — BTTS dua alias, dua angka resmi berbeda. Edisi sm_ terbit
         belakangan DAN dari paket yang sedang tampil di item Analisa:
         resolver lama pasti memilih 0,7727. */
      pick({
        match_id: "mt_konflik",
        published_prob: 0.6276,
        published_at_utc: "2026-11-20T09:00:00.000Z",
        pick_uid: "uid-konflik-mt",
        package_id: 101,
      }),
      pick({
        match_id: "sm_konflik",
        published_prob: 0.7727,
        published_at_utc: "2026-11-20T10:00:00.000Z",
        pick_uid: "uid-konflik-sm",
        package_id: 102,
      }),
      /* B — satu laga fisik (dua alias), ou25 pada DUA garis tersimpan
         berbeda + ou35. Baris garis 3.5 pada ou25 terbit paling akhir
         dengan angka tertinggi: penyaring tanpa garis akan
         mencampurnya ke leg ou25. (Dua baris ou25 hidup di alias
         berbeda karena indeks unik warisan ledger melarang
         match_id+market+selection yang sama pada satu id.) */
      pick({
        match_id: "sm_garis",
        market: "ou25",
        selection: "over",
        line: "2.5",
        published_prob: 0.66,
        probability_basis: "model",
        published_at_utc: "2026-11-20T09:00:00.000Z",
        pick_uid: "uid-garis-25",
        package_id: 201,
      }),
      pick({
        match_id: "mt_garis",
        market: "ou25",
        selection: "over",
        line: "3.5",
        published_prob: 0.91,
        probability_basis: "model",
        published_at_utc: "2026-11-20T11:00:00.000Z",
        pick_uid: "uid-garis-25-garis35",
        package_id: 202,
      }),
      pick({
        match_id: "sm_garis35",
        market: "ou35",
        selection: "over",
        line: "3.5",
        published_prob: 0.55,
        probability_basis: "model",
        published_at_utc: "2026-11-20T09:30:00.000Z",
        pick_uid: "uid-garis-35",
        package_id: 203,
      }),
      /* C — kontrol tunggal: resmi 0,68 basis model; paket terbaru 0,45. */
      pick({
        match_id: "sm_tunggal",
        published_prob: 0.68,
        probability_basis: "model",
        published_at_utc: "2026-11-20T09:00:00.000Z",
        pick_uid: "uid-tunggal",
        package_id: 301,
      }),
    ]);

    const web = await import("../lib/web/data");
    const buatItem = (over: Partial<JadwalItem>): JadwalItem => ({
      match_id: "sm_x",
      fixture_uid: null,
      home: "Kandang",
      away: "Tamu",
      competition_name: "Liga Uji",
      competition_country: null,
      competition_canonical_id: "sm:1",
      competition_id_mentah: "sm:1",
      grup_kunci: "sm:1",
      grup_nama: "Liga Uji",
      grup_negara: null,
      grup_sumber: null,
      home_canonical_id: null,
      away_canonical_id: null,
      kickoff_utc: KO,
      status: "scheduled",
      home_goals: null,
      away_goals: null,
      menit: null,
      jadwal_asal_utc: null,
      jadwal_ulang_utc: null,
      package_id: null,
      gate_status: "calibrated",
      pickCounts: { A: 1, B: 0, C: 0 },
      topLeg: null,
      topLegResmi: null,
      topLegKonflik: null,
      ...over,
    });
    const leg = (over: Partial<Leg>): Leg => ({
      market: "btts",
      selection: "yes",
      model_prob: 0.7,
      effective_prob: 0.7,
      effective_source: "lab-band",
      band: "85+",
      band_n: 100,
      grade: "A",
      market_prob: null,
      sm_prob: null,
      agreement_spread: null,
      ...over,
    });

    const itemKonflik = buatItem({
      match_id: "sm_konflik",
      fixture_uid: "uid-fisik-konflik",
      package_id: 102,
      topLeg: leg({ effective_prob: 0.7 }),
    });
    const itemGaris = buatItem({
      match_id: "sm_garis",
      fixture_uid: "uid-fisik-garis",
      package_id: 202,
      topLeg: leg({ market: "ou25", selection: "over", effective_prob: 0.5 }),
    });
    const itemGaris35 = buatItem({
      match_id: "sm_garis35",
      package_id: 203,
      topLeg: leg({ market: "ou35", selection: "over", effective_prob: 0.5 }),
    });
    const itemTunggal = buatItem({
      match_id: "sm_tunggal",
      package_id: 302,
      topLeg: leg({ effective_prob: 0.45 }),
    });
    const itemPaket = buatItem({
      match_id: "sm_paket",
      package_id: 401,
      topLeg: leg({ market: "ou25", selection: "over", effective_prob: 0.77 }),
    });
    const semua = [itemKonflik, itemGaris, itemGaris35, itemTunggal, itemPaket];
    web.lengkapiTopLegResmi(semua);

    /* ---------------- A: konflik dua alias ------------------------- */
    const k = itemKonflik;
    console.log(
      `PROBE analisa-konflik: topLegResmi=${JSON.stringify(k.topLegResmi)} topLegKonflik=${JSON.stringify(
        k.topLegKonflik?.nilai.map((n) => n.published_prob) ?? null,
      )}`,
    );
    /* Silang-periksa Detail atas ledger yang sama. */
    const resmiMentah = web.getOfficialPicks("sm_konflik", "uid-fisik-konflik");
    const kejadian = web.kelompokkanPilihanResmi(resmiMentah);
    const bttsDetail = kejadian.find((g) => g.pick.market === "btts" && g.pick.selection === "yes");
    console.log(
      `PROBE detail-konflik: kejadian=${kejadian.length} konflikBtts=${JSON.stringify(
        bttsDetail?.konflik?.nilai.map((n) => n.published_prob) ?? null,
      )}`,
    );
    suite.eq("detail: BTTS satu kejadian dengan konflik [0,6276 · 0,7727]",
      (bttsDetail?.konflik?.nilai.map((n) => n.published_prob) ?? []).sort(),
      [0.6276, 0.7727],
    );
    suite.eq("analisa konflik: TIDAK ada angka resmi tunggal", k.topLegResmi, null);
    suite.check("analisa konflik: status konflik terisi", k.topLegKonflik !== null);
    suite.eq(
      "analisa konflik: jejak nilai == detail [0,6276 · 0,7727]",
      (k.topLegKonflik?.nilai.map((n) => n.published_prob) ?? []).sort(),
      [0.6276, 0.7727],
    );
    suite.eq(
      "analisa konflik: jejak asal menyebut kedua alias",
      (k.topLegKonflik?.nilai.map((n) => n.match_id) ?? []).sort(),
      ["mt_konflik", "sm_konflik"],
    );

    /* ---------------- B: garis berbeda tidak tercampur -------------- */
    const g25 = itemGaris;
    suite.eq("garis: leg ou25 mengambil angka garis 2.5 (0,66)", g25.topLegResmi?.prob, 0.66);
    suite.eq("garis: leg ou25 tanpa konflik semu", g25.topLegKonflik, null);
    const g35 = itemGaris35;
    suite.eq("garis: leg ou35 mengambil angka garis 3.5 (0,55)", g35.topLegResmi?.prob, 0.55);
    const kejadianGaris = web.kelompokkanPilihanResmi(
      web.getOfficialPicks("sm_garis", "uid-fisik-garis"),
    );
    suite.eq(
      "garis: detail mengelompokkan ou25 menjadi dua kejadian per garis",
      kejadianGaris.filter((g) => g.pick.market === "ou25").length,
      2,
    );

    /* ---------------- C & D: kontrol -------------------------------- */
    const t = itemTunggal;
    suite.eq("kontrol tunggal: angka resmi 0,68 (bukan 0,45 paket)", t.topLegResmi?.prob, 0.68);
    suite.eq(
      "kontrol tunggal: label basis B2.2 'Peluang model saat terbit'",
      t.topLegResmi?.label_basis,
      "Peluang model saat terbit",
    );
    suite.eq("kontrol tunggal: tanpa konflik", t.topLegKonflik, null);
    const p = itemPaket;
    suite.eq("kontrol paket-saja: tanpa angka resmi", p.topLegResmi, null);
    suite.eq("kontrol paket-saja: tanpa konflik", p.topLegKonflik, null);

    /* ---------------- E: budget SQL --------------------------------- */
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
    const segar = [
      buatItem({ match_id: "sm_konflik", fixture_uid: "uid-fisik-konflik", package_id: 102, topLeg: leg({}) }),
      buatItem({ match_id: "sm_garis", fixture_uid: "uid-fisik-garis", package_id: 202, topLeg: leg({ market: "ou25", selection: "over" }) }),
      buatItem({ match_id: "sm_tunggal", package_id: 302, topLeg: leg({}) }),
    ];
    sqlCount = 0;
    counting = true;
    try {
      web.lengkapiTopLegResmi(segar);
    } finally {
      counting = false;
      proto.prepare = origPrepare;
      proto.exec = origExec;
    }
    console.log(`PROBE budget-sql-lengkapi: ${sqlCount} statement untuk 3 item`);
    suite.check(
      `budget: lengkapiTopLegResmi batch ≤ 4 statement (terukur ${sqlCount})`,
      sqlCount > 0 && sqlCount <= 4,
      `sql=${sqlCount}`,
    );
    gagal = suite.failedCount > 0;
  } catch (e) {
    gagal = true;
    suite.check("sandbox berjalan", false, e instanceof Error ? e.message : String(e));
  } finally {
    settleFixtureEnv(env, gagal);
  }
  suite.finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
