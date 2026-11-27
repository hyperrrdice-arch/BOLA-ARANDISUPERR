/**
 * Seed PANGGUNG untuk suite test-jadwal-akses-browser (brief tindak
 * lanjut §2.2–§2.4): satu direktori data sandbox yang membuktikan, di
 * browser nyata, tiga hal sekaligus —
 *
 *   1. Nama aksesibel baris Jadwal membawa tim + status + skor,
 *      termasuk 0–0 yang sah (sm_aks_done00 selesai 0–0, sm_aks_live
 *      live 2–1, sm_aks_next terjadwal tanpa skor).
 *   2. Identitas angka Analisa: sm_aks_resmi punya paket TERBARU dengan
 *      peluang btts 45% tetapi pilihan resmi ledger 68% basis model —
 *      Analisa wajib menampilkan 68% + "Peluang model saat terbit";
 *      sm_aks_paket hanya punya paket (77%) tanpa pilihan resmi —
 *      wajib berlabel "Paket terbaru · Belum terbit resmi";
 *      sm_aks_konflik punya DUA edisi resmi BTTS dari dua alias laga
 *      yang sama (0,6276 vs 0,7727 — pola arsip Marseille) — Analisa
 *      wajib menampilkan status "Dua sumber berbeda angka" TANPA satu
 *      angka pun (bukan 77%, bukan 63%, bukan 70% milik paket).
 *   3. Cap refresh B2.2 di footer Jadwal (meta disemai 1 jam lalu),
 *      logo kompetisi/tim dari logo-assets panggung, dan konteks
 *      kembali Detail/404.
 *
 * Semua kickoff dipatok pada jam WIB tetap (hari ini 08.00/09.00 untuk
 * selesai/live — status sumber selalu menang atas dimensi waktu;
 * besok 15.00/16.00/17.00 untuk terjadwal) supaya suite stabil kapan
 * pun dijalankan. Mengembalikan kunci tanggal WIB kedua hari itu.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  buildCoreSchemas,
  seedDatasetTeams,
  type FixtureEnv,
} from "./fixture-env";
import {
  seedKatalog,
  seedPaketObjek,
  seedPicks,
  type BarisKatalog,
} from "./redesain-seeds";

const JAM = 3_600_000;

/** Instant UTC untuk pukul `jamWib`:00 pada tanggal WIB `offsetHari` dari hari ini. */
function padaJamWib(offsetHari: number, jamWib: number, nowMs: number): number {
  const wib = new Date(nowMs + 7 * JAM);
  return (
    Date.UTC(
      wib.getUTCFullYear(),
      wib.getUTCMonth(),
      wib.getUTCDate() + offsetHari,
      jamWib - 7,
    )
  );
}

