import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("data/thestats_dataset.db");

const compNames: Record<string, string> = {
  comp_3039: "Premier League (ENG)",
  comp_8814: "LaLiga (ESP)",
  comp_5840: "Serie A (ITA)",
  comp_4643: "Bundesliga (GER)",
  comp_0256: "Ligue 1 (FRA)",
  comp_3809: "Eredivisie (NED)",
  comp_3498: "Champions League (UCL)",
};

console.log("================================================================================");
console.log("📊 [THESTATS_DATASET.DB] Ringkasan Multi-Kompetisi 2026/2027");
console.log("================================================================================");

const summary = (db.prepare(`
  SELECT competition_id, COUNT(*) as matches_count 
  FROM matches 
  GROUP BY competition_id
`).all() as any[]).map((r) => ({
  Kompetisi: compNames[r.competition_id] || r.competition_id,
  CompID: r.competition_id,
  LagaSelesai: r.matches_count,
  TeamLogs95Kolom: r.matches_count * 2,
}));

console.table(summary);

console.log("\n================================================================================");
console.log("🔥 [SAMPLE TEAM MATCH LOGS] Telemetry Granular Terkini Klub Elit Eropa");
console.log("================================================================================");

const sampleLogs = (db.prepare(`
  SELECT 
    SUBSTR(m.utc_date, 1, 10) as Tanggal,
    t1.name as Tim,
    t2.name as Lawan,
    l.venue as Venue,
    l.goals_for || '-' || l.goals_against as Skor,
    ROUND(l.xg_for, 2) as xGF,
    ROUND(l.xg_against, 2) as xGA,
    l.shots_inside_box_for as BoxShots,
    l.big_chances_for as BigChances,
    ROUND(l.possession_pct, 1) || '%' as Poss,
    l.passes_accurate_for as AccPass,
    l.accurate_crosses_for as Crosses,
    ROUND(l.aerial_duels_pct_for, 1) as AerialDuels,
    l.corners_for as Corners
  FROM team_match_logs l
  JOIN matches m ON l.match_id = m.match_id
  JOIN teams t1 ON l.team_id = t1.team_id
  JOIN teams t2 ON l.opponent_id = t2.team_id
  WHERE t1.name IN ('Arsenal', 'Real Madrid', 'Barcelona', 'FC Bayern München', 'Inter', 'Paris Saint-Germain', 'AFC Ajax')
    AND l.venue = 'HOME'
  GROUP BY t1.name
  ORDER BY m.utc_date DESC
`).all() as any[]);

console.table(sampleLogs);

console.log("\n================================================================================");
console.log("🏥 [SAMPLE SQUAD & INJURIES] Status Pemain Cedera Terkini di Database");
console.log("================================================================================");

const sampleInjuries = (db.prepare(`
  SELECT 
    t.name as Klub,
    p.name as Pemain,
    p.position as Pos,
    p.injury_status as StatusMedis,
    p.height_cm as TinggiCm
  FROM team_squads p
  JOIN teams t ON p.team_id = t.team_id
  WHERE p.injury_status LIKE 'INJURED%' OR p.injury_status LIKE 'SUSPENDED%'
  ORDER BY t.name ASC
  LIMIT 10
`).all() as any[]);

console.table(sampleInjuries);
