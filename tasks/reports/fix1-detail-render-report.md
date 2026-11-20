# Laporan Fix 1 — Detail Laga Crash Saat `market.bookmakers` Null

**Butir:** review pemilik atas K8, butir 1 (merge ditahan sampai perbaikan selesai)
**Branch:** `fix/review-k8` dari kandidat beku `eb52863` (worktree `app-football-fix`)
**Status:** SELESAI — repro terbukti sebelum, keenam kasus penerimaan lulus sesudah, regresi penuh hijau. Belum di-merge, belum menyentuh produksi.

---

## 1. Masalah

Halaman detail `app/(terminal)/pertandingan/[matchId]/page.tsx` membaca
`p.market.bookmakers.length` tanpa penjaga. Paket yang field
`bookmakers`-nya `null` melempar `TypeError` saat render → pengguna melihat
layar galat global "This page couldn't load" sementara status HTTP tetap
200 (render streaming), sehingga smoke test berbasis status tidak
menangkapnya. Digest produksi yang dilaporkan pemilik: `1423494998`,
contoh publik `/pertandingan/sm_19719152` (Vissel Kobe–Mito Hollyhock).

### Bentuk data nyata (DB checkout utama VM, `analysis_snapshots.db`)

7.840 paket terbit terbagi persis tiga bentuk field `market`:

| Bentuk | Jumlah |
|---|---|
| Lengkap: probs terisi, `captured_utc` string, `bookmakers` array tak kosong | 4.116 |
| **Warisan hadir-tapi-kosong: `{probs:{}, captured_utc:null, bookmakers:null}`** | **3.650** |
| `market: null` | 74 |

Tidak ada bentuk campuran (tak ada probs-ada/bookmakers-null, tak ada
`bookmakers: []`). Paket terbaru `sm_19719152` (id 7544) persis bentuk
warisan: `{"probs":{},"captured_utc":null,"bookmakers":null}` — harga
pasar sebenarnya tidak pernah tertangkap untuk paket-paket ini; yang
ada hanya kerangka field-nya.

## 2. Bukti SEBELUM (reproduksi pada build produksi kandidat murni)

Metode pola K6/K7: seed DB lokal di worktree (skema dibangun kode repo
sendiri) → `npm run build` kandidat tak berubah → `next start` →
Chromium headless (puppeteer-core + @sparticuz/chromium) mengukur **isi
render** sesudah hidrasi, bukan cuma status. Enam kasus: kontrol valid
(bentuk fixture K6), mutasi sintetis HANYA `bookmakers → null`, payload
produksi asli id 7544 di- seed apa adanya, `market: null`,
`bookmakers: []`, dan paket tanpa field `market`.

| Kasus | URL langsung | Sesudah Reload | Dari daftar |
|---|---|---|---|
| valid (kontrol) | render penuh (1.708 char) | penuh | — |
| **bookmakers null (sintetis)** | **LAYAR GALAT (96 char), HTTP 200** | **galat** | — |
| **sm_19719152 (payload asli)** | **LAYAR GALAT (96 char), HTTP 200** | **galat** | **galat** |
| market null | render penuh | penuh | — |
| bookmakers [] | render penuh | penuh | — |
| tanpa field market | render penuh | penuh | — |

- Log server: `⨯ TypeError: Cannot read properties of null (reading 'length')` + digest.
- Tangkapan layar kasus asli: persis gejala produksi — "This page
  couldn't load / A server error occurred. Reload to try again." +
  `ERROR <digest>` (digest lokal berbeda dari produksi karena digest
  bergantung build; gejalanya identik).
- Konsol peramban: React error #441 pada kedua kasus gagal.

## 3. Perbaikan (sesuai arahan review)

### (a) Normalisasi di adapter baca — `lib/web/data.ts`

Fungsi baru `normalizeMarket()` dipakai `normalizePayload()` — pintu
satu-satunya antara payload mentah tabel `packages` dan semua konsumen
web — pada kedua jalur bentuk payload (dasar + spread fixture):

- `market` bukan objek / `probs` bukan objek / **`probs` kosong → `null`**.
  Harga dianggap tersedia hanya bila peluang benar-benar tertangkap;
  bentuk warisan kosong menjadi "belum tersedia", bukan sumber hantu
  (sebelumnya `sumberTersedia` menghitungnya sebagai 1 sumber) dan
  bukan crash.
- Bila harga ada: `bookmakers` null/absen/bukan array → `[]` (daftar
  nama hanyalah label); `captured_utc` non-string → `null`. Tipe
  `QuantPayload["market"].captured_utc` kini `string | null`.
- Tidak ada penjaga tersebar di komponen; komponen tetap membaca
  `bookmakers.length` dari nilai yang dijamin adapter berbentuk array.

### (b) Degradasi per-field di halaman — `page.tsx` (footer Sumber angka)

Satu-satunya penyesuaian komponen: kalimat waktu tangkap kini bercabang
pada data ternormalisasi — `captured_utc` ada → kalimat persis seperti
sebelumnya (termasuk sufiks bookmaker); harga ada tapi waktu tangkap
tidak tercatat → kalimat jujur "waktu tangkapnya tidak tercatat pada
paket ini" (sebelumnya `tanggalJamWib(null)` akan mencetak tanggal
epoch 1970). Nilai null pada satu field hanya menutup bagian yang
bergantung padanya; seluruh bagian lain tetap render.

