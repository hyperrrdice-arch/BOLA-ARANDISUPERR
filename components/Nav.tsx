"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/pertandingan", label: "Pertandingan" },
  { href: "/pilihan", label: "Pilihan Aman" },
  { href: "/bukti", label: "Ledger Bukti" },
];

/** Versi statis tanpa hook — fallback Suspense agar kerangka halaman bisa
 *  di-prerender (Cache Components) sementara status aktif menyusul. */
export function NavStatic() {
  return (
    <nav aria-label="Navigasi terminal" className="flex md:flex-col gap-1 overflow-x-auto">
      {ITEMS.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          className="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm whitespace-nowrap text-mid-gray"
        >
          <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-faint/50" />
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

export default function Nav() {
  const path = usePathname();
  return (
    <nav aria-label="Navigasi terminal" className="flex md:flex-col gap-1 overflow-x-auto">
      {ITEMS.map((it) => {
        const active = path === it.href || path.startsWith(it.href + "/");
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm whitespace-nowrap transition-colors ${
              active
                ? "bg-surface-alt text-ink font-semibold"
                : "text-mid-gray hover:text-ink hover:bg-surface-alt/60"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? "bg-accent" : "bg-faint/50"}`} />
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
