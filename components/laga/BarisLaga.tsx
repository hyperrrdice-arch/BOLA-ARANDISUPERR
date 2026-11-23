/**
 * BARIS LAGA BERSAMA (Addendum Jadwal per Liga) — satu pola baris untuk
 * Jadwal dan daftar singkat Beranda: jam di kiri; dua tim dua baris
 * (crest 20 px + nama membungkus utuh di tengah, skor sejajar kanan
 * HANYA saat datanya ada, termasuk 0–0 yang sah); status/peluang/kelas
 * turun ke baris metadata di bawah nama. Seluruh laga = satu tautan.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import Crest from "./Crest";

export interface BarisLagaProps {
  href: string;
  ariaLabel: string;
  /** Jam tampil pada zona aktif, mis. "20.00". */
  jam: string;
  home: string;
  away: string;
  logoHome: string | null;
  logoAway: string | null;
  /** Skor per tim; null = belum ada data skor → kolom skor tidak dirender. */
  skor: { home: number; away: number } | null;
  /** Label status Indonesia (Terjadwal/Ditunda/Menunggu pembaruan/Selesai/…); null = jangan tampilkan. */
  statusLabel: string | null;
  /** Isi baris metadata di bawah dua baris tim (pasar/peluang/kelas, label liga, keterangan tunda). */
  meta?: ReactNode;
  /** Rel kanan baris tim (peluang+kelas di Jadwal, chevron di Beranda). */
  kanan?: ReactNode;
}

export default function BarisLaga({
  href,
  ariaLabel,
  jam,
  home,
  away,
  logoHome,
  logoAway,
  skor,
  statusLabel,
  meta,
  kanan,
}: BarisLagaProps) {
  const barisTim = (nama: string, logo: string | null, gol: number | null) => (
    <span className="flex items-center gap-2">
      <Crest url={logo} nama={nama} ukuran={20} />
      <span className="min-w-0 flex-1 text-[17px] leading-snug font-medium break-words text-ink">
        {nama}
      </span>
      {skor && (
        <span className="w-6 flex-none text-right text-[17px] font-semibold text-ink tabular-nums">
          {gol}
        </span>
      )}
    </span>
  );
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className="block transition-colors hover:bg-surface-alt/40"
    >
      <span className="flex items-start gap-[16px] sm:gap-6">
        <span className="w-[3.5rem] flex-none pt-0.5 text-sm whitespace-nowrap text-mid-gray tabular-nums">
          {jam}
        </span>
        <span className="min-w-0 flex-1">
          {barisTim(home, logoHome, skor ? skor.home : null)}
          <span className="mt-1 block">{barisTim(away, logoAway, skor ? skor.away : null)}</span>
        </span>
        {kanan}
      </span>
      {(statusLabel || meta) && (
        <span className="mt-1.5 block pl-[72px] text-[13px] text-mid-gray sm:pl-[80px]">
          {statusLabel && <span className="block font-medium">{statusLabel}</span>}
          {meta}
        </span>
      )}
    </Link>
  );
}
