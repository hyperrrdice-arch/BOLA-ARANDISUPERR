/**
 * VERIFIKASI PRODUKSI — TEMUAN #1 (branch fix/verifikasi-produksi).
 *
 * Pemilik membuktikan di produksi (21 Nov 2026, 16.56–17.05 WIB):
 * Gençlerbirliği–Gaziantep (Süper Lig, kickoff 2026-11-21T10:30:00Z)
 * tampil DUA kali — fd_T1_20261121_genclerbirligi_gaziantep dan
 * sm_19746551 — dan kejadian yang sama ("tim kandang mencetak gol",
 * terbit 0,7612) bisa ditambah dari kedua baris: draf menampilkan
 * 2 pilihan dari 2 laga · 57,9% (= 0,7612²). Yang benar: 1 · 76,1%.
 *
 * Suite ini mereproduksi keadaan produksi secara beku (jam sebelum
 * kickoff; ekstrak nyata: tests/fixtures/verifikasi/) dalam dua fase
 * pada sandbox yang sama:
 *   FASE PRA  — registry pra-gabung (Gaziantep terbelah fd_/sm_) +
 *               store identitas apa adanya (fixture fd_ sudah ada,
 *               sisi sm_ tanpa alias): defek harus TERLIHAT.
 *   FASE PASCA — registry repo hasil perbaikan (gabung gelombang 6)
 *               + builder tautan yang sama: satu laga fisik, satu
 *               kejadian 76,1%, konflik pasar lain ditahan berjejak.
 *
 * Jalankan: npx tsx tests/test-verifikasi-genclerbirligi.ts
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
  seedKatalog,
  seedRegistry,
  seedPaketObjek,
  seedPicks,
  type BarisKatalog,
} from "./helpers/redesain-seeds";
import {
  bacaFixtureVer,
  katalogKontrol,
  picksGenclerbirligi,
  seedIdentitasPra,
  FD_06,
  FD_21,
  SM_06,
  SM_21,
  UID_FD_06,
  UID_FD_21,
} from "./helpers/verifikasi-seeds";

const suite = new Suite("verifikasi-genclerbirligi");
let gagal = false;

function runProbe<T>(env: FixtureEnv, aksi: string): T {
  const res = runScript(env, "tests/helpers/verifikasi-probe.ts", [aksi]);
  const line = res.stdout.split("\n").find((l) => l.startsWith("PROBE_JSON "));
  if (!line) {
    throw new Error(`probe ${aksi} gagal (code ${res.code}): ${res.stderr.slice(-800)}`);
  }
  return JSON.parse(line.slice("PROBE_JSON ".length)) as T;
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
  ds.close();
  fs.writeFileSync(path.join(env.dataDir, "fixture-links.json"), JSON.stringify({ links: [] }));
}

const bulat4 = (x: number) => Math.round(x * 10_000) / 10_000;

interface KejadianProbe {
  market: string; selection: string; line: string; prob: number;
  match_id: string; pick_uid: string; fixture_uid: string;
  konflik: { prob: number; match_id: string; pick_uid: string }[] | null;
}
interface ProbeUmpan {
  totalKejadian: number;
  kejadian: KejadianProbe[];
  target: { jumlah: number; kelompok: number; gabungan: number | null };
  ganda: { kelompok: number; gabungan: number | null } | null;
  gabungSemua: { pilihan: number; kelompok: number; gabungan: number | null };
  uids: Record<string, string | null>;
  saudaraSm: string[];
  saudaraFd: string[];
}
interface ProbeIdentitas {
  fx21: { competition_id: string | null; home_cid: string | null; away_cid: string | null; state: string } | null;
  fx06: { competition_id: string | null; home_cid: string | null; away_cid: string | null; state: string } | null;
  obsSm: { kind: string; fixtureUid: string | null };
  obsFd: { kind: string; fixtureUid: string | null };
  obsSm06: { kind: string; fixtureUid: string | null };
}

function bacaLinks(env: FixtureEnv): { twin_id: string; canonical_id: string }[] {
  const f = JSON.parse(
    fs.readFileSync(path.join(env.dataDir, "fixture-links.json"), "utf8"),
  ) as { links: { twin_id: string; canonical_id: string }[] };
  return f.links;
}

async function main(): Promise<void> {
  const env = createFixtureEnv("verifikasi1");
  try {
    await siapkanSkema(env);
    seedRegistry(env, bacaFixtureVer<unknown[]>("registry-tim-pra.json"));
    const nyata = bacaFixtureVer<BarisKatalog[]>("katalog-genclerbirligi.json");
    seedKatalog(env, [...nyata, ...katalogKontrol()]);
    seedIdentitasPra(env);
    const paketIds = seedPaketObjek(env, [
      bacaFixtureVer<Record<string, unknown>>("paket-fd-genclerbirligi.json"),
      bacaFixtureVer<Record<string, unknown>>("paket-sm-genclerbirligi.json"),
    ]);
    seedPicks(env, picksGenclerbirligi(paketIds));

    /* ================= FASE PRA — defek harus terlihat ================ */
    console.log("\n== Fase PRA — registry terbelah, keadaan produksi ==");
    const runPra = runScript(env, "scripts/build-fixture-links.ts");
    suite.check("PRA builder tautan berjalan", runPra.code === 0, runPra.stderr.slice(-300));
    const linksPra = bacaLinks(env);
    suite.eq(
      "PRA laga 21 Nov TIDAK tertaut (defek ter-reproduksi)",
      linksPra.find((l) => l.twin_id === FD_21)?.canonical_id,
      undefined,
    );
    suite.eq(
      "PRA laga 6 Nov TIDAK tertaut (defek yang sama)",
      linksPra.find((l) => l.twin_id === FD_06)?.canonical_id,
      undefined,
    );
    const pra = runProbe<ProbeUmpan>(env, "umpan");
    const targetPra = pra.kejadian.filter(
      (k) => k.market === "team_over05_home" && k.selection === "yes",
    );
    suite.eq("PRA kejadian 'tim kandang mencetak gol' tampil DUA kali", targetPra.length, 2);
    suite.eq(
      "PRA dua baris berkunci laga fisik BERBEDA (fx_ tersimpan vs match_id)",
      targetPra.map((k) => k.fixture_uid).sort(),
      [UID_FD_21, SM_21].sort(),
    );
    suite.eq("PRA total kejadian umpan = 6 (3 pasar × 2 baris)", pra.totalKejadian, 6);
    suite.eq("PRA tambah dari dua baris: 2 kelompok laga", pra.target.kelompok, 2);
    suite.check(
      "PRA gabungan terkuadratkan ≈ 57,9% (0,7612²) — angka salah pemilik",
      pra.target.gabungan !== null && Math.abs(pra.target.gabungan - 0.5794) < 0.0015,
      `gabungan=${pra.target.gabungan}`,
    );
    suite.eq("PRA store identitas: sisi sm_ tanpa UID", pra.uids[SM_21], null);
    suite.eq("PRA store identitas: sisi fd_ = fixture importer", pra.uids[FD_21], UID_FD_21);

    /* ================= FASE PASCA — perbaikan berlaku ================= */
    console.log("\n== Fase PASCA — registry gabung gelombang 6 + builder ==");
    fs.copyFileSync(
      path.join(REPO_ROOT, "data", "team-canonical.json"),
      path.join(env.dataDir, "team-canonical.json"),
    );
    const runPasca = runScript(env, "scripts/build-fixture-links.ts");
    suite.check("PASCA builder tautan berjalan", runPasca.code === 0, runPasca.stderr.slice(-300));
    const links = bacaLinks(env);
    const twinDari = (id: string) => links.find((l) => l.twin_id === id)?.canonical_id;
    suite.eq("PASCA fd_ 21 Nov tertaut ke sm_19746551", twinDari(FD_21), SM_21);
    suite.eq("PASCA fd_ 6 Nov tertaut ke sm_19746564", twinDari(FD_06), SM_06);
    suite.eq(
      "PASCA pasangan balikan 2027 tertaut satu sama lain",
      twinDari("fd_T1_20270418_genclerbirligi_gaziantep"),
      "sm_19746999",
    );
    suite.check(
      "PASCA kontrol senama/senior-muda TIDAK tertaut",
      ["sm_910001", "sm_910002", "sm_910003", "sm_910004"].every(
        (id) => twinDari(id) === undefined,
      ),
    );

    const pasca = runProbe<ProbeUmpan>(env, "umpan");
    suite.eq("PASCA total kejadian umpan = 3 (3 pasar, satu laga)", pasca.totalKejadian, 3);
    const target = pasca.kejadian.filter(
      (k) => k.market === "team_over05_home" && k.selection === "yes",
    );
    suite.eq("PASCA 'tim kandang mencetak gol' tampil SATU kali", target.length, 1);
    suite.eq("PASCA peluangnya 76,1% (0,7612)", bulat4(target[0]?.prob ?? 0), 0.7612);
    suite.eq("PASCA berkunci fixture fisik yang sudah ada (fx_ importer)", target[0]?.fixture_uid, UID_FD_21);
    suite.eq("PASCA tanpa konflik (dua edisi sepakat 0,7612)", target[0]?.konflik, null);
    const dc = pasca.kejadian.find((k) => k.market === "dc" && k.selection === "1x");
    suite.eq(
      "PASCA pasar lain beda angka → konflik berjejak [0,6855 · 0,7271]",
      dc?.konflik?.map((n) => bulat4(n.prob)).sort(),
      [0.6855, 0.7271],
    );
    suite.eq(
      "PASCA jejak konflik menyebut kedua alias",
      dc?.konflik?.map((n) => n.match_id).sort(),
      [FD_21, SM_21].sort(),
    );
    const ou = pasca.kejadian.find((k) => k.market === "ou15");
    suite.eq("PASCA OU1.5 satu kejadian 0,7505 tanpa konflik",
      [bulat4(ou?.prob ?? 0), ou?.konflik], [0.7505, null]);
    suite.eq("PASCA tambah kejadian itu: 1 kelompok laga", pasca.target.kelompok, 1);
    suite.check(
      "PASCA gabungan = 76,1% (bukan 57,9%)",
      pasca.target.gabungan !== null && Math.abs(pasca.target.gabungan - 0.7612) < 0.001,
      `gabungan=${pasca.target.gabungan}`,
    );
    suite.eq(
      "PASCA tambah dua kali (dua kunci baris) tetap 1 kelompok · 76,1%",
      [pasca.ganda?.kelompok, pasca.ganda?.gabungan !== null && pasca.ganda !== null ? bulat4(pasca.ganda.gabungan as number) : null],
      [1, 0.7612],
    );
    suite.eq(
      "PASCA slip semua kejadian bersih: 2 pilihan dalam 1 kelompok laga fisik",
      [pasca.gabungSemua.pilihan, pasca.gabungSemua.kelompok],
      [2, 1],
    );
    suite.check(
      "PASCA joint satu laga ≤ marginal terkecil (0,7505) dan > 0",
      pasca.gabungSemua.gabungan !== null &&
        pasca.gabungSemua.gabungan > 0 &&
        pasca.gabungSemua.gabungan <= 0.7505 + 1e-9,
      `gabungan=${pasca.gabungSemua.gabungan}`,
    );
    suite.eq("PASCA UID: kedua alias 21 Nov satu fixture", [pasca.uids[FD_21], pasca.uids[SM_21]], [UID_FD_21, UID_FD_21]);
    suite.eq("PASCA UID: kedua alias 6 Nov satu fixture", [pasca.uids[FD_06], pasca.uids[SM_06]], [UID_FD_06, UID_FD_06]);
    suite.check(
      "PASCA UID balikan 2027: berbagi UID sendiri, BEDA dari laga 21 Nov",
      pasca.uids["sm_19746999"] !== null &&
        pasca.uids["sm_19746999"] === pasca.uids["fd_T1_20270418_genclerbirligi_gaziantep"] &&
        pasca.uids["sm_19746999"] !== UID_FD_21,
      JSON.stringify(pasca.uids),
    );
    suite.check(
      "PASCA kontrol tidak memperoleh fixture bersama",
      ["sm_910001", "sm_910002", "sm_910003", "sm_910004"].every(
        (id) => pasca.uids[id] === null,
      ),
    );
    suite.check(
      "PASCA kedua tautan lama membuka laga yang sama (saudara dua arah)",
      pasca.saudaraSm.includes(FD_21) && pasca.saudaraSm.includes(SM_21) &&
        pasca.saudaraFd.includes(FD_21) && pasca.saudaraFd.includes(SM_21),
      JSON.stringify({ sm: pasca.saudaraSm, fd: pasca.saudaraFd }),
    );

    const idn = runProbe<ProbeIdentitas>(env, "identitas");
    suite.eq(
      "PASCA cid fixture 21 Nov terpulihkan ke registry gabung (fd_gaziantep → sm:4192)",
      [idn.fx21?.home_cid, idn.fx21?.away_cid],
      ["sm:286", "sm:4192"],
    );
    suite.eq(
      "PASCA kompetisi fixture tetap catatan importer ('T1'), UID tidak berubah",
      [idn.fx21?.competition_id, idn.fx21?.state],
      ["T1", "scheduled"],
    );
    suite.eq(
      "PASCA cid fixture 6 Nov terpulihkan dua sisi (→ sm:4192 / sm:1071)",
      [idn.fx06?.home_cid, idn.fx06?.away_cid, idn.fx06?.state],
      ["sm:4192", "sm:1071", "finished"],
    );
    suite.eq(
      "PASCA resolver: observasi sm_ 'known' ke fixture yang sama (tidak ambigu)",
      [idn.obsSm.kind, idn.obsSm.fixtureUid],
      ["known", UID_FD_21],
    );
    suite.eq(
      "PASCA resolver: observasi fd_ 'known' ke fixture yang sama",
      [idn.obsFd.kind, idn.obsFd.fixtureUid],
      ["known", UID_FD_21],
    );
    suite.eq(
      "PASCA resolver: observasi sm_ 6 Nov 'known' ke fixture selesai yang sama",
      [idn.obsSm06.kind, idn.obsSm06.fixtureUid],
      ["known", UID_FD_06],
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
