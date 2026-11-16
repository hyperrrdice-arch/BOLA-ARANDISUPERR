# Ekspansi Divisi Football-Data — Laporan (2026-11-16)

Tugas: perluas impor football-data.co.uk melampaui 16 divisi warisan, ukur
delta kegunaannya (fixture ter-rate), tanpa melonggarkan gerbang apa pun.

## 1 · Inventaris situs (diperiksa langsung sesi ini, 2026-11-16)

**Liga utama (mmz4281, per musim) = 22 divisi.** Yang sudah diimpor: 16.
Yang belum — dan semuanya nyata ada untuk musim 2627, skema kolom identik
dengan divisi lama:

| Kode | Liga | Baris 2627 | Closing Pinnacle (PPCH/D/A) | xG (HxG/AxG) |
|------|------|-----------:|:---:|:---:|
| E2 | English League One | 158 | ✓ | ✓ |
| E3 | English League Two | 164 | ✓ | ✓ |
| EC | English National League | 189 | ✓ | ✗ (tembakan saja) |
| SC1 | Scottish Championship | 69 | ✓ | ✗ |
| SC2 | Scottish League One | 69 | ✓ | ✗ |
| SC3 | Scottish League Two | 65 | ✓ | ✗ |

**Liga ekstra dunia (16 liga premier: Argentina, Austria, Brasil, China,
Denmark, Finlandia, Irlandia, Jepang, Meksiko, Norwegia, Polandia, Romania,
Rusia, Swedia, Swiss, USA)** — file tunggal `new/<KODE>.csv`, **TIDAK
diimpor di putaran ini**: skemanya berbeda total dari mmz4281
(`Country,League,Season,Date,Time,Home,Away,HG,AG,Res,PSCH,…` — multi-musim
dalam satu file, tanpa xG/tembakan, tanpa blok pra-laga), jadi tidak
ter-parse oleh pola importer yang ada. Memasukkannya butuh adapter terpisah
— keputusan terpisah, bukan bagian ekspansi ini.

## 2 · Yang dibangun

1. `lib/feeds/football-data.ts` — `FD_DIVISIONS` 16 → 22 (enam kode di atas,
   nama/negara sesuai penamaan situs).
2. `scripts/calibrate-ratings.ts` — **jalur fit legacy baru**: divisi fd yang
   hasil impornya sudah mendarat di `dataset.matches` (competition_id = kode
   divisi) tapi belum punya entri ratings difit dengan mesin + gerbang yang
   PERSIS sama dengan jalur Sportmonks (fitLeague yang sama, uji skala 2%,
   cakupan telemetri ≥80% — dihitung dari log hasil fd — tangga gerbang OOS
   yang sama). Entri lama (16 warisan + semua SM) tidak pernah disentuh.
   Entri hasil jalur ini (`source='football-data-fit'`) di-fit ulang tiap
   run seperti liga SM, dan dikecualikan dari stempel 'calibrated' loop
   registrasi warisan (kalau tidak, status gerbangnya tertimpa di run
   berikutnya — bug yang ditangkap sebelum rantai penuh jalan).
3. `lib/quant/league-identity.ts` — `parseSourceId`: pengecualian eksplisit
   `'EC'`, satu-satunya kode divisi legacy tanpa digit akhir; tanpa ini EC
   tidak pernah ter-resolusi sebagai id sumber (registry-nya sendiri sudah
   benar — yang putus hanya parsernya).
4. Registry kanonik diregenerasi dengan builder proyek
   (`build-league-canonical.ts`): SC1/SC2/SC3 menjadi entri kanonik sendiri
   (menggantikan entri comp_ lama yang tanpa fit), E2/E3/EC menjadi alias
   legacy-div + fit legacy pada entri sm:12/sm:14/sm:17. Perubahan lain pada
   regenerasi = penyesuaian status/alias mengikuti registry DB (sumber
   kebenaran) yang memang sudah bergerak sejak registry terakhir dibuat
   2026-11-04 — tanpa kehilangan alias/fit apa pun.

## 3 · Hasil impor (run target pertama, musim 2627)

| Div | Parsed | Insert | Bridge | Telemetri | Odds closing |
|-----|-------:|-------:|-------:|----------:|-------------:|
| E2 | 158 | 114 | 44 | 228 | +158 |
| E3 | 164 | 144 | 20 | 288 | +164 |
| EC | 189 | 162 | 27 | 324 | +189 |
| SC1 | 69 | 69 | 0 | 138 | +69 |
| SC2 | 69 | 69 | 0 | 138 | +69 |
| SC3 | 65 | 65 | 0 | 130 | +65 |
| **Total** | **714** | **623** | **91** | **1.246** | **+714** |

Semua odds closing = Pinnacle (pinPreferred di semua baris). Fixtures:
40 ter-parse dari fixtures.csv → 37 insert + 3 bridge, odds pra-laga +40.
Catatan E2: bridge hanya menangkap 44/158 — sisanya tidak cocok
(tanggal/bentuk nama) dengan baris sm:12 dan ter-insert sebagai baris fd;
populasi fit legacy murni baris fd, jadi tidak ada laga terhitung ganda di
dalam satu fit.

