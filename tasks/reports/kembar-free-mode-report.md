# Laporan Fix Kembar Free-Mode (fd_/sm_) — 25 Nov 2026

Branch `fix/kembar-free-mode` dari master `fcf4c5a`. Perintah pemilik:
"Gas perbaiki sekarang" (25 Nov 2026 18:28 WIB), sebelum kickoff
kembar pertama (Boreham Wood, Kam 26 Nov 02:00 WIB = 2026-11-25T19:00Z).

## Ringkasan

Empat laga fisik terbit dua kali di slate dan ledger — sekali sebagai
fixture `sm_`, sekali sebagai fixture `fd_` bernama pendek:

| Laga fisik | sm_ (ledger) | fd_ (ledger) | Kickoff UTC |
|---|---|---|---|
| Boreham Wood vs Aldershot Town | sm_19748115 (pkg 8802, 9 pick) | fd_EC_20261125_boreham-wood_aldershot (pkg 9205, 8 pick) | 2026-11-25T19:00Z |
| Hartlepool United vs Solihull Moors | sm_19748113 (pkg 8809, 8 pick) | fd_EC_20261125_hartlepool_solihull (pkg 9212, 8 pick) | 2026-11-25T19:45Z |
| Harrogate Town vs Kidderminster Harriers | sm_19748114 (pkg 8810, 6 pick) | fd_EC_20261125_harrogate_kidderminster (pkg 9211, 6 pick) | 2026-11-25T19:45Z |
| Doncaster Rovers vs Huddersfield Town | sm_19728143 (pkg 9044, 8 pick) | fd_E2_20261126_doncaster_huddersfield (pkg 9258, 6 pick) | 2026-11-26T20:00Z |

Total 59 pick tercatat (31 sm_ + 28 fd_), 27 di antaranya duplikat
persis per (market, selection, line). Catatan koreksi kecil atas
brief: nomor paket sisi sm_ di brief (9201/9209/9210/9244) adalah
nomor paket di berkas slate; nomor paket LEDGER terverifikasi adalah
8802/8809/8810/9044 (sm_) dan 9205/9211/9212/9258 (fd_).

Perbaikan tiga lapis: (1) aturan umum varian-akhiran nama di kunci
tautan menyatukan keempat pasang lewat mesin builder sendiri;
(2) penjaga cadangan slate memakai kunci komposit yang sama sehingga
pencocokan fisik tidak lagi bergantung pada `fixture_uid` baris
ledger; (3) 27 pick fd_ duplikat dimarking `duplicate_of` di produksi
(copy-first, backup terverifikasi) — efek persisnya dinyatakan apa
adanya di Fase 3.

## Fase 1 — Diagnosis per lapis (bukti, bukan tebakan)

### 1a. Builder tautan: kunci tim belah di SATU sisi tiap pasang

Resolver registry (`buildTeamResolver.resolve`) mengutamakan
`team_id`. Baris katalog (verbatim dari `upcoming_fixtures` produksi):

- Boreham: home kedua baris team_id "998" → sm:998 sama. Away: sm_
  "194" → **sm:194** "Aldershot Town"; fd_ "fd_aldershot" →
  **fd_aldershot** "Aldershot" — entri kanonik fd_ SENDIRI. **BELAH.**
- Hartlepool: fd_ home "fd_hartlepool" → **sm:310** (sudah member;
  alias "Hartlepool"/"Hartlepool United") sama dengan sm_. Away:
  "1030" → sm:1030 vs "fd_solihull" → **fd_solihull**. **BELAH (away).**
- Harrogate: fd_ home "fd_harrogate" → **sm:382** (member) sama.
  Away: "832" → sm:832 vs "fd_kidderminster" → **fd_kidderminster**.
  **BELAH (away).**
- Doncaster: home "235" → sm:235 vs "fd_doncaster" → **fd_doncaster**.
  **BELAH (home).** Away kedua baris "251" → sm:251 sama.

