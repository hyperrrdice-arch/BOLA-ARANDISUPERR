/**
 * TEST:QUANT — suite kuantitatif K0.
 *
 * Tiga bagian:
 *  A. Kontrak vig-stripping (pengganti maksud test-quant-scale.ts lama
 *     bagian [3] + test-value-bets.ts lama): odds invalid fail-fast,
 *     probabilitas fair berjumlah ~1. Modul lib/quant/vig-stripping.ts
 *     masih dipakai jalur produksi (jangkar pasar), jadi kontraknya hidup.
 *  B. Suite warisan scripts/quant-correctness-tests.ts dijalankan apa
 *     adanya sebagai subprocess di sandbox fixture (dataset sm:8 mini
 *     untuk Temuan 5 point-in-time). Jumlah baris OK dihitung — suite
 *     tidak boleh "lolos" dengan nol assertion.
 *  C. scripts/pick-engine-acceptance.ts di sandbox output: dua paket
 *     fixture dibaca dari tasks/ sandbox dan hasilnya ditulis ke tasks/
 *     sandbox (checkout tidak tersentuh). Pemeriksaan toleransi skrip itu
 *     selama ini hanya mencetak peringatan — di sini output JSON-nya
 *     dinilai dan pelanggaran toleransi = exit gagal.
 *
 * Pakai: npm run test:quant
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  stripVigProportional,
  stripVigShin,
  stripVigTwoWay,
} from "../lib/quant/vig-stripping";
import {
  REPO_ROOT,
  Suite,
  buildCoreSchemas,
  createFixtureEnv,
  runScript,
  seedDatasetTeams,
  settleFixtureEnv,
} from "./helpers/fixture-env";
import { D01_TEAMS } from "./helpers/scenarios";

async function main(): Promise<void> {
  const suite = new Suite("test:quant");
  const approx = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

  // ---------------------------------------------------------------------------
  // A. Vig-stripping
  // ---------------------------------------------------------------------------
  console.log("A. kontrak vig-stripping");
  {
    const prop = stripVigProportional(2.1, 3.4, 3.6);
    const propSum = prop.fair_prob.home + prop.fair_prob.draw + prop.fair_prob.away;
    suite.check("proporsional: fair_prob berjumlah ~1", approx(propSum, 1, 0.002), `sum=${propSum}`);
    suite.check("proporsional: overround sesuai 1/odds", approx(prop.overround, 1.0481, 0.001), `overround=${prop.overround}`);

    const shin = stripVigShin(2.1, 3.4, 3.6);
    const shinSum = shin.fair_prob.home + shin.fair_prob.draw + shin.fair_prob.away;
    suite.check("shin: fair_prob berjumlah ~1", approx(shinSum, 1, 0.002), `sum=${shinSum}`);
    suite.check(
      "shin: semua fair_prob di (0,1) + method tercatat",
      [shin.fair_prob.home, shin.fair_prob.draw, shin.fair_prob.away].every((p) => p > 0 && p < 1) &&
        shin.method_used === "shin",
    );

    const two = stripVigTwoWay(1.9, 1.9);
    suite.check(
      "dua-arah simetris: fair 0,5 / 0,5",
      approx(two.fair_prob.optionA, 0.5, 0.001) && approx(two.fair_prob.optionB, 0.5, 0.001),
    );

    const throws = (fn: () => unknown): boolean => {
      try {
        fn();
        return false;
      } catch {
        return true;
      }
    };
    suite.check("proporsional: odds = 1,0 throw (bukan probabilitas karangan)", throws(() => stripVigProportional(1.0, 3.4, 3.6)));
    suite.check("proporsional: odds NaN throw", throws(() => stripVigProportional(Number.NaN, 3.4, 3.6)));
    suite.check("shin: odds < 1,0 throw", throws(() => stripVigShin(0.95, 3.4, 3.6)));
    suite.check("shin: odds Infinity throw", throws(() => stripVigShin(2.1, Number.POSITIVE_INFINITY, 3.6)));
  }

  // ---------------------------------------------------------------------------
  // B. quant-correctness-tests.ts di sandbox (dataset fixture sm:8)
  // ---------------------------------------------------------------------------
  console.log("B. quant-correctness-tests.ts (subprocess, sandbox)");
  {
    const env = createFixtureEnv("quant");
    process.chdir(env.root);
    await buildCoreSchemas();
    seedDatasetTeams(env, D01_TEAMS);
    const ds = new DatabaseSync(path.join(env.dataDir, "thestats_dataset.db"));
    const ins = ds.prepare(
      `INSERT INTO matches (match_id, competition_id, season, utc_date, status,
         home_team_id, away_team_id, home_score, away_score, referee_name, updated_at)
       VALUES (?, 'sm:8', '2024-2025', ?, 'finished', ?, ?, ?, ?, NULL, '2025-01-01T00:00:00.000Z')`,
    );
    // 3 laga sebelum cutoff 2025-06-01 (rerata per-laga 1,5 / 0,5 / 2,0) dan
    // 2 laga sesudahnya (3,0 / 3,0): rerata point-in-time (1,333) HARUS beda
    // dari rerata seluruh dataset (2,0) — itu assertion kebocoran Temuan 5.
    const rows: [string, string, string, string, number, number][] = [
      ["sm8_f1", "2025-01-10T15:00:00.000Z", "tm_alpha", "tm_beta", 2, 1],
      ["sm8_f2", "2025-02-10T15:00:00.000Z", "tm_gamma", "tm_delta", 1, 0],
      ["sm8_f3", "2025-03-10T15:00:00.000Z", "tm_beta", "tm_gamma", 3, 1],
      ["sm8_f4", "2025-08-10T15:00:00.000Z", "tm_alpha", "tm_gamma", 4, 2],
      ["sm8_f5", "2025-09-10T15:00:00.000Z", "tm_delta", "tm_beta", 3, 3],
    ];
    for (const r of rows) ins.run(...r);
    ds.close();

    const res = runScript(env, "scripts/quant-correctness-tests.ts");
    const okCount = res.stdout.split("\n").filter((l) => /^\s+OK\s/.test(l)).length;
    const failCount = res.stdout.split("\n").filter((l) => /^\s+FAIL/.test(l)).length;
    console.log(res.stdout.trimEnd());
    if (res.code !== 0) console.log(res.stderr.trimEnd());
    suite.check("quant-correctness: exit 0", res.code === 0, `exit=${res.code}`);
    suite.check("quant-correctness: nol FAIL", failCount === 0, `fail=${failCount}`);
    suite.check(
      "quant-correctness: jumlah assertion substantif (>= 30, anti lolos-kosong)",
      okCount >= 30,
      `ok=${okCount}`,
    );
    settleFixtureEnv(env, res.code !== 0 || failCount > 0);
  }

  // ---------------------------------------------------------------------------
  // C. pick-engine-acceptance.ts di sandbox output
  // ---------------------------------------------------------------------------
  console.log("C. pick-engine-acceptance.ts (subprocess, sandbox output)");
  {
    const env = createFixtureEnv("pick-engine");
    for (const f of ["e2e-run-1-package.json", "e2e-cup-package-live.json"]) {
      fs.copyFileSync(path.join(REPO_ROOT, "tasks", f), path.join(env.tasksDir, f));
    }
    const res = runScript(env, "scripts/pick-engine-acceptance.ts");
    suite.check("pick-engine: exit 0", res.code === 0, `exit=${res.code} ${res.stderr.slice(0, 200)}`);
    const outPath = path.join(env.tasksDir, "pick-engine-acceptance.json");
    suite.check("pick-engine: artefak tertulis di sandbox (bukan checkout)", fs.existsSync(outPath));
    if (fs.existsSync(outPath)) {
      interface AccOut {
        fixtures: {
          fixture: string;
          reproduction_all_within_tolerance: boolean;
          legs: { market: string; selection: string; grade: string }[];
        }[];
        fenerbahce_same_match_combo: { joint_exact: number };
      }
      const out = JSON.parse(fs.readFileSync(outPath, "utf8")) as AccOut;
      suite.eq("pick-engine: tepat 2 fixture dinilai", out.fixtures.length, 2);
      for (const f of out.fixtures) {
        suite.check(
          `pick-engine: reproduksi ${f.fixture} semua dalam toleransi`,
          f.reproduction_all_within_tolerance === true,
        );
        suite.check(`pick-engine: ${f.fixture} menerbitkan legs`, f.legs.length > 0, `legs=${f.legs.length}`);
      }
      const fener = out.fixtures[1];
      const btts = fener.legs.find((l) => l.market === "btts" && l.selection === "yes");
      const ou25 = fener.legs.find((l) => l.market === "ou25" && l.selection === "over");
      suite.check(
        "pick-engine: kasus wajib Fenerbahçe BTTS terbit grade C (cap gerbang)",
        btts !== undefined && btts.grade === "C",
        `btts=${JSON.stringify(btts)}`,
      );
      suite.check(
        "pick-engine: kasus wajib Fenerbahçe OU2.5 terbit grade C (cap gerbang)",
        ou25 !== undefined && ou25.grade === "C",
        `ou25=${JSON.stringify(ou25)}`,
      );
      suite.check(
        "pick-engine: kombo satu laga eksak terhitung (0 < joint < 1)",
        out.fenerbahce_same_match_combo.joint_exact > 0 &&
          out.fenerbahce_same_match_combo.joint_exact < 1,
      );
    }
    settleFixtureEnv(env, suite.failedCount > 0);
  }
    suite.finish();
  }

  main().catch((e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    process.exit(1);
  });
