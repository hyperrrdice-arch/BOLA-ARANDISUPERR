# Laporan Item 8 — Kurasi Identitas fdorg Batch 1

**Tanggal:** Kamis, 26 November 2026 · **Keputusan pemilik:** 26 Nov 2026 — Item 8 batch 1 DIBUKA, hanya bentuk nama resmi penuh yang TIDAK AMBIGU; kasus ambigu (contoh pemilik: "Everton FC") wajib tetap di antrean.
**Mekanisme apply:** kamus alias proyek `TEAM_NAME_ALIASES` (`lib/quant/team-normalizer.ts`) — jalur resmi yang dipakai `resolveFdorgTeamCid`/`buildFdorgMapping` di `lib/feeds/fdorg-results.ts` sebagai langkah normalisasi pertama. Tidak ada jalur paralel baru.

## Koreksi baseline (jujur, sebelum mulai)

Angka "476 baris terbuka (181 lama + 295 baru)" berasal dari laporan fix aktivasi adapter 25 Nov — **di salinan worktree** larian itu. Keadaan produksi yang terukur di awal paket ini:

- Antrean fdorg terbuka di DB produksi (`thestats_dataset.db`): **181 baris**, semua `fdorg_unmapped_team`, dibuat 2026-11-25T09:04 UTC (larian produksi pagi, sebelum fix fallback terlucuti `fcf4c5a` ter-merge). 0 baris fdorg yang pernah ter-resolve.
- Ke-295 baris "baru" **tidak pernah masuk DB produksi** — salinan worktree dibuang sesudah larian bukti. Bentuk-bentuk namanya (28 nama resmi penuh) terdokumentasi persis di `tasks/reports/fix-aktivasi-adapter-report.md` dan menjadi daftar kurasi Bagian A di bawah; manfaatnya: larian fdorg produksi berikutnya tidak lagi mengantrekan ±295 baris itu.
- Jadi target hitungan yang benar untuk produksi: **181 → N**, bukan 476 → N.

Jangkar awal (sebelum perubahan apa pun):

- `data/picks.db` sha256 `2e8043748aa77b9df458f7087d8dcd0ca020428038921c2a91919b3e15b3e11a`
- `data/model-manifest.json` sha256 `a6cf947a4f9f1ccfb80fcfccc739dca522bfc00dd042f2b6759530dca2b54315` (anchor champion)
- `data/calibrated_ratings.json` sha256 `be93286a1f55836e7645ea03d7f19415e8a193b6d6ab5c9d257229589a636685` (anchor champion)
- `data/thestats_dataset.db` 3.041.361.920 B, mtime 2026-11-25 13:24:45 UTC; `matches` fo_ = 4 baris.

Metode bukti untuk semua pemetaan: mesin adapter ASLI (`buildFdorgMapping` + `resolveFdorgTeamCid`) dijalankan read-only terhadap DB + registry produksi; kandidat tujuan disaring dari tim kanonik yang **benar-benar bermain di divisi fdorg terkait** di dataset (PD→SP1, SA→I1, FL1→F1, DED→N1, PPL→P1) dan berbagi token khas nama; nama kanonik tujuan diverifikasi unik di seluruh registry (tepat 1 canonical_id per nama tujuan).

---

## Bagian SEBELUM — Daftar calon batch 1

### A. Pemetaan BARU — 28 bentuk nama resmi penuh (saat ini TIDAK terpetakan)

