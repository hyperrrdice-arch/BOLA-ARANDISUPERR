/**
 * TOP BAR — one slim, transparent bar shared by every page.
 * Wordmark left, nav right; the active link is bone text with a 2px
 * amber underline. No background, no border, no boxes.
 */
import { Suspense } from "react";
import Link from "next/link";
import NavClient, { NavStatic } from "./NavClient";

export function TopBar() {
  return (
    <header>
      <div className="mx-auto flex h-16 w-full max-w-[76rem] items-center justify-between px-6">
        <Link
          href="/"
          className="font-display text-[17px] font-semibold tracking-[-0.01em] text-ink"
        >
          Bola
        </Link>
        <Suspense fallback={<NavStatic />}>
          <NavClient />
        </Suspense>
      </div>
    </header>
  );
}
