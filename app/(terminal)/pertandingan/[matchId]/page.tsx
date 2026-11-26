/**
 * DETAIL PERTANDINGAN — satu laga (redesain §3C): data inti dari
 * jadwal kanonik dirender lebih dulu; prediksi EDISI TERBIT dipasangkan
 * dengan skor 90 menit dan vonisnya; angka mutakhir hidup di bagiannya
 * sendiri bertimestamp; kemungkinan skor adalah peta §9 (tabel 2D +
 * mode 3D pilihan pembaca); metode menutup halaman.
 *
 * Aturan keras halaman ini:
 * - Panel Sportmonks adalah data arsip: hanya tampil di bagian
 *   "Panel arsip" dan tidak pernah masuk metrik/selisih langsung.
 * - Pilihan dan tiket hanya ditautkan bila resmi menurut K2/K3
 *   (pick_uid terbit / slip published_slips); angka "saat terbit" beku.
 * - Skor mengikuti gerbang status: laga batal tidak pernah berskor,
 *   laga dihentikan menampilkan skor parsial berlabel; skor pasca-
 *   regulasi (AET/penalti) dilabeli terpisah dan skor 90 menit TIDAK
 *   PERNAH ditebak darinya — ia datang dari hasil resolver pada
 *   pilihan resmi, atau dinyatakan belum terkonfirmasi.
 * - Laga terjadwal tanpa paket tetap terbuka ("Analisis belum
 *   tersedia"); hanya ID asing yang 404.
 * - SELURUH isi halaman dirender SEBARIS dalam respons HTML —
 *   TANPA batas <Suspense>/fallback (temuan #4 verifikasi produksi):
 *   di bawah cacheComponents, isi yang menangguhkan di balik batas
 *   dikirim sebagai segmen tersembunyi yang hanya bisa ditukar
 *   masuk oleh skrip, jadi dengan JavaScript mati pembaca hanya
 *   melihat fallback selamanya. Bacaan data halaman ini sinkron
 *   dan lokal (SQLite), jadi menunggu render penuh adalah harga
 *   yang benar; yang tetap lazy hanyalah mode 3D peta skor (pulau
 *   klien, dimuat saat dipilih — kontrak §9 tidak berubah).
 */
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
  num,
  pct,
  tanggalJamWib,
  tanggalWib,
  zonaValid,
} from "@/lib/web/format";
import { labelStatus } from "@/lib/web/status";
import {
  labelSumberPeluang,
  panelArsipAdaNilai,
  teksPembanding,
} from "@/lib/web/sumber-peluang";
import { mulaiTimerRute, selesaikanTimerRute } from "@/lib/web/timing";
import { adaptasiMatriks } from "@/lib/web/peta-skor";
import { tujuanKembaliDariDetail } from "@/lib/web/jadwal";
import {
  EmptyState,
  FormChips,
  GateStatus,
  GradeMark,
  Prob,
  SectionHead,
} from "@/components/ui";
import PetaSkor from "@/components/detail/PetaSkor";

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
  partial: "Uji historis liga ini baru memenuhi sebagian kriteria.",
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

/**
 * Vonis pilihan di detail (brief §5): sesudah laga selesai tetapi
 * penilaian belum punya skor regulasi, labelnya "Menunggu hasil
 * resmi" — bukan "Menunggu hasil" yang menyiratkan laga belum main.
 */
function verdikDetail(pk: OfficialPick, selesai: boolean): string {
  if (pk.hit === 1) return "Tepat";
  if (pk.hit === 0) return "Meleset";
  return selesai ? "Menunggu hasil resmi" : "Menunggu hasil";
}

/**
 * Proyeksi sumber peluang + pembanding (B2.2b) untuk satu pilihan
 * resmi — aturan bersama lib/web/sumber-peluang atas bukti beku baris
 * itu sendiri. Menggantikan kalimat basis lama yang menyimpulkan
 * "disesuaikan dari uji historis" dari basis effective saja, padahal
 * effective bisa berarti fallback angka model (stated-fallback).
 */
