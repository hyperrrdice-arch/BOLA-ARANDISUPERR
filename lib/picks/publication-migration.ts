import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import {
  canonicalLineFor,
  ensurePublicationSchema,
  packageKeyOf,
} from "./publication";
import { getUidForMatchId, identityTablesExist } from "../identity/fixture-resolver";

// ============================================================================
// MIGRASI BUKTI LAMA (PRD kartu K2 butir 6)
// ----------------------------------------------------------------------------
// Baris ledger historis tidak punya bukti peluang terbit yang immutable.
// Migrasi ini TIDAK mengarang angka: basis menjadi 'unknown_legacy',
// published_prob tetap NULL, dan baris keluar dari perbandingan
// probabilitas (tetap bisa dinilai hit/miss seperti biasa).
//
// SATU pengecualian yang jujur: baris yang terikat paket (package_id) dan
// payload paketnya masih memuat leg yang PERSIS cocok (market, selection)
// dengan effective_prob yang sama dengan baris — angka terbitnya bisa
// diselamatkan dari bukti primer itu (basis 'effective'; atau basis
// 'model' bila leg maupun baris sama-sama tanpa effective). "Sama" di
// sini berarti identik, atau identik pada presisi simpan historis ledger
// (4 desimal — satu generasi produser lama membulatkan effective_prob
// saat menulis baris, sementara payload paket menyimpan presisi penuh;
// pada salinan produksi 2026-11-20, 184/184 baris yang gagal uji identik
// cocok persis pada pembulatan 4-dp, 0 pengecualian). Angka yang disimpan
// sebagai published_prob adalah angka BARIS itu sendiri — bukan presisi
// paket yang tidak pernah diterbitkan. Selain itu: tidak ada tebakan,
// tidak ada waktu terbit karangan (published_at_utc hanya diisi dari
// created_utc baris untuk baris yang diselamatkan, karena created_utc
// memang momen baris itu ditulis oleh run penerbit).
//
// Idempoten: hanya baris dengan probability_basis IS NULL yang diproses;
// jalan kedua melaporkan semuanya sebagai already_migrated.
// Duplikat resmi: dalam grup (fixture_uid, market, line, selection,
// series) baris paling awal memegang pick_uid; sisanya ditandai
// duplicate_of agar tidak melanggar kunci resmi dan tidak terhitung dua.
// ============================================================================

export interface PublicationMigrationReport {
  total_rows: number;
  processed: number;
  already_migrated: number;
  salvaged_effective: number;
  salvaged_model: number;
  unknown_legacy: number;
  duplicates_marked: number;
  uid_resolved: number;
  uid_unresolved: number;
}

interface LegacyRow {
  id: number;
  match_id: string;
  market: string;
  selection: string;
  source: string;
  created_utc: string;
  kickoff_utc: string | null;
  model_prob: number;
  effective_prob: number | null;
  package_id: number | null;
}

