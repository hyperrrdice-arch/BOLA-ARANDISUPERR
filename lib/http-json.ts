/**
 * Response JSON untuk route handler.
 *
 * Kompresi diserahkan ke server. Riwayat: helper ini dulu meng-gzip
 * manual karena terukur route handler tidak dikompresi server. Pada
 * tumpukan saat ini (Next 16.4.6, `next start` — perintah yang sama
 * dengan produksi) premis itu tidak lagi berlaku dan gzip manual
 * justru merusak: terukur di panggung skala verifikasi-3 pada
 * 2026-11-21 (lihat tasks/reports/verifikasi-3-pilihan-payload-report.md)
 * respons ≥ 1 KB tiba sebagai gzip(gzip(JSON)) dengan SATU header
 * `Content-Encoding: gzip`, sehingga `fetch().json()` di browser dan
 * undici melempar SyntaxError. Respons kecil (< 1 KB, tanpa gzip
 * manual) tiba dengan tepat satu lapis gzip dari server — bukti
 * server memang mengompresi route handler.
 *
 * Aturan yang dijaga di sini:
 * - Body selalu JSON polos; server menerapkan paling banyak satu
 *   lapis kompresi dan menghormati `Accept-Encoding` klien.
 * - `Vary: Accept-Encoding` dipertahankan supaya cache/proxy tidak
 *   menyajikan varian terkompresi ke client yang tidak memintanya.
 */
export function jsonResponse(
  req: Request,
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  void req; // tanda tangan dipertahankan untuk pemanggil yang ada
  const payload = JSON.stringify(body ?? null);
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");

  const existingVary = headers.get("Vary");
  const varyHasAcceptEncoding = (existingVary ?? "").toLowerCase().includes("accept-encoding");
  headers.set(
    "Vary",
    existingVary && !varyHasAcceptEncoding
      ? `${existingVary}, Accept-Encoding`
      : "Accept-Encoding",
  );

  return new Response(payload, { status: init?.status ?? 200, headers });
}
