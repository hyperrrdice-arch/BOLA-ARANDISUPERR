/**
 * KEANDALAN BRIEF REDESAIN — LANGKAH 2 (branch redesain/bola).
 *
 * Membuktikan tiga perbaikan §8.2 brief di atas fixture Langkah 1:
 *  A. Identitas tim terbelah (Marseille): registry digabung di sumber
 *     kebenaran + builder tautan/identitas K1 + kunci semantik umpan
 *     (idempoten 85,5%, satu laga) + konflik BTTS ditahan berjejak.
 *  B. Status berdimensi waktu (brief §4): jam beku sebelum/tepat/
 *     sesudah kickoff, status terlambat, jadwal ulang, FT, sumber
 *     mengonfirmasi — identik di jalur tunggal dan batch jadwal.
 *  C. Isolasi error per bagian di detail: tabel bantu telemetri hilang
 *     → halaman tetap render, form terdegradasi kosong.
 *  R. Registry + tautan NYATA di repo (hasil builder gelombang 5).
 *
 * Jalankan: npx tsx tests/test-redesain-keandalan.ts
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
} from "./helpers/redesain-seeds";

const suite = new Suite("redesain-keandalan");
let gagal = false;

function runProbe<T>(env: FixtureEnv, aksi: string): T {
  const res = runScript(env, "tests/helpers/redesain2-probe.ts", [aksi]);
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

/* ==================================================== KASUS A — IDENTITAS */

interface ProbeUmpan {
  totalKejadian: number;
  kejadian: {
    market: string; selection: string; line: string; prob: number;
    match_id: string; fixture_uid: string;
    konflik: { prob: number; match_id: string; pick_uid: string }[] | null;
  }[];
  gabungOu: { kelompok: number; hitungGrup: number; gabungan: number } | null;
  gabungSemua: { pilihan: number; kelompok: number; gabungan: number };
  uids: Record<string, string | null>;
}

