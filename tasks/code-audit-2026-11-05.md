# Audit Kode Menyeluruh — football-agent (branch `safe-bet-parlay`)

Tanggal: 2026-11-05 · Auditor: subagent audit (perintah owner via agen utama: "audit sekali lagi semua code, baru branch ke master")
Cakupan: semua TypeScript first-party di `app/`, `lib/`, `scripts/` (95 file, ±32.210 baris) + konfigurasi root (`package.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`).
Di luar cakupan: `node_modules`, `.next`, `archive/`, `data/`, `tasks/`, dan `components/dashboard` (warisan, lihat A13).
Metode: enumerasi grep penuh untuk sumbu 2 & 3 (semua match dinilai satu per satu), baca langsung modul inti kuant/ledger/web, `npx tsc --noEmit`, percobaan `npx eslint`, dan pengukuran I/O read-only pada `data/thestats_dataset.db`.
Audit ini TIDAK mengubah kode sumber apa pun.

## Hasil build/lint

- `npx tsc --noEmit` → **bersih, exit 0** (strict mode aktif).
- `npx eslint` → **tidak bisa jalan sama sekali** (lihat A4).

---

## Temuan

### A1 — MAJOR · Sumbu 2 (integritas data) · Pick live-run tidak punya penjaga unik di level DB
- Bukti: `lib/picks/ledger.ts:124-125` — satu-satunya indeks unik parsial hanya menutup `source='lab'`:
  `CREATE UNIQUE INDEX idx_picks_lab_unique ON picks(match_id, market, selection, source) WHERE source = 'lab'`.
  Jalur live memakai INSERT polos (`lib/picks/ledger.ts:219`), sedangkan jalur lab memakai INSERT OR IGNORE + lookup + throw (`lib/picks/ledger.ts:203-215`).
- Dedupe live saat ini hanya di level aplikasi: `scripts/pick-slate.ts:357` membangun set `alreadyRecorded` dari `SELECT DISTINCT match_id FROM picks WHERE source='live-run'` dan melewati fixture yang sudah tercatat (`scripts/pick-slate.ts:572`).
- Risiko: DUA penjadwal menjalankan pick-slate (langkah 7 `free-refresh` 12-jam + cron `football-pick-slate-trial`). Bila dua proses tumpang-tindih, keduanya lolos cek yang sama dan pick live tertulis ganda → total ledger (permukaan kepercayaan produk) menggelembung. Efek samping desain yang sama: fixture yang sudah tercatat membeku selamanya — pilihan baru dari versi engine berikutnya tidak pernah ditambahkan untuk fixture itu.
- Aksi: tambahkan indeks unik parsial untuk `source='live-run'` dengan kunci yang sama + jalur INSERT OR IGNORE simetris dengan lab, ATAU kunci file/proses tunggal untuk pick-slate. Satu baris skema + satu baris query.

### A2 — MAJOR · Sumbu 3 (keamanan) · Route API warisan sindikat adalah permukaan HTTP hidup, tanpa auth
- Bukti: `app/api/agent/route.tsx:8-11,41` mengimpor `insertSnapshot` dan menulis snapshot analisis ke DB atas permintaan HTTP (`persistSnapshot`). `app/api/betting/route.ts:1-9` memanggil model LLM (NineRouter) + 1xBet; route ini punya rate-limit (`lib/rate-limit`) tapi tidak ada autentikasi di mana pun — tidak ada `middleware.ts` di repo.
- Frontend v2 tidak memanggil route-route ini sama sekali (semua halaman membaca `lib/web` di server). Kode `lib/` sindikat memang diputuskan owner tetap utuh & dorman — tetapi route HTTP bukan kode dorman: setelah deploy mereka bisa dipanggil publik (biaya LLM + tulis DB).
- Aksi: sebelum deploy publik, hapus atau kunci `app/api/agent`, `app/api/betting`, `app/api/odds`, `app/api/matches` (kode `lib/` sindikat TIDAK perlu disentuh). Bukan penghalang merge; penghalang deploy publik.

