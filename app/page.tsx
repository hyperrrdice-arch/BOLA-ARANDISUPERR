/**
 * LANDING — "Pilihan Aman", v2 big-tech calm (approved 2026-11-05).
 *
 * One idea per screen: a quiet headline, the data ball as the product
 * shot, then the record. The static shell prerenders (Cache Components);
 * every number is read in async islands inside <Suspense> from the
 * read-only layer lib/web/data.ts. Client islands: the 3D ball (lazy,
 * ssr off) and the GSAP Reveal.
 */
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { landingStats, ledgerStats, listUpcoming } from "../lib/web/data";
import { int, pct } from "../lib/web/format";
import { EmptyState, GateStatus, GradeMark, SectionHead } from "../components/ui";
import { TopBar } from "../components/Nav";
import HeroScene from "../components/landing/HeroScene";
import Reveal from "../components/landing/Reveal";

/* ------------------------------------------------------------- islands */

async function HeroFigure() {
  await connection();
  const upcoming = listUpcoming(72);
  const featured =
    upcoming.find((f) => f.pkg.gate_status === "calibrated" && f.pkg.payload.score_matrix?.length) ??
    upcoming.find((f) => f.pkg.payload.score_matrix?.length) ??
    null;
  if (!featured) {
    return (
      <EmptyState
        title="No score matrix in this window"
        note="The next data refresh writes new packages every 12 hours."
      />
    );
  }
  const matrix = featured.pkg.payload.score_matrix.slice(0, 6).map((r) => r.slice(0, 6));
  const fx = featured.pkg.payload.fixture;
  return (
    <figure>
      <div className="relative h-[52vh] max-h-[540px] min-h-[340px]">
        <HeroScene matrix={matrix} home={fx.home} away={fx.away} />
      </div>
      <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] text-mid-gray">
          Built from a real score matrix — {fx.home} vs {fx.away} · {fx.competition_name}
        </span>
        <GateStatus status={featured.pkg.gate_status} />
      </figcaption>
    </figure>
  );
}

async function StatsRow() {
  await connection();
  const stats = landingStats();
  const cells: { value: string; label: string }[] = [
    { value: int(stats.leagues_calibrated), label: "leagues calibrated" },
    { value: int(stats.lab_picks), label: "picks on record" },
    { value: int(stats.packages), label: "match packages" },
  ];
  return (
    <dl className="flex flex-wrap items-start justify-center gap-x-16 gap-y-8">
      {cells.map((c) => (
        <div key={c.label} className="text-center">
          <dd className="font-display text-[32px] leading-none font-semibold text-ink">{c.value}</dd>
          <dt className="mt-2 text-[13px] text-mid-gray">{c.label}</dt>
        </div>
      ))}
    </dl>
  );
}

async function AmberBand() {
  await connection();
  const stats = landingStats();
  return (
    <p className="font-display text-4xl font-semibold tracking-[-0.01em] text-accent-ink sm:text-5xl">
      {int(stats.lab_picks)} picks on record.
    </p>
  );
}

async function HowItWorks() {
  await connection();
  const stats = landingStats();
  const steps: { line: string; support: string }[] = [
    {
      line: "Data refreshes every 12 hours.",
      support: "Results, fixtures and closing odds come in from football-data.co.uk.",
    },
    {
      line: "The model prices every outcome.",
      support: "Win, draw, goals and both-teams markets, from a calibrated score model.",
    },
    {
      line: "The strongest picks are graded A.",
      support: `Grades come from ${int(stats.lab_picks)} graded picks — A is the band that held up best.`,
    },
  ];
  return (
    <div className="mt-12 grid gap-10 md:grid-cols-3 md:gap-12">
      {steps.map((s, i) => (
        <Reveal key={s.line} delay={i * 0.08}>
          <p className="font-display text-lg font-semibold text-accent">{i + 1}</p>
          <h3 className="mt-3 text-xl leading-snug font-medium text-ink">{s.line}</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-mid-gray">{s.support}</p>
        </Reveal>
      ))}
    </div>
  );
}

