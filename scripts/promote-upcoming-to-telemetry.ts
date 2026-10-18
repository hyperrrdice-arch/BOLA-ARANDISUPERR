/**
 * PROMOSI UPCOMING → TELEMETRY (lifecycle store upcoming).
 *
 * Untuk setiap fixture di `upcoming_fixtures.db` yang kickoff-nya sudah lewat:
 *   1. kalau telemetry-nya SUDAH ada di `thestats_dataset.db` → cukup hapus baris upcoming
 *   2. kalau belum → ambil `/football/matches/{id}` + `/stats` + `/lineups`,
 *      tulis `matches` + 2× `team_match_logs` (mapper shared yang sama dengan sync:weekly)
 *   3. setelah aman → HAPUS barisnya dari store upcoming (satu-satunya tempat
 *      fixture berumur pendek; dataset utama tak pernah dihapus)
 *
 * Kalau(match belum selesai / fetch gagal) → baris upcoming DISIMPAN untuk dicoba lagi.
 * Idempotent: menjalankan dua kali tidak menggandakan log.
 *
 * Jalankan: npx tsx scripts/promote-upcoming-to-telemetry.ts [--dry-run]
 */
try {
  if (typeof (process as any).loadEnvFile === "function") {
    (process as any).loadEnvFile(".env.local");
  }
} catch {}

import { TARGET_COMPETITIONS } from "../lib/thestats-competitions";
import { getTheStatsDb, upsertMatch, upsertTeamMatchLog, upsertTeam } from "../lib/db/thestats-dataset";
import { getDueFixtures, deleteUpcoming, countUpcoming } from "../lib/db/upcoming-fixtures";
import { mapStatsToTelemetry } from "../lib/stats-log-mapper";
import { saveRawPayload, getRawPayload } from "../lib/db/thestats-vault";

const DRY_RUN = process.argv.includes("--dry-run");
const API_BASE = "https://api.thestatsapi.com/api";
const apiKey = process.env.STATS_API_KEY;
const dataset = getTheStatsDb();

if (!apiKey) {
  console.error("[CRITICAL] STATS_API_KEY tidak ada — promosi dibatalkan.");
  process.exit(1);
}

const seasonOf = (competitionId: string | null) =>
  TARGET_COMPETITIONS[competitionId ?? ""]?.seasonName ?? "2026/2027";
const compIdOf = (competitionId: string | null) => competitionId ?? "comp_unknown";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let requests = 0;

async function get(path: string): Promise<any> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    requests++;
    const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (res.status === 429) {
      const waitMs = 2000 * attempt;
      console.warn(`⚠️ 429 — tunggu ${waitMs / 1000}s (${attempt}/4)`);
      await sleep(waitMs);
      continue;
    }
    if (!res.ok) return null;
    const json: any = await res.json();
    return json?.data ?? json;
  }
  return null;
}

async function main() {
  const due = getDueFixtures();
  if (due.length === 0) {
    console.log("[promote] Tidak ada fixture yang lewat jadwalnya. Store upcoming: " + countUpcoming() + " baris.");
    return;
  }
  console.log(`📦 [PROMOSI] ${due.length} fixture lewat jadwal, dicek satu per satu…`);

  const promoted: string[] = [];
  const deleted: string[] = [];

  for (const row of due) {
    // Kelengkapan = 2 log (home + away). Cek `LIMIT 1` lama menganggap crash
    // di tengah promosi sebagai "sudah ada" sehingga awayLog hilang permanen.
    const logCount = (
      dataset.prepare("SELECT count(*) AS c FROM team_match_logs WHERE match_id = ?").get(row.match_id) as { c: number }
    ).c;

    if (logCount >= 2) {
      deleted.push(row.match_id);
      console.log(`  ♻️ ${row.home_team_name} vs ${row.away_team_name}: telemetry sudah ada → hapus dari upcoming.`);
      continue;
    }
    if (logCount === 1) {
      console.warn(`  ⚠️ ${row.match_id}: telemetry setengah jadi (1 log) → bersihkan dan promosikan ulang.`);
      if (!DRY_RUN) {
        dataset.prepare("DELETE FROM team_match_logs WHERE match_id = ?").run(row.match_id);
      }
    }

    const remote = await get(`/football/matches/${row.match_id}`);
    if (!remote || String(remote.status ?? "").toLowerCase() !== "finished") {
      console.log(`  ⏳ ${row.home_team_name} vs ${row.away_team_name}: belum finished (${remote?.status ?? "tidak ditemukan"}) → ditunda.`);
      continue;
    }

    const stats = await get(`/football/matches/${row.match_id}/stats`);
    const lineups = await get(`/football/matches/${row.match_id}/lineups`);
    if (!stats) {
      console.warn(`  ⚠️ ${row.match_id}: stats belum tersedia → ditunda (fixture tetap disimpan).`);
      continue;
    }
    if (!DRY_RUN) {
      saveRawPayload("stats", `stats_${row.match_id}`, { data: stats });
      if (lineups) saveRawPayload("lineups", `lineups_${row.match_id}`, { data: lineups });
    }

    const mapped = mapStatsToTelemetry({
      m: remote,
      stats,
      competitionId: compIdOf(row.competition_id ?? remote.competition_id),
      seasonName: seasonOf(row.competition_id ?? remote.competition_id),
    });
    if (!mapped) {
      console.warn(`  ⚠️ ${row.match_id}: mapping gagal → ditunda.`);
      continue;
    }
    if (!DRY_RUN) {
      // Referee dari vault (ditarik Task 7 enrichment) — apa adanya, boleh null.
      const refPayload: any = getRawPayload(`referee_${row.match_id}`);
      const refName = refPayload?.data?.name ?? refPayload?.data?.referee?.name ?? null;
      // Transaksi tunggal per match: crash di tengah tidak boleh meninggalkan
      // log setengah jadi (audit 2026-10-18). Vault terpisah, di luar transaksi ini.
      dataset.exec("BEGIN IMMEDIATE");
      try {
        upsertMatch({ ...mapped.match, referee_name: typeof refName === "string" ? refName : null });
        upsertTeamMatchLog(mapped.homeLog);
        upsertTeamMatchLog(mapped.awayLog);
        // Guardrail 7: nama kosong jangan menimpa nama yang sudah ada.
        if (row.home_team_name) upsertTeam({ team_id: mapped.match.home_team_id, name: row.home_team_name });
        if (row.away_team_name) upsertTeam({ team_id: mapped.match.away_team_id, name: row.away_team_name });
        dataset.exec("COMMIT");
      } catch (err) {
        dataset.exec("ROLLBACK");
        throw err;
      }
    }
    promoted.push(row.match_id);
    deleted.push(row.match_id);
    console.log(
      `  ✅ ${row.home_team_name} vs ${row.away_team_name}: ${mapped.match.home_score}-${mapped.match.away_score} → telemetry masuk dataset utama${DRY_RUN ? " (dry-run)" : ""}`
    );
    await sleep(600);
  }

  const n = DRY_RUN ? 0 : deleteUpcoming(deleted);
  console.log(`\n🎉 [PROMOSI SELESAI]`);
  console.log(`- Dipromosikan (telemetry baru): ${promoted.length}`);
  console.log(`- Dihapus dari upcoming       : ${DRY_RUN ? 0 : n} (${deleted.length} kandidat${DRY_RUN ? ", dry-run" : ""})`);
  console.log(`- Request API                : ${requests}`);
  console.log(`- Sisa upcoming              : ${countUpcoming()} baris`);
}

main().catch((err) => {
  console.error("[promote] gagal:", err);
  process.exit(1);
});