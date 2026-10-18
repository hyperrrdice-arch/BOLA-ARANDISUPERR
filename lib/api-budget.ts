/**
 * PENGHITUNG BUDGET REQUEST TheStatsAPI — persisten antar run.
 *
 * Kuota bakar sesi ini terbatas (lihat tasks/plan-data-coverage.md): tiap script
 * wajib (a) catat pemakaian lewat `recordRequests`, (b) stop bersih via
 * `guardBudget` saat sisa di bawah ambang. Angka tersimpan di
 * `data/api-budget.json` supaya akumulatif lintas script & lintas run.
 */
import fs from "node:fs";
import path from "node:path";

export const API_BUDGET_TOTAL = Number(process.env.STATS_API_BUDGET_TOTAL ?? 7000);
const BUDGET_FILE = path.join(process.cwd(), "data", "api-budget.json");

function readUsed(): number {
  try {
    return Number(JSON.parse(fs.readFileSync(BUDGET_FILE, "utf8")).used ?? 0);
  } catch {
    return 0;
  }
}

/** Catat n request yang baru dipakai → kembalikan sisa budget. */
export function recordRequests(n: number): number {
  const used = readUsed() + n;
  fs.mkdirSync(path.dirname(BUDGET_FILE), { recursive: true });
  fs.writeFileSync(BUDGET_FILE, JSON.stringify({ used, updatedAt: new Date().toISOString() }, null, 2));
  return API_BUDGET_TOTAL - used;
}

export function remainingBudget(): number {
  return API_BUDGET_TOTAL - readUsed();
}

/** Stop bersih (exit 2) kalau sisa di bawah ambang. */
export function guardBudget(minRemaining = 100): void {
  const rem = remainingBudget();
  if (rem < minRemaining) {
    console.error(`\n⛔ [BUDGET] sisa ${rem} request < ambang ${minRemaining} — stop bersih.`);
    process.exit(2);
  }
}
