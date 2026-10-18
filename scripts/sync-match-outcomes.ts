/**
 * PULLBACK OUTCOME (DB SNAPSHOT T3) — tarik hasil aktual untuk snapshot yang
 * kickoff-nya sudah lewat, supaya prediksi bisa dibandingkan dengan kenyataan.
 *
 * Urutan sumber (sesuai kontrak):
 *   1. LOKAL DULU — `data/thestats_dataset.db`: `matches` (skor/status) +
 *      `team_match_logs` dua tim (statistik pasca-laga 60+ kolom).
 *   2. Online HANYA kalau lokal kosong — `cachedStatsGet("/football/matches/{id}")`.
 *      `source` dicatat supaya jelas angka datang dari mana.
 *
 * Odds penutup = odds 1X2/O-U dari snapshot TERAKHIR match itu (harga terakhir
 * yang kita lihat pre-match), dicatat sebagai `closing_source = 'snapshot'`.
 *
 * Idempotent: match yang sudah ada di `match_outcomes` dilewati, jadi dua kali
 * jalan tidak menambah baris. Laga belum selesai TIDAK ditulis (status bukan
 * 'finished' → skip, bukan tulis dengan hasil parsial).
 *
 * Jalankan: npx tsx scripts/sync-match-outcomes.ts [--match <match_id>]
 */
import { getTheStatsDb } from "../lib/db/thestats-dataset";
import { getSnapshotDb, upsertOutcome, deriveMarketKey, type MatchOutcomeInput } from "../lib/db/analysis-snapshot";
import { cachedStatsGet } from "../lib/stats-cache";

// Auto-load .env.local (pola sama dengan scripts/sync-weekly-telemetry.ts) —
// fallback online butuh STATS_API_KEY yang hanya ada di file itu.
try {
  if (typeof (process as any).loadEnvFile === "function") {
    (process as any).loadEnvFile(".env.local");
  }
} catch {}

const matchArgIndex = process.argv.indexOf("--match");
const forcedMatch = matchArgIndex >= 0 ? process.argv[matchArgIndex + 1] : null;

const dataset = getTheStatsDb();
const snapshot = getSnapshotDb();

// ---------------------------------------------------------------------------
// Kandidat: match_id dari snapshot yang belum punya outcome, dan snapshot
// terakhirnya sudah kickoff (atau kickoff-nya tidak diketahui = riwayat lama).
// ---------------------------------------------------------------------------
const candidates: string[] = forcedMatch
  ? [forcedMatch]
  : (snapshot
      .prepare(`
        SELECT DISTINCT s.match_id
        FROM analysis_snapshots s
        LEFT JOIN match_outcomes o ON o.match_id = s.match_id
        WHERE o.match_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM analysis_snapshots s2
            WHERE s2.match_id = s.match_id
              AND s2.kickoff_utc IS NOT NULL
              AND s2.kickoff_utc > ?
          )
      `)
      // Bandingkan sesama ISO 8601 — datetime('now') berformat "YYYY-MM-DD HH:MM:SS"
      // selalu kalah string-compare vs "YYYY-MM-DDT.." sehingga outcome tertunda
      // sampai hari berikutnya (audit 2026-10-18).
      .all(new Date().toISOString()) as { match_id: string }[]).map((r) => r.match_id);

if (candidates.length === 0) {
  console.log("[sync-outcomes] Tidak ada match yang perlu ditarik.");
  process.exit(0);
}

/**
 * Odds penutup: dari snapshot TERAKHIR match (snapshot_id tertinggi dengan
 * lead_time > 0 kalau ada). Ambil dari value_bets_json via deriveMarketKey
 * supaya key yang dipakai sama dengan tabel snapshot.
 */
function closingOddsFromSnapshots(matchId: string): {
  home: number | null;
  draw: number | null;
  away: number | null;
  over25: number | null;
  under25: number | null;
} {
  const empty = { home: null, draw: null, away: null, over25: null, under25: null };
  const row = snapshot
    .prepare(`
      SELECT value_bets_json, home_team, away_team
      FROM analysis_snapshots
      WHERE match_id = ?
      ORDER BY (lead_time_minutes > 0) DESC, snapshot_id DESC
      LIMIT 1
    `)
    .get(matchId) as { value_bets_json: string | null; home_team: string | null; away_team: string | null } | undefined;
  if (!row?.value_bets_json) return empty;
  try {
    const bets = JSON.parse(row.value_bets_json) as Array<Record<string, any>>;
    const out = { ...empty };
    for (const b of bets) {
      const odds = typeof b.bookmaker_odds === "number" ? b.bookmaker_odds : null;
      if (!odds) continue;
      // Sumber tunggal konvensi market = deriveMarketKey (mirror yang sama dengan
      // VIEW & route). Komentar lama mengklaim ini tapi kodenya menyalin logika
      // sendiri — drift antar salinan = closing odds salah atribusi diam-diam.
      const key = deriveMarketKey(b.market_name, b.selection, row.home_team, row.away_team);
      if (key === "1X2_HOME") out.home = odds;
      else if (key === "1X2_DRAW") out.draw = odds;
      else if (key === "1X2_AWAY") out.away = odds;
      else if (key === "O25") out.over25 = odds;
      else if (key === "U25") out.under25 = odds;
    }
    return out;
  } catch {
    return empty;
  }
}

