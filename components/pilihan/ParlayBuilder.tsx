"use client";

/**
 * PARLAY BUILDER — the live-run pick list plus the slip panel.
 *
 * Data (picks + package matrices) arrives from the Server Component as
 * serialisable props; this component only holds the user's selection.
 * Combined probability comes from lib/web/parlay.ts (pure): multiple
 * picks in one match are combined exactly from the score matrix,
 * across matches they are multiplied (independence assumption) — the
 * method is labelled in the slip, never hidden.
 */
import { useMemo, useState } from "react";
import { GateStatus, GradeMark, Prob, EmptyState } from "../ui";
import { MARKET_LABEL, jamWibOnly, labelPilihan, pct, tanggalWib } from "../../lib/web/format";
import { combineSlip, type SlipPick } from "../../lib/web/parlay";

export interface BuilderPick {
  key: string;
  matchId: string;
  kickoffUtc: string;
  home: string;
  away: string;
  competitionName: string;
  gateStatus: string;
  grade: string;
  market: string;
  selection: string;
  /** Effective probability (lab-corrected when probBasis is "lab"). */
  prob: number;
  /** "lab" = prob is the lab-corrected probability; "model" = raw model prob. */
  probBasis: "lab" | "model";
  /** Raw model probability, kept for reference/display. */
  modelProb: number;
  sourcesAgree: number;
  packageId: number | null;
}

const MAX_PICKS = 12;
type GradeFilter = "AB" | "A" | "ALL";
const FILTERS: { id: GradeFilter; label: string }[] = [
  { id: "AB", label: "A + B" },
  { id: "A", label: "A only" },
  { id: "ALL", label: "All" },
];

