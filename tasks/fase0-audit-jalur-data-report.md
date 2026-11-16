# FASE 0 — Audit Jalur Data App Bola (read-only)

> Tanggal audit: **2026-11-16** (pengukuran langsung sore ini, WIB/WITA).
> Doktrin Fase 0: **cek dulu, jangan bangun dulu** — laporan ini TIDAK
> mengubah kode/data apa pun. Semua temuan menjadi daftar perbaikan
> untuk fase berikutnya.
> Basis pembanding: `docs/DATABASE.md` + `docs/DATA-INVARIANTS.md`
> (audit 5 Nov 2026). Yang diaudit di sini adalah keadaan ERA BEBAS
> (pasca-Sportmonks), bukan pengulangan audit 5 Nov.
> Skala verdict per sambungan: **SEHAT** (bekerja + terbukti) ·
> **PERHATIAN** (bekerja, tapi terdegradasi/berisiko senyap) ·
> **RUSAK** (tidak bekerja / melanggar kontrak tertulis).

## Ringkasan verdict

| # | Sambungan | Verdict |
|---|---|---|
| 1 | Sumber data | PERHATIAN |
| 2 | Importer & rantai free-refresh | SEHAT (1 catatan kerapuhan) |
| 3 | Store & identitas | PERHATIAN |
| 4 | Telemetri | SEHAT (kesegaran terbatas sumber) |
| 5 | Rating & gerbang | PERHATIAN |
| 6 | Slate → paket → pick | PERHATIAN (1 pelanggaran kontrak tertulis) |
| 7 | Ledger → /bukti | SEHAT (baru diperbaiki; sisa terukur) |
| 8 | Ops/jadwal | PERHATIAN (peta titik gagal senyap) |

---

## 1 · SUMBER — PERHATIAN

**football-data.co.uk (sumber utama era bebas), dicek langsung ke situs
16 Nov ~09:01 UTC:**
- File hasil per divisi (mmz4281/2627) saat ini berhenti di ronde
  **9 Nov 2026** (ekor file SP2 diverifikasi baris demi baris: laga
  terakhir 09/11 Las Palmas–Eldense & Sabadell–Sociedad B). Cocok
  dengan store kita: `matches` fd_ maks **2026-11-09**, telemetri fd
  maks 2026-11-09. Ronde 13–15 Nov **belum diterbitkan situs** sebagai
  hasil — ini jeda sisi situs (pola update Selasa/Jumat), bukan
  kegagalan importer kita.
- `fixtures.csv` situs saat ini masih memuat **ronde 14 Nov** (fixture
  bertanggal 13–15 Nov, sudah lampau). Konsekuensi terukur: divisi
  ekspansi (E2/E3/EC/SC1/SC2/SC3) belum menyumbang satu pun fixture
  masa depan; delta slate ekspansi = 0 sampai file diperbarui.
- Katalog fixture SM-era (`upcoming_fixtures`): horizon maks
  **2027-01-05** (sesuai target menang), 3.924 baris (sm_ 3.458 /
  mt_ 378 / fd_ 88); baris sm_ membeku pada `fetched_utc`
  2026-11-07T12:35Z; baris fd_ terakhir masuk 2026-11-13. Dari hari
  ini: 2.757 fixture masa depan.
- Arsip predictions: tangkapan **3–7 Nov saja** (batch terakhir
  2026-11-07T12:45Z), 84.721 nilai / 924 fixture, cakupan kickoff s.d.
  2027-01-03. Beku **by design** (panel arsip), tapi menua tanpa label
  usia di output slate (lihat titik gagal senyap S-2).
- football-data.org: importer **dorman terkonfirmasi** — tanpa env
  `FOOTBALL_DATA_ORG_TOKEN` skrip mencetak SKIP dan exit 0; tidak
  masuk rantai free-refresh sama sekali. Token memang belum ada
  (menunggu owner daftar gratis).

## 2 · IMPORTER & RANTAI — SEHAT (1 catatan kerapuhan)

