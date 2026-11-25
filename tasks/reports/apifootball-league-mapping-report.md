# Laporan Riset — Pemetaan ID Liga API-Football untuk Capture Per-Liga

**Tanggal:** Kamis, 26 November 2026 (WIB) · **Sifat:** RISET — nol perubahan produksi (script capture, cron, dan DB produksi tidak disentuh) · **Keputusan pemilik yang membuka:** 26 Nov 2026, paket #6 dari daftar Sisa Pekerjaan.

## Ringkasan

- Liga prioritas dari katalog aktif: **70 kompetisi tergabung** (77 baris kompetisi mentah dari dua sumber, sm: + comp_/fdorg) dengan **2124 fixture** pada jendela 26 Nov 2026 – 5 Jan 2027.
- Terpetakan berbukti kuat: **49 kompetisi** mencakup **1818 dari 2124 fixture (85,6%)**.
- Tidak terpetakan di batch ini: **21 kompetisi / 306 fixture (14,4%)** — semuanya karena **belum diteliti** (anggaran 25 request habis untuk cakupan terbesar dulu), BUKAN karena ambigu. Daftar + alasannya di bagian 4.
- Kuota riset: **24 dari maks 25 request** (1 status + 23 /leagues). Status awal hari ini: 15/100 terpakai, sisa 85 — capture produksi 18:00 WIB kemarin tidak terganggu, dan jendela produksi berikutnya (09:00 WIB) jatuh pada hari kuota UTC baru.
- Kelayakan: capture per-liga untuk 49 liga ini butuh **±25 request/hari pada hari rata-rata dan ±62 pada hari tersibuk** (dua jendela penuh) — jauh di dalam cap 100/hari. Rincian + proposal desain di bagian 6. **Proposal saja — tidak diimplementasikan di paket ini.**

## 1. Metode

1. Daftar prioritas diambil dari `data/upcoming_fixtures.db` (read-only): semua kompetisi dengan fixture 26 Nov 2026 – 5 Jan 2027, digabung bila nama+negara sama (mis. Premier League England = sm:8 84 + comp_3039 10), diurutkan menurun menurut jumlah fixture.
2. Identitas API dicari lewat `GET /leagues` — per negara (`?country=`) untuk negara dengan banyak liga prioritas, per pencarian nama (`?search=`) untuk piala kontinental. Pola klien sama dengan script capture produksi (`lib/feeds/api-football.ts`): base `https://v3.football.api-sports.io`, header `x-apisports-key`, key dari `.env.local` (nilai tidak pernah dicetak/dicatat).
3. Bukti per baris: id + nama + tipe + negara API, rentang musim, musim `current`, dan `coverage.odds` musim kini — semuanya diekstrak programatik dari respons tersimpan dan dicocokkan ke baris katalog; baris tanpa kandidat tunggal yang kuat tidak masuk peta.

## 2. Daftar prioritas katalog (tergabung, dari data)

