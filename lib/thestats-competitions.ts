/**
 * Registry Konfigurasi & Mapping Kompetisi TheStatsAPI Target
 * Cakupan: Tier 1 Big 5 Eropa (PL, LaLiga, Serie A, Bundesliga, Ligue 1) + Eredivisie + UCL
 */

export interface TheStatsCompetitionConfig {
  id: string; // TheStatsAPI competition_id
  name: string; // Nama resmi di TheStatsAPI
  divCode: string; // Kode divisi yang selaras dengan data historis CSV & calibrated_ratings
  country: string;
  seasonName: string;
  seasonStartDate: string; // Filter awal musim 2026/2027
  tier: "TIER_1" | "CONTINENTAL" | "TIER_2";
  totalExpectedTeams: number;
}

export const TARGET_COMPETITIONS: Record<string, TheStatsCompetitionConfig> = {
  comp_3039: {
    id: "comp_3039",
    name: "Premier League",
    divCode: "E0",
    country: "England",
    seasonName: "2026/2027",
    seasonStartDate: "2026-08-01",
    tier: "TIER_1",
    totalExpectedTeams: 20,
  },
  comp_8814: {
    id: "comp_8814",
    name: "LaLiga",
    divCode: "SP1",
    country: "Spain",
    seasonName: "2026/2027",
    seasonStartDate: "2026-08-01",
    tier: "TIER_1",
    totalExpectedTeams: 20,
  },
  comp_5840: {
    id: "comp_5840",
    name: "Serie A",
    divCode: "I1",
    country: "Italy",
    seasonName: "2026/2027",
    seasonStartDate: "2026-08-01",
    tier: "TIER_1",
    totalExpectedTeams: 20,
  },
  comp_4643: {
    id: "comp_4643",
    name: "Bundesliga",
    divCode: "D1",
    country: "Germany",
    seasonName: "2026/2027",
    seasonStartDate: "2026-08-01",
    tier: "TIER_1",
    totalExpectedTeams: 18,
  },
  comp_0256: {
    id: "comp_0256",
    name: "Ligue 1",
    divCode: "F1",
    country: "France",
    seasonName: "2026/2027",
    seasonStartDate: "2026-08-01",
    tier: "TIER_1",
    totalExpectedTeams: 18,
  },
  comp_3809: {
    id: "comp_3809",
    name: "Eredivisie",
    divCode: "N1",
    country: "Netherlands",
    seasonName: "2026/2027",
    seasonStartDate: "2026-08-01",
    tier: "TIER_1",
    totalExpectedTeams: 18,
  },
  comp_3498: {
    id: "comp_3498",
    name: "UEFA Champions League",
    divCode: "UCL",
    country: "Europe",
    seasonName: "2026/2027",
    seasonStartDate: "2026-09-01",
    tier: "CONTINENTAL",
    totalExpectedTeams: 36,
  },
};

export function getCompetitionById(compId: string): TheStatsCompetitionConfig | undefined {
  return TARGET_COMPETITIONS[compId];
}

export function getCompetitionByDivCode(divCode: string): TheStatsCompetitionConfig | undefined {
  return Object.values(TARGET_COMPETITIONS).find(
    (c) => c.divCode.toUpperCase() === divCode.toUpperCase()
  );
}

export function getAllTargetCompetitionIds(): string[] {
  return Object.keys(TARGET_COMPETITIONS);
}
