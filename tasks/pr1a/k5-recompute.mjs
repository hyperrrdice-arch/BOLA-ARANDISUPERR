// PR 1A diagnostik read-only: hitung ulang log-loss/Brier dari artefak K5
// tasks/experiments/k5-kappa/predictions-h.jsonl (kolom A10/A20 = Level A,
// B10/B20 = Level B; outcome = indeks H/D/A dari hs vs as).
import { readFileSync } from 'node:fs';

const path = new URL('../experiments/k5-kappa/predictions-h.jsonl', import.meta.url);
const lines = readFileSync(path, 'utf8').trim().split('\n');
const keys = ['A10', 'A20', 'B10', 'B20'];
const acc = Object.fromEntries(keys.map(k => [k, { ll: 0, brier: 0, n: 0 }]));
const weeks = new Set();
const matches = new Set();
let drawPredSum = 0, drawActual = 0, clamped = 0;

for (const line of lines) {
  const r = JSON.parse(line);
  weeks.add(r.week); matches.add(r.match);
  const y = r.hs > r.as ? 0 : r.hs === r.as ? 1 : 2;
  if (y === 1) drawActual++;
  drawPredSum += r.B10[1];
  for (const k of keys) {
    const p = r[k];
    let py = p[y];
    if (!(py > 0)) { py = 1e-15; clamped++; }
    acc[k].ll += -Math.log(py);
    acc[k].brier += p.reduce((s, pk, i) => s + (pk - (i === y ? 1 : 0)) ** 2, 0);
    acc[k].n++;
  }
}
const out = { rows: lines.length, uniqueMatches: matches.size, weeks: weeks.size };
for (const k of keys) out[k] = { n: acc[k].n, logloss: acc[k].ll / acc[k].n, brier: acc[k].brier / acc[k].n };
out.drawCheck_B10 = { meanPredDraw: drawPredSum / lines.length, actualDrawRate: drawActual / lines.length };
out.clamped = clamped;
console.log(JSON.stringify(out, null, 2));
