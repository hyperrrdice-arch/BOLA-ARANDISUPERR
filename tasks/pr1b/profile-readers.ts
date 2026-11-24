// PR 1B diagnostik: profil pembaca Beranda di staging (cwd = worktree,
// data/ = salinan konsisten produksi via sqlite .backup). Mengukur waktu
// per pembaca yang dipakai app/page.tsx sebelum & sesudah perubahan:
// jalur LAMA (sorotanBeranda + jadwalBerikutnya + ambilRekam) dan jalur
// BARU (berandaSorotanDanJadwal + ambilRingkasanRekam, bila sudah ada).
// Read-only terhadap data staging.
import { performance } from "node:perf_hooks";
import * as data from "../../lib/web/data";
import * as rekam from "../../lib/web/rekam";

function timeit(label: string, fn: () => unknown, reps = 7) {
  const times: number[] = [];
  let sample: unknown = null;
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    sample = fn();
    times.push(performance.now() - t0);
  }
  const sorted = [...times].sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      label,
      reps,
      cold_ms: +times[0].toFixed(1),
      warm_median_ms: +sorted[Math.floor(sorted.length / 2)].toFixed(1),
      warm_min_ms: +sorted[0].toFixed(1),
      warm_max_ms: +sorted[sorted.length - 1].toFixed(1),
      result_size: Array.isArray(sample)
        ? sample.length
        : sample
          ? Object.keys(sample as object).length
          : 0,
    }),
  );
}

const now = new Date();
timeit("listUpcoming(72)", () => data.listUpcoming(72));
timeit("sorotanBeranda", () => data.sorotanBeranda(now));
const sorotan = data.sorotanBeranda(now);
timeit("jadwalBerikutnya", () => data.jadwalBerikutnya(sorotan, now));
timeit("ambilRekam(default)", () =>
  rekam.ambilRekam(rekam.parseFilterRekam({}), now.toISOString()),
);

const baru = data as unknown as Record<string, unknown>;
if (typeof baru.berandaSorotanDanJadwal === "function") {
  const gabung = baru.berandaSorotanDanJadwal as (n: Date) => unknown;
  timeit("berandaSorotanDanJadwal [BARU]", () => gabung(now));
}
const rekamBaru = rekam as unknown as Record<string, unknown>;
if (typeof rekamBaru.ambilRingkasanRekam === "function") {
  const ringkas = rekamBaru.ambilRingkasanRekam as (
    f: ReturnType<typeof rekam.parseFilterRekam>,
    n: string,
  ) => unknown;
  timeit("ambilRingkasanRekam(default) [BARU]", () =>
    ringkas(rekam.parseFilterRekam({}), now.toISOString()),
  );
}

timeit("beranda_total(3 pembaca lama)", () => {
  const s = data.sorotanBeranda(now);
  data.jadwalBerikutnya(s, now);
  return rekam.ambilRekam(rekam.parseFilterRekam({}), now.toISOString());
});
console.log("sorotan:", JSON.stringify(sorotan)?.slice(0, 200));
