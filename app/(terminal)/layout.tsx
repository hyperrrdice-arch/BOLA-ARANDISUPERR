import { Suspense } from "react";
import Link from "next/link";
import Nav, { NavStatic } from "../../components/Nav";

export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="w-full md:w-60 shrink-0 bg-well border-b md:border-b-0 md:border-r border-hairline md:min-h-screen md:sticky md:top-0">
        <div className="px-4 pt-5 pb-4">
          <Link href="/" className="block">
            <span className="font-display text-[26px] leading-none font-bold tracking-wide text-ink">
              PILIHAN <span className="text-accent">AMAN</span>
            </span>
            <span className="micro-label block mt-1.5">Mesin probabilitas sepak bola</span>
          </Link>
        </div>
        <div className="px-2 pb-3 md:py-2">
          <Suspense fallback={<NavStatic />}>
            <Nav />
          </Suspense>
        </div>
        <div className="hidden md:block px-4 mt-6">
          <p className="text-[11px] leading-relaxed text-faint font-mono">
            Angka dari model deterministik yang terkalibrasi & teruji out-of-sample.
            Alat bantu keyakinan — bukan janji menang.
          </p>
        </div>
      </aside>
      <main id="konten-utama" className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
    </div>
  );
}
