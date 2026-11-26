/**
 * KEPALA HALAMAN + NAVIGASI BAWAH.
 * Desktop: wordmark "Bola." (Barlow Condensed tebal miring, titik
 * jingga) di kiri, lima tautan di sebelahnya, aksi "Cari tim" di kanan
 * menuju kolom pencarian daftar yang sedang dibuka (Analisa/Jadwal).
 * Ponsel: wordmark + cari di atas (tinggi kepala ±56 px), lima tujuan
 * tetap di bawah (NavClient). Garis halus menutup kepala.
 * Beranda memakai kepala tanpa aksi cari (`denganCari={false}`):
 * hero-nya hanya berisi wordmark + navigasi global.
 */
import { Suspense } from "react";
import Link from "next/link";
import NavClient, {
  BottomNavClient,
  BottomNavStatic,
  CariTimClient,
  CariTimStatic,
  NavStatic,
} from "./NavClient";

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

export function TopBar({ denganCari = true }: { denganCari?: boolean }) {
  return (
    <>
      <header className="border-b border-garis">
        <div className="shell-x mx-auto flex w-full max-w-[1200px] items-center gap-5 py-1.5 md:gap-9">
          <Wordmark />
          <Suspense fallback={<NavStatic />}>
            <NavClient />
          </Suspense>
          {denganCari && (
            <Suspense fallback={<CariTimStatic />}>
              <CariTimClient />
            </Suspense>
          )}
        </div>
      </header>
      <Suspense fallback={<BottomNavStatic />}>
        <BottomNavClient />
      </Suspense>
    </>
  );
}
