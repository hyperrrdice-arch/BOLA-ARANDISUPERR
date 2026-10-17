import { getTheStatsDb } from "../lib/db/thestats-dataset";
import { getMasterDb } from "../lib/db/sqlite-master";

const theStatsDb = getTheStatsDb();
const masterDb = getMasterDb();

console.log("theStatsDb tables:", theStatsDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all());
const sampleC = theStatsDb.prepare("SELECT * FROM matches WHERE home_score IS NOT NULL LIMIT 1").get();
console.log("Sample theStats match:", sampleC);

const masterCols = masterDb.prepare("PRAGMA table_info(matches)").all();
console.log("masterDb matches cols:", masterCols.map((c: any) => c.name));
