import { loadServingModel } from "../../lib/quant/model-manifest";
import fs from "node:fs";
const s = loadServingModel(process.cwd() + "/data");
console.log("active artifact file:", s.artifactFile, "| modelVersion:", s.manifest.modelVersion);
const work = JSON.parse(fs.readFileSync("data/calibrated_ratings.json", "utf8"));
const LEGACY = ["B1","D1","D2","F1","I2","N1","SC0","E0","F2","G1","I1","P1","SP1","SP2","T1","E1"];
let same = 0; const diff: string[] = [];
for (const d of LEGACY) {
  if (JSON.stringify(s.ratings.leagues[d]) === JSON.stringify(work.leagues[d])) same++; else diff.push(d);
}
console.log("legacy identical active-vs-working:", same, "/16; differing:", diff.join(",") || "-");
for (const k of ["SM8","SM564","SM82","SM567"]) {
  const a = s.ratings.leagues[k], b = work.leagues[k];
  console.log(k, "active calibDate", a?.calibrationDate, "| working calibDate", b?.calibrationDate, "| identical:", JSON.stringify(a) === JSON.stringify(b));
}
console.log("active compiledAt:", s.ratings.compiledAt, "| working compiledAt:", work.compiledAt);
