/**
 * scripts/pick-slate.ts — Driver slate pick Fase B (safe-bet parlay).
 *
 * Memindai fixture pada jendela waktu (default 48 jam ke depan) dari
 * upcoming_fixtures, menjalankan pipeline analisis offline yang sama dengan
 * scripts/run-one-analysis.ts untuk fixture di kompetisi yang lolos gerbang
 * (calibrated / partial), lalu menerbitkan kaki ter-grade via
 * lib/picks/engine.ts.
 *
 * Output:
 *   - tasks/pick-slate-latest.json  (struktur penuh)
 *   - tasks/pick-slate-latest.md    (ringkasan terbaca)
 *   - store paket data/analysis_snapshots.db: SETIAP fixture ter-rate
 *     ditulis sebagai paket kuant penuh versi baru (trigger 'slate',
 *     lib/picks/packages.ts). Fixture tak ter-rate tidak menulis apa pun;
 *     kegagalan menulis paket = fixture gugur dengan alasan eksplisit
 *     (fail-closed: kaki tanpa rumah provenance tidak diterbitkan).
 *   - ledger data/picks.db: kaki fixture live ditulis dengan source
 *     'live-run' (flag --no-ledger DITOLAK sejak Item 24 — ia tetap
 *     menulis paket resmi tanpa provenance ledger), package_id
 *     menunjuk baris paket asalnya. Fixture yang sudah
 *     pernah dicatat sebagai live-run dilewati (idempoten per match_id di
 *     level driver — skema ledger memang tanpa constraint unik untuk
 *     live-run). market_prob (Shin 1X2 / strip dua-arah OU2.5) dan sm_prob
 *     (panel Sportmonks, persen → 0..1) diisi bila tersedia; agreement_spread
 *     dihitung ledger. Grading TIDAK memakai ambang agreement apa pun —
 *     data agreement dicatat untuk validasi ke depan (lab Fase A tidak
 *     punya bukti historisnya).
 *
 * Fixture yang tidak bisa di-rate TIDAK pernah dibuang diam-diam: semuanya
 * masuk daftar unrated beserta alasannya.
 *
 * Kembar mt_ (Fase 0 R-03): fixture mt_ yang tertaut sebagai kembar katalog
 * di data/fixture-links.json (twin_id → canonical_id) TIDAK di-rate dan
 * TIDAK menulis paket/pick — laga fisiknya diwakili baris kanoniknya.
 * Tanpa saringan ini ledger menerima dua paket + dua set pick per laga
 * (preseden 4–8 Nov: 438 paket / 422 pick mt_). Fixture mt_ TANPA kembar
 * kanonik adalah cakupan sah dan tetap di-rate normal. Kembar yang
 * dilewati tercatat di daftar unrated dengan alasan eksplisit, bukan
 * dibuang diam-diam.
 *
 * Kembar tertaut kelas lain (Lanjut-4): saringan yang sama diperluas ke
 * SEMUA kelas kembar fixture-links (fd_/sm_) — group_key lama berbasis
 * ejaan nama tidak menyatukan alias ("ADO Den Haag" vs "Den Haag"), jadi
 * slate 22 Nov 2026 memuat 14 pasangan tertaut dua kali dan contoh
 * parlay "Alternatif" berisi dua unit dari laga fisik yang sama.
 * Logikanya hidup di lib/picks/slate-identity.ts (sumber yang sama
 * dengan UI): kembar dilewati bila kanoniknya ikut terpindai (kelas mt_
 * tetap tanpa syarat ala R-03), group_key baris tertaut berbasis kunci
 * fisik, dan titik tulis ledger didedupe per laga fisik — pencatatan
 * lewat id kembar memblokir penulisan lewat id kanoniknya.
 *
 * Kembar TAK tertaut (Lanjut-5): builder tautan kini toleran (konteks
 * liga + kunci tim level tautan + rantai kickoff ±120 menit —
 * lib/identity/link-matching.ts), tapi slate tidak bergantung padanya
 * saja: titik tulis ledger punya PENJAGA CADANGAN laga fisik. Baris
 * tak tertaut yang laga fisiknya sudah terwakili (wakil klaster
 * cadangan di antara baris terpindai, catatan ledger lewat id lain,
 * atau terbitan run ini) tetap di-rate dan tetap menulis paket
 * analisis, tapi pick-nya TIDAK diterbitkan dua kali; kejadiannya
 * dihitung di statistik unlinked_twin_fixtures_skipped. Produksi
 * 22 Nov 2026: 4 pasang lolos dari builder lama (belahan registry
 * Beveren/Standard + drift kickoff mt_ 60–90 menit) → 26 pick dobel.
 *
 * OFFLINE PENUH — tidak ada panggilan Sportmonks/TheStats. Env dijalankan
 * dengan resep driver E2E: .env.local dimuat hanya agar impor planner 🔒
 * tidak throw (base URL NineRouter), lalu STATS_API_KEY dan
 * SPORTMONKS_API_TOKEN dikosongkan paksa sebelum modul pipeline diimpor
 * secara dinamis → klien API throw sebelum fetch.
 *
 * Pakai:
 *   NODE_OPTIONS="--env-file=.env.local" npx tsx scripts/pick-slate.ts [--hours 48] [--limit N]
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getUpcomingDb } from "../lib/db/upcoming-fixtures";
import {
  getCanonicalBySourceId,
  getCanonicalCupModel,
} from "../lib/quant/league-identity";
import { getLeagueGate, competitionIdToDiv } from "../lib/quant/league-gate";
import {
  loadCalibratedRatings,
  resolveDivForMatch,
  setCalibratedRatingsOverride,
} from "../lib/quant/ratings-loader";
import {
  ModelManifestError,
  loadServingModel,
  type ServingModel,
} from "../lib/quant/model-manifest";
import { parseFixtureDetail } from "../lib/odds/sportmonks-adapter";
import { pickSmQuotes } from "../lib/odds/sportmonks-wire";
import { stripVigShin, stripVigTwoWay } from "../lib/quant/vig-stripping";
import {
  pickLegs,
  combineParlay,
  rebuildMatrix,
  probFromMatrix,
  CANDIDATES,
  type GateStatus,
  type PickLeg,
  type Population,
} from "../lib/picks/engine";
import { writePackage, type PackageInput } from "../lib/picks/packages";
import {
  SlateIdentity,
  decideSlateFixture,
  fallbackBlockReason,
  fallbackGroupKey,
  parseSlateLinks,
  slateGroupKey,
  takeDistinctByGroup,
} from "../lib/picks/slate-identity";
import {
  buildLinkTeamKeyFn,
  buildTeamResolver,
  clusterTwinRows,
  loadLinkTeamAliases,
  resolveLinkRow,
  type LinkableFixtureRow,
  type ResolvedLinkRow,
  type TeamRegistryFile,
} from "../lib/identity/link-matching";
import {
  publishPicks,
  type OddsSnapshot,
  type PublishLegInput,
} from "../lib/picks/publication";
import {
  getUidForMatchId,
  identityTablesExist,
} from "../lib/identity/fixture-resolver";
import { selectMarketQuote } from "../lib/market/market-snapshot";
import { GATE_LABEL } from "../lib/web/format";
import { execSync } from "node:child_process";

function openRo(p: string): DatabaseSync {
  return new DatabaseSync(p, { readOnly: true });
}

function coerceGate(s: unknown): GateStatus | null {
  return s === "calibrated" || s === "partial" || s === "uncalibrated" ? s : null;
}

function wib(utcIso: string): string {
  const d = new Date(new Date(utcIso).getTime() + 7 * 3600_000);
  return `${d.toISOString().slice(0, 16).replace("T", " ")} WIB`;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

interface FixtureRow {
  match_id: string;
  competition_id: string;
  competition_name: string;
  competition_country: string | null;
  utc_date: string;
  home_team_id: string;
  home_team_name: string;
  away_team_id: string;
  away_team_name: string;
}

interface RatedFixture {
  fixture: FixtureRow;
  canonical_id: string | null;
  gate_status: GateStatus;
  population: Population;
  /** 'free' bila fixture berasal dari feed gratis (id fd_*), selain itu 'full'. */
  feed_mode: "free" | "full";
  lambda: number;
  mu: number;
  /** Baris store paket (packages.id) tempat paket penuh fixture ini tinggal. */
  package_id: number | null;
  legs: PickLeg[];
  /** Kunci grup contoh parlay: identitas fisik `fx:<canonical_id>` untuk
   *  baris tertaut fixture-links; `fb:<...>` wakil klaster untuk anggota
   *  klaster cadangan tak tertaut (Lanjut-5); formula nama warisan
   *  selain itu. */
  group_key: string;
}

