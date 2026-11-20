/**
 * JADWAL — logika murni halaman jadwal (K6, U01): validasi filter dari
 * query URL, jendela UTC satu tanggal lokal, dan pengelompokan per
 * tanggal lokal zona terpilih.
 *
 * Sengaja bebas impor Next/DB supaya perjalanan U01 (filter pulih dari
 * URL, kelompok mengikuti tengah malam zona) dapat diuji langsung.
 * Nilai filter tak dikenal → default terdokumentasi (bab U1), bukan error.
 */
import {
  ZONA_BAKU,
  kunciTanggal,
  labelHari,
  tanggalPanjang,
  zonaValid,
} from "./format";
import type { StatusTampil } from "./status";

export type StatusFilter = "semua" | "akan-datang" | "selesai";

/**
 * Mode jendela jadwal (brief redesain §3B.2). "tanggal" = cakupan
 * sehari penuh pada `tanggal` (perilaku K6, termasuk URL lama yang
 * membagikan `tanggal` eksplisit). Tiga lainnya adalah pintasan waktu
 * relatif terhadap jam saat halaman dibuka.
 */
export type ModeJadwal = "tanggal" | "sekarang" | "malam-ini" | "besok";

export interface FilterJadwal {
  /** Tanggal lokal "YYYY-MM-DD" pada zona `tz`. */
  tanggal: string;
  status: StatusFilter;
  liga: string | null;
  negara: string | null;
  tz: string;
  /** Jendela waktu aktif; baku "tanggal" (cakupan tanggal penuh). */
  mode: ModeJadwal;
  /** Kueri pencarian tim/liga; null = tanpa pencarian. */
  q: string | null;
}

const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

function tanggalSah(s: string): boolean {
  if (!POLA_TANGGAL.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function teks(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== "string") return null;
  const t = s.trim().slice(0, 80);
  return t === "" ? null : t;
}

/**
 * Baca filter dari searchParams. Default: tanggal = hari ini pada zona
 * terpilih, status = semua, tanpa filter liga/negara, zona = baku.
 */
export function parseFilterJadwal(
  params: Record<string, string | string[] | undefined>,
  now: Date = new Date(),
): FilterJadwal {
  const tz = zonaValid(teks(params.tz) ?? undefined);
  const tglMentah = teks(params.tanggal);
  const tanggal = tglMentah && tanggalSah(tglMentah) ? tglMentah : kunciTanggal(now.toISOString(), tz);
  const st = teks(params.status);
  const status: StatusFilter =
    st === "akan-datang" || st === "selesai" ? st : "semua";
  const md = teks(params.mode);
  const mode: ModeJadwal =
    md === "sekarang" || md === "malam-ini" || md === "besok" ? md : "tanggal";
  return {
    tanggal,
    status,
    liga: teks(params.liga),
    negara: teks(params.negara),
    tz,
    mode,
    q: teks(params.q),
  };
}

/** Query string kanonik untuk filter — tautan menyimpannya apa adanya. */
export function queryJadwal(f: FilterJadwal): string {
  const q = new URLSearchParams();
  q.set("tanggal", f.tanggal);
  if (f.mode !== "tanggal") q.set("mode", f.mode);
  if (f.q) q.set("q", f.q);
  if (f.status !== "semua") q.set("status", f.status);
  if (f.liga) q.set("liga", f.liga);
  if (f.negara) q.set("negara", f.negara);
  if (f.tz !== ZONA_BAKU) q.set("tz", f.tz);
  return q.toString();
}

/** Offset zona (ms) pada instant tertentu — dari Intl, tanpa tabel manual. */
function offsetZonaMs(tz: string, utcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) bag[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(bag.year),
    Number(bag.month) - 1,
    Number(bag.day),
    Number(bag.hour),
    Number(bag.minute),
    Number(bag.second),
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Awal tanggal lokal `tanggal` (YYYY-MM-DD) pada zona `tz`, sebagai ms UTC. */
function awalTanggalMs(tanggal: string, tz: string): number {
  const [y, m, d] = tanggal.split("-").map(Number);
  const tebak = Date.UTC(y, m - 1, d);
  let dari = tebak - offsetZonaMs(tz, tebak);
  dari = tebak - offsetZonaMs(tz, dari);
  return dari;
}

/** Jendela UTC [dari, sampai) yang tepat mencakup satu tanggal lokal. */
export function jendelaTanggalUtc(
  tanggal: string,
  tz: string,
): { dariUtc: string; sampaiUtc: string } {
  const dari = awalTanggalMs(tanggal, tz);
  const [y, m, d] = tanggal.split("-").map(Number);
  const esok = new Date(Date.UTC(y, m - 1, d + 1));
  const kunciEsok = `${esok.getUTCFullYear()}-${String(esok.getUTCMonth() + 1).padStart(2, "0")}-${String(esok.getUTCDate()).padStart(2, "0")}`;
  const sampai = awalTanggalMs(kunciEsok, tz);
  return { dariUtc: new Date(dari).toISOString(), sampaiUtc: new Date(sampai).toISOString() };
}

/* ------------------------------------------------- pintasan waktu (§3B.2) */

/** Kunci tanggal digeser `hari` hari (kalender murni, tanpa zona). */
function geserKunci(kunci: string, hari: number): string {
  const [y, m, d] = kunci.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + hari));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Instant UTC (ms) untuk pukul `jam`:00 pada tanggal lokal `kunci` di zona `tz`. */
function msLokalPadaJam(kunci: string, jam: number, tz: string): number {
  const [y, m, d] = kunci.split("-").map(Number);
  const tebak = Date.UTC(y, m - 1, d, jam);
  let ms = tebak - offsetZonaMs(tz, tebak);
  ms = tebak - offsetZonaMs(tz, ms);
  return ms;
}

/** Jam lokal (0–23) dari instant `now` pada zona `tz`. */
function jamLokal(now: Date, tz: string): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
}

