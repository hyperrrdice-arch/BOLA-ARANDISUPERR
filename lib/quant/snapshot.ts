/**
 * PEMBACA SNAPSHOT AS-OF (K4 · bab Model Q2 butir 2).
 *
 * Fitur form sebuah tim untuk satu keputusan hanya boleh berasal dari
 * observasi yang SUDAH TERSEDIA pada decision_at: `available_at ≤
 * decision_at`. Observasi dengan available_at sesudah keputusan — hasil
 * ekstrem, harga menarik, apa pun — tidak mengubah snapshot (uji suntikan
 * masa depan Q03).
 *
 * Aturan tanggal-saja: observasi yang cap ketersediaannya hanya tanggal
 * (tanpa jam) baru terhitung untuk keputusan pada hari UTC BERIKUTNYA —
 * jendela fitur selalu hari-hari yang lebih awal dari hari keputusan,
 * sehingga hasil satu hari tidak pernah bocor ke prediksi hari yang sama.
 */
export interface TeamResultRow {
  team: string;
  /** Tanggal laga (ISO atau YYYY-MM-DD). */
  date: string;
  /** Kapan versi data ini pertama bisa dibaca sistem; default = date. */
  availableAt?: string | null;
  goalsFor: number;
  goalsAgainst: number;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Momen efektif sebuah observasi mulai boleh dibaca (ms epoch). */
export function effectiveAvailableMs(row: TeamResultRow): number {
  const raw = (row.availableAt ?? row.date ?? "").trim();
  if (DATE_ONLY.test(raw)) {
    // Tanggal-saja → hari UTC berikutnya pukul 00:00 (lihat header modul).
    return Date.parse(`${raw}T00:00:00.000Z`) + 86400_000;
  }
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

export function isAvailableAt(row: TeamResultRow, decisionAtIso: string): boolean {
  const decisionMs = Date.parse(decisionAtIso);
  if (!Number.isFinite(decisionMs)) return false;
  return effectiveAvailableMs(row) <= decisionMs;
}

export interface TeamFormSnapshot {
  /** Rata-rata gol dicetak pada jendela; null bila tak ada observasi sah. */
  goalsAvg: number | null;
  sampleSize: number;
  /** Tanggal observasi terlama yang terpakai (untuk audit jendela). */
  usedDates: string[];
}

/**
 * Snapshot form satu tim pada decision_at: `window` observasi TERBARU
 * yang tersedia, dirata-rata golnya. Baris tim lain / belum tersedia /
 * bertanggal ≥ batas disaring keluar.
 */
export function buildFormSnapshot(
  rows: readonly TeamResultRow[],
  team: string,
  decisionAtIso: string,
  window = 6,
): TeamFormSnapshot {
  const usable = rows
    .filter((r) => r.team === team && isAvailableAt(r, decisionAtIso))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, Math.max(0, window));
  if (usable.length === 0) return { goalsAvg: null, sampleSize: 0, usedDates: [] };
  const avg = usable.reduce((s, r) => s + r.goalsFor, 0) / usable.length;
  return { goalsAvg: avg, sampleSize: usable.length, usedDates: usable.map((r) => r.date) };
}
