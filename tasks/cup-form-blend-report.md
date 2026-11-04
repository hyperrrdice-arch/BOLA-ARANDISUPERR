# Laporan Fase C — Form Blend Jalur Piala (Uji di Belakang Gerbang OOS)

Tanggal: 2026-11-05 · Fase: C dari plan safe-bet parlay (branch `safe-bet-parlay`) · Status: **SELESAI — varian DITOLAK oleh gerbang pra-terdaftar; jalur saji piala tetap buta-form by evidence**

Ringkasan satu kalimat: blend telemetri last-6 ala Level B domestik
(κ×2 = 16/28/32) di atas prior offset δ memang **menurunkan log-loss
pooled** (−0,0113), tetapi **memperburuk slope kalibrasi** dan
**menggerus kejujuran pita probabilitas tinggi** — dua dari tiga kriteria
adopsi pra-terdaftar gagal, jadi blend **tidak diadopsi**; yang mendarat
dari fase ini hanya harness + bukti + laporan ini, kode saji tidak berubah
satu baris pun.

---

## 1. Masalah yang diuji

Di jalur saji piala, telemetri last-6 hanya konteks: probabilitas berasal
murni dari att/def domestik yang ditransformasi offset δ
(`observed_xg_samples` 0/0, `macro_prior_only`), tidak seperti jalur
domestik yang mem-blend form saat penyajian. Konsekuensi terukur di run
live Fenerbahçe vs Liverpool: model tidak bisa "melihat" form terkini
kedua tim. Fase C menguji apakah blend form pantas diadopsi — di belakang
disiplin gerbang yang sama seperti fase piala: **aturan diputuskan
sebelum hasil dilihat; hasil negatif adalah keluaran yang sah**
(preseden: rho tetap 0 di overhaul domestik).

## 2. Desain varian (persis yang diuji)

- **Prior** = parameter jalur offset saat ini: att·e^δ, def·e^−δ dari fit
  domestik (di harness: fit lipatan walk-forward; δ, G, HA dari fit
  offset lipatan — tanpa kebocoran parameter produksi).
- **Live** = telemetri rolling last-6 per tim dari `team_match_logs`
  (`source='sportmonks'`, xG tertimbang rasio rata-rata kompetisi dengan
  target = kompetisi piala laga itu, cutoff tanggal laga strictly-before)
  — semantik dicerminkan persis dari cerminan lab di
  `scripts/parlay-lab.ts` (`rollingTelem`/`formGoals`/`blendInput`/
  `lamMuFromBlend`), yang mencerminkan blend produksi
  `lib/quant/ratings-loader.ts`:
  - sampel xG ≥ 3 → live att/def dari xG rolling, n = sampel xG, κ = 16;
  - sampel ≥ 1 → live dari gol rolling, κ = 28;
  - tanpa telemetri → fallback form-gol (live def dari live att form
    lawan), κ = 32.
  - `w = n/(n+κ)`; blended = clamp(round3(w·live + (1−w)·prior)) dengan
    clamp yang sama seperti produksi (attH/defH/defA ≥ 0,5; attA ≥ 0,4).
- **λ/μ** dari parameter hasil blend dengan G dan HA piala graf;
  Dixon-Coles rho = 0 — satu-satunya perubahan dari jalur offset adalah
  att/def yang masuk.
- Inti blend bersama (murni, tanpa DB): `lib/quant/cup-form-blend.ts`
  (`blendCupTeam`/`blendCupMatch`/`cupLamMu`). Harness:
  `scripts/backtest-cup-form-blend.ts` — mencerminkan
  `scripts/backtest-cup-offsets.ts`; lengan offset-only memakai
  `predictMatch` yang ada; lengan blend menilai **populasi ter-rate yang
  identik** (blend hanya dihitung bila prediksi offset ada; ditegaskan
  lewat assertion di output).
- Konfigurasi yang diuji = konfigurasi produksi κ×2. **Tidak ada varian
  κ alternatif yang diuji untuk adopsi** — mengutak-atik κ sesudah melihat
  hasil akan melanggar pra-registrasi; varian semacam itu butuh protokol
  validasinya sendiri (keputusan owner, §8).