/** Kunci tanggal WIB (YYYY-MM-DD) dari instant UTC. */
function kunciWib(ms: number): string {
  const wib = new Date(ms + 7 * JAM);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${wib.getUTCFullYear()}-${p(wib.getUTCMonth() + 1)}-${p(wib.getUTCDate())}`;
}

const MATRIKS = [
  [0.06, 0.06, 0.03],
  [0.08, 0.15, 0.07],
  [0.05, 0.13, 0.07],
];

function paket(
  matchId: string,
  home: string,
  away: string,
  kickoffMs: number,
  legs: Record<string, unknown>[],
): Record<string, unknown> {
  return {
    fixture: {
      match_id: matchId,
      competition_id: "sm:1",
      competition_name: "Liga Akses",
      home,
      away,
      kickoff_utc: new Date(kickoffMs).toISOString(),
    },
    gate_status: "calibrated",
    population: "league",
    lambda: 1.7,
    mu: 1.2,
    rho: 0,
    probabilities: { "btts:yes": 0.68, "ou25:over": 0.77 },
    top_scores: [{ home_goals: 1, away_goals: 1, prob: 0.15 }],
    score_matrix: MATRIKS,
    legs,
  };
}

function leg(over: Record<string, unknown>): Record<string, unknown> {
  return {
    market: "btts",
    selection: "yes",
    model_prob: 0.68,
    effective_prob: 0.68,
    effective_source: "lab-band",
    band: "85+",
    band_n: 100,
    grade: "A",
    market_prob: null,
    sm_prob: null,
    agreement_spread: null,
    ...over,
  };
}

export interface PanggungAkses {
  tanggalHariIni: string;
  tanggalBesok: string;
  markerUtc: string;
}

export async function seedPanggungAkses(env: FixtureEnv): Promise<PanggungAkses> {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const koDone = padaJamWib(0, 8, now);
  const koLive = padaJamWib(0, 9, now);
  const koKonflik = padaJamWib(1, 14, now);
  const koNext = padaJamWib(1, 15, now);
  const koResmi = padaJamWib(1, 16, now);
  const koPaket = padaJamWib(1, 17, now);

  process.chdir(env.root);
  const { ledger } = await buildCoreSchemas();
  const publication = await import("../../lib/picks/publication");
  const tickets = await import("../../lib/picks/tickets");
  publication.ensurePublicationSchema(ledger.getPicksDb());
  tickets.ensureTicketSchema(ledger.getPicksDb());
  const identity = await import("../../lib/identity/fixture-resolver");
  const ds0 = new DatabaseSync(path.join(env.dataDir, "thestats_dataset.db"));
  identity.ensureIdentitySchema(ds0);
  /* Alias laga konflik: dua id sumber, satu UID fisik — edisi resmi
     BTTS-nya berbeda angka (pola arsip Marseille dua alias). */
  const insAlias = ds0.prepare(
    `INSERT INTO fixture_aliases (source, source_match_id, fixture_uid, match_basis, first_seen_utc, last_seen_utc)
     VALUES ('seed', ?, 'uid-aks-konflik', 'seed', ?, ?)`,
  );
  insAlias.run("sm_aks_konflik", iso(now), iso(now));
  insAlias.run("mt_aks_konflik", iso(now), iso(now));
  ds0.close();

  fs.writeFileSync(
    path.join(env.dataDir, "fixture-links.json"),
    JSON.stringify({ links: [] }),
  );
  fs.writeFileSync(
    path.join(env.dataDir, "league-canonical.json"),
    JSON.stringify({
      version: 1,
      leagues: [
        {
          canonical_id: "sm:1",
          name: "Liga Akses",
          country: "Indonesia",
          aliases: [],
          fits: [{ system: "seed" }],
        },
      ],
    }),
  );
  const tim = (
    canonical_id: string,
    name: string,
    team_id: string,
  ): Record<string, unknown> => ({
    canonical_id,
    name,
    country: null,
    members: [{ system: "thestats", team_id, name_as_stored: name }],
    aliases: [name],
    contested_name: false,
  });
  fs.writeFileSync(
    path.join(env.dataDir, "team-canonical.json"),
    JSON.stringify({
      version: 1,
      generated_utc: iso(now),
      teams: [
        tim("sm:aks1", "Akses Nol", "tm_aks_h1"),
        tim("sm:aks2", "Tandem FC", "tm_aks_a1"),
        tim("sm:aks3", "Live Akses", "tm_aks_h2"),
        tim("sm:aks4", "Tandang Live", "tm_aks_a2"),
        tim("sm:aks5", "Jadwal Home", "tm_aks_h3"),
        tim("sm:aks6", "Jadwal Away", "tm_aks_a3"),
        tim("sm:aks7", "Resmi Home", "tm_aks_h4"),
        tim("sm:aks8", "Resmi Away", "tm_aks_a4"),
        tim("sm:aks9", "Paket Home", "tm_aks_h5"),
        tim("sm:aks10", "Paket Away", "tm_aks_a5"),
        tim("sm:aks11", "Konflik Home", "tm_aks_h6"),
        tim("sm:aks12", "Konflik Away", "tm_aks_a6"),
      ],
    }),
  );
  /* Logo panggung: berkas disalin suite ke public/logo-uji.webp. */
  const logoTim: Record<string, string> = {};
  for (let i = 1; i <= 12; i++) logoTim[`sm:aks${i}`] = "/logo-uji.webp";
  fs.writeFileSync(
    path.join(env.dataDir, "logo-assets.json"),
    JSON.stringify({ kompetisi: { "sm:1": "/logo-uji.webp" }, tim: logoTim }),
  );

  const katalog = (r: Partial<BarisKatalog> & { match_id: string }): BarisKatalog => ({
    competition_id: "sm:1",
    competition_name: "Liga Akses",
    competition_country: "Indonesia",
    utc_date: iso(koNext),
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
    katalog({
      match_id: "sm_aks_live",
      utc_date: iso(koLive),
      status: "live",
      home_team_id: "tm_aks_h2",
      home_team_name: "Live Akses",
      away_team_id: "tm_aks_a2",
      away_team_name: "Tandang Live",
    }),
    katalog({
      match_id: "sm_aks_next",
      utc_date: iso(koNext),
      home_team_id: "tm_aks_h3",
      home_team_name: "Jadwal Home",
      away_team_id: "tm_aks_a3",
      away_team_name: "Jadwal Away",
    }),
    katalog({
      match_id: "sm_aks_resmi",
      utc_date: iso(koResmi),
      home_team_id: "tm_aks_h4",
      home_team_name: "Resmi Home",
      away_team_id: "tm_aks_a4",
      away_team_name: "Resmi Away",
    }),
    katalog({
      match_id: "sm_aks_paket",
      utc_date: iso(koPaket),
      home_team_id: "tm_aks_h5",
      home_team_name: "Paket Home",
      away_team_id: "tm_aks_a5",
      away_team_name: "Paket Away",
    }),
    katalog({
      match_id: "sm_aks_konflik",
      utc_date: iso(koKonflik),
      home_team_id: "tm_aks_h6",
      home_team_name: "Konflik Home",
      away_team_id: "tm_aks_a6",
      away_team_name: "Konflik Away",
    }),
  ]);

  seedPaketObjek(env, [
    paket("sm_aks_done00", "Akses Nol", "Tandem FC", koDone, []),
    paket("sm_aks_live", "Live Akses", "Tandang Live", koLive, []),
  ]);
  /* sm_aks_resmi: paket lama DULU (id lebih kecil), paket terbaru
     SESUDAHnya — LATEST_PER_MATCH mengambil id terbesar. Paket kedua
     untuk laga yang sama disisipkan SQL langsung dengan computed_utc
     berbeda (unik per (match_id, trigger, computed_utc) — pola yang
     sama dengan test-redesain-jadwal). */
  const idsLama = seedPaketObjek(env, [
    paket("sm_aks_resmi", "Resmi Home", "Resmi Away", koResmi, [
      leg({ model_prob: 0.68, effective_prob: 0.68 }),
    ]),
  ]);
  {
    const db = new DatabaseSync(path.join(env.dataDir, "analysis_snapshots.db"));
    const payloadBaru = paket("sm_aks_resmi", "Resmi Home", "Resmi Away", koResmi, [
      leg({ model_prob: 0.5, effective_prob: 0.45 }),
    ]);
    db.prepare(
      `INSERT INTO packages (match_id, competition_canonical_id, kickoff_utc,
         computed_utc, trigger, payload_json)
       VALUES (?, ?, ?, ?, 'manual', ?)`,
    ).run(
      "sm_aks_resmi",
      "sm:1",
      iso(koResmi),
      iso(koResmi - 4 * JAM),
      JSON.stringify(payloadBaru),
    );
    db.close();
  }
  seedPaketObjek(env, [
    paket("sm_aks_paket", "Paket Home", "Paket Away", koPaket, [
      leg({
        market: "ou25",
        selection: "over",
        model_prob: 0.8,
        effective_prob: 0.77,
      }),
    ]),
  ]);
  const idsKonflik = seedPaketObjek(env, [
    paket("sm_aks_konflik", "Konflik Home", "Konflik Away", koKonflik, [
      leg({ model_prob: 0.7, effective_prob: 0.7 }),
    ]),
  ]);

  seedPicks(env, [
    {
      match_id: "sm_aks_resmi",
      market: "btts",
      selection: "yes",
      line: "",
      model_prob: 0.68,
      market_prob: null,
      sm_prob: null,
      published_prob: 0.68,
      probability_basis: "model",
      published_at_utc: iso(koResmi - 5 * JAM),
      grade: "A",
      gate_status: "calibrated",
      pick_uid: "uid-aks-resmi-btts",
      competition_canonical_id: "sm:1",
      kickoff_utc: iso(koResmi),
      package_id: idsLama.get("sm_aks_resmi") ?? null,
      fixture_uid: null,
    },
    /* Konflik: edisi alias mt_ terbit lebih dulu 0,6276; edisi sm_
       (id katalog yang tampil) terbit belakangan 0,7727. Keduanya
       fixture_uid NULL — tautan fisik hanya dari store alias. */
    {
      match_id: "mt_aks_konflik",
      market: "btts",
      selection: "yes",
      line: "",
      model_prob: 0.7,
      market_prob: null,
      sm_prob: null,
      published_prob: 0.6276,
      probability_basis: "effective",
      published_at_utc: iso(koKonflik - 6 * JAM),
      grade: "A",
      gate_status: "calibrated",
      pick_uid: "uid-aks-konflik-mt",
      competition_canonical_id: "sm:1",
      kickoff_utc: iso(koKonflik),
      package_id: null,
      fixture_uid: null,
    },
    {
      match_id: "sm_aks_konflik",
      market: "btts",
      selection: "yes",
      line: "",
      model_prob: 0.7,
      market_prob: null,
      sm_prob: null,
      published_prob: 0.7727,
      probability_basis: "effective",
      published_at_utc: iso(koKonflik - 5 * JAM),
      grade: "A",
      gate_status: "calibrated",
      pick_uid: "uid-aks-konflik-sm",
      competition_canonical_id: "sm:1",
      kickoff_utc: iso(koKonflik),
      package_id: idsKonflik.get("sm_aks_konflik") ?? null,
      fixture_uid: null,
    },
  ]);

  seedDatasetTeams(env, [
    { team_id: "tm_aks_h1", name: "Akses Nol" },
    { team_id: "tm_aks_a1", name: "Tandem FC" },
    { team_id: "tm_aks_h2", name: "Live Akses" },
    { team_id: "tm_aks_a2", name: "Tandang Live" },
  ]);
  const ds = new DatabaseSync(path.join(env.dataDir, "thestats_dataset.db"));
  const insMatch = ds.prepare(
    `INSERT INTO matches (match_id, competition_id, season, utc_date, status,
       home_team_id, away_team_id, home_score, away_score, referee_name, updated_at)
     VALUES (?, 'sm:1', '2026-2027', ?, ?, ?, ?, ?, ?, NULL, ?)`,
  );
  insMatch.run("sm_aks_done00", iso(koDone), "finished", "tm_aks_h1", "tm_aks_a1", 0, 0, iso(now));
  insMatch.run("sm_aks_live", iso(koLive), "live", "tm_aks_h2", "tm_aks_a2", 2, 1, iso(now));
  ds.close();

  /* Cap refresh B2.2: meta pada analysis_snapshots, 1 jam lalu. */
  const markerUtc = iso(now - JAM);
  const snap = new DatabaseSync(path.join(env.dataDir, "analysis_snapshots.db"));
  snap.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  snap
    .prepare(
      `INSERT INTO meta (key, value) VALUES ('free_refresh_last_success_utc', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(markerUtc);
  snap.close();

  return {
    tanggalHariIni: kunciWib(koDone),
    tanggalBesok: kunciWib(koNext),
    markerUtc,
  };
}
