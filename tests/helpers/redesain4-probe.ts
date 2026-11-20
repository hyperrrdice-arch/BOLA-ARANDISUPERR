/**
 * Probe adapter LANGKAH 4 redesain (jadwal + detail) — dijalankan
 * sebagai SUBPROSES dari tests/test-redesain-jadwal.ts dengan
 * cwd = sandbox. Mengimpor modul repo persis seperti server produksi
 * dan mencetak `PROBE_JSON`.
 *
 * Aksi: jadwal | detail <matchId> | keadaan <matchId> <nowMs>
 */
import { getMatchDetail, getMatchState, listSchedule } from "../../lib/web/data";

const aksi = process.argv[2];

function cetak(obj: unknown): void {
  console.log(`PROBE_JSON ${JSON.stringify(obj)}`);
}

if (aksi === "jadwal") {
  const items = listSchedule("2020-01-01T00:00:00.000Z", "2030-01-01T00:00:00.000Z");
  cetak(
    items.map((i) => ({
      match_id: i.match_id,
      home: i.home,
      away: i.away,
      competition_name: i.competition_name,
      competition_country: i.competition_country,
      kickoff_utc: i.kickoff_utc,
      status: i.status,
      home_goals: i.home_goals,
      away_goals: i.away_goals,
    })),
  );
} else if (aksi === "detail") {
  const d = getMatchDetail(process.argv[3]);
  cetak(
    d === null
      ? null
      : {
          pkgId: d.pkg.id,
          paketTerbitId: d.paketTerbit?.id ?? null,
          trioTerbit: d.paketTerbit
            ? {
                a: d.paketTerbit.payload.probabilities["1x2:1"] ?? null,
                x: d.paketTerbit.payload.probabilities["1x2:x"] ?? null,
                b: d.paketTerbit.payload.probabilities["1x2:2"] ?? null,
              }
            : null,
          keadaan: d.keadaan,
          picks: d.officialPicks.map((p) => ({
            market: p.market,
            selection: p.selection,
            published_prob: p.published_prob,
            probability_basis: p.probability_basis,
            published_at_utc: p.published_at_utc,
            package_id: p.package_id,
            hit: p.hit,
            home_goals: p.home_goals,
            away_goals: p.away_goals,
          })),
        },
  );
} else if (aksi === "keadaan") {
  cetak(getMatchState(process.argv[3], Number(process.argv[4])));
} else {
  console.error(`aksi tak dikenal: ${aksi}`);
  process.exit(2);
}