**Aturan adopsi pra-terdaftar** (tertulis di header harness + JSON
sebelum hasil ada): adopsi HANYA bila (i) log-loss pooled held-out blend
< offset-only; (ii) slope kalibrasi pooled tidak memburuk:
|slope_blend − 1| ≤ |slope_offset − 1|; (iii) kejujuran pita tinggi tidak
menurun secara keseluruhan: gap (hitRate − meanProb) tertimbang-n atas
semua kandidat matriks berprobabilitas ≥ 0,55 dari blend ≥ offset-only.

## 3. Gerbang sanity reproduksi — lolos pada substansi, satu pelanggaran toleransi tercatat

Lengan offset-only harness wajib mereproduksi `tasks/cup-oos.json`
(referensi digenerate 2026-11-04T11:47Z):

| Pemeriksaan | Hasil |
|---|---|
| nTest per kompetisi (17) | **identik semua** |
| nRated per kompetisi | **eksak semua** (total 1.536 = 1.536) |
| Cakupan per kompetisi | **eksak semua** |
| Log-loss per kompetisi | **eksak (selisih 0,0000) di 16 dari 17** |
| Pengecualian: sm:78 KNVB Beker | mine **1,0933** vs referensi **1,0957** — selisih **0,0024**, melampaui toleransi ±0,002 sebesar **0,0004** (nRated tetap eksak 31/31) |

Determinisme harness terverifikasi (dua run penuh bit-identik kecuali
timestamp; runtime ±34–39 dtk). Penilaian koordinator fase: pelanggaran
0,0004 pada satu kompetisi domestik bern kecil (n=31) konsisten dengan
drift sisi-LATIH store sejak referensi dibuat (store bertumbuh tiap run
daily-refresh; populasi UJI terbukti identik), bukan divergensi kode —
kode yang sama mereproduksi 16 kompetisi lain secara eksak termasuk
ketiga kompetisi kontinental. Yang lebih menentukan: **keputusan fase
tidak bergantung pada angka absolut lengan offset terhadap referensi** —
ketiga kriteria adopsi membandingkan blend vs offset di dalam run yang
sama atas populasi yang identik (assertion lolos), dan kriteria (ii) +
(iii) gagal dengan margin jauh di atas 0,0004. File bukti tetap
menyimpan `reproductionCheck.pass = false` apa adanya; caveat ini
dicatat, bukan disapu.

## 4. Hasil OOS — pooled (populasi identik, n = 1.536 laga ter-rate)

| Lengan | Log-loss | Brier | Slope kalibrasi |
|---|---|---|---|
| Naive (base rate kompetisi) | 1,0321 | 0,6220 | 1,066 |
| Offset-only (produksi saat ini) | 0,9657 | 0,5699 | 1,044 |
| **Form blend (varian)** | **0,9544** | **0,5654** | **1,100** |

### Kriteria adopsi, satu per satu

- **(i) Log-loss: LULUS.** Blend 0,9544 < offset 0,9657 (Δ −0,0113).
  Blend memperbaiki LL di 14 dari 17 kompetisi.
- **(ii) Slope kalibrasi: GAGAL.** |1,100 − 1| = 0,100 > |1,044 − 1| =
  0,044. Blend mendorong probabilitas menjauhi kalibrasi — model menjadi
  lebih overconfident secara sistematis.
- **(iii) Kejujuran pita tinggi: GAGAL.** Kandidat ≥ 0,55 pooled:
  offset gap **−0,0134** (n = 11.901; klaim rerata 0,7198, hit 0,7064)
  vs blend gap **−0,0356** (n = 12.184; klaim rerata 0,7341, hit 0,6985).
  Blend menaikkan klaim probabilitas pita tinggi tanpa hit yang
  mengimbangi — persis sifat yang paling berbahaya bagi produk parlay.

**VERDICT: REJECT.** Jalur saji piala tetap offset-only (buta-form).
`lib/quant/global-offsets.ts` dan `lib/quant/ratings-loader.ts` TIDAK
diubah; irisan piala parlay lab tidak diregenerasi (tidak ada perubahan
jalur saji yang perlu dicerminkan); acceptance engine Fase B tidak
perlu di-run ulang karena tidak ada perilaku saji yang berubah.

