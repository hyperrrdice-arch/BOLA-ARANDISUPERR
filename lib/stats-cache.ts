/**
 * In-Memory RAM Cache for TheStatsAPI
 * Menghemat kuota request API TheStatsAPI dan memotong latensi hingga < 5ms.
 */

interface CacheRecord<T> {
  data: T;
  cachedAt: number;
  expiry: number;
  path: string;
}

interface CacheMetrics {
  hits: number;
  misses: number;
  totalEntries: number;
  hitRate: string;
  savedCalls: number;
}

// Gunakan globalThis agar cache bertahan selama proses server Next.js aktif (termasuk saat HMR dev)
const globalCache = globalThis as unknown as {
  __theStatsApiCache?: Map<string, CacheRecord<any>>;
  __theStatsApiMetrics?: { hits: number; misses: number };
};

if (!globalCache.__theStatsApiCache) {
  globalCache.__theStatsApiCache = new Map<string, CacheRecord<any>>();
}

if (!globalCache.__theStatsApiMetrics) {
  globalCache.__theStatsApiMetrics = { hits: 0, misses: 0 };
}

const memoryStore = globalCache.__theStatsApiCache;
const metrics = globalCache.__theStatsApiMetrics;

/** Dedupe fetch yang sedang jalan per key (hanya untuk pemanggil tanpa signal). */
const inFlight = new Map<string, Promise<any>>();

/**
 * TTL untuk response error upstream. Sengaja pendek: cukup untuk menahan hujan
 * request saat TheStatsAPI sedang rusak, tapi tidak menahan data bagus kelamaan.
 */
const NEGATIVE_TTL_MS = Math.max(1000, Number(process.env.STATS_NEGATIVE_TTL_MS) || 30_000);

const API_BASE = "https://api.thestatsapi.com/api";

function buildCacheKey(path: string, params: Record<string, any> = {}): string {
  const sortedKeys = Object.keys(params).sort();
  const queryStr = sortedKeys
    .filter((k) => params[k] !== undefined && params[k] !== null)
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return `statsapi:${path}?${queryStr}`;
}

/**
 * Fetch TheStatsAPI dengan in-memory cache otomatis
 * @param path Endpoint path, misalnya "/football/matches" atau "/football/matches/123/stats"
 * @param params Query parameters
 * @param ttlMs Time to live dalam milidetik (Default: 30 menit)
 * @param signal AbortSignal request pemanggil — abort membatalkan fetch upstream (plan-perf Task 3)
 */
export async function cachedStatsGet<T = any>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
  ttlMs: number = 30 * 60 * 1000,
  signal?: AbortSignal
): Promise<T> {
  const key = buildCacheKey(path, params);
  const now = Date.now();

  // 1. Cek Memory Cache
  const cached = memoryStore.get(key);
  if (cached && now < cached.expiry) {
    metrics.hits += 1;
    const remainingSec = Math.round((cached.expiry - now) / 1000);
    if (process.env.PIPELINE_DEBUG) {
      console.log(
        `[TheStatsAPI Cache] 🟢 HIT: ${path} (Tersisa ${remainingSec}s, Quota dihemat: ${metrics.hits})`
      );
    }
    return cached.data as T;
  }

  // 2. Dedupe: N pemanggil bersamaan pada key dingin = 1 fetch upstream.
  // ponytail: hanya untuk pemanggil TANPA signal — abort milik satu client tidak boleh
  // membunuh fetch milik client lain yang sedang berbagi promise. Upgrade: ref-count per key.
  if (!signal) {
    const pending = inFlight.get(key);
    if (pending) return pending as Promise<T>;
    const request = loadFromUpstream<T>(path, params, ttlMs, key);
    inFlight.set(key, request);
    void request.then(
      () => inFlight.delete(key),
      () => inFlight.delete(key)
    );
    return request;
  }

  return loadFromUpstream<T>(path, params, ttlMs, key, signal);
}

/**
 * Fetch sebenarnya ke TheStatsAPI + tulis cache.
 * Response error di-cache singkat (negative caching) supaya upstream yang sedang rusak
 * tidak dipukul ulang tiap request. Throw (termasuk abort) TIDAK pernah di-cache.
 */
async function loadFromUpstream<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  ttlMs: number,
  key: string,
  signal?: AbortSignal
): Promise<T> {
  // 3. Cache Miss atau Expired: Lakukan fetch ke TheStatsAPI
  metrics.misses += 1;
  if (process.env.PIPELINE_DEBUG) {
    console.log(`[TheStatsAPI Cache] 🔴 MISS: ${path} (Fetching remote API...)`);
  }

  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      url.searchParams.set(k, String(v));
    }
  }

  const apiKey = process.env.STATS_API_KEY;
  if (!apiKey) {
    throw new Error("STATS_API_KEY tidak dikonfigurasi di environment variables");
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal,
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => null);
    const errObj = {
      error: `HTTP ${res.status}`,
      code: errJson?.error?.code || "REQUEST_FAILED",
      message: errJson?.error?.message || res.statusText,
    };
    // Negative caching: tahan beban error sebentar, jangan sampai tiap request menembak upstream.
    memoryStore.set(key, {
      data: errObj as unknown as T,
      cachedAt: Date.now(),
      expiry: Date.now() + NEGATIVE_TTL_MS,
      path,
    });
    return errObj as unknown as T;
  }

  const data = await res.json();

  const safeTtl = Math.max(1000, Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : 30 * 60 * 1000);

  // 4. Simpan di Memory Cache jika fetch berhasil
  memoryStore.set(key, {
    data,
    cachedAt: Date.now(),
    expiry: Date.now() + safeTtl,
    path,
  });

  // Pembersihan pasif jika cache melebihi 1000 entri
  if (memoryStore.size > 1000) {
    pruneExpiredCache(1000);
  }

  return data as T;
}

/**
 * Hapus cache yang sudah expired untuk menjaga ukuran RAM,
 * serta lakukan eviksi FIFO jika melebihi batas ukuran maksimal.
 */
export function pruneExpiredCache(maxLimit: number = 1000): number {
  const now = Date.now();
  let deletedCount = 0;
  for (const [key, item] of memoryStore.entries()) {
    if (now >= item.expiry) {
      memoryStore.delete(key);
      deletedCount += 1;
    }
  }

  // FIFO eviction jika masih melebihi batas maksimal RAM store
  if (memoryStore.size > maxLimit) {
    const excess = memoryStore.size - maxLimit;
    let count = 0;
    for (const key of memoryStore.keys()) {
      if (count >= excess) break;
      memoryStore.delete(key);
      count += 1;
      deletedCount += 1;
    }
  }

  return deletedCount;
}

/**
 * Dapatkan statistik efisiensi cache
 */
export function getStatsCacheMetrics(): CacheMetrics {
  const total = metrics.hits + metrics.misses;
  const rate = total > 0 ? ((metrics.hits / total) * 100).toFixed(1) + "%" : "0%";
  return {
    hits: metrics.hits,
    misses: metrics.misses,
    totalEntries: memoryStore.size,
    hitRate: rate,
    savedCalls: metrics.hits,
  };
}

/**
 * Reset memory cache jika diperlukan
 */
export function clearStatsCache(): void {
  memoryStore.clear();
  metrics.hits = 0;
  metrics.misses = 0;
}
