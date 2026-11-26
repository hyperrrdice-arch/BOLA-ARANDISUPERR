"use client";
/**
 * GRUP LIGA (Addendum Jadwal per Liga) — kartu grup kompetisi pada
 * daftar Analisa/Jadwal: sudut ±14 px di atas panel #0D0D0F, header
 * berisi logo 28 px, nama liga, label negara/sumber pembeda,
 * kalibrasi (bila mode menampilkannya), jumlah laga HASIL FILTER, dan
 * chevron. Grup terbuka secara default; header adalah tombol selebar
 * grup dengan aria-expanded yang menutup grup secara independen
 * (sentuh + keyboard, fokus terlihat dari token global). Karena
 * daftar dirender server per keadaan filter, grup yang punya hasil
 * selalu mulai terbuka pada keadaan filter baru.
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
    <div className="mt-6 overflow-hidden rounded-[14px] border border-garis bg-gelap">
      <h3>
        <button
          type="button"
          aria-expanded={terbuka}
          onClick={() => setTerbuka((v) => !v)}
          className="flex min-h-11 w-full flex-wrap items-center gap-2.5 px-3 py-2 text-left sm:px-[16px]"
        >
          <Crest url={logoUrl} nama={nama} ukuran={28} />
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
      {terbuka && <div className="px-3 sm:px-[16px]">{children}</div>}
    </div>
  );
}