## 5. Hasil per kompetisi (log-loss; Δ = blend − offset)

| Kompetisi | n ter-rate | Offset | Blend | Naive | Δ |
|---|---|---|---|---|---|
| sm:2 Champions League | 238 | 0,9825 | 0,9764 | 1,0399 | −0,0061 |
| sm:5 Europa League | 264 | 0,9912 | 0,9748 | 1,0455 | −0,0164 |
| sm:2286 Conference League | 188 | 0,9956 | 1,0037 | 1,0788 | **+0,0081** |
| sm:24 FA Cup | 79 | 0,8511 | 0,8137 | 0,9689 | −0,0374 |
| sm:27 Carabao Cup | 136 | 0,8074 | 0,7917 | 0,9741 | −0,0157 |
| sm:307 Coupe de France | 22 | 0,9625 | 0,9216 | 1,1028 | −0,0409 |
| sm:468 Taça de Portugal | 16 | 0,9548 | 0,9262 | 1,0043 | −0,0286 |
| sm:78 KNVB Beker | 31 | 1,0933 | 1,0291 | 0,9418 | −0,0642 |
| sm:570 Copa del Rey | 29 | 1,0107 | 0,9839 | 1,0353 | −0,0268 |
| sm:109 DFB Pokal | 44 | 0,7724 | 0,7471 | 0,9632 | −0,0253 |
| sm:390 Coppa Italia | 43 | 0,7042 | 0,7026 | 0,7584 | −0,0016 |
| sm:1122 Libertadores | 114 | 1,0885 | 1,0808 | 1,0690 | −0,0077 |
| sm:1116 Sudamericana | 132 | 1,1012 | 1,0891 | 1,0771 | −0,0121 |
| sm:654 Copa do Brasil | 84 | 0,9744 | 0,9655 | 1,0818 | −0,0089 |
| sm:1085 ACL Elite | 84 | 1,0109 | 1,0043 | 1,0501 | −0,0066 |
| sm:1088 ACL Two | 13 | 0,8422 | 0,8961 | 1,1112 | **+0,0539** |
| sm:950 Kings Cup | 19 | 0,6587 | 0,6791 | 0,9402 | **+0,0204** |

Catatan: perbaikan LL terbesar justru di kompetisi bern kecil dan di
KNVB (yang tetap kalah dari naive di kedua lengan: 1,0291 vs 0,9418 —
blend tidak menyelamatkan kompetisi yang memang kalah). Tiga kompetisi
yang memburuk (UECL, ACL Two, Kings Cup) semuanya bern tipis atau
bercakupan rendah.

## 6. Kejujuran pita tinggi — pooled per pita (semua pasar)

| Pita | Offset: n · gap | Blend: n · gap |
|---|---|---|
| 55–60 | 1.798 · **+0,0114** | 1.566 · −0,0353 |
| 60–65 | 1.748 · −0,0166 | 1.591 · −0,0250 |
| 65–70 | 1.749 · −0,0238 | 1.616 · −0,0283 |
| 70–75 | 1.779 · −0,0173 | 1.769 · −0,0481 |
| 75–80 | 2.027 · −0,0079 | 2.164 · −0,0308 |
| 80–85 | 1.457 · −0,0102 | 1.610 · −0,0324 |
| 85+ | 1.343 · −0,0353 | 1.868 · −0,0477 |

Gap blend lebih buruk di **setiap** pita. Mekanisme yang terlihat di
tabel: blend memigrasikan kandidat ke pita lebih tinggi (pita 85+:
n 1.343 → 1.868) sementara hit-rate pita itu justru turun (0,857 →
0,847) — form last-6 menaikkan λ/μ kedua arah (tim yang sedang "panas"
dan lawan yang sedang bocor sama-sama didorong), sehingga total gol dan
probabilitas favorit terinflasi bersama. Di pasar yang paling relevan
buat parlay: BTTS blend memasukkan jauh lebih banyak kandidat ke pita
65–80 dengan gap ≈ −0,13 s.d. −0,18 (offset: −0,14 s.d. −0,19 pada n
yang jauh lebih kecil) — blend membuat kaki BTTS *tampak* aman jauh
lebih sering tanpa menjadi lebih aman. OU2.5 menunjukkan pola sama.

