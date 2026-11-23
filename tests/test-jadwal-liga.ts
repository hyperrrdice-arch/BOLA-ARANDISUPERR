/**
 * TEST:JADWAL-LIGA — Addendum Jadwal per Liga (2026-11-23).
 *
 * Murni: pengelompokan per IDENTITAS kompetisi (kunci berbasis ID,
 * bukan string nama), monogram fallback, resolver logo pada pemetaan
 * kosong.
 *
 * Sandbox (jebakan audit brief, dibuktikan pada lapis data): katalog
 * produksi memuat "Serie A" dari TIGA identitas — Italia namespace
 * Sportmonks (sm:384), Italia namespace TheStats (comp_5840, alias
 * kanonik yang sama), dan Brasil (sm:648, memuat Athletico PR vs Remo).
 * listSchedule harus memberi dua Italia kunci grup yang sama, Brasil
 * kunci berbeda, dan baris TheStats tak-terpetakan (comp_9999, nama +
 * negara sama persis dengan Italia) grup sendiri berlabel sumber —
 * tidak pernah menyatu diam-diam.
 *
 * Pakai: npx tsx tests/test-jadwal-liga.ts
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  Suite,
  buildCoreSchemas,
  createFixtureEnv,
  settleFixtureEnv,
  type FixtureEnv,
} from "./helpers/fixture-env";
import { seedKatalog, type BarisKatalog } from "./helpers/redesain-seeds";
import { kelompokPerKompetisi } from "../lib/web/jadwal";
import { monogram, urlLogoKompetisi, urlLogoTim } from "../lib/web/logo";

const suite = new Suite("jadwal-liga");

/* ============================================================ murni */
suite.eq("monogram: dua kata → dua inisial", monogram("Athletico PR"), "AP");
suite.eq("monogram: satu kata → satu huruf", monogram("Remo"), "R");
suite.eq("monogram: aksen dipertahankan sebagai huruf", monogram("Køge"), "K");
suite.eq("monogram: tanda hubung memisah kata", monogram("Paris Saint-Germain"), "PS");
suite.eq("monogram: nama kosong → ?", monogram("  "), "?");
suite.eq("logo: id tak terpetakan → kompetisi null", urlLogoKompetisi("sm:999999999"), null);
suite.eq("logo: id tak terpetakan → tim null", urlLogoTim("sm:123"), null);
suite.eq(
  "logo: terpetakan → kompetisi Serie A Italia (CDN Sportmonks)",
  urlLogoKompetisi("sm:384"),
  "https://cdn.sportmonks.com/images/soccer/leagues/0/384.png",
);
suite.eq(
  "logo: terpetakan → tim AC Milan (CDN Sportmonks)",
  urlLogoTim("sm:113"),
  "https://cdn.sportmonks.com/images/soccer/teams/17/113.png",
);
suite.eq("logo: id null → null", urlLogoKompetisi(null), null);

type ItemGrup = {
  grup_kunci: string;
  grup_nama: string;
  grup_negara: string | null;
  grup_sumber: string | null;
  gate_status: string | null;
  competition_canonical_id: string | null;
  id: string;
};
const mk = (p: Partial<ItemGrup> & { id: string }): ItemGrup => ({
  grup_kunci: "k:sm:384",
  grup_nama: "Serie A",
  grup_negara: "Italy",
  grup_sumber: null,
  gate_status: null,
  competition_canonical_id: "sm:384",
  ...p,
});
const campur = [
  mk({ id: "ita-1" }),
  mk({
    id: "bra-1",
    grup_kunci: "k:sm:648",
    grup_negara: "Brazil",
    competition_canonical_id: "sm:648",
  }),
  mk({ id: "ita-2", gate_status: "calibrated" }),
  mk({
    id: "asing-1",
    grup_kunci: "m:comp_9999",
    grup_sumber: "TheStats",
    competition_canonical_id: null,
  }),
];
const grup = kelompokPerKompetisi(campur);
suite.eq("grup: tiga identitas → tiga grup", grup.length, 3);
suite.eq(
  "grup: urutan = kemunculan pertama",
  grup.map((g) => g.kunci),
  ["k:sm:384", "k:sm:648", "m:comp_9999"],
);
suite.eq(
  "grup: Italia memuat kedua barisnya",
  grup[0].items.map((i) => i.id),
  ["ita-1", "ita-2"],
);
suite.eq("grup: gerbang dari baris pertama yang punya", grup[0].gate_status, "calibrated");
suite.eq("grup: Brasil terpisah walau nama sama", grup[1].items.map((i) => i.id), ["bra-1"]);
suite.eq("grup: tak-terpetakan membawa label sumber", grup[2].sumber, "TheStats");

/* ========================================================== sandbox */
const JAM = 3_600_000;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