function sumberDariPick(pk: OfficialPick) {
  return labelSumberPeluang({
    probability_basis: pk.probability_basis,
    effective_source: pk.effective_source,
    evidence_source: pk.evidence_source ?? null,
    market_prob: pk.market_prob,
    line: pk.line ?? "",
    odds_bookmaker: pk.odds_bookmaker ?? null,
    odds_period: pk.odds_period ?? null,
    odds_line: pk.odds_line ?? null,
    odds_decimal: pk.odds_decimal ?? null,
    odds_captured_utc: pk.odds_captured_utc ?? null,
    decision_at_utc: pk.decision_at_utc ?? null,
    kickoff_at_issue_utc: pk.kickoff_at_issue_utc ?? null,
  });
}

/* ------------------------------------------------------------------- page */

/**
 * Kontrak temuan #4: rute ini BLOCKING — dirender penuh di server
 * pada setiap permintaan, tanpa shell prerender + fallback. Tanpa
 * penanda ini, cacheComponents menolak build karena data runtime
 * (params/searchParams/connection()) diakses di luar <Suspense>;
 * dengan penanda ini, tidak ada segmen tersembunyi yang menunggu
 * skrip penukar, jadi isi terbaca dari HTML dengan skrip mati.
 */
export const instant = false;

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

export default async function AnalisisPage({
  params,
  searchParams,
}: {
  params: Promise<{ matchId: string }>;
  searchParams: SearchParams;
}) {
  // Tanpa batas <Suspense> di antara akar rute dan isi: render
  // menunggu data (lewat connection() di AnalisisContent) lalu
  // menulis isi sebagai HTML sebaris — terbaca penuh dengan
  // JavaScript mati, bukan fallback yang menunggu skrip penukar.
  return <AnalisisContent params={params} searchParams={searchParams} />;
}

/**
 * Konteks kembali daftar: `asal` memilih tab asal dari allowlist
 * (analisa|jadwal — selain itu Jadwal), `kembali` adalah filter
 * terserialisasi yang disanitasi ulang sebelum menjadi URL tujuan.
 * Deep link lama tanpa `asal` jatuh ke Jadwal seperti sebelumnya.
 */
