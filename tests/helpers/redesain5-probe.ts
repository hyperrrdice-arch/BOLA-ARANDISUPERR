/**
 * Probe subproses suite Langkah 5 redesain (Pilihan + Rekam hasil).
 * Dijalankan dengan cwd = sandbox fixture-env; mencetak satu baris
 * "PROBE_JSON <json>" per aksi. Getter DB repo meng-cache koneksi per
 * proses, jadi adapter web dibaca di sini — bukan di proses suite.
 *
 * Aksi:
 * - umpan  → daftarPilihanPraLaga pada jam beku (baris + kunci semantik)
 * - rekam  → ambilRekam (semua periode + 19 Nov WIB) + kalimatRingkasan
 *            + kelompokkanTabRekam, untuk assertion struktur §3E.
 */
import {
  ambilRekam,
  daftarPilihanPraLaga,
  kalimatRingkasan,
  kelompokkanTabRekam,
  parseFilterRekam,
  type RekamData,
} from "../../lib/web/rekam";
import { kunciSemantikPilihan } from "../../lib/web/draf";

function cetak(obj: unknown): void {
  console.log(`PROBE_JSON ${JSON.stringify(obj)}`);
}

const aksi = process.argv[2];
const NOW = "2026-11-21T12:00:00.000Z";

if (aksi === "umpan") {
  const rows = daftarPilihanPraLaga(NOW);
  cetak({
    total: rows.length,
    baris: rows.map((r) => ({
      pick_uid: r.pick_uid,
      match_id: r.match_id,
      fixture_uid: r.fixture_uid,
      market: r.market,
      selection: r.selection,
      line: r.line,
      published_prob: r.published_prob,
      konflik: r.konflik !== null,
      kunciSemantik: kunciSemantikPilihan(r.fixture_uid, r.market, r.line, r.selection),
    })),
  });
} else if (aksi === "rekam") {
  const ringkas = (d: RekamData) => {
    const tab = kelompokkanTabRekam(d.baris);
    const kalimat = kalimatRingkasan(d.stats, d.laga_dinilai_unik);
    return {
      issued: d.stats.issued,
      settled: d.stats.settled,
      hits: d.stats.hits,
      hitRatio: d.stats.hit_ratio,
      due: d.stats.due,
      coverage: d.stats.coverage,
      voids: d.stats.voids,
      notStarted: d.stats.not_started,
      overdue: d.stats.overdue_pending,
      lagaDinilaiUnik: d.laga_dinilai_unik,
      kalimatUtama: kalimat.utama,
      kalimatCakupan: kalimat.cakupan,
      tab: {
        dinilaiPilihan: tab.hitungan.dinilai,
        menungguPilihan: tab.hitungan.menunggu,
        batalPilihan: tab.hitungan.batal,
        kelompokDinilai: tab.dinilai.map((k) => ({
          kunci: k.kunci,
          match_id: k.match_id,
          n: k.baris.length,
          skor: [k.home_goals, k.away_goals],
        })),
        menungguLewat: tab.menungguLewat.length,
        menungguMendatang: tab.menungguMendatang.length,
        partisi:
          tab.hitungan.dinilai + tab.hitungan.menunggu + tab.hitungan.batal ===
          d.baris.length,
      },
    };
  };
  cetak({
    semua: ringkas(ambilRekam(parseFilterRekam({}), NOW)),
    f19: ringkas(
      ambilRekam(
        parseFilterRekam({ dari: "2026-11-19", sampai: "2026-11-19", tz: "Asia/Jakarta" }),
        NOW,
      ),
    ),
  });
} else {
  console.error(`aksi tak dikenal: ${aksi}`);
  process.exit(2);
}
