"use client";

/**
 * REVEAL — animasi masuk halus berbasis GSAP ScrollTrigger.
 * Transform + opacity saja (tidak menggeser layout), sekali per elemen,
 * dilewati total saat prefers-reduced-motion. Tanpa JS, konten tetap tampil
 * (keadaan awal hanya disetel dari dalam effect).
 */
import { useEffect, useRef, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

let registered = false;

export default function Reveal({
  children,
  delay = 0,
  y = 16,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!registered) {
      gsap.registerPlugin(ScrollTrigger);
      registered = true;
    }
    const tween = gsap.fromTo(
      el,
      { y, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 0.6,
        delay,
        ease: "power3.out",
        scrollTrigger: { trigger: el, start: "top 90%", once: true },
      },
    );
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [delay, y]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
