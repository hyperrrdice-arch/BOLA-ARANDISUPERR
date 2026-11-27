/**
 * GENERATOR TIKET RESMI HARIAN FIX-4 (Item 23) — entry point manual.
 *
 * Membekukan keputusan tiket resmi satu tanggal WIB sesuai kebijakan beku
 * lib/picks/fix4-policy.ts: tepat 4 pilihan published_prob >= 0,72 dari
 * kompetisi berfeed, maks 1 per laga, ranking deterministik — atau ABSTAIN
 * tercatat bila kandidat layak < 4.
 *
 * STATUS AKTIVASI: skrip ini SENGAJA tidak dirangkai ke rantai
 * free-refresh produksi. Aktivasi (penjadwalan harian sesudah cutoff
 * 14:00 WIB) adalah langkah pasca-merge atas keputusan pemilik — lihat
 * checklist aktivasi di laporan Sprint C. Menjalankannya menulis snapshot
 * append-only ke picks.db pada cwd aktif; keputusan per tanggal tidak
 * pernah ditimpa.
 *
 * Pakai:
 *   npx tsx scripts/generate-fix4-ticket.ts [--date=YYYY-MM-DD]
 *   (tanggal dalam WIB; default = tanggal WIB hari ini)
 */
import { getPicksDb } from "../lib/picks/ledger";
import { fix4WaitingIfBeforeCutoff, generateFix4Ticket } from "../lib/picks/fix4-tickets";
import { fix4DateWibOf } from "../lib/picks/fix4-policy";

const args = process.argv.slice(2);
const dateArg = args.find((a) => a.startsWith("--date="))?.split("=")[1];
const dateWib = dateArg ?? fix4DateWibOf(new Date());
const nowUtc = new Date().toISOString();

// Penjaga cutoff di boundary CLI: sebelum cutoff 14:00 WIB berhenti di
// sini — TANPA membuka DB writable sama sekali (keputusan resmi adalah
// himpunan AS-OF cutoff; calon yang terbit sampai cutoff harus terhitung).
// Jam masuk ini HANYA untuk penjaga cutoff: jam penerbitan dibaca ulang
// oleh generateFix4Ticket sesudah lock tulisnya diperoleh (revisi
// PR #12, R1) lewat clock hidup yang diteruskan di bawah.
const waiting = fix4WaitingIfBeforeCutoff(dateWib, nowUtc);
if (waiting) {
  console.log(`FIX-4 ${dateWib}: ${waiting.reason}`);
  process.exit(0);
}

const db = getPicksDb();
const decision = generateFix4Ticket(db, dateWib, nowUtc, {
  now: () => new Date().toISOString(),
});

if (decision.status === "WAITING_CUTOFF") {
  console.log(`FIX-4 ${dateWib}: ${decision.reason}`);
} else if (decision.status === "ABSTAIN") {
  console.log(
    `FIX-4 ${dateWib}: ABSTAIN — ${decision.reason ?? "kandidat layak kurang"} ` +
      `(keputusan ${decision.already_existed ? "sudah tercatat sebelumnya" : "baru dibekukan"}, cutoff ${decision.decision_ts}).`,
  );
} else {
  console.log(
    `FIX-4 ${dateWib}: TIKET RESMI ${decision.ticket_uid} ` +
      `(expected ${(decision.expected_hit_prob ?? 0).toFixed(4)}, kandidat layak ${decision.eligible_count}, ` +
      `${decision.already_existed ? "sudah tercatat sebelumnya" : "baru dibekukan"}, cutoff ${decision.decision_ts}):`,
  );
  for (const [i, l] of decision.legs.entries()) {
    console.log(
      `  ${i + 1}. ${l.match_id} ${l.market}/${l.selection} published_prob=${l.published_prob.toFixed(4)} kickoff=${l.kickoff_utc}`,
    );
  }
}
