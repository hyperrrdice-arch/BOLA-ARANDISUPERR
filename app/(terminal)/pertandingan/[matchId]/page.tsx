/**
 * MATCH ANALYSIS — one full quant package per match: probabilities from
 * three sources, the score matrix, where the numbers come from, recent
 * form, goals vs xG, and the picks recorded for it with their results.
 * Presentation only — every figure comes from the stored package.
 */
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getMatchDetail, type FormEntry, type PickRow } from "@/lib/web/data";
import {
  GATE_LABEL,
  labelPilihan,
  num,
  pct,
  tanggalJamWib,
  tanggalWib,
} from "@/lib/web/format";
import {
  EmptyState,
  FormChips,
  GateStatus,
  GradeMark,
  PageLoading,
  Prob,
  SectionHead,
  heatStyle,
} from "@/components/ui";

/* ------------------------------------------------------------ luck types */

interface LuckSide {
  status: string;
  net_luck_rating: number;
  sample_size: number;
  total_goals_for: number;
  total_xg_for: number;
  total_goals_against: number;
  total_xg_against: number;
}
interface LuckMetrics {
  home: LuckSide;
  away: LuckSide;
  luck_disparity: number;
  market_bias_warning: string | null;
}

const LUCK_LABEL: Record<string, string> = {
  OVERPERFORMING: "Overperforming",
  UNDERPERFORMING: "Underperforming",
  NEUTRAL: "In line",
  INSUFFICIENT_DATA: "Not enough data",
};

/* ------------------------------------------------------- probability rows */

const PROB_ROWS: { market: string; selection: string }[] = [
  { market: "1x2", selection: "1" },
  { market: "1x2", selection: "x" },
  { market: "1x2", selection: "2" },
  { market: "dc", selection: "1x" },
  { market: "dc", selection: "12" },
  { market: "dc", selection: "x2" },
  { market: "ou15", selection: "over" },
  { market: "ou15", selection: "under" },
  { market: "ou25", selection: "over" },
  { market: "ou25", selection: "under" },
  { market: "ou35", selection: "over" },
  { market: "ou35", selection: "under" },
  { market: "btts", selection: "yes" },
  { market: "btts", selection: "no" },
  { market: "team_over05_home", selection: "yes" },
  { market: "team_over05_away", selection: "yes" },
];

const GATE_SENTENCE: Record<string, string> = {
  calibrated: "This league passed calibration checks on held-out matches.",
  partial: "This league is partly calibrated — treat its numbers with care.",
  uncalibrated: "This league has not passed calibration checks yet.",
};

