/**
 * WALK-FORWARD OOS — MODEL OFFSET GLOBAL PIALA → tasks/cup-oos.json.
 *
 * Protokol (seketat walk-forward liga Fase 3/rekalibrasi):
 *   - Per kompetisi piala, per musim t setelah musim pertama: SEMUA yang
 *     dipakai memprediksi musim t di-fit hanya dari data bertanggal
 *     SEBELUM musim t kompetisi itu mulai — fit domestik per liga di-fit
 *     ulang per lipatan (IPF + decay 365 + shrink κ=10, resep produksi),
 *     offset δ di-fit ulang dari laga jangkar latih, G/HA ikut latih.
 *   - Parameter produksi (JSON) TIDAK dipakai di sini — tidak ada bocor
 *     kekuatan tim musim berjalan ke prediksi musim itu.
 *   - comp_3498 (UCL ruang TheStats) dikecualikan dari walk-forward
 *     (bukan kompetisi saji; massanya <3% jangkar) — ia hanya jangkar
 *     tambahan di fit produksi.
 *   - Baseline naive per kompetisi: rata-rata gol kandang/tandang latih
 *     kompetisi itu sendiri (base rate), Dixon-Coles rho=0.
 *   - Subset leg-2 (proksi pertemuan kedua venue-tertukar) dilaporkan
 *     terpisah per kompetisi.
 *
 * Status gerbang piala (diputuskan di sini, diterapkan fit-global-offsets):
 *   calibrated : n_rated ≥ 100, cakupan ≥ 0.80, LL < naive, slope ∈ [0.70, 1.30]
 *   partial    : n_rated ≥ 30, cakupan ≥ 0.50, LL < naive (gagal satu kriteria calibrated)
 *   uncalibrated: sisanya (termasuk LL ≥ naive — model tidak mengalahkan base rate)
 *
 * Pakai: npx tsx scripts/backtest-cup-offsets.ts
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import {
  CUP_COMPETITIONS,
  buildTeamDomesticMap,
  domesticLeaguesOfGraph,
  fitDomesticFold,
  fitOffsets,
  flagLeg2,
  isDomesticLeagueEntry,
  loadFinishedMatches,
  loadTeamNames,
  metricsOf,
  pickReference,
  predictMatch,
  resolveAnchors,
  storeIdsOf,
  type AnchorMatch,
  type GraphId,
  type MatchPrediction,
  type ResolvedTeam,
  type StoreMatch,
} from "../lib/quant/cup-offset-fit";
import type { CanonicalLeague } from "../lib/quant/league-identity";
import { calculateDixonColes } from "../lib/quant/dixon-coles";

interface CompFold {
  season: string;
  boundary: string;
  nTest: number;
  nRated: number;
  reference: string | null;
}

interface CompResult {
  graph: GraphId;
  kind: string;
  folds: CompFold[];
  nTest: number;
  nRated: number;
  coverage: number;
  model: ReturnType<typeof metricsOf>;
  naive: ReturnType<typeof metricsOf>;
  leg2: { model: ReturnType<typeof metricsOf>; naive: ReturnType<typeof metricsOf> };
  status: "calibrated" | "partial" | "uncalibrated";
  reason: string;
}

function decideStatus(r: Omit<CompResult, "status" | "reason">): { status: CompResult["status"]; reason: string } {
  const { nRated, coverage, model, naive } = r;
  if (nRated < 30) {
    return { status: "uncalibrated", reason: `Bukti OOS tidak cukup: n_rated=${nRated} < 30 (total laga uji ${r.nTest}, cakupan ${coverage.toFixed(2)}).` };
  }
  if (model.logLoss >= naive.logLoss) {
    return { status: "uncalibrated", reason: `Model offset TIDAK mengalahkan base rate naive secara OOS: LL ${model.logLoss} >= naive ${naive.logLoss} (n=${nRated}).` };
  }
  if (coverage < 0.5) {
    return { status: "uncalibrated", reason: `Cakupan tim ter-rate terlalu rendah: ${coverage.toFixed(2)} < 0.50 (n_rated=${nRated}/${r.nTest}) walau LL ${model.logLoss} < naive ${naive.logLoss}.` };
  }
  const slopeOk = model.slope !== null && model.slope >= 0.7 && model.slope <= 1.3;
  if (nRated >= 100 && coverage >= 0.8 && slopeOk) {
    return { status: "calibrated", reason: `Lolos gerbang piala OOS: LL ${model.logLoss} < naive ${naive.logLoss} (n=${nRated}), cakupan ${coverage.toFixed(2)}, slope ${model.slope}.` };
  }
  const gaps: string[] = [];
  if (nRated < 100) gaps.push(`n_rated=${nRated} < 100`);
  if (coverage < 0.8) gaps.push(`cakupan ${coverage.toFixed(2)} < 0.80`);
  if (!slopeOk) gaps.push(`slope ${model.slope} di luar [0.70, 1.30]`);
  return { status: "partial", reason: `Mengalahkan naive (LL ${model.logLoss} < ${naive.logLoss}) tapi belum calibrated: ${gaps.join("; ")}.` };
}

function main() {
  const canonicals = (JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "league-canonical.json"), "utf8")) as { leagues: CanonicalLeague[] }).leagues;
  const matches = loadFinishedMatches();
  const teamNames = loadTeamNames();

  // Peta ID store domestik → kanonik (untuk keanggotaan tim).
  const domesticStoreToCanonical = new Map<string, string>();
  for (const e of canonicals) {
    if (!isDomesticLeagueEntry(e)) continue;
    for (const id of storeIdsOf(e)) domesticStoreToCanonical.set(id, e.canonical_id);
  }
  // ID store kompetisi piala → kanonik (tanpa extraStoreIds: comp_3498 di luar walk-forward).
  const cupStoreToCanonical = new Map<string, string>();
  for (const c of CUP_COMPETITIONS) cupStoreToCanonical.set(c.canonicalId, c.canonicalId);

  const graphs: GraphId[] = ["europe", "conmebol", "afc"];
  const compResults = new Map<string, CompResult>();
  const connectivity: Record<string, unknown> = {};

  for (const graph of graphs) {
    const graphLeagueEntries = domesticLeaguesOfGraph(canonicals, graph);
    const graphLeagues = new Set(graphLeagueEntries.map((e) => e.canonical_id));
    const cupStoreIds = new Set(CUP_COMPETITIONS.filter((c) => c.graph === graph).map((c) => c.canonicalId));
    const cupMatches = matches.filter((m) => cupStoreIds.has(m.competition_id));
    const leg2Idx = flagLeg2(cupMatches);
    const leg2Keys = new Set(
      [...leg2Idx].map((i) => {
        const m = cupMatches[i];
        return `${m.competition_id}|${m.utc_date}|${m.home_team_id}|${m.away_team_id}`;
      }),
    );
    const isLeg2 = (m: StoreMatch) => leg2Keys.has(`${m.competition_id}|${m.utc_date}|${m.home_team_id}|${m.away_team_id}`);

    // Cache per tanggal batas: peta keanggotaan + fit domestik + fit δ.
    interface FoldContext {
      teamDomestic: ReturnType<typeof buildTeamDomesticMap>;
      foldFits: Map<string, ReturnType<typeof fitDomesticFold>>;
      anchors: AnchorMatch[];
      offsetFit: ReturnType<typeof fitOffsets>;
      reference: string | null;
    }
    const ctxCache = new Map<string, FoldContext>();
    const getCtx = (boundary: string): FoldContext => {
      const hit = ctxCache.get(boundary);
      if (hit) return hit;
      const bMs = Date.parse(boundary);
      const trainDomestic = matches.filter((m) => domesticStoreToCanonical.has(m.competition_id) && Date.parse(m.utc_date) < bMs);
      const teamDomestic = buildTeamDomesticMap(trainDomestic, canonicals, domesticStoreToCanonical);
      const foldFits = new Map<string, ReturnType<typeof fitDomesticFold>>();
      for (const e of graphLeagueEntries) {
        const lm = trainDomestic.filter((m) => domesticStoreToCanonical.get(m.competition_id) === e.canonical_id);
        if (lm.length >= 10) foldFits.set(e.canonical_id, fitDomesticFold(lm, bMs));
      }
      const resolver = (teamId: string): ResolvedTeam | null => {
        const dom = teamDomestic.get(teamId);
        if (!dom || !graphLeagues.has(dom.canonicalId)) return null;
        const fit = foldFits.get(dom.canonicalId);
        if (!fit) return null;
        const att = fit.attack.get(teamId);
        const def = fit.defense.get(teamId);
        if (att === undefined || def === undefined) return null;
        return { domestic: dom.canonicalId, attack: att, defense: def };
      };
      const trainCup = cupMatches.filter((m) => Date.parse(m.utc_date) < bMs);
      const { anchors } = resolveAnchors(trainCup, cupStoreToCanonical, graphLeagues, resolver, bMs);
      const reference = pickReference(anchors);
      const offsetFit = reference ? fitOffsets(anchors, [...graphLeagues], reference) : null;
      const ctx: FoldContext = { teamDomestic, foldFits, anchors, offsetFit, reference };
      ctxCache.set(boundary, ctx);
      return ctx;
    };

    for (const comp of CUP_COMPETITIONS.filter((c) => c.graph === graph)) {
      const compMatches = cupMatches.filter((m) => m.competition_id === comp.canonicalId);
      const seasons = [...new Set(compMatches.map((m) => m.season))].sort();
      const folds: CompFold[] = [];
      const modelPreds: MatchPrediction[] = [];
      const naivePreds: MatchPrediction[] = [];
      const modelLeg2: MatchPrediction[] = [];
      const naiveLeg2: MatchPrediction[] = [];
      let nTest = 0;

      for (let si = 1; si < seasons.length; si++) {
        const season = seasons[si];
        const test = compMatches.filter((m) => m.season === season);
        const boundary = test.reduce((min, m) => (m.utc_date < min ? m.utc_date : min), test[0].utc_date);
        const ctx = getCtx(boundary);
        const trainComp = compMatches.filter((m) => Date.parse(m.utc_date) < Date.parse(boundary));
        // Naive base rate kompetisi dari latih.
        let hSum = 0, aSum = 0;
        for (const m of trainComp) { hSum += m.home_score; aSum += m.away_score; }
        const mu0 = trainComp.length > 0 ? aSum / trainComp.length : 1.2;
        const lam0 = trainComp.length > 0 ? hSum / trainComp.length : 1.5;
        const naiveDc = calculateDixonColes({
          homeAttack: 1, homeDefense: 1, awayAttack: 1, awayDefense: 1,
          leagueAvgGoals: Math.max(0.2, mu0), homeAdvantage: Math.max(0.2, lam0 / Math.max(0.2, mu0)), rho: 0,
        });
        let nRatedFold = 0;
        for (const m of test) {
          nTest += 1;
          const outcome = m.home_score > m.away_score ? "H" : m.home_score === m.away_score ? "D" : "A";
          const leg2 = isLeg2(m);
          if (!ctx.offsetFit) continue;
          // Resolusi tim lipatan untuk laga uji (parameter fit lipatan, kunci team_id).
          const domH = ctx.teamDomestic.get(m.home_team_id);
          const domA = ctx.teamDomestic.get(m.away_team_id);
          const fitH = domH ? ctx.foldFits.get(domH.canonicalId) : null;
          const fitA = domA ? ctx.foldFits.get(domA.canonicalId) : null;
          const attH = fitH?.attack.get(m.home_team_id);
          const defH = fitH?.defense.get(m.home_team_id);
          const attA = fitA?.attack.get(m.away_team_id);
          const defA = fitA?.defense.get(m.away_team_id);
          if (!domH || !domA || attH === undefined || defH === undefined || attA === undefined || defA === undefined) continue;
          const anchorLike: AnchorMatch = {
            competition_id: comp.canonicalId, season: m.season, utc_date: m.utc_date,
            homeLeague: domH.canonicalId, awayLeague: domA.canonicalId,
            attH, defH, attA, defA,
            homeGoals: m.home_score, awayGoals: m.away_score, weight: 1,
            crossLeague: domH.canonicalId !== domA.canonicalId,
          };
          const pred = predictMatch(anchorLike, ctx.offsetFit.delta, ctx.offsetFit.globalAvg, ctx.offsetFit.cupHA);
          if (!pred) continue;
          nRatedFold += 1;
          // Naive dicatat HANYA untuk laga yang sama dengan prediksi model —
          // perbandingan gerbang harus berpasangan (apel-ke-apel).
          const np: MatchPrediction = { pHome: naiveDc.prob_home_win, pDraw: naiveDc.prob_draw, pAway: naiveDc.prob_away_win, outcome, leg2 };
          naivePreds.push(np);
          const mp: MatchPrediction = { ...pred, outcome, leg2 };
          modelPreds.push(mp);
          if (leg2) { modelLeg2.push(mp); naiveLeg2.push(np); }
        }
        folds.push({ season, boundary, nTest: test.length, nRated: nRatedFold, reference: ctx.reference });
      }

      const partial: Omit<CompResult, "status" | "reason"> = {
        graph, kind: comp.kind, folds,
        nTest, nRated: modelPreds.length,
        coverage: nTest > 0 ? modelPreds.length / nTest : 0,
        model: metricsOf(modelPreds),
        naive: metricsOf(naivePreds),
        leg2: { model: metricsOf(modelLeg2), naive: metricsOf(naiveLeg2) },
      };
      const { status, reason } = decideStatus(partial);
      compResults.set(comp.canonicalId, { ...partial, status, reason });
    }

    // Konektivitas graf (data penuh): penampilan liga di JANGKAR TER-RESOLVE
    // konteks batas terjauh — liga tanpa jangkar ter-resolve = tidak
    // teridentifikasi, seketat definisi fit produksi.
    const allCtx = getCtx("2999-01-01");
    const perLeague = new Map<string, number>();
    for (const m of allCtx.anchors) {
      perLeague.set(m.homeLeague, (perLeague.get(m.homeLeague) ?? 0) + 1);
      perLeague.set(m.awayLeague, (perLeague.get(m.awayLeague) ?? 0) + 1);
    }
    const withFit = graphLeagueEntries.filter((e) => e.fits.length > 0).map((e) => e.canonical_id);
    const identified = [...perLeague.entries()].filter(([, n]) => n > 0).map(([l]) => l);
    const thin = [...perLeague.entries()].filter(([, n]) => n > 0 && n < 15).map(([l, n]) => ({ league: l, anchors: n }));
    const holes = withFit.filter((l) => !perLeague.has(l));
    connectivity[graph] = {
      leaguesInGraph: graphLeagueEntries.length,
      leaguesWithFits: withFit.length,
      identifiedLeagues: identified.length,
      thin,
      holes,
      anchorMatchesResolved: allCtx.anchors.length,
    };
  }

  // -------------------------------------------------------------------------
  // Audit tambahan (di luar sistem offset — enumerasi jujur)
  // -------------------------------------------------------------------------
  const ds = new DatabaseSync(path.join(process.cwd(), "data", "thestats_dataset.db"), { readOnly: true });
  const countComp = (id: string) =>
    (ds.prepare("SELECT COUNT(*) AS n FROM matches WHERE competition_id = ? AND status='finished' AND home_score IS NOT NULL").get(id) as { n: number }).n;
  const cafComps: Record<string, number> = { "sm:1107": countComp("sm:1107"), "sm:860 (Botola Pro, domestik Maroko)": countComp("sm:860"), "sm:830 (Premier League Mesir)": countComp("sm:830"), "sm:806 (Premier League Afrika Selatan)": countComp("sm:806") };
  const ratings = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "calibrated_ratings.json"), "utf8")) as {
    leagues: Record<string, { leagueName?: string; teams: Record<string, unknown> }>;
  };
  const womenTeamNames = new Set<string>();
  for (const lg of Object.values(ratings.leagues)) {
    if (/women/i.test(lg.leagueName ?? "")) for (const t of Object.keys(lg.teams)) womenTeamNames.add(t.toLowerCase());
  }
  const uwcl = matches.filter((m) => m.competition_id === "sm:1419");
  let uwclBoth = 0;
  for (const m of uwcl) {
    const h = teamNames.get(m.home_team_id)?.toLowerCase();
    const a = teamNames.get(m.away_team_id)?.toLowerCase();
    if (h && a && womenTeamNames.has(h) && womenTeamNames.has(a)) uwclBoth += 1;
  }
  const audit = {
    caf: {
      note: "Kompetisi CAF hadir di store tapi DI LUAR scope yang disetujui — tidak di-fit, menunggu keputusan owner.",
      competitions: cafComps,
      cafChampionsLeagueCanonical: "sm:1107 (saat ini ter-fit sebagai liga, status partial — perilaku lama rekalibrasi)",
    },
    womensChampionsLeague: {
      canonical: "sm:1419",
      matches: uwcl.length,
      bothTeamsInWomensFits: uwclBoth,
      note: "Ekosistem wanita terpisah dari graf pria; cakupan fit domestik wanita di store nyaris nol di luar WSL — tidak dilayani model offset pria (bahaya tabrakan nama klub pria/wanita dijaga: kompetisi ini tidak mendapat cup_model).",
    },
    friendlies: {
      "sm:1082 Friendly International": countComp("sm:1082"),
      "sm:2451 Club Friendlies 3": countComp("sm:2451"),
      "sm:2452 Club Friendlies 4": countComp("sm:2452"),
      "sm:2450 Club Friendlies 2": countComp("sm:2450"),
      "sm:1101 Club Friendlies 1": countComp("sm:1101"),
      note: "Friendly = laga ekshibisi (rotasi bebas, tanpa taruhan kompetitif) dan tim nasional tidak punya fit liga domestik — dikeluarkan dari jangkar maupun penyajian by design.",
    },
    intercontinental: { "sm:1452 FIFA Intercontinental Cup": countComp("sm:1452"), note: "Lintas benua — tidak ada graf bersama; di luar model offset per-benua v1." },
  };

  const out = {
    generated_at: new Date().toISOString(),
    protocol: "walk-forward per kompetisi: fit domestik + δ hanya dari data sebelum musim uji; naive = base rate kandang/tandang latih kompetisi; rho=0; leg-2 = proksi pertemuan kedua venue-tertukar",
    gate: {
      calibrated: "n_rated>=100, coverage>=0.80, LL<naive, slope in [0.70,1.30]",
      partial: "n_rated>=30, coverage>=0.50, LL<naive, gagal satu kriteria calibrated",
      uncalibrated: "sisanya (termasuk LL>=naive atau bukti tak cukup)",
    },
    competitions: Object.fromEntries(compResults),
    connectivity,
    audit,
  };
  fs.writeFileSync(path.join(process.cwd(), "tasks", "cup-oos.json"), JSON.stringify(out, null, 2));

  console.log("=== WALK-FORWARD OOS PIALA ===");
  for (const [id, r] of compResults) {
    console.log(
      `${id} [${r.graph}/${r.kind}] uji=${r.nTest} rated=${r.nRated} cov=${r.coverage.toFixed(2)} LL=${r.model.logLoss} vs naive=${r.naive.logLoss} slope=${r.model.slope} brier=${r.model.brier} | leg2 n=${r.leg2.model.n} LL=${r.leg2.model.logLoss} vs naive=${r.leg2.naive.logLoss} → ${r.status.toUpperCase()}`,
    );
  }
  console.log("\nKonektivitas:", JSON.stringify(connectivity, null, 1));
  console.log("\nAudit:", JSON.stringify(audit, null, 1));
  console.log("\nDitulis: tasks/cup-oos.json");
}

main();
