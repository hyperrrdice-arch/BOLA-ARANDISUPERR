/**
 * Profil tempo babak 1 vs 2 dari team_match_logs (Task 2 todo-offline-depth).
 *
 * Agregat `first_half/second_half_xg_for/against` 6 laga terakhir per tim
 * menjadi label arah tempo + selisih xG. KONTEKS ONLY: output modul ini
 * DILARANG mengalir ke probabilitas/fair odds Dixon-Coles — hanya tampil
 * sebagai baris bukti view + 1 paragraf konteks prompt sindikat.
 *
 * Aturan jujur (tanpa imputasi):
 * - Log tanpa xG babak dilewati (bukan diisi 0).
 * - < `HALF_PROFILE_MIN_SAMPLES` log berskor babak → tier INSUFFICIENT_DATA,
 *   semua angka null, label INSUFFICIENT_DATA.
 */
import { getPreMatchLogs, resolveTeamId } from "../db/team-telemetry";

export type HalfProfileLabel =
  | "SECOND_HALF_TEAM"
  | "SLOW_STARTER"
  | "FAST_STARTER"
  | "SEIMBANG"
  | "INSUFFICIENT_DATA";

export type HalfConfidenceTier = "HIGH" | "MODERATE" | "LOW" | "INSUFFICIENT_DATA";

/** Window form rolling, sama seperti telemetri utama (6 laga terakhir). */
export const HALF_PROFILE_WINDOW = 6;
/** Di bawah ini = INSUFFICIENT_DATA (acceptance Task 2: <3 log berskor babak). */
export const HALF_PROFILE_MIN_SAMPLES = 3;
/** |selisih| di bawah ini = SEIMBANG (noise babak, bukan sinyal tempo). */
export const HALF_BALANCED_BAND = 0.15;
/** Selisih babak-2 di atas ini = SECOND_HALF_TEAM penuh (bukan sekadar slow-start). */
export const HALF_STRONG_SECOND_HALF = 0.35;

export interface TeamHalfProfile {
  team_id: string;
  /** Jumlah log yang dilihat (<= window). */
  sample_size: number;
  /** Log yang punya xG babak-1 DAN babak-2 (sisi for). */
  observed_half_samples: number;
  avg_first_half_xg_for: number | null;
  avg_second_half_xg_for: number | null;
  avg_first_half_xg_against: number | null;
  avg_second_half_xg_against: number | null;
  /** Rata-rata babak-2 minus babak-1 (sisi for, xG/laga). null bila tak cukup sampel. */
  diff_second_minus_first: number | null;
  /** Idem sisi against (ketahanan babak-2 vs babak-1). null bila tak cukup sampel. */
  diff_against_second_minus_first: number | null;
  label: HalfProfileLabel;
  confidence_tier: HalfConfidenceTier;
  is_estimated: boolean;
  /** 1 kalimat konteks null-jujur, siap tampil. */
  summary: string;
}

/**
 * Tier keyakinan ala special-markets-engine.tierForSamples, dengan lantai
 * diperketat: <3 sampel = INSUFFICIENT_DATA (half-xG lebih jarang terisi
 * daripada telemetri utama, jadi ambang jujur dinaikkan).
 */
export function tierForHalfSamples(n: number): {
  confidence_tier: HalfConfidenceTier;
  is_estimated: boolean;
} {
  if (n < HALF_PROFILE_MIN_SAMPLES) return { confidence_tier: "INSUFFICIENT_DATA", is_estimated: true };
  if (n === 3) return { confidence_tier: "LOW", is_estimated: true };
  if (n <= 5) return { confidence_tier: "MODERATE", is_estimated: false };
  return { confidence_tier: "HIGH", is_estimated: false };
}

/** Pemetaan murni selisih → label (diff = rata-rata babak-2 minus babak-1). */
export function labelHalfDiff(diff: number): Exclude<HalfProfileLabel, "INSUFFICIENT_DATA"> {
  if (!Number.isFinite(diff)) return "SEIMBANG";
  if (diff >= HALF_STRONG_SECOND_HALF) return "SECOND_HALF_TEAM";
  if (diff >= HALF_BALANCED_BAND) return "SLOW_STARTER";
  if (diff <= -HALF_BALANCED_BAND) return "FAST_STARTER";
  return "SEIMBANG";
}

const r2 = (x: number): number => Number(x.toFixed(2));
const signed = (x: number): string => (x >= 0 ? `+${x.toFixed(2)}` : x.toFixed(2));

/**
 * Agregat profil babak 1 vs 2 untuk 1 tim (anti-leakage via beforeDate,
 * pola query sama seperti getTeamRollingTelemetry).
 */