/** Skor-skor paling mungkin dari matriks (untuk payload paket). */
function topScoresFromMatrix(
  matrix: number[][],
  n = 8,
): { home_goals: number; away_goals: number; prob: number }[] {
  const cells: { home_goals: number; away_goals: number; prob: number }[] = [];
  matrix.forEach((row, h) =>
    row.forEach((p, a) => cells.push({ home_goals: h, away_goals: a, prob: p })),
  );
  return cells.sort((x, y) => y.prob - x.prob).slice(0, n);
}

/** δ kandang dari metadata cupOffset planner (objek offset global); null di luar itu. */
function cupDeltaFrom(cupOffset: unknown): number | null {
  if (typeof cupOffset === "number" && Number.isFinite(cupOffset)) return cupOffset;
  if (cupOffset !== null && typeof cupOffset === "object") {
    const o = cupOffset as Record<string, unknown>;
    for (const k of ["homeDelta", "delta", "offset"]) {
      if (typeof o[k] === "number" && Number.isFinite(o[k])) return o[k] as number;
    }
  }
  return null;
}

interface UnratedFixture {
  fixture: FixtureRow;
  reason: string;
}

/** Nama pasar panel SM → peta kunci engine (probabilitas persen → 0..1). */
const SM_MARKET_MAP: Record<string, Record<string, string>> = {
  "Fulltime Result Probability": { home: "1x2:1", draw: "1x2:x", away: "1x2:2" },
  "Double Chance Probability": {
    draw_home: "dc:1x",
    home_away: "dc:12",
    draw_away: "dc:x2",
  },
  "Over/Under 1.5 Probability": { yes: "ou15:over", no: "ou15:under" },
  "Over/Under 2.5 Probability": { yes: "ou25:over", no: "ou25:under" },
  "Over/Under 3.5 Probability": { yes: "ou35:over", no: "ou35:under" },
  "Both Teams To Score Probability": { yes: "btts:yes", no: "btts:no" },
  "Home Over/Under 0.5 Probability": { yes: "team_over05_home:yes" },
  "Away Over/Under 0.5 Probability": { yes: "team_over05_away:yes" },
};

/**
 * Identitas fisik slate dari data/fixture-links.json (boleh tidak ada):
 * SEMUA kelas kembar dimuat (mt_ untuk R-03; fd_/sm_ untuk Lanjut-4) —
 * logika keputusan/kuncinya di lib/picks/slate-identity.ts. File dibangun
 * ulang oleh build-fixture-links di rantai free-refresh SEBELUM pick-slate,
 * jadi peta yang dibaca di sini selalu versi segar run yang sama. File
 * absen/rusak → identitas kosong → perilaku warisan (saringan dilewati,
 * group_key nama), bukan ditebak.
 */
function loadSlateIdentity(): SlateIdentity {
  const p = path.join(process.cwd(), "data", "fixture-links.json");
  if (!fs.existsSync(p)) return new SlateIdentity([]);
  return new SlateIdentity(parseSlateLinks(fs.readFileSync(p, "utf8")));
}

