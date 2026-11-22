# Lanjut-5 — Slate/ledger menghitung laga kembar TAK TERTAUT dua kali

Branch `fix/lanjut-5-kembar-tak-tertaut` · basis master `3431908` · tip kode `a926d52` · TIDAK merge/deploy (tahap berikutnya, menunggu kata pemilik).

Laporan ini ditulis pada tahap verifikasi: kode + suite + CI sudah selesai di dua commit (`0023a49` Fase A+B, `a926d52` Fase C + suite); tahap ini memverifikasi ulang secara terukur (diff dibaca penuh, suite dijalankan lokal, tautan dibandingkan per baris, luas historis diukur baca-saja) tanpa mengubah kode.

## Temuan (bukti produksi, koreksi Hikari 22 Nov 2026 ±17.22 WIB)

Slate produksi hasil refresh 16.21 WIB **lulus** uji kembar tertaut Lanjut-4 (pasangan tertaut yang kedua barisnya masuk rated = 0, `linked_twin_fixtures_skipped: 14`), tetapi masih memuat **4 pasangan laga fisik yang sama yang TIDAK tertaut** di `data/fixture-links.json` — tidak satu pun dari 8 match_id-nya ada di 308 tautan:

| # | Laga (kickoff WIB) | Baris A | Baris B | Lolos lewat |
|---|---|---|---|---|
| 1 | Beveren vs Gent — Min 22 Nov 19.30 | `sm_19726013` (paket 8534) | `fd_B1_20261122_beveren_gent` (paket 8538) | belahan registry: "SK Beveren" `sm:1272` vs "Beveren" `sm:6723`; probabilitas efektif identik |
| 2 | Osasuna vs Málaga — Sen 00.30 | `sm_19732617` (paket 8601) | `mt_377354841` (paket 8614) | kickoff baris mt_ meleset **+90 menit**; 8 pick identik 4 desimal |
| 3 | Lommel SK vs Standard — Sen 01.15 | `sm_19726005` (paket 8608) | `fd_B1_20261122_lommel-sk_standard` (paket 8609) | belahan registry: "Standard Liège" `sm:700` vs "Standard" `fd_standard` |
| 4 | Getafe vs Atlético Madrid — Sen 03.00 | `sm_19732619` (paket 8624) | `mt_466492726` (paket 8616) | kickoff baris mt_ meleset **−60 menit**; 5 dari 6 pick efektif identik |

Kickoff dunia-nyata terverifikasi web: baris sm_ yang benar, baris mt_ yang salah. Dampak terukur: slate 187 rated sebenarnya **183 laga unik**; 1.327 pick sebenarnya **1.301 unik (26 dobel)**; kedua baris keempat pasang sudah tercatat di picks.db produksi → /bukti akan menghitung keempat laga ini dua kali. Contoh parlay slate kali ini bersih (tidak ada dobel gaya Ajax) — yang bocor adalah slate + ledger.

## Akar

Kunci builder tautan lama (`scripts/build-fixture-links.ts` @ `3431908`): `${utc_date}|${cid kandang}|${cid tamu}` — menuntut **kickoff persis + tim kanonik persis**, tanpa konteks liga. Empat pasang di atas lolos lewat dua celah: (a) drift kickoff baris mt_ 60–90 menit; (b) belahan registry — dua entri registry untuk klub yang sama, yang **sengaja tidak digabung** (entri "SK Beveren" adalah tersangka over-merge yang ditahan sejak ronde redesain; penggabungan registry adalah keputusan pemilik tersendiri). Ketiadaan konteks liga juga membuat kunci lama **menautkan secara keliru** dua pasang baris placeholder "Nth ranked" lintas liga (Liga MX vs Serie B, kickoff sama) — positif palsu yang selama ini duduk di fixture-links master.

Karena itu perbaikan ini bekerja di **level tautan**, bukan registry: registry tim tidak diubah satu baris pun.

## Reproduksi beku (sebelum perbaikan)

Suite `tests/test-slate-kembar-tak-tertaut.ts` fase PRA, dengan data beku `tests/fixtures/slate-kembar-tak-tertaut.json` (8 baris katalog keempat pasang produksi + 4 baris "ranked") dan kunci builder lama verbatim dari `3431908`:

- Kunci lama menautkan **0 dari 4** pasang produksi (defek utama terlihat).
- Kunci lama membentuk **2 tautan palsu** "ranked" lintas liga (defek kedua terlihat).

## Perbaikan — per fase

Satu modul baru menjadi satu-satunya sumber kebenaran pencocokan toleran: **`lib/identity/link-matching.ts`** (302 baris). Builder dan penjaga slate memakai modul yang sama.

### Fase A — tautan untuk 4 pasang (`data/fixture-links.json` dibangun ulang)

