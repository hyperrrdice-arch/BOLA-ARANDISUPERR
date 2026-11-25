# Laporan Sprint ML1 — Eksperimen Shadow A/B (Tahap A: Form/Elo; Tahap B: +Shots/SoT Proxy As-Of)

**Tanggal:** 25 Nov 2026 · **Basis:** `cc1728d` (pasca audit Item 21) · **Sifat:** 100% SHADOW/OFFLINE — champion live tidak diubah, tidak ada promosi, tidak ada tulisan ke DB produksi, cron/web tidak disentuh.
**Design pra-registrasi:** `tasks/ml1/design.md` (dibekukan & di-commit di Fase 0, sebelum run apa pun).
**Artefak:** `tasks/ml1/evidence/` (`features.jsonl` + manifest, `ml1-a/`, `ml1-b/`, `slices.json`, `fase0/environment.json`, `fase1/extraction.json`).

---

## 1. Ringkasan eksekutif

- Stop-gate Fase 0 sprint sebelumnya (`BLOCKED_MISSING_ML_RUNTIME`) terangkat oleh ACC pemilik: **lightgbm 4.7.0** terpasang di venv persisten `~/workspace/tools/ml1-venv` (Python sistem 3.12.3 externally-managed; `pip install --user` ditolak PEP 668). Backend diverifikasi: objective Poisson jalan, deterministik byte-identik, dan semantik offset terbukti empiris — `predict()` LightGBM **tidak** menyertakan `init_score`, sehingga komposisi resmi `λ = exp(log λ_champion + raw_score)` dipakai (uji pemulihan koreksi tertanam: corr 0,9624).
- **Kedua kandidat lolos Gate PR 4 pada holdout H pooled** → status brief **`READY_FOR_PROSPECTIVE_CONFIRMATION`** untuk ML1-A dan ML1-B. Sesuai brief & Item 19, status ini **bukan** promosi: promosi tetap dilarang tanpa konfirmasi periode prospektif baru + persetujuan pemilik via `promote-model.ts`. `promotion_performed = false` di kedua `decision.json`.
- **Irisan Fase 4 mengubah tafsir angka pooled secara material:** lift pooled ML1-A digerakkan oleh irisan Friendlies/Uncalibrated (Δ −0,0225), sedangkan di Liga Kompetitif ML1-A memberi **nol** lift (Δ +0,00001). Kontribusi murni shots/SoT (ablasi B−A) **tidak signifikan secara pooled** (−0,00070; CI95 melintasi 0), tetapi **nyata dan signifikan di Liga Kompetitif** (−0,00226; UB −0,00147) dan sedikit negatif di Friendlies (+0,00216).

## 2. Tabel ringkasan wajib (holdout H)

| Model & Irisan (`H`) | `n` Laga | Log-Loss | `Δ` vs Champion | `UB CI 95%` | Brier | Keputusan Gate |
| :--- | ---: | ---: | ---: | ---: | ---: | :--- |
| Champion (Pooled) | 10.401 | 1,023958 | — | — | 0,612775 | Jangkar |
| `ML1-A` (Pooled) | 10.401 | 1,016015 | −0,007944 | −0,005050 | 0,606842 | READY_FOR_PROSPECTIVE_CONFIRMATION |
| `ML1-B` (Pooled) | 10.401 | 1,015318 | −0,008641 | −0,006078 | 0,606480 | READY_FOR_PROSPECTIVE_CONFIRMATION |
| Champion (Liga Kompetitif) | 6.731 | 1,012686 | — | — | 0,605876 | Diagnostik |
| `ML1-A` (Liga Kompetitif) | 6.731 | 1,012693 | +0,000007 | +0,002136 | 0,605988 | Diagnostik |
| `ML1-B` (Liga Kompetitif) | 6.731 | 1,010437 | −0,002249 | −0,000255 | 0,604484 | Diagnostik |
| `ML1-B` (Friendlies / Uncalibrated) | 3.670 | 1,024268 | −0,020364 | −0,015926 | 0,610143 | Diagnostik |

Baris pelengkap (di luar 7 baris wajib): Champion (Friendlies) n=3.670, LL 1,044632, Brier 0,625427; `ML1-A` (Friendlies) LL 1,022106, Δ −0,022526, UB −0,017806, Brier 0,608409.

**Detail gate pooled (mesin `applyKappaDecision`, ambang beku repo):**

