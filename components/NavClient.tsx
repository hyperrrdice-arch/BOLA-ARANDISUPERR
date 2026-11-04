"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/pertandingan", label: "Matches" },
  { href: "/pilihan", label: "Picks" },
  { href: "/bukti", label: "Record" },
];

/** Static version without hooks — the Suspense fallback, so the page
 *  shell can prerender (Cache Components) while the active state streams in. */
export function NavStatic() {
  return (
    <nav aria-label="Main" className="flex items-center gap-7">
      {ITEMS.map((it) => (
        <Link key={it.href} href={it.href} className="text-[15px] whitespace-nowrap text-mid-gray">
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

export default function NavClient() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex items-center gap-7">
      {ITEMS.map((it) => {
        const active = path === it.href || path.startsWith(it.href + "/");
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={`text-[15px] whitespace-nowrap transition-colors ${
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