async function main(): Promise<void> {
  const env: FixtureEnv = createFixtureEnv("jadwal-liga");
  let gagal = false;
  try {
    process.chdir(env.root);
    await buildCoreSchemas();
    const identity = await import("../lib/identity/fixture-resolver");
    const ds0 = new DatabaseSync(path.join(env.dataDir, "thestats_dataset.db"));
    identity.ensureIdentitySchema(ds0);
    ds0.close();
    fs.writeFileSync(path.join(env.dataDir, "fixture-links.json"), JSON.stringify({ links: [] }));
    fs.writeFileSync(path.join(env.dataDir, "team-canonical.json"), JSON.stringify({ teams: [] }));
    fs.writeFileSync(
      path.join(env.dataDir, "league-canonical.json"),
      JSON.stringify({
        version: 1,
        leagues: [
          {
            canonical_id: "sm:384",
            name: "Serie A",
            country: "Italy",
            aliases: [
              { system: "sportmonks", id: "sm:384" },
              { system: "thestats", id: "comp_5840" },
            ],
            fits: [],
          },
          {
            canonical_id: "sm:648",
            name: "Serie A",
            country: "Brazil",
            aliases: [{ system: "sportmonks", id: "sm:648" }],
            fits: [],
          },
        ],
      }),
    );

    const katalog = (r: Partial<BarisKatalog> & { match_id: string }): BarisKatalog => ({
      competition_id: "sm:384",
      competition_name: "Serie A",
      competition_country: "Italy",
      utc_date: iso(now + 26 * JAM),
      status: "scheduled",
      stage_name: null,
      home_team_id: null,
      home_team_name: "?",
      away_team_id: null,
      away_team_name: "?",
      venue: null,
      is_neutral: null,
      odds_available: null,
      xg_available: null,
      fetched_utc: iso(now),
      ...r,
    });
    seedKatalog(env, [
      katalog({ match_id: "uji_ita_sm", home_team_name: "Inter", away_team_name: "Roma" }),
      katalog({
        match_id: "uji_ita_ts",
        competition_id: "comp_5840",
        home_team_name: "Cremonese",
        away_team_name: "Torino",
        utc_date: iso(now + 27 * JAM),
      }),
      katalog({
        match_id: "uji_bra",
        competition_id: "sm:648",
        competition_country: "Brazil",
        home_team_name: "Athletico PR",
        away_team_name: "Remo",
        utc_date: iso(now + 28 * JAM),
      }),
      katalog({
        match_id: "uji_asing",
        competition_id: "comp_9999",
        home_team_name: "Asing FC",
        away_team_name: "Luar United",
        utc_date: iso(now + 29 * JAM),
      }),
    ]);

    const data = await import("../lib/web/data");
    const items = data.listSchedule(iso(now - JAM), iso(now + 72 * JAM));
    const cari = (id: string) => items.find((i) => i.match_id === id);
    suite.eq("sandbox: empat baris terbaca", items.length, 4);
    suite.eq("sandbox: sm:384 → kunci kanonik Italia", cari("uji_ita_sm")?.grup_kunci, "k:sm:384");
    suite.eq(
      "sandbox: comp_5840 (TheStats) menyatu ke kunci Italia yang sama",
      cari("uji_ita_ts")?.grup_kunci,
      "k:sm:384",
    );
    suite.eq("sandbox: Athletico PR vs Remo → kunci Brasil", cari("uji_bra")?.grup_kunci, "k:sm:648");
    suite.eq("sandbox: grup Brasil bernegara Brazil", cari("uji_bra")?.grup_negara, "Brazil");
    suite.eq(
      "sandbox: canonical Brasil teresolusi",
      cari("uji_bra")?.competition_canonical_id,
      "sm:648",
    );
    suite.eq(
      "sandbox: comp_9999 tak-terpetakan → grup mentah sendiri",
      cari("uji_asing")?.grup_kunci,
      "m:comp_9999",
    );
    suite.eq(
      "sandbox: grup tak-terpetakan berlabel sumber TheStats",
      cari("uji_asing")?.grup_sumber,
      "TheStats",
    );
    const grupSandbox = kelompokPerKompetisi(items);
    suite.eq("sandbox: tepat tiga grup untuk empat baris", grupSandbox.length, 3);
    const grupBra = grupSandbox.find((g) => g.kunci === "k:sm:648");
    suite.check(
      "sandbox: Athletico PR hanya di grup Brasil",
      grupBra?.items.length === 1 && grupBra.items[0].match_id === "uji_bra",
    );
    const grupIta = grupSandbox.find((g) => g.kunci === "k:sm:384");
    suite.eq(
      "sandbox: grup Italia = dua namespace, dua laga",
      grupIta?.items.map((i) => i.match_id).sort(),
      ["uji_ita_sm", "uji_ita_ts"],
    );
  } catch (e) {
    gagal = true;
    console.error(e);
    suite.check("sandbox selesai tanpa pengecualian", false, String(e));
  } finally {
    settleFixtureEnv(env, gagal || suite.failedCount > 0);
  }
  suite.finish();
}

void main();
