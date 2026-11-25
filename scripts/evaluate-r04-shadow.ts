/**
 * R-04 — EVALUASI SHADOW (read-only terhadap produksi; tidak menulis data/).
 *
 * Pertanyaan pemilik (keputusan 26 Nov 2026): fixture fd_ di EPL / La Liga /
 * Bundesliga / La Liga 2 saat ini dihargai fit warisan football-data beku
 * 11–12 Okt 2026 (div E0/SP1/D1/SP2 di data/calibrated_ratings.json, tanpa
 * field source/calibrationStatus — tidak pernah di-fit ulang calibrate).
 * Dua opsi perbaikan: (A) jalur fit-ulang fit warisan dari data fd segar,
 * (B) arahkan fixture fd_ di 4 liga itu ke fit SM segar. Opsi ketiga yang
 * selalu dinilai: status quo (SQ).
 *
 * DESAIN PRA-REGISTRASI (dikunci sebelum hasil dilihat):
 * - Populasi: laga selesai di CSV football-data musim 2627 (unduh segar
 *   lewat lib/feeds/football-data.fetchSeasonCsv — sumber yang sama dengan
 *   importer produksi) untuk div E0/SP1/D1/SP2, bertanggal KETAT sesudah
 *   vintage fit warisan liga itu (E0/SP1/SP2 > 2026-10-12; D1 > 2026-10-11).
 *   Inilah universe fixture fd_ yang beresolusi di liga terdampak.
 * - Jendela PRIMER: tanggal > 2026-11-06. Alasan: fit SM di file produksi
 *   dilatih dari hasil SM ≤ 2026-11-06 (umpan SM berhenti 7 Nov) dan fit
 *   warisan beku ≤ 12 Okt — di jendela ini kedua lengan PASIF strictly
 *   out-of-sample; lengan A di-fit as-of per laga (point-in-time ketat).
 *   Jendela SEKUNDER: seluruh populasi pasca-vintage (lengan B sebagian
 *   in-sample di awal jendela — dilaporkan dengan catatan itu).
 * - Lengan (lapisan fit saja; komposisi hilir Dixon-Coles identik):
 *   SQ = entri warisan persis dari data/calibrated_ratings.json di disk.
 *   B  = entri SM (SM8/SM564/SM82/SM567) persis dari file yang sama.
 *   A  = fit ulang as-of tanggal laga dari korpus CSV fd segar 6 musim
 *        (2122..2627, baris bertanggal < tanggal laga) memakai fitter
 *        produksi lib/quant/fit.fitLeagueRatings (half-life 365 hari,
 *        shrink κ=10) dan rho=0 (kebijakan rho produksi saat ini).
 *   Pencarian tim SQ/B memakai lookupTeamRating repo (normalizer + indeks
 *   alias bentuk-nama) atas nama tim bentuk-CSV — persis jalur saji.
 * - Dukungan bersama (common support): metrik berpasangan hanya atas laga
 *   yang ketiga lengan berhasil menghargai (kedua tim ketemu di roster
 *   lengan; lengan A juga mensyaratkan ≥30 laga latih as-of). Cakupan
 *   per lengan atas seluruh populasi dilaporkan terpisah.
 * - Metrik: log-loss 1X2 (−ln p hasil aktual, jepit 1e-12), rata-rata
 *   |Δλ| & |Δμ| berpasangan vs SQ, per liga + pooled. CI 95% selisih
 *   log-loss berpasangan (A−SQ, B−SQ) via bootstrap atas laga pooled
 *   jendela primer (4.000 repetisi, seed 20261126).
 * - Aturan keputusan (dikunci): lengan MENANG bila di jendela primer
 *   pooled ΔLL < 0 DAN batas atas CI 95% < 0. Bila tak ada yang menang
 *   penuh, tingkat "tidak lebih buruk": ΔLL ≤ 0, batas atas CI < +0,005,
 *   dan ΔLL jendela sekunder < 0 → lengan dengan LL primer terendah
 *   diadopsi. Bila A dan B sama-sama lolos dan selisih keduanya tak
 *   terpisahkan (CI ΔLL A−B memuat 0), B didahulukan (ruang lingkup 4
 *   liga, tanpa perubahan jalur data). Bila tak ada lengan yang lolos
 *   tingkat mana pun → TIDAK ADA perubahan serving.
 *
 * Keluaran: tasks/r04/evidence/shadow-results.json + ringkasan konsol.
 * Produksi tidak disentuh: tidak ada penulisan ke data/, DB hanya dibaca
 * lewat file JSON; CSV diunduh ke memori.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fetchSeasonCsv, type FdRawRow } from "../lib/feeds/football-data";
import { fitLeagueRatings, selectTrainingRows, type FitMatchRow } from "../lib/quant/fit";
import { calculateDixonColes } from "../lib/quant/dixon-coles";
import { loadCalibratedRatings, lookupTeamRating, type CalibratedRatingsFile } from "../lib/quant/ratings-loader";
import { normalizeTeamName } from "../lib/quant/team-normalizer";

const DIVS = ["E0", "SP1", "D1", "SP2"] as const;
const SM_DIV: Record<string, string> = { E0: "SM8", SP1: "SM564", D1: "SM82", SP2: "SM567" };
const FREEZE: Record<string, string> = { E0: "2026-10-12", SP1: "2026-10-12", SP2: "2026-10-12", D1: "2026-10-11" };
const PRIMARY_AFTER = "2026-11-06";
const SEASONS = ["2122", "2223", "2324", "2425", "2526", "2627"];
const MIN_TRAIN = 30;
const BOOT_SEED = 20261126;
const BOOT_REPS = 4000;

function fdDateToIso(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

interface EvalMatch {
  div: string; date: string; home: string; away: string; fthg: number; ftag: number;
}

interface ArmScore { lambda: number; mu: number; p: [number, number, number]; ll: number }

function outcomeIdx(m: EvalMatch): 0 | 1 | 2 {
  return m.fthg > m.ftag ? 0 : m.fthg === m.ftag ? 1 : 2;
}

function scoreFromEntry(
  data: CalibratedRatingsFile, divKey: string, m: EvalMatch,
): ArmScore | null {
  const lg = data.leagues[divKey];
  if (!lg) return null;
  const h = lookupTeamRating(data, divKey, normalizeTeamName(m.home));
  const a = lookupTeamRating(data, divKey, normalizeTeamName(m.away));
  if (!h || !a) return null;
  const dc = calculateDixonColes({
    homeAttack: h.attack, homeDefense: h.defense,
    awayAttack: a.attack, awayDefense: a.defense,
    homeAdvantage: lg.homeAdvantage, leagueAvgGoals: lg.leagueAvgGoals, rho: lg.rho,
  });
  const p: [number, number, number] = [dc.prob_home_win, dc.prob_draw, dc.prob_away_win];
  return { lambda: dc.lambda, mu: dc.mu, p, ll: -Math.log(Math.max(p[outcomeIdx(m)], 1e-12)) };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main(): Promise<void> {
  const ratingsPath = path.join(process.cwd(), "data", "calibrated_ratings.json");
  const ratingsRaw = fs.readFileSync(ratingsPath, "utf8");
  const ratingsSha = createHash("sha256").update(ratingsRaw).digest("hex");
  const data = loadCalibratedRatings();
  if (!data) throw new Error("calibrated_ratings.json tidak termuat");

  // --- Muat korpus fd segar + populasi evaluasi ---
  const corpus: Record<string, FitMatchRow[]> = {};
  const corpusInfo: Record<string, { perSeason: Record<string, number>; maxDate: string }> = {};
  const population: EvalMatch[] = [];
  for (const div of DIVS) {
    corpus[div] = [];
    corpusInfo[div] = { perSeason: {}, maxDate: "" };
    for (const season of SEASONS) {
      const rows: FdRawRow[] | null = await fetchSeasonCsv(div, season);
      if (!rows) { corpusInfo[div].perSeason[season] = 0; continue; }
      let n = 0;
      for (const r of rows) {
        const iso = fdDateToIso(r.Date ?? "");
        const fthg = Number(r.FTHG), ftag = Number(r.FTAG);
        if (!iso || !r.HomeTeam || !r.AwayTeam || !Number.isFinite(fthg) || !Number.isFinite(ftag) || r.FTHG === "" || r.FTAG === "") continue;
        n += 1;
        if (iso > corpusInfo[div].maxDate) corpusInfo[div].maxDate = iso;
        corpus[div].push({
          competition_id: div, season, utc_date: iso,
          home_team_id: r.HomeTeam, away_team_id: r.AwayTeam,
          home_score: fthg, away_score: ftag,
        });
        if (season === "2627" && iso > FREEZE[div]) {
          population.push({ div, date: iso, home: r.HomeTeam, away: r.AwayTeam, fthg, ftag });
        }
      }
      corpusInfo[div].perSeason[season] = n;
    }
    corpus[div].sort((x, y) => x.utc_date.localeCompare(y.utc_date));
  }
  population.sort((x, y) => x.date.localeCompare(y.date));

  // --- Lengan A: fit as-of (cache per div+tanggal) ---
  const fitCache = new Map<string, ReturnType<typeof fitLeagueRatings>>();
  const scoreA = (m: EvalMatch): ArmScore | null => {
    const key = `${m.div}|${m.date}`;
    if (!fitCache.has(key)) {
      const train = selectTrainingRows(corpus[m.div], m.date);
      fitCache.set(key, train.length >= MIN_TRAIN ? fitLeagueRatings(train, {
        nowMs: Date.parse(`${m.date}T00:00:00Z`), halfLifeDays: 365, shrinkKappa: 10,
      }) : null);
    }
    const fit = fitCache.get(key);
    if (!fit) return null;
    const ha = fit.attack.get(m.home), hd = fit.defense.get(m.home);
    const aa = fit.attack.get(m.away), ad = fit.defense.get(m.away);
    if (ha == null || hd == null || aa == null || ad == null) return null;
    const dc = calculateDixonColes({
      homeAttack: ha, homeDefense: hd, awayAttack: aa, awayDefense: ad,
      homeAdvantage: fit.homeAdvantage, leagueAvgGoals: fit.leagueAvgGoals, rho: 0,
    });
    const p: [number, number, number] = [dc.prob_home_win, dc.prob_draw, dc.prob_away_win];
    return { lambda: dc.lambda, mu: dc.mu, p, ll: -Math.log(Math.max(p[outcomeIdx(m)], 1e-12)) };
  };

  // --- Skor semua lengan ---
  interface Scored extends EvalMatch { sq: ArmScore | null; b: ArmScore | null; a: ArmScore | null }
  const scored: Scored[] = population.map((m) => ({
    ...m,
    sq: scoreFromEntry(data, m.div, m),
    b: scoreFromEntry(data, SM_DIV[m.div], m),
    a: scoreA(m),
  }));

  const summarize = (rows: Scored[]) => {
    const common = rows.filter((r) => r.sq && r.b && r.a);
    const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    const arm = (pick: (r: Scored) => ArmScore | null) => ({
      coverage: rows.filter((r) => pick(r)).length,
      llCommon: mean(common.map((r) => pick(r)!.ll)),
      meanLambda: mean(common.map((r) => pick(r)!.lambda)),
      meanMu: mean(common.map((r) => pick(r)!.mu)),
    });
    return {
      nPopulation: rows.length,
      nCommon: common.length,
      sq: arm((r) => r.sq), b: arm((r) => r.b), a: arm((r) => r.a),
      meanAbsDLambdaB: mean(common.map((r) => Math.abs(r.b!.lambda - r.sq!.lambda))),
      meanAbsDMuB: mean(common.map((r) => Math.abs(r.b!.mu - r.sq!.mu))),
      meanAbsDLambdaA: mean(common.map((r) => Math.abs(r.a!.lambda - r.sq!.lambda))),
      meanAbsDMuA: mean(common.map((r) => Math.abs(r.a!.mu - r.sq!.mu))),
      maxAbsDMuB: common.length ? Math.max(...common.map((r) => Math.abs(r.b!.mu - r.sq!.mu))) : null,
    };
  };

  const windows: Record<string, Scored[]> = {
    primary: scored.filter((r) => r.date > PRIMARY_AFTER),
    secondary: scored,
  };
  const summary: Record<string, unknown> = {};
  for (const [wname, rows] of Object.entries(windows)) {
    const perLeague: Record<string, unknown> = {};
    for (const div of DIVS) perLeague[div] = summarize(rows.filter((r) => r.div === div));
    summary[wname] = { pooled: summarize(rows), perLeague };
  }

  // --- Bootstrap berpasangan di jendela primer pooled (dukungan bersama) ---
  const primCommon = windows.primary.filter((r) => r.sq && r.b && r.a);
  const bootstrap = (pick: (r: Scored) => number) => {
    const diffs = primCommon.map(pick);
    const point = diffs.reduce((s, x) => s + x, 0) / diffs.length;
    const rnd = mulberry32(BOOT_SEED);
    const reps: number[] = [];
    for (let i = 0; i < BOOT_REPS; i++) {
      let s = 0;
      for (let j = 0; j < diffs.length; j++) s += diffs[Math.floor(rnd() * diffs.length)];
      reps.push(s / diffs.length);
    }
    reps.sort((x, y) => x - y);
    return { point, ciLo: reps[Math.floor(0.025 * BOOT_REPS)], ciHi: reps[Math.floor(0.975 * BOOT_REPS)] };
  };
  const boot = {
    nPrimaryCommon: primCommon.length,
    dLlBminusSq: bootstrap((r) => r.b!.ll - r.sq!.ll),
    dLlAminusSq: bootstrap((r) => r.a!.ll - r.sq!.ll),
    dLlAminusB: bootstrap((r) => r.a!.ll - r.b!.ll),
  };

  const out = {
    generatedAt: new Date().toISOString(),
    ratingsFile: { compiledAt: data.compiledAt, sha256: ratingsSha },
    corpusInfo,
    freeze: FREEZE, primaryAfter: PRIMARY_AFTER,
    summary, boot,
    rows: scored.map((r) => ({
      div: r.div, date: r.date, home: r.home, away: r.away, fthg: r.fthg, ftag: r.ftag,
      sq: r.sq && { lambda: r.sq.lambda, mu: r.sq.mu, ll: r.sq.ll },
      b: r.b && { lambda: r.b.lambda, mu: r.b.mu, ll: r.b.ll },
      a: r.a && { lambda: r.a.lambda, mu: r.a.mu, ll: r.a.ll },
    })),
  };
  const outDir = path.join(process.cwd(), "tasks", "r04", "evidence");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "shadow-results.json"), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ corpusInfo, summary, boot }, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
