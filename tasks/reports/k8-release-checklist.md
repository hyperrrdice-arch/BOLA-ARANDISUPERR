# Daftar Periksa Penerimaan Rilis — K8

- **Kandidat beku:** tip rangkaian `prd/k7-pilihan-rekam` = `5d94d4c`
  (+ artefak rilis K8 di branch `prd/k8-penerimaan-rilis`).
- **Basis:** `b9b3871` (master saat paket PRD dibuat).
- **Sumber daftar:** `04-qa-rilis.md` (D01–D09, Q01–Q04, U01–U08,
  anggaran performa, migrasi/peluncuran/rollback, checklist pemilik).
- **Regresi K8 dijalankan ulang dari kandidat yang sama** (Node v24.22.1,
  checkout worktree bersih): tsc exit 0 · build exit 0 (env placeholder CI) ·
  **547 assertion, semua lolos** — rincian per suite di laporan K8.
- Status: **LULUS** = bukti terukur ada · **TERCATAT** = menyimpang/gap yang
  ditulis apa adanya dengan angka · **MENUNGGU** = memang dirancang berjalan
  sesudah deploy (peninjauan pemilik).

## D01–D09 · Data, API, publikasi

| ID | Status | Bukti |
|---|---|---|
| D01 | LULUS | Suite `test:baseline:d01` 12/12 pada run K8; laporan K1 (2/2 ter-resolve, verdict [hit, miss], rerun idempoten) |
| D02 | LULUS | Suite `test:identity` 58/58 (K8); laporan K1 (4/4 row lama tertelusur, 2 fixture unik) |
| D03 | LULUS | Suite `test:identity` (K8); laporan K1 (leg tak digabung, 4 kasus ambigu → antrean) |
| D04 | LULUS | Suite `test:identity` (K8); laporan K1 (koreksi berversi, piala 90 menit, cancelled → void) |
| D05 | LULUS | Suite `test:publication` 89/89 (K8); laporan K2 (T−1 ms diterima, T/T+1 ms ditolak, 2 worker → 1 keputusan) |
| D06 | LULUS | Suite `test:publication` (K8); laporan K2 (snapshot A 74% tetap; warisan → "Peluang terbit tidak tercatat") |
| D07 | LULUS | Suite `test:publication`/cohort (K8); laporan K2 (9 terbit, 4 dinilai, 75%, cakupan 66,7%, status kosong & 0/5 = 0%) |
| D08 | LULUS | Suite `test:publication` (K8); laporan K2 (crash sesudah paket & sesudah ledger, retry paralel → 1 publikasi, rekonsiliasi intent) |
| D09 | LULUS | Suite `test:tickets` 69/69 (K8); laporan K3 (vektor hit, miss, void, miss, pending; komposisi beku) |
| Kontrak API tambahan (4 endpoint `app/api/{agent,betting,matches,odds}`) | **TERCATAT — tidak diuji di tingkat HTTP** | Tidak ada suite yang memanggil route handler; cakupan yang ada = adapter `lib/web/data.ts` di `test:web` 12/12 + keempat route ter-build (build exit 0). Route ini kode warisan basis, tidak diubah K1–K7. Gap dicatat sebagai pekerjaan lanjutan, bukan ditutup-tutupi. |

## Q01–Q04 · Kebenaran hitung, model, eksperimen

| ID | Status | Bukti |
|---|---|---|
| Q01 | LULUS | Suite `test:quant` 22/22 + `test:tickets` (irisan matriks); laporan K4 (Σ sel = 1 ± 1e-9; 1X2 0,47/0,40/0,13; 1X 0,87; irisan konsisten; produk dua laga 1e-12) |
| Q02 | LULUS | Suite `test:model` 61/61 (fit 2× identik; latih ≥ cutoff ditolak); laporan K4; determinisme eksperimen di laporan K5 |
| Q03 | LULUS | Suite `test:model` (K8); laporan K4 (dua jalur manifest sama; paritas 20 laga Σ\|Δp\| = 0; manifest hilang → berhenti bernama) |
| Q04 | LULUS | Suite `test:model` + `test:tickets` (K8); laporan K4 (gerbang menolak kandidat latih lebih kecil; regenerasi identik 1e-12) + K3 (alias dihitung sekali; tanpa matriks → gabungan NULL beralasan) |

