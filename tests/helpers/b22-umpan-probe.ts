/**
 * UMPAN SUMBER PROBE (B2.2b) — dijalankan sebagai subprocess dengan
 * cwd = sandbox fixture.
 *
 * Menjalankan tiga jalur konsumen umpan yang sebenarnya atas fixture
 * yang sama — `daftarPilihanPraLaga` (umpan), `halamanUmpan` (SSR +
 * /api/pilihan), dan `pulihkanDariUmpan` (/api/pilihan/pulih) — plus,
 * bila argumen kedua diberikan, `getMatchDetail` untuk memeriksa bukti
 * beku yang terbaca jalur Detail. Mencetak satu baris "PROBE_JSON ".
 * Probe tidak menilai apa pun; suite yang menilai.
 */
import { daftarPilihanPraLaga } from "../../lib/web/rekam";
import {
  FILTER_UMPAN_BAWAAN,
  halamanUmpan,
  pulihkanDariUmpan,
} from "../../lib/web/pilihan-umpan";
import { kunciSemantikPilihan } from "../../lib/web/draf";
import { getMatchDetail } from "../../lib/web/data";

const nowUtc = process.argv[2];
const detailId = process.argv[3];
if (!nowUtc) {
  console.error("argumen nowUtc wajib");
  process.exit(2);
}
const umpan = daftarPilihanPraLaga(nowUtc);
const halaman = halamanUmpan(umpan, FILTER_UMPAN_BAWAAN, 0, 100);
const entri = umpan.map((p) => ({
  pickUid: p.pick_uid,
  kunciSemantik: kunciSemantikPilihan(p.fixture_uid, p.market, p.line, p.selection),
}));
const pulih = pulihkanDariUmpan(entri, umpan);
const detail = detailId ? getMatchDetail(detailId) : null;
console.log(
  `PROBE_JSON ${JSON.stringify({
    umpan: umpan.map((p) => ({
      pick_uid: p.pick_uid,
      match_id: p.match_id,
      published_prob: p.published_prob,
      konflik: p.konflik !== null,
      sumber: p.sumber ?? null,
    })),
    halaman,
    pulih,
    detail: detail
      ? {
          officialPicks: detail.officialPicks.map((o) => ({
            pick_uid: o.pick_uid,
            published_prob: o.published_prob,
            probability_basis: o.probability_basis,
            effective_source: o.effective_source,
            evidence_source: o.evidence_source ?? null,
            market_prob: o.market_prob,
            line: o.line,
            odds_bookmaker: o.odds_bookmaker ?? null,
            odds_period: o.odds_period ?? null,
            odds_line: o.odds_line ?? null,
            odds_decimal: o.odds_decimal ?? null,
            odds_captured_utc: o.odds_captured_utc ?? null,
            decision_at_utc: o.decision_at_utc ?? null,
            kickoff_at_issue_utc: o.kickoff_at_issue_utc ?? null,
          })),
        }
      : null,
  })}`,
);
