/**
 * GET /healthz — probe liveness ringan (brief stabilisasi 2026-11-24,
 * opsi 1 diagnosis hang). Dipakai watchdog liveness lewat loopback.
 *
 * Kontrak: 200 OK, Cache-Control: no-store, body mungil. Handler ini
 * — dan seluruh graf impornya — TIDAK mengakses SQLite, file data,
 * auth eksternal, atau jaringan: satu-satunya impor adalah
 * connection() dari next/server, penanda bawaan Next agar handler
 * berjalan per request (dinamis), bukan hasil prerender statis.
 * connection() sendiri tidak membaca data apa pun; ia hanya menahan
 * handler sampai request masuk tersedia.
 *
 * Makna liveness-nya: respons membuktikan proses server hidup dan
 * event loop-nya masih melayani. Ia TIDAK membuktikan jalur data
 * sehat — kesehatan halaman dipantau terpisah lewat log [timing].
 */
import { connection } from "next/server";

export async function GET(): Promise<Response> {
  await connection();
  return new Response("ok\n", {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