## 4 · Kalibrasi per liga baru (keluaran gerbang, bukan ditulis tangan)

| Div | Status | n match | Skala | Cakupan |
|-----|--------|--------:|------:|--------:|
| E2 | **partial** | 114 | 0,967 | 1,00 |
| E3 | calibrated | 144 | 0,996 | 1,00 |
| EC | calibrated | 162 | 1,000 | 1,00 |
| SC1 | calibrated | 69 | 1,005 | 1,00 |
| SC2 | calibrated | 69 | 1,012 | 1,00 |
| SC3 | calibrated | 65 | 0,999 | 1,00 |

E2 jatuh ke partial karena skala 0,967 di luar toleransi 2% — gerbang
bekerja, tidak dilonggarkan. Konsekuensi aturan fit-sesuai-sumber (sama
seperti pasangan E0/SM8): fixture fd League One kini dilayani fit E2
(partial, 1 musim, n=114), fixture sm:12 tetap dilayani SM12 (calibrated,
n=1.271). Label gerbang yang dibaca slate untuk E2/E3/EC mengikuti baris
kanoniknya (sm:12 calibrated / sm:14 partial / sm:17 partial).

## 5 · Delta kegunaan — jujur: 0 di jendela ini, jalurnya terbukti

Baseline slate 72 jam (committed c0eddc0 dan run segar pra-ekspansi —
identik): **scanned 30, rated 9, legs 68 (A26/B21/C21)**.
Sesudah ekspansi (free-refresh penuh, semua langkah exit 0):
**scanned 30, rated 9, legs 68 (A26/B21/C21)** — **delta = 0**.

Sebabnya terukur, bukan kegagalan ekspansi: fixtures.csv situs saat ini
masih berisi ronde **14 Nov** (situs mengumpulkan fixture baru Selasa &
Jumat sore; hari ini Senin) — ke-37 fixture divisi baru yang ter-insert
semuanya bertanggal 2026-11-14, sudah lewat, di luar jendela 72 jam mana
pun. Tidak ada fixture divisi baru lain di upcoming_fixtures dalam jendela
ini dari sumber mana pun.

Bukti jalur sajinya bekerja (probe resolusi → fit saji → gerbang → rating
tim, jalur yang sama persis dengan yang dipakai pick-slate; 12 fixture
sampel, 2 per divisi): **6/6 divisi ter-resolusi ke fit yang melayani**
(E2→E2, E3→E3, EC→EC, SC1→SC1, SC2→SC2, SC3→SC3) dan **23/24 tim sampel
ketemu langsung** di fit sajinya. Satu-satunya yang meleset: "Sheffield
Weds" (ejaan fixtures.csv) vs kunci roster "Sheffield Wednesday" — bentuk
nama, dilaporkan apa adanya, tidak ditebak aliasnya (keputusan alias =
wewenang owner, seperti proses unmatched yang sudah ada). Delta rated akan
terwujud pada slate pertama setelah fixtures.csv diperbarui — ronde
21–22 Nov keenam liga bermain penuh.

## 6 · Tim tak ter-resolve

Run target pertama: **49 nama** (semua konteks hasil; baris teams `fd_`
dibuat untuk semuanya; nol tebak fuzzy — daftar lengkapnya ada di log run
tersebut; contoh: Wycombe, Bradford, Salford, Forest Green, Ayr, Morton).
Setelah build-team-canonical + impor ulang rantai penuh, laporan
`tasks/free-import-unmatched.json` final membaca **0** — semua nama
ter-resolve lewat baris/registry yang dibuat di antaranya.

## 7 · Catatan samping (di luar scope, tidak diubah)

Fixture bertanggal lampau dari fixtures.csv ter-insert berstatus
'scheduled' (37 baris divisi baru di atas) — ini perilaku importer yang
sudah ada untuk semua divisi, bukan hal baru dari ekspansi ini.

## 8 · Verifikasi & kepatuhan

- Rantai `free-refresh` penuh: 7/7 langkah exit 0; fit legacy ter-re-fit
  dengan hasil gerbang identik di run kedua (E2 tetap partial 0,967).
- `tsc --noEmit` = 0 di semua checkpoint.
- `scripts/quant-correctness-tests.ts`: SEMUA LOLOS.
  `scripts/pick-engine-acceptance.ts`: PASS (exit 0).
- File 🔒 tidak disentuh: `lib/agent/*`, `lib/coverage.ts`,
  `lib/syndicate-orchestrator.ts`, `lib/llm/*` — nol edit. Blok
  `nextjs-agent-feedback` di AGENTS.md proyek dibaca sebagai konten file,
  TIDAK dijalankan. `.env.local` tidak pernah dibuka/dibaca (hanya
  diteruskan lewat flag `--env-file` tsx pada driver slate/acceptance,
  resep standar proyek).
- Commit: `045c6ea` (kode ekspansi + jalur fit), `60251e8` (fix re-fit
  status gerbang), `81448df` (fix `parseSourceId` EC), `ec97019` (data/hasil
  rantai: ratings, registry kanonik, fixture-links, team-canonical, slate,
  laporan ini). Branch kerja: master. Status git final: bersih — semua file
  hasil kerja tugas ini ter-commit, tidak ada file dirty tersisa.