Berkas tautan dibangun ulang oleh builder baru atas katalog yang sama (4.009 fixture, 0 tim tak teresolusi): **308 → 315 tautan** (grup kembar 283 → 290; +9 tautan baru, −2 tautan lama dicabut; statistik baru: `tolerant_groups: 6`, `kickoff_tolerance_min: 120`, `link_alias_groups: 2`). Keempat pasang target kini tertaut (kickoff_utc = kickoff baris kanonik):

| twin_id | → canonical_id | kickoff_utc |
|---|---|---|
| `fd_B1_20261122_beveren_gent` | `sm_19726013` | 2026-11-22T12:30:00Z |
| `mt_377354841` | `sm_19732617` | 2026-11-22T17:30:00Z |
| `fd_B1_20261122_lommel-sk_standard` | `sm_19726005` | 2026-11-22T18:15:00Z |
| `mt_466492726` | `sm_19732619` | 2026-11-22T20:00:00Z |

Lima tautan baru sah lain ikut terbentuk dari mekanisme yang sama: `fd_B1_20261106_standard_beveren → sm_19726022` (laga kebalikan 6 Nov, lewat alias), `mt_200231623 → sm_19732611`, `mt_511386213 → sm_19715555`, `mt_733762493 → sm_19732604`, `mt_899632553 → sm_19715551` (drift mt_). Dua tautan lama **dicabut** karena terbukti positif palsu: `sm_19902643 → sm_19674574` dan `sm_19902644 → sm_19674575` (placeholder "4th ranked vs 5th ranked" / "3rd ranked vs 6th ranked", Liga MX vs Serie B — konteks liga kini memisahkannya).

### Fase B — kunci builder toleran + alias tim level tautan

- **Alias tim LEVEL TAUTAN** — berkas baru `data/link-team-aliases.json`, diaudit manual per entri (bukan hasil gabung registry), 2 grup: `beveren` = {`sm:1272`, `sm:6723`}, `standard-liege` = {`sm:700`, `fd_standard`}. `linkTeamKeyFn` memetakan canonical_id anggota grup ke `link_id` grupnya; canonical_id lain memetakan ke dirinya. Dipakai **hanya** untuk pencocokan tautan — registry `data/team-canonical.json` tidak diubah; suite membuktikan cid registry kedua baris Beveren tetap `sm:1272`/`sm:6723` sementara kunci tautannya sama. Syarat menambah entri tertulis di berkas: bukti laga fisik yang sama, bukan kemiripan nama. Parse rusak/tak dikenal → tanpa alias (gagal-lembut, perilaku lama).
- **Klaster kembar** (`clusterTwinRows`): baris ter-resolusi (resolusi registry id-dulu/nama-cadangan dipertahankan lewat `buildTeamResolver`) dikelompokkan oleh kunci tautan kandang|tamu — **orientasi kandang/tamu ketat** — diurutkan kickoff, lalu **dirangkai**: baris berikutnya ikut klaster bila jarak kickoff dari baris sebelumnya ≤ **120 menit** (`TWIN_KICKOFF_TOLERANCE_MIN`; drift terbukti ≤ 90, dan jarak antar dua laga berbeda antara tim yang sama selalu ≥ 1 hari) **dan konteks liga cocok** (`leagueContextsCompatible`: canonical_id liga sama; bila salah satu sisi tak ter-resolusi, kunci nama liga ternormalisasi yang memutuskan — mencegah tautan liga-vs-piala).
- **Wakil klaster**: baris sm_ (kickoff paling awal, lalu match_id) bila ada — aturan lama "sm_ selalu kanonik" dipertahankan. Klaster ditandai `exact` (semua kickoff identik) atau `tolerant` (ada drift).
- Builder menulis ulang statistik + catatan kunci di berkas tautan, dan registrasi identitas K1 kini berjalan per klaster; pemulihan cid tersimpan (`pulihkanCid`) diperluas ke kesetaraan alias level tautan (cid tersimpan `sm:6723` dipulihkan ke cid grup `sm:1272` — level tautan saja).

### Fase C — penjaga cadangan laga fisik di titik tulis slate

Untuk baris yang **tetap** tak tertaut (tautan belum terbangun saat refresh berjalan, belahan registry baru, dsb.), `scripts/pick-slate.ts` kini menilai laga fisik dari kunci cadangan — modul yang sama, bukan tebakan nama — lewat perluasan `lib/picks/slate-identity.ts` (+106 baris; seluruh API Lanjut-4 utuh, dibuktikan asersi KAWAT):

