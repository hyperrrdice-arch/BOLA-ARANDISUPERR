/**
 * JADWAL PERTANDINGAN — daftar kanonik dari katalog jadwal (termasuk
 * laga tanpa paket), dikelompokkan menurut TANGGAL LOKAL zona terpilih
 * dan disaring lewat query URL yang dapat dibagikan.
 *
 * Redesain §3B: susunan judul → pencarian → pintasan Sekarang/Malam
 * ini/Besok → Filter → laga. Pencarian meliput aksen dan mencakup
 * SELURUH himpunan terfilter (jendela diperlebar ke liputan penuh
 * saat kueri aktif). Tiga keadaan kosong dibedakan persis brief:
 * filter tak cocok, tanggal belum tersedia, jadwal gagal dimuat.
 * Halaman ini tidak menghitung model apa pun.
 */
import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import {
  cakupanJadwal,
  getPackagePicks,
  listSchedule,
  type JadwalItem,
} from "@/lib/web/data";
import {
  GATE_LABEL,
  jamWibOnly,
  kunciTanggal,
  labelPilihan,
  labelVerdik,
  labelZona,
  tanggalJamWib,
  tanggalPanjang,
  tanggalWib,
} from "@/lib/web/format";
import { labelStatus } from "@/lib/web/status";
import {
  cocokPencarian,
  jendelaPintasan,
  jendelaTanggalUtc,
  kelompokPerKompetisi,
  kelompokPerTanggal,
  parseFilterJadwal,
  queryJadwal,
  urutSekarang,
  urutTampilJadwal,
  type FilterJadwal,
} from "@/lib/web/jadwal";
import { urlLogoKompetisi, urlLogoTim } from "@/lib/web/logo";
import { mulaiTimerRute, selesaikanTimerRute } from "@/lib/web/timing";
import { EmptyState, GateStatus, GradeMark, PageLoading, Prob } from "@/components/ui";
import KontrolJadwal from "@/components/jadwal/KontrolJadwal";
import GrupLiga from "@/components/jadwal/GrupLiga";
import BarisLaga from "@/components/laga/BarisLaga";

export const metadata: Metadata = { title: "Jadwal pertandingan | Bola" };

