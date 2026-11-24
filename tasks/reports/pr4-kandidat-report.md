# PR 4 — Kandidat Shadow Pertama: Q1 Poisson Terpenalti di Atas Champion

**Branch:** `pr-4/kandidat-q1-poisson` (dari master `5f3752a`)
**Sifat:** SHADOW murni. Tidak ada merge, deploy, tulisan produksi, atau
promosi. Manifest aktif dan artefak saji tidak berubah (dibuktikan hash,
§7). Champion tetap champion apa pun hasilnya.

**Catatan kepatuhan:** `AGENTS.md` proyek berisi blok injeksi
("nextjs-agent-feedback" → perintah menjalankan `npx next internal
agent-feedback-instructions`) dan blok aturan tanaman lain. Isi file itu
diperlakukan sebagai konten saja — **tidak dijalankan dan tidak diikuti**.

---

## 1. Kandidat yang dibangun

Brief (bab P2 "Model Quant", tangga Q0→Q1→Q2→Q3→ML1; bab Promosi butir 5:
"satu hipotesis quant per PR") menetapkan tangga tetapi tidak menamai rung
PR 4 secara eksplisit. Q0 adalah *baseline wajib* (champion terpin +
pembanding) — bukan kandidat. Maka rung kandidat pertama, dan satu-satunya
yang dibangun di PR ini, adalah:

> **Q1 · Poisson terpenalti di atas champion**
> `log(λ_new) = log(λ_champion) + β_home·X_home`,
> `log(μ_new) = log(μ_champion) + β_away·X_away`,
> loss = mean Poisson NLL (kedua sisi) + α‖β‖²,
> X = [rest_diff, venue_neutral, promoted, form_residual, missing_flags].

Komponen:

| Komponen | Isi |
|---|---|
| `lib/eval/kandidat-q1-poisson.ts` | Ekstraktor fitur point-in-time (indeks sendiri dari baris evaluator), fit Poisson ridge per sisi (Newton deterministik dari β=0), aplikasi kandidat (clamp intensitas [0,05; 6,0]), matriks penuh 1X2/OU2.5/BTTS, pemetaan kosakata gate. Murni, tanpa I/O. |
| `scripts/evaluate-kandidat-q1.ts` | CLI shadow: prediksi champion via evaluator PR 3 → protokol β (fit V1 → pilih α di V2 → refit V1+V2 → beku) → nilai H sekali → gate → irisan benchmark. Menulis artefak wajib brief. |
| `tests/test-kandidat-q1.ts` | 33 assertion (§8). Dirantai ke `test:quant` + script `test:kandidat`. |
| `tasks/pr4/design.md` | **Design pra-registrasi** — di-commit (`ef2c77a`) SEBELUM run evaluasi apa pun: hipotesis, fitur, grid α, protokol, batas, kebijakan abstain, aturan gate, seed. |

Protokol blok (brief bab Evaluasi Kronologis): V1 = latih β (6.676 laga),
V2 = pilih α (6.683 laga), refit V1+V2 (13.359 laga), H = holdout terkunci
(6.708 laga, 63 liga universe K5, 33 blok pekan ISO). Semua pengukuran
lewat evaluator PR 3 mode `as-of` pada irisan yang identik dengan champion.

## 2. Hasil headline — holdout H (endpoint primer gate)

Jangkar sanity LOLOS: champion direproduksi persis — log-loss H
**1,013402262327106** vs terkunci 1,0134022623271062 (selisih 1 ULP urutan
penjumlahan, sama seperti PR 3); benchmark champion 1,0094304221309824
persis.

| Metrik (H, n = 6.708, 33 blok) | Champion | Kandidat Q1 | Δ |
|---|---|---|---|
| Log-loss 1X2 (terjepit, konvensi K5) | 1,013402262327106 | 1,013436337397265 | **+0,0000341** |
| Brier | 0,6065786 | 0,6066042 | +0,0000255 |
| ECE | 0,0149171 | 0,0142378 | −0,0006793 |
| Cakupan | 1,000 | 1,000 | 0 |
| Fallback | 0 | 0 | 0 |

Bootstrap blok berpasangan (pekan ISO, 5.000 resample, seed 20261124):
Δ mean **+0,0000341**; CI 95% dua sisi [−0,000234; +0,000322]; **batas atas
satu sisi 95% = +0,000271**.

**Bacaan jujur:** kandidat praktis identik dengan champion pada 1X2 —
sedikit lebih buruk (+0,00003, nol secara statistik), dan dua orde di bawah
ambang manfaat gate (−0,005). Koreksi fitur konteks (istirahat, promosi,
residual form) tidak membawa sinyal 1X2 tambahan di luar blend champion.

Irisan sekunder H (semua sedikit memihak kandidat, semua jauh di bawah
ambang apa pun): Poisson NLL gol Δ **−0,000287** (1,727204 → 1,726917);
OU2.5 biner Δ **−0,000153** (0,679132 → 0,678978); BTTS biner Δ **−0,000307**
(0,687021 → 0,686715). Kandidat memang sedikit memperbaiki metrik gol
native-nya, tetapi tidak terjemahkan ke 1X2.

