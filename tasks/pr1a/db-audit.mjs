// PR 1A diagnostik read-only: audit picks.db + thestats_dataset.db +
// analysis_snapshots.db + predictions.db produksi (dibuka mode=ro).
// Tidak menulis apa pun. Output: JSON ke stdout.
import { DatabaseSync } from 'node:sqlite';

const D = process.env.APP_DATA_DIR || '/home/hatch/workspace/coding/app-football/data';
const ro = (f) => new DatabaseSync(`${D}/${f}`, { readOnly: true });
const picks = ro('picks.db');
const ds = ro('thestats_dataset.db');
const snaps = ro('analysis_snapshots.db');
const preds = ro('predictions.db');
const out = {};

// ---------- A3: grade ----------
const gradeRows = picks.prepare(`
  SELECT p.grade AS grade, p.source AS source,
    COUNT(*) AS rows_n,
    COUNT(DISTINCT p.match_id) AS fixtures_matchid,
    COUNT(DISTINCT COALESCE(p.fixture_uid, p.match_id)) AS fixtures_uid,
    SUM(CASE WHEN o.pick_id IS NOT NULL THEN 1 ELSE 0 END) AS settled_n,
    SUM(CASE WHEN o.hit = 1 THEN 1 ELSE 0 END) AS hits,
    AVG(CASE WHEN o.pick_id IS NOT NULL THEN p.published_prob END) AS mean_published_settled,
    AVG(CASE WHEN o.pick_id IS NOT NULL THEN p.model_prob END) AS mean_model_settled,
    AVG(CASE WHEN o.pick_id IS NOT NULL THEN p.effective_prob END) AS mean_effective_settled,
    AVG(p.published_prob) AS mean_published_all,
    AVG(p.model_prob) AS mean_model_all
  FROM picks p LEFT JOIN pick_outcomes o ON o.pick_id = p.id
  WHERE p.grade IS NOT NULL
  GROUP BY p.grade, p.source ORDER BY p.grade, p.source`).all();
out.grades = gradeRows.map(r => ({ ...r, hit_rate_settled: r.settled_n ? r.hits / r.settled_n : null, pending_n: r.rows_n - r.settled_n }));
out.gradeTotals = picks.prepare(`
  SELECT COUNT(*) AS graded_rows, COUNT(DISTINCT grade) AS grades_present,
    SUM(CASE WHEN grade IN ('A','B','C') THEN 1 ELSE 0 END) AS abc_rows
  FROM picks WHERE grade IS NOT NULL`).get();
out.gradeA_byMarket = picks.prepare(`
  SELECT p.market, COUNT(*) AS rows_n, COUNT(DISTINCT p.match_id) AS fixtures,
    SUM(CASE WHEN o.pick_id IS NOT NULL THEN 1 ELSE 0 END) AS settled_n,
    SUM(CASE WHEN o.hit = 1 THEN 1 ELSE 0 END) AS hits,
    AVG(CASE WHEN o.pick_id IS NOT NULL THEN p.published_prob END) AS mean_published_settled
  FROM picks p LEFT JOIN pick_outcomes o ON o.pick_id = p.id
  WHERE p.grade = 'A' GROUP BY p.market ORDER BY rows_n DESC`).all();
out.gradeA_byGate = picks.prepare(`
  SELECT p.gate_status, COUNT(*) AS rows_n,
    SUM(CASE WHEN o.pick_id IS NOT NULL THEN 1 ELSE 0 END) AS settled_n,
    SUM(CASE WHEN o.hit = 1 THEN 1 ELSE 0 END) AS hits
  FROM picks p LEFT JOIN pick_outcomes o ON o.pick_id = p.id
  WHERE p.grade = 'A' GROUP BY p.gate_status`).all();
// due-but-unsettled: kickoff lewat, belum ada outcome
out.dueUnsettled = picks.prepare(`
  SELECT COUNT(*) AS n FROM picks p LEFT JOIN pick_outcomes o ON o.pick_id = p.id
  WHERE p.grade IS NOT NULL AND o.pick_id IS NULL AND p.kickoff_utc < '2026-11-24T00:00:00Z'`).get();
// panel/market evidence presence pada pick live
out.evidencePresence = picks.prepare(`
  SELECT COUNT(*) AS live_n,
    SUM(CASE WHEN sm_prob IS NOT NULL THEN 1 ELSE 0 END) AS with_sm_prob,
    SUM(CASE WHEN market_prob IS NOT NULL THEN 1 ELSE 0 END) AS with_market_prob,
    SUM(CASE WHEN published_prob IS NOT NULL THEN 1 ELSE 0 END) AS with_published_prob,
    SUM(CASE WHEN published_prob IS NOT NULL AND ABS(published_prob - model_prob) > 1e-9 THEN 1 ELSE 0 END) AS published_diff_model,
    SUM(CASE WHEN effective_prob IS NOT NULL AND ABS(effective_prob - model_prob) > 1e-9 THEN 1 ELSE 0 END) AS effective_diff_model
  FROM picks WHERE source = 'live-run'`).get();
