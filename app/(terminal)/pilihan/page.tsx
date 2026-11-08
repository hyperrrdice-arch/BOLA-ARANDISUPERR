/**
 * PICKS — build a parlay slip from the highest-probability picks.
 *
 * Server Component: reads the live-run ledger (listSafePicks) plus the
 * score matrices of the packages actually on the page (getPackageMatrix),
 * then hands interaction to ParlayBuilder (client). An 11x11 matrix is
 * ~2.7 KB of JSON; only packages behind these picks are sent.
 */
import { Suspense } from "react";
import { connection } from "next/server";
import ParlayBuilder, { type BuilderPick } from "../../../components/pilihan/ParlayBuilder";
import { PageLoading } from "../../../components/ui";
import { getPackageMatrix, listSafePicks } from "../../../lib/web/data";

export default function PilihanPage() {
  return (
    <Suspense fallback={<PageLoading label="Loading picks…" />}>
      <PilihanContent />
    </Suspense>
  );
}

async function PilihanContent() {
  await connection();
  const picks = listSafePicks(300);

  const packageIds = new Set<number>();
  for (const p of picks) if (p.package_id !== null) packageIds.add(p.package_id);
  const matrices: Record<number, number[][]> = {};
  for (const pid of packageIds) {
    const m = getPackageMatrix(pid);
    if (m) matrices[pid] = m;
  }

  const builderPicks: BuilderPick[] = picks.map((p) => ({
    key: `pick-${p.id}`,
    matchId: p.match_id,
    kickoffUtc: p.kickoff_utc,
    home: p.home,
    away: p.away,
    competitionName: p.competition_name,
    gateStatus: p.gate_status,
    grade: p.grade,
    market: p.market,
    selection: p.selection,
    // Builder memakai probabilitas EFEKTIF (koreksi lab) bila kolomnya ada;
    // model mentah hanya jadi cadangan, dan basisnya dinyatakan eksplisit
    // lewat probBasis (audit T3 — sebelumnya baris ini selalu model_prob
    // mentah walau antarmuka menjanjikan angka efektif).
    prob: p.effective_prob ?? p.model_prob,
    probBasis: p.effective_source === "lab-band" ? "lab" : "model",
    modelProb: p.model_prob,
    sourcesAgree: p.sources_agree,
    packageId: p.package_id,
  }));

  return (
    <div>
      <header className="mb-10">
        <h1 className="font-display text-[2.5rem] leading-tight font-semibold tracking-[-0.02em] text-ink">
          Build your parlay.
        </h1>
        <p className="mt-2 text-[15px] text-mid-gray">
          Combined probability, from the score matrix.
        </p>
      </header>

      <ParlayBuilder picks={builderPicks} matrices={matrices} />
    </div>
  );
}
