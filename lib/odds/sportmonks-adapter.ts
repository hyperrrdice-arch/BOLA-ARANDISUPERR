/**
 * SPORTMONKS ADAPTER — Track B Task SM-1 (detail pull shortlist + budget guard).
 *
 * Sintaks terverifikasi spike 27 Okt:
 * - Base `https://api.sportmonks.com/v3/football`, auth via query `api_token`
 *   (dari env `SPORTMONKS_API_TOKEN`). Key TIDAK PERNAH di-print/log.
 * - 1 call = `GET /fixtures/{id}` dengan
 *   `include=odds.bookmaker;predictions.type;lineups;sidelined;participants`
 *   (`participants` tambahan biar home/away tidak tebak-tebakan; tetap 1 call,
 *   nested max 2) + `filters=markets:1,80;bookmakers:35,20`
 *   (market 1 = 1X2, 80 = O/U goals; 35 = 1xBet, 20 = Pinnacle).
 * - Bookie/market asing = skip + catat di `skipped[]`, bukan crash.
 * - Budget: cap default 150 (`SM_CALL_CAP`, env override), auto-stop di 80%,
 *   pacing 2 dtk antar call (`SM_PACING_MS` override opsional). Counter in-memory
 *   per proses (lihat `smCallsUsed()`); over-budget = throw pesan jelas, tanpa HTTP.
 * - Key mati (401/403) / rate limit (429) = `SportmonksDegradedError`
 *   (`code === "SPORTMONKS_DEGRADED"`, pesan "pantau", bukan stack trace ke user).
 * - DILARANG tulis ke DB dari adapter ini.
 */

const SM_BASE = "https://api.sportmonks.com/v3/football";

export const SM_DEFAULT_CAP = 150;
const SM_STOP_RATIO = 0.8;
const SM_PACING_MS_DEFAULT = 2000;
const SM_TIMEOUT_MS = 25000;

export const SM_MARKET_1X2 = 1;
export const SM_MARKET_OU = 80;
/** Bookie yang kita kenal dari spike: 35 = 1xBet, 20 = Pinnacle, 2 = bet365. */
const SM_KNOWN_BOOKMAKERS = new Map<number, string>([
  [35, "1xBet"],
  [20, "Pinnacle"],
  [2, "bet365"],
]);

// ---------- error terstruktur ----------

export class SportmonksDegradedError extends Error {
  readonly code = "SPORTMONKS_DEGRADED";
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "SportmonksDegradedError";
    this.status = status;
  }
}

export function isSportmonksDegraded(e: unknown): e is SportmonksDegradedError {
  if (e instanceof SportmonksDegradedError) return true;
  return (
    typeof e === "object" &&
    e !== null &&
    (e as Record<string, unknown>).code === "SPORTMONKS_DEGRADED"
  );
}

// ---------- budget guard (in-memory per proses) ----------

const budgetState = { used: 0, lastAt: 0 };

export function readSmCallCap(): number {
  const raw = Number(process.env.SM_CALL_CAP ?? SM_DEFAULT_CAP);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : SM_DEFAULT_CAP;
}

/** Batas aman = 80% dari cap (cap 150 → stop di 120). */
export function smStopAt(): number {
  return Math.max(1, Math.floor(readSmCallCap() * SM_STOP_RATIO));
}

export function smCallsUsed(): number {
  return budgetState.used;
}

export function smBudget(): { cap: number; used: number; stopAt: number } {
  return { cap: readSmCallCap(), used: budgetState.used, stopAt: smStopAt() };
}

