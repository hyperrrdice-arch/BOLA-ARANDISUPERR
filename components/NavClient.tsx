"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Beranda" },
  { href: "/pertandingan", label: "Jadwal" },
  { href: "/pilihan", label: "Pilihan" },
  { href: "/bukti", label: "Rekam hasil" },
];

/** Static version without hooks — the Suspense fallback, so the page
 *  shell can prerender (Cache Components) while the active state streams in. */
export function NavStatic() {
  return (
    <nav aria-label="Utama" className="flex items-center gap-4 min-[480px]:gap-7">
      {ITEMS.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          className="text-[13px] whitespace-nowrap text-mid-gray min-[480px]:text-[15px]"
        >
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

export default function NavClient() {
  const path = usePathname();
  return (
    <nav aria-label="Utama" className="flex items-center gap-4 min-[480px]:gap-7">
      {ITEMS.map((it) => {
        const active =
          it.href === "/" ? path === "/" : path === it.href || path.startsWith(it.href + "/");
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={`text-[13px] whitespace-nowrap transition-colors min-[480px]:text-[15px] ${
              active
                ? "text-ink underline decoration-accent decoration-2 underline-offset-8"
                : "text-mid-gray hover:text-ink"
            }`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
