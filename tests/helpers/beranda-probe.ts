/**
 * BERANDA PROBE (PR 1B) — dijalankan sebagai subprocess dengan cwd =
 * sandbox. Membandingkan jalur baca Beranda LAMA (sorotanBeranda +
 * jadwalBerikutnya + ambilRekam) dengan jalur BARU
 * (berandaSorotanDanJadwal + ambilRingkasanRekam) pada jam beku yang
 * sama dan data fixture yang sama, lalu mencetak "PROBE_JSON ".
 * Skenario dipilih lewat env BERANDA_PROBE_SKENARIO:
 *   utama    — sorotan prediksi + kasus kickoff direvisi + parity rekam
 *              pada beberapa filter (termasuk beda zona waktu);
 *   cadangan — tangga fallback sorotan: tanpa-prediksi, berikutnya,
 *              hasil-terakhir (listFinished memakai jam asli proses —
 *              laga selesai di-seed relatif terhadap jam asli suite);
 *   kosong   — skema saja, nol data.
 * Probe tidak menilai apa pun; suite yang menilai.
 */
import {
  berandaSorotanDanJadwal,
  jadwalBerikutnya,
  sorotanBeranda,
  type FixtureListItem,
} from "../../lib/web/data";
import {
  ambilRekam,
  ambilRingkasanRekam,
  parseFilterRekam,
} from "../../lib/web/rekam";

export const NOW_A = "2026-11-24T12:00:00.000Z";
export const NOW_T = "2026-11-24T05:00:00.000Z";
export const NOW_B = "2027-06-01T12:00:00.000Z";
export const NOW_H = "2027-07-01T12:00:00.000Z";

function ringkasItem(i: FixtureListItem) {
  return {
    match_id: i.pkg.match_id,
    package_id: i.pkg.id,
    kickoff_utc: i.pkg.kickoff_utc,
    pickCounts: i.pickCounts,
    topLeg: i.topLeg
      ? {
          market: i.topLeg.market,
          selection: i.topLeg.selection,
          effective_prob: i.topLeg.effective_prob,
          grade: i.topLeg.grade,
        }
      : null,
    result: i.result,
  };
}

function pasanganSorotan(nowIso: string) {
  const now = new Date(nowIso);
  const sorotanLama = sorotanBeranda(now);
  const berikutLama = jadwalBerikutnya(sorotanLama, now).map(ringkasItem);
  const gabung = berandaSorotanDanJadwal(now);
  return {
    lama: { sorotan: sorotanLama, berikut: berikutLama },
    baru: { sorotan: gabung.sorotan, berikut: gabung.berikut.map(ringkasItem) },
  };
}

function pasanganRekam(params: Record<string, string>, nowIso: string) {
  const f = parseFilterRekam(params);
  const lama = ambilRekam(f, nowIso);
  const baru = ambilRingkasanRekam(f, nowIso);
  return {
    lama: { stats: lama.stats, laga_dinilai_unik: lama.laga_dinilai_unik },
    baru: { stats: baru.stats, laga_dinilai_unik: baru.laga_dinilai_unik },
  };
}

function main(): void {
  const skenario = process.env.BERANDA_PROBE_SKENARIO ?? "utama";
  let out: unknown;
  if (skenario === "utama") {
    out = {
      sorotan: pasanganSorotan(NOW_A),
      rekam: {
        baku: pasanganRekam({}, NOW_A),
        pasar: pasanganRekam({ pasar: "1x2" }, NOW_A),
        liga: pasanganRekam({ liga: "comp_pr1b" }, NOW_A),
        tanggalUtc: pasanganRekam(
          { dari: "2026-11-21", sampai: "2026-11-22", tz: "UTC" },
          NOW_A,
        ),
        tanggalJakarta: pasanganRekam(
          { dari: "2026-11-21", sampai: "2026-11-22", tz: "Asia/Jakarta" },
          NOW_A,
        ),
      },
    };
  } else if (skenario === "cadangan") {
    out = {
      tanpaPrediksi: pasanganSorotan(NOW_T),
      berikutnya: pasanganSorotan(NOW_B),
      hasilTerakhir: pasanganSorotan(NOW_H),
    };
  } else if (skenario === "kosong") {
    out = {
      sorotan: pasanganSorotan(NOW_A),
      rekam: pasanganRekam({}, NOW_A),
    };
  } else {
    throw new Error(`skenario tak dikenal: ${skenario}`);
  }
  console.log(`PROBE_JSON ${JSON.stringify(out)}`);
}

main();
