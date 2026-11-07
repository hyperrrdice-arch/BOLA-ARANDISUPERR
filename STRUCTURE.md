# Structure Map — football-agent

> Ditulis ulang 7 Nov 2026 (cleanup pra-deploy; menggantikan peta
> 4 Nov 2026 yang sudah basi: frontend v2 sudah jadi, mode free sudah
> hidup, dan batch cleanup menghapus kode/data mati). Arsitektur &
> alasan sistem ada di `ARCHITECTURE.md`; bukti per fase ada di
> `tasks/` (§7 bawah). Tujuan app (koreksi owner 5 Nov 2026): alat
> pencari **safe bet untuk parlay** — pick diperingkat dari probabilitas
> model + kesepakatan lintas sumber; EV/Kelly sekunder.
> Laporan cleanup: `tasks/pre-deploy-cleanup-report-2026-11-07.md`.

## 1. Pohon teranotasi (keadaan final)

```
football-agent/
├── ARCHITECTURE.md        arsitektur sistem (dokumen pendamping)
├── STRUCTURE.md           peta repo ini
├── README.md              ringkasan produk + cara kerja
├── CHANGELOG.md           riwayat versi (v2.0.0)
├── AGENTS.md              aturan proyek (next dev + aturan owner)
├── package.json           Next 16.4.0 / React 19.3; dev & start port 3101;
│                          script: build/dev/start/lint saja (4 script mati
│                          era lama dihapus di cleanup B1)
├── app/                   Next.js App Router — FRONTEND v2 (AKTIF)
│   ├── page.tsx           / — landing (bola data 3D + statistik ledger)
│   ├── layout.tsx, globals.css, favicon.ico
│   ├── (terminal)/
│   │   ├── layout.tsx
│   │   ├── pertandingan/page.tsx          /pertandingan — daftar laga
│   │   ├── pertandingan/[matchId]/page.tsx  detail paket per laga
│   │   ├── pilihan/page.tsx               /pilihan — pick aman ber-grade
│   │   └── bukti/page.tsx                 /bukti — kejujuran grade/model
│   └── api/               ⚠️ RUTE WARISAN (utang deploy A2 — frontend v2
│       ├── agent/route.tsx    TIDAK memanggilnya; tanpa auth; keputusan
│       ├── betting/route.ts   owner di langkah deploy: hapus / gating)
│       ├── matches/route.ts
│       └── odds/route.ts      (satu-satunya pengimpor components/dashboard/types)
├── components/
│   ├── Nav.tsx, NavClient.tsx     navigasi v2
│   ├── icons.tsx, ui.tsx          primitif tampilan
│   ├── landing/                   DataBall3D.tsx, HeroScene.tsx, Reveal.tsx
│   ├── pilihan/                   ParlayBuilder.tsx
│   └── dashboard/types.ts         ⚠️ sisa folder dashboard lama: TIPE untuk
│                                  app/api/odds — nasibnya mengikuti A2
├── lib/                   seluruh logika backend
│   ├── agent/             🔒 READ-ONLY: planner.ts, llm.ts, schemas.ts,
│   │                      coverage.ts (jalur sindikat dorman)
│   ├── llm/               🔒 READ-ONLY: models.ts, voice-guide.ts
│   ├── syndicate-orchestrator.ts  🔒 debat 5-LLM dorman (KEEP aturan owner)
│   ├── quant/             mesin deterministik — SUMBER SEMUA ANGKA
│   │   ├── dixon-coles.ts       Poisson bivariat + koreksi τ(rho), matriks 11×11
│   │   ├── ratings-loader.ts    prior ratings + blend James-Stein + gerbang
│   │   ├── league-identity.ts   registry liga kanonik + resolusi serving
│   │   ├── league-gate.ts       jembatan registry kalibrasi → analisis
│   │   ├── cup-offset-fit.ts    inti fit offset δ piala (offline)
│   │   ├── global-offsets.ts    penyajian runtime model piala
│   │   ├── team-identity.ts     registry tim kanonik (acuan pakem)
│   │   ├── team-normalizer.ts   normalisasi nama tim lintas sumber
│   │   ├── vig-stripping.ts     Shin; kelly.ts (info sekunder — ARCH §1)
│   │   ├── fallback-guard.ts    gerbang kualitas data
│   │   ├── special-markets-engine.ts  konteks pasar khusus
│   │   ├── momentum.ts, half-profile.ts, luck-regression.ts  konteks saja
│   │   ├── cup-form-blend.ts    modul riset harness Phase C (ditolak OOS)
│   │   └── index.ts             barrel (diimpor planner/llm 🔒)
│   ├── picks/             MESIN PICK SAFE-BET (jalur aktif)
│   │   ├── engine.ts            bangun pick ber-grade dari paket kuant
│   │   ├── ledger.ts            tulis/baca ledger picks.db + evaluasi hasil
│   │   └── packages.ts          tulis paket versi ke analysis_snapshots.db
│   ├── web/               LAPIS SAJI frontend v2 (read-only, Server Component)
│   │   ├── data.ts              koneksi SQLite readOnly ter-cache; landingStats
│   │   │                        (cache tanda-tangan file + COUNT upcoming),
│   │   │                        ledgerStats, listUpcoming/listSafePicks, form
│   │   ├── parlay.ts            predikat pilihan + gabungan matriks skor
│   │   └── format.ts            format tampilan
│   ├── db/                akses store lokal
│   │   ├── upcoming-fixtures.ts   katalog + sm_id_map
│   │   ├── thestats-dataset.ts    dataset utama (matches, odds history, konteks)
│   │   ├── team-telemetry.ts      rolling telemetri anti-leakage
│   │   └── analysis-snapshot.ts   🔒 kode dorman snapshot lama (store-nya
│   │                              diganti store paket 5 Nov 2026 — ADR-003)
│   ├── odds/              sportmonks-adapter.ts (fetch; render tidak memanggil
│   │                      API), sportmonks-wire.ts (merge berlabel sumber)
│   ├── feeds/             football-data.ts (impor feed gratis football-data.co.uk)
│   ├── view/analysis-view.ts  BFF view-model jalur planner (dorman)
│   └── *.ts (root)        stats-fetcher-agent.ts (dispatcher intel offline),
│                          stats-validator.ts (Zod VerifiedMatchIntelligence),
│                          stats-cache.ts, 1xbet.ts, league-constants.ts,
│                          rate-limit.ts, http-json.ts
│                          [dihapus cleanup B1: stats-fetch.ts,
│                          stats-log-mapper.ts, thestats-competitions.ts,
│                          api-budget.ts, db/sqlite-master.ts,
│                          db/thestats-vault.ts — semua 0 referensi]
├── scripts/               perkakas operasional (tsx) — per peran di §2
├── data/                  store runtime — rinci §3
├── tasks/                 dokumen kerja + bukti per fase — peta di §7
├── docs/                  PRD & dokumen desain DB (docs/plans/, DATABASE.md)
├── design-system/         artefak desain (bukan runtime)
├── archive/               ⛔ arsip legacy owner — tidak disentuh, tidak
│                          dihapus, dikecualikan dari paket deploy
├── .agents/               konfigurasi agent owner (bukan runtime)
└── .taste-skill/          artefak tooling desain (gitignored, bukan runtime)
```