export default function ParlayBuilder({
  picks,
  matrices,
}: {
  picks: BuilderPick[];
  matrices: Record<number, number[][]>;
}) {
  const [filter, setFilter] = useState<GradeFilter>("AB");
  const [selected, setSelected] = useState<BuilderPick[]>([]);

  const selectedKeys = useMemo(() => new Set(selected.map((p) => p.key)), [selected]);

  const groups = useMemo(() => {
    const keep = (g: string) =>
      filter === "ALL" ? true : filter === "A" ? g === "A" : g === "A" || g === "B";
    const map = new Map<string, BuilderPick[]>();
    for (const p of picks) {
      if (!keep(p.grade)) continue;
      const arr = map.get(p.matchId);
      if (arr) arr.push(p);
      else map.set(p.matchId, [p]);
    }
    return [...map.values()];
  }, [picks, filter]);

  const result = useMemo(() => {
    const slip: SlipPick[] = selected.map((p) => ({
      key: p.key,
      matchId: p.matchId,
      market: p.market,
      selection: p.selection,
      prob: p.prob,
      probBasis: p.probBasis,
      matrix: p.packageId !== null ? matrices[p.packageId] ?? null : null,
    }));
    return combineSlip(slip);
  }, [selected, matrices]);

  const pickByMatch = useMemo(() => {
    const m = new Map<string, BuilderPick>();
    for (const p of selected) if (!m.has(p.matchId)) m.set(p.matchId, p);
    return m;
  }, [selected]);

  const full = selected.length >= MAX_PICKS;
  const multiGroups = result.groups.filter((g) => g.count > 1);

  function toggle(p: BuilderPick) {
    setSelected((cur) => {
      if (cur.some((s) => s.key === p.key)) return cur.filter((s) => s.key !== p.key);
      if (cur.length >= MAX_PICKS) return cur;
      return [...cur, p];
    });
  }

  if (picks.length === 0) {
    return (
      <EmptyState
        title="No live picks yet"
        note="The next slate writes its picks before kick-off — never after."
      />
    );
  }

  return (
    <div className="flex flex-col gap-12 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-14">
      {/* ---------------------------------------------------------- slip */}
      <aside
        className="order-1 lg:order-2 lg:sticky lg:top-10 lg:border-l lg:border-hairline/60 lg:pl-10"
        aria-label="Your slip"
      >
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-display text-xl font-semibold text-ink">Your slip</h2>
          <span className="text-[13px] text-faint">
            {selected.length} / {MAX_PICKS} max
          </span>
        </div>

        {selected.length === 0 ? (
          <p className="py-8 text-sm leading-relaxed text-mid-gray">No picks yet.</p>
        ) : (
          <>
            <ul className="mt-4">
              {selected.map((p) => (
                <li
                  key={p.key}
                  className="flex items-start gap-2.5 border-t border-hairline/50 py-2.5 first:border-t-0"
                >
                  <GradeMark grade={p.grade} className="pt-px" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">
                      {labelPilihan(p.market, p.selection, p.home, p.away)}
                    </span>
                    <span className="flex items-center gap-2 text-[12px] text-faint">
                      <span className="truncate">
                        {p.home} vs {p.away}
                      </span>
                      <GateStatus status={p.gateStatus} />
                    </span>
                  </span>
                  <Prob value={p.prob} className="text-sm" />
                  <button
                    type="button"
                    onClick={() => toggle(p)}
                    aria-label={`Remove ${labelPilihan(p.market, p.selection, p.home, p.away)} from the slip`}
                    className="shrink-0 px-1 text-lg leading-none text-mid-gray transition-colors hover:text-brick"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-6 border-t border-hairline pt-5">
              <p className="text-[13px] text-mid-gray">Combined probability</p>
              <p className="tabular-nums mt-1.5 text-[40px] leading-none font-semibold text-accent">
                {pct(result.combined, result.combined >= 0.1 ? 1 : 2)}
              </p>

              {multiGroups.length > 0 && (
                <ul className="mt-5 space-y-3">
                  {multiGroups.map((g) => {
                    const head = pickByMatch.get(g.matchId);
                    return (
                      <li key={g.matchId} className="text-[13px] leading-relaxed">
                        <span className="text-mid-gray">
                          {head ? `${head.home} vs ${head.away}` : g.matchId}
                        </span>{" "}
                        <span className="tabular-nums text-ink">{pct(g.prob)}</span>
                        <span className="block text-faint">
                          {g.count} picks in this match —{" "}
                          {g.exact
                            ? "combined from the score matrix."
                            : "no matrix, multiplied (an estimate)."}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}

              <p className="mt-5 text-[12px] leading-relaxed text-faint">
                {result.basis === "lab" &&
                  "Every number in this slip is a lab-corrected probability. Same-match picks are combined exactly from the score matrix."}
                {result.basis === "model" &&
                  "These numbers are raw model probabilities — no lab correction applies to this slip. Same-match picks are combined exactly from the model score matrix."}
                {result.basis === "mixed" &&
                  "Mixed bases: singles use lab-corrected probabilities where available; same-match combos are computed exactly from the model score matrix, not lab-corrected."}
              </p>

              <button
                type="button"
                onClick={() => setSelected([])}
                className="mt-4 text-sm text-mid-gray transition-colors hover:text-brick"
              >
                Clear slip
              </button>
            </div>
          </>
        )}
        {full && (
          <p className="mt-3 text-[13px] text-accent">
            {MAX_PICKS} max — remove a pick to add another.
          </p>
        )}
      </aside>

      {/* ------------------------------------------------------ pick list */}
      <section className="order-2 min-w-0 lg:order-1" aria-label="Picks">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-6 gap-y-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`text-[15px] transition-colors ${
                filter === f.id
                  ? "font-medium text-ink underline decoration-accent decoration-2 underline-offset-8"
                  : "text-mid-gray hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="ml-auto text-[13px] text-faint">
            {picks.length} picks · {new Set(picks.map((p) => p.matchId)).size} matches
          </span>
        </div>

        {groups.length === 0 ? (
          <EmptyState
            title="No picks in this filter"
            note="Switch the grade filter to see the rest of this slate."
          />
        ) : (
          <div>
            {groups.map((group) => {
              const head = group[0];
              return (
                <div key={head.matchId} className="mt-10 first:mt-6">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-1">
                    <span className="tabular-nums text-sm text-mid-gray">
                      {jamWibOnly(head.kickoffUtc)}
                    </span>
                    <span className="text-[13px] text-faint">{tanggalWib(head.kickoffUtc)}</span>
                    <h3 className="font-display text-[17px] font-medium text-ink">
                      {head.home} <span className="font-normal text-faint">vs</span> {head.away}
                    </h3>
                    {head.competitionName && (
                      <span className="text-[13px] text-faint">{head.competitionName}</span>
                    )}
                    <span className="ml-auto">
                      <GateStatus status={head.gateStatus} />
                    </span>
                  </div>
                  <ul>
                    {group.map((p) => {
                      const active = selectedKeys.has(p.key);
                      return (
                        <li
                          key={p.key}
                          className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hairline/50 py-3 ${
                            active ? "bg-surface-alt/50" : ""
                          }`}
                        >
                          <GradeMark grade={p.grade} className="w-4 text-center" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] text-ink">
                              {labelPilihan(p.market, p.selection, p.home, p.away)}
                            </span>
                            <span className="block text-[12px] text-faint">
                              {MARKET_LABEL[p.market] ?? p.market}
                            </span>
                          </span>
                          <span className="hidden text-[12px] text-mid-gray sm:block">
                            {p.sourcesAgree} of 3 sources
                          </span>
                          <Prob value={p.prob} strong className="text-base" />
                          <button
                            type="button"
                            aria-pressed={active}
                            disabled={!active && full}
                            onClick={() => toggle(p)}
                            className={`shrink-0 px-1 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                              active ? "text-mid-gray hover:text-ink" : "text-accent hover:text-ink"
                            }`}
                          >
                            {active ? "Added" : "Add"}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-10 max-w-2xl text-[12px] leading-relaxed text-faint">
          Grades come from the historical lab — hundreds of thousands of picks tested out of
          sample. The probability shown is the graded (effective) probability, not the raw model
          output.
        </p>
      </section>
    </div>
  );
}
