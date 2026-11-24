/**
 * GERBANG PROMOSI MODEL (K4 + Item 24 Sprint A+B) — satu-satunya jalur
 * mengganti manifest AKTIF sesudah bootstrap. Membaca manifest aktif
 * (champion) + kandidat, memverifikasi artefak immutable kandidat ADA di
 * store dan hash-nya cocok dengan manifest kandidat (fix-5: bukan lagi
 * file lepas), lalu menilai dengan lib/quant/promotion-gate.ts.
 * Keputusan "promote" → pointer aktif berpindah ATOMIK ke kandidat
 * (tulis temp + rename); "reject" → aktif tidak berubah. Exit code:
 * 0 = promote, 2 = reject, 1 = error bernama.
 *
 * FAIL-CLOSED (Item 24): sebelum gerbang mekanis boleh mempromosikan,
 * berkas bukti promosi WAJIB lengkap dan saling cocok (lihat
 * lib/quant/promotion-evidence.ts): decision eksperimen berstatus
 * lolos gate, run-manifest yang mengikat hash kandidat + hash input +
 * cakupan, bukti persetujuan pemilik eksplisit untuk kandidat yang
 * sama, ringkasan paritas, dan file rencana rollback. Satu saja
 * hilang/tidak cocok → reject, exit 2, dan TIDAK ada file yang ditulis.
 *
 * Pakai: npx tsx scripts/promote-model.ts [--data-dir=data]
 *   --decision-file=path.json    outcome gate eksperimen (PR 3/PR 4)
 *   --run-manifest=path.json     manifes run dengan blok promotion
 *   --owner-approval=path.json   bukti keputusan pemilik bertanda waktu
 *   --parity-file=path.json      {"sampleSize": N, "sumAbsDelta": X}
 *   --rollback-plan=path         file rencana rollback (wajib ada)
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  ModelManifestError,
  loadActiveManifest,
  loadCandidateManifest,
  verifyManifestArtifact,
  writeActiveManifest,
} from "../lib/quant/model-manifest";
import { evaluatePromotion, type ParitySummary } from "../lib/quant/promotion-gate";
import { validatePromotionEvidence } from "../lib/quant/promotion-evidence";

function argValue(flag: string): string | null {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
}

/** Baca JSON defensif: absen/rusak → { value: null, error } (bukan throw). */
function readJsonArg(
  flag: string,
): { value: unknown; error?: string } {
  const p = argValue(flag);
  if (!p) return { value: null, error: `flag ${flag} tidak diberikan` };
  try {
    return { value: JSON.parse(fs.readFileSync(p, "utf8")) as unknown };
  } catch (e) {
    return {
      value: null,
      error: `${p}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

function main(): void {
  const dataDir = path.resolve(argValue("--data-dir") ?? "data");
  try {
    const champion = loadActiveManifest(dataDir);
    const candidate = loadCandidateManifest(dataDir);

    // Kandidat basi (artefaknya tidak ada di store / hash tidak cocok
    // dengan manifest kandidat) = reject.
    try {
      verifyManifestArtifact(dataDir, candidate);
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

    // --- Lapisan bukti fail-closed (Item 24). Semua berkas dibaca
    // defensif; ketiadaan apa pun menjadi alasan reject, bukan crash,
    // dan tidak ada penulisan sebelum seluruh bukti lolos.
    const decisionArg = readJsonArg("--decision-file");
    const runManifestArg = readJsonArg("--run-manifest");
    const approvalArg = readJsonArg("--owner-approval");

    let parity: ParitySummary | null = null;
    let parityError: string | undefined;
    const parityFile = argValue("--parity-file");
    if (!parityFile) {
      parityError = "flag --parity-file tidak diberikan";
    } else {
      try {
        parity = JSON.parse(fs.readFileSync(parityFile, "utf8")) as ParitySummary;
      } catch (e) {
        parityError = `${parityFile}: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    let rollbackPlan: { path: string; sha256: string } | null = null;
    let rollbackError: string | undefined;
    const rollbackPath = argValue("--rollback-plan");
    if (!rollbackPath) {
      rollbackError = "flag --rollback-plan tidak diberikan";
    } else {
      try {
        const raw = fs.readFileSync(rollbackPath);
        if (raw.length === 0) throw new Error("file kosong");
        rollbackPlan = {
          path: rollbackPath,
          sha256: `sha256:${createHash("sha256").update(raw).digest("hex")}`,
        };
      } catch (e) {
        rollbackError = `${rollbackPath}: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    const evidence = validatePromotionEvidence({
      candidate,
      decision: decisionArg.value,
      decisionError: decisionArg.error,
      runManifest: runManifestArg.value,
      runManifestError: runManifestArg.error,
      approval: approvalArg.value,
      approvalError: approvalArg.error,
      parity: parityError ? null : parity,
      rollbackPlan,
      rollbackError,
    });

    const evaluation = evaluatePromotion({ champion, candidate, parity });
    const promote = evidence.ok && evaluation.decision === "promote";
    console.log(
      JSON.stringify(
        {
          decision: promote ? "promote" : "reject",
          reasons: [
            ...evidence.reasons,
            ...(parityError ? [`parity_unreadable: ${parityError}`] : []),
            ...evaluation.reasons,
          ],
          warnings: evaluation.warnings,
          notes: [...evidence.notes, ...evaluation.notes],
          evidence: { ok: evidence.ok, reasons: evidence.reasons },
          champion: champion.modelVersion,
          candidate: candidate.modelVersion,
        },
        null,
        2,
      ),
    );
    if (promote) {
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