interface PackageLeg {
  market?: unknown;
  selection?: unknown;
  model_prob?: unknown;
  effective_prob?: unknown;
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

/** Bukti angka yang sama: identik, atau identik pada presisi simpan 4-dp. */
function sameStoredNumber(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= 1e-9 || round4(a) === b || round4(b) === a;
}

export function migratePublishedProb(opts: {
  picksDb: DatabaseSync;
  packagesDb?: DatabaseSync | null;
  datasetDb?: DatabaseSync | null;
}): PublicationMigrationReport {
  const db = opts.picksDb;
  ensurePublicationSchema(db);
  const packagesDb = opts.packagesDb ?? null;
  const datasetDb = opts.datasetDb ?? null;
  const hasIdentity = datasetDb ? identityTablesExist(datasetDb) : false;

  const total = (
    db.prepare("SELECT COUNT(*) AS n FROM picks").get() as { n: number }
  ).n;
  const already = (
    db
      .prepare("SELECT COUNT(*) AS n FROM picks WHERE probability_basis IS NOT NULL")
      .get() as { n: number }
  ).n;

  const rows = db
    .prepare(
      `SELECT id, match_id, market, selection, source, created_utc, kickoff_utc,
              model_prob, effective_prob, package_id
       FROM picks WHERE probability_basis IS NULL
       ORDER BY created_utc ASC, id ASC`,
    )
    .all() as unknown as LegacyRow[];

  const pkgStmt = packagesDb
    ? packagesDb.prepare(
        "SELECT match_id, trigger, computed_utc, payload_json FROM packages WHERE id = ?",
      )
    : null;
  const pkgCache = new Map<
    number,
    | { key: string; hash: string; legs: PackageLeg[] }
    | null
  >();
  const loadPackage = (packageId: number) => {
    if (pkgCache.has(packageId)) return pkgCache.get(packageId) ?? null;
    let out: { key: string; hash: string; legs: PackageLeg[] } | null = null;
    const row = pkgStmt?.get(packageId) as
      | {
          match_id: string;
          trigger: string;
          computed_utc: string;
          payload_json: string;
        }
      | undefined;
    if (row) {
      try {
        const payload = JSON.parse(row.payload_json) as { legs?: unknown };
        out = {
          key: packageKeyOf(row.match_id, row.trigger, row.computed_utc),
          hash: createHash("sha256").update(row.payload_json).digest("hex"),
          legs: Array.isArray(payload.legs)
            ? (payload.legs as PackageLeg[])
            : [],
        };
      } catch {
        out = null;
      }
    }
    pkgCache.set(packageId, out);
    return out;
  };

  const update = db.prepare(
    `UPDATE picks SET
       fixture_uid = ?, line = ?, series = ?, pick_uid = ?, duplicate_of = ?,
       decision_at_utc = ?, published_at_utc = ?, kickoff_at_issue_utc = ?,
       package_key = ?, package_hash = ?,
       published_prob = ?, probability_basis = ?
     WHERE id = ?`,
  );

  const report: PublicationMigrationReport = {
    total_rows: total,
    processed: 0,
    already_migrated: already,
    salvaged_effective: 0,
    salvaged_model: 0,
    unknown_legacy: 0,
    duplicates_marked: 0,
    uid_resolved: 0,
    uid_unresolved: 0,
  };
  const officialSeen = new Map<string, number>();

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const r of rows) {
      report.processed++;
      const line = canonicalLineFor(r.market);
      const uid =
        hasIdentity && datasetDb ? getUidForMatchId(datasetDb, r.match_id) : null;
      if (uid) report.uid_resolved++;
      else report.uid_unresolved++;

      // --- Coba selamatkan angka terbit dari bukti paket primer.
      let basis: "effective" | "model" | "unknown_legacy" = "unknown_legacy";
      let publishedProb: number | null = null;
      let packageKey: string | null = null;
      let packageHash: string | null = null;
      if (r.package_id !== null && pkgStmt) {
        const pkg = loadPackage(r.package_id);
        const leg = pkg?.legs.find(
          (l) => l.market === r.market && l.selection === r.selection,
        );
        if (pkg && leg) {
          const legEff =
            typeof leg.effective_prob === "number" ? leg.effective_prob : null;
          const legModel =
            typeof leg.model_prob === "number" ? leg.model_prob : null;
          if (legEff !== null && sameStoredNumber(legEff, r.effective_prob)) {
            basis = "effective";
            // Angka baris itu sendiri yang terbit — leg hanya bukti penguat.
            publishedProb = r.effective_prob;
            packageKey = pkg.key;
            packageHash = pkg.hash;
          } else if (
            legEff === null &&
            r.effective_prob === null &&
            legModel !== null &&
            sameStoredNumber(legModel, r.model_prob)
          ) {
            basis = "model";
            publishedProb = r.model_prob;
            packageKey = pkg.key;
            packageHash = pkg.hash;
          }
        }
      }
      if (basis === "effective") report.salvaged_effective++;
      else if (basis === "model") report.salvaged_model++;
      else report.unknown_legacy++;

      // --- Kunci resmi: duplikat dalam grup UID ditandai, bukan dihapus.
      let pickUid: string | null = null;
      let duplicateOf: number | null = null;
      if (uid) {
        const groupKey = `${uid}|${r.market}|${line}|${r.selection}|${r.source}`;
        const first = officialSeen.get(groupKey);
        if (first !== undefined) {
          duplicateOf = first;
          report.duplicates_marked++;
        } else {
          officialSeen.set(groupKey, r.id);
          pickUid = `pk_${createHash("sha256")
            .update(`k2-legacy|${r.id}|${r.created_utc}|${r.match_id}|${r.market}|${r.selection}|${r.source}`)
            .digest("hex")
            .slice(0, 32)}`;
        }
      } else {
        pickUid = `pk_${createHash("sha256")
          .update(`k2-legacy|${r.id}|${r.created_utc}|${r.match_id}|${r.market}|${r.selection}|${r.source}`)
          .digest("hex")
          .slice(0, 32)}`;
      }

      update.run(
        uid,
        line,
        r.source,
        pickUid,
        duplicateOf,
        r.created_utc, // decision_at = momen baris ditulis run penerbit
        basis === "unknown_legacy" ? null : r.created_utc,
        r.kickoff_utc,
        packageKey,
        packageHash,
        publishedProb,
        basis,
        r.id,
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return report;
}