/** Statistik dari team_match_logs lokal untuk kedua tim. */
function localTeamLogs(matchId: string): { home: any; away: any } {
  const match = dataset.prepare("SELECT home_team_id, away_team_id FROM matches WHERE match_id = ?").get(matchId) as
    | { home_team_id: string; away_team_id: string }
    | undefined;
  if (!match) return { home: null, away: null };
  const home = dataset.prepare("SELECT * FROM team_match_logs WHERE match_id = ? AND team_id = ?").get(matchId, match.home_team_id);
  const away = dataset.prepare("SELECT * FROM team_match_logs WHERE match_id = ? AND team_id = ?").get(matchId, match.away_team_id);
  return { home: home ?? null, away: away ?? null };
}

async function main() {
  let written = 0;
  let skipped = 0;

  for (const matchId of candidates) {
    if (!forcedMatch) {
      const existing = snapshot.prepare("SELECT match_id FROM match_outcomes WHERE match_id = ?").get(matchId);
      if (existing) {
        skipped++;
        console.log(`[skip] ${matchId}: outcome sudah ada (idempoten).`);
        continue;
      }
    }

    // 1. LOKAL DULU
    let source: "local_sqlite" | "online_api" = "local_sqlite";
    let matchRow = dataset.prepare("SELECT * FROM matches WHERE match_id = ?").get(matchId) as any;
    let logs = matchRow ? localTeamLogs(matchId) : { home: null, away: null };
    let statsJson: string | null = null;
    let htHome: number | null = null;
    let htAway: number | null = null;

    if (!matchRow || (!logs.home && !logs.away)) {
      // 2. Online fallback — endpoint detail yang sama dengan fetcher agent.
      source = "online_api";
      try {
        const remote = await cachedStatsGet<any>(`/football/matches/${matchId}`, {}, 5 * 60 * 1000);
        const r = remote?.data ?? remote;
        if (r && typeof r === "object" && !Array.isArray(r) && (r.id || r.match_id)) {
          matchRow = {
            match_id: matchId,
            status: r.status ?? r.match_status ?? null,
            home_score: r.score?.home ?? r.home_score ?? null,
            away_score: r.score?.away ?? r.away_score ?? null,
            home_team_id: r.home_team?.id ?? null,
            away_team_id: r.away_team?.id ?? null,
            utc_date: r.utc_date ?? null,
          };
          htHome = r.score?.half_time_home ?? null;
          htAway = r.score?.half_time_away ?? null;
          statsJson = JSON.stringify(r); // payload mentah, untuk audit
        }
        // Respons tidak berbentuk match ATAU catch di bawah: matchRow lokal (bila ada)
        // tetap dipakai — skor lokal valid tidak boleh dibuang karena fallback online
        // gagal (audit 2026-10-18). Cukup stats online yang kosong.
      } catch (err) {
        console.warn(`[online] ${matchId} gagal diambil:`, err instanceof Error ? err.message : err);
      }
    }

    if (!matchRow) {
      skipped++;
      console.log(`[skip] ${matchId}: tidak ada di lokal DAN tidak ditemukan online.`);
      continue;
    }

    const status = String(matchRow.status ?? "").toLowerCase();
    if (status !== "finished") {
      skipped++;
      console.log(`[skip] ${matchId}: status "${status}", belum selesai — outcome belum ditarik.`);
      continue;
    }

    const homeGoals = typeof matchRow.home_score === "number" ? matchRow.home_score : null;
    const awayGoals = typeof matchRow.away_score === "number" ? matchRow.away_score : null;
    if (homeGoals === null || awayGoals === null) {
      skipped++;
      console.log(`[skip] ${matchId}: finished tapi skor NULL — jangan mengarang.`);
      continue;
    }

    if (logs.home || logs.away) {
      statsJson = JSON.stringify({ home: logs.home, away: logs.away });
    }

    const closing = closingOddsFromSnapshots(matchId);
    const ftr = homeGoals > awayGoals ? "H" : homeGoals === awayGoals ? "D" : "A";

    const outcome: MatchOutcomeInput = {
      match_id: matchId,
      status: "finished",
      home_goals: homeGoals,
      away_goals: awayGoals,
      ht_home_goals: htHome, // sumber online punya skor HT; dataset lokal tidak
      ht_away_goals: htAway,
      ftr,
      xg_home: logs.home?.xg_for ?? null,
      xg_away: logs.away?.xg_for ?? null,
      npxg_home: logs.home?.npxg_for ?? null,
      npxg_away: logs.away?.npxg_for ?? null,
      shots_home: logs.home?.shots_for ?? null,
      shots_away: logs.away?.shots_for ?? null,
      sot_home: logs.home?.shots_on_target_for ?? null,
      sot_away: logs.away?.shots_on_target_for ?? null,
      corners_home: logs.home?.corners_for ?? null,
      corners_away: logs.away?.corners_for ?? null,
      cards_home: logs.home?.yellow_cards ?? null,
      cards_away: logs.away?.yellow_cards ?? null,
      possession_home: logs.home?.possession_pct ?? null,
      closing_odds_home: closing.home,
      closing_odds_draw: closing.draw,
      closing_odds_away: closing.away,
      closing_over_2_5: closing.over25,
      closing_under_2_5: closing.under25,
      stats_json: statsJson,
      source,
      closing_source:
        closing.home ?? closing.draw ?? closing.away ?? closing.over25 ?? closing.under25 ? "snapshot" : null,
    };

    upsertOutcome(outcome);
    written++;
    console.log(`[tulis] ${matchId}: ${homeGoals}-${awayGoals} (${ftr}) source=${source}`);
  }

  console.log(`\n[sync-outcomes] selesai: ${written} ditulis, ${skipped} dilewati.`);
}

main().catch((err) => {
  console.error("[sync-outcomes] gagal:", err);
  process.exit(1);
});