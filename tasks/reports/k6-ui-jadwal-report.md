# Laporan Kartu K6 — UI Jadwal, Beranda, Detail

- **Branch:** `prd/k6-ui-jadwal` (bertumpuk di atas K5, belum merge — merge menunggu K8 selesai)
- **SHA awal:** `15d47fa` (tip `prd/k5-eksperimen-kappa`)
- **Commit K6:**
  - `270bd88` feat(web): status tampil 7 keadaan + formatter Indonesia zona-terpilih
  - `d2e1883` feat(web): adapter jadwal kanonik + keadaan laga + tautan resmi
  - `24a64d3` feat(ui): jadwal berbasis tanggal/zona, detail langsung-vs-arsip, copy Indonesia
  - `5b34e6d` test(ui): suite K6 U01–U03 (66 assertion) + ui-probe; test:web dirantai
  - `e19d646` fix(ui): overflow 320px — nav menyusut, tabel sumber tanpa min-width paksa
- **Push:** `origin/prd/k6-ui-jadwal` ter-push (branch baru). Master tidak berubah. DB produksi tidak ditulis; app live tidak disentuh; tidak ada login server.

## Hasil per uji penerimaan

### U01 — Pengelompokan tanggal lokal, zona waktu, filter URL

- **Masukan:** fixture katalog kickoff `2026-11-20T17:30:00Z` (= 00.30 WIB 21 Nov), fixture lain 21 Nov WIB, tiga fixture kickoff identik `2026-11-21T05:00:00Z` di dua liga (satu ber-fit di registry, satu tidak), query filter lengkap/tidak sah.
- **Hasil:** laga 00.30 WIB berkelompok di kunci `2026-11-21` pada zona Asia/Jakarta dan `2026-11-20` pada UTC; jendela UTC untuk tanggal WIB 21 Nov = `2026-11-20T17:00Z … 2026-11-21T17:00Z`; urutan seri = prioritas liga (liga ber-fit lebih dulu, mengalahkan id) lalu nama kompetisi lalu id pertandingan; `parseFilterJadwal` memulihkan filter utuh dari query kanonik (`queryJadwal` round-trip persis) dan nilai tidak sah jatuh ke default terdokumentasi (tanggal = hari ini di zona terpilih, status = semua, zona = Asia/Jakarta); label "Hari ini"/"Besok" mengikuti zona terpilih.
- **Harapan:** sesuai dokumen 03 (U1) + 04 baris U01 — **LULUS** (suite `tests/test-ui.ts`, bagian U01).

### U02 — Tujuh status tampil

- **Masukan:** baris katalog/dataset berstatus mentah beragam: `POSTPONED` + sibling jadwal ulang satu UID, `CANCELLED` dengan baris dataset **beracun** (menyimpan skor 3–3), `abandoned` berskor 2–1, `LIVE` berskor 1–0, status asing `DIALIHOFF`.
- **Hasil:** tujuh status (`scheduled, live, finished, postponed, cancelled, abandoned, unknown`) masing-masing berlabel Indonesia sendiri dan ketujuh label terverifikasi berbeda semua; cancelled tampil **tanpa skor** di daftar maupun keadaan (skor racun tertelan); abandoned tampil dengan skor parsial 2–1 + label "Dihentikan"; postponed mempertahankan jadwal asal dan membawa jadwal ulang sibling (`2026-11-25T08:00Z`); status asing tetap `unknown`, tidak ditebak; pasangan tunda/jadwal-ulang ter-dedup per `fixture_uid` menjadi satu baris.
- **Harapan:** sesuai dokumen 03 (U2) + 04 baris U02 — **LULUS**.
- **Keputusan terdokumentasi:** normalizer K1 memetakan "abandoned"→cancelled untuk *settlement*; lapisan web memeriksa ejaan abandoned **sebelum** mendelegasikan ke K1, sehingga tampilan membedakan "Dihentikan" dari "Dibatalkan" tanpa mengubah K1. Prioritas liga (dokumen tidak memberi field-nya): 0 = liga punya fit di `league-canonical.json` (semesta ter-rate aplikasi), 1 = lainnya; lalu nama kompetisi, lalu id.

