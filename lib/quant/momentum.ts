/**
 * Momentum gol/xG last-3 vs matches 4-6 dari team_match_logs (Task 3 todo-offline-depth).
 *
 * Per tim: rata-rata goals-for 3 laga terakhir vs rata-rata 3 laga sebelumnya
 * (matches 4-6, window disjoint — bukan last-3 vs last-6 avg — supaya delta
 * tidak teredam oleh overlap subset), plus delta xG-for sebagai konfirmasi
 * kualitas peluang. KONTEKS ONLY: output modul ini DILARANG mengalir ke
 * probabilitas/fair odds Dixon-Coles — hanya tampil sebagai baris bukti
 * view + 1 paragraf konteks prompt sindikat.
 *
 * Definisi ambang (eksplisit, day-one):
 * - MOMENTUM_FLAT_GOALS = 0.34 gol/laga: |delta| di bawah ~1 gol per 3 laga
 *   = noise hasil (variansi gol tinggi), bukan sinyal momentum → DATAR.
 *   Panah NAIK bila delta >= +0.34, TURUN bila delta <= -0.34.
 * - MOMENTUM_FLAT_XG = 0.25 xG/laga: xG lebih stabil dari gol sehingga pita
 *   datarnya lebih sempit. xG delta DILAPORKAN saja (konfirmasi), TIDAK ikut
 *   menentukan arah panah — arah panah murni dari delta gol aktual (definisi
 *   momentum form), supaya 1 angka 1 aturan (aturan ganda = sengketa label).
 * - Delta dihitung dari rata-rata MENTAH lalu dibulatkan (r2), bukan dari
 *   selisih rata-rata yang sudah dibulatkan — menghindari artefak ±0.01
 *   pembulatan ganda (kasus nyata: 5/3 vs 4/3 mentah = +0.33 DATAR, tapi
 *   1.67-1.33 tampilan = +0.34 NAIK bila dihitung dari angka tampil).
 * - Tier keyakinan dari total sampel (binding constraint = window tua):
 *   <4 log (tanpa baseline: butuh 3 recent + >=1 tua) = INSUFFICIENT_DATA,
 *   4 log (3v1) = LOW, 5 log (3v2) = MODERATE, 6 log (3v3) = HIGH.
 *   n=3 ikut INSUFFICIENT_DATA walau >=3: tanpa laga 4-6 tak ada pembanding.
 *
 * Aturan jujur (tanpa imputasi):
 * - xG null di satu window → delta_xg null (bukan 0); panah gol tetap jalan.
 * - INSUFFICIENT_DATA → semua angka null, direction INSUFFICIENT_DATA.
 */
import { getPreMatchLogs, resolveTeamId } from "../db/team-telemetry";

export type MomentumDirection = "NAIK" | "TURUN" | "DATAR" | "INSUFFICIENT_DATA";

export type MomentumTier = "HIGH" | "MODERATE" | "LOW" | "INSUFFICIENT_DATA";

/** Window rolling total (3 recent + 3 tua), sama seperti telemetri utama. */
export const MOMENTUM_WINDOW = 6;
/** Ukuran window recent (3 laga terakhir). */
export const MOMENTUM_RECENT = 3;
/** Di bawah 4 log = INSUFFICIENT_DATA (butuh 3 recent + >=1 baseline tua). */
export const MOMENTUM_MIN_SAMPLES = 4;
/** |delta gol| di bawah ini = DATAR (~1 gol per 3 laga = noise, bukan sinyal). */
export const MOMENTUM_FLAT_GOALS = 0.34;
/** Pita datar xG (laporan saja, tak menentukan panah — xG lebih stabil). */
export const MOMENTUM_FLAT_XG = 0.25;

export interface TeamMomentum {
  team_id: string;
  /** Jumlah log yang dilihat (<= window). */
  sample_size: number;
  /** Log di window recent (<=3) dan window tua (<=3). */
  recent_sample: number;
  older_sample: number;
  /** Observasi xG per window (null-skip, bukan imputasi). */
  observed_xg_recent: number;
  observed_xg_older: number;
  avg_goals_recent: number | null;
  avg_goals_older: number | null;
  /** Rata-rata recent minus tua (gol/laga). null bila tak cukup sampel. */
  delta_goals: number | null;
  avg_xg_recent: number | null;
  avg_xg_older: number | null;
  /** Idem sisi xG. null bila tak cukup sampel ATAU salah satu window 0 obs xG. */
  delta_xg: number | null;
  direction: MomentumDirection;
  /** |delta_goals|. null bila tak cukup sampel. */
  magnitude: number | null;
  confidence_tier: MomentumTier;
  is_estimated: boolean;
  /** 1 kalimat konteks null-jujur, siap tampil. */
  summary: string;
}

