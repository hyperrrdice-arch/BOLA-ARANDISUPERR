/**
 * VERIFIKASI PRODUKSI — TEMUAN #3 (branch fix/verifikasi-produksi).
 *
 * Pemilik mengukur di produksi (21 Nov 2026, 16.56 WIB): dokumen awal
 * /pilihan mengirim 2.718 rekaman pilihan + 388 matriks lengkap
 * (84.081 nilai) — 989.837 byte transfer / 3.500.284 byte dekompresi —
 * padahal tampilan awal hanya memperlihatkan 20 laga.
 *
 * Suite ini membekukan kontrak pengiriman yang baru pada fixture
 * tetap (31 laga / 94 pilihan):
 * - muatan awal = ringkasan 20 kelompok pertama + total terfilter,
 *   NOL matriks (rakitan lama pada fixture yang sama terbukti membawa
 *   30 matriks — jadi nol-nya perbaikan ini terukur, bukan bawaan
 *   fixture);
 * - pencarian berjalan di server atas SELURUH hasil: Køge BK duduk di
 *   kelompok ke-26 (di luar halaman pertama) dan tetap ditemukan,
 *   termasuk lewat lipatan aksen;
 * - route matriks mengembalikan hanya paket yang diminta (berkelompok),
 *   null untuk paket tanpa matriks / tak dikenal;
 * - matematika gabungan TIDAK berubah: matriks yang diambil lewat
 *   route lazy menghasilkan irisan 52,9% dan gabungan 46,1% persis
 *   regresi langkah 5; matriks null → gabungan tidak tersedia +
 *   alasan (jalur pesan yang sudah ada);
 * - pemulihan draf di server: cocok lewat pick_uid, cocok lewat kunci
 *   semantik, dan yang asing terhitung hilang; badan rusak → 400.
 *
 * Jalankan: npx tsx tests/test-verifikasi-pilihan-payload.ts
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
import { seedPaketObjek, seedPicks, type PickSeed } from "./helpers/redesain-seeds";

const suite = new Suite("verifikasi-pilihan-payload");
let gagal = false;

function runProbe<T>(env: FixtureEnv, aksi: string): T {
  const res = runScript(env, "tests/helpers/verifikasi3-probe.ts", [aksi]);
  const line = res.stdout.split("\n").find((l) => l.startsWith("PROBE_JSON "));
  if (!line) {
    throw new Error(`probe ${aksi} gagal (code ${res.code}): ${res.stderr.slice(-800)}`);
  }
  return JSON.parse(line.slice("PROBE_JSON ".length)) as T;
}

const MATRIKS_REGRESI: number[][] = [
  [0.06, 0.07, 0.055, 0.035, 0.012, 0.007],
  [0.15, 0.14, 0.07, 0.045, 0.02, 0.008],
  [0.09, 0.05, 0.048, 0.026, 0.011, 0.004],
  [0.029, 0.028, 0.016, 0.009, 0.004, 0.001],
  [0.006, 0.003, 0.0015, 0.0005, 0.0003, 0.0002],
  [0.0003, 0.0001, 0.00005, 0.00003, 0.00001, 0.00001],
];

/** Matriks 4×4 deterministik untuk laga pengisi (16 nilai). */
function matriksKecil(): number[][] {
  const m: number[][] = [];
  let total = 0;
  for (let h = 0; h < 4; h++) {
    const row: number[] = [];
    for (let a = 0; a < 4; a++) {
      const w = h * 4 + a + 1;
      row.push(w);
      total += w;
    }
    m.push(row);
  }
  return m.map((r) => r.map((v) => v / total));
}

function paket(
  matchId: string,
  home: string,
  away: string,
  kickoffMs: number,
  matrix: number[][] | null,
): Record<string, unknown> {
  return {
    fixture: {
      match_id: matchId,
      competition_id: "sm:1",
      competition_name: "Liga Uji",
      home,
      away,
      kickoff_utc: new Date(kickoffMs).toISOString(),
    },
    gate_status: "calibrated",
    population: "league",
    lambda: 1.7,
    mu: 1.2,
    rho: 0,
    probabilities: {},
    top_scores: [],
    score_matrix: matrix,
    market: null,
    sm_panel: null,
    legs: [],
  };
}

