/**
 * FORMAT — shared display helpers (server + client safe, no Node imports).
 * English number format (en-GB): dot decimals, comma thousands.
 * Times are always WIB (Asia/Jakarta), labelled in the UI copy.
 */

export function pct(p: number | null | undefined, digits = 1): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  return `${(p * 100).toFixed(digits)}%`;
}

export function num(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function int(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-GB");
}

const tglWib = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  weekday: "short",
  day: "numeric",
  month: "short",
});
const jamWib = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const tglJamWib = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const hariWib = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  weekday: "long",
});

export function tanggalWib(iso: string): string {
  return tglWib.format(new Date(iso));
}
export function jamWibOnly(iso: string): string {
  return jamWib.format(new Date(iso));
}
export function tanggalJamWib(iso: string): string {
  return `${tglJamWib.format(new Date(iso))} WIB`;
}

/** Relative day group for lists: "Today", "Tomorrow", or the weekday name. */
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
  if (a === b) return "Today";
  if (a === besok) return "Tomorrow";
  return hariWib.format(d);
}

export const GATE_LABEL: Record<string, string> = {
  calibrated: "Calibrated",
  partial: "Partial",
  uncalibrated: "Not calibrated",
};

export const MARKET_LABEL: Record<string, string> = {
  "1x2": "Match result",
  dc: "Double chance",
  ou15: "Over/under 1.5 goals",
  ou25: "Over/under 2.5 goals",
  ou35: "Over/under 3.5 goals",
  btts: "Both teams to score",
  team_over05_home: "Home team to score",
  team_over05_away: "Away team to score",
};

export function labelPilihan(market: string, selection: string, home: string, away: string): string {
  const s = selection.toLowerCase();
  switch (market) {
    case "1x2":
      return s === "1" ? `${home} win` : s === "x" ? "Draw" : `${away} win`;
    case "dc":
      return s === "1x" ? `${home} or draw` : s === "12" ? `${home} or ${away}` : `Draw or ${away}`;
    case "ou15":
    case "ou25":
    case "ou35": {
      const line = market.slice(2).replace("5", ".5");
      return s === "over" ? `Over ${line} goals` : `Under ${line} goals`;
    }
    case "btts":
      return s === "yes" ? "Both teams to score" : "Not both teams to score";
    case "team_over05_home":
      return `${home} to score`;
    case "team_over05_away":
      return `${away} to score`;
    default:
      return `${market} ${selection}`;
  }
}
