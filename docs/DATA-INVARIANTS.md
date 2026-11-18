# DATA-INVARIANTS.md — Kontrak Invarian Lapisan Data

> Ditulis 5 Nov 2026 (audit basis data penuh, `tasks/db-audit-report.md`)
> mengikuti disiplin constraint-driven: kontrak ini adalah **bilah
> tertulis yang bisa dicek mesin**, bukan prosa. Setiap invarian punya
> query pemeriksa dan hasil audit terakhir. Invarian yang gagal hari
> ini dicatat sebagai **FAIL (diketahui)** beserta penyebab + proposal
> perbaikannya — kontrak tidak mengedit hasil agar terlihat hijau.
>
> Cara memeriksa ulang: jalankan query tiap invarian pada store
> read-only (`sqlite3.connect('file:data/<db>?mode=ro', uri=True)`).
> Ritme harian menambah baris; yang dikontrakkan adalah **relasinya**,
> bukan jumlah baris absolut — kecuali invarian yang menyebut angka
> arsip beku (INV-14).

## Grup A — Ledger & paket (validasi produk)

**INV-01 · Setiap pick live-run tertaut ke paket yang ada.**
`picks.package_id` (untuk `source='live-run'`) menunjuk `packages.id` yang eksis.
Periksa: hitung live-run ber-package_id NULL + package_id yang tidak ada di store paket.
Audit: **PASS** — 483/483 tertaut, 0 NULL, 0 menggantung.

**INV-02 · Pick lab tidak membawa package_id.**
Populasi lab mendahului store paket; mengisinya belakangan = provenance karangan.
Periksa: `SELECT COUNT(*) FROM picks WHERE source='lab' AND package_id IS NOT NULL` → harus 0.
Audit: **PASS** — 0 (163,008 lab semua NULL).

**INV-03 · Outcome mengikuti penyelesaian laga.**
(a) Setiap pick lab punya tepat satu baris outcome. (b) Pick live-run
boleh belum ter-resolve hanya bila laganya belum 'finished' di
`dataset.matches`.
Periksa: (a) bandingkan COUNT(pick_outcomes) vs COUNT(picks lab);
(b) live-run tanpa outcome yang match_id-nya sudah finished → harus 0.
Audit: **PASS** — (a) 163,008 = 163,008; (b) 483 belum ter-resolve, 0 di antaranya sudah finished.

