# Laporan Langkah 1 — Reproduksi Brief Redesain Bola

- **Branch:** `redesain/bola` (worktree `~/workspace/coding/app-football-redesain`)
- **SHA dasar:** `ef9b67cd2810fe6ac8eb452c66c05792362cd6dd` (tip `fix/review-k8`, sudah terdeploy)
- **Tanggal ukur:** 21 Nov 2026 (WIB)
- **Kode produk diubah:** TIDAK ADA. Hanya fixture tes, suite reproduksi, dan laporan ini.

## Metode

Audit di brief dilakukan malam 20 Nov terhadap build K8 **sebelum** rangkaian
perbaikan Fix-1…Fix-6. Laporan ini membuktikan keadaan **sekarang** per kasus
lewat dua lapis bukti pada data sandbox terisolasi:

1. **Suite adapter** `tests/test-redesain-repro.ts` (31 assertion, semua lolos) —
   menjalankan modul repo asli (builder tautan, store identitas K1, adapter
   rekam, `combineSlip`) sebagai subproses di sandbox `fixture-env`.
   Jalankan ulang: `npx tsx tests/test-redesain-repro.ts`.
2. **Render build produksi** branch ini (`npm run build`, env placeholder
   seperti CI) di dua panggung `/tmp/bola-stage-*` yang disemai
   `tests/helpers/redesain-stage-seed.ts`, didorong Chromium headless
   (viewport **378×800**) oleh harness `~/workspace/tools/pwshot/redesain1-probe.mjs`.

Data uji adalah data NYATA yang diekstrak **read-only** (`mode=ro`) dari DB
checkout utama ke `tests/fixtures/redesain-repro/` — payload paket verbatim,
baris katalog verbatim, 16 pick Marseille dari ledger hasil migrasi K1/K2,
dan entri registry tim apa adanya. Tidak ada penulisan ke DB checkout,
tidak ada kontak VPS.

| Kasus | Vonis |
|---|---|
| 1 — Alias Marseille | **MASIH SALAH** (ter-reproduksi persis: 2 laga, 73,2%) |
| 2 — Detail parsial Rostov | **SUDAH DIPERBAIKI** (Fix-1) + bukti render; 1 temuan kerapuhan baru |
| 3 — Status tertinggal Barcelona W | **MASIH SALAH** (aturan §4 belum ada) |
| 4 — Arsip 0/74 | **MASIH SALAH secara penyajian** (angka jujur, struktur §3E belum ada) |

---

## Kasus 1 — Alias Marseille: MASIH SALAH

**Input persis.** Dua baris katalog untuk satu laga fisik yang sama —
Ligue 1, Olympique Marseille vs Le Mans, kickoff identik
`2026-11-22T19:45:00.000Z` (23 Nov 02.45 WIB):

- `sm_19715544` — home "Olympique Marseille", `home_team_id=44`, `away_team_id=7758`
- `mt_022917440` — home "Olympique de Marseille", `home_team_id=tm_25550`, `away_team_id=tm_97723`

**Jalur yang dilalui & hasil terukur:**

1. **Registry tim (`data/team-canonical.json`) — akar masalah.** Klub yang
   sama terbelah jadi DUA tim kanonik yang tidak pernah dilebur:
   `sm:44` "Olympique Marseille" (anggota: sportmonks `44` saja) dan
   `tm_25550` "Olympique de Marseille" (anggota: thestats `tm_25550` saja).
   Lawannya justru benar: Le Mans menyatu di `sm:7758` (anggota `7758` +
   `tm_97723`).
2. **Builder tautan (`scripts/build-fixture-links.ts`)** mengelompokkan
   katalog dengan kunci `kickoff|homeCid|awayCid`. Canonical kandang kedua
   baris berbeda → tidak pernah segrup → tidak ada tautan, dan registrasi
   alias K1 (`linkAlias`) ikut tidak terjadi. Di sandbox: builder berjalan
   bersih, grup kembar terdeteksi **0** untuk pasangan ini; file produksi
   `fixture-links.json` (188 tautan) juga tidak memuat kedua id ini.
   Di dataset hasil migrasi K1: tidak ada baris `fixture_aliases` untuk
   kedua id, dan laga ini tidak ada di `canonical_fixtures` sama sekali.
