# Laporan Redesain — Langkah 2: KEANDALAN (branch `redesain/bola`)

Basis: `5dfe499` (langkah 1) di atas `ef9b67c` (fix/review-k8). Tanggal: 2026-11-21.
Ruang lingkup: keandalan saja (§8 baris 2 brief) — tanpa perubahan bahasa
visual/susunan halaman (langkah 3–5). Tiga perbaikan, tiga commit terpisah.

**Hasil ringkas**

| Perbaikan | Status | Bukti kunci |
|---|---|---|
| A. Identitas tim terbelah | SELESAI | 58 gabung kanonik + 1 pisah paksa (Everton); tautan 188 → 260; Marseille: 16 pick → 9 kejadian, OU1.5 satu kali 85,5%, gabungan 85,5% (bukan 73,2%); 4 kejadian konflik ditahan berjejak |
| B. Status berdimensi waktu | SELESAI | Jam beku 24/24: sebelum = "Belum mulai", tepat kickoff/+3,5 jam/+24 jam = "Menunggu pembaruan pertandingan", sumber terkonfirmasi selalu menang |
| C. Isolasi error per bagian | SELESAI | Tabel telemetri absen → detail tetap render, form kosong terdegradasi, data inti utuh |

Suite baru `tests/test-redesain-keandalan.ts`: **62/62** (A 18, B 24, C 8, R 12).
Regresi: test:data **278/278**, test:web **236/236**, test:api **42/42**,
suite reproduksi langkah 1 **32/32** (Kasus 3 diperbarui — lihat §5),
`npx tsc --noEmit` bersih, `npm run build` bersih.

---

## A. Identitas tim terbelah

### A.1 Mekanisme perbaikan (di sumber kebenaran, bukan tambalan halaman)

1. **Registry kanonik** (`scripts/build-team-canonical.ts` → `data/team-canonical.json`):
   audit kelas penuh (metode di A.2) menghasilkan entri `MERGE_PAIRS`
   "Gelombang 5 (2026-11-21)" — setiap pasangan membawa alasan bukti.
   Registry dibangun ulang dari builder: **6.600 → 6.543 tim** (−58 gabung,
   +1 pisah). Diff adopsi diverifikasi tim-per-tim: nol perubahan di luar
   keputusan audit.
2. **Builder tautan** (`scripts/build-fixture-links.ts`, tak diubah kodenya —
   mesinnya sehat, datanya yang terbelah): `data/fixture-links.json`
   dibangun ulang dengan registry baru: **188 → 260 tautan / 244 grup
   kembar, 0 tim tak ter-resolusi**. Termasuk `mt_022917440 → sm_19715544`
   dan `mt_377265875 → sm_19715561` (pasangan Marseille–Toulouse yang juga
   tak tertaut). Rantai refresh membangun ulang file ini dari registry
   yang sama, jadi perbaikan persisten.
3. **Kunci semantik di jalur saji** (`lib/web/rekam.ts`): `daftarPilihanPraLaga`
   kini mengelompokkan per **kunci fisik** (fixture_uid ledger; untuk baris
   ber-UID NULL, resolusi batch read-only lewat `fixture_aliases` store
   identitas K1 — `petaUidFisik()`; fallback match_id) + pasar + garis +
   pilihan. `ambilRekam` memakai kunci fisik yang sama untuk resolusi UID
   baris dan hitungan `laga_dinilai_unik`.
4. **Penjaga gabungan** (`lib/web/parlay.ts`): `combineSlip` men-dedupe
   kejadian semantik identik (laga fisik + pasar + pilihan) sebelum
   pengelompokan — kejadian yang sama tidak bisa dikuadratkan dari jalur
   mana pun. `components/pilihan/ParlayBuilder.tsx` + `app/(terminal)/pilihan/page.tsx`:
   pilihan berkonflik tidak bisa ditambahkan (tombol nonaktif, label
   "Konflik", jejak angka + asal tampil).

### A.2 Metode audit kelas (bukan cuma Marseille)

Dua jalur bukti independen atas katalog (3.924 baris) + registry lama:

- **Bukti kembar**: pasangan baris katalog lintas namespace dengan kickoff
  identik + satu sisi kanonik sama + sisi lain terbelah → 53 pasangan
  kandidat.
