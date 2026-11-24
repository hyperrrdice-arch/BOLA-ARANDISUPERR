/**
 * BUKTI PROMOSI FAIL-CLOSED (Item 24, Sprint A+B — brief hal. 14).
 *
 * scripts/promote-model.ts adalah satu-satunya jalur mengganti manifest
 * aktif. Sebelum gerbang mekanis promotion-gate.ts boleh berkata
 * "promote", promosi WAJIB membawa berkas bukti lengkap yang saling
 * mengikat satu sama lain dan ke manifest kandidat:
 *
 *  1. decision — outcome eksperimen evaluator (PR 3/PR 4): keputusan
 *     gate LULUS ("promote" kosakata mesin experiment-stats, atau
 *     "eligible_for_shadow" kosakata brief) dan SETIAP gate_checks
 *     berstatus pass. Keputusan "retain"/"inconclusive" = tolak.
 *  2. run-manifest — manifes run yang sama, memuat blok `promotion`:
 *     hash contentHash + ratingsHash + modelVersion kandidat yang
 *     DINILAI (harus sama persis dengan manifest kandidat yang akan
 *     dipromosikan), hash input eksperimen (≥1, format sha256:), dan
 *     metrik cakupan kandidat vs champion (penurunan > 0,02 = tolak,
 *     ambang yang sama dengan cek coverage_drop mesin gate PR 4).
 *  3. approval — bukti keputusan pemilik yang eksplisit: approved=true,
 *     approved_by terisi, approved_at_utc timestamp valid, dan
 *     candidate_content_hash yang sama dengan kandidat. Tanpa ini
 *     promosi tidak diizinkan — gerbang tidak menebak persetujuan.
 *  4. parity — ringkasan paritas lab/produksi WAJIB ada (di gerbang
 *     mekanis lama ia hanya warning; di lapisan bukti ini ia syarat).
 *  5. rollback — file rencana rollback harus ada; path + sha256-nya
 *     dicatat pemanggil ke keluaran promosi.
 *
 * Satu saja syarat hilang/korup/tidak cocok → ok=false dengan alasan
 * bernama; pemanggil keluar non-zero dan TIDAK menulis file apa pun.
 * Modul ini murni (JSON masuk → alasan keluar) agar dapat diuji negatif
 * per jalur penolakan.
 */
import type { ModelManifest } from "./model-manifest";
import type { ParitySummary } from "./promotion-gate";

/** Ambang penurunan cakupan maksimum — sama dengan gate PR 4. */
export const PROMOTION_COVERAGE_DROP_TOLERANCE = 0.02;

export interface PromotionEvidenceInput {
  candidate: ModelManifest;
  /** Isi decision.json ter-parse, atau null bila berkas tak terbaca. */
  decision: unknown;
  decisionError?: string;
  /** Isi run-manifest.json ter-parse, atau null bila tak terbaca. */
  runManifest: unknown;
  runManifestError?: string;
  /** Isi berkas persetujuan pemilik ter-parse, atau null. */
  approval: unknown;
  approvalError?: string;
  parity: ParitySummary | null;
  /** Rencana rollback: path + sha256 isi, atau null bila absen. */
  rollbackPlan: { path: string; sha256: string } | null;
  rollbackError?: string;
}

