# Foundation Review — temuan & rencana perbaikan

> Untuk coding agent berikutnya. Audit read-only: **16 Oktober 2026**. HEAD: `fef3bc5` (v1.3.0) + perubahan working tree.
> Fokus: **rapihin fondasi** sebelum tambah data/fitur, lalu naikkan akurasi lintas liga.
>
> Semua temuan diverifikasi langsung dari source + eksekusi script, bukan asumsi. Angka = snapshot saat audit; verifikasi ulang sebelum mengubah.

---

## 0. Cara pakai dokumen ini

- Bagian **1** = apa yang sudah benar (jangan diutak-atik).
- Bagian **2** = bug prediksi inti yang masih hidup (P0).
- Bagian **3** = bug baru yang dibawa perbaikan terakhir.
- Bagian **4** = hygiene & risiko repo.
- Bagian **5** = rencana eksekusi bertahap.

Perbaikan DB terakhir (`DATABASE_REVIEW_PREMIER_LEAGUE.md`) **sudah dikerjakan dan hasilnya bagus di layer data**. Tapi bug prediksi inti belum disentuh, dan fitur baru membawa masalah baru. Dokumen ini melanjutkan dari situ.

---

## 1. Yang sudah benar — jangan diubah

| Item | Bukti |
| --- | --- |
| Gap musim ketutup | `football_master.db`: 2021/22 → 2026/27, E0 = 6 musim / 1960 laga. Sebelumnya berhenti 2025-06-01. |
| Ratings fresh | `calibrated_ratings.json`: `compiledAt 2026-10-16`, `calibrationDate 2026-10-12`, 16 liga, 483 tim. |
| Injury mapping jujur | 53 INJURED, 5 SUSPENDED, 58 UNKNOWN, 397 FIT. `FIT` sekarang = tim punya payload resmi & pemain tidak ada di list. |
| Telemetry tanpa imputasi | `lib/db/team-telemetry.ts`: NULL transparan + `observed_*_samples` per metrik. |
| Pre-match cutoff | `getPreMatchLogs(..., beforeDate)` pakai `match_date < ?`. Terverifikasi: Arsenal cutoff 2026-09-15 → 4 laga. |
| Migrasi non-destruktif | `sqlite-master.ts`: `ALTER TABLE ... ADD COLUMN` dalam try/catch, bukan `DROP TABLE`. |
| `dixon-coles.ts` | Matematika benar. **Jangan tulis ulang.** |
| Typecheck | `tsc --noEmit` bersih. |
| Acceptance test | `scripts/verify-pl-pipeline.ts` exit 0, cetak `100% PASS`. |

---

## 2. Bug prediksi inti — MASIH HIDUP (P0)

### 2.1 Fallback buta ke E0 untuk liga tak dikenal

**Lokasi:** `lib/quant/ratings-loader.ts:246`

```ts
const divCode = resolveDivCode(options.leagueHint) || "E0"; // Default ke EPL jika tidak dikenal
```

Liga apa pun yang gagal di-resolve akan memakai parameter Dixon-Coles **Premier League** tanpa peringatan. Rating file sudah berisi 16 liga, jadi ini murni bug lama yang belum disentuh.

**Dampak memburuk:** baris `302` dan `313` meng-gate telemetry dengan `divCode === "E0"`. Jadi liga yang salah resolve tidak cuma dapat parameter EPL — dia juga mencoba menarik telemetry EPL.

**Arah fix:**
- `resolveDivCode` gagal → **jangan** substitusi E0. Kembalikan `isCalibrated: false` dengan `metadata.div = "UNKNOWN"`, dan tandai output sebagai tidak terkalibrasi supaya LLM/pipeline bisa PASS.
- Kalau mau tetap ada prediksi, pakai `defaultFallback` yang sudah ada (baris 249-270) — tapi itu memang jalur "no calibration", bukan jalur EPL.
- Gate telemetry jangan bergantung pada `divCode`. Pakai hasil lookup `getTheStatsTeamId()` sebagai penentu.

