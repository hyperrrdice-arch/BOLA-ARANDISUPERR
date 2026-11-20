/**
 * BANGUN MANIFEST MODEL (K4) — jalur fit / bootstrap.
 *
 * Default: menulis manifest KANDIDAT (data/model-manifest.candidate.json)
 * yang mendeskripsikan artefak rating saat ini di --data-dir. Manifest
 * kandidat juga ditulis otomatis oleh scripts/calibrate-ratings.ts dan
 * scripts/fit-global-offsets.ts setiap mereka menulis ulang artefak.
 *
 * --activate: menulis manifest AKTIF (data/model-manifest.json). Hanya
 * untuk bootstrap awal; pergantian champion sesudahnya wajib lewat
 * gerbang scripts/promote-model.ts.
 *
 * Pakai: npx tsx scripts/build-model-manifest.ts [--data-dir=data] [--activate]
 */
import path from "node:path";
import {
  ACTIVE_MANIFEST_FILENAME,
  CANDIDATE_MANIFEST_FILENAME,
  ModelManifestError,
  buildManifest,
  readRatingsRaw,
  trainingWindowFromDataset,
  writeActiveManifest,
  writeCandidateManifest,
} from "../lib/quant/model-manifest";

function argValue(flag: string): string | null {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
}

function main(): void {
  const dataDir = path.resolve(argValue("--data-dir") ?? "data");
  const activate = process.argv.includes("--activate");
  try {
    if (activate) {
      const ratingsRaw = readRatingsRaw(dataDir);
      const manifest = buildManifest({
        ratingsRaw,
        generatedBy: "scripts/build-model-manifest.ts --activate",
        window: trainingWindowFromDataset(dataDir) ?? undefined,
      });
      writeActiveManifest(dataDir, manifest);
      console.log(
        JSON.stringify(
          {
            file: path.join(dataDir, ACTIVE_MANIFEST_FILENAME),
            modelVersion: manifest.modelVersion,
            ratingsHash: manifest.ratingsHash,
            trainingMatches: manifest.training.totalMatches,
            window: manifest.training.window,
            contentHash: manifest.contentHash,
          },
          null,
          2,
        ),
      );
    } else {
      const manifest = writeCandidateManifest(dataDir, {
        generatedBy: "scripts/build-model-manifest.ts",
      });
      console.log(
        JSON.stringify(
          {
            file: path.join(dataDir, CANDIDATE_MANIFEST_FILENAME),
            modelVersion: manifest.modelVersion,
            ratingsHash: manifest.ratingsHash,
            trainingMatches: manifest.training.totalMatches,
            window: manifest.training.window,
            contentHash: manifest.contentHash,
          },
          null,
          2,
        ),
      );
    }
  } catch (err) {
    if (err instanceof ModelManifestError) {
      console.error(`[${err.code}] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

main();