Kunci tautan lama = canonical_id (di luar 2 grup alias manual), jadi
`home_key|away_key` kedua baris berbeda → `clusterTwinRows` tidak
membentuk klaster → tidak ada tautan. Kickoff kedua baris PERSIS sama
(selisih 0 ≤ toleransi 120) dan konteks liga kompatibel (nama
kompetisi identik di kedua baris; EC/E2 jatuh ke name_key) — kickoff
dan liga BUKAN penghalang; satu-satunya penghalang adalah kunci tim.
Kelasnya sama dengan belahan registry Lanjut-5 (Beveren), kali ini
ber-namespace fd_: sebagian entri fd_ sudah jadi member entri sm:
(fd_hartlepool, fd_harrogate), empat ini sisa yang belum menyatu.

### 1b. Penjaga cadangan slate: kunci yang sama, lubang yang sama

`scripts/pick-slate.ts` membangun ref cadangan dari resolver +
`linkTeamKeyFn` yang sama → kunci fd_ tetap belah → tidak ada klaster
di kolam pindai (`representativeOf` kosong untuk pasang ini) dan ref
tercatat sisi sm_ tidak pernah `samePhysicalFallback` dengan ref fd_
→ `fallbackBlockReason` mengembalikan null → paket fd_ terbit penuh.
Bukti statistik slate 25 Nov (dua refresh): `unlinked_twin_fixtures_
skipped: 0`, `linked_twin_fixtures_skipped: 3`, `fixtures_rated_free_
mode: 4`.

Soal `fixture_uid` NULL di baris ledger sm_: jalur terbit mengambil
`fixture_uid` dari identity store dataset (`getUidForMatchId` atas
match_id), BUKAN dari baris ledger; penjaga titik-tulis
(`recordedPhysicalKeys`/`writtenPhysicalKeys`) mengunci dari
match_id lewat `fixture-links` — jadi sekali tautan ada, penjaga itu
bekerja tanpa peduli NULL. Lubang NULL yang nyata ada di tempat lain:
pengelompokan duplikat resmi migrasi K2 per `(fixture_uid, market,
line, selection, series)` tidak akan pernah memasangkan baris-baris
ini (sisi sm_ fixture_uid-nya NULL).

### 1c. Semantik `duplicate_of` di kode (dibaca + dibuktikan di Fase 3)

- Definisi (`lib/picks/publication-migration.ts`): dalam grup
  (fixture_uid, market, line, selection, series), baris terawal
  memegang `pick_uid`; baris berikutnya `duplicate_of` = id baris
  pertama dan `pick_uid` = NULL. Ke-59 pick kembar ber-basis
  `effective`, jadi migrasi (hanya memproses basis NULL) tidak akan
  pernah menyentuhnya.
- Satu-satunya konsumen perilaku: `publishSlip`
  (`lib/picks/tickets.ts`) — slip yang memuat pick ber-`duplicate_of`
  DITOLAK dengan alasan `leg_not_official`.
- Resolver TIDAK menyaring duplikat (`listUnresolved` mengambil semua
  pick tanpa outcome) → ke-59 pick tetap dinilai resolver.
- `cohortStats` dan `ledgerStats` TIDAK menyaring `duplicate_of` →
  duplikat yang sudah dinilai tetap terhitung penuh di statistik
  akurasi/cakupan utama.
- Daftar /bukti (`kelompokkanKejadianResmi`) sudah mengelompokkan per
  laga fisik → duplikat tampil sebagai SATU kejadian dua edisi sumber
  (label konflik bila probabilitas terbit berbeda).
- `pick_voids` adalah satu-satunya mekanisme pengecualian statistik,
  tetapi semantik terdokumentasinya adalah pembatalan provider —
  di luar ruang lingkup perubahan produksi yang diizinkan brief
  (UPDATE `duplicate_of` saja), jadi tidak dipakai.

## Fase 2 — Perbaikan

### 2a. Aturan umum varian-akhiran (`lib/identity/link-matching.ts`)

Fungsi baru, registry TIDAK pernah diubah (pola Lanjut-5):

