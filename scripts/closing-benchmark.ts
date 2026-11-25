/**
 * CLOSING-LINE BENCHMARK SKALA BESAR — model walk-forward vs Pinnacle closing.
 *
 * PENGUKURAN MURNI. Tidak mengubah perilaku engine/serving, tidak menulis DB.
 * Metode dikunci di tasks/closing-benchmark-report.md §1 SEBELUM run ini.
 *
 * Sumber:
 *  - Probabilitas model: data/picks.db source='lab' (populasi walk-forward
 *    OOS parlay-lab; triple 1X2 + pair OU2.5 presisi penuh per match).
 *  - Identitas & skor model: data/thestats_dataset.db (matches + teams) pada
 *    match_id yang sama dengan pick lab.
 *  - Closing Pinnacle: file CSV football-data.co.uk di data/historical/raw/
 *    (96 file, 16 divisi × 6 musim). Kolom closing: PSCH/PSCD/PSCA (≤2526)
 *    atau PPCH/PPCD/PPCA (2627); OU: PC>2.5/PC<2.5 (≤2526 saja).
 *  - Vig-strip: stripVigShin (1X2) + stripVigTwoWay (OU2.5) dari
 *    lib/quant/vig-stripping.ts — implementasi proyek, bukan buatan baru.
 *  - Join: (divisi, tanggal UTC kickoff CSV, slug home, slug away) dengan
 *    normalizeTeamName + teamSlug (jalur importer free-feed). Fallback ±1
 *    hari hanya bila slug kedua tim cocok DAN skor sama. Setiap pasangan
 *    wajib lulus verifikasi skor lintas sumber (CSV vs dataset).
 *
 * Output: tasks/closing-benchmark.json + ringkasan ke stdout.
 * Pakai: npx tsx scripts/closing-benchmark.ts
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { stripVigShin, stripVigTwoWay } from "../lib/quant/vig-stripping";
import { normalizeTeamName } from "../lib/quant/team-normalizer";
import {
  parseCsv,
  toResultRow,
  num,
  teamSlug,
  FD_DIVISION_CODES,
  type FdRawRow,
} from "../lib/feeds/football-data";
import { dbPath } from "../lib/db/paths";

const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data", "historical", "raw");
const OUT_JSON = path.join(ROOT, "tasks", "closing-benchmark.json");

// ---------------------------------------------------------------------------
// Pemetaan divisi CSV → liga kanonis (via alias legacy-div league-canonical)
// ---------------------------------------------------------------------------
interface LeagueInfo {
  div: string;
  canonicalId: string;
  name: string;
}
function loadDivMap(): LeagueInfo[] {
  const reg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "league-canonical.json"), "utf8"),
  ) as { leagues: { canonical_id: string; name: string; aliases: { system: string; id: string }[] }[] };
  const fdCodes = new Set(FD_DIVISION_CODES);
  const out: LeagueInfo[] = [];
  for (const L of reg.leagues) {
    for (const a of L.aliases) {
      // Hanya kode divisi football-data asli — registry juga memuat alias
      // turunan seperti "master_T1" yang BUKAN kode file CSV.
      if (a.system === "legacy-div" && fdCodes.has(a.id)) {
        out.push({ div: a.id, canonicalId: L.canonical_id, name: L.name });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sisi model: pick lab + match dataset
// ---------------------------------------------------------------------------
interface LabMatch {
  matchId: string;
  canonicalId: string;
  dateUtc: string; // yyyy-mm-dd dari dataset utc_date
  homeName: string;
  awayName: string;
  homeGoals: number;
  awayGoals: number;
  p1x2: [number, number, number]; // [home, draw, away]
  pOuOver: number;
  pOuUnder: number;
}

function loadLabMatches(canonicalIds: Set<string>): LabMatch[] {
  const picksDb = new DatabaseSync(dbPath("picks.db"), { readOnly: true });
  const dsDb = new DatabaseSync(dbPath("thestats_dataset.db"), { readOnly: true });

  const pickRows = picksDb
    .prepare(
      `SELECT match_id, competition_canonical_id, market, selection, model_prob
       FROM picks WHERE source='lab' AND market IN ('1x2','ou25')`,
    )
    .all() as unknown as {
    match_id: string;
    competition_canonical_id: string;
    market: string;
    selection: string;
    model_prob: number;
  }[];

  interface Acc {
    canonicalId: string;
    p: Record<string, number>;
  }
  const byMatch = new Map<string, Acc>();
  for (const r of pickRows) {
    if (!canonicalIds.has(r.competition_canonical_id)) continue;
    let acc = byMatch.get(r.match_id);
    if (!acc) {
      acc = { canonicalId: r.competition_canonical_id, p: {} };
      byMatch.set(r.match_id, acc);
    }
    acc.p[`${r.market}|${r.selection}`] = r.model_prob;
  }

  const teamName = new Map<string, string>();
  for (const t of dsDb.prepare(`SELECT team_id, name FROM teams`).all() as unknown as {
    team_id: string;
    name: string;
  }[]) {
    teamName.set(t.team_id, t.name);
  }

  const out: LabMatch[] = [];
  const matchStmt = dsDb.prepare(
    `SELECT utc_date, home_team_id, away_team_id, home_score, away_score
     FROM matches WHERE match_id = ?`,
  );
  for (const [matchId, acc] of byMatch) {
    const h = acc.p["1x2|1"];
    const x = acc.p["1x2|x"];
    const a = acc.p["1x2|2"];
    const over = acc.p["ou25|over"];
    const under = acc.p["ou25|under"];
    if (h === undefined || x === undefined || a === undefined || over === undefined || under === undefined) {
      throw new Error(`pick lab tidak lengkap untuk ${matchId} — populasi berubah dari pre-registrasi`);
    }
    const m = matchStmt.get(matchId) as
      | { utc_date: string; home_team_id: string; away_team_id: string; home_score: number; away_score: number }
      | undefined;
    if (!m) throw new Error(`match dataset hilang untuk ${matchId}`);
    out.push({
      matchId,
      canonicalId: acc.canonicalId,
      dateUtc: m.utc_date.slice(0, 10),
      homeName: teamName.get(m.home_team_id) ?? "",
      awayName: teamName.get(m.away_team_id) ?? "",
      homeGoals: m.home_score,
      awayGoals: m.away_score,
      p1x2: [h, x, a],
      pOuOver: over,
      pOuUnder: under,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sisi closing: file CSV
// ---------------------------------------------------------------------------
interface CsvEntry {
  file: string;
  div: string;
  season: string;
  dateUtc: string;
  homeSlug: string;
  awaySlug: string;
  homeRaw: string;
  awayRaw: string;
  homeGoals: number;
  awayGoals: number;
  pin1x2: [number, number, number] | null; // odds desimal closing Pinnacle
  pinOu: [number, number] | null; // [over, under] odds desimal closing Pinnacle
}

interface FileInventory {
  file: string;
  div: string;
  season: string;
  rows: number;
  hasPscClosing: boolean; // PSCH* (≤2526)
  hasPpcClosing: boolean; // PPCH* (2627)
  hasPinOuClosing: boolean; // PC>2.5
  hasBttsCols: boolean;
  rowsWithPin1x2: number;
  rowsWithPinOu: number;
}

function slugOf(name: string): string {
  // Pra-lipat 'ı' (dotless i Turki) → 'i': teamSlug mengubah 'ı' menjadi '-'
  // (tidak terurai NFD) sehingga "Kasımpaşa" ≠ "Kasimpasa". Dilipat di kedua
  // sisi secara identik — deterministik, hanya untuk kunci join benchmark.
  return teamSlug(normalizeTeamName(name).replace(/ı/g, "i"));
}

/**
 * Alias residual SPESIFIK-BENCHMARK: nama dataset (Sportmonks) → nama CSV
 * (football-data) untuk klub yang sama, hanya bila slug ternormalisasi
 * tetap berbeda (nama pendek CSV vs nama resmi dataset). Setiap entri
 * diverifikasi manual sebagai klub yang sama; daftar ini juga disalin ke
 * tasks/closing-benchmark.json agar bisa diaudit.
 */