async function kasusA(): Promise<void> {
  console.log("\n== Kasus A — identitas Marseille (registry gabung + kunci semantik) ==");
  const env = createFixtureEnv("rd2identitas");
  try {
    await siapkanSkema(env);
    seedRegistry(env, bacaFixture<unknown[]>("registry-tim-gabung.json"));
    const kasus = bacaFixture<BarisKatalog[]>("katalog-kasus.json");
    const pembanding = bacaFixture<BarisKatalog[]>("katalog-pembanding.json");
    const marseille = kasus.filter((r) =>
      ["sm_19715544", "mt_022917440"].includes(r.match_id),
    );
    const dasar = marseille[0];
    const kontrol: BarisKatalog[] = [
      {
        ...dasar, match_id: "sm_900001", competition_id: "sm:301",
        utc_date: "2026-11-25T20:00:00.000Z",
        home_team_id: "7758", home_team_name: "Le Mans",
        away_team_id: "289", away_team_name: "Toulouse FC",
      },
      {
        ...dasar, match_id: "mt_900001", competition_id: "comp_0256",
        utc_date: "2026-11-25T20:00:00.000Z",
        home_team_id: "tm_97723", home_team_name: "Le Mans",
        away_team_id: "tm_25581", away_team_name: "Toulouse",
      },
    ];
    seedKatalog(env, [...marseille, ...pembanding, ...kontrol]);

    const run = runScript(env, "scripts/build-fixture-links.ts");
    suite.check("A builder fixture-links berjalan", run.code === 0, run.stderr.slice(-300));
    const linksFile = JSON.parse(
      fs.readFileSync(path.join(env.dataDir, "fixture-links.json"), "utf8"),
    ) as { links: { twin_id: string; canonical_id: string }[] };
    const twinDari = (id: string) => linksFile.links.find((l) => l.twin_id === id);
    suite.eq("A mt_022917440 tertaut ke sm_19715544", twinDari("mt_022917440")?.canonical_id, "sm_19715544");
    suite.eq("A mt_377265875 (vs Toulouse) tertaut ke sm_19715561", twinDari("mt_377265875")?.canonical_id, "sm_19715561");
    suite.eq("A kontrol Le Mans–Toulouse tetap tertaut", twinDari("mt_900001")?.canonical_id, "sm_900001");

    const pkgIds = seedPaket(env, ["paket-sm_19715544.json", "paket-mt_022917440.json"]);
    seedPicks(env, picksMarseille(pkgIds));

    const p = runProbe<ProbeUmpan>(env, "umpan");
    suite.check(
      "A store identitas: kedua alias Marseille satu UID",
      typeof p.uids["sm_19715544"] === "string" &&
        p.uids["sm_19715544"] === p.uids["mt_022917440"],
      JSON.stringify(p.uids),
    );
    suite.check(
      "A store identitas: pasangan Toulouse berbagi UID yang sama",
      typeof p.uids["sm_19715561"] === "string" &&
        p.uids["sm_19715561"] === p.uids["mt_377265875"],
    );
    suite.check(
      "A negatif: Lyon (nama mirip, laga beda) TIDAK menyatu ke UID Marseille",
      p.uids["mt_155794033"] === null || p.uids["mt_155794033"] !== p.uids["sm_19715544"],
    );
    suite.eq("A umpan: 16 pick mentah melebur jadi 9 kejadian semantik", p.totalKejadian, 9);
    const ou = p.kejadian.filter((k) => k.market === "ou15" && k.selection === "over");
    suite.eq("A 'Minimal dua gol' tampil SATU kali", ou.length, 1);
    suite.eq("A OU1.5 = 85,5% (angka terbit yang disepakati dua edisi)", bulat4(ou[0]?.prob ?? 0), 0.8553);
    suite.eq("A OU1.5 tanpa konflik", ou[0]?.konflik, null);
    suite.eq("A OU1.5 berkunci UID fisik", ou[0]?.fixture_uid, p.uids["sm_19715544"]);
    const konflik = p.kejadian.filter((k) => k.konflik !== null);
    suite.eq(
      "A kejadian berkonflik = 4 (btts, dc 1x, ou25, team_over05_away)",
      konflik.map((k) => `${k.market}:${k.selection}`).sort(),
      ["btts:yes", "dc:1x", "ou25:over", "team_over05_away:yes"],
    );
    const btts = konflik.find((k) => k.market === "btts");
    suite.eq(
      "A konflik BTTS berjejak dua angka + dua asal",
      btts?.konflik?.map((n) => bulat4(n.prob)).sort(),
      [0.6276, 0.7727],
    );
    suite.eq(
      "A jejak BTTS menyebut kedua alias",
      btts?.konflik?.map((n) => n.match_id).sort(),
      ["mt_022917440", "sm_19715544"],
    );
    suite.check(
      "A tambah OU1.5 lewat dua alias: 1 kelompok, gabungan ≈85,5% dari matriks (bukan 73,2%)",
      p.gabungOu !== null &&
        p.gabungOu.kelompok === 1 &&
        Math.abs(p.gabungOu.gabungan - 0.8553) < 0.002,
      JSON.stringify(p.gabungOu),
    );
    suite.eq(
      "A slip gabungan: 5 pilihan bisa-digabung dalam 1 kelompok laga fisik",
      [p.gabungSemua.pilihan, p.gabungSemua.kelompok],
      [5, 1],
    );
    suite.check(
      "A joint 5 kejadian ≤ marginal terkecil (0,6288) dan > 0 — satu laga, bukan dua",
      p.gabungSemua.gabungan > 0 && p.gabungSemua.gabungan <= 0.6288 + 1e-9,
      `gabungan=${p.gabungSemua.gabungan}`,
    );
  } catch (e) {
    gagal = true;
    suite.check("A sandbox berjalan", false, e instanceof Error ? e.message : String(e));
  } finally {
    settleFixtureEnv(env, gagal || suite.failedCount > 0);
  }
}

/* ======================================================= KASUS B — STATUS */

