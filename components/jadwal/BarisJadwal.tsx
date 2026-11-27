/**
 * BARIS JADWAL — satu baris laga untuk daftar Analisa dan Jadwal
 * (mode tampilan eksplisit dari rute):
 *
 * - Bersama: jam zona aktif di kiri, crest + dua baris tim, skor rata
 *   kanan HANYA saat datanya ada (0–0 sah ikut tampil), label status
 *   dan keterangan status sesuai tabel copy §6 brief (Live + menit
 *   bila sumber memberi, Selesai, Menunggu pembaruan pertandingan,
 *   Ditunda + jadwal ulang, Dibatalkan, Dihentikan + "Skor saat laga
 *   dihentikan", Status belum diketahui).
 * - Analisa: peluang event terkuat dalam SATU area ("76% · Minimal
 *   2 gol"), kelas + hitungan kelas, daftar penilaian ringkas sesudah
 *   laga selesai, dan "Analisa belum tersedia" untuk laga tanpa paket.
 *   Angka yang tampil selalu beridentitas sumber (brief tindak lanjut
 *   §2.3): bila pilihan yang sama sudah terbit resmi, angkanya adalah
 *   angka ledger + label basis B2.2-nya; bila belum, angkanya milik
 *   paket terbaru dan dilabeli persis begitu — angka paket terbaru
 *   tidak pernah tampil seolah-olah angka resmi.
 * - Jadwal: berhenti di info pertandingan — pembaca pick khusus
 *   Analisa (getPackagePicks) tidak dipanggil dan tidak ada persen,
 *   grade, gerbang, odds, atau ringkasan pick di markup.
 *
 * Seluruh baris adalah satu tautan ke Detail kanonik dengan konteks
 * asal (`asal=analisa|jadwal`) + filter terserialisasi (`kembali`).
 * Nama aksesibel tautan membawa tim, status, dan skor yang tersedia
 * (termasuk 0–0), karena aria-label menimpa seluruh teks anak.
 */
import { getPackagePicks, type JadwalItem } from "@/lib/web/data";
import {
  jamWibOnly,
  labelPilihan,
  labelVerdik,
  tanggalJamWib,
} from "@/lib/web/format";
import { labelStatus } from "@/lib/web/status";
import { queryJadwal, type FilterJadwal } from "@/lib/web/jadwal";
import { urlLogoTim } from "@/lib/web/logo";
import { GradeMark, Prob } from "@/components/ui";
import BarisLaga from "@/components/laga/BarisLaga";

export type ModeDaftar = "analisa" | "jadwal";

export function hrefDetail(item: JadwalItem, filter: FilterJadwal, mode: ModeDaftar): string {
  const q = new URLSearchParams();
  if (filter.tz !== "Asia/Jakarta") q.set("tz", filter.tz);
  q.set("asal", mode);
  q.set("kembali", queryJadwal(filter));
  return `/pertandingan/${item.match_id}?${q.toString()}`;
}