function pacingMs(): number {
  const raw = Number(process.env.SM_PACING_MS ?? SM_PACING_MS_DEFAULT);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : SM_PACING_MS_DEFAULT;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function readToken(explicit?: string): string {
  const t = (explicit ?? process.env.SPORTMONKS_API_TOKEN ?? "").trim();
  if (!t) {
    throw new SportmonksDegradedError(
      "Sportmonks pantau dulu — API token belum dikonfigurasi (SPORTMONKS_API_TOKEN kosong)."
    );
  }
  return t;
}

// ---------- HTTP mentah (semua call lewat sini: budget + pacing + counter) ----------

export async function smGetRaw(
  endpoint: string,
  params: Record<string, string> = {},
  opts: { apiToken?: string } = {}
): Promise<{ status: number; body: unknown }> {
  const b = smBudget();
  if (b.used >= b.stopAt) {
    throw new Error(
      `Sportmonks budget habis — stop otomatis di ${b.used}/${b.cap} calls ` +
        `(batas aman 80% = ${b.stopAt}). Kurangi shortlist atau naikkan SM_CALL_CAP.`
    );
  }
  const wait = pacingMs() - (Date.now() - budgetState.lastAt);
  if (wait > 0) await sleep(wait);

  const token = readToken(opts.apiToken);
  const url = new URL(`${SM_BASE}${endpoint}`);
  url.searchParams.set("api_token", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.append(k, v);

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(SM_TIMEOUT_MS) });
  } catch {
    budgetState.used += 1;
    budgetState.lastAt = Date.now();
    throw new SportmonksDegradedError(
      `Sportmonks pantau dulu — jaringan/timeout saat memanggil ${endpoint}.`
    );
  }
  budgetState.used += 1;
  budgetState.lastAt = Date.now();

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (res.status === 401 || res.status === 403 || res.status === 429) {
    const hint =
      res.status === 429
        ? "rate limit (429)"
        : `otorisasi (HTTP ${res.status}) — key mati/kedaluwarsa?`;
    throw new SportmonksDegradedError(
      `Sportmonks pantau dulu — sumber harga/prediksi tidak tersedia (${hint}). ` +
        `Tanpa data SM, jangan bet dari angka ini.`,
      res.status
    );
  }
  if (!res.ok) throw new Error(`Sportmonks HTTP ${res.status} untuk ${endpoint}.`);
  return { status: res.status, body };
}

// ---------- tipe rapi ----------

export interface SmMoneyline {
  bookmaker_id: number;
  bookmaker: string;
  home: number | null;
  draw: number | null;
  away: number | null;
}

export interface SmOverUnder {
  bookmaker_id: number;
  bookmaker: string;
  line: string;
  over: number | null;
  under: number | null;
}

export interface SmPrediction {
  type_id: number;
  type_name: string;
  values: Record<string, unknown>;
}

export interface SmLineupPlayer {
  name: string;
  position: string | null;
  number: number | null;
}

export interface SmLineup {
  team_id: number | null;
  team_name: string | null;
  formation: string | null;
  players: SmLineupPlayer[];
}

export interface SmSidelined {
  player_name: string;
  team_id: number | null;
  reason: string | null;
}

export interface SmFixtureDetail {
  fixture_id: number;
  odds_1x2: SmMoneyline[];
  odds_ou: SmOverUnder[];
  predictions: SmPrediction[];
  lineup_home: SmLineup | null;
  lineup_away: SmLineup | null;
  sidelined: SmSidelined[];
  skipped: string[];
}

// ---------- parsing defensif ----------

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function str(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t ? t : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function pick12Side(label: string | null, name: string | null): "home" | "draw" | "away" | null {
  const t = `${label ?? ""}`.trim().toLowerCase();
  const n = `${name ?? ""}`.trim().toLowerCase();
  for (const cand of [t, n]) {
    if (cand === "1" || cand === "home" || cand === "home win") return "home";
    if (cand === "x" || cand === "draw" || cand === "draws") return "draw";
    if (cand === "2" || cand === "away" || cand === "away win") return "away";
  }
  return null;
}

function pickOuSide(label: string | null, name: string | null): "over" | "under" | null {
  const t = `${label ?? ""} ${name ?? ""}`.toLowerCase();
  if (/\bover\b/.test(t)) return "over";
  if (/\bunder\b/.test(t)) return "under";
  return null;
}

function pickOuLine(entry: Record<string, unknown>): string | null {
  const hay = `${str(entry.label) ?? ""} ${str(entry.name) ?? ""}`;
  const m = hay.match(/(\d+(?:\.\d+)?)/);
  if (m) return m[1];
  for (const k of ["total", "handicap", "line", "points"]) {
    const v = entry[k];
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    if (typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim())) return v.trim();
  }
  return null;
}

