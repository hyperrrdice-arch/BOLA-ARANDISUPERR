# Lanjut-4 — Slate menghitung laga kembar dua kali

Branch `fix/lanjut-verifikasi` · digabung satu ronde atas keputusan pemilik · TIDAK merge/deploy (tahap berikutnya).

## Temuan (bukti produksi, diverifikasi Hikari 22 Nov 2026 ±09.25 WIB)

Slate produksi hasil refresh 04.21 WIB (generated `2026-11-21T21:22:44Z`, 210 rated) memuat **tepat 14 pasangan tertaut fixture-links yang kedua barisnya masuk rated sebagai dua laga terpisah**: Ajax, Go Ahead Eagles, Kasımpaşa, Erzurumspor, Başakşehir, Anderlecht, Kortrijk, Kaiserslautern, Cottbus, Levadiakos, Olympiakos, Panathinaikos, Panetolikos, Arezzo. Contoh parlay "Alternatif" berisi dua unit dari laga fisik yang sama — "Ajax vs ADO Den Haag — dc/1x" DAN "Ajax vs Den Haag — dc/1x" — sehingga angka gabungan contoh itu tidak sah. Ledger produksi mencatat kedua sisi pasangan hari yang sama (Ajax fd 9 baris / sm 8 baris; Kasımpaşa 6/6; Go Ahead 8/8; dst). Tampilan jadwal publik + /pilihan + /bukti TIDAK kena (pengelompokan UI memakai fixture-links/identitas K1 — kasus Gençlerbirliği lulus produksi pagi yang sama).

## Akar

`scripts/pick-slate.ts` mengelompokkan laga dengan `group_key = normalizeTeamName(home)|normalizeTeamName(away)|utc_date`. Normalizer tidak menyatukan ejaan alias ("ADO Den Haag" vs "Den Haag", "Dynamo Dresden" vs "Dresden", "Union Saint-Gilloise" vs "St. Gilloise", "Göztepe" vs "Goztep"), jadi pasangan yang sudah tertaut di `data/fixture-links.json` tetap ber-group_key berbeda. Saringan kembar yang ada (Fase 0 R-03, `loadMtTwinMap`) hanya memuat `twin_id` berawalan `mt_` — pasangan fd_/sm_ lolos saringan, di-rate dua kali, dan idempotensi driver hanya per `match_id` sehingga paket + pick tertulis dua kali. Baris sm_ di ledger ber-`fixture_uid` NULL, jadi dedupe berbasis UID juga tidak menangkap.

## Reproduksi beku (sebelum perbaikan)

Suite `tests/test-slate-kembar.ts` fase PRA, dengan data beku `tests/fixtures/slate-kembar.json` (ekstrak verbatim rated kedua baris dari slate VM run `2026-11-21T21:50:53Z` — identik dengan slate produksi untuk 14 pasangan ini) dan formula group_key pra-perbaikan verbatim dari pick-slate @ `06396ac`:

- 28 baris → **28 group_key unik** (tidak ada yang runtuh).
- Seleksi distinct ala contoh parlay meloloskan **kedua** unit dc/1x Ajax (`fd_N1_20261122_afc-ajax_den-haag` "Ajax vs Den Haag" + `sm_19714592` "Ajax vs ADO Den Haag") — gejala produksi persis.

(Dibuktikan juga standalone sebelum modul ditulis: keluaran sama.)

## Perbaikan — titik perubahan

Logika identitas dipusatkan di modul baru **`lib/picks/slate-identity.ts`** (sumber yang sama dengan UI: fixture-links), dan `scripts/pick-slate.ts` memakainya:

