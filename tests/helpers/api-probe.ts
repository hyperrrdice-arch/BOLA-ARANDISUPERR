/**
 * API PROBE — uji kontrak HTTP Fix-6 (butir 6 §2).
 *
 * Dijalankan sebagai subprocess dengan cwd = sandbox fixture (pola
 * fixture-env): skema dibangun oleh kode repo, upstream DIGANTIKAN stub
 * globalThis.fetch per skenario, lalu handler route dipanggil langsung
 * dengan Request sungguhan. Satu proses per skenario supaya cache
 * in-module (stats-cache, 1xbet) tidak bocor antar-skenario.
 *
 * Keluaran: satu baris `PROBE_JSON{...}` berisi { status, headers, body }.
 * Skenario: lihat tests/test-api-contract.ts.
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { buildCoreSchemas } from "./fixture-env";

const scenario = process.argv[2];
if (!scenario) throw new Error("argumen skenario wajib");

// ---------------------------------------------------------------------------
// Stub upstream. Host stats: api.thestatsapi.com; host 1xBet dari env
// RAPIDAPI_1XBET_HOST; host router LLM: router.fixture.invalid.
// ---------------------------------------------------------------------------

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const kickoffSoon = new Date(Date.now() + 2 * 3600_000).toISOString();
const STATS_MATCH = {
  id: "sm_probe_1",
  utc_date: kickoffSoon,
  competition_id: 8,
  competition_name: "Premier League",
  home_team: { id: "t1", name: "Arsenal" },
  away_team: { id: "t2", name: "Chelsea" },
  venue: null,
  is_neutral: false,
  odds_available: true,
  xg_available: false,
  shotmap_available: false,
};
const BOOKMAKER = {
  name: "Pinnacle",
  markets: {
    match_odds: {
      home: { opening: 2.0, last_seen: 2.1 },
      draw: { opening: 3.4, last_seen: 3.3 },
      away: { opening: 3.6, last_seen: 3.8 },
    },
    total_goals: {
      over_2_5: { opening: 1.9, last_seen: 1.95 },
      under_2_5: { opening: 1.9, last_seen: 1.85 },
    },
  },
};
const XBET_MARKET = { market_id: 1, name: "1X2", base: null, odds: { home: 2.1, draw: 3.3, away: 3.8 } };

function statsResponse(url: string): Response {
  switch (scenario) {
    case "m-authdead":
      return jsonRes(401, { error: { code: "KEY_REVOKED", message: "key revoked" } });
    case "m-500":
    case "o-upstream-error":
    case "a-fail":
      return jsonRes(500, { error: { code: "REQUEST_FAILED", message: "upstream boom" } });
    case "m-empty":
      return jsonRes(200, { data: [] });
    case "o-upstream-empty":
      return jsonRes(200, { data: { bookmakers: [] } });
    case "o-ok":
      return jsonRes(200, { data: { bookmakers: [BOOKMAKER] } });
    case "m-ok":
      if (url.includes("/football/competitions")) {
        return jsonRes(200, { data: [{ id: 8, name: "Premier League", country: "England" }] });
      }
      return jsonRes(200, { data: [STATS_MATCH] });
    default:
      return jsonRes(200, { data: [] });
  }
}

function xbetResponse(): Response {
  switch (scenario) {
    case "b-get-fail":
      throw new Error("network down");
    case "b-get-ok":
    case "b-post-llmfail":
      return jsonRes(200, { data: [XBET_MARKET] });
    case "b-post-empty":
      return jsonRes(200, { data: [] });
    case "b-post-notfound":
      return jsonRes(200, { data: [] }); // leagues kosong → find1xBetMatch null
    default:
      return jsonRes(200, { data: [] });
  }
}

globalThis.fetch = (async (input: unknown) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as { url: string }).url;
  if (url.includes("router.fixture.invalid")) {
    throw new Error("router unreachable");
  }
  if (url.includes("api.thestatsapi.com")) return statsResponse(url);
  if (url.includes("fixture.rapidapi.test")) return xbetResponse();
  throw new Error(`fetch tak terduga di probe: ${url}`);
}) as typeof fetch;

// ---------------------------------------------------------------------------
// Skema + seed per skenario (setelah chdir ke sandbox oleh runner).
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
await buildCoreSchemas();
const dataDir = path.join(process.cwd(), "data");

if (scenario === "m-local" || scenario === "m-clamp") {
  const db = new DatabaseSync(path.join(dataDir, "upcoming_fixtures.db"));
  db.prepare(
    `INSERT INTO upcoming_fixtures (match_id, competition_id, competition_name, competition_country, utc_date, status, home_team_id, home_team_name, away_team_id, away_team_name, fetched_utc)
     VALUES ('sm_local_1', '8', 'Premier League', 'England', ?, 'scheduled', 't1', 'Arsenal', 't2', 'Chelsea', ?)`,
  ).run(kickoffSoon, new Date().toISOString());
  db.close();
}
if (scenario === "o-anchor-empty") {
  const db = new DatabaseSync(path.join(dataDir, "thestats_dataset.db"));
  db.prepare(
    `INSERT INTO match_odds_history (match_id, captured_utc, payload_json, has_odds) VALUES ('sm_odds_1', ?, NULL, 0)`,
  ).run(new Date().toISOString());
  db.close();
}
if (scenario === "a-cache") {
  const snap = await import("../../lib/db/analysis-snapshot");
  const db = snap.getSnapshotDb();
  db.prepare(
    `INSERT INTO analysis_snapshots (match_id, captured_utc, cache_key_hint, view_json, is_fallback, is_grounded)
     VALUES ('sm_agent_1', ?, '', ?, 0, 1)`,
  ).run(new Date().toISOString(), JSON.stringify({ analisis: { penanda: "fixture-cache" } }));
}

// ---------------------------------------------------------------------------
// Panggil handler.
// ---------------------------------------------------------------------------

const BASE = "http://fixture.local";
let res: Response;
switch (scenario) {
  case "m-local":
  case "m-authdead":
  case "m-500":
  case "m-ok":
  case "m-empty": {
    const { GET } = await import("../../app/api/matches/route");
    res = await GET(new Request(`${BASE}/api/matches?hours=12`));
    break;
  }
  case "m-clamp": {
    const { GET } = await import("../../app/api/matches/route");
    res = await GET(new Request(`${BASE}/api/matches?hours=999`));
    break;
  }
  case "o-400": {
    const { GET } = await import("../../app/api/odds/route");
    res = await GET(new Request(`${BASE}/api/odds`));
    break;
  }
  case "o-anchor-empty":
  case "o-upstream-error":
  case "o-upstream-empty":
  case "o-ok": {
    const { GET } = await import("../../app/api/odds/route");
    res = await GET(new Request(`${BASE}/api/odds?match_id=sm_odds_1`));
    break;
  }
  case "b-503-get": {
    const { GET } = await import("../../app/api/betting/route");
    res = await GET(new Request(`${BASE}/api/betting?match_id=123`));
    break;
  }
  case "b-503-post": {
    const { POST } = await import("../../app/api/betting/route");
    res = await POST(
      new Request(`${BASE}/api/betting`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ match_id_1xbet: "123" }),
      }),
    );
    break;
  }
  case "b-400-get": {
    const { GET } = await import("../../app/api/betting/route");
    res = await GET(new Request(`${BASE}/api/betting`));
    break;
  }
  case "b-400-post": {
    const { POST } = await import("../../app/api/betting/route");
    res = await POST(
      new Request(`${BASE}/api/betting`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    break;
  }
  case "b-get-ok":
  case "b-get-fail": {
    const { GET } = await import("../../app/api/betting/route");
    res = await GET(new Request(`${BASE}/api/betting?match_id=123`));
    break;
  }
  case "b-post-notfound": {
    const { POST } = await import("../../app/api/betting/route");
    res = await POST(
      new Request(`${BASE}/api/betting`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ home_team: "Arsenal", away_team: "Chelsea" }),
      }),
    );
    break;
  }
  case "b-post-empty":
  case "b-post-llmfail": {
    const { POST } = await import("../../app/api/betting/route");
    res = await POST(
      new Request(`${BASE}/api/betting`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ match_id_1xbet: "123" }),
      }),
    );
    break;
  }
  case "a-400": {
    const { GET } = await import("../../app/api/agent/route");
    res = await GET(new Request(`${BASE}/api/agent`));
    break;
  }
  case "a-cache": {
    const { GET } = await import("../../app/api/agent/route");
    res = await GET(new Request(`${BASE}/api/agent?match_id=sm_agent_1`));
    break;
  }
  case "a-fail": {
    const { GET } = await import("../../app/api/agent/route");
    res = await GET(new Request(`${BASE}/api/agent?match_id=sm_tidakada`));
    break;
  }
  default:
    throw new Error(`skenario tak dikenal: ${scenario}`);
}

const body = await res.json().catch(() => null);
console.log(
  `PROBE_JSON${JSON.stringify({
    status: res.status,
    cacheHeader: res.headers.get("x-analysis-cache"),
    body,
  })}`,
);
}

main().catch((err) => {
  console.error("[api-probe] gagal:", err);
  process.exit(1);
});