function hitunganKelas(item: JadwalItem): string | null {
  const c = item.pickCounts;
  const parts: string[] = [];
  if (c.A > 0) parts.push(`${c.A} A`);
  if (c.B > 0) parts.push(`${c.B} B`);
  if (c.C > 0) parts.push(`${c.C} C`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Label status baris (§6): Live menyertakan menit hanya bila sumber memberinya. */
function labelBarisStatus(item: JadwalItem): string | null {
  switch (item.status) {
    case "live":
      return item.menit !== null ? `Live · ${item.menit}'` : "Live";
    case "finished":
    case "menunggu-pembaruan":
    case "scheduled":
      return labelStatus(item.status);
    default:
      return null;
  }
}

export default function BarisJadwal({
  item,
  filter,
  mode,
}: {
  item: JadwalItem;
  filter: FilterJadwal;
  mode: ModeDaftar;
}) {
  const tz = filter.tz;
  const leg = item.topLeg;
  const resmi = item.topLegResmi;
  const konflik = item.topLegKonflik;
  const counts = hitunganKelas(item);
  const statusLabel = labelBarisStatus(item);
  const selesai = item.status === "finished" || item.status === "abandoned";
  /* Pembaca pick khusus Analisa: mode Jadwal tidak memanggilnya. */
  const picks =
    mode === "analisa" && selesai && item.package_id
      ? getPackagePicks(item.package_id).slice(0, 3)
      : [];
  const tampilProb =
    leg !== null &&
    (item.status === "scheduled" ||
      item.status === "unknown" ||
      item.status === "menunggu-pembaruan");
  const skor =
    (item.status === "finished" || item.status === "abandoned" || item.status === "live") &&
    item.home_goals !== null &&
    item.away_goals !== null
      ? { home: item.home_goals, away: item.away_goals }
      : null;

  /* Keterangan status (§6) — berlaku di kedua mode. */
  const metaStatus =
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
      skor ? (
        "Dihentikan · Skor saat laga dihentikan"
      ) : (
        "Dihentikan"
      )
    ) : item.status === "unknown" ? (
      "Status belum diketahui"
    ) : null;

  /* Nama aksesibel baris (§2.2): aria-label menimpa teks anak, jadi
     nama memuat tim, status baris, dan skor yang tersedia — termasuk
     0–0 yang sah. Keadaan yang label barisnya null (ditunda /
     dibatalkan / dihentikan / tak dikenal) menyumbang kata status
     dari keterangan statusnya sendiri. */
  const statusAksesibel =
    statusLabel ??
    (item.status === "postponed"
      ? "Ditunda"
      : item.status === "cancelled"
        ? "Dibatalkan"
        : item.status === "abandoned"
          ? "Dihentikan"
          : item.status === "unknown"
            ? "Status belum diketahui"
            : null);
  const skorAksesibel = skor
    ? item.status === "abandoned"
      ? `Skor saat laga dihentikan ${skor.home}–${skor.away}`
      : `Skor ${skor.home}–${skor.away}`
    : null;
  const ariaLabel = [
    `${item.home} melawan ${item.away}`,
    item.competition_name,
    tanggalJamWib(item.kickoff_utc, tz),
    statusAksesibel,
    skorAksesibel,
  ]
    .filter((x): x is string => Boolean(x))
    .join(", ");

  /* Isi khusus Analisa: peluang event + kelas, atau ketiadaan analisa.
     Identitas angka (§2.3): resmi → angka ledger + label basis B2.2
     (keterangan kalibrasi lab-band ikut, karena itulah klaim yang
     membedakan basisnya); belum resmi → angka paket terbaru dengan
     label paketnya. Edisi resmi BERKONFLIK (validasi rilis §2,
     resolusi per kejadian yang sama dengan Detail) → status konflik
     yang jelas dan TIDAK ada angka tunggal yang tampil sebagai
     jawaban — bukan angka resmi, bukan pula angka paket. */
  const identitasAngka = !tampilProb ? null : konflik ? (
    <>
      {" "}· <span className="font-medium text-brick">Dua sumber berbeda angka</span>
    </>
  ) : resmi ? (
    <>
      {" "}· {resmi.label_basis}
      {resmi.label_basis === "Peluang saat terbit" && resmi.keterangan_basis && (
        <> · {resmi.keterangan_basis}</>
      )}
    </>
  ) : (
    <> · Paket terbaru · Belum terbit resmi</>
  );
  const metaAnalisa =
    mode !== "analisa" || metaStatus ? null : leg ? (
      <>
        {tampilProb && !konflik && (
          <span className="block">
            <Prob value={resmi ? resmi.prob : leg.effective_prob} strong />{" "}
            <span className="text-ink-soft">
              · {labelPilihan(leg.market, leg.selection, item.home, item.away)}
            </span>
          </span>
        )}
        {(!tampilProb || konflik) && (
          <span className="block">
            {labelPilihan(leg.market, leg.selection, item.home, item.away)}
          </span>
        )}
        <span className="block text-[12px] text-faint">
          Pilihan terkuat · Kelas {leg.grade}
          {counts && <> · {counts}</>}
          {identitasAngka}
        </span>
      </>
    ) : item.package_id ? (
      "Analisis tersedia · Belum ada pilihan berkelas"
    ) : item.status === "live" ? null : (
      "Analisa belum tersedia"
    );

  const meta = metaStatus ?? metaAnalisa;
  return (
    <div className="border-t border-hairline/50 py-4 first:border-t-0">
      <BarisLaga
        href={hrefDetail(item, filter, mode)}
        ariaLabel={ariaLabel}
        jam={jamWibOnly(item.kickoff_utc, tz)}
        home={item.home}
        away={item.away}
        logoHome={urlLogoTim(item.home_canonical_id)}
        logoAway={urlLogoTim(item.away_canonical_id)}
        skor={skor}
        statusLabel={statusLabel}
        kanan={
          <span aria-hidden="true" className="shrink-0 text-xl text-sekunder">
            ›
          </span>
        }
        meta={meta ?? undefined}
      />
      {picks.length > 0 && (
        <ul className="mt-3 space-y-1.5 pl-[64px] sm:pl-[76px]">
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