Diagnosis (interpretasi, bukan bukti terpisah): di jalur domestik blend
bekerja karena form diukur melawan rekan satu liga dan priornya fit liga
yang sama. Di jalur piala, prior sendiri sudah hasil transformasi lintas
liga (satu lapis fit ekstra dengan errornya sendiri), jendela form 6 laga
melintasi kompetisi yang hanya dinormalisasi rasio rata-rata, dan bobot
κ efektif 16/28 terbukti terlalu besar untuk tumpukan ketidakpastian itu:
LL pooled tetap membaik (LL menghargai banyak koreksi kecil di tengah
distribusi), tetapi slope dan kejujuran pita tinggi — sifat yang menjadi
nyawa produk safe-bet parlay — yang membayar harganya.

## 7. Cakupan cabang telemetri (3.072 sisi-tim ter-rate)

| Cabang | Sisi | % | Mean w |
|---|---|---|---|
| xG (sampel ≥ 3) | 2.091 | 68,1% | 0,2452 |
| Gol (sampel ≥ 1) | 956 | 31,1% | 0,1620 |
| Fallback form | 25 | 0,8% | 0,1579 |

Per graf — Eropa: xG 1.614 / gol 546 / fallback 20; CONMEBOL:
400 / 260 / 0; AFC: 77 / 150 / 5 (AFC paling miskin xG — konsisten dengan
graf tertipis di fase offset). Penolakan ini **bukan** artefak ketiadaan
data: 99,2% sisi-tim menerima sinyal form nyata dengan bobot live
rerata ±0,16–0,25 — sinyalnya masuk, dan tetap gagal gerbang.

## 8. Ilustrasi worked example — Fenerbahçe vs Liverpool (BUKAN bukti)

Dihitung offline dengan modul bersama atas parameter produksi yang
benar-benar disajikan 2026-11-04 (input lengkap:
`tasks/cup-form-blend-fenerbahce-inputs.json`; hasil:
`tasks/cup-form-blend-fenerbahce.json`). Lengan offset-only dari
perhitungan ini mereproduksi paket tersimpan **persis** (λ 1,410,
μ 2,085, 25,82/21,10/53,08) — pipa ilustrasinya valid.

| | Offset-only (disajikan) | Dengan blend |
|---|---|---|
| Fenerbahçe att/def | 1,000 / 1,306 | 1,093 / 1,307 (cabang xG, w 0,273) |
| Liverpool att/def | 1,268 / 0,869 | 1,287 / 0,895 (cabang xG, w 0,158 — pas di ambang 3 sampel) |
| λ / μ | 1,410 / 2,085 | **1,587 / 2,117** |
| Kandang / Seri / Tamu | 25,82% / 21,10% / 53,08% | **29,06% / 20,90% / 50,04%** |
| Over 2.5 | 67,82% | 71,52% |
| BTTS yes | 66,19% | 69,97% |

Dua hal yang ditunjukkan ilustrasi ini dengan jujur:

1. **Arah geraknya "terasa benar"** — λ naik lewat serangan Fenerbahçe
   (xGF rolling bersih 1,69) dan pertahanan Liverpool yang form-nya lebih
   bocor dari prior (xGA 1,30 vs prior 0,869). Justru di sinilah gunanya
   gerbang: gerak yang terasa benar di satu laga adalah gerak yang sama
   yang secara sistematis overconfident di 1.536 laga uji (§6).
2. **Koreksi atas narasi run live**: pertahanan Fenerbahçe nyaris tidak
   bergerak di bawah blend (def 1,306 → 1,307), karena xGA form
   bersihnya 1,65 ≈ prior. Angka "kebobolan 3,00 gol/laga" yang tercatat
   di paket live ternyata **terinflasi hitung-ganda**: laga 2026-10-14
   (kalah 0–6) muncul dua kali di telemetri paket — sekali sebagai baris
   TheStats (`mt_…`/comp_3498, source None) dan sekali sebagai baris
   Sportmonks (`sm_…`/sm:2) — karena telemetri yang dipasok planner
   tidak difilter source. Set bersih cermin-lab (sportmonks saja):
   gol kebobolan rerata **2,00**, xGA tertimbang **1,653**. Varians gol
   biasa di atas profil xGA yang waras — bukan keruntuhan form.

