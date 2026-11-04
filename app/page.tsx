/**
 * LANDING — "Pilihan Aman" (Editorial Terminal / Amber Panas).
 *
 * Kerangka halaman statis (Cache Components); angka dibaca di pulau-pulau
 * async di dalam <Suspense> agar selalu segar dari lapis baca-saja
 * lib/web/data.ts dan tidak membekukan prerender. Pulau client hanya dua:
 * objek 3D hero (lazy, ssr mati) dan Reveal GSAP.
 * Framing: alat bantu keyakinan — bukan tipster, bukan janji menang.
 */
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { landingStats, ledgerStats, listSafePicks, listUpcoming } from "../lib/web/data";
import { int, labelPilihan, pct } from "../lib/web/format";
import { GateStatus, MicroLabel, SectionHead, EmptyState } from "../components/ui";
import HeroScene from "../components/landing/HeroScene";
import Reveal from "../components/landing/Reveal";

const GRADE_TEXT: Record<string, string> = {
  A: "text-sage",
  B: "text-accent",
  C: "text-brick",
};

function fmtGap(gap: number | null): string {
  if (gap === null) return "—";
  const s = `${gap > 0 ? "+" : ""}${gap.toFixed(1)}`.replace(".", ",");
  return `${s} poin`;
}

/* ------------------------------------------------------------- pulau data */

async function HeroStats() {
  await connection();
  const stats = landingStats();
  const cells: { value: string; label: string }[] = [
    { value: int(stats.leagues_calibrated), label: "Liga terkalibrasi penuh" },
    {
      value: int(stats.lab_picks),
      label: `Pilihan lab teruji · ${int(stats.lab_resolved)} sudah beres`,
    },
    { value: int(stats.packages), label: "Paket analisis tersimpan" },
    { value: int(stats.upcoming), label: "Laga dalam 72 jam ke depan" },
  ];
  return (
    <dl className="grid grid-cols-2 gap-px border border-hairline bg-hairline lg:grid-cols-4">
      {cells.map((c) => (
        <div key={c.label} className="bg-paper px-4 py-3">
          <dd className="tabular-nums text-2xl font-semibold text-ink">{c.value}</dd>
          <dt className="mt-1">
            <MicroLabel>{c.label}</MicroLabel>
          </dt>
        </div>
      ))}
    </dl>
  );
}

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
        title="Matriks belum tersedia"
        note="Belum ada paket bermatriks skor pada jendela 72 jam ini."
      />
    );
  }
  const raw = featured.pkg.payload.score_matrix.slice(0, 6).map((r) => r.slice(0, 6));
  const max = Math.max(...raw.flat(), 0);
  const heroMatrix = max > 0 ? raw.map((r) => r.map((v) => v / max)) : raw;
  const fx = featured.pkg.payload.fixture;
  return (
    <figure className="flex h-full flex-col">
      <div className="relative min-h-[320px] flex-1 lg:min-h-[420px]">
        <HeroScene matrix={heroMatrix} home={fx.home} away={fx.away} />
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3">
        <span className="font-mono text-[11px] tracking-wider text-mid-gray">
          MATRIKS SKOR — {fx.home.toUpperCase()} VS {fx.away.toUpperCase()} ·{" "}
          {fx.competition_name.toUpperCase()}
        </span>
        <GateStatus status={featured.pkg.gate_status} />
      </figcaption>
    </figure>
  );
}

