// PR 1A diagnostik read-only: tabel coverage per liga (kompetisi) — Bagian B.
// Sumber: thestats_dataset.db (matches, canonical_fixtures, result_revisions),
// picks.db (corong issued/due/settled), analysis_snapshots.db (rated).
// Lag hasil p50/p95 TIDAK dihitung: tidak ada kolom available_at/ingested_at
// historis (matches.updated_at = waktu update baris terakhir, bukan waktu
// ketersediaan pertama) → null + alasan, sesuai perintah brief hal. 3.
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';

const D = '/home/hatch/workspace/coding/app-football/data';
const ds = new DatabaseSync(`${D}/thestats_dataset.db`, { readOnly: true });
const picks = new DatabaseSync(`${D}/picks.db`, { readOnly: true });
const snaps = new DatabaseSync(`${D}/analysis_snapshots.db`, { readOnly: true });

const REF = '2026-11-16'; // akhir jendela fit manifest aktif
const rows = ds.prepare(`
  SELECT m.competition_id AS comp,
    COUNT(*) AS catalog_n,
    SUM(CASE WHEN m.status='finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL THEN 1 ELSE 0 END) AS scored_90_n,
    COUNT(DISTINCT m.home_team_id) + 0 AS home_teams,
    MIN(m.utc_date) AS first_date, MAX(m.utc_date) AS last_date,
    SUM(CASE WHEN m.utc_date >= '2026-11-15' THEN 1 ELSE 0 END) AS dates_7d,
    SUM(CASE WHEN m.utc_date >= '2026-10-23' THEN 1 ELSE 0 END) AS dates_30d,
    SUM(CASE WHEN m.match_id LIKE 'sm_%' THEN 1 ELSE 0 END) AS sm_n,
    SUM(CASE WHEN m.match_id LIKE 'fd_%' THEN 1 ELSE 0 END) AS fd_n,
    SUM(CASE WHEN m.match_id LIKE 'mt_%' THEN 1 ELSE 0 END) AS mt_n,
    SUM(exp(-0.6931471805599453 * (julianday('${REF}') - julianday(m.utc_date)) / 365.0)) AS sum_w,
    SUM(exp(-2 * 0.6931471805599453 * (julianday('${REF}') - julianday(m.utc_date)) / 365.0)) AS sum_w2,
    SUM(CASE WHEN m.utc_date BETWEEN '2024-01-01' AND '${REF}' THEN 1 ELSE 0 END) AS in_fit_window_n
  FROM matches m GROUP BY m.competition_id`).all();
const teams = new Map(ds.prepare(`
  SELECT competition_id AS comp, COUNT(*) AS n FROM (
    SELECT competition_id, home_team_id AS t FROM matches
    UNION SELECT competition_id, away_team_id AS t FROM matches)
  GROUP BY competition_id`).all().map(r => [r.comp, r.n]));
const canon = new Map(ds.prepare(`SELECT competition_id AS comp, COUNT(*) AS n FROM canonical_fixtures GROUP BY competition_id`).all().map(r => [r.comp, r.n]));
const revisions = new Map(ds.prepare(`
  SELECT cf.competition_id AS comp, COUNT(*) AS n FROM result_revisions rr
  JOIN canonical_fixtures cf ON cf.fixture_uid = rr.fixture_uid GROUP BY cf.competition_id`).all().map(r => [r.comp, r.n]));
const dup = new Map(ds.prepare(`
  SELECT competition_id AS comp, COUNT(*) AS n FROM (SELECT competition_id, home_team_id, away_team_id, substr(utc_date,1,10) d, COUNT(*) c
    FROM matches GROUP BY competition_id, home_team_id, away_team_id, d HAVING c > 1) GROUP BY competition_id`).all().map(r => [r.comp, r.n]));
const funnel = new Map(picks.prepare(`
  SELECT p.competition_canonical_id AS comp, COUNT(*) AS issued_n,
    SUM(CASE WHEN o.pick_id IS NOT NULL THEN 1 ELSE 0 END) AS settled_n,
    SUM(CASE WHEN o.pick_id IS NULL AND p.kickoff_utc < '2026-11-24T00:00:00Z' THEN 1 ELSE 0 END) AS due_unsettled_n
  FROM picks p LEFT JOIN pick_outcomes o ON o.pick_id = p.id
  WHERE p.source='live-run' AND p.competition_canonical_id IS NOT NULL GROUP BY p.competition_canonical_id`).all().map(r => [r.comp, r]));
const rated = new Map(snaps.prepare(`
  SELECT competition_canonical_id AS comp, COUNT(*) AS packages_n, COUNT(DISTINCT match_id) AS rated_fixtures
  FROM packages WHERE competition_canonical_id IS NOT NULL GROUP BY competition_canonical_id`).all().map(r => [r.comp, r]));

const header = ['competition_id','catalog_n','scored_90_n','unique_teams','sources_sm_fd_mt','first_date','last_date','match_dates_last7d','match_dates_last30d','in_fit_window_n','n_eff_hl365_at_2026-11-16','canonical_fixtures_n','result_revisions_n','duplicate_clusters_n','rated_packages_n','rated_fixtures_n','picks_issued_n','picks_settled_n','picks_due_unsettled_n','result_lag_p50_h','result_lag_p95_h','lag_note'];
const lines = [header.join(',')];
for (const r of rows.sort((a, b) => b.catalog_n - a.catalog_n)) {
  const f = funnel.get(r.comp) || {};
  const rt = rated.get(r.comp) || {};
  const neff = r.sum_w && r.sum_w2 ? (r.sum_w * r.sum_w) / r.sum_w2 : null;
  lines.push([r.comp, r.catalog_n, r.scored_90_n, teams.get(r.comp) ?? '', `${r.sm_n}/${r.fd_n}/${r.mt_n}`,
    r.first_date, r.last_date, r.dates_7d, r.dates_30d, r.in_fit_window_n,
    neff ? neff.toFixed(1) : '', canon.get(r.comp) ?? 0, revisions.get(r.comp) ?? 0, dup.get(r.comp) ?? 0,
    rt.packages_n ?? '', rt.rated_fixtures ?? '', f.issued_n ?? '', f.settled_n ?? '', f.due_unsettled_n ?? '',
    '', '', 'tidak terukur: tidak ada available_at/ingested_at historis'].join(','));
}
writeFileSync(new URL('../reports/pr1a-evidence/coverage-per-liga.csv', import.meta.url), lines.join('\n') + '\n');
console.log(`rows=${rows.length} -> coverage-per-liga.csv`);
console.log('top10:', rows.slice(0, 10).map(r => `${r.comp}:${r.catalog_n}`).join(' '));