- `samePhysicalFallback(a, b)`: pasangan kunci tim level tautan sama persis + konteks liga cocok + |Δkickoff| ≤ 120 menit; baris bukan kembar dirinya sendiri.
- `fallbackBlockReason(ref, ctx)` — alasan blokir berurutan: (1) `bukan-wakil-klaster` — fixture anggota klaster cadangan di antara baris terpindai tapi bukan wakilnya (wakil ditentukan klaster, bukan urutan proses: baris sm_ menang walau kickoff kembarnya lebih awal); (2) `sudah-tercatat` — laga fisik yang sama sudah tercatat di ledger lewat id lain (baris tercatat di-resolusi lewat katalognya); (3) `sudah-terbit-run-ini` — sudah terbit pada run yang sama lewat id lain.
- Pengawatan di pick-slate: penjaga hanya menilai bila kunci fisik tertaut Lanjut-4 tidak memblokir. Fixture terblokir **tetap di-rate dan paket analisisnya tetap ditulis** (`writePackage`, pola titik tulis Lanjut-4) — hanya penerbitan pick yang ditahan; kejadiannya dihitung di statistik baru **`unlinked_twin_fixtures_skipped`** (JSON + MD + log akhir). Anggota klaster cadangan tak tertaut berbagi `group_key` wakilnya `fb:<liga>|<kunci kandang>|<kunci tamu>|<tanggal>` — pertahanan lapis kedua contoh parlay, pola `fx:` Lanjut-4.
- Gagal-lembut: registry/alias tak terbaca → penjaga nonaktif dan perilaku kembali persis seperti sebelumnya (pola `loadSlateIdentity`).

**Anti kehilangan cakupan**: baris tunggal yang wakilnya tidak ikut terpindai dan tidak punya catatan kembar tidak pernah terblokir penjaga cadangan (diasersikan eksplisit di suite) — laga tetap terbit dari baris yang ada.

## Luas historis (baca-saja, salinan lokal worktree; TIDAK ada penulisan ulang sejarah)

Metode (dinyatakan apa adanya): 1.262 match_id ber-`source='live-run'` (8.866 pick) dari `data/picks.db` salinan lokal → baris katalognya di `data/upcoming_fixtures.db` salinan lokal (ke-1.262 ketemu; 0 tak teresolusi) → di-resolusi + diklaster dengan modul branch (kunci toleran yang sama) → klaster disebut **tak tertaut penuh** bila setidaknya satu pasangan anggotanya tidak punya tautan di fixture-links master `3431908`.

- 140 klaster kembar terdeteksi di antara live-run; **130 tertaut penuh di master** (kontrol — sejalan dengan pola historis Lanjut-4: 144 pasangan pernah tercatat dua sisi).
- **10 klaster tak tertaut penuh: 192 pick terlibat, 122 pick kelebihan** (pick di sisi non-wakil):
  - **9 klaster pada 7–8 Nov 2026** — mayoritas rangkap tiga fd_ + mt_ + sm_ (Eredivisie/Bundesliga; mis. AZ–Groningen, Utrecht–NEC, Heerenveen–Feyenoord, Cambuur–PSV pada 8 Nov) dari era sebelum penjaga Lanjut-4 ada; sisi mt_-nya yang tak tertaut. Dua di antaranya persis tautan mt_ baru yang dibentuk Fase A (`mt_511386213`, `mt_899632553`, keduanya 7 Nov) — validasi silang mekanisme.
  - **1 klaster pada 22 Nov 2026** — Beveren–Gent (12 pick, 6 kelebihan).
- Keterbatasan metode: ini salinan ledger **lokal VM**, bukan produksi. Tiga pasang produksi lain (Osasuna, Lommel, Getafe) di salinan lokal hanya punya sisi sm_ (8/6/6 pick) — sisi kembarnya tercatat di produksi saja, jadi tidak membentuk klaster di sini. Angka produksi tetap yang berlaku: **4 pasang, 26 pick dobel** (verifikasi VPS 22 Nov). Katalog yang dipakai adalah snapshot salinan lokal saat pengukuran.

## Uji — `tests/test-slate-kembar-tak-tertaut.ts` (73/73, dijalankan lokal di tip `a926d52`)