`scripts/free-refresh.ts` = 8 langkah berurutan (impor → team-canonical
→ fixture-links → calibrate → cup-offsets → canonical-telemetry →
slate 72j → **resolve-pick-outcomes**). Perilaku gagal: langkah
non-nol → rantai **berhenti, exit 1** (keras/terdengar, bukan senyap).
- Idempotensi terukur dari run cron hari ini 04:21 WITA: impor 1.685
  hasil → **1.135 bridged, 550 sudah ada, 0 baru**; fixture 11 →
  8 bridged, 3 sudah ada; unmatched tim = **0**
  (`tasks/free-import-unmatched.json`, count 0, diperbarui hari ini).
- Rasio jembatan akumulatif (dari laporan fase sebelumnya): impor awal
  412 insert / 1.115 bridged; ekspansi +623 insert / +91 bridged.
- Catatan kerapuhan: di dalam importer, error satu divisi di-`throw`
  ulang → **seluruh langkah impor gagal** (all-or-nothing per run).
  Keras, tapi satu file divisi rusak/404 menghentikan semua divisi.
- Resolver sebagai langkah 8 terverifikasi di kode (komentar langkah
  menyebut regresi 7–16 Nov secara eksplisit).

## 3 · STORE & IDENTITAS — PERHATIAN

**Integritas (diukur hari ini):** football_master, upcoming_fixtures,
predictions, picks, analysis_snapshots (paket), arsip legacy —
`integrity_check = ok`, `foreign_key_check = 0`. Arsip legacy beku
persis 21/81 (INV-16 PASS). **Dataset (1,5 GB): integrity_check penuh
tidak selesai dalam jendela audit** (perilaku sama seperti audit 5 Nov
— saat itu akhirnya selesai di latar = ok). Tidak ada rhythm yang
menjadwalkan cek ini (titik gagal senyap S-6).

**Drift hitungan vs `docs/DATABASE.md` (5 Nov → 16 Nov):** dataset
matches 70.114 → **71.452**; team_match_logs 85.521 → **88.197**;
teams 6.450 → **6.541**; match_odds_history 4.071 → **8.273**
(NULL 500 ≤27 Okt · sportmonks 4.091 ≤7 Nov · **football-data 3.682,
terbaru hari ini 06:09Z**); league_calibration 125 → **131**;
upcoming 3.770 → **3.924**; predictions 70.553 → **84.721**; picks
163.491 → **168.028** (lab 163.008 + live-run 5.020); paket 78 →
**5.298**. Drift = pertumbuhan nyata, tapi dokumen basis kini basi
angka (daftar perbaikan R-08).

**Identitas:** registry liga kanonik **250** ✓; registry tim **6.600
entri** (dibangun ulang hari ini 06:10Z) — merge Celta terverifikasi
di file: `sm:384` "Celta Fortuna" beranggotakan sportmonks 384 +
`fd_celta-b`, alias ["Celta B","Celta Fortuna"]; senior `sm:36` utuh.
**Sisa kembar:** `fixture-links.json` (dibangun ulang hari ini):
3.924 fixture, **177 grup duplikat**, 188 baris kembar tertaut
(**163 mt_ + 16 fd_ + 9 sm_** → semua kanonik sm_). Scan katalog masa
depan (metode yang sama dengan perbaikan Celta — kickoff sama + home
sama): **81 grup**, 80 di antaranya pasangan mt_/sm_ lama (kelas P-09
yang belum dieksekusi) + 1 Albacete (sudah tertaut). **132 fixture mt_
masa depan masuk jendela slate mulai 20 Nov** (maks 29 Nov).
**INV-13 masih FAIL persis**: 225 baris standings merujuk team_id yang
tidak ada di `teams` (tidak berubah sejak 5 Nov). Seluruh 3.924 baris
katalog berstatus `'scheduled'` — termasuk **1.167 baris bertanggal
lampau** (status basi kelas P-02; tidak dipakai resolver, tapi bidang
status katalog tidak lagi bermakna).

## 4 · TELEMETRI — SEHAT (kesegaran terbatas sumber)

- Tabel resmi `team_match_logs_canonical` = 85.782 baris, dibangun
  ulang tiap refresh dari log mentah 88.197 baris; baris tak
  ter-resolusi ke registry = **0** (laporan builder hari ini).
