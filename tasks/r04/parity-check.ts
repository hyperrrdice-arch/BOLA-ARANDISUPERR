/**
 * R-04 — Paritas lab/produksi untuk kandidat promosi.
 *
 * Menghitung probabilitas 1X2 sampel fixture mendatang (4 liga terdampak,
 * baris fd_ + sm_) lewat DUA jalur pemuatan bobot kandidat yang sama:
 *   (produksi) loadServingModel di direktori staging yang manifest
 *              aktifnya = manifest kandidat + artefak immutable-nya;
 *   (lab)      file lepas data/calibrated_ratings.json (isi yang sama,
 *              ditulis jalur fit) di-parse langsung.
 * Σ|Δp| atas seluruh probabilitas sampel harus ≤ toleransi gerbang
 * promosi (0,005) — membuktikan artefak yang dipromosikan menghasilkan
 * angka yang sama dengan yang dievaluasi lab. Menulis
 * tasks/r04/promotion/parity.json {sampleSize, sumAbsDelta}.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { loadServingModel } from "../../lib/quant/model-manifest";
import { setCalibratedRatingsOverride, clearCalibratedRatingsCache, type CalibratedRatingsFile } from "../../lib/quant/ratings-loader";
import { predictMatch } from "../../lib/quant/predict";

const DATA = path.join(process.cwd(), "data");
const STAGE = "/tmp/r04-parity-data";

// --- staging: kandidat sebagai manifest aktif di direktori salinan ---
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(path.join(STAGE, "model-artifacts"), { recursive: true });
const candidateRaw = fs.readFileSync(path.join(DATA, "model-manifest.candidate.json"), "utf8");
fs.writeFileSync(path.join(STAGE, "model-manifest.json"), candidateRaw);
const cand = JSON.parse(candidateRaw) as { ratingsHash: string };
const short = cand.ratingsHash.replace("sha256:", "");
const artifact = fs.readdirSync(path.join(DATA, "model-artifacts")).find((f) => f.startsWith(`ratings-${short}`));
if (!artifact) throw new Error("artefak kandidat tidak ditemukan di store");
fs.copyFileSync(path.join(DATA, "model-artifacts", artifact), path.join(STAGE, "model-artifacts", artifact));

// --- sampel fixture ---
const db = new DatabaseSync(path.join(DATA, "upcoming_fixtures.db"), { readOnly: true });
const rows = db.prepare(
  `SELECT match_id, competition_id, home_team_name, away_team_name, utc_date
   FROM upcoming_fixtures
   WHERE utc_date >= '2026-11-26' AND utc_date < '2026-12-13'
     AND (competition_id IN ('sm:8','sm:564','sm:82','sm:567','E0','SP1','D1','SP2'))
   ORDER BY utc_date LIMIT 60`,
).all() as { match_id: string; competition_id: string; home_team_name: string; away_team_name: string; utc_date: string }[];
db.close();
if (rows.length === 0) throw new Error("sampel fixture kosong");

const probsFor = (ratings: CalibratedRatingsFile): number[] => {
  setCalibratedRatingsOverride(ratings);
  const out: number[] = [];
  for (const r of rows) {
    const p = predictMatch({
      homeTeam: r.home_team_name, awayTeam: r.away_team_name,
      leagueHint: r.competition_id,
      homeTelemetry: null, awayTelemetry: null,
      cutoff: r.utc_date.slice(0, 10),
    });
    out.push(p.probs.home, p.probs.draw, p.probs.away);
  }
  clearCalibratedRatingsCache();
  return out;
};

const serving = loadServingModel(STAGE);
const prod = probsFor(serving.ratings);
const labRatings = JSON.parse(fs.readFileSync(path.join(DATA, "calibrated_ratings.json"), "utf8")) as CalibratedRatingsFile;
const lab = probsFor(labRatings);

let sumAbsDelta = 0;
for (let i = 0; i < prod.length; i++) sumAbsDelta += Math.abs(prod[i] - lab[i]);

const outDir = path.join(process.cwd(), "tasks", "r04", "promotion");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "parity.json"), JSON.stringify({ sampleSize: rows.length, sumAbsDelta }, null, 1));
console.log(JSON.stringify({
  sampleSize: rows.length,
  nFdRows: rows.filter((r) => r.match_id.startsWith("fd_")).length,
  sumAbsDelta,
  candidateArtifact: artifact,
  servingModelVersion: serving.manifest.modelVersion,
}, null, 1));
