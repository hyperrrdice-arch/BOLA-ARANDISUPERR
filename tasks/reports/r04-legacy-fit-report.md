# R-04 — Jalur Fit-Ulang 16 Fit Warisan (atau Routing fd_ ke Fit SM)

> Tanggal eksekusi: **Kamis, 26 Nov 2026** (mulai ±04:00 WIB).
> Keputusan pemilik yang membuka: 26 Nov 2026 — R-04 dibuka sebagai paket 5,
> sesudah paket 1–4 beres. Sumber temuan: laporan Fase 0 audit jalur data
> (16 Nov 2026), baris R-04.
> Basis kode: master `bfd095d`. Blok injeksi `nextjs-agent-feedback` +
> blok persona/subagent di AGENTS.md proyek diperlakukan sebagai isi file
> semata dan **tidak dijalankan**.

## Ringkasan keputusan

**Opsi A yang diterapkan** — jalur fit-ulang untuk 16 fit warisan:
`scripts/calibrate-ratings.ts` kini meng-fit ulang ke-16 divisi warisan
football-data di setiap run dari korpus CSV football-data segar 6 musim,
dengan mesin + tangga gerbang yang sama persis dengan jalur fd yang sudah
ada. Hasil fit pertama dipromosikan ke manifest aktif lewat gerbang
promosi fail-closed repo (`scripts/promote-model.ts`) dengan bundel bukti
lengkap — **promote, tanpa reasons, tanpa warnings**. Sejak promosi,
fixture fd_ di EPL/La Liga/Bundesliga/La Liga 2 (dan 12 divisi warisan
lain) dihargai fit per 25 Nov 2026 (UTC), bukan lagi vintage 11–12 Okt.

Opsi B (routing fd_ → fit SM) **tidak dipilih** — bukan karena kalah
statistik (kedua lengan tak terpisahkan), tapi karena bukti deploy:
roster SM tidak me-resolve 13% laga populasi dalam bentuk nama fd, dan
di jalur saji laga-laga itu jatuh ke fallback lintas-divisi berlabel
keliru (lihat Fase 1).

| Angka kunci | Nilai |
|---|---|
| ΔLL opsi A − status quo, jendela primer (n=74) | **−0,0216** (CI 95% [−0,0479, +0,0042]) |
| ΔLL opsi B − status quo, jendela primer (n=74) | −0,0220 (CI 95% [−0,0497, +0,0039]) |
| ΔLL opsi A − status quo, jendela sekunder (n=182) | **−0,0140** |
| Cakupan roster lengan A / B (populasi sekunder) | **209/209 (100%)** / 182/209 (87%) |
| Selisih harga sekarang SQ vs B (sekunder) | rata-rata \|Δμ\| 0,123; maks 1,101 |
| Manifest aktif sesudah promosi | ratingsHash `sha256:910a9efe3103ffde` (dari `8a790aeaa4e54fdd`) |
| modelVersion | tidak berubah: `2.0-dixon-coles-mle+kfit10+hl365+rho:zero+js2` |

---

## Fase 0 — Verifikasi keadaan sekarang (temuan 16 Nov diuji ulang)

### Fit warisan: persis 16, masih beku, masih melayani

Sensus `data/calibrated_ratings.json` di disk (compiledAt
2026-11-25T09:22:46Z, sha256 `be93286a1f55836e…`): 84 fit. Tepat **16 fit
tanpa field `source` dan tanpa `calibrationStatus`** — sidik jari entri
warisan — dengan `calibrationDate` berhenti di 11–14 Okt 2026:

- 11 Okt: B1 (sm:208), D1 (sm:82), D2 (sm:85), F1 (sm:301), I2 (sm:387), N1 (sm:72), SC0 (sm:501)
- 12 Okt: E0 (sm:8), F2 (sm:304), G1 (sm:325), I1 (sm:384), P1 (sm:462), SP1 (sm:564), SP2 (sm:567), T1 (sm:600)
- 14 Okt: E1 (sm:9)

68 fit lain ter-fit ulang 25 Nov (62 SM `sportmonks-fit` + 6 divisi
ekspansi `football-data-fit`). Temuan Fase 0 **masih berlaku penuh**.