- Prioritas pemenang per pertandingan terkonfirmasi di kode
  `build-canonical-telemetry.ts`: **sportmonks > football-data >
  thestats (NULL) > master**, lalu xG-terisi, lalu kelengkapan kolom;
  konflik skor ditandai `goals_conflict`, xG pinjaman ditandai
  `xg_filled_from` (kejujuran asal terjaga).
- Sensus `chosen_source`: sportmonks 83.356 (maks **2026-11-07**) ·
  football-data 2.074 (maks **2026-11-09**) · thestats 334 (≤17 Okt) ·
  master 18 (≤11 Okt). Tidak ada sumber hasil yang lebih baru dari
  9 Nov di mana pun di store — batas kesegaran form hari ini memang
  9 Nov, dan itu batas situs, bukan bug.
- Kesegaran jendela per tim (5.548 tim berjendela): hanya **711
  (12,8%)** baris terbarunya ≤14 hari; 636 di 15–31 hari; **4.201
  (75,7%) >31 hari** (ekor panjang tim piala/obscure + jeda
  internasional — tim aktif papan atas terwakili di 711 itu; contoh
  trace di bawah berakhir 4–7 Nov).
- Jalur fallback SM-only (`team-telemetry.ts`, untuk tim di luar
  registry): eksposur terukur saat ini ≈ **nol** (0 baris tak
  ter-resolusi di builder), tapi jalur itu tetap ada dan akan
  menyajikan jendela beku-SM secara senyap untuk tim baru yang belum
  masuk registry (titik gagal senyap S-7).

## 5 · RATING & GERBANG — PERHATIAN

- `calibrated_ratings.json` ter-compile **hari ini 06:10Z**: 84 fit /
  2.088 tim. Sensus `calibrationDate`: **68 fit di-fit ulang hari
  ini**, 16 fit warisan berhenti di **11–14 Okt**.
- **Temuan fit basi terstruktur:** ke-16 fit warisan (E0, SP1, SP2,
  D1, dst. — `calibrationStatus` dan `source` sama-sama absen,
  `maxTeamLastMatch` = 11/12 Okt) **tidak pernah di-fit ulang** oleh
  calibrate (by design jalur ekspansi: entri lama dipertahankan).
  Karena aturan fit-sesuai-sumber, fit basi inilah yang melayani
  fixture **fd_** di liga-liga besar itu, sementara fixture sm_ di
  liga yang sama memakai fit segar (SM8 calibrated data s.d. 6 Nov;
  SM567 partial s.d. 2 Nov). Dampak terukur di Trace A (μ beda 0,28
  untuk pertandingan fisik yang sama).
- Sensus gerbang registry (`league_calibration`, 131 baris):
  **48 calibrated / 39 partial / 44 uncalibrated**; menurut sumber:
  sportmonks-fit 92, legacy-csv-fit 22, cup-offset 17.
- Offset piala: blok `canonical.cupOffsets` ter-fit ulang **hari ini
  06:10:50Z**, 3 graf (europe/conmebol/afc), 17 kompetisi:
  **0 calibrated / 4 partial / 13 uncalibrated** — tidak berubah sejak
  5 Nov (gerbang tidak dilonggarkan; benar secara disiplin, tapi
  berarti jalur piala tetap tanpa satu pun kompetisi calibrated).

## 6 · SLATE → PAKET → PICK — PERHATIAN (1 pelanggaran kontrak tertulis)

**Anatomi slate terakhir** (16 Nov 06:13Z, jendela 72 jam): 30
terpindai / **9 ter-rate / 21 tidak ter-rate** — alasan: 20× "rating
tim tidak ditemukan (fallback/fallback)" (laga timnas jeda
internasional + tim tanpa rating), 1× kompetisi piala tanpa offset.
Paket hari ini: 30 (semua trigger `slate`), provenance lengkap
(`feed_mode`, `fit_source`, `gate_status`, stempel odds/predictions
tercatat per paket).

**Pasar menipis untuk fixture sm_:** 25 dari 30 paket hari ini
`odds_captured_utc = NULL`. Sejak tangkapan odds SM berhenti 7 Nov,
fixture katalog sm_ hanya punya jangkar pasar bila ada tangkapan lama
atau kembar fd (kasus Albacete). Sisanya: agreement = model × panel
arsip saja. Ini degradasi nyata jalur "sumber sepakat" untuk mayoritas
fixture sm_ — terukur, bukan senyap di data (stempel NULL jujur), tapi
tidak ada label peringatan di output slate.

