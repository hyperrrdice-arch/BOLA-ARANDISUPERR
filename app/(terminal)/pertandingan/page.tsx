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
  kelompokPerTanggal,
  parseFilterJadwal,
  queryJadwal,
  urutSekarang,
  urutTampilJadwal,
  type FilterJadwal,
} from "@/lib/web/jadwal";
import { EmptyState, GateStatus, GradeMark, PageLoading, Prob } from "@/components/ui";
import KontrolJadwal from "@/components/jadwal/KontrolJadwal";

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
  /* Susunan baris brief upgrade P0: jam + nama tim di baris pertama;
     peluang/kelas tetap di kanan baris pertama; STATUS dan ringkasan
     model turun ke baris kedua yang berdiri sendiri. Susunan lama
     menaruh label status sebagai kolom shrink-0 di samping nama —
     pada 320 px label "Menunggu pembaruan pertandingan" (213 px)
     mendesak kolom nama sampai 35 px, nama pecah bertingkat dan
     baris membengkak ke 350 px (terukur lokal, cocok dengan audit). */
  const tampilProb =
    leg !== null &&
    (item.status === "scheduled" ||
      item.status === "unknown" ||
      item.status === "menunggu-pembaruan");
  const labelBarisStatus =
    item.status === "live" || item.status === "finished" || item.status === "menunggu-pembaruan"
      ? labelStatus(item.status)
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
  return (
    <div className="border-t border-hairline/50 py-4 first:border-t-0">
      <Link
        href={hrefDetail(item, filter)}
        aria-label={`${item.home} melawan ${item.away}, ${item.competition_name}, ${tanggalJamWib(item.kickoff_utc, tz)}`}
        className="block transition-colors hover:bg-surface-alt/40"
      >
        <span className="flex items-start gap-[16px] sm:gap-6">
          <span className="w-[3.5rem] flex-none pt-0.5 text-sm whitespace-nowrap text-mid-gray tabular-nums">
            {selesai && item.home_goals !== null ? (
              <span className="text-base font-semibold text-ink">
                {item.home_goals}–{item.away_goals}
              </span>
            ) : (
              jamWibOnly(item.kickoff_utc, tz)
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-medium break-words text-ink">
              {item.home} <span className="font-normal text-faint">vs</span> {item.away}
            </span>
          </span>
          {tampilProb && leg ? (
            <span className="shrink-0 text-right">
              <span className="flex items-baseline justify-end gap-2.5">
                <Prob value={leg.effective_prob} strong className="text-[28px] leading-none" />
                <GradeMark grade={leg.grade} className="text-xl" />
              </span>
            </span>
          ) : null}
        </span>
        {(labelBarisStatus || meta || (tampilProb && leg)) && (
          <span className="mt-1.5 block pl-[72px] text-[13px] text-mid-gray sm:pl-[80px]">
            {labelBarisStatus && (
              <span className="block font-medium">{labelBarisStatus}</span>
            )}
            {/* Keterangan "Pilihan terkuat · Kelas" pindah ke baris
                kedua: sebagai keterangan di bawah persen ia melebar
                kolom kanan sampai ±130 px dan memangkas kolom nama
                di 320 px hingga kata terpanjang (87,7 px) tidak muat
                satu baris utuh. */}
            {tampilProb && leg && (
              <span className="block text-[12px] text-faint">
                Pilihan terkuat · Kelas {leg.grade}
              </span>
            )}
            {meta && <span className="block">{meta}</span>}
          </span>
        )}
      </Link>
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
          {kelompok.map((k) => {
            const perKompetisi = new Map<string, JadwalItem[]>();
            for (const it of k.items) {
              const arr = perKompetisi.get(it.competition_name);
              if (arr) arr.push(it);
              else perKompetisi.set(it.competition_name, [it]);
            }
            return (
              <section key={k.kunci} className="mt-14">
                <h2 className="font-display text-xl font-semibold text-ink">
                  {k.label}
                  <span className="ml-3 text-sm font-normal text-faint">{k.tanggal}</span>
                </h2>
                {[...perKompetisi.entries()].map(([comp, items]) => (
                  <div key={comp} className="mt-8">
                    <div className="flex flex-wrap items-center gap-2.5 pb-1">
                      {items[0].gate_status && (
                        <GateStatus status={items[0].gate_status} withLabel={false} />
                      )}
                      <span className="font-display text-[17px] font-semibold text-ink">{comp}</span>
                      {items[0].gate_status && (
                        <span className="text-[13px] text-mid-gray">
                          {GATE_LABEL[items[0].gate_status] ?? items[0].gate_status}
                        </span>
                      )}
                      {items[0].competition_country && (
                        <span className="text-[13px] text-faint">{items[0].competition_country}</span>
                      )}
                    </div>
                    <div>
                      {items.map((it) => (
                        <BarisJadwal key={it.match_id} item={it} filter={filter} />
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
