import fs from "node:fs";
import { getMasterDb } from "../lib/db/sqlite-master";
import { getTheStatsDb } from "../lib/db/thestats-dataset";

const masterDb = getMasterDb();
const theStatsDb = getTheStatsDb();

console.log("Checking if UCL odds exist in masterDb or theStatsDb...");
const uclOddsInMaster = masterDb.prepare("SELECT count(*) as count FROM matches WHERE div = 'UCL' AND b365h IS NOT NULL").get();
console.log("uclOddsInMaster:", uclOddsInMaster);

// Check if any json in data/ has odds
const files = fs.readdirSync("data");
console.log("Files in data/:", files);