3. **Filter kembar R-03 (`scripts/pick-slate.ts`)** membaca HANYA
   `fixture-links.json` → `mt_022917440` tidak dikenali sebagai kembar →
   lolos sebagai laga unik → dinilai & diterbitkan terpisah. Di ledger:
   **16/16 pick live-run kedua alias `fixture_uid`-nya NULL** (bagian dari
   5.534 pick tak-teresolusi dari 7.805 live-run).
4. **Jalur saji (`lib/web/rekam.ts` → builder).** `daftarPilihanPraLaga`
   memakai kunci laga `fixture_uid ?? match_id` → jatuh ke dua match_id
   berbeda → dedup tidak melebur. Terukur di sandbox: daftar memuat **16
   pilihan (8 per alias)**; "Minimal dua gol" (OU1.5 over) muncul **dua
   kali @ 85,5%** (published_prob 0,8553 di kedua alias; model_prob-nya
   berbeda: sm 0,8855 vs mt 0,9336). `ParlayBuilder` mengelompokkan per
   fixtureUid dan `combineSlip` mengalikan antar kelompok:
   **0,8553² = 0,7315 → 73,2% sebagai "2 laga"** — klaim brief
   ter-reproduksi persis, dan dikonfirmasi di browser pada build produksi:
   header "16 pilihan · 2 laga", dua tombol "Tambah Minimal dua gol"
   (satu per ejaan nama), sesudah keduanya diklik panel berbunyi
   **"2 pilihan dari 2 laga — perkiraan peluang semua pilihan tepat
   73,2%"** (tangkapan `redesain-1-reproduksi/pilihan-gabungan-378.png`).
5. **Konflik BTTS tidak ditangani sama sekali.** BTTS yes terbit 0,6276
   (sm) vs 0,7727 (mt) — dua angka untuk satu laga fisik tampil sebagai
   dua laga berbeda; tidak ada jalur kode yang pernah membandingkan
   keduanya, karena sistem tidak tahu keduanya satu laga.

**Kasus pembanding negatif (tetap terpisah, benar):**

- Olympique **Lyonnais** vs Nice (`mt_155794033`) — nama mirip, laga
  berbeda: tidak tertaut, uid tetap NULL/berbeda. Registry Lyon sendiri
  sehat (`sm:79`, kedua sistem id menyatu).
- Pasangan kontrol sintetis (Le Mans vs Toulouse FC, dua baris katalog,
  tim kanonik menyatu): **tertaut** oleh builder yang sama dan terdaftar
  satu uid di store identitas → mesin tautan sehat; yang rusak spesifik
  data registry.
- Temuan sistemik: pasangan Marseille–Toulouse (`mt_377265875` +
  `sm_19715561`, kickoff sama 2026-11-01T19:45Z) juga **tidak tertaut**
  di file produksi — defek yang sama menimpa semua laga klub ini.

**Akar masalah (untuk langkah 2):** `data/team-canonical.json` membelah
satu klub menjadi dua entri kanonik (`sm:44` vs `tm_25550`) → seluruh
rantai hilir (tautan katalog → alias K1 → filter kembar R-03 → kunci
laga saat saji) mewarisi keterbelahan itu. Perbaikan harus mulai dari
peleburan entri registry + pembangunan ulang tautan/alias + penanganan
16 pick yang sudah terbit dengan uid NULL; bukan dari lapisan tampil.

---

## Kasus 2 — Detail Parsial Rostov: SUDAH DIPERBAIKI (Fix-1)

**Input persis.** `sm_19726740` (Rostov vs Krylya Sovetov, kickoff
2026-11-20T16:30Z), paket terbaru id 7557 di checkout — payload-nya
persis bentuk warisan kosong yang dulu melempar halaman Vissel:
`market = {probs:{}, captured_utc:null, bookmakers:null}`.

