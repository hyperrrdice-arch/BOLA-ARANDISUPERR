/**
 * MATCHES — the next 72 hours from the latest analysis packages,
 * grouped by day, then competition. Every number comes from stored
 * pipeline output; this page calculates nothing.
 */
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import {
  getPackagePicks,
  listFinished,
  listUpcoming,
  type FixtureListItem,
} from "@/lib/web/data";
import { GATE_LABEL, jamWibOnly, labelHari, labelPilihan, tanggalWib } from "@/lib/web/format";
import { EmptyState, GateStatus, GradeMark, PageLoading, Prob, SectionHead } from "@/components/ui";

function sourcesOf(item: FixtureListItem): { agree: number; total: number } {
  const leg = item.topLeg;
  if (!leg) return { agree: 0, total: 0 };
  const total = 1 + (leg.market_prob !== null ? 1 : 0) + (leg.sm_prob !== null ? 1 : 0);
  return { agree: total, total: 3 };
}

function countsLine(item: FixtureListItem): string | null {
  const c = item.pickCounts;
  const parts: string[] = [];
  if (c.A > 0) parts.push(`${c.A} A`);
  if (c.B > 0) parts.push(`${c.B} B`);
  if (c.C > 0) parts.push(`${c.C} C`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function FixtureRow({ item }: { item: FixtureListItem }) {
  const f = item.pkg.payload.fixture;
  const leg = item.topLeg;
  const src = sourcesOf(item);
  const counts = countsLine(item);
  return (
    <Link
      href={`/pertandingan/${item.pkg.match_id}`}
      className="flex items-start gap-4 border-t border-hairline/50 py-4 transition-colors first:border-t-0 hover:bg-surface-alt/40 sm:gap-6"
    >
      <span className="tabular-nums w-[3.5rem] flex-none whitespace-nowrap pt-0.5 text-sm text-mid-gray">
        {jamWibOnly(item.pkg.kickoff_utc)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] font-medium text-ink">
          {f.home} <span className="font-normal text-faint">vs</span> {f.away}
        </span>
        <span className="mt-1 block text-[13px] text-mid-gray">
          {leg ? (
            <>
              {labelPilihan(leg.market, leg.selection, f.home, f.away)}
              {counts && <span className="text-faint"> · {counts}</span>}
            </>
          ) : (
            "No graded pick"
          )}
        </span>
      </span>
      {leg && (
        <span className="shrink-0 text-right">
          <span className="flex items-baseline justify-end gap-2.5">
            <Prob value={leg.effective_prob} strong className="text-[28px] leading-none" />
            <GradeMark grade={leg.grade} className="text-xl" />
          </span>
          <span className="mt-1.5 block text-[12px] text-faint">
            {src.agree} of {src.total} sources
          </span>
        </span>
      )}
    </Link>
  );
}

function FinishedRow({ item }: { item: FixtureListItem }) {
  const f = item.pkg.payload.fixture;
  const r = item.result;
  const picks = getPackagePicks(item.pkg.id).slice(0, 3);
  return (
    <div className="flex items-start gap-4 border-t border-hairline/50 py-5 first:border-t-0 sm:gap-6">
      <span className="tabular-nums w-16 shrink-0 text-2xl font-semibold text-ink">
        {r ? `${r.home_goals}–${r.away_goals}` : "—"}
      </span>
      <span className="min-w-0 flex-1">
        <Link
          href={`/pertandingan/${item.pkg.match_id}`}
          className="block truncate text-[17px] font-medium text-ink transition-colors hover:text-accent"
        >
          {f.home} <span className="font-normal text-faint">vs</span> {f.away}
        </Link>
        <span className="mt-1 block text-[13px] text-mid-gray">
          {f.competition_name} · {jamWibOnly(item.pkg.kickoff_utc)} WIB
        </span>
        {picks.length > 0 ? (
          <ul className="mt-3 space-y-1.5">
            {picks.map((p) => (
              <li key={p.id} className="flex items-baseline gap-2.5 text-sm">
                <GradeMark grade={p.grade} />
                <span className="min-w-0 flex-1 truncate text-ink-soft">
                  {labelPilihan(p.market, p.selection, f.home, f.away)}
                </span>
                <Prob value={p.model_prob} className="text-[13px]" />
                {p.hit === 1 ? (
                  <span className="text-[13px] font-medium text-sage">Hit</span>
                ) : p.hit === 0 ? (
                  <span className="text-[13px] font-medium text-brick">Miss</span>
                ) : (
                  <span className="text-[13px] text-faint">Not graded</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[13px] text-faint">No picks recorded for this package.</p>
        )}
      </span>
      <span className="shrink-0 pt-1">
        <GateStatus status={item.pkg.gate_status} />
      </span>
    </div>
  );
}

export default function PertandinganPage() {
  return (
    <Suspense fallback={<PageLoading label="Loading matches…" />}>
      <PertandinganContent />
    </Suspense>
  );
}

async function PertandinganContent() {
  await connection();
  const upcoming = listUpcoming(72);
  const finished = listFinished(72, 60);

  const updated = upcoming.reduce<string | null>(
    (max, it) => (max === null || it.pkg.computed_utc > max ? it.pkg.computed_utc : max),
    null,
  );

  // Group: day -> competition (kickoff order preserved).
  const byDay = new Map<string, Map<string, FixtureListItem[]>>();
  for (const it of upcoming) {
    const day = labelHari(it.pkg.kickoff_utc);
    if (!byDay.has(day)) byDay.set(day, new Map());
    const comps = byDay.get(day)!;
    const comp = it.pkg.payload.fixture.competition_name;
    if (!comps.has(comp)) comps.set(comp, []);
    comps.get(comp)!.push(it);
  }

  return (
    <div>
      <header>
        <h1 className="font-display text-[2.5rem] leading-tight font-semibold tracking-[-0.02em] text-ink">
          Matches
        </h1>
        <p className="mt-2 text-[15px] text-mid-gray">
          Next 72 hours
          {updated && (
            <>
              {" "}· Updated {tanggalWib(updated)} {jamWibOnly(updated)} WIB
            </>
          )}
        </p>
      </header>

      {upcoming.length === 0 ? (
        <EmptyState
          title="No matches in this window."
          note="The slate refreshes every 12 hours."
        />
      ) : (
        [...byDay.entries()].map(([day, comps]) => (
          <section key={day} className="mt-14">
            <h2 className="font-display text-xl font-semibold text-ink">
              {day}
              {comps.size > 0 && (
                <span className="ml-3 text-sm font-normal text-faint">
                  {tanggalWib([...comps.values()][0][0].pkg.kickoff_utc)}
                </span>
              )}
            </h2>
            {[...comps.entries()].map(([comp, items]) => (
              <div key={comp} className="mt-8">
                <div className="flex items-center gap-2.5 pb-1">
                  <GateStatus status={items[0].pkg.gate_status} withLabel={false} />
                  <span className="font-display text-[17px] font-semibold text-ink">{comp}</span>
                  <span className="text-[13px] text-mid-gray">
                    {GATE_LABEL[items[0].pkg.gate_status] ?? items[0].pkg.gate_status}
                  </span>
                </div>
                <div>
                  {items.map((it) => (
                    <FixtureRow key={it.pkg.id} item={it} />
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))
      )}

      <section className="mt-20">
        <SectionHead
          label="Finished"
          right={<span className="text-[13px] text-faint">{finished.length} matches</span>}
        />
        <div className="mt-6">
          {finished.length === 0 ? (
            <p className="text-sm text-faint">
              No finished matches with a stored package in the last 72 hours.
            </p>
          ) : (
            finished.map((it) => <FinishedRow key={it.pkg.id} item={it} />)
          )}
        </div>
      </section>
    </div>
  );
}
