# Laporan Item 19 — Jalur Pengamatan Prospektif Harian ML1-B

**Tanggal:** 26 Nov 2026 · **Keputusan pemilik:** Item 19 DIBUKA (26 Nov 2026) — pengamatan prospektif harian, shadow-only, read-only terhadap produksi, khusus kandidat ML1-B, irisan Liga Kompetitif sebagai bacaan utama. **Promosi model tetap dilarang** sampai evaluasi prospektif lolos + ACC pemilik.
**Commit:** Fase 0 `ffbd756` · Fase 1 `88c0dac` · laporan ini (master = origin/main).

---

## 1. Fase 0 — Gerbang reproduksi: LOLOS (deviasi 0)

Tidak ada booster terserialisasi di evidence sprint, jadi ML1-B dilatih ulang persis dari design terkunci (`tasks/ml1/evidence/ml1-b/design.md`) memakai kode sprint apa adanya (`scripts/ml1-train.py` + `scripts/ml1-evaluate.ts`, fitur dari `tasks/ml1/evidence/features.jsonl` beku, sha256 `f778551e…`), data latih V1/V2 saja, lalu dinilai di H satu kali:

| Angka | Beku sprint | Reproduksi | Deviasi |
| :--- | ---: | ---: | ---: |
| Konfigurasi terpilih | 100 round, λ_l2 10 | 100 round, λ_l2 10 | — |
| NLL seleksi V2 | 1,7271406599396455 | 1,7271406599396455 | 0 |
| pred-h.jsonl sha256 | `8e53fdaa…` | `8e53fdaa…` | byte-identik |
| Champion LL pooled H | 1,023958 | 1,0239583212641568 | 0 |
| ML1-B LL pooled H | 1,015318 | 1,0153175495292575 | 0 |
| Δ pooled | −0,008641 | −0,00864077173489841 | 0 |
| UB CI 95% pooled | −0,006078 | −0,006078428390643886 | 0 |
| Δ kompetitif (n 6.731) | −0,002249 | −0,0022490237516275356 | 0 |
| UB CI kompetitif | −0,000255 | −0,0002553570451575355 | 0 |

Jangkar champion vs artefak beku PR 4: `anchor_ok = true`. Penjaga isolasi selama evaluasi: identik. Toleransi gerbang (0,0005) tidak terpakai — reproduksi eksak.

**Serialisasi:** `scripts/ml1-train.py` diberi flag opsional `--model-out` (tanpa flag, perilaku identik sprint; pred-h hasil run ber-flag tetap `8e53fdaa…`). Booster refit V1+V2 kini persisten di repo:

- `tasks/ml1/model/ml1-b-home.booster` — sha256 `8d0acdd84fa2fef29526999d98f7a80e1a0b65b292016868f12d4473ef8d33d3`
- `tasks/ml1/model/ml1-b-away.booster` — sha256 `f3733e1198750ec90770cd88a8b23b8211a13343563173ebefc092e7381fdff8`
- `tasks/ml1/model/model-manifest.json` — konfigurasi terpilih, parameter beku, hash fitur/pred-h/booster, aturan komposisi.

Verifikasi inferensi dari booster tersimpan (`scripts/ml1-predict.py` atas 10.401 baris H): 10.385 baris bit-identik dengan pred-h beku, sisanya beda ≤ 4,4e-16 (noise serialisasi teks booster) — jalur inferensi setia.

## 2. Fase 1 — Desain pipeline

**`scripts/ml1-prospective.ts`** (CLI harian, TypeScript/tsx; Python hanya untuk inferensi booster lewat venv `~/workspace/tools/ml1-venv`, pola sprint):

