/**
 * PENGHITUNG BUDGET REQUEST TheStatsAPI — persisten antar run.
 *
 * Kebenaran utama = header response API (`x-monthly-quota-*`): kuota BULANAN
 * 10.000 request (bukan harian — terkoreksi setelah membaca header asli).
 * `recordRequests` mencatat percobaan (termasuk retry) sebagai accounting lokal;
 * `recordQuotaRemaining` menyinkronkan sisa NYATA dari header. `remainingBudget()`
 * mengembalikan angka header bila sudah pernah terlihat (paling jujur).
 */
import fs from "node:fs";
import path from "node:path";

export const API_BUDGET_TOTAL = Number(process.env.STATS_API_BUDGET_TOTAL ?? 10000);
const BUDGET_FILE = path.join(process.cwd(), "data", "api-budget.json");

interface BudgetState {
  used: number;
  actualRemaining: number | null;
  updatedAt: string;
}

function readState(): BudgetState {
  try {
    const s = JSON.parse(fs.readFileSync(BUDGET_FILE, "utf8"));
    return { used: Number(s.used ?? 0), actualRemaining: s.actualRemaining ?? null, updatedAt: s.updatedAt ?? "" };
  } catch {
    return { used: 0, actualRemaining: null, updatedAt: "" };
  }
}

function writeState(s: BudgetState): void {
  fs.mkdirSync(path.dirname(BUDGET_FILE), { recursive: true });
  fs.writeFileSync(BUDGET_FILE, JSON.stringify(s, null, 2));
}

/** Catat n percobaan HTTP (termasuk retry) → accounting lokal. */
export function recordRequests(n: number): void {
  const s = readState();
  s.used += n;
  s.updatedAt = new Date().toISOString();
  writeState(s);
}

/** Sinkronkan sisa kuota NYATA dari header `x-monthly-quota-remaining`. */
export function recordQuotaRemaining(remaining: number): void {
  const s = readState();
  s.actualRemaining = remaining;
  s.updatedAt = new Date().toISOString();
  writeState(s);
}

/** Sisa budget: angka header (paling jujur) bila pernah terlihat, selainnya accounting lokal. */
export function remainingBudget(): number {
  const s = readState();
  return s.actualRemaining != null ? s.actualRemaining : API_BUDGET_TOTAL - s.used;
}

export function usedLocally(): number {
  return readState().used;
}

/** Stop bersih (exit 2) kalau sisa di bawah ambang. */
export function guardBudget(minRemaining = 100): void {
  const rem = remainingBudget();
  if (rem < minRemaining) {
    console.error(`\n⛔ [BUDGET] sisa ${rem} request < ambang ${minRemaining} — stop bersih.`);
    process.exit(2);
  }
}