| # | Nama fdorg | Komp | Tim kanonik tujuan | Bukti ketidakambiguan |
|---|---|---|---|---|
| 1 | Club Atlético de Madrid | PD | sm:7980 "Atletico de Madrid" | Tepat 1 kandidat token "atletico" di SP1; nama tujuan unik di registry |
| 2 | Real Racing Club de Santander | PD | sm:9818 "Racing de Santander" (Spain) | Tepat 1 kandidat token "santander" di SP1; negara konsisten |
| 3 | Real Sociedad de Fútbol | PD | sm:594 "Real Sociedad" | Tepat 1 kandidat token "sociedad" di SP1 (di luar tim II/III/W yang tidak di SP1) |
| 4 | RCD Espanyol de Barcelona | PD | sm:528 "Espanyol" | Tepat 1 kandidat token "espanyol" di SP1 |
| 5 | Rayo Vallecano de Madrid | PD | sm:377 "Rayo Vallecano" | Tepat 1 kandidat token "vallecano" di SP1 |
| 6 | Real Betis Balompié | PD | sm:265948 "Real Betis" (Spain) | Tepat 1 kandidat token "betis" di SP1; negara konsisten |
| 7 | FC Internazionale Milano | SA | sm:2930 "Inter Milan" | Tepat 1 kandidat token "internazionale/inter" di I1 |
| 8 | Bologna FC 1909 | SA | sm:8513 "Bologna FC" | Tepat 1 kandidat token "bologna" di I1 |
| 9 | US Sassuolo Calcio | SA | sm:2714 "US Sassuolo" | Tepat 1 kandidat token "sassuolo" di I1 |
| 10 | Parma Calcio 1913 | SA | sm:398 "Parma Calcio" | Tepat 1 kandidat token "parma" di I1 |
| 11 | ES Troyes AC | FL1 | sm:7047 "ESTAC Troyes" | Tepat 1 kandidat token "troyes" di F1 |
| 12 | Racing Club de Lens | FL1 | sm:271 "RC Lens" | Tepat 1 kandidat token "lens" di F1 |
| 13 | Lille OSC | FL1 | sm:690 "LOSC Lille" | Tepat 1 kandidat token "lille" di F1 |
| 14 | Stade Rennais FC 1901 | FL1 | sm:598 "Stade Rennais" | Tepat 1 kandidat token "rennais" di F1 |
| 15 | RC Strasbourg Alsace | FL1 | sm:686 "RC Strasbourg" | Tepat 1 kandidat token "strasbourg" di F1 |
| 16 | SC Cambuur-Leeuwarden | DED | sm:1435 "SC Cambuur" (Netherlands) | Tepat 1 kandidat token "cambuur" di N1; negara konsisten |
| 17 | SBV Excelsior | DED | sm:1652 "Excelsior" | Tepat 1 kandidat token "excelsior" di N1 (Excelsior Maassluis/'31 ada di registry tapi bukan tim N1 dataset & nama beda) |
| 18 | NEC | DED | sm:494 "NEC Nijmegen" (Netherlands) | Tidak ada tim kanonik bernama persis "NEC"; satu-satunya klub NEC di registry = NEC Nijmegen (Belanda), bermain di N1; tidak ada baris `teams` bernama "NEC" milik cid lain |
| 19 | Telstar 1963 | DED | sm:1550 "Telstar" (Netherlands) | Tepat 1 kandidat token "telstar" di N1; negara konsisten |
| 20 | Feyenoord Rotterdam | DED | sm:73 "Feyenoord" | Tepat 1 kandidat token "feyenoord" di N1 |
| 21 | FC Twente '65 | DED | sm:593 "FC Twente" | Tepat 1 kandidat token "twente" di N1 (di luar FC Twente W) |
| 22 | Sporting Clube de Braga | PPL | sm:884 "Sporting Braga" (Portugal) | Tepat 1 kandidat token "braga" di P1; negara konsisten; dibedakan tegas dari Sporting CP |
| 23 | CF Estrela da Amadora | PPL | sm:12152 "Estrela Amadora" (Portugal) | Tepat 1 kandidat token "estrela/amadora" di P1; negara konsisten |
| 24 | Sporting Clube de Portugal | PPL | sm:58 "Sp Lisbon" (anggota SM "Sporting CP") | Satu-satunya kanonik Sporting CP/Lisbon di registry; anggota tersimpan "Sporting CP" + "Sporting"; dibedakan tegas dari sm:884 Braga dan sm:6362 Sporting CP II |
| 25 | Sport Lisboa e Benfica | PPL | sm:605 "SL Benfica" (Portugal) | Tepat 1 kandidat token "benfica" di P1 (tim utama); negara konsisten |
| 26 | Académico de Viseu FC | PPL | sm:8297 "Academico Viseu" (Portugal) | Tepat 1 kandidat token "viseu" di P1; negara konsisten |
| 27 | CS Marítimo | PPL | sm:5931 "Maritimo" | Tepat 1 kandidat token "maritimo" di P1 (di luar Maritimo II) |
| 28 | GD Estoril Praia | PPL | sm:1198 "Estoril" (Portugal) | Tepat 1 kandidat token "estoril" di P1; negara konsisten |

### B. Antrean lama — 36 dari 37 nama SUDAH terpetakan, barisnya layak ditutup

Ke-181 baris produksi berasal dari 37 nama PL/ELC. Sesudah fix `fcf4c5a`, 36 nama ter-resolve oleh adapter saat ini ke tepat satu tim kanonik (diverifikasi ulang read-only di awal paket ini, mesin + registry + DB produksi):

Arsenal FC→sm:19 · Aston Villa FC→sm:15 · Birmingham City FC→sm:12 · Blackburn Rovers FC→sm:2 · Bolton Wanderers FC→sm:16 · Brentford FC→sm:236 · Brighton & Hove Albion FC→sm:78 · Burnley FC→sm:27 · Cardiff City FC→sm:69 · Charlton Athletic FC→sm:4 · Chelsea FC→sm:18 · Coventry City FC→sm:117 · Crystal Palace FC→sm:51 · Derby County FC→sm:24 · Fulham FC→sm:11 · Hull City AFC→sm:22 · Ipswich Town FC→sm:116 · Leeds United FC→sm:71 · Lincoln City FC→sm:305 · Liverpool FC→sm:8 · Manchester City FC→sm:9 · Manchester United FC→sm:14 · Newcastle United FC→sm:20 · Norwich City FC→sm:33 · Nottingham Forest FC→sm:63 · Preston North End FC→sm:99 · Queens Park Rangers FC→sm:47 · Southampton FC→sm:65 · Stoke City FC→sm:26 · Sunderland AFC→sm:3 · Swansea City AFC→sm:30 · Tottenham Hotspur FC→sm:6 · West Bromwich Albion FC→sm:10 · West Ham United FC→sm:1 · Wolverhampton Wanderers FC→sm:29 · Wrexham AFC→sm:283.

Baris yang ditutup = baris yang SEMUA sisi tak-terpetakannya termasuk 36 nama ini. Baris yang menyentuh nama tertahan (Bagian C) tetap terbuka utuh.

### C. DITAHAN — ambigu, tetap di antrean

| Nama | Alasan |
|---|---|
| Everton FC | Dua tim kanonik bernama persis "Everton": sm:13 (England) dan sm:15064 (Chile) — persis kasus contoh pemilik. Adapter memang membuang kunci "everton" sebagai ambigu. 11 baris antrean yang menyentuh nama ini tetap terbuka. |

---

## Backup (sebelum apply)

Direktori `~/workspace/backups/pre-item8-batch1-20261126/`:

| File | Isi | sha256 |
|---|---|---|
| `fixture_identity_queue-pre.sql` | Dump penuh tabel `fixture_identity_queue` (satu-satunya tabel yang ditulis paket ini) | `e31fef980c08d7cf9798394e12a39ee00be779b30d645788fd99cf8cf605b375` |
| `queue-open-counts-pre.txt` | Hitungan antrean terbuka per source/reason sebelum apply | `07c56f57f2caa4132fc5491171c0e1f0dc05af574aff64db5ac795bccbcd2998` |
| `team-normalizer.ts.pre` | Salinan `lib/quant/team-normalizer.ts` sebelum perubahan | `bb1c878cba7d48ff7c165ac0af419a805f1fcaa973f84042c3bb31e107f4d3af` |

Rollback: pulihkan dump antrean + kembalikan file normalizer (atau `git revert` commit paket ini).

## Bagian SESUDAH — Hasil apply

### Apply 1 — pemetaan baru (kode)

28 entri alias ditambahkan ke `TEAM_NAME_ALIASES` di `lib/quant/team-normalizer.ts` (diff: **+42 baris, 0 dihapus** — 28 entri + komentar kurasi per liga). Verifikasi ulang memakai mesin adapter asli terhadap DB + registry produksi: **ke-28 nama kini ter-resolve ke tepat satu cid tujuan yang direncanakan** (sama persis dengan kolom tujuan Bagian A — Club Atlético de Madrid→sm:7980, Real Racing Club de Santander→sm:9818, Real Sociedad de Fútbol→sm:594, RCD Espanyol de Barcelona→sm:528, Rayo Vallecano de Madrid→sm:377, Real Betis Balompié→sm:265948, FC Internazionale Milano→sm:2930, Bologna FC 1909→sm:8513, US Sassuolo Calcio→sm:2714, Parma Calcio 1913→sm:398, ES Troyes AC→sm:7047, Racing Club de Lens→sm:271, Lille OSC→sm:690, Stade Rennais FC 1901→sm:598, RC Strasbourg Alsace→sm:686, SC Cambuur-Leeuwarden→sm:1435, SBV Excelsior→sm:1652, NEC→sm:494, Telstar 1963→sm:1550, Feyenoord Rotterdam→sm:73, FC Twente '65→sm:593, Sporting Clube de Braga→sm:884, CF Estrela da Amadora→sm:12152, Sporting Clube de Portugal→sm:58, Sport Lisboa e Benfica→sm:605, Académico de Viseu FC→sm:8297, CS Marítimo→sm:5931, GD Estoril Praia→sm:1198).

Dari seluruh 65 nama yang diperiksa (37 antrean + 28 resmi), tepat **1 nama tetap tak terpetakan sesudah apply: Everton FC** — sesuai batas pemilik.

### Apply 2 — penutupan antrean (data)

Penutupan diputuskan per baris oleh mesin adapter asli (bukan daftar manual): baris ditutup hanya bila semua sisi tak-terpetakannya ter-resolve. Satu transaksi, `resolved_at = 2026-11-25T20:48:32.048Z`:

- Antrean fdorg terbuka: **181 → 11** (170 baris ditutup).
- Sisa 11 baris terbuka = persis baris yang menyentuh **Everton FC** (id antrean 552, 560, 576, 583, 590, 604, 608, 620, 637, 638, 657) — tetap utuh, tidak diubah.
- Antrean total semua sumber: 728 → 558 terbuka.

### Verifikasi

| Pemeriksaan | Hasil |
|---|---|
| Suite fdorg `tests/test-fdorg-results.ts` (sekuensial) | **43/43 lolos** — termasuk assertion khusus "Everton FC ambigu → unmapped" |
| Diff dump antrean sebelum vs sesudah | Tepat 170 baris berubah; satu-satunya perubahan = `resolved_at` NULL → cap waktu batch pada 170 baris itu; 0 baris lain berubah |
| Tabel lain di dataset | `matches` 71.695 → 71.695; fo_ 4 → 4; `teams` 6.547 → 6.547 (tidak berubah) |
| `data/picks.db` | sha256 identik `2e804374…` |
| Manifest champion | sha256 identik `a6cf947a…` |
| Ratings champion | sha256 identik `be93286a…` |
| Registry `team-canonical.json` / `league-canonical.json` | Tidak disentuh paket ini |

Catatan cakupan jujur: penutupan 170 baris adalah tindakan kurasi atas worklist — hasil-hasil laga ELC/PL terkait memang sudah mendarat lewat fetch segar pada larian bukti 25 Nov (di salinan); di produksi, baris hasil fo_ baru akan tertulis pada larian fdorg produksi berikutnya, yang kini juga akan menjangkau PD/SA/FL1/DED/PPL tanpa mengantrekan 28 nama resmi penuh ini.

## Ringkasan

- **Bentuk dikurasi: 28** nama resmi penuh fdorg (PD 6, SA 4, FL1 5, DED 6, PPL 7) — semuanya tak ambigu menurut bukti (tepat 1 kandidat di divisi terkait + nama tujuan unik di registry), kini terpetakan lewat kamus alias resmi proyek.
- **Baris antrean tertutup: 170** dari 181 baris produksi → antrean fdorg **181 → 11**. (Baseline "476" adalah total salinan worktree 25 Nov; 295 baris di dalamnya tidak pernah masuk produksi — lihat Koreksi baseline.)
- **Ditahan: 1 nama / 11 baris** — Everton FC, ambigu persis seperti contoh pemilik (Everton Inggris sm:13 vs Everton Chile sm:15064).
- Tidak ada baris di luar batch yang berubah; ledger, dataset hasil, manifest, dan ratings champion identik byte-per-byte.
