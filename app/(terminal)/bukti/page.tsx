/**
 * REKAM HASIL — buku besar terbuka pilihan RESMI dan tiket RESMI.
 *
 * Pure Server Component, read-only. Prinsip halaman (D4 + bab UI U4):
 * - Default "Pilihan yang diterbitkan": ringkasan dan tabel berasal dari
 *   cohort yang SAMA (cohortStats K2 dengan filter halaman) — filter
 *   mengubah anggota cohort, bukan definisi ukuran.
 * - Angka terbit adalah snapshot beku saat terbit (K2); analisis terbaru
 *   tidak pernah menimpa angka rekam.
 * - Tiket resmi (K3) dipisah dari pilihan; slip draf browser tidak
 *   masuk penyebut mana pun. Detail tiket lewat /bukti?tiket=<slip_uid>.
 * - Angka lab hanya tampil di bagian "Uji historis", tidak dicampur.
 * - Keadaan kosong jujur: tanpa penyebut tampil "Belum ada hasil",
 *   0% hanya bila ada observasi yang dinilai.
 */
import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import {
  GateStatus,
  GradeMark,
  PageLoading,
  Prob,
  SectionHead,
} from "../../../components/ui";
import { landingStats, ledgerStats } from "../../../lib/web/data";
import {
  DAFTAR_ZONA,
  MARKET_LABEL,
  int,
  jamWibOnly,
  labelBasisPeluang,
  labelPilihan,
  pct,
  tanggalJamWib,
  tanggalPanjang,
  tanggalWib,
} from "../../../lib/web/format";
import {
  ambilDetailTiket,
  ambilRekam,
  bulatkanTampil,
  KEADAAN_LABEL,
  parseFilterRekam,
  type BarisRekam,
  type DetailTiket,
  type RekamData,
} from "../../../lib/web/rekam";
import type { OfficialSlipView } from "../../../lib/picks/tickets";

export const metadata: Metadata = { title: "Rekam hasil | Bola" };

const TH = "pb-3 text-left text-[13px] font-normal text-mid-gray";
const THR = "pb-3 text-right text-[13px] font-normal text-mid-gray";
const TD = "py-3 text-mid-gray";
const TDR = "py-3 text-right tabular-nums text-mid-gray";
const MAKS_BARIS = 200;

type Params = Record<string, string | string[] | undefined>;

export default function BuktiPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  return (
    <Suspense fallback={<PageLoading label="Memuat rekam hasil…" />}>
      <BuktiContent searchParams={searchParams} />
    </Suspense>
  );
}

/* ------------------------------------------------------------ tiket */

const STATE_TIKET_LABEL: Record<string, string> = {
  hit: "Tepat",
  miss: "Meleset",
  void: "Batal",
  pending: "Menunggu hasil",
};

const BASIS_GABUNGAN_LABEL: Record<string, string> = {
  independence: "Independensi antarlaga",
  matrix_intersection: "Irisan matriks satu laga",
  dependency_range: "Rentang ketergantungan",
  joint_unavailable: "Gabungan tidak tersedia",
};

const ALASAN_GABUNGAN_LABEL: Record<string, string> = {
  joint_unavailable: "matriks skor tidak tersedia untuk irisan satu laga",
  leg_prob_unrecorded: "ada pilihan tanpa peluang terbit tercatat",
};

function teksGabungan(s: OfficialSlipView): string {
  if (s.combined_prob === null) {
    const alasan = s.combined_reason
      ? (ALASAN_GABUNGAN_LABEL[s.combined_reason] ?? s.combined_reason)
      : null;
    return alasan
      ? `Peluang gabungan tidak tersedia — ${alasan}`
      : "Peluang gabungan tidak tersedia";
  }
  const basis = BASIS_GABUNGAN_LABEL[s.combined_basis] ?? s.combined_basis;
  if (
    s.combined_low !== null &&
    s.combined_high !== null &&
    s.combined_high - s.combined_low > 1e-12
  ) {
    return `${pct(s.combined_low)} – ${pct(s.combined_high)} · ${basis}`;
  }
  return `${pct(s.combined_prob)} · ${basis}`;
}

