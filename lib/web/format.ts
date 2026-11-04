/**
 * FORMAT — helper tampilan bersama (server + client aman, tanpa impor Node).
 * Angka Indonesia: koma desimal, titik ribuan. Waktu selalu WIB.
 */

export function pct(p: number | null | undefined, digits = 1): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  return `${(p * 100).toFixed(digits).replace(".", ",")}%`;
}

export function num(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(digits).replace(".", ",");
}

export function int(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

const tglWib = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  weekday: "short",
  day: "numeric",
  month: "short",
});
const jamWib = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const tglJamWib = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function tanggalWib(iso: string): string {
  return tglWib.format(new Date(iso));
}
export function jamWibOnly(iso: string): string {
  return jamWib.format(new Date(iso)).replace(".", ":");
}
export function tanggalJamWib(iso: string): string {
  return `${tglJamWib.format(new Date(iso)).replace(".", ":")} WIB`;
}

/** Kelompok hari relatif untuk daftar: "Hari ini", "Besok", atau tanggal. */
export function labelHari(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const a = fmt.format(d);
  const b = fmt.format(now);
  const besok = fmt.format(new Date(now.getTime() + 86_400_000));
  if (a === b) return "Hari ini";
  if (a === besok) return "Besok";
  return tglWib.format(d);
}

export const GATE_LABEL: Record<string, string> = {
  calibrated: "TERKALIBRASI",
  partial: "SEBAGIAN",
  uncalibrated: "BELUM TERKALIBRASI",
};

export const MARKET_LABEL: Record<string, string> = {
  "1x2": "1X2",
  dc: "Peluang Ganda",
  ou15: "Atas/Bawah 1,5",
  ou25: "Atas/Bawah 2,5",
  ou35: "Atas/Bawah 3,5",
  btts: "Kedua Tim Cetak Gol",
  team_over05_home: "Tim Kandang Cetak Gol",
  team_over05_away: "Tim Tamu Cetak Gol",
};

export function labelPilihan(market: string, selection: string, home: string, away: string): string {
  const s = selection.toLowerCase();
  switch (market) {
    case "1x2":
      return s === "1" ? `${home} menang` : s === "x" ? "Seri" : `${away} menang`;
    case "dc":
      return s === "1x" ? `${home} / Seri` : s === "12" ? `${home} / ${away}` : `Seri / ${away}`;
    case "ou15":
    case "ou25":
    case "ou35": {
      const line = market.slice(2).replace("5", ",5");
      return s === "over" ? `Lebih dari ${line} gol` : `Kurang dari ${line} gol`;
    }
    case "btts":
      return s === "yes" ? "Kedua tim cetak gol" : "Salah satu tim gagal cetak gol";
    case "team_over05_home":
      return `${home} cetak gol`;
    case "team_over05_away":
      return `${away} cetak gol`;
    default:
      return `${market} ${selection}`;
  }
}