/**
 * Jendela UTC untuk pintasan waktu (brief §3B.2):
 * - "malam-ini": 18.00 sampai sebelum 06.00 pada zona terpilih. Pada
 *   pukul 00.00–05.59 jendela BERJALAN sudah berawal hari sebelumnya;
 *   sebelum 18.00 pintasan menunjuk malam pada tanggal aktif (hari ini).
 * - "besok": tanggal kalender berikutnya, sehari penuh.
 * - "sekarang": jendela lebar di sekitar kini (laga berlangsung
 *   terkonfirmasi + yang terdekat akan mulai) — penyaringan urutan
 *   live-dulu dilakukan pemanggil dari status tampil.
 */
export function jendelaPintasan(
  mode: Exclude<ModeJadwal, "tanggal">,
  tz: string,
  now: Date = new Date(),
): { dariUtc: string; sampaiUtc: string } {
  if (mode === "besok") {
    return jendelaTanggalUtc(geserKunci(kunciTanggal(now.toISOString(), tz), 1), tz);
  }
  if (mode === "sekarang") {
    return {
      dariUtc: new Date(now.getTime() - 6 * 3_600_000).toISOString(),
      sampaiUtc: new Date(now.getTime() + 72 * 3_600_000).toISOString(),
    };
  }
  const hariIni = kunciTanggal(now.toISOString(), tz);
  const awal = jamLokal(now, tz) < 6 ? geserKunci(hariIni, -1) : hariIni;
  return {
    dariUtc: new Date(msLokalPadaJam(awal, 18, tz)).toISOString(),
    sampaiUtc: new Date(msLokalPadaJam(geserKunci(awal, 1), 6, tz)).toISOString(),
  };
}

/* ------------------------------------------------------------ pencarian */

/**
 * Lipatan teks pencarian (brief §3B.4): abaikan kapital dan aksen.
 * Huruf yang tidak terurai lewat NFD (ø, æ, œ, ß, đ, ł, þ, ð) dipetakan
 * eksplisit — "koge" menemukan "Køge" lewat jalur ini.
 */