async function main() {
  const args = process.argv.slice(2);
  const hours = Number(args[args.indexOf("--hours") + 1]) || 48;
  const limit = args.includes("--limit")
    ? Number(args[args.indexOf("--limit") + 1]) || Infinity
    : Infinity;
  // Item 24 (Sprint A+B): --no-ledger DITOLAK KERAS. Tanpa ledger, run
  // ini tetap menulis paket resmi ke store paket (cabang paket-saja) —
  // paket resmi tanpa rumah provenance di ledger adalah celah yang
  // ditutup brief hal. 14. Tidak ada mode tulis-paket-tanpa-ledger.
  if (args.includes("--no-ledger")) {
    console.error(
      "[pick-slate] ERROR: flag --no-ledger ditolak — mode tanpa ledger tetap menulis paket resmi tanpa provenance ledger (celah Item 24). Jalankan tanpa flag itu; tidak ada file yang ditulis.",
    );
    process.exit(1);
  }
  const writeLedger = true;

  // --- Env: muat .env.local lalu kosongkan kunci API SEBELUM impor pipeline.
  try {
    process.loadEnvFile(path.join(process.cwd(), ".env.local"));
  } catch {
    /* .env.local absen → impor planner mungkin throw; biarkan error-nya bicara */
  }
  process.env.STATS_API_KEY = "";
  process.env.SPORTMONKS_API_TOKEN = "";

  const { fetchAndValidateMatchIntelligence } = await import(
    "../lib/stats-fetcher-agent"
  );
  const { buildQuantPackage } = await import("../lib/agent/planner");

  const TODAY = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const windowEnd = new Date(now.getTime() + hours * 3600_000);
  const iso = (d: Date) => d.toISOString();

  const upDb = getUpcomingDb();
  const dsDb = openRo("data/thestats_dataset.db");
  const prDb = openRo("data/predictions.db");

  // Model saji (K4 + fix-5 review K8 §5): pointer manifest aktif dibaca
  // SATU KALI lewat loadServingModel — artefak bobot immutable yang
  // dirujuk pointer divalidasi hash-nya terhadap manifest, lalu bobot
  // itu ditanam ke ratings-loader sehingga seluruh hitungan proses ini
  // (termasuk planner) memakai artefak pointer, BUKAN file lepas
  // data/calibrated_ratings.json. Identitas yang dicap ke paket
  // (modelVersion + ratingsMarker) berasal dari manifest yang sama —
  // angka dan label tidak bisa lagi berpisah saat refit menimpa file
  // lepas. Artefak hilang / hash tidak cocok → berhenti bernama
  // SEBELUM penerbitan apa pun; tidak ada fallback diam-diam.
  let serving: ServingModel;
  try {
    serving = loadServingModel(path.join(process.cwd(), "data"));
  } catch (err) {
    if (err instanceof ModelManifestError) {
      console.error(`[pick-slate] model saji tidak dapat dipakai [${err.code}]: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
  setCalibratedRatingsOverride(serving.ratings);
  const ratingsMarker: string = serving.manifest.ratingsHash;
  const modelVersion: string = serving.manifest.modelVersion;

  const ratings = loadCalibratedRatings();
  const slateIdentity = loadSlateIdentity();

  const fixtures = upDb
    .prepare(
      `SELECT match_id, competition_id, competition_name, competition_country, utc_date, home_team_id, home_team_name, away_team_id, away_team_name
       FROM upcoming_fixtures
       WHERE utc_date >= ? AND utc_date < ? AND status = 'scheduled'
       ORDER BY utc_date ASC`,
    )
    .all(iso(now), iso(windowEnd)) as unknown as FixtureRow[];

  console.log(
    `Jendela ${iso(now)} → ${iso(windowEnd)} (${hours} jam): ${fixtures.length} fixture terjadwal.`,
  );

  // Himpunan id terpindai run ini — keputusan kembar Lanjut-4 untuk
  // kelas non-mt_ mensyaratkan kanoniknya ikut terpindai.
  const scannedIds = new Set(fixtures.map((f) => f.match_id));

  const registryStatus = (leagueId: string): string | null => {
    const row = dsDb
      .prepare("SELECT status FROM league_calibration WHERE league_id = ?")
      .get(leagueId) as { status: string } | undefined;
    return row?.status ?? null;
  };

  const smFixtureIdFor = (fx: FixtureRow): number | null => {
    if (fx.match_id.startsWith("sm_")) {
      const n = Number(fx.match_id.slice(3));
      return Number.isFinite(n) ? n : null;
    }
    const row = upDb
      .prepare("SELECT sm_fixture_id FROM sm_id_map WHERE match_id = ?")
      .get(fx.match_id) as { sm_fixture_id: number } | undefined;
    return row?.sm_fixture_id ?? null;
  };

  interface MarketInfo {
    probs: Record<string, number>;
    /** Cap tangkapan odds yang benar-benar masuk paket; null bila tak ada. */
    captured_utc: string | null;
    bookmakers: string[] | null;
    /** Harga desimal mentah per kunci "market:selection" (K2: bukti odds terbit). */
    decimals: Record<string, { decimal: number; bookmaker: string | null }>;
  }

  const marketInfoFor = (fx: FixtureRow, smId: number | null): MarketInfo => {
    const info: MarketInfo = { probs: {}, captured_utc: null, bookmakers: null, decimals: {} };
    const newest = dsDb
      .prepare(
        "SELECT captured_utc, payload_json, source FROM match_odds_history WHERE match_id = ? ORDER BY captured_utc DESC LIMIT 1",
      )
      .get(fx.match_id) as
      | { captured_utc: string; payload_json: string; source: string | null }
      | undefined;
    if (!newest) return info;
    if (smId !== null) {
      try {
        const envelope = JSON.parse(newest.payload_json) as { odds?: unknown[] };
        const detail = parseFixtureDetail(smId, { data: { odds: envelope.odds ?? [] } });
        const quotes = pickSmQuotes(detail, newest.captured_utc);
        if (quotes) {
          // Tangkapan ini benar-benar memberi makan paket → catat freshness-nya.
          info.captured_utc = newest.captured_utc;
          const q = quotes as unknown as Record<string, unknown>;
          const names = [q.bookmaker, q.compare_bookmaker].filter(
            (v): v is string => typeof v === "string" && v.length > 0,
          );
          if (names.length > 0) info.bookmakers = [...new Set(names)];
          if (quotes.home_last && quotes.draw_last && quotes.away_last) {
            const shin = stripVigShin(quotes.home_last, quotes.draw_last, quotes.away_last);
            if (shin.fair_prob) {
              info.probs["1x2:1"] = shin.fair_prob.home;
              info.probs["1x2:x"] = shin.fair_prob.draw;
              info.probs["1x2:2"] = shin.fair_prob.away;
            }
            const bk = typeof q.bookmaker === "string" ? q.bookmaker : null;
            info.decimals["1x2:1"] = { decimal: quotes.home_last, bookmaker: bk };
            info.decimals["1x2:x"] = { decimal: quotes.draw_last, bookmaker: bk };
            info.decimals["1x2:2"] = { decimal: quotes.away_last, bookmaker: bk };
          }
          if (quotes.total_goals_over_2_5 && quotes.under_2_5) {
            const two = stripVigTwoWay(quotes.total_goals_over_2_5, quotes.under_2_5);
            info.probs["ou25:over"] = two.fair_prob.optionA;
            info.probs["ou25:under"] = two.fair_prob.optionB;
            const bk = typeof q.bookmaker === "string" ? q.bookmaker : null;
            info.decimals["ou25:over"] = { decimal: quotes.total_goals_over_2_5, bookmaker: bk };
            info.decimals["ou25:under"] = { decimal: quotes.under_2_5, bookmaker: bk };
          }
        }
      } catch {
        /* payload tidak ter-parse → probabilitas pasar absen (null), bukan karangan */
      }
      if (Object.keys(info.probs).length > 0) return info;
    }
    // --- Degradasi feed gratis: envelope football-data pra-laga.
    // Hanya bila jalur SM tidak menghasilkan apa pun DAN baris odds terbaru
    // memang tangkapan football-data kind='pre-match'.
    if (newest.source === "football-data" && newest.payload_json) {
      try {
        const payload = JSON.parse(newest.payload_json) as {
          kind?: string;
          books?: Array<{
            bookmaker: string;
            "1x2": { home: number; draw: number; away: number };
            ou25: { over: number; under: number } | null;
          }>;
        };
        if (payload.kind === "pre-match" && Array.isArray(payload.books) && payload.books.length > 0) {
          const primary =
            payload.books.find((b) => b.bookmaker === "Pinnacle") ??
            payload.books.find((b) => b.bookmaker === "Bet365") ??
            payload.books[0];
          const shin = stripVigShin(primary["1x2"].home, primary["1x2"].draw, primary["1x2"].away);
          if (shin.fair_prob) {
            info.probs["1x2:1"] = shin.fair_prob.home;
            info.probs["1x2:x"] = shin.fair_prob.draw;
            info.probs["1x2:2"] = shin.fair_prob.away;
          }
          info.decimals["1x2:1"] = { decimal: primary["1x2"].home, bookmaker: primary.bookmaker };
          info.decimals["1x2:x"] = { decimal: primary["1x2"].draw, bookmaker: primary.bookmaker };
          info.decimals["1x2:2"] = { decimal: primary["1x2"].away, bookmaker: primary.bookmaker };
          const ordered = [primary, ...payload.books.filter((b) => b !== primary)];
          for (const b of ordered) {
            if (b.ou25) {
              const two = stripVigTwoWay(b.ou25.over, b.ou25.under);
              info.probs["ou25:over"] = two.fair_prob.optionA;
              info.probs["ou25:under"] = two.fair_prob.optionB;
              info.decimals["ou25:over"] = { decimal: b.ou25.over, bookmaker: b.bookmaker };
              info.decimals["ou25:under"] = { decimal: b.ou25.under, bookmaker: b.bookmaker };
              break;
            }
          }
          if (Object.keys(info.probs).length > 0) {
            info.captured_utc = newest.captured_utc;
            info.bookmakers = [...new Set(payload.books.map((b) => b.bookmaker))];
          }
        }
      } catch {
        /* envelope fd tidak valid → probabilitas pasar absen (null), bukan karangan */
      }
    }
    return info;
  };

  /** Cap batch predictions SM terakhir untuk fixture (freshness panel). */
  const smBatchUtcFor = (smId: number | null): string | null => {
    if (smId === null) return null;
    const row = prDb
      .prepare("SELECT MAX(captured_utc) AS m FROM sm_predictions WHERE fixture_sm_id = ?")
      .get(smId) as { m: string | null } | undefined;
    return row?.m ?? null;
  };

  const smProbsFor = (smId: number | null) => {
    const out: Record<string, number> = {};
    if (smId === null) return out;
    const rows = prDb
      .prepare(
        "SELECT market, outcome, probability FROM sm_predictions WHERE fixture_sm_id = ?",
      )
      .all(smId) as unknown as Array<{
      market: string;
      outcome: string;
      probability: number;
    }>;
    for (const r of rows) {
      const key = SM_MARKET_MAP[r.market]?.[r.outcome];
      if (key) out[key] = r.probability / 100;
    }
    return out;
  };

  // Idempotensi driver untuk ledger live-run.
  const alreadyRecorded = new Set<string>();
  if (writeLedger) {
    try {
      const pkDb = openRo("data/picks.db");
      for (const r of pkDb
        .prepare("SELECT DISTINCT match_id FROM picks WHERE source = 'live-run'")
        .all() as unknown as Array<{ match_id: string }>) {
        alreadyRecorded.add(r.match_id);
      }
      pkDb.close();
    } catch {
      /* picks.db belum ada → tidak ada yang pernah dicatat */
    }
  }
  // Dedupe titik tulis per LAGA FISIK (Lanjut-4): kunci fisik dari
  // match_id yang sudah tercatat — pencatatan lama lewat id kembar
  // memblokir penulisan ulang lewat id kanoniknya, dan sebaliknya.
  // writtenPhysicalKeys menampung kunci yang ditulis run ini.
  const recordedPhysicalKeys = slateIdentity.physicalKeySet(alreadyRecorded);
  const writtenPhysicalKeys = new Set<string>();

  // --- Penjaga cadangan laga fisik (Lanjut-5): untuk baris yang tetap
  // TAK tertaut di fixture-links, laga fisik dinilai dari kunci tim
  // LEVEL TAUTAN + konteks liga + kickoff (modul yang sama dengan
  // builder: lib/identity/link-matching.ts). Klaster di antara baris
  // terpindai menentukan wakilnya; baris ledger yang sudah tercatat
  // dicocokkan lewat baris katalognya. Registry/alias tak terbaca →
  // penjaga nonaktif dan perilaku kembali persis seperti sebelumnya
  // (gagal-lembut, pola loadSlateIdentity).
  const dataDir = path.join(process.cwd(), "data");
  let resolveCatalogRow: ((row: LinkableFixtureRow) => ResolvedLinkRow | null) | null =
    null;
  try {
    const reg = JSON.parse(
      fs.readFileSync(path.join(dataDir, "team-canonical.json"), "utf8"),
    ) as TeamRegistryFile;
    const teamResolver = buildTeamResolver(reg);
    const keyOf = buildLinkTeamKeyFn(reg, loadLinkTeamAliases(dataDir));
    resolveCatalogRow = (row) => resolveLinkRow(row, teamResolver, keyOf);
  } catch {
    resolveCatalogRow = null;
  }
  const fallbackRefOf = new Map<string, ResolvedLinkRow>();
  const representativeOf = new Map<string, string>();
  const canonicalRefOf = new Map<string, ResolvedLinkRow>();
  const recordedFallbackRefs: ResolvedLinkRow[] = [];
  const writtenFallbackRefs: ResolvedLinkRow[] = [];
  if (resolveCatalogRow) {
    const scannedResolved: ResolvedLinkRow[] = [];
    for (const f of fixtures) {
      const r = resolveCatalogRow(f);
      if (r) {
        fallbackRefOf.set(r.match_id, r);
        scannedResolved.push(r);
      }
    }
    for (const cluster of clusterTwinRows(scannedResolved)) {
      for (const r of cluster.rows) {
        representativeOf.set(r.match_id, cluster.canonical.match_id);
        canonicalRefOf.set(r.match_id, cluster.canonical);
      }
    }
    if (writeLedger && alreadyRecorded.size > 0) {
      const stmt = upDb.prepare(
        "SELECT match_id, competition_id, competition_name, utc_date, home_team_id, home_team_name, away_team_id, away_team_name FROM upcoming_fixtures WHERE match_id = ?",
      );
      for (const id of alreadyRecorded) {
        const row = stmt.get(id) as unknown as LinkableFixtureRow | undefined;
        if (!row) continue;
        const r = resolveCatalogRow(row);
        if (r) recordedFallbackRefs.push(r);
      }
    }
  }

  /** Snapshot odds prematch per leg untuk bukti terbit K2 (harga mentah buku). */
  const oddsSnapshotsFor = (leg: PickLeg, mInfo: MarketInfo): OddsSnapshot[] => {
    const d = mInfo.decimals[`${leg.market}:${leg.selection}`];
    if (!d || !mInfo.captured_utc) return [];
    return [
      {
        source: "book",
        type: "prematch",
        available_utc: mInfo.captured_utc,
        bookmaker: d.bookmaker,
        decimal: d.decimal,
      },
    ];
  };

  /** SHA kode penerbit (best-effort; null bila git tak tersedia). */
  let codeSha: string | null = null;
  try {
    codeSha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim() || null;
  } catch {
    codeSha = null;
  }

  const rated: RatedFixture[] = [];
  const unrated: UnratedFixture[] = [];
  let ledgerWritten = 0;
  let ledgerCutoffRejected = 0;
  let processed = 0;
  let packagesWritten = 0;
  let mtTwinsSkipped = 0;
  let linkedTwinsSkipped = 0;
  let unlinkedTwinsSkipped = 0;

  // --- MarketSnapshot (Item 3, Sprint C): pembacaan pasar TERKUNCI pada
  // decision_ts tiap fixture (computedUtc = decision_at_utc publikasi).
  // Murni pencatatan ke laporan slate — TIDAK mengubah probabilitas,
  // paket, atau pick. Store absen (aktivasi menunggu token pemilik)
  // → semua cek tercatat abstain "store_absent", bukan error.
  const marketQuoteChecks: {
    match_id: string;
    status: "found" | "abstain";
    reason: string | null;
    source: string | null;
    first_observed: string | null;
    age_ms: number | null;
  }[] = [];
  let msDb: DatabaseSync | null | undefined;
  const marketQuoteCheck = (
    matchId: string,
    decisionTs: string,
    kickoffTs: string,
  ): void => {
    try {
      if (msDb === undefined) {
        const p = path.join(process.cwd(), "data", "market_snapshots.db");
        msDb = fs.existsSync(p) ? openRo(p) : null;
      }
      if (!msDb) {
        marketQuoteChecks.push({
          match_id: matchId,
          status: "abstain",
          reason: "store_absent",
          source: null,
          first_observed: null,
          age_ms: null,
        });
        return;
      }
      const sel = selectMarketQuote(msDb, {
        fixture_id: matchId,
        market: "1x2",
        line: null,
        decision_ts: decisionTs,
        kickoff_ts: kickoffTs,
      });
      marketQuoteChecks.push({
        match_id: matchId,
        status: sel.quote ? "found" : "abstain",
        reason: sel.reason,
        source: sel.quote?.source ?? null,
        first_observed: sel.quote?.first_observed ?? null,
        age_ms: sel.age_ms,
      });
    } catch {
      marketQuoteChecks.push({
        match_id: matchId,
        status: "abstain",
        reason: "store_error",
        source: null,
        first_observed: null,
        age_ms: null,
      });
    }
  };

  for (const fx of fixtures) {
    if (processed >= limit) break;
    processed++;
    const tag = `[${processed}/${Math.min(fixtures.length, limit)}] ${fx.home_team_name} vs ${fx.away_team_name}`;
    const t0 = Date.now();

    // --- Saringan kembar tertaut (Fase 0 R-03 + Lanjut-4): baris yang
    // merupakan kembar katalog dari baris kanonik tidak menulis
    // paket/pick kedua untuk laga fisik yang sama; baris kanoniknya
    // yang mewakili. Keputusan + kelasnya dari lib/picks/slate-identity
    // (mt_ tanpa syarat ala R-03; kelas lain bila kanonik ikut terpindai).
    const twinDecision = decideSlateFixture(fx.match_id, slateIdentity, scannedIds);
    if (twinDecision.action === "skip") {
      if (twinDecision.kind === "mt-r03") mtTwinsSkipped++;
      else linkedTwinsSkipped++;
      const reason =
        twinDecision.kind === "mt-r03"
          ? `kembar mt_ dari ${twinDecision.canonical_id} — paket/pick hanya dari baris kanonik (Fase 0 R-03)`
          : `kembar tertaut dari ${twinDecision.canonical_id} — paket/pick hanya dari baris kanonik (Lanjut-4)`;
      unrated.push({ fixture: fx, reason });
      console.log(`${tag} → dilewati: ${reason}`);
      continue;
    }

    // --- Gerbang kompetisi (pra-cek; status final dari metadata paket).
    const canonical = getCanonicalBySourceId(fx.competition_id);
    const canonicalId = canonical?.canonical_id ?? null;
    let gate: GateStatus | null = canonicalId
      ? coerceGate(registryStatus(canonicalId))
      : null;
    if (!gate) {
      const div =
        competitionIdToDiv(fx.competition_id) ??
        (ratings
          ? resolveDivForMatch(
              ratings,
              fx.competition_name,
              fx.home_team_name,
              fx.away_team_name,
            )
          : null);
      const g = div ? getLeagueGate(div) : null;
      if (g) gate = coerceGate(g.status);
    }
    if (!gate) {
      unrated.push({
        fixture: fx,
        reason: "gerbang kompetisi tidak ter-resolve (kanonik/registry tidak ditemukan)",
      });
      console.log(`${tag} → unrated: gerbang tidak ter-resolve`);
      continue;
    }
    // Gerbang = label (keputusan owner 2026-11-05): kompetisi uncalibrated
    // TIDAK lagi di-skip — fixture-nya tetap di-rate dan kakinya terbit
    // dengan gate_status 'uncalibrated' tercatat sebagai label.

    // --- Pipeline offline (jalur yang sama dengan run-one-analysis).
    let legs: PickLeg[] | null = null;
    let packageId: number | null = null;
    let ratedMeta: Omit<RatedFixture, "fixture" | "legs" | "group_key" | "feed_mode"> | null = null;
    let failReason: string | null = null;
    try {
      const fetched = await fetchAndValidateMatchIntelligence(
        fx.match_id,
        fx.competition_id,
      );
      const pure = buildQuantPackage(fetched.intelligence, TODAY);
      const md = pure.shrunkParams.metadata as unknown as {
        calibrationStatus?: string;
        homeSource?: string;
        awaySource?: string;
        cupOffset?: unknown;
        leagueResolution?: { canonicalId?: string };
      } | null;
      const gateFinal = coerceGate(md?.calibrationStatus) ?? gate;
      const isCup =
        Boolean(md?.cupOffset) ||
        (canonicalId ? getCanonicalCupModel(canonicalId) !== null : false);
      const population: Population = isCup ? "cup" : "domestic";

      if (isCup && !md?.cupOffset) {
        failReason =
          "kompetisi piala tapi jalur offset tidak me-rate fixture ini (cupOffset absen — tim/liga di luar graf offset)";
      } else if (
        !isCup &&
        (md?.homeSource === "fallback" || md?.awaySource === "fallback" || !md)
      ) {
        failReason = `ratings tim tidak ditemukan (homeSource=${md?.homeSource ?? "?"}, awaySource=${md?.awaySource ?? "?"})`;
      } else {
        const smId = smFixtureIdFor(fx);
        const matrix =
          pure.dcOutput.score_matrix ??
          rebuildMatrix(
            pure.dcOutput.lambda,
            pure.dcOutput.mu,
            pure.shrunkParams.rho ?? 0,
          );
        const mInfo = marketInfoFor(fx, smId);
        const smProbs = smProbsFor(smId);
        legs = pickLegs({
          matrix,
          gate_status: gateFinal,
          population,
          market_probs: mInfo.probs,
          sm_probs: smProbs,
        });

        // --- Store paket: paket penuh fixture ini = satu baris versi baru.
        // Gagal tulis = fixture gugur dengan alasan eksplisit (fail-closed).
        try {
          const probabilities: Record<string, number> = {};
          for (const c of CANDIDATES) {
            probabilities[`${c.market}:${c.selection}`] = probFromMatrix(
              matrix,
              c.market,
              c.selection,
            );
          }
          const batchUtc = smBatchUtcFor(smId);
          const computedUtc = new Date().toISOString();
          const pkgInput: PackageInput = {
            match_id: fx.match_id,
            competition_canonical_id:
              md?.leagueResolution?.canonicalId ?? canonicalId,
            kickoff_utc: fx.utc_date,
            computed_utc: computedUtc,
            trigger: "slate",
            fit_source: population === "cup" ? "cup-offset" : (md?.homeSource ?? null),
            gate_status: gateFinal,
            cup_delta: cupDeltaFrom(md?.cupOffset),
            ratings_marker: ratingsMarker,
            odds_captured_utc: mInfo.captured_utc,
            bookmakers: mInfo.bookmakers,
            predictions_batch_utc: batchUtc,
            lambda: pure.dcOutput.lambda,
            mu: pure.dcOutput.mu,
            rho: pure.shrunkParams.rho ?? null,
            payload: {
              kind: "quant-package",
              version: 1,
              source: "pick-slate",
              fixture: {
                match_id: fx.match_id,
                competition_id: fx.competition_id,
                competition_name: fx.competition_name,
                home: fx.home_team_name,
                away: fx.away_team_name,
                kickoff_utc: fx.utc_date,
              },
              canonical_id: md?.leagueResolution?.canonicalId ?? canonicalId,
              gate_status: gateFinal,
              population,
              lambda: pure.dcOutput.lambda,
              mu: pure.dcOutput.mu,
              rho: pure.shrunkParams.rho ?? null,
              probabilities,
              top_scores: topScoresFromMatrix(matrix),
              score_matrix: matrix,
              shrunk_metadata: md ?? null,
              market: {
                probs: mInfo.probs,
                captured_utc: mInfo.captured_utc,
                bookmakers: mInfo.bookmakers,
              },
              sm_panel: { probs: smProbs, batch_utc: batchUtc },
              legs,
            },
            provenance: {
              source: "pick-slate",
              pipeline: "buildQuantPackage",
              population,
              feed_mode: fx.match_id.startsWith("fd_") ? "free" : "full",
              home_source: md?.homeSource ?? null,
              away_source: md?.awaySource ?? null,
              cup_offset: md?.cupOffset ?? null,
            },
          };
          // Titik tulis ledger (Lanjut-4): dedupe per LAGA FISIK, bukan
          // hanya per match_id — laga yang sudah tercatat/ditulis lewat
          // id kembar ATAU kanoniknya tidak diterbitkan dua kali.
          // Penjaga cadangan (Lanjut-5): bila kunci fisik tertaut tidak
          // memblokir, laga fisik yang sama tetap ditahan lewat kunci
          // cadangan (tim level tautan + liga + kickoff toleran) —
          // fixture terblokir jatuh ke cabang paket-saja di bawah,
          // persis pola titik tulis Lanjut-4.
          const physKey = slateIdentity.physicalKey(fx.match_id);
          const linkedBlocked =
            recordedPhysicalKeys.has(physKey) || writtenPhysicalKeys.has(physKey);
          const fbRef = fallbackRefOf.get(fx.match_id) ?? null;
          const fbReason =
            writeLedger && !linkedBlocked && fbRef
              ? fallbackBlockReason(fbRef, {
                  representativeOf,
                  recordedRefs: recordedFallbackRefs,
                  writtenRefs: writtenFallbackRefs,
                })
              : null;
          if (
            writeLedger &&
            !linkedBlocked &&
            !fbReason
          ) {
            // --- Jalur resmi K2: intent → paket → commit beku. Validasi
            // cutoff terjadi SAAT COMMIT; run yang commit-nya lewat kickoff
            // hanya menyisakan paket sebagai analisis internal.
            const pubLegs: PublishLegInput[] = legs.map((leg) => ({
              market: leg.market,
              selection: leg.selection,
              model_prob: leg.model_prob,
              effective_prob: leg.effective_prob,
              effective_source: leg.effective_source,
              market_prob: leg.market_prob,
              sm_prob: leg.sm_prob,
              grade: leg.grade,
              gate_status: gateFinal,
              odds_snapshots: oddsSnapshotsFor(leg, mInfo),
            }));
            // Pembacaan pasar terkunci decision_ts (Item 3) — dicatat ke
            // laporan slate; tidak memengaruhi publikasi di bawah ini.
            marketQuoteCheck(fx.match_id, computedUtc, fx.utc_date);
            const res = publishPicks(
              {
                series: "live-run",
                source_match_id: fx.match_id,
                fixture_uid: identityTablesExist(dsDb)
                  ? getUidForMatchId(dsDb, fx.match_id)
                  : null,
                competition_canonical_id:
                  md?.leagueResolution?.canonicalId ?? canonicalId,
                kickoff_utc: fx.utc_date,
                scheduled_cutoff_utc: iso(now),
                decision_at_utc: computedUtc,
                model_version: modelVersion,
                ratings_hash: ratingsMarker,
                code_sha: codeSha,
                package: {
                  trigger: "slate",
                  computed_utc: computedUtc,
                  fit_source: pkgInput.fit_source,
                  gate_status: gateFinal,
                  cup_delta: pkgInput.cup_delta,
                  ratings_marker: ratingsMarker,
                  odds_captured_utc: mInfo.captured_utc,
                  bookmakers: mInfo.bookmakers,
                  predictions_batch_utc: batchUtc,
                  lambda: pure.dcOutput.lambda,
                  mu: pure.dcOutput.mu,
                  rho: pure.shrunkParams.rho ?? null,
                  payload: pkgInput.payload,
                  provenance: pkgInput.provenance,
                },
                legs: pubLegs,
              },
              {
                // Jam terinjeksi sebagai fungsi yang dibaca ulang di
                // dalam lock commit + keadaan fixture (status DAN kickoff)
                // dibaca segar dari katalog pada momen yang sama
                // (review K8 butir 3A).
                now: () => new Date().toISOString(),
                fixture_state: () => {
                  const row = upDb
                    .prepare(
                      "SELECT status, utc_date FROM upcoming_fixtures WHERE match_id = ?",
                    )
                    .get(fx.match_id) as
                    | { status: string; utc_date: string }
                    | undefined;
                  return row
                    ? { status: row.status, kickoff_utc: row.utc_date }
                    : null;
                },
              },
            );
            packageId = res.package_id;
            packagesWritten++;
            if (res.status === "published" || res.status === "already_committed") {
              ledgerWritten += res.pick_ids.length;
            } else if (res.status === "rejected_cutoff") {
              ledgerCutoffRejected++;
              console.log(
                `${tag} → publikasi ditolak saat commit (${res.reason ?? "cutoff"}) — paket tetap analisis internal`,
              );
            } else {
              throw new Error(`publikasi gagal: ${res.reason ?? res.status}`);
            }
            writtenPhysicalKeys.add(physKey);
            if (fbRef) writtenFallbackRefs.push(fbRef);
          } else {
            if (fbReason) {
              unlinkedTwinsSkipped++;
              console.log(
                `${tag} → penerbitan ditahan penjaga cadangan (${fbReason}) — paket tetap analisis internal (Lanjut-5)`,
              );
            }
            const pkg = writePackage(pkgInput);
            packageId = pkg.id;
            packagesWritten++;
          }
        } catch (e) {
          legs = null;
          failReason = `store paket gagal: ${e instanceof Error ? e.message : String(e)}`;
        }

        if (legs) {
          ratedMeta = {
            canonical_id: md?.leagueResolution?.canonicalId ?? canonicalId,
            gate_status: gateFinal,
            population,
            lambda: pure.dcOutput.lambda,
            mu: pure.dcOutput.mu,
            package_id: packageId,
          };
        }
      }
    } catch (e) {
      failReason = `pipeline throw: ${e instanceof Error ? e.message : String(e)}`;
    }

    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    if (!legs || !ratedMeta) {
      unrated.push({ fixture: fx, reason: failReason ?? "tidak ter-rate (alasan tidak tercatat)" });
      console.log(`${tag} → unrated: ${failReason} (${dt}s)`);
      continue;
    }

    const entry: RatedFixture = {
      fixture: fx,
      ...ratedMeta,
      feed_mode: fx.match_id.startsWith("fd_") ? "free" : "full",
      legs,
      // Group_key berbasis identitas fisik untuk baris tertaut
      // (Lanjut-4, lib/picks/slate-identity); anggota klaster cadangan
      // tak tertaut berbagi kunci wakil klaster (Lanjut-5); baris lain
      // memakai formula nama warisan di dalam fungsi yang sama.
      group_key:
        !slateIdentity.isLinked(fx.match_id) && canonicalRefOf.has(fx.match_id)
          ? fallbackGroupKey(canonicalRefOf.get(fx.match_id)!)
          : slateGroupKey(fx, slateIdentity),
    };
    rated.push(entry);
    console.log(
      `${tag} → rated (${entry.gate_status}/${entry.population}) ${legs.length} kaki (${dt}s)`,
    );

    // Ledger live-run kini ditulis di dalam blok paket lewat jalur
    // publikasi resmi K2 (publishPicks) — tidak ada lagi penumpukan
    // ledgerRows + recordPicks di akhir run.
  }

  // --- Contoh parlay: lintas pertandingan, grup kembar (twin) dianggap satu laga.
  const gradeRank = { A: 3, B: 2, C: 1 } as const;
  const flatLegs = rated.flatMap((r) =>
    r.legs.map((leg) => ({ r, leg })),
  );
  const byGradeEff = [...flatLegs].sort(
    (x, y) =>
      gradeRank[y.leg.grade] - gradeRank[x.leg.grade] ||
      y.leg.effective_prob - x.leg.effective_prob,
  );
  const byEff = [...flatLegs].sort(
    (x, y) => y.leg.effective_prob - x.leg.effective_prob,
  );
  // Seleksi "satu unit per grup" dari lib/picks/slate-identity — dengan
  // group_key fisik, dua baris satu laga fisik tidak pernah lolos
  // bersama walau keduanya ter-rate (pertahanan lapis kedua, Lanjut-4).
  const toUnits = (items: typeof flatLegs) =>
    items.map(({ r, leg }) => ({
      label: `${r.fixture.home_team_name} vs ${r.fixture.away_team_name} — ${leg.market}/${leg.selection} [${leg.grade} · ${GATE_LABEL[r.gate_status] ?? r.gate_status}]`,
      stated_prob: leg.model_prob,
      effective_prob: leg.effective_prob,
    }));

  const utama = takeDistinctByGroup(byGradeEff, 4, (it) => it.r.group_key);
  const aman = takeDistinctByGroup(
    byEff.filter(({ leg }) => leg.grade !== "C"),
    3,
    (it) => it.r.group_key,
  );
  const alternatif = takeDistinctByGroup(
    byGradeEff,
    3,
    (it) => it.r.group_key,
    new Set(utama.map(({ r }) => r.group_key)),
  );
  const parlays = [
    { name: "Utama (4 kaki — grade lalu efektif)", items: utama },
    { name: "Aman (3 kaki — hanya A/B, efektif tertinggi)", items: aman },
    { name: "Alternatif (3 kaki — di luar laga Utama)", items: alternatif },
  ]
    .filter((p) => p.items.length >= 2)
    .map((p) => ({ name: p.name, ...combineParlay(toUnits(p.items)) }));

  // --- Statistik + output.
  const legsByGrade = { A: 0, B: 0, C: 0 };
  for (const r of rated) for (const l of r.legs) legsByGrade[l.grade]++;
  const reasonCounts: Record<string, number> = {};
  for (const u of unrated) {
    const key = u.reason.split(" (")[0].split(":")[0];
    reasonCounts[key] = (reasonCounts[key] ?? 0) + 1;
  }

  const result = {
    generated_at: new Date().toISOString(),
    window: { from: iso(now), to: iso(windowEnd), hours },
    stats: {
      fixtures_scanned: processed,
      fixtures_rated: rated.length,
      fixtures_unrated: unrated.length,
      legs_total: rated.reduce((s, r) => s + r.legs.length, 0),
      legs_by_grade: legsByGrade,
      unrated_reason_counts: reasonCounts,
      packages_written: packagesWritten,
      mt_twin_fixtures_skipped: mtTwinsSkipped,
      linked_twin_fixtures_skipped: linkedTwinsSkipped,
      unlinked_twin_fixtures_skipped: unlinkedTwinsSkipped,
      fixtures_rated_free_mode: rated.filter((r) => r.feed_mode === "free").length,
      ledger_live_run_rows_written: ledgerWritten,
      ledger_cutoff_rejected_fixtures: ledgerCutoffRejected,
      ledger_skipped_already_recorded: writeLedger
        ? rated.filter((r) =>
            recordedPhysicalKeys.has(
              slateIdentity.physicalKey(r.fixture.match_id),
            ),
          ).length
        : 0,
    },
    market_snapshot: {
      checked: marketQuoteChecks.length,
      found: marketQuoteChecks.filter((c) => c.status === "found").length,
      abstained: marketQuoteChecks.filter((c) => c.status === "abstain").length,
      checks: marketQuoteChecks,
    },
    rated: rated.map((r) => ({
      match_id: r.fixture.match_id,
      utc_date: r.fixture.utc_date,
      competition_id: r.fixture.competition_id,
      competition_name: r.fixture.competition_name,
      canonical_id: r.canonical_id,
      home: r.fixture.home_team_name,
      away: r.fixture.away_team_name,
      gate_status: r.gate_status,
      population: r.population,
      feed_mode: r.feed_mode,
      lambda: r.lambda,
      mu: r.mu,
      package_id: r.package_id,
      legs: r.legs,
    })),
    unrated: unrated.map((u) => ({
      match_id: u.fixture.match_id,
      utc_date: u.fixture.utc_date,
      competition_name: u.fixture.competition_name,
      home: u.fixture.home_team_name,
      away: u.fixture.away_team_name,
      reason: u.reason,
    })),
    parlays,
  };

  fs.writeFileSync(
    path.join(process.cwd(), "tasks", "pick-slate-latest.json"),
    JSON.stringify(result, null, 2),
  );

  const md: string[] = [];
  md.push(`# Slate Pick — ${wib(iso(now))} (jendela ${hours} jam ke depan)`);
  md.push("");
  md.push(
    `Fixture terpindai **${result.stats.fixtures_scanned}** · ter-rate **${result.stats.fixtures_rated}** · ` +
      `tidak ter-rate **${result.stats.fixtures_unrated}** · total kaki **${result.stats.legs_total}** ` +
      `(A ${legsByGrade.A} / B ${legsByGrade.B} / C ${legsByGrade.C}) · ` +
      `paket kuant tersimpan **${packagesWritten}** · ` +
      `kembar mt_ dilewati **${mtTwinsSkipped}** · ` +
      `kembar tertaut dilewati **${linkedTwinsSkipped}** · ` +
      `kembar tak tertaut ditahan penjaga cadangan **${unlinkedTwinsSkipped}** · ` +
      `baris ledger live-run tertulis **${ledgerWritten}**.`,
  );
  md.push("");
  md.push(
    `Fixture ter-rate mode free (feed gratis football-data): **${result.stats.fixtures_rated_free_mode}**.`,
  );
  md.push(
    "Probabilitas efektif = hit-rate empiris lab Fase A untuk sel (pasar, pita) — dipakai untuk matematika parlay. " +
      "Kombinasi dilaporkan sebagai RANGE: efektif = estimasi titik, produk stated = batas atas (lab mengukur produk independensi melebih-lebihkan survival ~1,5–4pp).",
  );
  md.push(
    "Setiap pilihan membawa label gerbang kalibrasi liganya (Calibrated / Partial / Not calibrated). " +
      "Gerbang adalah label, bukan pembatas (keputusan owner 2026-11-05): pilihan dari liga Not calibrated tetap terbit " +
      "dan tetap tercatat di ledger, dengan labelnya terlihat — bukan disembunyikan (Fase 0 R-02; kontrak INV-04).",
  );
  md.push("");
  md.push("## Contoh parlay");
  for (const p of parlays) {
    md.push("");
    md.push(`### ${p.name}`);
    for (const u of p.units) {
      md.push(`- ${u.label} — stated ${pct(u.stated_prob)}, efektif ${pct(u.effective_prob)}`);
    }
    md.push(
      `**Kombinasi: ${pct(p.combined_effective)} (estimasi titik) s.d. ${pct(p.combined_stated)} (batas atas)**`,
    );
  }
  md.push("");
  md.push("## Fixture ter-rate");
  for (const r of rated) {
    md.push("");
    md.push(
      `### ${r.fixture.home_team_name} vs ${r.fixture.away_team_name} — ${r.fixture.competition_name} (${r.gate_status}${r.population === "cup" ? ", piala/offset" : ""})${r.feed_mode === "free" ? " · mode: free" : ""}`,
    );
    md.push(`Kickoff ${wib(r.fixture.utc_date)} · λ ${r.lambda} / μ ${r.mu}`);
    for (const l of r.legs) {
      md.push(
        `- [${l.grade}] ${l.market}/${l.selection} — stated ${pct(l.model_prob)}, efektif ${pct(l.effective_prob)} (${l.effective_source}${l.band ? `, pita ${l.band} n=${l.band_n}` : ""})` +
          `${l.market_prob !== null ? ` · pasar ${pct(l.market_prob)}` : ""}` +
          `${l.sm_prob !== null ? ` · SM ${pct(l.sm_prob)}` : ""}` +
          `${l.agreement_spread !== null ? ` · spread ${(l.agreement_spread * 100).toFixed(1)}pp` : ""}`,
      );
    }
    if (r.legs.length === 0) md.push("- (tidak ada kaki yang lolos lantai grade)");
  }
  md.push("");
  md.push("## Tidak ter-rate (dengan alasan)");
  for (const u of unrated) {
    md.push(
      `- ${u.fixture.home_team_name} vs ${u.fixture.away_team_name} — ${u.fixture.competition_name}, kickoff ${wib(u.fixture.utc_date)}: ${u.reason}`,
    );
  }
  md.push("");
  fs.writeFileSync(
    path.join(process.cwd(), "tasks", "pick-slate-latest.md"),
    md.join("\n"),
  );

  console.log(
    `\nSelesai: rated ${rated.length}, unrated ${unrated.length}, kaki A/B/C = ${legsByGrade.A}/${legsByGrade.B}/${legsByGrade.C}, paket tersimpan ${packagesWritten}, kembar tertaut dilewati ${linkedTwinsSkipped}, kembar tak tertaut ditahan ${unlinkedTwinsSkipped}, ledger live-run +${ledgerWritten}.`,
  );
  console.log("Tertulis: tasks/pick-slate-latest.json + tasks/pick-slate-latest.md");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
