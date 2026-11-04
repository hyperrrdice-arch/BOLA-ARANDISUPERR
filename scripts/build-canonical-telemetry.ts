/**
 * BUILD CANONICAL TELEMETRY — melebur team_match_logs per sumber menjadi
 * SATU baris resmi per tim per pertandingan (tabel baru
 * team_match_logs_canonical di thestats_dataset.db), bagian acuan pakem
 * (perintah owner 2026-11-05, fase 4).
 *
 * Kunci kanonik pertandingan: (tanggal kalender, tim kanonik, lawan
 * kanonik, venue) — identitas tim lewat data/team-canonical.json, jadi
 * baris TheStats (source NULL, id tm_) dan baris Sportmonks (id numerik)
 * untuk pertandingan nyata yang sama jatuh ke kunci yang sama. Inilah
 * dobel-hitung yang dulu menggelembungkan form Fenerbahçe.
 *
 * Pemenang per kunci (urutan prioritas sumber):
 *   sportmonks > football-data > thestats (NULL) > master
 * lalu baris dengan xG terisi didahulukan, lalu kelengkapan kolom.
 * Bila pemenang tidak punya xG tapi kembarannya punya, kolom xG diisi
 * dari kembaran terbaik dan ditandai xg_filled_from (asal tercatat).
 * Bila skor antar kembaran TIDAK sama, baris ditandai goals_conflict=1
 * (dipilih tetap per prioritas; daftar contoh di laporan).
 *
 * Tabel asal TIDAK diubah — tabel kanonik adalah lapisan resmi yang
 * dibangun ulang reproduksibel dari tabel asal + registry.
 *
 * Pakai: npx tsx scripts/build-canonical-telemetry.ts
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DB_PATH = path.join(ROOT, "data/thestats_dataset.db");
const REPORT = path.join(ROOT, "tasks/telemetry-canonical-report.md");

const SOURCE_PRIORITY: Record<string, number> = {
  sportmonks: 0,
  "football-data": 1,
  thestats: 2, // source NULL di data asal
  master: 3,
};
const XG_COLS = [
  "xg_for", "xg_against", "npxg_for", "npxg_against",
  "first_half_xg_for", "second_half_xg_for", "first_half_xg_against", "second_half_xg_against",
];

type Row = Record<string, unknown> & {
  log_id: string; team_id: string; opponent_id: string; venue: string;
  match_date: string; source: string | null;
  goals_for: number; goals_against: number; xg_for: number | null;
};

function main() {
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, "data/team-canonical.json"), "utf8")) as {
    teams: { canonical_id: string; members: { team_id: string }[] }[];
  };
  const canon = new Map<string, string>();
  for (const t of reg.teams) for (const m of t.members) canon.set(m.team_id, t.canonical_id);

  const db = new DatabaseSync(DB_PATH);
  const cols = (db.prepare("PRAGMA table_info(team_match_logs)").all() as unknown as { name: string }[])
    .map((c) => c.name);
  const rows = db.prepare("SELECT * FROM team_match_logs").all() as unknown as Row[];

  const srcOf = (r: Row): string => r.source ?? "thestats";
  const nonNullCount = (r: Row): number => cols.reduce((s, c) => s + (r[c] !== null && r[c] !== undefined ? 1 : 0), 0);
  const score = (r: Row): [number, number, number, string] => [
    SOURCE_PRIORITY[srcOf(r)] ?? 9,
    r.xg_for !== null && r.xg_for !== undefined ? 0 : 1,
    -nonNullCount(r),
    r.log_id,
  ];

  const groups = new Map<string, Row[]>();
  let unresolved = 0;
  for (const r of rows) {
    const ct = canon.get(r.team_id);
    const co = canon.get(r.opponent_id);
    if (!ct || !co) { unresolved += 1; continue; }
    const key = `${r.match_date.slice(0, 10)}|${ct}|${co}|${r.venue}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const extraCols: [string, string][] = [
    ["canonical_team_id", "TEXT"],
    ["canonical_opponent_id", "TEXT"],
    ["canonical_match_key", "TEXT"],
    ["chosen_source", "TEXT"],
    ["sources_present", "TEXT"],
    ["alternates_count", "INTEGER"],
    ["goals_conflict", "INTEGER"],
    ["xg_filled_from", "TEXT"],
  ];
  db.exec("DROP TABLE IF EXISTS team_match_logs_canonical");
  db.exec(
    `CREATE TABLE team_match_logs_canonical (${cols.map((c) => `"${c}"`).join(", ")}, ${extraCols.map(([n, t]) => `"${n}" ${t}`).join(", ")})`,
  );
  const insert = db.prepare(
    `INSERT INTO team_match_logs_canonical (${[...cols, ...extraCols.map(([n]) => n)].map((c) => `"${c}"`).join(", ")}) VALUES (${[...cols, ...extraCols.map(([n]) => n)].map((c) => `@${c}`).join(", ")})`,
  );

  let twinsMerged = 0;
  let xgFills = 0;
  const conflicts: { key: string; scores: string }[] = [];
  const winnerBySource = new Map<string, number>();

  db.exec("BEGIN");
  try {
    for (const [key, members] of groups) {
      const sorted = [...members].sort((a, b) => {
        const sa = score(a);
        const sb = score(b);
        return sa[0] - sb[0] || sa[1] - sb[1] || sa[2] - sb[2] || (sa[3] < sb[3] ? -1 : 1);
      });
      const winner: Row = { ...sorted[0] };
      let xgFilledFrom: string | null = null;
      if (winner.xg_for === null || winner.xg_for === undefined) {
        const donor = sorted.find((r) => r.xg_for !== null && r.xg_for !== undefined);
        if (donor) {
          for (const c of XG_COLS) winner[c] = donor[c];
          if (winner.xg_source === null || winner.xg_source === undefined) {
            winner.xg_source = donor.xg_source ?? srcOf(donor);
          }
          xgFilledFrom = srcOf(donor);
          xgFills += 1;
        }
      }
      const scoreSet = new Map<string, number>();
      for (const r of members) {
        const s = `${r.goals_for}-${r.goals_against}`;
        scoreSet.set(s, (scoreSet.get(s) ?? 0) + 1);
      }
      const conflict = scoreSet.size > 1 ? 1 : 0;
      if (conflict && conflicts.length < 25) {
        conflicts.push({ key, scores: [...scoreSet.entries()].map(([s, n]) => `${s}×${n}`).join(", ") });
      }
      if (members.length > 1) twinsMerged += members.length - 1;
      const chosen = srcOf(sorted[0]);
      winnerBySource.set(chosen, (winnerBySource.get(chosen) ?? 0) + 1);
      const [date, ct, co] = key.split("|");
      void date;
      insert.run({
        ...winner,
        canonical_team_id: ct,
        canonical_opponent_id: co,
        canonical_match_key: key,
        chosen_source: chosen,
        sources_present: JSON.stringify([...new Set(members.map(srcOf))].sort()),
        alternates_count: members.length - 1,
        goals_conflict: conflict,
        xg_filled_from: xgFilledFrom,
      });
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  db.exec("CREATE INDEX idx_tmlc_team_date ON team_match_logs_canonical (canonical_team_id, match_date)");
  const canonCount = (db.prepare("SELECT COUNT(*) AS c FROM team_match_logs_canonical").get() as unknown as { c: number }).c;
  db.close();

  const lines: string[] = [];
  lines.push("# Telemetri Kanonik — Laporan Build (Fase 4)");
  lines.push("");
  lines.push(`Dibangun: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Angka");
  lines.push("");
  lines.push(`- Baris asal team_match_logs: **${rows.length}** (tidak diubah)`);
  lines.push(`- Baris kanonik team_match_logs_canonical: **${canonCount}**`);
  lines.push(`- Baris kembar dilebur: **${twinsMerged}**`);
  lines.push(`- Baris tak ter-resolusi ke registry: **${unresolved}**`);
  lines.push(`- Isi xG dari kembaran (pemenang tak punya xG): **${xgFills}** baris`);
  lines.push(`- Pemenang per sumber: ${[...winnerBySource.entries()].map(([s, n]) => `${s}=${n}`).join(", ")}`);
  lines.push("");
  lines.push("## Contoh konflik skor antar sumber (goals_conflict=1)");
  lines.push("");
  for (const c of conflicts) lines.push(`- \`${c.key}\` — skor tercatat: ${c.scores}`);
  lines.push("");
  lines.push("Prioritas sumber: sportmonks > football-data > thestats (NULL) > master; di dalam sumber yang sama: xG terisi dulu, lalu kolom terlengkap. Konflik skor tetap dipilih per prioritas dan DITANDAI, tidak disembunyikan.");
  lines.push("");
  fs.writeFileSync(REPORT, lines.join("\n"));
  console.log(`asal=${rows.length} kanonik=${canonCount} kembar-dilebur=${twinsMerged} xg-diisi=${xgFills} tak-teresolusi=${unresolved}`);
  console.log(`pemenang: ${[...winnerBySource.entries()].map(([s, n]) => `${s}=${n}`).join(", ")}`);
  console.log(`tertulis: tabel team_match_logs_canonical + ${REPORT}`);
}

main();