async function siapkan(env: FixtureEnv): Promise<void> {
  process.chdir(env.root);
  // Route app/api/* mengimpor alias "@/*" — tsx memetakannya dari
  // tsconfig di cwd (sandbox), jadi sandbox diberi tsconfig yang
  // menunjuk baseUrl ke root repo sungguhan (pola suite kontrak API).
  fs.writeFileSync(
    path.join(env.root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        baseUrl: REPO_ROOT,
        paths: { "@/*": ["./*"] },
      },
    }),
  );
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
  fs.writeFileSync(path.join(env.dataDir, "league-canonical.json"), JSON.stringify({ version: 1, leagues: [] }));
  fs.writeFileSync(path.join(env.dataDir, "team-canonical.json"), JSON.stringify({ teams: [] }));

  const JAM = 3_600_000;
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const TERBIT = iso(now - 2 * JAM);
  const dasar: Omit<PickSeed, "match_id" | "market" | "selection" | "line" | "published_prob" | "pick_uid" | "kickoff_utc" | "fixture_uid"> = {
    model_prob: 0.8, market_prob: null, sm_prob: null, probability_basis: "effective",
    published_at_utc: TERBIT, grade: "A", gate_status: "calibrated",
    competition_canonical_id: "sm:1", package_id: null,
  };
  const pick = (
    over: Partial<PickSeed> & Pick<PickSeed, "match_id" | "market" | "selection" | "published_prob" | "pick_uid" | "kickoff_utc">,
  ): PickSeed => ({ ...dasar, line: "", fixture_uid: null, ...over });

  const koBeng = now + 3 * JAM;
  const koSha = now + 5 * JAM;
  const koFiller = (i: number) => now + 8 * JAM + i * 0.5 * JAM;
  const koKoge = now + 8 * JAM + 23.25 * 0.5 * JAM; // antara pengisi 23 dan 24

  const pakets: Record<string, unknown>[] = [
    paket("vt_beng", "Bengaluru FC", "Mumbai City", koBeng, MATRIKS_REGRESI),
    paket("vt_sha", "Shabab Al Ahli Dubai", "Ajman", koSha, null),
  ];
  const picks: PickSeed[] = [
    pick({ match_id: "vt_beng", market: "team_over05_home", selection: "yes", published_prob: 0.761, pick_uid: "pk_t_b1", kickoff_utc: iso(koBeng), fixture_uid: "uid-t-beng" }),
    pick({ match_id: "vt_beng", market: "ou35", selection: "under", line: "3.5", published_prob: 0.749, pick_uid: "pk_t_b2", kickoff_utc: iso(koBeng), fixture_uid: "uid-t-beng" }),
    pick({ match_id: "vt_beng", market: "dc", selection: "1x", published_prob: 0.71, pick_uid: "pk_t_b3", kickoff_utc: iso(koBeng), fixture_uid: "uid-t-beng", grade: "B" }),
    pick({ match_id: "vt_beng", market: "btts", selection: "yes", published_prob: 0.68, pick_uid: "pk_t_b4", kickoff_utc: iso(koBeng), fixture_uid: "uid-t-beng", grade: "B" }),
    pick({ match_id: "vt_beng", market: "1x2", selection: "1", published_prob: 0.52, pick_uid: "pk_t_b5", kickoff_utc: iso(koBeng), fixture_uid: "uid-t-beng" }),
    pick({ match_id: "vt_sha", market: "team_over05_home", selection: "yes", published_prob: 0.872, pick_uid: "pk_t_s1", kickoff_utc: iso(koSha), fixture_uid: "uid-t-sha" }),
    pick({ match_id: "vt_sha", market: "1x2", selection: "1", published_prob: 0.66, pick_uid: "pk_t_s2", kickoff_utc: iso(koSha), fixture_uid: "uid-t-sha", grade: "B" }),
  ];
  for (let i = 1; i <= 28; i++) {
    const id = `vt_f${i}`;
    pakets.push(paket(id, `Pengisi ${i} FC`, `Lawan ${i} FC`, koFiller(i), matriksKecil()));
    picks.push(
      pick({ match_id: id, market: "ou15", selection: "over", line: "1.5", published_prob: 0.8, pick_uid: `pk_t_f${i}_1`, kickoff_utc: iso(koFiller(i)), fixture_uid: `uid-t-f${i}` }),
      pick({ match_id: id, market: "dc", selection: "1x", published_prob: 0.77, pick_uid: `pk_t_f${i}_2`, kickoff_utc: iso(koFiller(i)), fixture_uid: `uid-t-f${i}`, grade: "B" }),
      pick({ match_id: id, market: "team_over05_home", selection: "yes", published_prob: 0.81, pick_uid: `pk_t_f${i}_3`, kickoff_utc: iso(koFiller(i)), fixture_uid: `uid-t-f${i}` }),
    );
    if (i === 1) {
      picks.push(
        pick({ match_id: id, market: "btts", selection: "yes", published_prob: 0.6, pick_uid: "pk_t_f1_4", kickoff_utc: iso(koFiller(i)), fixture_uid: "uid-t-f1", grade: "C" }),
        pick({ match_id: id, market: "ou25", selection: "over", line: "2.5", published_prob: 0.83, pick_uid: "pk_t_f1_5", kickoff_utc: iso(koFiller(i)), fixture_uid: "uid-t-f1" }),
      );
    }
    if (i === 23) {
      pakets.push(paket("vt_koge", "Køge BK", "Næstved BK", koKoge, matriksKecil()));
      picks.push(
        pick({ match_id: "vt_koge", market: "ou15", selection: "over", line: "1.5", published_prob: 0.8, pick_uid: "pk_t_koge1", kickoff_utc: iso(koKoge), fixture_uid: "uid-t-koge" }),
      );
    }
  }

  const ids = seedPaketObjek(env, pakets);
  seedPicks(env, picks.map((p) => ({ ...p, package_id: ids.get(p.match_id) ?? null })));
}

