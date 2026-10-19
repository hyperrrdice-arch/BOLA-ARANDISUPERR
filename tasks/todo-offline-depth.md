# TODO — Offline Depth (lihat tasks/plan-offline-depth.md)

> Prinsip: data sudah ada → kedalaman baru. Nol API. Konteks dulu, koefisien jangan.

## Task 1: Tambal tim tipis via master (dampak langsung)

**Description:** 51 tim punya <6 log + 226 sel xG kosong bikin shrinkage jatuh ke prior. Tambal dari `football_master.db` (28.922 laga, ada skor/shots/`h_xg`/`a_xg`/HT/Bet365): HANYA tim tipis + sel kosong, via bridge `team-normalizer` (coverage <80% = stop). Tiap baris bertag sumber `master` + tier; COALESCE (data bagus tak tertimpa); skema log tak berubah sehingga pipeline baca apa adanya.

**Acceptance criteria:**
- [x] Bridge coverage per liga tercatat (E0 100%, SP1 91%, I1 100%, F1 87% LANJUT; D1 67%, N1 35%, D2 STOP honoured — 0 baris dari div STOP, diverifikasi head)
- [x] 11 tim sembuh ke 6 log (terverifikasi head: counts 2423, checksum legacy identik, 144 tim sehat utuh, nol duplikat entitas)
- [x] Sel xG 0/226 terisi — jujur struktural (tak ada pasangan di master), bukan bug
- [x] Data lama utuh (2348 legacy source NULL + checksum identik — diverifikasi head independen)

**Catatan head:** thin 51→70 karena 30 stub baru yang tipis by construction — akan gemuk tiap refresh CSV. Micro-follow-up alias terbukti keliru premisnya (stub bukan duplikat) TAPI investigasi menemukan bug asli: DB `Sporting` vs ratings `Sp Lisbon` vs normalizer `Sporting CP` (orphan) → Sporting CP selalu jatuh ke prior. Fix 19 Okt: kanonikal `Sp Lisbon` + repoint orphan + alias `sporting` (Gijon tetap ≠). Bukti: lookup P1 hit attack 2.016/defense 0.646 (178 laga), sebelumnya MISS. Test 62/62 + tsc 0. Sisa: scan mismatch 3-namespace serupa untuk tim lain (pekerjaan lanjutan).

**Verification:**
- [x] `test-master-backfill.ts` 47/47 (dijalankan ulang oleh head: hijau)
- [x] `test-stats-mapper` 19/19 + `test-upcoming-guard` 10/10 hijau · tsc exit 0
- [x] DILARANG git ops dipatuhi (worker: nol git; head: verifikasi tanpa git)

**Dependencies:** None

**Files likely touched:**
- `scripts/backfill-from-master.ts` (baru)
- `lib/quant/team-normalizer.ts` (bila perlu, minimal)
- `lib/db/thestats-dataset.ts` (kolom sumber/tag bila perlu, nullable)

**Estimated scope:** M (2-3 files)

## Task 2: Profil babak 1 vs 2

**Description:** Agregat `first_half/second_half_xg_for/against` per tim (6 laga): label SLOW_STARTER / SECOND_HALF_TEAM / SEIMBANG + selisih. Tampil sebagai baris bukti + konteks prompt. Jujur tier saat sampel tipis.

**Acceptance criteria:**
- [ ] 2 tim contoh diverifikasi manual dari logs
- [ ] Tier INSUFFICIENT_DATA saat <3 log berskor babak
- [ ] Prob/fair tidak berubah (konteks only)

**Verification:**
- [ ] Runnable baru `test-half-profile.ts`
- [ ] tsc + build hijau

**Dependencies:** None

**Files likely touched:**
- `lib/quant/half-profile.ts` (baru)
- `lib/view/analysis-view.ts`, `lib/syndicate-orchestrator.ts`

**Estimated scope:** S

## Task 3: Momentum last-3 vs last-6

