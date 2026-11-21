/**
 * VERIFIKASI PRODUKSI — TEMUAN #2 (branch fix/verifikasi-produksi).
 *
 * Pemilik membuktikan di produksi (21 Nov 2026): kedua URL detail
 * Marseille–Le Mans (/pertandingan/mt_022917440 dan
 * /pertandingan/sm_19715544) menampilkan 16 pilihan resmi MENTAH —
 * termasuk DUA baris BTTS bertentangan (77,3% vs 62,8%, sama-sama
 * berlabel "peluang saat terbit") — sementara /pilihan sudah
 * mengelompokkannya dengan benar sebagai 9 kejadian · 1 laga dengan
 * BTTS berlabel Konflik.
 *
 * Suite ini membekukan keadaan itu dari data nyata
 * (tests/fixtures/redesain-repro/picks-marseille.json — 16 pick
 * ledger hasil migrasi K1/K2, fixture_uid 16/16 NULL persis produksi)
 * dan mengunci kontrak perbaikannya:
 *  - lapis mentah tidak berubah: kedua URL tetap membaca 16 pick;
 *  - kejadianResmi = 9 kejadian unik di KEDUA URL, hasil identik;
 *  - BTTS tampil satu kali sebagai konflik berjejak (dua nilai +
 *    dua asal + dua waktu terbit tertelusur);
 *  - kejadian sepakat melebur dengan semua edisi tertelusur;
 *  - pengelompokan detail == pengelompokan umpan Pilihan;
 *  - halaman detail merender kejadianResmi + label konflik pemilik.
 *
 * Jalankan: npx tsx tests/test-verifikasi-marseille-detail.ts
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  createFixtureEnv,
  buildCoreSchemas,
  runScript,
  settleFixtureEnv,
  Suite,
  REPO_ROOT,
  type FixtureEnv,
} from "./helpers/fixture-env";
import {
  bacaFixture,
  seedKatalog,
  seedRegistry,
  seedPaket,
  seedPicks,
  picksMarseille,
  type BarisKatalog,
  type PickSeed,
} from "./helpers/redesain-seeds";

const suite = new Suite("verifikasi-marseille-detail");
let gagal = false;

const MT = "mt_022917440";
const SM = "sm_19715544";
const bulat4 = (x: number) => Math.round(x * 10_000) / 10_000;

interface EdisiProbe {
  prob: number | null;
  match_id: string;
  pick_uid: string;
  published_at_utc: string | null;
}
interface KejadianProbe {
  kunci: string;
  line: string;
  prob: number | null;
  pick_uid: string;
  edisi: EdisiProbe[];
  konflik: EdisiProbe[] | null;
}
interface DetailProbe {
  mentah: number;
  kejadian: KejadianProbe[];
}
interface UmpanProbe {
  kunci: string;
  line: string;
  prob: number;
  konflik: EdisiProbe[] | null;
}

function runProbe(env: FixtureEnv): Record<string, DetailProbe | UmpanProbe[] | null> {
  const res = runScript(env, "tests/helpers/verifikasi2-probe.ts", ["detail"]);
  const line = res.stdout.split("\n").find((l) => l.startsWith("PROBE_JSON "));
  if (!line) {
    throw new Error(`probe detail gagal (code ${res.code}): ${res.stderr.slice(-800)}`);
  }
  return JSON.parse(line.slice("PROBE_JSON ".length)) as Record<
    string,
    DetailProbe | UmpanProbe[] | null
  >;
}

async function siapkanSkema(env: FixtureEnv): Promise<void> {
  process.chdir(env.root);
  const { ledger } = await buildCoreSchemas();
  const publication = await import("../lib/picks/publication");
  const tickets = await import("../lib/picks/tickets");
  publication.ensurePublicationSchema(ledger.getPicksDb());
  tickets.ensureTicketSchema(ledger.getPicksDb());
  const identity = await import("../lib/identity/fixture-resolver");
  const ds = new DatabaseSync(path.join(env.dataDir, "thestats_dataset.db"));
  identity.ensureIdentitySchema(ds);
  // Tabel telemetri kanonik selalu ada di produksi (dibangun refresh).
  ds.exec(
    `CREATE TABLE IF NOT EXISTS team_match_logs_canonical (
       log_id INTEGER, match_id TEXT, team_id TEXT, opponent_id TEXT,
       venue TEXT, match_date TEXT, season TEXT, result TEXT,
       goals_for INTEGER, goals_against INTEGER,
       xg_for REAL, xg_against REAL,
       canonical_team_id TEXT, canonical_opponent_id TEXT,
       canonical_match_key TEXT
     )`,
  );
  ds.close();
  fs.writeFileSync(path.join(env.dataDir, "fixture-links.json"), JSON.stringify({ links: [] }));
}

async function main(): Promise<void> {
  const env = createFixtureEnv("verifikasi2");
  try {
    await siapkanSkema(env);
    // Keadaan produksi pasca-gabung registry (langkah 2 redesain):
    // registry gabung + tautan dibangun builder yang sama.
    seedRegistry(env, bacaFixture<unknown[]>("registry-tim-gabung.json"));
    const kasus = bacaFixture<BarisKatalog[]>("katalog-kasus.json");
    seedKatalog(env, kasus.filter((r) => [SM, MT].includes(r.match_id)));
    const run = runScript(env, "scripts/build-fixture-links.ts");
    suite.check("builder fixture-links berjalan", run.code === 0, run.stderr.slice(-300));
    const pkgIds = seedPaket(env, ["paket-sm_19715544.json", "paket-mt_022917440.json"]);
    const seeds = picksMarseille(pkgIds);
    seedPicks(env, seeds);

    /* ---------------- ekspektasi diturunkan dari fixture beku -------- */
    const perKunci = new Map<string, PickSeed[]>();
    for (const p of seeds) {
      const k = `${p.market}:${p.selection}`;
      const arr = perKunci.get(k);
      if (arr) arr.push(p);
      else perKunci.set(k, [p]);
    }
    const kunciKonflik = [...perKunci.entries()]
      .filter(([, rows]) => new Set(rows.map((r) => r.published_prob)).size > 1)
      .map(([k]) => k)
      .sort();
    suite.eq("fixture beku: 16 pick mentah", seeds.length, 16);
    suite.eq("fixture beku: 9 kejadian semantik", perKunci.size, 9);
    suite.eq(
      "fixture beku: 4 kejadian berkonflik (btts, dc 1x, ou25, team_over05_away)",
      kunciKonflik,
      ["btts:yes", "dc:1x", "ou25:over", "team_over05_away:yes"],
    );

    const out = runProbe(env);
    const dMt = out[MT] as DetailProbe | null;
    const dSm = out[SM] as DetailProbe | null;
    const umpan = out.umpan as UmpanProbe[];
    suite.check("kedua URL detail terbaca", dMt !== null && dSm !== null);

    /* ---------------- lapis mentah + hitungan unik ------------------- */
    suite.eq("URL mt_: officialPicks mentah tetap 16", dMt?.mentah, 16);
    suite.eq("URL sm_: officialPicks mentah tetap 16", dSm?.mentah, 16);
    suite.eq("URL mt_: kejadian unik = 9 (bukan 16 mentah)", dMt?.kejadian.length, 9);
    suite.eq("URL sm_: kejadian unik = 9 (bukan 16 mentah)", dSm?.kejadian.length, 9);
    suite.eq(
      "kedua URL menampilkan pengelompokan yang IDENTIK",
      JSON.stringify(dSm?.kejadian),
      JSON.stringify(dMt?.kejadian),
    );

    for (const [label, d] of [["mt_", dMt], ["sm_", dSm]] as const) {
      if (!d) continue;
      const kunciAda = d.kejadian.map((k) => k.kunci).sort();
      suite.eq(
        `${label} kunci kejadian == fixture beku`,
        kunciAda,
        [...perKunci.keys()].sort(),
      );
      // Setiap kejadian: jumlah edisi tertelusur == jumlah baris fixture.
      const edisiPas = d.kejadian.every(
        (k) => k.edisi.length === (perKunci.get(k.kunci)?.length ?? -1),
      );
      suite.check(`${label} semua edisi sumber tertelusur per kejadian`, edisiPas);
      const konflikAda = d.kejadian
        .filter((k) => k.konflik !== null)
        .map((k) => k.kunci)
        .sort();
      suite.eq(`${label} kejadian berkonflik = 4 yang sama`, konflikAda, kunciKonflik);
    }

    /* ---------------- BTTS: satu kali, konflik berjejak -------------- */
    const btts = dMt?.kejadian.filter((k) => k.kunci === "btts:yes") ?? [];
    suite.eq("BTTS tampil SATU kali", btts.length, 1);
    suite.check("BTTS berlabel konflik (jejak ada)", btts[0]?.konflik !== null);
    suite.eq(
      "BTTS: kedua nilai tetap tertelusur [0,6276 · 0,7727]",
      (btts[0]?.konflik ?? []).map((n) => n.prob).sort(),
      [0.6276, 0.7727],
    );
    suite.eq(
      "BTTS: jejak menyebut kedua asal (mt_ + sm_)",
      (btts[0]?.konflik ?? []).map((n) => n.match_id).sort(),
      [MT, SM].sort(),
    );
    suite.check(
      "BTTS: waktu terbit kedua edisi tercatat di jejak",
      (btts[0]?.konflik ?? []).every(
        (n) => typeof n.published_at_utc === "string" && n.published_at_utc.length > 0,
      ),
    );
    suite.eq("BTTS: edisi sumber = 2 (lapis audit utuh)", btts[0]?.edisi.length, 2);

    /* ---------------- kejadian sepakat: melebur, tertelusur --------- */
    const ou = dMt?.kejadian.find((k) => k.kunci === "ou15:over");
    suite.eq("OU1.5 'Minimal dua gol' satu kejadian 85,5%", ou?.prob, 0.8553);
    suite.eq("OU1.5 tanpa konflik", ou?.konflik, null);
    suite.eq(
      "OU1.5: kedua pick_uid edisi tertelusur",
      (ou?.edisi ?? []).map((e) => e.pick_uid).sort(),
      (perKunci.get("ou15:over") ?? []).map((r) => r.pick_uid).sort(),
    );
    const tunggal = dMt?.kejadian.filter((k) => k.edisi.length === 1).map((k) => k.kunci).sort();
    suite.eq(
      "kejadian satu edisi tetap satu (ou35, 1x2)",
      tunggal,
      ["1x2:1", "ou35:over"],
    );

    /* ---------------- konsistensi dengan umpan Pilihan --------------- */
    suite.eq("umpan Pilihan: 9 kejadian juga", umpan.length, 9);
    suite.eq(
      "umpan Pilihan: kunci kejadian == detail",
      umpan.map((u) => u.kunci).sort(),
      (dMt?.kejadian ?? []).map((k) => k.kunci).sort(),
    );
    suite.eq(
      "umpan Pilihan: kunci konflik == detail",
      umpan.filter((u) => u.konflik !== null).map((u) => u.kunci).sort(),
      kunciKonflik,
    );
    const nilaiUmpanBtts = (umpan.find((u) => u.kunci === "btts:yes")?.konflik ?? [])
      .map((n) => n.prob)
      .sort();
    suite.eq("umpan Pilihan: nilai konflik BTTS == detail", nilaiUmpanBtts, [0.6276, 0.7727]);
    const probSepakat = (list: { kunci: string; prob: number | null; konflik: unknown }[]) =>
      list
        .filter((x) => x.konflik === null)
        .map((x) => `${x.kunci}=${x.prob === null ? "null" : bulat4(x.prob)}`)
        .sort();
    suite.eq(
      "kejadian sepakat: angka perwakilan detail == Pilihan",
      probSepakat(dMt?.kejadian ?? []),
      probSepakat(umpan),
    );

    /* ---------------- penjaga halaman detail ------------------------- */
    const pageSrc = fs.readFileSync(
      path.join(REPO_ROOT, "app", "(terminal)", "pertandingan", "[matchId]", "page.tsx"),
      "utf8",
    );
    suite.check(
      "halaman memuat label konflik pemilik 'Dua sumber berbeda angka'",
      pageSrc.includes("Dua sumber berbeda angka"),
    );
    suite.check(
      "label jumlah memakai hitungan kejadian unik",
      pageSrc.includes("kejadianResmi.length} pilihan resmi"),
    );
    suite.check(
      "daftar prediksi memetakan kejadianResmi (bukan baris mentah)",
      pageSrc.includes("kejadianResmi.map"),
    );
    suite.check(
      "daftar prediksi TIDAK lagi memetakan officialPicks mentah",
      !pageSrc.includes("officialPicks.map"),
    );
    suite.check(
      "rincian edisi sumber dirender (asal + waktu terbit per edisi)",
      pageSrc.includes("Edisi sumber") && pageSrc.includes("e.match_id"),
    );
  } catch (e) {
    gagal = true;
    suite.check("sandbox berjalan", false, e instanceof Error ? e.message : String(e));
  } finally {
    settleFixtureEnv(env, gagal || suite.failedCount > 0);
  }
  suite.finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
