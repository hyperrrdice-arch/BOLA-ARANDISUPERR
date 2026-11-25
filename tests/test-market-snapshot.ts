/**
 * SUITE T02 (Item 20 + Item 3, Sprint C) — MarketSnapshot & API-Football.
 *
 * Yang diverifikasi (kewajiban brief Fase 2):
 *  - Selector menolak quote first_observed > decision_ts (anti-bocor masa
 *    depan), quote berusia > 12 jam (usang), dan quote first_observed
 *    >= kickoff_ts (in-play) — masing-masing dengan alasan abstain eksplisit.
 *  - Append-only: batch baru menambah revisi TANPA mengubah first_observed
 *    quote yang odds-nya sama dan tanpa menyentuh baris historis.
 *  - Properti devig Shin 3-way & dua-arah: jumlah = 1,0 (toleransi 1e-9),
 *    semua probabilitas di (0,1), monoton (odds lebih pendek → prob lebih
 *    besar).
 *  - Parser payload API-Football v3 (mock BENTUK ASLI): entri /odds
 *    TIDAK membawa `teams` — nama tim datang dari payload /fixtures
 *    terpisah dan digabung per fixture.id (jembatan blocker #3). Payload
 *    odds mentah tanpa jembatan menghasilkan 0 quote; entri odds yang
 *    fixture.id-nya tanpa pasangan /fixtures dihitung tak terjembatani.
 *    1X2 + O/U per garis, baris tak lengkap dilewati.
 *  - Rate limiter: <= 9 req/menit (menunggu), anggaran harian melempar,
 *    sisa kuota header di ambang pengaman menghentikan larian.
 *  - Jendela tetap 09:00/18:00 WIB dikenali; di luar itu null.
 */
import { DatabaseSync } from "node:sqlite";
import { Suite } from "./helpers/fixture-env";
import {
  ApiFootballRateLimiter,
  APIFOOTBALL_FREE_PLAN_MAX_PAGE,
  captureWindowForInstant,
  fetchApiFootballFixturesForDate,
  fetchApiFootballOddsForDate,
  fetchApiFootballOddsPage,
  joinApiFootballOddsWithFixtures,
  parseApiFootballFixtures,
  parseApiFootballOdds,
  type AfFixturesPayload,
  type AfOddsPayload,
  type FetchLike,
} from "../lib/feeds/api-football";
import {
  appendMarketSnapshot,
  devig1x2,
  devigTwoWay,
  ensureMarketSnapshotSchema,
  listMarketSnapshots,
  selectMarketQuote,
} from "../lib/market/market-snapshot";

const suite = new Suite("market-snapshot T02 (Item 20+3)");

const KICKOFF = "2026-11-26T13:00:00.000Z";
const DECISION = "2026-11-26T07:00:00.000Z";
const H = 3_600_000;
const shift = (iso: string, ms: number): string =>
  new Date(Date.parse(iso) + ms).toISOString();

function memDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  ensureMarketSnapshotSchema(db);
  return db;
}