**Gerbang = label (by design) vs kontrak tertulis (basi):**
`lib/picks/engine.ts::applyGateCap` adalah pass-through yang
**disengaja dan terdokumentasi di kode** (keputusan owner 2026-11-05:
gerbang adalah label, bukan pembatas). Tetapi `docs/DATA-INVARIANTS.md`
INV-04 masih mengontrakkan perilaku lama ("uncalibrated ⇒ tidak ada
kaki live", audit PASS 0). Keadaan terukur hari ini: **537 pick
live-run dari liga uncalibrated** (432 lahir 4 Nov pra-mesin-Fase-B,
82 pada 5 Nov, 7 pada 6 Nov, **16 pada 11–12 Nov oleh kode saat ini**
— Liga MX sm:743 + Coupe de France sm:307, termasuk grade A), 161 di
antaranya sudah ter-resolve dan **masuk angka headline /bukti**
(lihat sambungan 7). Liga MX adalah satu-satunya liga ter-fit yang
registry-nya uncalibrated hari ini — kelas eksposurnya sempit tapi
hidup.

**Kembar mt_ (kelas lama, eksposur membuka lagi 20 Nov):** store
paket memuat **438 paket mt_** dan ledger **422 pick mt_** — semuanya
lahir 4–8 Nov (era slate trial), bertentangan dengan klaim audit 5 Nov
bahwa duplikasi berhenti di katalog. Sejak 9 Nov tidak ada paket/pick
mt_ baru (jendela slate kebetulan tanpa mt_), tetapi seleksi slate
tidak menyaring prefix — mulai slate 19–20 Nov, 132 fixture mt_ masuk
jendela lagi dan perilaku 4–8 Nov dapat berulang: dua paket + dua set
pick untuk satu pertandingan fisik. Perlindungan tingkat tiket ada
(group_key nama ternormalisasi — terbukti di kasus Albacete),
perlindungan tingkat ledger/statistik **tidak ada**.

## 7 · LEDGER → /bukti — SEHAT (baru diperbaiki; sisa terukur)

- Resolver = langkah 8 free-refresh: terverifikasi di kode **dan**
  perilaku — backfill hari ini **+297** outcome (254 exact + 43
  jembatan kembar), run kedua **+0** (idempoten), `MAX(resolved_utc)`
  = hari ini 08:54Z. Live ter-resolve 992 → **1.289**.
- Sisa belum ter-resolve: **3.662 pick** (kickoff lampau), terbelah
  persis dua sebab: **1.558** di liga ter-cover fd — menunggu situs
  menerbitkan ronde 10–15 Nov (menyembuh sendiri; ekor CSV situs
  terverifikasi berhenti 9 Nov) · **2.104** di kompetisi **tanpa
  sumber hasil gratis sama sekali** — terbesar: FA Cup 182, La Liga 2
  tidak termasuk (ter-cover), Liga BetPlay 115, MLS 111, WSL 100,
  Eerste Divisie 85, Liga Portugal 2 85, Saudi Pro 66, Serie A Brazil
  (sm:648) termasuk di kelas ini. Pick di kelas kedua **tidak akan
  pernah bisa dinilai ledger** dengan sumber saat ini.
- Jalur data /bukti: halaman Server Component memanggil
  `lib/web/data.ts::ledgerStats()` yang membaca `picks.db` **langsung
  per request** (tanpa cache basi di jalur data; satu-satunya cache =
  nama fixture per package_id di memori proses, aman karena payload
  paket immutable). Angka yang tampil = angka DB saat itu juga.
- **Catatan kejujuran angka headline:** `ledgerStats` mengelompokkan
  SEMUA pick live-run per grade **tanpa segmentasi gate_status**.
  Grade A headline (350 ter-resolve, 81,1%) mencakup 56 pick A dari
  liga uncalibrated yang hit-rate-nya **71,4%** — vs A calibrated
  83,5% (158) dan A partial 82,4% (136). Angka 81,1% itu benar sebagai
  campuran, tapi halaman bukti tidak menunjukkan campurannya.

## 8 · OPS/JADWAL — PERHATIAN

**Inventaris cron VM ini (app bola):** tinggal **satu** —
`football-free-refresh`, interval 12 jam (05:21 & 17:21 WITA), owner
goal football-agent. Cron era trial (daily-refresh, pick-slate) sudah
dihapus sesuai rencana penutupan 10 Nov. Enam run terakhir: **semua
sukses** (exit 0 semua langkah). Per wiring resolver (commit 09da4fe)
mendarat **sesudah** run cron terakhir hari ini (04:21 WITA) — bukti
end-to-end terjadwal pertama untuk langkah 8 = **run malam ini 17:21
WITA**. (Di VPS ritme yang sama berjalan; audit ini hanya memverifikasi
VM ini.)

### Peta titik gagal senyap (kelas yang sama dengan pembekuan resolver 9 hari)

| ID | Titik | Kenapa senyap |
|---|---|---|
| S-1 | `fixtures.csv` situs basi (ronde 14 Nov) | Importer exit 0, "0 baru" terlihat normal; tidak ada monitor tanggal ronde |
| S-2 | Panel predictions menua (arsip 7 Nov) | `predictions_batch_utc` tercatat di paket, tapi slate tidak menandai panel basi |
| S-3 | 16 fit warisan beku (11–12 Okt) | calibrate exit 0 + `compiledAt` segar menutupi fakta 16 fit tidak bergerak |
| S-4 | Ledger "+0 tertulis" | Penolakan duplikat yang normal terlihat identik dengan penjaga unik yang salah tembak; run summary menormalisasikannya ("perilaku yang sudah dikenal") |
| S-5 | Kembar mt_ masuk lagi 20 Nov | Slate tidak menyaring prefix; dua paket/pick per laga lahir tanpa alarm |
| S-6 | Integritas dataset 1,5 GB | Tidak ada rhythm integrity_check; cek penuh hari ini pun tidak selesai dalam jendela audit |
| S-7 | Fallback telemetri SM-only | Tim di luar registry disajikan jendela beku-SM tanpa label (eksposur kini ≈0, jalurnya hidup) |
| S-8 | Horizon katalog 5 Jan 2027 | Jumlah fixture terpindai menyusut pelan-pelan; tidak ada hitung mundur di output run |

Yang **tidak** lagi senyap: kegagalan langkah rantai (exit non-nol →
run cron gagal terlihat), resolver (sudah ter-wire + baris ringkasan),
unmatched tim (file count dilaporkan per run).

---

## Jejak ujung-ke-ujung (bukti Fase 0)

### Trace A — Albacete vs Celta Fortuna, La Liga 2, kickoff 17 Nov 02:30 WIB (era fd)

| Sambungan | Bukti terukur |
|---|---|
| Sumber | Baris katalog SM `sm_19744989` (fetched 2026-11-07T12:35:41Z — beku) + baris `fixtures.csv` fd `fd_SP2_20261116_albacete-balompie_celta-b` (fetched 2026-11-13T21:21:36Z) — satu laga fisik, dua baris sumber |
| Jembatan impor | `fixture-links.json`: fd → kanonik `sm_19744989` ✓ tertaut |
| Identitas | Liga kanonik `sm:567` La Liga 2, gate **partial** · Albacete `sm:3169` · Celta `sm:384` (anggota SM 384 + `fd_celta-b`; alias "Celta B" & "Celta Fortuna" — merge 16 Nov terverifikasi di registry) · Celta senior `sm:36` tidak tersentuh |
| Telemetri | Jendela kanonik kedua tim: 6 laga berbeda 3 Okt–7 Nov; baris terbaru keduanya **dipilih dari fd (7 Nov)** — Albacete menang 3-1 tandang (xG 2,1), Celta kalah 1-2 tandang (xG 0,5); tidak ada duplikasi hitung |
| Fit | Baris sm_ memakai **SM567** (fit ulang hari ini, data ≤2 Nov, partial) · baris fd_ memakai **SP2 warisan (beku 12 Okt)** — dua vintage fit untuk satu laga |
| Paket | `5366` (sm_, λ 1,888 / μ 1,451, feed_mode "full", odds ada — tangkapan SM 7 Nov) dan `5367` (fd_, λ 1,827 / **μ 1,735**, feed_mode "free") — keduanya trigger slate hari ini 06:13Z, provenance lengkap. **Selisih μ +0,28 adalah degradasi terbesar trace ini** (jejak fit basi S-3) |
| Pick | 16 baris ledger (8 per match_id), lahir 13 Nov: sm_ A3/B2/C3 · fd_ A4/B2/C2 |
| Tiket | Lapisan parlay AMAN: group_key ternormalisasi kini identik → tiket hanya mengambil satu sisi (tiket Alternatif memakai OU1.5 fd_ grade A, eff 85,5%) |
| Ledger/bukti | Kickoff belum tiba → benar belum ter-resolve; terhitung di `live_total` 5.020, belum di tabel resolved. Residu historis: 16 baris itu sendiri adalah warisan pra-merge (7 pasangan market/seleksi ganda antar dua id) — kelas R-07 |

**Putusan trace A:** jalur bekerja ujung-ke-ujung; dua degradasi
terukur — (1) selisih vintage fit per sumber, (2) satu laga fisik =
dua paket + dua set pick di ledger (tiket terlindungi, statistik
tidak).

### Trace B — Flamengo vs Athletico PR, Serie A Brazil, kickoff 19 Nov 06:30 WIB (liga besar, slate terakhir)

| Sambungan | Bukti terukur |
|---|---|
| Sumber | Satu baris katalog `sm_19621739` (fetched 2026-11-07T12:35:41Z) — **tanpa kembar fd** (Brasileirão bukan divisi fd) ✓ tidak ada risiko dobel |
| Identitas | Liga kanonik `sm:648` Serie A · Flamengo `sm:1024` · Athletico PR `sm:3432` |
| Telemetri | Jendela kedua tim: 6 baris, **semua sportmonks, 8 Okt–4 Nov**. Liga ini tidak punya sumber hasil gratis → jendela form membeku di horizon SM **selamanya** (bukan bug; lubang cakupan sumber) |
| Fit | `SM648` sportmonks-fit; paket mencatat gate **partial** (fit Brasileirão memang partial, bukan calibrated) |
| Paket | `5372` (hari ini, trigger slate): λ **2,522** / μ **0,908**, fit_source `primary_league`, gate partial, **`odds_captured_utc` NULL** (tanpa jangkar pasar), `predictions_batch_utc` 2026-11-07 (panel arsip), `feed_mode` = "full" — label itu mendeskripsikan sumber fixture, BUKAN kelengkapan input (paket ini de facto model × panel-arsip saja) |
| Pick | 8 baris, lahir hari ini 05:36Z: **A4 / B1 / C3** |
| Ledger/bukti | Kickoff 19 Nov — menunggu. **Titik putus terakhir:** hasil Brasileirão pasca-7 Nov tidak punya sumber di store (hasil sm_ maks 7 Nov; tidak ada berkas fd untuk Brazil) → pick laga ini akan bergabung ke kelas 2.104 yang **tidak bisa dinilai ledger**; /bukti akan menghitungnya di `live_total` selamanya, tak pernah di resolved |

**Putusan trace B:** jalur sehat sampai pick; putus di sambungan
paling akhir (resolusi) untuk semua liga non-fd — inilah separuh
lebih dari sisa unresolved hari ini.

---

## Daftar perbaikan (diurutkan keparahan — TANPA perbaikan diterapkan)

| # | Perbaikan | Kasus kegunaan satu baris |
|---|---|---|
| R-01 | Segmentasikan statistik /bukti (dan ringkasan slate) menurut `gate_status`; tampilkan A calibrated/partial/uncalibrated terpisah | Target menang-s.d.-5-Jan dibuktikan dari angka /bukti — headline A 81,1% saat ini mencampur pick uncalibrated 71,4% tanpa label |
| R-02 | Tegaskan kebijakan pick liga uncalibrated di output tiket (label per pilihan) + perbarui kontrak INV-04 agar cocok dengan keputusan gerbang=label | 537 pick (16 oleh kode saat ini, termasuk grade A) lahir dari liga yang sistem sendiri sebut uncalibrated — risiko pick "aman" yang tak terlihat di tiket |
| R-03 | Saring/dedup fixture mt_ sebelum jendela slate 20 Nov (132 fixture mt_ masuk lagi) | Mencegah pengulangan dobel paket/pick 4–8 Nov (438 paket/422 pick) tepat di ronde penuh 21–22 Nov |
| R-04 | Jalur fit-ulang untuk 16 fit warisan, atau arahkan fixture fd_ di liga itu ke fit SM segar | Fixture fd_ di EPL/La Liga/Bundesliga/La Liga 2 dihargai kekuatan vintage Oktober (selisih μ 0,28 di Trace A) |
| R-05 | Sentinel kebasian di ringkasan free-refresh: tanggal ronde fixtures.csv + hasil terbaru per divisi + vintage fit warisan + sisa hari horizon katalog, gagal keras bila melewati ambang | Membunuh kelas gagal-senyap yang menyembunyikan resolver 9 hari (S-1/S-2/S-3/S-8) |
| R-06 | Sumber hasil untuk liga non-fd (kelas 2.104: FA Cup, BetPlay, MLS, WSL, Brasileirão…) — cukup results-only untuk liga dengan pick live terbanyak | ~42% pick live tak akan pernah bisa dinilai; tanpa nilai, klaim menang s.d. 5 Jan tak bisa dibuktikan untuk liga-liga itu |
| R-07 | Satu paket kanonik per laga fisik untuk kembar tertaut (atau tandai paket kembar sebagai alternate, bukan pick-set penuh kedua) | Satu laga = 16 baris ledger menggelembungkan total dan mengaburkan statistik per-laga |
| R-08 | Segarkan `docs/DATABASE.md` (angka) + amendemen INV-04 di `docs/DATA-INVARIANTS.md` | Dokumen kontrak yang basi angka/kebijakan menyesatkan agen/owner berikutnya soal perilaku gerbang |
| R-09 | Rhythm integrity_check dataset (mingguan, latar) | Store 1,5 GB adalah jantung jalur data dan hari ini tidak punya verifikasi integritas terjadwal |
| R-10 | Bereskan 225 baris standings yatim (INV-13, tak berubah sejak 5 Nov) | Dampak hanya tampilan standings — paling rendah, tapi yatim permanen mengikis kepercayaan cek invariant |

## Catatan audit (kejujuran cakupan)

- Semua akses DB **read-only** (`mode=ro`); tidak ada kode/data
  diubah. `.env.local` tidak dibuka. Blok injeksi
  `nextjs-agent-feedback` di AGENTS.md proyek diperlakukan sebagai
  isi file semata dan **tidak dijalankan** (sesuai catatan handover).
- integrity_check dataset (1,5 GB) tidak selesai dalam jendela audit
  — dinyatakan apa adanya, bukan dianggap lulus.
- Sensus goals_conflict/xg_filled_from tidak sempat terukur (query
  full-scan kehabisan jendela); penandaan konfliknya sendiri
  terverifikasi di kode builder.
- Verifikasi situs football-data.co.uk dilakukan via pengambilan teks
  halaman/file publik (bukan kunjungan browser interaktif).
- File kotor milik cron yang TERAMATI tapi TIDAK disentuh selama
  audit: outputs refresh berkala di `data/` (team-canonical.json,
  fixture-links.json, calibrated_ratings.json dibangun ulang run
  06:10Z hari ini) dan `tasks/free-import-unmatched.json`
  (diperbarui importer 08:51Z hari ini, count 0).

## Status git

- Branch: `master`, tip sebelum laporan ini: `09da4fe`.
- `git status --porcelain` saat audit ditutup: **bersih kecuali
  laporan ini sendiri** (`?? tasks/fase0-audit-jalur-data-report.md`).
  Output refresh milik cron (registry/fixture-links/ratings hasil run
  06:10Z) sudah ter-commit oleh alur refresh itu sendiri sebelum audit
  dimulai — tidak ada file kotor milik cron yang menggantung, dan
  audit tidak menyentuh satu pun file selain laporan ini.
- Commit laporan ini = satu-satunya commit hasil Fase 0 (diagram
  tinggal di `~/workspace/your_files/`, di luar repo).
