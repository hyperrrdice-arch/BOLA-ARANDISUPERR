/**
 * TEST:PR2-DATA-PUBLIKASI — uji PR 2 (brief hal. 7 + hal. 13 L01) di atas
 * sandbox fixture. Yang dibuktikan:
 *
 *  1. BASIS TUNGGAL (menutup temuan basis ganda PR 1A F3): agregat
 *     ledgerStats per kelas memakai published_prob atas irisan yang
 *     sama dengan prob_slice cohortStats — claimed kelas A = 0,70
 *     (bukan 0,80 basis model), gap dihitung terhadap hit-rate irisan
 *     yang sama, prob_n menyatakan populasinya.
 *  2. L01 (brief hal. 13): pick resmi terbit p=0,78 dari paket A; paket
 *     B yang lebih baru membawa angka berbeda. Semua tampilan resmi
 *     tetap 0,78 (baris rekam + officialPicks + edisi terbit detail);
 *     analisis terbaru membaca paket B; angka terbit tidak berubah.
 *  3. KLASIFIKASI TERMINAL (lubang settlement PR 1A F7): jatuh tempo di
 *     kompetisi terdaftar tanpa feed hasil = `unresolvable`, keluar
 *     dari penyebut due/cakupan, terhitung sendiri; rekonsiliasi
 *     issued = settled + voids + not_started + awaiting + overdue +
 *     unresolvable persis. Kompetisi berfeed tetap pending (lag),
 *     kompetisi tak terdaftar tetap pending (tidak ditebak), alasan
 *     konflik terbukti MENANG atas klasifikasi feed, dan baris yang
 *     belum jatuh tempo di kompetisi tanpa feed BUKAN terminal.
 *  4. Registri absen → klasifikasi nonaktif: angka persis perilaku lama
 *     (jaminan sandbox suite lain + deployment tanpa registri).
 *
 * Seed + probe berjalan sebagai subprocess dengan cwd = sandbox.
 * Pakai: npm run test:web (suite ini dirantai di dalamnya).
 */
import {
  Suite,
  createFixtureEnv,
  runScript,
  settleFixtureEnv,
  type FixtureEnv,
} from "./helpers/fixture-env";

interface StatsProbe {
  issued: number;
  settled: number;
  hits: number;
  misses: number;
  hit_ratio: number | null;
  due: number;
  coverage: [number, number] | null;
  coverage_ratio: number | null;
  voids: number;
  not_started: number;
  awaiting_window: number;
  overdue_pending: number;
  unresolvable: number;
  overdue_by_reason: Record<string, number>;
  prob_slice: {
    n: number;
    avg_published_prob: number | null;
    avg_hit: number | null;
    legacy_hitmiss_only: number;
  };
}

interface ProbeOut {
  cohortLangsung: StatsProbe;
  rekam: {
    stats: StatsProbe;
    baris: {
      match_id: string;
      keadaan: string;
      alasan_jatuh_tempo: string | null;
      published_display: number | string;
    }[];
  };
  ringkasan: StatsProbe;
  tab: {
    hitungan: { dinilai: number; menunggu: number; batal: number; tak_dinilai: number };
    takDinilai: string[];
    menungguLewat: string[];
  };
  ledgerByGrade: {
    grade: string;
    n: number;
    resolved: number;
    hits: number;
    hit_rate: number | null;
    claimed: number | null;
    prob_n: number;
    gap_pp: number | null;
  }[];
  detail: {
    pkg_id: number;
    paket_terbit_id: number | null;
    official: { published_prob: number | null; package_id: number | null }[];
    trio_terbaru: Record<string, number>;
    trio_terbit: Record<string, number> | null;
  } | null;
}

function jalankanProbe(env: FixtureEnv): ProbeOut {
  const res = runScript(env, "tests/helpers/pr2-probe.ts");
  const line = res.stdout.split("\n").find((l) => l.startsWith("PROBE_JSON "));
  if (!line) {
    throw new Error(`probe gagal (exit=${res.code}): ${res.stdout} ${res.stderr}`);
  }
  return JSON.parse(line.slice("PROBE_JSON ".length)) as ProbeOut;
}

function dekat(a: number | null, b: number): boolean {
  return a !== null && Math.abs(a - b) < 1e-9;
}

