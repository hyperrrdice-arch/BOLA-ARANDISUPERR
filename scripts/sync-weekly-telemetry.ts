import {
  getTheStatsDb,
  upsertTeam,
  upsertSquadPlayer,
  upsertMatch,
  upsertTeamMatchLog,
  type TeamRecord,
  type SquadPlayerRecord,
} from "../lib/db/thestats-dataset";
// Mapping stats → baris DB dipakai modul shared (sama dengan skrip promosi
// upcoming), supaya 60+ kolom tidak diduplikasi di dua tempat.
import { mapStatsToTelemetry } from "../lib/stats-log-mapper";
import {
  saveRawPayload,
  getRawPayload,
  hasRawPayload,
} from "../lib/db/thestats-vault";
import { TARGET_COMPETITIONS, TheStatsCompetitionConfig } from "../lib/thestats-competitions";

// Auto-load .env.local jika tersedia di Node.js runtime
try {
  if (typeof (process as any).loadEnvFile === "function") {
    (process as any).loadEnvFile(".env.local");
  }
} catch {}

const API_BASE = "https://api.thestatsapi.com/api";

const apiKey = process.env.STATS_API_KEY;
if (!apiKey) {
  console.error("[CRITICAL ERROR] STATS_API_KEY tidak ditemukan di environment!");
  process.exit(1);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let apiCallsCount = 0;
let retryAttemptsCount = 0;

async function fetchWithStrictRetry(path: string, params: Record<string, any> = {}): Promise<any> {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const MAX_RETRIES = 6;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    attempt++;
    apiCallsCount++;
    await sleep(850); // Politeness delay: ~70 req/menit

    try {
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (res.status === 429) {
        retryAttemptsCount++;
        const waitMs = Math.min(30000, attempt * 7000);
        console.warn(`⚠️ [HTTP 429 Rate Limit] Menunggu ${waitMs / 1000}s sebelum retry (${attempt}/${MAX_RETRIES})...`);
        await sleep(waitMs);
        continue;
      }

      if (res.status === 404) return null;

      if (!res.ok) {
        retryAttemptsCount++;
        const backoffMs = Math.min(24000, 1500 * Math.pow(2, attempt - 1));
        console.warn(`⚠️ [HTTP ${res.status}] ${path}. Backoff ${backoffMs}ms...`);
        await sleep(backoffMs);
        continue;
      }

      return await res.json();
    } catch (e: any) {
      retryAttemptsCount++;
      const backoffMs = Math.min(24000, 1500 * Math.pow(2, attempt - 1));
      console.warn(`⚠️ [Network Error] ${path}: ${e.message}. Retry dalam ${backoffMs}ms...`);
      await sleep(backoffMs);
    }
  }

  console.error(`❌ [FAILED] Gagal fetch ${path} setelah ${MAX_RETRIES} percobaan.`);
  return null;
}

