"use client";
/**
 * CREST — slot logo tetap (Addendum Jadwal per Liga): logo kompetisi
 * 24 px di header grup, crest tim 20 px di baris laga. URL kosong ATAU
 * gagal muat → monogram nama di slot yang sama persis (object-fit:
 * contain, lazy di bawah layar), jadi baris tidak pernah bergeser.
 * alt="" karena nama selalu tampil di samping crest (dekoratif).
 */
import { useState } from "react";
import { monogram } from "@/lib/web/monogram";

export default function Crest({
  url,
  nama,
  ukuran = 20,
}: {
  url: string | null;
  nama: string;
  ukuran?: 20 | 24 | 28;
}) {
  const [gagal, setGagal] = useState(false);
  const px = `${ukuran}px`;
  if (url && !gagal) {
    return (
      <span
        aria-hidden="true"
        className="inline-flex flex-none items-center justify-center"
        style={{ width: px, height: px }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- URL logo dari pemetaan lokal; next/image menuntut allowlist host */}
        <img
          src={url}
          alt=""
          loading="lazy"
          onError={() => setGagal(true)}
          className="max-h-full max-w-full object-contain"
        />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="inline-flex flex-none items-center justify-center rounded-full bg-surface-alt font-display font-semibold text-faint"
      style={{
        width: px,
        height: px,
        fontSize: ukuran === 28 ? "11px" : ukuran === 24 ? "10px" : "9px",
        letterSpacing: "0.02em",
      }}
    >
      {monogram(nama)}
    </span>
  );
}