- **Sumber fixture + champion:** paket kuant resmi terbaru per fixture dari generator pick (`analysis_snapshots.db`, trigger `slate`, read-only) dengan `kickoff_utc > waktu lari`. λ/μ champion + probabilitas 1X2 diambil dari paket itu apa adanya (keluaran kode kuant champion) — tidak dihitung ulang. Detail fixture (id tim Sportmonks, nama) dari `upcoming_fixtures.db` (read-only).
- **Fitur as-of:** ekstraktor sprint `lib/eval/ml1-features.ts` atas `thestats_dataset.db` (read-only, query identik ekstraksi sprint). Semua komponen memakai cutoff tanggal fixture, strictly-before. Perluasan aditif ekstraktor: keadaan Elo final per kompetisi (rating sesudah laga selesai terakhir) untuk fixture yang belum ada di universe — `prospectiveFeaturesB()`; jalur lama tidak berubah (uji injeksi tetap 22/22). Kunci tim fixture dipetakan dari id Sportmonks ke namespace dataset (`tm_*` TheStats) lewat registry kanonik tim (`lib/quant/team-identity.ts`) — namespace yang sama dengan baris `matches` terbaru dan log kanonik shots. Fitur `promoted_*` untuk fixture mendatang bernilai 0 (label musim fixture belum ada di dataset; semantik Q1 sendiri mengembalikan 0 bila musim tak diketahui) — dicatat sebagai deviasi sadar.
- **Inferensi:** `scripts/ml1-predict.py` memuat booster, memverifikasi hash terhadap `model-manifest.json` (fail-closed), komposisi resmi `λ = clamp(exp(log λ_champion + raw), 0.05, 6.0)` (predict() LightGBM tidak menyertakan init_score). Probabilitas kandidat dari `matrixProbs(λ, μ, 0)` — fungsi matriks evaluator yang sama dengan sprint.
- **Penyimpanan:** DB bayangan BARU `data/ml1_prospective.db` (di-gitignore seperti DB runtime lain): `predictions` (PK match_id → dedupe; menyimpan predicted_at, vektor fitur 32 kolom, probabilitas champion & kandidat, irisan, provenance paket), `gradings`, `evaluations`, `runs`. Semua akses DB produksi mode read-only (`readOnly: true` / URI `mode=ro`).
- **Irisan:** persis definisi sprint — kompetitif = status registry `league_calibration` `calibrated|partial`; friendlies = `uncalibrated`/tanpa baris. Bacaan utama = kompetitif.
- **Grading:** semantik resolver produksi (`scripts/resolve-pick-outcomes.ts`) — lapisan identitas K1 (skor regulasi terverifikasi) dulu, lalu baris dataset mentah berstatus full-time polos via kandidat id (saudara identitas, bridge `sm_id_map`, saudara `fixture-links.json`); `pending_score_basis` tidak pernah dinilai; fixture `cancelled` → void; koreksi skor resmi menilai ulang grading (pola PRD D2). Log-loss 1X2 per fixture champion vs ML1-B, diakumulasi per irisan.
- **Aturan evaluasi pra-registrasi (ditanam di kode):** status `READY_TO_PROPOSE` hanya bila graded kompetitif **n ≥ 500 DAN Δ LL kompetitif ≤ −0,005 DAN UB CI bootstrap (blok pekan ISO, 5.000 resample, seed 20261124) < 0**. Selain itu `COLLECTING`. Job hanya menandai — tidak ada promosi otomatis dalam kondisi apa pun.

## 3. Fase 2 — Jadwal + larian perdana

- **Cron:** `football-ml1-prospective` (goal `football-agent-sportmonks-database-expansion`), harian, jendela ±17:05 WIB → tersimpan **17:30:12 WIB** (sesudah refresh 16:21), delivery ke chat WhatsApp pemilik. Isi body meniru pola `football-fix4-ticket`: jalankan pipeline, laporkan SATU baris ringkas (prediksi baru hari ini, kumulatif graded kompetitif n, Δ LL kompetitif kumulatif — atau "belum ada yang ternilai"); kegagalan selalu dilaporkan.
- **Larian perdana (manual, 26 Nov ±03:31 WIB):** **415 prediksi baru** — 404 kompetitif + 11 friendlies; kickoff 26 Nov 06:00 WIB s.d. 30 Nov 03:30 WIB. Cakupan fitur sehat: 392/415 fixture punya riwayat shots sisi kandang (has_prior_shots_home = 1); hanya 6 prediksi yang kedua timnya tanpa riwayat laga. Larian kedua langsung sesudahnya: **0 prediksi baru** (415 terlewat sebagai sudah-terprediksi) — dedupe terbukti.
- **Uji grading:** satu baris prediksi sintetis untuk laga selesai `sm_19722110` (skor resmi 3–1) dinilai pipeline pada salinan DB bayangan: graded via sumber `identity`, ll_champ 0,693147180559945 = −ln 0,5 persis, ll_cand 0,597837000755620 = −ln 0,55 persis. DB bayangan lalu dipulihkan ke keadaan murni hasil seeding (415 prediksi, 0 grading).

## 4. Bukti isolasi & suite (sekuensial)

sha256 sebelum/sesudah seluruh pekerjaan — **identik semua**:

| Berkas | sha256 |
| :--- | :--- |
| data/picks.db | `2e804374…` = baseline |
| data/predictions.db | `fb1049b2…` = baseline |
| data/market_snapshots.db | `fcb95ca8…` = baseline |
| data/thestats_dataset.db | `1b2193db…` = baseline |
| data/model-manifest.json | `a6cf947a…` (= jangkar beku sprint) |
| data/calibrated_ratings.json | `be93286a…` (= jangkar beku sprint) |

Penjaga di dalam pipeline sendiri (`guard_identical`) juga `true` pada semua larian. Suite: L02 `test-kandidat-q1` **33/33**, injeksi fitur ML1 **22/22**, fix4 **46/46**, `tsc --noEmit` bersih untuk berkas baru/berubah. Tanpa redeploy web (CLI + cron saja).

## 5. Keadaan akhir & langkah berikutnya (milik pemilik)

- Status evaluasi saat laporan ini ditulis: **COLLECTING** (graded kompetitif n = 0 — laga-laga pertama baru kickoff mulai 26 Nov pagi WIB; grading pertama akan muncul pada larian 26 Nov 17:30 WIB untuk laga yang sudah selesai dan hasilnya sudah masuk dataset).
- Dengan laju slate saat ini (±400 prediksi/3 hari, ±97% kompetitif), ambang n ≥ 500 graded kompetitif diperkirakan tercapai dalam hitungan minggu — angka pastinya tergantung laju penyelesaian laga + impor hasil refresh.
- Bila status suatu saat menjadi `READY_TO_PROPOSE`, itu hanya penanda: promosi tetap menunggu evaluasi pemilik + persetujuan eksplisit via `promote-model.ts`.