export interface PromotionEvidenceResult {
  ok: boolean;
  reasons: string[];
  notes: string[];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export function validatePromotionEvidence(
  input: PromotionEvidenceInput,
): PromotionEvidenceResult {
  const reasons: string[] = [];
  const notes: string[] = [];
  const cand = input.candidate;

  // --- 1. decision eksperimen -------------------------------------------
  const decision = asRecord(input.decision);
  if (!decision) {
    reasons.push(
      `decision_missing: berkas decision eksperimen tidak ada/tidak terbaca${input.decisionError ? ` (${input.decisionError})` : ""} — promosi fail-closed`,
    );
  } else {
    const word = decision.decision;
    if (word !== "promote" && word !== "eligible_for_shadow") {
      reasons.push(
        `decision_not_pass: keputusan gate eksperimen = ${JSON.stringify(word)} — hanya "promote"/"eligible_for_shadow" yang boleh lanjut promosi`,
      );
    }
    const checks = decision.gate_checks;
    if (!Array.isArray(checks) || checks.length === 0) {
      reasons.push(
        "decision_gate_checks_missing: decision tidak memuat gate_checks — outcome gate tidak dapat diverifikasi",
      );
    } else {
      for (const c of checks) {
        const rec = asRecord(c);
        if (!rec || rec.pass !== true) {
          reasons.push(
            `decision_gate_check_failed: gate check ${JSON.stringify(rec?.id ?? "?")} tidak pass`,
          );
        }
      }
    }
    const headline = asRecord(decision.headline);
    if (!headline || typeof headline.coverage_candidate !== "number") {
      reasons.push(
        "decision_coverage_missing: headline decision tidak memuat coverage_candidate numerik",
      );
    }
  }

  // --- 2. run-manifest mengikat kandidat ---------------------------------
  const runManifest = asRecord(input.runManifest);
  if (!runManifest) {
    reasons.push(
      `run_manifest_missing: berkas run-manifest tidak ada/tidak terbaca${input.runManifestError ? ` (${input.runManifestError})` : ""} — promosi fail-closed`,
    );
  } else {
    const promo = asRecord(runManifest.promotion);
    if (!promo) {
      reasons.push(
        "run_manifest_promotion_block_missing: run-manifest tidak memuat blok promotion (hash kandidat + input + cakupan)",
      );
    } else {
      if (promo.candidate_content_hash !== cand.contentHash) {
        reasons.push(
          `run_manifest_candidate_hash_mismatch: promotion.candidate_content_hash=${JSON.stringify(promo.candidate_content_hash)} ≠ manifest kandidat ${cand.contentHash}`,
        );
      }
      if (promo.candidate_ratings_hash !== cand.ratingsHash) {
        reasons.push(
          `run_manifest_ratings_hash_mismatch: promotion.candidate_ratings_hash=${JSON.stringify(promo.candidate_ratings_hash)} ≠ manifest kandidat ${cand.ratingsHash}`,
        );
      }
      if (promo.candidate_model_version !== cand.modelVersion) {
        reasons.push(
          `run_manifest_model_version_mismatch: promotion.candidate_model_version=${JSON.stringify(promo.candidate_model_version)} ≠ ${cand.modelVersion}`,
        );
      }
      const inputs = asRecord(promo.input_hashes);
      const inputEntries = inputs ? Object.entries(inputs) : [];
      if (
        !inputs ||
        inputEntries.length === 0 ||
        inputEntries.some(
          ([, v]) => typeof v !== "string" || !v.startsWith("sha256:"),
        )
      ) {
        reasons.push(
          "run_manifest_input_hashes_missing: promotion.input_hashes harus memuat ≥1 hash input format sha256:",
        );
      }
      const coverage = asRecord(promo.coverage);
      if (
        !coverage ||
        typeof coverage.candidate !== "number" ||
        typeof coverage.champion !== "number"
      ) {
        reasons.push(
          "run_manifest_coverage_missing: promotion.coverage {candidate, champion} numerik wajib ada",
        );
      } else if (
        coverage.champion - coverage.candidate >
        PROMOTION_COVERAGE_DROP_TOLERANCE
      ) {
        reasons.push(
          `run_manifest_coverage_drop: cakupan kandidat ${coverage.candidate} turun > ${PROMOTION_COVERAGE_DROP_TOLERANCE} dari champion ${coverage.champion}`,
        );
      }
    }
  }

  // --- 3. persetujuan pemilik eksplisit -----------------------------------
  const approval = asRecord(input.approval);
  if (!approval) {
    reasons.push(
      `owner_approval_missing: bukti persetujuan pemilik tidak ada/tidak terbaca${input.approvalError ? ` (${input.approvalError})` : ""} — promosi butuh keputusan pemilik eksplisit`,
    );
  } else {
    if (approval.approved !== true) {
      reasons.push("owner_approval_not_granted: approval.approved bukan true");
    }
    if (typeof approval.approved_by !== "string" || approval.approved_by.trim() === "") {
      reasons.push("owner_approval_by_missing: approval.approved_by kosong");
    }
    const at = approval.approved_at_utc;
    if (typeof at !== "string" || !Number.isFinite(Date.parse(at))) {
      reasons.push(
        "owner_approval_timestamp_invalid: approval.approved_at_utc bukan timestamp valid",
      );
    }
    if (approval.candidate_content_hash !== cand.contentHash) {
      reasons.push(
        `owner_approval_hash_mismatch: approval.candidate_content_hash=${JSON.stringify(approval.candidate_content_hash)} ≠ manifest kandidat ${cand.contentHash} — persetujuan harus menyebut kandidat yang sama`,
      );
    }
  }

  // --- 4. paritas wajib ----------------------------------------------------
  if (!input.parity) {
    reasons.push(
      "parity_missing: ringkasan paritas lab/produksi wajib disertakan untuk promosi (fail-closed)",
    );
  }

  // --- 5. rencana rollback ---------------------------------------------------
  if (!input.rollbackPlan) {
    reasons.push(
      `rollback_plan_missing: file rencana rollback tidak ada/tidak terbaca${input.rollbackError ? ` (${input.rollbackError})` : ""} — promosi tanpa rencana rollback dilarang`,
    );
  } else {
    notes.push(
      `rollback_plan: ${input.rollbackPlan.path} sha256=${input.rollbackPlan.sha256}`,
    );
  }

  if (reasons.length === 0) {
    notes.push("promotion_evidence_ok: seluruh bukti promosi cocok dengan manifest kandidat");
  }
  return { ok: reasons.length === 0, reasons, notes };
}
