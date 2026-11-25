/**
 * IMPORT FIXTURE football-data.org v4 → upcoming_fixtures (SUPLEMEN DORMAN).
 *
 * Desain: tasks/free-feed-research.md (§B). Sumber fixture pelengkap SAJA
 * (tanpa odds, skor free tier tertunda — tidak dipakai untuk hasil).
 *
 * Dormansi by design: tanpa env FOOTBALL_DATA_ORG_TOKEN skrip ini mencetak
 * satu baris pesan skip yang jelas dan exit 0 — mode bebas TIDAK bergantung
 * padanya (fixtures.csv football-data.co.uk menutup kebutuhan yang sama).
 * Token dibaca dari env SAJA dan tidak pernah dicetak/log.
 *
 * Kompetisi free yang memetakan ke divisi proyek:
 *   PL→E0, ELC→E1, PD→SP1, BL1→D1, SA→I1, FL1→F1, DED→N1, PPL→P1.
 * Batas free tier 10 req/menit → jeda ≥6,5 detik antar-request.
 * Id fixture: fo_<DIV>_<yyyymmdd>_<homeNorm>_<awayNorm>; laga yang sudah
 * ada di katalog (sm_/mt_/fd_) dijembatani via tanggal + nama ternormalisasi
 * dan tidak diduplikasi.
 *
 * Pakai: FOOTBALL_DATA_ORG_TOKEN=... npx tsx scripts/import-fdorg-fixtures.ts
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { normalizeTeamName } from "../lib/quant/team-normalizer";
import { getCanonicalBySourceId } from "../lib/quant/league-identity";
import { teamSlug, yyyymmdd } from "../lib/feeds/football-data";
import { dbPath } from "../lib/db/paths";

const CODE_TO_DIV: Record<string, string> = {
  PL: "E0",
  ELC: "E1",
  PD: "SP1",
  BL1: "D1",
  SA: "I1",
  FL1: "F1",
  DED: "N1",
  PPL: "P1",
};
const SPACING_MS = 6500;

interface FdOrgMatch {
  utcDate: string;
  status: string;
  homeTeam?: { name?: string };
  awayTeam?: { name?: string };
}

async function main() {
  const token = process.env.FOOTBALL_DATA_ORG_TOKEN;
  if (!token) {
    console.log(
      "SKIP import-fdorg: FOOTBALL_DATA_ORG_TOKEN belum di-set. Set env itu dengan token gratis dari https://football-data.org/client/register untuk mengaktifkan suplemen fixture ini; tanpa token, mode bebas tetap jalan via football-data.co.uk.",
    );
    return;
  }

  const up = new DatabaseSync(dbPath("upcoming_fixtures.db"));
  up.exec("PRAGMA journal_mode = WAL;");
  up.exec("PRAGMA busy_timeout = 60000;");

  const bridgeKey = (date10: string, homeNorm: string, awayNorm: string) =>
    `${date10}|${homeNorm}|${awayNorm}`;
  const existingByKey = new Map<string, string>();
  const existingIds = new Set<string>();
  for (const r of up
    .prepare("SELECT match_id, utc_date, home_team_name, away_team_name FROM upcoming_fixtures")
    .all() as unknown as {
    match_id: string;
    utc_date: string;
    home_team_name: string | null;
    away_team_name: string | null;
  }[]) {
    existingIds.add(r.match_id);
    if (r.home_team_name && r.away_team_name) {
      const key = bridgeKey(r.utc_date.slice(0, 10), normalizeTeamName(r.home_team_name), normalizeTeamName(r.away_team_name));
      if (!existingByKey.has(key)) existingByKey.set(key, r.match_id);
    }
  }

  const insFixture = up.prepare(
    `INSERT OR IGNORE INTO upcoming_fixtures (
       match_id, competition_id, competition_name, competition_country, utc_date, status,
       home_team_id, home_team_name, away_team_id, away_team_name, fetched_utc
     ) VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?)`,
  );

  const nowIso = new Date().toISOString();
  let totalInserted = 0;
  let totalBridged = 0;
  let totalAlready = 0;
  let first = true;
  for (const [code, div] of Object.entries(CODE_TO_DIV)) {
    if (!first) await new Promise((r) => setTimeout(r, SPACING_MS));
    first = false;
    const res = await fetch(
      `https://api.football-data.org/v4/competitions/${code}/matches?status=SCHEDULED`,
      { headers: { "X-Auth-Token": token } },
    );
    if (!res.ok) {
      console.warn(`[${code}→${div}] HTTP ${res.status} — dilewati.`);
      continue;
    }
    const body = (await res.json()) as { matches?: FdOrgMatch[] };
    const canonical = getCanonicalBySourceId(div);
    let inserted = 0;
    let bridged = 0;
    let already = 0;
    up.prepare("BEGIN").run();
    try {
      for (const m of body.matches ?? []) {
        const homeName = m.homeTeam?.name;
        const awayName = m.awayTeam?.name;
        if (!homeName || !awayName || !m.utcDate) continue;
        const kickoffUtc = new Date(m.utcDate).toISOString();
        const homeNorm = normalizeTeamName(homeName);
        const awayNorm = normalizeTeamName(awayName);
        const foId = `fo_${div}_${yyyymmdd(kickoffUtc)}_${teamSlug(homeNorm)}_${teamSlug(awayNorm)}`;
        if (existingIds.has(foId)) {
          already++;
          continue;
        }
        const bKey = bridgeKey(kickoffUtc.slice(0, 10), homeNorm, awayNorm);
        if (existingByKey.has(bKey)) {
          bridged++;
          continue;
        }
        insFixture.run(
          foId, div, canonical?.name ?? div, canonical?.country ?? null,
          kickoffUtc, `fo_${teamSlug(homeNorm)}`, homeName, `fo_${teamSlug(awayNorm)}`, awayName, nowIso,
        );
        existingIds.add(foId);
        existingByKey.set(bKey, foId);
        inserted++;
      }
      up.prepare("COMMIT").run();
    } catch (e) {
      up.prepare("ROLLBACK").run();
      throw e;
    }
    totalInserted += inserted;
    totalBridged += bridged;
    totalAlready += already;
    console.log(`[${code}→${div}] inserted=${inserted} bridged=${bridged} already=${already}`);
  }
  console.log(`SELESAI fdorg: inserted=${totalInserted} bridged=${totalBridged} already=${totalAlready}`);
  up.close();
}

main().catch((e) => {
  console.error("GAGAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
