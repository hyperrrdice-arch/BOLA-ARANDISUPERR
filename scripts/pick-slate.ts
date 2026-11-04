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
 *   - ledger data/picks.db: kaki fixture live ditulis dengan source
 *     'live-run' (flag --no-ledger untuk menonaktifkan). Fixture yang sudah
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
 * OFFLINE PENUH — tidak ada panggilan Sportmonks/TheStats. Env dijalankan
 * dengan resep driver E2E: .env.local dimuat hanya agar impor planner 🔒
 * tidak throw (base URL NineRouter), lalu STATS_API_KEY dan
 * SPORTMONKS_API_TOKEN dikosongkan paksa sebelum modul pipeline diimpor
 * secara dinamis → klien API throw sebelum fetch.
 *
 * Pakai:
 *   NODE_OPTIONS="--env-file=.env.local" npx tsx scripts/pick-slate.ts [--hours 48] [--no-ledger] [--limit N]
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
import { loadCalibratedRatings, resolveDivForMatch } from "../lib/quant/ratings-loader";
import { normalizeTeamName } from "../lib/quant/team-normalizer";
import { parseFixtureDetail } from "../lib/odds/sportmonks-adapter";
import { pickSmQuotes } from "../lib/odds/sportmonks-wire";
import { stripVigShin, stripVigTwoWay } from "../lib/quant/vig-stripping";
import {
  pickLegs,
  combineParlay,
  rebuildMatrix,
  type GateStatus,
  type PickLeg,
  type Population,
} from "../lib/picks/engine";
import { recordPicks, type PickInput } from "../lib/picks/ledger";

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
  home_team_name: string;
  away_team_name: string;
}