function hitunganKelas(item: JadwalItem): string | null {
  const c = item.pickCounts;
  const parts: string[] = [];
  if (c.A > 0) parts.push(`${c.A} A`);
  if (c.B > 0) parts.push(`${c.B} B`);
  if (c.C > 0) parts.push(`${c.C} C`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function hrefDetail(item: JadwalItem, filter: FilterJadwal): string {
  const q = new URLSearchParams();
  if (filter.tz !== "Asia/Jakarta") q.set("tz", filter.tz);
  q.set("kembali", queryJadwal(filter));
  return `/pertandingan/${item.match_id}?${q.toString()}`;
}

function BarisJadwal({ item, filter }: { item: JadwalItem; filter: FilterJadwal }) {
  const tz = filter.tz;
  const leg = item.topLeg;
  const counts = hitunganKelas(item);
  const selesai = item.status === "finished" || item.status === "abandoned";
  const picks = selesai && item.package_id ? getPackagePicks(item.package_id).slice(0, 3) : [];
  /* Baris laga bersama (Addendum Jadwal per Liga): jam selalu di kiri;
     skor pindah ke kanan baris masing-masing tim, HANYA saat datanya
     ada (0–0 sah ikut tampil); status/peluang/kelas di baris metadata
     supaya nama panjang membungkus utuh — melanjutkan alasan P0 yang
     menaruh status di baris kedua (label "Menunggu pembaruan
     pertandingan" 213 px mendesak nama sampai 35 px pada 320 px). */
  const tampilProb =
    leg !== null &&
    (item.status === "scheduled" ||
      item.status === "unknown" ||
      item.status === "menunggu-pembaruan");
  const labelBarisStatus =
    item.status === "live" ||
    item.status === "finished" ||
    item.status === "menunggu-pembaruan" ||
    item.status === "scheduled"
      ? labelStatus(item.status)
      : null;
  const skor =
    (item.status === "finished" || item.status === "abandoned" || item.status === "live") &&
    item.home_goals !== null &&
    item.away_goals !== null
      ? { home: item.home_goals, away: item.away_goals }
      : null;
  const meta =
    item.status === "postponed" ? (
      <>
        Ditunda · Jadwal asal {tanggalJamWib(item.jadwal_asal_utc ?? item.kickoff_utc, tz)}
        {item.jadwal_ulang_utc && (
          <> · Jadwal ulang {tanggalJamWib(item.jadwal_ulang_utc, tz)}</>
        )}
      </>
    ) : item.status === "cancelled" ? (
      "Dibatalkan"
    ) : item.status === "abandoned" ? (
      "Dihentikan · Skor parsial saat laga berhenti"
    ) : item.status === "unknown" ? (
      "Status tidak diketahui"
    ) : leg ? (
      <>
        {labelPilihan(leg.market, leg.selection, item.home, item.away)}
        {counts && <span className="text-faint"> · {counts}</span>}
      </>
    ) : item.package_id ? (
      "Analisis tersedia · Belum ada pilihan berkelas"
    ) : item.status === "live" ? null : (
      "Belum ada analisis"
    );
  const adaMeta = Boolean(meta) || Boolean(tampilProb && leg);
  return (
    <div className="border-t border-hairline/50 py-4 first:border-t-0">
      <BarisLaga
        href={hrefDetail(item, filter)}
        ariaLabel={`${item.home} melawan ${item.away}, ${item.competition_name}, ${tanggalJamWib(item.kickoff_utc, tz)}`}
        jam={jamWibOnly(item.kickoff_utc, tz)}
        home={item.home}
        away={item.away}
        logoHome={urlLogoTim(item.home_canonical_id)}
        logoAway={urlLogoTim(item.away_canonical_id)}
        skor={skor}
        statusLabel={labelBarisStatus}
        kanan={
          tampilProb && leg ? (
            <span className="shrink-0 text-right">
              <span className="flex items-baseline justify-end gap-2.5">
                <Prob value={leg.effective_prob} strong className="text-[28px] leading-none" />
                <GradeMark grade={leg.grade} className="text-xl" />
              </span>
            </span>
          ) : undefined
        }
        meta={
          adaMeta ? (
            <>
              {/* "Pilihan terkuat · Kelas" tetap di baris metadata:
                  sebagai keterangan di bawah persen ia melebar kolom
                  kanan ±130 px dan memangkas kolom nama di 320 px. */}
              {tampilProb && leg && (
                <span className="block text-[12px] text-faint">
                  Pilihan terkuat · Kelas {leg.grade}
                </span>
              )}
              {meta && <span className="block">{meta}</span>}
            </>
          ) : undefined
        }
      />
      {picks.length > 0 && (
        <ul className="mt-3 space-y-1.5 pl-[4.5rem] sm:pl-[5.5rem]">
          {/* flex-wrap pada li: pada lebar ekstrem (teks 200%) persen +
              verdik turun ke baris berikut ketimbang meluapkan baris
              laga; tak berubah pada lebar brief. */}
          {picks.map((p) => (
            <li key={p.id} className="flex flex-wrap items-baseline gap-2.5 text-sm">
              <GradeMark grade={p.grade} />
              <span className="min-w-0 flex-1 break-words text-ink-soft">
                {labelPilihan(p.market, p.selection, item.home, item.away)}
              </span>
              <Prob value={p.model_prob} className="text-[13px]" />
              <span
                className={`text-[13px] font-medium ${
                  p.hit === 1 ? "text-sage" : p.hit === 0 ? "text-brick" : "text-faint"
                }`}
              >
                {labelVerdik(p.hit)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PertandinganPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<PageLoading label="Memuat jadwal…" />}>
      <PertandinganContent searchParams={searchParams} />
    </Suspense>
  );
}

async function PertandinganContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const t0Timer = mulaiTimerRute();
  const now = new Date();
  const filter = parseFilterJadwal(await searchParams, now);
  const cakupan = cakupanJadwal();

  /* Jendela baca: mode menentukan jendela dasar; pencarian memperlebar
     ke seluruh liputan supaya hasil mencakup himpunan terfilter penuh,
     bukan hanya tanggal yang sedang tampil (brief §3B.4). */
  let jendela =
    filter.mode === "tanggal"
      ? jendelaTanggalUtc(filter.tanggal, filter.tz)
      : jendelaPintasan(filter.mode, filter.tz, now);
  if (filter.q && cakupan) {
    // Tepi cakupan adalah momen kickoff itu sendiri; jendela listSchedule
    // setengah-terbuka [dari, sampai), jadi ujungnya diberi bantalan 2 jam
    // supaya laga tepat di tepi cakupan tidak tersisih dari pencarian.
    jendela = {
      dariUtc: cakupan.dariUtc,
      sampaiUtc: new Date(Date.parse(cakupan.sampaiUtc) + 2 * 3_600_000).toISOString(),
    };
  }

  let semua: JadwalItem[] = [];
  let gagalMuat = false;
  try {
    semua = listSchedule(jendela.dariUtc, jendela.sampaiUtc);
  } catch {
    gagalMuat = true;
  }

  const ligaTersedia = [...new Set(semua.map((i) => i.competition_name).filter(Boolean))].sort();
  const negaraTersedia = [
    ...new Set(semua.map((i) => i.competition_country).filter((x): x is string => Boolean(x))),
  ].sort();

  let tersaring = semua.filter((i) => {
    if (filter.status === "akan-datang") {
      if (!(i.status === "scheduled" || i.status === "live" || i.status === "postponed" || i.status === "menunggu-pembaruan")) return false;
    } else if (filter.status === "selesai") {
      if (!(i.status === "finished" || i.status === "abandoned")) return false;
    }
    if (filter.liga && i.competition_name !== filter.liga) return false;
    if (filter.negara && i.competition_country !== filter.negara) return false;
    return true;
  });
  if (filter.q) {
    tersaring = tersaring.filter((i) =>
      cocokPencarian(
        [i.home, i.away, i.competition_name, i.competition_country ?? ""],
        filter.q!,
      ),
    );
  }

  if (filter.mode === "sekarang") {
    tersaring = urutSekarang(tersaring);
  } else {
    tersaring = urutTampilJadwal(tersaring);
  }

  const diLuarLiputan =
    !filter.q &&
    filter.mode !== "sekarang" &&
    cakupan !== null &&
    (jendela.dariUtc > cakupan.sampaiUtc || jendela.sampaiUtc <= cakupan.dariUtc);
  const kelompok = kelompokPerTanggal(tersaring, filter.tz, now);
  const tanggalHariIni = kunciTanggal(now.toISOString(), filter.tz);

  const subjudul =
    filter.mode === "sekarang"
      ? `Sedang berlangsung dan yang terdekat · Zona waktu ${labelZona(filter.tz)}`
      : filter.mode === "malam-ini"
        ? `Malam ini · ${tanggalWib(jendela.dariUtc, filter.tz)} – ${tanggalWib(jendela.sampaiUtc, filter.tz)} · Zona waktu ${labelZona(filter.tz)}`
        : filter.mode === "besok"
          ? `${tanggalPanjang(jendela.dariUtc, filter.tz)} · Zona waktu ${labelZona(filter.tz)}`
          : `${tanggalPanjang(`${filter.tanggal}T12:00:00.000Z`, filter.tz)} · Zona waktu ${labelZona(filter.tz)}`;

  selesaikanTimerRute("/pertandingan", t0Timer);
  return (
    <div>
      <header>
        <h1 className="font-display text-[2.5rem] leading-tight font-semibold tracking-[-0.02em] text-ink">
          Jadwal pertandingan
        </h1>
        <p className="mt-2 text-[15px] text-mid-gray">
          {subjudul}
          {cakupan && (
            <>
              {" "}· Liputan {tanggalWib(cakupan.dariUtc, filter.tz)} –{" "}
              {tanggalWib(cakupan.sampaiUtc, filter.tz)}
            </>
          )}
        </p>
      </header>

      <KontrolJadwal
        filter={filter}
        ligaTersedia={ligaTersedia}
        negaraTersedia={negaraTersedia}
        tanggalHariIni={tanggalHariIni}
      />

      {gagalMuat ? (
        <div className="py-16 text-center">
          <p className="text-[17px] font-medium text-ink">Jadwal belum bisa dimuat</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-mid-gray">
            Daftar pertandingan tidak dapat dibaca saat ini. Pilihan filter kamu tersimpan di
            alamat halaman ini.
          </p>
          <p className="mt-6">
            <Link
              href={`/pertandingan?${queryJadwal(filter)}`}
              className="text-[15px] font-medium text-accent-deep underline underline-offset-4"
            >
              Coba lagi
            </Link>
          </p>
        </div>
      ) : diLuarLiputan ? (
        <div className="py-16 text-center">
          <p className="text-[17px] font-medium text-ink">Jadwal untuk tanggal ini belum tersedia</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-mid-gray">
            Sumber data belum mencakup tanggal yang dipilih.
          </p>
          <p className="mt-6">
            <Link
              href="/pertandingan"
              className="text-[15px] font-medium text-accent-deep underline underline-offset-4"
            >
              Pilih tanggal lain
            </Link>
          </p>
        </div>
      ) : tersaring.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-[17px] font-medium text-ink">Tidak ada laga yang cocok dengan filter ini</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-mid-gray">
            {filter.q
              ? `Tidak ada tim atau liga yang cocok dengan “${filter.q}” pada filter yang aktif.`
              : "Coba longgarkan status, liga, atau negara yang dipilih."}
          </p>
          <p className="mt-6">
            <Link
              href="/pertandingan"
              className="text-[15px] font-medium text-accent-deep underline underline-offset-4"
            >
              Hapus filter
            </Link>
          </p>
        </div>
      ) : (
        <div key={queryJadwal(filter)} className="grup-masuk">
          {kelompok.map((k) => (
            <section key={k.kunci} className="mt-14">
              <h2 className="font-display text-xl font-semibold text-ink">
                {k.label}
                <span className="ml-3 text-sm font-normal text-faint">{k.tanggal}</span>
              </h2>
              {/* Grup per IDENTITAS kompetisi (Addendum): kunci grup dari
                  ID kanonik/mentah, bukan string nama — "Serie A" Italia
                  (sm:384, alias comp_5840) dan "Serie A" Brasil (sm:648)
                  tidak lagi menyatu; hitungan = laga hasil filter. */}
              {kelompokPerKompetisi(k.items).map((g) => (
                <GrupLiga
                  key={g.kunci}
                  logoUrl={urlLogoKompetisi(g.canonical_id)}
                  nama={g.nama}
                  negara={g.negara}
                  sumber={g.sumber}
                  jumlah={g.items.length}
                  kalibrasi={
                    g.gate_status ? (
                      <span className="flex items-center gap-2.5">
                        <GateStatus status={g.gate_status} withLabel={false} />
                        <span className="text-[13px] text-mid-gray">
                          {GATE_LABEL[g.gate_status] ?? g.gate_status}
                        </span>
                      </span>
                    ) : undefined
                  }
                >
                  <div>
                    {g.items.map((it) => (
                      <BarisJadwal key={it.match_id} item={it} filter={filter} />
                    ))}
                  </div>
                </GrupLiga>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
