/**
 * WEB PROBE — dijalankan sebagai subprocess dengan cwd = sandbox fixture.
 *
 * Memanggil adapter halaman sebenarnya (lib/web/data.ts) terhadap DB
 * fixture dan mencetak satu baris JSON prefixed "PROBE_JSON " berisi hasil
 * getMatchDetail / getResult per id + ringkasan ledgerStats. Suite pemanggil
 * yang menilai assertion-nya; probe ini tidak menilai apa pun.
 *
 * Pakai: tsx tests/helpers/web-probe.ts <match_id> [match_id...]
 */
import { getMatchDetail, getResult, ledgerStats } from "../../lib/web/data";

interface IdProbe {
  detail: unknown;
  detailError: string | null;
  result: unknown;
  resultError: string | null;
}

function main(): void {
  const ids = process.argv.slice(2);
  const perId: Record<string, IdProbe> = {};
  for (const id of ids) {
    const entry: IdProbe = {
      detail: null,
      detailError: null,
      result: null,
      resultError: null,
    };
    try {
      const d = getMatchDetail(id);
      entry.detail = d
        ? {
            home: d.pkg.payload.fixture.home,
            away: d.pkg.payload.fixture.away,
            picks: d.picks.map((p) => ({
              market: p.market,
              selection: p.selection,
              hit: p.hit,
            })),
            result: d.result,
          }
        : null;
    } catch (e) {
      entry.detailError = e instanceof Error ? e.message : String(e);
    }
    try {
      entry.result = getResult(id);
    } catch (e) {
      entry.resultError = e instanceof Error ? e.message : String(e);
    }
    perId[id] = entry;
  }
  let stats: unknown = null;
  try {
    const s = ledgerStats();
    stats = {
      lab_total: s.lab_total,
      live_total: s.live_total,
      live_resolved: s.live_resolved,
    };
  } catch (e) {
    stats = { error: e instanceof Error ? e.message : String(e) };
  }
  console.log(`PROBE_JSON ${JSON.stringify({ perId, stats })}`);
}

main();
