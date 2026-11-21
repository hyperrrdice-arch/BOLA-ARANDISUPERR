/**
 * Seed sandbox untuk VERIFIKASI PRODUKSI temuan #1 (2026-11-21):
 * Gençlerbirliği–Gaziantep tampil dua kali (fd_ ↔ sm_) dan kejadian
 * yang sama bisa ditambah dari kedua baris (0,7612² = 57,9%).
 *
 * Semua data laga/paket/pick adalah ekstrak NYATA read-only dari DB
 * checkout utama pada 2026-11-21 (baris katalog verbatim, payload paket
 * verbatim, nilai pick verbatim). Keadaan produksi yang direproduksi:
 * - pick fd_ SUDAH terbit dengan fixture_uid tersimpan fx_59ea… (UID
 *   fixture yang dibuat importer fd lebih dulu, basis 'created');
 * - pick sm_ terbit (di produksi) dengan fixture_uid NULL dan TANPA
 *   alias di store identitas → kunci fisiknya jatuh ke match_id.
 * pick_uid sisi sm_ sintetis berlabel (di DB lokal sisi sm_ belum
 * terbit; di produksi terbit — nilai peluangnya verbatim dari baris
 * lokal). UID fx_59ea… adalah UID salinan lokal; UID produksi
 * (fx_a8e993ea…, tercatat di berkas verifikasi pemilik) berbeda nilainya
 * tetapi mekanismenya identik.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { FixtureEnv } from "./fixture-env";
import type { BarisKatalog, PickSeed } from "./redesain-seeds";

const FIX = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "verifikasi",
);

export function bacaFixtureVer<T>(nama: string): T {
  return JSON.parse(fs.readFileSync(path.join(FIX, nama), "utf8")) as T;
}

export const FD_21 = "fd_T1_20261121_genclerbirligi_gaziantep";
export const SM_21 = "sm_19746551";
export const FD_06 = "fd_T1_20261106_gaziantep_kasimpasa";
export const SM_06 = "sm_19746564";
export const UID_FD_21 = "fx_59ea2a4b-1ffc-4337-9789-adbd1158385f";
export const UID_FD_06 = "fx_9cf0f0bd-14c4-44ae-b4a5-91259e0263eb";
export const KICKOFF_21 = "2026-11-21T10:30:00.000Z";

/** Baris katalog kontrol (sintetis berlabel, pola kontrol redesain L2). */
export function katalogKontrol(): BarisKatalog[] {
  const dasar: BarisKatalog = {
    match_id: "",
    competition_id: "sm:600",
    competition_name: "Super Lig",
    competition_country: "Turkey",
    utc_date: KICKOFF_21,
    status: "scheduled",
    stage_name: null,
    home_team_id: null,
    home_team_name: "",
    away_team_id: null,
    away_team_name: "",
    venue: null,
    is_neutral: null,
    odds_available: null,
    xg_available: null,
    fetched_utc: "2026-11-21T00:00:00.000Z",
  };
  return [
    // Pasangan BALIKAN dua klub yang sama, tanggal berbeda (18 Apr 2027):
    // harus tertaut satu sama lain, TIDAK menyatu dengan laga 21 Nov.
    {
      ...dasar, match_id: "fd_T1_20270418_genclerbirligi_gaziantep",
      competition_id: "T1", utc_date: "2027-04-18T10:30:00.000Z",
      home_team_id: "286", home_team_name: "Genclerbirligi",
      away_team_id: "fd_gaziantep", away_team_name: "Gaziantep",
    },
    {
      ...dasar, match_id: "sm_19746999",
      utc_date: "2027-04-18T10:30:00.000Z",
      home_team_id: "286", home_team_name: "Gençlerbirliği",
      away_team_id: "4192", away_team_name: "Gaziantep F.K.",
    },
    // Klub senama, negara berbeda: Everton Inggris (13) vs Everton
    // Chile (15064), kickoff + lawan kanonik sama — TIDAK boleh tertaut.
    {
      ...dasar, match_id: "sm_910001", competition_id: "sm:8",
      competition_name: "Premier League", competition_country: "England",
      utc_date: "2026-11-25T20:00:00.000Z",
      home_team_id: "13", home_team_name: "Everton",
      away_team_id: "289", away_team_name: "Toulouse FC",
    },
    {
      ...dasar, match_id: "sm_910002", competition_id: "sm:347",
      competition_name: "Primera División", competition_country: "Chile",
      utc_date: "2026-11-25T20:00:00.000Z",
      home_team_id: "15064", home_team_name: "Everton",
      away_team_id: "289", away_team_name: "Toulouse FC",
    },
    // Senior vs tim kedua: Real Sociedad (594) vs Real Sociedad II
    // (9656), kickoff + lawan sama — TIDAK boleh tertaut.
    {
      ...dasar, match_id: "sm_910003",
      utc_date: "2026-11-25T20:00:00.000Z",
      home_team_id: "594", home_team_name: "Real Sociedad",
      away_team_id: "4192", away_team_name: "Gaziantep F.K.",
    },
    {
      ...dasar, match_id: "sm_910004",
      utc_date: "2026-11-25T20:00:00.000Z",
      home_team_id: "9656", home_team_name: "Real Sociedad II",
      away_team_id: "4192", away_team_name: "Gaziantep F.K.",
    },
  ];
}

