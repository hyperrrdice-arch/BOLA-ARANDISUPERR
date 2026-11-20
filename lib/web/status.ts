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
  scheduled: "Akan datang",
  live: "Sedang berlangsung",
  finished: "Selesai",
  postponed: "Ditunda",
  cancelled: "Dibatalkan",
  abandoned: "Dihentikan",
  unknown: "Status tidak diketahui",
};

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
