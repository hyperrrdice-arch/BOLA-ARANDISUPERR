# Analisis Teknis — Football Agent Syndicate

**Tanggal audit:** 16 Oktober 2026
**Versi codebase:** 1.3.0 (commit `fef3bc5`)
**Auditor:** DeepSeek v4.1 Flash (Lead Orchestrator)
**Scope:** `app/`, `lib/`, `components/`, `scripts/`, konfigurasi repo

---

## 1. Konteks Arsitektur (baseline)

| Layer | Isi |
|---|---|
| **Data historis (offline)** | `data/football_master.db` (SQLite via `node:sqlite`, ~22.394 match, 16 divisi, 4 musim) → `data/calibrated_ratings.json` (~112 KB, 428 klub, 16 liga) |
| **Runtime quant** | `lib/quant/dixon-coles.ts` (bivariate Poisson + τ adjustment), `vig-stripping.ts` (Shin + proportional), `kelly.ts` (EV + fractional Kelly), `ratings-loader.ts` (James-Stein shrinkage `w = n/(n+κ)`, κ=16) |
| **Data feed live** | TheStatsAPI (`lib/stats-cache.ts` → `cachedStatsGet`), 1xBet via RapidAPI (`lib/1xbet.ts`) |
| **AI orchestration** | `lib/stats-fetcher-agent.ts` (dispatcher agent), `lib/syndicate-orchestrator.ts` (Bull/Neutral/Bear + Dual Judge + consensus), `app/api/agent/route.tsx` (pipeline utama) |
| **API routes** | `/api/matches`, `/api/agent`, `/api/odds`, `/api/betting` |
| **UI** | `app/page.tsx` (5 tab analisis), `components/dashboard/*` |
| **Model routing** | 9Router (`NINE_ROUTER_BASE_URL`), model `bai/*` + `ag/*` |

Alur utama:

```
historical CSV → SQLite → calibrated_ratings.json
                                    ↓
user pilih laga → /api/matches → /api/agent
   → fetcher(dispatcher + Zod) → quant(DC + Shin + Kelly) → LLM(syndicate 5 agent + judge)
   → JSON tervalidasi → 5 tab UI
```

---

## 2. Temuan

### P0 — Security & Correctness (wajib duluan)

#### P0-1. API key hardcoded dan sudah ter-commit ke git history

**Lokasi:**
- `lib/1xbet.ts:30` → `const KEY = process.env.RAPIDAPI_1XBET_KEY || "c8267e344fmsh6add4d3eaa51353p1dc5d8jsna8bca937e332";`
- `lib/syndicate-orchestrator.ts:69` → `const API_KEY = process.env.NINE_ROUTER_API_KEY || "sk-7b18b5c31d5d653c-z0q24f-c3542ecc";`
- `lib/stats-fetcher-agent.ts:34` → `apiKey: process.env.NINE_ROUTER_API_KEY || "sk-7b18b5c31d5d653c-z0q24f-c3542ecc",`

**Bukti ter-commit** (dijalankan di repo):

```
git log --oneline -S "c8267e344fmsh6add4d3eaa51353p1dc5d8jsna8bca937e332" --all
  → 7b01b48 (initial release), 85554bc (v1.2.0), fef3bc5 (v1.3.0)

git log --oneline -S "sk-7b18b5c31d5d653c" --all
  → 7b01b48, 85554bc, fef3bc5
```

**Dampak:** kredensial RapidAPI (1xBet) dan 9Router gateway bocor permanen di git history. Siapa pun yang punya akses repo bisa memakai kuota berbayar. `.gitignore` sudah menutup `.env*`, tapi fallback string di source tidak tertutup.

**Perbaikan (urutan wajib):**
1. **Rotate kedua key sekarang** (RapidAPI dashboard + 9Router). Anggap key lama sudah burned.
2. Hapus fallback literal → `throw new Error("RAPIDAPI_1XBET_KEY tidak dikonfigurasi")` / `throw new Error("NINE_ROUTER_API_KEY tidak dikonfigurasi")`.
3. Kalau repo publik atau akan publik: purge history (`git filter-repo` atau BFG) lalu force-push. Kalau repo privat dan key sudah dirotasi, purge opsional.

