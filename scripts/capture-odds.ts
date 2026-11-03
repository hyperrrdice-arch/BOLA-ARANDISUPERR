/**
 * CAPTURE ODDS PRE-MATCH SPORTMONKS → match_odds_history (thestats_dataset.db)
 *
 * Blok B PRD ekspansi DB. Pola yang sama dengan sync katalog:
 * - Token HANYA dari env SPORTMONKS_API_TOKEN (via scripts/sm-fetch.ts).
 * - Satu panggilan per fixture: GET /odds/pre-match/fixtures/{smId} (semua
 *   bookmaker), lalu disaring client-side ke market utama saja (payload mentah
 *   full bisa 2,3 MB/fixture di liga besar — yang disimpan versi saringannya,
 *   terstruktur, sesuai keputusan retensi PRD §10.5).
 * - capture_kind: 'baseline' (tangkapan pertama fixture), 'scheduled' (titik
 *   T-24j/T-6j/T-1j/T-15m), 'backfill' (premium history, mode terpisah).
 *   Titik jadwal yang terlewat karena fixture telat masuk katalog ditandai
 *   payload.late_entry = true.
 * - Idempoten: fixture yang sudah punya tangkapan untuk kind/titik yang sama
 *   tidak ditangkap ulang.
 * - Fixture tanpa odds tercatat has_odds = 0 (jujur kosong), bukan hilang.
 * - Predictions TIDAK PERNAH ditulis di sini (aturan keras PRD §5.5).
 *
 * Pakai:
 *   SPORTMONKS_API_TOKEN=... npx tsx scripts/capture-odds.ts [--window-hours=72] [--limit=50]
 *   SPORTMONKS_API_TOKEN=... npx tsx scripts/capture-odds.ts --backfill-premium
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { smGet } from "./sm-fetch";

const args = process.argv.slice(2);
const argVal = (k: string): string | null => {
  const hit = args.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split("=")[1] : null;
};
const WINDOW_HOURS = argVal("window-hours") ? Number(argVal("window-hours")) : null;
const LIMIT = argVal("limit") ? Number(argVal("limit")) : null;
const BACKFILL = args.includes("--backfill-premium");

// Market utama (berbasis bukti distribusi payload UCL 3 Nov 2026: market ramai
// seperti Correct Score/player props dibuang; yang disimpan market inti 1X2,
// O/U, AH, BTTS, DC, DNB, goal line).
const MAIN_MARKET_HINTS = [
  "match winner",
  "double chance",
  "draw no bet",
  "both teams to score",
  "goals over/under",
  "asian handicap",
  "goal line",
];
function isMainMarket(desc: string | undefined): boolean {
  if (!desc) return false;
  const d = desc.toLowerCase();
  return MAIN_MARKET_HINTS.some((h) => d.includes(h));
}

interface SmOdd {
  market_id?: number;
  market_description?: string;
  bookmaker_id?: number;
  label?: string;
  name?: string;
  value?: string;
  total?: string | null;
  handicap?: string | null;
  sort_order?: number | null;
}

const POINTS = [
  { h: 24, label: "T-24h" },
  { h: 6, label: "T-6h" },
  { h: 1, label: "T-1h" },
  { h: 0.25, label: "T-15m" },
] as const;

function dataPath(file: string): string {
  const dir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, file);
}

function openDataset(): DatabaseSync {
  const db = new DatabaseSync(dataPath("thestats_dataset.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 120000;");
  // Migrasi aditif (PRD §5.4): source + capture_kind + indeks.
  const cols = db.prepare("PRAGMA table_info(match_odds_history)").all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("source")) db.exec("ALTER TABLE match_odds_history ADD COLUMN source TEXT");
  if (!names.has("capture_kind"))
    db.exec("ALTER TABLE match_odds_history ADD COLUMN capture_kind TEXT");
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_moh_match_captured ON match_odds_history(match_id, captured_utc)",
  );
  return db;
}

interface Target {
  matchId: string; // id katalog (sm_* atau mt_* yang terpetakan)
  smFixtureId: number;
  kickoffUtc: string;
}

function loadTargets(): Target[] {
  const up = new DatabaseSync(dataPath("upcoming_fixtures.db"), { readOnly: true });
  const smRows = up
    .prepare(
      "SELECT match_id, utc_date FROM upcoming_fixtures WHERE match_id LIKE 'sm_%' ORDER BY utc_date ASC",
    )
    .all() as { match_id: string; utc_date: string }[];
  const smIdsInCatalog = new Set(smRows.map((r) => Number(r.match_id.slice(3))));
  const targets: Target[] = smRows.map((r) => ({
    matchId: r.match_id,
    smFixtureId: Number(r.match_id.slice(3)),
    kickoffUtc: r.utc_date,
  }));
  // mt_* yang terpetakan tapi kembaran sm_-nya tidak ada di katalog.
  const mtRows = up
    .prepare(
      `SELECT m.match_id AS match_id, m.sm_fixture_id AS sm_id, f.utc_date AS utc_date
       FROM sm_id_map m JOIN upcoming_fixtures f ON f.match_id = m.match_id
       WHERE m.match_id NOT LIKE 'sm_%' ORDER BY f.utc_date ASC`,
    )
    .all() as { match_id: string; sm_id: number; utc_date: string }[];
  for (const r of mtRows) {
    if (!smIdsInCatalog.has(r.sm_id)) {
      targets.push({ matchId: r.match_id, smFixtureId: r.sm_id, kickoffUtc: r.utc_date });
    }
  }
  targets.sort((a, b) => a.kickoffUtc.localeCompare(b.kickoffUtc));
  return targets;
}

interface ExistingCapture {
  point: string | null;
  kind: string | null;
}
function existingCaptures(db: DatabaseSync, matchId: string): ExistingCapture[] {
  const rows = db
    .prepare(
      "SELECT payload_json, capture_kind FROM match_odds_history WHERE match_id = ? AND source = 'sportmonks'",
    )
    .all(matchId) as { payload_json: string; capture_kind: string | null }[];
  return rows.map((r) => {
    let point: string | null = null;
    try {
      point = (JSON.parse(r.payload_json) as { point?: string }).point ?? null;
    } catch {
      point = null;
    }
    return { point, kind: r.capture_kind };
  });
}

async function fetchMainOdds(smFixtureId: number): Promise<Record<string, unknown>[]> {
  const body = await smGet<SmOdd>(`/odds/pre-match/fixtures/${smFixtureId}`);
  const rows = (body.data ?? []) as SmOdd[];
  return rows
    .filter((o) => isMainMarket(o.market_description))
    .map((o) => ({
      market_id: o.market_id,
      market_description: o.market_description,
      bookmaker_id: o.bookmaker_id,
      label: o.label,
      name: o.name,
      value: o.value,
      total: o.total ?? null,
      handicap: o.handicap ?? null,
    }));
}

async function main() {
  const db = openDataset();
  const insert = db.prepare(
    `INSERT INTO match_odds_history (match_id, captured_utc, payload_json, has_odds, source, capture_kind)
     VALUES (?, ?, ?, ?, 'sportmonks', ?)`,
  );

  if (BACKFILL) {
    // Premium odds history: endpoint premium terbukti kosong pada 2 probe
    // (global + per-fixture). Tetap dicoba per fixture selesai sebagai bukti;
    // hasil kosong dicatat sebagai 0 baris — tidak ada data karangan.
    const finished = db
      .prepare(
        "SELECT DISTINCT match_id FROM team_match_logs WHERE source = 'sportmonks' AND match_id LIKE 'sm_%' LIMIT 20",
      )
      .all() as { match_id: string }[];
    let stored = 0;
    for (const f of finished) {
      const smId = Number(f.match_id.slice(3));
      for (const p of [`/odds/premium/history/fixtures/${smId}`, `/odds/premium/fixtures/${smId}`]) {
        try {
          const body = await smGet<Record<string, unknown>>(p);
          const rows = body.data ?? [];
          if (rows.length > 0) {
            insert.run(
              f.match_id,
              new Date().toISOString(),
              JSON.stringify({
                source: "sportmonks",
                kind: "backfill",
                point: "premium-history",
                fixture_id: smId,
                odds: rows,
              }),
              1,
              "backfill",
            );
            stored += 1;
          }
        } catch {
          // endpoint tidak ada/kosong — lanjut, dicatat di ringkasan akhir.
        }
      }
    }
    console.log(`BACKFILL premium: ${stored} baris tersimpan dari ${finished.length} fixture selesai yang dicoba.`);
    return;
  }

  const now = Date.now();
  let targets = loadTargets().filter((t) => {
    const h = (new Date(t.kickoffUtc).getTime() - now) / 3600_000;
    if (h < -0.5) return false; // sudah kickoff > 30 mnt — odds pre-match lewat
    if (WINDOW_HOURS != null && h > WINDOW_HOURS) return false;
    return true;
  });
  if (LIMIT != null) targets = targets.slice(0, LIMIT);
  console.log(`Target tangkapan: ${targets.length} fixture${WINDOW_HOURS != null ? ` (jendela ${WINDOW_HOURS} jam)` : ""}`);

  let captured = 0;
  let empty = 0;
  let skippedDone = 0;
  let errors = 0;
  for (const t of targets) {
   try {
    const H = (new Date(t.kickoffUtc).getTime() - Date.now()) / 3600_000;
    const existing = existingCaptures(db, t.matchId);
    const hasBaseline = existing.some((e) => e.kind === "baseline");
    const donePoints = new Set(existing.filter((e) => e.point).map((e) => e.point as string));

    const jobs: { kind: string; point: string }[] = [];
    if (!hasBaseline) jobs.push({ kind: "baseline", point: "baseline" });
    for (const p of POINTS) {
      if (H <= p.h && !donePoints.has(p.label)) jobs.push({ kind: "scheduled", point: p.label });
    }
    if (jobs.length === 0) {
      skippedDone += 1;
      continue;
    }
    let odds: Record<string, unknown>[];
    try {
      odds = await fetchMainOdds(t.smFixtureId);
    } catch (e) {
      errors += 1;
      console.warn(`  Gagal fixture ${t.smFixtureId}: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    const lateEntry = !hasBaseline && H < 24;
    for (const job of jobs) {
      const payload = JSON.stringify({
        source: "sportmonks",
        kind: job.kind,
        point: job.point,
        late_entry: job.kind === "baseline" ? lateEntry : undefined,
        fixture_id: t.smFixtureId,
        kickoff_utc: t.kickoffUtc,
        market_filter: "main",
        odds,
      });
      // Tulis dengan retry: lock sesaat dari penulis lain (backfill) tidak
      // boleh membunuh larian panjang — tunggu dan ulangi, jangan menyerah.
      let written = false;
      for (let attempt = 0; attempt < 8 && !written; attempt++) {
        try {
          insert.run(t.matchId, new Date().toISOString(), payload, odds.length > 0 ? 1 : 0, job.kind);
          written = true;
        } catch (e) {
          if (attempt === 7) throw e;
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        }
      }
      captured += 1;
    }
    if (odds.length === 0) empty += 1;
    if (captured % 100 < jobs.length) {
      console.log(`  progres: ${captured} tangkapan (${t.kickoffUtc} ${t.matchId})`);
    }
   } catch (e) {
     errors += 1;
     console.warn(`  Error fixture ${t.matchId}: ${e instanceof Error ? e.message : e} — lanjut.`);
   }
  }
  console.log(
    `SELESAI: ${captured} tangkapan baru, ${empty} fixture tanpa odds (has_odds=0), ${skippedDone} fixture sudah lengkap dilewati, ${errors} error.`,
  );
}

main().catch((e) => {
  console.error("GAGAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
