# Store Paket Kuant — Laporan Penggantian `analysis_snapshots.db`

Branch `safe-bet-parlay` · Keputusan owner 2026-11-05: kunci store snapshot
warisan dicabut ("hapus atau ganti aja gapapa, itu hasil app lama"); hasil
run kuant wajib tinggal di store DB sebagai paket berversi.

## 1 · Recon — siapa menyentuh store lama

Hanya **satu modul** yang membuka file: `lib/db/analysis-snapshot.ts`
(penulis `insertSnapshot`; pembaca `getFreshSnapshot`, `getSnapshotMetrics`;
`upsertOutcome`/`getOutcome` untuk tabel pendamping `match_outcomes`; dua
VIEW evaluasi `v_snapshot_eval*`). Hanya **satu pemanggil**:
`app/api/agent/route.tsx` — jalur produksi planner dorman (mengimpor
`getFreshSnapshot`, `insertSnapshot`, `deriveMarketKey`). File lain
(ledger, driver E2E, docs) hanya menyebut nama file di komentar/dokumen.

Konsekuensi penggantian per konsumen:

- **Jalur planner dorman**: bila suatu hari dihidupkan lagi,
  `getSnapshotDb()`-nya akan membuat ulang tabel lama dalam keadaan
  **kosong** di file yang sama (CREATE TABLE IF NOT EXISTS) — korpus lama
  tidak kembali, insert baru mendarat di tabel warisan kosong, store paket
  tidak terganggu. Perilaku menyimpang ini **terlihat**, bukan senyap:
  tabel `meta` di store baru mendokumentasikan penggantiannya, dan header
  `lib/picks/packages.ts` memperingatkannya.
- **`match_outcomes` (81 baris)**: tidak ada pembaca/penulis aktif di luar
  modul dorman itu sendiri → tidak dibawa ke store baru; utuh di arsip.
- **VIEW evaluasi**: gugur bersama file lama; definisinya utuh di arsip.
- **Ledger/pipeline Fase A–C**: tidak pernah menyentuh file ini — tak
  terdampak (ledger hanya dapat kolom aditif `package_id`).

Dokumen `docs/db-snapshot.md` kini mendeskripsikan store yang sudah
diganti — dibiarkan apa adanya di langkah ini (di luar cakupan), tercatat
di sini sebagai dokumen basi yang diketahui.

## 2 · Arsip (sebelum apa pun diganti)

`archive/analysis_snapshots-legacy-2026-10.db` — byte-copy setelah
`wal_checkpoint(TRUNCATE)`: **872.448 bytes, sha256
`99a67039c8956d3b…`** (identik dengan sumber saat penyalinan; hash yang
sama tercatat di `meta.legacy_archive_sha256` store baru dan terverifikasi ulang setelah semua pekerjaan selesai). Isi terverifikasi dari salinan:
`analysis_snapshots` **21 baris**, `match_outcomes` **81 baris**.
File arsip di-gitignore (konvensi repo: file DB tidak pernah di-commit).

## 3 · Store baru (path sama: `data/analysis_snapshots.db`)

- `meta` (key/value, 8 entri): `schema_version=1`, `store=quant-packages`,
  `created_utc`/`replaced_utc`, `legacy_archive` + hash-nya,
  `legacy_rows`, dan `description` yang mendokumentasikan penggantian +
  keputusan owner di dalam DB sendiri.
- `packages`: id, match_id, competition_canonical_id, kickoff_utc,
  computed_utc, trigger (`baseline|t-24h|t-6h|t-1h|t-15m|slate|manual|
  legacy-import`, CHECK), fit_source, gate_status, cup_delta (δ kandang;
  pasangan lengkap di provenance), ratings_marker, odds_captured_utc,
  bookmakers_json, predictions_batch_utc, lambda, mu, rho, payload_json,
  provenance_json. `UNIQUE(match_id, trigger, computed_utc)` + indeks
  match_id/kickoff_utc/computed_utc.
- Modul `lib/picks/packages.ts`: `writePackage` (idempoten — versi yang
  sudah tercatat tidak ditimpa), `latestPackageFor`, `listPackages`
  (jendela kickoff), `getPackageStoreMeta`. Probe dedupe terverifikasi:
  tulis dua kali → id sama, `inserted=false`, satu baris.

## 4 · Integrasi slate + migrasi ledger

- `scripts/pick-slate.ts` (CLI tidak berubah): setiap fixture ter-rate
  menulis paket penuh (trigger `slate`) — probabilitas ke-16 kandidat dari
  matriks via `probFromMatrix`, top skor, matriks skor, merge pasar +
  cap tangkapan & bookmaker, panel SM + cap batch predictions, λ/μ/ρ,
  provenance fit/gerbang/δ + `ratings_marker` = sha256 isi
  `calibrated_ratings.json`. Gagal tulis paket → fixture gugur beralasan
  eksplisit (fail-closed). Fixture tak ter-rate tidak menulis apa pun.
- Ledger: migrasi aditif `picks.package_id` (PRAGMA check + ALTER, pola
  yang sama dengan modul warisan); kaki live-run dari slate membawa
  package_id paket asalnya. Baris lama tetap NULL kecuali backfill di
  bawah.

## 5 · Backfill (provenance jujur)

`scripts/backfill-packages.ts` — payload disimpan verbatim; field yang
tidak dibawa artefak = NULL + catatan di provenance (tidak ada timestamp
yang dikarang):

| Sumber | Trigger | Baris | Catatan |
|---|---|---|---|
| e2e-run-1-package.json (+ `.pre-canonical`, `.canonical`) | manual | 3 | Tiga versi komputasi Everton yang berbeda (04:11 / 10:58 / 11:33 UTC) — dua versi kanonik terakhir identik λ/μ (1,552/1,123, ρ 0) |
| e2e-cup-package-live.json | manual | 1 | Fenerbahçe: gate partial, δ kandang −0,4792, λ/μ 1,410/2,085, odds capture 2026-11-04T12:38Z |
| pick-slate-latest.json (Fase B) | legacy-import | 70 | Payload = entri ringkasan slate (kaki + λ/μ); ρ/freshness tidak dibawa artefak → NULL tercatat |

Penautan ledger: **483/483 kaki live-run tertaut** ke paket slate
asalnya; 0 kaki lab tersentuh. Re-run backfill: **+0 paket, +0 tautan**
(idempoten penuh).

## 6 · Verifikasi

- Baca-balik per trigger: payload ter-parse; jumlah probabilitas 1X2 =
  1,0000 (slate & Fenerbahçe) / 1,0001 (Everton — pembulatan artefak
  sumber itu sendiri).
- Smoke slate pasca-integrasi (`--limit 8 --no-ledger`): 4 ter-rate →
  **4 paket `slate` tertulis** (probabilitas 16 kandidat, matriks
  berjumlah 1,0000, cap odds & batch terisi, bookmaker `["1xBet"]`,
  marker ratings terisi); ledger tidak berubah; file output slate
  dikembalikan ke keadaan commit Fase B sesudahnya.
- Keadaan akhir store: **78 paket** (70 legacy-import + 4 manual +
  4 slate).
- `tsc --noEmit` = 0 di setiap checkpoint. File 🔒 tidak disentuh.
- Waktu pendaratan: dini hari WIB, jauh sebelum run cron pick-slate
  08:30 WIB — run cron pertama akan menjadi eksekusi produksi pertama
  driver baru (kontrak CLI identik, jadi tidak ada yang rusak).
