/**
 * TEST:BERANDA-PARITY (PR 1B) — parity jalur baca Beranda gaya uji P01
 * brief (hal. 13) di atas sandbox fixture.
 *
 * Yang dibuktikan:
 *  1. Pembaca gabungan baru `berandaSorotanDanJadwal` menghasilkan
 *     sorotan + daftar jadwal yang IDENTIK dengan pasangan lama
 *     `sorotanBeranda` + `jadwalBerikutnya` pada jam beku yang sama —
 *     termasuk kasus tepi P01: edisi baru yang memindahkan kickoff
 *     KELUAR jendela (laga hilang), edisi baru yang memindahkan
 *     kickoff MASUK jendela (edisi baru yang tampil), laga tanpa pick
 *     resmi (dilewati sorotan, tetap di jadwal), dan tangga fallback
 *     tanpa-prediksi / berikutnya / hasil-terakhir.
 *  2. Pembaca ringkasan baru `ambilRingkasanRekam` menghasilkan
 *     statistik cohort + laga unik yang IDENTIK dengan `ambilRekam`
 *     pada filter baku, pasar, liga, dan rentang tanggal pada dua zona
 *     waktu (UTC vs Asia/Jakarta — jendela lokal yang berbeda).
 *  3. Nol data: kedua jalur sepakat (sorotan null, daftar kosong,
 *     statistik kosong).
 *
 * Seed + probe berjalan sebagai subprocess dengan cwd = sandbox
 * (state modul bersih per skenario). Suite ini hanya menilai.
 *
 * Pakai: npm run test:web (suite ini dirantai di dalamnya).
 */
import {
  Suite,
  createFixtureEnv,
  runScript,
  settleFixtureEnv,
  type FixtureEnv,
  type RunResult,
} from "./helpers/fixture-env";

/* ------------------------------------------------------------ probe types */

interface StatsProbe {
  issued: number;
  settled: number;
  hits: number;
  misses: number;
  hit_ratio: number | null;
  due: number;
  voids: number;
  not_started: number;
  awaiting_window: number;
  overdue_pending: number;
  overdue_by_reason: Record<string, number>;
}
interface RekamPasangan {
  lama: { stats: StatsProbe; laga_dinilai_unik: number };
  baru: { stats: StatsProbe; laga_dinilai_unik: number };
}
interface ItemProbe {
  match_id: string;
  package_id: number;
  kickoff_utc: string;
}
interface SorotanProbe {
  jenis: string;
  match_id: string;
  prob: number | null;
}
interface SorotanPasangan {
  lama: { sorotan: SorotanProbe | null; berikut: ItemProbe[] };
  baru: { sorotan: SorotanProbe | null; berikut: ItemProbe[] };
}
interface ProbeUtama {
  sorotan: SorotanPasangan;
  rekam: Record<string, RekamPasangan>;
}
interface ProbeCadangan {
  tanpaPrediksi: SorotanPasangan;
  berikutnya: SorotanPasangan;
  hasilTerakhir: SorotanPasangan;
}
interface ProbeKosong {
  sorotan: SorotanPasangan;
  rekam: RekamPasangan;
}

function jalankan<T>(env: FixtureEnv, skrip: string, envVar: Record<string, string>, penanda: string): T {
  const res: RunResult = runScript(env, skrip, [], envVar);
  if (penanda === "SEED_OK") {
    if (!res.stdout.includes("SEED_OK")) {
      throw new Error(`seed gagal (exit=${res.code}): ${res.stdout} ${res.stderr}`);
    }
    return undefined as T;
  }
  const line = res.stdout.split("\n").find((l) => l.startsWith("PROBE_JSON "));
  if (!line) {
    throw new Error(`probe tidak menghasilkan PROBE_JSON (exit=${res.code}): ${res.stdout} ${res.stderr}`);
  }
  return JSON.parse(line.slice("PROBE_JSON ".length)) as T;
}

function seed(env: FixtureEnv, skenario: string): void {
  jalankan(env, "tests/helpers/beranda-seed.ts", { BERANDA_SEED_SKENARIO: skenario }, "SEED_OK");
}
function probe<T>(env: FixtureEnv, skenario: string): T {
  return jalankan<T>(env, "tests/helpers/beranda-probe.ts", { BERANDA_PROBE_SKENARIO: skenario }, "PROBE_JSON");
}

/* ------------------------------------------------------------------ suite */

const s = new Suite("test-beranda-pr1b");
let gagal = false;