interface UmpanOut {
  totalUmpan: number;
  awal: { nPilihan: number; totalPilihan: number; totalLaga: number; grup: number };
  kedua: { nPilihan: number; totalLaga: number };
  kelasA: { totalPilihan: number; totalLaga: number };
  semua: { totalPilihan: number; totalLaga: number };
  cariKoge: { totalLaga: number; nPilihan: number; home: string | null };
  cariKogeAksen: { totalLaga: number };
  indeksKoge: number;
  perTanggal: { nHasil: number; memuatKoge: boolean; semuaSatuTanggal: boolean } | null;
  ukuran: {
    byteLama: number;
    byteBaru: number;
    nMatriksLama: number;
    nNilai: number;
    halamanMengandungMatriks: boolean;
  };
}

interface RuteOut {
  daftar: { status: number; totalPilihan: number; totalLaga: number; nPilihan: number };
  daftarKoge: { totalLaga: number };
  daftarHal2: { nPilihan: number };
  matriks: {
    status: number;
    kunci: string[];
    bengSama: boolean;
    shaNull: boolean;
    asingNull: boolean;
  };
  gabungan: {
    dua: number | null;
    tiga: number | null;
    gagalNull: boolean;
    gagalAlasan: string | null;
  };
  pulih: {
    status: number;
    keys: string[];
    hilang: number;
    statusRusak: number;
    statusBukanJson: number;
  };
}

