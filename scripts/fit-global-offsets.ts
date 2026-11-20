/**
 * FIT GLOBAL OFFSETS (produksi) — fase kalibrasi piala.
 *
 * Fit δ per graf benua dari SELURUH hasil lintas-liga di store (resolver
 * produksi: tim dinilai dari fit domestik JSON pasca-rekalibrasi, persis
 * yang dikonsumsi jalur penyajian; comp_3498 ikut sebagai jangkar UCL
 * tambahan di sini saja), lalu menulis hasil ke struktur TERPADU yang
 * disetujui owner (tanpa file per-benua):
 *   1. data/league-canonical.json — cup_offset di entri liga domestik
 *      graf (identified/delta/anchors), cup_model di 17 kompetisi piala
 *      (status dari bukti OOS tasks/cup-oos.json), loader_special pensiun.
 *   2. data/calibrated_ratings.json — blok canonical.cupOffsets (parameter
 *      graf: referensi, globalAvg, cupHA) + status per kompetisi; entri
 *      JSON SM1085/SM1088 DIHAPUS (perlakuan liga-fit-nya digantikan model
 *      offset; calibrate-ratings menulisnya lagi tiap siklus dan langkah
 *      ini — berjalan SETELAH calibrate di rantai daily-refresh —
 *      menghapusnya lagi secara idempoten).
 *   3. league_calibration — baris 17 kompetisi: source='cup-offset',
 *      status dari OOS (tanpa bukti OOS → 'uncalibrated').
 *
 * Offline murni: hanya store lokal. CAF tidak di-fit (di luar scope).
 * Jalankan: npx tsx scripts/fit-global-offsets.ts
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { writeCandidateManifest } from "../lib/quant/model-manifest";
import {
  CUP_COMPETITIONS,
  anchorStoreIds,
  buildTeamDomesticMap,
  domesticLeaguesOfGraph,
  fitOffsets,
  graphForCountry,
  isDomesticLeagueEntry,
  loadFinishedMatches,
  loadTeamNames,
  makeProductionTeamResolver,
  pickReference,
  resolveAnchors,
  storeIdsOf,
  type GraphId,
  type RatingsFileLike,
} from "../lib/quant/cup-offset-fit";
import type { CanonicalLeague } from "../lib/quant/league-identity";

const DATA_DIR = path.join(process.cwd(), "data");
const nowIso = new Date().toISOString();

interface OosEntry {
  status: string;
  nTest: number;
  nRated: number;
  coverage: number; // fraksi 0..1
  model: { logLoss: number | null; slope: number | null };
  naive: { logLoss: number | null };
  reason: string;
}

interface RegistryFile {
  leagues: (CanonicalLeague & {
    cup_model?: { graph: string; status: string; fitted_at?: string };
    cup_offset?: { graph: string; delta: number | null; anchors: number; identified: boolean; fitted_at?: string };
    loader_special?: string;
  })[];
  [k: string]: unknown;
}

function main(): void {
  const registryPath = path.join(DATA_DIR, "league-canonical.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8")) as RegistryFile;
  const canonicals = registry.leagues;
  const canonicalById = new Map(canonicals.map((e) => [e.canonical_id, e]));

  const ratingsPath = path.join(DATA_DIR, "calibrated_ratings.json");
  const ratings = JSON.parse(fs.readFileSync(ratingsPath, "utf8")) as {
    leagues: Record<string, { teams: Record<string, unknown>; canonicalId?: string | null; [k: string]: unknown }>;
    canonical?: Record<string, unknown>;
    totalLeagues?: number;
    totalTeams?: number;
    [k: string]: unknown;
  };

  const matches = loadFinishedMatches();
  const teamNames = loadTeamNames();

  const domesticStoreToCanonical = new Map<string, string>();
  for (const e of canonicals) {
    if (!isDomesticLeagueEntry(e)) continue;
    for (const id of storeIdsOf(e)) domesticStoreToCanonical.set(id, e.canonical_id);
  }
  // Produksi: extraStoreIds (comp_3498 untuk UCL) IKUT sebagai jangkar.
  const cupStoreToCanonical = new Map<string, string>();
  for (const c of CUP_COMPETITIONS) {
    cupStoreToCanonical.set(c.canonicalId, c.canonicalId);
    for (const extra of c.extraStoreIds ?? []) cupStoreToCanonical.set(extra, c.canonicalId);
  }
  const teamDomestic = buildTeamDomesticMap(matches, canonicals, domesticStoreToCanonical);
  const resolver = makeProductionTeamResolver(
    ratings as unknown as RatingsFileLike,
    canonicalById as Map<string, CanonicalLeague>,
    teamDomestic,
    teamNames,
  );

  // Status per kompetisi dari bukti walk-forward (gerbang pradaftar di
  // backtest-cup-offsets.ts; di sini hanya DITERAPKAN, tidak diubah).
  const oosPath = path.join(process.cwd(), "tasks", "cup-oos.json");
  const oos = fs.existsSync(oosPath)
    ? (JSON.parse(fs.readFileSync(oosPath, "utf8")) as { competitions: Record<string, OosEntry> }).competitions
    : {};
  const statusFor = (cid: string): string => oos[cid]?.status ?? "uncalibrated";

  // ── Fit per graf ──────────────────────────────────────────────────────
  const graphs: GraphId[] = ["europe", "conmebol", "afc"];
  const graphOut: Record<string, {
    reference: string; globalAvgGoals: number; cupHomeAdvantage: number;
    nAnchorMatches: number; nLeaguesIdentified: number;
  }> = {};
  const deltaByLeague = new Map<string, { graph: GraphId; delta: number; anchors: number }>();
  const anchorsByGraph = new Map<GraphId, number>();

  for (const graph of graphs) {
    const graphLeagues = new Set(domesticLeaguesOfGraph(canonicals, graph).map((e) => e.canonical_id));
    const storeIds = new Set(anchorStoreIds(graph));
    const cupMatches = matches.filter((m) => storeIds.has(m.competition_id));
    const { anchors } = resolveAnchors(cupMatches, cupStoreToCanonical, graphLeagues, resolver, Date.now());
    const ref = pickReference(anchors);
    const fitted = ref ? fitOffsets(anchors, [...graphLeagues], ref) : null;
    anchorsByGraph.set(graph, anchors.length);
    if (!fitted || !ref) {
      console.log(`[${graph}] TIDAK ter-fit (jangkar=${anchors.length}, referensi=${ref}) — graf dilewati.`);
      continue;
    }
    graphOut[graph] = {
      reference: ref,
      globalAvgGoals: Number(fitted.globalAvg.toFixed(4)),
      cupHomeAdvantage: Number(fitted.cupHA.toFixed(4)),
      nAnchorMatches: anchors.length,
      nLeaguesIdentified: fitted.delta.size,
    };
    for (const [cid, d] of fitted.delta) {
      deltaByLeague.set(cid, { graph, delta: d, anchors: fitted.anchorsPerLeague.get(cid) ?? 0 });
    }
    const sorted = [...fitted.delta.entries()].sort((a, b) => b[1] - a[1]);
    const fmt = ([k, v]: [string, number]) => `${k} ${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
    console.log(
      `[${graph}] referensi=${ref} G=${fitted.globalAvg.toFixed(3)} cupHA=${fitted.cupHA.toFixed(3)} ` +
      `jangkar=${anchors.length} teridentifikasi=${fitted.delta.size} | terkuat: ${sorted.slice(0, 3).map(fmt).join(", ")} | terlemah: ${sorted.slice(-3).map(fmt).join(", ")}`,
    );
  }

  // ── 1. Registry kanonik: cup_model + cup_offset ──────────────────────
  const cupById = new Map(CUP_COMPETITIONS.map((c) => [c.canonicalId, c]));
  for (const entry of registry.leagues) {
    const cup = cupById.get(entry.canonical_id);
    if (cup) {
      entry.cup_model = { graph: cup.graph, status: statusFor(cup.canonicalId), fitted_at: nowIso };
      delete entry.loader_special;
      continue;
    }
    const graph = graphForCountry(entry.country);
    if (!graph || graph === "caf") continue; // di luar 3 graf (CAF: keputusan owner) — tidak disentuh
    const hit = deltaByLeague.get(entry.canonical_id);
    entry.cup_offset = hit
      ? { graph, delta: Number(hit.delta.toFixed(4)), anchors: hit.anchors, identified: true, fitted_at: nowIso }
      : { graph, delta: null, anchors: 0, identified: false, fitted_at: nowIso };
  }
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  console.log("league-canonical.json: cup_model di 17 kompetisi + cup_offset di liga domestik graf ditulis.");

  // ── 2. Ratings JSON: blok canonical.cupOffsets + hapus fit liga ACL ──
  const competitionsBlock: Record<string, { graph: string; status: string }> = {};
  for (const c of CUP_COMPETITIONS) competitionsBlock[c.canonicalId] = { graph: c.graph, status: statusFor(c.canonicalId) };
  ratings.canonical = {
    ...(ratings.canonical ?? {}),
    cupOffsets: { fittedAt: nowIso, graphs: graphOut, competitions: competitionsBlock },
  };
  for (const key of ["SM1085", "SM1088"]) {
    if (ratings.leagues[key]) {
      delete ratings.leagues[key];
      console.log(`calibrated_ratings.json: entri ${key} dihapus (perlakuan liga-fit digantikan model offset).`);
    }
  }
  ratings.totalLeagues = Object.keys(ratings.leagues).length;
  ratings.totalTeams = Object.values(ratings.leagues).reduce(
    (s, lg) => s + Object.keys(lg.teams ?? {}).length, 0,
  );
  fs.writeFileSync(ratingsPath, JSON.stringify(ratings, null, 2));
  console.log("calibrated_ratings.json: blok canonical.cupOffsets ditulis.");

  // Manifest kandidat (K4): skrip ini menulis ulang artefak rating
  // sesudah calibrate-ratings di rantai refresh, jadi kandidat disegarkan
  // lagi agar hash-nya mendeskripsikan file final. Manifest AKTIF tidak
  // disentuh — promosi hanya lewat scripts/promote-model.ts.
  try {
    const candidate = writeCandidateManifest(DATA_DIR, {
      generatedBy: "scripts/fit-global-offsets.ts",
    });
    console.log(
      `Manifest kandidat diperbarui: ${candidate.modelVersion} (${candidate.ratingsHash}).`,
    );
  } catch (err) {
    console.warn(
      `[manifest] gagal memperbarui manifest kandidat: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ── 3. league_calibration: baris 17 kompetisi (source='cup-offset') ──
  const ds = new DatabaseSync(path.join(DATA_DIR, "thestats_dataset.db"));
  // Langkah lain di rantai (telemetry) bisa memegang kunci tulis sesaat —
  // tunggu sampai 120 d alih-alih gagal seketika.
  ds.exec("PRAGMA busy_timeout = 120000");
  const ins = ds.prepare(
    `INSERT OR REPLACE INTO league_calibration
       (league_id, league_name, country, tier, status, n_matches, n_teams, telemetry_coverage,
        scale_ratio, fitted_at, source, notes, canonical_id)
     VALUES (?, ?, ?, NULL, ?, ?, NULL, ?, NULL, ?, 'cup-offset', ?, ?)`,
  );
  const countStmt = ds.prepare(
    "SELECT COUNT(*) AS n FROM matches WHERE competition_id = ? AND status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL",
  );
  for (const c of CUP_COMPETITIONS) {
    const entry = canonicalById.get(c.canonicalId);
    const o = oos[c.canonicalId];
    const nStore = (countStmt.get(c.canonicalId) as { n: number }).n;
    const notes = o
      ? `Model offset global graf ${c.graph} (δ liga domestik; ML Poisson atas ${anchorsByGraph.get(c.graph)} jangkar lintas-liga graf). Bukti OOS: ${o.reason}`
      : `Model offset global graf ${c.graph} — belum ada bukti OOS (tasks/cup-oos.json); uncalibrated sampai walk-forward membuktikannya.`;
    ins.run(
      c.canonicalId, entry?.name ?? c.canonicalId, entry?.country ?? null,
      statusFor(c.canonicalId), nStore,
      o ? o.coverage : null,
      nowIso, notes, c.canonicalId,
    );
  }
  ds.close();
  console.log("league_calibration: 17 baris kompetisi piala diperbarui (source='cup-offset').");
  console.log("Selesai.");
}

main();
