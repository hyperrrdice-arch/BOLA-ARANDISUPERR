"use client";
/**
 * GRUP LIGA (Addendum Jadwal per Liga) — header grup kompetisi Jadwal:
 * logo 24 px, nama liga, label negara/sumber pembeda, kalibrasi (bila
 * ada), jumlah laga HASIL FILTER, chevron. Grup terbuka secara default;
 * header adalah tombol selebar grup dengan aria-expanded yang menutup
 * grup secara independen (sentuh + keyboard, fokus terlihat dari token
 * global). Karena daftar dirender server per keadaan filter, grup yang
 * punya hasil selalu mulai terbuka pada keadaan filter baru.
 */
import { useState, type ReactNode } from "react";
import Crest from "@/components/laga/Crest";

export default function GrupLiga({
  logoUrl,
  nama,
  negara,
  sumber,
  jumlah,
  kalibrasi,
  children,
}: {
  logoUrl: string | null;
  nama: string;
  negara: string | null;
  sumber: string | null;
  /** Jumlah laga grup SESUDAH filter aktif. */
  jumlah: number;
  /** Node status kalibrasi (GateStatus + label) bila grup punya data gerbang. */
  kalibrasi?: ReactNode;
  children: ReactNode;
}) {
  const [terbuka, setTerbuka] = useState(true);
  return (
    <div className="mt-8">
      <h3>
        <button
          type="button"
          aria-expanded={terbuka}
          onClick={() => setTerbuka((v) => !v)}
          className="flex min-h-11 w-full flex-wrap items-center gap-2.5 rounded-md border border-hairline bg-paper px-3 py-2 text-left"
        >
          <Crest url={logoUrl} nama={nama} ukuran={24} />
          <span className="font-display text-[17px] font-semibold text-ink">{nama}</span>
          {negara && <span className="text-[13px] text-faint">{negara}</span>}
          {sumber && (
            <span className="text-[13px] text-faint">· Sumber: {sumber}</span>
          )}
          {kalibrasi}
          <span className="ml-auto flex items-center gap-2">
            <span className="text-[13px] whitespace-nowrap text-mid-gray tabular-nums">
              {jumlah} laga
            </span>
            <span
              aria-hidden="true"
              className="inline-block text-faint transition-transform duration-[var(--duration-micro)]"
              style={{ transform: terbuka ? "rotate(0deg)" : "rotate(-90deg)" }}
            >
              ▾
            </span>
          </span>
        </button>
      </h3>
      {terbuka && <div>{children}</div>}
    </div>
  );
}