function signed(n: number, digits = 2): string {
  const s = num(Math.abs(n), digits);
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${s}`;
}

/** Plain-English serving note from the structured resolution fields
 *  (the stored note itself is pipeline prose, so it is not printed). */
function resolutionSentence(
  lr: { fitSystem?: string; via?: string } | undefined,
): string | null {
  if (!lr) return null;
  if (lr.via === "cup-offset") return "This fixture is served by the global cup offset model.";
  switch (lr.fitSystem) {
    case "sportmonks":
      return "This fixture is served by the Sportmonks fit for its league.";
    case "legacy-div":
      return "This fixture is served by the legacy divisional fit for its league.";
    case "special":
      return "This fixture is served by a dedicated fit for its competition.";
    default:
      return null;
  }
}

/* ------------------------------------------------------------------- page */

export default function AnalisisPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  return (
    <Suspense fallback={<PageLoading label="Loading match analysis…" />}>
      <AnalisisContent params={params} />
    </Suspense>
  );
}

async function AnalisisContent({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  await connection();
  const detail = getMatchDetail(matchId);
  if (!detail) notFound();

  const { pkg, picks, result, formHome, formAway } = detail;
  const p = pkg.payload;
  const f = p.fixture;
  const home = f.home;
  const away = f.away;

  const resolved = picks.filter((x) => x.hit !== null);
  const hits = resolved.filter((x) => x.hit === 1).length;

  const luck = (p.shrunk_metadata?.luckMetrics ?? null) as LuckMetrics | null;
  const feedMode = (p as unknown as { feed_mode?: string }).feed_mode;
  const resolution = resolutionSentence(p.shrunk_metadata?.leagueResolution);

  const matrix = p.score_matrix ?? [];
  const cut = matrix.slice(0, 6).map((row) => row.slice(0, 6));
  const maxCell = cut.reduce((m, row) => row.reduce((a, v) => Math.max(a, v), m), 0);

  const spreadRows = PROB_ROWS.map(({ market, selection }) => {
    const key = `${market}:${selection}`;
    const mv = p.probabilities[key] ?? null;
    const kv = p.market?.probs[key] ?? null;
    const sv = p.sm_panel?.probs[key] ?? null;
    const present = [mv, kv, sv].filter((v): v is number => v !== null);
    const spread = present.length >= 2 ? Math.max(...present) - Math.min(...present) : 0;
    return { market, selection, key, mv, kv, sv, spread };
  });
  const disagreeCount = spreadRows.filter((r) => r.spread > 0.1).length;

  return (
    <div>
      <Link
        href="/pertandingan"
        className="text-sm text-mid-gray transition-colors hover:text-ink"
      >
        ← Matches
      </Link>

      {/* ---------------------------------------------------------- header */}
      <header className="mt-8">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-mid-gray">
          <GateStatus status={pkg.gate_status} withLabel={false} />
          <span>{f.competition_name}</span>
          <span aria-hidden="true">·</span>
          <span>{GATE_LABEL[pkg.gate_status] ?? pkg.gate_status}</span>
        </p>
        <h1 className="mt-3 font-display text-[32px] leading-tight font-semibold tracking-[-0.01em] text-ink sm:text-4xl">
          {home} <span className="font-normal text-faint">vs</span> {away}
        </h1>
        <p className="mt-2.5 text-[15px] text-mid-gray">
          {tanggalJamWib(f.kickoff_utc)}
          {feedMode === "free" && <> · Free data mode</>}
        </p>
        {result?.finished && (
          <div className="mt-8">
            <p className="text-xl font-medium text-ink">
              Finished {home} {result.home_goals}–{result.away_goals} {away}.
            </p>
            {picks.length > 0 && (
              <p className="mt-1.5 text-sm text-mid-gray">
                {resolved.length > 0
                  ? `${hits} of ${resolved.length} picks from this package hit.`
                  : `${picks.length} picks recorded, none graded yet.`}
              </p>
            )}
          </div>
        )}
      </header>

      {/* --------------------------------------------------- three sources */}
      <section className="mt-16">
        <SectionHead label="Three sources" />
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[540px] text-sm">
            <thead>
              <tr>
                <th className="pb-3 text-left text-[13px] font-normal text-mid-gray">Pick</th>
                <th className="pb-3 text-right text-[13px] font-normal text-mid-gray">Model</th>
                <th className="pb-3 text-right text-[13px] font-normal text-mid-gray">Market</th>
                <th className="pb-3 text-right text-[13px] font-normal text-mid-gray">Sportmonks</th>
              </tr>
            </thead>
            <tbody>
              {spreadRows.map((r) => {
                const hot = r.spread > 0.1;
                const present = [r.mv, r.kv, r.sv].filter((v): v is number => v !== null);
                const hi = hot ? Math.max(...present) : null;
                const lo = hot ? Math.min(...present) : null;
                const cls = (v: number | null) =>
                  hot && v !== null && (v === hi || v === lo) ? "font-semibold text-accent" : "";
                return (
                  <tr key={r.key} className="border-t border-hairline/50">
                    <td className="py-2 pr-3 text-ink-soft">
                      {labelPilihan(r.market, r.selection, home, away)}
                    </td>
                    <td className={`py-2 px-3 text-right ${cls(r.mv)}`}>
                      <Prob value={r.mv} />
                    </td>
                    <td className={`py-2 px-3 text-right ${cls(r.kv)}`}>
                      <Prob value={r.kv} />
                    </td>
                    <td className={`py-2 pl-3 text-right ${cls(r.sv)}`}>
                      <Prob value={r.sv} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-4 space-y-1.5 text-[13px] leading-relaxed text-faint">
          {disagreeCount > 0 && (
            <p>Sources disagree by more than 10 points on {disagreeCount} picks.</p>
          )}
          {p.market ? (
            <p>
              Market odds captured {tanggalJamWib(p.market.captured_utc)}
              {p.market.bookmakers.length > 0 && <> · {p.market.bookmakers.join(", ")}</>}.
            </p>
          ) : (
            <p>No market odds captured for this match.</p>
          )}
          {p.sm_panel ? (
            <p>Sportmonks panel {tanggalJamWib(p.sm_panel.batch_utc)}.</p>
          ) : (
            <p>No Sportmonks panel for this match.</p>
          )}
        </div>
      </section>

      <div className="mt-16 grid gap-16 lg:grid-cols-2">
        {/* ------------------------------------------------- likely scores */}
        <section>
          <SectionHead label="Likely scores" sub="Home goals down, away goals across." />
          {cut.length === 0 ? (
            <p className="mt-6 text-sm text-faint">No score matrix stored in this package.</p>
          ) : (
            <>
              <table className="mt-6 border-collapse">
                <thead>
                  <tr>
                    <th className="h-9 w-8" />
                    {cut[0].map((_, j) => (
                      <th key={j} className="h-9 w-12 font-mono text-xs font-normal text-mid-gray sm:w-14">
                        {j}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cut.map((row, i) => (
                    <tr key={i}>
                      <th className="h-10 w-8 font-mono text-xs font-normal text-mid-gray">{i}</th>
                      {row.map((v, j) => (
                        <td
                          key={j}
                          style={heatStyle(v, maxCell)}
                          className="h-10 w-12 rounded-[3px] text-center font-mono text-[11px] tabular-nums sm:w-14"
                        >
                          {pct(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <ol className="mt-6 space-y-1.5">
                {(p.top_scores ?? []).slice(0, 5).map((s, i) => (
                  <li key={i} className="flex items-baseline gap-3 text-sm">
                    <span className="w-4 text-faint">{i + 1}.</span>
                    <span className="font-medium text-ink">
                      {s.home_goals}–{s.away_goals}
                    </span>
                    <span className="tabular-nums text-mid-gray">{pct(s.prob)}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-4 text-[13px] text-faint">
                Shown 0–5 goals per side, from the full 11×11 matrix.
              </p>
            </>
          )}
        </section>

        {/* ------------------------------------------- about these numbers */}
        <section>
          <SectionHead label="About these numbers" />
          <div className="mt-6 space-y-3.5 text-[15px] leading-relaxed text-ink-soft">
            <p>
              Expected goals <span className="tabular-nums">{num(p.lambda)}</span> –{" "}
              <span className="tabular-nums">{num(p.mu)}</span>. Correlation{" "}
              <span className="tabular-nums">{num(p.rho)}</span>.
            </p>
            <p>
              Ratings from <span className="font-mono text-[13px]">{pkg.fit_source}</span>.
            </p>
            {pkg.cup_delta !== null && (
              <p>
                Cup match: league offset{" "}
                <span className="tabular-nums">{signed(pkg.cup_delta, 3)}</span> applied.
              </p>
            )}
            <p>{GATE_SENTENCE[pkg.gate_status] ?? GATE_SENTENCE.uncalibrated}</p>
            {resolution && <p>{resolution}</p>}
            <p className="text-mid-gray">Calculated {tanggalJamWib(pkg.computed_utc)}.</p>
          </div>
        </section>
      </div>

      {/* --------------------------------------------------------- last six */}
      <section className="mt-16">
        <SectionHead label="Last six" />
        <div className="mt-8 grid gap-12 md:grid-cols-2">
          {[
            { name: home, form: formHome },
            { name: away, form: formAway },
          ].map(({ name, form }) => {
            const gf = form.reduce((a, e) => a + e.goals_for, 0);
            const ga = form.reduce((a, e) => a + e.goals_against, 0);
            return (
              <div key={name}>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-display text-lg font-semibold text-ink">{name}</span>
                  <FormChips form={form} />
                </div>
                {form.length > 0 && (
                  <>
                    <p className="mt-2 text-[13px] text-mid-gray">
                      Scored {gf} · Conceded {ga}
                    </p>
                    <ul className="mt-4 space-y-2 text-sm">
                      {form.map((e: FormEntry, i: number) => (
                        <li key={i} className="flex items-baseline gap-2.5 text-ink-soft">
                          <span className="w-[5.5rem] shrink-0 font-mono text-[11px] text-faint">
                            {tanggalWib(e.date)}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {e.venue === "home" ? "vs" : "at"} {e.opponent}
                          </span>
                          <span className="tabular-nums">
                            {e.goals_for}–{e.goals_against}
                          </span>
                          {e.xg_for !== null && e.xg_against !== null && (
                            <span className="tabular-nums text-[11px] text-faint">
                              xG {num(e.xg_for)}–{num(e.xg_against)}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ------------------------------------------------------------ luck */}
      {luck && (
        <section className="mt-16">
          <SectionHead label="Goals vs expected goals (xG)" />
          <div className="mt-8 grid gap-12 md:grid-cols-2">
            {[
              { name: home, side: luck.home },
              { name: away, side: luck.away },
            ].map(({ name, side }) => (
              <div key={name}>
                {side.status === "INSUFFICIENT_DATA" ? (
                  <p className="text-[15px] text-ink-soft">{name}: not enough xG data yet.</p>
                ) : (
                  <>
                    <p className="text-[15px] text-ink-soft">
                      {name}: <span className="tabular-nums">{signed(side.net_luck_rating)}</span>{" "}
                      per game vs xG — {LUCK_LABEL[side.status] ?? side.status}.
                    </p>
                    <p className="mt-2 text-[13px] leading-relaxed text-faint">
                      Across {side.sample_size} games: scored {side.total_goals_for} on{" "}
                      {num(side.total_xg_for)} xG, conceded {side.total_goals_against} on{" "}
                      {num(side.total_xg_against)} xG against.
                    </p>
                  </>
                )}
              </div>
            ))}
          </div>
          {luck.market_bias_warning && (
            <p className="mt-8 max-w-2xl text-[15px] leading-relaxed text-ink-soft">
              Note: {home} are {(LUCK_LABEL[luck.home.status] ?? "").toLowerCase()} against xG
              while {away} are {(LUCK_LABEL[luck.away.status] ?? "").toLowerCase()} — recent
              results and the numbers disagree here.
            </p>
          )}
        </section>
      )}

      {/* ---------------------------------------------------- package picks */}
      <section className="mt-16">
        <SectionHead
          label="Picks from this package"
          right={<span className="text-[13px] text-faint">{picks.length} on record</span>}
        />
        {picks.length === 0 ? (
          <EmptyState
            title="No picks recorded for this package"
            note="This package was calculated before the pick engine wrote to the ledger, or no pick cleared the grade threshold."
          />
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr>
                  <th className="pb-3 text-left text-[13px] font-normal text-mid-gray">Grade</th>
                  <th className="pb-3 text-left text-[13px] font-normal text-mid-gray">Pick</th>
                  <th className="pb-3 text-right text-[13px] font-normal text-mid-gray">Model</th>
                  <th className="pb-3 text-right text-[13px] font-normal text-mid-gray">Market</th>
                  <th className="pb-3 text-right text-[13px] font-normal text-mid-gray">Sportmonks</th>
                  <th className="pb-3 text-right text-[13px] font-normal text-mid-gray">Result</th>
                </tr>
              </thead>
              <tbody>
                {picks.map((pk: PickRow) => (
                  <tr key={pk.id} className="border-t border-hairline/50">
                    <td className="py-2.5 pr-3">
                      <GradeMark grade={pk.grade} />
                    </td>
                    <td className="py-2.5 px-3 text-ink-soft">
                      {labelPilihan(pk.market, pk.selection, home, away)}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <Prob value={pk.model_prob} strong={pk.grade === "A"} />
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <Prob value={pk.market_prob} />
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <Prob value={pk.sm_prob} />
                    </td>
                    <td className="py-2.5 pl-3 text-right">
                      {pk.hit === 1 ? (
                        <span className="text-[13px] font-medium text-sage">Hit</span>
                      ) : pk.hit === 0 ? (
                        <span className="text-[13px] font-medium text-brick">Miss</span>
                      ) : (
                        <span className="text-[13px] text-faint">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
