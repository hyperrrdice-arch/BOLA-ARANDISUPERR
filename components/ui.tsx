/**
 * UI ATOMS — v2 "big-tech calm" (approved 2026-11-05).
 * No boxes, no stamps, no all-caps labels: hierarchy comes from size,
 * weight, colour and spacing. Shared by every page; do not duplicate
 * these styles inside pages.
 */
import type { ReactNode } from "react";
import { GATE_LABEL, pct } from "../lib/web/format";
import type { FormEntry } from "../lib/web/data";

/** Quiet sentence-case label text (replaces the old mono micro-label). */
export function MicroLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`text-[13px] text-mid-gray ${className}`}>{children}</span>;
}

const GRADE_TEXT: Record<string, string> = {
  A: "text-sage",
  B: "text-accent",
  C: "text-brick",
  D: "text-faint",
};

/** A plain coloured grade letter — no border, no background, no stamp. */
export function GradeMark({ grade, className = "" }: { grade: string; className?: string }) {
  return (
    <span
      className={`font-display font-semibold ${GRADE_TEXT[grade] ?? "text-faint"} ${className}`}
      aria-label={`Kelas ${grade}`}
    >
      {grade}
    </span>
  );
}

const GATE_DOT: Record<string, string> = {
  calibrated: "bg-sage",
  partial: "bg-accent",
  uncalibrated: "bg-brick",
};

export function GateStatus({ status, withLabel = true }: { status: string; withLabel?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className={`h-1.5 w-1.5 rounded-full ${GATE_DOT[status] ?? "bg-faint"}`} />
      {withLabel && (
        <span className="text-[13px] text-mid-gray">{GATE_LABEL[status] ?? status}</span>
      )}
    </span>
  );
}

export function Prob({ value, strong = false, className = "" }: { value: number | null | undefined; strong?: boolean; className?: string }) {
  return (
    <span className={`tabular-nums ${strong ? "font-semibold text-accent" : ""} ${className}`}>
      {pct(value)}
    </span>
  );
}

const FORM_STYLE: Record<string, string> = {
  W: "bg-sage/25 text-sage",
  D: "bg-surface-alt text-mid-gray",
  L: "bg-brick/20 text-brick",
};

/** Huruf chip form dalam Bahasa Indonesia: M = Menang, S = Seri, K = Kalah. */
const FORM_HURUF: Record<string, string> = { W: "M", D: "S", L: "K" };
const FORM_KATA: Record<string, string> = { W: "Menang", D: "Seri", L: "Kalah" };

export function FormChips({ form, showScore = false }: { form: FormEntry[]; showScore?: boolean }) {
  if (form.length === 0) return <span className="text-[13px] text-faint">Belum ada data laga terakhir</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      {form.map((f, i) => (
        <span
          key={i}
          title={`${f.date.slice(0, 10)} ${f.venue === "home" ? "vs" : "di markas"} ${f.opponent} ${f.goals_for}-${f.goals_against} · ${FORM_KATA[f.result] ?? f.result}`}
          className={`inline-flex h-[22px] items-center justify-center rounded-full text-[10px] font-semibold ${
            showScore ? "px-2" : "w-[22px]"
          } ${FORM_STYLE[f.result]}`}
        >
          {showScore ? `${f.goals_for}-${f.goals_against}` : (FORM_HURUF[f.result] ?? f.result)}
        </span>
      ))}
    </span>
  );
}

/**
 * Warna panas matriks skor pada PANEL AMOLED brief upgrade (#0D0D0F):
 * jingga #FFAD5B sebagai panas, diskala ke sel terpanas.
 *
 * Kontras teks sel adalah kontrak terukur, bukan perkiraan: rampa
 * alfa kontinu punya zona mati di tengah (pada alfa ≈0,58 teks terang
 * maupun gelap hanya ≈4,4:1), jadi alfa dibuat DUA SEGMEN —
 *   u ≤ 0,5 → alfa 0 → 0,53, teks #F5F5F7;
 *   u > 0,5 → alfa 0,62 → 0,95, teks #000000;
 * dengan u = (p/maks)^0,72 seperti kurva lama. Kontras minimum di
 * seluruh rentang terhadap warna komposit di atas panel #0D0D0F =
 * 4,92:1 (dihitung 2026-11-22; audit lama mengukur sel 7,6% pada
 * ≈2,5:1 dan pengukuran lokal mengonfirmasi minimum 2,34:1).
 * Warna teks yang dikembalikan juga dipakai cincin sel terpilih,
 * jadi penanda pilihan mewarisi kontras yang sama.
 */
export function heatStyle(prob: number, max: number): { backgroundColor: string; color: string } {
  const u = max > 0 ? Math.pow(prob / max, 0.72) : 0;
  if (u <= 0.5) {
    return {
      backgroundColor: `rgba(255, 173, 91, ${(u * 1.06).toFixed(3)})`,
      color: "#f5f5f7",
    };
  }
  return {
    backgroundColor: `rgba(255, 173, 91, ${(0.62 + (u - 0.5) * 0.66).toFixed(3)})`,
    color: "#000000",
  };
}

/** Streaming fallback for data islands (Cache Components: Suspense). */
export function PageLoading({ label }: { label: string }) {
  return (
    <div className="py-16" role="status" aria-label={label}>
      <p className="text-sm text-mid-gray">{label}</p>
      <div className="mono-loading-bar-container mt-4 max-w-xs">
        <div className="mono-loading-bar" />
      </div>
    </div>
  );
}

export function EmptyState({ title, note }: { title: string; note?: string }) {
  return (
    <div className="py-16 text-center">
      <p className="text-[17px] font-medium text-ink">{title}</p>
      {note && <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-mid-gray">{note}</p>}
    </div>
  );
}

export function SectionHead({
  label,
  sub,
  right,
}: {
  label: string;
  sub?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-[-0.01em] text-ink">{label}</h2>
        {sub && <p className="mt-1.5 text-sm text-mid-gray">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
