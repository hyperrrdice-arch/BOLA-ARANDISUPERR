/**
 * TIMING RUTE — log durasi request ringan untuk observabilitas (opsi 6
 * diagnosis hang 2026-11-23; brief stabilisasi 2026-11-24).
 *
 * Satu baris per request yang terpilih, tag `[timing]`, ke stdout
 * (tertangkap journald dari service app):
 *
 *   [timing] ts=<ISO> route=<templat> status=<kode> dur_ms=<angka>
 *
 * Aturan volume (terkendali):
 * - Request lambat SELALU dicatat: dur_ms >= TIMING_SLOW_MS
 *   (env, baku 2000).
 * - Request normal dicatat sebagai sampel 1 dari TIMING_SAMPLE_N
 *   penyelesaian rute (env, baku 100; nilai <= 1 = catat semua).
 * - Error server dicatat selalu lewat catatRuteError (dari
 *   instrumentation onRequestError) dengan dur_ms=- karena titik
 *   mulai request tidak tersedia di jalur itu.
 *
 * Yang dicatat HANYA templat rute (mis. /pertandingan/[matchId]) —
 * tidak pernah path mentah, nilai parameter, atau query string.
 *
 * Makna dur_ms pada baris rute: dari awal render komponen konten
 * per-request (sesudah connection() terselesaikan) sampai respons
 * selesai terkirim (diukur di callback after() Next). Ia mencakup
 * seluruh fase baca data + render + streaming respons; ia TIDAK
 * mencakup waktu antre/routing sebelum render dimulai (umumnya
 * milidetik) dan tidak mencakup transfer jaringan ke klien.
 *
 * Durasi SQLite per request TIDAK dicatat: query berjalan sinkron di
 * dalam fase render yang sama dan tidak ada titik ukur bersih tanpa
 * mengubah lapisan data; durasi total + delay event loop (lihat
 * instrumentation-node.ts) adalah dua sinyal yang dipakai untuk
 * membedakan stall I/O dari beban komputasi.
 */
import { after } from "next/server";

const g = globalThis as unknown as { __timingHitungan?: number };

function envAngka(nama: string, baku: number): number {
  const mentah = process.env[nama];
  if (!mentah) return baku;
  const n = Number(mentah);
  return Number.isFinite(n) && n >= 0 ? n : baku;
}

/** Keputusan log murni (dapat diuji): lambat selalu; normal per sampel. */
export function perluLog(
  durMs: number,
  slowMs: number,
  sampleN: number,
  hitungan: number,
): boolean {
  if (durMs >= slowMs) return true;
  if (sampleN <= 1) return true;
  return hitungan % sampleN === 0;
}

/** Format satu baris log timing (murni, dapat diuji). */
export function formatBarisTiming(
  tsIso: string,
  templat: string,
  status: number,
  durMs: number | null,
): string {
  return `[timing] ts=${tsIso} route=${templat} status=${status} dur_ms=${durMs === null ? "-" : durMs}`;
}

/**
 * Normalisasi routePath dari konteks onRequestError menjadi templat
 * rute URL: segmen grup rute "(nama)" dibuang, segmen dinamis "[...]"
 * dipertahankan. Contoh: "/(terminal)/pertandingan/[matchId]" ->
 * "/pertandingan/[matchId]".
 */
export function normalisasiTemplatRute(routePath: string): string {
  const segmen = routePath
    .split("/")
    .filter((s) => s.length > 0 && !(s.startsWith("(") && s.endsWith(")")));
  return "/" + segmen.join("/");
}

/** Titik mulai pengukuran di komponen konten per-request. */
export function mulaiTimerRute(): number {
  return Date.now();
}

/**
 * Daftarkan pencatatan akhir rute: dipanggil di ujung komponen konten
 * SESUDAH data berhasil dimuat (bila render melempar sebelum titik
 * ini, tidak ada baris status=200 palsu — errornya dicatat jalur
 * onRequestError). Callback after() berjalan sesudah respons selesai.
 */
export function selesaikanTimerRute(templat: string, t0: number, status = 200): void {
  after(() => {
    const durMs = Date.now() - t0;
    g.__timingHitungan = (g.__timingHitungan ?? 0) + 1;
    const slowMs = envAngka("TIMING_SLOW_MS", 2000);
    const sampleN = envAngka("TIMING_SAMPLE_N", 100);
    if (perluLog(durMs, slowMs, sampleN, g.__timingHitungan)) {
      console.log(formatBarisTiming(new Date().toISOString(), templat, status, durMs));
    }
  });
}

/** Catatan error server (selalu dicatat; durasi tak tersedia di jalur ini). */
export function catatRuteError(templat: string, digest?: string): void {
  const dasar = formatBarisTiming(new Date().toISOString(), templat, 500, null);
  console.log(digest ? `${dasar} digest=${digest}` : dasar);
}