## 2. Skrip per peran (`scripts/`, 33 file)

**Ritme AKTIF — mode free (tanpa token, bertahan pasca-trial)**
- `free-refresh.ts` — entrypoint rantai bebas 7 langkah: import feed →
  registry tim → tautan fixture → kalibrasi → offset piala → telemetri
  kanonik → slate pick 72 jam. Cron tiap 12 jam; di VPS = 1 baris crontab.
- `import-free-feed.ts` — hasil + closing odds + fixture dari
  football-data.co.uk → dataset + telemetri fd (idempoten).
- `import-fdorg-fixtures.ts` — importer football-data.org (dorman —
  menunggu token gratis owner).
- `pick-slate.ts` — bangun paket kuant per fixture jendela → store paket
  + terbitkan pick live-run ke ledger.
- `resolve-pick-outcomes.ts` — nilai pick ledger dari hasil akhir di
  dataset lokal (satu-satunya jalur resolusi resmi).

**Ritme trial Sportmonks (pensiun bersama trial 10 Nov 2026)**
- `daily-refresh.ts` — rantai harian SM: catalog → odds → predictions →
  telemetry → calibrate → cup-offsets → context → laporan cakupan.
- `sm-fetch.ts` — helper fetch SM bersama (token dari env saja).
- `sync-sportmonks-fixtures.ts`, `capture-odds.ts`, `sync-predictions.ts`,
  `backfill-telemetry.ts`, `sync-context.ts` — langkah-langkah rantainya.

