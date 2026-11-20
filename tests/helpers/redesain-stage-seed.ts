/**
 * Penyemai PANGGUNG RENDER reproduksi redesain — membangun direktori
 * data sandbox di target yang diberikan (untuk `next start` pada build
 * produksi), memakai seed yang sama persis dengan suite
 * tests/test-redesain-repro.ts.
 *
 * Pakai: npx tsx tests/helpers/redesain-stage-seed.ts <dirTarget> <skenario>
 * Skenario: marseille | detailarsip
 * Target TIDAK boleh di dalam checkout (pakai /tmp/...); skrip menolak
 * target yang memuat .git atau node_modules supaya tidak salah semai.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildCoreSchemas, type FixtureEnv } from "./fixture-env";
import {
  bacaFixture,
  seedKatalog,
  seedRegistry,
  seedPaket,
  seedPaketObjek,
  seedPicks,
  picksMarseille,
  picksArsip19Nov,
  paketArsip,
  type BarisKatalog,
} from "./redesain-seeds";

const [target, skenario] = process.argv.slice(2);
if (!target || !skenario) {
  console.error("pakai: redesain-stage-seed.ts <dirTarget> <marseille|detailarsip>");
  process.exit(2);
}
const root = path.resolve(target);
if (fs.existsSync(path.join(root, ".git"))) {
  console.error(`menolak target yang tampak seperti checkout: ${root}`);
  process.exit(2);
}
fs.mkdirSync(path.join(root, "data"), { recursive: true });
fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
fs.mkdirSync(path.join(root, "fd-csv"), { recursive: true });

const env: FixtureEnv = {
  label: `stage-${skenario}`,
  root,
  dataDir: path.join(root, "data"),
  tasksDir: path.join(root, "tasks"),
  csvDir: path.join(root, "fd-csv"),
};

async function main(): Promise<void> {
  process.chdir(root);
  const { ledger } = await buildCoreSchemas();
  const publication = await import("../../lib/picks/publication");
  const tickets = await import("../../lib/picks/tickets");
  publication.ensurePublicationSchema(ledger.getPicksDb());
  tickets.ensureTicketSchema(ledger.getPicksDb());
  const identity = await import("../../lib/identity/fixture-resolver");
  const ds = new DatabaseSync(path.join(env.dataDir, "thestats_dataset.db"));
  identity.ensureIdentitySchema(ds);
  ds.close();
  fs.writeFileSync(path.join(env.dataDir, "fixture-links.json"), JSON.stringify({ links: [] }));

  const kasus = bacaFixture<BarisKatalog[]>("katalog-kasus.json");
  if (skenario === "marseille") {
    seedRegistry(env, bacaFixture<unknown[]>("registry-tim.json"));
    seedKatalog(env, kasus.filter((r) => ["sm_19715544", "mt_022917440"].includes(r.match_id)));
    const pkgIds = seedPaket(env, ["paket-sm_19715544.json", "paket-mt_022917440.json"]);
    seedPicks(env, picksMarseille(pkgIds));
  } else if (skenario === "detailarsip") {
    seedKatalog(
      env,
      kasus.filter((r) => ["sm_19726740", "sm_19719152", "sm_19879501"].includes(r.match_id)),
    );
    seedPaket(env, ["paket-sm_19726740.json", "paket-sm_19719152.json"]);
    const picks = picksArsip19Nov();
    const perMatch = new Map<string, string>();
    for (const p of picks) perMatch.set(p.match_id, p.kickoff_utc);
    const ids = seedPaketObjek(env, [...perMatch.entries()].map(([m, ko]) => paketArsip(m, ko)));
    seedPicks(env, picks.map((p) => ({ ...p, package_id: ids.get(p.match_id) ?? null })));
  } else {
    console.error(`skenario tidak dikenal: ${skenario}`);
    process.exit(2);
  }
  console.log(`stage seed selesai: ${skenario} → ${env.dataDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
