/**
 * BACKFILL KICKOFF (satu kali / berulang) — isi `kickoff_utc` untuk snapshot
 * yang menulainya NULL (baris migrasi lama), lalu hitung ulang
 * `lead_time_minutes` dari `captured_utc` yang sudah tersimpan.
 *
 * Sumber: tabel `matches` lokal (TheStatsAPI ingesti) — data nyata, bukan
 * tebakan. Match yang tidak ada di lokal → dibiarkan NULL (tidak diisi karangan).
 *
 * Konsekuensi yang diharapkan dan memang disengaja: analisis yang diambil
 * SETELAH kickoff akan terhitung lead negatif dan dikeluarkan dari VIEW
 * evaluasi (leakage guard), bukan dipaksa jadi "benar".
 *
 * Idempotent: hanya baris `kickoff_utc IS NULL` yang disentuh.
 * Jalankan: npx tsx scripts/backfill-snapshot-kickoff.ts [--dry-run]
 */
import { getTheStatsDb } from "../lib/db/thestats-dataset";
import { getSnapshotDb } from "../lib/db/analysis-snapshot";

const DRY_RUN = process.argv.includes("--dry-run");
const ds = getTheStatsDb();
const snap = getSnapshotDb();

const rows = snap
  .prepare(`
    SELECT snapshot_id, match_id, captured_utc, duration_ms
    FROM analysis_snapshots
    WHERE kickoff_utc IS NULL
    ORDER BY snapshot_id
  `)
  .all() as Array<{ snapshot_id: number; match_id: string; captured_utc: string; duration_ms: number | null }>;

let updated = 0;
let noSource = 0;

for (const row of rows) {
  const m = ds
    .prepare("SELECT utc_date FROM matches WHERE match_id = ?")
    .get(row.match_id) as { utc_date?: string } | undefined;
  if (!m?.utc_date) {
    noSource++;
    console.log(`[skip] snapshot ${row.snapshot_id} (${row.match_id}): tidak ada di matches lokal — tetap NULL.`);
    continue;
  }
  const kickoffMs = Date.parse(m.utc_date);
  const capturedMs = Date.parse(row.captured_utc);
  const lead = Math.round((kickoffMs - capturedMs) / 60000);
  const verdict = lead > 0 ? "pre-match (masuk evaluasi)" : "pasca-kickoff (DIKECUALIKAN dari evaluasi)";
  if (DRY_RUN) {
    console.log(`[dry-run] snapshot ${row.snapshot_id}: kickoff ${m.utc_date} → lead ${lead} mnt · ${verdict}`);
    updated++;
    continue;
  }
  snap
    .prepare("UPDATE analysis_snapshots SET kickoff_utc = ?, lead_time_minutes = ? WHERE snapshot_id = ?")
    .run(m.utc_date, lead, row.snapshot_id);
  updated++;
  console.log(`[backfill] snapshot ${row.snapshot_id}: kickoff ${m.utc_date} → lead ${lead} mnt · ${verdict}`);
}

console.log(`\n[backfill] ${updated} baris${DRY_RUN ? " (dry-run)" : " di-update"}, ${noSource} tanpa sumber.`);