**Description:** Delta goals/xG-for last-3 vs last-6 per tim → panah momentum (NAIK/TURUN/DATAR) + magnitude. Baris bukti + konteks prompt, tier jujur.

**Acceptance criteria:**
- [ ] Arah panah benar di 3 contoh (naik/turun/datar)
- [ ] Tidak mengubah prob/fair

**Verification:**
- [ ] Runnable baru `test-momentum.ts`
- [ ] tsc + build hijau

**Dependencies:** None

**Files likely touched:**
- `lib/quant/momentum.ts` (baru)
- `lib/view/analysis-view.ts`, `lib/syndicate-orchestrator.ts`

**Estimated scope:** S

### Checkpoint: Matchup
- [ ] 3 sinyal tampil ringkas + tier jujur · live 1 analisis · tsc+build hijau · review user

## Task 4: Panel kalibrasi Bet365 (read-only)

**Description:** Dari `football_master` (28.922 laga + Bet365): hitung Brier/log-loss model-vs-Bet365 per liga via harness backtest yang ada, tampilkan sebagai panel kalibrasi read-only (internal dulu). Tanpa ubah model.

**Acceptance criteria:**
- [ ] Angka per liga cocok dengan `backtest_report.json` (tidak ada pipeline ganda)
- [ ] Panel jelas: "model vs Bet365", bukan klaim edge
- [ ] Read-only: nol tulis ke DB produksi

**Verification:**
- [ ] Panel vs report: selisih 0 (script banding)
- [ ] tsc + build hijau

**Dependencies:** None

**Files likely touched:**
- `scripts/calibration-panel.ts` (baru, baca report + master)
- `components/dashboard/CalibrationPanel.tsx` (baru, terlipat default)

**Estimated scope:** M (2 files)

## Task 5: Profil first-half dari master (bridge terukur)

**Description:** Agregat HT (hthg/htag/htr) per tim dari master → kecenderungan babak-1 (unggul/imbang/tertinggal di HT). WAJIB ukur bridge `team-normalizer` master↔tm_* dulu; coverage <80% per liga = stop + dokumentasi, bukan imputasi.

**Acceptance criteria:**
- [ ] Laporan coverage bridge per liga tercatat (≥80% lanjut, <80% stop)
- [ ] Profil 3 tim cocok hitungan manual dari master
- [ ] Konteks only, tier jujur

**Verification:**
- [ ] `test-ht-bridge.ts`: coverage + 3 contoh
- [ ] tsc + build hijau

**Dependencies:** Task 2 (pola profil babak sudah ada)

**Files likely touched:**
- `scripts/ht-bridge-report.ts` (baru)
- `lib/quant/half-profile.ts` (extend, bila bridge lolos)

**Estimated scope:** S-M

### Checkpoint: Market
- [ ] Panel kalibrasi tampil · bridge lolos/gagal terdokumentasi · backtest tidak regresi · review user

## Task 6: Laporan kalibrasi bulanan otomatis

**Description:** Perluas `snapshot-report.ts`: agregat Brier/log-loss/P-L per market + data kurva kalibrasi → feed UI honesty panel ("model kami vs pasar, jujur"). Read-only, tanpa auto-refit (refit = keputusan manusia, preseden quant-refit).

**Acceptance criteria:**
- [ ] Output report mencakup per-market Brier + P-L unit
- [ ] Panel UI render dari output report (statis, tanpa query live)
- [ ] Nol auto-refit, nol tulis tak disengaja

**Verification:**
- [ ] `npm run report:snapshot` hijau + panel tampil
- [ ] tsc + build hijau

**Dependencies:** Task 4 (pola panel kalibrasi)

**Files likely touched:**
- `scripts/snapshot-report.ts` (extend)
- `components/dashboard/CalibrationPanel.tsx` (extend)

**Estimated scope:** M

### Checkpoint: Final
- [ ] Semua acceptance hijau · live 1 analisis pamer fitur baru · siap jualan track record · review user