/** Peta alasan dengan kunci terurut — perbandingan isi, bukan urutan sisip. */
function alasanKanonik(m: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(m).sort()) out[k] = m[k];
  return out;
}

const suite = new Suite("pr2-data-publikasi");

function skenarioUtama(): void {
  console.log("\n== PR2 utama — registri ada ==");
  const env = createFixtureEnv("pr2utama");
  let gagal = false;
  try {
    const seed = runScript(env, "tests/helpers/pr2-seed.ts");
    suite.check("seed utama OK", seed.code === 0 && seed.stdout.includes("SEED_OK"), seed.stderr);
    const p = jalankanProbe(env);
    const s = p.rekam.stats;

    /* ---- 3. klasifikasi terminal + rekonsiliasi ---- */
    suite.eq("rekonsiliasi issued", s.issued, 12);
    suite.eq(
      "rekonsiliasi bagian-bagiannya",
      s.settled + s.voids + s.not_started + s.awaiting_window + s.overdue_pending + s.unresolvable,
      12,
    );
    suite.eq("settled/hits", [s.settled, s.hits], [4, 3]);
    suite.eq("unresolvable = 1 (hanya tanpa-feed murni)", s.unresolvable, 1);
    suite.eq("overdue_pending = 3 (berfeed + konflik + asing)", s.overdue_pending, 3);
    suite.eq("due mengecualikan terminal", s.due, 7);
    suite.eq("cakupan [4,7]", s.coverage, [4, 7]);
    suite.eq(
      "alasan jatuh tempo",
      alasanKanonik(s.overdue_by_reason),
      { konflik: 1, tanpa_feed: 1, unspecified: 2 },
    );
    // cohortStats langsung (tanpa peta alasan): baris konflik ikut
    // terklasifikasi struktural — preseden alasan hanya berlaku bila
    // pemanggil menyerahkan alasan terbukti.
    suite.eq("langsung: unresolvable 2 tanpa peta alasan", p.cohortLangsung.unresolvable, 2);
    suite.eq("langsung: due 6", p.cohortLangsung.due, 6);
    // Paritas ringkasan Beranda vs rekam penuh.
    suite.eq("ringkasan == rekam (statistik)", p.ringkasan, s);

    /* ---- baris + tab ---- */
    const baris = new Map(p.rekam.baris.map((b) => [b.match_id, b]));
    suite.eq("baris tanpa-feed: keadaan terminal", baris.get("sm_pr2_o2")?.keadaan, "tidak-dapat-dinilai");
    suite.eq("baris tanpa-feed: alasan", baris.get("sm_pr2_o2")?.alasan_jatuh_tempo, "tanpa-feed");
    suite.eq("baris konflik: tetap jatuh-tempo", baris.get("mt_pr2_konflik")?.keadaan, "jatuh-tempo");
    suite.eq("baris konflik: alasan konflik", baris.get("mt_pr2_konflik")?.alasan_jatuh_tempo, "konflik");
    suite.eq("baris berfeed: jatuh-tempo biasa", baris.get("sm_pr2_o1")?.keadaan, "jatuh-tempo");
    suite.eq("baris asing: jatuh-tempo biasa", baris.get("sm_pr2_o4")?.keadaan, "jatuh-tempo");
    suite.eq("baris belum mulai (tanpa feed): belum-mulai", baris.get("sm_pr2_n1")?.keadaan, "belum-mulai");
    suite.eq("baris jendela (tanpa feed): menunggu-jendela", baris.get("sm_pr2_w1")?.keadaan, "menunggu-jendela");
    suite.eq("tab: hitungan", p.tab.hitungan, { dinilai: 4, menunggu: 6, batal: 1, tak_dinilai: 1 });
    suite.eq("tab: ember takDinilai", p.tab.takDinilai, ["sm_pr2_o2"]);

    /* ---- 1. basis tunggal ---- */
    suite.eq("prob_slice n", s.prob_slice.n, 3);
    suite.check(
      "prob_slice avg published",
      dekat(s.prob_slice.avg_published_prob, (0.8 + 0.6 + 0.65) / 3),
      String(s.prob_slice.avg_published_prob),
    );
    suite.check("prob_slice avg hit", dekat(s.prob_slice.avg_hit, 2 / 3), String(s.prob_slice.avg_hit));
    suite.eq("prob_slice warisan", s.prob_slice.legacy_hitmiss_only, 1);
    const gA = p.ledgerByGrade.find((g) => g.grade === "A");
    const gB = p.ledgerByGrade.find((g) => g.grade === "B");
    suite.check("ledger A claimed basis terbit 0,70", dekat(gA?.claimed ?? null, 0.7), String(gA?.claimed));
    suite.check(
      "ledger A claimed BUKAN basis model 0,80",
      gA !== undefined && gA.claimed !== null && Math.abs(gA.claimed - 0.8) > 0.05,
      String(gA?.claimed),
    );
    suite.eq("ledger A prob_n", gA?.prob_n, 2);
    suite.eq("ledger A gap satu irisan (−20,0)", gA?.gap_pp, -20);
    suite.check("ledger B claimed 0,65", dekat(gB?.claimed ?? null, 0.65), String(gB?.claimed));
    suite.eq("ledger B gap (+35,0)", gB?.gap_pp, 35);
    suite.eq(
      "baris warisan: label peluang tak tercatat",
      baris.get("sm_pr2_s3")?.published_display,
      "Peluang terbit tidak tercatat",
    );

    /* ---- 2. L01 ---- */
    suite.check("detail L01 ada", p.detail !== null);
    if (p.detail) {
      suite.eq("L01: pick resmi tetap 0,78", p.detail.official.map((o) => o.published_prob), [0.78]);
      suite.check(
        "L01: edisi terbit != edisi terbaru",
        p.detail.paket_terbit_id !== null && p.detail.paket_terbit_id !== p.detail.pkg_id,
        `terbit=${p.detail.paket_terbit_id} terbaru=${p.detail.pkg_id}`,
      );
      suite.eq("L01: trio terbit dari paket A", p.detail.trio_terbit, { "1": 0.55, x: 0.25, "2": 0.2 });
      suite.eq("L01: trio terbaru dari paket B", p.detail.trio_terbaru, { "1": 0.62, x: 0.22, "2": 0.16 });
      suite.eq("L01: baris rekam tampil 0,78", baris.get("sm_pr2_l01")?.published_display, 0.78);
    }
  } catch (e) {
    gagal = true;
    suite.check("skenario utama tanpa pengecualian", false, e instanceof Error ? e.message : String(e));
  } finally {
    settleFixtureEnv(env, gagal || suite.failedCount > 0);
  }
}

