export interface PopularCompetition {
  id: string; // e.g. "comp_3039", "comp_4083", "comp_3498"
  label_1xbet: string; // e.g. "England. Premier League", "Italy. Serie A"
  short: string; // e.g. "Premier League", "Serie A", "UCL"
}

// 7 Kompetisi / Liga Populer dengan ID resmi TheStatsAPI (llms.md) & format penamaan 1xBet
export const POPULAR_COMPETITIONS: PopularCompetition[] = [
  { id: "ALL", label_1xbet: "Semua Laga", short: "Semua" },
  { id: "comp_3498", label_1xbet: "UEFA Champions League", short: "UCL" },
  { id: "comp_7739", label_1xbet: "UEFA Europa League", short: "UEL" },
  { id: "comp_3039", label_1xbet: "England. Premier League", short: "Premier League" },
  { id: "comp_4083", label_1xbet: "Italy. Serie A", short: "Serie A" },
  { id: "comp_8814", label_1xbet: "Spain. La Liga", short: "La Liga" },
  { id: "comp_3892", label_1xbet: "Germany. Bundesliga", short: "Bundesliga" },
  { id: "comp_3601", label_1xbet: "France. Ligue 1", short: "Ligue 1" },
];

/**
 * Memformat nama kompetisi TheStatsAPI mengikuti standar penamaan 1xBet:
 * - Liga Domestik: "<Country>. <League Name>" (contoh: "England. Premier League", "Italy. Serie A", "Spain. La Liga")
 * - Turnamen Kontinental / Internasional: "<League Name>" (contoh: "UEFA Champions League", "UEFA Europa League")
 */
export function format1xBetLeagueName(name: string | undefined | null, country?: string | null): string {
  if (!name || typeof name !== "string") return "Kompetisi";

  // Normalisasi nama umum
  let cleanName = name.trim();
  if (cleanName.toLowerCase() === "laliga") cleanName = "La Liga";

  // Jika nama sudah mengandung nama negara di depannya
  if (country && cleanName.toLowerCase().startsWith(country.toLowerCase())) {
    return cleanName;
  }

  // Jika turnamen internasional / kontinental, jangan tambahkan nama negara
  const isInternational = /uefa|fifa|afc|caf|conmebol|world|champions league|europa league|nations league/i.test(cleanName);
  if (!isInternational && country && country.trim().length > 0) {
    return `${country.trim()}. ${cleanName}`;
  }

  return cleanName;
}
