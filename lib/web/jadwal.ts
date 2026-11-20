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

export type StatusFilter = "semua" | "akan-datang" | "selesai";

export interface FilterJadwal {
  /** Tanggal lokal "YYYY-MM-DD" pada zona `tz`. */
  tanggal: string;
  status: StatusFilter;
  liga: string | null;
  negara: string | null;
  tz: string;
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
  return {
    tanggal,
    status,
    liga: teks(params.liga),
    negara: teks(params.negara),
    tz,
  };
}

/** Query string kanonik untuk filter — tautan menyimpannya apa adanya. */
export function queryJadwal(f: FilterJadwal): string {
  const q = new URLSearchParams();
  q.set("tanggal", f.tanggal);
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
