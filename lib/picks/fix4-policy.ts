// ============================================================================
// KEBIJAKAN BEKU FIX-4 — SLOT TIKET RESMI HARIAN (Item 23)
// ----------------------------------------------------------------------------
// Keputusan pemilik (Arandi, 25 Nov 2026) — FINAL, tidak ditanyakan ulang:
//   - tepat 4 pilihan ("leg") per tiket, maks 1 tiket resmi per hari;
//   - ambang minimum per pilihan: published_prob >= 0,72;
//   - cutoff harian 14:00 WIB (Asia/Jakarta, UTC+7 tanpa DST);
//   - WAJIB ABSTAIN bila kandidat layak < 4 (dilarang menurunkan syarat);
//   - maks 1 pilihan per pertandingan;
//   - hanya kompetisi dengan feed hasil terverifikasi (klasifikasi PR 2:
//     statusFeedKompetisi === "berfeed");
//   - ranking deterministik: published_prob desc, fixture_id asc.
//
// Jendela harian: keputusan tanggal D (WIB) diambil pada cutoff D 14:00 WIB;
// laga layak = kickoff di (D 14:00 WIB, D+1 14:00 WIB]. Partisi 24 jam dari
// cutoff ini memastikan setiap laga masuk tepat satu keputusan harian —
// laga dini hari (00:00–14:00 WIB) tidak yatim dari jendela mana pun.
// Kandidat juga wajib sudah terbit pada/saat cutoff (created_utc <=
// decision_ts): keputusan dibekukan AS-OF cutoff, jadi menjalankan ulang
// generator sesudah cutoff menghasilkan himpunan yang sama persis.
// ============================================================================

/** Versi kebijakan Fix-4 (dibekukan bersama keputusan pemilik 25 Nov 2026). */
export const FIX4_POLICY_VERSION = "fix4-2026-11-25";

/** Tepat 4 pilihan per tiket. */
export const FIX4_TICKET_SIZE = 4;

/** Maksimal 1 tiket resmi per hari. */
export const FIX4_MAX_TICKETS_PER_DAY = 1;

/** Ambang minimum published_prob per pilihan. */
export const FIX4_MIN_PUBLISHED_PROB = 0.72;

/** Jam cutoff harian dalam WIB (14:00). */
export const FIX4_CUTOFF_HOUR_WIB = 14;

/** Maksimal pilihan per pertandingan (fixture_id = match_id di picks.db). */
export const FIX4_MAX_LEGS_PER_FIXTURE = 1;

/** Wajib ABSTAIN bila kandidat layak < FIX4_TICKET_SIZE. */
export const FIX4_ABSTAIN_IF_BELOW_SIZE = true;

/** Asia/Jakarta = UTC+7 sepanjang tahun (tanpa DST). */
export const WIB_OFFSET_MS = 7 * 3_600_000;

export interface Fix4Window {
  /** Tanggal keputusan dalam WIB, format YYYY-MM-DD. */
  date_wib: string;
  /** Momen cutoff beku (D 14:00 WIB) dalam ISO UTC. */
  decision_ts_utc: string;
  /** Batas bawah jendela kickoff (EKSKLUSIF) — sama dengan decision_ts. */
  window_start_utc: string;
  /** Batas atas jendela kickoff (INKLUSIF) — D+1 14:00 WIB. */
  window_end_utc: string;
}

/** Jendela Fix-4 untuk satu tanggal WIB (YYYY-MM-DD). */
export function fix4WindowForDate(dateWib: string): Fix4Window {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateWib);
  if (!m) throw new Error(`fix4: format tanggal WIB tidak valid: ${dateWib}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // 14:00 WIB = 07:00 UTC pada tanggal yang sama.
  const decisionMs = Date.UTC(y, mo - 1, d, FIX4_CUTOFF_HOUR_WIB - 7, 0, 0, 0);
  const decision = new Date(decisionMs).toISOString();
  return {
    date_wib: dateWib,
    decision_ts_utc: decision,
    window_start_utc: decision,
    window_end_utc: new Date(decisionMs + 24 * 3_600_000).toISOString(),
  };
}

/** Tanggal WIB (YYYY-MM-DD) dari sebuah momen UTC. */
export function fix4DateWibOf(nowUtc: string | Date): string {
  const t = nowUtc instanceof Date ? nowUtc.getTime() : Date.parse(nowUtc);
  if (!Number.isFinite(t)) throw new Error(`fix4: timestamp tidak valid: ${nowUtc}`);
  return new Date(t + WIB_OFFSET_MS).toISOString().slice(0, 10);
}
