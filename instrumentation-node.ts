/**
 * MONITOR DELAY EVENT LOOP — hanya Node.js, dimuat register() dari
 * instrumentation.ts (brief stabilisasi 2026-11-24, opsi 6).
 *
 * Kenapa diukur: query SQLite sinkron (node:sqlite DatabaseSync) dan
 * stall I/O menahan event loop yang sama dengan yang melayani
 * /healthz dan semua rute. Delay event loop yang besar bersamaan
 * dengan dur_ms rute yang besar = event loop tertahan (I/O / kerja
 * sinkron), bukan sekadar satu query lambat di proses lain.
 *
 * Aturan volume: histogram monitorEventLoopDelay direset tiap 30
 * detik; SATU baris ringkasan [timing] ditulis HANYA bila delay
 * maksimum pada jendela itu >= TIMING_ELD_MAX_MS (env, baku 1000):
 *
 *   [timing] ts=<ISO> eventloop mean_ms=<n> p95_ms=<n> max_ms=<n> window_s=30
 *
 * Semua angka dalam milidetik: mean = rata-rata delay penjadwalan
 * timer pada jendela, p95 = persentil 95, max = delay terburuk.
 * Kegagalan memuat monitor tidak boleh menggagalkan startup server:
 * seluruh blok dibungkus try/catch dan interval di-unref.
 */
import { monitorEventLoopDelay } from "node:perf_hooks";

const g = globalThis as unknown as { __timingEldAktif?: boolean };

function envAngka(nama: string, baku: number): number {
  const mentah = process.env[nama];
  if (!mentah) return baku;
  const n = Number(mentah);
  return Number.isFinite(n) && n >= 0 ? n : baku;
}

try {
  if (!g.__timingEldAktif && process.env.NEXT_PHASE !== "phase-production-build") {
    g.__timingEldAktif = true;
    const ambangMaxMs = envAngka("TIMING_ELD_MAX_MS", 1000);
    const histogram = monitorEventLoopDelay({ resolution: 20 });
    histogram.enable();
    const timer = setInterval(() => {
      const maxMs = histogram.max / 1e6;
      if (Number.isFinite(maxMs) && maxMs >= ambangMaxMs) {
        const meanMs = histogram.mean / 1e6;
        const p95Ms = histogram.percentile(95) / 1e6;
        console.log(
          `[timing] ts=${new Date().toISOString()} eventloop mean_ms=${meanMs.toFixed(1)} ` +
            `p95_ms=${p95Ms.toFixed(1)} max_ms=${maxMs.toFixed(1)} window_s=30`,
        );
      }
      histogram.reset();
    }, 30_000);
    timer.unref();
  }
} catch {
  // Monitor bersifat tambahan; server harus tetap naik tanpanya.
}
