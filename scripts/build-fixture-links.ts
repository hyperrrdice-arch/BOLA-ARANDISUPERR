/**
 * BUILD FIXTURE LINKS — tautan eksplisit pertandingan kembar antar sumber
 * di katalog upcoming (data/fixture-links.json), bagian acuan pakem
 * (perintah owner 2026-11-05).
 *
 * Dua baris katalog = pertandingan yang sama bila kickoff (timestamp
 * persis) + tim kanonik kandang + tim kanonik tamu sama persis, dengan
 * tim diselesaikan lewat data/team-canonical.json (id dulu; nama fixture
 * sebagai cadangan). Baris Sportmonks (sm_) selalu jadi baris kanonik;
 * baris sumber lain (mt_ TheStats, fd_) tercatat sebagai kembarnya.
 * Resolver liga di runtime sudah mendahulukan sm_ — file ini membuat
 * tautannya EKSPLISIT sebagai data, bukan aturan baca yang implisit.
 *
 * Pakai: npx tsx scripts/build-fixture-links.ts
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import {
  ensureIdentitySchema,
  linkAlias,
  resolveFixtureIdentity,
  sourceOfMatchId,
} from "../lib/identity/fixture-resolver";

const ROOT = process.cwd();

interface CanonFile {
  teams: {
    canonical_id: string;
    name: string;
    members: { team_id: string }[];
    aliases: string[];
  }[];
}

function main() {
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, "data/team-canonical.json"), "utf8")) as CanonFile;
  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const t of reg.teams) {
    for (const m of t.members) byId.set(m.team_id, t.canonical_id);
    byName.set(t.name, t.canonical_id);
    for (const a of t.aliases) if (!byName.has(a)) byName.set(a, t.canonical_id);
  }
  const resolve = (id: string, name: string): string | null =>
    byId.get(id) ?? byName.get(name) ?? null;

  const up = new DatabaseSync(path.join(ROOT, "data/upcoming_fixtures.db"), { readOnly: true });
  const fx = up.prepare(
    "SELECT match_id, competition_id, utc_date, home_team_id, home_team_name, away_team_id, away_team_name FROM upcoming_fixtures",
  ).all() as unknown as {
    match_id: string; competition_id: string | null; utc_date: string;
    home_team_id: string; home_team_name: string;
    away_team_id: string; away_team_name: string;
  }[];
  up.close();

  const groups = new Map<string, string[]>();
  let unresolved = 0;
  for (const f of fx) {
    const ch = resolve(f.home_team_id, f.home_team_name);
    const ca = resolve(f.away_team_id, f.away_team_name);
    if (!ch || !ca) { unresolved += 1; continue; }
    const key = `${f.utc_date}|${ch}|${ca}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f.match_id);
  }

  const links: { twin_id: string; canonical_id: string; kickoff_utc: string }[] = [];
  let dupGroups = 0;
  for (const [key, ids] of groups) {
    if (ids.length < 2) continue;
    dupGroups += 1;
    const canonical = ids.find((i) => i.startsWith("sm_")) ?? ids[0];
    for (const id of ids) {
      if (id !== canonical) links.push({ twin_id: id, canonical_id: canonical, kickoff_utc: key.split("|")[0] });
    }
  }
  links.sort((a, b) => a.twin_id.localeCompare(b.twin_id));

  const out = {
    version: 1,
    generated_at: new Date().toISOString(),
    generator: "scripts/build-fixture-links.ts",
    note: "Tautan pertandingan kembar katalog: twin_id (sumber lain) -> canonical_id (baris Sportmonks). Kunci kecocokan: kickoff persis + tim kanonik kandang/tamu persis (registry data/team-canonical.json).",
    stats: { fixtures: fx.length, duplicate_groups: dupGroups, twin_rows: links.length, fixtures_with_unresolved_team: unresolved },
    links,
  };
  fs.writeFileSync(path.join(ROOT, "data/fixture-links.json"), JSON.stringify(out, null, 2));
  console.log(`fixtures=${fx.length} grup-kembar=${dupGroups} baris-kembar=${links.length} fixture-tim-tak-teresolusi=${unresolved}`);
  console.log("tertulis: data/fixture-links.json");

  // K1: grup kembar yang sama juga didaftarkan ke store identitas
  // persisten di dataset (satu UID per laga fisik, alias dua arah), supaya
  // resolver hasil dan adapter web tidak bergantung pada file JSON saja.
  // Output JSON di atas tidak berubah. Dataset yang belum ada (checkout
  // tanpa data) dilewati — builder tetap murni penulis registry katalog.
  const dsPath = path.join(ROOT, "data/thestats_dataset.db");
  if (fs.existsSync(dsPath)) {
    const ds = new DatabaseSync(dsPath);
    ds.exec("PRAGMA journal_mode = WAL;");
    ds.exec("PRAGMA busy_timeout = 60000;");
    try {
      ensureIdentitySchema(ds);
      const nowIso = new Date().toISOString();
      const rowById = new Map(fx.map((f) => [f.match_id, f]));
      let registered = 0;
      for (const [key, ids] of groups) {
        if (ids.length < 2) continue;
        const [kickoffUtc, homeCid, awayCid] = key.split("|");
        const canonical = ids.find((i) => i.startsWith("sm_")) ?? ids[0];
        const primary = rowById.get(canonical);
        const resolved = resolveFixtureIdentity(
          ds,
          {
            source: sourceOfMatchId(canonical),
            sourceMatchId: canonical,
            competitionId: primary?.competition_id ?? null,
            homeCid,
            awayCid,
            homeName: primary?.home_team_name ?? null,
            awayName: primary?.away_team_name ?? null,
            kickoffUtc,
            kickoffPrecision: "exact",
          },
          nowIso,
        );
        if (resolved.kind === "ambiguous") continue;
        for (const id of ids) {
          if (id === canonical) continue;
          linkAlias(ds, resolved.fixtureUid, sourceOfMatchId(id), id, "catalog_twin", nowIso);
          registered++;
        }
      }
      console.log(`identitas: ${registered} alias kembar terdaftar ke store dataset`);
    } finally {
      ds.close();
    }
  }
}

main();
