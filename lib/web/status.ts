/**
 * STATUS TAMPIL — kosakata status pertandingan untuk lapisan web (K6, U02).
 *
 * Tujuh keadaan resmi: scheduled, live, finished, postponed, cancelled,
 * abandoned, unknown — masing-masing dengan label Indonesianya sendiri.
 *
 * Normalisasi dasar tetap milik K1 (`normalizeMatchStatus` di
 * lib/identity/fixture-resolver.ts, dipakai produser dan resolver hasil).
 * Satu perbedaan yang disengaja di lapisan tampil: K1 mengelompokkan
 * ejaan "abandoned" ke cancelled karena untuk penyelesaian pilihan
 * keduanya sama-sama tidak menghasilkan skor regulasi. Untuk pembaca
 * keduanya BUKAN hal yang sama — laga yang dibatalkan tidak pernah
 * menampilkan skor, sedangkan laga yang dihentikan menampilkan skor
 * parsialnya. Jadi ejaan abandoned diperiksa di sini SEBELUM mendelegasi
 * ke normalizer K1; perilaku K1 sendiri tidak diubah.
 */
import { normalizeMatchStatus } from "../identity/fixture-resolver";

export type FixtureStatus =
  | "scheduled"
  | "live"
  | "finished"
  | "postponed"
  | "cancelled"
  | "abandoned"
  | "unknown";

const ABANDONED_SPELLINGS = new Set([
  "abandoned",
  "abd",
  "abandon",
  "abandoned_match",
  "match_abandoned",
]);

/** Status mentah sumber mana pun → tujuh keadaan tampil. Tak dikenal → 'unknown', tidak ditebak. */
export function displayStatus(raw: string | null | undefined): FixtureStatus {
  if (raw !== null && raw !== undefined) {
    if (ABANDONED_SPELLINGS.has(raw.trim().toLowerCase())) return "abandoned";
  }
  return normalizeMatchStatus(raw);
}

export const STATUS_LABEL_ID: Record<FixtureStatus, string> = {
  scheduled: "Belum mulai",
  live: "Sedang berlangsung",
  finished: "Selesai",
  postponed: "Ditunda",
  cancelled: "Dibatalkan",
  abandoned: "Dihentikan",
  unknown: "Status tidak diketahui",
};

/* ------------------------------------------- dimensi waktu (brief §4) */

/**
 * Status TAMPIL = status sumber + dimensi waktu. Satu keadaan tambahan
 * yang tidak bisa dinyatakan string sumber mana pun: sepak mula sudah
 * lewat tetapi sumber belum mengonfirmasi apa pun (belum menyatakan
 * berlangsung, belum memberi skor) — brief §4 mewajibkan labelnya
 * sendiri, "Menunggu pembaruan pertandingan", identik di semua
 * permukaan. Tipe sumber `FixtureStatus` TIDAK berubah (tujuh keadaan
 * K1/K6 tetap kosakata normalisasi); waktu hanya menafsir ULANG
 * keadaan terjadwal/tak-dikenal yang sudah kedaluwarsa.
 */
export type StatusTampil = FixtureStatus | "menunggu-pembaruan";

export const LABEL_STATUS_TAMPIL: Record<StatusTampil, string> = {
  ...STATUS_LABEL_ID,
  "menunggu-pembaruan": "Menunggu pembaruan pertandingan",
};

/**
 * Terapkan dimensi waktu pada status sumber yang sudah dinormalisasi:
 * - berlangsung/selesai/ditunda/dibatalkan/dihentikan dari sumber
 *   selalu menang — jam tidak pernah menimpa konfirmasi sumber;
 * - terjadwal (atau tak dikenal) dengan kickoff yang sudah tiba/lewat
 *   → "menunggu-pembaruan" (pada instant kickoff persis sudah termasuk:
 *   konsisten dengan gerbang cutoff K2 dan kunci builder yang mengunci
 *   PADA T);
 * - kickoff tak terbaca → status sumber apa adanya (tidak ditebak).
 */
export function terapkanWaktu(
  status: FixtureStatus,
  kickoffUtc: string | null | undefined,
  nowMs: number,
): StatusTampil {
  if (status !== "scheduled" && status !== "unknown") return status;
  const ko = kickoffUtc ? Date.parse(kickoffUtc) : NaN;
  if (Number.isFinite(ko) && nowMs >= ko) return "menunggu-pembaruan";
  return status;
}

/** Status mentah + kickoff + jam → status tampil (gabungan dua langkah). */
export function statusTampil(
  raw: string | null | undefined,
  kickoffUtc: string | null | undefined,
  nowMs: number,
): StatusTampil {
  return terapkanWaktu(displayStatus(raw), kickoffUtc, nowMs);
}

/** Menit berjalan dari string status mentah ("63'", "2H 63'") — null bila tak terbaca. */
export function menitDariStatusMentah(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/(\d{1,3})\s*['′]/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 130 ? n : null;
}

/** Label render untuk status tampil; laga berlangsung menyertakan menit bila sumber memberinya. */
export function labelStatus(status: StatusTampil, menit?: number | null): string {
  const dasar = LABEL_STATUS_TAMPIL[status];
  return status === "live" && menit !== null && menit !== undefined
    ? `${dasar} · ${menit}'`
    : dasar;
}

/**
 * Skor apa yang boleh ditampilkan untuk keadaan ini:
 * - "penuh": skor resmi (finished; live menampilkan skor berjalan),
 * - "parsial": skor saat laga dihentikan (abandoned),
 * - "tidak": tidak ada skor yang boleh tampil — cancelled secara eksplisit
 *   TIDAK PERNAH menampilkan skor walau baris sumber membawanya.
 */
export type SkorTerlihat = "penuh" | "parsial" | "tidak";

export function skorTerlihat(status: FixtureStatus): SkorTerlihat {
  switch (status) {
    case "finished":
    case "live":
      return "penuh";
    case "abandoned":
      return "parsial";
    default:
      return "tidak";
  }
}
