# Laporan Validasi Lengan Telemetri Gabungan (SM ∪ football-data) — Level B OOS

Tanggal: 2026-11-16 · Branch `master` · Status: **ATURAN PRA-TERDAFTAR DITULIS & DI-COMMIT SEBELUM HARNESS DIJALANKAN — hasil di §5 ke bawah diisi sesudah run**

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

## 3 · Hasil OOS

_(diisi sesudah run)_

## 4 · Kesegaran (kriteria c)

_(diisi sesudah run)_

## 5 · Verdict

_(diisi sesudah run)_

## 6 · Yang diubah / tidak diubah

_(diisi sesudah run)_

## 7 · Verifikasi & commit

_(diisi sesudah run)_