async function main(): Promise<void> {
  const env = createFixtureEnv("verifikasi3");
  try {
    await siapkan(env);

    const u = runProbe<UmpanOut>(env, "umpan");
    suite.eq("umpan: total pilihan resmi terbaca", u.totalUmpan, 94);
    suite.eq("awal: total terfilter kelas AB", u.awal.totalPilihan, 93);
    suite.eq("awal: total laga terfilter", u.awal.totalLaga, 31);
    suite.eq("awal: tepat 20 kelompok laga pertama", u.awal.grup, 20);
    suite.eq("awal: pilihan di halaman pertama", u.awal.nPilihan, 62);
    suite.eq("halaman 2: sisa pilihan terjangkau", u.kedua.nPilihan, 31);
    suite.eq("halaman 2: total laga konsisten", u.kedua.totalLaga, 31);
    suite.eq("kelas A saja: total pilihan", u.kelasA.totalPilihan, 62);
    suite.eq("kelas A saja: total laga", u.kelasA.totalLaga, 31);
    suite.eq("semua kelas: total pilihan", u.semua.totalPilihan, 94);
    suite.eq("pencarian server: 'koge' menemukan 1 laga", u.cariKoge.totalLaga, 1);
    suite.eq("pencarian server: hasil 'koge' adalah Køge BK", u.cariKoge.home, "Køge BK");
    suite.eq("pencarian server: lipatan aksen 'køge' juga menemukan", u.cariKogeAksen.totalLaga, 1);
    suite.check(
      "Køge duduk di luar 20 kelompok pertama",
      u.indeksKoge > 19,
      `indeks=${u.indeksKoge}`,
    );
    suite.eq("Køge adalah kelompok ke-26 (indeks 25)", u.indeksKoge, 25);
    suite.check(
      "saringan tanggal memuat laga pada tanggalnya",
      u.perTanggal?.memuatKoge === true,
    );
    suite.check(
      "saringan tanggal: semua hasil berbagi kunci tanggal yang sama",
      u.perTanggal?.semuaSatuTanggal === true,
    );
    suite.eq("rakitan lama membawa 30 matriks (beban terbukti ada)", u.ukuran.nMatriksLama, 30);
    suite.eq("rakitan lama membawa 500 nilai matriks", u.ukuran.nNilai, 500);
    suite.check(
      "halaman awal baru: NOL matriks terkirim",
      u.ukuran.halamanMengandungMatriks === false,
    );
    suite.check(
      "halaman awal baru lebih kecil dari rakitan lama",
      u.ukuran.byteBaru < u.ukuran.byteLama,
      `baru=${u.ukuran.byteBaru} lama=${u.ukuran.byteLama}`,
    );

    const r = runProbe<RuteOut>(env, "rute");
    suite.eq("route daftar: status 200", r.daftar.status, 200);
    suite.eq("route daftar: total pilihan AB", r.daftar.totalPilihan, 93);
    suite.eq("route daftar: total laga", r.daftar.totalLaga, 31);
    suite.eq("route daftar: halaman pertama 62 pilihan", r.daftar.nPilihan, 62);
    suite.eq("route daftar: pencarian 'koge' → 1 laga", r.daftarKoge.totalLaga, 1);
    suite.eq("route daftar: offset 20 → 31 pilihan", r.daftarHal2.nPilihan, 31);
    suite.eq("route matriks: status 200", r.matriks.status, 200);
    suite.eq(
      "route matriks: hanya paket yang diminta (duplikat melebur)",
      r.matriks.kunci.length,
      3,
    );
    suite.check("route matriks: matriks Bengaluru identik sumbernya", r.matriks.bengSama);
    suite.check("route matriks: paket tanpa matriks → null", r.matriks.shaNull);
    suite.check("route matriks: paket tak dikenal → null", r.matriks.asingNull);
    suite.check(
      "gabungan lazy: dua pilihan satu laga = 52,9%",
      r.gabungan.dua !== null && Math.abs(r.gabungan.dua - 0.529) < 0.001,
      String(r.gabungan.dua),
    );
    suite.check(
      "gabungan lazy: tambah lintas laga = 46,1%",
      r.gabungan.tiga !== null && Math.abs(r.gabungan.tiga - 0.461288) < 0.001,
      String(r.gabungan.tiga),
    );
    suite.check("gabungan tanpa matriks → tidak tersedia (bukan angka karangan)", r.gabungan.gagalNull);
    suite.check(
      "gabungan tanpa matriks → alasan menyebut matriks",
      (r.gabungan.gagalAlasan ?? "").includes("matriks"),
      String(r.gabungan.gagalAlasan),
    );
    suite.eq("route pulih: status 200", r.pulih.status, 200);
    suite.eq(
      "route pulih: cocok pick_uid + kunci semantik, urutan draf terjaga",
      r.pulih.keys,
      ["pk_t_b1", "pk_t_s1"],
    );
    suite.eq("route pulih: entri asing terhitung hilang", r.pulih.hilang, 1);
    suite.eq("route pulih: badan bukan array → 400", r.pulih.statusRusak, 400);
    suite.eq("route pulih: badan bukan JSON → 400", r.pulih.statusBukanJson, 400);
  } catch (e) {
    gagal = true;
    console.error(e);
  } finally {
    settleFixtureEnv(env, gagal || suite.failedCount > 0);
  }
  suite.finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