const PETA_LIPAT: Record<string, string> = {
  ø: "o",
  æ: "ae",
  œ: "oe",
  ß: "ss",
  đ: "d",
  ł: "l",
  þ: "th",
  ð: "d",
};

export function lipatTeks(s: string): string {
  return s
    .toLowerCase()
    .replace(/[øæœßđłþð]/g, (c) => PETA_LIPAT[c] ?? c)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Apakah salah satu nama (tim/kompetisi/negara) cocok dengan kueri terlipat. */
export function cocokPencarian(nama: string[], q: string): boolean {
  const kueri = lipatTeks(q).trim();
  if (!kueri) return true;
  return nama.some((n) => lipatTeks(n).includes(kueri));
}

/* --------------------------------------------------------- urutan tampil */

/**
 * Urutan tampil jadwal (brief §3B.3): kronologis dari kickoff UTC
 * asli; keadaan selesai/dihentikan paling BARU dulu. Live dan yang
 * akan datang tetap menaik. Stabil untuk kickoff yang sama.
 */
export function urutTampilJadwal<T extends { status: StatusTampil; kickoff_utc: string }>(
  items: T[],
): T[] {
  const selesai = (s: StatusTampil) => s === "finished" || s === "abandoned";
  return items
    .map((it, i) => ({ it, i }))
    .sort((x, y) => {
      const sx = selesai(x.it.status);
      const sy = selesai(y.it.status);
      if (sx !== sy) return sx ? 1 : -1;
      const kx = x.it.kickoff_utc;
      const ky = y.it.kickoff_utc;
      if (kx !== ky) return sx ? (kx < ky ? 1 : -1) : kx < ky ? -1 : 1;
      return x.i - y.i;
    })
    .map(({ it }) => it);
}

/**
 * Urutan pintasan "Sekarang" (brief §3B.2): laga berlangsung yang
 * dikonfirmasi sumber lebih dulu, lalu yang menunggu pembaruan, lalu
 * yang terdekat akan mulai; keadaan lain dikeluarkan. Maksimum 30.
 */
export function urutSekarang<T extends { status: StatusTampil; kickoff_utc: string }>(
  items: T[],
): T[] {
  const peringkat = (s: StatusTampil) =>
    s === "live" ? 0 : s === "menunggu-pembaruan" ? 1 : s === "scheduled" ? 2 : 3;
  return items
    .filter((i) => peringkat(i.status) < 3)
    .sort(
      (x, y) =>
        peringkat(x.status) - peringkat(y.status) ||
        (x.kickoff_utc < y.kickoff_utc ? -1 : x.kickoff_utc > y.kickoff_utc ? 1 : 0),
    )
    .slice(0, 30);
}

export interface KelompokJadwal<T> {
  /** Kunci tanggal lokal "YYYY-MM-DD". */
  kunci: string;
  /** "Hari ini" / "Besok" / nama hari — mengikuti zona terpilih. */
  label: string;
  /** "Jumat, 20 November" pada zona terpilih. */
  tanggal: string;
  items: T[];
}

/**
 * Kelompokkan item menurut TANGGAL LOKAL zona terpilih (bukan tanggal
 * UTC/server): laga 00.30 WIB keesokan hari masuk kelompok tanggal
 * WIB-nya. Urutan item di dalam kelompok dipertahankan dari pemanggil
 * (yang mengurutkan kickoff → prioritas liga → id).
 */
export function kelompokPerTanggal<T extends { kickoff_utc: string }>(
  items: T[],
  tz: string,
  now: Date = new Date(),
): KelompokJadwal<T>[] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = kunciTanggal(it.kickoff_utc, tz);
    const arr = map.get(k);
    if (arr) arr.push(it);
    else map.set(k, [it]);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([kunci, arr]) => ({
      kunci,
      label: labelHari(arr[0].kickoff_utc, tz, now),
      tanggal: tanggalPanjang(arr[0].kickoff_utc, tz),
      items: arr,
    }));
}
