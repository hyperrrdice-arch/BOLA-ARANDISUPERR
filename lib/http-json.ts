import { gzipSync } from "node:zlib";

/**
 * Response JSON dengan gzip manual.
 *
 * Kenapa manual: di setup ini route handler TIDAK dikompresi server. Terukur
 * `/api/matches` terkirim 36 KB utuh tanpa `Content-Encoding` (rasio transfer/resource
 * 1.01) sementara chunk JS di app yang sama `Content-Encoding: gzip`. Lighthouse
 * memperkirakan 30 KB terbuang per load katalog; Chrome DevTools mengonfirmasi
 * header-nya dari sisi browser.
 *
 * Aturan yang dijaga di sini:
 * - `Accept-Encoding` dihormati: client tanpa gzip dapat JSON polos (curl tanpa
 *   `--compressed` juga).
 * - Payload kecil (< 1 KB) tidak dikompresi — bukan penghematan, hanya overhead.
 * - `Vary: Accept-Encoding` supaya cache/proxy tidak menyajikan gzip ke client
 *   yang tidak memintanya.
 */
const MIN_COMPRESS_BYTES = 1024;

export function jsonResponse(
  req: Request,
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> }
): Response {
  const payload = JSON.stringify(body ?? null);
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");

  const existingVary = headers.get("Vary");
  headers.set(
    "Vary",
    existingVary && !existingVary.includes("Accept-Encoding")
      ? `${existingVary}, Accept-Encoding`
      : "Accept-Encoding"
  );

  const acceptsGzip = (req.headers.get("accept-encoding") ?? "").includes("gzip");
  if (!acceptsGzip || payload.length < MIN_COMPRESS_BYTES) {
    return new Response(payload, { status: init?.status ?? 200, headers });
  }

  headers.set("Content-Encoding", "gzip");
  return new Response(gzipSync(payload), { status: init?.status ?? 200, headers });
}
