/**
 * PILIHAN — susun gabungan dari pilihan RESMI pra-laga.
 *
 * Server Component: membaca pilihan resmi yang diterbitkan jalur
 * publikasi K2 (daftarPilihanPraLaga — pick_uid terisi, peluang terbit
 * beku, belum sepak mula) plus matriks skor paket yang benar-benar ada
 * di halaman, lalu menyerahkan interaksi ke ParlayBuilder (klien).
 * Angka builder adalah peluang SAAT TERBIT, bukan analisis terbaru.
 * Slip yang disusun di sini adalah draf pengguna — tidak masuk rekam
 * hasil resmi (D4); tiket resmi hidup di /bukti.
 */
import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import ParlayBuilder, { type BuilderPick } from "../../../components/pilihan/ParlayBuilder";
import { PageLoading } from "../../../components/ui";
import { getPackageMatrix } from "../../../lib/web/data";
import { daftarPilihanPraLaga } from "../../../lib/web/rekam";

export const metadata: Metadata = { title: "Pilihan pra-laga | Bola" };

export default function PilihanPage() {
  return (
    <Suspense fallback={<PageLoading label="Memuat pilihan…" />}>
      <PilihanContent />
    </Suspense>
  );
}

async function PilihanContent() {
  await connection();
  const picks = daftarPilihanPraLaga(new Date().toISOString());

  const packageIds = new Set<number>();
  for (const p of picks) if (p.package_id !== null) packageIds.add(p.package_id);
  const matrices: Record<number, number[][]> = {};
  for (const pid of packageIds) {
    const m = getPackageMatrix(pid);
    if (m) matrices[pid] = m;
  }

  const builderPicks: BuilderPick[] = picks.map((p) => ({
    key: p.pick_uid,
    matchId: p.match_id,
    fixtureUid: p.fixture_uid,
    kickoffUtc: p.kickoff_utc,
    home: p.home,
    away: p.away,
    competitionName: p.competition_name,
    gateStatus: p.gate_status,
    grade: p.grade,
    market: p.market,
    selection: p.selection,
    // Peluang builder = peluang SAAT TERBIT (beku K2). Basisnya memetakan
    // basis terbit: effective → koreksi lab yang dibekukan ("lab"),
    // model → peluang model saat terbit ("model").
    prob: p.published_prob,
    probBasis: p.probability_basis === "effective" ? "lab" : "model",
    basisTerbit: p.probability_basis,
    publishedAtUtc: p.published_at_utc,
    modelProb: p.model_prob,
    sourcesAgree: p.sources_agree,
    packageId: p.package_id,
  }));

  return (
    <div>
      <header className="mb-10">
        <h1 className="font-display text-[2.5rem] leading-tight font-semibold tracking-[-0.02em] text-ink">
          Pilihan pra-laga
        </h1>
        <p className="mt-2 text-[15px] text-mid-gray">
          Peluang resmi saat terbit, digabung persis dari matriks skor.
        </p>
      </header>

      <ParlayBuilder picks={builderPicks} matrices={matrices} />
    </div>
  );
}
