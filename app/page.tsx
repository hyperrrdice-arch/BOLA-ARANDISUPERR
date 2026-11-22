/**
 * BERANDA — brief redesain §3A (2026-11-21).
 *
 * Urutan ponsel: kepala halaman, tanggal+zona, judul dinamis
 * ("Malam ini" / "Pertandingan hari ini"), SATU panel sorotan gelap,
 * lalu jadwal berikutnya; desktop mensejajarkan jadwal berikutnya di
 * kanan sorotan (kolom ±7:5). Sesudahnya rekam hasil ringkas dengan
 * penyebut lengkap + tautan arsip. Scene bola 3D dan animasi hero
 * KELUAR dari jalur render rute ini (brief §6): konten utama terlihat
 * dari render pertama, angka tim+jam berasal dari server.
 *
 * Shell statis prerender (Cache Components); angka dibaca pulau async
 * di dalam <Suspense> dari lapisan baca lib/web/data.ts + rekam.ts.
 */
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import {
  jadwalBerikutnya,
  sorotanBeranda,
  type FixtureListItem,
  type SorotanBeranda,
} from "../lib/web/data";
import { ambilRekam, parseFilterRekam } from "../lib/web/rekam";
import {
  int,
  jamWibOnly,
  judulBeranda,
  kunciTanggal,
  labelZona,
  pct,
  tanggalJamWib,
  tanggalPanjang,
  tanggalZona,
  ZONA_BAKU,
} from "../lib/web/format";
import { EmptyState } from "../components/ui";
import { TopBar } from "../components/Nav";

/* ------------------------------------------------------------- kepala */

async function KepalaBeranda() {
  await connection();
  const now = new Date();
  return (
    <div>
      <p className="text-sm text-sekunder">{tanggalZona(now)}</p>
      <h1 className="font-display mt-2 text-[40px] leading-[1.03] font-bold text-tinta lg:text-[52px]">
        {judulBeranda(now)}
      </h1>
    </div>
  );
}

/* ------------------------------------------------------------ sorotan */

