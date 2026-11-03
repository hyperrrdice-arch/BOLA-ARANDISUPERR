"use client";

import { useEffect, useRef } from "react";

/** Ponytail motion: 1 hook + 1 angka count-up, dipakai katalog + hero kuantitatif. */
export function useGsapChildren<T extends HTMLElement>(deps: readonly unknown[]) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || el.children.length === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;
    let ctx: { revert: () => void } | null = null;
    (async () => {
      const { gsap } = await import("gsap");
      if (cancelled || !ref.current) return;
      ctx = gsap.context(() => {
        gsap.fromTo(
          Array.from(ref.current!.children),
          { y: 18, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.45, stagger: 0.055, ease: "power2.out", overwrite: true, clearProps: "transform" },
        );
      }, ref);
    })();
    return () => {
      cancelled = true;
      ctx?.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

/** Angka persen yang count-up sekali jalan; hormati reduced-motion + null. */
export function GsapPct({ value }: { value: number | null }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (value == null || !ref.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      ref.current.textContent = `${value}%`;
      return;
    }
    let cancelled = false;
    const target = ref.current;
    (async () => {
      const { gsap } = await import("gsap");
      if (cancelled) return;
      const obj = { v: 0 };
      gsap.to(obj, {
        v: value,
        duration: 0.7,
        ease: "power2.out",
        overwrite: true,
        onUpdate: () => {
          target.textContent = `${Math.round(obj.v)}%`;
        },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [value]);
  return <span ref={ref}>{value == null ? "—" : `${value}%`}</span>;
}
