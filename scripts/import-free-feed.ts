/**
 * IMPORT FEED GRATIS football-data.co.uk → store lokal (mode tanpa Sportmonks).
 *
 * Desain: tasks/free-feed-research.md (§A, §D). Mengisi:
 *  - Hasil musim berjalan (16 divisi)      → dataset.matches (+ teams fd_ baru)
 *  - Telemetri gol/tembakan/xG hasil fd    → dataset.team_match_logs
 *    (source='football-data' — filter saji source='sportmonks' TIDAK diubah;
 *    baris fd adalah arsip hasil + sumber odds closing, bukan telemetri saji)
 *  - Odds closing tiap hasil               → dataset.match_odds_history
 *    (source='football-data', capture_kind='closing'; Pinnacle closing
 *    didahulukan, Bet365 closing hanya bila Pinnacle absen — label jujur)
 *  - Fixture dari fixtures.csv (16 divisi) → upcoming_fixtures (id fd_*)
 *  - Odds pra-laga fixture                 → match_odds_history
 *    (capture_kind='fd-prematch', envelope books Pinnacle/Bet365 terpisah)
 *
 * Anti-duplikasi laga fisik: sebelum insert, laga dijembatani terhadap
 * store yang ada (tanggal UTC + nama home/away ternormalisasi). Laga yang
 * sudah ada sebagai sm_/mt_ TIDAK diduplikasi; id yang ada menjadi jangkar
 * odds-nya.
 *
 * Resolusi tim: nama CSV → baris teams yang ada lewat normalizeTeamName +
 * TEAM_NAME_ALIASES (lib/quant/team-normalizer.ts — satu-satunya normalizer).
 * Tak ter-resolve → id fd_<slug>; untuk HASIL dibuatkan baris teams-nya,
 * untuk FIXTURE tidak. Semua yang tak ter-resolve masuk laporan
 * tasks/free-import-unmatched.json — tidak ada tebakan fuzzy di luar itu.
 *
 * Idempoten: re-run memasukkan 0 baris baru di semua tabel.
 *
 * Pakai:
 *   npx tsx scripts/import-free-feed.ts [--results --odds --fixtures]
 *                                       [--season=2627] [--divs=E0,SP1] [--dry-run]
 *   (tanpa flag bagian = semua bagian jalan)
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import {
  FD_DIVISIONS,
  fetchSeasonCsv,
  fetchFixturesCsv,
  toResultRow,
  toFixtureRow,
  preMatchBooks,
  closingBook,
  hasBothClosingBooks,
  teamSlug,
  yyyymmdd,
  type FdRawRow,
} from "../lib/feeds/football-data";
import { normalizeTeamName } from "../lib/quant/team-normalizer";
import { getCanonicalBySourceId } from "../lib/quant/league-identity";

const args = process.argv.slice(2);
const argVal = (k: string): string | null => {
  const hit = args.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split("=")[1] : null;
};
const anyPartFlag = args.includes("--results") || args.includes("--odds") || args.includes("--fixtures");
const DO_RESULTS = !anyPartFlag || args.includes("--results");
const DO_ODDS = !anyPartFlag || args.includes("--odds");
const DO_FIXTURES = !anyPartFlag || args.includes("--fixtures");
const DRY_RUN = args.includes("--dry-run");
const SEASON_CODE = argVal("season") ?? "2627";
const SEASON_LABEL = `${2000 + Number(SEASON_CODE.slice(0, 2))}-${2000 + Number(SEASON_CODE.slice(0, 2)) + 1}`;
const DIVS = (argVal("divs") ?? FD_DIVISIONS.map((d) => d.code).join(","))
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter((c) => FD_DIVISIONS.some((d) => d.code === c));

const nowIso = new Date().toISOString();
const todayUtc = nowIso.slice(0, 10);

function dataPath(file: string): string {
  return path.join(process.cwd(), "data", file);
}

interface UnmatchedTeam {
  csv_name: string;
  normalized: string;
  team_id: string;
  div: string;
  context: "result" | "fixture";
  team_row_created: boolean;
}

interface DivSummary {
  div: string;
  rows_parsed: number;
  results_inserted: number;
  results_bridged: number;
  results_already_present: number;
  rows_skipped_invalid: number;
  telemetry_rows: number;
  closing_odds_written: number;
  closing_odds_skipped_existing: number;
  closing_pinnacle_preferred: number;
  rows_without_closing_odds: number;
}

async function main() {
  if (DIVS.length === 0) {
    console.error("Tidak ada divisi valid yang dipilih.");
    process.exit(1);
  }
  console.log(
    `Import feed gratis: musim ${SEASON_CODE} (${SEASON_LABEL}), divisi ${DIVS.join(",")}` +
      `, bagian: results=${DO_RESULTS} odds=${DO_ODDS} fixtures=${DO_FIXTURES}${DRY_RUN ? " [DRY-RUN]" : ""}`,
  );

  const ds = new DatabaseSync(dataPath("thestats_dataset.db"));
  ds.exec("PRAGMA journal_mode = WAL;");
  ds.exec("PRAGMA busy_timeout = 60000;");
  const up = new DatabaseSync(dataPath("upcoming_fixtures.db"));
  up.exec("PRAGMA journal_mode = WAL;");
  up.exec("PRAGMA busy_timeout = 60000;");

  // --- Peta resolusi tim: nama ternormalisasi → team_id yang ada.
  const teamRows = ds.prepare("SELECT team_id, name FROM teams").all() as unknown as {
    team_id: string;
    name: string;
  }[];
  const teamIdByNorm = new Map<string, string>();
  const teamNameById = new Map<string, string>();
  for (const t of teamRows) {
    teamNameById.set(t.team_id, t.name);
    const key = normalizeTeamName(t.name);
    if (!teamIdByNorm.has(key)) teamIdByNorm.set(key, t.team_id);
  }

  const unmatched: UnmatchedTeam[] = [];
  const unmatchedSeen = new Set<string>();
  const resolveTeam = (
    csvName: string,
    div: string,
    context: "result" | "fixture",
  ): { teamId: string; resolved: boolean; normalized: string } => {
    const normalized = normalizeTeamName(csvName);
    const hit = teamIdByNorm.get(normalized);
    if (hit) return { teamId: hit, resolved: true, normalized };
    const teamId = `fd_${teamSlug(normalized)}`;
    const seenKey = `${teamId}|${context}`;
    if (!unmatchedSeen.has(seenKey)) {
      unmatchedSeen.add(seenKey);
      unmatched.push({
        csv_name: csvName,
        normalized,
        team_id: teamId,
        div,
        context,
        team_row_created: false,
      });
    }
    return { teamId, resolved: false, normalized };
  };

  // --- Indeks jembatan laga fisik yang sudah ada.
  const bridgeKey = (date10: string, homeNorm: string, awayNorm: string) =>
    `${date10}|${homeNorm}|${awayNorm}`;
  const existingMatchByKey = new Map<string, string>();
  {
    const rows = ds
      .prepare(
        `SELECT m.match_id AS match_id, m.utc_date AS utc_date,
                ht.name AS home_name, at.name AS away_name
         FROM matches m
         JOIN teams ht ON ht.team_id = m.home_team_id
         JOIN teams at ON at.team_id = m.away_team_id`,
      )
      .all() as unknown as { match_id: string; utc_date: string; home_name: string; away_name: string }[];
    for (const r of rows) {
      const key = bridgeKey(r.utc_date.slice(0, 10), normalizeTeamName(r.home_name), normalizeTeamName(r.away_name));
      if (!existingMatchByKey.has(key)) existingMatchByKey.set(key, r.match_id);
    }
  }
  const existingFixtureByKey = new Map<string, string>();
  const existingFixtureIds = new Set<string>();
  {
    const rows = up
      .prepare("SELECT match_id, utc_date, home_team_name, away_team_name FROM upcoming_fixtures")
      .all() as unknown as {
      match_id: string;
      utc_date: string;
      home_team_name: string | null;
      away_team_name: string | null;
    }[];
    for (const r of rows) {
      existingFixtureIds.add(r.match_id);
      if (r.home_team_name && r.away_team_name) {
        const key = bridgeKey(
          r.utc_date.slice(0, 10),
          normalizeTeamName(r.home_team_name),
          normalizeTeamName(r.away_team_name),
        );
        if (!existingFixtureByKey.has(key)) existingFixtureByKey.set(key, r.match_id);
      }
    }
  }
  const existingMatchIds = new Set(
    (ds.prepare("SELECT match_id FROM matches").all() as unknown as { match_id: string }[]).map((r) => r.match_id),
  );

  // --- Prepared statements.
  const insTeam = ds.prepare(
    "INSERT OR IGNORE INTO teams (team_id, name, short_name, country, stadium, updated_at) VALUES (?, ?, NULL, ?, NULL, ?)",
  );
  const insMatch = ds.prepare(
    `INSERT OR IGNORE INTO matches (match_id, competition_id, season, utc_date, status, home_team_id, away_team_id, home_score, away_score, referee_name, updated_at)
     VALUES (?, ?, ?, ?, 'finished', ?, ?, ?, ?, ?, ?)`,
  );
  const insLog = ds.prepare(
    `INSERT OR IGNORE INTO team_match_logs (
       log_id, match_id, team_id, opponent_id, venue, match_date, season, result,
       goals_for, goals_against, xg_for, xg_against,
       shots_for, shots_against, shots_on_target_for, shots_on_target_against,
       created_at, source, xg_source
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insOdds = ds.prepare(
    `INSERT INTO match_odds_history (match_id, captured_utc, payload_json, has_odds, source, capture_kind)
     VALUES (?, ?, ?, 1, 'football-data', ?)`,
  );
  const hasClosing = ds.prepare(
    "SELECT 1 AS x FROM match_odds_history WHERE match_id = ? AND source = 'football-data' AND capture_kind = 'closing' LIMIT 1",
  );
  const hasPrematchToday = ds.prepare(
    "SELECT 1 AS x FROM match_odds_history WHERE match_id = ? AND source = 'football-data' AND capture_kind = 'fd-prematch' AND substr(captured_utc, 1, 10) = ? LIMIT 1",
  );
  const insFixture = up.prepare(
    `INSERT OR IGNORE INTO upcoming_fixtures (
       match_id, competition_id, competition_name, competition_country, utc_date, status,
       home_team_id, home_team_name, away_team_id, away_team_name, fetched_utc
     ) VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?)`,
  );

  const fdKeyFor = (prefix: string, div: string, kickoffUtc: string, homeNorm: string, awayNorm: string) =>
    `${prefix}_${div}_${yyyymmdd(kickoffUtc)}_${teamSlug(homeNorm)}_${teamSlug(awayNorm)}`;

  const summaries: DivSummary[] = [];
  const totals = {
    results_inserted: 0,
    results_bridged: 0,
    results_already_present: 0,
    telemetry_rows: 0,
    closing_odds_written: 0,
    fixtures_inserted: 0,
    fixtures_bridged: 0,
    fixtures_already_present: 0,
    prematch_odds_written: 0,
    prematch_odds_skipped_today: 0,
  };

  // ================= HASIL + ODDS CLOSING =================
  if (DO_RESULTS || DO_ODDS) {
    for (const div of DIVS) {
      const sum: DivSummary = {
        div,
        rows_parsed: 0,
        results_inserted: 0,
        results_bridged: 0,
        results_already_present: 0,
        rows_skipped_invalid: 0,
        telemetry_rows: 0,
        closing_odds_written: 0,
        closing_odds_skipped_existing: 0,
        closing_pinnacle_preferred: 0,
        rows_without_closing_odds: 0,
      };
      const rawRows = await fetchSeasonCsv(div, SEASON_CODE);
      if (rawRows === null) {
        console.log(`[${div}] file musim tidak ditemukan (404) — dilewati.`);
        summaries.push(sum);
        continue;
      }
      const canonical = getCanonicalBySourceId(div);
      const country = canonical?.country ?? FD_DIVISIONS.find((d) => d.code === div)?.country ?? null;

      if (!DRY_RUN) ds.prepare("BEGIN").run();
      try {
        for (const raw of rawRows) {
          if ((raw["Div"] ?? "").toUpperCase() !== div) continue;
          const row = toResultRow(raw);
          if (!row) {
            sum.rows_skipped_invalid++;
            continue;
          }
          sum.rows_parsed++;
          const home = resolveTeam(row.homeTeam, div, "result");
          const away = resolveTeam(row.awayTeam, div, "result");
          const fdId = fdKeyFor("fd", div, row.kickoffUtc, home.normalized, away.normalized);
          const bKey = bridgeKey(row.kickoffUtc.slice(0, 10), home.normalized, away.normalized);

          let anchorId = fdId;
          let insertedHere = false;
          if (DO_RESULTS) {
            if (existingMatchIds.has(fdId)) {
              sum.results_already_present++;
            } else if (existingMatchByKey.has(bKey)) {
              anchorId = existingMatchByKey.get(bKey) as string;
              sum.results_bridged++;
            } else {
              // Tim fd_ baru dari hasil: buat baris teams-nya (nama CSV apa adanya).
              for (const side of [
                { r: home, csv: row.homeTeam },
                { r: away, csv: row.awayTeam },
              ]) {
                if (!side.r.resolved) {
                  if (!DRY_RUN) insTeam.run(side.r.teamId, side.csv, country, nowIso);
                  teamIdByNorm.set(side.r.normalized, side.r.teamId);
                  teamNameById.set(side.r.teamId, side.csv);
                  const entry = unmatched.find((u) => u.team_id === side.r.teamId && u.context === "result");
                  if (entry) entry.team_row_created = true;
                }
              }
              if (!DRY_RUN) {
                insMatch.run(
                  fdId, div, SEASON_LABEL, row.kickoffUtc,
                  home.teamId, away.teamId, row.homeGoals, row.awayGoals, row.referee, nowIso,
                );
                // Telemetri: 2 baris, hanya untuk match yang barusan di-insert.
                const sides = [
                  { team: home.teamId, opp: away.teamId, venue: "HOME", gf: row.homeGoals, ga: row.awayGoals, xgF: row.homeXg, xgA: row.awayXg, shF: row.homeShots, shA: row.awayShots, stF: row.homeShotsOnTarget, stA: row.awayShotsOnTarget },
                  { team: away.teamId, opp: home.teamId, venue: "AWAY", gf: row.awayGoals, ga: row.homeGoals, xgF: row.awayXg, xgA: row.homeXg, shF: row.awayShots, shA: row.homeShots, stF: row.awayShotsOnTarget, stA: row.homeShotsOnTarget },
                ];
                for (const s of sides) {
                  const result = s.gf > s.ga ? "W" : s.gf < s.ga ? "L" : "D";
                  const hasXg = s.xgF !== null && s.xgA !== null;
                  insLog.run(
                    `fdlog_${fdId}_${s.venue === "HOME" ? "h" : "a"}`,
                    fdId, s.team, s.opp, s.venue, row.kickoffUtc.slice(0, 10), SEASON_LABEL, result,
                    s.gf, s.ga, s.xgF, s.xgA, s.shF, s.shA, s.stF, s.stA,
                    nowIso, "football-data", hasXg ? "football-data" : null,
                  );
                  sum.telemetry_rows++;
                }
              } else {
                sum.telemetry_rows += 2;
              }
              existingMatchIds.add(fdId);
              existingMatchByKey.set(bKey, fdId);
              sum.results_inserted++;
              insertedHere = true;
            }
          } else if (existingMatchByKey.has(bKey)) {
            anchorId = existingMatchByKey.get(bKey) as string;
          }
          void insertedHere;

          // Odds closing untuk SETIAP baris hasil ter-parse (jangkar = id bridged bila ada).
          if (DO_ODDS) {
            const book = closingBook(raw as FdRawRow);
            if (!book) {
              sum.rows_without_closing_odds++;
            } else if (hasClosing.get(anchorId)) {
              sum.closing_odds_skipped_existing++;
            } else {
              if (hasBothClosingBooks(raw as FdRawRow)) sum.closing_pinnacle_preferred++;
              const payload = JSON.stringify({
                source: "football-data",
                kind: "closing",
                bookmaker: book.bookmaker,
                "1x2": { home: book.h, draw: book.d, away: book.a },
                ou25:
                  book.ou25Over != null && book.ou25Under != null
                    ? { over: book.ou25Over, under: book.ou25Under }
                    : null,
                kickoff_utc: row.kickoffUtc,
              });
              if (!DRY_RUN) insOdds.run(anchorId, nowIso, payload, "closing");
              sum.closing_odds_written++;
            }
          }
        }
        if (!DRY_RUN) ds.prepare("COMMIT").run();
      } catch (e) {
        if (!DRY_RUN) ds.prepare("ROLLBACK").run();
        throw e;
      }
      summaries.push(sum);
      totals.results_inserted += sum.results_inserted;
      totals.results_bridged += sum.results_bridged;
      totals.results_already_present += sum.results_already_present;
      totals.telemetry_rows += sum.telemetry_rows;
      totals.closing_odds_written += sum.closing_odds_written;
      console.log(
        `[${div}] parsed=${sum.rows_parsed} inserted=${sum.results_inserted} bridged=${sum.results_bridged} ` +
          `already=${sum.results_already_present} invalid=${sum.rows_skipped_invalid} telemetry=${sum.telemetry_rows} ` +
          `closingOdds=+${sum.closing_odds_written} (skipExisting=${sum.closing_odds_skipped_existing}, pinPreferred=${sum.closing_pinnacle_preferred}, noOdds=${sum.rows_without_closing_odds})`,
      );
    }
  }

  // ================= FIXTURE + ODDS PRA-LAGA =================
  const fixtureSummary = { parsed: 0, inserted: 0, bridged: 0, already: 0, outOfScope: 0, invalid: 0 };
  if (DO_FIXTURES || DO_ODDS) {
    const rawRows = await fetchFixturesCsv();
    if (!DRY_RUN) up.prepare("BEGIN").run();
    try {
      for (const raw of rawRows) {
        const div = (raw["Div"] ?? "").toUpperCase();
        if (!DIVS.includes(div)) {
          fixtureSummary.outOfScope++;
          continue;
        }
        const row = toFixtureRow(raw);
        if (!row) {
          fixtureSummary.invalid++;
          continue;
        }
        fixtureSummary.parsed++;
        const home = resolveTeam(row.homeTeam, div, "fixture");
        const away = resolveTeam(row.awayTeam, div, "fixture");
        const fdId = fdKeyFor("fd", div, row.kickoffUtc, home.normalized, away.normalized);
        const bKey = bridgeKey(row.kickoffUtc.slice(0, 10), home.normalized, away.normalized);
        const canonical = getCanonicalBySourceId(div);

        let anchorId = fdId;
        if (DO_FIXTURES) {
          if (existingFixtureIds.has(fdId)) {
            fixtureSummary.already++;
          } else if (existingFixtureByKey.has(bKey)) {
            anchorId = existingFixtureByKey.get(bKey) as string;
            fixtureSummary.bridged++;
          } else {
            if (!DRY_RUN) {
              insFixture.run(
                fdId, div,
                canonical?.name ?? FD_DIVISIONS.find((d) => d.code === div)?.name ?? div,
                canonical?.country ?? FD_DIVISIONS.find((d) => d.code === div)?.country ?? null,
                row.kickoffUtc, home.teamId, row.homeTeam, away.teamId, row.awayTeam, nowIso,
              );
            }
            existingFixtureIds.add(fdId);
            existingFixtureByKey.set(bKey, fdId);
            fixtureSummary.inserted++;
          }
        } else if (existingFixtureByKey.has(bKey)) {
          anchorId = existingFixtureByKey.get(bKey) as string;
        }

        if (DO_ODDS) {
          const books = preMatchBooks(raw as FdRawRow);
          if (books.length > 0) {
            if (hasPrematchToday.get(anchorId, todayUtc)) {
              totals.prematch_odds_skipped_today++;
            } else {
              const payload = JSON.stringify({
                source: "football-data",
                kind: "pre-match",
                books: books.map((b) => ({
                  bookmaker: b.bookmaker,
                  "1x2": { home: b.h, draw: b.d, away: b.a },
                  ou25:
                    b.ou25Over != null && b.ou25Under != null
                      ? { over: b.ou25Over, under: b.ou25Under }
                      : null,
                })),
              });
              if (!DRY_RUN) insOdds.run(anchorId, nowIso, payload, "fd-prematch");
              totals.prematch_odds_written++;
            }
          }
        }
      }
      if (!DRY_RUN) up.prepare("COMMIT").run();
    } catch (e) {
      if (!DRY_RUN) up.prepare("ROLLBACK").run();
      throw e;
    }
    totals.fixtures_inserted = fixtureSummary.inserted;
    totals.fixtures_bridged = fixtureSummary.bridged;
    totals.fixtures_already_present = fixtureSummary.already;
    console.log(
      `[fixtures] parsed=${fixtureSummary.parsed} inserted=${fixtureSummary.inserted} bridged=${fixtureSummary.bridged} ` +
        `already=${fixtureSummary.already} outOfScope=${fixtureSummary.outOfScope} invalid=${fixtureSummary.invalid} ` +
        `prematchOdds=+${totals.prematch_odds_written} (skipToday=${totals.prematch_odds_skipped_today})`,
    );
  }

  // --- Laporan tim tak ter-resolve.
  console.log(`Tim tak ter-resolve (baru fd_*): ${unmatched.length}`);
  for (const u of unmatched.slice(0, 40)) {
    console.log(`  - ${u.csv_name} → ${u.team_id} [${u.div}/${u.context}${u.team_row_created ? ", teams row dibuat" : ""}]`);
  }
  if (!DRY_RUN) {
    const reportPath = path.join(process.cwd(), "tasks", "free-import-unmatched.json");
    fs.writeFileSync(
      reportPath,
      JSON.stringify({ generated_at: nowIso, season: SEASON_CODE, count: unmatched.length, teams: unmatched }, null, 2),
    );
    console.log(`Laporan unmatched tertulis: tasks/free-import-unmatched.json`);
  }

  console.log("TALLY " + JSON.stringify({ ...totals, unmatched_teams: unmatched.length, per_division: summaries, fixtures: fixtureSummary }));
  ds.close();
  up.close();
}

main().catch((e) => {
  console.error("GAGAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
