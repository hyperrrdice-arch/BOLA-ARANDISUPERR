/**
 * FALLBACK-SOURCE GUARD (Task 1 parlay-pivot) — DETERMINISTIK, BUKAN LLM.
 *
 * Aturan owner: bila salah satu sisi rating bersumber `fallback` (atau 0 sampel
 * xG + bobot shrinkage < 0.25), value play butuh edge > FALLBACK_MIN_EDGE
 * atau verdict = SKIP dengan alasan kualitas data.
 *
 * - Guard ini TIDAK menyentuh probabilitas/fair odds/EV/Kelly (quant frozen).
 *   Ia hanya membaca calibration_metadata + value_bets dan memutuskan lapisan
 *   verdict/flag. Angka quant di-copy apa adanya di mapper.
 * - Dipakai oleh mapPipelineToView() (lib/view/analysis-view.ts) — satu choke
 *   point backend, tanpa sentuhan components/ atau app/.
 */

export const FALLBACK_MIN_EDGE = 0.50;

/** Batas bobot shrinkage di bawahnya sampel xG dianggap tidak kredibel. */
const FALLBACK_MIN_WEIGHT = 0.25;

export interface GuardValueBet {
  market_name?: unknown;
  selection?: unknown;
  bookmaker_odds?: unknown;
  fair_odds?: unknown;
  expected_value?: unknown;
  ev_percentage?: unknown;
  is_positive_ev?: unknown;
}

export interface FallbackDetection {
  homeSource: string | null;
  awaySource: string | null;
  homeFallback: boolean;
  awayFallback: boolean;
  involved: boolean;
  fallbackSide: "home" | "away" | "both" | null;
}

function readKey(obj: unknown, ...keys: string[]): unknown {
  if (obj === null || typeof obj !== "object") return undefined;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    if (rec[k] !== undefined) return rec[k];
  }
  return undefined;
}

/**
 * Satu sisi fallback bila source == "fallback" ATAU
 * (observed_xg_samples == 0 DAN bobot shrinkage < 0.25).
 */
export function isFallbackSide(
  source: unknown,
  observedXg: unknown,
  weight: unknown
): boolean {
  if (source === "fallback") return true;
  return (
    observedXg === 0 &&
    typeof weight === "number" &&
    Number.isFinite(weight) &&
    weight < FALLBACK_MIN_WEIGHT
  );
}

export function detectFallbackSource(calibration: unknown): FallbackDetection {
  const homeSource = (readKey(calibration, "home_source", "homeSource") ?? null) as string | null;
  const awaySource = (readKey(calibration, "away_source", "awaySource") ?? null) as string | null;
  const weights = readKey(calibration, "shrinkage_weights", "shrinkageWeights") as
    | Record<string, unknown>
    | undefined;
  const samples = readKey(calibration, "observed_xg_samples", "observedXgSamples") as
    | Record<string, unknown>
    | undefined;
  const homeFallback = isFallbackSide(
    homeSource,
    readKey(samples, "home"),
    readKey(weights, "home")
  );
  const awayFallback = isFallbackSide(
    awaySource,
    readKey(samples, "away"),
    readKey(weights, "away")
  );
  return {
    homeSource: typeof homeSource === "string" ? homeSource : null,
    awaySource: typeof awaySource === "string" ? awaySource : null,
    homeFallback,
    awayFallback,
    involved: homeFallback || awayFallback,
    fallbackSide: homeFallback && awayFallback ? "both" : homeFallback ? "home" : awayFallback ? "away" : null,
  };
}

/** Pick +EV utama = entri is_positive_ev pertama (urutan sama seperti hero ev_teratas). */
export function topPositiveEvPick(valueBets: unknown): GuardValueBet | null {
  if (!Array.isArray(valueBets)) return null;
  for (const b of valueBets) {
    if (b !== null && typeof b === "object" && (b as Record<string, unknown>).is_positive_ev === true) {
      return b as GuardValueBet;
    }
  }
  return null;
}

/** Edge = expected_value desimal (mis. 0.3948 = +39.5%); fallback parse ev_percentage. */
export function guardEdgeOf(pick: GuardValueBet | null): number | null {
  if (!pick) return null;
  const ev = pick.expected_value;
  if (typeof ev === "number" && Number.isFinite(ev)) return ev;
  const pct = pick.ev_percentage;
  if (typeof pct === "string") {
    const m = pct.match(/([+-]?[\d]+(?:\.[\d]+)?)/);
    if (m) {
      const v = parseFloat(m[1]);
      if (Number.isFinite(v)) return v / 100;
    }
  }
  return null;
}

export interface FallbackGuardFlag {
  skipped: boolean;
  reason: string;
  edge: number | null;
  threshold: number;
  original_verdict: string;
  original_pick: {
    market_name: string;
    selection: string;
    bookmaker_odds: number;
    fair_odds: number;
    ev_percentage: string;
  } | null;
  fallback_side: "home" | "away" | "both" | null;
}

export interface DataQualityFlag {
  home_source: string | null;
  away_source: string | null;
  is_fallback_involved: boolean;
}

