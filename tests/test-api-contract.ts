/**
 * UJI KONTRAK HTTP — Fix-6 butir 6 §2 (npm run test:api).
 *
 * Empat endpoint publik dipanggil lewat handler aslinya di sandbox
 * fixture, upstream diganti stub (tests/helpers/api-probe.ts):
 *   /api/matches  — store lokal, clamp parameter, upstream mati-auth,
 *                   upstream error, upstream ok, upstream kosong.
 *   /api/odds     — parameter invalid (400), anchor lokal kosong,
 *                   provider gagal, hasil kosong, hasil ok terurai.
 *   /api/agent    — parameter invalid (400), cache snapshot (200 persis),
 *                   provider gagal (500 {error}).
 *   /api/betting  — belum terkonfigurasi (503), parameter invalid (400),
 *                   laga tak ditemukan, pasar kosong, provider gagal
 *                   (500), LLM gagal → degradasi di dalam respons sukses.
 *
 * Yang dikunci adalah STATUS + BENTUK respons — kontrak yang dilihat
 * klien — bukan isi analisis.
 */
import fs from "node:fs";
import path from "node:path";
import {
  REPO_ROOT,
  Suite,
  createFixtureEnv,
  runScript,
  settleFixtureEnv,
} from "./helpers/fixture-env";

const suite = new Suite("test:api-contract (Fix-6)");

const BASE_ENV: Record<string, string> = {
  STATS_API_KEY: "dummy-stats",
  NINE_ROUTER_BASE_URL: "http://router.fixture.invalid/v1",
  NINE_ROUTER_API_KEY: "dummy-router",
  NINE_ROUTER_MODEL: "dummy-model",
};
const XBET_ENV: Record<string, string> = {
  RAPIDAPI_1XBET_HOST: "fixture.rapidapi.test",
  RAPIDAPI_1XBET_KEY: "dummy-xbet",
};
const XBET_OFF: Record<string, string> = {
  RAPIDAPI_1XBET_HOST: "",
  RAPIDAPI_1XBET_KEY: "",
};

interface ProbeOut {
  status: number;
  cacheHeader: string | null;
  body: Record<string, any> | null;
}

function runScenario(
  name: string,
  extraEnv: Record<string, string>,
): ProbeOut | null {
  const env = createFixtureEnv(`api-${name}`);
  // Route app/api/* mengimpor alias "@/..." — tsx memetakannya dari
  // tsconfig di cwd (sandbox), jadi sandbox diberi tsconfig yang
  // menunjuk baseUrl ke root repo sungguhan.
  fs.writeFileSync(
    path.join(env.root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        baseUrl: REPO_ROOT,
        paths: { "@/*": ["./*"] },
      },
    }),
  );
  const res = runScript(env, "tests/helpers/api-probe.ts", [name], {
    ...BASE_ENV,
    ...extraEnv,
  });
  const line = res.stdout.split("\n").find((l) => l.startsWith("PROBE_JSON"));
  settleFixtureEnv(env, !line);
  if (!line) {
    console.log(
      `  [probe ${name}] gagal jalan (exit ${res.code}): ${(res.stderr || res.stdout).slice(-400)}`,
    );
    return null;
  }
  return JSON.parse(line.slice("PROBE_JSON".length)) as ProbeOut;
}

const ONLY = process.env.API_CONTRACT_ONLY;
function skenario(name: string): boolean {
  return !ONLY || ONLY.split(",").includes(name);
}

// ---------------------------------------------------------------- /api/matches
if (skenario("m-local")) {
  const r = runScenario("m-local", {});
  suite.check("matches lokal: status 200", r?.status === 200, `status=${r?.status}`);
  suite.check("matches lokal: offline=true dari store lokal", r?.body?.offline === true);
  suite.eq("matches lokal: total 1", r?.body?.total, 1);
  suite.eq("matches lokal: id laga dari store", r?.body?.matches?.[0]?.id, "sm_local_1");
}
if (skenario("m-clamp")) {
  const r = runScenario("m-clamp", {});
  suite.eq("matches: hours=999 di-clamp ke 48", r?.body?.hours, 48);
}
if (skenario("m-authdead")) {
  const r = runScenario("m-authdead", {});
  suite.check("matches upstream mati-auth: tetap 200 (degradasi jujur)", r?.status === 200, `status=${r?.status}`);
  suite.eq("matches upstream mati-auth: total 0", r?.body?.total, 0);
  suite.check("matches upstream mati-auth: matches [] + offline", Array.isArray(r?.body?.matches) && r?.body?.offline === true);
}
if (skenario("m-500")) {
  const r = runScenario("m-500", {});
  suite.check("matches upstream 500: status 500", r?.status === 500, `status=${r?.status}`);
  suite.check("matches upstream 500: body {error: string}", typeof r?.body?.error === "string");
}
if (skenario("m-ok")) {
  const r = runScenario("m-ok", {});
  suite.check("matches upstream ok: 200 + offline=false", r?.status === 200 && r?.body?.offline === false);
  suite.eq("matches upstream ok: total 1", r?.body?.total, 1);
  suite.eq("matches upstream ok: nama tim terpetakan", r?.body?.matches?.[0]?.home_team?.name, "Arsenal");
}
if (skenario("m-empty")) {
  const r = runScenario("m-empty", {});
  suite.check("matches upstream kosong: 200 total 0", r?.status === 200 && r?.body?.total === 0);
}