### U03 — Detail: langsung vs arsip, tautan resmi saja

- **Masukan:** satu laga berpaket (angka fixture `interface_demo` PRD: Persada FC vs Rawa United) dengan satu pilihan **resmi** K2 (`pick_uid`, `published_prob` 0,74 basis `effective`), satu pilihan non-resmi se-paket, satu tiket resmi K3 memuat pilihan resmi, satu tiket umpan memuat `pick_uid` hantu; satu laga katalog tanpa paket; satu ID asing.
- **Hasil:** identitas detail mengikuti `fixture_uid` K1 (`fx_k6_pack`); yang tertaut hanya pilihan resmi (peluang terbit beku 0,74, basis effective) dan hanya tiket resmi (umpan gugur); panel Sportmonks hanya dirender di bagian **Panel arsip** dan tidak masuk hitungan "sumber tersedia"/selisih di Sumber angka (hanya model + harga pasar); kickoff tampil di zona terpilih + UTC; laga katalog tanpa paket tetap punya info (detail paket null → halaman "Analisis belum tersedia", bukan 404 data); ID asing → info null → 404 lokal "Laga tidak ditemukan".
- **Harapan:** sesuai dokumen 03 (U3) + 04 baris U03 — **LULUS**.

## Bukti lebar layar (overflow)

- **Metode:** DB contoh di-seed lokal di worktree (nama tim panjang "Borussia Mönchengladbach" vs "1. FC Heidenheim 1846", semua status, satu paket penuh matriks 11×11 + pasar + panel arsip, pilihan resmi + tiket resmi) → `npm run build` (env placeholder CI, exit 0) → `next start` → puppeteer-core + Chromium headless (@sparticuz/chromium) mengukur `document.documentElement.scrollWidth` vs `clientWidth` dan memindai elemen yang melewati tepi kanan viewport di luar region bergeser yang disengaja (matriks). Seed dihapus sesudahnya; DB contoh tidak masuk commit.
- **Hasil akhir:** 9/9 kombinasi bersih — halaman jadwal, detail berpaket, detail katalog × lebar 320, 390, 768 (scrollWidth == clientWidth di semua). Kolom "Harga pasar" terverifikasi muat penuh di 390px (tepi kanan 366 < 390). Screenshot tersimpan di folder laporan ini: `overflow-jadwal-390.png`, `overflow-detail-paket-390.png`, `overflow-detail-paket-768.png`, `overflow-detail-paket-1440.png`.
- **Dua temuan nyata selama bukti, keduanya diperbaiki di `e19d646`:**
  1. Navigasi atas overflow di 320px (scrollWidth 374): empat tautan + wordmark tidak muat. Perbaikan bedah: gap/ukuran tautan menyusut di bawah 480px, padding header `px-4` di layar kecil — desain ≥480px tidak berubah.
  2. Tabel Sumber angka/Panel arsip memakai `min-w` paksa (420/320px) sehingga kolom pasar hanya terjangkau dengan menggeser region tabel. `min-w` dilepas; kolom Pilihan membungkus — semua kolom terlihat tanpa geser.
- **Batas metode:** data seed minimal buatan (bukan salinan produksi); label relatif hari ("Besok") pada screenshot mengikuti tanggal mesin saat bukti diambil; matriks skor memang tetap berada di region bergeser berlabel sesuai desain (alternatif teks daftar skor disediakan di bawahnya).
- **Catatan lingkungan (bukan regresi K6):** pada DB telanjang tanpa langkah refresh, halaman detail melempar `no such table: team_match_logs_canonical` dari pembaca form lama — tabel itu dibangun langkah telemetri refresh di produksi. Seed bukti membuatnya (kosong) meniru produksi; kode tidak diubah (aturan bedah: komponen sehat tidak disentuh).

## Istilah glosarium (dokumen 03, U5) yang diterapkan