- **Bukti nama**: kesetaraan himpunan token nama setelah stopword dibuang
  (de, fc, sk, fk, sv, the, …) lintas entri yang disjoint namespace.

Kandidat hanya digabung bila identitas terbukti oleh fixture kembar
(kickoff + lawan kanonik + kompetisi identik di kedua sumber) atau fixture
cermin dataset (baris TheStats `comp_3498` vs baris Sportmonks `sm:2`
dengan tanggal + lawan identik). Kemiripan nama semata TIDAK cukup.

**Kontrol negatif yang lolos uji**: Olympique Lyonnais tetap terpisah;
pasangan kontrol sintetis Le Mans–Toulouse (registry menyatu) tertaut
dengan benar sebelum dan sesudah — mesin tautan memang sehat.

### A.3 Daftar gabung yang dilakukan (58) + bukti identitas

Format: `sumber → kanonik`. Bukti ringkas; alasan lengkap per pasangan
tercatat di `MERGE_PAIRS` builder.

**TheStats → Sportmonks (19):**

| Gabung | Klub | Bukti |
|---|---|---|
| tm_25550 → sm:44 | Olympique Marseille | Fixture kembar Ligue 1: vs Le Mans 22 Nov, vs Toulouse 1 Nov, vs Nice 8 Nov (kickoff + lawan identik dua sumber). "de" membuat nama ternormalisasi beda. |
| tm_master_charleroi → sm:1087 | Sporting Charleroi | Kembar Pro League vs Westerlo 7 Nov |
| tm_master_ofi_crete → sm:118 | OFI Crete | Kembar Super League Yunani vs Atromitos 8 Nov (SM menyimpan "OFI") |
| tm_8557956 → sm:138649 | Sabah FK | Kembar UCL 25 Nov (SM menyimpan "Sabah") |
| tm_master_oud_heverlee_leuven → sm:1947 | OH Leuven | Kembar Pro League vs Mechelen 7 Nov |
| tm_64842 → sm:216 | Slavia Praha | Kembar UCL 4 + 25 Nov (SM tanpa "SK") |
| tm_02198 → sm:2417 | Slovan Bratislava | Kembar UCL 3 + 24 Nov |
| tm_89026 → sm:3588 | SV Elversberg | Kembar Bundesliga 7 + 21 + 28 Nov ("SV 07 Elversberg") |
| tm_98394 → sm:429 | Deportivo La Coruña | Kembar LaLiga 2 + 7 Nov (SM "Deportivo A Coruña"); alias CSV "La Coruna" ikut pindah |
| tm_64398 → sm:794 | Mainz 05 | Kembar Bundesliga 7 + 22 + 28 Nov (SM tanpa "1.") |
| tm_64681 → sm:7980 | Atlético Madrid | Kembar LaLiga/UCL 31 Okt + 3 + 8 Nov |
| tm_master_levadeiakos → sm:990 | Levadiakos | Kembar Super League Yunani vs AEK 8 Nov (ejaan "Levadeiakos") |
| tm_master_raal_la_louviere → sm:6722 | RAAL La Louvière | Kembar Pro League vs Cercle Brugge 7 Nov |
| tm_26373 → sm:669 | Willem II | Kembar Eredivisie 6 + 22 + 27 Nov — "II" = nama raja, BUKAN tim cadangan |
| tm_76152 → sm:2673 | Crvena Zvezda | Fixture cermin dataset (comp_3498 vs sm:2, Jul–Agu 2026, tanggal + lawan identik) |
| tm_08322 → sm:321 | Viking FK | Fixture cermin dataset (Agu–Okt 2026) |
| tm_25152 → sm:3357 | Sturm Graz | Fixture cermin dataset (5 Agu 2026) |
| tm_42581 → sm:3877 | Borac Banja Luka | Fixture cermin dataset (Jul 2026) |
| tm_2905815 → sm:928 | Kauno Žalgiris | Fixture cermin dataset (Jul–Agu 2026) |

