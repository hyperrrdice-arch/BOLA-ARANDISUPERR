// PR 1A diagnostik: profil pembaca Beranda di staging (cwd = worktree,
// data/ = salinan konsisten produksi). Mengukur waktu per pembaca yang
// dipakai app/page.tsx: sorotanBeranda, jadwalBerikutnya, ambilRekam,
// plus listUpcoming(72) mentah. Read-only terhadap data staging.
import { performance } from "node:perf_hooks";
import { sorotanBeranda, jadwalBerikutnya, listUpcoming } from "../../lib/web/data";
import { ambilRekam, parseFilterRekam } from "../../lib/web/rekam";

function timeit(label: string, fn: () => unknown, reps = 5) {
  const times: number[] = [];
  let sample: unknown = null;
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    sample = fn();
    times.push(performance.now() - t0);
  }
  const sorted = [...times].sort((a, b) => a - b);
  console.log(JSON.stringify({
    label, reps, cold_ms: +times[0].toFixed(1),
    warm_median_ms: +sorted[Math.floor(sorted.length / 2)].toFixed(1),
    warm_min_ms: +sorted[0].toFixed(1), warm_max_ms: +sorted[sorted.length - 1].toFixed(1),
    result_size: Array.isArray(sample) ? sample.length : sample ? Object.keys(sample as object).length : 0,
  }));
}

const now = new Date();
timeit("listUpcoming(72)", () => listUpcoming(72));
timeit("sorotanBeranda", () => sorotanBeranda(now));
const sorotan = sorotanBeranda(now);
timeit("jadwalBerikutnya", () => jadwalBerikutnya(sorotan, now));
timeit("ambilRekam(default)", () => ambilRekam(parseFilterRekam({}), now.toISOString()));
timeit("beranda_total(3 pembaca)", () => {
  const s = sorotanBeranda(now);
  jadwalBerikutnya(s, now);
  return ambilRekam(parseFilterRekam({}), now.toISOString());
});
console.log("sorotan:", JSON.stringify(sorotan)?.slice(0, 200));
