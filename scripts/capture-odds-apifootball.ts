/**
 * CAPTURE ODDS PRA-LAGA API-FOOTBALL → MarketSnapshot (Item 20 + Item 3).
 *
 * Sumber odds pra-laga PRIMER (keputusan pemilik 25 Nov 2026): API-Football
 * v3, pasar 1X2 + Over/Under, diambil pada 2 jendela tetap harian
 * (09:00 & 18:00 WIB) agar usia snapshot selalu < 12 jam terhadap keputusan.
 * Hasil tangkapan masuk penyimpanan MarketSnapshot APPEND-ONLY
 * (lib/market/market-snapshot.ts) dengan source "api-football".
 * 1xbet tetap fallback sekunder berlabel "1xbet" — tidak pernah dicampur.
 *
 * DORMANSI: tanpa env APIFOOTBALL_API_KEY skrip mencetak status
 * WAITING_OWNER_TOKEN dan exit 0. Token dibaca dari env SAJA, tidak pernah
 * dicetak. Penjadwalan cron 09:00/18:00 WIB adalah langkah AKTIVASI
 * pasca-merge oleh pemilik (lihat checklist di laporan Sprint C) — skrip
 * ini sendiri tidak mendaftarkan cron apa pun.
 *
 * Penjembatanan fixture: quote API dijembatani ke match_id repo lewat
 * tanggal + nama tim ternormalisasi terhadap upcoming_fixtures (pola yang
 * sama dengan importer fdorg). Quote yang tidak terjembatani DIHITUNG dan
 * dilewati — tidak pernah disimpan dengan ID karangan.
 *
 * JEMBATAN /fixtures (blocker #3): entri /odds asli TIDAK membawa nama
 * tim — nama diambil dari GET /fixtures?date= pada tanggal yang sama
 * (peta fixture.id → nama tim) dan digabung ke entri odds sebelum
 * parser berjalan. Entri odds yang fixture.id-nya tidak ada di peta
 * /fixtures dihitung terpisah sebagai "entri odds tanpa pasangan
 * /fixtures" — tidak dibuang diam-diam.
 *
 * BATAS FREE PLAN: query /odds?date= mencakup semua fixture dunia pada
 * tanggal itu dan total halamannya jauh di atas 3, sedangkan free plan
 * menolak Page > 3 (terbukti live 25 Nov 2026). Pengambilan dibatasi
 * 3 halaman pertama dan sisanya dilaporkan sebagai
 * skipped-due-to-plan-cap — tangkapan bersifat parsial secara eksplisit.
 *
 * Pakai:
 *   APIFOOTBALL_API_KEY=... npx tsx scripts/capture-odds-apifootball.ts [--date=YYYY-MM-DD] [--window=09:00|18:00]
 *   (--date = tanggal API dalam UTC; default hari ini UTC)
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import {
  ApiFootballRateLimiter,
  APIFOOTBALL_FREE_PLAN_MAX_PAGE,
  APIFOOTBALL_MAX_REQ_PER_DAY,
  APIFOOTBALL_MAX_REQ_PER_MINUTE,
  captureWindowForInstant,
  fetchApiFootballFixturesForDate,
  fetchApiFootballOddsForDate,
  joinApiFootballOddsWithFixtures,
  parseApiFootballOdds,
  type FetchLike,
} from "../lib/feeds/api-football";
import {
  appendMarketSnapshot,
  openMarketSnapshotDb,
} from "../lib/market/market-snapshot";
import { normalizeTeamName } from "../lib/quant/team-normalizer";
import { dbPath } from "../lib/db/paths";

const args = process.argv.slice(2);
const argVal = (k: string): string | null => {
  const hit = args.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split("=")[1] : null;
};

async function main(): Promise<void> {
  const apiKey = process.env.APIFOOTBALL_API_KEY;
  if (!apiKey) {
    console.log(
      "WAITING_OWNER_TOKEN: APIFOOTBALL_API_KEY belum di-set — capture odds API-Football dilewati. " +
        "Set env itu (free plan API-Sports) untuk mengaktifkan sumber odds primer; MarketSnapshot tetap kosong dan selector pasar abstain secara jujur.",
    );
    return;
  }

  const nowIso = new Date().toISOString();
  const date = argVal("date") ?? nowIso.slice(0, 10);
  const win = captureWindowForInstant(nowIso);
  const windowLabel = argVal("window") ?? (win ? win.window : "manual");
  const capturedAt = nowIso;

  // Jembatan: (tanggal UTC | nama kandang ternormalisasi | nama tandang
  // ternormalisasi) → match_id katalog.
  const up = new DatabaseSync(dbPath("upcoming_fixtures.db"), {
    readOnly: true,
  });
  const bridge = new Map<string, string>();
  for (const r of up
    .prepare("SELECT match_id, utc_date, home_team_name, away_team_name FROM upcoming_fixtures")
    .all() as unknown as {
    match_id: string;
    utc_date: string;
    home_team_name: string | null;
    away_team_name: string | null;
  }[]) {
    if (!r.home_team_name || !r.away_team_name) continue;
    const key = `${r.utc_date.slice(0, 10)}|${normalizeTeamName(r.home_team_name)}|${normalizeTeamName(r.away_team_name)}`;
    if (!bridge.has(key)) bridge.set(key, r.match_id);
  }
  up.close();

  const limiter = new ApiFootballRateLimiter({
    maxPerMinute: APIFOOTBALL_MAX_REQ_PER_MINUTE,
    maxPerDay: APIFOOTBALL_MAX_REQ_PER_DAY,
  });
  const fetchFn = globalThis.fetch as unknown as FetchLike;
  const db = openMarketSnapshotDb();

  // Jembatan /fixtures dulu: peta fixture.id → nama tim untuk tanggal
  // yang sama. /fixtures diambil SATU request tanpa parameter page
  // (endpoint menolak field Page — bukti live 25 Nov 2026); klaim
  // halaman ekstra dari envelope dilaporkan eksplisit di bawah.
  const fixturesFetch = await fetchApiFootballFixturesForDate(fetchFn, apiKey, date, limiter);

  // Paginasi dibatasi batas free plan (Page <= 3) oleh
  // fetchApiFootballOddsForDate; halaman selebihnya TIDAK diambil dan
  // dilaporkan eksplisit di bawah sebagai skipped-due-to-plan-cap.
  const dateFetch = await fetchApiFootballOddsForDate(fetchFn, apiKey, date, limiter);
  let stored = 0;
  let unmapped = 0;
  let quotes = 0;
  let unbridged = 0;
  for (const res of dateFetch.pages) {
    const joined = joinApiFootballOddsWithFixtures(res.payload, fixturesFetch.teamsByFixtureId);
    unbridged += joined.unbridgedEntries;
    const parsed = parseApiFootballOdds(joined.payload);
    quotes += parsed.length;
    for (const q of parsed) {
      const key = `${q.kickoff_utc.slice(0, 10)}|${normalizeTeamName(q.home_name)}|${normalizeTeamName(q.away_name)}`;
      const matchId = bridge.get(key);
      if (!matchId) {
        unmapped++;
        continue;
      }
      appendMarketSnapshot(db, {
        fixture_id: matchId,
        source: "api-football",
        bookmaker: q.bookmaker,
        market: q.market,
        line: q.line,
        odds_raw: q.odds,
        captured_at: capturedAt,
      });
      stored++;
    }
  }

  console.log(
    `SELESAI capture API-Football: tanggal ${date}, jendela ${windowLabel}, ` +
      `peta /fixtures ${fixturesFetch.teamsByFixtureId.size} fixture (halaman ${fixturesFetch.fetchedPages}/${fixturesFetch.totalPages}), ` +
      `halaman odds ${dateFetch.fetchedPages}/${dateFetch.totalPages} terambil, ` +
      `${quotes} quote terbaca, ${stored} snapshot tersimpan, ` +
      `${unbridged} entri odds tanpa pasangan /fixtures dilewati, ${unmapped} quote tak terjembatani dilewati, ` +
      `${limiter.usedToday} request terpakai (sisa kuota header: ${limiter.lastRemaining ?? "tidak diketahui"}).`,
  );
  if (fixturesFetch.truncated) {
    console.log(
      `PERINGATAN fixtures-tidak-lengkap: envelope /fixtures?date=${date} mengklaim ${fixturesFetch.totalPages} halaman, ` +
        `tetapi endpoint menolak parameter Page sehingga hanya respons pertama yang terambil — ` +
        `peta fixture mungkin tidak lengkap; entri odds tanpa pasangan akan terhitung eksplisit di baris SELESAI.`,
    );
  }
  if (dateFetch.truncated) {
    console.log(
      `PERINGATAN skipped-due-to-plan-cap: ${dateFetch.skippedPages} dari ${dateFetch.totalPages} halaman ` +
        `query /odds?date=${date} TIDAK diambil karena batas free plan (Page maks ${APIFOOTBALL_FREE_PLAN_MAX_PAGE}) — ` +
        `cakupan tangkapan tanggal ini PARSIAL, bukan tangkapan penuh.`,
    );
  }
  db.close();
}

main().catch((e) => {
  console.error("GAGAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