**Verifikasi:** panggil `getShrunkMatchParameters({ homeTeam: "Real Madrid", awayTeam: "Barcelona", leagueHint: "la liga", ... })` → `metadata.div` harus `SP1`, bukan `E0`.

### 2.2 Alias `G1` (Greek Super League) hilang

**Lokasi:** `lib/quant/ratings-loader.ts:71-119` (`LEAGUE_ALIAS_TO_DIV`)

`G1` ada di `data/calibrated_ratings.json` (16 liga terverifikasi) dan di `LEAGUE_METADATA` (`scripts/calibrate-ratings.ts:52`), tapi tidak ada satu pun alias yang memetakan ke `G1`. Liga Yunani selalu jatuh ke bug 2.1.

**Arah fix:** tambah `"super league": "G1"`, `"greek super league": "G1"`, `"super league greece": "G1"`. Hati-hati: `"super lig"` (tanpa `e`) sudah dipakai untuk `T1` Turki — jangan sampai tabrakan.

**Catatan cakupan:** alias map punya 15 dari 16 div code di file kalibrasi. `G1` satu-satunya yang hilang (`E1`, `SP2`, `I2`, `D2`, `F2`, `SC0` semuanya sudah ada). Setelah menambah `G1`, jalankan cek otomatis: setiap key `calibrated_ratings.json.leagues` harus punya minimal satu alias, dan sebaliknya.

### 2.3 `sampleN` memakai jumlah meeting H2H sebagai sample size

**Lokasi:** `app/api/agent/route.tsx:321-335`

```ts
const sampleN = intel.h2h_history?.sample_size
  ? Math.max(3, Math.min(10, intel.h2h_history.sample_size))
  : 5;

// ...
homeSampleN: sampleN,
awaySampleN: sampleN,
```

`homeSampleN`/`awaySampleN` masuk ke James-Stein shrinkage `w = n/(n+16)` di `ratings-loader.ts:370-372`. Nilai yang benar adalah **jumlah laga form tim itu**, bukan jumlah pertemuan head-to-head.

**Dampak sekarang:** sebagian tertutup karena telemetry meng-override `nHome`/`nAway` saat tersedia (`ratings-loader.ts:336,342,358,364`). Tapi untuk liga non-EPL / tim tanpa telemetry, shrinkage tetap memakai angka yang salah.

**Arah fix:** ambil jumlah laga form aktual. `intel.form_split` sudah dipakai untuk `home_goals_avg`; cek apakah `stats-validator.ts` mengekspos count. Kalau tidak, ekspos (`home_form_sample_size`) dan pakai itu. Fallback ke konstanta kecil yang jujur, bukan H2H.

**Verifikasi:** unit test dengan `h2h_history.sample_size = 10` tapi form 3 laga → `shrinkageWeights.home` harus `3/19 ≈ 0.158`, bukan `10/26 ≈ 0.385`.

---

## 3. Bug baru dari perbaikan terakhir

### 3.1 Pasar Headed Goal praktis konstan tapi dilabel `HIGH`

**Lokasi:** `lib/quant/special-markets-engine.ts:106` dan `:164-170`

```ts
const BENCHMARK_AERIAL_PCT = 50.0;
// ...
homeAerialFactor = Math.pow(homeTelemetry.avg_aerial_duels_pct_for / BENCHMARK_AERIAL_PCT, 0.8);
// ...
const safeHomeMultiplier = Math.min(2.2, Math.max(0.5, homeCrossFactor * homeAerialFactor * homeTouchFactor));
```

**Bukti bahwa benchmark salah:** `aerial_duels_pct_for` di DB punya range **5–30, rata-rata 15.15** (n=98). Cek raw vault: `duels_won=46, ground_duels=35, aerial_duels=11` → field ini = **persentase duel yang berupa aerial**, bukan aerial win-rate.

**Efek:** `(15/50)^0.8 ≈ 0.38`, dikali cross & touch factor → ≈0.465, lalu **kena clamp floor 0.5**. Output `verify-pl-pipeline.ts`: `expected_headers = 0.191` — hampir persis base rate `LEAGUE_BASE_HEADER_RATE = 0.19`. Artinya semua tim menghasilkan angka hampir sama, tapi `confidence_tier` bilang `HIGH`. Ini keyakinan palsu versi baru.