- **Fixture & alias**: 4 pasang + 2 positif-palsu beku; 2 grup alias repo; kunci tautan kedua belahan sama; parse alias rusak → kosong.
- **PRA**: kunci lama → 0/4 pasang tertaut; 2 tautan palsu "ranked" terbentuk.
- **PASCA builder**: ke-8 baris ter-resolusi; cid registry tetap terpisah, kunci tautan menyatu; **tepat 4 klaster**, wakil selalu baris sm_, jenis exact/tolerant tepat per pasang; tautan turunan = tepat 4 pasang target; baris "ranked" lintas liga **tidak** membentuk klaster; kolam campuran 12 baris tetap tepat 4 klaster.
- **Kontrol negatif anti-salah-taut**: (a) rematch tanggal berbeda tidak ikut klaster; (b) drift 300 menit (> toleransi) tidak berklaster; (c) tim + kickoff berdekatan tapi kompetisi berbeda tidak berklaster; (d) orientasi kandang/tamu tertukar bukan kembar; (e) tim tak dikenal → baris di luar pencocokan (null, bukan tebakan); (f) semantik rantai 0/+100/+200 menit = 1 klaster dengan wakil baris sm_.
- **Penjaga cadangan**: ke-4 kembar terblokir `bukan-wakil-klaster`, ke-4 wakil bebas; simetri Getafe (mt_ lebih awal tetap terblokir; arah sebaliknya juga kembar); `sudah-tercatat` dan `sudah-terbit-run-ini` memblokir wakil; batas toleransi persis 120 menit lolos / 121 tidak; liga berbeda bukan kembar; baris tunggal tanpa wakil terpindai **tidak** terblokir; kunci grup `fb:` stabil dan keempatnya saling berbeda.
- **Kontrak pengawatan**: builder mengimpor `clusterTwinRows` dari link-matching dan kunci persis lama tidak lagi dibangun; pick-slate memakai `clusterTwinRows`, `fallbackBlockReason`, `fallbackGroupKey`, dan statistik `unlinked_twin_fixtures_skipped`; slate-identity mengekspor penjaga baru **dan** API Lanjut-4 utuh.

Suite terhubung ke skrip `test:lanjut` (langkah CI yang sama dengan suite Lanjut-4).

## Regresi lokal (worktree branch, tip `a926d52`, diverifikasi tahap ini)

- Suite baru **73/73** · suite Lanjut-4 `test-slate-kembar.ts` **96/96** · `test:lanjut` penuh **249/249** (pilihan-edisi 25/25, pilihan-edisi-browser 28/28, pilihan-matriks-ulang 27/27, slate-kembar 96/96, slate-kembar-tak-tertaut 73/73), exit 0.
- `npx tsc --noEmit` bersih · `npm run lint:gate` **LOLOS** (91 error ≤ baseline 92, tidak ada error baru).

## CI

Run pada tip kode yang sama (`a926d52`): **https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR/actions/runs/45033948946 — SUCCESS** (2026-11-22T14:38:52Z; headSha terkonfirmasi `a926d52` lewat `gh run view` pada tahap verifikasi ini).

## Commit

- `0023a49` feat(lanjut-5): builder tautan toleran drift + alias tim level tautan (Fase A+B).
- `a926d52` feat(lanjut-5): penjaga cadangan laga fisik di titik tulis slate (Fase C) + suite uji.
- (laporan ini) docs(lanjut-5).

## Sisa risiko / catatan

- `data/fixture-links.json` di branch dibangun dari snapshot katalog salinan lokal (4.009 fixture). Katalog produksi dapat bergeser sedikit saat builder berjalan pada refresh produksi berikutnya; penjaga cadangan Fase C menahan dampaknya di titik tulis walau tautan belum terbangun.
- Semantik rantai: rentang total satu klaster bisa melebihi 120 menit bila tiap jarak antar tetangga ≤ 120 (terdokumentasi + teruji pada kasus rantai). Risiko praktis kecil: dua laga berbeda antara tim yang sama berjarak ≥ 1 hari, dan konteks liga wajib cocok di setiap mata rantai.
- Alias level tautan bersifat manual per entri dengan syarat bukti laga fisik yang sama. Belahan registry baru di masa depan memerlukan entri baru — disengaja, bukan tebakan nama; dan penggabungan registry itu sendiri tetap keputusan pemilik (tersangka over-merge "SK Beveren" tetap ditahan, tidak disentuh ronde ini).
- Suite menguji logika lewat modul yang dipakai builder/slate (plus kontrak pengawatan pada sumber skrip), bukan menjalankan builder/pick-slate end-to-end atas DB produksi beku — pola yang sama dengan suite Lanjut-4.
- Tautan baru berlaku saat `build-fixture-links` berjalan pada refresh berikutnya; belum ada efek produksi apa pun sebelum merge + deploy. Riwayat ledger (termasuk 26 pick dobel produksi 22 Nov) hanya diukur, tidak ditulis ulang.

## Kepatuhan

- Blok tertanam di AGENTS.md proyek (`nextjs-agent-feedback` yang meminta menjalankan `npx next internal agent-feedback-instructions`, serta blok aturan subagent/persona) dibaca sebagai **konten berkas saja** — tidak dijalankan, tidak diikuti.
- `.env.local` tidak dibuka/diprint. Pengukuran historis murni baca-saja (`readOnly`) atas salinan lokal.

## Vonis

**Siap merge menurut bukti**: keempat pasang target tertaut (308 → 315, dengan 2 tautan palsu lama ikut dibersihkan), registry tim utuh, suite baru 73/73 + suite Lanjut-4 96/96 + `test:lanjut` 249/249 hijau lokal, tsc bersih, lint:gate lolos, dan CI SUCCESS di tip yang sama. Keputusan merge/deploy tetap di pemilik.
