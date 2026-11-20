/**
 * DETAIL PERTANDINGAN — satu laga: peta peluang, sumber angka langsung
 * (model + harga pasar), panel arsip yang TERPISAH, pilihan resmi saat
 * terbit dan tiket resmi yang memuatnya (K6, U03).
 *
 * Aturan keras halaman ini:
 * - Panel Sportmonks adalah data arsip: hanya tampil di bagian
 *   "Panel arsip" dan tidak pernah masuk metrik/selisih langsung.
 * - Pilihan dan tiket hanya ditautkan bila resmi menurut K2/K3
 *   (pick_uid terbit / slip published_slips); angka "saat terbit" beku
 *   dan dipisahkan dari analisis terbaru bila paketnya berbeda.
 * - Skor mengikuti gerbang status: laga batal tidak pernah berskor,
 *   laga dihentikan menampilkan skor parsial berlabel.
 * - Laga terjadwal tanpa paket tetap terbuka ("Analisis belum
 *   tersedia"); hanya ID asing yang 404.
 */
import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import {
  getFixtureInfo,
  getMatchDetail,
  type FormEntry,
  type OfficialPick,
} from "@/lib/web/data";
import {
  GATE_LABEL,
  jamWibOnly,
  labelBasisPeluang,
  labelGate,
  labelPilihan,
  labelVerdik,
  num,
  pct,
  tanggalJamWib,
  tanggalWib,
  zonaValid,
} from "@/lib/web/format";
import { labelStatus } from "@/lib/web/status";
import { parseFilterJadwal, queryJadwal } from "@/lib/web/jadwal";
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
  OVERPERFORMING: "di atas xG",
  UNDERPERFORMING: "di bawah xG",
  NEUTRAL: "sejalan dengan xG",
  INSUFFICIENT_DATA: "data belum cukup",
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
  calibrated: "Liga ini lulus uji kalibrasi pada laga-laga uji.",
  partial: "Liga ini baru lolos sebagian — perlakukan angkanya dengan hati-hati.",
  uncalibrated: "Liga ini belum lulus uji kalibrasi.",
};

