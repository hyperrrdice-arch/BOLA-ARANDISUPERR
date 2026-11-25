# Laporan Fix Aktivasi Adapter — API-Football + football-data.org

- **Branch:** `fix/aktivasi-adapter` dari master `0f94f09`, worktree
  `~/workspace/coding/app-football-fixadapter`.
- **Commit:** Fase 1 `a2a82ff` · Fase 2 `e4a9a4d` · laporan ini (docs).
- **Status:** kode + tes + SATU larian live per adapter selesai. **TIDAK
  ada merge, deploy, pendaftaran cron, atau hook Fix-4** — aktivasi
  menunggu kata pemilik sesudah peninjauan laporan ini.
- **Kerahasiaan:** kedua token hanya diteruskan lewat environment dari
  `.env.local` (blind-copy ke worktree); nilai token tidak pernah
  dicetak di log, laporan, atau chat mana pun.

---

## FASE 1 — API-Football: paginasi menabrak batas free plan

### Diagnosis (akar masalah, dari kode + bukti live)

- Script capture memanggil `GET /odds?date=<tanggal>` — odds SEMUA
  fixture dunia pada tanggal itu — lalu mengiterasi `page` dari 1
  sampai `paging.total` yang dilaporkan API (ukuran halaman API = 10).
- Pada larian live 25 Nov 2026, `paging.total` = **18 halaman** untuk
  tanggal 2026-11-25. Free plan menolak Page > 3, jadi loop lama mati
  di halaman 4 dengan error verbatim dari larian produksi pagi itu:
  `GAGAL: api-football: payload errors: {"plan":"Free plans are limited to a maximum value of 3 for the Page parameter"}`.
- Repo TIDAK memiliki pemetaan ID liga API-Football, dan mempersempit
  query per-liga/per-fixture memerlukan ID yang tidak ada di repo
  (mengarang ID dilarang) atau model request berbeda. Jadi perbaikan
  minimal yang jujur = **cap keras di 3 halaman + pelaporan eksplisit
  halaman yang dilewati**; mempersempit query dicatat sebagai celah
  lanjutan (lihat Temuan baru + Celah sisa).

### Perubahan (3 berkas, commit `a2a82ff`)

1. `lib/feeds/api-football.ts`
   - Konstanta `APIFOOTBALL_FREE_PLAN_MAX_PAGE = 3`.
   - Guard keras di `fetchApiFootballOddsPage`: page di luar 1..3
     melempar SEBELUM `limiter.acquire()`/fetch — halaman terlarang
     tidak pernah diminta, dan kuota tidak terbakar untuk request yang
     pasti ditolak.
   - Helper baru `fetchApiFootballOddsForDate(...)` mengembalikan
     `{ pages, totalPages, fetchedPages, skippedPages, truncated }`.
   - Komentar header mendokumentasikan batas plan + error livenya.
2. `scripts/capture-odds-apifootball.ts` — memakai helper ter-cap;
   baris SELESAI kini memuat `halaman <terambil>/<total> terambil`;
   bila terpotong, dicetak baris eksplisit
   `PERINGATAN skipped-due-to-plan-cap: …` (pemotongan senyap dilarang).
3. `tests/test-market-snapshot.ts` — +9 assertion: transport mock
   7 halaman → hanya halaman [1,2,3] yang diminta, `skippedPages=4`,
   `truncated=true`; hitungan laporan hanya berasal dari halaman yang
   terambil (9 quote); transport 2 halaman tidak terpotong; Page 4
   ditolak sebelum request (fetch tidak pernah dipanggil).

### Tes

- Suite T02 (test-market-snapshot): **39/39 → 48/48 lolos**.

### Larian live (tepat SATU kali, cwd worktree)

Salinan konsisten `upcoming_fixtures.db` produksi (VACUUM INTO, 4.029
baris) ditaruh di `data/` worktree; DB snapshot tujuan adalah berkas
worktree sendiri — produksi tidak disentuh (dibuktikan di Fase 3).