**Bukti lulus (dua lapis):**

- **Adapter:** `getMatchDetail('sm_19726740')` pada branch aktif TIDAK
  melempar; `normalizeMarket` (Fix-1, `lib/web/data.ts`) mengubah market
  warisan kosong menjadi `null`; peluang model utuh (1x2 kandang
  0,41122… = payload). Kasus crash asli `sm_19719152` (Vissel) juga
  lulus: tidak melempar, market null.
- **Render build produksi (378 px):** halaman tampil penuh — "Peta
  peluang" 41,1% / 26,7% / 32,2% (sesuai payload), kalimat "Harga pasar
  belum tersedia untuk laga ini.", tanpa error konsol
  (`redesain-1-reproduksi/detail-rostov-378.png`).

**Temuan samping (kerapuhan baru, bukan klaim brief):** render pertama di
panggung sempat jatuh ke segmen error ("Analisis laga ini gagal dimuat")
karena tabel `team_match_logs_canonical` belum ada di dataset sandbox.
Di produksi tabel itu ada (dibangun `scripts/build-canonical-telemetry.ts`
dalam rantai refresh; sesudah skrip asli itu dijalankan di panggung,
halaman render penuh). Yang layak dicatat untuk langkah 2 (§8.2/§3C):
`getForm()` di `lib/web/data.ts` menelan **tanpa isolasi error** — satu
tabel bantu yang hilang meruntuhkan SELURUH halaman detail, padahal
paket analisisnya sehat. Halaman belum memenuhi prinsip "panel yang
hilang tidak meruntuhkan halaman".

Catatan: header Rostov di render yang sama juga menampilkan "Akan
datang" ±3,5 jam sesudah kickoff — manifestasi Kasus 3 (status katalog
masih `scheduled`).

---

## Kasus 3 — Status Tertinggal Barcelona W: MASIH SALAH

**Input persis.** `sm_19879501` (Barcelona W vs Servette Chênois W, UEFA
Women's Champions League), kickoff `2026-11-19T20:00:00.000Z` (20 Nov
03.00 WIB), status sumber katalog `scheduled`, tidak ada paket, tidak
ada baris hasil di dataset.

**Hasil terukur:**

- **Adapter:** `getMatchState` mengembalikan status `scheduled`;
  `displayStatus('scheduled')` → label **"Akan datang"**.
- **Render build produksi:** header halaman berbunyi persis
  **"Jumat, 20 November · 03.00 WIB · Akan datang"** — dilihat ±24 jam
  sesudah kickoff (`redesain-1-reproduksi/detail-barcelona-378.png`).

**Akar masalah:** jalur derivasi status **tidak punya dimensi waktu**.
`displayStatus` (`lib/web/status.ts`) memetakan string status sumber
saja; penggabung keadaan `keadaanDariBaris` (`lib/web/data.ts`) memilih
antara baris dataset dan status katalog tanpa pernah menerima atau
membandingkan jam sekarang. `STATUS_LABEL_ID` hanya memuat 7 label;
string "Menunggu pembaruan pertandingan" **tidak muncul di mana pun**
di `lib/`, `app/`, `components/` — keadaan antara yang diwajibkan
brief §4 (kickoff lewat + sumber belum memperbarui) memang belum
dimodelkan, baik di tipe `FixtureStatus` maupun di labelnya. Perbaikan
langkah 2 harus menambahkan derivasi berbasis waktu di jalur status
(sumber kebenaran tunggal), bukan tambalan teks per halaman.

---

## Kasus 4 — Arsip 0/74: MASIH SALAH secara penyajian (angka jujur)

**Input persis.** `/bukti?dari=2026-11-19&sampai=2026-11-19&tz=Asia/Jakarta`.
Keadaan direplikasi di sandbox: 74 pick live-run terbit dengan kickoff
tersebar di jendela WIB 19 Nov 2026, 0 outcome, dilihat pada
2026-11-21T12:00Z. Replikasi ini setia: hitungan read-only pada ledger
hasil migrasi untuk jendela yang sama menghasilkan **persis 74 terbit /
0 dinilai / 74 belum dinilai**.

