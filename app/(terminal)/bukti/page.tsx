/**
 * THE RECORD — the open ledger of every pick and its result.
 *
 * Pure Server Component, read-only from the ledger (ledgerStats). The
 * page's principle: picks are logged BEFORE kick-off and graded on the
 * final score — nothing is deleted, moved, or rewritten afterwards.
 * The main tables are the lab record itself — every lab candidate and
 * its result. Live picks (issued from real slates) follow below, once
 * any of them have finished.
 */
import { Suspense } from "react";
import { GradeMark, PageLoading, Prob, SectionHead } from "../../../components/ui";
import { connection } from "next/server";
import { landingStats, ledgerStats } from "../../../lib/web/data";
import { MARKET_LABEL, int, jamWibOnly, labelPilihan, pct, tanggalWib } from "../../../lib/web/format";

const TH = "pb-3 text-left text-[13px] font-normal text-mid-gray";
const THR = "pb-3 text-right text-[13px] font-normal text-mid-gray";
const TD = "py-3 text-mid-gray";
const TDR = "py-3 text-right tabular-nums text-mid-gray";

export default function BuktiPage() {
  return (
    <Suspense fallback={<PageLoading label="Loading the record…" />}>
      <BuktiContent />
    </Suspense>
  );
}

async function BuktiContent() {
  await connection();
  const s = ledgerStats();
  const landing = landingStats();
  const labAllGraded = landing.lab_resolved >= landing.lab_picks;

  return (
    <div>
      <header>
        <h1 className="font-display text-[2.5rem] leading-tight font-semibold tracking-[-0.02em] text-ink">
          The record
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-mid-gray">
          Every pick is logged before kick-off and graded on the final score. Nothing gets edited.
        </p>
      </header>

      <section className="mt-12 flex flex-wrap gap-x-16 gap-y-8" aria-label="Ledger summary">
        <div>
          <p className="tabular-nums font-display text-[32px] leading-none font-semibold text-ink">
            {int(s.lab_total)}
          </p>
          <p className="mt-2 text-[13px] text-mid-gray">
            Lab picks · {labAllGraded ? "all graded" : `${int(landing.lab_resolved)} graded`}
          </p>
        </div>
        <div>
          <p className="tabular-nums font-display text-[32px] leading-none font-semibold text-ink">
            {int(s.live_total)}
          </p>
          <p className="mt-2 text-[13px] text-mid-gray">
            Live picks · {int(s.live_resolved)} graded
          </p>
        </div>
      </section>

      <section className="mt-16" aria-label="Record by grade">
        <SectionHead label="By grade" />
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr>
                <th className={TH}>Grade</th>
                <th className={THR}>Promised</th>
                <th className={THR}>Actual</th>
                <th className={THR}>Picks</th>
              </tr>
            </thead>
            <tbody>
              {s.lab_by_grade.map((g) => (
                <tr key={g.grade} className="border-t border-hairline/50">
                  <td className={TD}>
                    <GradeMark grade={g.grade} className="text-base" />
                  </td>
                  <td className={TDR}>
                    <Prob value={g.claimed} />
                  </td>
                  <td className={`${TDR} font-medium text-ink`}>
                    <Prob value={g.hit_rate} />
                  </td>
                  <td className={TDR}>{int(g.n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-faint">
          Promised is the average probability the model claimed; Actual is how often the picks
          actually landed. Grades come from the lab&apos;s per-market table —{" "}
          {int(s.lab_by_grade.reduce((a, g) => a + g.n, 0))} of the {int(s.lab_total)} lab
          candidates carry a grade; the rest sit below the lowest grade floor. The market
          table below uses the same graded candidates.
        </p>
      </section>

      <section className="mt-16" aria-label="Record by market">
        <SectionHead label="By market" />
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr>
                <th className={TH}>Market</th>
                <th className={THR}>Promised</th>
                <th className={THR}>Actual</th>
                <th className={THR}>Picks</th>
              </tr>
            </thead>
            <tbody>
              {s.lab_by_market.map((m) => (
                <tr key={m.market} className="border-t border-hairline/50">
                  <td className={`${TD} text-ink`}>{MARKET_LABEL[m.market] ?? m.market}</td>
                  <td className={TDR}>
                    <Prob value={m.claimed} />
                  </td>
                  <td className={`${TDR} font-medium text-ink`}>
                    <Prob value={m.hit_rate} />
                  </td>
                  <td className={TDR}>{int(m.n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-16" aria-label="Live picks">
        <SectionHead label="Live picks" />
        {s.live_resolved === 0 ? (
          <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-mid-gray">
            No live picks have finished yet.
          </p>
        ) : (
          <>
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr>
                    <th className={TH}>Grade</th>
                    <th className={THR}>Promised</th>
                    <th className={THR}>Actual</th>
                    <th className={THR}>Picks</th>
                  </tr>
                </thead>
                <tbody>
                  {s.by_grade.map((g) => (
                    <tr key={g.grade} className="border-t border-hairline/50">
                      <td className={TD}>
                        <GradeMark grade={g.grade} className="text-base" />
                      </td>
                      <td className={TDR}>
                        <Prob value={g.claimed} />
                      </td>
                      <td className={`${TDR} font-medium text-ink`}>
                        <Prob value={g.hit_rate} />
                      </td>
                      <td className={TDR}>{int(g.n)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {s.live_resolved < 100 && (
              <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-faint">
                The live sample is still small (n={int(s.live_resolved)}) — read it as an early
                direction, not a verdict.
              </p>
            )}
            {s.recent_resolved.length > 0 && (
              <>
                <div className="mt-12">
                  <SectionHead label="Recently graded" />
                </div>
                <ul className="mt-6">
            {s.recent_resolved.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-hairline/50 py-3.5 first:border-t-0"
              >
                <span className="font-mono text-[11px] text-faint">
                  {tanggalWib(p.kickoff_utc)} · {jamWibOnly(p.kickoff_utc)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-ink">
                    {p.home} <span className="text-faint">vs</span> {p.away}
                  </span>
                  <span className="block truncate text-[13px] text-mid-gray">
                    {labelPilihan(p.market, p.selection, p.home, p.away)} · Promised{" "}
                    {pct(p.model_prob)}
                  </span>
                </span>
                <GradeMark grade={p.grade} />
                <span className="tabular-nums text-[15px] text-ink">
                  {p.home_goals ?? "–"}–{p.away_goals ?? "–"}
                </span>
                <span
                  className={`w-10 text-right text-[13px] font-medium ${
                    p.hit === 1 ? "text-sage" : "text-brick"
                  }`}
                >
                  {p.hit === 1 ? "Hit" : "Miss"}
                </span>
              </li>
            ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
