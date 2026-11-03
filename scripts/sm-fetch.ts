/**
 * Helper fetch Sportmonks bersama untuk script-script sprint ekspansi DB.
 *
 * - Token HANYA dari env SPORTMONKS_API_TOKEN (tidak pernah ditulis ke file/log).
 * - Rate limit per entity dibaca dari body respons (`rate_limit.remaining`):
 *   bila sisa < 100 → tunggu sampai reset lalu lanjut (bukan exit), supaya
 *   tarikan panjang bisa ditinggal jalan. 429 → tunggu 60 dtk, maks 5 kali.
 * - Pacing dasar 120 ms antar panggilan (pola scripts/sync-sportmonks-fixtures.ts).
 */
export const SM_BASE = "https://api.sportmonks.com/v3/football";
export const SM_ROOT = "https://api.sportmonks.com/v3";

const TOKEN = process.env.SPORTMONKS_API_TOKEN ?? "";
if (!TOKEN) {
  console.error("SPORTMONKS_API_TOKEN belum di-set. Berhenti.");
  process.exit(1);
}

export interface SmPage<T> {
  data: T[];
  pagination?: { has_more?: boolean; current_page?: number; count?: number };
  rate_limit?: { remaining?: number; resets_in_seconds?: number; requested_entity?: string };
  message?: string;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let lastRemaining: number | null = null;
export function smLastRemaining(): number | null {
  return lastRemaining;
}

export async function smGet<T>(path: string): Promise<SmPage<T>> {
  const url = path.startsWith("http") ? path : `${SM_BASE}${path}`;
  let waits = 0;
  let netFails = 0;
  for (;;) {
    let res: Response;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 60_000);
      try {
        res = await fetch(url, {
          headers: { Authorization: TOKEN, Accept: "application/json" },
          signal: ctl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      // Timeout / socket basi: undici bisa menggantung di koneksi idle yang
      // sudah ditutup server — mundur lalu ulangi dengan koneksi baru.
      netFails += 1;
      if (netFails > 5) throw e;
      const waitS = 5 * netFails;
      console.warn(`  fetch gagal (${e instanceof Error ? e.name : e}) pada ${path} — retry ${waitS} dtk (${netFails}/5)`);
      await sleep(waitS * 1000);
      continue;
    }
    if (res.status === 429) {
      waits += 1;
      if (waits > 5) throw new Error(`429 berulang pada ${path}`);
      console.warn(`  429 pada ${path} — tunggu 60 dtk (percobaan ${waits}/5)`);
      await sleep(60_000);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} pada ${path}`);
    const body = (await res.json()) as SmPage<T>;
    const sisa = body.rate_limit?.remaining;
    if (typeof sisa === "number") {
      lastRemaining = sisa;
      if (sisa < 100) {
        const reset = body.rate_limit?.resets_in_seconds ?? 3600;
        console.warn(
          `  Kuota entity ${body.rate_limit?.requested_entity ?? "?"} sisa ${sisa} — tunggu reset ${reset}s`,
        );
        await sleep(Math.min(reset + 5, 3700) * 1000);
      }
    }
    await sleep(120);
    return body;
  }
}

export async function smGetAllPages<T>(pathNoPage: string, perPage = 100): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  for (;;) {
    const sep = pathNoPage.includes("?") ? "&" : "?";
    const body = await smGet<T>(`${pathNoPage}${sep}per_page=${perPage}&page=${page}`);
    out.push(...body.data);
    if (!body.pagination?.has_more) break;
    page += 1;
  }
  return out;
}
