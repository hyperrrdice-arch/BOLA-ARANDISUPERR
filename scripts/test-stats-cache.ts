/**
 * RUNNABLE CHECK (plan-perf Task 7) — cache TheStatsAPI.
 * Tanpa jaringan: `fetch` global distub.
 *
 * Membuktikan:
 *  - N pemanggil bersamaan pada key dingin = 1 fetch upstream (anti-stampede)
 *  - response error di-cache singkat (negative caching), bukan dipukul ulang tiap request
 *  - abort TIDAK ikut di-cache sebagai error
 *  - pemanggil ber-signal tidak ikut dedupe (abort satu client tidak membunuh yang lain)
 *
 * Jalankan: npx tsx scripts/test-stats-cache.ts
 */
import { cachedStatsGet, clearStatsCache, getStatsCacheMetrics } from "../lib/stats-cache";

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
  }
}

process.env.STATS_API_KEY = "test-key";
const realFetch = globalThis.fetch;
let calls = 0;
let mode: "ok" | "error" | "abort" = "ok";

globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
  calls++;
  await new Promise((r) => setTimeout(r, 40));
  if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (mode === "abort") throw new DOMException("Aborted", "AbortError");
  if (mode === "error") return new Response(JSON.stringify({ error: { code: "BOOM" } }), { status: 503 });
  return new Response(JSON.stringify({ data: [{ id: 1 }] }), { status: 200 });
}) as typeof fetch;

async function main() {
  console.log("=== TEST STATS CACHE ===\n");
  clearStatsCache();

  // 1. Anti-stampede: 6 pemanggil bersamaan, satu key, tanpa signal.
  calls = 0;
  const parallel = await Promise.all(
    Array.from({ length: 6 }, () => cachedStatsGet("/stampede", { q: "a" }, 60_000))
  );
  assert(calls === 1, `6 pemanggil bersamaan = 1 fetch upstream (nyata: ${calls})`);
  assert(
    parallel.every((r: { data?: Array<{ id: number }> }) => r?.data?.[0]?.id === 1),
    "semua pemanggil dapat data yang sama"
  );
  assert(getStatsCacheMetrics().misses === 1, "misses dihitung sekali (bukan 6)");

  // 2. Hit setelahnya tidak menambah fetch.
  calls = 0;
  await cachedStatsGet("/stampede", { q: "a" }, 60_000);
  assert(calls === 0, "cache hit tidak menembak upstream");

  // 3. Negative caching: error di-cache singkat, request berikutnya tidak refetch.
  mode = "error";
  calls = 0;
  const first = await cachedStatsGet("/negative", {}, 60_000);
  const second = await cachedStatsGet("/negative", {}, 60_000);
  assert((first as { error?: string }).error === "HTTP 503", "error upstream dikembalikan apa adanya");
  assert((second as { error?: string }).error === "HTTP 503", "error kedua datang dari cache");
  assert(calls === 1, `upstream yang rusak tidak dipukul ulang (nyata: ${calls} fetch)`);

  // 4. Abort tidak di-cache sebagai error, dan tidak meninggalkan promise basi di dedupe map.
  mode = "abort";
  calls = 0;
  let threw = false;
  try {
    await cachedStatsGet("/aborted", {}, 60_000);
  } catch {
    threw = true;
  }
  assert(threw, "abort melempar error ke pemanggil (tidak ditelan)");

  mode = "ok";
  calls = 0;
  const afterAbort = await cachedStatsGet("/aborted", {}, 60_000);
  assert(calls === 1, "abort tidak tertinggal di cache — request sehat berikutnya fetch ulang");
  assert(
    (afterAbort as { data?: Array<{ id: number }> }).data?.[0]?.id === 1,
    "request sehat setelah abort dapat data asli"
  );

  // 5. Pemanggil ber-signal tidak ikut dedupe.
  calls = 0;
  await Promise.all(
    Array.from({ length: 3 }, () => {
      const c = new AbortController();
      return cachedStatsGet("/with-signal", { b: "1" }, 60_000, c.signal);
    })
  );
  assert(calls === 3, `pemanggil ber-signal fetch sendiri-sendiri (nyata: ${calls})`);

  globalThis.fetch = realFetch;
  console.log(`\n${passed} lulus, ${failed} gagal`);
  if (failed > 0) {
    console.error("=== ADA YANG GAGAL ===");
    process.exit(1);
  }
  console.log("=== SEMUA PENGUJIAN STATS CACHE LOLOS ===");
}

void main();
