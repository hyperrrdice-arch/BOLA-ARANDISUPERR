"use client";

/**
 * NAVIGASI (brief redesain §2) — dua permukaan dari daftar tujuan yang
 * sama: tautan desktop di kepala halaman dan navigasi bawah ponsel.
 * Keadaan aktif memakai usePathname; varian Static (tanpa hooks) adalah
 * fallback Suspense supaya shell halaman bisa prerender.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

export const ITEMS = [
  { href: "/", label: "Beranda" },
  { href: "/pertandingan", label: "Jadwal" },
  { href: "/pilihan", label: "Pilihan" },
  { href: "/bukti", label: "Rekam hasil" },
];

function aktif(path: string | null, href: string): boolean {
  if (!path) return false;
  return href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
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
  return (
    <nav aria-label="Utama" className="hidden items-center gap-7 md:flex">
      {ITEMS.map((it) => {
        const on = aktif(path, it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
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
 * Navigasi bawah ponsel: empat tujuan masing-masing seperempat lebar,
 * tinggi minimal 52 px + safe-area; tujuan aktif ditandai garis jingga
 * di tepi atas selnya + aria-current (lembar acuan 2).
 */
function SelBawah({
  href,
  label,
  on,
}: {
  href: string;
  label: string;
  on: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`relative flex min-h-[52px] items-center justify-center px-1 text-[13px] transition-colors duration-[var(--duration-micro)] ${
        on ? "font-semibold text-tinta" : "text-sekunder hover:text-tinta"
      }`}
    >
      {on && <span aria-hidden="true" className="absolute inset-x-5 top-0 h-[3px] bg-jingga" />}
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
      <div className="grid grid-cols-4 pb-[env(safe-area-inset-bottom)]">
        {ITEMS.map((it) => (
          <SelBawah key={it.href} href={it.href} label={it.label} on={false} />
        ))}
      </div>
    </nav>
  );
}

export function BottomNavClient() {
  const path = usePathname();
  return (
    <nav
      aria-label="Utama"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-garis bg-kertas md:hidden"
    >
      <div className="grid grid-cols-4 pb-[env(safe-area-inset-bottom)]">
        {ITEMS.map((it) => (
          <SelBawah key={it.href} href={it.href} label={it.label} on={aktif(path, it.href)} />
        ))}
      </div>
    </nav>
  );
}
