/**
 * DETAIL PROBE (fix review 1) — dijalankan sebagai subprocess dengan
 * cwd = sandbox.
 *
 * Memanggil getMatchDetail sebenarnya (lib/web/data.ts) untuk enam
 * bentuk field market historis dan mencetak satu baris "PROBE_JSON "
 * berisi payload ternormalisasi per kasus (fixture, market, peluang
 * model) — termasuk error per kasus bila adapter melempar. Probe tidak
 * menilai apa pun; suite yang menilai.
 */
import { getMatchDetail } from "../../lib/web/data";

const IDS = [
  "sm_fx_valid",
  "sm_fx_bmnull",
  "sm_fx_legacy",
  "sm_fx_marketnull",
  "sm_fx_bmempty",
  "sm_fx_nomarket",
];

function main(): void {
  const out: Record<string, unknown> = {};
  for (const id of IDS) {
    try {
      const d = getMatchDetail(id);
      out[id] = d
        ? {
            home: d.pkg.payload.fixture.home,
            away: d.pkg.payload.fixture.away,
            market: d.pkg.payload.market ?? null,
            model121: d.pkg.payload.probabilities["1x2:1"] ?? null,
          }
        : null;
    } catch (e) {
      out[id] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  console.log(`PROBE_JSON ${JSON.stringify(out)}`);
}

main();