// ------------------------------------------------------------------- /api/odds
if (skenario("o-400")) {
  const r = runScenario("o-400", {});
  suite.check("odds tanpa match_id: 400", r?.status === 400, `status=${r?.status}`);
  suite.check("odds tanpa match_id: error menyebut match_id", String(r?.body?.error ?? "").includes("match_id"));
}
if (skenario("o-anchor-empty")) {
  const r = runScenario("o-anchor-empty", {});
  suite.check("odds anchor kosong: 200", r?.status === 200);
  suite.eq("odds anchor kosong: source local_anchor_empty", r?.body?.source, "local_anchor_empty");
  suite.check("odds anchor kosong: is_available=false, bookmakers []", r?.body?.is_available === false && Array.isArray(r?.body?.bookmakers) && r.body.bookmakers.length === 0);
}
if (skenario("o-upstream-error")) {
  const r = runScenario("o-upstream-error", {});
  suite.eq("odds provider gagal: source upstream_error (tetap 200)", r?.body?.source, "upstream_error");
  suite.check("odds provider gagal: is_available=false", r?.body?.is_available === false);
}
if (skenario("o-upstream-empty")) {
  const r = runScenario("o-upstream-empty", {});
  suite.eq("odds upstream kosong: source upstream_empty", r?.body?.source, "upstream_empty");
}
if (skenario("o-ok")) {
  const r = runScenario("o-ok", {});
  suite.check("odds ok: is_available=true", r?.body?.is_available === true);
  suite.eq("odds ok: bookmaker terurai", r?.body?.bookmakers?.[0]?.name, "Pinnacle");
  suite.eq("odds ok: best_odds.home harga upstream", r?.body?.best_odds?.home?.price, 2.1);
}

// ---------------------------------------------------------------- /api/betting
if (skenario("b-503-get")) {
  const r = runScenario("b-503-get", XBET_OFF);
  suite.check("betting GET belum terkonfigurasi: 503", r?.status === 503, `status=${r?.status}`);
  suite.eq("betting GET belum terkonfigurasi: status unavailable", r?.body?.status, "unavailable");
}
if (skenario("b-503-post")) {
  const r = runScenario("b-503-post", XBET_OFF);
  suite.check("betting POST belum terkonfigurasi: 503 unavailable", r?.status === 503 && r?.body?.status === "unavailable");
}
if (skenario("b-400-get")) {
  const r = runScenario("b-400-get", XBET_ENV);
  suite.check("betting GET tanpa parameter: 400 {error}", r?.status === 400 && typeof r?.body?.error === "string");
}
if (skenario("b-400-post")) {
  const r = runScenario("b-400-post", XBET_ENV);
  suite.check("betting POST tanpa tim/id: 400 {error}", r?.status === 400 && typeof r?.body?.error === "string");
}
if (skenario("b-get-ok")) {
  const r = runScenario("b-get-ok", XBET_ENV);
  suite.check("betting GET ok: 200 success", r?.status === 200 && r?.body?.status === "success");
  suite.eq("betting GET ok: 1 pasar terhitung", r?.body?.total_markets_scanned, 1);
}
if (skenario("b-get-fail")) {
  const r = runScenario("b-get-fail", XBET_ENV);
  suite.check("betting GET provider gagal: 500 {error}", r?.status === 500 && typeof r?.body?.error === "string", `status=${r?.status}`);
}
if (skenario("b-post-notfound")) {
  const r = runScenario("b-post-notfound", XBET_ENV);
  suite.check("betting POST laga tak ada di 1xBet: 200 not_found", r?.status === 200 && r?.body?.status === "not_found");
}
if (skenario("b-post-empty")) {
  const r = runScenario("b-post-empty", XBET_ENV);
  suite.check("betting POST pasar kosong: 200 empty", r?.status === 200 && r?.body?.status === "empty");
}
if (skenario("b-post-llmfail")) {
  const r = runScenario("b-post-llmfail", XBET_ENV);
  suite.check("betting POST LLM mati: tetap 200 success (degradasi internal)", r?.status === 200 && r?.body?.status === "success", `status=${r?.status}`);
  suite.check(
    "betting POST LLM mati: kedua model success=false",
    r?.body?.model_a?.result?.success === false && r?.body?.model_b?.result?.success === false,
  );
}

// ------------------------------------------------------------------ /api/agent
if (skenario("a-400")) {
  const r = runScenario("a-400", {});
  suite.check("agent tanpa match_id: 400 {error}", r?.status === 400 && typeof r?.body?.error === "string");
}
if (skenario("a-cache")) {
  const r = runScenario("a-cache", {});
  suite.check("agent cache snapshot: 200", r?.status === 200, `status=${r?.status}`);
  suite.eq("agent cache snapshot: header x-analysis-cache hit", r?.cacheHeader, "hit");
  suite.eq("agent cache snapshot: view tersimpan disajikan persis", r?.body?.analisis?.penanda, "fixture-cache");
}
if (skenario("a-fail")) {
  const r = runScenario("a-fail", {});
  suite.check("agent provider gagal: 500 {error}", r?.status === 500 && typeof r?.body?.error === "string", `status=${r?.status} body=${JSON.stringify(r?.body)?.slice(0, 120)}`);
}

suite.finish();
