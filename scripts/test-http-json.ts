/**
 * RUNNABLE CHECK — helper respons JSON terkompresi (`lib/http-json.ts`).
 * Tanpa jaringan: bikin `Request` sintetis, cek header + isi yang benar-benar dikirim.
 *
 * Yang dibuktikan:
 *  - payload besar + client nerima gzip  → Content-Encoding: gzip, isi tetap identik setelah di-inflate
 *  - tanpa Accept-Encoding / tanpa gzip   → JSON polos (curl tanpa --compressed tetap bisa baca)
 *  - payload kecil                        → tidak dikompresi (ambang 1 KB)
 *  - status + header tambahan tidak hilang, Vary diisi Accept-Encoding
 *
 * Jalankan: npx tsx scripts/test-http-json.ts
 */
import { gunzipSync } from "node:zlib";
import { jsonResponse } from "../lib/http-json";

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

function reqWith(acceptEncoding?: string): Request {
  const headers = new Headers();
  if (acceptEncoding) headers.set("Accept-Encoding", acceptEncoding);
  return new Request("http://localhost/api/test", { headers });
}

async function main() {
  console.log("=== TEST http-json (kompresi respons) ===\n");
  const big = { matches: Array.from({ length: 60 }, (_, i) => ({ id: `mt_${i}`, name: `Tim ${i}` })) };

  // 1. gzip diminta + payload besar → dikompresi, isi utuh
  const gz = jsonResponse(reqWith("gzip, deflate, br"), big);
  assert(gz.headers.get("content-encoding") === "gzip", "Accept-Encoding gzip → Content-Encoding: gzip");
  assert(gz.headers.get("content-type")?.includes("application/json") === true, "Content-Type JSON");
  const rawBuf = Buffer.from(await gz.arrayBuffer());
  const inflated = gunzipSync(rawBuf).toString("utf8");
  assert(JSON.stringify(JSON.parse(inflated)) === JSON.stringify(big), "isi setelah inflate identik dengan aslinya");
  assert(rawBuf.length < JSON.stringify(big).length, `payload gzip lebih kecil (${rawBuf.length} < ${JSON.stringify(big).length})`);

  // 2. tanpa Accept-Encoding (mis. curl biasa) → polos
  const plain = jsonResponse(reqWith(), big);
  assert(plain.headers.get("content-encoding") === null, "tanpa Accept-Encoding → tidak dikompresi");
  assert(JSON.stringify(JSON.parse(await plain.text())) === JSON.stringify(big), "JSON polos tetap terbaca");

  // 3. Accept-Encoding tanpa gzip → polos
  const brOnly = jsonResponse(reqWith("br"), big);
  assert(brOnly.headers.get("content-encoding") === null, "hanya 'br' (tanpa gzip) → tidak dikompresi");

  // 4. ambang ukuran: payload kecil → polos walau gzip diminta
  const small = jsonResponse(reqWith("gzip"), { error: "kecil" });
  assert(small.headers.get("content-encoding") === null, "payload < 1 KB → tidak dikompresi (overhead tak sepadan)");

  // 5. status + header tambahan dipertahankan, Vary diisi
  const five = jsonResponse(reqWith("gzip"), big, {
    status: 500,
    headers: { "x-analysis-cache": "miss" },
  });
  assert(five.status === 500, "status custom dipertahankan");
  assert(five.headers.get("x-analysis-cache") === "miss", "header tambahan dipertahankan");
  assert(five.headers.get("vary")?.includes("Accept-Encoding") === true, "Vary: Accept-Encoding diisi");

  // 6. null/undefined tidak meledak
  const nul = jsonResponse(reqWith(), null);
  assert((await nul.text()) === "null", "body null tetap valid JSON");

  console.log(`\n${passed} lulus, ${failed} gagal`);
  if (failed > 0) {
    console.error("=== ADA YANG GAGAL ===");
    process.exit(1);
  }
  console.log("=== SEMUA PENGUJIAN http-json LOLOS ===");
}

void main();