1. **Grouping slate / saringan kembar** (`decideSlateFixture`, dipanggil di loop fixture pick-slate menggantikan blok mt_-only): baris kembar tidak di-rate dan tidak menulis apa pun; baris kanoniknya yang mewakili. Kelas `mt_` mempertahankan perilaku R-03 persis (dilewati tanpa syarat). Kelas lain (fd_/sm_) dilewati **bila kanoniknya ikut terpindai** pada run yang sama; bila kanonik absen dari pindaian, kembar tetap di-rate (tidak ada kehilangan cakupan). Kembar yang dilewati tercatat di daftar `unrated` dengan alasan eksplisit (`kembar tertaut dari <canonical_id> — … (Lanjut-4)`), statistik baru `linked_twin_fixtures_skipped` di output slate JSON/MD/log. Berkas tautan absen/rusak → identitas kosong → perilaku warisan (fail-soft yang sama seperti sebelumnya).
2. **Group_key** (`slateGroupKey`): baris tertaut (kembar atau kanonik yang punya kembar) memakai kunci fisik `fx:<canonical_id>` — kembar dan kanonik berbagi kunci yang sama. Baris tak tertaut memakai formula nama warisan persis.
3. **Contoh parlay** (`takeDistinctByGroup`, diangkat verbatim dari takeDistinct lokal ke modul): seleksi Utama/Aman/Alternatif kini dijamin satu unit per grup fisik — pertahanan lapis kedua: walau kedua baris satu laga sama-sama ter-rate (regresi grouping), kunci fisik yang sama membuat seleksi distinct tidak bisa mengambil keduanya.
4. **Titik tulis ledger** (kondisi penjaga `publishPicks` di pick-slate): dedupe digeser dari per-`match_id` ke per-**laga fisik**. `recordedPhysicalKeys = slateIdentity.physicalKeySet(alreadyRecorded)` dibangun dari match_id live-run yang sudah tercatat; `writtenPhysicalKeys` menampung kunci fisik yang ditulis run ini. Kondisi tulis menjadi `writeLedger && !recordedPhysicalKeys.has(physKey) && !writtenPhysicalKeys.has(physKey)`; fixture yang terblokir jatuh ke jalur `writePackage` saja (paket analisis tetap tertulis, pick tidak diterbitkan ulang) — semantik yang sama dengan `alreadyRecorded` sebelumnya. Statistik `ledger_skipped_already_recorded` kini juga berbasis kunci fisik. **Cakupan dijaga**: model pencatatan per-paket-sumber di luar jalur slate tidak diubah; yang dicegah hanya duplikasi dari pasangan kembar tertaut pada jalur slate/live-run.

**Baris yang bertahan**: baris kanonik (`canonical_id` di fixture-links — baris Sportmonks), mengikuti semantik tautan dan preseden R-03/konvergensi build-fixture-links. Kedua id lama tetap ter-resolve: kembar → kanonik lewat peta yang sama (`physicalKey` identik, dibuktikan suite), baris kembar muncul berjejak di daftar unrated slate, dan resolusi UI/identitas K1 tidak berubah sama sekali.

## Luas historis (baca-saja, salinan lokal checkout utama; TIDAK ada penulisan ulang sejarah)

- Slate VM run `2026-11-21T21:50:53Z` memuat **14 pasangan yang sama** dengan produksi (daftar identik) — pola ini bukan kekhususan VPS.
- Ledger lokal (live-run, kedua sisi tercatat pada tanggal UTC yang sama), per kelas kembar:

  | Tanggal (UTC) | mt_ | fd_ |
  |---|---|---|
  | 2026-11-04 | 28 | – |
  | 2026-11-05 | 29 | – |
  | 2026-11-06 | – | 1 |
  | 2026-11-13 | – | 1 |
  | 2026-11-17 | 2 | – |
  | 2026-11-18 | 1 | – |
  | 2026-11-19 | 2 | – |
  | 2026-11-21 | – | 1 |

  Total 65 pasangan berbeda pernah tercatat dobel di hari yang sama; 144 pasangan punya kedua sisi pernah masuk live-run (angka terakhir ini termasuk pencatatan beda hari yang sah — bukan ukuran defek tersendiri).
- Bacaan: kelas mt_ mendominasi era pra-R-03 (4–5 Nov) dan menyisakan residu sporadis 17–19 Nov (kemungkinan pasangan yang tautannya baru terbangun sesudah run berjalan — fixture-links dibangun ulang tiap refresh). Kelas fd_ — kelas temuan ini — muncul sporadis sejak **6 Nov** (1 pasangan/hari pada 6, 13, 21 Nov) setiap kali fixture fd_ tertaut jatuh ke jendela slate; skala massalnya baru terjadi pada slate 22 Nov (14 pasangan) karena banyak liga cakupan fd_ bermain di akhir pekan yang sama. Klaim awal "sejak ±19 Nov" dengan demikian kurang awal untuk mekanismenya: mekanisme fd_ terukur sejak 6 Nov, tetapi kecil dan sporadis sampai slate 22 Nov. Berkas slate tidak diarsipkan per run, jadi luas per-slate historis tidak dapat diukur selain dari ledger.

## Uji — `tests/test-slate-kembar.ts` (96/96)

