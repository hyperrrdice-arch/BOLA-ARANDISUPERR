/**
 * DAFTAR LAGA BERSAMA — fondasi satu-satunya untuk Analisa
 * (/analisa) dan Jadwal (/pertandingan): tanggal → grup liga → baris
 * laga dari SATU pembacaan katalog per render. Rute menentukan mode:
 *
 * - Analisa membawa isi prediksi lama Jadwal (paket/edisi terbit,
 *   peluang event, kelas, status penilaian; laga tanpa prediksi
 *   resmi tetap tampil bertanda "Analisa belum tersedia").
 * - Jadwal berhenti di info pertandingan dan menutup halaman dengan
 *   footer status penyegaran (marker B2.2, helper pembaca yang sama
 *   seperti Beranda dulu): "Data terakhir diperbarui <waktu>" atau
 *   "Waktu pembaruan belum tersedia".
 *
 * Grup liga diurutkan prioritas brief §5 (ID kanonik, bukan label);
 * strip lima tanggal menulis mode tanggal pada filter URL; mode
 * pencarian mengganti strip dengan label "Hasil pencarian". Tiga
 * keadaan kosong dibedakan persis §6: tanggal kosong, filter tanpa
 * hasil, gagal muat. Halaman ini tidak menghitung model apa pun.
 */
import Link from "next/link";
import { connection } from "next/server";
import { cakupanJadwal, listSchedule, type JadwalItem } from "@/lib/web/data";
import {
  GATE_LABEL,
  kunciTanggal,
  labelZona,
  tanggalJamWib,
  tanggalPanjang,
  tanggalWib,
} from "@/lib/web/format";
import {
  cocokPencarian,
  daftarStripTanggal,
  jendelaPintasan,
  jendelaTanggalUtc,
  kelompokPerKompetisi,
  kelompokPerTanggal,
  parseFilterJadwal,
  queryJadwal,
  urutkanGrupLiga,
  urutSekarang,
  urutTampilJadwal,
  type FilterJadwal,
} from "@/lib/web/jadwal";
import { ambilWaktuRefreshTerakhir } from "@/lib/web/rekam";
import { urlLogoKompetisi } from "@/lib/web/logo";
import { mulaiTimerRute, selesaikanTimerRute } from "@/lib/web/timing";
import { GateStatus } from "@/components/ui";
import KontrolJadwal from "@/components/jadwal/KontrolJadwal";
import GrupLiga from "@/components/jadwal/GrupLiga";
import BarisJadwal, { type ModeDaftar } from "@/components/jadwal/BarisJadwal";

/* ------------------------------------------------------- strip tanggal */

