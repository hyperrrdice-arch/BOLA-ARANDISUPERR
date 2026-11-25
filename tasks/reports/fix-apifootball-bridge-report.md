# Laporan Fix Jembatan API-Football /fixtures (Blocker #3)

- **Branch:** `fix/apifootball-fixtures-bridge` dari master `fcf4c5a`,
  worktree `~/workspace/coding/app-football-fixbridge`.
- **Commit:** fix jembatan + tes (satu commit logis) · laporan ini (docs).
- **Status:** kode + tes selesai dan hijau; **larian live tunggal yang
  diizinkan KONSUMSI oleh kegagalan yang justru membuktikan fakta
  kontrak endpoint baru** (lihat Larian live) — verifikasi live
  ujung-ke-ujung BELUM tercapai dan menunggu satu larian lagi atas kata
  pemilik. **TIDAK ada merge, deploy, pendaftaran cron, atau hook
  Fix-4** — aktivasi menunggu kata pemilik sesudah peninjauan.
- **Kerahasiaan:** token hanya diteruskan lewat environment dari
  `.env.local` (blind-copy ke worktree); nilai token tidak pernah
  dicetak di log, laporan, atau chat mana pun.

---

## Akar masalah (rekap blocker #3)

Parser Sprint C (`parseApiFootballOdds`) mensyaratkan
`entry.teams.home/away.name`, tetapi entri respons `/odds` asli
berbentuk `{ league, fixture { id, timezone, date, timestamp },
update, bookmakers }` — **tidak ada field `teams`** (terverifikasi dari
model typed resmi + larian live Fase 1 fix-aktivasi: 30 fixture
terambil, 0 quote terparse). Mock T02 Sprint C mengarang field `teams`
sehingga cacat tertutup. Nama tim untuk sebuah fixture hanya tersedia
di respons `/fixtures`.

## Desain jembatan

Bentuk `/fixtures` diverifikasi SEBELUM coding dari model typed resmi
(Go client `api-sports-football-go`, pkg.go.dev): setiap entri =
`{ fixture { id, timezone, date, timestamp, ... }, league {...},
teams { home { id, name, logo, winner }, away { id, name, ... } },
goals {...}, score {...} }`, dibungkus envelope
`{ get, parameters, errors, results, paging { current, total },
response [...] }`.

Alur capture sekarang:

1. `fetchApiFootballFixturesForDate(fetch, key, date, limiter)` —
   ambil `/fixtures?date=<tanggal yang sama>` dan bangun peta
   `fixture.id → { home_name, away_name }` lewat
   `parseApiFootballFixtures` (entri tanpa id/nama dilewati — tidak
   ada nama karangan).
2. `fetchApiFootballOddsForDate(...)` — tidak berubah (cap Page ≤ 3).
3. `joinApiFootballOddsWithFixtures(payload, teamsByFixtureId)` —
   pasang `teams { home { name }, away { name } }` dari peta ke setiap
   entri odds berdasarkan `fixture.id`. Parser odds mengonsumsi
   payload TERGABUNG ini. Entri yang `fixture.id`-nya tidak ada di
   peta **tidak masuk payload hasil** dan dihitung di
   `unbridgedEntries`; skrip melaporkannya di baris SELESAI sebagai
   "entri odds tanpa pasangan /fixtures" — tidak ada pembuangan
   diam-diam. Peta /fixtures adalah satu-satunya sumber nama tim;
   field `teams` bawaan entri odds tidak pernah dipakai.
4. Penjembatanan ke katalog repo (tanggal + nama ternormalisasi →
   `upcoming_fixtures`) dan penyimpanan MarketSnapshot tidak berubah.

### Fakta paginasi /fixtures (BARU, terbukti live)

`/fixtures` **berbeda** dari `/odds`: endpoint ini **menolak parameter
Page**. Larian live pertama versi jembatan mengirim
`/fixtures?date=2026-11-25&page=1` dan mati dengan error verbatim API:

```
GAGAL: api-football: payload errors: {"page":"The Page field do not exist."}
```