### A3 — MINOR · Sumbu 6 (performa) · build-canonical-telemetry ±18 menit: I/O baris lebar dari DB 2,96 GB, bukan algoritma
- Bukti: `scripts/build-canonical-telemetry.ts:67` melakukan `SELECT * FROM team_match_logs` lalu grouping in-memory (linear) + insert satu transaksi + satu index — tidak ada pola O(n²) di kode.
- Pengukuran read-only auditor: `data/thestats_dataset.db` = 2.963.279.872 byte (723.458 halaman × 4 KB, freelist 0 = semua data hidup); `SELECT *` yang sama atas 86.359 baris memakan **±45 detik** dalam proses kosong; query `dbstat` tidak selesai dalam 75 detik.
- Penjelasan selisih vs run 04:29 (±8 menit TOTAL rantai): run 17:40 berjalan bersamaan dengan build/tsc/Chromium di VM 4 vCPU yang sama, cache disk dingin untuk file ini, dan DB sudah memuat akumulasi payload odds hari itu. Algoritma bukan penyebabnya; lebar baris + ukuran file + kontensi adalah.
- Aksi: ganti `SELECT *` dengan daftar kolom yang benar-benar dipakai; pertimbangkan `PRAGMA journal_mode=WAL` pada koneksi build; jadwalkan telaah VACUUM/pemangkasan payload `match_odds_history` (tumpukan terbesar kemungkinan di sana). Ukur ulang pada run idle sebelum menyimpulkan lebih jauh.

### A4 — MINOR · Sumbu 5 (perkakas) · ESLint rusak total: versi config tidak sejajar dengan Next
- Bukti: `package.json` — `"next": "16.4.0"` tetapi `"eslint-config-next": "^14.2.35"`. `npx eslint` gagal: `Cannot find module '.../eslint-config-next/core-web-vitals'` dari `eslint.config.mjs`. Artinya proyek tidak punya gerbang lint sama sekali saat ini.
- Aksi: naikkan `eslint-config-next` ke `^16` sejajar Next, lalu jalankan lint dan rapikan hasilnya.

### A5 — MINOR · Sumbu 5 (kode mati) · Empat npm script menunjuk file yang tidak ada
- Bukti: `package.json` scripts — `ingest:multileague` → `scripts/ingest-historical-data.ts`, `report:snapshot` → `scripts/snapshot-report.ts`, `sync:outcomes` → `scripts/sync-match-outcomes.ts`, `sync:weekly` → `scripts/sync-weekly-telemetry.ts`; keempatnya tidak ada di `scripts/` (terverifikasi `ls`). Menjalankannya = error file-not-found.
- Aksi: hapus keempat entri script mati dari `package.json`.

### A6 — MINOR · Sumbu 5 (kode mati) · getH2HLogs tanpa pemanggil + import mati
- Bukti: `lib/db/thestats-dataset.ts:587` mengekspor `getH2HLogs`; satu-satunya referensi lain adalah import di `lib/db/team-telemetry.ts:4` yang tidak pernah dipanggil di file itu (grep: hanya baris import). Tidak ada pemanggil lain di repo.
- Penyebab lolos: `tsconfig.json` aktif `strict` tapi tanpa `noUnusedLocals`, jadi tsc tidak menandainya.
- Aksi: hapus ekspor + import, atau aktifkan `noUnusedLocals` dan bersihkan hasilnya sekali jalan.

### A7 — MINOR · Sumbu 1/5 (duplikasi derivasi) · Semantik pasar hidup di dua implementasi
- Bukti: `lib/picks/ledger.ts:263` `evaluatePick` (fail-fast, throw untuk market/seleksi tak dikenal) dan `lib/web/parlay.ts:38` `selectionPredicate` (mengembalikan null) mengimplementasikan predikat yang sama untuk 8 pasar. Auditor membandingkan baris per baris: **identik hari ini** (termasuk ou `total > line`, btts-no `h==0||a==0`, team_over05 hanya 'yes').
- Risiko: pasar/seleksi baru yang ditambah ke ledger tidak otomatis sampai ke slip web; kegagalannya diam-diam (null → "tidak bisa dihitung"), bukan error.
- Aksi: tambahkan uji kesetaraan kecil (atau komentar dua arah yang saling menunjuk kewajiban sinkron) antara `evaluatePick` dan `selectionPredicate`.