**Kalibrasi, registry & telemetri (dipakai kedua ritme)**
- `build-team-canonical.ts` — generator `data/team-canonical.json`
  (acuan pakem: 6.557 tim kanonik).
- `build-fixture-links.ts` — generator `data/fixture-links.json`
  (tautan fixture kembar mt_/sm_).
- `build-league-canonical.ts` — generator `data/league-canonical.json`
  (satu-satunya pembaca `data/football_master.db`).
- `calibrate-ratings.ts` — fit IPF (half-life 365, shrinkage κ=10) →
  registry `league_calibration` + `data/calibrated_ratings.json`.
- `fit-global-offsets.ts` — fit offset piala → blok `cupOffsets` +
  baris registry `source='cup-offset'` (TEPAT sesudah calibrate —
  kontraktual).
- `build-canonical-telemetry.ts` — bangun `team_match_logs_canonical`
  dari `team_match_logs` + registry tim (sumber form di halaman detail).

**Validasi & riset (read-only / offline)**
- `backtest-walkforward.ts`, `backtest-cup-offsets.ts`,
  `backtest-cup-form-blend.ts` — harness OOS (domestik, piala, blend —
  blend DITOLAK gerbangnya, piala tetap offset-only).
- `parlay-lab.ts` — walk-forward kejujuran pick (163.008 pick lab).
- `verify-consumption.ts`, `validate-telemetry-equivalence.ts`,
  `validate-telemetry-oos.ts`, `pick-engine-acceptance.ts`,
  `measure-form-snapshot.ts`, `measure-luck-snapshot.ts` — audit &
  pengukuran.
- `run-one-analysis.ts`, `run-one-cup-analysis.ts`, `run-one-cup-live.ts`
  — driver E2E offline satu laga.
- `backfill-packages.ts`, `migrate-snapshots-to-packages.ts` —
  perkakas migrasi satu-kali (sudah dijalankan; disimpan sebagai
  riwayat cara store paket terbentuk).

## 3. Store & artefak data (`data/`)

| Artefak | Isi / produsen | Deploy? |
|---|---|---|
| `thestats_dataset.db` (±3,0 GB) | dataset utama: matches, team_match_logs(+_canonical), match_odds_history, registry kalibrasi | ✅ wajib (kargo utama) |
| `picks.db` (47,5 MB) | ledger pick lab + live-run & outcomes — `lib/picks/ledger.ts`, `resolve-pick-outcomes.ts` | ✅ wajib |
| `analysis_snapshots.db` (38 MB) | store paket kuant versi per run — `lib/picks/packages.ts` | ✅ wajib |
| `predictions.db` (17 MB) | panel predictions SM (terisolasi dari jalur odds) | ⚠️ nasib pasca-trial = keputusan owner (10 Nov) |
| `upcoming_fixtures.db` (1,7 MB) | katalog fixture + sm_id_map | ✅ wajib |
| `football_master.db` (9,8 MB) | historis football-data.co.uk; hanya dibaca `build-league-canonical.ts` | ❌ exclude (tool rebuild registry) |
| `team-canonical.json` (2,3 MB) | registry tim acuan pakem — `build-team-canonical.ts` | ✅ tracked |
| `calibrated_ratings.json` (0,5 MB) | rating terkalibrasi + blok canonical/cupOffsets — `calibrate-ratings.ts` + `fit-global-offsets.ts` | ✅ tracked (pengecualian .gitignore) |
| `league-canonical.json`, `fixture-links.json` | registry liga (250) & tautan kembar (168 grup) | ✅ tracked |
| `historical/`, `backtest_cache/` | data kerja feed & cache riset | sebagian |
| `sm_prediction_log.jsonl` | log panel SM — direferensikan `lib/odds/sportmonks-wire.ts` (KEEP) | ikut repo |