## 9. Temuan sampingan (di luar scope fase, dicatat apa adanya)

- **Divergensi telemetri saji vs harness**: telemetri yang dialirkan
  planner 🔒 ke loader tidak difilter `source` dan tidak dinormalisasi
  kompetisi (tanpa argumen `targetDivCode`), sedangkan harness/lab yang
  memvalidasi Level B memakai log `source='sportmonks'` tertimbang
  kompetisi. Duplikasi mt_/sm_ untuk laga yang sama (kasus §8) menaikkan
  n dan menimbang-ganda laga duplikat di jalur saji — termasuk jalur
  domestik produksi saat ini. Fase C tidak mengubah perilaku ini;
  memperbaikinya adalah pekerjaan terpisah dengan validasinya sendiri.
- **Rekon jalur saji (bila suatu hari varian lolos gerbang)**: perubahan
  minimal hanya menyentuh 2 file non-🔒 — `lib/quant/global-offsets.ts`
  (sisipan blend sesudah transformasi δ, sebelum clamp; metadata
  telemetry diisi nyata) + cabang piala `lib/quant/ratings-loader.ts`
  (meneruskan `options.homeTelemetry/awayTelemetry` yang SUDAH dipasok
  planner untuk semua fixture termasuk piala). Planner 🔒 tidak perlu
  disentuh. Risiko resolusi nama→id untuk tim piala sudah termitigasi
  pola yang ada (pemilihan kandidat berlog terbanyak), dengan catatan
  konteks divisi piala ≠ liga domestik tim.

## 10. Yang mendarat & verifikasi

- **Kode saji: TIDAK berubah.** `global-offsets.ts`, `ratings-loader.ts`,
  irisan piala `parlay-lab.ts`, dan seluruh file 🔒 utuh — diverifikasi
  `sha256sum -c tasks/backend-readonly-hashes.txt` = semua OK.
- Yang mendarat (branch `safe-bet-parlay`, master tetap 80122c6):
  `lib/quant/cup-form-blend.ts` (inti blend bersama — tetap berguna
  sebagai implementasi referensi bila varian masa depan divalidasi),
  `scripts/backtest-cup-form-blend.ts` (harness + aturan pra-terdaftar di
  header), `tasks/cup-form-blend-oos.json` (bukti penuh, termasuk
  `reproductionCheck.pass=false` apa adanya), 
  `tasks/cup-form-blend-fenerbahce-inputs.json` (commit `59d77e5`),
  `tasks/cup-form-blend-fenerbahce.json`, laporan ini.
- `npx tsc --noEmit` = **0 error**. `analysis_snapshots.db` tidak berubah
  (872.448 byte, mtime 2026-11-03 11:30 UTC — sama dengan baseline).
  Nol panggilan API Sportmonks; `.env.local` tidak dibuka.
- Status gerbang kompetisi piala tidak berubah (tidak ada hasil fase ini
  yang menyentuh status — gerbang adopsi varian ≠ gerbang status
  kompetisi): UCL/UEL/Carabao/Coppa Italia tetap partial, 13 lainnya
  tetap uncalibrated.

## 11. Keputusan yang DIBIARKAN terbuka (owner)

1. **Varian blend ber-κ lebih besar / khusus piala** (bobot form lebih
   kecil) — satu-satunya arah yang disarankan data (perbaikan LL nyata
   tapi bobot terbukti terlalu agresif untuk pita tinggi). Ini varian
   BARU: butuh aturan adopsi pra-terdaftar + run walk-forward sendiri;
   tidak boleh diturunkan dari angka fase ini.
2. Perbaikan divergensi telemetri saji (filter source / normalisasi
   kompetisi di jalur planner→loader) — pekerjaan terpisah, berdampak ke
   jalur domestik juga, perlu validasi ulang Level B bila disentuh.
3. Keputusan-keputusan terparkir dari fase piala tetap berlaku apa
   adanya (scope CAF, definisi cakupan gerbang piala, kompresi CONMEBOL,
   konsekuensi ACL Elite) — fase ini tidak mengubah satu pun.