// ---------- entrypoint utama: 1 call per laga ----------

export function parseFixtureDetail(smFixtureId: number | string, body: unknown): SmFixtureDetail {
  const root = asRecord(body);
  const rawData = root ? root.data : null;
  const d = asRecord(rawData) ?? asRecord(asArray(rawData)[0]);
  if (!d) throw new Error(`Sportmonks: fixture ${smFixtureId} tidak ada data.`);
  const skipped: string[] = [];

  // --- participants → label home/away + nama tim ---
  const teamName = new Map<number, string>();
  const teamSide = new Map<number, "home" | "away">();
  for (const p of asArray(d.participants)) {
    const pr = asRecord(p);
    if (!pr) continue;
    const tid = num(pr.team_id ?? pr.id);
    const nm = str(pr.name);
    if (tid !== null && nm) teamName.set(tid, nm);
    if (tid !== null) {
      const loc = str(asRecord(pr.meta)?.location)?.toLowerCase();
      if (loc === "home" || loc === "away") teamSide.set(tid, loc);
    }
  }

  // --- odds ---
  const lines12 = new Map<number, SmMoneyline>();
  const linesOu = new Map<string, SmOverUnder>();
  for (const o of asArray(d.odds)) {
    const or = asRecord(o);
    if (!or) continue;
    const marketId = num(or.market_id);
    const bookId = num(or.bookmaker_id);
    const label = str(or.label);
    const name = str(or.name);
    const value = num(or.value);
    if (marketId === null || bookId === null) {
      skipped.push(`odd tanpa market/bookmaker id (odd id ${str(or.id) ?? "?"})`);
      continue;
    }
    if (!SM_KNOWN_BOOKMAKERS.has(bookId)) {
      skipped.push(`bookmaker asing ${bookId} (${str(asRecord(or.bookmaker)?.name) ?? "?"}), market ${marketId} — skip`);
      continue;
    }
    if (marketId !== SM_MARKET_1X2 && marketId !== SM_MARKET_OU) {
      skipped.push(`market asing ${marketId} (bookie ${bookId}, label "${label ?? "?"}") — skip`);
      continue;
    }
    const bname =
      str(asRecord(or.bookmaker)?.name) ?? SM_KNOWN_BOOKMAKERS.get(bookId) ?? `bookie:${bookId}`;
    if (marketId === SM_MARKET_1X2) {
      const side = pick12Side(label, name);
      if (!side || value === null) {
        skipped.push(`1x2 label tak dikenal "${label ?? "?"}"/"${name ?? "?"}" (bookie ${bookId}) — skip`);
        continue;
      }
      let row = lines12.get(bookId);
      if (!row) {
        row = { bookmaker_id: bookId, bookmaker: bname, home: null, draw: null, away: null };
        lines12.set(bookId, row);
      }
      row[side] = value;
    } else {
      const side = pickOuSide(label, name);
      const line = pickOuLine(or);
      if (!side || !line || value === null) {
        skipped.push(`ou tak terurai (label "${label ?? "?"}", bookie ${bookId}) — skip`);
        continue;
      }
      const key = `${bookId}|${line}`;
      let row = linesOu.get(key);
      if (!row) {
        row = { bookmaker_id: bookId, bookmaker: bname, line, over: null, under: null };
        linesOu.set(key, row);
      }
      row[side] = value;
    }
  }

  // --- predictions (wajib berlabel tipe) ---
  const predictions: SmPrediction[] = [];
  for (const p of asArray(d.predictions)) {
    const pr = asRecord(p);
    if (!pr) continue;
    const typeId = num(pr.type_id);
    if (typeId === null) {
      skipped.push("prediction tanpa type_id — skip");
      continue;
    }
    const t = asRecord(pr.type);
    const typeName = str(t?.name) ?? str(t?.code) ?? `type:${typeId}`;
    const vals = asRecord(pr.predictions);
    predictions.push({
      type_id: typeId,
      type_name: typeName,
      values: vals ?? (pr.predictions !== undefined ? { value: pr.predictions } : {}),
    });
  }

  // --- lineups, grup per tim ---
  const groups = new Map<string, SmLineup>();
  for (const l of asArray(d.lineups)) {
    const lr = asRecord(l);
    if (!lr) continue;
    const tid = num(lr.team_id ?? asRecord(lr.team)?.id);
    const key = tid !== null ? `t:${tid}` : "t:unknown";
    let g = groups.get(key);
    if (!g) {
      g = { team_id: tid, team_name: null, formation: null, players: [] };
      groups.set(key, g);
    }
    const form = str(lr.formation);
    if (!g.formation && form) g.formation = form;
    const nm =
      str(lr.player_name) ?? str(lr.name) ?? str(asRecord(lr.player)?.name);
    if (!nm) continue;
    g.players.push({
      name: nm,
      position:
        str(lr.formation_position) ??
        str(lr.position_name) ??
        str(asRecord(lr.position)?.name) ??
        str(lr.position),
      number: num(lr.jersey_number ?? lr.number ?? asRecord(lr.player)?.number),
    });
  }
  for (const g of groups.values()) {
    if (g.team_id !== null && teamName.has(g.team_id)) g.team_name = teamName.get(g.team_id)!;
  }
  let lineup_home: SmLineup | null = null;
  let lineup_away: SmLineup | null = null;
  for (const g of groups.values()) {
    const side = g.team_id !== null ? teamSide.get(g.team_id) : undefined;
    if (side === "home" && !lineup_home) lineup_home = g;
    else if (side === "away" && !lineup_away) lineup_away = g;
  }
  if ((!lineup_home || !lineup_away) && groups.size > 0) {
    // Fallback urutan respons bila meta home/away absen — catat agar tidak dikira pasti.
    const [a, b] = [...groups.values()];
    if (!lineup_home) lineup_home = a ?? null;
    if (!lineup_away) lineup_away = b ?? (!lineup_home ? null : null);
    if (lineup_away === lineup_home) lineup_away = null;
    skipped.push("meta home/away participants absen — lineup_home/_away ikut urutan respons");
  }

  // --- sidelined (cedera/sanksi) ---
  const sidelined: SmSidelined[] = [];
  for (const s of asArray(d.sidelined)) {
    const sr = asRecord(s);
    if (!sr) continue;
    const nm = str(sr.player_name) ?? str(sr.name) ?? str(asRecord(sr.player)?.name);
    if (!nm) continue;
    const typeRec = asRecord(sr.type);
    sidelined.push({
      player_name: nm,
      team_id: num(sr.team_id ?? asRecord(sr.team)?.id),
      reason:
        str(typeRec?.name) ??
        str(sr.type) ??
        str(sr.reason) ??
        str(sr.description) ??
        null,
    });
  }

  return {
    fixture_id: Number(smFixtureId),
    odds_1x2: [...lines12.values()],
    odds_ou: [...linesOu.values()],
    predictions,
    lineup_home,
    lineup_away,
    sidelined,
    skipped,
  };
}

/** 1 call: tarik fixture detail dari Sportmonks + parse rapi. */
export async function fetchFixtureDetail(
  smFixtureId: number | string,
  opts: { apiToken?: string } = {}
): Promise<SmFixtureDetail> {
  const { body } = await smGetRaw(
    `/fixtures/${smFixtureId}`,
    {
      include: "odds.bookmaker;predictions.type;lineups;sidelined;participants",
      filters: "markets:1,80;bookmakers:35,20",
    },
    opts
  );
  return parseFixtureDetail(smFixtureId, body);
}