**football-data CSV (fd_) → Sportmonks (38)** — semuanya terbukti fixture
kembar (kompetisi + kickoff + lawan identik); pola umumnya nama CSV pendek/
singkatan/tanpa diakritik: fd_accrington→395 Accrington Stanley ·
fd_amedspor→3570 Amed SK · fd_bielefeld→2927 Arminia Bielefeld ·
fd_birmingham→12 Birmingham City · fd_bolton→16 Bolton Wanderers ·
fd_borussia-monchengladbach→683 Borussia Mönchengladbach ·
fd_bristol-rvs→230 Bristol Rovers · fd_burton→150 Burton Albion ·
fd_buyuksehyr→3702 İstanbul Başakşehir · fd_charlton→4 Charlton Athletic ·
fd_colchester→74 Colchester United · fd_corum→13871 Çorum FK ·
fd_cottbus→3322 Energie Cottbus · fd_crewe→87 Crewe Alexandra ·
fd_den-haag→1128 ADO Den Haag · fd_dresden→1077 Dynamo Dresden ·
fd_erzurumspor→13818 Erzurumspor · fd_estrela→12152 Estrela Amadora ·
fd_for-sittard→1459 Fortuna Sittard · fd_guimaraes→830 Vitória Guimarães ·
fd_harrogate→382 Harrogate Town · fd_hartlepool→310 Hartlepool United ·
fd_hornchurch→1151 AFC Hornchurch · fd_iraklis→7171 Iraklis ·
fd_kortrijk→1130 KV Kortrijk · fd_lincoln→305 Lincoln City ·
**fd_mansfield→225 Mansfield Town** · fd_nijmegen→494 NEC Nijmegen ·
fd_padova→249160 Calcio Padova · fd_panetolikos→213 Panaitolikos ·
fd_scunthorpe→101 Scunthorpe United · fd_sp-braga→884 Sporting Braga ·
fd_stockport→249 Stockport County · fd_tranmere→201 Tranmere Rovers ·
fd_vfl-bochum→999 VfL Bochum · fd_yeovil→261 Yeovil Town ·
fd_york→92 York City · fd_zwolle→1016 PEC Zwolle.

**Pecahan internal Sportmonks (1):** 562 → 602 Olympiacos. Id 562
("Olympiakos", label World) hanya membawa 3 laga persahabatan; 602 membawa
73 domestik + Eropa; anggota tm_47798 sudah duduk di 562. Kanonik dipaksa
ke pembawa utama 602 lewat `CANONICAL_ID_OVERRIDES` (pola sama dengan
kasus Benfica 254165/605 yang sudah ada).

**Pisah paksa yang ditemukan audit (over-merge lama) — Everton:**
entri `sm:15064` lama mencampur Everton FC Inggris (SM 13, Premier
League/Carabao) dengan Everton de Viña del Mar Chile (SM 15064, Primera
Chile) + tm_8091 — nama tersimpan identik "Everton", kompetisi disjoint.
Campuran ini bahkan memfabrikasi kandidat kembar palsu (Brentford↔
Coquimbo). Perbaikan: mekanisme baru `SPLIT_DECISIONS` di builder
(memisahkan anggota SEBELUM fase gabung) — 15064 menjadi entrinya sendiri
(`sm:15064`, Chile), tuan rumah dihitung ulang ke `sm:13` (Inggris);
`DISTINCT_PAIRS` ditambah dua arah untuk 13/15064, 374/2488 (Bohemians
Dublin vs Bohemians 1905 Praha — terbukti distinct: 20 laga id 374 semua
vs klub Irlandia), dan fd_mansfield/20249 (Mansfield Town vs AFC
Mansfield, klub non-liga berbeda).

### A.4 Curiga, TIDAK digabung (dilaporkan saja)

- **SK Beveren 1272 vs Beveren 6723** — aktivitas konkuren 2024–2026 di
  himpunan kompetisi disjoint; identitas tak terbukti. TAHAN.
- **6 entri curiga over-merge lama, tidak disentuh langkah ini**
  (memisahkannya butuh audit sendiri): Athletic Club (13258/234948),
  Andorra timnas 18781 vs FC Andorra 238115, Al Ittihad 476/7784,
  Nacional 7035/828, Liverpool 8/976, Racing 5632 di dalam entri sm:8364.