---

#### P0-2. Parameter `rho` inkonsisten antar path fallback

**Lokasi:**
- `lib/quant/dixon-coles.ts:137` → `const rho = Number.isFinite(input.rho) ? input.rho : -0.13;` (default engine, sesuai referensi Dixon-Coles)
- `lib/quant/ratings-loader.ts:219` → `rho: -0.04` (di `defaultFallback`)
- `lib/quant/ratings-loader.ts:238` → `rho: Number.isFinite(league.rho) ? league.rho : -0.04`
- `lib/quant/ratings-loader.ts:288` → `rho: Number.isFinite(league.rho) ? league.rho : -0.04`

**Dampak:** 3 nilai fallback berbeda (`-0.13` vs `-0.04`) untuk parameter korelasi skor rendah. Output `tau(x,y)` untuk skor (0,0), (0,1), (1,0), (1,1) jadi bergantung path eksekusi, bukan pada data. Misal laga tanpa data kalibrasi dapat `rho` berbeda dari laga tercalibrasi yang kehilangan field `rho`.

**Perbaikan:** tetapkan satu konstanta (nilai literatur DC 1997 ≈ `-0.13`, atau nilai hasil kalibrasi liga) dan pakai di semua cabang. Tambahkan test yang mengunci nilainya.

---

#### P0-3. Timeout tidak konsisten pada pemanggilan LLM di pipeline utama

**Lokasi:**
- `lib/syndicate-orchestrator.ts:83-193` → `call9RouterDirect` sudah punya `AbortController` + `setTimeout(controller.abort(), timeoutMs)` (default 180s).
- `app/api/agent/route.tsx:260-282` → `callModelWithFallback` memakai `generateText` dari AI SDK **tanpa** `abortSignal` / timeout.
- `lib/stats-fetcher-agent.ts:119-135` → dispatcher punya race timeout 2500 ms (ini sudah benar).

**Dampak:** jalur narasi utama (`MODEL_JUDGEMENT_1`) bisa menggantung tanpa batas atas eksplisit kalau gateway tidak membalas. Di Vercel/serverless ini berujung pada fungsi yang mati di limit platform dengan error yang tidak informatif, dan user melihat loading tak berujung.

**Perbaikan:** bungkus `generateText` dengan `AbortSignal.timeout(N)` atau race timeout seperti pola dispatcher. Sinkronkan budget timeout antar layer (fetcher 2.5 s, quant ~0 s, LLM mis. 60–90 s).

---

#### P0-4. Liga tak dikenal diam-diam memakai parameter EPL

**Lokasi:**
- `lib/quant/ratings-loader.ts:209` → `const divCode = resolveDivCode(options.leagueHint) || "E0"; // Default ke EPL jika tidak dikenal`
- `lib/quant/ratings-loader.ts:224` → cabang lain hanya mengembalikan `defaultFallback` (`isCalibrated: false`).

**Dampak:** dua perilaku berbeda untuk kasus "liga tidak dikenal". Kalau `resolveDivCode` gagal (alias tidak ketemu) → jatuh ke `E0`, sehingga `leagueAvgGoals` dan `homeAdvantage` Premier League dipakai untuk liga yang sangat berbeda (Eredivisie, Primeira Liga, Süper Lig). Ini menghasilkan λ/μ yang sistematis bias, dan `isCalibrated` tetap `true` di `metadata` sehingga bias tidak terlihat di UI.

**Perbaikan:** kalau div code tidak ter-resolve, jangan default ke E0. Set `isCalibrated: false`, pakai rata-rata gol generik (1.35) + `homeAdvantage` generik, dan tandai `homeSource/awaySource: "fallback"` supaya bisa ditampilkan sebagai peringatan di `DataIntegrityShield`.

---

### P1 — Leverage Kualitas Keputusan

#### P1-1. Tidak ada backtest: klaim akurasi model tidak terbukti

