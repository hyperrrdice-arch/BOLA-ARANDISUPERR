/**
 * FORMAT — formatter tampilan bersama (aman server + client, tanpa impor Node).
 *
 * Bahasa Indonesia (K6, bab Antarmuka U1/U5): tanggal & jam memakai
 * `id-ID`, persentase maksimal satu desimal dengan koma ("72,5%"), odds
 * desimal dua angka di belakang koma ("2,10"), ribuan bertanda titik
 * ("45.866"). Zona waktu tampilan dapat dipilih; baku Asia/Jakarta (WIB).
 * Backend tetap menyimpan UTC — konversi hanya terjadi di sini.
 */

export const ZONA_BAKU = "Asia/Jakarta";

/** Zona yang dikenal filter/UI; nilai di luar daftar ini → zona baku. */
export const DAFTAR_ZONA: { id: string; label: string }[] = [
  { id: "Asia/Jakarta", label: "WIB" },
  { id: "Asia/Makassar", label: "WITA" },
  { id: "Asia/Jayapura", label: "WIT" },
  { id: "UTC", label: "UTC" },
];

export function zonaValid(z: string | null | undefined): string {
  return z && DAFTAR_ZONA.some((d) => d.id === z) ? z : ZONA_BAKU;
}

export function labelZona(tz: string): string {
  return DAFTAR_ZONA.find((d) => d.id === tz)?.label ?? tz;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(kind: string, tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${kind}|${tz}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("id-ID", { timeZone: tz, ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

export function pct(p: number | null | undefined, digits = 1): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  const s = new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(p * 100);
  return `${s}%`;
}

export function num(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

export function int(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("id-ID");
}

/** Kunci tanggal lokal "YYYY-MM-DD" untuk instant `iso` pada zona `tz`. */
export function kunciTanggal(iso: string, tz: string = ZONA_BAKU): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function tanggalWib(iso: string, tz: string = ZONA_BAKU): string {
  return fmt("tgl", tz, { weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));
}

export function jamWibOnly(iso: string, tz: string = ZONA_BAKU): string {
  return fmt("jam", tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(iso),
  );
}

/** "Jumat, 20 November · 20.00 WIB" — pola tanggal dan jam resmi bab U1. */
export function tanggalJamWib(iso: string, tz: string = ZONA_BAKU): string {
  const d = fmt("tglPanjang", tz, { weekday: "long", day: "numeric", month: "long" }).format(
    new Date(iso),
  );
  return `${d} · ${jamWibOnly(iso, tz)} ${labelZona(tz)}`;
}

/** "Jumat, 20 November" tanpa jam — untuk kepala kelompok jadwal. */
export function tanggalPanjang(iso: string, tz: string = ZONA_BAKU): string {
  return fmt("tglPanjang", tz, { weekday: "long", day: "numeric", month: "long" }).format(
    new Date(iso),
  );
}

/**
 * Label kelompok hari relatif terhadap `now` pada zona terpilih:
 * "Hari ini", "Besok", atau nama hari — mengikuti tengah malam zona itu,
 * bukan tengah malam UTC/server.
 */
export function labelHari(iso: string, tz: string = ZONA_BAKU, now: Date = new Date()): string {
  const kunci = kunciTanggal(iso, tz);
  if (kunci === kunciTanggal(now.toISOString(), tz)) return "Hari ini";
  const besok = new Date(now.getTime() + 86_400_000);
  if (kunci === kunciTanggal(besok.toISOString(), tz)) return "Besok";
  return fmt("hari", tz, { weekday: "long" }).format(new Date(iso));
}

export const GATE_LABEL: Record<string, string> = {
  calibrated: "Kalibrasi liga lolos uji",
  partial: "Lolos sebagian",
  uncalibrated: "Belum lolos uji",
};

/** Label status kalibrasi; keadaan tak dikenal jujur sebagai bukti belum tersedia. */
export function labelGate(status: string | null | undefined): string {
  if (status && GATE_LABEL[status]) return GATE_LABEL[status];
  return "Bukti belum tersedia";
}

export const MARKET_LABEL: Record<string, string> = {
  "1x2": "Hasil pertandingan",
  dc: "Peluang ganda",
  ou15: "Total gol · garis 1,5",
  ou25: "Total gol · garis 2,5",
  ou35: "Total gol · garis 3,5",
  btts: "Kedua tim mencetak gol",
  team_over05_home: "Tim kandang mencetak gol",
  team_over05_away: "Tim tamu mencetak gol",
};

/**
 * Nama pilihan yang menyatakan kondisi menang secara lugas (kamus U5):
 * nama tim dipakai apa adanya dari data; garis gol diterjemahkan menjadi
 * jumlah gol ("Minimal dua gol"), bukan "Over 1.5".
 */
export function labelPilihan(market: string, selection: string, home: string, away: string): string {
  const s = selection.toLowerCase();
  switch (market) {
    case "1x2":
      return s === "1" ? `${home} menang` : s === "x" ? "Seri" : `${away} menang`;
    case "dc":
      return s === "1x"
        ? `${home} menang atau seri`
        : s === "12"
          ? "Salah satu tim menang"
          : `${away} menang atau seri`;
    case "ou15":
      return s === "over" ? "Minimal dua gol" : "Maksimal satu gol";
    case "ou25":
      return s === "over" ? "Minimal tiga gol" : "Maksimal dua gol";
    case "ou35":
      return s === "over" ? "Minimal empat gol" : "Maksimal tiga gol";
    case "btts":
      return s === "yes"
        ? "Kedua tim mencetak gol"
        : "Setidaknya satu tim tidak mencetak gol";
    case "team_over05_home":
      return `${home} mencetak gol`;
    case "team_over05_away":
      return `${away} mencetak gol`;
    default:
      return `${market} ${selection}`;
  }
}

/** Vonis satu pilihan (kamus U5): Tepat / Meleset / Menunggu hasil / Dibatalkan. */
export function labelVerdik(hit: number | null | undefined, dibatalkan = false): string {
  if (dibatalkan) return "Dibatalkan";
  if (hit === 1) return "Tepat";
  if (hit === 0) return "Meleset";
  return "Menunggu hasil";
}

/**
 * Label basis peluang terbit (K2). Baris warisan tanpa bukti immutable
 * memang tidak punya angka terbit — labelnya menyatakan itu, bukan
 * mengarang angka pengganti.
 */
export function labelBasisPeluang(basis: string | null | undefined): string {
  switch (basis) {
    case "effective":
      return "Peluang efektif";
    case "model":
      return "Peluang model";
    default:
      return "Peluang terbit tidak tercatat";
  }
}

export function labelKelas(grade: string): string {
  return `Kelas ${grade}`;
}
