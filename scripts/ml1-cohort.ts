/**
 * ML1 KOHOR PROSPEKTIF — CLI eksplisit untuk protokol, verifikasi bukti,
 * grading shadow, dan evaluasi kohor (Brief ML1 Kohor Prospektif).
 *
 *   npx tsx scripts/ml1-cohort.ts manifest [--write=<file.json>]
 *     Cetak manifest protokol usulan + protocol_sha256 + cohort_id.
 *
 *   npx tsx scripts/ml1-cohort.ts verify
 *     Verifikasi arsip proyeksi terhadap manifest tercatat di DB shadow
 *     (DB_DIR aktif) — per proyeksi unik (§2C).
 *
 *   npx tsx scripts/ml1-cohort.ts grade --cutoff=<ISO> [--manifest=<file.json>]
 *     Grading append-only berbasis UID ke cohort_gradings di DB shadow.
 *     Input resmi dibuka read-only; satu-satunya tulisan adalah tabel
 *     cohort_* di ml1_prospective_pit_b.db.
 *
 *   npx tsx scripts/ml1-cohort.ts evaluate [--manifest=<file.json>] [--persist]
 *     Laporan operasi + evaluasi berpasangan dari grading yang tersedia.
 *
 *   npx tsx scripts/ml1-cohort.ts preflight [--manifest=<file.json>]
 *     Preflight atas DB_DIR yang sedang aktif (HARUS salinan/staging
 *     terisolasi, bukan produksi): verifikasi marker champion aktual dari
 *     paket slate terbaru, hitungan skor anomali, hitungan arsip yatim,
 *     verifikasi artefak. Tidak menjalankan koleksi.
 *
 * TIDAK ada subcommand yang menjadwalkan cron atau mengaktifkan koleksi.
 * Aktivasi mengikuti persetujuan pemilik atas manifest + preflight.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { dataDir, dbDir, dbPath } from "../lib/db/paths";
import { verifyPitBArtifacts } from "../lib/eval/ml1-pit-b";
import {
  buildProposedProtocol,
  canonicalJson,
  cohortIdFor,
  computeCohortFunnel,
  computeMarkerFunnel,
  countAnomalousScores,
  countOrphanProjections,
  evaluateCohortFromDb,
  finalizeProtocol,
  gradeCohort,
  protocolHash,
  validateProtocolManifest,
  type CohortProtocol,
} from "../lib/eval/ml1-cohort";

const args = process.argv.slice(2);
const cmd = args[0] ?? "";
const flag = (name: string): string | null =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;

function loadProtocol(): { protocol: CohortProtocol; cohortId: string } {
  const file = flag("manifest");
  if (file) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { protocol?: CohortProtocol } | CohortProtocol;
    const protocol = (parsed as { protocol?: CohortProtocol }).protocol ?? (parsed as CohortProtocol);
    return { protocol, cohortId: cohortIdFor(protocol) };
  }
  const protocol = buildProposedProtocol();
  return { protocol, cohortId: cohortIdFor(protocol) };
}

function openShadow(): DatabaseSync {
  return new DatabaseSync(dbPath("ml1_prospective_pit_b.db"));
}

function cmdManifest(): void {
  const fin = finalizeProtocol(buildProposedProtocol());
  const writeTo = flag("write");
  if (writeTo) {
    fs.writeFileSync(writeTo, `${JSON.stringify(fin, null, 2)}\n`);
  }
  console.log(JSON.stringify({ tool: "ml1-cohort-manifest", ...fin }, null, 2));
}

function cmdVerify(): void {
  const shadow = openShadow();
  try {
    const res = verifyPitBArtifacts(shadow, path.join(dbDir(), "pitb-projections"));
    console.log(JSON.stringify({ tool: "ml1-cohort-verify", ...res }, null, 2));
    if (res.snapshot_errors.length > 0) process.exitCode = 1;
  } finally {
    shadow.close();
  }
}

function cmdGrade(): void {
  const cutoff = flag("cutoff");
  if (!cutoff) {
    console.error("ML1-KOHOR: grade memerlukan --cutoff=<ISO instant>.");
    process.exit(2);
  }
  const { protocol, cohortId } = loadProtocol();
  const shadow = openShadow();
  const dataset = new DatabaseSync(dbPath("thestats_dataset.db"), { readOnly: true });
  try {
    const modeFlag = flag("mode");
    const summary = gradeCohort({
      shadowDb: shadow,
      dataset,
      projectionDir: path.join(dbDir(), "pitb-projections"),
      protocol,
      cohortId,
      gradingCutoffUtc: cutoff,
      clock: () => new Date(),
      mode: modeFlag === "official" ? "official" : modeFlag === "staging" ? "staging" : undefined,
    });
    console.log(JSON.stringify({ tool: "ml1-cohort-grade", ...summary }, null, 2));
  } finally {
    dataset.close();
    shadow.close();
  }
}

function cmdEvaluate(): void {
  const { protocol, cohortId } = loadProtocol();
  const shadow = openShadow();
  const dataset = new DatabaseSync(dbPath("thestats_dataset.db"), { readOnly: true });
  try {
    const now = new Date().toISOString();
    const { evaluation, operations } = evaluateCohortFromDb(shadow, protocol, {
      cohortId,
      reportCutoffUtc: now,
      asOfUtc: now,
      persist: args.includes("--persist"),
    });
    const funnel = computeCohortFunnel(shadow, dataset, protocol, now, cohortId);
    console.log(JSON.stringify({ tool: "ml1-cohort-evaluate", evaluation, operations, funnel }, null, 2));
  } finally {
    dataset.close();
    shadow.close();
  }
}

function cmdPreflight(): void {
  const { protocol, cohortId } = loadProtocol();
  const shadowPath = dbPath("ml1_prospective_pit_b.db");
  const dataset = new DatabaseSync(dbPath("thestats_dataset.db"), { readOnly: true });
  const snapshots = new DatabaseSync(dbPath("analysis_snapshots.db"), { readOnly: true });
  try {
    // INVENTARIS paket slate (semua edisi, tanpa jendela/selector) —
    // angka lama 558/9.876 + 41 marker berasal dari sini dan BUKAN
    // penyebut kohor. Funnel resmi ada di marker_funnel_asof di bawah.
    const markerRows = snapshots
      .prepare(
        `SELECT ratings_marker, COUNT(*) AS n FROM packages
         WHERE trigger = 'slate' GROUP BY ratings_marker ORDER BY MAX(computed_utc) DESC`,
      )
      .all() as unknown as { ratings_marker: string | null; n: number }[];
    // Funnel marker dengan penyebut LAGA FISIK (Validasi Rilis §4.4):
    // komponen alias + status kanonik + selector as-of kolektor yang
    // sama, penyebut = laga fisik terjadwal dalam allowlist manifest.
    // As-of default = computed paket terbaru pada snapshot (titik
    // segar snapshot sesudah refresh).
    let markerFunnel: ReturnType<typeof computeMarkerFunnel> | null = null;
    const upcomingPath = dbPath("upcoming_fixtures.db");
    if (fs.existsSync(upcomingPath)) {
      const latestComputed = snapshots
        .prepare("SELECT MAX(computed_utc) AS m FROM packages WHERE trigger = 'slate'")
        .get() as unknown as { m: string | null };
      if (latestComputed.m) {
        const upcoming = new DatabaseSync(upcomingPath, { readOnly: true });
        try {
          markerFunnel = computeMarkerFunnel(snapshots, upcoming, dataset, {
            asOfUtc: flag("asof") ?? latestComputed.m,
            horizonSeconds: protocol.horizon.max_lead_seconds,
            primaryMarker: protocol.champion.primary_marker ?? protocol.champion.primary_marker_repo_baseline,
            allowlist: protocol.competitive_primary.list.map((e) => e.competition_id),
            dataDirPath: dataDir(),
          });
        } finally {
          upcoming.close();
        }
      }
    }
    let modelManifestHash: string | null = null;
    try {
      const mm = JSON.parse(fs.readFileSync(path.join(dataDir(), "model-manifest.json"), "utf8")) as { ratingsHash?: string };
      modelManifestHash = mm.ratingsHash ?? null;
    } catch {
      modelManifestHash = null;
    }
    const anomalies = countAnomalousScores(dataset);
    let verification: ReturnType<typeof verifyPitBArtifacts> | null = null;
    let orphans: ReturnType<typeof countOrphanProjections> | null = null;
    if (fs.existsSync(shadowPath)) {
      const shadow = new DatabaseSync(shadowPath, { readOnly: true });
      try {
        verification = verifyPitBArtifacts(shadow, path.join(dbDir(), "pitb-projections"));
        orphans = countOrphanProjections(shadow, path.join(dbDir(), "pitb-projections"), fs, path.join);
      } finally {
        shadow.close();
      }
    }
    console.log(
      JSON.stringify(
        {
          tool: "ml1-cohort-preflight",
          db_dir: dbDir(),
          cohort_id: cohortId,
          protocol_sha256: protocolHash(protocol),
          champion_marker_repo_baseline: protocol.champion.primary_marker_repo_baseline,
          champion_marker_model_manifest_ratings_hash: modelManifestHash,
          slate_package_inventory_all_editions: markerRows,
          marker_funnel_asof: markerFunnel,
          manifest_validation: validateProtocolManifest(protocol),
          anomalous_scores: anomalies,
          artifact_verification: verification,
          orphan_projections: orphans,
          notes: [
            "Preflight hanya membaca; koleksi tidak dijalankan.",
            "Marker primer protokol diisi dari marker aktual terverifikasi di sini, lalu manifest dibekukan atas persetujuan pemilik.",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    dataset.close();
    snapshots.close();
  }
}

switch (cmd) {
  case "manifest":
    cmdManifest();
    break;
  case "verify":
    cmdVerify();
    break;
  case "grade":
    cmdGrade();
    break;
  case "evaluate":
    cmdEvaluate();
    break;
  case "preflight":
    cmdPreflight();
    break;
  default:
    console.error(`ML1-KOHOR: subcommand tidak dikenal: "${cmd}". Pilihan: manifest | verify | grade | evaluate | preflight.`);
    process.exit(2);
}