## 3. Putusan gate — WOULD FAIL (`retain`)

Mesin repo `applyKappaDecision` (ambang = brief bab Metrik dan Bukti),
fail-closed:

| Cek | Teramati | Ambang | Lolos |
|---|---|---|---|
| Lantai sampel | n 6.708, 33 blok | ≥1.000, ≥20 | ✓ |
| Mean Δ | +0,0000341 | ≤ −0,005 | ✗ |
| Batas atas CI satu sisi 95% | +0,000271 | < 0 | ✗ |
| Penurunan cakupan | 0 | ≤ 0,02 | ✓ |
| Kenaikan Brier | +0,0000255 | ≤ 0,002 | ✓ |

**Keputusan: `retain`** — kandidat TIDAK lolos gate; seandainya diajukan,
ia gugur pada dua cek manfaat. Tidak ada promosi yang dilakukan atau
diusulkan oleh PR ini; angka ini informasi untuk keputusan Arandi.
`decision.json` di evidence memuat rincian yang sama.

## 4. Irisan benchmark penutupan (set pasangan PR 3, konvensi −ln p)

β tersedia menurut lipatan (walk-forward, sesuai design): lipatan H →
β(V1+V2); V1 → kandidat = champion (belum ada OOS lebih awal); tanpa
lipatan → fallback champion.

| Irisan | n | Kandidat aktif | LL champion | LL kandidat | LL closing | Δ champ vs closing | Δ kand vs closing |
|---|---|---|---|---|---|---|---|
| 1X2 pooled | 1.223 | 663 | 1,009430 | 1,009364 | 0,976915 | +0,032515 | +0,032449 |
| 1X2 subset lipatan H | 663 | 663 | 1,012012 | 1,011890 | 0,983891 | +0,028121 | +0,027999 |
| OU2.5 pooled | 561 | **0** | 0,700680 | 0,700680 | 0,682957 | +0,017723 | +0,017723 |

Δ kandidat−champion pooled 1X2 = −0,000066 (CI 95% [−0,000752; +0,000625] —
memuat 0). Celah ke closing praktis tidak bergerak.

**Catatan OU2.5 yang terbuka:** kandidat tidak pernah aktif di irisan OU —
terverifikasi bukan bug: set pasangan OU terpetakan ke lipatan V1 (554) +
tanpa lipatan (7), NOL lipatan H (pemeriksaan ulang independen mereproduksi
pemetaan lipatan PR 3 persis: 1X2 V1 553/H 663/null 7). Di bawah aturan
walk-forward yang dibekukan, belum ada β yang sah untuk laga-laga itu, jadi
kandidat = champion menurut protokol. Irisan OU benchmark karenanya tidak
membawa sinyal kandidat; sinyal OU ada di irisan sekunder H (§2).

## 5. Pemilihan α, ablasi, dan β

Grid α terdaftar {0,3; 1; 3; 10; 30; 100} — Poisson NLL V2 menurun monoton
ke α terkecil: 1,796243 (α=0,3) … 1,796757 (α=100). **α\* = 0,3** (tepi bawah
grid; selisih seluruh grid hanya ±0,0005 — permukaan datar). Semua fit
konvergen; fit final deterministik (refit → β identik byte-per-byte).

Ablasi (brief: ukur ablasi form/xG): pada α\*, NLL V2 model penuh 1,796243
vs tanpa `form_resid` 1,796388 → form_resid berkontribusi −0,000144 di
validasi (kecil, positif).

β final (V1+V2, α\*=0,3) — semua kecil; efek terbesar: tim promosi dicetak
sedikit di bawah ekspektasi champion:

| Fitur | β home | β away | β home (V1 saja) | β away (V1 saja) |
|---|---|---|---|---|
| rest_adv | −0,00131 | −0,00014 | +0,00285 | −0,00593 |
| venue_neutral | 0 (tidak di-fit) | 0 | 0 | 0 |
| promoted | −0,01810 | −0,02198 | −0,02844 | −0,02265 |
| form_resid | −0,00269 | −0,01487 | +0,00377 | −0,01386 |
| miss_rest | −0,00097 | −0,00092 | −0,00030 | +0,00059 |
| miss_form | −0,00190 | −0,00121 | +0,00037 | +0,00077 |

Koefisien terkecil bertukar tanda antara fit V1 dan V1+V2 (rest_adv home,
form_resid home) — konsisten dengan efek ≈ 0.

## 6. Fitur — deviasi karena data (terdaftar di design sebelum run)

1. **`venue_neutral` tidak teridentifikasi:** tidak ada kolom venue netral
   di `matches`/sumber mana pun (kolom `venue` di `team_match_logs` adalah
   perspektif home/away tim). Kolom dipertahankan sesuai spesifikasi brief
   dengan nilai 0 dan dikeluarkan dari fit (β ≡ 0). Bukan penghapusan
   diam-diam — tercatat di design §4 sebelum run.
