"use client";

/**
 * NAVIGASI — lima tujuan (Beranda · Analisa · Jadwal · Pilihan · Hasil)
 * pada dua permukaan dari daftar yang sama: tautan desktop di kepala
 * halaman dan navigasi bawah ponsel. Keadaan aktif memakai
 * usePathname; varian Static (tanpa hooks) adalah fallback Suspense
 * supaya shell halaman bisa prerender.
 *
 * Detail laga (/pertandingan/[matchId]) mewarisi tab asal daftarnya:
 * query `asal=analisa` membuat Analisa aktif; tanpa asal eksplisit
 * (termasuk tautan lama dari Pilihan/Hasil) Jadwal yang aktif.
 * Pembacaan query hidup di komponen ini — boundary nav yang memang
 * sudah dibungkus Suspense oleh TopBar.
 */
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export const ITEMS = [
  { href: "/", label: "Beranda" },
  { href: "/analisa", label: "Analisa" },
  { href: "/pertandingan", label: "Jadwal" },
  { href: "/pilihan", label: "Pilihan" },
  { href: "/bukti", label: "Hasil" },
];

/** Tab aktif untuk rute saat ini; tepat satu (atau null di luar lima rute). */
export function tabAktif(path: string | null, asal: string | null): string | null {
  if (!path) return null;
  if (path === "/") return "/";
  if (path === "/analisa") return "/analisa";
  if (path === "/pertandingan") return "/pertandingan";
  if (path.startsWith("/pertandingan/")) {
    return asal === "analisa" ? "/analisa" : "/pertandingan";
  }
  if (path === "/pilihan" || path.startsWith("/pilihan/")) return "/pilihan";
  if (path === "/bukti" || path.startsWith("/bukti/")) return "/bukti";
  return null;
}

function useTabAktif(): string | null {
  const path = usePathname();
  const params = useSearchParams();
  return tabAktif(path, params.get("asal"));
}

/**
 * Prefetch daftar dimatikan KHUSUS dari Beranda: hero tidak boleh
 * memicu baca daftar sebelum pengguna benar-benar berpindah (brief
 * Beranda §3). Di rute lain prefetch berjalan seperti biasa.
 */
function prefetchDaftar(path: string | null, href: string): boolean | undefined {
  if (path === "/" && (href === "/analisa" || href === "/pertandingan")) return false;
  return undefined;
}

/* ---------------------------------------------------------- desktop */

const KELAS_DESKTOP =
  "inline-flex min-h-[44px] items-center text-[15px] whitespace-nowrap transition-colors duration-[var(--duration-micro)]";

export function NavStatic() {
  return (
    <nav aria-label="Utama" className="hidden items-center gap-7 md:flex">
      {ITEMS.map((it) => (
        <Link key={it.href} href={it.href} className={`${KELAS_DESKTOP} text-sekunder hover:text-tinta`}>
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

export default function NavClient() {
  const path = usePathname();
  const aktif = useTabAktif();
  return (
    <nav aria-label="Utama" className="hidden items-center gap-7 md:flex">
      {ITEMS.map((it) => {
        const on = aktif === it.href;
        return (
          <Link
            key={it.href}
            href={it.href}
            prefetch={prefetchDaftar(path, it.href)}
            aria-current={on ? "page" : undefined}
            className={`${KELAS_DESKTOP} ${
              on
                ? "font-semibold text-tinta underline decoration-jingga decoration-[3px] underline-offset-8"
                : "text-sekunder hover:text-tinta"
            }`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}

/* ------------------------------------------------------------ ponsel */

/**
 * Navigasi bawah ponsel: lima tujuan masing-masing seperlima lebar,
 * tinggi minimal 52 px + safe-area; tujuan aktif ditandai garis jingga
 * di tepi atas selnya + aria-current.
 */
function SelBawah({
  href,
  label,
  on,
  prefetch,
}: {
  href: string;
  label: string;
  on: boolean;
  prefetch?: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      aria-current={on ? "page" : undefined}
      className={`relative flex min-h-[52px] items-center justify-center px-1 text-[13px] transition-colors duration-[var(--duration-micro)] ${
        on ? "font-semibold text-tinta" : "text-sekunder hover:text-tinta"
      }`}
    >
      {on && <span aria-hidden="true" className="absolute inset-x-3 top-0 h-[3px] bg-jingga" />}
      {label}
    </Link>
  );
}

export function BottomNavStatic() {
  return (
    <nav
      aria-label="Utama"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-garis bg-kertas md:hidden"
    >
      <div className="grid grid-cols-5 pb-[env(safe-area-inset-bottom)]">
        {ITEMS.map((it) => (
          <SelBawah key={it.href} href={it.href} label={it.label} on={false} />
        ))}
      </div>
    </nav>
  );
}

export function BottomNavClient() {
  const path = usePathname();
  const aktif = useTabAktif();
  return (
    <nav
      aria-label="Utama"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-garis bg-kertas md:hidden"
    >
      <div className="grid grid-cols-5 pb-[env(safe-area-inset-bottom)]">
        {ITEMS.map((it) => (
          <SelBawah
            key={it.href}
            href={it.href}
            label={it.label}
            on={aktif === it.href}
            prefetch={prefetchDaftar(path, it.href)}
          />
        ))}
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------ cari tim */

/**
 * Aksi "Cari tim" di kepala: menuju kontrol pencarian pada daftar
 * yang sedang dibuka — Analisa saat berada di Analisa, selain itu
 * Jadwal. Varian Static adalah fallback Suspense (tujuan Jadwal,
 * perilaku warisan).
 */
const KELAS_CARI =
  "ml-auto inline-flex min-h-[44px] items-center gap-2 text-[15px] whitespace-nowrap text-sekunder transition-colors duration-[var(--duration-micro)] hover:text-tinta";

function IkonCari() {
  return (
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
  );
}

export function CariTimStatic() {
  return (
    <Link href="/pertandingan" className={KELAS_CARI}>
      <IkonCari />
      Cari tim
    </Link>
  );
}

export function CariTimClient() {
  const path = usePathname();
  return (
    <Link href={path === "/analisa" ? "/analisa" : "/pertandingan"} className={KELAS_CARI}>
      <IkonCari />
      Cari tim
    </Link>
  );
}