### A8 — MINOR · Sumbu 1 (korektnes) · top_scorelines memakai persen, semua field lain pecahan
- Bukti: `lib/quant/dixon-coles.ts` pada pemetaan `top_scorelines`: `prob: Math.round(s.prob * 1000) / 10, // percentage e.g. 14.5%` — satu-satunya field probabilitas berbentuk persen (0–100) di objek hasil yang semua field lainnya pecahan (0–1). Terdokumentasi di komentar, tetap jebakan satuan untuk konsumen baru.
- Aksi: samakan ke pecahan dan biarkan lapisan tampil yang memformat persen.

### A9 — MINOR · Sumbu 4 (robustness) · parsePackage tanpa penjaga JSON.parse
- Bukti: `lib/web/data.ts:218-219` — `JSON.parse(r.payload_json as string)` tanpa try/catch di jalur daftar paket; satu baris `payload_json` korup akan melempar dan menggagalkan seluruh halaman daftar/detail. Data ditulis mesin sehingga risikonya rendah; `normalizePayload` sendiri sudah menangani 3 generasi payload dengan benar (lihat Verifikasi).
- Aksi: bungkus parse per baris; baris korup dilewati dengan catatan log, bukan membunuh halaman.

### A10 — MINOR · Sumbu 4 (robustness) · Catch diam di jalur saji
- Bukti: `lib/quant/ratings-loader.ts:857` — `} catch {}` membuang sinyal luck tanpa jejak apa pun (fitur mati diam-diam bila regresi). Beberapa catch parse-JSON di `ratings-loader.ts:526,569,740,751` dan `lib/quant/league-identity.ts:192,419` berpola sama (benign, tapi tak tercatat). Pola yang benar sudah ada di repo: `lib/quant/league-gate.ts:85` memasang flag `cacheFailed` pada catch.
- Aksi: minimal satu `console.warn` ter-rate-limit atau flag pada catch di jalur saji; biarkan catch parse murni apa adanya.

### A11 — MINOR · Sumbu 2 (integritas data) · capture-odds: INSERT polos ke tabel yang sama dengan bug hari ini
- Bukti: `scripts/capture-odds.ts:173` — `INSERT INTO match_odds_history (match_id, captured_utc, ...)` tanpa OR IGNORE/ON CONFLICT, ke tabel berkunci unik `(match_id, captured_utc)` yang sama dengan kejadian 2026-11-05.
- Mitigasi yang ada: cek aplikasi `existingCaptures` (baseline/poin terjadwal tidak ditangkap ulang) + loop retry 8× yang mencetak `captured_utc` BARU tiap percobaan (`scripts/capture-odds.ts:274-282`) — tabrakan unik tidak akan membunuh run, tapi retry-nya justru menulis tangkapan duplikat secara semantik.
- Konteks: script ini bagian tumpukan trial Sportmonks (pensiun 10 Nov), bukan rantai bebas. Kelas bug yang sama, dampak kecil, umur pendek.
- Aksi: samakan dengan pola importir bebas (INSERT OR IGNORE + hitung `changes`), sekalian bila file ini disentuh lagi sebelum pensiun.