interface RatedFixture {
  fixture: FixtureRow;
  canonical_id: string | null;
  gate_status: GateStatus;
  population: Population;
  lambda: number;
  mu: number;
  legs: PickLeg[];
  group_key: string;
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

async function main() {
  const args = process.argv.slice(2);
  const hours = Number(args[args.indexOf("--hours") + 1]) || 48;
  const limit = args.includes("--limit")
    ? Number(args[args.indexOf("--limit") + 1]) || Infinity
    : Infinity;
  const writeLedger = !args.includes("--no-ledger");

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
  const ratings = loadCalibratedRatings();

  const fixtures = upDb
    .prepare(
      `SELECT match_id, competition_id, competition_name, competition_country, utc_date, home_team_name, away_team_name
       FROM upcoming_fixtures
       WHERE utc_date >= ? AND utc_date < ? AND status = 'scheduled'
       ORDER BY utc_date ASC`,
    )
    .all(iso(now), iso(windowEnd)) as unknown as FixtureRow[];

  console.log(
    `Jendela ${iso(now)} → ${iso(windowEnd)} (${hours} jam): ${fixtures.length} fixture terjadwal.`,
  );

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

  const marketProbsFor = (fx: FixtureRow, smId: number | null) => {
    const out: Record<string, number> = {};
    const newest = dsDb
      .prepare(
        "SELECT captured_utc, payload_json FROM match_odds_history WHERE match_id = ? ORDER BY captured_utc DESC LIMIT 1",
      )
      .get(fx.match_id) as { captured_utc: string; payload_json: string } | undefined;
    if (!newest || smId === null) return out;
    try {
      const envelope = JSON.parse(newest.payload_json) as { odds?: unknown[] };
      const detail = parseFixtureDetail(smId, { data: { odds: envelope.odds ?? [] } });
      const quotes = pickSmQuotes(detail, newest.captured_utc);
      if (!quotes) return out;
      if (quotes.home_last && quotes.draw_last && quotes.away_last) {
        const shin = stripVigShin(quotes.home_last, quotes.draw_last, quotes.away_last);
        if (shin.fair_prob) {
          out["1x2:1"] = shin.fair_prob.home;
          out["1x2:x"] = shin.fair_prob.draw;
          out["1x2:2"] = shin.fair_prob.away;
        }
      }
      if (quotes.total_goals_over_2_5 && quotes.under_2_5) {
        const two = stripVigTwoWay(quotes.total_goals_over_2_5, quotes.under_2_5);
        out["ou25:over"] = two.fair_prob.optionA;
        out["ou25:under"] = two.fair_prob.optionB;
      }
    } catch {
      /* payload tidak ter-parse → probabilitas pasar absen (null), bukan karangan */
    }
    return out;
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

  const rated: RatedFixture[] = [];
  const unrated: UnratedFixture[] = [];
  const ledgerRows: PickInput[] = [];
  let processed = 0;

  for (const fx of fixtures) {
    if (processed >= limit) break;
    processed++;
    const tag = `[${processed}/${Math.min(fixtures.length, limit)}] ${fx.home_team_name} vs ${fx.away_team_name}`;
    const t0 = Date.now();

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
    if (gate === "uncalibrated") {
      unrated.push({
        fixture: fx,
        reason: `kompetisi uncalibrated (${fx.competition_name}) — tanpa kaki per aturan gerbang`,
      });
      console.log(`${tag} → unrated: uncalibrated`);
      continue;
    }

    // --- Pipeline offline (jalur yang sama dengan run-one-analysis).
    let legs: PickLeg[] | null = null;
    let ratedMeta: Omit<RatedFixture, "fixture" | "legs" | "group_key"> | null = null;
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

      if (gateFinal === "uncalibrated") {
        failReason = "paket kuant melayani status uncalibrated — tanpa kaki";
      } else if (isCup && !md?.cupOffset) {
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
        legs = pickLegs({
          matrix,
          gate_status: gateFinal,
          population,
          market_probs: marketProbsFor(fx, smId),
          sm_probs: smProbsFor(smId),
        });
        ratedMeta = {
          canonical_id: md?.leagueResolution?.canonicalId ?? canonicalId,
          gate_status: gateFinal,
          population,
          lambda: pure.dcOutput.lambda,
          mu: pure.dcOutput.mu,
        };
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
      legs,
      group_key: `${normalizeTeamName(fx.home_team_name)}|${normalizeTeamName(fx.away_team_name)}|${fx.utc_date}`,
    };
    rated.push(entry);
    console.log(
      `${tag} → rated (${entry.gate_status}/${entry.population}) ${legs.length} kaki (${dt}s)`,
    );

    if (writeLedger && !alreadyRecorded.has(fx.match_id)) {
      for (const leg of legs) {
        ledgerRows.push({
          match_id: fx.match_id,
          competition_canonical_id: entry.canonical_id,
          kickoff_utc: fx.utc_date,
          market: leg.market,
          selection: leg.selection,
          model_prob: leg.model_prob,
          market_prob: leg.market_prob,
          sm_prob: leg.sm_prob,
          gate_status: entry.gate_status,
          grade: leg.grade,
          source: "live-run",
          notes:
            `pick-slate fase B; eff=${leg.effective_prob.toFixed(4)} ${leg.effective_source}` +
            (leg.band ? ` pita ${leg.band} n=${leg.band_n}` : ""),
        });
      }
    }
  }

  let ledgerWritten = 0;
  if (writeLedger && ledgerRows.length > 0) {
    ledgerWritten = recordPicks(ledgerRows);
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
  const takeDistinct = (
    pool: typeof flatLegs,
    n: number,
    excludeGroups = new Set<string>(),
  ) => {
    const used = new Set(excludeGroups);
    const picked: typeof flatLegs = [];
    for (const item of pool) {
      if (used.has(item.r.group_key)) continue;
      used.add(item.r.group_key);
      picked.push(item);
      if (picked.length === n) break;
    }
    return picked;
  };
  const toUnits = (items: typeof flatLegs) =>
    items.map(({ r, leg }) => ({
      label: `${r.fixture.home_team_name} vs ${r.fixture.away_team_name} — ${leg.market}/${leg.selection} [${leg.grade}]`,
      stated_prob: leg.model_prob,
      effective_prob: leg.effective_prob,
    }));

  const utama = takeDistinct(byGradeEff, 4);
  const aman = takeDistinct(
    byEff.filter(({ leg }) => leg.grade !== "C"),
    3,
  );
  const alternatif = takeDistinct(
    byGradeEff,
    3,
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
      ledger_live_run_rows_written: ledgerWritten,
      ledger_skipped_already_recorded: writeLedger
        ? rated.filter((r) => alreadyRecorded.has(r.fixture.match_id)).length
        : 0,
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
      lambda: r.lambda,
      mu: r.mu,
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
      `baris ledger live-run tertulis **${ledgerWritten}**.`,
  );
  md.push("");
  md.push(
    "Probabilitas efektif = hit-rate empiris lab Fase A untuk sel (pasar, pita) — dipakai untuk matematika parlay. " +
      "Kombinasi dilaporkan sebagai RANGE: efektif = estimasi titik, produk stated = batas atas (lab mengukur produk independensi melebih-lebihkan survival ~1,5–4pp).",
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
      `### ${r.fixture.home_team_name} vs ${r.fixture.away_team_name} — ${r.fixture.competition_name} (${r.gate_status}${r.population === "cup" ? ", piala/offset" : ""})`,
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
    `\nSelesai: rated ${rated.length}, unrated ${unrated.length}, kaki A/B/C = ${legsByGrade.A}/${legsByGrade.B}/${legsByGrade.C}, ledger live-run +${ledgerWritten}.`,
  );
  console.log("Tertulis: tasks/pick-slate-latest.json + tasks/pick-slate-latest.md");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
