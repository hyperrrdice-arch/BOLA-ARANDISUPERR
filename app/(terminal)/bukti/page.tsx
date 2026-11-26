/**
 * REKAM HASIL — buku besar terbuka pilihan RESMI dan tiket RESMI.
 *
 * Pure Server Component, read-only. Prinsip halaman (D4 + bab UI U4 +
 * brief redesain §3E):
 * - Urutan: judul, periode yang bisa diubah (default Semua periode),
 *   "Ringkasan periode", lalu tab Sudah dinilai (default) / Menunggu /
 *   Batal. Tab hanya mengatur DAFTAR — ringkasan dan daftar berasal
 *   dari cohort yang SAMA (cohortStats K2 dengan filter halaman), jadi
 *   mengganti tab tidak pernah mengubah pembilang/penyebut/cakupan.
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
import TabRekam from "../../../components/bukti/TabRekam";
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
  ZONA_BAKU,
} from "../../../lib/web/format";
import {
  ambilDetailTiket,
  ambilKeputusanFix4HariIni,
  ambilRekam,
  bulatkanTampil,
  kalimatRingkasan,
  kelompokkanTabRekam,
  KEADAAN_LABEL,
  parseFilterRekam,
  type BarisRekam,
  type DetailTiket,
  type KelompokLagaRekam,
  type KeputusanFix4HariIni,
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
        <Link href="/bukti" className="text-sm text-accent-deep hover:text-ink">
          Kembali ke rekam hasil
        </Link>
      </p>
    </section>
  );
}

/* ------------------------------------------- keputusan tiket hari ini */

/**
 * Kartu keputusan Fix-4 HARI INI dalam WIB (B2.1). Tanggal kartu berasal
 * dari `fix4DateWibOf(nowUtc)` di lapisan baca — filter zona halaman
 * TIDAK menggesernya, dan semua jam di kartu ini selalu WIB. Status
 * dipahami lewat teks; angka peluang adalah snapshot beku saat terbit.
 */
const STATUS_KEPUTUSAN_LABEL: Record<KeputusanFix4HariIni["status"], string> = {
  menunggu: "Menunggu keputusan",
  "belum-tersedia": "Keputusan belum tersedia",
  abstain: "Abstain",
  terbit: "Tiket terbit",
  "tercatat-tak-utuh": "Tiket tercatat · detail belum tersedia",
  "data-belum-ada": "Data tiket belum tersedia",
};