**Kondisi:** `data/football_master.db` berisi ~22.394 match, `scripts/calibrate-ratings.ts` menghasilkan parameter in-sample. Tidak ada skrip yang mengukur performa prediktif keluar-sampel.

**Dampak:** semua angka `+EV`, `edge_rating: "EXCELLENT"`, dan `recommended_stake_percentage` bergantung pada asumsi modelnya benar. Tanpa metrik (Brier score, log-loss, ROI) tidak ada cara membedakan edge asli dari mis-kalibrasi.

**Perbaikan:** tambah `scripts/backtest.ts` dengan **walk-forward validation**:
1. Kalibrasi memakai musim `N-3..N-2`.
2. Prediksi musim `N-1` (out-of-sample, hanya data lampau — tanpa look-ahead).
3. Bandingkan dengan hasil aktual: Brier score, log-loss, akurasi 1X2, kalibrasi reliabilitas (reliability curve).
4. Simulasi ROI: pasang Kelly pada clossing odds historis, hitung yield + max drawdown + jumlah bet.

Database sudah menyimpan closing odds (`pinnacle`, `bet365`) per match di tabel `matches`, jadi bahan backtest sudah ada — tidak perlu data baru.

---

#### P1-2. Tidak ada tracking hasil / CLV (closed loop)

**Kondisi:** pipeline hanya menghasilkan rekomendasi one-shot. Tidak ada penyimpanan pick, tidak ada pembandingan ke closing line.

**Dampak:** sistem tidak punya mekanisme belajar. Parameter shrinkage `KAPPA = 16` (`lib/quant/ratings-loader.ts:244`) dan cap Kelly (`maxStakeCap = 4.0`) adalah angka pilihan tangan, bukan hasil optimasi pada data sendiri. Tidak ada bukti sistem profitable.

**Perbaikan (minimum viable):**
1. Tabel `picks` di SQLite: `match_id`, `market`, `selection`, `odds_taken`, `model_prob`, `stake`, `created_at`.
2. Tabel `closing_odds`: `match_id`, `market`, `selection`, `closing_price`, `captured_at`.
3. Endpoint/skrip evaluasi: hitung **CLV** = `(odds_taken / closing_price - 1)`, plus realized ROI setelah hasil diketahui.

CLV adalah prediktor profit paling jujur dan tidak butuh sampel besar (beda dengan ROI mentah). Data ini juga bisa dipakai men-tuning `κ` dan cap stake secara empiris.

---

#### P1-3. Engine tidak memakai sinyal non-gol

**Kondisi:** input λ/μ hanya dari attack/defense historis + rata-rata gol form live (`getShrunkMatchParameters`). Lineup, cedera, dan shot quality tidak masuk ke estimasi λ/μ — hanya dipakai LLM untuk narasi.

**Dampak:** tim kehilangan striker utama tetap diberi attack rating historis. `npxg` di output (`route.tsx:499-501`) hanya meng-echo `dcOutput.lambda`, bukan xG kualitas tembakan asli.

**Catatan prioritas rendah:** shrinkage κ=16 sudah meredam sebagian. Kalau dikerjakan, cara paling bersih adalah menjadikan xG rata-rata sebagai estimator attack menggantikan gol mentah — bukan menambah layer koreksi ad-hoc di atas DC.

---

### P2 — Simplifikasi (dampak terbesar pada jumlah kode)

#### P2-1. `app/api/agent/route.tsx` 706 baris, mayoritas boilerplate narasi statis

**Bukti:** prompt di `route.tsx:441-538` menyuruh LLM mengisi JSON, tapi banyak field di-hardcode sebagai string literal placeholder:

```
route.tsx:480   "klasemen": "Posisi klasemen kompetisi reguler"
route.tsx:483   "asian_handicap": "Pasar handicap seimbang"
route.tsx:484   "over_under": "Line Total Gol 2.5"
route.tsx:486   "pergerakan_smart_money": "Aliran dana pasar stabil"
```

Lalu `route.tsx:552-681` melakukan `safeParse` → kalau gagal, melakukan merge manual ~100 baris yang sebagian besar mengembalikan nilai yang sama dengan template.

