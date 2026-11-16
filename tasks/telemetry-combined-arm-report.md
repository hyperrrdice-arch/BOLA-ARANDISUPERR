# Laporan Validasi Lengan Telemetri Gabungan (SM ∪ football-data) — Level B OOS

Tanggal: 2026-11-16 · Branch `master` · Status: **SELESAI — gerbang pra-terdaftar PASS (3/3 kriteria); penerimaan baris football-data ke telemetri saji ter-backing OOS; tidak ada perubahan kode saji yang diperlukan (jalur kanonik live terverifikasi ekuivalen)**

---

## 0 · Aturan adopsi PRA-TERDAFTAR (verbatim — ditulis sebelum hasil apa pun ada)

> **Pertanyaan.** Bolehkah telemetri saji memasukkan baris `source='football-data'`
> (digabung dengan `source='sportmonks'`, ter-dedupe per laga fisik) tanpa
> menurunkan akurasi out-of-sample?
>
> **Lengan yang dibandingkan** (harness yang sama dengan
> `scripts/validate-telemetry-oos.ts`; populasi, lipatan, fit, dan blend
> identik — satu-satunya saklar adalah definisi `rollingTelem`):
> - `fixed` — SM-only + bobot xG rasio kompetisi (definisi tervalidasi saat
>   ini; kode byte-identik dengan lengan `fixed` di run 2026-11-04).
> - `combined` — SM ∪ fd ter-pool per `team_id`; dedupe SEBELUM windowing
>   dengan kunci `tanggal(10)|opponent_id|goals_for|goals_against`; pada
>   tabrakan kunci, baris **sportmonks menang**; jendela = 6 laga fisik
>   berbeda terakhir strictly-before cutoff; bobot xG rasio kompetisi
>   identik dengan `fixed` (kompetisi log ter-resolve lewat join `matches`
>   pada `match_id`; tak ter-resolve → bobot 1,0 — fallback harness yang
>   sudah ada). **Perilaku xG absen: baris dengan `xg_for`/`xg_against`
>   NULL hanya menyumbang gol — rata-rata xG per sisi dibagi COUNT sampel
>   non-null sisi itu; NULL tidak pernah diimputasi 0** (perlakuan identik
>   dengan lengan `fixed`).
> - `canonical` — DESKRIPTIF saja, tidak ikut gerbang: jendela dari
>   `team_match_logs_canonical` (yang benar-benar dibaca saji hari ini)
>   lewat pemetaan registry; tim tanpa pemetaan kanonik jatuh ke jendela
>   `fixed` (paritas fallback saji).
>
> **Gerbang — adopsi (PASS) hanya bila KETIGANYA terpenuhi:**
> (a) Log-loss pooled (lipatan V2 + H, populasi identik) lengan `combined`
>     tidak lebih buruk dari `fixed` lebih dari **+0,002**:
>     `LL_combined − LL_fixed ≤ +0,002`.
> (b) Slope kalibrasi pooled tidak memburuk lebih dari **0,02** dalam
>     jarak ke 1: `|slope_combined − 1| ≤ |slope_fixed − 1| + 0,02`.
> (c) Manfaat kesegaran NYATA, bukan ~nol. Populasi: (i) fixture slate
>     terakhir (`tasks/pick-slate-latest.json`, tergenerate
>     2026-11-16T05:36Z) dan (ii) fixture `upcoming_fixtures` 20–24 Nov
>     2026 (akhir pekan klub pertama pasca jeda internasional). Sebuah
>     tim-fixture "gain" bila jendela gabungannya (strictly-before
>     kickoff) memuat ≥1 laga bertanggal lebih baru daripada laga terbaru
>     di jendela SM-only-nya (atau jendela SM kosong & gabungan non-kosong).
>     Manfaat dinilai ~nol — dan adopsi DITOLAK berapa pun (a)/(b) — bila
>     gainers < 10 tim-fixture gabungan (i)+(ii), atau gainers < 5% dari
>     tim-fixture populasi (ii).
>
> **Pemetaan verdict ke tindakan** (ditetapkan di muka, mengingat realita
> saji di §1):
> - PASS → penerimaan fd ter-backing OOS. Implementasi = verifikasi
>   ekuivalensi jendela lapisan kanonik live vs definisi `combined` pada
>   sampel tim era-fd + perbaiki divergensi material bila ditemukan +
>   regresi (acceptance engine, slate smoke, tsc) + commit. Jalur fallback
>   SM-only untuk tim di luar registry TIDAK diubah (baris fd tidak bisa
>   diatribusikan ke tim tanpa identitas kanonik).
> - FAIL → NOL perubahan saji. Laporan menyatakan angka penolakan apa
>   adanya, termasuk fakta bahwa saji kanonik live saat ini sudah
>   memasukkan fd (keputusan pakem, tervalidasi snapshot — bukan OOS):
>   divergensi itu menjadi keputusan owner, tidak dibalik diam-diam.