function signed(n: number, digits = 2): string {
  const s = num(Math.abs(n), digits);
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${s}`;
}

/** Kalimat penyajian dari field resolusi terstruktur (bukan prosa pipeline). */
function resolutionSentence(
  lr: { fitSystem?: string; via?: string } | undefined,
): string | null {
  if (!lr) return null;
  if (lr.via === "cup-offset") return "Laga ini dilayani model offset piala global.";
  switch (lr.fitSystem) {
    case "sportmonks":
      return "Laga ini dilayani fit Sportmonks untuk liganya.";
    case "legacy-div":
      return "Laga ini dilayani fit divisi warisan untuk liganya.";
    case "special":
      return "Laga ini dilayani fit khusus untuk kompetisinya.";
    default:
      return null;
  }
}

const SLIP_STATE_LABEL: Record<string, string> = {
  hit: "Tepat",
  miss: "Meleset",
  void: "Dibatalkan",
  pending: "Menunggu hasil",
};

/* ------------------------------------------------------------------- page */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ matchId: string }>;
}): Promise<Metadata> {
  const { matchId } = await params;
  const detail = getMatchDetail(matchId);
  const info = detail ? null : getFixtureInfo(matchId);
  const home = detail?.pkg.payload.fixture.home ?? info?.home;
  const away = detail?.pkg.payload.fixture.away ?? info?.away;
  return { title: home && away ? `${home} vs ${away} | Bola` : "Laga | Bola" };
}

export default function AnalisisPage({
  params,
  searchParams,
}: {
  params: Promise<{ matchId: string }>;
  searchParams: SearchParams;
}) {
  return (
    <Suspense fallback={<PageLoading label="Memuat analisis laga…" />}>
      <AnalisisContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

function hrefKembali(sp: Record<string, string | string[] | undefined>): string {
  const mentah = Array.isArray(sp.kembali) ? sp.kembali[0] : sp.kembali;
  if (!mentah) return "/pertandingan";
  const sebagaiParams: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of new URLSearchParams(mentah).entries()) sebagaiParams[k] = v;
  return `/pertandingan?${queryJadwal(parseFilterJadwal(sebagaiParams))}`;
}

async function AnalisisContent({
  params,
  searchParams,
}: {
  params: Promise<{ matchId: string }>;
  searchParams: SearchParams;
}) {
  const { matchId } = await params;
  const sp = await searchParams;
  const tz = zonaValid(Array.isArray(sp.tz) ? sp.tz[0] : sp.tz);
  const kembali = hrefKembali(sp);
  await connection();
  const detail = getMatchDetail(matchId);
  if (!detail) {
    const info = getFixtureInfo(matchId);
    if (!info) notFound();
    return (
      <div>
        <Link href={kembali} className="text-sm text-mid-gray transition-colors hover:text-ink">
          ← Jadwal pertandingan
        </Link>
        <header className="mt-8">
          <p className="text-sm text-mid-gray">
            {info.competition_name}
            {info.competition_country && <> · {info.competition_country}</>}
          </p>
          <h1 className="mt-3 font-display text-[32px] leading-tight font-semibold tracking-[-0.01em] break-words text-ink sm:text-4xl">
            {info.home} <span className="font-normal text-faint">vs</span> {info.away}
          </h1>
          <p className="mt-2.5 text-[15px] text-mid-gray">
            {tanggalJamWib(info.kickoff_utc, tz)} · {labelStatus(info.status)}
          </p>
        </header>
        <div className="mt-10">
          <EmptyState
            title="Analisis belum tersedia untuk laga ini"
            note="Laga ini ada di jadwal, tetapi belum ada paket analisis tersimpan untuknya."
          />
        </div>
        <p className="mt-6">
          <Link href={kembali} className="text-[15px] font-medium text-ink hover:text-accent">
            Kembali ke jadwal <span className="text-accent">→</span>
          </Link>
        </p>
      </div>
    );
  }

  const { pkg, result, formHome, formAway, keadaan, officialPicks, officialTickets } = detail;
  const p = pkg.payload;
  const f = p.fixture;
  const home = f.home;
  const away = f.away;

  const luck = (p.shrunk_metadata?.luckMetrics ?? null) as LuckMetrics | null;
  const feedMode = (p as unknown as { feed_mode?: string }).feed_mode;
  const resolution = resolutionSentence(p.shrunk_metadata?.leagueResolution);

  const matrix = p.score_matrix ?? [];
  const cut = matrix.slice(0, 6).map((row) => row.slice(0, 6));
  const maxCell = cut.reduce((m, row) => row.reduce((a, v) => Math.max(a, v), m), 0);

  // Selisih langsung HANYA dari model vs harga pasar — panel arsip tidak
  // pernah masuk metrik langsung (U03).
  const spreadRows = PROB_ROWS.map(({ market, selection }) => {
    const key = `${market}:${selection}`;
    const mv = p.probabilities[key] ?? null;
    const kv = p.market?.probs[key] ?? null;
    const spread = mv !== null && kv !== null ? Math.abs(mv - kv) : 0;
    return { market, selection, key, mv, kv, spread };
  });
  const disagreeCount = spreadRows.filter((r) => r.spread > 0.1).length;
  const sumberTersedia = (p.probabilities["1x2:1"] !== undefined ? 1 : 0) + (p.market ? 1 : 0);

  const p1 = p.probabilities["1x2:1"] ?? null;
  const px = p.probabilities["1x2:x"] ?? null;
  const p2 = p.probabilities["1x2:2"] ?? null;
  let kalimatPeta: string | null = null;
  if (p1 !== null && px !== null && p2 !== null) {
    const maks = Math.max(p1, px, p2);
    if (maks === p1) {
      kalimatPeta = `${home} paling berpeluang menang. Model tetap memberi peluang ${pct(px + p2)} untuk seri atau kemenangan ${away}.`;
    } else if (maks === p2) {
      kalimatPeta = `${away} paling berpeluang menang. Model tetap memberi peluang ${pct(p1 + px)} untuk seri atau kemenangan ${home}.`;
    } else {
      kalimatPeta = `Seri adalah hasil paling berpeluang menurut model. Model tetap memberi peluang ${pct(p1 + p2)} untuk kemenangan salah satu tim.`;
    }
  }

  const resmiDinilai = officialPicks.filter((x) => x.hit !== null);
  const resmiTepat = resmiDinilai.filter((x) => x.hit === 1).length;
  const paketTerbitBerbeda =
    officialPicks.length > 0 &&
    officialPicks.some((x) => x.package_id !== null && x.package_id !== pkg.id);
  const terbitUtc = officialPicks.find((x) => x.package_computed_utc)?.package_computed_utc ?? null;

  const statusTampil = keadaan?.status ?? null;

  return (
    <div>
      <Link href={kembali} className="text-sm text-mid-gray transition-colors hover:text-ink">
        ← Jadwal pertandingan
      </Link>

      {/* ---------------------------------------------------------- header */}
      <header className="mt-8">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-mid-gray">
          <GateStatus status={pkg.gate_status} withLabel={false} />
          <span>{f.competition_name}</span>
          <span aria-hidden="true">·</span>
          <span>{GATE_LABEL[pkg.gate_status] ?? pkg.gate_status}</span>
        </p>
        <h1 className="mt-3 font-display text-[32px] leading-tight font-semibold tracking-[-0.01em] break-words text-ink sm:text-4xl">
          {home} <span className="font-normal text-faint">vs</span> {away}
        </h1>
        <p className="mt-2.5 text-[15px] text-mid-gray">
          {tanggalJamWib(f.kickoff_utc, tz)}
          {tz !== "UTC" && <> · {jamWibOnly(f.kickoff_utc, "UTC")} UTC</>}
          {statusTampil && <> · {labelStatus(statusTampil, keadaan?.menit)}</>}
          {feedMode === "free" && <> · Mode data gratis</>}
        </p>
        {keadaan?.status === "finished" && keadaan.home_goals !== null && (
          <div className="mt-8">
            <p className="text-xl font-medium text-ink">
              Selesai · {home} {keadaan.home_goals}–{keadaan.away_goals} {away}.
            </p>
            {officialPicks.length > 0 && (
              <p className="mt-1.5 text-sm text-mid-gray">
                {resmiDinilai.length > 0
                  ? `${resmiTepat} dari ${resmiDinilai.length} pilihan resmi tepat.`
                  : `${officialPicks.length} pilihan resmi tercatat, belum ada yang dinilai.`}
              </p>
            )}
          </div>
        )}
        {keadaan?.status === "abandoned" && keadaan.home_goals !== null && (
          <p className="mt-8 text-xl font-medium text-ink">
            Dihentikan · Skor parsial {home} {keadaan.home_goals}–{keadaan.away_goals} {away}.
          </p>
        )}
        {keadaan?.status === "cancelled" && (
          <p className="mt-8 text-xl font-medium text-ink">Laga ini dibatalkan.</p>
        )}
        {keadaan?.status === "postponed" && (
          <p className="mt-8 text-xl font-medium text-ink">
            Laga ini ditunda dari jadwal asal {tanggalJamWib(f.kickoff_utc, tz)}.
          </p>
        )}
        {result?.finished && !keadaan && (
          <p className="mt-8 text-xl font-medium text-ink">
            Selesai · {home} {result.home_goals}–{result.away_goals} {away}.
          </p>
        )}
      </header>

      {/* ----------------------------------------------------- peta peluang */}
      {p1 !== null && px !== null && p2 !== null && (
        <section className="mt-16">
          <SectionHead label="Peta peluang" />
          <dl className="mt-6 grid gap-6 sm:grid-cols-3">
            {[
              { nama: `${home} menang`, nilai: p1 },
              { nama: "Seri", nilai: px },
              { nama: `${away} menang`, nilai: p2 },
            ].map((r) => (
              <div key={r.nama}>
                <dt className="text-sm break-words text-mid-gray">{r.nama}</dt>
                <dd className="mt-1">
                  <Prob value={r.nilai} strong className="text-[32px] leading-none" />
                </dd>
              </div>
            ))}
          </dl>
          {kalimatPeta && (
            <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-ink-soft">{kalimatPeta}</p>
          )}
        </section>
      )}

      {/* ----------------------------------------------------- sumber angka */}
      <section className="mt-16">
        <SectionHead
          label="Sumber angka"
          right={<span className="text-[13px] text-faint">{sumberTersedia} sumber tersedia</span>}
        />
        <div
          className="mt-6 overflow-x-auto"
          role="region"
          aria-label="Tabel perbandingan model dan harga pasar"
        >
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="pb-3 text-left text-[13px] font-normal text-mid-gray">Pilihan</th>
                <th className="pb-3 text-right text-[13px] font-normal text-mid-gray">Model</th>
                <th className="pb-3 text-right text-[13px] font-normal text-mid-gray">Harga pasar</th>
              </tr>
            </thead>
            <tbody>
              {spreadRows.map((r) => (
                <tr key={r.key} className="border-t border-hairline/50">
                  <td className="py-2 pr-3 break-words text-ink-soft">
                    {labelPilihan(r.market, r.selection, home, away)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Prob value={r.mv} />
                  </td>
                  <td className="py-2 pl-3 text-right">
                    <Prob value={r.kv} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 space-y-1.5 text-[13px] leading-relaxed text-faint">
          {disagreeCount > 0 && (
            <p>
              Model dan harga pasar berbeda lebih dari 10 poin pada {disagreeCount} pilihan.
            </p>
          )}
          {p.market ? (
            <p>
              {p.market.captured_utc ? (
                <>
                  Harga pasar ditangkap {tanggalJamWib(p.market.captured_utc, tz)}
                  {p.market.bookmakers.length > 0 && (
                    <> · {p.market.bookmakers.join(", ")}</>
                  )}
                  . Peluang pasar adalah peluang tersirat setelah margin dihapus.
                </>
              ) : (
                <>
                  Harga pasar tersedia, tetapi waktu tangkapnya tidak tercatat pada
                  paket ini. Peluang pasar adalah peluang tersirat setelah margin
                  dihapus.
                </>
              )}
            </p>
          ) : (
            <p>Harga pasar belum tersedia untuk laga ini.</p>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------ panel arsip */}
      <section className="mt-16">
        <SectionHead label="Panel arsip" />
        {p.sm_panel ? (
          <>
            <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-faint">
              Panel arsip Sportmonks · {tanggalJamWib(p.sm_panel.batch_utc, tz)}. Ini arsip
              probabilitas lama — bukan angka langsung dan tidak masuk perbandingan sumber di
              atas.
            </p>
            <div
              className="mt-4 overflow-x-auto"
              role="region"
              aria-label="Tabel panel arsip Sportmonks"
            >
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="pb-3 text-left text-[13px] font-normal text-mid-gray">Pilihan</th>
                    <th className="pb-3 text-right text-[13px] font-normal text-mid-gray">
                      Panel arsip
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {PROB_ROWS.map(({ market, selection }) => {
                    const v = p.sm_panel?.probs[`${market}:${selection}`] ?? null;
                    return (
                      <tr key={`${market}:${selection}`} className="border-t border-hairline/50">
                        <td className="py-2 pr-3 break-words text-ink-soft">
                          {labelPilihan(market, selection, home, away)}
                        </td>
                        <td className="py-2 pl-3 text-right">
                          <Prob value={v} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="mt-4 text-sm text-faint">Panel arsip tidak tersedia untuk laga ini.</p>
        )}
      </section>

      {/* ------------------------------------------------ pilihan saat terbit */}
      <section className="mt-16">
        <SectionHead
          label="Pilihan sebelum laga"
          right={
            <span className="text-[13px] text-faint">{officialPicks.length} pilihan resmi</span>
          }
        />
        {paketTerbitBerbeda && terbitUtc && (
          <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-faint">
            Prediksi saat terbit berasal dari paket {tanggalJamWib(terbitUtc, tz)}. Analisis
            terbaru di halaman ini dihitung {tanggalJamWib(pkg.computed_utc, tz)} — angka terbit
            tidak berubah oleh analisis yang lebih baru.
          </p>
        )}
        {officialPicks.length === 0 ? (
          <p className="mt-6 text-sm text-faint">
            Belum ada pilihan resmi untuk laga ini. Pilihan resmi adalah pilihan yang diterbitkan
            sebelum sepak mula dan tercatat beku di ledger.
          </p>
        ) : (
          <ul className="mt-6 space-y-4">
            {officialPicks.map((pk: OfficialPick) => (
              <li
                key={pk.pick_uid}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-hairline/50 pt-4"
              >
                <GradeMark grade={pk.grade} />
                <span className="min-w-0 flex-1 break-words text-[15px] text-ink">
                  {labelPilihan(pk.market, pk.selection, home, away)}
                </span>
                <span className="text-right">
                  {pk.published_prob !== null ? (
                    <>
                      <Prob value={pk.published_prob} strong />{" "}
                      <span className="text-[13px] text-faint">peluang saat terbit</span>
                    </>
                  ) : (
                    <span className="text-[13px] text-faint">{labelBasisPeluang(pk.probability_basis)}</span>
                  )}
                </span>
                <span className="w-full text-[13px] text-faint">
                  {labelBasisPeluang(pk.probability_basis)} · {labelGate(pk.gate_status)}
                  {pk.published_at_utc && (
                    <> · Terbit {tanggalJamWib(pk.published_at_utc, tz)}</>
                  )}
                  {" · "}
                  <span
                    className={
                      pk.hit === 1
                        ? "font-medium text-sage"
                        : pk.hit === 0
                          ? "font-medium text-brick"
                          : ""
                    }
                  >
                    {labelVerdik(pk.hit)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* -------------------------------------------------------- tiket resmi */}
      {officialTickets.length > 0 && (
        <section className="mt-16">
          <SectionHead label="Tiket resmi" />
          <ul className="mt-6 space-y-3">
            {officialTickets.map((t) => (
              <li key={t.slip_uid} className="border-t border-hairline/50 pt-4 text-[15px]">
                <Link
                  href={`/bukti?tiket=${encodeURIComponent(t.slip_uid)}`}
                  className="font-medium text-ink transition-colors hover:text-accent"
                >
                  Tiket resmi {t.slip_uid.slice(0, 13)}…
                </Link>
                <span className="text-mid-gray">
                  {" "}· {SLIP_STATE_LABEL[t.state] ?? t.state} · Terbit{" "}
                  {tanggalJamWib(t.published_utc, tz)}
                  {t.combined_prob !== null && (
                    <>
                      {" "}· Perkiraan peluang semua pilihan tepat {pct(t.combined_prob)}
                      {t.combined_low !== null &&
                        t.combined_high !== null &&
                        t.combined_low !== t.combined_high && (
                          <> (rentang {pct(t.combined_low)}–{pct(t.combined_high)})</>
                        )}
                    </>
                  )}
                  {t.combined_prob === null && t.combined_reason && (
                    <> · Peluang gabungan tidak dapat dihitung: {t.combined_reason}</>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-16 grid gap-16 lg:grid-cols-2">
        {/* --------------------------------------------------- skor mungkin */}
        <section>
          <SectionHead label="Skor paling mungkin" sub="Gol kandang ke bawah, gol tamu ke kanan." />
          {cut.length === 0 ? (
            <p className="mt-6 text-sm text-faint">Paket ini tidak menyimpan matriks skor.</p>
          ) : (
            <>
              <div
                className="mt-6 overflow-x-auto"
                role="region"
                aria-label="Matriks skor pertandingan"
                tabIndex={0}
              >
                <table className="border-collapse">
                  <thead>
                    <tr>
                      <th className="h-9 w-8" />
                      {cut[0].map((_, j) => (
                        <th key={j} className="h-9 w-10 font-mono text-xs font-normal text-mid-gray sm:w-14">
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
                            className="h-10 w-10 rounded-[3px] text-center font-mono text-[10px] tabular-nums sm:w-14 sm:text-[11px]"
                          >
                            {pct(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
                Ditampilkan 0–5 gol per sisi dari matriks penuh 11×11. Daftar skor di atas adalah
                alternatif teks matriks ini.
              </p>
            </>
          )}
        </section>

        {/* --------------------------------------------- tentang angka ini */}
        <section>
          <SectionHead label="Tentang angka ini" />
          <div className="mt-6 space-y-3.5 text-[15px] leading-relaxed text-ink-soft">
            <p>
              Gol yang diharapkan <span className="tabular-nums">{num(p.lambda)}</span> –{" "}
              <span className="tabular-nums">{num(p.mu)}</span>. Korelasi{" "}
              <span className="tabular-nums">{num(p.rho)}</span>.
            </p>
            <p>
              Rating dari <span className="font-mono text-[13px]">{pkg.fit_source}</span>.
            </p>
            {pkg.cup_delta !== null && (
              <p>
                Laga piala: offset liga{" "}
                <span className="tabular-nums">{signed(pkg.cup_delta, 3)}</span> diterapkan.
              </p>
            )}
            <p>{GATE_SENTENCE[pkg.gate_status] ?? GATE_SENTENCE.uncalibrated}</p>
            {resolution && <p>{resolution}</p>}
            <p className="text-mid-gray">Dihitung {tanggalJamWib(pkg.computed_utc, tz)}.</p>
          </div>
        </section>
      </div>

      {/* -------------------------------------------------- enam laga akhir */}
      <section className="mt-16">
        <SectionHead label="Enam laga terakhir" />
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
                  <span className="font-display text-lg font-semibold break-words text-ink">{name}</span>
                  <FormChips form={form} />
                </div>
                {form.length > 0 && (
                  <>
                    <p className="mt-2 text-[13px] text-mid-gray">
                      Mencetak {gf} · Kebobolan {ga}
                    </p>
                    <ul className="mt-4 space-y-2 text-sm">
                      {form.map((e: FormEntry, i: number) => (
                        <li key={i} className="flex items-baseline gap-2.5 text-ink-soft">
                          <span className="w-[5.5rem] shrink-0 font-mono text-[11px] text-faint">
                            {tanggalWib(e.date, tz)}
                          </span>
                          <span className="min-w-0 flex-1 break-words">
                            {e.venue === "home" ? "vs" : "di markas"} {e.opponent}
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

      {/* ------------------------------------------------------------- xG */}
      {luck && (
        <section className="mt-16">
          <SectionHead label="Gol vs gol yang diharapkan (xG)" />
          <div className="mt-8 grid gap-12 md:grid-cols-2">
            {[
              { name: home, side: luck.home },
              { name: away, side: luck.away },
            ].map(({ name, side }) => (
              <div key={name}>
                {side.status === "INSUFFICIENT_DATA" ? (
                  <p className="text-[15px] text-ink-soft">{name}: data xG belum cukup.</p>
                ) : (
                  <>
                    <p className="text-[15px] text-ink-soft">
                      {name}: <span className="tabular-nums">{signed(side.net_luck_rating)}</span>{" "}
                      per laga vs xG — {LUCK_LABEL[side.status] ?? side.status}.
                    </p>
                    <p className="mt-2 text-[13px] leading-relaxed text-faint">
                      Dari {side.sample_size} laga: mencetak {side.total_goals_for} gol dari{" "}
                      {num(side.total_xg_for)} xG, kebobolan {side.total_goals_against} dari{" "}
                      {num(side.total_xg_against)} xG lawan.
                    </p>
                  </>
                )}
              </div>
            ))}
          </div>
          {luck.market_bias_warning && (
            <p className="mt-8 max-w-2xl text-[15px] leading-relaxed text-ink-soft">
              Catatan: {home} {(LUCK_LABEL[luck.home.status] ?? "").toLowerCase()} terhadap xG
              sedangkan {away} {(LUCK_LABEL[luck.away.status] ?? "").toLowerCase()} — hasil
              terakhir dan angka tidak sejalan di sini.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