**Analisis:** LLM pada dasarnya hanya memparafrase angka yang sudah dihitung deterministic quant engine (`quantPackage` langsung di-inject balik di `route.tsx:554` sebagai `quant_engine`). Nilai tambah LLM terbatas pada `prediksi.alasan`, `konsensus_panel`, dan narasi `syndicate_debate` (yang sudah dihasilkan terpisah oleh `orchestrate5AgentSyndicate`).

**Perbaikan:** susun objek `analisis` secara deterministik dari `intel + quantPackage + syndicateDebate`; sisakan **satu** panggilan LLM untuk ringkasan narasi pendek. Konsekuensi: `AnalysisSchema` (~190 baris) dan blok merge fallback (~100 baris) bisa dihapus atau diperkecil drastis; route turun ke ~150 baris; latency berkurang; surface hallucination hilang.

---

#### P2-2. Type safety lemah di orchestrator

**Lokasi:**
- `lib/syndicate-orchestrator.ts:214-219` → `intel: any; quantPackage: any;`
- `lib/syndicate-orchestrator.ts:220-251` → belasan akses `dc?.field ?? default`

**Kondisi:** `VerifiedMatchIntelligence` sudah ada dan tersedia dari `lib/stats-validator.ts`, dan `quantPackage` dibentuk deterministik di route.

**Perbaikan:** ganti `any` dengan tipe eksplisit. Efeknya: mismatch field terdeteksi saat compile, bukan jadi `undefined` yang jatuh ke default secara silent (yang saat ini menyamarkan bug data).

---

### P3 — Performance, Biaya, dan Abuse

#### P3-1. Cache hanya in-memory: tidak efektif di serverless

**Lokasi:**
- `lib/stats-cache.ts:21-36` → cache disimpan di `globalThis.__theStatsApiCache` (Map).
- `lib/1xbet.ts:10-27` → `memoryCache` Map terpisah, plus `fetch(..., { next: { revalidate: 3600 } })` di `1xbet.ts:39` (dua mekanisme cache berbeda untuk resource yang sama).

**Dampak:** di deploy serverless (Vercel), tiap instance/cold start punya Map kosong. Hit rate nyata jauh di bawah angka `getStatsCacheMetrics()`, dan kuota TheStatsAPI/1xBet bisa habis jauh lebih cepat dari perkiraan. Metrik `cacheMetrics` yang ditampilkan UI (`savedCalls: metrics.hits`) juga menyesatkan di konteks multi-instance.

**Perbaikan:** pindahkan cache ke penyimpanan bersama (Vercel KV / Upstash Redis) dengan TTL, atau minimal pakai `unstable_cache` Next untuk hasil fetch. Satukan mekanisme cache TheStatsAPI dan 1xBet supaya konsisten.

---

#### P3-2. Biaya & latency: 7 panggilan LLM per analisa, `max_tokens` 16384

**Lokasi:**
- `lib/syndicate-orchestrator.ts:271-296` → Stage 1: 3 model paralel.
- `lib/syndicate-orchestrator.ts:355-372` → Stage 2: 2 model paralel.
- `lib/syndicate-orchestrator.ts:87-88` → `maxTokens = 16384`, `timeoutMs = 180000`.
- `app/api/agent/route.tsx:541-548` → ditambah 1 panggilan (`MODEL_JUDGEMENT_1`) secara paralel.

**Dampak:** total 6–7 panggilan LLM, masing-masing dengan plafon 16k token output dan timeout 180 detik. Untuk output JSON pendek, plafon 16k token adalah pemborosan konfigurasi dan memperbesar peluang timeout. Secara struktur, Stage 1 dan Stage 2 sebenarnya bisa digabung dalam satu wave paralel.

**Perbaikan:**
1. Turunkan `max_tokens` sesuai kebutuhan output JSON riil (mis. 1500–3000) dan timeout ke 60–90 s.
2. Tambahkan cache hasil analisa per `match_id` + TTL supaya request berulang untuk laga sama tidak mengulang 7 panggilan.
3. Ubah UI ke **SSE streaming per-stage** agar user melihat progres alih-alih menunggu 1–2 menit tanpa umpan balik.