interface ProbeStatusUnit {
  [k: string]: { status: string; label: string } | string | number | null;
}
interface ProbeStatus {
  barcaSebelum: { status: string; label: string } | null;
  barcaTepat: { status: string; label: string } | null;
  barca24jam: { status: string; label: string } | null;
  rostov35jam: { status: string; label: string } | null;
  rostovSebelum: { status: string; label: string } | null;
  jadwalBarca: { status: string; label: string } | null;
}

async function kasusB(): Promise<void> {
  console.log("\n== Kasus B — status berdimensi waktu (jam beku) ==");
  const env = createFixtureEnv("rd2status");
  try {
    await siapkanSkema(env);
    const kasus = bacaFixture<BarisKatalog[]>("katalog-kasus.json");
    seedKatalog(
      env,
      kasus.filter((r) => ["sm_19726740", "sm_19879501"].includes(r.match_id)),
    );

    const u = runProbe<ProbeStatusUnit>(env, "status-unit");
    const st = (k: string) => (u[k] as { status: string; label: string }).status;
    const lb = (k: string) => (u[k] as { status: string; label: string }).label;
    suite.eq("B sebelum kickoff: scheduled", st("sebelum"), "scheduled");
    suite.eq("B sebelum kickoff: label 'Belum mulai'", lb("sebelum"), "Belum mulai");
    suite.eq("B tepat kickoff: menunggu-pembaruan", st("tepat-kickoff"), "menunggu-pembaruan");
    suite.eq("B +3,5 jam (pola Rostov): menunggu-pembaruan", st("plus-3.5jam"), "menunggu-pembaruan");
    suite.eq("B +24 jam (pola Barcelona): menunggu-pembaruan", st("plus-24jam"), "menunggu-pembaruan");
    suite.eq(
      "B label persis brief §4",
      lb("plus-24jam"),
      "Menunggu pembaruan pertandingan",
    );
    suite.eq("B sumber 'live' menang atas jam", st("live-sumber"), "live");
    suite.eq("B label live", lb("live-sumber"), "Sedang berlangsung");
    suite.eq("B menit terbaca dari status mentah", u["menit-dari-mentah"], 63);
    suite.eq("B label live + menit", u["label-live-menit"], "Sedang berlangsung · 63'");
    suite.eq("B ditunda mengikuti sumber walau +24 jam", st("ditunda"), "postponed");
    suite.eq("B dibatalkan mengikuti sumber", st("dibatalkan"), "cancelled");
    suite.eq("B FT = selesai", st("ft"), "finished");
    suite.eq("B final tanpa skor tetap selesai (penilaian menunggu di lapisan resolver)", st("selesai-tanpa-skor"), "finished");
    suite.eq("B status tak dikenal + kickoff lewat = menunggu-pembaruan", st("tak-dikenal-lewat"), "menunggu-pembaruan");
    suite.eq("B tanpa kickoff: tidak ditebak", st("terjadwal-tanpa-kickoff"), "scheduled");
    suite.eq("B T−1ms masih scheduled", u["terapkan-scheduled"], "scheduled");

    const s = runProbe<ProbeStatus>(env, "status");
    suite.eq("B integrasi: Barcelona sebelum kickoff = scheduled", s.barcaSebelum?.status, "scheduled");
    suite.eq("B integrasi: Barcelona tepat kickoff = menunggu-pembaruan", s.barcaTepat?.status, "menunggu-pembaruan");
    suite.eq("B integrasi: Barcelona +24 jam = menunggu-pembaruan", s.barca24jam?.status, "menunggu-pembaruan");
    suite.eq("B integrasi: label Barcelona +24 jam", s.barca24jam?.label, "Menunggu pembaruan pertandingan");
    suite.eq("B integrasi: Rostov +3,5 jam = menunggu-pembaruan", s.rostov35jam?.status, "menunggu-pembaruan");
    suite.eq("B integrasi: Rostov sebelum kickoff = scheduled", s.rostovSebelum?.status, "scheduled");
    suite.eq("B jalur batch jadwal: status sama (menunggu-pembaruan)", s.jadwalBarca?.status, "menunggu-pembaruan");
  } catch (e) {
    gagal = true;
    suite.check("B sandbox berjalan", false, e instanceof Error ? e.message : String(e));
  } finally {
    settleFixtureEnv(env, gagal || suite.failedCount > 0);
  }
}