### (c) Batas kegagalan lokal — `app/(terminal)/pertandingan/[matchId]/error.tsx` (baru)

Error boundary segmen (Client Component, konvensi Next 16: prop
`retry`): tampil di dalam kerangka terminal dengan tombol "Coba lagi"
dan tautan "Kembali ke jadwal". Terbukti hidup selama pengujian: saat
fixture awal belum meniru tabel telemetri produksi, boundary inilah
yang menangkap lemparan `getForm` dan menampilkannya secara lokal —
bukan layar galat global.

### (d) Yang TIDAK berubah

- Paket valid dirender byte-for-byte sama: kalimat footer kasus valid
  sebelum vs sesudah identik ("Harga pasar ditangkap Sabtu, 21
  November · 08.30 WIB · FixtureBook. …").
- Peluang terbit + waktu terbit (jalur publikasi K2) tidak disentuh
  sama sekali; tidak ada file read-only yang diubah; κ tetap 10.

## 4. Bukti SESUDAH (build produksi, isi render diperiksa)

Keenam kasus × tiga jalan (URL langsung / Reload / klik dari daftar
`/pertandingan`) — **semua render penuh, nol error konsol**:

| Kasus | Langsung | Reload | Dari daftar | Isi kunci |
|---|---|---|---|---|
| valid | ✓ 1.708 | ✓ | ✓ | footer: ditangkap … · FixtureBook |
| bookmakers null (sintetis) | ✓ 1.715 | ✓ | ✓ | footer: ditangkap … (tanpa sufiks nama — jujur) |
| sm_19719152 (asli) | ✓ 2.966 | ✓ | ✓ | "Harga pasar belum tersedia"; Sumber angka = "1 sumber tersedia"; Harga pasar "—"; Peta peluang 70,4/18,3/11,3% persis payload |
| market null | ✓ 1.622 | ✓ | ✓ | "Harga pasar belum tersedia" |
| bookmakers [] | ✓ 1.694 | ✓ | ✓ | footer tanpa sufiks nama |
| tanpa field market | ✓ 1.608 | ✓ | ✓ | "Harga pasar belum tersedia" |

Log server sesudah: **nol TypeError**. Tangkapan layar `sm_19719152`
sesudah: halaman detail penuh (Peta peluang + Sumber angka), bukan lagi
layar galat.

Catatan fixture: run sesudah pertama sempat menangkap lemparan
`no such table: team_match_logs_canonical` dari `getForm` untuk nama
tim asli — artefak seed (tabel itu selalu ada di produksi karena
dibangun langkah telemetri refresh; persis catatan jujur K6), bukan bug
halaman. Seed dilengkapi tabel kosong ber-DDL produksi, lalu kasus asli
render penuh. Boundary lokal (c) terbukti bekerja justru dari kejadian
ini.

## 5. Regresi permanen di suite repo

- Baru: `tests/test-detail-render.ts` (27 assertion) + probe
  `tests/helpers/detail-probe.ts`, dirantai di akhir `test:web`
  (`package.json`). Mengunci kontrak adapter untuk keenam bentuk +
  keberadaan `error.tsx` segmen dengan jalan kembali ke jadwal.

## 6. Regresi penuh (tree final branch ini)

| Suite | Hasil |
|---|---|
| test:quant | 22/22 |
| test:model | 61/61 |
| test:experiment-stats | 23/23 |
| test:data | 18/18 |
| test:identity | 58/58 |
| test:publication | 89/89 |
| test:tickets | 69/69 |
| test:web | 12/12 |
| test:ui | 66/66 |
| test:rekam | 110/110 |
| **test:detail-render (baru)** | **27/27** |
| test:e2e | 7/7 |
| test:baseline:d01 | 12/12 |
| **Total** | **574/574 hijau** (547 kandidat + 27 baru) |
| `tsc --noEmit` | exit 0 |
| `npm run build` (env placeholder CI) | exit 0 |

## 7. File yang berubah

- `lib/web/data.ts` — `normalizeMarket()` + pemakaian di
  `normalizePayload()` (kedua jalur) + tipe `captured_utc: string | null`.
- `app/(terminal)/pertandingan/[matchId]/page.tsx` — footer Sumber
  angka bercabang pada `captured_utc` ternormalisasi.
- `app/(terminal)/pertandingan/[matchId]/error.tsx` — **baru**, batas
  kegagalan lokal segmen.
- `tests/test-detail-render.ts` + `tests/helpers/detail-probe.ts` —
  **baru**, regresi permanen.
- `package.json` — `test:web` merantai suite baru.

## 8. Pengamatan di luar lingkup (tidak dikerjakan, sesuai aturan bedah)

- `sm_panel.batch_utc` null pada 1.868 paket: halaman mencetak tanggal
  epoch dari `tanggalJamWib(null)` di bagian Panel arsip — tidak crash,
  tapi tanggalnya tidak jujur. Kelas masalah sama, field berbeda;
  dicatat untuk keputusan pemilik, tidak disentuh di butir ini.
- Peringatan PPR `unstable value new Date()` muncul di log pada
  kandidat murni maupun sesudah perbaikan, tanpa dampak ke hasil
  render mana pun (semua halaman terender). Pra-ada, di luar butir ini.