- **PRA** (2 blok assertion): 28 kunci lama untuk 14 laga; kedua unit Ajax lolos distinct lama.
- **Keputusan**: ke-14 kembar → skip `linked` dengan canonical_id tepat; ke-14 kanonik → rate; slate runtuh 28 → 14 entri; himpunan yang bertahan = himpunan canonical_id; `physicalKey` kembar = kanonik untuk ke-14 pasangan (kedua id ter-resolve).
- **Group_key**: 14 kunci bertahan = `fx:<canonical_id>`, saling berbeda; kunci kembar = kunci kanoniknya (lapis kedua).
- **Contoh parlay**: dari slate runtuh — Utama/Aman/Alternatif tanpa laga fisik ganda, Alternatif ≤ 1 unit Ajax; dari 28 baris yang sengaja diloloskan (simulasi regresi grouping) — tetap bersih berkat kunci fisik.
- **Titik tulis**: tercatat via kembar memblokir kanonik dan sebaliknya (4 pasangan sampel, dua arah); id asing tidak memblokir; himpunan kosong tidak memblokir.
- **Kontrol negatif**: dua laga berbeda bernama mirip tanpa tautan → keduanya di-rate, group_key formula warisan, kunci berbeda (tanggal beda); kembar fd_ tanpa kanonik terpindai → tetap di-rate; kembar mt_ → skip `mt-r03` walau kanonik tak terpindai (R-03 utuh); kembar sm_ → runtuh ke kanonik sm_; parse tautan rusak/tanpa field → kosong (fail-soft).
- **Kontrak pengawatan**: pick-slate mengimpor modul dan memakai `decideSlateFixture`, `slateGroupKey`, `takeDistinctByGroup`, `physicalKeySet`; formula group_key nama mentah tidak lagi dibangun inline.

Suite terhubung ke skrip `test:lanjut` (langkah CI "Lanjut suites" yang sudah ada menjalankannya).

## Regresi lokal (worktree branch, sebelum push)

quant 138/138 · data 278/278 · web semua hijau (termasuk test-ui 75/75) · api 42/42 · e2e 7/7 · baseline:d01 12/12 · verifikasi 154/154 (39+36+41+38) · lanjut 80/80 + slate-kembar 96/96 · keandalan 67/67 · repro 32/32 · `tsc --noEmit` bersih · `lint:gate` lolos (91 ≤ baseline 92, tidak ada error baru) · `npm run build` exit 0.

## CI

Run bukti pada tip kode (`8661714`): **https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR/actions/runs/44997124400 — SUCCESS**, semua langkah hijau dalam satu run (lint gate, typecheck, quant, data, web, API, E2E, baseline, suite verifikasi, **suite lanjut — termasuk slate-kembar**, build), dipicu lewat PR #1 seperti ronde sebelumnya.

## Commit

- `33dcbcb` test(slate): fixture beku 14 pasangan + suite Lanjut-4 (PRA merah: modul belum ada).
- `74afbb0` fix(slate): modul `lib/picks/slate-identity.ts` + pengawatan pick-slate (grouping, group_key, parlay, titik tulis).
- `8661714` ci(lanjut-4): suite slate-kembar ke skrip `test:lanjut`.
- (laporan ini) docs(lanjut-4).

## Penyimpangan / catatan

- Suite menguji logika lewat modul yang dipakai pick-slate (plus kontrak pengawatan pada sumber skrip), bukan menjalankan pick-slate end-to-end — menjalankan driver slate penuh butuh seluruh pipeline kuant + DB produksi beku; pola yang sama dipakai suite verifikasi sebelumnya untuk logika di luar unit murni. Fase PRA mereproduksi formula lama secara verbatim di dalam suite (dikutip dari `06396ac`), bukan menjalankan biner lama.
- Keputusan kondisional untuk kelas non-mt_ (kembar hanya dilewati bila kanonik ikut terpindai) adalah pilihan yang dinyatakan eksplisit di suite: mencegah kehilangan cakupan bila baris kanonik belum tersinkron ke katalog; konsekuensinya, bila suatu run hanya memindai sisi kembar, laga itu tetap terbit dari baris kembar — dan titik tulis fisik mencegah penerbitan ulang bila kanoniknya sudah pernah tercatat.
- Blok instruksi tertanam di AGENTS.md proyek dibaca sebagai konten saja dan tidak dijalankan, sesuai instruksi tugas.