Konfigurasi tetap (identik run referensi): params `hl365|rho:zero|kfit:10`,
blend James-Stein κ×2, populasi = liga registry `league_calibration`
calibrated/partial dengan ≥120 laga selesai `sm:%`, lipatan kronologis
V2 (70–85%) + H (85–100%), V1 dilewati (runtime) — dinyatakan eksplisit
di JSON output.

Angka referensi tercatat (store 2026-11-04, `tasks/telemetry-oos.json`):
`fixed` pooled n=12.409, LL **1,0152**, Brier 0,6078, slope 0,982.
Reproduksi persis TIDAK diharapkan (store tumbuh sejak itu; lipatan %
kronologis per liga bergeser) — perbandingan yang sah adalah antar-lengan
di dalam run yang sama atas populasi identik.

---

## 1 · Konteks & koreksi premis (recon 2026-11-16, terukur)

Brief tugas ini ditulis terhadap bentuk saji pra-pakem ("saji membaca
HANYA `source='sportmonks'`; form membeku"). Recon menemukan keadaan
sebenarnya sudah bergerak lebih jauh:

- **Jalur utama saji hari ini = `team_match_logs_canonical`.**
  `getPreMatchLogs` (`lib/db/team-telemetry.ts`) dan
  `calculateTeamLuckMetrics` (`lib/quant/luck-regression.ts`) membaca
  tabel kanonik lewat registry `data/team-canonical.json` (ACUAN PAKEM
  fase 4–5, 2026-11-05; dibangun ulang di setiap run free-refresh,
  langkah 6). Filter `source='sportmonks'` hanya bertahan sebagai
  **fallback** untuk tim yang tidak dikenal registry.
- **Tabel kanonik sudah memasukkan fd.** Builder
  (`scripts/build-canonical-telemetry.ts`) melebur baris per kunci
  (tanggal|tim kanonik|lawan kanonik|venue) dengan prioritas sumber
  sportmonks > football-data > thestats (NULL) > master; pemenang tanpa
  xG diisi xG-nya dari kembaran terbaik (ditandai `xg_filled_from`);
  konflik skor ditandai `goals_conflict=1`. Tabel kanonik saat recon:
  84.606 baris, maks tanggal **2026-11-09** (= tanggal maks fd; SM berhenti
  2026-11-07).
- **Validasi pakem untuk peralihan itu = snapshot ekuivalensi, BUKAN
  OOS** (`tasks/pakem-phase5-report.md`: sampel form 1.273→1.471 tim;
  1.176/1.273 identik GF/GA; median |Δ|=0,00). Definisi harness secara
  eksplisit TIDAK berubah waktu itu. Jadi pertanyaan OOS tugas ini tetap
  terbuka dan tetap layak dijawab persis dengan gerbang §0.
- **Fakta store saat recon (2026-11-16):**
  - `team_match_logs`: sportmonks 83.426 baris (2024-12-28 → 2026-11-07;
    xG non-null 34.474); **football-data 1.102 baris (2026-08-07 →
    2026-11-09), xG terisi 1.102/1.102** (`xg_source='football-data'`),
    **npxG non-null 0/1.102** (CSV tidak membawa npxG — perlakuan count
    per sisi di §0 menanganinya: sisi npxG fd tidak menambah sampel);
    NULL (TheStats) 2.348; master 75.
  - Baris fd ≥ 2026-11-08: **118 baris / 118 tim berbeda** (akhir pekan
    8–9 Nov); baris SM ≥ 2026-11-08: **0**. Di sinilah kesegaran tinggal.
  - Kembaran eksak SM untuk baris fd (kunci tanggal|lawan|GF|GA yang
    sama): hanya **96/1.102** — sisanya laga yang telemetri SM-nya tidak
    ada (celah cakupan SM) atau sesudah SM berhenti. Dedupe tetap wajib:
    96 tabrakan itu nyata.
  - Seluruh 277 `team_id` fd ada di registry kanonik DAN muncul sebagai
    id tim di `matches` (namespace id SM) → pooling per `team_id` di
    harness sah; 5.450/5.450 `team_id` SM juga terpetakan registry.
  - `match_id` baris fd berbentuk `fd_<DIV>_<tanggal>_<tim>_<tim>` —
    `competition_id`-nya ter-resolve lewat `matches` hanya bila laga
    `fd_` itu ada di store hasil; yang tidak → bobot 1,0 per aturan §0.

## 2 · Metode

- **Harness** `scripts/validate-telemetry-combined.ts`: salinan
  `scripts/validate-telemetry-oos.ts` (fit IPF, shrinkage, blend, metrik,
  populasi, lipatan disalin verbatim) dengan saklar lengan §0. Fit
  dihitung sekali per (liga, lipatan) dan dipakai semua lengan — populasi
  uji identik antar-lengan by construction. Output:
  `tasks/telemetry-combined-oos.json` (memuat evaluasi gerbang (a)+(b)
  yang dihitung script itu sendiri).
- **Diagnostik jendela berbeda** (deskriptif): per laga uji, himpunan
  kunci jendela (tanggal|GF|GA per tim) `combined` dibandingkan dengan
  `fixed`; laga yang salah satu sisinya berbeda dihitung, dan kedua
  lengan dinilai ulang pada subset itu saja. Ini menunjukkan di mana
  fd benar-benar mengubah input — pooled yang menipiskan efek mayoritas
  laga tak-terpengaruh adalah sifat yang sama seperti dicatat laporan
  divergensi §3b.
- **Kesegaran** `scripts/measure-telemetry-freshness.ts` →
  `tasks/telemetry-freshness.json`: tanggal laga terbaru per tim
  strictly-before kickoff, pool SM-only vs pool gabungan, pada populasi
  (i) slate terakhir dan (ii) upcoming 20–24 Nov 2026, dengan ambang
  persis §0(c).
- **Konvensi point-in-time** sama dengan harness tervalidasi: baris log
  diperlakukan diketahui pada cutoff bila `match_date < cutoff`, di kedua
  lengan (baris SM pun historisnya ditangkap massal retrospektif).
  Tidak ada sumber data baru yang bocor ke fit — fit hanya membaca
  `matches`, identik antar-lengan.

## 3 · Hasil OOS (run 2026-11-16; bukti `tasks/telemetry-combined-oos.json`)

Populasi run ini: 63 liga, n pooled **13.391** (store sudah tumbuh sejak
referensi 2026-11-04: 58 liga / n 12.409 — angka absolut bergeser seperti
diperingatkan §0; perbandingan sah = antar-lengan satu run).

Pool gabungan: 1.102 baris fd masuk; **120 tabrakan kunci** ter-resolve,
**96 baris fd terbuang sebagai duplikat baris SM** (SM dipertahankan —
persis hitungan kembaran independen di §1); 1.006 baris fd bertahan di
pool ter-dedupe.

| Lengan | V2 (n=6.683) LL / Brier / slope | H (n=6.708) LL / Brier / slope | Pooled (n=13.391) LL / Brier / slope |
|---|---|---|---|
| fixed (SM-only) | 1,0237 / 0,6139 / 0,925 | 1,0134 / 0,6066 / 1,030 | 1,0185 / 0,6102 / 0,976 |
| **combined (SM ∪ fd)** | 1,0236 / 0,6139 / 0,925 | 1,0137 / 0,6068 / 1,026 | 1,0186 / 0,6103 / 0,974 |
| canonical (deskriptif) | 1,0237 / 0,6139 / 0,925 | 1,0136 / 0,6067 / 1,030 | 1,0186 / 0,6103 / 0,976 |

**Kriteria (a) — LULUS.** ΔLL pooled = **+0,0001** (ambang ≤ +0,002).
Per lipatan: V2 −0,0001 (gabungan sedikit lebih baik), H +0,0003.
**Kriteria (b) — LULUS.** |slope−1|: fixed 0,024 → combined 0,026;
memburuk **0,002** (ambang ≤ 0,02).

**Diagnostik subset berjendela beda** (deskriptif): 638 dari 13.391 laga
uji (4,8%) benar-benar berubah inputnya — V2 hanya 15 (era fd baru mulai
Agustus 2026), H 623. Pada subset itu saja: LL fixed 0,9789 vs combined
0,9814 (Δ +0,0025 — biaya kecil terkonsentrasi persis di laga yang
tersentuh), tetapi slope subset membaik: 1,134 → **1,086** (gabungan
kurang overconfident di laga-laga itu). Di 95,2% laga sisanya kedua
lengan identik, sehingga efek pooled menipis ke +0,0001 — pola yang sama
seperti dicatat laporan divergensi §3b. Lengan `canonical` deskriptif
mendarat di angka pooled yang sama dengan `combined` (LL 1,0186, slope
0,976): definisi yang benar-benar disajikan saji live berperilaku sama
dengan definisi yang lulus gerbang.

## 4 · Kesegaran (kriteria c) — LULUS, manfaat nyata

Bukti `tasks/telemetry-freshness.json` (diukur sebelum harness, sesudah
aturan §0 di-commit):

- **Populasi (i) slate terakhir** (9 fixture rated, 18 tim-fixture):
  **3 gainers (16,7%)**, 1 di antaranya dari jendela SM kosong.
- **Populasi (ii) akhir pekan 20–24 Nov 2026** (528 fixture, 1.056
  tim-fixture): **204 gainers (19,3%)**, 16 dari jendela SM kosong.
- Total gainers **207** (ambang ≥ 10) dan share populasi (ii) **19,3%**
  (ambang ≥ 5%) → manfaat **bukan ~nol**: kira-kira satu dari lima
  jendela form akhir pekan ini memuat laga 8–9 Nov yang tidak akan
  terlihat oleh definisi SM-only (SM berhenti 7 Nov; sesudah itu setiap
  akhir pekan baru menambah jaraknya).

## 5 · Verdict

**PASS — ketiga kriteria pra-terdaftar terpenuhi** ((a) +0,0001 ≤
+0,002; (b) memburuk 0,002 ≤ 0,02; (c) 207 gainers, 19,3% ≥ ambang).
Memasukkan baris football-data ke telemetri saji **tidak menurunkan
akurasi out-of-sample** pada populasi identik, dan membeli kesegaran
form yang terukur. Sesuai pemetaan §0, implementasi berjalan lewat
verifikasi lapisan kanonik live (§6) — bukan penulisan ulang filter,
karena jalur utama saji sudah berbentuk kanonik sejak pakem.

## 6 · Yang diubah / tidak diubah

**Tidak ada perubahan kode saji yang diperlukan — dan tidak ada yang
dibuat.** Jalur utama (`getPreMatchLogs`, `calculateTeamLuckMetrics`)
sudah membaca `team_match_logs_canonical`, yang memuat fd; gerbang ini
memberi backing OOS yang selama ini belum ada untuk penerimaan itu.
Verifikasi ekuivalensi (bukti
`tasks/telemetry-canonical-equivalence.json`, cutoff 2026-11-16,
seluruh 277 tim berbaris fd):

- **232/277 tim: jendela kanonik identik** dengan definisi `combined`
  (kunci tanggal|lawan kanonik|GF|GA); pada yang identik, rata-rata
  GF/GA sama persis (0 mismatch); 2 tim berbeda xG saja — efek
  `xg_filled_from` builder yang terdokumentasi.
- **3/277: ekstra terjelaskan** — kanonik memuat baris fallback
  thestats/master untuk laga tanpa baris SM/fd (sesuai desain builder).
- **42/277: selisih representasi identitas, bukan selisih laga** —
  pemeriksaan contoh menunjukkan dua pola: (1) laga fisik yang sama
  dengan lawan tertulis di namespace anggota berbeda (mis.
  `tm_master_kasimpasa` vs `sm:1071`, tanggal+skor sama); (2) tim
  ber-id `fd_<slug>` yang jendela kanoniknya justru **lebih kaya/baru**
  karena registry melebur log namespace SM mereka (yang tidak terlihat
  pool mentah per-id). Pemeriksaan riwayat penuh (bukan hanya last-6):
  dari **13.305** baris pool gabungan milik tim-tim fd, yang tidak
  ditemukan padanannya (tanggal|GF|GA) di tabel kanonik hanya
  **9 baris (0,07%)** — kesembilannya pada id warisan berkonflasi
  identitas yang sudah dikenal (dua di antaranya `tm_0406`, keluarga
  residual laporan divergensi §6) dan bertanggal ≤ 2026-08-16; tidak
  ada baris dari akhir pekan mana pun sesudah itu yang hilang, dan
  sebaliknya 0 baris fd pilihan kanonik yang berada di luar pool
  per-id. Jendela era-fd yang tersaji utuh.
- **Spot-check fungsi saji asli** (`getTeamRollingTelemetry`, cutoff
  fixture 20 Nov): Magdeburg — jendela 6 laga, laga terbaru **2026-11-08
  dari football-data**; Pau FC — terbaru 2026-11-07, sumber campuran
  fd+SM; Bayern München — terbaru 2026-11-07, sumber campuran. Form
  pasca-Sportmonks hidup lewat jalur saji yang sebenarnya, bukan hanya
  di tabel.

Yang TIDAK diubah, sesuai §0: jalur fallback SM-only untuk tim di luar
registry (baris fd tidak bisa diatribusikan ke tim tanpa identitas
kanonik); definisi harness; tabel asal; builder kanonik. 🔒 tidak
disentuh.

## 7 · Verifikasi & commit

- **Acceptance engine** (`scripts/pick-engine-acceptance.ts`): **PASS,
  tidak berubah** — kedua paket tersimpan mereproduksi semua kuantitas
  dalam toleransi (Δ maks 0,00005 « toleransi 0,0011); kombo Fenerbahçe
  tetap 57,27% vs produk naif 44,89%. (Wajar: tidak ada kode saji yang
  berubah; run ini mengonfirmasi ulang.)
- **Slate smoke** (`pick-slate.ts --limit 5 --no-ledger`): selesai tanpa
  error — 3 rated (paket tertulis), 2 unrated fail-closed dengan alasan
  eksplisit, ledger +0 sesuai flag. File `pick-slate-latest.*` hasil
  smoke dikembalikan ke keadaan commit terakhir (file output ritme,
  diregenerasi cron berikutnya).
- **`npx tsc --noEmit` = 0** pada setiap checkpoint dan pohon final.
- 🔒 **utuh**: tidak ada perubahan di `lib/agent/*`, `lib/coverage.ts`,
  `lib/syndicate-orchestrator.ts`, `lib/llm/*` — pekerjaan ini tidak
  mengubah `lib/` sama sekali. `.env.local` tidak dibuka. Nol panggilan
  API.
- Commit: `57e3948` (pra-registrasi: laporan §0–§2 + harness + pengukur
  kesegaran — sebelum run) · commit bukti+hasil (JSON OOS, JSON
  kesegaran, script+JSON ekuivalensi, acceptance ter-regenerasi, laporan
  final ini).