Jadi klien final meminta `/fixtures?date=` dalam **satu request tanpa
parameter page**. `paging.total` dari envelope tetap dibaca: bila
envelope suatu saat mengklaim > 1 halaman, sisanya tidak dapat diambil
(tidak ada parameter untuk memintanya) dan dilaporkan sebagai
`truncated` + peringatan `fixtures-tidak-lengkap` di skrip — eksplisit,
bukan didiamkan. Guard kuota tidak berubah: limiter bersama ≤9
req/menit, ≤80 req/hari per proses, berhenti bila sisa kuota header
≤ 20. Anggaran request per larian capture kini: 1 (fixtures) + ≤3
(odds) = ≤4.

## Perubahan (3 berkas)

1. `lib/feeds/api-football.ts`
   - Tipe `AfFixturesPayload` + `ApiFootballFixtureTeams`.
   - `parseApiFootballFixtures(payload)` → `Map<fixture.id, nama tim>`.
   - `fetchApiFootballFixturesForDate(...)` — satu request tanpa page,
     header sisa kuota dicatat ke limiter yang sama, errors payload
     melempar (pola yang sama dengan /odds); mengembalikan
     `{ payload, remaining, totalPages, fetchedPages: 1, skippedPages,
     truncated, teamsByFixtureId }`.
   - `joinApiFootballOddsWithFixtures(payload, map)` →
     `{ payload tergabung, bridgedEntries, unbridgedEntries }`.
   - Komentar header + dok parser diperbarui (blocker #3, fakta Page
     /fixtures, parser mengonsumsi bentuk tergabung).
2. `scripts/capture-odds-apifootball.ts` — ambil peta /fixtures dulu,
   join per halaman odds, hitung `unbridged`; baris SELESAI memuat
   ukuran peta /fixtures + hitungan tanpa-pasangan; peringatan
   `fixtures-tidak-lengkap` bila envelope terpotong. Peringatan
   skipped-due-to-plan-cap untuk /odds tidak berubah.
3. `tests/test-market-snapshot.ts` — mock ditulis ulang ke BENTUK ASLI
   (entri odds tanpa `teams`; payload /fixtures terpisah); mock
   `teams` karangan Sprint C tidak ada lagi.

## Tes

- Suite T02 (test-market-snapshot): **48/48 → 63/63 lolos** (+15
  assertion bersih; beberapa assertion parser lama ditulis ulang ke
  bentuk asli):
  - peta /fixtures terbangun (ukuran + nama tim);
  - payload odds mentah tanpa jembatan → **0 quote** (cacat blocker #3
    terkunci sebagai perilaku teruji);
  - join: hitungan bridged/unbridged; entri yatim (fixture.id tak
    dikenal) terhitung dan quotenya tidak bocor ke hasil parse;
  - /fixtures: tepat 1 request, URL **tanpa** parameter `page`;
    envelope total 4 → tetap 1 request, skipped 3, truncated eksplisit;
  - jalur capture ujung-ke-ujung via transport mock (fixtures → odds →
    join → parse → append): 3 quote, snapshot 1X2 + O/U 2.5 + O/U 3.5
    tersimpan, devig snapshot Σ = 1,0 @1e-9;
  - assertion lama yang dipertahankan: devig Σ=1 @1e-9, selector T02,
    append-only/first_observed, limiter, dan seluruh assertion cap
    paginasi /odds (halaman yang diminta [1,2,3], skipped 4 pada
    transport 7 halaman, Page 4 ditolak sebelum request).
- Validasi berurutan di worktree (data keadaan commit):
  - `npx tsc --noEmit` — OK.
  - `npm run lint:gate` — LOLOS (91 error vs baseline 92, nol baru).
  - `npm run test:data` — semua hijau: data 18/18 · identity 58/58 ·
    publication 110/110 · tickets 69/69 · resolver-score 23/23 ·
    slip-stats 12/12 · ingest-freshness 12/12 · fix4 35/35 ·
    market-snapshot **63/63** · fdorg-results 43/43 — exit 0.
  - `npm run test:quant` — semua hijau: quant 22/22 · model **62/62** ·
    model-artifacts 32/32 · experiment-stats 23/23 · evaluator 22/22 ·
    kandidat-q1 lolos · promote-gate 21/21 · q0 19/19 · q2 11/11 —
    exit 0. (test:web di luar cakupan brief.)