Output verbatim (exit 0):

```
SELESAI capture API-Football: tanggal 2026-11-25, jendela manual, halaman 3/18 terambil, 0 quote terbaca, 0 snapshot tersimpan, 0 quote tak terjembatani dilewati, 3 request terpakai (sisa kuota header: 94).
PERINGATAN skipped-due-to-plan-cap: 15 dari 18 halaman query /odds?date=2026-11-25 TIDAK diambil karena batas free plan (Page maks 3) — cakupan tangkapan tanggal ini PARSIAL, bukan tangkapan penuh.
```

- Request terpakai larian ini: **3**; sisa kuota menurut header: **94**.
  Total pemakaian akun hari ini ≈ 6 dari 100 (≈3 larian gagal pagi +
  3 larian ini) — konsisten dengan header.
- Snapshot tertulis: **0** — BUKAN karena paginasi; lihat Temuan baru.
- Spot-check devig Σ≈1,0: tidak dapat dilakukan (0 snapshot); jaminan
  Σ=1 @1e-9 tetap dibuktikan assertion T02 yang ada.
- `data/market_snapshots.db` worktree sesudah larian: 16.384 B, 0 baris
  (skema terinisialisasi oleh larian; disisihkan sebagai
  `data/market_snapshots.db.livecopy-fase1`, tidak di-commit).

### ★ TEMUAN BARU — blocker #3: parser mengharapkan field `teams` yang tidak ada

0 quote terparse MESKI 30 fixture halaman 1–3 benar-benar terambil.
Sebabnya terkonfirmasi dari model typed resmi API (Go client
`OddsResponse`, pkg.go.dev, dibaca 2026-11-25 09:19 UTC): entri respons
`/odds` berbentuk `{ league, fixture { id, timezone, date, timestamp },
update, bookmakers }` — **tidak ada field `teams`**. Parser Sprint C
(`parseApiFootballOdds`) mensyaratkan `entry.teams.home.name` /
`entry.teams.away.name`, jadi 100% entri asli terskip. Mock T02 Sprint C
mengarang field `teams`, sehingga cacat ini tertutup selama ini.

**Keputusan:** Fase 1 TIDAK diperluas menjadi desain-ulang bridge.
Perbaikan yang benar = menjembatani lewat `GET /fixtures?date=`
(fixture.id → nama tim), yang memerlukan perubahan desain sendiri +
larian live verifikasinya sendiri (aturan satu-larian-live melarang
memverifikasinya sekarang). Rekomendasi desain dicatat di Celah sisa.

---

## FASE 2 — football-data.org: pemetaan tim + ketahanan larian

### Diagnosis (akar masalah, dari bukti antrean + registry)

Antrean produksi sesudah larian pagi: **181 baris terbuka** sumber
`football-data-org` (PL 110, ELC 71). Per flags pemetaan di detail
antrean: kedua tim tak-terpetakan **142**, hanya home **18**, hanya
away **21**. Nama berbeda yang tak terpetakan: **37 — SEMUANYA membawa
imbuhan badan hukum** ("Arsenal FC", "Hull City AFC", "Sunderland AFC",
"Swansea City AFC", "Wrexham AFC", …).

Akar masalah (terbukti dengan skrip diagnostik terhadap DB + registry
produksi, read-only):

- `normalizeTeamName` (lib/quant/team-normalizer.ts) memakai bentuk
  terlucuti-imbuhan HANYA untuk lookup kamus alias; pada jalur fallback
  ia mengembalikan nama MENTAH yang masih berimbuhan.
- `buildFdorgMapping` (adapter) membangun kuncinya dari nama registry /
  nama dataset — bentuk tanpa imbuhan ("Arsenal", "Hull City", …).