function StripTanggal({
  filter,
  tujuan,
  now,
}: {
  filter: FilterJadwal;
  tujuan: "/analisa" | "/pertandingan";
  now: Date;
}) {
  if (filter.q) {
    return (
      <p className="mt-6 text-[13px] font-semibold tracking-[0.04em] text-sekunder uppercase">
        Hasil pencarian
      </p>
    );
  }
  const strip = daftarStripTanggal(filter.tanggal, filter.tz, now);
  return (
    <nav aria-label="Pilih tanggal" className="mt-6">
      <ul className="grid grid-cols-5 gap-1.5">
        {strip.map((t) => (
          <li key={t.kunci}>
            <Link
              href={`${tujuan}?${queryJadwal({ ...filter, tanggal: t.kunci, mode: "tanggal" })}`}
              aria-current={t.aktif ? "date" : undefined}
              className={`flex min-h-11 flex-col items-center justify-center rounded-md border px-1 py-1.5 text-center transition-colors duration-[var(--duration-micro)] ${
                t.aktif
                  ? "border-jingga bg-gelap font-semibold text-tinta"
                  : "border-garis text-sekunder hover:text-tinta"
              }`}
            >
              <span className="text-[12px] leading-tight">{t.labelHari}</span>
              <span className="text-[13px] leading-tight tabular-nums">{t.labelTanggal}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* ------------------------------------------------------ footer Jadwal */

/** Status penyegaran data (B2.2) — kini di footer Jadwal. */
function KakiPenyegaran({ now, tz }: { now: Date; tz: string }) {
  const marker = ambilWaktuRefreshTerakhir(now.toISOString());
  return (
    <footer className="mt-14 border-t border-garis pt-6">
      <p className="text-[13px] text-sekunder">
        {marker
          ? `Data terakhir diperbarui ${tanggalJamWib(marker, tz)}`
          : "Waktu pembaruan belum tersedia"}
        {" · Jadwal refresh tiap 12 jam."}
      </p>
    </footer>
  );
}

/* ------------------------------------------------------------- halaman */

export default async function DaftarLaga({
  mode,
  searchParams,
}: {
  mode: ModeDaftar;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const t0Timer = mulaiTimerRute();
  const now = new Date();
  const tujuan = mode === "analisa" ? "/analisa" : "/pertandingan";
  const filter = parseFilterJadwal(await searchParams, now);
  const cakupan = cakupanJadwal();

  /* Jendela baca: mode menentukan jendela dasar; pencarian memperlebar
     ke seluruh liputan supaya hasil mencakup himpunan terfilter penuh,
     bukan hanya tanggal yang sedang tampil. */
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
  const filterAktif =
    Boolean(filter.q) ||
    filter.status !== "semua" ||
    filter.liga !== null ||
    filter.negara !== null;
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

  selesaikanTimerRute(tujuan, t0Timer);
  return (
    <div className="-mt-8 md:mt-0">
      <header>
        <h1 className="font-display text-[2.5rem] leading-tight font-semibold tracking-[-0.02em] text-ink">
          {mode === "analisa" ? "Analisa" : "Jadwal pertandingan"}
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

      <StripTanggal filter={filter} tujuan={tujuan} now={now} />

      <KontrolJadwal
        filter={filter}
        ligaTersedia={ligaTersedia}
        negaraTersedia={negaraTersedia}
        tanggalHariIni={tanggalHariIni}
        tujuan={tujuan}
      />

      {gagalMuat ? (
        <div className="py-16 text-center">
          <p className="text-[17px] font-medium text-ink">Jadwal gagal dimuat</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-mid-gray">
            Daftar pertandingan tidak dapat dibaca saat ini. Pilihan filter kamu tersimpan di
            alamat halaman ini.
          </p>
          <p className="mt-6">
            <Link
              href={`${tujuan}?${queryJadwal(filter)}`}
              className="text-[15px] font-medium text-accent-deep underline underline-offset-4"
            >
              Coba lagi
            </Link>
          </p>
        </div>
      ) : tersaring.length === 0 && !filterAktif ? (
        <div className="py-16 text-center">
          <p className="text-[17px] font-medium text-ink">Belum ada jadwal untuk tanggal ini</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-mid-gray">
            {diLuarLiputan
              ? "Sumber data belum mencakup tanggal yang dipilih."
              : "Tidak ada pertandingan yang terjadwal pada tanggal ini."}
          </p>
          <p className="mt-6">
            <Link
              href={tujuan}
              className="text-[15px] font-medium text-accent-deep underline underline-offset-4"
            >
              Pilih tanggal lain
            </Link>
          </p>
        </div>
      ) : tersaring.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-[17px] font-medium text-ink">Tidak ada laga yang cocok</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-mid-gray">
            {filter.q
              ? `Tidak ada tim atau liga yang cocok dengan “${filter.q}” pada filter yang aktif.`
              : "Coba longgarkan status, liga, atau negara yang dipilih."}
          </p>
          <p className="mt-6">
            <Link
              href={tujuan}
              className="text-[15px] font-medium text-accent-deep underline underline-offset-4"
            >
              Hapus filter
            </Link>
          </p>
        </div>
      ) : (
        <div key={queryJadwal(filter)} className="grup-masuk">
          {kelompok.map((k) => (
            <section key={k.kunci} className="mt-10">
              <h2 className="font-display text-xl font-semibold text-ink">
                {k.label}
                <span className="ml-3 text-sm font-normal text-faint">{k.tanggal}</span>
              </h2>
              {/* Grup per IDENTITAS kompetisi: kunci grup dari ID
                  kanonik/mentah, bukan string nama — "Serie A" Italia
                  (sm:384) dan Brasil (sm:648) tidak menyatu; urutan
                  grup mengikuti prioritas brief §5. */}
              {urutkanGrupLiga(kelompokPerKompetisi(k.items)).map((g) => (
                <GrupLiga
                  key={g.kunci}
                  logoUrl={urlLogoKompetisi(g.canonical_id)}
                  nama={g.nama}
                  negara={g.negara}
                  sumber={g.sumber}
                  jumlah={g.items.length}
                  kalibrasi={
                    mode === "analisa" && g.gate_status ? (
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
                      <BarisJadwal key={it.match_id} item={it} filter={filter} mode={mode} />
                    ))}
                  </div>
                </GrupLiga>
              ))}
            </section>
          ))}
        </div>
      )}

      {mode === "jadwal" && <KakiPenyegaran now={now} tz={filter.tz} />}
    </div>
  );
}