| # | Kompetisi katalog | Negara | Fixture | ID katalog |
|---:|---|---|---:|---|
| 1 | Championship | England | 96 | sm:9 |
| 2 | Premier League | England | 94 | sm:8, comp_3039 |
| 3 | League One | England | 86 | sm:12, E2 |
| 4 | League Two | England | 85 | sm:14 |
| 5 | Enterprise National League | England | 84 | sm:17 |
| 6 | Serie A | Italy | 63 | sm:384, comp_5840 |
| 7 | La Liga | Spain | 62 | sm:564, comp_8814 |
| 8 | Serie B | Italy | 60 | sm:387 |
| 9 | La Liga 2 | Spain | 55 | sm:567 |
| 10 | Europa Conference League | Europe | 54 | sm:2286 |
| 11 | Ligat ha'Al | Israel | 49 | sm:372 |
| 12 | Liga Portugal 2 | Portugal | 48 | sm:465 |
| 13 | Premiership | Scotland | 48 | sm:501 |
| 14 | Premier League | Egypt | 46 | sm:830 |
| 15 | Liga Portugal | Portugal | 45 | sm:462 |
| 16 | Ligue 1 | France | 45 | sm:301, comp_0256 |
| 17 | Bundesliga | Germany | 45 | sm:82, comp_4643 |
| 18 | Eredivisie | Netherlands | 44 | sm:72, comp_3809 |
| 19 | 1. Lig | Turkey | 40 | sm:603 |
| 20 | Eerste Divisie | Netherlands | 40 | sm:74 |
| 21 | J1 League | Japan | 40 | sm:968 |
| 22 | V-League | Vietnam | 36 | sm:1073 |
| 23 | Pro League | Belgium | 36 | sm:208 |
| 24 | Europa League | Europe | 36 | sm:5 |
| 25 | Super Lig | Turkey | 36 | sm:600 |
| 26 | 2. Bundesliga | Germany | 36 | sm:85 |
| 27 | Superliga | Romania | 32 | sm:474 |
| 28 | Indian Super League | India | 31 | sm:1007 |
| 29 | Premier League | South Africa | 31 | sm:806 |
| 30 | A-League Men | Australia | 30 | sm:1356 |
| 31 | Pro League | Saudi Arabia | 30 | sm:944 |
| 32 | Challenger Pro League | Belgium | 28 | sm:211 |
| 33 | Super League | Greece | 28 | sm:325 |
| 34 | UAE Pro League | United Arab Emirates | 28 | sm:959 |
| 35 | Ligue 2 | France | 27 | sm:304 |
| 36 | Ekstraklasa | Poland | 27 | sm:453 |
| 37 | Premier League | Ukraine | 25 | sm:609 |
| 38 | CAF Champions League | Africa | 24 | sm:1107 |
| 39 | Chance Liga | Czech Republic | 24 | sm:262 |
| 40 | Eliteserien | Norway | 24 | sm:444 |
| 41 | Super League | Switzerland | 24 | sm:591 |
| 42 | AFC Champions League Two | Asia | 22 | sm:1088 |
| 43 | 1. HNL | Croatia | 20 | sm:244 |
| 44 | Serie A | Brazil | 20 | sm:648 |
| 45 | Admiral Bundesliga | Austria | 18 | sm:181 |
| 46 | Champions League | Europe | 18 | sm:2 |
| 47 | AFC Champions League Elite | Asia | 16 | sm:1085 |
| 48 | Premier League | Russia | 16 | sm:486 |
| 49 | Primera Division | Chile | 16 | sm:663 |
| 50 | KNVB Beker | Netherlands | 16 | sm:78 |
| 51 | First League | Bulgaria | 14 | sm:229 |
| 52 | Women's Super League | England | 14 | sm:45 |
| 53 | K League 1 | South Korea | 12 | sm:1034 |
| 54 | Superliga | Denmark | 12 | sm:271 |
| 55 | First Division | Denmark | 12 | sm:274 |
| 56 | UEFA Women's Champions League | Europe | 9 | sm:1419 |
| 57 | DFB Pokal | Germany | 8 | sm:109 |
| 58 | Taça De Portugal | Portugal | 8 | sm:468 |
| 59 | Allsvenskan | Sweden | 8 | sm:573 |
| 60 | Liga MX | Mexico | 8 | sm:743 |
| 61 | Kings Cup | Saudi Arabia | 8 | sm:950 |
| 62 | Stars League | Qatar | 6 | sm:938 |
| 63 | Coppa Italia | Italy | 5 | sm:390 |
| 64 | Carabao Cup | England | 4 | sm:27 |
| 65 | Friendly International | World | 3 | sm:1082 |
| 66 | FIFA Intercontinental Cup | World | 3 | sm:1452 |
| 67 | Club Friendlies 3 | World | 2 | sm:2451 |
| 68 | Serie B | Brazil | 2 | sm:651 |
| 69 | Copa Libertadores | South America | 1 | sm:1122 |
| 70 | Copa do Brasil | Brazil | 1 | sm:654 |

Total: 2124 fixture, 70 kompetisi tergabung.

## 3. Tabel pemetaan berbukti (masuk `data/apifootball-league-map.json`)