**Arah fix (pilih salah satu, jangan campur):**
1. Ganti metrik: pakai `duels_won_pct_for` (range realistis 39–61) sebagai proxy kekuatan duel udara. Benchmark ±50 masuk akal di sana.
2. Atau turunkan benchmark ke skala aktual (mis. 15) **dan** naikkan exponent, lalu buang clamp floor 0.5 yang menyamakan semua tim.
3. Jangan klaim `HIGH` kalau multiplier-nya mentok di batas clamp — itu tanda metrik tidak diskriminatif.

**Verifikasi:** jalankan special markets untuk 2 tim dengan profil aerial jauh berbeda; `expected_headers` harus berbeda secara material, bukan 0.19 vs 0.19.

### 3.2 `observed_crosses_samples` diisi dengan sample passes

**Lokasi:** `lib/quant/special-markets-engine.ts:189`

```ts
observed_crosses_samples: { home: homePassSamples, away: awayPassSamples },
```

`homePassSamples` = `observed_passes_samples` (baris 111-112). `TeamRollingTelemetry` bahkan tidak mengekspos `countCrosses` (`team-telemetry.ts:243-246` menghitungnya tapi tidak dikembalikan).

**Arah fix:** ekspos `observed_crosses_samples` di `TeamRollingTelemetry`, pakai di engine. Jangan isi field crosses dengan angka passes.

### 3.3 Corners & Cards melakukan imputasi diam-diam tanpa flag

**Lokasi:** `lib/quant/special-markets-engine.ts:202-203` dan `:245-246`

```ts
const homeCorners = homeTelemetry.avg_corners_for !== null ? homeTelemetry.avg_corners_for : LEAGUE_AVG_CORNERS_TEAM;
```

`LEAGUE_AVG_CORNERS_TEAM = 5.2` dan `LEAGUE_AVG_CARDS_TEAM = 2.1` adalah konstanta hardcode tanpa sumber. Saat telemetry null, output tetap keluar **tanpa** flag `is_estimated` — padahal `headed_goal` punya. Inkonsisten dengan prinsip "no silent imputation" yang ditulis di header file itu sendiri (baris 6-9).

**Arah fix:** tambah `is_estimated` + `observed_samples` yang eksplisit di output corners & cards. Kalau sampel nol, kembalikan `confidence_tier: "INSUFFICIENT_DATA"` dan jangan sajikan fair odds seolah terukur.

### 3.4 Semantik `liveHomeDefense` berubah diam-diam

**Lokasi:** `lib/quant/ratings-loader.ts:326` dan `:348`

```ts
let liveHomeDefense = Math.max(0.6, 2.5 - liveHomeAttack);
```

Sebelumnya `2.5 - liveAwayAttack` (memakai attack lawan). Sekarang memakai attack sendiri: makin tajam attack ⇒ makin "bagus" defense. Ini tidak punya dasar sepak bola; nilainya cuma dipakai saat telemetry kosong, tapi perubahannya tidak didokumentasikan dan tidak ada test yang mengunci perilakunya.

**Arah fix:** putuskan sadar mau yang mana. Kalau tujuannya defense berbasis lawan, kembalikan ke `2.5 - liveAwayAttack`. Kalau mau berbasis tim sendiri, ganti ke `2.5 - liveHomeAttack` **dengan komentar alasan** dan test. Yang penting: jangan berubah tanpa jejak.

### 3.5 `is_estimated_telemetry` salah arah

**Lokasi:** `lib/quant/ratings-loader.ts:412`

```ts
isEstimatedTelemetry: homeTelemetrySource !== "thestats_observed_xg" || awayTelemetrySource !== "thestats_observed_xg",
```

Kalau kedua tim memakai `thestats_observed_goals` (data **terukur**, hanya bukan xG), flag jadi `true` — seolah estimasi. Ini kebalikan dari maksud flag.

**Arah fix:** bedakan "terukur tapi bukan xG" dari "estimasi/prior". Tambah nilai source terpisah (mis. `thestats_observed_goals`) yang tetap dianggap observed, dan hanya set `is_estimated` saat benar-benar `macro_prior_only`.