function skenarioTanpaRegistri(): void {
  console.log("\n== PR2 tanpa-registri — klasifikasi nonaktif ==");
  const env = createFixtureEnv("pr2noreg");
  let gagal = false;
  try {
    const seed = runScript(env, "tests/helpers/pr2-seed.ts", [], {
      PR2_SEED_VARIANT: "tanpa-registri",
    });
    suite.check("seed tanpa-registri OK", seed.code === 0 && seed.stdout.includes("SEED_OK"), seed.stderr);
    const p = jalankanProbe(env);
    const s = p.rekam.stats;
    suite.eq("tanpa registri: unresolvable 0", s.unresolvable, 0);
    suite.eq("tanpa registri: overdue_pending 4 (perilaku lama)", s.overdue_pending, 4);
    suite.eq("tanpa registri: due 8 (perilaku lama)", s.due, 8);
    suite.eq("tanpa registri: cakupan [4,8]", s.coverage, [4, 8]);
    suite.eq(
      "tanpa registri: alasan hanya konflik + unspecified",
      alasanKanonik(s.overdue_by_reason),
      { konflik: 1, unspecified: 3 },
    );
    const baris = new Map(p.rekam.baris.map((b) => [b.match_id, b]));
    suite.eq(
      "tanpa registri: baris tanpa-feed tetap jatuh-tempo",
      baris.get("sm_pr2_o2")?.keadaan,
      "jatuh-tempo",
    );
    suite.eq("tanpa registri: tak_dinilai 0", p.tab.hitungan.tak_dinilai, 0);
  } catch (e) {
    gagal = true;
    suite.check("skenario tanpa-registri tanpa pengecualian", false, e instanceof Error ? e.message : String(e));
  } finally {
    settleFixtureEnv(env, gagal || suite.failedCount > 0);
  }
}

skenarioUtama();
skenarioTanpaRegistri();
suite.finish();
