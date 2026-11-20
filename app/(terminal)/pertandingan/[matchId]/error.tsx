"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Batas kegagalan LOKAL segmen detail (butir review 1): satu payload
 * aneh tidak boleh menjatuhkan seluruh halaman ke layar galat global
 * ("This page couldn't load"). Fallback ini tampil di dalam kerangka
 * terminal, menyatakan laga ini saja yang gagal, dan memberi jalan
 * kembali ke jadwal.
 */
export default function DetailError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div>
      <Link
        href="/pertandingan"
        className="text-sm text-mid-gray transition-colors hover:text-ink"
      >
        ← Jadwal pertandingan
      </Link>
      <div className="py-16 text-center">
        <p className="text-[17px] font-medium text-ink">Analisis laga ini gagal dimuat</p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-mid-gray">
          Data laga ini tidak bisa ditampilkan saat ini. Laga lain di jadwal tidak
          terpengaruh.
        </p>
        <p className="mt-6 flex items-center justify-center gap-6">
          <button
            type="button"
            onClick={() => retry()}
            className="text-[15px] font-medium text-ink hover:text-accent"
          >
            Coba lagi
          </button>
          <Link
            href="/pertandingan"
            className="text-[15px] font-medium text-ink hover:text-accent"
          >
            Kembali ke jadwal <span className="text-accent">→</span>
          </Link>
        </p>
      </div>
    </div>
  );
}