### 3.6 Special markets masuk prompt LLM tanpa pembanding odds

**Lokasi:** `lib/syndicate-orchestrator.ts:253-258` (string `specialMarketsStr`)

Fair odds special markets disuntik ke prompt, tapi **tidak** dimasukkan ke `value_bets` di `app/api/agent/route.tsx:365-387`. Jadi tidak ada EV/Kelly untuk pasar ini. LLM bisa merekomendasikan pasar tersebut seolah ada value, padahal cuma fair odds tanpa harga bandar.

**Arah fix:** kalau odds 1xBet untuk pasar itu tersedia, hitung EV seperti 1X2/OU. Kalau tidak tersedia, beri instruksi eksplisit di prompt: "fair odds saja, bukan rekomendasi value". Jangan biarkan LLM menebak edge.

---

## 4. Hygiene & risiko repo

### 4.1 Secret hardcoded masih ada

- `lib/syndicate-orchestrator.ts:69` — fallback `NINE_ROUTER_API_KEY`
- `lib/stats-fetcher-agent.ts:34` — fallback `NINE_ROUTER_API_KEY`
- `lib/1xbet.ts:30` — fallback `RAPIDAPI_1XBET_KEY`

Sudah ada di history sejak `7b01b48`. Harus dirotasi dulu (lihat `GIT_PUSH_BRIEF.md` §2.2). Hapus fallback saja tidak cukup.

### 4.2 Database binary tidak ter-ignore

`.gitignore:51` hanya menutup `data/football_master.db*`. `thestats_dataset.db`, `thestats_raw_vault.db`, dan file `.bak`/`-wal`/`-shm` untracked tanpa ignore. Detail + pola di `GIT_PUSH_BRIEF.md` §2.1.

### 4.3 Layer LLM terduplikasi

Masih ada **3× `createOpenAI`**, **3× `customFetch`**, **2× `extractJSON`**, plus transport manual `call9RouterDirect` di `syndicate-orchestrator.ts:83` yang mem-parse SSE sendiri.

`MODEL_DEFAULT` juga berbeda: `bai/glm-5.3-flash` (orchestrator:71) vs `ag/gemini-3.8-flash` (agent route:56). Dengan `.env.local` aktif hasilnya konsisten, tapi ini bug laten kalau env hilang.

**Arah fix:** satu `lib/llm/client.ts` (satu `customFetch`, satu `createOpenAI`, satu `callModel`, satu `extractJSON`) + satu `lib/llm/models.ts` sebagai sumber tunggal nama model. Ini Fase C.

### 4.4 UPSERT mengubah arti return value

**Lokasi:** `lib/db/sqlite-master.ts:194` dan `:200-216`

`insertMatchRecord` sekarang UPSERT, jadi `Number(result.changes) > 0` selalu true untuk konflik. `insertBatchMatches` menghitung update sebagai "inserted" → angka di log ingest melar. Minor, tapi log ingest jadi tidak bisa dipercaya.

**Catatan tambahan:** `fthg`/`ftag`/`ftr` di UPSERT **tidak** pakai `COALESCE` (selalu menimpa), sedangkan kolom lain pakai. Sengaja untuk koreksi skor, tapi tidak ada guard: source parsial bisa menimpa skor bagus. Pertimbangkan guard `WHERE excluded.fthg IS NOT NULL`.

### 4.5 Barrel `lib/quant` sekarang membawa `node:sqlite`

`lib/quant/index.ts:5` mengekspor `ratings-loader`, yang mengimpor `../db/thestats-dataset` → `node:sqlite`. Aman sekarang karena hanya 2 file yang impor `@/lib/quant` dan keduanya route server (`app/api/agent/route.tsx`, `app/api/betting/route.ts`). Tapi barrel ini tidak bisa lagi dipakai dari client component.

**Arah fix:** pindahkan import DB di `ratings-loader` jadi lazy (di dalam fungsi), atau pisahkan barrel server-only. Minimal: tulis komentar peringatan di `lib/quant/index.ts`.

### 4.6 `MODEL_ARBITER` di `.env.local` tidak terpakai

