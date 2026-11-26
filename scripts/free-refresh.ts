/**
 * FREE REFRESH — ritme mode bebas (pengganti jalur Sportmonks setelah
 * langganan dibatalkan 9 Nov 2026). Tanpa token apa pun:
 *   1. import-free-feed.ts  — hasil + odds closing + telemetri fd +
 *      fixture + odds pra-laga dari football-data.co.uk
 *   2. build-team-canonical.ts — registry tim acuan pakem dibangun ulang
 *      (tim fd_ baru dari langkah 1 langsung terdaftar resmi)
 *   3. build-fixture-links.ts — tautan fixture kembar katalog diperbarui
 *   4. calibrate-ratings.ts — refit rating dari store lokal (offline)
 *   5. fit-global-offsets.ts — offset piala ditanam SETELAH calibrate
 *      (calibrate menulis ulang file rating tanpa blok cupOffsets)
 *   6. build-canonical-telemetry.ts — tabel form kanonik dibangun ulang
 *      supaya saji membaca data resmi terbaru
 *   7. pick-slate.ts --hours=72 — slate pick dari store lokal (offline)
 *   8. resolve-pick-outcomes.ts — skor final lokal (hasil fd yang baru
 *      diimpor di langkah 1 termasuk) ditulis ke ledger pick; tanpa langkah
 *      ini pick menumpuk tak pernah dinilai (regresi 7–16 Nov 2026: rantai
 *      lama memanggilnya, rantai bebas awal tidak).
 *   9. MARKER refresh sukses (B2.2a) — sesudah langkah 8 sukses, cap
 *      ISO UTC ditulis ke `analysis_snapshots.db.meta` key
 *      `free_refresh_last_success_utc` lewat `catatRefreshSukses`
 *      (upsert atomik + monoton). Kegagalan langkah data mana pun →
 *      marker lama utuh; kegagalan MENULIS marker dicatat eksplisit
 *      sebagai kegagalan marker (bukan kegagalan impor/publikasi) dan
 *      tidak membatalkan keberhasilan langkah data.
 *  10. wal-checkpoint.ts — PRAGMA wal_checkpoint(PASSIVE) atas
 *      thestats_dataset.db (evaluasi WAL A4): triplet dicatat ke log;
 *      langkah ini TIDAK PERNAH menggagalkan rantai (selalu exit 0).
 *
 * Setiap langkah spawnSync npx tsx dengan stdio inherit; ringkasan satu
 * baris per langkah (nama + exit code + durasi); exit non-nol bila ada
 * langkah yang gagal (rantai berhenti di langkah itu).
 *
 * Pakai: npx tsx scripts/free-refresh.ts
 */
import { spawnSync } from "node:child_process";
import { catatRefreshSukses } from "../lib/picks/packages";

interface Step {
  name: string;
  script: string;
  scriptArgs: string[];
}

const STEPS: Step[] = [
  { name: "import-free-feed", script: "scripts/import-free-feed.ts", scriptArgs: [] },
  { name: "build-team-canonical", script: "scripts/build-team-canonical.ts", scriptArgs: [] },
  { name: "build-fixture-links", script: "scripts/build-fixture-links.ts", scriptArgs: [] },
  { name: "calibrate-ratings", script: "scripts/calibrate-ratings.ts", scriptArgs: [] },
  { name: "fit-global-offsets", script: "scripts/fit-global-offsets.ts", scriptArgs: [] },
  { name: "build-canonical-telemetry", script: "scripts/build-canonical-telemetry.ts", scriptArgs: [] },
  // pick-slate mem-parse "--hours <n>" (bentuk spasi), bukan "--hours=<n>".
  { name: "pick-slate", script: "scripts/pick-slate.ts", scriptArgs: ["--hours", "72"] },
  // Penilai ledger: jalan terakhir, sesudah impor hasil + slate, supaya
  // hasil yang baru tiba di langkah 1 langsung menilai pick yang menunggu.
  { name: "resolve-pick-outcomes", script: "scripts/resolve-pick-outcomes.ts", scriptArgs: [] },
  // Penutup: checkpoint WAL PASSIVE (langkah 9) — skripnya sendiri
  // menjamin exit 0, jadi rantai tidak pernah putus di sini.
  { name: "wal-checkpoint", script: "scripts/wal-checkpoint.ts", scriptArgs: [] },
];

/** Jalankan satu langkah; kembalikan true bila exit 0. */
function jalankanLangkah(step: Step): boolean {
  const t0 = Date.now();
  const res = spawnSync("npx", ["tsx", step.script, ...step.scriptArgs], {
    stdio: "inherit",
    env: process.env,
    cwd: process.cwd(),
  });
  const durS = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[free-refresh] ${step.name}: exit=${res.status ?? "null"} durasi=${durS}s`);
  return res.status === 0;
}

function main() {
  // Langkah data = semua kecuali penutup WAL; marker sukses hanya
  // boleh ditulis di antara langkah data terakhir dan penutup itu.
  const langkahData = STEPS.filter((s) => s.name !== "wal-checkpoint");
  const langkahWal = STEPS.find((s) => s.name === "wal-checkpoint");
  let failed: string | null = null;
  for (const step of langkahData) {
    if (!jalankanLangkah(step)) {
      failed = step.name;
      break;
    }
  }
  if (failed) {
    console.log(`[free-refresh] SELESAI DENGAN KEGAGALAN di langkah ${failed}.`);
    process.exit(1);
  }

  // Semua langkah data sukses (termasuk nol pick baru) → geser marker.
  // Kegagalan menulis marker dicatat eksplisit dan terpisah: langkah
  // data SUDAH berhasil, jadi rantai tetap ditutup dengan checkpoint.
  try {
    const cap = new Date().toISOString();
    const bergerak = catatRefreshSukses(cap);
    console.log(
      `[free-refresh] marker refresh sukses: ${cap}` +
        (bergerak ? "" : " (tidak digeser — cap tersimpan lebih baru)"),
    );
  } catch (err) {
    console.error(
      `[free-refresh] MARKER GAGAL DITULIS (langkah data sukses; ini kegagalan pencatatan marker, bukan impor/publikasi): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (langkahWal && !jalankanLangkah(langkahWal)) {
    console.log("[free-refresh] SELESAI DENGAN KEGAGALAN di langkah wal-checkpoint.");
    process.exit(1);
  }
  console.log("[free-refresh] SELESAI: semua langkah sukses (mode bebas, tanpa Sportmonks).");
}

main();