async function main(): Promise<void> {
  // --- Devig -----------------------------------------------------------------
  const d3 = devig1x2(1.85, 3.4, 4.2);
  const sum3 = d3.probs.reduce((a, b) => a + b, 0);
  suite.check("devig shin: jumlah = 1,0 (1e-9)", Math.abs(sum3 - 1) <= 1e-9, `sum=${sum3}`);
  suite.check("devig shin: semua di (0,1)", d3.probs.every((p) => p > 0 && p < 1));
  suite.check("devig shin: monoton (1,85 < 3,40 < 4,20 → p menurun)",
    d3.probs[0] > d3.probs[1] && d3.probs[1] > d3.probs[2]);
  const d3eq = devig1x2(2.9, 3.1, 3.1);
  suite.check("devig shin: odds seri identik → prob identik",
    Math.abs(d3eq.probs[1] - d3eq.probs[2]) <= 1e-12);
  const d2 = devigTwoWay(1.8, 2.0);
  suite.check("devig 2-arah: jumlah = 1,0 (1e-9)", Math.abs(d2.probs[0] + d2.probs[1] - 1) <= 1e-9);
  suite.check("devig 2-arah: monoton", d2.probs[0] > d2.probs[1]);
  const d2eq = devigTwoWay(1.9, 1.9);
  suite.check("devig 2-arah: odds sama → 0,5/0,5",
    Math.abs(d2eq.probs[0] - 0.5) <= 1e-9 && Math.abs(d2eq.probs[1] - 0.5) <= 1e-9);
  let threw = false;
  try { devig1x2(1.0, 3.0, 3.0); } catch { threw = true; }
  suite.check("devig shin: odds <= 1,0 ditolak (fail-fast)", threw);
  threw = false;
  try { devigTwoWay(0.5, 2.0); } catch { threw = true; }
  suite.check("devig 2-arah: odds <= 1,0 ditolak (fail-fast)", threw);

  // --- Parser payload mock (BENTUK ASLI API) -----------------------------------
  // Entri /odds asli: { league, fixture{id, timezone, date, timestamp},
  // update, bookmakers } — TANPA field `teams` (blocker #3). Nama tim
  // hanya ada di payload /fixtures terpisah (fixturesPayload di bawah).
  const payload: AfOddsPayload = {
    paging: { current: 1, total: 2 },
    response: [
      {
        fixture: { id: 1035072, date: KICKOFF },
        bookmakers: [
          {
            id: 8,
            name: "Bet365",
            bets: [
              {
                id: 1,
                name: "Match Winner",
                values: [
                  { value: "Home", odd: "1.85" },
                  { value: "Draw", odd: "3.40" },
                  { value: "Away", odd: "4.20" },
                ],
              },
              {
                id: 5,
                name: "Goals Over/Under",
                values: [
                  { value: "Over 2.5", odd: "1.90" },
                  { value: "Under 2.5", odd: "1.90" },
                  { value: "Over 3.5", odd: "2.60" },
                  { value: "Under 3.5", odd: "1.50" },
                  { value: "Over 4.5", odd: "4.00" }, // tak lengkap → dilewati
                ],
              },
              { id: 4, name: "Asian Handicap", values: [{ value: "Home -1", odd: "2.10" }] },
            ],
          },
          {
            id: 4,
            name: "BookB",
            bets: [
              {
                id: 1,
                name: "Match Winner",
                values: [
                  { value: "Home", odd: "1.87" },
                  { value: "Away", odd: "4.10" }, // tanpa Draw → dilewati
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  // Payload /fixtures bentuk asli: { fixture{id,...}, league,
  // teams{home{id,name}, away{id,name}}, goals, score } per entri.
  const fixturesPayload: AfFixturesPayload = {
    paging: { current: 1, total: 1 },
    results: 1,
    response: [
      {
        fixture: { id: 1035072, date: KICKOFF },
        teams: { home: { id: 42, name: "Arsenal" }, away: { id: 49, name: "Chelsea" } },
      },
    ],
  };
  const teamsById = parseApiFootballFixtures(fixturesPayload);
  suite.eq("fixtures: peta berisi 1 fixture", teamsById.size, 1);
  suite.eq("fixtures: nama tim terbaca dari payload /fixtures",
    teamsById.get(1035072), { home_name: "Arsenal", away_name: "Chelsea" });

  // Payload odds MENTAH (tanpa jembatan) memang menghasilkan 0 quote —
  // inilah cacat blocker #3; parser tidak mengarang nama tim.
  suite.eq("parser: payload odds asli tanpa jembatan → 0 quote",
    parseApiFootballOdds(payload).length, 0);

  const joined = joinApiFootballOddsWithFixtures(payload, teamsById);
  suite.eq("jembatan: 1 entri terjembatani, 0 tanpa pasangan",
    [joined.bridgedEntries, joined.unbridgedEntries], [1, 0]);
  const quotes = parseApiFootballOdds(joined.payload);
  suite.eq("parser: 3 quote utuh (1X2 + O/U 2.5 + O/U 3.5)", quotes.length, 3);
  suite.eq("parser: quote pertama 1X2 Bet365",
    [quotes[0].market, quotes[0].bookmaker, quotes[0].line], ["1x2", "Bet365", null]);
  suite.eq("parser: odds 1X2 terbaca", quotes[0].odds, { home: 1.85, draw: 3.4, away: 4.2 });
  suite.eq("parser: garis O/U terpisah", [quotes[1].line, quotes[2].line], [2.5, 3.5]);
  suite.eq("parser: kickoff + nama tim dari jembatan terbawa",
    [quotes[0].kickoff_utc, quotes[0].home_name, quotes[0].away_name],
    [KICKOFF, "Arsenal", "Chelsea"]);

  // Entri odds yang fixture.id-nya TIDAK ada di peta /fixtures:
  // dihitung tak terjembatani dan tidak masuk payload hasil.
  const payloadOrphan: AfOddsPayload = {
    paging: { current: 1, total: 1 },
    response: [
      ...(payload.response ?? []),
      {
        fixture: { id: 9999999, date: KICKOFF },
        bookmakers: [
          {
            id: 8,
            name: "Bet365",
            bets: [
              {
                id: 1,
                name: "Match Winner",
                values: [
                  { value: "Home", odd: "2.00" },
                  { value: "Draw", odd: "3.10" },
                  { value: "Away", odd: "3.60" },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const joinedOrphan = joinApiFootballOddsWithFixtures(payloadOrphan, teamsById);
  suite.eq("jembatan: entri tanpa pasangan /fixtures dihitung eksplisit",
    [joinedOrphan.bridgedEntries, joinedOrphan.unbridgedEntries], [1, 1]);
  suite.eq("jembatan: quote dari entri yatim tidak bocor ke hasil parse",
    parseApiFootballOdds(joinedOrphan.payload).length, 3);

  // --- Rate limiter --------------------------------------------------------------
  let fakeNow = Date.parse("2026-11-25T00:00:00.000Z");
  const sleeps: number[] = [];
  const lim = new ApiFootballRateLimiter({
    maxPerMinute: 9,
    maxPerDay: 80,
    now: () => fakeNow,
    sleep: async (ms) => { sleeps.push(ms); fakeNow += ms; },
  });
  for (let i = 0; i < 9; i++) await lim.acquire();
  suite.eq("limiter: 9 req pertama tanpa menunggu", sleeps.length, 0);
  await lim.acquire();
  suite.check("limiter: req ke-10 menunggu jendela menit", sleeps.length === 1 && sleeps[0] > 0);
  const limDay = new ApiFootballRateLimiter({
    maxPerMinute: 9, maxPerDay: 3, now: () => fakeNow, sleep: async () => {},
  });
  await limDay.acquire(); await limDay.acquire(); await limDay.acquire();
  threw = false;
  try { await limDay.acquire(); } catch { threw = true; }
  suite.check("limiter: anggaran harian habis → melempar", threw);
  const limQuota = new ApiFootballRateLimiter({
    maxPerMinute: 9, maxPerDay: 80, now: () => fakeNow, sleep: async () => {},
  });
  limQuota.noteRemaining(15);
  threw = false;
  try { await limQuota.acquire(); } catch { threw = true; }
  suite.check("limiter: sisa kuota header <= 20 → berhenti", threw);

  // --- Fetch satu halaman (mock) --------------------------------------------------
  const fetchOk: FetchLike = async () => ({
    ok: true,
    status: 200,
    headers: { get: (n) => (n === "x-ratelimit-requests-remaining" ? "73" : null) },
    json: async () => payload,
  });
  const limFetch = new ApiFootballRateLimiter({
    maxPerMinute: 9, maxPerDay: 80, now: () => fakeNow, sleep: async () => {},
  });
  const page1 = await fetchApiFootballOddsPage(fetchOk, "mock-key", "2026-11-26", 1, limFetch);
  suite.eq("fetch: sisa kuota dari header tercatat", page1.remaining, 73);
  suite.eq("fetch: total halaman dari paging", page1.totalPages, 2);
  suite.eq("fetch: limiter mencatat remaining", limFetch.lastRemaining, 73);
  const fetch500: FetchLike = async () => ({
    ok: false, status: 500, headers: { get: () => null }, json: async () => ({}),
  });
  threw = false;
  try { await fetchApiFootballOddsPage(fetch500, "mock-key", "2026-11-26", 1, limFetch); }
  catch { threw = true; }
  suite.check("fetch: HTTP 500 → melempar", threw);

  // --- Batas paginasi free plan (Page <= 3) ------------------------------------------
  // Transport mock yang berpura-pura punya `totalPages` halaman dan mencatat
  // halaman yang diminta — membuktikan klien TIDAK PERNAH membangun request
  // Page > 3 dan potongan dilaporkan sebagai skipped-due-to-plan-cap.
  const fastLimiter = () =>
    new ApiFootballRateLimiter({
      maxPerMinute: 100, maxPerDay: 80, now: () => fakeNow, sleep: async () => {},
    });
  const mockTransport = (totalPages: number, requested: number[]): FetchLike =>
    async (url) => {
      const page = Number(new URL(url).searchParams.get("page"));
      requested.push(page);
      return {
        ok: true,
        status: 200,
        headers: { get: (n: string) => (n === "x-ratelimit-requests-remaining" ? "90" : null) },
        json: async () => ({ ...payload, paging: { current: page, total: totalPages } }),
      };
    };

  const req7: number[] = [];
  const res7 = await fetchApiFootballOddsForDate(mockTransport(7, req7), "mock-key", "2026-11-26", fastLimiter());
  suite.eq("paginasi: transport 7 halaman → hanya halaman 1..3 yang diminta", req7, [1, 2, 3]);
  suite.check("paginasi: tidak ada request Page > batas free plan",
    req7.every((p) => p <= APIFOOTBALL_FREE_PLAN_MAX_PAGE));
  suite.eq("paginasi: fetchedPages/totalPages terlaporkan", [res7.fetchedPages, res7.totalPages], [3, 7]);
  suite.eq("paginasi: skipped-due-to-plan-cap = 4 halaman", res7.skippedPages, 4);
  suite.check("paginasi: truncated terlaporkan eksplisit", res7.truncated === true);
  const quotes7 = res7.pages.reduce(
    (n, p) => n + parseApiFootballOdds(joinApiFootballOddsWithFixtures(p.payload, teamsById).payload).length,
    0,
  );
  suite.eq("paginasi: hitungan laporan larian hanya dari halaman terambil (3×3 quote)", quotes7, 9);

  const req2: number[] = [];
  const res2 = await fetchApiFootballOddsForDate(mockTransport(2, req2), "mock-key", "2026-11-26", fastLimiter());
  suite.eq("paginasi: transport 2 halaman → semua diambil", req2, [1, 2]);
  suite.check("paginasi: 2 halaman → tidak truncated, skipped 0",
    res2.truncated === false && res2.skippedPages === 0);

  let guardCalls = 0;
  const guardFetch: FetchLike = async () => {
    guardCalls++;
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => payload };
  };
  threw = false;
  try { await fetchApiFootballOddsPage(guardFetch, "mock-key", "2026-11-26", 4, fastLimiter()); }
  catch { threw = true; }
  suite.check("paginasi: Page 4 ditolak klien sebelum request dibangun",
    threw && guardCalls === 0);

  // --- /fixtures: SATU request, TANPA parameter page ------------------------------
  // Endpoint /fixtures menolak field Page (terbukti live 25 Nov 2026:
  // payload errors {"page":"The Page field do not exist."}) — berbeda
  // dari /odds. Klien wajib meminta tepat satu kali tanpa `page=`.
  const fixturesTransport = (totalPages: number, requestedUrls: string[]): FetchLike =>
    async (url) => {
      requestedUrls.push(url);
      return {
        ok: true,
        status: 200,
        headers: { get: (n: string) => (n === "x-ratelimit-requests-remaining" ? "88" : null) },
        json: async () => ({ ...fixturesPayload, paging: { current: 1, total: totalPages } }),
      };
    };
  const fxUrls: string[] = [];
  const resFx1 = await fetchApiFootballFixturesForDate(fixturesTransport(1, fxUrls), "mock-key", "2026-11-26", fastLimiter());
  suite.eq("fixtures: tepat 1 request untuk satu tanggal", fxUrls.length, 1);
  suite.check("fixtures: URL request TANPA parameter page (endpoint menolaknya)",
    !fxUrls[0].includes("page="));
  suite.check("fixtures: envelope 1 halaman → utuh, tidak truncated, peta terbangun",
    resFx1.truncated === false && resFx1.skippedPages === 0 && resFx1.teamsByFixtureId.size === 1);
  const fxUrlsBig: string[] = [];
  const resFxBig = await fetchApiFootballFixturesForDate(fixturesTransport(4, fxUrlsBig), "mock-key", "2026-11-26", fastLimiter());
  suite.eq("fixtures: envelope mengklaim 4 halaman → tetap 1 request, sisa 3 dilaporkan skipped",
    [fxUrlsBig.length, resFxBig.skippedPages, resFxBig.truncated], [1, 3, true]);

  // --- Jalur capture ujung-ke-ujung (transport mock) --------------------------------
  // Router mock: /fixtures → payload fixtures; /odds → payload odds.
  // Menjalankan urutan yang sama dengan skrip capture: ambil peta
  // /fixtures → ambil halaman odds → jembatani → parse → simpan snapshot.
  const routerFetch: FetchLike = async (url) => ({
    ok: true,
    status: 200,
    headers: { get: (n: string) => (n === "x-ratelimit-requests-remaining" ? "85" : null) },
    json: async () =>
      url.includes("/fixtures?")
        ? fixturesPayload
        : { ...payload, paging: { current: 1, total: 1 } },
  });
  const e2eLimiter = fastLimiter();
  const fxFetch = await fetchApiFootballFixturesForDate(routerFetch, "mock-key", "2026-11-26", e2eLimiter);
  const odFetch = await fetchApiFootballOddsForDate(routerFetch, "mock-key", "2026-11-26", e2eLimiter);
  const dbE2e = memDb();
  let e2eQuotes = 0;
  let e2eUnbridged = 0;
  for (const res of odFetch.pages) {
    const j = joinApiFootballOddsWithFixtures(res.payload, fxFetch.teamsByFixtureId);
    e2eUnbridged += j.unbridgedEntries;
    for (const q of parseApiFootballOdds(j.payload)) {
      e2eQuotes++;
      appendMarketSnapshot(dbE2e, {
        fixture_id: "fx_e2e",
        source: "api-football",
        bookmaker: q.bookmaker,
        market: q.market,
        line: q.line,
        odds_raw: q.odds,
        captured_at: "2026-11-25T02:00:00.000Z",
      });
    }
  }
  suite.eq("e2e capture: 3 quote terparse dari transport mock", e2eQuotes, 3);
  suite.eq("e2e capture: 0 entri tanpa pasangan /fixtures", e2eUnbridged, 0);
  const snap1x2 = listMarketSnapshots(dbE2e, "fx_e2e", "1x2", null);
  suite.eq("e2e capture: snapshot 1X2 tersimpan", snap1x2.length, 1);
  const snapSum = Object.values(snap1x2[0].devig_probs).reduce((a, b) => a + b, 0);
  suite.check("e2e capture: devig snapshot 1X2 berjumlah 1,0 (1e-9)", Math.abs(snapSum - 1) <= 1e-9);
  suite.eq("e2e capture: snapshot O/U 2.5 + 3.5 tersimpan",
    listMarketSnapshots(dbE2e, "fx_e2e", "ou", 2.5).length +
      listMarketSnapshots(dbE2e, "fx_e2e", "ou", 3.5).length, 2);

  // --- Jendela tetap ---------------------------------------------------------------
  suite.eq("jendela: 02:30 UTC = 09:30 WIB → 09:00",
    captureWindowForInstant("2026-11-25T02:30:00.000Z")?.window, "09:00");
  suite.eq("jendela: 11:00 UTC = 18:00 WIB → 18:00",
    captureWindowForInstant("2026-11-25T11:00:00.000Z")?.window, "18:00");
  suite.eq("jendela: 12:00 WIB → null",
    captureWindowForInstant("2026-11-25T05:00:00.000Z"), null);

  // --- Selector T02 ------------------------------------------------------------------
  const db = memDb();
  const base = {
    source: "api-football" as const,
    bookmaker: "Bet365",
    market: "1x2" as const,
    line: null,
    odds_raw: { home: 1.85, draw: 3.4, away: 4.2 },
  };
  const sel = (fixture: string, decision: string, kickoff = KICKOFF) =>
    selectMarketQuote(db, { fixture_id: fixture, market: "1x2", line: null, decision_ts: decision, kickoff_ts: kickoff });

  suite.eq("selector: tanpa snapshot → no_snapshot", sel("fx_none", DECISION).reason, "no_snapshot");

  appendMarketSnapshot(db, { ...base, fixture_id: "fx_future", captured_at: shift(DECISION, 1 * H), first_observed: shift(DECISION, 1 * H) });
  suite.eq("selector: first_observed > decision → future_quote", sel("fx_future", DECISION).reason, "future_quote");

  appendMarketSnapshot(db, { ...base, fixture_id: "fx_inplay", captured_at: shift(KICKOFF, 0.5 * H), first_observed: shift(KICKOFF, 0.5 * H) });
  suite.eq("selector: first_observed >= kickoff → in_play_quote",
    sel("fx_inplay", shift(KICKOFF, 1 * H)).reason, "in_play_quote");

  appendMarketSnapshot(db, { ...base, fixture_id: "fx_stale", captured_at: shift(DECISION, -13 * H), first_observed: shift(DECISION, -13 * H) });
  suite.eq("selector: usia 13 jam → stale_quote", sel("fx_stale", DECISION).reason, "stale_quote");

  appendMarketSnapshot(db, { ...base, fixture_id: "fx_ok", captured_at: shift(DECISION, -2 * H), first_observed: shift(DECISION, -2 * H) });
  const okSel = sel("fx_ok", DECISION);
  suite.check("selector: quote sah terpilih", okSel.quote !== null && okSel.reason === null);
  suite.eq("selector: usia quote = 2 jam", okSel.age_ms, 2 * H);
  const devigSum = Object.values(okSel.quote!.devig_probs).reduce((a, b) => a + b, 0);
  suite.check("selector: devig tersimpan berjumlah 1,0 (1e-9)", Math.abs(devigSum - 1) <= 1e-9);

  // Dua observasi sah: yang terbaru sebelum decision yang dipilih.
  appendMarketSnapshot(db, { ...base, fixture_id: "fx_two", odds_raw: { home: 2.0, draw: 3.2, away: 3.6 }, captured_at: shift(DECISION, -11 * H), first_observed: shift(DECISION, -11 * H) });
  appendMarketSnapshot(db, { ...base, fixture_id: "fx_two", odds_raw: { home: 1.8, draw: 3.4, away: 4.4 }, captured_at: shift(DECISION, -1 * H), first_observed: shift(DECISION, -1 * H) });
  const twoSel = sel("fx_two", DECISION);
  suite.eq("selector: observasi terakhir sebelum decision dipilih",
    twoSel.quote?.odds_raw, { home: 1.8, draw: 3.4, away: 4.4 });

  // --- Append-only + first_observed diteruskan ---------------------------------------
  const db2 = memDb();
  const t0 = shift(DECISION, -5 * H);
  const t1 = shift(DECISION, -3 * H);
  const t2 = shift(DECISION, -1 * H);
  const r1 = appendMarketSnapshot(db2, { ...base, fixture_id: "fx_ao", captured_at: t0 });
  suite.eq("append: revisi pertama = 1, first_observed = t0", [r1.revision, r1.first_observed], [1, t0]);
  const r2 = appendMarketSnapshot(db2, { ...base, fixture_id: "fx_ao", captured_at: t1 });
  suite.eq("append: odds sama → revisi 2, first_observed TETAP t0", [r2.revision, r2.first_observed], [2, t0]);
  const r3 = appendMarketSnapshot(db2, { ...base, fixture_id: "fx_ao", odds_raw: { home: 1.8, draw: 3.4, away: 4.4 }, captured_at: t2 });
  suite.eq("append: odds berubah → revisi 3, first_observed baru t2", [r3.revision, r3.first_observed], [3, t2]);
  const all = listMarketSnapshots(db2, "fx_ao", "1x2", null);
  suite.eq("append: 3 baris historis utuh", all.length, 3);
  suite.check("append: baris pertama tidak berubah (captured t0, odds asal)",
    all[0].captured_at === t0 && all[0].odds_raw.home === 1.85 && all[0].revision === 1);

  // --- Label sumber terpisah ------------------------------------------------------------
  appendMarketSnapshot(db2, { ...base, fixture_id: "fx_ao", source: "1xbet", bookmaker: "1xBet", captured_at: t2 });
  const onlyAf = selectMarketQuote(db2, {
    fixture_id: "fx_ao", market: "1x2", line: null,
    decision_ts: DECISION, kickoff_ts: KICKOFF, source: "api-football",
  });
  suite.eq("sumber: filter api-football tidak mengambil baris 1xbet",
    onlyAf.quote?.source, "api-football");

  suite.finish();
}

main().catch((e) => {
  console.error("GAGAL BESAR:", e);
  process.exit(1);
});