- Terkonfirmasi tetap terpisah (sudah benar): River Plate ARG/URU,
  Melilla, Ourense, San Fernando, Coria, Celoricense, Qatar vs Qatar SC,
  VfB vs VfL Oldenburg, Man Utd vs United of Manchester, LA Galaxy vs
  Galaxy, León vs St. Leon.

### A.5 Konflik BTTS — aturan brief §4 diterapkan

Umpan Marseille nyata (16 pick terbit, semuanya 2026-11-19T21:40:53Z,
basis effective) melebur jadi **9 kejadian semantik**:

- Sepakat (satu pilihan, tanpa konflik): OU1.5 over **0,8553** (dua edisi),
  DC 12 0,8288, team_over05_home 0,8715; tunggal: 1X2 "1" 0,6288 (sm),
  OU3.5 over 0,6882 (mt).
- **Konflik (4 kejadian)** — dua edisi resmi, angka berbeda, bukti tak
  menyelesaikan: BTTS yes **0,6276 (sm_19715544) vs 0,7727 (mt_022917440)**,
  DC 1x 0,8288 vs 0,7271, OU2.5 over 0,6789 vs 0,8094, team_over05_away
  0,7014 vs 0,8136. Perilaku: tampil SATU baris perwakilan (edisi terbit
  pertama — prinsip keputusan-pertama K2) dengan field `konflik` berisi
  jejak lengkap (semua nilai + match_id + pick_uid + package_id +
  published_at_utc); **kejadian ditahan dari kombinasi** — builder menolak
  menambahkannya dan menampilkan jejaknya. Tidak ada angka yang dipilih
  diam-diam.

### A.6 Uji penerimaan identitas (brief §7)

- Builder di sandbox registry-gabung: `mt_022917440 → sm_19715544`,
  `mt_377265875 → sm_19715561`, kontrol Le Mans–Toulouse tertaut. ✓
- Store identitas K1: kedua alias Marseille menyelesaikan ke UID fisik
  yang sama; Lyon tidak menyatu. ✓
- Tambah "Minimal dua gol" lewat kedua alias → **1 kelompok, gabungan
  ≈ 0,8553 dari matriks laga itu (bukan 0,7315/73,2%)**. ✓
- Slip 5 pilihan bisa-digabung = 1 kelompok laga fisik; joint ≤ marginal
  terkecil. ✓ Kasus pembanding dua laga mirip tetap dua: kontrol +
  negatif Lyon di atas. ✓

### A.7 Dampak historis — BACA SAJA (tidak ada penulisan ulang)

Basis hitung: salinan berbentuk produksi pasca-migrasi
`k8-rehearsal/work/data/picks.db` (170.813 pick; DB checkout utama masih
skema pra-K2 sehingga tidak bisa dipakai). Metode: selisih himpunan
tautan baru vs lama dipetakan ke pick ber-`fixture_uid` NULL.

- Pick ber-fixture_uid NULL: **5.534** dari 170.813.
- Yang kini ter-resolusi ke UID fisik bersama oleh tautan baru:
  **367 pick** (61 sisi twin + 306 sisi canonical) pada 52 match_id /
  71 laga fisik baru tertaut — **seluruhnya pick terbit resmi**
  (pick_uid terisi). Marseille menyumbang 16 di antaranya.
- Sisa 5.167 pick NULL berada di laga TANPA kembaran lintas sumber
  (satu sumber saja) — kunci fisiknya memang match_id; bukan defek.
- Agregat yang berubah ke depan: hitungan laga unik pada rekam/umpan
  untuk 71 laga fisik itu kini satu (bukan dua), dan kejadian semantik
  yang bertabrakan angka tampil sebagai konflik berjejak, bukan dua
  pilihan. Angka histori yang sudah terbit TIDAK diubah; resolusi terjadi
  saat baca (read-time), tercatat di laporan ini — sesuai larangan
  menulis ulang histori diam-diam. Migrasi data produksi tidak dieksekusi
  di langkah ini.

---

## B. Status berdimensi waktu

### B.1 Mekanisme

`lib/web/status.ts` (kontrak 7 status dasar `FixtureStatus` TIDAK berubah
— dikunci test-ui K6):