Masthead **Bola**; menu **Beranda / Jadwal / Pilihan / Rekam hasil**; judul tab "Jadwal pertandingan", "Rekam hasil"; status: Akan datang, Sedang berlangsung, Selesai, Ditunda, Dibatalkan, Dihentikan, Status tidak diketahui; label gerbang: "Kalibrasi liga lolos uji" / "Lolos sebagian" / "Belum lolos uji"; kamus pilihan (mis. over 1.5 → "Minimal dua gol", DC 12 → "Salah satu tim menang", BTTS no → "Setidaknya satu tim tidak mencetak gol"); verdik Tepat/Meleset/Menunggu hasil/Dibatalkan; "Peluang terbit tidak tercatat" untuk pilihan resmi tanpa angka terbit (label K2); format angka id-ID (persen koma desimal "72,5%", odds "2,10", ribuan titik "45.866"); pola tanggal "Sabtu, 21 November · 20.00 WIB"; bagian detail: Peta peluang, Sumber angka, Panel arsip, Pilihan sebelum laga, Tiket resmi, Skor paling mungkin, Tentang angka ini, Enam laga terakhir. Angka hero beranda kini **dihitung** dari ledger lab (`lab_resolved`), bukan literal lama "45,866 past games"; tabel lab beranda berlabel "Uji historis dari laboratorium — bukan pilihan resmi pra-laga."

## File berubah

Baru: `lib/web/status.ts`, `lib/web/jadwal.ts`, `tests/test-ui.ts`, `tests/helpers/ui-probe.ts`, `app/(terminal)/pertandingan/[matchId]/not-found.tsx`.
Berubah: `lib/web/data.ts` (listSchedule 3 sumber + dedup UID + urutan stabil, getMatchState, getFixtureInfo, getOfficialPicks, getOfficialTickets), `lib/web/format.ts` (formatter Indonesia + zona terpilih), `app/(terminal)/pertandingan/page.tsx` (jadwal + filter GET), `app/(terminal)/pertandingan/[matchId]/page.tsx` (detail langsung-vs-arsip), `app/page.tsx` (beranda), `app/layout.tsx` (`lang="id"`, judul Indonesia), `components/Nav.tsx`, `components/NavClient.tsx`, `components/ui.tsx` (chip form M/S/K), `package.json` (`test:web` merantai `tests/test-ui.ts`).
Tidak disentuh: file read-only (`lib/agent/*`, `lib/coverage.ts`, `lib/syndicate-orchestrator.ts`, `lib/llm/*`), seluruh jalur K1–K5 (identitas, publikasi, tiket, manifest, keputusan κ), `scripts/pick-slate.ts`.

## Perintah verifikasi + hasil

| Perintah | Exit | Hasil |
|---|---|---|
| `npx --no-install tsc --noEmit` | 0 | bersih |
| `npm run test:quant` | 0 | 22/22 + model 61/61 + experiment-stats 23/23 |
| `npm run test:data` | 0 | 18/18 + identity 58/58 + publication 89/89 + tickets 69/69 |
| `npm run test:web` | 0 | web 12/12 + **ui 66/66** — dijalankan 2×, identik |
| `npm run test:e2e` | 0 | 7/7 — dijalankan 2×, identik |
| `npm run test:baseline:d01` | 0 | 12/12 |
| `npm run build` (env placeholder CI) | 0 | bersih |
| `npx eslint <14 file berubah K6>` | 0 | bersih |
| Cek overflow headless (9 kombinasi) | 0 | scrollWidth == clientWidth semua |

## Cara kembali

Branch terpisah: hapus `prd/k6-ui-jadwal` (lokal + remote) dan seluruh K0–K5/master tidak berubah. Tidak ada migrasi DB, tidak ada perubahan skema, tidak ada deploy — rollback tidak memerlukan langkah data.

## Belum terbukti / di luar kartu

- Produksi + deploy menunggu rangkaian selesai (merge sekali di akhir sesudah K8, keputusan pemilik).
- Halaman **Pilihan** dan **Rekam hasil** (/pilihan, /bukti) adalah cakupan **K7** — di K6 hanya label navigasi + tautan tiket (`/bukti?tiket=`) yang disiapkan.
- 32 konflik `identity_ambiguous` dari bukti migrasi K1 masih terbuka, menunggu peninjauan pemilik.
- Bukti overflow memakai seed lokal, bukan data produksi; verifikasi visual produksi menunggu deploy pasca-K8.