export function getTeamHalfProfile(
  teamIdOrName: string,
  limit: number = HALF_PROFILE_WINDOW,
  beforeDate?: string
): TeamHalfProfile {
  const teamId = resolveTeamId(teamIdOrName);
  const logs = getPreMatchLogs(teamId, limit, beforeDate);
  const scored = logs.filter((l) => l.first_half_xg_for != null && l.second_half_xg_for != null);
  const n = scored.length;
  const tier = tierForHalfSamples(n);

  if (n < HALF_PROFILE_MIN_SAMPLES) {
    return {
      team_id: teamId,
      sample_size: logs.length,
      observed_half_samples: n,
      avg_first_half_xg_for: null,
      avg_second_half_xg_for: null,
      avg_first_half_xg_against: null,
      avg_second_half_xg_against: null,
      diff_second_minus_first: null,
      diff_against_second_minus_first: null,
      label: "INSUFFICIENT_DATA",
      confidence_tier: tier.confidence_tier,
      is_estimated: true,
      summary: `${teamId}: data xG babak tak cukup (${n}/${logs.length} laga) — profil babak tidak disimpulkan.`,
    };
  }

  const avg = (xs: number[]): number | null => (xs.length > 0 ? r2(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const fhFor = scored.map((l) => l.first_half_xg_for as number);
  const shFor = scored.map((l) => l.second_half_xg_for as number);
  const fhAg = scored
    .filter((l) => l.first_half_xg_against != null && l.second_half_xg_against != null)
    .map((l) => ({ f: l.first_half_xg_against as number, s: l.second_half_xg_against as number }));

  const avgFhFor = avg(fhFor) as number;
  const avgShFor = avg(shFor) as number;
  const avgFhAg = fhAg.length > 0 ? avg(fhAg.map((x) => x.f)) : null;
  const avgShAg = fhAg.length > 0 ? avg(fhAg.map((x) => x.s)) : null;
  const diff = r2(avgShFor - avgFhFor);
  const diffAg = avgFhAg !== null && avgShAg !== null ? r2(avgShAg - avgFhAg) : null;
  const label = labelHalfDiff(diff);

  return {
    team_id: teamId,
    sample_size: logs.length,
    observed_half_samples: n,
    avg_first_half_xg_for: avgFhFor,
    avg_second_half_xg_for: avgShFor,
    avg_first_half_xg_against: avgFhAg,
    avg_second_half_xg_against: avgShAg,
    diff_second_minus_first: diff,
    diff_against_second_minus_first: diffAg,
    label,
    confidence_tier: tier.confidence_tier,
    is_estimated: tier.is_estimated,
    summary:
      `${teamId}: ${label} — xG babak-2 ${avgShFor.toFixed(2)}/laga vs babak-1 ${avgFhFor.toFixed(2)}/laga ` +
      `(selisih ${signed(diff)}, ${n} laga, ${tier.confidence_tier}).`,
  };
}

export interface HalfMatchup {
  home: TeamHalfProfile;
  away: TeamHalfProfile;
}

const SHORT: Record<Exclude<HalfProfileLabel, "INSUFFICIENT_DATA">, string> = {
  SECOND_HALF_TEAM: "babak-2",
  SLOW_STARTER: "slow-start",
  FAST_STARTER: "fast-start",
  SEIMBANG: "seimbang",
};

function sideToken(p: TeamHalfProfile, displayName: string): string | null {
  if (p.confidence_tier === "INSUFFICIENT_DATA" || p.diff_second_minus_first === null) return null;
  const label = p.label === "INSUFFICIENT_DATA" ? "SEIMBANG" : p.label;
  return `${displayName} (${SHORT[label]} ${signed(p.diff_second_minus_first)})`;
}

/**
 * 1 baris bukti gabungan untuk mapper view (bukti ≤5 terjaga oleh pemanggil).
 * Null = kedua tim tak cukup data → pemanggil tidak menambah baris apa pun.
 */
export function formatHalfEvidenceRow(
  hp: HalfMatchup,
  homeName?: string,
  awayName?: string
): { label: string; value: string } | null {
  if (!hp || !hp.home || !hp.away) return null;
  const h = sideToken(hp.home, homeName ?? hp.home.team_id);
  const a = sideToken(hp.away, awayName ?? hp.away.team_id);
  if (!h && !a) return null;
  const value = h && a ? `${h} vs ${a}` : `${h ?? a} (lawan: data tak cukup)`;
  return { label: "Profil Babak (xG B1 vs B2)", value };
}

/**
 * 1 paragraf konteks tempo babak untuk prompt sindikat (konteks only —
 * teks ini DILARANG dipakai mengubah probabilitas/fair odds model).
 */
export function formatHalfMatchupParagraph(
  hp: HalfMatchup,
  homeName?: string,
  awayName?: string
): string {
  if (!hp || !hp.home || !hp.away) return "";
  const hName = homeName ?? hp.home.team_id;
  const aName = awayName ?? hp.away.team_id;
  const side = (p: TeamHalfProfile, name: string): string => {
    if (p.confidence_tier === "INSUFFICIENT_DATA" || p.diff_second_minus_first === null) {
      return `${name}: data xG babak tak cukup (${p.observed_half_samples}/${p.sample_size} laga) — tanpa kesimpulan tempo.`;
    }
    const ag =
      p.diff_against_second_minus_first !== null
        ? ` (lawan bikin ${signed(p.diff_against_second_minus_first)} xG babak-2 vs babak-1)`
        : "";
    return (
      `${name}: ${p.label} — xG babak-2 ${p.avg_second_half_xg_for?.toFixed(2)}/laga vs ` +
      `babak-1 ${p.avg_first_half_xg_for?.toFixed(2)}/laga (selisih ${signed(p.diff_second_minus_first)}, ` +
      `${p.observed_half_samples} laga, ${p.confidence_tier})${ag}.`
    );
  };
  return (
    `KONTEKS TEMPO BABAK (xG terukur 6 laga terakhir — konteks narasi saja, JANGAN ubah probabilitas/fair odds model): ` +
    `${side(hp.home, hName)} ${side(hp.away, aName)}`
  );
}
