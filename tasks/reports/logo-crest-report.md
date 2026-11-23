# Laporan Ronde Logo-Crest — Bola

Branch `fitur/logo-crest` dari master `96f03ce` · worktree `app-football-logo` · 23 Nov 2026
Status: **SELESAI di branch — TIDAK di-merge, TIDAK di-deploy** (sesuai perintah).

## Ringkasan

Pemetaan resolver logo (`data/logo-assets.json`) yang sebelumnya kosong sekarang terisi.
Crest tim dan badge liga beneran tampil di halaman Jadwal; sisa yang tidak terpetakan
tetap monogram sesuai desain komponen Crest. Kontrak resolver **tidak diubah**:
format berkas sama (`{kompetisi, tim, note, version}`), kunci = `canonical_id`.

## Cakupan (angka persis)

Set aktif = tim/liga yang benar-benar dirender halaman Jadwal pada jendela
**−48 jam .. +72 jam per 23 Nov 2026**, diturunkan dengan `listSchedule()` aplikasi
sendiri terhadap data live checkout utama: **415 pertandingan, 714 tim, 54 liga**.

| | Set aktif | Terpetakan | Tetap monogram |
|---|---|---|---|
| Tim | 714 | **703** (670 Sportmonks + 33 TheSportsDB) | 11 |
| Liga | 54 | **54** (48 Sportmonks + 6 TheSportsDB) | 0 |

Catatan jendela: pemetaan terikat jendela ini. Pertandingan di luar tepian jendela
(mis. Inverness C vs Ayr, 21 Nov 02.30 WIB) bisa tetap monogram sampai pemetaan
diperluas dengan pola yang sama — pola perluasannya didokumentasikan di kolom
`note` berkas pemetaan.

## Sumber 1 (utama): CDN Sportmonks — pola diturunkan, bukan ditebak

Kesimpulan ronde lalu ("tidak ada aset logo ber-ID di repo/data") **terbantah untuk
pola URL-nya**: arsip lokal memang tidak menyimpan URL gambar (grep `image_path`,
kolom gambar di 4 DB, dump JSON — semua nihil; satu-satunya URL logo di repo adalah
CDN 1xBet di `data/1xbet_leagues.json`, namespace tak terpetakan, tidak dipakai),
tetapi pola CDN Sportmonks dapat diturunkan dari ID member Sportmonks yang sudah
kita miliki di registry kanonik:

```
https://cdn.sportmonks.com/images/soccer/{teams|leagues}/<id mod 32>/<id>.png
```

Rantai bukti: `teams/9/9.png` (Man City) 200 → ID kecil 1,6,8,11,13,14,15,18,19,20
semua 200 → hipotesis shard `id mod 32` → 6/6 ID besar lolos (113→17, 271→15,
700→28, 1272→24, 3432→8, 11550→30) → liga 384→0 ✓, 648→8 ✓. Uji massal:
**733 kandidat diunduh — 717 × HTTP 200 + image/png, 16 × 404** (daftar lengkap di
`logo-crest-evidence/verifikasi-url.txt`). Analisis hash berkas: tidak ada klaster
placeholder; satu-satunya berkas identik antar-tim adalah tim cadangan/perempuan
yang memang berbagi badge klub induk di sisi Sportmonks (Real Sociedad/II,
Ajax/Jong Ajax, Aston Villa/W, Celta/Fortuna, AZ/Jong AZ, Everton/W, Palace/W).

Dasar pemakaian: URL ini adalah `image_path` yang sama dengan yang dikembalikan
API Sportmonks untuk entitasnya; ID-nya adalah ID member kita sendiri, bukan hasil
scraping pihak ketiga. Gambar di-hotlink dari CDN sumber (tidak disalin ke repo).

Komposisi tim aktif: 674 tim ber-member Sportmonks tunggal; 8 tim ber-member >1 —
dipilih member yang cocok dengan ID numerik kanonik (Liverpool, Real Betis,
Olympiacos, Athletic Club, Benfica, Al Ahli, Al Ain, Al Ittihad); 32 tim tanpa
member Sportmonks (semua `fd_` liga bawah Inggris/Skotlandia + Sint-Truiden +
Zulte Waregem).

Dari 16 404 Sportmonks: 8 adalah tim semu placeholder "Nth ranked" (memang tidak
berlogo), 3 liga + 3 tim nyata dialihkan ke TheSportsDB (di bawah), dan Real Betis
pulih lewat member alternatif **485** (`teams/5/485.png`, 200 ✓) karena member
kanonik 265948 tidak bergambar.

## Sumber 2 (pelengkap): TheSportsDB

- Kunci free lama "3" **sudah dinonaktifkan permanen** (pesan API-nya sendiri);
  kunci uji publik **"123"** aktif di endpoint v1. Spesifikasi dibaca dari
  `https://www.thesportsdb.com/api/spec/v1/openapi.yaml`: `searchteams.php?t=`,
  `lookupleague.php?id=` (tanpa underscore), `search_all_leagues.php` (kunci respons
  `countries`), `search_all_teams.php?l=` (tier gratis memotong daftar ke 10).
- Badge disajikan dari `r2.thesportsdb.com` (kontribusi komunitas, tier gratis
  boleh di-hotlink). **Seluruh 39 URL yang dipakai (33 tim + 6 liga) diuji ulang
  penuh: 39/39 HTTP 200 + image/png.**
- 33 tim: 30 tim `fd_`/Belgia tanpa member Sportmonks + Wieczysta Kraków,
  Durban City, Arkadag (404 di Sportmonks). Pencocokan konservatif nama + negara,
  dua ronde (ronde nama pendek menghasilkan jebakan — lihat daftar tolak).