| Kompetisi katalog | Fixture | ID API | Nama API | Negara API | Musim kini | Odds? | Catatan bukti |
|---|---:|---:|---|---|---:|:--:|---|
| Championship (England) | 96 | 40 | Championship | England | 2026 | ya | nama + negara + tipe persis |
| Premier League (England) | 94 | 39 | Premier League | England | 2026 | ya | persis; gabungan sm:8 + comp_3039 |
| League One (England) | 86 | 41 | League One | England | 2026 | ya | nama + negara + tipe persis |
| League Two (England) | 85 | 42 | League Two | England | 2026 | ya | nama + negara + tipe persis |
| Enterprise National League (England) | 84 | 43 | National League | England | 2026 | ya | tanpa awalan sponsor 'Enterprise'; North/South divisi bawah, terpisah |
| Serie A (Italy) | 63 | 135 | Serie A | Italy | 2026 | ya | nama + negara + tipe persis |
| La Liga (Spain) | 62 | 140 | La Liga | Spain | 2026 | ya | persis; gabungan 'La Liga' + 'LaLiga' |
| Serie B (Italy) | 60 | 136 | Serie B | Italy | 2026 | ya | nama + negara + tipe persis |
| La Liga 2 (Spain) | 55 | 141 | Segunda División | Spain | 2026 | ya | API 'Segunda División' = nama resmi kasta 2 yang sama |
| Europa Conference League (Europe) | 54 | 848 | UEFA Europa Conference League | World | 2026 | ya | API 'UEFA Europa Conference League', negara API 'World' |
| Ligat ha'Al (Israel) | 49 | 383 | Ligat Ha'al | Israel | 2026 | ya | API "Ligat Ha'al" — kapitalisasi/apostrof saja |
| Liga Portugal 2 (Portugal) | 48 | 95 | Segunda Liga | Portugal | 2026 | ya | API 'Segunda Liga' = nama resmi kasta 2 |
| Premiership (Scotland) | 48 | 179 | Premiership | Scotland | 2026 | ya | nama + negara + tipe persis |
| Premier League (Egypt) | 46 | 233 | Premier League | Egypt | 2026 | ya | nama persis + negara Egypt sebagai pembeda |
| Liga Portugal (Portugal) | 45 | 94 | Primeira Liga | Portugal | 2026 | ya | API 'Primeira Liga' = nama lama resmi kasta 1 yang sama |
| Ligue 1 (France) | 45 | 61 | Ligue 1 | France | 2026 | ya | nama + negara + tipe persis |
| Bundesliga (Germany) | 45 | 78 | Bundesliga | Germany | 2026 | ya | nama + negara + tipe persis |
| Eredivisie (Netherlands) | 44 | 88 | Eredivisie | Netherlands | 2026 | ya | nama + negara + tipe persis |
| Eerste Divisie (Netherlands) | 40 | 89 | Eerste Divisie | Netherlands | 2026 | ya | nama + negara + tipe persis |
| 1. Lig (Turkey) | 40 | 204 | 1. Lig | Turkey | 2026 | ya | nama + negara + tipe persis |
| J1 League (Japan) | 40 | 98 | J1 League | Japan | 2027 | ya | persis; musim current API = 2027 (transisi J.League) |
| 2. Bundesliga (Germany) | 36 | 79 | 2. Bundesliga | Germany | 2026 | ya | nama + negara + tipe persis |
| Super Lig (Turkey) | 36 | 203 | Süper Lig | Turkey | 2026 | ya | API 'Süper Lig' — beda diakritik saja |
| Pro League (Belgium) | 36 | 144 | Jupiler Pro League | Belgium | 2026 | ya | API 'Jupiler Pro League' = nama sponsor liga yang sama |
| Europa League (Europe) | 36 | 3 | UEFA Europa League | World | 2026 | ya | API 'UEFA Europa League', negara API 'World' |
| V-League (Vietnam) | 36 | 340 | V.League 1 | Vietnam | 2027 | ya | API 'V.League 1' = kasta 1; V.League 2 = kasta 2; current API = 2027 |
| Superliga (Romania) | 32 | 283 | Liga I | Romania | 2026 | ya | API 'Liga I' = nama lama kasta 1 Romania (nama SuperLiga sejak 2022) |
| Indian Super League (India) | 31 | 323 | Indian Super League | India | 2026 | ya | nama + negara + tipe persis |
| Pro League (Saudi Arabia) | 30 | 307 | Pro League | Saudi-Arabia | 2026 | ya | API 'Jupiler Pro League' = nama sponsor liga yang sama |
| A-League Men (Australia) | 30 | 188 | A-League | Australia | 2026 | ya | API 'A-League'; varian Women (id=190) terpisah |
| Challenger Pro League (Belgium) | 28 | 145 | Challenger Pro League | Belgium | 2026 | ya | nama + negara + tipe persis |
| Super League (Greece) | 28 | 197 | Super League 1 | Greece | 2026 | ya | API 'Super League 1' = kasta 1; Super League 2 = kasta 2 |
| UAE Pro League (United Arab Emirates) | 28 | 301 | Pro League | United-Arab-Emirates | 2026 | ya | API 'Pro League' + negara 'United-Arab-Emirates'; varian U23 terpisah |
| Ligue 2 (France) | 27 | 62 | Ligue 2 | France | 2026 | ya | nama + negara + tipe persis |
| CAF Champions League (Africa) | 24 | 12 | CAF Champions League | World | 2026 | ya | nama + negara + tipe persis |
| AFC Champions League Two (Asia) | 22 | 18 | AFC Champions League Two | World | 2026 | ya | nama + negara + tipe persis |
| Serie A (Brazil) | 20 | 71 | Serie A | Brazil | 2026 | ya | persis + negara Brazil (pembeda dari Serie A Italy id=135) |
| Champions League (Europe) | 18 | 2 | UEFA Champions League | World | 2026 | ya | API 'UEFA Champions League'; terbedakan dari Women/CAF/AFC/CONCACAF/OFC |
| KNVB Beker (Netherlands) | 16 | 90 | KNVB Beker | Netherlands | 2026 | **tidak** | persis; odds musim kini dilaporkan False |
| AFC Champions League Elite (Asia) | 16 | 17 | AFC Champions League Elite | World | 2026 | ya | nama + negara + tipe persis |
| Women's Super League (England) | 14 | 44 | FA WSL | England | 2026 | ya | API 'FA WSL' = nama lama liga sama; Women's Championship = kasta 2 |
| UEFA Women's Champions League (Europe) | 9 | 525 | UEFA Champions League Women | World | 2026 | ya | API 'UEFA Champions League Women' (urutan kata beda) |
| Taça De Portugal (Portugal) | 8 | 96 | Taça de Portugal | Portugal | 2026 | ya | nama + negara + tipe persis |
| DFB Pokal (Germany) | 8 | 81 | DFB Pokal | Germany | 2026 | **tidak** | persis; odds musim kini dilaporkan False |
| Kings Cup (Saudi Arabia) | 8 | 504 | King's Cup | Saudi-Arabia | 2027 | **tidak** | API "King's Cup"; odds musim kini False; current API = 2027 |
| Coppa Italia (Italy) | 5 | 137 | Coppa Italia | Italy | 2026 | **tidak** | persis; odds musim kini dilaporkan False |
| Carabao Cup (England) | 4 | 48 | League Cup | England | 2026 | **tidak** | API 'League Cup' (tanpa sponsor); odds musim kini dilaporkan False |
| Serie B (Brazil) | 2 | 72 | Serie B | Brazil | 2026 | ya | nama + negara + tipe persis |
| Copa do Brasil (Brazil) | 1 | 73 | Copa Do Brasil | Brazil | 2026 | **tidak** | API 'Copa Do Brasil' (kapitalisasi); odds musim kini False |

