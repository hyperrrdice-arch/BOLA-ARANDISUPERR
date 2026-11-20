/**
 * GERBANG PROMOSI MODEL (K4) — satu-satunya jalur mengganti manifest
 * AKTIF sesudah bootstrap. Membaca manifest aktif (champion) + kandidat,
 * memverifikasi kandidat mendeskripsikan artefak rating saat ini, lalu
 * menilai dengan lib/quant/promotion-gate.ts. Keputusan "promote" →
 * kandidat ditulis menjadi manifest aktif; "reject" → aktif tidak
 * berubah. Exit code: 0 = promote, 2 = reject, 1 = error bernama.
 *
 * Pakai: npx tsx scripts/promote-model.ts [--data-dir=data] [--parity-file=path.json]
 * --parity-file berisi {"sampleSize": N, "sumAbsDelta": X} dari evaluasi paritas.
 */
import fs from "node:fs";
import path from "node:path";
import {
  ModelManifestError,
  loadActiveManifest,
  loadCandidateManifest,
  readRatingsRaw,
  verifyManifestRatings,
  writeActiveManifest,
} from "../lib/quant/model-manifest";
import { evaluatePromotion, type ParitySummary } from "../lib/quant/promotion-gate";

function argValue(flag: string): string | null {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
}

function main(): void {
  const dataDir = path.resolve(argValue("--data-dir") ?? "data");
  try {
    const champion = loadActiveManifest(dataDir);
    const candidate = loadCandidateManifest(dataDir);

    // Kandidat basi (artefak sudah berubah sejak kandidat dibangun) = reject.
    try {
      verifyManifestRatings(candidate, readRatingsRaw(dataDir));
    } catch (err) {
      if (err instanceof ModelManifestError) {
        console.log(
          JSON.stringify(
            {
              decision: "reject",
              reasons: [`${err.code}: ${err.message}`],
              warnings: [],
              notes: [],
              champion: champion.modelVersion,
              candidate: candidate.modelVersion,
            },
            null,
            2,
          ),
        );
        process.exit(2);
      }
      throw err;
    }

    let parity: ParitySummary | null = null;
    const parityFile = argValue("--parity-file");
    if (parityFile) {
      parity = JSON.parse(fs.readFileSync(parityFile, "utf8")) as ParitySummary;
    }

    const evaluation = evaluatePromotion({ champion, candidate, parity });
    console.log(
      JSON.stringify(
        {
          ...evaluation,
          champion: champion.modelVersion,
          candidate: candidate.modelVersion,
        },
        null,
        2,
      ),
    );
    if (evaluation.decision === "promote") {
      writeActiveManifest(dataDir, candidate);
      console.log(`Manifest aktif sekarang: ${candidate.modelVersion}`);
      process.exit(0);
    }
    process.exit(2);
  } catch (err) {
    if (err instanceof ModelManifestError) {
      console.error(`[${err.code}] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

main();