Dihapus di cleanup B2 (0 referensi, terverifikasi): `thestats_raw_vault.db`
(18,8 MB), 4 file `.bak*` dataset era 27 Okt (42,6 MB), 13 file
state/log era lama (±0,09 MB). DB runtime lain (picks/snapshots/dataset)
adalah kargo wajib — bukan pangkasan.

## 4. Zona read-only 🔒 (perintah owner — byte-identik)

- `lib/agent/planner.ts`, `lib/agent/llm.ts`, `lib/agent/schemas.ts`,
  `lib/agent/coverage.ts`
- `lib/syndicate-orchestrator.ts`
- `lib/llm/models.ts`, `lib/llm/voice-guide.ts`
- `lib/db/analysis-snapshot.ts` (kode dorman; path tidak berpindah)

Path di atas tidak boleh berpindah: planner mengimpornya persis dari
lokasi ini, dan owner ingin sindikat bisa diaktifkan lagi tanpa
perbaikan wiring. Konsekuensi terukur (cleanup B5): `noUnusedLocals`
tidak bisa diaktifkan tanpa menyentuh zona ini (2 error TS6133 di
`syndicate-orchestrator.ts`) — dicatat, tidak dipaksakan.

## 5. Keputusan penempatan & keadaan cleanup

- **File root `lib/*.ts` tidak dipindah ke subfolder** — beberapa
  diimpor planner 🔒 lewat path persis ini.
- **`scripts/` tetap datar** — path dirujuk kedua entrypoint ritme
  (`free-refresh.ts`, `daily-refresh.ts`) dan dokumentasi ini.
- **Identitas dipusatkan**: liga di `lib/quant/league-identity.ts`,
  tim di `lib/quant/team-identity.ts` + `data/team-canonical.json`.
- **Model piala tidak membuat file data baru** — δ + status hidup
  sebagai field di artefak terpadu (registry + ratings JSON).
- **Paket deploy** (rincian audit §5/B7): kode (<2 MB) + data runtime
  ±3,1 GB. Exclude dari transfer: `node_modules/` (npm ci di VPS),
  `.next/` (build di tempat), `.agents/`, `.taste-skill/`, `tasks/`,
  `docs/`, `design-system/`, `archive/`, `data/football_master.db`,
  script riset/one-off (tetap di repo, tak perlu di server).

## 6. Cara menjalankan (ringkas)

```bash
npm run build && npm run start   # sajian produksi di port 3101
npm run dev                      # dev di port 3101
npx tsc --noEmit                 # typecheck (bersih)
npx eslint .                     # lint (hidup lagi sejak cleanup B5;
                                 #  sisa temuan tercatat di laporan cleanup)
npx tsx scripts/free-refresh.ts  # ritme bebas penuh (tanpa token)
npx tsx scripts/pick-slate.ts --hours 72   # slate saja
npx tsx scripts/resolve-pick-outcomes.ts   # resolusi hasil ledger
```

## 7. Peta bukti per fase (`tasks/`)

| Fase | Laporan utama |
|---|---|
| Sprint ekspansi DB Sportmonks | `sprint-report-2026-11-09.md` |
| Overhaul backend F1–F4 | `backend-flow-map.md`, `model-audit.md` |
| Unifikasi liga & tim kanonik (acuan pakem) | `league-canonical-report.md`, `DATA-STANDARD.md` |
| Rekalibrasi domestik & kalibrasi piala | `recalibration-report.md`, `cup-offset-report.md` |
| Safe-bet parlay (ledger, lab, engine, slate) | `tasks/` laporan fase A–D safe-bet + `gate-label-report.md` |
| Mode free (tanpa Sportmonks) | `free-mode-report.md` |
| Frontend v2 | `frontend-rebuild-v2-report.md` |
| Audit kode menyeluruh | `code-audit-2026-11-05.md` |
| Audit + cleanup pra-deploy (7 Nov 2026) | `pre-deploy-audit-2026-11-07.md`, `pre-deploy-cleanup-report-2026-11-07.md` |
| Berjalan | `coverage-latest.md`, `pick-slate-latest.{json,md}`, `telemetry-canonical-report.md` |