- `linkNameTokens(name)` — token nama ternormalisasi (huruf kecil,
  diakritik dilucuti, non-alfanumerik → spasi).
- `suffixVariantGroups(reg)` — untuk setiap entri kanonik fd_,
  kandidat = entri non-fd_ yang token namanya menjadikan token nama
  fd_ sebagai AWALAN PERSIS yang sejati (lebih banyak token). Tepat
  1 kandidat → grup varian; 0 atau ≥2 → DITOLAK (ambigu tetap urusan
  alias manual berbasis bukti). Nama identik antar-entri (bukan
  awalan sejati, mis. dua "Everton") tidak disatukan di sini.
- `buildLinkTeamKeyFn(reg, aliases)` — kunci komposit: entri fd_
  varian dipetakan ke canonical panjangnya, lalu alias manual
  diterapkan atas hasilnya (alias manual tetap menang; terverifikasi
  konsisten: fd_standard → sm:700 → "standard-liege").

Bukti cakupan aturan atas registry produksi: 38 entri fd_; 30
berelasi awalan; **22 unik** (termasuk 4 penyebab bug: fd_aldershot →
sm:194, fd_solihull → sm:1030, fd_kidderminster → sm:832,
fd_doncaster → sm:235); **8 ambigu ditolak** (fd_bradford → City/Town/
Park Avenue, fd_cambridge, fd_carlisle, fd_grimsby, fd_hamilton,
fd_northampton, fd_sutton, fd_swindon). Risiko klub-salah dicatat
jujur: fd_queens-park → kandidat tunggal sm:47 "Queens Park Rangers"
padahal Queen's Park FC ≠ QPR — TETAPI penyatuan kunci bukan tautan:
klaster tetap menuntut lawan sama + liga cocok + kickoff ≤120 menit,
jadi kedua klub itu tidak pernah tertaut (diuji sebagai kasus
negatif).

Titik pakai diubah tepat dua: `scripts/build-fixture-links.ts` dan
ref cadangan `scripts/pick-slate.ts` — keduanya kini memakai
`buildLinkTeamKeyFn`. `linkTeamKeyFn` lama tetap diekspor utuh.

Verifikasi builder di worktree atas SALINAN data produksi (registry +
katalog saat ini): tautan 322 → **343** (+21, 0 hilang). Keempat
pasang target tertaut ke canonical sm_ yang benar. 17 tautan baru
lainnya adalah fixture fd_ historis (14–24 Nov) dari kelas yang sama
— spot-check 4 di antaranya verbatim sama laga (kickoff persis, nama
pendek vs panjang): Exeter/Cheltenham, Solihull/Altrincham, Oxford/
Wycombe, Fylde/Halifax. Berkas `data/fixture-links.json` hasil
regenerasi TIDAK di-commit di branch ini: refresh 04:21
meregenerasinya dari kode hasil merge pada langkah 3, sebelum
konsumen mana pun berjalan, dan meng-commitnya akan bertabrakan
dengan salinan regenerasi dirty di checkout utama.

### 2b. Penjaga cadangan diperkuat (lewat kunci yang sama)

Tidak ada perubahan logika di `slate-identity.ts`/`publication.ts` —
kelemahannya bukan logikanya melainkan kuncinya. Dengan kunci
komposit, ref cadangan kedua sisi kini berbagi `home_key`/`away_key`
yang sama, sehingga: fd_ terblokir `bukan-wakil-klaster` bila wakil
sm_ ikut terpindai, dan terblokir `sudah-tercatat` bila laga fisik
sudah tercatat lewat match_id sisi lain — pencocokan berjalan dari
baris katalog per match_id, sama sekali tidak membaca `fixture_uid`
baris ledger, jadi lubang NULL tertutup oleh konstruksi. Lapisan
ketiga (penjaga titik-tulis per `physicalKey` fixture-links) ikut
menguat begitu tautan terbentuk.

### 2c. Tes