- Akibatnya nama fdorg berimbuhan tidak pernah bertemu kuncinya:
  kegagalan sistematis, bukan per-nama. (Kamus normalizer juga tidak
  memuat token `afc` sama sekali.) 4 baris fo_ yang sempat mendarat
  pagi itu adalah pasangan ELC yang kebetulan tanpa imbuhan / tertolong
  kamus: Portsmouth–Millwall, Watford–Middlesbrough,
  Middlesbrough–Bristol City, Sheffield United–Watford.
- Verifikasi perbaikan pada data yang sama: peta kunci-terlucuti yang
  diturunkan dari peta nama final menyelesaikan **36 dari 37 nama**.
  Sisa 1 = **"Everton FC"**: "Everton" sungguh ambigu — DUA tim kanonik
  bernama "Everton" (Inggris `sm:13`, Chile `sm:15064` — split paksa
  redesain) — jadi Everton BENAR tetap di antrean (11 laga). Penyebab
  "ambigu sesudah dilucuti" antar-cid lain: 0 untuk PL/ELC.

### Pilihan desain

Fallback kunci-terlucuti dibangun **lokal di adapter**, diturunkan dari
peta nama final `buildFdorgMapping` (kunci yang bertabrakan antar-cid
dibuang — ambigu tetap ke antrean). Tanpa edit tangan ke registry
produksi, tanpa ID karangan, tanpa store alias baru: seluruh bukti
pasangan nama ↔ cid sudah ada di registry; yang hilang hanya langkah
normalisasi di sisi adapter. Identitas tertahan 'SK Beveren' tidak
disentuh.

### Perubahan (3 berkas, commit `e4a9a4d`)

1. `lib/feeds/fdorg-results.ts`
   - `FdorgMapping.cidByStrippedTeamName` + `fdorgStrippedTeamKey()`
     (melucuti imbuhan badan hukum: fc/afc/cf/ac/as/sc/sv/cd/ud/rc/rcd/
     ssc/vfb/vfl/spvgg/ogc/losc/aj) + `resolveFdorgTeamCid()` (exact
     dulu, lalu terlucuti). `applyFdorgResults` memakai resolver ini;
     precedence/revisi/D2/antrean tidak berubah.
   - Retry jaringan terbatas di `fetchFdorgFinishedMatches`: error
     lemparan fetch diulang maks **2×** dengan backoff 2 dtk → 4 dtk
     (lewat `limiter.sleepMs`, dapat diinjeksi di tes), lalu dibungkus
     error `fdorg: kegagalan jaringan untuk <KODE> setelah 2
     pengulangan: …`. Jalur **429/Retry-After dipertahankan persis**
     (1 retry sesudah Retry-After; 429 berulang tetap melempar) dan
     guard ≤9 req/menit tidak berubah.
   - Helper baru `runFdorgCompetitions(...)`: SATU rate limiter
     bersama, isolasi kegagalan per kompetisi — fetch/parse/apply per
     kode dibungkus try/catch; kegagalan dicatat di `failures` + dilog
     `…: GAGAL — … — kompetisi dilewati, larian berlanjut.`, kompetisi
     berikutnya tetap diproses.
2. `scripts/import-fdorg-results.ts` — memakai runner; dormansi
   WAITING_OWNER_TOKEN dipertahankan; baris SELESAI dipertahankan;
   bila ada kegagalan, dicetak baris `SELESAI SEBAGIAN: …` dan
   `process.exitCode = 1` (parsial tidak menyamar sebagai sukses).
3. `tests/test-fdorg-results.ts` — +14 assertion (total 43):
   - jaringan gagal 2× lalu sukses (3 percobaan, backoff [2000, 4000]);
     jaringan selalu gagal → melempar sesudah tepat 3 percobaan;
   - nama ASLI antrean live terpetakan end-to-end lewat apply:
     "Manchester United FC" vs "Arsenal FC", "Brighton & Hove Albion
     FC" vs "Hull City AFC", "Sunderland AFC" vs "Wolverhampton
     Wanderers FC" → applied, unmapped_team=0, baris fo_ tertulis;
   - "Everton FC" dengan dua tim kanonik "Everton" di registry fixture
     → tetap unmapped + masuk antrean;
   - isolasi: `runFdorgCompetitions` dengan ELC selalu gagal jaringan
     → failures=[ELC], PL tetap applied=1, DED tetap diproses.