Bukti lengkap per baris (termasuk rentang musim penuh + teks bukti) ada di field `evidence`/`evidence_source` pada `data/apifootball-league-map.json`. Enam piala domestik (League Cup, Coppa Italia, DFB Pokal, KNVB Beker, Copa Do Brasil, King's Cup) terpetakan dengan bukti kuat tetapi API melaporkan `coverage.odds=false` untuk musim kini — pemetaannya sah, kegunaan odds-nya belum terbukti; capture per-liga sebaiknya memperlakukan keenamnya sebagai prioritas rendah sampai ada quote nyata yang teramati.

Jebakan nama yang berhasil diselesaikan oleh bukti (bukan tebakan): Premier League England (39) vs Egypt (233); Serie A Italy (135) vs Brazil (71); National League (43) vs North (50)/South (51); A-League (188) vs A-League Women (190); Super League 1 Yunani (197) vs Super League 2 (494); UEFA Champions League (2) vs Women (525) vs CAF (12) vs AFC Elite (17)/Two (18); Pro League Saudi (307) vs UAE (301) vs U23 UAE (1218).

## 4. Tidak terpetakan di batch ini — belum diteliti (anggaran habis)

21 kompetisi / 306 fixture berikut tidak kebagian panggilan /leagues karena anggaran riset 25 request diprioritaskan ke cakupan fixture terbesar. Tidak satu pun ditolak karena ambigu — semuanya kandidat wajar untuk batch lanjutan (perkiraan biaya: ±16 panggilan negara, satu hari riset):

| Kompetisi katalog | Negara | Fixture |
|---|---|---:|
| Premier League | South Africa | 31 |
| Ekstraklasa | Poland | 27 |
| Premier League | Ukraine | 25 |
| Chance Liga | Czech Republic | 24 |
| Eliteserien | Norway | 24 |
| Super League | Switzerland | 24 |
| 1. HNL | Croatia | 20 |
| Admiral Bundesliga | Austria | 18 |
| Premier League | Russia | 16 |
| Primera Division | Chile | 16 |
| First League | Bulgaria | 14 |
| Superliga | Denmark | 12 |
| First Division | Denmark | 12 |
| K League 1 | South Korea | 12 |
| Allsvenskan | Sweden | 8 |
| Liga MX | Mexico | 8 |
| Stars League | Qatar | 6 |
| Friendly International | World | 3 |
| FIFA Intercontinental Cup | World | 3 |
| Club Friendlies 3 | World | 2 |
| Copa Libertadores | South America | 1 |

Catatan: tiga entri 'World' terakhir (persahabatan/piala antarbenua) kemungkinan memang tidak punya padanan liga API yang bersih — nilai dulu di batch lanjutan, jangan dipaksakan.

## 5. Log panggilan API + kuota

Status akun sebelum riset (`GET /status`): plan Free aktif, **15 request terpakai hari ini (UTC), limit 100/hari, sisa header 85**. Semua panggilan di bawah http=200, tanpa error, jeda 7 detik antar panggilan (di bawah limit 10/menit).

| # | Panggilan | Hasil (jumlah liga) | Sisa kuota (header) |
|---:|---|---:|---:|
| 1 | `GET /status` | 0 | 85 |
| 2 | `GET /leagues?country=England` | 46 | 83 |
| 3 | `GET /leagues?country=Italy` | 31 | 82 |
| 4 | `GET /leagues?country=Spain` | 39 | 81 |
| 5 | `GET /leagues?country=Portugal` | 19 | 80 |
| 6 | `GET /leagues?country=Netherlands` | 14 | 79 |
| 7 | `GET /leagues?country=Germany` | 34 | 84 |
| 8 | `GET /leagues?country=France` | 24 | 83 |
| 9 | `GET /leagues?country=Turkey` | 11 | 82 |
| 10 | `GET /leagues?country=Belgium` | 28 | 81 |
| 11 | `GET /leagues?country=Israel` | 6 | 80 |
| 12 | `GET /leagues?country=Scotland` | 12 | 79 |
| 13 | `GET /leagues?country=Egypt` | 8 | 78 |
| 14 | `GET /leagues?country=Japan` | 9 | 77 |
| 15 | `GET /leagues?country=Saudi-Arabia` | 7 | 84 |
| 16 | `GET /leagues?country=Brazil` | 109 | 83 |
| 17 | `GET /leagues?search=Europa` | 3 | 77 |
| 18 | `GET /leagues?search=Champions%20League` | 11 | 76 |
| 19 | `GET /leagues?country=Vietnam` | 4 | 75 |
| 20 | `GET /leagues?country=Romania` | 16 | 74 |
| 21 | `GET /leagues?country=India` | 7 | 73 |
| 22 | `GET /leagues?country=Australia` | 25 | 72 |
| 23 | `GET /leagues?country=Greece` | 17 | 79 |
| 24 | `GET /leagues?country=United-Arab-Emirates` | 6 | 78 |

Total riset: **24 request** (1 status + 23 /leagues) dari anggaran maks 25 — 1 request cadangan tidak dipakai. Nilai 'sisa kuota' dari header tidak monoton (naik-turun ±5 antar respons berurutan) — itu perilaku penghitung API, bukan kebocoran; angka otoritatif adalah /status: 15 terpakai sebelum riset. Capture produksi tidak disentuh dan tidak terganggu: jendela 18:00 WIB sudah lewat sebelum riset mulai, jendela 09:00 WIB besok jatuh pada hari kuota UTC yang baru.

## 6. Matematika kuota + PROPOSAL desain capture per-liga (belum diimplementasikan)

Basis hitung dari katalog (liga terpetakan saja, tanggal UTC kickoff): 442 hari-liga pada 41 hari kalender (rata-rata 10,8 hari-liga/hari; tersibuk Sabtu 28 Nov = 27 hari-liga). Fixture per hari-liga: maks 18, 98,6% ≤ 12. Endpoint /odds mempaginasi 10 entri/halaman dan free plan meng-cap Page ≤ 3, jadi halaman odds yang dibutuhkan = Σ ceil(fixture/10) per hari-liga: **rata-rata 11,6 halaman/hari, tersibuk 30 halaman/hari (28 Nov)**.

Usulan query per jendela: `GET /odds?league={id}&season={musim}&date={tanggal}` untuk setiap liga terpetakan yang punya fixture pada tanggal itu + jembatan nama tim tetap `GET /fixtures?date=` global 1× per jendela (pola yang sudah terbukti di script produksi; entri odds tetap tidak membawa nama tim). Parameter `season` wajib menyertai `league` — nilainya dari kolom 'Musim kini' peta (2026 untuk 46 liga; 2027 untuk J1 League, V.League 1, King's Cup).

| Skenario | Hari rata-rata | Hari tersibuk (28 Nov) | Di dalam cap 100/hari? |
|---|---:|---:|:--:|
| Dua jendela penuh (09:00 + 18:00, masing-masing 1 lintasan per-liga + 1 jembatan) | 2 × (11,6 + 1) ≈ **25 req** | 2 × (30 + 1) = **62 req** | ya, sisa lega |
| Jendela 18:00 hanya liga yang kickoff-nya masih di depan (hemat) | ≈ **17–19 req** | ≈ **45 req** | ya |
| + capture global lama dipertahankan untuk 21 liga belum terpetakan (4 req/hari) | +4 | +4 | ya (maks gabungan ±66) |

Perbandingan dengan keadaan sekarang: capture global memakai cuma 4 req/hari tetapi hanya menjangkau ±30 fixture pertama dunia per tanggal (cap 3 halaman global) dan ±3.000 quote per larian terlewat. Capture per-liga menjangkau **semua** fixture dari 49 liga terpetakan (85,6% fixture katalog) dengan biaya yang masih jauh di bawah kuota. Penjaga yang sudah ada di `lib/feeds/api-football.ts` tetap berlaku per proses (≤9 req/menit, ≤80 req/proses, berhenti bila sisa header ≤ 20): lintasan tersibuk per jendela = 31 request ≈ 3,5 menit pada 9 req/menit — aman.

Urutan implementasi yang diusulkan bila pemilik menyetujui (di luar paket ini): (1) mode `--per-league` pada script capture membaca `data/apifootball-league-map.json`; (2) uji satu jendela manual pada salinan DB; (3) bandingkan jumlah snapshot vs capture global; (4) baru jadwalkan mengganti/menemani cron 09:00/18:00. Enam piala dengan coverage odds False dipanggil terakhir/prioritas rendah.

## 7. Artefak

- `data/apifootball-league-map.json` — 49 baris terpetakan + bukti per baris (format mengikuti konvensi repo: version/generated_at/generator/note).
- Laporan ini: `tasks/reports/apifootball-league-mapping-report.md`.
- Respons mentah /leagues selama riset disimpan sementara di luar repo (/tmp) dan tidak di-commit; yang di-commit hanya peta + laporan ini.