| Cek | Ambang | ML1-A | Lolos | ML1-B | Lolos |
| :--- | ---: | ---: | :---: | ---: | :---: |
| sample_floor | ≥1 (n≥1000, blok≥20) | 2,30 (n=10.401, 46 blok) | ✓ | 2,30 | ✓ |
| mean_delta | ≤ −0,005 | −0,007944 | ✓ | −0,008641 | ✓ |
| bootstrap_upper | < 0 | −0,005050 | ✓ | −0,006078 | ✓ |
| coverage_drop | ≤ 0,02 | 0 (abstain identik) | ✓ | 0 | ✓ |
| brier_increase | ≤ 0,002 | −0,005933 | ✓ | −0,006294 | ✓ |

CI95 dua sisi Δ pooled: ML1-A [−0,012007, −0,004446]; ML1-B [−0,012022, −0,005631]. Jendela H: 2025-05-31 s.d. 2026-11-07 (irisan indeks per liga 85–100%).

## 3. Ablasi `ML1-B − ML1-A` (kontribusi murni shots/SoT)

| Irisan | Δ Ablasi | UB CI 95% | CI95 | Tafsir |
| :--- | ---: | ---: | :--- | :--- |
| Pooled | −0,000697 | +0,000548 | [−0,001969, +0,000831] | **Tidak signifikan** — CI melintasi 0; gain kompetitif terencerkan irisan friendlies. |
| Liga Kompetitif | −0,002256 | −0,001471 | [−0,003093, −0,001320] | **Signifikan** — satu-satunya sumber lift ML1-B di liga terkalibrasi; ML1-A sendiri nol di irisan ini. |
| Friendlies / Uncalibrated | +0,002162 | +0,004951 | [−0,000550, +0,005550] | Sedikit negatif — shots/SoT (cakupan cuma 23,8–33% di Club Friendlies) tidak membantu di laga persahabatan. |

Kesimpulan ablasi: fitur shots/SoT proxy **bekerja persis di tempat yang diramalkan audit Item 21** — liga kompetitif dengan cakupan stat memadai — dan tidak bekerja di friendlies. Lift pooled kedua model sebagian besar adalah koreksi atas champion yang buruk di friendlies (LL champion 1,0446 di irisan itu vs 1,0127 di liga kompetitif), yang dicapai sudah oleh form/Elo (ML1-A).

## 4. Protokol & hasil per fase

- **Fase 0** (`f337657`): jangkar sha256 dicatat; backend lightgbm 4.7.0 dipilih (preferensi pertama brief) & terverifikasi; format artefak diseragamkan dengan PR 4/Q0/Q2; design dibekukan. Interpreter resmi: `/home/hatch/workspace/tools/ml1-venv/bin/python` (tercatat di setiap run-manifest/train-summary).
- **Fase 1** (`f884550`): ekstraktor `lib/eval/ml1-features.ts` — form bergulir 5/10 as-of, Elo sekuensial per liga konstruksi Q0-Elo, konteks Q1 persis (rest/venue/promoted), shots/SoT rolling as-of dari `team_match_logs_canonical` (≥3 log + flag eksplisit). **Uji injeksi masa depan 22/22 PASS** (`tests/test-ml1-features.ts`). Ekstraksi universe penuh: **31.112 baris** (V1 10.349 / V2 10.362 / H 10.401); 13 liga-lipatan fit-null dikeluarkan sesuai aturan genRows PR 4 (terdaftar di manifest; menjelaskan selisih −5/−4/−5 vs hitungan audit Item 21). **Determinisme ekstraksi: 2 run → sha256 fitur identik** (`f778551e…`). Satu perbaikan skrip tercatat: liga mungil beririsan-uji-kosong dilewati sebelum `foldFit` (semantik baris tak berubah). Ekstraksi lambat (~14 menit/run, IO-bound DB 3 GB) dan satu run terpotong runtime replacement lalu diulang dari nol — tidak ada hasil parsial yang dipakai.
- **Fase 2** (`00132a4`, `5e09a9a`): ML1-A — konfigurasi terpilih **hanya dari V1→V2**: 200 round, λ_l2 10 (NLL V2 1,725385; grid penuh di `metrics.json`). Validasi V2 Δ log-loss −0,008170 (konsisten dengan H). Determinisme latih byte-identik 2× (pred-h `aa808b07…`). **L02 33/33 PASS**, injeksi 22/22 PASS.
- **Fase 3** (`7260f23`): ML1-B — terpilih 100 round, λ_l2 10 (NLL V2 1,727141 — pada metrik seleksi gol sedikit di atas ML1-A, namun log-loss 1X2 H lebih baik; keduanya dilaporkan apa adanya). Validasi V2 Δ −0,008845. Determinisme byte-identik 2× (pred-h `8e53fdaa…`). L02 33/33, injeksi 22/22.
- **Fase 4** (`9992eb5`): irisan di `tasks/ml1/evidence/slices.json` — lihat §2–§3.
- **Metrik sekunder H (pooled):** Poisson NLL gol — champion 1,734181; ML1-A 1,705161 (Δ −0,029019); ML1-B 1,706767 (Δ −0,027414). OU2.5 binary log-loss — champion 0,700347; ML1-A 0,694541 (Δ −0,005806); ML1-B 0,695333 (Δ −0,005014).
- **Jangkar champion:** probabilitas champion pada 6.708 baris irisan artefak beku PR 4 cocok **persis** (max |Δp| = 0) dan log-loss irisan = 1,013402262327106 = angka terkunci PR 3 → jalur champion yang dinilai identik dengan jalur resmi.

