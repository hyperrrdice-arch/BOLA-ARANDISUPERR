/**
 * Rate limiter fixed-window in-memory untuk route publik (/api/agent, /api/betting).
 *
 * ponytail: ceiling = state per-instance di memori (hilang tiap deploy, tidak adil
 * antar-replica). Upgrade path: shared store (Redis) + real auth via x-api-key atau session.
 */
const buckets = new Map<string, { count: number; windowStart: number }>();

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { ok: boolean; retryAfterSec?: number } {
  const now = Date.now();
  // Prune window yang sudah lewat biar Map tidak bengkak
  for (const [k, v] of buckets) {
    if (now - v.windowStart >= windowMs) buckets.delete(k);
  }
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { ok: true };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000)),
    };
  }
  return { ok: true };
}

/** Identitas klien dari header proxy (IP pertama), fallback ke bucket "unknown". */
export function clientKeyFromReq(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown").slice(0, 64);
}

export function tooManyResponse(retryAfterSec?: number): Response {
  const sec = retryAfterSec ?? 60;
  return Response.json(
    { error: "Terlalu banyak permintaan. Coba lagi beberapa saat lagi.", retryAfterSec: sec },
    { status: 429, headers: { "Retry-After": String(sec) } }
  );
}