**Hasil terukur (adapter + render build produksi):**

- Statistik jujur: `settled=0`, `hit_ratio=null` → halaman TIDAK
  mencetak akurasi 0% palsu. Teks yang tampil: "Belum ada hasil —
  belum ada pilihan yang bisa dinilai pada rentang ini." dan "74
  pilihan sudah jatuh tempo tetapi belum dinilai"; ubin cakupan
  "0 dari 74 (0%)". Ke-74 baris berkeadaan `jatuh-tempo`.
- **Yang belum memenuhi brief §3E:** halaman tidak punya tab sama
  sekali (elemen `role="tab"` terhitung **0**). "Sudah dinilai" hanya
  label ubin statistik, bukan tab yang terbuka secara default; tidak
  ada keadaan menunggu yang eksplisit sebagai bacaan utama dan tidak
  ada aksi "Lihat 74 yang menunggu" (pola teks itu tidak ditemukan di
  render). Elemen dominan tetap satu tabel campuran berisi 74 baris
  "Sudah jatuh tempo" — keadaan 0/74 terbaca sebagai daftar gagal,
  bukan sebagai keadaan menunggu hasil resmi.
- **Tampilan default (tanpa filter) masih dipimpin laga masa depan:**
  baris diurutkan `kickoff_utc DESC` tanpa gerbang waktu dan dipotong
  pada `MAKS_BARIS = 200` di halaman — baris pertama terukur
  berkeadaan `belum-mulai`. Struktur di balik klaim audit "200 baris
  awal Belum mulai" masih utuh.

**Akar masalah:** `app/(terminal)/bukti/page.tsx` merender satu daftar
tak-terdiferensiasi dari `ambilRekam` (`lib/web/rekam.ts`); pemisahan
sudah-dinilai vs menunggu untuk penyajian belum ada. Klasifikasi per
baris sebenarnya sudah tersedia (`keadaanPilihan`: tepat/meleset/
belum-mulai/menunggu-jendela/jatuh-tempo) — yang hilang adalah struktur
tab §3E dan urutan bawaan yang menempatkan yang sudah dinilai lebih
dulu. Bukan masalah kebenaran angka.

Tangkapan: `redesain-1-reproduksi/bukti-19nov-378.png` (potongan atas
dari tangkapan satu halaman penuh; jumlah baris diukur dari DOM).

---

## Regresi cepat (dasar tidak rusak)

Di worktree `redesain/bola`, sesudah semua fixture ditambahkan:

- `npm run test:data` — hijau (semua suite: data, identity,
  publication, tickets, resolver-score).
- `npm run test:web` — hijau **236/236** (web 12, ui 66, rekam 110,
  detail-render 27, fix6 21).
- Suite reproduksi ini: **31/31** (Kasus 1: 15, Kasus 2+3: 7, Kasus 4: 9).

## Berkas yang ditambahkan di langkah ini

- `tests/fixtures/redesain-repro/` — `paket-sm_19715544.json`,
  `paket-mt_022917440.json`, `paket-sm_19726740.json`,
  `paket-sm_19719152.json` (payload verbatim), `katalog-kasus.json`,
  `katalog-pembanding.json`, `picks-marseille.json`, `registry-tim.json`.
- `tests/helpers/redesain-seeds.ts` — seed sandbox dari fixture di atas.
- `tests/helpers/redesain-probe.ts` — probe adapter (subproses).
- `tests/helpers/redesain-stage-seed.ts` — penyemai panggung render.
- `tests/test-redesain-repro.ts` — suite reproduksi (sengaja TIDAK
  dirantai ke `test:web`; ia mengunci perilaku saat ini termasuk yang
  salah — langkah 2 memperbaruinya saat perilaku diperbaiki).
- Laporan ini + 4 tangkapan layar 378 px di
  `tasks/reports/redesain-1-reproduksi/`.
