/**
 * FETCH API TheStatsAPI — pola standar semua script bakar sesi ini
 * (tasks/plan-data-coverage.md Task 2):
 *
 *   (a) dedupe vault: `resource_id` dicek sebelum hit API — request sama tidak 2×
 *   (b) retry gigih: 429/5xx/timeout/network → backoff + retry, JANGAN skip diam-diam
 *   (c) budget: tiap percobaan HTTP dicatat; `guardBudget` stop bersih saat sisa tipis
 *   (d) 404 = data memang tidak ada → return null (bukan error, jangan diimputasi)
 */
import { getRawPayload, saveRawPayload } from "./db/thestats-vault";
import { recordRequests, guardBudget, recordQuotaRemaining } from "./api-budget";

const API_BASE = "https://api.thestatsapi.com/api";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Pacing adaptif — LIMIT NYATA 12 request/menit (dari header x-ratelimit-limit) ──
// Asumsi lama 120/menit salah → 429 di mana-mana. Pacing 5s (+1s jeda di script)
// ≈ 9-10/menit, di bawah limit. 429 → jarak membesar; sukses → mengecil pelan (AIMD).
const BASE_GAP_MS = 5000;
let adaptiveGapMs = BASE_GAP_MS;
let nextAllowedAt = 0;

async function pace(): Promise<void> {
  const wait = nextAllowedAt - Date.now();
  if (wait > 0) await sleep(wait);
  // Jitter ±15% supaya tidak nempel di batas jendela rate limit.
  nextAllowedAt = Date.now() + Math.round(adaptiveGapMs * (0.9 + Math.random() * 0.3));
}

export interface StatsFetchOpts {
  /** Umur cache vault. `undefined` = pakai cache apa adanya (tanpa batas). */
  maxAgeMs?: number;
  /** Ambang sisa budget sebelum fetch (default 100). */
  minRemaining?: number;
  /** Maksimum percobaan HTTP (default 5). */
  retries?: number;
  /** Override API base (untuk uji degradasi offline). */
  apiBase?: string;
}

/**
 * GET dengan vault-dedupe + retry. Return null HANYA untuk 404 (data absen).
 * Setelah retry habis → throw (biar gagalnya keras, bukan dataset bolong diam-diam).
 */
export async function statsFetch<T = any>(
  path: string,
  params: Record<string, string | number> | null,
  resourceId: string,
  endpointType: string,
  opts: StatsFetchOpts = {}
): Promise<T | null> {
  const cached = getRawPayload<T>(resourceId, opts.maxAgeMs);
  if (cached) return cached;

  const apiKey = process.env.STATS_API_KEY;
  if (!apiKey) throw new Error("STATS_API_KEY tidak ada di .env.local");

  const base = opts.apiBase ?? API_BASE;
  const qs = params
    ? "?" + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")
    : "";
  const url = `${base}${path}${qs}`;
  const maxRetries = opts.retries ?? 8;
  let lastErr = "";

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    guardBudget(opts.minRemaining ?? 100);
    recordRequests(1);
    await pace();
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30_000),
      });

      // Sinkron sisa kuota bulanan dari header (kebenaran utama budget).
      const quotaRem = res.headers.get("x-monthly-quota-remaining");
      if (quotaRem) recordQuotaRemaining(Number(quotaRem));

      if (res.status === 404) return null; // data memang tidak ada — jangan dikarang
      if (res.status === 429) {
        // Rate limit: hormati header reset + jarak adaptif membesar — jangan skip.
        adaptiveGapMs = Math.min(60_000, Math.round(adaptiveGapMs * 1.6));
        const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0);
        const waitUntilReset = reset > 0 ? Math.max(0, reset * 1000 - Date.now() + 1500) : 0;
        const waitMs = Math.max(waitUntilReset, Math.min(60_000, 3000 * 2 ** (attempt - 1)));
        lastErr = "HTTP 429 rate limit";
        console.warn(`⚠️ 429 ${path} — tunggu ${Math.round(waitMs / 1000)}s (percobaan ${attempt}/${maxRetries})`);
        await sleep(waitMs);
        continue;
      }
      if (!res.ok) {
        lastErr = `HTTP ${res.status}`;
        if (res.status >= 500) {
          const waitMs = Math.min(24_000, 1500 * 2 ** (attempt - 1));
          console.warn(`⚠️ ${lastErr} ${path} — retry dalam ${waitMs}ms (percobaan ${attempt}/${maxRetries})`);
          await sleep(waitMs);
          continue;
        }
        const body = await res.text().catch(() => "");
        // 401/403 = kunci ditolak / langganan mati (terbukti 2026-10-18: KEY_REVOKED
        // "API key has no active subscription plan"). Ini permanen — retry tidak berguna,
        // dan setelah masa(key) habis tidak ada jalur data online sama sekali.
        if (res.status === 401 || res.status === 403) {
          throw new Error(
            `[statsFetch] AKSES API MATI (HTTP ${res.status}) — ${path}: ${body.slice(0, 200)}\n` +
              `  Kunci ditolak / langganan berakhir. Tidak ada request yang bisa dicoba lagi; ` +
              `lanjutkan dari vault (data yang sudah ditarik tetap utuh).`
          );
        }
        throw new Error(`[statsFetch] ${path} ditolak permanen: ${lastErr} ${body.slice(0, 200)}`);
      }

      const json = (await res.json()) as T;
      saveRawPayload(endpointType, resourceId, json);
      adaptiveGapMs = Math.max(BASE_GAP_MS, Math.round(adaptiveGapMs * 0.9)); // sukses → longgar lagi pelan
      return json;
    } catch (err: any) {
      if (err?.message?.startsWith("[statsFetch]")) throw err; // 4xx non-404: bug kita, jangan di-retry
      lastErr = err?.message ?? String(err);
      const waitMs = Math.min(24_000, 1500 * 2 ** (attempt - 1));
      console.warn(`⚠️ network/timeout ${path}: ${lastErr} — retry dalam ${waitMs}ms (${attempt}/${maxRetries})`);
      await sleep(waitMs);
    }
  }
  throw new Error(`[statsFetch] ${path} gagal setelah ${maxRetries} percobaan (terakhir: ${lastErr})`);
}