`tests/test-slate-kembar-tak-tertaut.ts`: **73 → 127 assertion**
(+54, semua lolos) — 8 baris katalog produksi verbatim; reproduksi
defek kunci lama (0 klaster); kunci komposit → tepat 4 klaster exact
berwakil sm_; cid registry tetap belah (registry tidak digabung);
22 grup varian + 8 ambigu ditolak + nama identik tidak disatukan;
penjaga memblokir fd_ lewat kedua jalur (bukan-wakil dan
sudah-tercatat dari match_id sisi sm_); negatif Queens Park vs QPR;
kontrak pengawatan kunci komposit di builder + pick-slate.
`tests/test-slate-kembar.ts` (Lanjut-4): **96/96 tetap hijau**.

## Fase 3 — Perlindungan 59 pick yang sudah tercatat

### Keputusan perlakuan (semantik kode sendiri)

`duplicate_of` diisi pada **27 pick fd_** yang punya pasangan persis
(market, selection, line, series) di sisi sm_, menunjuk id pick sm_
pasangannya. **Pick Boreham ou35/under (fd id 335455) TIDAK
dimarking**: semantik kolom menuntut pasangan seleksi yang sama;
sisi sm_ untuk ou35 adalah `over` (id 335017) — menunjukkannya ke
pick over akan merusak satu-satunya invarian kolom dan mengotori
audit di masa depan. Pick under itu taruhan berbeda yang sah
(diterbitkan sebelum kickoff dari paket fixture duplikat); ia dinilai
resolver atas kelayakannya sendiri. Paket induknya tidak akan pernah
terbit lagi berkat Fase 2.

### Bukti copy-first

1. Backup produksi: `~/workspace/backups/pre-kembar-fix-20261125/
   picks.db.bak` (VACUUM INTO dari sumber read-only; integrity_check
   `ok`; 173.021 baris; duplicate_of non-null = 0).
2. Marking diterapkan + diverifikasi di SALINAN (mapping dihitung
   terprogram per pasangan; satu-satunya yang tak termarking =
   335455, sesuai keputusan di atas).
3. Verifikasi semantik dengan kode asli atas salinan termarking vs
   salinan kontrol tanpa marking:
   - `publishSlip([335450])` di salinan termarking → **rejected,
     `leg_not_official`**; di kontrol → **published** (leg 335450).
     `publishSlip([335010])` (sisi sm_) di termarking → published.
   - `listUnresolved` memuat **59/59** pick kembar di kedua salinan →
     resolver TETAP menilai semuanya malam ini.
   - Sesudah outcome hipotetis identik dicatat di kedua salinan,
     `cohortStats(live-run)` **identik byte-per-byte** (settled
     166.134, hits 88.527, hit_ratio 0.5328650366571562, cakupan
     sama) → marking TIDAK mengubah statistik utama.
4. Produksi: mapping dihitung ulang di produksi dan sama persis
   dengan salinan sebelum UPDATE dijalankan. Hasil: **27 baris
   ter-update**; total baris tetap 173.021; checksum 59 pick
   (count 59, SUM(id) 19.781.453, SUM(published_prob)
   43.41645482978321) identik sebelum/sesudah; `pick_outcomes` tetap
   166.075; duplicate_of non-null = **27**; integrity_check `ok`;
   pick 335455 tetap NULL. Tidak ada penghapusan, tidak ada perubahan
   outcome/probabilitas.

**Pernyataan persis efek marking:** 27 pick fd_ kini tidak memenuhi
syarat sebagai anggota slip resmi (`publishSlip` menolaknya). Mereka
TETAP dinilai resolver dan TETAP terhitung di statistik
akurasi/cakupan utama — mengeluarkannya dari statistik membutuhkan
keputusan pemilik tersendiri (filter duplikat di cohort atau void),
tidak dilakukan malam ini.

## Fase 4 — Validasi + merge

Di worktree `app-football-kembar`, berurutan (tidak paralel):