export interface FallbackGuardResult {
  verdict: string;
  fallback_guard: FallbackGuardFlag;
  data_quality: DataQualityFlag;
}

function fmtPct(edge: number): string {
  const v = Math.round(edge * 1000) / 10;
  return `${v > 0 ? "+" : ""}${v}%`;
}

function sideLabel(side: "home" | "away" | "both" | null, homeTeam?: string, awayTeam?: string): string {
  if (side === "both") return `kedua sisi (${homeTeam ?? "?"} & ${awayTeam ?? "?"})`;
  if (side === "home") return `kandang (${homeTeam ?? "?"})`;
  if (side === "away") return `tamu (${awayTeam ?? "?"})`;
  return "salah satu sisi";
}

export function applyFallbackGuard(input: {
  calibration: unknown;
  valueBets: unknown;
  verdict: string;
  homeTeam?: string;
  awayTeam?: string;
}): FallbackGuardResult {
  const { calibration, valueBets, verdict, homeTeam, awayTeam } = input;
  const det = detectFallbackSource(calibration);
  const data_quality: DataQualityFlag = {
    home_source: det.homeSource,
    away_source: det.awaySource,
    is_fallback_involved: det.involved,
  };
  const top = topPositiveEvPick(valueBets);
  const original_pick =
    top !== null
      ? {
          market_name: String(top.market_name ?? "?"),
          selection: String(top.selection ?? "?"),
          bookmaker_odds: typeof top.bookmaker_odds === "number" ? top.bookmaker_odds : NaN,
          fair_odds: typeof top.fair_odds === "number" ? top.fair_odds : NaN,
          ev_percentage: String(top.ev_percentage ?? "?"),
        }
      : null;

  const base = {
    threshold: FALLBACK_MIN_EDGE,
    original_verdict: verdict,
    original_pick,
    fallback_side: det.fallbackSide,
  };

  // Bukan fallback → guard tidak memblokir, verdict utuh.
  if (!det.involved) {
    return {
      verdict,
      fallback_guard: {
        ...base,
        skipped: false,
        reason: "Tidak ada sisi fallback; guard tidak memblokir.",
        edge: guardEdgeOf(top),
      },
      data_quality,
    };
  }

  // Fallback terlibat tapi tidak ada pick +EV → tidak ada value play yang diblokir.
  if (!top) {
    return {
      verdict,
      fallback_guard: {
        ...base,
        skipped: false,
        reason: "Sisi fallback terlibat tapi tidak ada pick +EV; tidak ada value play yang diblokir.",
        edge: null,
      },
      data_quality,
    };
  }

  const edge = guardEdgeOf(top);

  // Edge tak terukur pada data fallback → SKIP konservatif (jangan loloskan angka gelap).
  if (edge === null || !Number.isFinite(edge)) {
    const reason =
      `Kualitas data rendah: sisi ${sideLabel(det.fallbackSide, homeTeam, awayTeam)} bersumber ` +
      `fallback dengan edge tak terukur sehingga value play DITAHAN.`;
    return {
      verdict: `SKIP — ${reason} (pick model ${original_pick?.selection ?? "?"} bukan rekomendasi).`,
      fallback_guard: { ...base, skipped: true, reason, edge: null },
      data_quality,
    };
  }

  // Edge < ambang → SKIP; pick lama tercatat di original_pick/original_verdict.
  if (edge < FALLBACK_MIN_EDGE) {
    const reason =
      `Kualitas data rendah: sisi ${sideLabel(det.fallbackSide, homeTeam, awayTeam)} bersumber ` +
      `fallback (0 sampel xG, bobot shrinkage <0.25) dengan edge ${fmtPct(edge)} di bawah ambang ` +
      `${Math.round(FALLBACK_MIN_EDGE * 100)}% sehingga value play DITAHAN.`;
    return {
      verdict:
        `SKIP — ${reason} (pick model ${original_pick?.selection ?? "?"} ` +
        `${original_pick?.market_name ?? "?"} @${original_pick?.bookmaker_odds ?? "?"} bukan rekomendasi).`,
      fallback_guard: { ...base, skipped: true, reason, edge },
      data_quality,
    };
  }

  // Edge ≥ ambang → lolos, tapi verdict wajib 1 kalimat peringatan kualitas data.
  const warning =
    `Peringatan kualitas data: sisi ${sideLabel(det.fallbackSide, homeTeam, awayTeam)} bersumber ` +
    `fallback (0 sampel xG, bobot shrinkage <0.25) sehingga edge ${fmtPct(edge)} ini belum stabil — ` +
    `jadikan spekulasi kecil, bukan leg utama parlay.`;
  return {
    verdict: `${verdict} ${warning}`,
    fallback_guard: {
      ...base,
      skipped: false,
      reason: `Sisi fallback terlibat tapi edge ${fmtPct(edge)} ≥ ambang ${Math.round(FALLBACK_MIN_EDGE * 100)}%; lolos dengan peringatan.`,
      edge,
    },
    data_quality,
  };
}