const RESIDUAL_TEAM_ALIASES: Record<string, string> = {
  // Spanyol (SP1)
  "Atlético de Madrid": "Ath Madrid",
  "Deportivo A Coruña": "La Coruna",
  "Girona FC": "Girona",
  "Levante UD": "Levante",
  "Racing Santander": "Santander",
  "Real Oviedo": "Oviedo",
  // Italia (I2)
  "Bari 1908": "Bari",
  "Calcio Padova": "Padova",
  "Hellas Verona": "Verona",
  // Prancis (F1/F2)
  "AS Monaco": "Monaco",
  "LOSC Lille": "Lille",
  "Olympique Lyonnais": "Lyon",
  "Olympique Marseille": "Marseille",
  "Paris Saint-Germain": "Paris SG",
  "RC Lens": "Lens",
  "RC Strasbourg": "Strasbourg",
  "Angers SCO": "Angers",
  "Grenoble Foot 38": "Grenoble",
  "Red Star FC": "Red Star",
  "Saint-Étienne": "St Etienne",
  "US Dunkerque": "Dunkerque",
  Pau: "Pau FC",
  // Yunani (G1)
  "AEK Athens": "AEK",
  "Iraklis 1908 FC": "Iraklis",
  Larissa: "Larisa",
  Levadiakos: "Levadeiakos",
  OFI: "OFI Crete",
  "Olympiacos F.C.": "Olympiakos",
  Panaitolikos: "Panetolikos",
  // Turki (T1) — "Buyuksehyr" adalah nama football-data untuk Başakşehir
  "Amed SK": "Amedspor",
  "Erzurumspor FK": "Erzurumspor",
  "Fatih Karagümrük": "Karagumruk",
  "Gaziantep F.K.": "Gaziantep",
  "Çorum FK": "Corum",
  "İstanbul Başakşehir": "Buyuksehyr",
  // Portugal (P1) — "CF Benfica" SENGAJA tidak dialias: klub berbeda dari SL Benfica
  "Estrela Amadora": "Estrela",
  "FC Porto": "Porto",
  "Sporting Braga": "Sp Braga",
  "Sporting CP": "Sp Lisbon",
  "Vitória Guimarães": "Guimaraes",
  // Jerman (D2)
  "DSC Arminia Bielefeld": "Bielefeld",
  "Darmstadt 98": "Darmstadt",
  "Dynamo Dresden": "Dresden",
  "Eintracht Braunschweig": "Braunschweig",
  "Energie Cottbus": "Cottbus",
  "FC Heidenheim": "Heidenheim",
  "FC Schalke 04": "Schalke 04",
  "FC St. Pauli": "St Pauli",
  "Hannover 96": "Hannover",
  "Hertha BSC": "Hertha",
  "Karlsruher SC": "Karlsruhe",
  "SpVgg Greuther Fürth": "Greuther Furth",
  "VfL Bochum 1848": "Bochum",
  "VfL Wolfsburg": "Wolfsburg",
};