## U01–U08 · Browser dan copy

| ID | Status | Bukti |
|---|---|---|
| U01 | LULUS | Suite `test:ui` 66/66 (K8); laporan K6 (kelompok tanggal lokal, urutan stabil, filter pulih dari URL) |
| U02 | LULUS | Suite `test:ui` (K8); laporan K6 (7 status berlabel; cancelled tak pernah tampil skor — terbukti vs baris beracun 3–3) |
| U03 | LULUS | Suite `test:ui` + `test:rekam` (K8); laporan K6/K7 (75% → irisan 51% → gabungan 35,2% persis contoh dokumen) |
| U04 | LULUS | Suite `test:rekam` 110/110 (K8); laporan K7 (`sudahMulai`: T−1 ms terbuka, tepat T terkunci, bukti peramban langsung) |
| U05 | LULUS | Suite `test:rekam` (K8); laporan K7 (spot-check terprogram halaman vs SQL mentah identik: terbit 12, dinilai 8, tepat 6, rata-rata 0,7125) |
| U06 | LULUS | Suite `test:rekam` + bukti peramban K7: 88 OK / 0 gagal, 24/24 halaman×lebar (320/390/768/1440) tanpa gulir horizontal; laporan K6 (9/9 bersih) |
| U07 | LULUS (1 temuan diperbaiki di K7) | Laporan K7: wilayah `aria-live` kini selalu dirender (commit `6a1a812`); kontras terukur h1/h2 15,41:1, teks 6,32:1 (≥ 4,5). Batas jujur: lintasan keyboard penuh + pembaca layar bersuara tidak dapat dijalankan di VM — yang dibuktikan adalah prasyarat terprogramnya. |
| U08 | LULUS | Suite `test:rekam` (K8); laporan K7 (10 literal lama absen dari sumber, 8 frasa absen dari render 6 halaman; contoh dokumen hanya muncul sebagai data terhitung: 6/8 tepat = 75%, rata-rata terbit 71,3%) |

## Gerbang rilis (migrasi, peluncuran, rollback, pemantauan)