/* ====================================================== KASUS C — ISOLASI */

interface ProbeIsolasi {
  tabelFormAda: boolean;
  formLangsung: unknown;
  detail: {
    ok: boolean; alasan?: string; home?: string; market?: unknown;
    p1x2home?: number | null; formHome?: number; formAway?: number;
    keadaanStatus?: string | null;
  };
}

async function kasusC(): Promise<void> {
  console.log("\n== Kasus C — isolasi error per bagian di detail ==");
  const env = createFixtureEnv("rd2isolasi");
  try {
    await siapkanSkema(env);
    // Registry penuh repo (Rostov harus ter-resolve kanoniknya) — disalin
    // apa adanya; dataset sandbox tetap TANPA tabel telemetri kanonik.
    fs.copyFileSync(
      path.join(REPO_ROOT, "data", "team-canonical.json"),
      path.join(env.dataDir, "team-canonical.json"),
    );
    const kasus = bacaFixture<BarisKatalog[]>("katalog-kasus.json");
    seedKatalog(env, kasus.filter((r) => r.match_id === "sm_19726740"));
    seedPaket(env, ["paket-sm_19726740.json"]);

    const p = runProbe<ProbeIsolasi>(env, "isolasi");
    suite.eq("C prasyarat: tabel telemetri memang absen di sandbox", p.tabelFormAda, false);
    suite.eq("C getForm langsung: tidak melempar, hasil kosong", p.formLangsung, 0);
    suite.check("C getMatchDetail TIDAK runtuh oleh tabel bantu hilang", p.detail.ok === true, p.detail.alasan ?? "");
    suite.eq("C data inti utuh: tim kandang dari paket", p.detail.home, "Rostov");
    suite.eq("C market warisan tetap null (Fix-1 utuh)", p.detail.market, null);
    const payload = bacaFixture<{ probabilities: Record<string, number> }>("paket-sm_19726740.json");
    suite.check(
      "C peluang model utuh dari paket",
      Math.abs((p.detail.p1x2home ?? 0) - payload.probabilities["1x2:1"]) < 1e-12,
      `aktual=${p.detail.p1x2home}`,
    );
    suite.eq("C form terdegradasi kosong di kedua sisi", [p.detail.formHome, p.detail.formAway], [0, 0]);
    suite.eq(
      "C keadaan laga tetap terhitung (kickoff lewat → menunggu-pembaruan)",
      p.detail.keadaanStatus,
      "menunggu-pembaruan",
    );
  } catch (e) {
    gagal = true;
    suite.check("C sandbox berjalan", false, e instanceof Error ? e.message : String(e));
  } finally {
    settleFixtureEnv(env, gagal || suite.failedCount > 0);
  }
}

/* ================================================ KASUS R — REGISTRY NYATA */

