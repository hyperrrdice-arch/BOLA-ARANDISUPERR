# ADR-002: Store SQLite terpisah berdasarkan fungsi, bukan sumber

## Status
Accepted

## Date
2026-11-04 (menegaskan pemisahan yang sudah berjalan sejak era TheStats)

## Context
Data proyek punya siklus hidup yang saling bertabrakan: katalog
fixture disposable (boleh dibangun ulang kapan saja), telemetri &
hasil yang terus tumbuh, predictions yang harus terisolasi, paket
analisis berversi yang tidak boleh ditimpa, dan payload mentah arsip.
Satu file DB untuk semua berarti operasi rumah tangga satu domain
(DELETE/refresh/VACUUM) bisa menyapu domain lain, dan satu kunci
tulis mengunci semua pembaca.

## Decision
Satu file SQLite per fungsi di `data/`: `upcoming_fixtures.db`
(katalog), `thestats_dataset.db` (hasil/telemetri/odds/konteks/
registry), `football_master.db` (historis legacy), `predictions.db`
(panel pembanding terisolasi, ADR-004), `picks.db` (ledger validasi,
ADR-005), `analysis_snapshots.db` (paket kuant, ADR-003),
`thestats_raw_vault.db` (payload mentah). Artefak JSON terpadu
(registry liga + rating) tetap file tunggal per jenis — graf benua
model piala adalah **field di dalam artefak yang sama**, bukan file
per benua (keputusan owner 4 Nov 2026).

## Alternatives Considered
### Satu database monolitik
- Pros: join lintas domain gratis; satu file dirawat.
- Cons: siklus hidup bertabrakan; risiko hapus lintas domain; contention tulis.
- Rejected: insiden potensialnya lebih mahal dari join yang hilang.

### File per sumber/provider (satu DB Sportmonks, satu DB TheStats)
- Pros: batas provider tegas.
- Cons: provider akan berganti (trial Sportmonks berakhir 10 Nov 2026; mode feed gratis menyusul) — memecah berdasarkan sesuatu yang akan mati mengabadikan struktur yang salah.
- Rejected: fungsi stabil, provider tidak.

## Consequences
- Referensi lintas store ditegakkan oleh kode + kontrak invarian (`docs/DATA-INVARIANTS.md`), bukan FK DDL — audit 5 Nov 2026 mengukur penutupannya (odds 0 yatim dari 3,850 id; telemetri 0 yatim; satu FAIL diketahui: standings→teams, INV-13).
- Setiap store bisa di-rebuild/dibuang sesuai siklus hidupnya tanpa menyentuh yang lain (kecuali yang dinyatakan permanen: predictions, picks, paket, arsip legacy).
- Biaya: query lintas store selalu dua langkah di kode (muat himpunan id, lalu cocokkan) — diterima, dan memang pola yang dipakai semua modul akses `lib/db/*`.