/** Tier dari total sampel (binding constraint = window tua 3v1/3v2/3v3). */
export function tierForMomentumSamples(n: number): {
  confidence_tier: MomentumTier;
  is_estimated: boolean;
} {
  if (n < MOMENTUM_MIN_SAMPLES) return { confidence_tier: "INSUFFICIENT_DATA", is_estimated: true };
  if (n === 4) return { confidence_tier: "LOW", is_estimated: true };
  if (n === 5) return { confidence_tier: "MODERATE", is_estimated: false };
  return { confidence_tier: "HIGH", is_estimated: false };
}

/** Pemetaan murni delta gol → arah panah (delta = avg recent minus tua). */
export function labelMomentumDelta(delta: number): Exclude<MomentumDirection, "INSUFFICIENT_DATA"> {
  if (!Number.isFinite(delta)) return "DATAR";
  if (delta >= MOMENTUM_FLAT_GOALS) return "NAIK";
  if (delta <= -MOMENTUM_FLAT_GOALS) return "TURUN";
  return "DATAR";
}

const r2 = (x: number): number => Number(x.toFixed(2));
const signed = (x: number): string => (x >= 0 ? `+${x.toFixed(2)}` : x.toFixed(2));

const ARROW: Record<Exclude<MomentumDirection, "INSUFFICIENT_DATA">, string> = {
  NAIK: "↗",
  TURUN: "↘",
  DATAR: "→",
};

/**
 * Agregat momentum 1 tim (anti-leakage via beforeDate, pola query sama
 * seperti getTeamRollingTelemetry).
 */
export function getTeamMomentum(
  teamIdOrName: string,
  limit: number = MOMENTUM_WINDOW,
  beforeDate?: string
): TeamMomentum {
  const teamId = resolveTeamId(teamIdOrName);
  const logs = getPreMatchLogs(teamId, limit, beforeDate);
  const recent = logs.slice(0, MOMENTUM_RECENT);
  const older = logs.slice(MOMENTUM_RECENT);
  const tier = tierForMomentumSamples(logs.length);

  if (logs.length < MOMENTUM_MIN_SAMPLES || older.length === 0) {
    return {
      team_id: teamId,
      sample_size: logs.length,
      recent_sample: recent.length,
      older_sample: older.length,
      observed_xg_recent: 0,
      observed_xg_older: 0,
      avg_goals_recent: null,
      avg_goals_older: null,
      delta_goals: null,
      avg_xg_recent: null,
      avg_xg_older: null,
      delta_xg: null,
      direction: "INSUFFICIENT_DATA",
      magnitude: null,
      confidence_tier: "INSUFFICIENT_DATA",
      is_estimated: true,
      summary: `${teamId}: data momentum tak cukup (${logs.length} laga, butuh ≥4) — arah momentum tidak disimpulkan.`,
    };
  }

  const avgRaw = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  const avgGoalsRecent = r2(avgRaw(recent.map((l) => l.goals_for)));
  const avgGoalsOlder = r2(avgRaw(older.map((l) => l.goals_for)));
  const deltaGoals = r2(avgRaw(recent.map((l) => l.goals_for)) - avgRaw(older.map((l) => l.goals_for)));

  const xgRecent = recent.filter((l) => l.xg_for != null).map((l) => l.xg_for as number);
  const xgOlder = older.filter((l) => l.xg_for != null).map((l) => l.xg_for as number);
  const avgXgRecent = xgRecent.length > 0 ? r2(avgRaw(xgRecent)) : null;
  const avgXgOlder = xgOlder.length > 0 ? r2(avgRaw(xgOlder)) : null;
  const deltaXg =
    xgRecent.length > 0 && xgOlder.length > 0 ? r2(avgRaw(xgRecent) - avgRaw(xgOlder)) : null;

  const direction = labelMomentumDelta(deltaGoals);

  const xgNote =
    deltaXg !== null
      ? `, xG ${signed(deltaXg)}`
      : `, xG: data tak cukup (${xgRecent.length} vs ${xgOlder.length} obs)`;

  return {
    team_id: teamId,
    sample_size: logs.length,
    recent_sample: recent.length,
    older_sample: older.length,
    observed_xg_recent: xgRecent.length,
    observed_xg_older: xgOlder.length,
    avg_goals_recent: avgGoalsRecent,
    avg_goals_older: avgGoalsOlder,
    delta_goals: deltaGoals,
    avg_xg_recent: avgXgRecent,
    avg_xg_older: avgXgOlder,
    delta_xg: deltaXg,
    direction,
    magnitude: r2(Math.abs(deltaGoals)),
    confidence_tier: tier.confidence_tier,
    is_estimated: tier.is_estimated,
    summary:
      `${teamId}: ${ARROW[direction]} ${direction} — gol ${avgGoalsRecent.toFixed(2)}/laga ` +
      `(3 terakhir) vs ${avgGoalsOlder.toFixed(2)}/laga (3 sebelumnya) ` +
      `(selisih ${signed(deltaGoals)}${xgNote}, ${tier.confidence_tier}).`,
  };
}