function konteksKembali(sp: Record<string, string | string[] | undefined>): {
  href: string;
  label: string;
} {
  const asal = Array.isArray(sp.asal) ? sp.asal[0] : sp.asal;
  const mentah = Array.isArray(sp.kembali) ? sp.kembali[0] : sp.kembali;
  return tujuanKembaliDariDetail(asal ?? null, mentah ?? null);
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
  const kembali = konteksKembali(sp);
  await connection();
  const t0Timer = mulaiTimerRute();
  const detail = getMatchDetail(matchId);
  if (!detail) {
    const info = getFixtureInfo(matchId);
    if (!info) notFound();
    selesaikanTimerRute("/pertandingan/[matchId]", t0Timer);
    return (
      <div>
        <Link href={kembali.href} className="text-sm text-mid-gray transition-colors hover:text-ink">
          ← {kembali.label}
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
            title="Analisis belum tersedia untuk laga ini."
            note="Laga ini ada di jadwal, tetapi belum ada paket analisis tersimpan untuknya."
          />
        </div>
        <p className="mt-6">
          <Link href={kembali.href} className="text-[15px] font-medium text-ink hover:text-accent">
            {kembali.label} <span className="text-accent">→</span>
          </Link>
        </p>
      </div>
    );
  }

  const {
    pkg,
    result,
    formHome,
    formAway,
    keadaan,
    officialPicks,
    kejadianResmi,
    officialTickets,
    paketTerbit,
  } = detail;
  const p = pkg.payload;
  const f = p.fixture;
  const home = f.home;
  const away = f.away;

  const luck = (p.shrunk_metadata?.luckMetrics ?? null) as LuckMetrics | null;
  const feedMode = (p as unknown as { feed_mode?: string }).feed_mode;
  const resolution = resolutionSentence(p.shrunk_metadata?.leagueResolution);

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

  const trioDari = (probs: Record<string, number>) => {
    const a = probs["1x2:1"] ?? null;
    const x = probs["1x2:x"] ?? null;
    const b = probs["1x2:2"] ?? null;
    return a !== null && x !== null && b !== null ? { a, x, b } : null;
  };
  const trioTerbaru = trioDari(p.probabilities);
  const trioTerbit = paketTerbit ? trioDari(paketTerbit.payload.probabilities) : null;

  let kalimatPeta: string | null = null;
  if (trioTerbaru) {
    const { a: p1, x: px, b: p2 } = trioTerbaru;
    const maks = Math.max(p1, px, p2);
    if (maks === p1) {
      kalimatPeta = `${home} paling berpeluang menang. Model tetap memberi peluang ${pct(px + p2)} untuk seri atau kemenangan ${away}.`;
    } else if (maks === p2) {
      kalimatPeta = `${away} paling berpeluang menang. Model tetap memberi peluang ${pct(p1 + px)} untuk seri atau kemenangan ${home}.`;
    } else {
      kalimatPeta = `Seri adalah hasil paling berpeluang menurut model. Model tetap memberi peluang ${pct(p1 + p2)} untuk kemenangan salah satu tim.`;
    }
  }

  const selesai = keadaan?.status === "finished";
  // Hitungan penilaian per KEJADIAN UNIK (bukan baris edisi mentah):
  // dua edisi satu kejadian tidak pernah terhitung dua kali.
  const resmiDinilai = kejadianResmi.filter((k) => k.pick.hit !== null);
  const resmiTepat = resmiDinilai.filter((k) => k.pick.hit === 1).length;
  const paketTerbitBerbeda =
    officialPicks.length > 0 &&
    officialPicks.some((x) => x.package_id !== null && x.package_id !== pkg.id);
  const terbitUtc =
    officialPicks
      .map((x) => x.published_at_utc)
      .filter((x): x is string => Boolean(x))
      .sort()[0] ?? null;

  /* Skor regulasi 90 menit: dari hasil resolver pada pilihan resmi
     (basis terautentikasi K1/Fix-3). Skor dataset pasca-regulasi tidak
     pernah dipakai sebagai skor 90 menit. */
  const skorRegulasi = (() => {
    const dinilai = officialPicks.find((x) => x.home_goals !== null && x.away_goals !== null);
    return dinilai ? { h: dinilai.home_goals!, a: dinilai.away_goals! } : null;
  })();

  const statusTampil = keadaan?.status ?? null;

  /* Peta skor membaca matriks EDISI TERBIT bila ada (matriks pra-laga
     yang dibandingkan dengan hasil, brief §9), selain itu paket
     terbaru. Validasi sekali di batas data lewat adapter §9. */
  const paketPeta = paketTerbit ?? pkg;
  const petaValid = adaptasiMatriks(paketPeta.payload.score_matrix);
  const skorAkhirPeta =
    selesai && keadaan.home_goals !== null
      ? (skorRegulasi ??
        (keadaan.pascaregulasi
          ? null
          : { h: keadaan.home_goals, a: keadaan.away_goals! }))
      : null;

  selesaikanTimerRute("/pertandingan/[matchId]", t0Timer);
  return (
    <div>
      <Link href={kembali.href} className="text-sm text-mid-gray transition-colors hover:text-ink">
        ← {kembali.label}
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
        {selesai && keadaan.home_goals !== null && (
          <div className="mt-8">
            {keadaan.pascaregulasi ? (
              <>
                <p className="text-sm text-mid-gray">
                  Skor {keadaan.pascaregulasi === "aet" ? "setelah perpanjangan waktu" : "adu penalti"}
                </p>
                <p className="mt-1 text-xl font-medium text-ink">
                  {home} {keadaan.home_goals}–{keadaan.away_goals} {away}
                </p>
                {skorRegulasi ? (
                  <p className="mt-3 text-xl font-medium text-ink">
                    Skor 90 menit · {home} {skorRegulasi.h}–{skorRegulasi.a} {away}
                  </p>
                ) : (
                  <p className="mt-3 text-[15px] text-mid-gray">
                    Skor 90 menit belum terkonfirmasi — penilaian menunggu hasil resmi.
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-sm text-mid-gray">Skor 90 menit</p>
                <p className="mt-1 text-xl font-medium text-ink">
                  {home} {keadaan.home_goals}–{keadaan.away_goals} {away}
                </p>
              </>
            )}
            {officialPicks.length > 0 && (
              <p className="mt-1.5 text-sm text-mid-gray">
                {resmiDinilai.length > 0
                  ? `${resmiTepat} dari ${resmiDinilai.length} pilihan resmi tepat.`
                  : `${kejadianResmi.length} pilihan resmi tercatat, belum ada yang dinilai.`}
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
            Selesai · Skor 90 menit {home} {result.home_goals}–{result.away_goals} {away}.
          </p>
        )}
      </header>

      {/* ------------------------------------------- prediksi edisi terbit */}
      {officialPicks.length > 0 && (
        <section className="mt-16">
          <SectionHead
            label={selesai ? "Prediksi saat terbit" : "Prediksi sebelum laga"}
            right={
              <span className="text-[13px] text-faint">{kejadianResmi.length} pilihan resmi</span>
            }
          />
          {trioTerbit && (
            <dl className="mt-6 grid gap-6 sm:grid-cols-3">
              {[
                { nama: `${home} menang`, nilai: trioTerbit.a },
                { nama: "Seri", nilai: trioTerbit.x },
                { nama: `${away} menang`, nilai: trioTerbit.b },
              ].map((r) => (
                <div key={r.nama}>
                  <dt className="text-sm break-words text-mid-gray">{r.nama}</dt>
                  <dd className="mt-1">
                    <Prob value={r.nilai} strong className="text-[32px] leading-none" />
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {terbitUtc && (
            <p className="mt-4 text-[13px] text-faint">
              Terbit {tanggalJamWib(terbitUtc, tz)}. Angka terbit tidak berubah oleh analisis
              yang lebih baru.
            </p>
          )}
          {selesai && skorRegulasi && (
            <p className="mt-2 text-[13px] text-faint">
              Dinilai terhadap skor 90 menit {skorRegulasi.h}–{skorRegulasi.a}.
            </p>
          )}
          {/* Kejadian UNIK (aturan pengelompokan yang sama dengan
              Pilihan): satu baris per kejadian semantik. Edisi sumber
              hidup di lapis audit yang bisa dibuka di bawah barisnya —
              tidak hilang, tidak tercampur ke bacaan utama. Kejadian
              berkonflik tidak menampilkan satu angka pun sebagai
              angka resmi; labelnya "Dua sumber berbeda angka" dan
              kedua nilainya ada di rincian edisi. */}
          <ul className="mt-6 space-y-4">
            {kejadianResmi.map((k) => {
              const pk = k.pick;
              const sumber = sumberDariPick(pk);
              const pembandingTeks = teksPembanding(sumber.pembanding, tz);
              const basisDikenal =
                pk.probability_basis === "model" || pk.probability_basis === "effective";
              return (
                <li key={pk.pick_uid} className="border-t border-hairline/50 pt-4">
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <GradeMark grade={pk.grade} />
                    <span className="min-w-0 flex-1 break-words text-[15px] text-ink">
                      {labelPilihan(pk.market, pk.selection, home, away)}
                    </span>
                    <span className="text-right">
                      {k.konflik ? (
                        <span className="text-[13px] font-medium text-brick">
                          Dua sumber berbeda angka
                        </span>
                      ) : pk.published_prob !== null ? (
                        <>
                          <Prob value={pk.published_prob} strong />{" "}
                          <span className="text-[13px] text-faint">
                            {basisDikenal ? sumber.label_basis : "peluang saat terbit"}
                          </span>
                        </>
                      ) : (
                        <span className="text-[13px] text-faint">
                          {labelBasisPeluang(pk.probability_basis)}
                        </span>
                      )}
                    </span>
                    <span className="w-full text-[13px] text-faint">
                      {k.konflik ? (
                        <>
                          Dua edisi resmi menerbitkan angka berbeda untuk kejadian ini —
                          tidak ada angka yang dipilih diam-diam.{" "}
                        </>
                      ) : (
                        <>
                          {sumber.keterangan_basis && <>{sumber.keterangan_basis} · </>}
                          {labelGate(pk.gate_status)}
                          {pk.published_at_utc && (
                            <> · Terbit {tanggalJamWib(pk.published_at_utc, tz)}</>
                          )}
                          {pembandingTeks && <> · {pembandingTeks}</>}
                          {" · "}
                        </>
                      )}
                      <span
                        className={
                          pk.hit === 1
                            ? "font-medium text-sage"
                            : pk.hit === 0
                              ? "font-medium text-brick"
                              : ""
                        }
                      >
                        {verdikDetail(pk, selesai)}
                      </span>
                    </span>
                  </div>
                  {k.edisi.length > 1 && (
                    <details className="mt-2">
                      <summary className="min-h-[28px] cursor-pointer text-[13px] font-medium text-mid-gray transition-colors hover:text-ink">
                        Edisi sumber · {k.edisi.length}
                        {k.konflik ? " — kedua angka berbeda" : " — angka sama"}
                      </summary>
                      <ul className="mt-1.5 space-y-1.5">
                        {k.edisi.map((e) => (
                          <li
                            key={e.pick_uid}
                            className="flex flex-wrap items-baseline gap-x-3 text-[13px] text-faint"
                          >
                            <span className="font-medium text-mid-gray">
                              {e.published_prob !== null
                                ? pct(e.published_prob, 1)
                                : labelBasisPeluang(e.probability_basis)}
                            </span>
                            <span>{e.match_id}</span>
                            {e.published_at_utc && (
                              <span>Terbit {tanggalJamWib(e.published_at_utc, tz)}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

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

      {/* --------------------------------- angka mutakhir (bagian sendiri) */}
      {trioTerbaru && (officialPicks.length === 0 || paketTerbitBerbeda) && (
        <section className="mt-16">
          <SectionHead
            label={officialPicks.length === 0 ? "Peta peluang" : "Analisis terbaru"}
            right={
              paketTerbitBerbeda ? (
                <span className="text-[13px] text-faint">
                  Dihitung {tanggalJamWib(pkg.computed_utc, tz)}
                </span>
              ) : undefined
            }
          />
          <dl className="mt-6 grid gap-6 sm:grid-cols-3">
            {[
              { nama: `${home} menang`, nilai: trioTerbaru.a },
              { nama: "Seri", nilai: trioTerbaru.x },
              { nama: `${away} menang`, nilai: trioTerbaru.b },
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
          {officialPicks.length === 0 && (
            <p className="mt-3 text-[13px] text-faint">
              Peluang dari model skor, dihitung {tanggalJamWib(pkg.computed_utc, tz)}. Belum ada
              edisi terbit resmi untuk laga ini.
            </p>
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
          <p>
            Perbandingan dari analisis terbaru · Dihitung {tanggalJamWib(pkg.computed_utc, tz)}.
          </p>
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
                  . Peluang tersirat pasar diturunkan dari odds setelah margin dihapus.
                </>
              ) : (
                <>
                  Harga pasar tersedia, tetapi waktu tangkapnya tidak tercatat pada
                  paket ini. Peluang tersirat pasar diturunkan dari odds setelah
                  margin dihapus.
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
        {p.sm_panel && panelArsipAdaNilai(p.sm_panel) ? (
          <>
            <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-faint">
              Panel arsip Sportmonks ·{" "}
              {p.sm_panel.batch_utc
                ? tanggalJamWib(p.sm_panel.batch_utc, tz)
                : "Waktu arsip tidak tersedia"}
              . Ini arsip probabilitas lama — bukan angka langsung dan tidak masuk
              perbandingan sumber di atas.
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

      {/* ------------------------------------------------ kemungkinan skor */}
      <section className="mt-16">
        <SectionHead
          label="Kemungkinan skor"
          sub="Peta peluang skor dari matriks model edisi yang dirujuk. Pilih skor untuk membaca peluang persisnya."
        />
        <div className="mt-6">
          {petaValid ? (
            <PetaSkor
              home={home}
              away={away}
              matrix={petaValid.matrix}
              tailMass={paketPeta.payload.score_matrix_tail_mass ?? null}
              skorAkhir={skorAkhirPeta}
            />
          ) : (
            <p className="text-sm text-faint">Peta skor belum tersedia untuk laga ini.</p>
          )}
        </div>
      </section>

      {/* --------------------------------------------- tentang angka ini */}
      <section className="mt-16">
        <SectionHead label="Tentang angka ini" />
        <div className="mt-6 max-w-2xl space-y-3.5 text-[15px] leading-relaxed text-ink-soft">
          <p>Model menghitung peluang tiap hasil pertandingan.</p>
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