function kasusR(): void {
  console.log("\n== Kasus R — registry + tautan nyata di repo (gelombang 5 + 6) ==");
  const reg = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "data", "team-canonical.json"), "utf8"),
  ) as {
    teams: {
      canonical_id: string;
      members: { team_id: string }[];
      distinct_from?: { canonical_id: string }[];
    }[];
  };
  const byMember = new Map<string, string>();
  for (const t of reg.teams) for (const m of t.members) byMember.set(m.team_id, t.canonical_id);
  const entri = (cid: string) => reg.teams.find((t) => t.canonical_id === cid);

  // 6.543 sesudah gelombang 5; gelombang 6 (verifikasi produksi temuan
  // #1, 2026-11-21) menggabung dua klub Turki lagi yang terbelah antar
  // sumber — lihat suite test-verifikasi-genclerbirligi.ts.
  suite.eq("R jumlah tim kanonik 6.600 − 58 gabung + 1 pisah − 2 gabung gelombang 6", reg.teams.length, 6541);
  suite.eq("R Gaziantep: fd_gaziantep kini anggota sm:4192", byMember.get("fd_gaziantep"), "sm:4192");
  suite.eq("R Kasımpaşa: tm_master_kasimpasa kini anggota sm:1071", byMember.get("tm_master_kasimpasa"), "sm:1071");
  suite.eq("R Marseille: tm_25550 kini anggota sm:44", byMember.get("tm_25550"), "sm:44");
  suite.eq("R Olympiacos: 562 + tm_47798 kini anggota sm:602", [byMember.get("562"), byMember.get("tm_47798")], ["sm:602", "sm:602"]);
  suite.eq("R Everton Inggris: id 13 berk kanonik sm:13", byMember.get("13"), "sm:13");
  suite.eq("R Everton Chile: id 15064 tetap sm:15064, sendiri", byMember.get("15064"), "sm:15064");
  suite.eq(
    "R Everton terpisah dua arah (distinct_from)",
    [
      entri("sm:13")?.distinct_from?.map((d) => d.canonical_id),
      entri("sm:15064")?.distinct_from?.map((d) => d.canonical_id),
    ],
    [["sm:15064"], ["sm:13"]],
  );
  suite.eq("R fd_mansfield anggota Mansfield Town (sm:225)", byMember.get("fd_mansfield"), "sm:225");
  suite.check(
    "R fd_mansfield BUKAN anggota AFC Mansfield (sm:20249)",
    entri("sm:20249")?.members.every((m) => m.team_id !== "fd_mansfield") === true,
  );
  suite.eq("R Bohemians Dublin (374) tetap terpisah dari Bohemians 1905 (2488)",
    [byMember.get("374"), byMember.get("2488")], ["sm:374", "sm:2488"]);

  const links = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "data", "fixture-links.json"), "utf8"),
  ) as { links: { twin_id: string; canonical_id: string }[]; stats: { twin_rows: number } };
  const twin = (id: string) => links.links.find((l) => l.twin_id === id)?.canonical_id;
  suite.eq("R tautan nyata: mt_022917440 → sm_19715544", twin("mt_022917440"), "sm_19715544");
  suite.eq("R tautan nyata: mt_377265875 → sm_19715561", twin("mt_377265875"), "sm_19715561");
  suite.eq("R tautan nyata: fd_ Gençlerbirliği–Gaziantep → sm_19746551", twin("fd_T1_20261121_genclerbirligi_gaziantep"), "sm_19746551");
  suite.eq("R tautan nyata: fd_ Gaziantep–Kasımpaşa → sm_19746564", twin("fd_T1_20261106_gaziantep_kasimpasa"), "sm_19746564");
  suite.eq("R tautan nyata: fd_ Kasımpaşa–Alanyaspor → sm_19746554", twin("fd_T1_20261122_kasimpasa_alanyaspor"), "sm_19746554");
  suite.check(
    "R tautan nyata bertambah dari 188 menjadi ≥250",
    links.stats.twin_rows >= 250 && links.links.length === links.stats.twin_rows,
    `twin_rows=${links.stats.twin_rows}`,
  );
}

async function main(): Promise<void> {
  const pilihan = process.argv[2];
  if (!pilihan) {
    const { spawnSync } = await import("node:child_process");
    const pathMod = await import("node:path");
    let kode = 0;
    for (const k of ["kasusA", "kasusB", "kasusC", "kasusR"]) {
      const res = spawnSync(
        pathMod.join(REPO_ROOT, "node_modules", ".bin", "tsx"),
        [pathMod.join(REPO_ROOT, "tests/test-redesain-keandalan.ts"), k],
        { cwd: REPO_ROOT, stdio: "inherit", env: { ...process.env } },
      );
      if ((res.status ?? 1) !== 0) kode = 1;
    }
    process.exit(kode);
  }
  if (pilihan === "kasusA") await kasusA();
  else if (pilihan === "kasusB") await kasusB();
  else if (pilihan === "kasusC") await kasusC();
  else if (pilihan === "kasusR") kasusR();
  else {
    console.error(`kasus tidak dikenal: ${pilihan}`);
    process.exit(2);
  }
  suite.finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