function PanelSorotan({ s }: { s: SorotanBeranda }) {
  const jam = `${jamWibOnly(s.kickoff_utc)} ${labelZona(ZONA_BAKU)}`;
  return (
    <section
      aria-label="Sorotan"
      className="panel-gelap bg-gelap px-5 py-6 text-tinta sm:px-7 sm:py-8"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="tabular-nums text-[17px] font-semibold text-jingga">
          {s.jenis === "hasil-terakhir" ? tanggalJamWib(s.kickoff_utc) : jam}
        </p>
        <p className="text-right text-sm text-gelap-sekunder">{s.competition_name}</p>
      </div>
      <h2 className="font-display mt-4 text-[44px] leading-[1.0] font-bold lg:text-[64px]">
        {s.home}
        <br />
        {s.away}
      </h2>
      <div className="mt-6 border-t border-tinta/25 pt-5">
        {s.jenis === "prediksi" && (
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div className="min-w-0">
              <p className="text-base">{s.label_prediksi}</p>
              <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
                <span className="font-display tabular-nums text-[44px] leading-none font-bold">
                  {pct(s.prob)}
                </span>
                {s.published_at_utc && (
                  <span className="text-sm text-gelap-sekunder">
                    Terbit {jamWibOnly(s.published_at_utc)} {labelZona(ZONA_BAKU)}
                  </span>
                )}
              </p>
            </div>
            <Link
              href={`/pertandingan/${s.match_id}`}
              className="inline-flex min-h-[48px] items-center gap-2 rounded-md bg-jingga px-5 text-[15px] font-semibold whitespace-nowrap text-accent-ink transition-opacity duration-150 hover:opacity-90"
            >
              Baca analisis <span aria-hidden="true">→</span>
            </Link>
          </div>
        )}
        {s.jenis === "tanpa-prediksi" && (
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <p className="max-w-md text-[15px] leading-relaxed text-gelap-sekunder">
              Prediksi resmi untuk laga ini belum terbit.
            </p>
            <Link
              href="/pertandingan"
              className="inline-flex min-h-[48px] items-center gap-2 rounded-md bg-jingga px-5 text-[15px] font-semibold whitespace-nowrap text-accent-ink transition-opacity duration-150 hover:opacity-90"
            >
              Lihat jadwal laga <span aria-hidden="true">→</span>
            </Link>
          </div>
        )}
        {s.jenis === "berikutnya" && (
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <p className="max-w-md text-[15px] leading-relaxed text-gelap-sekunder">
              Belum ada laga pada jendela dekat. Laga berikutnya: {tanggalJamWib(s.kickoff_utc)}.
            </p>
            <Link
              href="/pertandingan"
              className="inline-flex min-h-[48px] items-center gap-2 rounded-md bg-jingga px-5 text-[15px] font-semibold whitespace-nowrap text-accent-ink transition-opacity duration-150 hover:opacity-90"
            >
              Lihat jadwal laga <span aria-hidden="true">→</span>
            </Link>
          </div>
        )}
        {s.jenis === "hasil-terakhir" && (
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <p className="flex items-baseline gap-3">
              <span className="text-sm text-gelap-sekunder">Skor 90 menit</span>
              <span className="font-display tabular-nums text-[44px] leading-none font-bold">
                {s.home_goals}–{s.away_goals}
              </span>
            </p>
            <Link
              href="/bukti"
              className="inline-flex min-h-[48px] items-center gap-2 rounded-md bg-jingga px-5 text-[15px] font-semibold whitespace-nowrap text-accent-ink transition-opacity duration-150 hover:opacity-90"
            >
              Lihat rekam hasil <span aria-hidden="true">→</span>
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------------------------------------------------- jadwal berikutnya */

function BarisBerikutnya({ item }: { item: FixtureListItem }) {
  const f = item.pkg.payload.fixture;
  return (
    <li>
      <Link
        href={`/pertandingan/${item.pkg.match_id}`}
        aria-label={`${f.home} melawan ${f.away}, ${tanggalJamWib(item.pkg.kickoff_utc)}`}
        className="group flex min-h-[56px] items-center gap-4 py-3"
      >
        <span className="tabular-nums w-[56px] shrink-0 text-[15px] font-semibold text-tinta">
          {jamWibOnly(item.pkg.kickoff_utc)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base leading-snug font-medium text-tinta">
            {f.home}
            <br />
            {f.away}
          </span>
          <span className="mt-0.5 block text-[13px] text-sekunder">{f.competition_name}</span>
        </span>
        <span aria-hidden="true" className="shrink-0 text-xl text-sekunder transition-colors group-hover:text-tinta">
          ›
        </span>
      </Link>
    </li>
  );
}

function JadwalBerikutnya({ items }: { items: FixtureListItem[] }) {
  if (items.length === 0) return null;
  const elemen: React.ReactNode[] = [];
  let kunciSebelumnya = "";
  for (const item of items) {
    const kunci = kunciTanggal(item.pkg.kickoff_utc);
    if (kunci !== kunciSebelumnya) {
      elemen.push(
        <li
          key={`tgl-${kunci}`}
          className="pt-3 pb-1 text-[13px] font-semibold tracking-[0.04em] text-sekunder uppercase"
        >
          {tanggalPanjang(item.pkg.kickoff_utc)}
        </li>,
      );
      kunciSebelumnya = kunci;
    }
    elemen.push(<BarisBerikutnya key={item.pkg.match_id} item={item} />);
  }
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-[28px] leading-tight font-bold text-tinta">
          Jadwal berikutnya
        </h2>
        <span className="text-sm text-sekunder">{labelZona(ZONA_BAKU)}</span>
      </div>
      <ul className="mt-2 divide-y divide-garis border-t-2 border-tinta">{elemen}</ul>
      <p className="mt-4">
        <Link
          href="/pertandingan"
          className="inline-flex min-h-[44px] items-center gap-2 text-[15px] font-medium text-jingga-teks hover:underline"
        >
          Lihat seluruh jadwal <span aria-hidden="true">→</span>
        </Link>
      </p>
    </div>
  );
}

async function SorotanDanJadwal() {
  await connection();
  const now = new Date();
  const sorotan = sorotanBeranda(now);
  const berikut = jadwalBerikutnya(sorotan, now);
  if (!sorotan && berikut.length === 0) {
    return (
      <EmptyState
        title="Belum ada pertandingan pada jendela ini"
        note="Jadwal dan prediksi baru muncul setelah penyegaran data berikutnya."
      />
    );
  }
  return (
    <div className="grid items-start gap-10 lg:grid-cols-[7fr_5fr] lg:gap-8">
      {sorotan && <PanelSorotan s={sorotan} />}
      <JadwalBerikutnya items={berikut} />
    </div>
  );
}

/* --------------------------------------------------------- rekam ringkas */

async function RekamRingkas() {
  await connection();
  const now = new Date();
  const data = ambilRekam(parseFilterRekam({}), now.toISOString());
  const st = data.stats;
  return (
    <section aria-label="Rekam hasil" className="mt-16 border-t border-garis pt-10 lg:mt-20">
      <h2 className="font-display text-[32px] leading-tight font-bold text-tinta">Rekam hasil</h2>
      {st.settled > 0 ? (
        <div className="mt-5 grid gap-8 lg:grid-cols-2 lg:gap-12">
          <div>
            <p className="font-display tabular-nums text-[38px] leading-[1.05] font-bold text-tinta lg:text-[44px]">
              {int(st.hits)} dari {int(st.settled)} pilihan tepat
            </p>
            <p className="mt-2 text-[15px] leading-relaxed text-sekunder">
              {pct(st.hit_ratio)} dari pilihan yang sudah dinilai, mencakup{" "}
              {int(data.laga_dinilai_unik)} laga.
            </p>
          </div>
          <div>
            <p className="text-[15px] font-semibold text-tinta">Cakupan penilaian</p>
            <p className="mt-1 text-[15px] leading-relaxed text-sekunder">
              {int(st.settled)} dari {int(st.due)} pilihan yang jatuh tempo sudah dinilai.
            </p>
            <p className="font-display tabular-nums mt-3 text-[26px] leading-none font-bold text-tinta">
              {pct(st.coverage_ratio)}
            </p>
            <div
              aria-hidden="true"
              className="mt-2 h-[6px] w-full max-w-sm bg-garis"
            >
              <div
                className="h-full bg-tinta"
                style={{ width: `${Math.round((st.coverage_ratio ?? 0) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-sekunder">
          Belum ada pilihan yang sudah dinilai.
          {st.due > 0 &&
            ` ${int(st.due)} pilihan masih menunggu hasil resmi.`}
        </p>
      )}
      <p className="mt-6">
        <Link
          href="/bukti"
          className="inline-flex min-h-[44px] items-center gap-2 text-[15px] font-medium text-jingga-teks hover:underline"
        >
          Lihat rekam hasil <span aria-hidden="true">→</span>
        </Link>
      </p>
    </section>
  );
}

/* ---------------------------------------------------------------- page */

export default function LandingPage() {
  return (
    <div className="flex min-h-full flex-col bg-kertas text-tinta">
      <TopBar />

      <main id="main-content" className="flex-1">
        <section className="shell-x mx-auto w-full max-w-[1240px] pt-10 pb-16 lg:pt-14">
          <Suspense
            fallback={
              <div>
                <p className="text-sm text-sekunder">Memuat tanggal…</p>
                <h1 className="font-display mt-2 text-[40px] leading-[1.03] font-bold text-tinta lg:text-[52px]">
                  Pertandingan hari ini
                </h1>
              </div>
            }
          >
            <KepalaBeranda />
          </Suspense>

          <div className="mt-8">
            <Suspense
              fallback={<p className="py-10 text-sm text-sekunder">Memuat sorotan…</p>}
            >
              <SorotanDanJadwal />
            </Suspense>
          </div>

          <Suspense fallback={null}>
            <RekamRingkas />
          </Suspense>
        </section>
      </main>

      {/* ---------------------------------------------------------- FOOTER */}
      <footer className="border-t border-garis">
        <div className="shell-x mx-auto flex w-full max-w-[1240px] flex-col gap-2 py-10 pb-[calc(52px+env(safe-area-inset-bottom)+2.5rem)] sm:flex-row sm:items-baseline sm:justify-between md:pb-10">
          <p className="text-[15px]">
            <span className="font-display text-[19px] font-bold text-tinta italic">
              Bola<span className="text-jingga not-italic">.</span>
            </span>
            <span className="text-sekunder"> · Data disegarkan tiap 12 jam.</span>
          </p>
          <p className="text-[13px] text-faint">Probabilitas, tercatat.</p>
        </div>
      </footer>
    </div>
  );
}