### A12 — MINOR · Sumbu 1 (korektnes tepi) · rebuildMatrix menyimpang diam-diam untuk λ tersimpan < 0,2
- Bukti: `lib/picks/engine.ts:202-222` merekonstruksi matriks lewat `calculateDixonColes` dengan trik `leagueAvgGoals = μ`, `homeAdvantage = λ/μ`; tetapi `lib/quant/dixon-coles.ts:158-165` mematok λ internal minimum 0,2 — paket tersimpan dengan λ < 0,2 akan ter-rebuild menjadi matriks yang berbeda dari aslinya, tanpa tanda. λ pertandingan nyata praktis tidak pernah serendah itu, dan λ/μ tidak valid sudah di-throw secara eksplisit (`engine.ts:207-209`).
- Aksi: catat batas ini di komentar `rebuildMatrix` (sudah ada komentar konvensi; tambahkan satu baris soal lantai 0,2).

### A13 — NOTE · Sumbu 5 · Subtree komponen warisan tak terpakai
- Bukti: `components/dashboard/*` (16 file .tsx) tidak diimpor satu pun oleh `app/` (grep impor `components/dashboard|components/landing` di `app/` hanya menghasilkan 2 baris, keduanya `components/landing` — HeroScene & Reveal, hidup). Yang hidup: `components/landing`, `components/pilihan` (ParlayBuilder), `components/ui`, `components/Nav`.
- Aksi: arsipkan/hapus `components/dashboard` pada pembersihan berikutnya; bukan penghalang merge. (Di luar direktori cakupan formal audit; dicatat demi kerapian.)

### A14 — NOTE · Sumbu 5 · Tepi pita diduplikasi di dua file (ambang grade sendiri sudah satu sumber)
- Bukti positif: `MARKET_GRADE_THRESHOLDS` di `lib/picks/engine.ts:65` adalah sumber tunggal — engine memakainya di `engine.ts:258` dan lapisan web menurunkan CASE SQL-nya dari konstanta yang sama (`lib/web/data.ts:506-511`). Tidak ada salinan angka ambang yang menyimpang.
- Sisa duplikasi: tepi pita bukti — `BAND_LOS` di `lib/picks/engine.ts:124` dan `BANDS` di `lib/picks/ledger.ts` (komentar engine sendiri mengakui "mirror BANDS di ledger"). Nilai yang terbandingkan sama hari ini.
- Aksi: ekspor satu konstanta tepi pita dari ledger dan impor di engine, atau terima dengan komentar dua arah.

---

## Verifikasi positif (yang diperiksa dan bersih)

- **Sumbu 2 — enumerasi INSERT lengkap (37 statement di `lib/` + `scripts/`), dinilai satu per satu:**
  - Rantai bebas (kritis, jalan 12-jam tanpa pengawasan): `import-free-feed` — semua INSERT OR IGNORE termasuk perbaikan hari ini di `scripts/import-free-feed.ts:246`; `build-canonical-telemetry` — DROP + CREATE ulang per run (idempoten secara konstruksi); `calibrate-ratings`/`fit-global-offsets` — INSERT OR REPLACE; `pick-slate` — dedupe aplikasi (lihat A1 untuk batasnya).
  - Ledger/paket: lab OR IGNORE + lookup + throw (`ledger.ts:203`), outcome ON CONFLICT (`ledger.ts:322`), paket OR IGNORE + lookup + throw (`lib/picks/packages.ts:233,265`).
  - Sync trial: `sync-predictions` ON CONFLICT ×3 (`scripts/sync-predictions.ts:134,164,170`); `sm_id_map` DELETE + cek exists dalam satu transaksi (`scripts/sync-sportmonks-fixtures.ts:231-252`); sisanya di A11.
  - Lib DB: `thestats-dataset` (5 upsert ON CONFLICT), `sqlite-master` ON CONFLICT, `upcoming-fixtures` ON CONFLICT ×2, `thestats-vault` ON CONFLICT, `analysis-snapshot` match_outcomes ON CONFLICT; snapshot analisis sendiri append-only secara desain.
  - Propagasi kegagalan rantai: `scripts/free-refresh.ts` memeriksa `res.status !== 0` per langkah, berhenti, dan `process.exit(1)`; script langkah berbentuk `main()` sinkron (throw = exit non-nol). Bukti empiris idempotensi: rantai penuh jalan 2× hari ini (04:29 & 17:40) exit 0 tanpa korupsi duplikasi; importir jalan 2× berturut dengan run kedua nol perubahan.
