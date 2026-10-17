/**
 * Runnable check Phase 1 — loop planner dengan MOCK tools.
 * Yang diuji: loop berhenti di stop_with_verdict dalam batas maxSteps, dan
 * input verdict lolos VerdictInputSchema. Model planner TETAP asli
 * (bai/mimo-v2.6-pro via 9Router lokal); hanya tool-nya yang dimock.
 *
 * Jalankan: npx tsx scripts/test-planner-loop.ts
 */

import { z } from "zod";
import { tool, type ToolSet } from "ai";
import fs from "fs";
import path from "path";
import { VerdictInputSchema, type VerdictInput } from "../lib/agent/schemas";

// Load .env.local sebelum module lib yang butuh env di-import (dynamic import di main)
const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.trim().match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2].trim();
    }
  }
}

function assert(kondisi: boolean, label: string): void {
  if (kondisi) {
    console.log(`  ✅ ${label}`);
  } else {
    console.error(`  ❌ ${label}`);
    process.exitCode = 1;
    throw new Error(`Assert gagal: ${label}`);
  }
}

async function main() {
  console.log("=== TEST PLANNER LOOP (mock tools) ===\n");

  const { runPlannerLoop, PLANNER_SYSTEM_PROMPT } = await import("../lib/agent/planner");

  const dipanggil: string[] = [];
  let verdictDiterima: VerdictInput | null = null;

  const StepInput = z.object({ alasan: z.string().optional(), trigger: z.string().optional() });

  const mockTools: ToolSet = {
    check_data_integrity: tool({
      description: "Ambil & validasi data intelijen match. WAJIB dipanggil pertama.",
      inputSchema: StepInput,
      execute: async (input) => {
        dipanggil.push("check_data_integrity");
        return {
          pertandingan: { tim_kandang: "Mock United", tim_tamu: "Test City" },
          coverage: { odds: true, lineups: false, form_samples: 6 },
          missing_data_registry: ["lineups"],
        };
      },
    }),
    fetch_missing_intel: tool({
      description: "Ambil ulang data ketika field penting kosong.",
      inputSchema: StepInput,
      execute: async (input) => {
        dipanggil.push("fetch_missing_intel");
        return { missing_sebelum: ["lineups"], missing_sesudah: ["lineups"], masih_kosong: ["lineups"] };
      },
    }),
    run_quant_package: tool({
      description: "Jalankan quant engine deterministik.",
      inputSchema: StepInput,
      execute: async (input) => {
        dipanggil.push("run_quant_package");
        return {
          dixon_coles: { prob_home_win: 0.48, prob_draw: 0.27, prob_away_win: 0.25 },
          value_bets: [],
        };
      },
    }),
    run_syndicate_debate: tool({
      description: "Jalankan debat 5 persona multi-model.",
      inputSchema: StepInput,
      execute: async (input) => {
        dipanggil.push("run_syndicate_debate");
        return { consensus_level: "CONCURRING", final_confidence_tier: "B_MODERATE" };
      },
    }),
    run_editorial_analysis: tool({
      description: "Susun analisis editorial terstruktur.",
      inputSchema: StepInput,
      execute: async (input) => {
        dipanggil.push("run_editorial_analysis");
        return { kunci_output: ["wasit_analisis", "prediksi"] };
      },
    }),
    stop_with_verdict: tool({
      description: "Akhiri analisis dengan sintesis final. WAJIB dipanggil paling akhir.",
      inputSchema: VerdictInputSchema,
      execute: async (input) => {
        dipanggil.push("stop_with_verdict");
        verdictDiterima = VerdictInputSchema.parse(input);
        return { ok: true, catatan: "Verdict diterima. Analisis selesai." };
      },
    }),
  };

  const { stepCount } = await runPlannerLoop({
    tools: mockTools,
    systemPrompt: PLANNER_SYSTEM_PROMPT,
    userPrompt:
      'Analisis pra-laga untuk match_id "mock-1" (Mock United vs Test City).\n' +
      "Rencanakan analisis, eksekusi tool yang diperlukan, lalu tutup dengan stop_with_verdict.",
    maxSteps: 8,
  });

  console.log(`\nUrutan tool (${dipanggil.length} panggilan, ${stepCount} step):`);
  console.log(`  ${dipanggil.join(" -> ")}`);

  assert(dipanggil.includes("check_data_integrity"), "check_data_integrity dipanggil");
  assert(dipanggil.includes("run_quant_package"), "run_quant_package dipanggil");
  assert(dipanggil[dipanggil.length - 1] === "stop_with_verdict", "stop_with_verdict adalah panggilan terakhir");
  assert(verdictDiterima !== null, "verdict lolos VerdictInputSchema");
  assert(stepCount <= 8, `stepCount ${stepCount} <= 8`);

  // Self-check coverage evaluator (code-side, tanpa LLM)
  const { createRunState } = await import("../lib/agent/planner");
  const { evaluateCoverage } = await import("../lib/agent/coverage");

  const stateKosong = createRunState("mock-1");
  const covKosong = evaluateCoverage(stateKosong);
  assert(covKosong.is_complete === false, "coverage state kosong = belum lengkap");
  assert(covKosong.gaps.length > 0, "state kosong tercatat sebagai gap");

  const statePenuh = createRunState("mock-1");
  statePenuh.fetchResult = {
    intelligence: { missing_data_registry: [] } as any,
    audit: {} as any,
  };
  statePenuh.quant = { quantPackage: { value_bets: [] } } as any;
  statePenuh.debate = { dual_judgement: { consensus_level: "UNANIMOUS" } } as any;
  statePenuh.editorial = {};
  statePenuh.verdict = verdictDiterima;
  statePenuh.fetchAttempts = 2;
  const covPenuh = evaluateCoverage(statePenuh);
  assert(covPenuh.is_complete === true, "coverage state lengkap = complete");
  assert(covPenuh.replan_triggers.length === 0, "state lengkap tanpa trigger");

  const stateDislokasi = createRunState("mock-1");
  stateDislokasi.quant = {
    quantPackage: {
      value_bets: [{ market_name: "1X2", selection: "Home", expected_value: 0.31, ev_percentage: "+31%" }],
    },
  } as any;
  const covDislokasi = evaluateCoverage(stateDislokasi);
  assert(
    covDislokasi.replan_triggers.some((t) => t.startsWith("ODDS_DISLOCATION")),
    "EV > threshold memicu ODDS_DISLOCATION"
  );

  console.log("\n=== SEMUA ASSERT LULUS ===");
}

main().catch((err) => {
  console.error("❌ GAGAL:", err.message);
  process.exit(1);
});
