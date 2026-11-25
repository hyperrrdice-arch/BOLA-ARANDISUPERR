// ============================================================================
// IMPORT HASIL football-data.org v4 (Item 7, Sprint C Fase 3)
// ----------------------------------------------------------------------------
// Sumber hasil KEDUA untuk kompetisi terpetakan (12 kompetisi papan atas
// v4; 8 terpetakan ke divisi proyek di FDORG_CODE_TO_DIV). Menarik laga
// FINISHED per kompetisi dengan X-Auth-Token, guard <= 9 req/menit +
// hormati HTTP 429, lalu menerapkan precedence/revisi/available_at lewat
// lib/feeds/fdorg-results.ts (mesin identitas D2 repo).
//
// KETAHANAN LARIAN: kegagalan satu kompetisi (mis. jaringan putus) TIDAK
// lagi membunuh seluruh larian — kompetisi itu dicatat gagal, sisanya
// lanjut, dan larian berakhir sebagai SELESAI SEBAGIAN dengan exit 1
// (jujur terbedakan dari sukses penuh). Kegagalan jaringan sesaat di
// dalam satu kompetisi diulang terbatas oleh adapter (maks 2×, backoff).
//
// Env: FOOTBALL_DATA_API_TOKEN (nama yang dikunci brief Sprint C — beda
// dari FOOTBALL_DATA_ORG_TOKEN milik importer fixture fdorg lama, yang
// tidak diubah). Tanpa token: script berhenti dengan pesan jujur
// WAITING_OWNER_TOKEN dan exit 0 (tidak ada fetch yang direka).
// ============================================================================
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import {
  FDORG_CODE_TO_DIV,
  runFdorgCompetitions,
  type FdorgFetchLike,
} from "../lib/feeds/fdorg-results";
import { recordIngestAttempt } from "../lib/feeds/ingest-freshness";

async function main(): Promise<void> {
  const token = process.env.FOOTBALL_DATA_API_TOKEN;
  if (!token) {
    console.log(
      "[fdorg-results] FOOTBALL_DATA_API_TOKEN belum terpasang — WAITING_OWNER_TOKEN. " +
        "Tidak ada fetch yang dijalankan. (Importer fixture lama memakai FOOTBALL_DATA_ORG_TOKEN; tidak diubah.)",
    );
    return;
  }
  const nowUtc = new Date().toISOString();
  const ds = new DatabaseSync(path.join(process.cwd(), "data", "thestats_dataset.db"));
  try {
    recordIngestAttempt(ds, "football-data-org", nowUtc);
    const fetchFn = globalThis.fetch.bind(globalThis) as unknown as FdorgFetchLike;
    const result = await runFdorgCompetitions(
      ds,
      fetchFn,
      token,
      Object.keys(FDORG_CODE_TO_DIV),
      () => new Date().toISOString(),
      (line) => console.log(line),
    );
    const totals = result.totals;
    console.log(
      `[fdorg-results] SELESAI applied=${totals.applied} dup=${totals.duplicates} corrected=${totals.corrected} ` +
        `conflict_primary_kept=${totals.conflicts_primary_kept} unmapped_team=${totals.unmapped_team} ` +
        `unmapped_comp=${totals.unmapped_competition} ambiguous=${totals.identity_ambiguous} ` +
        `rows_written=${totals.rows_written} skipped_basis=${result.skipped_basis} skipped_status=${result.skipped_status}`,
    );
    if (result.failures.length > 0) {
      console.log(
        `[fdorg-results] SELESAI SEBAGIAN: ${result.failures.length} kompetisi gagal: ` +
          result.failures.map((f) => `${f.code} (${f.error})`).join("; "),
      );
      process.exitCode = 1;
    }
  } finally {
    ds.close();
  }
}

main().catch((e) => {
  console.error("[fdorg-results] GAGAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