function loadCsvEntries(): { entries: CsvEntry[]; inventory: FileInventory[] } {
  const files = fs.readdirSync(RAW_DIR).filter((f) => f.endsWith(".csv")).sort();
  const entries: CsvEntry[] = [];
  const inventory: FileInventory[] = [];
  for (const file of files) {
    const m = file.match(/^([A-Z0-9]+)_(\d{4})\.csv$/);
    if (!m) continue;
    const [, div, season] = m;
    const rows = parseCsv(fs.readFileSync(path.join(RAW_DIR, file), "utf8"));
    const header = rows.length > 0 ? Object.keys(rows[0]) : [];
    const inv: FileInventory = {
      file,
      div,
      season,
      rows: rows.length,
      hasPscClosing: header.includes("PSCH"),
      hasPpcClosing: header.includes("PPCH"),
      hasPinOuClosing: header.includes("PC>2.5"),
      hasBttsCols: header.some((h) => /BTTS/i.test(h)),
      rowsWithPin1x2: 0,
      rowsWithPinOu: 0,
    };
    for (const row of rows as FdRawRow[]) {
      const r = toResultRow(row);
      if (!r) continue;
      const psc: [number | null, number | null, number | null] = [num(row, "PSCH"), num(row, "PSCD"), num(row, "PSCA")];
      const ppc: [number | null, number | null, number | null] = [num(row, "PPCH"), num(row, "PPCD"), num(row, "PPCA")];
      const pin = psc.every((v) => v !== null) ? (psc as [number, number, number]) : ppc.every((v) => v !== null) ? (ppc as [number, number, number]) : null;
      const ouO = num(row, "PC>2.5");
      const ouU = num(row, "PC<2.5");
      const pinOu: [number, number] | null = ouO !== null && ouU !== null ? [ouO, ouU] : null;
      if (pin) inv.rowsWithPin1x2++;
      if (pinOu) inv.rowsWithPinOu++;
      entries.push({
        file,
        div,
        season,
        dateUtc: r.kickoffUtc.slice(0, 10),
        homeSlug: slugOf(r.homeTeam),
        awaySlug: slugOf(r.awayTeam),
        homeRaw: r.homeTeam,
        awayRaw: r.awayTeam,
        homeGoals: r.homeGoals,
        awayGoals: r.awayGoals,
        pin1x2: pin,
        pinOu,
      });
    }
    inventory.push(inv);
  }
  return { entries, inventory };
}