## 5. Konfirmasi isolasi 100% shadow

- sha256 `data/model-manifest.json`: awal `a6cf947a4f9f1ccfb80fcfccc739dca522bfc00dd042f2b6759530dca2b54315` — akhir **identik** (diverifikasi ulang di Fase 5).
- sha256 `data/calibrated_ratings.json`: awal `be93286a1f55836e7645ea03d7f19415e8a193b6d6ab5c9d257229589a636685` — akhir **identik**.
- Penjaga isolasi (sha256 berkas saji + ukuran/mtime DB) identik sebelum/sesudah di **setiap** run (ekstraksi ×2, evaluasi ML1-A, evaluasi ML1-B) — tercatat di run-manifest masing-masing.
- L02 (`tests/test-kandidat-q1.ts`) **33/33**; uji injeksi masa depan ML1 **22/22**; determinisme byte-identik: ekstraksi 2×, latih ML1-A 2×, latih ML1-B 2×.
- Tidak ada perubahan pada `picks.db`, manifest, ratings, ambang gate, L01/L02, cron, atau web. Semua bacaan DB `readOnly`/`mode=ro`. xG asli, lineup, dan odds pasar **tidak** dipakai di mana pun (non-goals brief dipatuhi).
- Validasi akhir Fase 5 (berurutan, keluaran aktual): `tsc --noEmit` exit 0; `npm run lint:gate` LOLOS (91 error ≤ baseline 92, tak ada error baru); `npm run test:data` exit 0 — semua suite hijau (data 18/18, identity 58/58, publication 110/110, tickets 69/69, resolver 23/23, slip-stats 12/12, ingest 12/12, fix4 46/46, market-snapshot 63/63, fdorg 43/43, cohort 21/21); `npm run test:quant` — quant 22/22, model-artifacts 32/32, experiment-stats 23/23, evaluator-kronologis 22/22, kandidat-q1 (L02) 33/33, promote-gate 21/21, q0 19/19, q2 11/11 hijau; **satu pengecualian tanda tangan lama yang sudah dikenal**: `test:model` 42/45 — 3 assertion `point_in_time_violation` sandbox (artefak rating hasil refresh live vs tanggal sandbox 2026-11-21) + ENOENT berkas sandbox di `/tmp`. Tanda tangan ini identik di master murni sebelum sprint (terdokumentasi berulang sejak 24–25 Nov; di worktree bersih 62/62) dan tidak disentuh perubahan ML1 yang murni aditif (tak ada berkas ML1 yang diimpor jalur model) — bukan regresi sprint ini.

## 6. Keputusan & langkah berikutnya (milik pemilik)

- Keputusan sprint menurut aturan brief Fase 4: ML1-A dan ML1-B sama-sama **`READY_FOR_PROSPECTIVE_CONFIRMATION`** (lolos gate pada H lama). **Tidak ada promosi.**
- Catatan penafsiran untuk keputusan pemilik: (i) keunggulan pooled kedua model terkonsentrasi di friendlies — segmen yang tidak dipakai produk; (ii) di liga kompetitif hanya ML1-B yang memberi lift, dan liftnya (−0,00225) di bawah ambang manfaat pooled −0,005; (iii) konfirmasi prospektif Item 19 akan menilai tepat di segmen kompetitif itu. Rekomendasi teknis sprint: bila konfirmasi prospektif dibuka, kandidat yang dibawa adalah **ML1-B**, dengan irisan kompetitif sebagai irisan utama pembacaan.