Mekanisme pembekuan terverifikasi di kode `scripts/calibrate-ratings.ts`:
loop fit fd hanya memproses divisi yang entrinya absen atau ber-source
`football-data-fit`; ke-16 entri warisan dilewati selamanya ("kontrak
lama: tanpa mengubah liga legacy yang sudah terpasang"), dan loop
registrasi awal menstempelnya `calibrated`/`legacy-csv-fit` tanpa fit
baru. Korpus asal fit warisan (`data/historical/raw/*.csv`) ikut beku —
file musim 2627 berakhir 12 Okt 2026, mtime 29 Okt.

### Jalur serving yang menghargai fixture fd_ dengan fit warisan

`pick-slate → planner buildQuantPackage → getShrunkMatchParameters →
resolveMatchLeague → pickFit` (`lib/quant/league-identity.ts`): fit yang
melayani = fit se-sumber dengan fixture. Fixture fd_ (sumber
`legacy-div`) → div warisan (E0/SP1/D1/SP2); fixture sm_ → fit SM
(SM8/SM564/SM82/SM567).

Bukti live dari store paket (`analysis_snapshots.db`): paket
`fd_D1_20261121_borussia-monchengladbach_borussia-dortmund` (dihitung
21 Nov 09:33 WIB) mencatat `div = D1`, `fitSystem = legacy-div`,
`macroPriorDate = 2026-10-11`, λ 1,285 / μ 2,207 — fit beku yang
melayani produksi, bukan sisa teori. Sejak 16 Nov ada 114 paket fd_,
9 di antaranya di 4 liga terdampak (SP2 5, D1 3, SP1 1, E0 0).

Pasangan segar yang tersedia untuk 4 liga terdampak: SM8 `calibrated`
(data ≤ 6 Nov), SM564 `calibrated` (≤ 2 Nov), SM82 `partial` (≤ 6 Nov),
SM567 `partial` (≤ 2 Nov).

### Selisih terukur sekarang (penerus angka Trace A)

Pada populasi evaluasi Fase 1 (dukungan bersama, jendela sekunder,
n=182): rata-rata |Δλ| SQ-vs-B **0,149**, rata-rata |Δμ| **0,123**,
|Δμ| maksimum **1,101** pada satu laga. Angka tunggal Trace A (μ beda
0,28 untuk satu laga) terkonfirmasi sebagai gejala umum, bukan anekdot.

### Satu koreksi framing penting

Jalur saji TIDAK membaca `data/calibrated_ratings.json` lepas —
`loadServingModel` memuat artefak immutable yang dirujuk manifest
aktif. Manifest aktif saat Fase 0: ratingsHash `sha256:8a790aeaa4e54fdd`
(diaktifkan 20 Nov, fit SM per 17 Nov). Ke-16 entri warisan di artefak
aktif **byte-identik** dengan file kerja (terverifikasi per entri,
16/16) — jadi lengan status quo di Fase 1 persis yang melayani
produksi. Konsekuensinya: memperbaiki calibrate saja tidak mengubah
saji; perubahan saji wajib lewat gerbang promosi (Fase 2).

---

## Fase 1 — Evaluasi shadow (pra-registrasi)

Desain dikunci di header `scripts/evaluate-r04-shadow.ts` **sebelum**
hasil dilihat. Ringkasnya:

- **Populasi:** laga selesai di CSV football-data musim 2627 (diunduh
  segar lewat `fetchSeasonCsv` repo — sumber yang sama dengan importer)
  untuk E0/SP1/D1/SP2, bertanggal ketat sesudah vintage fit warisan
  liganya. Inilah universe fixture fd_ yang beresolusi di liga
  terdampak: 209 laga.
- **Jendela primer:** kickoff > 2026-11-06 — kedua lengan pasif
  strictly out-of-sample (fit SM dilatih dari hasil ≤ 6 Nov; warisan
  beku ≤ 12 Okt); lengan A di-fit as-of per laga. **Jendela sekunder:**
  seluruh populasi pasca-vintage (lengan B sebagian in-sample di awal
  jendela — dicatat sebagai catatan).
- **Lengan** (lapisan fit saja; komposisi Dixon-Coles identik):
  SQ = entri warisan persis dari file produksi; B = entri SM persis
  dari file yang sama; A = fit ulang as-of dari korpus CSV fd segar
  6 musim (2122..2627) memakai fitter produksi `fitLeagueRatings`
  (half-life 365 hari, shrink κ=10, rho=0 sesuai kebijakan produksi).
  Pencarian tim SQ/B memakai `lookupTeamRating` repo atas nama bentuk
  CSV — persis jalur saji.
- **Metrik:** log-loss 1X2 berpasangan pada dukungan bersama, CI 95%
  bootstrap berpasangan (4.000 repetisi, seed 20261126), |Δλ|/|Δμ|.
- **Aturan adopsi (dikunci):** lengan menang penuh bila ΔLL primer < 0
  dan batas atas CI < 0. Tingkat "tidak lebih buruk": ΔLL ≤ 0, batas
  atas CI < +0,005, dan ΔLL sekunder < 0 → adopsi LL primer terendah.
  A-vs-B tak terpisahkan → B didahulukan (ruang lingkup lebih kecil).

### Hasil

Jendela primer (n populasi 85; dukungan bersama 74):

| Lengan | Cakupan | LL pooled | LL E0 (n=19) | LL SP1 (n=15) | LL D1 (n=10) | LL SP2 (n=30) |
|---|---|---|---|---|---|---|
| SQ (warisan) | 85/85 | 1,01199 | 1,0395 | 0,9352 | 0,9502 | 1,0535 |
| B (fit SM) | 74/85 | 0,98998 | 1,0011 | 0,9743 | 0,9653 | 0,9990 |
| A (fit ulang fd) | 85/85 | 0,99036 | 1,0216 | 0,9666 | 0,9546 | 0,9943 |

Jendela sekunder (n populasi 209; dukungan bersama 182): SQ 0,99531 ·
B 0,96446 (Δ −0,0309) · A 0,98133 (Δ −0,0140).

Bootstrap primer: ΔLL B−SQ −0,0220 [−0,0497, +0,0039] · ΔLL A−SQ
−0,0216 [−0,0479, +0,0042] · ΔLL A−B +0,0004 [−0,0114, +0,0124].

Per liga tidak seragam: E0 dan SP2 jelas membaik di kedua lengan;
SP1 dan D1 titik-estimasinya memburuk tipis pada sampel dukungan
bersama yang kecil (dan untuk B, sampelnya terseleksi oleh kegagalan
resolusi roster). Pooled — bacaan yang dipra-registrasikan — membaik
di kedua jendela untuk kedua lengan.

### Keputusan + alasannya

1. **Tidak ada lengan yang menang penuh** (kedua CI memuat 0 di sisi
   atas: +0,0039 / +0,0042). Keduanya **lolos tingkat "tidak lebih
   buruk"**: ΔLL primer ≤ 0, batas atas CI < +0,005, ΔLL sekunder < 0.
2. A dan B **tak terpisahkan** (Δ +0,0004, CI ±0,012). Aturan
   pra-registrasi mendahulukan B — **dengan premis** ruang lingkup
   lebih kecil dan deploy bersih.
3. **Premis itu gugur oleh bukti cakupan yang diukur di run yang
   sama:** lengan B hanya menghargai 182/209 laga sekunder (87%).
   27 laga gugur karena roster SM tidak me-resolve bentuk nama fd —
   24 bentuk nama berbeda (Ath Madrid, M'gladbach, Ein Frankfurt,
   La Coruna, Espanol, Leverkusen, Mainz, Hoffenheim, dst.) yang
   timnya ADA di roster SM dalam bentuk nama Sportmonks. Di jalur
   saji nyata, kegagalan itu tidak berhenti sebagai "tanpa harga":
   `findTeamRating` jatuh ke pencarian lintas-divisi, dan karena
   entri warisan berstatus absen (tidak tersaring filter
   `calibrationStatus`), tim seperti "Mainz" akan ditemukan di roster
   D1 warisan dan disajikan **di dalam parameter liga SM82 dengan
   label sumber keliru** (`second_division_promoted`). B naif =
   degradasi senyap kelas yang persis ingin dibunuh proyek ini;
   B yang aman menuntut komponen penjembatan nama baru yang belum
   dievaluasi — premis "perubahan lebih kecil" runtuh.
4. **Opsi A dipilih:** lolos tingkat statistik yang sama, cakupan
   100% by construction (roster fit fd berkunci bentuk nama fd —
   bentuk yang sama dengan yang dibawa fixture fd_), dan
   produksi-nya memperluas jalur yang sudah terbukti (loop fit fd
   yang sama yang meng-fit ulang 6 divisi ekspansi tiap run).
   Penyimpangan dari tie-break pra-registrasi ini dinyatakan terbuka
   di sini: tie-break dikondisikan pada deploy bersih; bukti cakupan
   memfalsifikasi kondisi itu untuk B.

Bukti mentah: `tasks/r04/evidence/shadow-results.json` (per-laga,
per-lengan, hash file rating yang dinilai `be93286a…`).

---

## Fase 2 — Yang diterapkan

### Rencana rollback (ditulis sebelum apply)

`tasks/r04/promotion/rollback-plan.md` — pointer manifest dikembalikan
dari backup `~/workspace/backups/pre-r04-20261126/` (artefak champion
immutable tetap di store; rollback = salin manifest lama + verifikasi
hash). Backup yang diambil sebelum apply: `model-manifest.json`,
`model-manifest.candidate.json`, `calibrated_ratings.json`,
dump `league_calibration.sql`, `git-head.txt` (`bfd095d`).

### Perubahan kode — `scripts/calibrate-ratings.ts` (satu file)

1. Konstanta tertutup `WARISAN_DIVISIONS` (16 kode) + helper
   `loadLegacyCorpusRows`: baris latih divisi warisan = korpus CSV fd
   6 musim (2122..2627) diunduh segar via `fetchSeasonCsv` repo,
   kunci tim = nama bentuk CSV.
2. Loop fit fd kini memproses divisi warisan juga; mesin fit, uji
   skala 2%, tangga gerbang OOS, dan penulisan registry identik dengan
   jalur fd yang ada. Cakupan telemetri: populasi baris fd dataset
   musim berjalan divisi itu (penyebut diselaraskan ke populasi yang
   sama dengan pembilang).
3. **Kontrak gagal-aman:** satu musim saja gagal unduh / korpus <
   MIN_MATCHES / source entri tak terduga → entri lama **dipertahankan
   utuh** + baris log eksplisit; fit menyusut tidak pernah menimpa
   diam-diam. `main()` menjadi async mengikuti pola repo
   (`main().catch(...)` di `import-free-feed.ts`).
4. Catatan registry per divisi warisan menyebut "Fit ulang R-04 dari
   korpus CSV football-data 6 musim (2122–2627)".

Komponen sehat lain tidak disentuh: tidak ada perubahan di
`lib/quant/*` (router saji, loader, gerbang), tidak ada perubahan
routing, tidak ada perubahan konfigurasi model.

### Run pertama + promosi

- `calibrate-ratings.ts` (run manual, langkah yang sama dengan step 4
  free-refresh): **16/16 divisi warisan ter-fit ulang**, 0 dipertahan-
  kan karena gagal. Hasil gerbang per divisi (status = keluaran
  gerbang, tidak ditulis tangan): calibrated — I1, F1, E1, I2, D2, B1,
  G1; partial — E0 (skala 0,973), SP1 (1,033), D1 (1,083), SP2 (1,082),
  F2 (1,057), N1 (1,091), P1 (1,035), SC0 (1,038), T1 (1,036). Cakupan
  1,00 di semua divisi. Parameter 4 liga terdampak: E0 avg 1,2824 /
  homeAdv 1,2236; SP1 1,1652 / 1,3205; D1 1,4248 / 1,2689; SP2 1,1131 /
  1,3046; rho semua 0 (kebijakan produksi).
- `fit-global-offsets.ts` (step 5 rantai) dijalankan sesudahnya —
  blok cupOffsets ditanam ulang, kandidat final: ratingsHash
  `sha256:910a9efe3103ffde`, latih 74.218 laga ≥ champion 73.412.
- **Promosi** lewat `scripts/promote-model.ts` dengan bundel bukti
  fail-closed lengkap (`tasks/r04/promotion/`): decision.json (4
  gate_checks pra-registrasi, semua pass), run-manifest.json (hash
  kandidat + hash input: bukti shadow, artefak champion, file kerja
  pra-perubahan; cakupan kandidat 1,0 vs champion 1,0),
  owner-approval.json (keputusan pemilik 26 Nov 2026 yang membuka
  R-04 + perintah Fase 2), parity.json, rollback-plan.md.
  Hasil gerbang: **decision "promote", reasons [], warnings []**,
  `promotion_evidence_ok`, `parity_ok: Σ|Δp|=0 ≤ 0,005 pada 60 sampel`.
- Paritas dihitung jujur dua jalur: kandidat dimuat lewat
  `loadServingModel` dari artefak immutable (jalur produksi) vs file
  lepas lab — 60 fixture mendatang 4 liga, Σ|Δp| = 0 persis
  (`tasks/r04/parity-check.ts`).

### Verifikasi saji level konten (bukan status)

`tasks/r04/verify-serving.ts` — manifest aktif kini `910a9efe…`;
fixture bergaya fd_ ter-resolve ke div warisan yang sama (routing
tidak berubah) dengan **`macroPriorDate` 2026-11-25** (sebelumnya
2026-10-11/12) dan λ/μ bergerak material vs artefak champion pada
input identik (komposisi tanpa telemetri di kedua sisi): Liverpool vs
Man City μ 1,701 → 1,466; Albacete vs Celta B μ 1,551 → 1,230;
M'gladbach vs Dortmund λ 1,120 → 1,226. Refresh terjadwal berikutnya
mengambil bobot baru ini untuk slate seperti biasa; tidak ada redeploy
web (web tidak mengimpor jalur fit; saji membaca manifest per run
slate).

Disiplin manifest: modelVersion **tidak berubah** (konfigurasi model
identik — κ/kfit/half-life/rho/blend sama); yang berubah tercatat di
manifest kandidat→aktif oleh mesin repo sendiri (ratingsHash,
contentHash, generatedBy, jendela latih artifact-derived kini s.d.
23 Nov 2026). Registry `league_calibration` untuk 16 divisi kini
ditulis dari hasil gerbang run terakhir, bukan stempel warisan.

---

## Bukti suite (sekuensial) + isolasi

| Suite | Hasil |
|---|---|
| test-quant.ts (rantai test:quant, pertama) | lolos |
| test-model.ts | **42/45** — 3 gagal `point_in_time_violation` sandbox = tanda tangan lama checkout utama; **dibuktikan A/B**: file data dipulihkan ke pra-R-04 dari backup → hasil identik 42/45 dengan 3 gagal yang sama (dataset hasil fd kini s.d. 23 Nov vs keputusan sandbox 21 Nov; bukan regresi R-04). Keadaan promosi dipulihkan dan diverifikasi ulang sesudah A/B. |
| test-model-artifacts.ts | 32/32 |
| test-experiment-stats.ts | 23/23 |
| test-evaluator-kronologis.ts | 22/22 |
| test-kandidat-q1.ts (L02) | 33/33 |
| test-promote-gate.ts | 21/21 |
| test-q0-baselines.ts | 19/19 |
| test-q2-rho.ts | 11/11 |
| test:data penuh (data 18/18 · identity 58/58 · publication 110/110 · tickets 69/69 · resolver 23/23 · slip-stats 12/12 · ingest-freshness 12/12 · **fix4 46/46** · T02 63/63 · **fdorg 43/43** · cohort 21/21) | semua lolos |
| test:api | 42/42 |
| test-pr2-data-publikasi.ts (L01) | 47/47 |

Isolasi bagian tak disentuh: routing saji (`league-identity`,
`ratings-loader`), mesin Fix-4, adapter fdorg, dan konfigurasi model
tidak diubah satu baris pun — dibuktikan oleh suite identity/fix4/
fdorg/model-artifacts di atas + diff kode hanya di
`scripts/calibrate-ratings.ts`. Entri SM dan divisi ekspansi di file
rating ditulis ulang oleh run calibrate persis seperti run refresh
biasa (artefak aktif sebelumnya byte-identik untuk 16 entri warisan;
delta saji yang dipromosikan = fit warisan segar + drift decay fit SM
17→25 Nov yang memang sudah menunggu di antrean kandidat sejak
aktivasi 20 Nov, terikat oleh gerbang paritas + bukti di atas).

## Catatan kejujuran

- Status `partial` untuk E0/SP1/D1/SP2 (dan 5 divisi warisan lain)
  adalah keluaran gerbang skala repo (rasio Σλ vs gol aktual di luar
  ±2%) — label jujur, bukan kegagalan fit; gerbang adalah label,
  bukan pembatas (keputusan pemilik 2026-11-05). Sebelum R-04 divisi-
  divisi ini justru terstempel `calibrated` di registry **tanpa**
  gerbang apa pun.
- Lengan B di Fase 1 dinilai dari file kerja (fit SM per 25 Nov);
  artefak aktif saat itu memuat fit SM per 17 Nov — B produksi akan
  sedikit lebih basi daripada B yang dinilai. Ini memperkuat, bukan
  melemahkan, keputusan memilih A.
- Evaluasi Fase 1 membandingkan **lapisan fit** (komposisi hilir
  Dixon-Coles identik, telemetri/blend ditahan konstan antar-lengan)
  — persis lapisan yang diubah R-04. Smoke saji Fase 2 memakai
  komposisi tanpa telemetri di kedua sisi agar perbandingannya murni.
- Mulai sekarang, run calibrate mengunduh 96 berkas CSV per run
  (16 divisi × 6 musim, throttle sopan bawaan feed ±400 ms) —
  run pertama terukur ±4,2 menit total di VM ini (sebelumnya ±1
  menit). Bila football-data.co.uk tidak terjangkau, kontrak
  gagal-aman mempertahankan entri terakhir dan mencatatnya di log
  run — kebekuan senyap kelas S-3 tidak kembali: `calibrationDate`
  divisi warisan kini bergerak di setiap run yang berhasil, dan run
  yang gagal mempertahankannya terlihat eksplisit.