function DetailTiketBlok({ detail, tz }: { detail: DetailTiket; tz: string }) {
  const { slip, legs } = detail;
  return (
    <section className="mt-12" aria-label="Detail tiket resmi">
      <SectionHead label="Detail tiket resmi" />
      <h2 className="font-display mt-6 text-2xl font-semibold text-ink">
        Tiket {slip.edition_key} · {slip.slot}
      </h2>
      <p className="mt-2 text-[13px] text-mid-gray">
        Terbit {tanggalJamWib(slip.published_utc, tz)} · Seri {slip.series} · Kebijakan status{" "}
        {slip.policy_version}
      </p>
      <p className="mt-4 text-[15px] text-ink">
        Status: <strong>{STATE_TIKET_LABEL[slip.state] ?? slip.state}</strong>
      </p>
      {slip.state === "pending" && slip.has_missed_leg && (
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-mid-gray">
          Sudah ada pilihan yang meleset — status akhir tetap menunggu semua pilihan selesai.
        </p>
      )}
      <p className="mt-2 text-[15px] text-mid-gray">{teksGabungan(slip)}</p>

      {slip.combined_detail && slip.combined_detail.groups.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-ink">Ketergantungan antar pilihan</h3>
          <ul className="mt-2 space-y-1.5">
            {slip.combined_detail.groups.map((gr, i) => {
              const terkuat =
                slip.combined_detail?.strongest_dependency === gr ||
                (slip.combined_detail?.strongest_dependency?.kind === gr.kind &&
                  slip.combined_detail?.strongest_dependency?.pick_uids.join() ===
                    gr.pick_uids.join());
              return (
                <li key={i} className="text-[13px] leading-relaxed text-mid-gray">
                  {gr.kind === "same_fixture"
                    ? "Laga yang sama"
                    : `Tim yang sama dalam jendela singkat${gr.teams?.length ? `: ${gr.teams.join(", ")}` : ""}`}
                  {" — "}
                  {gr.note}
                  {terkuat ? " (ketergantungan terkuat)" : ""}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-6 overflow-x-auto" role="region" aria-label="Anggota tiket">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr>
              <th className={TH}>Laga</th>
              <th className={TH}>Pilihan</th>
              <th className={THR}>Peluang beku</th>
              <th className={THR}>Skor</th>
              <th className={THR}>Hasil</th>
            </tr>
          </thead>
          <tbody>
            {legs.map((leg) => (
              <tr key={leg.pick_uid} className="border-t border-hairline/50">
                <td className={TD}>
                  <span className="text-ink">
                    {leg.home} <span className="text-faint">vs</span> {leg.away}
                  </span>
                  {leg.kickoff_utc && (
                    <span className="block text-[12px] text-faint">
                      {tanggalWib(leg.kickoff_utc, tz)} · {jamWibOnly(leg.kickoff_utc, tz)}
                    </span>
                  )}
                </td>
                <td className={TD}>{labelPilihan(leg.market, leg.selection, leg.home, leg.away)}</td>
                <td className={TDR}>
                  {leg.frozen_prob !== null ? pct(leg.frozen_prob) : "Tidak tercatat"}
                </td>
                <td className={TDR}>
                  {leg.home_goals !== null && leg.away_goals !== null
                    ? `${leg.home_goals}–${leg.away_goals}`
                    : "—"}
                </td>
                <td className={`${TDR} font-medium text-ink`}>
                  {STATE_TIKET_LABEL[leg.state] ?? leg.state}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-6">
        <Link href="/bukti" className="text-sm text-accent hover:text-ink">
          Kembali ke rekam hasil
        </Link>
      </p>
    </section>
  );
}

/* ------------------------------------------------------------- baris */

function alasanPending(b: BarisRekam): string | null {
  if (b.keadaan === "menunggu-jendela") return "Menunggu hasil dari sumber data.";
  if (b.keadaan === "jatuh-tempo") {
    return b.alasan_jatuh_tempo === "konflik"
      ? "Menunggu peninjauan konflik identitas."
      : "Menunggu hasil dari sumber data.";
  }
  return null;
}

function BarisRekamTabel({ b, tz }: { b: BarisRekam; tz: string }) {
  const alasan = alasanPending(b);
  return (
    <tr className="border-t border-hairline/50">
      <td className={TD}>
        <Link href={`/pertandingan/${b.match_id}`} className="text-ink hover:underline">
          {b.home} <span className="text-faint">vs</span> {b.away}
        </Link>
        <span className="block text-[12px] text-faint">
          {tanggalWib(b.kickoff_utc, tz)} · {jamWibOnly(b.kickoff_utc, tz)}
          {b.competition_name ? ` · ${b.competition_name}` : ""}
        </span>
      </td>
      <td className={TD}>
        <span className="flex items-start gap-2">
          <GradeMark grade={b.grade ?? ""} className="pt-px" />
          <span>
            <span className="block text-ink">
              {labelPilihan(b.market, b.selection, b.home, b.away)}
            </span>
            <span className="block text-[12px] text-faint">
              {MARKET_LABEL[b.market] ?? b.market}
              {b.gate_status ? " · " : ""}
              {b.gate_status ? <GateStatus status={b.gate_status} /> : null}
            </span>
          </span>
        </span>
      </td>
      <td className={TDR}>
        {typeof b.published_display === "number" ? (
          <Prob value={b.published_display} />
        ) : (
          <span className="text-[13px]">{b.published_display}</span>
        )}
        <span className="block text-[12px] text-faint">
          {labelBasisPeluang(b.probability_basis)}
          {b.published_at_utc ? ` · terbit ${jamWibOnly(b.published_at_utc, tz)}` : ""}
        </span>
      </td>
      <td className={TDR}>
        {b.home_goals !== null && b.away_goals !== null
          ? `${b.home_goals}–${b.away_goals}`
          : "—"}
      </td>
      <td className={`${TDR} font-medium text-ink`}>
        {KEADAAN_LABEL[b.keadaan]}
        {alasan && (
          <span className="block text-[12px] font-normal text-faint">{alasan}</span>
        )}
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------ konten */

async function BuktiContent({ searchParams }: { searchParams: Promise<Params> }) {
  await connection();
  const params = await searchParams;
  const filter = parseFilterRekam(params);
  const tz = filter.tz;
  const nowUtc = new Date().toISOString();
  const data: RekamData = ambilRekam(filter, nowUtc);
  const s = data.stats;

  const tiketParam = Array.isArray(params.tiket) ? params.tiket[0] : params.tiket;
  const detailTiket =
    typeof tiketParam === "string" && tiketParam ? ambilDetailTiket(tiketParam) : null;

  const menunggu = s.not_started + s.awaiting_window + s.overdue_pending;
  const konflikJatuhTempo = s.overdue_by_reason["konflik"] ?? 0;
  const kelasSelect =
    "rounded-md border border-hairline bg-surface px-2.5 py-2 text-sm text-ink";
  const labelKelas = "block text-[12px] text-faint mb-1";

  return (
    <div>
      <header>
        <h1 className="font-display text-[2.5rem] leading-tight font-semibold tracking-[-0.02em] text-ink">
          Rekam hasil
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-mid-gray">
          Setiap pilihan resmi dicatat sebelum sepak mula dan dinilai dari skor akhir. Ringkasan
          dan tabel di halaman ini dihitung dari cohort yang sama.
        </p>
      </header>

      {typeof tiketParam === "string" && tiketParam ? (
        detailTiket ? (
          <DetailTiketBlok detail={detailTiket} tz={tz} />
        ) : (
          <section className="mt-12" aria-label="Tiket tidak ditemukan">
            <SectionHead label="Detail tiket resmi" />
            <p className="mt-6 text-[15px] text-ink">Tiket tidak ditemukan</p>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-mid-gray">
              ID tiket pada tautan ini tidak ada di rekam resmi.{" "}
              <Link href="/bukti" className="text-accent hover:text-ink">
                Kembali ke rekam hasil
              </Link>
            </p>
          </section>
        )
      ) : null}

      {/* ------------------------------------------- pilihan diterbitkan */}
      <section className="mt-16" aria-label="Pilihan yang diterbitkan">
        <SectionHead label="Pilihan yang diterbitkan" />
        <p className="mt-4 text-[13px] text-mid-gray">
          Periode:{" "}
          {filter.dari || filter.sampai
            ? `${filter.dari ? tanggalPanjang(`${filter.dari}T12:00:00.000Z`, tz) : "awal"} – ${
                filter.sampai ? tanggalPanjang(`${filter.sampai}T12:00:00.000Z`, tz) : "akhir"
              }`
            : "Semua periode"}
          {data.diperbarui_utc
            ? ` · Terbit terakhir ${tanggalJamWib(data.diperbarui_utc, tz)}`
            : ""}
        </p>

        <form method="get" action="/bukti" className="mt-6 flex flex-wrap items-end gap-3">
          <label>
            <span className={labelKelas}>Pasar</span>
            <select name="pasar" defaultValue={filter.pasar ?? ""} className={kelasSelect}>
              <option value="">Semua pasar</option>
              {data.opsi_pasar.map((m) => (
                <option key={m} value={m}>
                  {MARKET_LABEL[m] ?? m}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={labelKelas}>Kelas</span>
            <select name="kelas" defaultValue={filter.kelas ?? ""} className={kelasSelect}>
              <option value="">Semua kelas</option>
              <option value="A">Kelas A</option>
              <option value="B">Kelas B</option>
              <option value="C">Kelas C</option>
            </select>
          </label>
          <label>
            <span className={labelKelas}>Liga</span>
            <select name="liga" defaultValue={filter.liga ?? ""} className={kelasSelect}>
              <option value="">Semua liga</option>
              {data.opsi_liga.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nama}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={labelKelas}>Dari tanggal</span>
            <input
              type="date"
              name="dari"
              defaultValue={filter.dari ?? ""}
              className={kelasSelect}
            />
          </label>
          <label>
            <span className={labelKelas}>Sampai tanggal</span>
            <input
              type="date"
              name="sampai"
              defaultValue={filter.sampai ?? ""}
              className={kelasSelect}
            />
          </label>
          <label>
            <span className={labelKelas}>Zona waktu</span>
            <select name="tz" defaultValue={filter.tz} className={kelasSelect}>
              {DAFTAR_ZONA.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-md border border-hairline bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:text-accent"
          >
            Terapkan
          </button>
          {(filter.pasar || filter.kelas || filter.liga || filter.dari || filter.sampai) && (
            <Link href="/bukti" className="px-1 py-2 text-sm text-mid-gray hover:text-ink">
              Atur ulang
            </Link>
          )}
        </form>

        <div className="mt-10 flex flex-wrap gap-x-14 gap-y-8" aria-label="Ringkasan rekam">
          <div>
            <p className="tabular-nums font-display text-[32px] leading-none font-semibold text-ink">
              {int(s.issued)}
            </p>
            <p className="mt-2 text-[13px] text-mid-gray">Pilihan terbit</p>
          </div>
          <div>
            <p className="tabular-nums font-display text-[32px] leading-none font-semibold text-ink">
              {int(s.settled)}
            </p>
            <p className="mt-2 text-[13px] text-mid-gray">Sudah dinilai</p>
          </div>
          <div>
            <p className="tabular-nums font-display text-[32px] leading-none font-semibold text-ink">
              {int(menunggu)}
            </p>
            <p className="mt-2 text-[13px] text-mid-gray">
              Menunggu · {int(s.not_started)} belum mulai
            </p>
          </div>
          <div>
            <p className="tabular-nums font-display text-[32px] leading-none font-semibold text-ink">
              {int(s.voids)}
            </p>
            <p className="mt-2 text-[13px] text-mid-gray">Batal</p>
          </div>
          <div>
            <p className="tabular-nums font-display text-[32px] leading-none font-semibold text-ink">
              {s.coverage ? `${s.coverage[0]} dari ${s.coverage[1]}` : "—"}
            </p>
            <p className="mt-2 text-[13px] text-mid-gray">
              Cakupan penilaian yang sudah jatuh tempo
              {s.coverage_ratio !== null ? ` (${pct(s.coverage_ratio)})` : ""}
            </p>
          </div>
        </div>

        <div className="mt-8 max-w-2xl space-y-2 text-[15px] leading-relaxed">
          {s.empty ? (
            <p className="text-ink">
              Belum ada hasil — belum ada pilihan yang bisa dinilai pada rentang ini.
            </p>
          ) : (
            <p className="text-ink">
              {int(s.hits)} dari {int(s.settled)} pilihan tepat ({pct(s.hit_ratio)}) di{" "}
              {int(data.laga_dinilai_unik)} laga
            </p>
          )}
          {s.prob_slice.n > 0 && (
            <p className="text-mid-gray">
              Rata-rata peluang saat terbit {pct(bulatkanTampil(s.prob_slice.avg_published_prob))}{" "}
              pada {int(s.prob_slice.n)} pilihan dinilai yang peluang terbitnya tercatat; hasil
              sebenarnya {pct(bulatkanTampil(s.prob_slice.avg_hit))}.
              {s.prob_slice.legacy_hitmiss_only > 0
                ? ` ${int(s.prob_slice.legacy_hitmiss_only)} pilihan warisan hanya bisa dinilai tepat/meleset — peluang terbitnya tidak tercatat.`
                : ""}
            </p>
          )}
          {s.overdue_pending > 0 && (
            <p className="text-mid-gray">
              {int(s.overdue_pending)} pilihan sudah jatuh tempo tetapi belum dinilai
              {konflikJatuhTempo > 0
                ? ` — ${int(konflikJatuhTempo)} di antaranya menunggu peninjauan konflik identitas`
                : ""}
              .
            </p>
          )}
        </div>

        {data.baris.length === 0 ? (
          <p className="mt-10 max-w-2xl text-[15px] leading-relaxed text-mid-gray">
            Belum ada pilihan diterbitkan pada rentang ini.
          </p>
        ) : (
          <>
            <div
              className="mt-8 overflow-x-auto"
              role="region"
              aria-label="Tabel pilihan yang diterbitkan"
            >
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr>
                    <th className={TH}>Laga</th>
                    <th className={TH}>Pilihan</th>
                    <th className={THR}>Peluang saat terbit</th>
                    <th className={THR}>Skor</th>
                    <th className={THR}>Hasil</th>
                  </tr>
                </thead>
                <tbody>
                  {data.baris.slice(0, MAKS_BARIS).map((b) => (
                    <BarisRekamTabel key={b.pick_id} b={b} tz={tz} />
                  ))}
                </tbody>
              </table>
            </div>
            {data.baris.length > MAKS_BARIS && (
              <p className="mt-4 text-[13px] text-faint">
                Menampilkan {MAKS_BARIS} baris terbaru dari {int(data.baris.length)} pilihan
                pada filter ini.
              </p>
            )}
          </>
        )}
      </section>

      {/* -------------------------------------------------- tiket resmi */}
      <section className="mt-16" aria-label="Tiket resmi">
        <SectionHead label="Tiket resmi" />
        {data.tiket_stats.slips === 0 ? (
          <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-mid-gray">
            Belum ada tiket resmi pada rekam ini.
          </p>
        ) : (
          <>
            <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-ink">
              {data.tiket_stats.hit_ratio !== null ? (
                <>
                  {int(data.tiket_stats.hit)} dari{" "}
                  {int(data.tiket_stats.hit + data.tiket_stats.miss)} tiket tepat (
                  {pct(data.tiket_stats.hit_ratio)})
                </>
              ) : (
                "Belum ada hasil — belum ada tiket resmi yang selesai dinilai."
              )}
            </p>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-mid-gray">
              {int(data.tiket_stats.slips)} tiket · {int(data.tiket_stats.void)} batal ·{" "}
              {int(data.tiket_stats.pending)} menunggu · {int(data.tiket_stats.unique_fixtures)}{" "}
              laga unik · {int(data.tiket_stats.total_legs)} pilihan anggota. Slip yang disusun
              sendiri di halaman Pilihan tidak masuk hitungan ini.
            </p>
            <ul className="mt-6">
              {data.tiket.map((t) => (
                <li
                  key={t.slip_uid}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-hairline/50 py-3.5 first:border-t-0"
                >
                  <span className="font-mono text-[11px] text-faint">
                    {tanggalWib(t.published_utc, tz)} · {jamWibOnly(t.published_utc, tz)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <Link
                      href={`/bukti?tiket=${encodeURIComponent(t.slip_uid)}`}
                      className="block truncate text-[15px] text-ink hover:underline"
                    >
                      Tiket {t.edition_key} · {t.slot}
                    </Link>
                    <span className="block truncate text-[13px] text-mid-gray">
                      {t.legs.length} pilihan · {teksGabungan(t)}
                    </span>
                  </span>
                  <span className="text-[13px] font-medium text-ink">
                    {STATE_TIKET_LABEL[t.state] ?? t.state}
                    {t.state === "pending" && t.has_missed_leg ? " · ada yang meleset" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* ------------------------------------------------- uji historis */}
      <UjiHistoris />
    </div>
  );
}

/**
 * Angka lab (uji mundur) — bagian terpisah dan berlabel jelas; tidak
 * pernah dicampur ke cohort pilihan resmi di atas (D4 + bab UI U4).
 */
function UjiHistoris() {
  const s = ledgerStats();
  const landing = landingStats();
  return (
    <section className="mt-16" aria-label="Uji historis">
      <SectionHead label="Uji historis" />
      <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-mid-gray">
        Hasil uji mundur laboratorium pada data historis — bukan pilihan resmi pra-laga.{" "}
        {int(s.lab_total)} kandidat diuji, {int(landing.lab_resolved)} sudah dinilai. Kandidat
        di bawah lantai kelas terendah tidak masuk tabel kelas.
      </p>
      {s.lab_by_grade.length > 0 && (
        <div
          className="mt-6 overflow-x-auto"
          role="region"
          aria-label="Tabel uji historis per kelas"
        >
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr>
                <th className={TH}>Kelas</th>
                <th className={THR}>Rata-rata peluang model</th>
                <th className={THR}>Porsi yang tepat</th>
                <th className={THR}>Kandidat dinilai</th>
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
      )}
    </section>
  );
}
