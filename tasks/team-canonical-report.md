# Registry Kanonik Tim — Laporan Build

Dibangun: 2026-11-05T10:20:15.731Z

## Angka

- Baris tim sumber (tabel teams): **6764**
- Tim kanonik hasil: **6557**
- Grup tergabung (>1 baris sumber): **204** (menyerap 215 baris ekstra)
- Grup lintas sistem (>1 sumber): **189**
- Tim bernama sengketa (≥2 negara): **2** entri
- Pasangan kandidat mirip BELUM digabung: **8**
- Keputusan resolusi fase 3 diterapkan: **25 penggabungan terbukti**, **8 pasangan terbukti klub BERBEDA** (dicatat distinct_from, tidak akan digabung), **34 alias eksternal**.
- Permukaan standings: **164 id** tanpa baris teams didaftarkan dari nama fixture; **3 id** terdaftar id-only (name_unknown: 828, 5632, 976). Cakupan standings sekarang penuh.
- Permukaan fixture: **111 id** tim katalog tanpa baris teams didaftarkan dari bukti fixture (nama + id-nya sendiri).

## Keputusan resolusi fase 3 (bukti terukur + web untuk identitas ambigu)

- GABUNG `fd_andorra` + `238115` — Satu klub: FC Andorra (Spanyol); baris fd cangkang nama pendek CSV.
- GABUNG `fd_bayer-leverkusen` + `tm_20832` — Satu klub: Bayer 04 Leverkusen; fd nama pendek CSV, tm pembawa data (145 match).
- GABUNG `fd_cambuur` + `tm_10474` — Satu klub: SC Cambuur (Belanda); fd nama pendek CSV.
- GABUNG `fd_groningen` + `tm_26302` — Satu klub: FC Groningen (Belanda); fd nama pendek CSV.
- GABUNG `fd_heerenveen` + `tm_04732` — Satu klub: SC Heerenveen (Belanda); fd nama pendek CSV.
- GABUNG `fd_sv-darmstadt-98` + `482` — Satu klub: Darmstadt 98 (Jerman); fd nama pendek CSV.
- GABUNG `fd_telstar` + `tm_91047` — Satu klub: SC Telstar (Belanda); fd nama pendek CSV.
- GABUNG `fd_tsg-1899-hoffenheim` + `tm_73909` — Satu klub: TSG Hoffenheim (Jerman); fd nama pendek CSV.
- GABUNG `254165` + `605` — PECAHAN ENTITAS SM, bukan klub lain: id 254165 (nama tersimpan 'CF Benfica') membawa match Eropa SL Benfica (UCL 26, UEL 9) + sebagian domestik; id 605 membawa domestik (Liga Portugal 68). Digabung ke 605, nama pakem 'SL Benfica'. BUKAN Clube Futebol Benfica.
- GABUNG `tm_master_sl_benfica` + `605` — Nama persis 'SL Benfica'; sisa master 2 match, digabung ke pembawa utama 605.
- GABUNG `17837` + `9908` — Satu klub: Al-Ahli Saudi. Kedua id main di kompetisi yang sama (Saudi Pro sm:944 + ACL Elite sm:1085); 17837 cuma pecahan berlabel negara 'Asia'.
- GABUNG `230422` + `7780` — Cangkang 1 match tanpa telemetri, nama 'Al-Ain' = Al Ain (UEA, id 7780 pembawa 77 match). Label negara 'Saudi Arabia' di cangkang itu keliru konteks.
- GABUNG `10655` + `tm_02219` — Thun = FC Thun (Swiss); imbuhan FC saja.
- GABUNG `132649` + `tm_7937035` — Ararat-Armenia = FC Ararat-Armenia (Armenia); imbuhan FC saja.
- GABUNG `1433` + `tm_10419` — Almere City = Almere City FC (Belanda); imbuhan FC saja.
- GABUNG `1668` + `tm_6686` — Bodø/Glimt — beda ejaan garis miring saja (SM 'Bodø / Glimt').
- GABUNG `2727` + `tm_89295` — Sparta Praha = AC Sparta Praha (Ceko); imbuhan AC saja.
- GABUNG `353` + `tm_64315` — St. Pauli = FC St. Pauli (Jerman); imbuhan FC saja.
- GABUNG `3546` + `tm_8366658` — Riga = Riga FC (Latvia); imbuhan FC saja.
- GABUNG `496` + `tm_master_st_mirren` — St. Mirren = St Mirren (Skotlandia); beda titik saja.
- GABUNG `52` + `tm_1772` — AFC Bournemouth = Bournemouth; bentuk pendek TheStats.
- GABUNG `591` + `tm_01119` — Paris Saint-Germain — beda tanda hubung saja.
- GABUNG `734` + `tm_master_st_johnstone` — St. Johnstone = St Johnstone (Skotlandia); beda titik saja.
- GABUNG `83` + `tm_37445` — FC Barcelona = Barcelona; imbuhan FC saja.
- GABUNG `3608` + `8364` — Racing Club: baris sintetis standings (Copa Sudamericana sm:1116) = id 8364 'Racing' yang membawa 237 match di sm:636/sm:770/sm:1116 — Racing Club de Avellaneda.
- GABUNG `4508` + `tm_11910` — 'Paris' (id 4508) di fixture + standings Ligue 1 = Paris FC — PSG entitasnya terpisah di SM (id 591) dan ikut Ligue 1 yang sama, jadi 'Paris' bukan PSG.
- GABUNG `fd_goztep` + `3897` — Nama CSV football-data 'Goztep' adalah Göztepe yang terpotek diakritiknya (Turki, id SM 3897 'Göztepe') — ketahuan dari baris form 31 Okt: lawan Fenerbahçe tercatat dua kali karena dua id ini tidak tergabung.
- BEDA `10002` + `2837` — River Plate Argentina vs River Plate Uruguay — dua klub berbeda (negara + volume data masing-masing besar).
- BEDA `132434` + `94617` — Ourense CF vs UD Ourense — dua klub berbeda dari kota yang sama (UD bubar 2014, Ourense CF klub terpisah).
- BEDA `2079` + `28207` — San Fernando CD (Cádiz, Andalusia) vs UD San Fernando (Maspalomas, Canarias) — klub berbeda.
- BEDA `26423` + `28245` — Coria CF = Coria del Río, Andalusia (berdiri 1923) vs CD Coria = Coria, Cáceres, Extremadura (berdiri 1960) — terverifikasi web (Wikipedia kedua klub).
- BEDA `277303` + `278222` — Celoricense (entitas Campeonato de Portugal) vs SC Celoricense = Sporting Clube Celoricense, Celorico da Beira (berdiri 1948, liga distrik Guarda) — terverifikasi web (soccerzz/playmakerstats).
- BEDA `10016` + `238136` — Melilla vs Melilla CD — bukti belum cukup dan keduanya cangkang nyaris kosong (3+1 match, 0 log); dibiarkan terpisah sampai ada bukti.
- BEDA `4701` + `82` — 'VfL Bremen' (id 4701, 1 match) BUKAN Werder Bremen (id 82, pembawa 106 match) — kandidat ini artefak kunci longgar, bukan kemiripan klub.
- BEDA `18544` + `84` — Qatar (tim NASIONAL, id 18544) vs Qatar SC (klub) — entitas berbeda kategori.