// ---------------------------------------------------------------------------
// Metrik
// ---------------------------------------------------------------------------
interface MarketAgg {
  n: number;
  modelLlSum: number;
  closingLlSum: number;
  favGapSum: number; // hanya 1X2
}
function newAgg(): MarketAgg {
  return { n: 0, modelLlSum: 0, closingLlSum: 0, favGapSum: 0 };
}
function finalize(a: MarketAgg) {
  return {
    n: a.n,
    model_logloss: a.n ? a.modelLlSum / a.n : null,
    closing_logloss: a.n ? a.closingLlSum / a.n : null,
    delta: a.n ? a.modelLlSum / a.n - a.closingLlSum / a.n : null,
    mean_abs_fav_gap: a.n && a.favGapSum > 0 ? a.favGapSum / a.n : null,
    indicative_only: a.n < 200,
  };
}

function main() {
  const divMap = loadDivMap();
  const divByCanonical = new Map(divMap.map((d) => [d.canonicalId, d]));
  const lab = loadLabMatches(new Set(divMap.map((d) => d.canonicalId)));
  const { entries, inventory } = loadCsvEntries();

  // Indeks CSV: div|date|homeSlug|awaySlug → entries
  const idx = new Map<string, CsvEntry[]>();
  for (const e of entries) {
    const k = `${e.div}|${e.dateUtc}|${e.homeSlug}|${e.awaySlug}`;
    const arr = idx.get(k);
    if (arr) arr.push(e);
    else idx.set(k, [e]);
  }
  const shiftDate = (yyyyMmDd: string, days: number): string => {
    const d = new Date(`${yyyyMmDd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  interface JoinDiag {
    labMatches: number;
    joinedExact: number;
    joinedShifted: number;
    unmatched: number;
    scoreMismatch: number;
    joinedNoPin1x2: number;
    joinedNoPinOu: number;
  }
  const diagByDiv = new Map<string, JoinDiag>();
  const diag = (div: string): JoinDiag => {
    let d = diagByDiv.get(div);
    if (!d) {
      d = { labMatches: 0, joinedExact: 0, joinedShifted: 0, unmatched: 0, scoreMismatch: 0, joinedNoPin1x2: 0, joinedNoPinOu: 0 };
      diagByDiv.set(div, d);
    }
    return d;
  };
  const joinedBySeason: Record<string, number> = {};
  const unmatchedTeams = new Map<string, Set<string>>(); // div → nama CSV tak terpakai / nama dataset tak ketemu
  const unmatchedLab: { matchId: string; div: string; date: string; home: string; away: string }[] = [];

  const dumpPairs: Record<string, unknown>[] = [];
  const aggByLeague = new Map<string, { x12: MarketAgg; ou25: MarketAgg }>();
  const pooled = { x12: newAgg(), ou25: newAgg() };
  const aggFor = (canonicalId: string) => {
    let a = aggByLeague.get(canonicalId);
    if (!a) {
      a = { x12: newAgg(), ou25: newAgg() };
      aggByLeague.set(canonicalId, a);
    }
    return a;
  };

  for (const lm of lab) {
    const info = divByCanonical.get(lm.canonicalId)!;
    const div = info.div;
    const d = diag(div);
    d.labMatches++;
    const hSlug = slugOf(RESIDUAL_TEAM_ALIASES[lm.homeName] ?? lm.homeName);
    const aSlug = slugOf(RESIDUAL_TEAM_ALIASES[lm.awayName] ?? lm.awayName);

    let candidates = idx.get(`${div}|${lm.dateUtc}|${hSlug}|${aSlug}`) ?? [];
    let shifted = false;
    if (candidates.length === 0) {
      for (const s of [-1, 1]) {
        const c = idx.get(`${div}|${shiftDate(lm.dateUtc, s)}|${hSlug}|${aSlug}`) ?? [];
        if (c.length > 0) {
          candidates = c;
          shifted = true;
          break;
        }
      }
    }
    if (candidates.length === 0) {
      d.unmatched++;
      unmatchedLab.push({ matchId: lm.matchId, div, date: lm.dateUtc, home: lm.homeName, away: lm.awayName });
      const set = unmatchedTeams.get(div) ?? new Set<string>();
      set.add(`dataset:${lm.homeName}`);
      set.add(`dataset:${lm.awayName}`);
      unmatchedTeams.set(div, set);
      continue;
    }
    // Verifikasi skor lintas sumber (wajib).
    const ok = candidates.filter((c) => c.homeGoals === lm.homeGoals && c.awayGoals === lm.awayGoals);
    if (ok.length === 0) {
      d.scoreMismatch++;
      continue;
    }
    const csv = ok[0];
    if (shifted) d.joinedShifted++;
    else d.joinedExact++;
    joinedBySeason[csv.season] = (joinedBySeason[csv.season] ?? 0) + 1;

    const agg = aggFor(lm.canonicalId);
    const actualIdx = lm.homeGoals > lm.awayGoals ? 0 : lm.homeGoals === lm.awayGoals ? 1 : 2;

    // --- 1X2 ---
    if (csv.pin1x2) {
      try {
        const close = stripVigShin(csv.pin1x2[0], csv.pin1x2[1], csv.pin1x2[2]);
        const cp: [number, number, number] = [close.fair_prob.home, close.fair_prob.draw, close.fair_prob.away];
        const fav = cp.indexOf(Math.max(...cp));
        for (const a of [agg.x12, pooled.x12]) {
          a.n++;
          a.modelLlSum += -Math.log(lm.p1x2[actualIdx]);
          a.closingLlSum += -Math.log(cp[actualIdx]);
          a.favGapSum += Math.abs(lm.p1x2[fav] - cp[fav]);
        }
        if (process.env.CB_DUMP_PAIRS) {
          dumpPairs.push({
            matchId: lm.matchId, div, season: csv.season, market: "1x2",
            model: lm.p1x2, closing: cp, actualIdx,
            odds: csv.pin1x2, score: [lm.homeGoals, lm.awayGoals],
          });
        }
      } catch {
        d.joinedNoPin1x2++;
      }
    } else {
      d.joinedNoPin1x2++;
    }

    // --- OU2.5 ---
    if (csv.pinOu) {
      try {
        const close = stripVigTwoWay(csv.pinOu[0], csv.pinOu[1]);
        const total = lm.homeGoals + lm.awayGoals;
        const pModel = total > 2.5 ? lm.pOuOver : lm.pOuUnder;
        const pClose = total > 2.5 ? close.fair_prob.optionA : close.fair_prob.optionB;
        for (const a of [agg.ou25, pooled.ou25]) {
          a.n++;
          a.modelLlSum += -Math.log(pModel);
          a.closingLlSum += -Math.log(pClose);
        }
        if (process.env.CB_DUMP_PAIRS) {
          dumpPairs.push({
            matchId: lm.matchId, div, season: csv.season, market: "ou25",
            modelOver: lm.pOuOver, closingOver: close.fair_prob.optionA,
            actualOver: total > 2.5, odds: csv.pinOu, score: [lm.homeGoals, lm.awayGoals],
          });
        }
      } catch {
        d.joinedNoPinOu++;
      }
    } else {
      d.joinedNoPinOu++;
    }
  }

  const leagues = [...aggByLeague.entries()]
    .map(([canonicalId, a]) => {
      const info = divByCanonical.get(canonicalId)!;
      return {
        canonical_id: canonicalId,
        div: info.div,
        name: info.name,
        "1x2": finalize(a.x12),
        ou25: finalize(a.ou25),
      };
    })
    .sort((x, y) => (x["1x2"].delta ?? Infinity) - (y["1x2"].delta ?? Infinity));

  const result = {
    generated_at: new Date().toISOString(),
    method:
      "Lab walk-forward OOS probs (picks.db source='lab') vs Pinnacle closing (football-data CSV), Shin strip (1X2) / two-way strip (OU2.5), score-verified join. See tasks/closing-benchmark-report.md §1.",
    inventory: {
      files: inventory,
      totals: {
        files: inventory.length,
        csvRows: inventory.reduce((s, f) => s + f.rows, 0),
        rowsWithPin1x2: inventory.reduce((s, f) => s + f.rowsWithPin1x2, 0),
        rowsWithPinOu: inventory.reduce((s, f) => s + f.rowsWithPinOu, 0),
        anyBttsCols: inventory.some((f) => f.hasBttsCols),
      },
    },
    join_diagnostics: {
      joined_by_season: joinedBySeason,
      residual_team_aliases: RESIDUAL_TEAM_ALIASES,
      by_div: Object.fromEntries(diagByDiv),
      unmatched_lab_sample: unmatchedLab.slice(0, 50),
      unmatched_lab_total: unmatchedLab.length,
      unmatched_dataset_teams_by_div: Object.fromEntries(
        [...unmatchedTeams.entries()].map(([k, v]) => [k, [...v].sort()]),
      ),
    },
    pooled: { "1x2": finalize(pooled.x12), ou25: finalize(pooled.ou25) },
    leagues,
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(result, null, 2));
  if (process.env.CB_DUMP_PAIRS) {
    fs.writeFileSync("/tmp/cb-pairs.json", JSON.stringify(dumpPairs));
    console.log(`pairs dumped: ${dumpPairs.length}`);
  }

  console.log("=== POOLED ===");
  console.log(JSON.stringify(result.pooled, null, 2));
  console.log("=== PER LIGA (urut Δ 1X2) ===");
  for (const L of leagues) {
    console.log(
      `${L.div.padEnd(4)} ${L.name.padEnd(22)} 1X2 n=${L["1x2"].n} model=${L["1x2"].model_logloss?.toFixed(4)} close=${L["1x2"].closing_logloss?.toFixed(4)} Δ=${L["1x2"].delta?.toFixed(4)} favGap=${L["1x2"].mean_abs_fav_gap?.toFixed(4)} | OU n=${L.ou25.n} Δ=${L.ou25.delta?.toFixed(4)}`,
    );
  }
  console.log("=== DIAGNOSTIK JOIN ===");
  console.log(JSON.stringify(result.join_diagnostics.by_div, null, 2));
  console.log(`unmatched lab total: ${unmatchedLab.length}`);
  console.log(JSON.stringify(result.join_diagnostics.unmatched_dataset_teams_by_div, null, 2));
}

main();