| Gerbang | Status | Bukti terukur (K8) |
|---|---|---|
| Regresi penuh kandidat beku | LULUS | 547 assertion semua suite exit 0; tsc 0; build 0 — run K8 dari `5d94d4c` |
| Backup konsisten + restore teruji | LULUS | `sqlite3 .backup` 4 DB checkout VM (~31 dtk; dataset 3 GB = 29 dtk); restore diverifikasi: integrity ok, jumlah baris sama persis dengan pra-migrasi; full `integrity_check` dataset salinan backup = **ok** (810 dtk di VM ini) |
| Rehearsal migrasi berurutan K1 → K2 | LULUS | Di salinan segar checkout VM: K1 jalan 1 **49 dtk** → 70.420 fixture, 71.832 alias, 70.279 revisi, 32 konflik antrean; jalan 2 **16 dtk** → 0 perubahan (idempoten). K2 jalan 1 **762 dtk** (di bawah beban pemindaian paralel; batas atas) → 7.805 basis `effective`, 163.008 `unknown_legacy`, 468 duplikat tertanda, integrity ok; jalan 2 **4 dtk** → 0 diproses (idempoten). Perbandingan vs bukti lama + penjelasan selisih: laporan K8 §3. |
| Latihan rollback | LULUS | Ujung-ke-ujung di tingkat salinan: **103 dtk** (restore ~1–31 dtk + checkout artefak rilis sebelumnya 2 dtk + verifikasi integrity picks ~100 dtk di bawah beban). Keadaan pra-migrasi terkonfirmasi pulih (kolom `probability_basis` absen, tabel identitas absen, jumlah identik). Rencana rollback deploy: catatan rilis §Rollback. |
| Anggaran performa — jadwal (usulan bab QA: ≤ 8 eksekusi SQL sesudah store terbuka) | **TERCATAT — tidak memenuhi usulan** | Terukur di salinan rehearsal (metode hitung = seluruh store yang disentuh, sesuai bab QA): jendela 46 item → **387** eksekusi; 62 item → **395**; 84 item → **620**. Latensi dinding 16 / 442 / 741 ms di VM 1,5 CPU. Pola N+1 per item lintas store — struktural, tidak hilang hanya dengan hardware lebih besar (latensinya yang membaik). |
| Anggaran performa — baca statistik (usulan: median ≤ 100 ms, p95 ≤ 150 ms, hangat, protokol 10+100) | **TERCATAT — sebagian** | `cohortStats` tanpa filter (170.813 baris): median **342,9 ms**, p95 **393,8 ms** → di luar usulan. Dengan filter yang dipakai halaman: grade A median 78,2 / p95 87,7 ms; sumber `live-run` median 28,8 / p95 39,5 ms → di dalam usulan. Angka VM 1,5 CPU bersama; wajib ukur ulang di hardware produksi (6 vCPU) sesudah deploy. |
| Invalidasi sesudah koreksi | LULUS (tingkat yang teruji) | D04 (suite identity): koreksi menilai ulang pilihan + tiket; K7: statistik berubah 75% → 50% sesudah koreksi pada filter sama. Halaman rekam membaca DB per request dengan klausa WHERE yang sama (tanpa cache TTL terpisah) — uji dua-proses khusus tidak dijalankan di kartu ini. |
| Alur provider hilang / data telat / proses berhenti | LULUS | D08 (crash dua titik + rekonsiliasi intent); U04/K7 (baris jatuh tempo tetap tampil beralasan, termasuk alasan `konflik` dari antrean K1) |
| Utang lint | TERCATAT — bukan regresi | `npm run lint` kandidat: exit 1, **92 error + 5 warning** — jumlah error identik dengan basis `b9b3871`; **nol** error di file yang dibuat/diubah K1–K7 (semua di file warisan: `app/api/*`, `lib/agent/*`, skrip lama). Langkah lint CI memang dipasang terlihat (keputusan K0). |
| Checklist penerimaan pemilik (4 item, bab QA) | MENUNGGU | Dirancang untuk dijalankan pemilik pada hasil yang sudah ter-deploy (urutan pemilik: K8 → deploy ke domain → pemilik melihat → merge). Belum dijalankan di kartu ini. |
| Catatan mandiri 1 — status eksperimen model | TERCATAT | K5: keputusan **RETAIN** κ-fit 10 (held-out H n=6.708: Level B 1,0134 vs 1,0142; Δ +0,00082, UB 95% +0,00159; dua syarat manfaat aturan beku gagal). Kandidat K5 tidak dipromosikan; manifest aktif tidak berubah. |
| Catatan mandiri 2 — paritas GitHub–VPS (refresh-sync) | TERCATAT — menunggu pemilik | Perbaikan telemetri refresh di repo **belum ada** (`build-canonical-telemetry.ts` masih memuat seluruh tabel form sekaligus); status resmi: menunggu patch/SHA tersanitasi dari pemilik; `ARCHITECTURE.md` §8/§10 belum disinkronkan. Mandiri dari penerimaan fitur rilis ini (sesuai catatan bab QA: penerimaan fitur bergantung pada pengujian aplikasinya sendiri). |
| Pembaca form di DB telanjang | TERCATAT | Di DB tanpa refresh, pembaca form lama melempar `no such table: team_match_logs_canonical` (tabel dibangun langkah telemetri refresh produksi). Tercatat di laporan K6; tidak diubah (di luar bedah rangkaian). |

## Vonis

**SIAP RILIS.**

Seluruh gerbang dengan definisi lulus yang tegas di bab QA (D01–D09,
Q01–Q04, U01–U08, regresi penuh, rehearsal migrasi, latihan rollback,
backup/restore) **LULUS dengan bukti terukur**. Tiga hal dicatat terbuka
dan tidak dihaluskan: (1) dua anggaran performa berstatus *usulan* di
bab QA tidak terpenuhi pada VM pengukuran — angkanya tertulis di atas,
dengan kewajiban ukur ulang di hardware produksi + kartu optimasi
lanjutan; (2) uji kontrak HTTP empat endpoint belum ada (cakupan adapter
ada); (3) checklist pemilik memang menunggu deploy. Tidak ada gerbang
berdefinisi-lulus yang gagal.
