/**
 * BUILD FIXTURE LINKS — tautan eksplisit pertandingan kembar antar sumber
 * di katalog upcoming (data/fixture-links.json), bagian acuan pakem
 * (perintah owner 2026-11-05).
 *
 * Dua baris katalog = pertandingan yang sama bila konteks liga cocok,
 * tim kandang/tamu sama pada LEVEL TAUTAN, dan kickoff berdekatan.
 * Pencocokan hidup di lib/identity/link-matching.ts (satu-satunya sumber
 * kebenaran; penjaga slate memakai modul yang sama):
 *
 *   - Tim diselesaikan lewat data/team-canonical.json (id dulu; nama
 *     fixture sebagai cadangan), lalu dipetakan ke kunci identitas
 *     LEVEL TAUTAN: alias di data/link-team-aliases.json menyatukan
 *     entri registry yang merujuk klub yang sama (mis. sm:1272
 *     "SK Beveren" dan sm:6723 "Beveren") TANPA menggabung registry —
 *     penggabungan nama registry adalah keputusan pemilik tersendiri.
 *   - Kickoff ditoleransi sampai ±120 menit (rantai antar baris
 *     berurutan): drift baris mt_ yang terbukti di produksi ≤ 90 menit
 *     (Osasuna vs Málaga +90, Getafe vs Atlético −60; 22 Nov 2026).
 *     Kunci lama — kickoff persis + tim kanonik persis — melewatkan
 *     4 pasangan itu sehingga slate/ledger mencatatnya dua kali
 *     (Lanjut-5).
 *
 * Baris Sportmonks (sm_) selalu jadi baris kanonik; baris sumber lain
 * (mt_ TheStats, fd_) tercatat sebagai kembarnya. Resolver liga di
 * runtime sudah mendahulukan sm_ — file ini membuat tautannya EKSPLISIT
 * sebagai data, bukan aturan baca yang implisit.
 *
 * Pakai: npx tsx scripts/build-fixture-links.ts
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import {
  ensureIdentitySchema,
  getFixtureByUid,
  getUidForMatchId,
  linkAlias,
  resolveFixtureIdentity,
  sourceOfMatchId,
} from "../lib/identity/fixture-resolver";
import {
  buildTeamResolver,
  clusterTwinRows,
  linkTeamKeyFn,
  loadLinkTeamAliases,
  resolveLinkRow,
  TWIN_KICKOFF_TOLERANCE_MIN,
  type LinkableFixtureRow,
  type TeamRegistryFile,
} from "../lib/identity/link-matching";

const ROOT = process.cwd();

function main() {
  const reg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data/team-canonical.json"), "utf8"),
  ) as TeamRegistryFile;
  const resolver = buildTeamResolver(reg);
  const aliases = loadLinkTeamAliases(path.join(ROOT, "data"));
  const linkKeyOf = linkTeamKeyFn(aliases);

  const up = new DatabaseSync(path.join(ROOT, "data/upcoming_fixtures.db"), { readOnly: true });
  const fx = up.prepare(
    "SELECT match_id, competition_id, competition_name, utc_date, home_team_id, home_team_name, away_team_id, away_team_name FROM upcoming_fixtures",
  ).all() as unknown as LinkableFixtureRow[];
  up.close();

  const resolvedRows = [];
  let unresolved = 0;
  for (const f of fx) {
    const r = resolveLinkRow(f, resolver, linkKeyOf);
    if (!r) { unresolved += 1; continue; }
    resolvedRows.push(r);
  }

  const clusters = clusterTwinRows(resolvedRows);
  const links: { twin_id: string; canonical_id: string; kickoff_utc: string }[] = [];
  let tolerantGroups = 0;
  for (const c of clusters) {
    if (c.kind === "tolerant") tolerantGroups += 1;
    for (const r of c.rows) {
      if (r.match_id !== c.canonical.match_id) {
        links.push({
          twin_id: r.match_id,
          canonical_id: c.canonical.match_id,
          kickoff_utc: c.canonical.utc_date,
        });
      }
    }
  }
  links.sort((a, b) => a.twin_id.localeCompare(b.twin_id));

  const out = {
    version: 1,
    generated_at: new Date().toISOString(),
    generator: "scripts/build-fixture-links.ts",
    note: "Tautan pertandingan kembar katalog: twin_id (sumber lain) -> canonical_id (baris Sportmonks). Kunci kecocokan (Lanjut-5, lib/identity/link-matching.ts): konteks liga sama + tim kandang/tamu sama pada level tautan (alias data/link-team-aliases.json menyatukan entri registry satu klub TANPA menggabung registry) + kickoff dalam rantai ±120 menit (drift mt_ terbukti ≤90 menit). Sebelumnya: kickoff persis + tim kanonik persis.",
    stats: {
      fixtures: fx.length,
      duplicate_groups: clusters.length,
      twin_rows: links.length,
      fixtures_with_unresolved_team: unresolved,
      tolerant_groups: tolerantGroups,
      kickoff_tolerance_min: TWIN_KICKOFF_TOLERANCE_MIN,
      link_alias_groups: aliases.groups.length,
    },
    links,
  };
  fs.writeFileSync(path.join(ROOT, "data/fixture-links.json"), JSON.stringify(out, null, 2));
  console.log(`fixtures=${fx.length} grup-kembar=${clusters.length} (toleran=${tolerantGroups}) baris-kembar=${links.length} fixture-tim-tak-teresolusi=${unresolved}`);
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
      // Pemulihan cid fixture yang tersimpan: cid lama yang menurut
      // registry SAAT INI adalah member dari cid grup (klub yang sama,
      // mis. 'fd_gaziantep' -> 'sm:4192' sesudah gabung registry)
      // ditulis ulang ke cid grup. Tanpa ini resolver menandai fixture
      // lama sebagai konflik tim (ambiguous) dan hasil tak pernah
      // menempel. cid yang menunjuk klub LAIN tidak disentuh.
      // Lanjut-5: pemulihan juga berlaku bila cid tersimpan dan cid
      // grup adalah ALIAS LEVEL TAUTAN satu sama lain (mis. tersimpan
      // 'sm:6723' Beveren, grup 'sm:1272' SK Beveren) — level tautan
      // saja; registry tidak berubah.
      const pulihkanCid = (uid: string, homeCid: string, awayCid: string): void => {
        const fxRow = getFixtureByUid(ds, uid);
        if (!fxRow) return;
        const setara = (tersimpan: string, grup: string): boolean =>
          resolver.byTeamId(tersimpan) === grup ||
          linkKeyOf(tersimpan) === linkKeyOf(grup);
        const map = (tersimpan: string | null, grup: string): string | null =>
          tersimpan && tersimpan !== grup && setara(tersimpan, grup)
            ? grup
            : tersimpan;
        const homeBaru = map(fxRow.home_cid, homeCid);
        const awayBaru = map(fxRow.away_cid, awayCid);
        if (homeBaru !== fxRow.home_cid || awayBaru !== fxRow.away_cid) {
          ds.prepare(
            "UPDATE canonical_fixtures SET home_cid = ?, away_cid = ?, updated_at = ? WHERE fixture_uid = ?",
          ).run(homeBaru, awayBaru, nowIso, uid);
        }
      };
      let registered = 0;
      for (const cluster of clusters) {
        const ids = cluster.rows.map((r) => r.match_id);
        const canonical = cluster.canonical.match_id;
        const kickoffUtc = cluster.canonical.utc_date;
        const homeCid = cluster.canonical.home_cid;
        const awayCid = cluster.canonical.away_cid;
        // Konvergensi (verifikasi produksi temuan #1): bila grup sudah
        // punya TEPAT SATU fixture fisik — dari member mana pun, mis.
        // fixture fd_ yang dibuat importer — dan baris kanonik belum
        // menunjuk ke sana, JANGAN buat fixture kedua lewat resolver:
        // tautkan semua alias grup ke fixture yang sudah ada itu. Pick
        // terbit membawa fixture_uid tersimpan, jadi kunci fisik
        // penyajian harus UID yang sudah ada, bukan UID baru.
        const uidPerId = new Map<string, string>();
        for (const id of ids) {
          const u = getUidForMatchId(ds, id);
          if (u) uidPerId.set(id, u);
        }
        const uidUnik = [...new Set(uidPerId.values())];
        if (uidUnik.length === 1) {
          const survivor = uidUnik[0];
          pulihkanCid(survivor, homeCid, awayCid);
          if (uidPerId.get(canonical) !== survivor) {
            linkAlias(ds, survivor, sourceOfMatchId(canonical), canonical, "catalog_twin", nowIso);
            registered++;
            for (const id of ids) {
              if (id === canonical) continue;
              if (uidPerId.get(id) !== survivor) {
                linkAlias(ds, survivor, sourceOfMatchId(id), id, "catalog_twin", nowIso);
                registered++;
              }
            }
            continue;
          }
          // Fixture tunggal itu milik baris kanonik sendiri dan cid-nya
          // sudah dipulihkan di atas — lanjut ke jalur resolver biasa,
          // yang kini memvalidasinya sebagai 'known'.
        }
        const primary = cluster.canonical;
        const resolved = resolveFixtureIdentity(
          ds,
          {
            source: sourceOfMatchId(canonical),
            sourceMatchId: canonical,
            competitionId: primary.competition_id ?? null,
            homeCid,
            awayCid,
            homeName: primary.home_team_name ?? null,
            awayName: primary.away_team_name ?? null,
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
