/**
 * PILIHAN AMAN — susun slip parlay dari pilihan probabilitas tertinggi.
 *
 * Server Component: membaca ledger live-run (listSafePicks) + matriks
 * skor paket yang benar-benar muncul di daftar (getPackageMatrix),
 * lalu menyerahkan interaksi ke ParlayBuilder (client). Matriks 11x11
 * per paket ~2,7 KB JSON; hanya paket milik pilihan di halaman ini
 * yang dikirim, bukan seluruh katalog.
 */
import { Suspense } from "react";
import { connection } from "next/server";
import ParlayBuilder, { type BuilderPick } from "../../../components/pilihan/ParlayBuilder";
import { MicroLabel, PageLoading } from "../../../components/ui";
import { getPackageMatrix, listSafePicks } from "../../../lib/web/data";

export default function PilihanPage() {
  return (
    <Suspense fallback={<PageLoading label="Memuat pilihan aman…" />}>
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
    prob: p.model_prob,
    sourcesAgree: p.sources_agree,
    packageId: p.package_id,
  }));

  return (
    <div>
      <header className="mb-6">
        <MicroLabel>Terminal / Pilihan Aman</MicroLabel>
        <h1 className="mt-1 font-display text-4xl font-bold tracking-wide text-ink">
          PILIHAN <span className="text-accent">AMAN</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-mid-gray">
          Pilihan probabilitas tertinggi dari ledger live-run, tercatat sebelum kickoff. Centang
          untuk menyusun slip — gabungannya dihitung dari matriks skor pertandingan, bukan
          sekadar dikalikan mentah.
        </p>
      </header>

      <ParlayBuilder picks={builderPicks} matrices={matrices} />
    </div>
  );
}