export interface MomentumMatchup {
  home: TeamMomentum;
  away: TeamMomentum;
}

function sideToken(m: TeamMomentum, displayName: string): string | null {
  if (m.confidence_tier === "INSUFFICIENT_DATA" || m.delta_goals === null) return null;
  const dir = m.direction === "INSUFFICIENT_DATA" ? "DATAR" : m.direction;
  return `${displayName} (${ARROW[dir]} ${signed(m.delta_goals)})`;
}

/**
 * 1 baris bukti gabungan untuk mapper view (bukti ≤5 terjaga oleh pemanggil).
 * Null = kedua tim tak cukup data → pemanggil tidak menambah baris apa pun.
 */
export function formatMomentumEvidenceRow(
  mm: MomentumMatchup,
  homeName?: string,
  awayName?: string
): { label: string; value: string } | null {
  if (!mm || !mm.home || !mm.away) return null;
  const h = sideToken(mm.home, homeName ?? mm.home.team_id);
  const a = sideToken(mm.away, awayName ?? mm.away.team_id);
  if (!h && !a) return null;
  const value = h && a ? `${h} vs ${a}` : `${h ?? a} (lawan: data tak cukup)`;
  return { label: "Momentum (3 vs 3 Laga)", value };
}

/**
 * 1 paragraf konteks momentum untuk prompt sindikat (konteks only —
 * teks ini DILARANG dipakai mengubah probabilitas/fair odds model).
 */
export function formatMomentumMatchupParagraph(
  mm: MomentumMatchup,
  homeName?: string,
  awayName?: string
): string {
  if (!mm || !mm.home || !mm.away) return "";
  const hName = homeName ?? mm.home.team_id;
  const aName = awayName ?? mm.away.team_id;
  const side = (m: TeamMomentum, name: string): string => {
    if (m.confidence_tier === "INSUFFICIENT_DATA" || m.delta_goals === null) {
      return `${name}: data momentum tak cukup (${m.sample_size} laga) — tanpa kesimpulan arah.`;
    }
    const xg =
      m.delta_xg !== null
        ? `, xG ${signed(m.delta_xg)}`
        : ` (xG: data tak cukup)`;
    return (
      `${name}: ${ARROW[m.direction === "INSUFFICIENT_DATA" ? "DATAR" : m.direction]} ${m.direction} — ` +
      `gol ${m.avg_goals_recent?.toFixed(2)}/laga (3 terakhir) vs ${m.avg_goals_older?.toFixed(2)}/laga ` +
      `(3 sebelumnya) (selisih ${signed(m.delta_goals)}${xg}, ${m.confidence_tier}).`
    );
  };
  return (
    `KONTEKS MOMENTUM (gol/xG 3 laga terakhir vs 3 sebelumnya — konteks narasi saja, JANGAN ubah probabilitas/fair odds model): ` +
    `${side(mm.home, hName)} ${side(mm.away, aName)}`
  );
}
