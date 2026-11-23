/**
 * INSTRUMENTATION — titik masuk observabilitas server (brief
 * stabilisasi 2026-11-24, opsi 6 diagnosis hang).
 *
 * - register(): di runtime Node.js, muat instrumentation-node.ts
 *   (monitor delay event loop). Di runtime lain tidak melakukan apa
 *   pun — perf_hooks hanya ada di Node.js.
 * - onRequestError(): setiap error server dicatat sebagai satu baris
 *   [timing] status=500 dengan templat rute yang dinormalisasi, agar
 *   kegagalan halaman terlihat di log yang sama dengan baris durasi
 *   rute (lib/web/timing.ts) dan dapat dikorelasikan dengan log
 *   keputusan watchdog liveness.
 */
import type { Instrumentation } from "next";
import { catatRuteError, normalisasiTemplatRute } from "./lib/web/timing";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}

export const onRequestError: Instrumentation.onRequestError = (err, _request, context) => {
  const digest =
    typeof err === "object" && err !== null && "digest" in err
      ? String((err as { digest: unknown }).digest)
      : undefined;
  catatRuteError(normalisasiTemplatRute(context.routePath), digest);
};
