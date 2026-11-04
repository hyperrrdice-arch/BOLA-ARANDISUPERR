/**
 * ATOM UI — bahasa visual Editorial Terminal (Amber Panas).
 * Dipakai semua halaman; jangan duplikasi gaya ini di halaman.
 */
import type { ReactNode } from "react";
import { GATE_LABEL, pct } from "../lib/web/format";
import type { FormEntry } from "../lib/web/data";

export function MicroLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`micro-label ${className}`}>{children}</span>;
}

const GRADE_STYLE: Record<string, string> = {
  A: "bg-sage/20 text-sage border-sage/50",
  B: "bg-accent/15 text-accent border-accent/50",
  C: "bg-brick/15 text-brick border-brick/50",
};

export function GradeStamp({ grade, size = "md" }: { grade: string; size?: "sm" | "md" | "lg" }) {
  const s = GRADE_STYLE[grade] ?? "bg-surface-alt text-mid-gray border-hairline-strong";
  const dim = size === "lg" ? "w-9 h-9 text-base" : size === "sm" ? "w-5 h-5 text-[11px]" : "w-7 h-7 text-sm";
  return (
    <span
      className={`inline-flex ${dim} items-center justify-center border rounded-md font-mono font-bold ${s}`}
      aria-label={`Grade ${grade}`}
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
const GATE_TEXT: Record<string, string> = {
  calibrated: "text-sage",
  partial: "text-accent",
  uncalibrated: "text-brick",
};

export function GateStatus({ status, withLabel = true }: { status: string; withLabel?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`w-1.5 h-1.5 rounded-full ${GATE_DOT[status] ?? "bg-faint"}`} />
      {withLabel && (
        <span className={`font-mono text-[11px] tracking-wider ${GATE_TEXT[status] ?? "text-faint"}`}>
          {GATE_LABEL[status] ?? status.toUpperCase()}
        </span>
      )}
    </span>
  );
}

export function Prob({ value, strong = false, className = "" }: { value: number | null | undefined; strong?: boolean; className?: string }) {
  return (
    <span className={`tabular-nums ${strong ? "text-accent font-semibold" : ""} ${className}`}>
      {pct(value)}
    </span>
  );
}

const FORM_STYLE: Record<string, string> = {
  W: "bg-sage/20 text-sage border-sage/40",
  D: "bg-surface-alt text-mid-gray border-hairline-strong",
  L: "bg-brick/15 text-brick border-brick/40",
};

export function FormChips({ form, showScore = false }: { form: FormEntry[]; showScore?: boolean }) {
  if (form.length === 0) return <span className="text-faint text-xs font-mono">belum ada data form</span>;
  return (
    <span className="inline-flex items-center gap-1">
      {form.map((f, i) => (
        <span
          key={i}
          title={`${f.date.slice(0, 10)} vs ${f.opponent} (${f.venue === "home" ? "kandang" : "tandang"}) ${f.goals_for}-${f.goals_against}`}
          className={`inline-flex items-center justify-center border rounded-md font-mono text-[11px] font-bold ${
            showScore ? "px-1.5 h-6" : "w-6 h-6"
          } ${FORM_STYLE[f.result]}`}
        >
          {showScore ? `${f.goals_for}-${f.goals_against}` : f.result}
        </span>
      ))}
    </span>
  );
}

/** Warna sel heatmap matriks skor: amber sebagai panas, diskalakan ke sel maksimum. */
export function heatStyle(prob: number, max: number): { backgroundColor: string; color: string } {
  const t = max > 0 ? Math.pow(prob / max, 0.72) : 0;
  return {
    backgroundColor: `rgba(255, 160, 46, ${(t * 0.85).toFixed(3)})`,
    color: t > 0.55 ? "#1a1206" : "#e9e4d8",
  };
}

/** Fallback streaming untuk pulau data (Cache Components: Suspense). */
export function PageLoading({ label }: { label: string }) {
  return (
    <div className="panel-flat px-5 py-8" role="status" aria-label={label}>
      <MicroLabel>{label}</MicroLabel>
      <div className="mono-loading-bar-container mt-4">
        <div className="mono-loading-bar" />
      </div>
    </div>
  );
}

export function EmptyState({ title, note }: { title: string; note: string }) {
  return (
    <div className="panel-flat px-5 py-8 text-center">
      <p className="font-display text-xl font-semibold tracking-wide text-ink">{title}</p>
      <p className="mt-1 text-sm text-mid-gray">{note}</p>
    </div>
  );
}

export function SectionHead({ label, right }: { label: string; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 border-b border-hairline pb-2">
      <MicroLabel>{label}</MicroLabel>
      {right}
    </div>
  );
}