export async function syncWeeklyDelta(daysLookback: number = 8) {
  console.log("================================================================================");
  console.log(`🔄 [WEEKLY TELEMETRY BATCH SYNC] Memeriksa Delta Laga Selesai (${daysLookback} Hari Terakhir)`);
  console.log("================================================================================");

  const db = getTheStatsDb();
  const cutoffDate = new Date(Date.now() - daysLookback * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  let newMatchesSynced = 0;
  let newLogsSynced = 0;
  let injuriesRefreshed = 0;

  const affectedTeamIds = new Set<string>();

  for (const comp of Object.values(TARGET_COMPETITIONS)) {
    console.log(`\n🔍 Memeriksa jadwal selesai baru: ${comp.name} (Cutoff: >= ${cutoffDate})...`);

    // Selalu refresh endpoint daftar matches terbaru
    const matchesRes = await fetchWithStrictRetry("/football/matches", {
      competition_id: comp.id,
      status: "finished",
      per_page: 50,
      page: 1,
    });

    const pageMatches: any[] = matchesRes?.data || [];
    const recentMatches = pageMatches.filter((m: any) => {
      const matchDate = m.utc_date ? m.utc_date.slice(0, 10) : "";
      return matchDate >= cutoffDate;
    });

    console.log(`-> Ditemukan ${recentMatches.length} laga dalam ${daysLookback} hari terakhir.`);

    for (const m of recentMatches) {
      const matchId = m.id;
      const homeId = m.home_team?.id;
      const awayId = m.away_team?.id;
      if (homeId) affectedTeamIds.add(homeId);
      if (awayId) affectedTeamIds.add(awayId);

      // Cek apakah sudah ada log-nya di database
      const existing = db.prepare("SELECT log_id FROM team_match_logs WHERE match_id = ? LIMIT 1").get(matchId);
      if (existing) {
        // Sudah ada di DB, lewati fetch stats untuk hemat kuota!
        continue;
      }

      console.log(`  📥 Mengambil data telemetry laga baru: ${m.home_team?.name} vs ${m.away_team?.name} (${m.utc_date?.slice(0, 10)})`);

      const statsRes = await fetchWithStrictRetry(`/football/matches/${matchId}/stats`);
      const lineupsRes = await fetchWithStrictRetry(`/football/matches/${matchId}/lineups`);

      if (statsRes) saveRawPayload("stats", `stats_${matchId}`, statsRes);
      if (lineupsRes) saveRawPayload("lineups", `lineups_${matchId}`, lineupsRes);

      const statsData = statsRes?.data || null;
      const lineupsData = lineupsRes?.data || null;

      const mapped = mapStatsToTelemetry({ m, stats: statsData, competitionId: comp.id, seasonName: comp.seasonName });
      if (!mapped) {
        console.warn(`  ⚠️ Mapping telemetry gagal untuk ${matchId} — dilewati.`);
        continue;
      }

      upsertMatch(mapped.match);
      upsertTeamMatchLog(mapped.homeLog);
      upsertTeamMatchLog(mapped.awayLog);
      newMatchesSynced++;
      newLogsSynced += 2;
    }
  }

  // Refresh Cedera Pemain untuk Tim yang Bertanding
  console.log(`\n🏥 Memperbarui Status Cedera & Kebugaran Skuad (${affectedTeamIds.size} Tim Terkait)...`);
  for (const teamId of affectedTeamIds) {
    const injuriesRes = await fetchWithStrictRetry(`/football/teams/${teamId}/injuries-suspensions`);
    if (injuriesRes) {
      saveRawPayload("injuries", `injuries_${teamId}`, injuriesRes);
      injuriesRefreshed++;

      // Update status cedera di tabel team_squads
      if (injuriesRes.data?.injuries) {
        for (const inj of injuriesRes.data.injuries) {
          const pId = inj.player_id || inj.player?.id;
          if (pId) {
            const reason = (inj.reason || inj.type || "injury").replace(/_/g, " ").toUpperCase();
            const statusStr = `INJURED: ${reason} (${inj.status || "out"})`;
            db.prepare("UPDATE team_squads SET injury_status = ?, updated_at = CURRENT_TIMESTAMP WHERE player_id = ?").run(statusStr, pId);
          }
        }
      }
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("🎉 [SYNC MINGGUAN SELESAI]");
  console.log(`- Laga Baru Ditambahkan   : ${newMatchesSynced}`);
  console.log(`- Log Baru Tersimpan      : ${newLogsSynced}`);
  console.log(`- Skuad Cedera Di-refresh : ${injuriesRefreshed} tim`);
  console.log(`- Total Request API       : ${apiCallsCount}`);
  console.log(`- Total Retry Berhasil    : ${retryAttemptsCount}`);
  console.log("================================================================================");
}

if (require.main === module) {
  const days = process.argv[2] ? parseInt(process.argv[2], 10) : 8;
  syncWeeklyDelta(days).catch((err) => {
    console.error("[Fatal Error]", err);
    process.exit(1);
  });
}
