/**
 * MIGRASI IDENTITAS FIXTURE (K1) — backfill store identitas persisten
 * (canonical_fixtures + fixture_aliases + result_revisions) dari data
 * historis yang sudah ada:
 *
 *  - Seluruh baris `matches` di dataset dikelompokkan per laga fisik:
 *    (tim kanonik kandang, tim kanonik tamu, tanggal UTC) yang sama =
 *    satu komponen; grup registry data/fixture-links.json menggabungkan
 *    komponen lintas id katalog (sm_/mt_/fd_).
 *  - Tiap komponen mendapat satu fixture_uid (atau memakai UID yang
 *    sudah terdaftar), seluruh id anggotanya menjadi alias dua arah.
 *  - Baris finished jangkar mendapat revisi 1 (source 'migration',
 *    observed_at = updated_at baris itu) — mencatat keadaan yang
 *    diketahui, bukan mengarang histori.
 *  - Komponen dengan dua skor finished yang bertabrakan TIDAK dipilih
 *    diam-diam: jangkar fd_ didahulukan sebagai otoritas era bebas,
 *    konfliknya masuk antrean peninjauan (identity_ambiguous /
 *    conflicting_scores) dan terhitung di ringkasan.
 *
 * Idempoten: run ulang tidak menambah fixture/alias/revisi baru
 * (komponen yang sudah terdaftar penuh dihitung already_registered).
 * Fixture katalog masa depan tanpa baris dataset dan tanpa grup tautan
 * tidak dibuatkan UID di sini — mereka terdaftar oleh rantai refresh
 * (importer + builder) pada run berikutnya.
 *
 * Pakai: npx tsx scripts/migrate-fixture-identity.ts [--dry-run]
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import {
  SETTLEMENT_POLICY_VERSION,
  ensureIdentitySchema,
  getUidForMatchId,
  isFinishedStatus,
  linkAlias,
  loadFixtureLinkGroups,
  normalizeMatchStatus,
  sourceOfMatchId,
} from "../lib/identity/fixture-resolver";
import { canonicalIdForTeamId, canonicalIdForTeamName } from "../lib/quant/team-identity";
import { dbPath } from "../lib/db/paths";

const DRY_RUN = process.argv.includes("--dry-run");
const ROOT = process.cwd();
const nowIso = new Date().toISOString();

interface MatchRow {
  match_id: string;
  competition_id: string;
  season: string;
  utc_date: string;
  status: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  updated_at: string;
}

interface CatalogRow {
  match_id: string;
  competition_id: string | null;
  utc_date: string;
  home_team_id: string | null;
  home_team_name: string | null;
  away_team_id: string | null;
  away_team_name: string | null;
}

function main(): void {
  const dsPath = dbPath("thestats_dataset.db");
  if (!fs.existsSync(dsPath)) {
    console.error("data/thestats_dataset.db tidak ada — tidak ada yang dimigrasi.");
    process.exit(1);
  }
  const ds = new DatabaseSync(dsPath);
  ds.exec("PRAGMA journal_mode = WAL;");
  ds.exec("PRAGMA busy_timeout = 60000;");
  ensureIdentitySchema(ds);

  const cidOf = (teamId: string | null, teamName?: string | null): string | null => {
    if (teamId) return canonicalIdForTeamId(teamId) ?? teamId;
    if (teamName) return canonicalIdForTeamName(teamName) ?? null;
    return null;
  };

  const matches = ds
    .prepare(
      `SELECT match_id, competition_id, season, utc_date, status, home_team_id,
              away_team_id, home_score, away_score, updated_at FROM matches`,
    )
    .all() as unknown as MatchRow[];
  const rowById = new Map(matches.map((m) => [m.match_id, m]));

  let catalog = new Map<string, CatalogRow>();
  const upPath = dbPath("upcoming_fixtures.db");
  if (fs.existsSync(upPath)) {
    const up = new DatabaseSync(upPath, { readOnly: true });
    try {
      const rows = up
        .prepare(
          "SELECT match_id, competition_id, utc_date, home_team_id, home_team_name, away_team_id, away_team_name FROM upcoming_fixtures",
        )
        .all() as unknown as CatalogRow[];
      catalog = new Map(rows.map((r) => [r.match_id, r]));
    } catch {
      catalog = new Map();
    } finally {
      up.close();
    }
  }

  // --- Union-find atas id laga: kunci fisik (tim kanonik + tanggal) dan
  // grup registry tautan.
  const parent = new Map<string, string>();
  const ensureNode = (x: string) => {
    if (!parent.has(x)) parent.set(x, x);
  };
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) as string;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    ensureNode(a);
    ensureNode(b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const m of matches) ensureNode(m.match_id);

  const byPhysicalKey = new Map<string, string>();
  for (const m of matches) {
    const key = `${cidOf(m.home_team_id)}|${cidOf(m.away_team_id)}|${m.utc_date.slice(0, 10)}`;
    const prev = byPhysicalKey.get(key);
    if (prev) union(prev, m.match_id);
    else byPhysicalKey.set(key, m.match_id);
  }
  const linkGroups = loadFixtureLinkGroups(path.join(ROOT, "data"));
  for (const g of linkGroups) {
    for (const id of g.ids) ensureNode(id);
    for (let i = 1; i < g.ids.length; i++) union(g.ids[0], g.ids[i]);
  }

  const components = new Map<string, string[]>();
  for (const id of parent.keys()) {
    const r = find(id);
    if (!components.has(r)) components.set(r, []);
    components.get(r)!.push(id);
  }

  const summary = {
    matches_rows: matches.length,
    catalog_rows: catalog.size,
    link_groups: linkGroups.length,
    components: components.size,
    fixtures_created: 0,
    fixtures_reused: 0,
    already_registered: 0,
    aliases_linked: 0,
    revisions_backfilled: 0,
    conflicts_queued: 0,
  };

  const insFixture = ds.prepare(
    `INSERT INTO canonical_fixtures (
       fixture_uid, competition_id, season, home_cid, away_cid, home_name, away_name,
       stage_or_leg, kickoff_utc, kickoff_precision, state, neutral, score_basis,
       current_revision, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 'exact', ?, NULL, 'regulation', ?, ?, ?)`,
  );
  const insRevision = ds.prepare(
    `INSERT OR IGNORE INTO result_revisions (
       fixture_uid, match_id, revision, status, home_score, away_score,
       home_score_et, away_score_et, home_score_pen, away_score_pen,
       score_basis, source, observed_at, checksum, settlement_policy_version
     ) VALUES (?, ?, 1, 'finished', ?, ?, NULL, NULL, NULL, NULL,
               'regulation', 'migration', ?, NULL, ?)`,
  );

  if (!DRY_RUN) ds.prepare("BEGIN").run();
  try {
    for (const ids of components.values()) {
      const rows = ids
        .map((id) => rowById.get(id))
        .filter((r): r is MatchRow => r !== undefined);
      // Jangkar: baris finished berskor (fd_ didahulukan — otoritas hasil
      // era bebas), lalu baris sm_, lalu baris pertama.
      const finishedRows = rows.filter(
        (r) => isFinishedStatus(r.status) && r.home_score !== null && r.away_score !== null,
      );
      const anchor =
        finishedRows.find((r) => r.match_id.startsWith("fd_")) ??
        finishedRows.find((r) => r.match_id.startsWith("sm_")) ??
        finishedRows[0] ??
        rows.find((r) => r.match_id.startsWith("sm_")) ??
        rows[0] ??
        null;

      // UID yang sudah terdaftar di komponen ini (bila migrasi parsial
      // atau rantai refresh sudah mendaftarkan sebagian).
      const existingUids = new Map<string, number>();
      for (const id of ids) {
        const uid = getUidForMatchId(ds, id);
        if (uid) existingUids.set(uid, (existingUids.get(uid) ?? 0) + 1);
      }
      let uid: string | null = null;
      if (existingUids.size > 0) {
        uid = [...existingUids.entries()].sort((a, b) => b[1] - a[1])[0][0];
      }

      const allAliased =
        uid !== null && ids.every((id) => getUidForMatchId(ds, id) === uid);
      const revExists =
        uid !== null
          ? ((ds
              .prepare("SELECT COUNT(*) AS n FROM result_revisions WHERE fixture_uid = ?")
              .get(uid) as { n: number }).n > 0)
          : false;
      if (allAliased && (finishedRows.length === 0 || revExists)) {
        summary.already_registered++;
        continue;
      }

      if (!uid) {
        uid = `fx_${crypto.randomUUID()}`;
        const cat = anchor ? undefined : catalog.get(ids[0]);
        const homeCid = anchor
          ? cidOf(anchor.home_team_id)
          : cidOf(cat?.home_team_id ?? null, cat?.home_team_name);
        const awayCid = anchor
          ? cidOf(anchor.away_team_id)
          : cidOf(cat?.away_team_id ?? null, cat?.away_team_name);
        const state = anchor ? normalizeMatchStatus(anchor.status) : "scheduled";
        if (!DRY_RUN) {
          insFixture.run(
            uid,
            anchor?.competition_id ?? cat?.competition_id ?? null,
            anchor?.season ?? null,
            homeCid,
            awayCid,
            null,
            null,
            anchor?.utc_date ?? cat?.utc_date ?? null,
            state,
            anchor && isFinishedStatus(anchor.status) ? 1 : 0,
            nowIso,
            nowIso,
          );
        }
        summary.fixtures_created++;
      } else {
        summary.fixtures_reused++;
      }

      for (const id of ids) {
        if (getUidForMatchId(ds, id) !== uid) {
          if (!DRY_RUN) linkAlias(ds, uid, sourceOfMatchId(id), id, "migration", nowIso);
          summary.aliases_linked++;
        }
      }

      if (anchor && isFinishedStatus(anchor.status) && anchor.home_score !== null && anchor.away_score !== null) {
        if (!revExists) {
          if (!DRY_RUN) {
            const r = insRevision.run(uid, anchor.match_id, anchor.home_score, anchor.away_score, anchor.updated_at, SETTLEMENT_POLICY_VERSION);
            if (Number(r.changes) > 0) summary.revisions_backfilled++;
            ds.prepare(
              "UPDATE canonical_fixtures SET state = 'finished', current_revision = MAX(current_revision, 1), updated_at = ? WHERE fixture_uid = ?",
            ).run(nowIso, uid);
          } else {
            summary.revisions_backfilled++;
          }
        }
      }

      // Konflik skor antar baris finished satu komponen → antrean.
      const distinctScores = new Set(
        finishedRows.map((r) => `${r.home_score}-${r.away_score}`),
      );
      if (distinctScores.size > 1 && anchor) {
        if (!DRY_RUN) {
          const existing = ds
            .prepare(
              "SELECT id FROM fixture_identity_queue WHERE source = 'migration' AND source_match_id = ? AND reason = 'identity_ambiguous' AND resolved_at IS NULL LIMIT 1",
            )
            .get(anchor.match_id) as { id: number } | undefined;
          if (!existing) {
            ds.prepare(
              "INSERT INTO fixture_identity_queue (source, source_match_id, reason, detail_json, created_at) VALUES ('migration', ?, 'identity_ambiguous', ?, ?)",
            ).run(
              anchor.match_id,
              JSON.stringify({
                cause: "conflicting_scores",
                fixture_uid: uid,
                rows: finishedRows.map((r) => ({
                  match_id: r.match_id,
                  home_score: r.home_score,
                  away_score: r.away_score,
                })),
              }),
              nowIso,
            );
          }
        }
        summary.conflicts_queued++;
      }
    }
    if (!DRY_RUN) ds.prepare("COMMIT").run();
  } catch (e) {
    if (!DRY_RUN) ds.prepare("ROLLBACK").run();
    throw e;
  }

  console.log("MIGRATION " + JSON.stringify(summary, null, 2));
  ds.close();
}

main();
