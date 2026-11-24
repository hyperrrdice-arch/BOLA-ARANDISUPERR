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
 * Pakai:
 *   APIFOOTBALL_API_KEY=... npx tsx scripts/capture-odds-apifootball.ts [--date=YYYY-MM-DD] [--window=09:00|18:00]
 *   (--date = tanggal API dalam UTC; default hari ini UTC)
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import {
  ApiFootballRateLimiter,
  APIFOOTBALL_MAX_REQ_PER_DAY,
  APIFOOTBALL_MAX_REQ_PER_MINUTE,
  captureWindowForInstant,
  fetchApiFootballOddsPage,
  parseApiFootballOdds,
  type FetchLike,
} from "../lib/feeds/api-football";
import {
  appendMarketSnapshot,
  openMarketSnapshotDb,
} from "../lib/market/market-snapshot";
import { normalizeTeamName } from "../lib/quant/team-normalizer";

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
  const up = new DatabaseSync(path.join(process.cwd(), "data", "upcoming_fixtures.db"), {
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

  let page = 1;
  let totalPages = 1;
  let stored = 0;
  let unmapped = 0;
  let quotes = 0;
  do {
    const res = await fetchApiFootballOddsPage(fetchFn, apiKey, date, page, limiter);
    totalPages = res.totalPages;
    const parsed = parseApiFootballOdds(res.payload);
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
    page++;
  } while (page <= totalPages);

  console.log(
    `SELESAI capture API-Football: tanggal ${date}, jendela ${windowLabel}, ` +
      `${quotes} quote terbaca, ${stored} snapshot tersimpan, ${unmapped} quote tak terjembatani dilewati, ` +
      `${limiter.usedToday} request terpakai (sisa kuota header: ${limiter.lastRemaining ?? "tidak diketahui"}).`,
  );
  db.close();
}

main().catch((e) => {
  console.error("GAGAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