### Tes

- Suite fdorg (test-fdorg-results): **29/29 → 43/43 lolos** (termasuk
  seluruh perilaku lama: 429, rate limiter, precedence, available_at).

### Larian live (tepat SATU kali, cwd worktree)

Input worktree = salinan konsisten produksi: `thestats_dataset.db`
(VACUUM INTO; pra-larian: fo_ = 4, antrean fdorg terbuka = 181,
last_successful_ingest = 2026-11-25T09:04:13.968Z) + registry produksi
saat ini sebagai input tes (disalin, TIDAK di-commit; registry worktree
dikembalikan ke keadaan commit sebelum validasi Fase 3).

Output verbatim (exit 1 — SELESAI SEBAGIAN, jujur):

```
[fdorg-results] PL: GAGAL — fdorg: kegagalan jaringan untuk PL setelah 2 pengulangan: fetch failed — kompetisi dilewati, larian berlanjut.
[fdorg-results] ELC: parsed=75 applied=20 dup=55 corrected=0 conflict_primary_kept=0 unmapped_team=0 ambiguous=0
[fdorg-results] PD: parsed=129 applied=40 dup=21 corrected=0 conflict_primary_kept=0 unmapped_team=68 ambiguous=0
[fdorg-results] BL1: parsed=90 applied=49 dup=36 corrected=0 conflict_primary_kept=0 unmapped_team=0 ambiguous=5
[fdorg-results] SA: parsed=120 applied=40 dup=36 corrected=0 conflict_primary_kept=0 unmapped_team=44 ambiguous=0
[fdorg-results] FL1: parsed=99 applied=28 dup=19 corrected=0 conflict_primary_kept=0 unmapped_team=48 ambiguous=4
[fdorg-results] DED: parsed=117 applied=32 dup=19 corrected=0 conflict_primary_kept=0 unmapped_team=66 ambiguous=0
[fdorg-results] PPL: parsed=98 applied=8 dup=27 corrected=0 conflict_primary_kept=0 unmapped_team=63 ambiguous=0
[fdorg-results] SELESAI applied=217 dup=213 corrected=0 conflict_primary_kept=0 unmapped_team=289 unmapped_comp=0 ambiguous=9 rows_written=435 skipped_basis=0 skipped_status=0
[fdorg-results] SELESAI SEBAGIAN: 1 kompetisi gagal: PL (fdorg: kegagalan jaringan untuk PL setelah 2 pengulangan: fetch failed)
EXIT=1
```

Penilaian terhadap kriteria brief:

- **applied > 0 ✓** — 217 applied, 435 baris tertulis; fo_ di salinan
  **4 → 439** (persis rows_written); last_successful_ingest terbarui ke
  2026-11-25T09:53:49.861Z.
- **ELC: unmapped_team 71 (pagi) → 0 ✓** — 20 applied + 55 duplikat
  (hasil yang sudah dikenal dari sm_/fd_). **BL1 juga 0 unmapped.**
  Perbaikan pemetaan terbukti pada data live.
- **Premier League: TIDAK terverifikasi live larian ini** — fetch PL
  gagal di level jaringan ("fetch failed", egress VM memang flaky;
  kegagalan yang sama membunuh larian produksi pagi tadi). Retry 2×
  habis, PL diisolasi, larian LANJUT ke 7 kompetisi lain dan berakhir
  jujur sebagai SELESAI SEBAGIAN exit 1 — **persis perilaku ketahanan
  yang diminta**, terbukti pada kegagalan nyata, bukan simulasi.
  Pemetaan PL sendiri terbukti oleh tes unit dengan nama-nama asli PL
  dari antrean + bukti live ELC/BL1 yang memakai jalur kode yang sama.