- Label terjadwal diganti sesuai brief §4: "Akan datang" → **"Belum mulai"**.
- Tipe tampil baru `StatusTampil = FixtureStatus | "menunggu-pembaruan"`
  + `LABEL_STATUS_TAMPIL` ("Menunggu pembaruan pertandingan").
- `terapkanWaktu(status, kickoffUtc, nowMs)`: hanya status
  scheduled/unknown yang berubah — kickoff terbaca dan `nowMs >= kickoff`
  → menunggu-pembaruan (tepat pada T sudah termasuk, konsisten cutoff K2).
  Status terkonfirmasi sumber (live/finished/postponed/cancelled/
  abandoned) selalu menang; kickoff tak terbaca → status sumber apa
  adanya (tidak ditebak).
- `menitDariStatusMentah()` membaca menit dari status mentah berpola
  `63'` (rentang 0–130); `labelStatus(status, menit?)` merender
  "Sedang berlangsung · 63'" bila sumber menyediakan menit.

`lib/web/data.ts`: `getMatchState(matchId, nowMs = Date.now())` membawa
kickoff (dataset `utc_date` / katalog) ke `keadaanDariBaris`, yang
menerapkan dimensi waktu pada status gabungan (penggabungan
dataset-vs-katalog yang sudah ada tidak berubah); `KeadaanLaga` membawa
`menit`. Jalur batch jadwal (`keadaanBatch`/`listSchedule`, satu
`nowMs` per panggilan) dan fallback `getFixtureInfo` (3 titik) memakai
fungsi yang sama — **identik di semua permukaan**. Halaman jadwal +
detail merender lewat `labelStatus`; filter jadwal "akan-datang"
(valuenya tetap, demi URL) kini menyertakan menunggu-pembaruan dan
label opsinya "Belum mulai".

Penilaian yang menunggu skor regulasi tetap wewenang resolver Fix-3
(`pending_score_basis`) — lapisan status hanya menampilkan keadaan;
"final tanpa skor" tampil Selesai dengan gol null, penilaiannya menunggu
di lapisan resolver. Jam kickoff mengunci penambahan pilihan: cutoff K2
sudah diverifikasi-ulang di dalam kunci penulis pada Fix-3 dan umpan
pra-laga menyaring `kickoff_utc > now` — tidak diubah langkah ini.

### B.2 Uji jam beku (24/24)

Unit murni + integrasi sandbox (katalog sumber tetap 'scheduled'):

| Keadaan | Hasil |
|---|---|
| T−1 menit / T−1 ms | scheduled — "Belum mulai" |
| Tepat T | menunggu-pembaruan |
| +3,5 jam (pola Rostov) | menunggu-pembaruan |
| +24 jam (pola Barcelona W) | menunggu-pembaruan — "Menunggu pembaruan pertandingan" |
| Sumber 'live' pada jam berapa pun | live — "Sedang berlangsung" (menang atas jam) |
| Menit dari status mentah `63'` | 63 → label "Sedang berlangsung · 63'" |
| Ditunda/dibatalkan +24 jam | mengikuti sumber (Ditunda/Dibatalkan) |
| FT / finished | Selesai |
| Status tak dikenal + kickoff lewat | menunggu-pembaruan |
| Terjadwal tanpa kickoff terbaca | scheduled (tidak ditebak) |

Integrasi: `getMatchState` Barcelona pada T−1m/T/+24 jam dan Rostov pada
+3,5 jam sesuai tabel; jalur batch `listSchedule` memberi status yang
sama untuk laga yang sama.

---

## C. Isolasi error per bagian di detail

### C.1 Mekanisme

`lib/web/data.ts`: helper internal `bagian(fn, fallback)` — pembaca
bagian yang melempar terdegradasi ke keadaan kosong miliknya.
`getForm()` dibungkus (tabel `team_match_logs_canonical` belum dibangun
rantai refresh → form kosong, bukan pengecualian — ini persis temuan
samping langkah 1). `getMatchDetail()` membungkus setiap bagian
pendukung: pick paket → [], hasil → null, form (via getForm), keadaan →
null, pilihan resmi → [], tiket resmi → []. Paket = data inti dan tetap
syarat keras (tanpa paket → null = tidak ditemukan, perilaku Fix-1
utuh). Halaman detail sudah merender setiap bagian secara kondisional,
jadi bagian kosong tampil sebagai keadaan belum-tersedia miliknya
sendiri tanpa perubahan visual.

