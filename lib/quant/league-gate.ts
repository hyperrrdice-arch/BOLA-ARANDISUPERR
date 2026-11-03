/**
 * LEAGUE CALIBRATION GATE — jembatan registry `league_calibration`
 * (thestats_dataset.db) ke jalur analisis.
 *
 * Registry adalah sumber kebenaran status per liga (ditulis
 * scripts/calibrate-ratings.ts):
 *   calibrated   → boleh disajikan normal
 *   partial      → boleh disajikan HANYA dengan flag eksplisit
 *   uncalibrated → TIDAK boleh disajikan (blokir + alasan eksplisit)
 *
 * Modul ini murni membaca registry (cache per proses). Bila registry/DB
 * tidak tersedia, return null — pemanggil wajib menandai status
 * 'unknown', BUKAN menganggap calibrated (tidak ada penyajian diam-diam).
 */
import { getTheStatsDb } from "../db/thestats-dataset";

export type CalibrationStatus = "calibrated" | "partial" | "uncalibrated" | "unknown";

export interface LeagueGateInfo {
  /** league_id di registry: 'sm:<id>' untuk Sportmonks, kode divisi untuk legacy. */
  leagueId: string;
  div: string;
  status: Exclude<CalibrationStatus, "unknown">;
  leagueName: string | null;
  scaleRatio: number | null;
  telemetryCoverage: number | null;
  nMatches: number | null;
  notes: string | null;
  /** Alasan manusiawi mengapa status ini berlaku (untuk flag/blokir eksplisit). */
  reason: string;
}

/** Divisi ratings → league_id registry. SM<id> → sm:<id>; legacy = divisi itu sendiri. */
export function divToLeagueId(div: string | null | undefined): string | null {
  if (!div) return null;
  const d = div.trim();
  const m = d.match(/^SM(\d+)$/i);
  if (m) return `sm:${m[1]}`;
  if (/^sm:\d+$/i.test(d)) return d.toLowerCase();
  return d; // legacy: registry memakai kode divisi (E0, SP1, …) sebagai league_id
}

/** Hint kompetisi mentah (mis. 'sm:8' dari fixture) → divisi ratings. */
export function competitionIdToDiv(competitionId: string | null | undefined): string | null {
  if (!competitionId) return null;
  const m = competitionId.trim().match(/^sm:(\d+)$/i);
  return m ? `SM${m[1]}` : null;
}

interface RegistryRow {
  league_id: string;
  league_name: string | null;
  status: string;
  n_matches: number | null;
  telemetry_coverage: number | null;
  scale_ratio: number | null;
  notes: string | null;
}

let cache: Map<string, RegistryRow> | null = null;
let cacheFailed = false;

function loadRegistry(): Map<string, RegistryRow> | null {
  if (cache) return cache;
  if (cacheFailed) return null;
  try {
    const db = getTheStatsDb();
    const rows = db
      .prepare(
        "SELECT league_id, league_name, status, n_matches, telemetry_coverage, scale_ratio, notes FROM league_calibration"
      )
      .all() as unknown as RegistryRow[];
    cache = new Map(rows.map((r) => [r.league_id, r]));
    return cache;
  } catch {
    cacheFailed = true;
    return null;
  }
}

function reasonFor(row: RegistryRow): string {
  const bits: string[] = [];
  if (row.status === "calibrated") bits.push("Lolos gerbang kalibrasi (uji skala + cakupan telemetri, dan gerbang OOS bila tersedia).");
  if (row.status === "partial") bits.push("Fit tersedia tapi liga berstatus PARTIAL — sajikan dengan flag, bukan sebagai ratings penuh.");
  if (row.status === "uncalibrated") bits.push("Liga UNCALIBRATED — analisis kuantitatif diblokir.");
  if (row.scale_ratio != null) bits.push(`rasio skala=${row.scale_ratio}`);
  if (row.telemetry_coverage != null) bits.push(`cakupan telemetri=${row.telemetry_coverage}`);
  if (row.notes) bits.push(row.notes);
  return bits.join(" ");
}

/** Status gerbang untuk satu divisi ratings. null = registry tak terbaca. */
export function getLeagueGate(div: string | null | undefined): LeagueGateInfo | null {
  const leagueId = divToLeagueId(div);
  if (!leagueId || !div) return null;
  const reg = loadRegistry();
  if (!reg) return null;
  const row = reg.get(leagueId);
  if (!row) return null;
  const status = (["calibrated", "partial", "uncalibrated"].includes(row.status)
    ? row.status
    : "uncalibrated") as LeagueGateInfo["status"];
  return {
    leagueId,
    div,
    status,
    leagueName: row.league_name,
    scaleRatio: row.scale_ratio,
    telemetryCoverage: row.telemetry_coverage,
    nMatches: row.n_matches,
    notes: row.notes,
    reason: reasonFor({ ...row, status }),
  };
}

/** Untuk test/diagnostik: kosongkan cache registry. */
export function resetLeagueGateCache(): void {
  cache = null;
  cacheFailed = false;
}