- **Antrean — jawaban eksplisit:** 181 baris lama **SEMUA tetap
  terbuka**. Mesin adapter tidak pernah menyelesaikan baris antrean
  secara otomatis pada larian ulang (tidak ada jalur kode untuk itu);
  laga ELC yang dulu terantre kini hasilnya mendarat lewat fetch segar,
  tetapi entri antreannya tetap ada untuk kurasi (Item 8), dan dedupe
  antrean mencegah baris ganda. Baris baru larian ini: **+295**
  (289 unmapped_team + ambiguous, ter-dedupe) — semuanya dari kompetisi
  yang BARU PERTAMA KALI terjangkau (PD/SA/FL1/DED/PPL; larian pagi
  mati sebelum mencapainya). Total terbuka di salinan: 476.
- Nama-nama baru yang belum terpetakan hanya **28 nama berbeda** —
  bentuk nama resmi PENUH (penyebab berbeda dari celah imbuhan PL/ELC):
  - PD: Club Atlético de Madrid · Real Racing Club de Santander ·
    Real Sociedad de Fútbol · RCD Espanyol de Barcelona · Rayo
    Vallecano de Madrid · Real Betis Balompié
  - SA: FC Internazionale Milano · Bologna FC 1909 · US Sassuolo
    Calcio · Parma Calcio 1913
  - FL1: ES Troyes AC · Racing Club de Lens · Lille OSC · Stade
    Rennais FC 1901 · RC Strasbourg Alsace
  - DED: SC Cambuur-Leeuwarden · SBV Excelsior · NEC · Telstar 1963 ·
    Feyenoord Rotterdam · FC Twente '65
  - PPL: Sporting Clube de Braga · CF Estrela da Amadora · Sporting
    Clube de Portugal · Sport Lisboa e Benfica · Académico de Viseu
    FC · CS Marítimo · GD Estoril Praia
- Kuota fdorg larian ini: 8 kompetisi terpetakan = 7 fetch sukses +
  PL 3 percobaan jaringan (1+2 retry); limiter ≤9 req/menit dipatuhi.

---

## FASE 3 — Validasi + isolasi live

### Validasi (berurutan, di worktree, data worktree keadaan commit)

| Pemeriksaan | Hasil |
|---|---|
| `npx tsc --noEmit` | OK, tanpa error |
| `npm run lint:gate` | LOLOS — 91 error vs baseline 92 (menyusut, boleh); nol error baru |
| `npm run test:data` | test-data 18/18 · identity 58/58 · publication 110/110 · tickets 69/69 · resolver-score 23/23 · slip-stats-pr2 12/12 · ingest-freshness 12/12 · fix4 35/35 · market-snapshot **48/48** · fdorg-results **43/43** — exit 0 |
| `npm run test:quant` | quant 22/22 · model **62/62** · model-artifacts 32/32 · experiment-stats 23/23 · evaluator-kronologis 22/22 · kandidat-q1 lolos · promote-gate 21/21 · q0-baselines 19/19 · q2a-rho 11/11 — exit 0 |
| `npm run test:lanjut` (L01) | pilihan-edisi 25/25 · pilihan-edisi-browser 28/28 · pilihan-matriks-ulang 27/27 · slate-kembar 96/96 · slate-kembar-tak-tertaut 73/73 — exit 0 |

test:web tidak dijalankan (di luar daftar Fase 3 brief; 2 assertion
test-beranda-pr1b 'hasil-terakhir' yang clock-dependent memang
diketahui gagal identik di master murni — tidak dikejar, sesuai brief).

### Isolasi live (checkout utama / produksi)

Jangkar awal sesi (direkam sebelum pekerjaan apa pun):

- `data/model-manifest.json` sha256 `a6cf947a4f9f1ccfb80fcfccc739dca522bfc00dd042f2b6759530dca2b54315`
- `data/calibrated_ratings.json` sha256 `c52af2193da75ea5a4359aac017b25860e0820ea883a2bb67fa8480035d4c85d`
- `data/picks.db` 59.863.040 B, mtime 2026-11-25 05:13:06 UTC
- `data/market_snapshots.db` 4.096 B, mtime 2026-11-25 09:11:48 UTC