## Larian live (tepat SATU kali, cwd worktree) — GAGAL di request pertama, secara informatif

Persiapan: salinan konsisten `upcoming_fixtures.db` produksi (VACUUM
INTO, 4.029 baris) di `data/` worktree; DB snapshot tujuan = berkas
worktree sendiri (belum ada sebelum larian; dibuat oleh inisialisasi
store skrip, 4.096 B, **0 baris** — disisihkan sebagai
`data/market_snapshots.db.livecopy-bridge`, tidak di-commit).

Output verbatim (exit 1):

```
GAGAL: api-football: payload errors: {"page":"The Page field do not exist."}
EXIT=1
```

Penilaian jujur terhadap kriteria sukses brief:

- **Request terpakai: 1** (request /fixtures yang ditolak). Pemakaian
  akun hari ini ≈ **7 dari 100** (≈6 sebelumnya + 1 ini). Larian mati
  SEBELUM fetch /odds dimulai, jadi tidak ada quote/snapshot untuk
  dinilai — kriteria "quotes > 0, snapshots > 0, first_observed ≈
  waktu larian, devig spot-check" **BELUM terverifikasi live**.
- Kegagalan ini adalah bukti live yang memperbaiki desain: kode awal
  jembatan mengasumsikan /fixtures berpaginasi seperti /odds;
  asumsi itu dibantah API sendiri. Kode final (satu request tanpa
  page) + seluruh suite hijau membuktikan perbaikan di level unit,
  tetapi sesuai aturan satu-larian-live, **larian kedua TIDAK
  dijalankan** — verifikasi ujung-ke-ujung menunggu izin pemilik
  untuk satu larian lagi.
- Yang sudah terbukti live dari larian ini: (a) endpoint /fixtures
  menerima query `date` dan merespons terstruktur sampai validasi
  parameter (bukan 401/403 — autentikasi lolos); (b) field Page tidak
  ada di endpoint ini.

## Isolasi live (checkout utama / produksi)

Jangkar sebelum larian == sesudah seluruh pekerjaan:

- `data/model-manifest.json` sha256
  `a6cf947a4f9f1ccfb80fcfccc739dca522bfc00dd042f2b6759530dca2b54315`
  — IDENTIK.
- `data/market_snapshots.db` produksi: 4.096 B, sha256
  `97e8d54f8a7255106f66cf1b213c4a4d7b558d21310b1c2bfedc3d0d526dddda`,
  mtime 2026-11-25 09:11 UTC — IDENTIK byte-per-byte (0 baris, tidak
  ada snapshot produksi yang tertulis).
- `data/picks.db` produksi: 60.653.568 B, mtime 2026-11-25 09:45 UTC
  — tidak berubah selama sesi ini (tidak disentuh; perubahan
  berikutnya adalah milik refresh terjadwal).

## Celah sisa (untuk keputusan pemilik, bukan dikerjakan di sini)

1. **Verifikasi live ujung-ke-ujung jembatan** menunggu SATU larian
   capture lagi atas kata pemilik (kode sudah final + hijau; expected:
   peta /fixtures terisi, quote > 0, snapshot pertama tertulis).
2. **Langit-langit cakupan free plan tetap berlaku:** query
   `/odds?date=` global hanya menjangkau 30 fixture pertama per hari
   (3 halaman × 10) dari ±18 halaman — sesudah jembatan terbukti live
   pun tangkapan tetap PARSIAL sampai ada pemetaan ID liga
   API-Football berbasis bukti untuk mempersempit query. Peta
   /fixtures sendiri mencakup seluruh hari, jadi entri odds di luar
   3 halaman pertama memang tidak pernah sampai ke join.
3. **Penjembatanan katalog** tetap berbasis nama ternormalisasi +
   tanggal terhadap `upcoming_fixtures`: fixture yang tidak ada di
   katalog repo akan terhitung "tak terjembatani" dan dilewati —
   jujur, tetapi cakupan snapshot efektif dibatasi katalog.
4. **Aktivasi tetap menunggu kata pemilik:** cron capture 09:00/18:00
   WIB, hook Fix-4 ke alur harian, dan tiket resmi pertama — tidak ada
   satu pun yang didaftarkan/dijalankan oleh branch ini.