async function RecordTable() {
  await connection();
  const ledger = ledgerStats();
  if (ledger.by_grade.length === 0) {
    return (
      <EmptyState
        title="No picks on record yet"
        note="The graded record appears here once the ledger has run."
      />
    );
  }
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left">
          <thead>
            <tr>
              {["Grade", "Promised", "Actual", "Picks"].map((h, i) => (
                <th
                  key={h}
                  className={`pb-3 text-[13px] font-normal text-mid-gray ${i > 0 ? "text-right" : ""}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ledger.by_grade.map((g) => (
              <tr key={g.grade} className="border-t border-hairline/60">
                <td className="py-3.5">
                  <GradeMark grade={g.grade} className="text-lg" />
                </td>
                <td className="tabular-nums py-3.5 text-right text-[15px]">{pct(g.claimed)}</td>
                <td className="tabular-nums py-3.5 text-right text-[15px] font-medium text-ink">
                  {pct(g.hit_rate)}
                </td>
                <td className="tabular-nums py-3.5 text-right text-[15px]">{int(g.n)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ledger.live_resolved === 0 && (
        <p className="mt-4 text-sm text-mid-gray">Live picks are still being graded.</p>
      )}
      <p className="mt-6">
        <Link href="/bukti" className="text-[15px] font-medium text-ink transition-colors hover:text-accent">
          See the full record <span className="text-accent">→</span>
        </Link>
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- page */

export default function LandingPage() {
  return (
    <div className="flex min-h-full flex-col bg-canvas text-ink">
      <TopBar />

      <main id="main-content" className="flex-1">
        {/* ------------------------------------------------------- HERO */}
        <section className="mx-auto w-full max-w-[76rem] px-6 pt-16 pb-20 sm:pt-20">
          <div className="mx-auto max-w-3xl text-center">
            <Reveal>
              <h1 className="font-display text-[clamp(2.5rem,5.5vw,4.5rem)] leading-[1.05] font-semibold tracking-[-0.02em] text-ink">
                Know your odds.
              </h1>
            </Reveal>
            <Reveal delay={0.08}>
              <p className="mt-5 text-lg leading-relaxed text-mid-gray">
                Match probabilities, checked against 45,866 past games.
              </p>
            </Reveal>
            <Reveal delay={0.16}>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
                <Link href="/pertandingan" className="text-[15px] font-medium text-ink transition-colors hover:text-accent">
                  See matches <span className="text-accent">→</span>
                </Link>
                <Link href="/pilihan" className="text-[15px] font-medium text-mid-gray transition-colors hover:text-ink">
                  Build a parlay <span className="text-accent">→</span>
                </Link>
              </div>
            </Reveal>
          </div>

          <Reveal delay={0.2}>
            <div className="mt-6">
              <Suspense
                fallback={
                  <div className="flex h-[52vh] max-h-[540px] min-h-[340px] items-center justify-center">
                    <p className="text-sm text-mid-gray">Loading the ball…</p>
                  </div>
                }
              >
                <HeroFigure />
              </Suspense>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="mt-14">
              <Suspense
                fallback={<p className="text-center text-sm text-mid-gray">Loading…</p>}
              >
                <StatsRow />
              </Suspense>
            </div>
          </Reveal>
        </section>

        {/* ------------------------------------------------- AMBER BAND */}
        <section className="bg-accent">
          <div className="mx-auto w-full max-w-[76rem] px-6 py-16 text-center sm:py-20">
            <Suspense fallback={null}>
              <AmberBand />
            </Suspense>
          </div>
        </section>

        {/* ------------------------------------------------ HOW IT WORKS */}
        <section className="mx-auto w-full max-w-[76rem] px-6 py-24 sm:py-28">
          <Reveal>
            <SectionHead label="How it works" />
          </Reveal>
          <Suspense fallback={null}>
            <HowItWorks />
          </Suspense>
        </section>

        {/* ------------------------------------------------- THE RECORD */}
        <section className="mx-auto w-full max-w-[76rem] px-6 py-24 sm:py-28">
          <Reveal>
            <SectionHead label="The record" />
          </Reveal>
          <Reveal delay={0.08}>
            <div className="mt-10">
              <Suspense
                fallback={<EmptyState title="Loading the record…" note="Reading the pick ledger." />}
              >
                <RecordTable />
              </Suspense>
            </div>
          </Reveal>
        </section>

        {/* ------------------------------------------------ GOOD TO KNOW */}
        <section className="mx-auto w-full max-w-[76rem] px-6 py-24 sm:py-28">
          <Reveal>
            <SectionHead label="Good to know" />
          </Reveal>
          <Reveal delay={0.08}>
            <div className="mt-10 max-w-2xl space-y-6">
              <p className="text-base leading-relaxed text-ink-soft">
                An 80% pick still misses about 20 times in 100. These numbers weigh the odds — the
                call is always yours.
              </p>
              <p className="text-base leading-relaxed text-ink-soft">
                Some leagues are only partly calibrated, and cup competitions use a separate offset
                model. Every match page says which.
              </p>
            </div>
          </Reveal>
        </section>
      </main>

      {/* ---------------------------------------------------------- FOOTER */}
      <footer>
        <div className="mx-auto flex w-full max-w-[76rem] flex-col gap-2 px-6 py-12 sm:flex-row sm:items-baseline sm:justify-between">
          <p className="text-[15px]">
            <span className="font-display font-semibold text-ink">Pilihan Aman</span>
            <span className="text-mid-gray"> · Data refreshes every 12 hours.</span>
          </p>
          <p className="text-[13px] text-faint">Probabilities, on record.</p>
        </div>
      </footer>
    </div>
  );
}