function KartuKeputusanFix4({ k }: { k: KeputusanFix4HariIni }) {
  const jamBatas = jamWibOnly(k.batas_penilaian_utc, ZONA_BAKU);
  return (
    <section className="mt-10" aria-label="Keputusan tiket hari ini">
      <div className="rounded-md border border-hairline bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="font-display text-xl font-semibold text-ink">
            Keputusan tiket hari ini
          </h2>
          <p className="text-[13px] text-faint">
            {tanggalPanjang(`${k.date_wib}T12:00:00.000Z`, ZONA_BAKU)} · WIB
          </p>
        </div>
        <p className="mt-3 text-[15px] text-ink">
          Status: <strong>{STATUS_KEPUTUSAN_LABEL[k.status]}</strong>
        </p>

        {k.status === "menunggu" && (
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-mid-gray">
            Belum ada keputusan yang tercatat untuk hari ini. Batas penilaian
            pukul {jamBatas} WIB.
          </p>
        )}
        {k.status === "belum-tersedia" && (
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-mid-gray">
            Batas penilaian pukul {jamBatas} WIB sudah lewat, tetapi belum ada
            keputusan yang tercatat untuk hari ini.
          </p>
        )}
        {k.status === "abstain" && (
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-mid-gray">
            {int(k.eligible_count)} kandidat layak dari {int(k.ukuran_tiket)}{" "}
            yang dibutuhkan — tidak ada tiket yang diterbitkan hari ini.
          </p>
        )}
        {k.status === "data-belum-ada" && (
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-mid-gray">
            Rekam hasil di bawah tetap dapat dipakai.
          </p>
        )}

        {k.status === "terbit" && (
          <ul className="mt-3">
            {k.pilihan.map((p) => (
              <li key={p.position} className="border-t border-hairline/50 first:border-t-0">
                <Link
                  href={p.href_detail}
                  className="flex min-h-[44px] flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
                >
                  <span className="min-w-0 flex-1">
                    {p.home && p.away ? (
                      <>
                        <span className="block text-ink">
                          {p.home} <span className="text-faint">vs</span> {p.away}
                        </span>
                        <span className="block text-[13px] text-mid-gray">
                          {p.label}
                          {p.competition_name ? ` · ${p.competition_name}` : ""}
                        </span>
                      </>
                    ) : (
                      <span className="block text-ink">{p.label}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-right">
                    <Prob value={p.published_prob} />
                    <span className="block text-[12px] text-faint">Peluang resmi</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {k.dicatat_utc && (
          <p className="mt-3 text-[13px] text-faint">
            Dicatat {tanggalJamWib(k.dicatat_utc, ZONA_BAKU)} · Batas penilaian{" "}
            {jamBatas} WIB
          </p>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- baris */

function alasanPending(b: BarisRekam): string | null {
  if (b.keadaan === "menunggu-jendela") return "Menunggu hasil resmi dari sumber data.";
  if (b.keadaan === "tidak-dapat-dinilai")
    return "Tidak dapat dinilai — kompetisinya tidak punya feed hasil.";
  if (b.keadaan === "jatuh-tempo") {
    return b.alasan_jatuh_tempo === "konflik"
      ? "Menunggu peninjauan konflik identitas."
      : "Menunggu hasil resmi dari sumber data.";
  }
  return null;
}

/** Isi satu baris pilihan: kejadian + basis terbit | peluang | hasil. */
function IsiBarisPilihan({ b, tz }: { b: BarisRekam; tz: string }) {
  return (
    <>
      <span className="flex min-w-0 flex-1 items-start gap-2">
        <GradeMark grade={b.grade ?? ""} className="pt-px" />
        <span className="min-w-0">
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
      <span className="shrink-0 text-right">
        {typeof b.published_display === "number" ? (
          <Prob value={b.published_display} />
        ) : (
          <span className="text-[13px] text-mid-gray">{b.published_display}</span>
        )}
        <span className="block text-[12px] text-faint">
          {labelBasisPeluang(b.probability_basis)}
          {b.published_at_utc ? ` · terbit ${jamWibOnly(b.published_at_utc, tz)}` : ""}
        </span>
      </span>
      <span
        className={`w-[86px] shrink-0 text-right font-medium ${
          b.keadaan === "tepat"
            ? "text-tepat"
            : b.keadaan === "meleset"
              ? "text-meleset"
              : "text-ink"
        }`}
      >
        {KEADAAN_LABEL[b.keadaan]}
      </span>
    </>
  );
}

/** Kelompok satu laga pada tab "Sudah dinilai" (brief §3E.1 + lembar 4). */
function KelompokDinilai({ k, tz }: { k: KelompokLagaRekam; tz: string }) {
  return (
    <article className="border-t border-hairline/60 py-5 first:border-t-0">
      <p className="text-[13px] text-faint">
        {tanggalWib(k.kickoff_utc, tz)} · {jamWibOnly(k.kickoff_utc, tz)}
        {k.competition_name ? ` · ${k.competition_name}` : ""}
      </p>
      <div className="mt-1 flex items-baseline justify-between gap-4">
        <h3 className="font-display text-[19px] font-medium text-ink">
          {k.home} <span className="font-normal text-faint">–</span> {k.away}
        </h3>
        {k.home_goals !== null && k.away_goals !== null && (
          <span className="shrink-0 text-right">
            <span className="tabular-nums font-display text-[22px] leading-none font-semibold text-ink">
              {k.home_goals}–{k.away_goals}
            </span>
            <span className="block text-[11px] text-faint">Skor 90 menit</span>
          </span>
        )}
      </div>
      <ul className="mt-2">
        {k.baris.map((b) => (
          <li
            key={b.pick_id}
            className="flex flex-wrap items-start gap-x-3 gap-y-1 border-t border-hairline/40 py-2.5 first:border-t-0"
          >
            <IsiBarisPilihan b={b} tz={tz} />
          </li>
        ))}
      </ul>
      <p className="mt-1">
        <Link
          href={`/pertandingan/${k.match_id}`}
          className="text-sm font-medium text-accent-deep hover:text-ink"
        >
          Buka detail pertandingan
        </Link>
      </p>
    </article>
  );
}

/** Baris mandiri pada tab Menunggu/Batal — nama laga di atas isinya. */
function BarisMandiri({ b, tz }: { b: BarisRekam; tz: string }) {
  const alasan = alasanPending(b);
  return (
    <li className="border-t border-hairline/50 py-3 first:border-t-0">
      <Link href={`/pertandingan/${b.match_id}`} className="text-ink hover:underline">
        {b.home} <span className="text-faint">vs</span> {b.away}
      </Link>
      <span className="block text-[12px] text-faint">
        {tanggalWib(b.kickoff_utc, tz)} · {jamWibOnly(b.kickoff_utc, tz)}
        {b.competition_name ? ` · ${b.competition_name}` : ""}
      </span>
      <span className="mt-1.5 flex flex-wrap items-start gap-x-3 gap-y-1">
        <IsiBarisPilihan b={b} tz={tz} />
      </span>
      {alasan && <span className="mt-0.5 block text-[12px] text-faint">{alasan}</span>}
    </li>
  );
}

/* ------------------------------------------------------------ konten */

async function BuktiContent({ searchParams }: { searchParams: Promise<Params> }) {
  await connection();
  const params = await searchParams;
  const filter = parseFilterRekam(params);
  const tz = filter.tz;
  const nowUtc = new Date().toISOString();
  const keputusan = ambilKeputusanFix4HariIni(nowUtc);
  const data: RekamData = ambilRekam(filter, nowUtc);
  const s = data.stats;
  const ringkasan = kalimatRingkasan(s, data.laga_dinilai_unik);
  const tab = kelompokkanTabRekam(data.baris);

  const tiketParam = Array.isArray(params.tiket) ? params.tiket[0] : params.tiket;
  const detailTiket =
    typeof tiketParam === "string" && tiketParam ? ambilDetailTiket(tiketParam) : null;

  const konflikJatuhTempo = s.overdue_by_reason["konflik"] ?? 0;
  const kelasSelect =
    "w-full rounded-md border border-hairline-strong bg-surface px-2.5 py-2 text-sm text-ink";
  const labelKelas = "block text-[12px] text-faint mb-1";
  const jumlahFilterAktif = [filter.pasar, filter.kelas, filter.liga, filter.dari, filter.sampai]
    .filter(Boolean).length;

  /* Panel tab — dirender server; tab klien hanya memilih tampilannya. */
  const grupTampil: KelompokLagaRekam[] = [];
  {
    let terpakai = 0;
    for (const k of tab.dinilai) {
      if (terpakai > 0 && terpakai + k.baris.length > MAKS_BARIS) break;
      grupTampil.push(k);
      terpakai += k.baris.length;
    }
  }
  const panelDinilai =
    tab.hitungan.dinilai === 0 ? (
      <div className="py-8">
        <h3 className="font-display text-xl font-semibold text-ink">
          Belum ada pilihan yang sudah dinilai
        </h3>
        {tab.hitungan.menunggu > 0 ? (
          <>
            <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-mid-gray">
              {int(tab.hitungan.menunggu)} pilihan masih menunggu hasil resmi.
            </p>
            <button
              type="button"
              data-alih-tab="menunggu"
              className="mt-4 flex min-h-[44px] items-center rounded-md border border-hairline bg-surface px-4 text-sm font-medium text-ink transition-colors hover:text-accent-deep"
            >
              Lihat {int(tab.hitungan.menunggu)} yang menunggu
            </button>
          </>
        ) : (
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-mid-gray">
            Tidak ada pilihan yang menunggu pada periode ini.
          </p>
        )}
      </div>
    ) : (
      <div>
        {grupTampil.map((k) => (
          <KelompokDinilai key={k.kunci} k={k} tz={tz} />
        ))}
        {grupTampil.length < tab.dinilai.length && (
          <p className="mt-4 text-[13px] text-faint">
            Menampilkan {int(grupTampil.reduce((n, k) => n + k.baris.length, 0))} dari{" "}
            {int(tab.hitungan.dinilai)} pilihan yang sudah dinilai — persempit periode atau
            filter untuk melihat sisanya.
          </p>
        )}
      </div>
    );

  const panelMenunggu =
    tab.hitungan.menunggu === 0 && tab.takDinilai.length === 0 ? (
      <p className="max-w-2xl py-8 text-[15px] leading-relaxed text-mid-gray">
        Tidak ada pilihan yang menunggu pada periode ini.
      </p>
    ) : (
      <div>
        {tab.menungguLewat.length > 0 && (
          <section aria-label="Sudah lewat, menunggu hasil resmi">
            <h3 className="pt-4 font-display text-[17px] font-medium text-ink">
              Sudah lewat — menunggu hasil resmi
            </h3>
            <ul>
              {tab.menungguLewat.slice(0, MAKS_BARIS).map((b) => (
                <BarisMandiri key={b.pick_id} b={b} tz={tz} />
              ))}
            </ul>
            {tab.menungguLewat.length > MAKS_BARIS && (
              <p className="mt-4 text-[13px] text-faint">
                Menampilkan {MAKS_BARIS} dari {int(tab.menungguLewat.length)} pilihan yang
                menunggu hasil resmi.
              </p>
            )}
          </section>
        )}
        {tab.menungguMendatang.length > 0 && (
          <section aria-label="Belum mulai">
            <h3 className="pt-6 font-display text-[17px] font-medium text-ink">Belum mulai</h3>
            <ul>
              {tab.menungguMendatang.slice(0, MAKS_BARIS).map((b) => (
                <BarisMandiri key={b.pick_id} b={b} tz={tz} />
              ))}
            </ul>
            {tab.menungguMendatang.length > MAKS_BARIS && (
              <p className="mt-4 text-[13px] text-faint">
                Menampilkan {MAKS_BARIS} dari {int(tab.menungguMendatang.length)} pilihan yang
                belum mulai.
              </p>
            )}
          </section>
        )}
        {tab.takDinilai.length > 0 && (
          <section aria-label="Tidak dapat dinilai">
            <h3 className="pt-6 font-display text-[17px] font-medium text-ink">
              Tidak dapat dinilai
            </h3>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-faint">
              Kompetisi pilihan-pilihan ini tidak punya feed hasil — hasilnya tidak akan
              pernah masuk, jadi pilihan ini tidak dihitung sebagai menunggu dan tidak
              masuk cakupan penilaian.
            </p>
            <ul>
              {tab.takDinilai.slice(0, MAKS_BARIS).map((b) => (
                <BarisMandiri key={b.pick_id} b={b} tz={tz} />
              ))}
            </ul>
            {tab.takDinilai.length > MAKS_BARIS && (
              <p className="mt-4 text-[13px] text-faint">
                Menampilkan {MAKS_BARIS} dari {int(tab.takDinilai.length)} pilihan yang
                tidak dapat dinilai.
              </p>
            )}
          </section>
        )}
      </div>
    );

  const panelBatal =
    tab.hitungan.batal === 0 ? (
      <p className="max-w-2xl py-8 text-[15px] leading-relaxed text-mid-gray">
        Tidak ada pilihan yang dibatalkan pada periode ini.
      </p>
    ) : (
      <div>
        <ul>
          {tab.batal.slice(0, MAKS_BARIS).map((b) => (
            <BarisMandiri key={b.pick_id} b={b} tz={tz} />
          ))}
        </ul>
        {tab.batal.length > MAKS_BARIS && (
          <p className="mt-4 text-[13px] text-faint">
            Menampilkan {MAKS_BARIS} dari {int(tab.batal.length)} pilihan batal.
          </p>
        )}
      </div>
    );

  return (
    <div>
      <header>
        <h1 className="font-display text-[2.5rem] leading-tight font-semibold tracking-[-0.02em] text-ink">
          Rekam hasil
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-mid-gray">
          Setiap pilihan resmi dicatat sebelum sepak mula dan dinilai dari skor akhir.
          Ringkasan dan daftar mengikuti periode serta filter yang kamu pilih.
        </p>
      </header>

      <KartuKeputusanFix4 k={keputusan} />

      {typeof tiketParam === "string" && tiketParam ? (
        detailTiket ? (
          <DetailTiketBlok detail={detailTiket} tz={tz} />
        ) : (
          <section className="mt-12" aria-label="Tiket tidak ditemukan">
            <SectionHead label="Detail tiket resmi" />
            <p className="mt-6 text-[15px] text-ink">Tiket tidak ditemukan</p>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-mid-gray">
              ID tiket pada tautan ini tidak ada di rekam resmi.{" "}
              <Link href="/bukti" className="text-accent-deep hover:text-ink">
                Kembali ke rekam hasil
              </Link>
            </p>
          </section>
        )
      ) : null}

      {/* ------------------------------------------- periode + filter */}
      <section className="mt-12" aria-label="Periode dan filter">
        <p className="text-[13px] text-mid-gray">
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

        {/* Kontrol lengkap hidup di dalam panel Filter (brief upgrade
            P0): pada 320 px enam kontrol yang tampil permanen memenuhi
            layar sebelum ringkasan (form 336 px terukur) dan lebar
            dokumen membengkak ke 333 px dengan tab "Batal" berakhir
            tepat di x=333. Urutan halaman menjadi periode → tombol
            Filter → ringkasan → tab. Form GET dan nama parameter
            tidak berubah. */}
        <details className="group mt-6">
          <summary
            className="inline-flex min-h-[44px] cursor-pointer list-none items-center gap-2 rounded-md border border-hairline-strong bg-surface px-4 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden"
            aria-label="Buka panel filter rekam hasil"
          >
            Filter
            {jumlahFilterAktif > 0 && (
              <span className="text-[13px] font-normal text-mid-gray">
                · {jumlahFilterAktif} aktif
              </span>
            )}
            <span
              aria-hidden="true"
              className="text-faint transition-transform duration-[var(--duration-micro)] group-open:rotate-180"
            >
              ▾
            </span>
          </summary>
          <div className="mt-3 rounded-md border border-hairline bg-surface p-4">
            <form
              method="get"
              action="/bukti"
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
            >
              <label className="block min-w-0">
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
              <label className="block min-w-0">
                <span className={labelKelas}>Kelas</span>
                <select name="kelas" defaultValue={filter.kelas ?? ""} className={kelasSelect}>
                  <option value="">Semua kelas</option>
                  <option value="A">Kelas A</option>
                  <option value="B">Kelas B</option>
                  <option value="C">Kelas C</option>
                </select>
              </label>
              <label className="block min-w-0">
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
              <label className="block min-w-0">
                <span className={labelKelas}>Dari tanggal</span>
                <input
                  type="date"
                  name="dari"
                  defaultValue={filter.dari ?? ""}
                  className={kelasSelect}
                />
              </label>
              <label className="block min-w-0">
                <span className={labelKelas}>Sampai tanggal</span>
                <input
                  type="date"
                  name="sampai"
                  defaultValue={filter.sampai ?? ""}
                  className={kelasSelect}
                />
              </label>
              <label className="block min-w-0">
                <span className={labelKelas}>Zona waktu</span>
                <select name="tz" defaultValue={filter.tz} className={kelasSelect}>
                  {DAFTAR_ZONA.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
                {/* Aksi panel (brief upgrade P1): Terapkan adalah aksi
                    utama (jingga, teks hitam — satu-satunya CTA jingga
                    di panel); Atur ulang tampil bila ADA keadaan yang
                    menyimpang dari bawaan, termasuk zona waktu saja,
                    dan mengembalikan seluruh query ke bawaan. */}
                <button
                  type="submit"
                  className="min-h-[44px] rounded-md bg-accent px-4 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90"
                >
                  Terapkan
                </button>
                {(filter.pasar ||
                  filter.kelas ||
                  filter.liga ||
                  filter.dari ||
                  filter.sampai ||
                  filter.tz !== ZONA_BAKU) && (
                  <Link href="/bukti" className="px-1 py-2 text-sm text-mid-gray hover:text-ink">
                    Atur ulang
                  </Link>
                )}
              </div>
            </form>
          </div>
        </details>
      </section>

      {/* ------------------------------------------- ringkasan periode */}
      <section className="mt-12" aria-label="Ringkasan periode">
        <SectionHead label="Ringkasan periode" />
        <div className="mt-6 flex flex-wrap items-end justify-between gap-x-14 gap-y-4">
          <p className="max-w-xl font-display text-[32px] leading-tight font-semibold text-ink">
            {ringkasan.utama}
          </p>
          {ringkasan.cakupan && (
            <div>
              <p className="text-[13px] text-faint">Cakupan penilaian</p>
              <p className="mt-1 max-w-sm text-[15px] leading-relaxed text-mid-gray">
                {ringkasan.cakupan}
              </p>
            </div>
          )}
        </div>

        <div className="mt-6 max-w-2xl space-y-2 text-[15px] leading-relaxed">
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
          {s.unresolvable > 0 && (
            <p className="text-mid-gray">
              {int(s.unresolvable)} pilihan tidak dapat dinilai — kompetisinya tidak punya
              feed hasil, jadi hasilnya tidak akan pernah masuk. Pilihan ini tidak dihitung
              dalam cakupan penilaian di atas.
            </p>
          )}
          <p className="text-[13px] text-faint">
            {int(s.issued)} pilihan terbit pada periode ini · {int(s.voids)} batal ·{" "}
            {int(tab.hitungan.menunggu)} menunggu
            {tab.hitungan.tak_dinilai > 0
              ? ` · ${int(tab.hitungan.tak_dinilai)} tidak dapat dinilai`
              : ""}
          </p>
        </div>
      </section>

      {/* -------------------------------------------------------- tab */}
      <section className="mt-10" aria-label="Daftar pilihan">
        {data.baris.length === 0 ? (
          <p className="max-w-2xl py-4 text-[15px] leading-relaxed text-mid-gray">
            Belum ada pilihan diterbitkan pada rentang ini — ubah periode atau filter untuk
            melihat rekam lain.
          </p>
        ) : (
          <TabRekam
            hitungan={tab.hitungan}
            panelDinilai={panelDinilai}
            panelMenunggu={panelMenunggu}
            panelBatal={panelBatal}
          />
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
              {int(data.tiket_stats.pending)} menunggu
              {data.tiket_stats.unresolvable > 0
                ? ` · ${int(data.tiket_stats.unresolvable)} tidak dapat dinilai`
                : ""}{" "}
              · {int(data.tiket_stats.unique_fixtures)}{" "}
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
 * Satuan selalu disebut (brief §3E.4): kandidat = baris kandidat
 * prediksi; laga = ID laga fisik unik di balik yang sudah dinilai.
 */
function UjiHistoris() {
  const s = ledgerStats();
  const landing = landingStats();
  return (
    <section className="mt-16" aria-label="Uji historis">
      <SectionHead label="Uji historis" />
      <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-mid-gray">
        Hasil uji mundur laboratorium pada data historis — bukan pilihan resmi pra-laga.{" "}
        {int(s.lab_total)} kandidat prediksi diuji pada data historis,{" "}
        {int(landing.lab_resolved)} di antaranya sudah dinilai dari{" "}
        {int(landing.lab_resolved_matches)} laga unik. Kandidat di bawah lantai kelas
        terendah tidak masuk tabel kelas.
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