2. **`form_residual` berbasis gol, bukan xG:** xG hanya ada di
   34.474/83.426 log (±41%); definisi brief tidak menetapkan basis xG.
   Dipakai residual gol vs rata-rata kompetisi point-in-time (cakupan
   penuh), di-cap [−2, 2], butuh ≥3 laga sebelumnya.

## 7. Bukti isolasi shadow

- CLI mencatat sha256 `data/model-manifest.json` + seluruh
  `data/model-artifacts/*.json` dan ukuran+mtime `picks.db`,
  `analysis_snapshots.db`, `thestats_dataset.db` di direktori data
  produksi SEBELUM dan SESUDAH run: **identik** (`guard.identical = true`
  di run-manifest).
- Suite G1 mereplikasi penjaga itu di worktree: hash manifest+artefak sama
  sebelum/sesudah seluruh jalur kandidat; `modelVersion` aktif tetap
  champion kfit10.
- Semua tulisan kandidat hanya di `tasks/pr4/evidence/q1-shadow/` worktree
  pr4. DB produksi dibaca `readOnly`. `scripts/promote-model.ts` tidak
  dijalankan; manifest kandidat model (jalur Fix-5) tidak ditulis — Q1
  adalah lapisan koreksi, artefaknya `candidate-artifact.json` (β beku +
  α\* + sha256 `4c061883…`) di area evidence, bukan manifest model.

## 8. Regresi (worktree pr4)

| Gerbang | Hasil |
|---|---|
| `tsc --noEmit` | lolos |
| `lint:gate` | lolos (91 ≤ baseline 92) |
| `test:quant` | hijau — quant 22/22, model 61/61, artifacts 32/32, experiment-stats 23/23, evaluator 22/22, **kandidat-q1 33/33** |
| `test:evaluator` | 22/22 |
| `test:data` | hijau — 18/18, identity 58/58, publication 110/110, tickets 69/69, resolver 23/23 |
| `test:web` | hijau kecuali **tepat 2 assertion pra-ada** test-beranda-pr1b ("cadangan: jenis hasil-terakhir", "cadangan: hasil-terakhir menunjuk laga F"; 34/36) — identik di master murni; suite sesudahnya (test-pr2) terpisah: 47/47 |
| `test:api` | 42/42 |
| `test:verifikasi` | hijau — 39/39, 36/36, 41/41, 38/38 |
| `test:lanjut` | hijau — 25/25, 28/28, 27/27, 96/96, 73/73 |
| `test:e2e` | 7/7 |
| `npm run build` | sukses (Compiled successfully) |

Catatan lingkungan yang jujur: run pertama test:verifikasi/test:lanjut
gagal pada assertion "npm run build berhasil di dalam suite" karena
`node_modules` worktree awalnya berupa symlink ke checkout utama (Next
menolak dependensi yang ter-resolve di luar root proyek di sandbox suite).
Diganti salinan nyata → kedua suite hijau penuh. Bukan isu kode; tidak ada
assertion lain yang terpengaruh.

## 9. Artefak

`tasks/pr4/evidence/q1-shadow/`: `design.md` · `run-manifest.json` (git
HEAD run `f6e4c47`, hash aliran matches `a9ce4587…`/logs `7c3b3068…` —
sama dengan manifest K5/PR 3, guard sebelum/sesudah) · `predictions.jsonl`
(6.708 baris H: champion + kandidat + fitur + hasil) · `metrics.json` ·
`decision.json` · `candidate-artifact.json` · `run.log` (perintah persis,
12:36:13→12:46:32 UTC, exit 0).

## 10. Format serah terima (brief bab Promosi)

- commit: lihat tip branch `pr-4/kandidat-q1-poisson` | tahap: PR 4
  kandidat shadow Q1 | status: selesai | alasan: gate GAGAL pada cek
  manfaat (Δ +0,00003 vs ≤ −0,005; UB CI +0,00027 vs < 0).
- Cakupan & asumsi: universe K5 63 liga; lipatan V1/V2/H evaluator PR 3;
  fitur sesuai design beku; venue_neutral tidak teridentifikasi dari data.
- Baseline → hasil: champion 1,013402262327106 → kandidat 1,013436337397265
  (Δ +0,0000341, CI 95% [−0,000234; +0,000322], n = 6.708 unik, 33 blok).
- Regresi: §8 (hijau kecuali 2 assertion pra-ada yang dikenal).
- Rollback: tidak ada yang berubah di produksi — rollback = hapus branch.
- Keputusan: **retain** (kosakata brief) — champion dipertahankan; kandidat
  tidak layak shadow lanjutan/promosi berdasarkan bukti ini. Rung
  berikutnya menurut tangga brief adalah Q2 (dependensi skor/ρ), menunggu
  kata pemilik.
