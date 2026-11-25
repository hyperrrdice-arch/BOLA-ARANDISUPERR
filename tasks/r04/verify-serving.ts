/**
 * R-04 — Verifikasi saji pasca-promosi (read-only).
 * Memuat model saji aktif lewat loadServingModel (jalur produksi) dan
 * membandingkan λ/μ + metadata resolusi untuk fixture bergaya fd_
 * (hint kode divisi + nama bentuk fd) terhadap artefak champion lama.
 */
import fs from "node:fs";
import path from "node:path";
import { loadServingModel } from "../../lib/quant/model-manifest";
import { setCalibratedRatingsOverride, clearCalibratedRatingsCache, type CalibratedRatingsFile } from "../../lib/quant/ratings-loader";
import { predictMatch } from "../../lib/quant/predict";

const DATA = path.join(process.cwd(), "data");
const serving = loadServingModel(DATA);
console.log("ACTIVE ratingsHash:", serving.manifest.ratingsHash, "| modelVersion:", serving.manifest.modelVersion);
const champion = JSON.parse(fs.readFileSync(path.join(DATA, "model-artifacts", "ratings-8a790aeaa4e54fdd43dc290dd229f1f8aca24e5ecbe25bc29666eeab93e648e8.json"), "utf8")) as CalibratedRatingsFile;

const SAMPLES = [
  { hint: "D1", home: "M'gladbach", away: "Dortmund" },
  { hint: "SP2", home: "Albacete", away: "Celta B" },
  { hint: "E0", home: "Liverpool", away: "Man City" },
  { hint: "SP1", home: "Ath Madrid", away: "Barcelona" },
];
for (const s of SAMPLES) {
  setCalibratedRatingsOverride(serving.ratings);
  const now = predictMatch({ homeTeam: s.home, awayTeam: s.away, leagueHint: s.hint, homeTelemetry: null, awayTelemetry: null, cutoff: "2026-11-26" });
  clearCalibratedRatingsCache();
  setCalibratedRatingsOverride(champion);
  const old = predictMatch({ homeTeam: s.home, awayTeam: s.away, leagueHint: s.hint, homeTelemetry: null, awayTelemetry: null, cutoff: "2026-11-26" });
  clearCalibratedRatingsCache();
  const md = now.params.metadata;
  console.log(JSON.stringify({
    fixture: `${s.home} vs ${s.away} (${s.hint})`,
    div: md?.div, fitSystem: md?.leagueResolution?.fitSystem, macroPriorDate: md?.macroPriorDate,
    lambdaNew: Number(now.lambda.toFixed(3)), muNew: Number(now.mu.toFixed(3)),
    lambdaOld: Number(old.lambda.toFixed(3)), muOld: Number(old.mu.toFixed(3)),
  }));
}
