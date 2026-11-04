/**
 * scripts/backfill-packages.ts — Impor artefak paket kuant yang sudah ada
 * ke store paket (lib/picks/packages.ts) + tautkan kaki ledger live-run ke
 * paket asalnya.
 *
 * Sumber impor (artefak di tasks/, tidak diubah):
 *   - e2e-run-1-package.json / .pre-canonical.json / .canonical.json
 *     (Everton vs Coventry, run driver manual Spark) → trigger 'manual',
 *     computed_utc = meta.generated_at artefak (timestamp ASLI run-nya).
 *   - e2e-cup-package-live.json (Fenerbahçe vs Liverpool, live cup)
 *     → trigger 'manual', computed_utc asli artefak.
 *   - pick-slate-latest.json (slate Fase B, 70 fixture ter-rate)
 *     → trigger 'legacy-import', computed_utc = generated_at slate.
 *
 * Kejujuran provenance: field yang TIDAK dibawa artefak dibiarkan NULL dan
 * dicatat di provenance_json — tidak ada timestamp/hash yang dikarang.
 * Payload disimpan verbatim (seluruh artefak / entri slate apa adanya).
 *
 * Penautan ledger: pick live-run dari run slate Fase B (notes 'pick-slate…')
 * yang match_id-nya punya paket legacy-import ditautkan via package_id.
 * Sisanya tetap NULL.
 *
 * Idempoten: writePackage dedupe pada (match_id, trigger, computed_utc);
 * penautan hanya menyentuh baris package_id IS NULL. Aman dijalankan ulang.
 *
 * Pakai: npx tsx scripts/backfill-packages.ts
 */

import fs from "node:fs";
import path from "node:path";
import { writePackage, listPackages, type PackageInput } from "../lib/picks/packages";
import { getPicksDb } from "../lib/picks/ledger";

type Json = Record<string, unknown>;

function obj(x: unknown): Json {
  return x !== null && typeof x === "object" && !Array.isArray(x)
    ? (x as Json)
    : {};
}
function str(x: unknown): string | null {
  return typeof x === "string" && x.length > 0 ? x : null;
}
function num(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}
function readJson(rel: string): Json {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), rel), "utf8")) as Json;
}

// ---------------------------------------------------------------------------
// Ekstraktor artefak driver E2E (Everton domestik + Fenerbahçe piala).
// Dua bentuk quant_pure: domestik menaruh dixon_coles di dalam
// quant_package; piala live menaruhnya sejajar. Keduanya dicoba.
// ---------------------------------------------------------------------------
function e2ePackage(rel: string): PackageInput {
  const art = readJson(rel);
  const meta = obj(art.meta);
  const selection = obj(art.selection);
  const fixture = obj(selection.fixture);
  const quantPure = obj(art.quant_pure);
  const nestedDc = obj(obj(quantPure.quant_package).dixon_coles);
  const dcResolved =
    Object.keys(nestedDc).length > 0 ? nestedDc : obj(quantPure.dixon_coles);
  const shrunk = obj(quantPure.shrunk_params);
  const md = obj(shrunk.metadata);
  const cupOffset = obj(quantPure.cup_offset_metadata);
  const anchor = obj(art.market_anchor_sm);
  const usedCapture = obj(anchor.used_capture);
  const quotes = obj(anchor.quotes_primary_and_compare);

  const isCup = Object.keys(cupOffset).length > 0;
  const homeSource = str(md.homeSource);
  const awaySource = str(md.awaySource);
  const notes: string[] = [
    "predictions_batch_utc absen di artefak (konteks predictions tanpa cap batch) → null",
    "ratings_marker absen (artefak mendahului skema penanda ratings) → null",
  ];
  if (isCup) {
    notes.push("cup_delta = δ tim kandang (homeDelta); δ tandang di provenance.away_delta");
  }

  return {
    match_id: str(meta.match_id) ?? str(fixture.match_id) ?? "",
    competition_canonical_id:
      str(obj(selection.registry_row).canonical_id) ??
      str(cupOffset.competitionCanonicalId) ??
      str(meta.competition_id),
    kickoff_utc: str(meta.kickoff_utc) ?? str(fixture.utc_date),
    computed_utc: str(meta.generated_at) ?? "",
    trigger: "manual",
    fit_source: isCup
      ? "cup-offset"
      : homeSource && homeSource === awaySource
        ? homeSource
        : homeSource || awaySource,
    gate_status: str(obj(selection.gate).status) ?? str(md.calibrationStatus),
    cup_delta: isCup ? num(cupOffset.homeDelta) : null,
    ratings_marker: null,
    odds_captured_utc: str(anchor.captured_utc) ?? str(usedCapture.captured_utc),
    bookmakers: str(quotes.bookmaker) ? [str(quotes.bookmaker) as string] : null,
    predictions_batch_utc: null,
    lambda: num(dcResolved.lambda_home_xg),
    mu: num(dcResolved.mu_away_xg),
    rho: num(shrunk.rho),
    payload: art,
    provenance: {
      source_file: rel,
      kind: "e2e-driver-artifact",
      run: str(meta.run),
      away_delta: isCup ? num(cupOffset.awayDelta) : undefined,
      cup_offset_metadata: isCup ? cupOffset : undefined,
      notes,
    },
  };
}