/* Skenario utama: parity sorotan/jadwal + ringkasan rekam. */
{
  const env = createFixtureEnv("pr1butama");
  try {
    seed(env, "utama");
    const p = probe<ProbeUtama>(env, "utama");

    s.eq("utama: sorotan+jadwal baru identik dengan lama", p.sorotan.baru, p.sorotan.lama);
    s.eq("utama: sorotan adalah prediksi laga A", p.sorotan.lama.sorotan?.jenis, "prediksi");
    s.eq("utama: sorotan menunjuk laga A", p.sorotan.lama.sorotan?.match_id, "sm_p1b_a");
    s.eq("utama: prob sorotan = angka terbit pick resmi", p.sorotan.lama.sorotan?.prob, 0.88);
    s.eq(
      "utama: jadwal berikutnya = [D, C] (A dikeluarkan, B hilang, E lampau)",
      p.sorotan.lama.berikut.map((b) => b.match_id),
      ["fd_p1b_d", "sm_p1b_c"],
    );
    s.eq(
      "utama: C yang tampil adalah edisi baru (kickoff 27 Nov)",
      p.sorotan.lama.berikut.find((b) => b.match_id === "sm_p1b_c")?.kickoff_utc,
      "2026-11-27T10:00:00.000Z",
    );
    s.check(
      "utama: laga B (kickoff direvisi keluar jendela) tidak tampil di mana pun",
      p.sorotan.lama.sorotan?.match_id !== "sm_p1b_b" &&
        !p.sorotan.lama.berikut.some((b) => b.match_id === "sm_p1b_b"),
    );

    for (const [nama, pasangan] of Object.entries(p.rekam)) {
      s.eq(`utama: ringkasan rekam identik (filter ${nama})`, pasangan.baru, pasangan.lama);
    }
    const baku = p.rekam.baku.lama;
    s.eq("utama: statistik baku — issued/settled/hits/misses", [baku.stats.issued, baku.stats.settled, baku.stats.hits, baku.stats.misses], [12, 5, 4, 1]);
    s.eq("utama: statistik baku — hit_ratio", baku.stats.hit_ratio, 0.8);
    s.eq("utama: statistik baku — due (settled + jatuh tempo)", baku.stats.due, 7);
    s.eq("utama: statistik baku — voids tak terhitung settled", baku.stats.voids, 1);
    s.eq("utama: statistik baku — alasan jatuh tempo (konflik + tanpa alasan)", baku.stats.overdue_by_reason, { konflik: 1, unspecified: 1 });
    s.eq("utama: laga dinilai unik (alias r2+r3 menyatu)", baku.laga_dinilai_unik, 3);
    const pasar = p.rekam.pasar.lama;
    s.eq("utama: filter pasar 1x2 — settled/hits/due", [pasar.stats.settled, pasar.stats.hits, pasar.stats.due], [3, 2, 3]);
    const utc = p.rekam.tanggalUtc.lama;
    s.eq("utama: filter tanggal UTC — settled/hits/laga", [utc.stats.settled, utc.stats.hits, utc.laga_dinilai_unik], [3, 2, 2]);
    const jkt = p.rekam.tanggalJakarta.lama;
    s.eq("utama: filter tanggal Asia/Jakarta — settled/hits/laga (jendela bergeser)", [jkt.stats.settled, jkt.stats.hits, jkt.laga_dinilai_unik], [4, 3, 2]);
  } catch (e) {
    gagal = true;
    s.check(`utama: seed+probe berjalan (${(e as Error).message.slice(0, 200)})`, false);
  } finally {
    settleFixtureEnv(env, gagal || s.failedCount > 0);
  }
}

/* Skenario cadangan: tangga fallback sorotan. */
{
  const env = createFixtureEnv("pr1bcadangan");
  try {
    seed(env, "cadangan");
    const p = probe<ProbeCadangan>(env, "cadangan");
    s.eq("cadangan: tanpa-prediksi identik", p.tanpaPrediksi.baru, p.tanpaPrediksi.lama);
    s.eq("cadangan: jenis tanpa-prediksi", p.tanpaPrediksi.lama.sorotan?.jenis, "tanpa-prediksi");
    s.eq("cadangan: tanpa-prediksi menunjuk laga T", p.tanpaPrediksi.lama.sorotan?.match_id, "sm_p1b_t");
    s.eq("cadangan: jadwal sesudah tanpa-prediksi kosong (laga sorotan dikeluarkan)", p.tanpaPrediksi.lama.berikut, []);
    s.eq("cadangan: berikutnya identik", p.berikutnya.baru, p.berikutnya.lama);
    s.eq("cadangan: jenis berikutnya", p.berikutnya.lama.sorotan?.jenis, "berikutnya");
    s.eq("cadangan: berikutnya menunjuk laga N", p.berikutnya.lama.sorotan?.match_id, "sm_p1b_n");
    s.eq("cadangan: hasil-terakhir identik", p.hasilTerakhir.baru, p.hasilTerakhir.lama);
    s.eq("cadangan: jenis hasil-terakhir", p.hasilTerakhir.lama.sorotan?.jenis, "hasil-terakhir");
    s.eq("cadangan: hasil-terakhir menunjuk laga F", p.hasilTerakhir.lama.sorotan?.match_id, "sm_p1b_f");
  } catch (e) {
    gagal = true;
    s.check(`cadangan: seed+probe berjalan (${(e as Error).message.slice(0, 200)})`, false);
  } finally {
    settleFixtureEnv(env, gagal || s.failedCount > 0);
  }
}

/* Skenario kosong: nol data. */
{
  const env = createFixtureEnv("pr1bkosong");
  try {
    seed(env, "kosong");
    const p = probe<ProbeKosong>(env, "kosong");
    s.eq("kosong: sorotan+jadwal identik", p.sorotan.baru, p.sorotan.lama);
    s.eq("kosong: sorotan null", p.sorotan.lama.sorotan, null);
    s.eq("kosong: jadwal kosong", p.sorotan.lama.berikut, []);
    s.eq("kosong: ringkasan identik", p.rekam.baru, p.rekam.lama);
    s.eq("kosong: settled 0 + hit_ratio null + laga 0", [p.rekam.lama.stats.settled, p.rekam.lama.stats.hit_ratio, p.rekam.lama.laga_dinilai_unik], [0, null, 0]);
  } catch (e) {
    gagal = true;
    s.check(`kosong: seed+probe berjalan (${(e as Error).message.slice(0, 200)})`, false);
  } finally {
    settleFixtureEnv(env, gagal || s.failedCount > 0);
  }
}

s.finish();