Keadaan akhir sesi:

- **model-manifest.json: sha256 IDENTIK** (`a6cf947a…`), modelVersion
  dan ratingsHash champion tidak berubah.
- **market_snapshots.db produksi: IDENTIK** (4.096 B, mtime sama) —
  larian capture Fase 1 menulis hanya ke DB worktree.
- calibrated_ratings.json (sha256 kini `be93286a…`), picks.db
  (60.653.568 B, mtime 09:45:10 UTC), dan thestats_dataset.db produksi
  (mtime 09:39:44 UTC) BERUBAH — **bukan oleh pekerjaan ini**: seluruh
  akses sesi ini ke checkout utama bersifat read-only (SELECT +
  blind-copy keluar), dan cron terjadwal `football-free-refresh`
  16:21 WIB berjalan di tengah sesi — buktinya
  `tasks/pick-slate-latest.json` ter-regenerasi 09:45:11 UTC beserta
  tulisan dataset/picks pada jendela 09:39–09:45 UTC yang sama.
  Langkah calibrate/pick/resolve refresh memang menulis ketiga berkas
  itu; manifest champion tidak ditulis ulang oleh refresh (konsisten
  dengan pengamatan Sprint C).
- Semua tulisan larian live sesi ini berada di salinan worktree:
  `data/market_snapshots.db.livecopy-fase1` (16.384 B, 0 baris) dan
  `data/thestats_dataset.db.livecopy-fase2` (fo_ 439) — keduanya TIDAK
  di-commit; JSON registry salinan produksi dikembalikan ke keadaan
  commit (`git checkout`) sebelum validasi.

### Celah sisa (untuk keputusan pemilik, bukan dikerjakan di sini)

1. **Blocker #3 API-Football (utama):** parser mengharapkan
   `entry.teams` yang tidak ada di respons asli. Rekomendasi: bridge
   lewat `GET /fixtures?date=` (fixture.id → home/away) lalu gabungkan
   ke entri odds per fixture.id — perubahan desain sendiri + satu
   larian live verifikasi. Tanpa ini, capture tidak akan pernah
   menulis snapshot meski paginasi sudah benar.
2. **Cakupan free plan:** query tanggal global hanya menjangkau 30
   fixture pertama per hari (3 halaman × 10). Sesudah blocker #3
   beres, nilai capture tetap parsial sampai ada pemetaan ID liga
   API-Football (kurasi berbasis bukti) untuk mempersempit query.
3. **Verifikasi live PL (fdorg)** menunggu satu larian pada jaringan
   yang sehat; jalur kodenya sudah terbukti (tes nama asli + ELC/BL1
   live). Larian produksi terjadwal berikutnya akan menunjukkannya.
4. **28 nama resmi penuh** (PD/SA/FL1/DED/PPL) perlu kurasi identitas
   (Item 8): alias registry berbasis bukti atau tabel pemetaan ID tim
   fdorg — JANGAN dilonggarkan dari sisi matcher (risiko gabung-salah
   lebih besar daripada manfaatnya; himpunannya kecil dan terenumerasi).
5. **"Everton FC" tetap di antrean secara desain** (dua tim kanonik
   bernama Everton) — 11 laga PL tidak akan terapan lewat fdorg sampai
   ada pembeda berbasis ID.
6. **Baris antrean tidak pernah tertutup otomatis** — 181 baris lama
   (termasuk ELC yang hasilnya kini mendarat) menunggu kurasi Item 8
   untuk ditandai resolved; bukan bug adapter.
7. **Aktivasi tetap menunggu kata pemilik:** cron capture 09:00/18:00
   WIB, hook Fix-4 ke alur harian, dan tiket resmi pertama — tidak ada
   satu pun yang didaftarkan/dijalankan oleh branch ini.
