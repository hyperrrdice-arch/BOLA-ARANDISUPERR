/**
 * RUNNER PARITAS JALUR PRODUKSI (K4, suite test-model).
 *
 * Dijalankan sebagai subprocess dengan cwd = sandbox fixture. Membangun
 * intel minimal per sampel (mensimulasikan keluaran fetcher produksi:
 * form_split dinyatakan eksplisit di sampel sebagai `form`), lalu memanggil
 * buildQuantPackage dari lib/agent/planner — fungsi produksi yang sama
 * yang dipakai scripts/pick-slate.ts — dan menulis probabilitas 1X2
 * dcOutput ke file --out.
 *
 * Pakai: tsx tests/helpers/predict-runner.ts --samples=<file> --out=<file>
 * Env placeholder NineRouter wajib terisi agar impor planner tidak throw
 * (buildQuantPackage sendiri murni kuant — tidak ada panggilan LLM).
 */
import fs from "node:fs";
import { buildCoreSchemas } from "./fixture-env";
import { getTheStatsDb } from "../../lib/db/thestats-dataset";
import type { VerifiedMatchIntelligence } from "../../lib/stats-validator";

interface RunnerSample {
  id: string;
  homeTeam: string;
  awayTeam: string;
  leagueHint?: string;
  decisionAt: string;
  form: {
    homeGoalsAvg: number | null;
    awayGoalsAvg: number | null;
    homeSampleN: number;
    awaySampleN: number;
  };
}

function argValue(flag: string): string | null {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
}

async function main(): Promise<void> {
  const samplesPath = argValue("--samples");
  const outPath = argValue("--out");
  if (!samplesPath || !outPath) {
    console.error("predict-runner: --samples dan --out wajib diisi.");
    process.exit(1);
  }
  const parsed = JSON.parse(fs.readFileSync(samplesPath, "utf8")) as
    | RunnerSample[]
    | { samples: RunnerSample[] };
  const samples = Array.isArray(parsed) ? parsed : parsed.samples;

  await buildCoreSchemas();
  // Scaffolding fixture: tabel telemetri kanonik dibangun di produksi oleh
  // scripts/build-canonical-telemetry.ts; sandbox mewakilkan deployment
  // yang barisnya belum ada (telemetri kosong → jalur macro-prior).
  getTheStatsDb().exec(`
    CREATE TABLE IF NOT EXISTS team_match_logs_canonical (
      log_id TEXT, match_id TEXT, team_id TEXT, opponent_id TEXT,
      canonical_team_id TEXT, canonical_opponent_id TEXT,
      venue TEXT, match_date TEXT, season TEXT, result TEXT,
      goals_for INTEGER, goals_against INTEGER,
      xg_for REAL, xg_against REAL, npxg_for REAL, npxg_against REAL
    );
  `);
  const { buildQuantPackage } = await import("../../lib/agent/planner");

  const rows = samples.map((s) => {
    const intel = {
      pertandingan: {
        id: s.id,
        tim_kandang: s.homeTeam,
        tim_tamu: s.awayTeam,
        waktu: s.decisionAt,
        kompetisi: s.leagueHint ?? "",
        venue: "",
        wasit: "",
        kickoff_jam_menuju: 24,
      },
      form_split: {
        home_form_summary: "",
        away_form_summary: "",
        home_form_sample_size: s.form.homeSampleN,
        away_form_sample_size: s.form.awaySampleN,
        home_goals_avg: s.form.homeGoalsAvg,
        away_goals_avg: s.form.awayGoalsAvg,
      },
      market_odds: {
        home_last: null,
        draw_last: null,
        away_last: null,
        total_goals_over_2_5: null,
      },
    } as unknown as VerifiedMatchIntelligence;

    const bundle = buildQuantPackage(intel, s.decisionAt.slice(0, 10));
    return {
      id: s.id,
      homeTeam: s.homeTeam,
      awayTeam: s.awayTeam,
      lambda: bundle.dcOutput.lambda,
      mu: bundle.dcOutput.mu,
      probHome: bundle.dcOutput.prob_home_win,
      probDraw: bundle.dcOutput.prob_draw,
      probAway: bundle.dcOutput.prob_away_win,
    };
  });

  fs.writeFileSync(outPath, `${JSON.stringify({ rows }, null, 2)}\n`);
  console.log(`predict-runner: ${rows.length} baris → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
