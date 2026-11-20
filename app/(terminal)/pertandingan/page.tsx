/**
 * JADWAL PERTANDINGAN — daftar kanonik dari katalog jadwal (termasuk
 * laga tanpa paket), dikelompokkan menurut TANGGAL LOKAL zona terpilih
 * dan disaring lewat query URL yang dapat dibagikan (K6, U01/U02).
 * Halaman ini tidak menghitung model apa pun; angka berasal dari paket
 * tersimpan dan keadaan hasil di adapter lib/web/data.ts.
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
  DAFTAR_ZONA,
  GATE_LABEL,
  jamWibOnly,
  labelPilihan,
  labelVerdik,
  labelZona,
  tanggalJamWib,
  tanggalPanjang,
  tanggalWib,
} from "@/lib/web/format";
import { labelStatus } from "@/lib/web/status";
import {
  jendelaTanggalUtc,
  kelompokPerTanggal,
  parseFilterJadwal,
  queryJadwal,
  type FilterJadwal,
} from "@/lib/web/jadwal";
import { EmptyState, GateStatus, GradeMark, PageLoading, Prob } from "@/components/ui";

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
  return (
    <div className="border-t border-hairline/50 py-4 first:border-t-0">
      <Link
        href={hrefDetail(item, filter)}
        className="flex items-start gap-4 transition-colors hover:bg-surface-alt/40 sm:gap-6"
      >
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
          <span className="mt-1 block text-[13px] text-mid-gray">
            {item.status === "postponed" ? (
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
            ) : item.status === "live" ? (
              "Sedang berlangsung"
            ) : item.status === "unknown" ? (
              "Status tidak diketahui"
            ) : leg ? (
              <>
                {labelPilihan(leg.market, leg.selection, item.home, item.away)}
                {counts && <span className="text-faint"> · {counts}</span>}
              </>
            ) : item.package_id ? (
              "Analisis tersedia · Belum ada pilihan berkelas"
            ) : (
              "Belum ada analisis"
            )}
          </span>
        </span>
        {item.status !== "scheduled" && item.status !== "unknown" ? (
          <span className="shrink-0 pt-0.5 text-[13px] font-medium text-mid-gray">
            {labelStatus(item.status)}
          </span>
        ) : leg ? (
          <span className="shrink-0 text-right">
            <span className="flex items-baseline justify-end gap-2.5">
              <Prob value={leg.effective_prob} strong className="text-[28px] leading-none" />
              <GradeMark grade={leg.grade} className="text-xl" />
            </span>
            <span className="mt-1.5 block text-[12px] text-faint">
              Pilihan terkuat · Kelas {leg.grade}
            </span>
          </span>
        ) : null}
      </Link>
      {picks.length > 0 && (
        <ul className="mt-3 space-y-1.5 pl-[4.5rem] sm:pl-[5.5rem]">
          {picks.map((p) => (
            <li key={p.id} className="flex items-baseline gap-2.5 text-sm">
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

function FormFilter({
  filter,
  ligaTersedia,
  negaraTersedia,
}: {
  filter: FilterJadwal;
  ligaTersedia: string[];
  negaraTersedia: string[];
}) {
  const kelasSelect =
    "rounded-md border border-hairline bg-surface px-2.5 py-2 text-sm text-ink";
  return (
    <form method="get" action="/pertandingan" className="mt-8 flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1.5 text-[13px] text-mid-gray">
        Tanggal
        <input
          type="date"
          name="tanggal"
          defaultValue={filter.tanggal}
          className={kelasSelect}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-[13px] text-mid-gray">
        Status
        <select name="status" defaultValue={filter.status} className={kelasSelect}>
          <option value="semua">Semua</option>
          <option value="akan-datang">Belum mulai</option>
          <option value="selesai">Selesai</option>
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-[13px] text-mid-gray">
        Liga
        <select name="liga" defaultValue={filter.liga ?? ""} className={kelasSelect}>
          <option value="">Semua liga</option>
          {ligaTersedia.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-[13px] text-mid-gray">
        Negara
        <select name="negara" defaultValue={filter.negara ?? ""} className={kelasSelect}>
          <option value="">Semua negara</option>
          {negaraTersedia.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-[13px] text-mid-gray">
        Zona waktu
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
        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink"
      >
        Terapkan
      </button>
    </form>
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
  const filter = parseFilterJadwal(await searchParams);
  const { dariUtc, sampaiUtc } = jendelaTanggalUtc(filter.tanggal, filter.tz);
  const semua = listSchedule(dariUtc, sampaiUtc);
  const cakupan = cakupanJadwal();

  const ligaTersedia = [...new Set(semua.map((i) => i.competition_name).filter(Boolean))].sort();
  const negaraTersedia = [
    ...new Set(semua.map((i) => i.competition_country).filter((x): x is string => Boolean(x))),
  ].sort();

  const tersaring = semua.filter((i) => {
    if (filter.status === "akan-datang") {
      if (!(i.status === "scheduled" || i.status === "live" || i.status === "postponed" || i.status === "menunggu-pembaruan")) return false;
    } else if (filter.status === "selesai") {
      if (!(i.status === "finished" || i.status === "abandoned")) return false;
    }
    if (filter.liga && i.competition_name !== filter.liga) return false;
    if (filter.negara && i.competition_country !== filter.negara) return false;
    return true;
  });

  const diLuarLiputan =
    cakupan !== null && (dariUtc > cakupan.sampaiUtc || sampaiUtc <= cakupan.dariUtc);
  const kelompok = kelompokPerTanggal(tersaring, filter.tz);

  return (
    <div>
      <header>
        <h1 className="font-display text-[2.5rem] leading-tight font-semibold tracking-[-0.02em] text-ink">
          Jadwal pertandingan
        </h1>
        <p className="mt-2 text-[15px] text-mid-gray">
          {tanggalPanjang(`${filter.tanggal}T12:00:00.000Z`, filter.tz)} · Zona waktu{" "}
          {labelZona(filter.tz)}
          {cakupan && (
            <>
              {" "}· Liputan {tanggalWib(cakupan.dariUtc, filter.tz)} –{" "}
              {tanggalWib(cakupan.sampaiUtc, filter.tz)}
            </>
          )}
        </p>
      </header>

      <FormFilter filter={filter} ligaTersedia={ligaTersedia} negaraTersedia={negaraTersedia} />

      {diLuarLiputan ? (
        <EmptyState
          title="Jadwal setelah tanggal ini belum tersedia."
          note="Sumber data belum mencakup tanggal atau kompetisi pada tanggal yang dipilih. Pilih tanggal lain di dalam jendela liputan."
        />
      ) : tersaring.length === 0 ? (
        <EmptyState
          title="Belum ada pertandingan pada tanggal ini."
          note="Coba tanggal atau filter lain — tanggal dan filter tersimpan di alamat halaman ini."
        />
      ) : (
        kelompok.map((k) => {
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
        })
      )}
    </div>
  );
}