function main() {
  let inserted = 0;
  let existing = 0;
  const track = (r: { inserted: boolean }) => {
    if (r.inserted) inserted++;
    else existing++;
  };

  // --- Artefak E2E manual.
  const e2eFiles = [
    "tasks/e2e-run-1-package.json",
    "tasks/e2e-run-1-package.pre-canonical.json",
    "tasks/e2e-run-1-package.canonical.json",
    "tasks/e2e-cup-package-live.json",
  ];
  for (const rel of e2eFiles) {
    const pkg = e2ePackage(rel);
    if (!pkg.match_id || !pkg.computed_utc) {
      throw new Error(`backfill: artefak ${rel} tanpa match_id/computed_utc — abort`);
    }
    track(writePackage(pkg));
    console.log(`  ${rel} → ${pkg.match_id} [${pkg.trigger}] @ ${pkg.computed_utc}`);
  }

  // --- Slate Fase B (legacy-import): payload = entri rated verbatim.
  const slateRel = "tasks/pick-slate-latest.json";
  const slate = readJson(slateRel);
  const generatedAt = str(slate.generated_at) ?? "";
  const rated = Array.isArray(slate.rated) ? (slate.rated as Json[]) : [];
  for (const entry of rated) {
    const population = str(entry.population);
    track(
      writePackage({
        match_id: str(entry.match_id) ?? "",
        competition_canonical_id: str(entry.canonical_id),
        kickoff_utc: str(entry.utc_date),
        computed_utc: generatedAt,
        trigger: "legacy-import",
        fit_source: population === "cup" ? "cup-offset" : "league-fit",
        gate_status: str(entry.gate_status),
        cup_delta: null,
        ratings_marker: null,
        odds_captured_utc: null,
        bookmakers: null,
        predictions_batch_utc: null,
        lambda: num(entry.lambda),
        mu: num(entry.mu),
        rho: null,
        payload: entry,
        provenance: {
          source_file: slateRel,
          kind: "slate-summary-entry",
          notes: [
            "payload = entri ringkasan slate Fase B (kaki + λ/μ), bukan paket pipeline penuh",
            "rho/cap waktu tangkapan/batch predictions tidak dibawa artefak slate → null",
            "cup_delta tidak dibawa artefak slate → null (δ ada di metadata paket pipeline aslinya)",
          ],
        },
      }),
    );
  }
  console.log(
    `  ${slateRel} → ${rated.length} fixture [legacy-import] @ ${generatedAt}`,
  );

  // --- Tautkan kaki live-run ke paket slate asalnya.
  // Subquery lintas-DB tidak tersedia (picks.db ≠ store paket) → ambil peta
  // match_id → package_id dari store paket lebih dulu, lalu UPDATE per match.
  const db = getPicksDb();
  const before = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM picks WHERE source = 'live-run' AND package_id IS NOT NULL",
      )
      .get() as { n: number }
  ).n;
  const slatePkgs = listPackages({ trigger: "legacy-import" });
  const byMatch = new Map<string, number>();
  for (const p of slatePkgs) {
    const prev = byMatch.get(p.match_id);
    if (prev === undefined) byMatch.set(p.match_id, p.id);
  }
  const upd = db.prepare(
    "UPDATE picks SET package_id = ? WHERE source = 'live-run' AND package_id IS NULL AND notes LIKE 'pick-slate%' AND match_id = ?",
  );
  let linked = 0;
  db.exec("BEGIN");
  try {
    for (const [matchId, pkgId] of byMatch) {
      const res = upd.run(pkgId, matchId);
      linked += Number(res.changes);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  const liveTotal = (
    db
      .prepare("SELECT COUNT(*) AS n FROM picks WHERE source = 'live-run'")
      .get() as { n: number }
  ).n;
  const after = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM picks WHERE source = 'live-run' AND package_id IS NOT NULL",
      )
      .get() as { n: number }
  ).n;

  console.log(
    `\nPaket: +${inserted} baru, ${existing} sudah ada (dedupe). ` +
      `Ledger live-run tertaut: ${before} → ${after} dari ${liveTotal} baris ` +
      `(run ini menautkan ${linked}).`,
  );
}

main();