out.liveByKickoffDay = picks.prepare(`
  SELECT substr(kickoff_utc,1,10) AS day, COUNT(*) AS n,
    SUM(CASE WHEN sm_prob IS NOT NULL THEN 1 ELSE 0 END) AS with_sm
  FROM picks WHERE source='live-run' AND kickoff_utc >= '2026-11-20' GROUP BY day ORDER BY day`).all();

// ---------- A6: dataset ----------
out.dataset = {
  matches_total: ds.prepare(`SELECT COUNT(*) n FROM matches`).get().n,
  matches_finished_scored: ds.prepare(`SELECT COUNT(*) n FROM matches WHERE status='finished' AND home_score IS NOT NULL AND away_score IS NOT NULL`).get().n,
  matches_by_status: ds.prepare(`SELECT status, COUNT(*) n FROM matches GROUP BY status`).all(),
  by_source: ds.prepare(`
    SELECT CASE WHEN match_id LIKE 'sm_%' THEN 'sm' WHEN match_id LIKE 'fd_%' THEN 'fd'
                WHEN match_id LIKE 'mt_%' THEN 'mt' ELSE 'other' END AS src,
      COUNT(*) AS rows_n,
      SUM(CASE WHEN status='finished' AND home_score IS NOT NULL THEN 1 ELSE 0 END) AS scored_n,
      MIN(utc_date) AS first_date, MAX(utc_date) AS last_date,
      SUM(CASE WHEN utc_date >= '2026-11-17' THEN 1 ELSE 0 END) AS last7d_by_date,
      SUM(CASE WHEN utc_date >= '2026-10-25' THEN 1 ELSE 0 END) AS last30d_by_date
    FROM matches GROUP BY src`).all(),
  canonical_fixtures: ds.prepare(`SELECT COUNT(*) n FROM canonical_fixtures`).get().n,
  fixture_aliases: ds.prepare(`SELECT COUNT(*) n FROM fixture_aliases`).get().n,
  identity_queue_open: ds.prepare(`SELECT COUNT(*) n FROM fixture_identity_queue WHERE resolved_at IS NULL`).get().n,
  identity_queue_total: ds.prepare(`SELECT COUNT(*) n FROM fixture_identity_queue`).get().n,
  result_revisions: ds.prepare(`SELECT COUNT(*) n FROM result_revisions`).get().n,
  distinct_competitions: ds.prepare(`SELECT COUNT(DISTINCT competition_id) n FROM matches`).get().n,
  distinct_teams_in_matches: ds.prepare(`SELECT COUNT(*) n FROM (SELECT home_team_id FROM matches UNION SELECT away_team_id FROM matches)`).get().n,
  matches_date_range: ds.prepare(`SELECT MIN(utc_date) a, MAX(utc_date) b FROM matches WHERE status='finished' AND home_score IS NOT NULL`).get(),
  dup_clusters_same_comp_teams_date: ds.prepare(`
    SELECT COUNT(*) n FROM (SELECT competition_id, home_team_id, away_team_id, substr(utc_date,1,10) d, COUNT(*) c
      FROM matches GROUP BY competition_id, home_team_id, away_team_id, d HAVING c > 1)`).get().n,
};

// ---------- C: snapshots & panel ----------
out.packages = snaps.prepare(`
  SELECT COUNT(*) AS n, MIN(computed_utc) AS first_computed, MAX(computed_utc) AS last_computed,
    COUNT(DISTINCT match_id) AS distinct_matches,
    SUM(CASE WHEN predictions_batch_utc IS NULL THEN 1 ELSE 0 END) AS batch_null,
    SUM(CASE WHEN predictions_batch_utc LIKE '1970%' THEN 1 ELSE 0 END) AS batch_epoch
  FROM packages`).get();
out.packagesByTrigger = snaps.prepare(`SELECT trigger, COUNT(*) n FROM packages GROUP BY trigger ORDER BY n DESC`).all();
out.panel = {
  rows: preds.prepare(`SELECT COUNT(*) n FROM sm_predictions`).get().n,
  fixtures: preds.prepare(`SELECT COUNT(DISTINCT fixture_sm_id) n FROM sm_predictions`).get().n,
  max_captured: preds.prepare(`SELECT MAX(captured_utc) m FROM sm_predictions`).get().m,
  by_captured_day: preds.prepare(`SELECT substr(captured_utc,1,10) d, COUNT(*) n FROM sm_predictions GROUP BY d ORDER BY d`).all(),
};

console.log(JSON.stringify(out, null, 2));
