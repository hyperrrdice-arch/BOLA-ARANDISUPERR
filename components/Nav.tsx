/**
 * KEPALA HALAMAN + NAVIGASI BAWAH (brief redesain §2, lembar acuan 1–2).
 * Desktop: wordmark "Bola." (Barlow Condensed tebal miring, titik
 * jingga) di kiri, empat tautan di sebelahnya, aksi "Cari tim" di kanan
 * menuju kolom pencarian Jadwal. Ponsel: wordmark + cari di atas, empat
 * tujuan tetap di bawah (NavClient). Garis halus menutup kepala.
 */
import { Suspense } from "react";
import Link from "next/link";
import NavClient, { BottomNavClient, BottomNavStatic, NavStatic } from "./NavClient";

export function Wordmark() {
  return (
    <Link
      href="/"
      aria-label="Bola — beranda"
      className="font-display inline-flex min-h-[44px] items-center text-[30px] leading-none font-bold tracking-[0.01em] text-tinta italic"
    >
      Bola<span className="text-jingga not-italic">.</span>
    </Link>
  );
}

function CariTim() {
  return (
    <Link
      href="/pertandingan"
      className="ml-auto inline-flex min-h-[44px] items-center gap-2 text-[15px] whitespace-nowrap text-sekunder transition-colors duration-150 hover:text-tinta"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-[18px] w-[18px]"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      >
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="M15.5 15.5 21 21" />
      </svg>
      Cari tim
    </Link>
  );
}

export function TopBar() {
  return (
    <>
      <header className="border-b border-garis">
        <div className="mx-auto flex w-full max-w-[1240px] items-center gap-5 px-4 min-[600px]:px-6 md:gap-9 lg:px-8">
          <Wordmark />
          <Suspense fallback={<NavStatic />}>
            <NavClient />
          </Suspense>
          <CariTim />
        </div>
      </header>
      <Suspense fallback={<BottomNavStatic />}>
        <BottomNavClient />
      </Suspense>
    </>
  );
}
