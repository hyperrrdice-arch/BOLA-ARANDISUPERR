"use client";

/**
 * TAB REKAM HASIL — tiga tab brief redesain §3E (Sudah dinilai /
 * Menunggu / Batal) di atas panel yang dirender server.
 *
 * Tab HANYA mengatur daftar: ringkasan periode (pembilang, penyebut,
 * cakupan) dirender server di luar komponen ini dan tidak pernah
 * berubah karena tab berganti — cakupan tidak bisa tampak 100%
 * hanya karena tab Menunggu disembunyikan.
 *
 * Gerak §9: penanda tab bergeser 160 ms (cubic-bezier brief); daftar
 * hadir bersama status tertulisnya tanpa animasi angka. Panel adalah
 * node server yang diserahkan sebagai props — yang aktif yang
 * dirender. Tombol di dalam panel dapat meminta pindah tab lewat
 * atribut `data-alih-tab="<id>"` (delegasi klik di sini), misalnya
 * aksi "Lihat 74 yang menunggu" pada keadaan kosong tab awal.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

export type IdTabRekam = "dinilai" | "menunggu" | "batal";

const TAB: { id: IdTabRekam; label: string }[] = [
  { id: "dinilai", label: "Sudah dinilai" },
  { id: "menunggu", label: "Menunggu" },
  { id: "batal", label: "Batal" },
];

export default function TabRekam({
  hitungan,
  panelDinilai,
  panelMenunggu,
  panelBatal,
}: {
  hitungan: Record<IdTabRekam, number>;
  panelDinilai: ReactNode;
  panelMenunggu: ReactNode;
  panelBatal: ReactNode;
}) {
  const [aktif, setAktif] = useState<IdTabRekam>("dinilai");
  const tombolRef = useRef<Array<HTMLButtonElement | null>>([]);
  const [penanda, setPenanda] = useState<{ kiri: number; lebar: number } | null>(null);

  // Ukur penanda dari tombol aktif; ukur ulang saat tab berganti atau
  // jendela berubah ukuran.
  useEffect(() => {
    const ukur = () => {
      const i = TAB.findIndex((t) => t.id === aktif);
      const el = tombolRef.current[i];
      if (el) setPenanda({ kiri: el.offsetLeft, lebar: el.offsetWidth });
    };
    ukur();
    window.addEventListener("resize", ukur);
    return () => window.removeEventListener("resize", ukur);
  }, [aktif]);

  const panel =
    aktif === "dinilai" ? panelDinilai : aktif === "menunggu" ? panelMenunggu : panelBatal;

  return (
    <div
      onClick={(e) => {
        const t = (e.target as HTMLElement).closest<HTMLElement>("[data-alih-tab]");
        const tujuan = t?.dataset.alihTab as IdTabRekam | undefined;
        if (tujuan && TAB.some((x) => x.id === tujuan)) setAktif(tujuan);
      }}
    >
      <div role="tablist" aria-label="Status pilihan" className="relative flex gap-2 border-b border-hairline">
        {TAB.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tombolRef.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={aktif === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={aktif === t.id ? 0 : -1}
            onClick={() => setAktif(t.id)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const arah = e.key === "ArrowRight" ? 1 : -1;
              const berikut = TAB[(i + arah + TAB.length) % TAB.length];
              setAktif(berikut.id);
              tombolRef.current[TAB.findIndex((x) => x.id === berikut.id)]?.focus();
            }}
            className={`flex min-h-[44px] items-center gap-2 px-3 text-[15px] transition-colors ${
              aktif === t.id ? "font-medium text-ink" : "text-mid-gray hover:text-ink"
            }`}
          >
            {t.label}
            <span className="tabular-nums text-[13px] text-faint">{hitungan[t.id]}</span>
          </button>
        ))}
        {penanda && (
          <span
            aria-hidden="true"
            className="absolute bottom-[-1px] h-[3px] bg-jingga transition-all duration-[160ms] [transition-timing-function:cubic-bezier(.22,.72,.2,1)]"
            style={{ left: penanda.kiri, width: penanda.lebar }}
          />
        )}
      </div>
      <div
        role="tabpanel"
        id={`panel-${aktif}`}
        aria-labelledby={`tab-${aktif}`}
        className="pt-2"
      >
        {panel}
      </div>
    </div>
  );
}