`MODEL_ARBITER` ada di `.env.local:11` dan `.env.example`, tapi `app/api/agent/route.tsx:62` meng-hardcode `const MODEL_ARBITER = MODEL_JUDGEMENT_1;`. Env-nya dead. Begitu juga `DEEPSEEK_THINKING_MODE` (`.env.local:12`) dan `ODDSPAPI_*` (`.env.local:17-18`) — nol referensi di kode.

**Arah fix:** entah pakai (`process.env.MODEL_ARBITER || MODEL_JUDGEMENT_1`) atau hapus dari `.env.example` biar tidak menyesatkan.

---

## 5. Rencana eksekusi bertahap

Kerjakan berurutan. Jangan gabung fase.

### Fase A — bug inti (kecil, dampak besar)

1. `ratings-loader.ts:246` — buang fallback `|| "E0"`.
2. `ratings-loader.ts:71-119` — tambah alias `G1` (+ audit seluruh 16 div code).
3. `ratings-loader.ts:302,313` — gate telemetry tidak lagi bergantung `divCode`.
4. `app/api/agent/route.tsx:321-335` — `sampleN` dari sample form, bukan H2H.

**Definition of done:** `tsc` bersih; `getShrunkMatchParameters` untuk La Liga mengembalikan `div: SP1`; unit test shrinkage.

### Fase B — kuantitatif

5. `special-markets-engine.ts` — benahi benchmark aerial (3.1).
6. `special-markets-engine.ts:189` — ekspos & pakai sample crosses asli (3.2).
7. `special-markets-engine.ts` — tambah `is_estimated` + tier di corners/cards (3.3).
8. `ratings-loader.ts:326,348` — putuskan & kunci semantik defense (3.4).
9. `ratings-loader.ts:412` — perbaiki `isEstimatedTelemetry` (3.5).
10. `syndicate-orchestrator.ts` — instruksi eksplisit special markets bukan rekomendasi value (3.6).

**Definition of done:** special markets untuk dua tim berbeda menghasilkan angka berbeda; `verify-pl-pipeline.ts` tetap pass; metadata estimasi akurat.

### Fase C — fondasi LLM

11. Buat `lib/llm/client.ts` + `lib/llm/models.ts`.
12. Migrasi 3 konsumen (`syndicate-orchestrator`, `stats-fetcher-agent`, `agent/route`, `betting/route`).
13. Hapus `call9RouterDirect` manual SSE.
14. Satu kebijakan fallback (putuskan: retry model sama vs fallback ke default).

**Definition of done:** `createOpenAI` count 3→1; `customFetch` 3→1; default model konsisten.

### Fase D — data & akurasi lintas liga

15. Sambungkan telemetry ke liga non-EPL saat data tersedia.
16. Walk-forward validation per musim (ratings harus di-rebuild per fold — snapshot saat ini bocor kalau dipakai untuk backtest).
17. Season weighting time-decay saja (keputusan user, belum dikonfirmasi).

---

## 6. Jebakan yang mudah terlewat

- **`ratings-loader.ts` dipakai juga oleh `app/api/betting/route.ts`.** Setiap perubahan signature harus dicek ke dua konsumen.
- **`scripts/migrate-schema.ts` sudah non-destruktif sekarang**, tapi versi lama sempat `DROP TABLE`. Jangan jalankan script migrasi lain tanpa baca dulu.
- **`getTeamRollingTelemetry(name, 6, today)` di agent route memakai `today`** (tanggal wall-clock), bukan tanggal kickoff. Aman untuk analisis pra-laga, tapi **bocor kalau dipakai backtest**. Untuk validasi walk-forward, ganti cutoff ke tanggal laga.
- **`data/thestats_dataset.db` hanya punya PL (20 tim, 60 laga).** Tim non-PL akan gagal resolve → `sample_size: 0`. Itu perilaku benar; jangan dianggap bug.
- **`dixon-coles.ts`, `vig-stripping.ts`, `kelly.ts` sudah diverifikasi benar.** Kalau ada yang mau "memperbaiki" matematikanya, minta bukti numerik dulu.