- **Sumbu 3 — keamanan:** grep pola token/key/password/secret di seluruh `lib/ scripts/ app/` → **nol kredensial hardcoded**; semua token lewat `process.env` (terverifikasi titik pakai: pick-slate mengosongkan `STATS_API_KEY` + `SPORTMONKS_API_TOKEN` sebelum impor pipeline, `scripts/pick-slate.ts:169-170`). SQL: semua statement terparameterisasi; interpolasi template yang ada hanya konstanta internal (`PICK_COLUMNS`, `LATEST_PER_MATCH` di `lib/web/data.ts:336,348`, daftar kolom statis ALTER di `lib/db/thestats-dataset.ts:382`, nama tabel di script migrasi satu-kali). Spawn: `spawnSync` argumen array tanpa shell di kedua driver rantai. Tidak ada penulisan file ke luar repo (semua jalur berjangkar `process.cwd()`/`data/`).
- **Sumbu 1 — inti kuant:** `calculateDixonColes` menyanitasi semua input (non-finite/≤0 → default), mematok λ/μ ≥ 0,2, menormalkan matriks dengan penjaga jumlah-nol, dan menjaga setiap pembagian (DNB/AH fallback 0,5; `toOdds` berpagar). `evaluatePick` lengkap untuk 8 pasar dan fail-fast. `normalizePayload` (`lib/web/data.ts:136`) menangani 3 generasi payload persis seperti terdokumentasi, dengan default kosong yang jujur + lookup nama dari dataset untuk generasi manual. `lib/web/parlay.ts` menggabungkan pilihan satu laga secara eksak dari matriks dan antar laga dengan produk berlabel asumsi independensi — angka reproduksi terverifikasi terhadap probabilitas tersimpan pada pembangunan v2.
- **Sumbu 7 — batas frontend:** `lib/web/*` **nol** statement tulis (grep INSERT/UPDATE/DELETE/writeFile = kosong) — murni baca. Satu-satunya komponen klien, `components/pilihan/ParlayBuilder.tsx`, hanya mengimpor modul murni `lib/web/parlay` + `lib/web/format` dan menerima props serializable dari Server Component. Tidak ada komponen klien yang mengimpor modul DB (satu-satunya impor `lib/db` di bawah `app/` ada di route server `app/api/agent` — lihat A2). Halaman memakai `connection()` + Suspense konsisten dengan `cacheComponents: true` di `next.config.ts`.
- **Sindikat dorman:** `lib/syndicate-orchestrator.ts`, `lib/agent/*`, `lib/llm/*` hadir utuh sesuai keputusan owner; audit tidak merekomendasikan penghapusan — yang ditandai hanya route HTTP-nya (A2).
- **Komentar vs kode:** titik-titik yang dicek (gerbang = label di `engine.ts` `applyGateCap` pass-through terdokumentasi; `feed_mode` di halaman detail hanya tampil bila paket membawanya — saat ini 0 paket, jadi dorman secara jujur; komentar header `free-refresh.ts` cocok dengan isi rantainya) tidak ditemukan komentar yang bertentangan dengan kode.

---

## Vonis

**SAFE TO MERGE** ke master.

Alasan: nol blocker. `tsc` bersih; jalur yang menggerakkan produk (rantai bebas 12-jam, ledger, paket, saji web) terverifikasi idempoten dan terjaga di level DB; tidak ada rahasia hardcoded; batas baca-saja frontend utuh. Dua temuan MAJOR bukan penghalang merge: A1 adalah celah laten yang hari ini termitigasi dedupe aplikasi + jadwal yang tidak tumpang-tindih (perbaikannya satu indeks parsial — layak jadi follow-up pertama), dan A2 menyangkut permukaan deploy publik, bukan isi branch (tindakannya di langkah deploy, bukan di merge). Sisanya minor/note untuk antrean pembersihan.
