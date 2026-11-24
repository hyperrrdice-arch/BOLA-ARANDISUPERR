// PR 1A diagnostik read-only: divergensi angka resmi vs matriks terbaru.
// Untuk pick resmi (pick_uid NOT NULL): bandingkan published_prob (beku)
// dengan (a) effective_prob & model_prob di baris yang sama,
// (b) probabilitas payload paket TERBARU untuk match yang sama.
import { DatabaseSync } from 'node:sqlite';

const D = '/home/hatch/workspace/coding/app-football/data';
const picks = new DatabaseSync(`${D}/picks.db`, { readOnly: true });
const snaps = new DatabaseSync(`${D}/analysis_snapshots.db`, { readOnly: true });

const official = picks.prepare(`
  SELECT id, match_id, market, selection, model_prob, effective_prob, published_prob, package_id
  FROM picks WHERE pick_uid IS NOT NULL AND published_prob IS NOT NULL`).all();

let pubVsEff = 0, pubVsModel = 0;
for (const p of official) {
  if (p.effective_prob !== null && Math.abs(p.published_prob - p.effective_prob) > 1e-9) pubVsEff++;
  if (Math.abs(p.published_prob - p.model_prob) > 1e-9) pubVsModel++;
}

const latestPkg = new Map();
for (const row of snaps.prepare(`SELECT match_id, payload_json FROM packages ORDER BY id ASC`).iterate()) {
  latestPkg.set(row.match_id, row.payload_json); // iterasi menaik: yang terakhir menang
}
let compared = 0, differ = 0, maxDiff = 0, sumAbs = 0, missing = 0;
for (const p of official) {
  const payload = latestPkg.get(p.match_id);
  if (!payload) { missing++; continue; }
  const probs = JSON.parse(payload).probabilities || {};
  const key = `${p.market}:${p.selection}`;
  const cur = probs[key];
  if (typeof cur !== 'number') { missing++; continue; }
  compared++;
  const d = Math.abs(cur - p.published_prob);
  if (d > 1e-9) differ++;
  sumAbs += d; if (d > maxDiff) maxDiff = d;
}
console.log(JSON.stringify({
  official_n: official.length, pubVsEff_diff: pubVsEff, pubVsModel_diff: pubVsModel,
  vs_latest_package: { compared, differ, mean_abs_diff: compared ? sumAbs / compared : null, max_abs_diff: maxDiff, key_missing: missing },
}, null, 2));