async function Ticker() {
  await connection();
  const tickerPicks = listSafePicks()
    .filter((p) => p.grade === "A" || p.grade === "B")
    .slice(0, 12);
  if (tickerPicks.length === 0) return null;
  return (
    <div
      className="overflow-hidden border-b border-hairline bg-well"
      aria-label="Pilihan grade A dan B mendatang"
    >
      <div className="ticker-track flex w-max items-center py-2.5">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex items-center" aria-hidden={copy === 1}>
            {tickerPicks.map((p) => (
              <span
                key={`${copy}-${p.id}`}
                className="flex items-center gap-2 px-5 font-mono text-xs whitespace-nowrap"
              >
                <span className="text-ink">
                  {p.home} vs {p.away}
                </span>
                <span className="text-faint">—</span>
                <span className="text-mid-gray">
                  {labelPilihan(p.market, p.selection, p.home, p.away)}{" "}
                  <span className="text-ink">{pct(p.model_prob)}</span>
                </span>
                <span className="text-faint">—</span>
                <span className={`font-bold ${GRADE_TEXT[p.grade] ?? "text-mid-gray"}`}>
                  GRADE {p.grade}
                </span>
                <span className="pl-3 text-accent">◆</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

async function BuktiTable() {
  await connection();
  const ledger = ledgerStats();
  if (ledger.by_grade.length === 0) {
    return (
      <EmptyState
        title="Ledger masih kosong"
        note="Belum ada pilihan live yang tercatat. Angka bukti tampil di sini begitu ledger berjalan."
      />
    );
  }
  return (
    <div className="overflow-x-auto border border-hairline bg-paper">
      <table className="w-full min-w-[640px] text-left">
        <thead>
          <tr className="border-b border-hairline">
            {["Grade", "Pilihan", "Beres", "Klaim model", "Kenyataan", "Selisih"].map((h) => (
              <th key={h} className="px-4 py-3">
                <MicroLabel>{h}</MicroLabel>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ledger.by_grade.map((g) => (
            <tr key={g.grade} className="border-b border-hairline last:border-b-0">
              <td className="px-4 py-3">
                <span className={`font-mono text-sm font-bold ${GRADE_TEXT[g.grade] ?? "text-mid-gray"}`}>
                  {g.grade}
                </span>
              </td>
              <td className="tabular-nums px-4 py-3 text-sm">{int(g.n)}</td>
              <td className="tabular-nums px-4 py-3 text-sm">{int(g.resolved)}</td>
              <td className="tabular-nums px-4 py-3 text-sm">{pct(g.claimed)}</td>
              <td className="tabular-nums px-4 py-3 text-sm font-semibold text-ink">
                {pct(g.hit_rate)}
              </td>
              <td
                className={`tabular-nums px-4 py-3 text-sm ${
                  g.gap_pp === null ? "text-faint" : g.gap_pp >= 0 ? "text-sage" : "text-brick"
                }`}
              >
                {fmtGap(g.gap_pp)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------- halaman */

export default function LandingPage() {
  return (
    <div className="flex min-h-full flex-col bg-canvas text-ink">
      {/* ---------------------------------------------------------- NAV */}
      <header className="border-b border-hairline">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="font-display text-xl font-bold tracking-[0.18em]">
            PILIHAN&nbsp;AMAN
          </Link>
          <nav className="hidden items-center gap-6 md:flex" aria-label="Utama">
            <Link href="/pertandingan" className="font-mono text-xs tracking-wider text-mid-gray transition-colors hover:text-ink">
              PERTANDINGAN
            </Link>
            <Link href="/pilihan" className="font-mono text-xs tracking-wider text-mid-gray transition-colors hover:text-ink">
              PILIHAN AMAN
            </Link>
            <Link href="/bukti" className="font-mono text-xs tracking-wider text-mid-gray transition-colors hover:text-ink">
              LEDGER BUKTI
            </Link>
          </nav>
          <Link
            href="/pertandingan"
            className="rounded-md bg-accent px-3.5 py-2 font-mono text-xs font-bold tracking-wider text-accent-ink transition-colors hover:bg-accent-deep hover:text-ink"
          >
            MASUK DASHBOARD
          </Link>
        </div>
      </header>

      <main id="konten-utama" className="flex-1">
        {/* ---------------------------------------------------------- HERO */}
        <section className="border-b border-hairline">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-12 lg:py-16">
            <div className="lg:col-span-7">
              <Reveal>
                <MicroLabel>Mesin probabilitas sepak bola — bukan tipster</MicroLabel>
              </Reveal>
              <Reveal delay={0.08}>
                <h1 className="mt-4 font-display text-[17vw] leading-[0.95] font-bold tracking-tight sm:text-7xl lg:text-[86px]">
                  PILIHAN <span className="text-accent">AMAN</span>,
                  <br />
                  BUKAN
                  <br />
                  TEBAKAN.
                </h1>
              </Reveal>
              <Reveal delay={0.16}>
                <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-soft">
                  Model kuantitatif deterministik membaca data pertandingan yang
                  bersih, menghitung probabilitas tiap hasil, lalu
                  membandingkannya lintas sumber. Yang ditampilkan adalah
                  pilihan dengan probabilitas kejadian tertinggi — lengkap
                  dengan catatan buktinya, bukan janji.
                </p>
              </Reveal>
              <Reveal delay={0.24}>
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <Link
                    href="/pertandingan"
                    className="rounded-md bg-accent px-5 py-3 font-mono text-sm font-bold tracking-wider text-accent-ink transition-colors hover:bg-accent-deep hover:text-ink"
                  >
                    LIHAT PERTANDINGAN
                  </Link>
                  <Link
                    href="/bukti"
                    className="rounded-md border border-hairline-strong px-5 py-3 font-mono text-sm font-bold tracking-wider text-ink transition-colors hover:border-accent hover:text-accent"
                  >
                    LIHAT BUKTI
                  </Link>
                </div>
              </Reveal>
              <Reveal delay={0.32}>
                <div className="mt-10">
                  <Suspense
                    fallback={
                      <div className="border border-hairline bg-paper px-4 py-6">
                        <MicroLabel>Memuat statistik…</MicroLabel>
                      </div>
                    }
                  >
                    <HeroStats />
                  </Suspense>
                </div>
              </Reveal>
            </div>

            <div className="lg:col-span-5">
              <Reveal delay={0.2} className="h-full">
                <Suspense
                  fallback={
                    <div className="flex min-h-[320px] items-center justify-center border border-hairline bg-paper lg:min-h-[420px]">
                      <MicroLabel>Memuat matriks skor…</MicroLabel>
                    </div>
                  }
                >
                  <HeroFigure />
                </Suspense>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- TICKER */}
        <Suspense fallback={null}>
          <Ticker />
        </Suspense>

        {/* ---------------------------------------------------------- CARA KERJA */}
        <section className="border-b border-hairline">
          <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:py-16">
            <Reveal>
              <SectionHead label="Cara kerja" />
            </Reveal>
            <div className="mt-6 grid gap-px border border-hairline bg-hairline md:grid-cols-3">
              {[
                {
                  n: "01",
                  title: "Data bersih, satu acuan",
                  body: "Semua sumber disatukan ke satu identitas resmi per tim, liga, dan pertandingan. Tidak ada hitungan ganda, tidak ada nama tim yang tertukar di tengah jalan.",
                },
                {
                  n: "02",
                  title: "Model terkalibrasi, diuji di luar sampel",
                  body: "Rating diuji ke pertandingan yang belum pernah dilihat model. Liga yang belum lulus uji tetap disajikan, tapi dilabeli apa adanya — gerbang kalibrasi di sini adalah label kejujuran, bukan pintu yang mengunci.",
                },
                {
                  n: "03",
                  title: "Pilihan bergrade dari bukti",
                  body: "Grade A/B/C lahir dari laboratorium ratusan ribu pilihan historis yang sudah beres: pasar dan pita probabilitas mana yang jujur, dan mana yang gradenya harus ditahan.",
                },
              ].map((c, i) => (
                <Reveal key={c.n} delay={i * 0.08} className="bg-paper">
                  <article className="h-full px-5 py-6">
                    <span className="tabular-nums text-sm font-semibold text-accent">{c.n}</span>
                    <h2 className="mt-3 font-display text-2xl font-semibold tracking-wide text-ink">
                      {c.title}
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-mid-gray">{c.body}</p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- BUKTI */}
        <section className="border-b border-hairline">
          <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:py-16">
            <Reveal>
              <SectionHead
                label="Bukti, bukan klaim"
                right={
                  <span className="font-mono text-[11px] tracking-wider text-faint">
                    PILIHAN LIVE YANG SUDAH SELESAI, DIBANDING KLAIM MODELNYA SENDIRI
                  </span>
                }
              />
            </Reveal>
            <Reveal delay={0.08}>
              <div className="mt-6">
                <Suspense fallback={<EmptyState title="Memuat ledger…" note="Menghitung klaim vs kenyataan dari ledger." />}>
                  <BuktiTable />
                </Suspense>
              </div>
            </Reveal>
            <Reveal delay={0.12}>
              <p className="mt-4 text-sm text-mid-gray">
                Selisih negatif berarti model mengklaim lebih tinggi daripada
                kenyataan — angka itu ditampilkan, bukan disembunyikan.{" "}
                <Link href="/bukti" className="font-mono text-xs font-bold tracking-wider text-accent hover:underline">
                  LIHAT LEDGER LENGKAP →
                </Link>
              </p>
            </Reveal>
          </div>
        </section>

        {/* ---------------------------------------------------------- KEJUJURAN */}
        <section className="border-b border-hairline">
          <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:py-16">
            <Reveal>
              <SectionHead label="Yang tidak dijanjikan" />
            </Reveal>
            <div className="mt-2">
              {[
                "Tidak ada jaminan menang. Probabilitas 80% tetap berarti kalah satu dari lima kali — alat ini menaikkan keyakinan, bukan menghapus risiko.",
                "Liga yang belum terkalibrasi tetap tampil dengan labelnya. Angka dari liga bertipis data tidak pernah disamarkan menjadi angka pasti.",
                "Dua pasar dibatasi gradenya: Kedua Tim Cetak Gol dan Lebih dari 2,5 gol terbukti terlalu percaya diri dalam pengujian, jadi gradenya ditahan sampai buktinya membaik.",
              ].map((line, i) => (
                <Reveal key={line} delay={i * 0.06}>
                  <div className="flex gap-4 border-b border-hairline py-5 last:border-b-0">
                    <span className="tabular-nums pt-0.5 text-sm font-semibold text-brick">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <p className="max-w-3xl text-base leading-relaxed text-ink-soft">{line}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* ---------------------------------------------------------- FOOTER */}
      <footer>
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-8 sm:px-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-display text-lg font-bold tracking-[0.18em]">PILIHAN&nbsp;AMAN</p>
            <p className="mt-1 max-w-xl font-mono text-[11px] leading-relaxed tracking-wider text-faint">
              DATA DIPERBARUI TIAP 12 JAM DARI SUMBER GRATIS (FOOTBALL-DATA.CO.UK)
              DAN ARSIP PANEL. MODEL BERJALAN LOKAL DARI DATA YANG SUDAH
              TERSIMPAN.
            </p>
          </div>
          <p className="font-mono text-[11px] tracking-wider text-faint">
            © 2026 PILIHAN AMAN — ALAT BANTU KEYAKINAN, BUKAN JANJI MENANG.
          </p>
        </div>
      </footer>
    </div>
  );
}