---

#### P3-3. `GET /api/agent` tanpa rate limit

**Lokasi:** `app/api/agent/route.tsx:287-297` — hanya memvalidasi keberadaan `match_id`.

**Dampak:** satu klien yang melakukan loop dapat menghabiskan kuota TheStatsAPI dan kredit 9Router, sekaligus menahan fungsi serverless.

**Perbaikan:** throttle berbasis IP (mis. token bucket sederhana atau Upstash Ratelimit). Batasi juga konkurensi request analisa berat.

---

### P4 — Testing

#### P4-1. Tidak ada test runner sama sekali

**Bukti:** `package.json:5-17` hanya memiliki `dev`, `build`, `start`, `lint`, `backup:*`, `restore:*`. Tidak ada `test`. Direktori `scripts/` berisi banyak skrip `test-*.ts`, tetapi itu skrip manual sekali-jalan, bukan suite yang dijalankan otomatis (dan tidak semuanya assertion-based).

**Kondisi math yang paling butuh kunci regresi:**
- `lib/quant/dixon-coles.ts` → jumlah seluruh probabilitas matriks harus 1.0; `P(home)+P(draw)+P(away)` = 1.0; fair odds = 1/p.
- `lib/quant/vig-stripping.ts` → `stripVigShin(...).fair_prob` harus berjumlah 1.0 (toleransi numerik); kasus odds degenerat harus jatuh ke `proportional`, bukan NaN.
- `lib/quant/kelly.ts` → `full Kelly f* = EV/(O-1)`; `recommended_stake_percentage ≤ maxStakeCap`; total alokasi portofolio ≤ `matchBankrollCap`.
- `lib/quant/ratings-loader.ts` → tim promosi terdeteksi dari kasta kedua; `rho` terkunci pada satu nilai (lihat P0-2).

**Perbaikan:** `node --test` (built-in, tanpa dependency baru) + `scripts/quant.test.ts` dengan case oracle. Ini pekerjaan murah yang langsung menutup risiko regresi pada logika paling kritis.

---

## 3. Yang sengaja TIDAK diusulkan

| Usulan | Alasan skip |
|---|---|
| Microservices / pisah jadi service terpisah | Monolith Next.js sudah cukup untuk skala ini; menambah boundary tanpa kebutuhan. |
| ORM (Prisma/Drizzle) | `node:sqlite` + query terindeks sudah memenuhi; ORM hanya menambah dependency dan abstraksi. |
| State manager (Redux/Zustand) | `useState` + `useMemo` di `page.tsx` sudah memadai. |
| Layer design token baru | `design-system/` sudah ada dan konsisten. |
| Ganti 9Router dengan provider langsung | Fleksibilitas multi-model 9Router adalah fitur inti (independensi judge). |

---

## 4. Rekomendasi Urutan Eksekusi

| Urutan | Paket | Estimasi | Alasan |
|---|---|---|---|
| 1 | **P0** (rotate key + hapus fallback, rho, timeout, div fallback) | ~1 jam | Risiko keamanan aktif + bug parameter yang mengubah output |
| 2 | **P4** (test runner `node --test`) | ~2 jam | Mengunci P0-2 dan mencegah regresi math selanjutnya |
| 3 | **P2** (determinisasi `analisis`, buang boilerplate LLM) | ~0.5 hari | Kode berkurang paling banyak; latency dan hallucination turun |
| 4 | **P1** (backtest walk-forward + tracking CLV) | ~1–2 hari | Baru relevan kalau klaim profitabilitas mau dipertanggungjawabkan |
| 5 | **P3** (cache bersama, turunkan token/timeout, rate limit, SSE) | ~1 hari | Optimasi biaya & UX; bergantung pada volume pemakaian nyata |

---

*Dokumen ini dihasilkan dari audit statis source (`app/`, `lib/`, `components/`, `scripts/`) dan verifikasi git history pada commit `fef3bc5`.*