## Contoh grup lintas sistem

- `sm:1` West Ham United (?): thestats:tm_3809="West Ham United" · sportmonks:1="West Ham United"
- `sm:10068` Lincoln Red Imps (?): thestats:tm_0181115="Lincoln Red Imps" · sportmonks:10068="Lincoln Red Imps"
- `sm:1016` PEC Zwolle (?): thestats:tm_26389="PEC Zwolle" · sportmonks:1016="PEC Zwolle"
- `sm:102` Genoa CFC (?): thestats:tm_51322="Genoa" · sportmonks:102="Genoa"
- `sm:1028` Stade de Reims (France): thestats:tm_master_stade_de_reims="Stade de Reims" · sportmonks:1028="Reims"
- `sm:1053` SC Heerenveen (Netherlands): football-data:fd_heerenveen="Heerenveen" · thestats:tm_04732="SC Heerenveen" · sportmonks:1053="SC Heerenveen"
- `sm:1055` Le Havre AC (?): thestats:tm_97714="Le Havre" · sportmonks:1055="Le Havre"
- `sm:106` Getafe CF (?): thestats:tm_73740="Getafe" · sportmonks:106="Getafe"
- `sm:10655` Thun (?): sportmonks:10655="Thun" · thestats:tm_02219="FC Thun"
- `sm:1072` Pisa SC (?): thestats:tm_37240="Pisa" · sportmonks:1072="Pisa"
- `sm:10722` US Cremonese (?): thestats:tm_20131="Cremonese" · sportmonks:10722="Cremonese"
- `sm:1073` De Graafschap (?): thestats:tm_79130="De Graafschap" · sportmonks:1073="De Graafschap"
- `sm:1079` 1. FC Union Berlin (Germany): thestats:tm_37885="1. FC Union Berlin" · sportmonks:1079="FC Union Berlin"
- `sm:108` AS Saint-Etienne (?): thestats:tm_83365="Saint-Étienne" · sportmonks:108="Saint-Étienne"
- `sm:1083` Red Star FC (?): thestats:tm_007490="Red Star FC" · sportmonks:1083="Red Star"

## Kandidat mirip (keputusan fase resolusi)

- kunci "river plate": `sm:10002` River Plate  vs  `sm:2837` River Plate
- kunci "melilla": `sm:10016` Melilla  vs  `sm:238136` Melilla CD
- kunci "ourense": `sm:132434` Ourense CF  vs  `sm:94617` UD Ourense
- kunci "qatar": `sm:18544` Qatar  vs  `sm:84` Qatar SC
- kunci "san fernando": `sm:2079` San Fernando CD  vs  `sm:28207` UD San Fernando
- kunci "coria": `sm:26423` Coria CF  vs  `sm:28245` CD Coria
- kunci "celoricense": `sm:277303` Celoricense  vs  `sm:278222` SC Celoricense
- kunci "werder bremen": `sm:4701` Werder Bremen  vs  `sm:82` SV Werder Bremen