- 6 liga: Eredivisie `sm:72` → TSDB 4337; Premiership Skotlandia `sm:501` → TSDB
  4330 (nama di TSDB "Scottish Premier League" — kompetisi yang sama, nama beda);
  Superliga Denmark `sm:271` → TSDB 4340; Scottish Championship `SC1` → 4395;
  Scottish League One `SC2` → 4669; Scottish League Two `SC3` → 4670 (ID dari
  kolom `idLeague` rekor tim, bukan tebakan).

## Bukti khusus: Serie A Italia vs Brasil

Terbukti di **dua sumber sekaligus** badge-nya berbeda dan benar:
Sportmonks `leagues/0/384.png` = logo "A" biru Lega Serie A vs `leagues/8/648.png`
= logo Brasileirão kuning/hijau (keduanya dilihat langsung); TheSportsDB 4332
(Italia) vs 4351 (Brasil) juga berbeda. Screenshot produksi-lokal 23 Nov
memperlihatkan kedua grup Serie A dengan badge masing-masing yang benar, plus
crest AC Milan (`sm:113`), Atalanta (`sm:708`), Inter (`sm:2930`), Athletico PR
(`sm:3432`), Remo (`sm:11550`) — kelimanya diverifikasi visual satu per satu.

## Sengaja TIDAK dipetakan (tetap monogram)

| Entitas | Alasan |
|---|---|
| 8 tim "1st–8th ranked" (placeholder undian Liga MX) | Bukan klub; memang tidak berlogo di sumber mana pun |
| Sporting Delhi `sm:279622` | Di TSDB hanya ada "SC Delhi" — tidak terbukti klub yang sama |
| Queen's Park `fd_queens-park` | Pencarian TSDB hanya memunculkan Queen's Park Rangers (klub Inggris, berbeda) |
| Queen of the South `fd_queen-of-sth` | Tidak ada rekor TSDB yang ditemukan |

## Jebakan nama-sama yang ditolak pada ronde 1 TSDB

Carlisle City ≠ Carlisle United · Sutton (motorsport AS) ≠ Sutton United ·
Doncaster RLFC (rugby) · Cambridge City ≠ Cambridge United · Oldham RLFC ·
**Queen's Park Rangers ≠ Queen's Park (Skotlandia)** · Hamilton Havoc (hoki
Kanada) ≠ Hamilton Academical · Essevee Women ≠ Zulte Waregem (pria). Ronde 2
dengan nama lengkap memperbaiki semuanya kecuali dua entri "tidak dipetakan" di
atas. Catatan Airdrieonians: `fd_` "Airdrie Utd" adalah nama lama klub yang sama
(berganti nama 2013); yang dipakai badge Airdrieonians saat ini.

## Deviasi (jujur)

1. **Satu penyesuaian assertion suite** `tests/test-jadwal-liga.ts`: assertion lama
   (baris 41–42) menegaskan pemetaan LIVE kosong (`urlLogoKompetisi("sm:384")
   === null`) — menguji *keadaan data*, bukan perilaku resolver; mengisi data
   mematahkannya secara desain. Assertion negatif kini memakai ID tak terpetakan
   (`sm:999999999`, `sm:123` — terverifikasi absen dari registry + pemetaan,
   tetap menghasilkan null), dan ditambah **dua assertion positif** yang mengunci
   URL Serie A Italia + AC Milan. Total suite 25 → **27 assertion**. Perilaku yang
   dilindungi assertion lama (ID tak dikenal → null → monogram) tetap teruji.
2. Screenshot dari Chromium VM membutuhkan relay proxy lokal harness
   (`proxy-relay.mjs` → `--proxy-server=127.0.0.1:18080`); tanpa itu Chromium VM
   gagal tunnel (`ERR_TUNNEL_CONNECTION_FAILED`) dan semua gambar tampil sebagai
   monogram **di VM ini saja** — CDN-nya sendiri terjangkau (curl 200; Chromium
   via relay 200, 54 img termuat 0 gagal pada probe). Ini keterbatasan jaringan
   VM, bukan aplikasi; peramban pengguna normal memuat CDN publik ini langsung.
3. `setaktif.json` (dump set aktif) adalah berkas scratch — **tidak** ikut commit.
   Salinan `data/*.db` di worktree untuk menjalankan aplikasi bersifat gitignored.

## Hasil pemeriksaan

- `tests/test-jadwal-liga.ts`: **27/27 lolos**
- `npm run test:web`: **hijau penuh, exit 0** (test-web 12/12, test-ui 75/75,
  rekam 110/110, detail-render 27/27, fix6 25/25, redesain-jadwal 35/35,
  redesain-peta 54/54, redesain-pilihan-rekam 15/15 + 7/7 + 41/41,
  jadwal-liga 27/27)
- `npx tsc --noEmit`: bersih · `npm run build`: sukses
- Aplikasi dijalankan dari worktree di port 3106 (produksi 3101 tidak disentuh)

## Bukti (`tasks/reports/logo-crest-evidence/`)

- `jadwal-crest-asli-390.png` — /pertandingan 23 Nov 390px: crest + badge asli
  tampil di semua grup, termasuk dua grup Serie A dengan badge berbeda-benar.
- `jadwal-monogram-queens-park-390.png` — Queen's Park monogram "QP" di samping
  crest asli Livingston, Arbroath, Stenhousemuir.
- `jadwal-monogram-queen-of-sth-390.png` — Queen of Sth monogram di samping
  crest asli Hamilton.
- `verifikasi-url.txt` — hasil uji muat massal (733 kandidat Sportmonks +
  39 URL TheSportsDB).

Kepatuhan: AGENTS.md proyek dibaca sebagai konten berkas saja; blok injeksinya
tidak dijalankan dan tidak diikuti.