### C.2 Uji (8/8)

Sandbox dengan dataset TANPA tabel telemetri: `getForm` langsung tidak
melempar (hasil 0); `getMatchDetail(sm_19726740)` tetap render — tim
dari paket utuh, market warisan null (Fix-1), peluang 1x2 kandang sama
persis dengan payload, form kedua sisi kosong terdegradasi, keadaan
laga tetap terhitung (menunggu-pembaruan — konsisten Perbaikan B).

---

## 4. File berubah

- **A**: `scripts/build-team-canonical.ts` (MERGE_PAIRS gelombang 5,
  SPLIT_DECISIONS, DISTINCT_PAIRS, override 602), `data/team-canonical.json`
  (dibangun ulang), `tasks/team-canonical-report.md` (keluaran builder),
  `data/fixture-links.json` (dibangun ulang), `lib/web/rekam.ts`
  (petaUidFisik/kunciFisik/kelompok semantik/konflik), `lib/web/parlay.ts`
  (dedupe kejadian identik), `components/pilihan/ParlayBuilder.tsx` +
  `app/(terminal)/pilihan/page.tsx` (konflik ditahan + jejak tampil).
- **B**: `lib/web/status.ts`, `lib/web/data.ts` (jalur status),
  `app/(terminal)/pertandingan/page.tsx`,
  `app/(terminal)/pertandingan/[matchId]/page.tsx`.
- **C**: `lib/web/data.ts` (bagian/getForm/getMatchDetail).
- **Uji**: `tests/test-redesain-keandalan.ts` (baru, 62 assertion),
  `tests/helpers/redesain2-probe.ts` (baru),
  `tests/fixtures/redesain-repro/registry-tim-gabung.json` (baru —
  ekstrak registry gabung nyata), `tests/helpers/redesain-probe.ts`
  (aksi status diperluas), `tests/test-redesain-repro.ts` (Kasus 3
  diperbarui, Kasus 1 diberi catatan fixture beku).

## 5. Suite reproduksi langkah 1 — pembaruan dengan alasan

- **Kasus 3 diperbarui**: assertion defek ('scheduled' + 'Akan datang'
  walau kickoff lewat) diganti perilaku brief §4 — memang itulah yang
  diperbaiki Perbaikan B.
- **Kasus 1 tetap hijau tanpa perubahan assertion**: sandbox-nya
  menyemai fixture registry PRA-perbaikan (ekstrak verbatim registry
  lama), jadi defek tetap ter-reproduksi sebagai catatan historis;
  perilaku sesudah perbaikan dikunci suite langkah 2 (Kasus A + R).
  Catatan ini ditulis di header suite.
- Kasus 2 dan 4 tidak berubah dan tetap hijau (32/32 total).

## 6. Penyimpangan & catatan

1. **Build sempat gagal karena `.env.local` tidak ada di worktree**
   (file tak-terlacak tidak ikut worktree; `syndicate-orchestrator`
   melempar saat evaluasi modul). Diatasi dengan menyalin `.env.local`
   dari checkout utama (tidak dibaca isinya, tidak ter-commit —
   terkonfirmasi tidak muncul di `git status`). Bukan perubahan kode.
2. **Menit pertandingan**: sumber data saat ini tidak menyediakan menit
   pada status live (ejaan live K1: live/1h/2h/ht), jadi menit tampil
   bila pola `63'` muncul di status mentah — parser + labelnya teruji
   unit; tanpa sumber menit, label tetap "Sedang berlangsung".
3. **6 entri curiga over-merge + pasangan Beveren** dilaporkan, tidak
   disentuh (A.4) — membelah/menggabungnya tanpa bukti akan melanggar
   kehati-hatian brief §4.
4. `tasks/team-canonical-report.md` ikut berubah sebagai keluaran
   builder registry (bukan dokumen bebas).
5. Tidak ada merge, deploy, sentuhan VPS/master/DB produksi, atau
   perubahan κ di langkah ini.