**INV-04 · Gerbang kalibrasi adalah label, bukan pembatas — dan labelnya wajib terbawa sampai ke konsumen.**
*(Amendemen 18 Nov 2026 — Fase 0 R-02, menyusul R-01. Rumusan awal invarian
ini (5 Nov 2026, "mesin pick fail-closed: uncalibrated ⇒ tidak ada kaki
live") sudah tidak cocok dengan keputusan owner 2026-11-05 bahwa gerbang
adalah label, bukan pembatas — audit Fase 0 §6 mengukur 537 pick live-run
dari liga uncalibrated, termasuk grade A, sementara kontrak lama masih
menyatakan 0. Kontrak di bawah ini yang berlaku sekarang.)*
Pick live-run BOLEH lahir dari kompetisi uncalibrated; mesin pick tidak
menolaknya (`lib/picks/engine.ts::applyGateCap` pass-through by design).
Yang dikontrakkan: (a) setiap pick live-run membawa `gate_status` ∈
{calibrated, partial, uncalibrated} — tidak pernah NULL atau di luar
domain itu; (b) label tersebut wajib tampil di permukaan konsumen —
statistik /bukti tersegmentasi menurut `gate_status` (R-01), dan setiap
pilihan di output tiket membawa label gerbangnya: contoh parlay slate
(`scripts/pick-slate.ts`) dan slip /pilihan (R-02).
(Populasi lab dikecualikan dari kewajiban tampil — ia populasi
*pengukuran* yang memang memuat status apa adanya: lab calibrated
138,432 / partial 10,896 / uncalibrated 13,680.)
Periksa: (a) `SELECT COUNT(*) FROM picks WHERE source='live-run' AND (gate_status IS NULL OR gate_status NOT IN ('calibrated','partial','uncalibrated'))` → 0;
(b) inspeksi render: segmentasi di `app/(terminal)/bukti/page.tsx`, label per pilihan di slip `components/pilihan/ParlayBuilder.tsx` dan di contoh parlay `tasks/pick-slate-latest.md`.
Audit: **PASS** — (a) 0 (live-run per status: calibrated 2,147 /
partial 2,839 / uncalibrated 537 — angka bergerak mengikuti ritme harian;
yang dikontrakkan relasinya, bukan jumlahnya). Hasil audit 5 Nov 2026
("PASS — 0 uncalibrated") berlaku bagi rumusan lama dan dinyatakan
**superseded** oleh amendemen ini.

**INV-05 · Probabilitas klaim selalu waras.**
`picks.model_prob` ∈ (0, 1]; payload paket valid JSON.
Periksa: MIN/MAX(model_prob) + COUNT di luar rentang; `json_valid(payload_json)` per paket.
Audit: **PASS** — rentang [0,0038, 0,9962], 0 di luar; payload 78/78 valid.

## Grup B — Identitas

**INV-06 · Satu liga kanonik per identitas sumber.**
Setiap pasangan (system, id) di `league-canonical.json` muncul di
tepat satu liga kanonik, dan canonical_id setiap liga termasuk dalam
aliasnya sendiri.
Periksa: muat JSON, hitung pasangan duplikat lintas liga + keberadaan canonical_id di aliases.
Audit: **PASS** — 412 pasangan, 0 duplikat; 250/250 canonical_id ada di aliasnya.

**INV-07 · Setiap kompetisi katalog ter-resolve ke liga kanonik.**
Seluruh competition_id distinct di `upcoming_fixtures` ada di himpunan alias sistemnya.
Audit: **PASS** — 88/88 competition_id distinct ter-resolve, 0 yatim.

**INV-08 · Registry kalibrasi lengkap & berdomain tertutup.**
Setiap baris `league_calibration` ber-canonical_id terisi dan
status ∈ {calibrated, partial, uncalibrated}.
Audit: **PASS** — canonical_id 125/125; domain status tepat tiga nilai itu.

**INV-09 · Jembatan laga tidak basi.**
Setiap `sm_id_map.match_id` ada di `upcoming_fixtures`.
Audit: **PASS** — 0 basi dari 3,420. (Sisi sebaliknya tidak dikontrakkan:
28 sm_fixture_id di peta tidak lagi berkoresponden fixture katalog —
efek rotasi, dicatat di laporan audit, bukan pelanggaran.)

## Grup C — Referensial lintas store

**INV-10 · Telemetri tertutup referensial.**
`team_match_logs.match_id ⊆ matches` dan `team_match_logs.team_id ⊆ teams`.
Audit: **PASS** — 0 yatim pada kedua arah (85,521 baris).

**INV-11 · Odds tertutup referensial.**
Setiap `match_odds_history.match_id` ∈ katalog upcoming ∪ `dataset.matches`.
Audit: **PASS** — 0 yatim dari 3,850 id distinct (3,770 katalog; 127 matches; 47 keduanya).

**INV-12 · Paket tertutup ke katalog.**
Setiap `packages.match_id` ∈ `upcoming_fixtures`.
Audit: **PASS** — 72/72 match_id distinct.

**INV-13 · Standings merujuk tim yang dikenal — FAIL (diketahui).**
Setiap `standings.team_id` seharusnya ada di `teams`.
Audit: **FAIL** — 225 baris standings merujuk 167 team_id numerik
Sportmonks yang tidak ada di `teams` (tim peserta liga yang tidak
pernah termaterialisasi sebagai baris teams). Dampak: nama/negara tim
untuk baris itu tidak bisa di-join dari `teams`. Proposal perbaikan:
backfill baris `teams` minimum (id + nama dari payload standings) di
ritme sync konteks — lihat laporan audit P-03. Sampai diperbaiki,
konsumen standings WAJIB mentolerir join kosong.

## Grup D — Isolasi & kejujuran data

**INV-14 · Predictions terisolasi dari jalur odds (ADR-004).**
(a) `predictions.db` tidak memuat tabel odds; (b) tidak ada baris
`match_odds_history` yang bersumber dari predictions
(`source` ∈ {NULL legacy, 'sportmonks'} saja); (c) tidak ada baris
premium-history dari endpoint `/odds/premium*`.
Audit: **PASS** — (a) hanya 3 tabel sm_*; (b) himpunan source tepat
{NULL, 'sportmonks'}; (c) baris premium = 0 (endpoint memang kosong).
**Amendemen 2026-11-05 (mode bebas Sportmonks, keputusan owner):**
himpunan `source` yang sah di (b) bertambah satu — `'football-data'`
(feed gratis football-data.co.uk; barisnya odds sungguhan dari CSV,
bukan predictions). Substansi invarian tidak berubah: tetap **tidak
ada** baris odds yang bersumber dari predictions. Keadaan pasca-ubah
terverifikasi di `tasks/free-mode-report.md`: source ∈ {NULL,
'sportmonks', 'football-data'}, baris bersumber predictions = 0.

**INV-15 · Statistik absen = NULL, bukan karangan.**
Kolom statistik yang tidak tersedia dari sumber disimpan NULL
(contoh terukur: `team_match_logs.xg_for` NULL pada 49,076/85,521
baris = 57,4% — cakupan xG parsial yang jujur). Invarian ini dijaga
oleh disiplin penulis (sync/backfill) dan terlihat dari profil NULL;
regresi terdeteksi bila NULL xG tiba-tiba 0 tanpa perubahan sumber.

**INV-16 · Arsip legacy beku.**
`archive/analysis_snapshots-legacy-2026-10.db` tidak berubah:
`analysis_snapshots` = 21 baris, `match_outcomes` = 81 baris,
integrity ok. (Hash salinan tercatat di `meta` store paket.)
Audit: **PASS** — 21/81, integrity ok.

**INV-17 · Predictions yang dipertahankan boleh yatim katalog — tercatat.**
`sm_predictions.fixture_sm_id` yang tidak lagi di katalog BUKAN
pelanggaran (retensi permanen, keputusan owner); jumlahnya dipantau.
Audit: 770 fixture, **2 di luar katalog** (rotasi horizon) — sesuai desain.

**INV-19 · Setiap fits kanonik menunjuk kunci yang ada di berkas ratings.**
Pemeriksa: untuk setiap entri `fits[].ratings_key` di
`league-canonical.json`, kunci itu harus ada sebagai liga di
`calibrated_ratings.json`. Audit susulan (dari census identitas):
**FAIL diketahui — tepat 1 menggantung**: liga kanonik sm:1085
membawa ratings_key 'SM1085' yang tidak ada di berkas (72 kunci).
Dampak langsung nol (baris registry sm:1085 berstatus uncalibrated
— gerbang memblokir sajiannya), tetapi referensinya basi.
Perbaikan = proposal P-10 di laporan audit.

## Grup E — Kesehatan store

**INV-18 · Semua store lolos integrity_check dan ber-journal wal.**
Audit: **PASS** untuk football_master, upcoming_fixtures,
predictions, picks, analysis_snapshots (paket), thestats_raw_vault,
arsip legacy — integrity ok, foreign_key_check 0 pelanggaran.
**Dataset: PASS (tertutup pasca-jendela utama)** — integrity_check
(1,5 GB) dua kali timeout di jendela audit di bawah beban tulis
bersamaan, tetapi proses latar audit akhirnya rampung dan
mengembalikan **integrity_check = ok, foreign_key_check = 0
pelanggaran**. Dengan itu kedelapan store PASS invarian ini.

---

### Ringkasan audit 5 Nov 2026
19 invarian: **15 PASS · 2 FAIL diketahui (INV-13 standings→teams;
INV-19 satu fits kanonik menggantung) · 2 catatan sesuai
desain/disiplin (INV-15, INV-17)**. FAIL tidak disembunyikan:
keduanya adalah item perbaikan (P-03 dan P-10) di laporan audit.
