import { getMasterDb } from "../lib/db/sqlite-master";

const masterDb = getMasterDb();
const d1Teams = masterDb.prepare("SELECT DISTINCT home_team FROM matches WHERE div = 'D1' AND season = '2026/2027'").all();
console.log("D1 teams in masterDb:", d1Teams.map((t: any) => t.home_team));

const n1Teams = masterDb.prepare("SELECT DISTINCT home_team FROM matches WHERE div = 'N1' AND season = '2026/2027'").all();
console.log("N1 teams in masterDb:", n1Teams.map((t: any) => t.home_team));