- `tsc --noEmit`: bersih.
- `lint:gate`: LOLOS (91 error ≤ baseline 92).
- `test:data`: hijau penuh (18/18, 58/58, 110/110, 69/69, 23/23,
  12/12, 12/12, 35/35, 48/48, 43/43).
- `test:quant`: hijau penuh (22/22, 62/62, 32/32, 23/23, 22/22,
  kandidat Q1, 21/21, 19/19, 11/11).
- `test:lanjut`: hijau penuh (25/25, 28/28, 27/27, 96/96, 127/127).

Merge: fast-forward ke master, push `master:main`, branch remote
dihapus (SHA merge dicatat di pesan serah ke pemilik). **Tidak ada
redeploy/rebuild web**: fungsi yang berubah hanya dipanggil oleh
`scripts/build-fixture-links.ts` dan `scripts/pick-slate.ts`;
aplikasi web tidak mengonsumsi `buildLinkTeamKeyFn`/
`suffixVariantGroups` sama sekali, dan build `.next` yang berjalan
tidak disentuh. Permukaan yang langsung memakai perbaikan sesudah
merge: langkah-langkah free-refresh (builder tautan langkah 3,
pick-slate langkah 7, resolver langkah 8) dan statistik sisi-skrip —
semuanya berjalan dari source checkout utama. Cron `football-free-
refresh` 04:21 WIB menjalankan `scripts/free-refresh.ts` dari
checkout utama, jadi kode hasil merge yang akan berjalan.

### Yang akan dilakukan refresh 04:21 WIB + resolver malam ini

1. Langkah 3 meregenerasi `fixture-links.json` dengan aturan baru:
   343 tautan termasuk 4 pasang ini; builder juga mendaftarkan alias
   `catalog_twin` ke identity store dataset (fixture fd_ sudah
   memegang UID fx_…; grup berkumpul ke UID yang bertahan itu).
2. Langkah 7: Doncaster (masih upcoming) — baris fd_-nya kini dilewati
   sebagai kembar tertaut; tidak ada pick duplikat baru. Tiga laga
   lain sudah kickoff sebelum 04:21 sehingga tidak dinilai ulang.
3. Langkah 8 (resolver): ke-59 pick dinilai dari skor terverifikasi
   (feed fd_ EC/E2 untuk baris fd_; jalur sibling sm_ juga tersedia
   kini). Ke-27 pick termarking dinilai seperti biasa tetapi tidak
   bisa masuk slip resmi; statistik utama menghitung kedua sisi —
   sesuai pernyataan Fase 3.

## Risiko sisa

- Inti nama ambigu (Bradford, Cambridge, Carlisle, Grimsby, Hamilton,
  Northampton, Sutton, Swindon) tetap tidak menyatu otomatis — calon
  kembar masa depan di inti itu masih butuh entri alias manual
  berbasis bukti per laga (pola Beveren/Standard).
- Nama pendek fd_ yang BUKAN awalan token dari nama panjangnya
  (singkatan/alias sejati) tidak tertangkap aturan ini; penjaga
  cadangan tetap menjadi lapis pengaman untuk kelas awalan saja.
- Belahan nama-identik (kelas Everton Inggris/Chile) sengaja tidak
  disentuh aturan ini.
- Statistik utama tetap menghitung 27 duplikat yang sudah dinilai
  (keputusan pemilik bila ingin dikeluarkan — lihat Fase 3).

## Deviasi jujur

1. `data/fixture-links.json` hasil regenerasi tidak di-commit (lihat
   2a) — tautan produksi diperbarui oleh refresh 04:21, bukan oleh
   merge ini.
2. Fase 2(b) brief mengantisipasi perubahan kode penjaga; bukti
   menunjukkan logika penjaga sudah benar dan yang rusak adalah
   kunci bersamanya — perbaikan dilakukan di kunci (dipakai builder
   DAN penjaga), tanpa mengubah `slate-identity.ts`/`publication.ts`.
3. Nomor paket sisi sm_ di brief adalah nomor berkas slate; nomor
   ledger terverifikasi dipakai di laporan ini (lihat Ringkasan).