/** Pick terbit kedua sisi untuk laga 21 Nov (nilai verbatim ekstrak). */
export function picksGenclerbirligi(packageIds: Map<string, number>): PickSeed[] {
  const dasar = {
    probability_basis: "effective",
    published_at_utc: "2026-11-21T09:33:03.018Z",
    gate_status: "calibrated",
    competition_canonical_id: "sm:600",
    kickoff_utc: KICKOFF_21,
  } as const;
  return [
    // --- sisi fd_ (pick_uid + fixture_uid verbatim dari ledger lokal)
    {
      ...dasar, match_id: FD_21, market: "team_over05_home", selection: "yes", line: "",
      model_prob: 0.7806309902474043, market_prob: null, sm_prob: null,
      published_prob: 0.7612, grade: "A",
      pick_uid: "pk_116ede0cf720899251e2a7babd2d37d8",
      package_id: packageIds.get(FD_21) ?? null, fixture_uid: UID_FD_21,
    },
    {
      ...dasar, match_id: FD_21, market: "dc", selection: "1x", line: "",
      model_prob: 0.6910488717704707, market_prob: null, sm_prob: null,
      published_prob: 0.6855, grade: "B",
      pick_uid: "pk_a18dbba3bd716baced70096e08edb2bb",
      package_id: packageIds.get(FD_21) ?? null, fixture_uid: UID_FD_21,
    },
    {
      ...dasar, match_id: FD_21, market: "ou15", selection: "over", line: "1.5",
      model_prob: 0.7782266889426589, market_prob: null, sm_prob: null,
      published_prob: 0.7505, grade: "B",
      pick_uid: "pk_f25d39e01deaac435c3f8e200db235f4",
      package_id: packageIds.get(FD_21) ?? null, fixture_uid: UID_FD_21,
    },
    // --- sisi sm_ (nilai verbatim; pick_uid sintetis berlabel vf_,
    // fixture_uid NULL persis keadaan produksi: tanpa alias, tanpa UID)
    {
      ...dasar, match_id: SM_21, market: "team_over05_home", selection: "yes", line: "",
      model_prob: 0.7993112338408394, market_prob: null, sm_prob: 0.7606999999999999,
      published_prob: 0.7612, grade: "A",
      pick_uid: "pk_vf_sm_team_over05_home",
      package_id: packageIds.get(SM_21) ?? null, fixture_uid: null,
    },
    {
      ...dasar, match_id: SM_21, market: "dc", selection: "1x", line: "",
      model_prob: 0.7070565577110212, market_prob: null, sm_prob: 0.6597,
      published_prob: 0.7271, grade: "B",
      pick_uid: "pk_vf_sm_dc_1x",
      package_id: packageIds.get(SM_21) ?? null, fixture_uid: null,
    },
    {
      ...dasar, match_id: SM_21, market: "ou15", selection: "over", line: "1.5",
      model_prob: 0.7751471715821224, market_prob: null, sm_prob: 0.8176000000000001,
      published_prob: 0.7505, grade: "B",
      pick_uid: "pk_vf_sm_ou15_over",
      package_id: packageIds.get(SM_21) ?? null, fixture_uid: null,
    },
  ];
}

/**
 * Keadaan store identitas PRA-perbaikan (verbatim salinan lokal):
 * fixture fd_ sudah dibuat importer (basis 'created') dengan cid
 * pra-gabung; sisi sm_ belum punya fixture/alias sama sekali.
 */
export function seedIdentitasPra(env: FixtureEnv): void {
  const db = new DatabaseSync(path.join(env.dataDir, "thestats_dataset.db"));
  const insFx = db.prepare(
    `INSERT INTO canonical_fixtures (
       fixture_uid, competition_id, season, home_cid, away_cid, home_name,
       away_name, stage_or_leg, kickoff_utc, kickoff_precision, state,
       neutral, score_basis, current_revision, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 'exact', ?, NULL, 'regulation', ?, ?, ?)`,
  );
  insFx.run(
    UID_FD_21, "T1", "2026-2027", "sm:286", "fd_gaziantep",
    "Genclerbirligi", "Gaziantep", KICKOFF_21, "scheduled", 0,
    "2026-11-21T09:21:52.079Z", "2026-11-21T09:21:52.079Z",
  );
  insFx.run(
    UID_FD_06, "T1", "2026-2027", "fd_gaziantep", "tm_master_kasimpasa",
    "Gaziantep", "Kasimpasa", "2026-11-06T17:00:00.000Z", "finished", 1,
    "2026-11-21T09:21:52.079Z", "2026-11-21T09:21:52.079Z",
  );
  const insAl = db.prepare(
    `INSERT INTO fixture_aliases (source, source_match_id, fixture_uid,
       match_basis, first_seen_utc, last_seen_utc)
     VALUES ('football-data', ?, ?, 'created', ?, ?)`,
  );
  insAl.run(FD_21, UID_FD_21, "2026-11-21T09:21:52.079Z", "2026-11-21T09:21:52.079Z");
  insAl.run(FD_06, UID_FD_06, "2026-11-21T09:21:52.079Z", "2026-11-21T09:21:52.079Z");
  db.close();
}
