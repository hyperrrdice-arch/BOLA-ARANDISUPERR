# Registry Kanonik Tim — Laporan Build

Dibangun: 2026-11-04T20:50:49.740Z

## Angka

- Baris tim sumber (tabel teams): **6489**
- Tim kanonik hasil: **6443**
- Grup tergabung (>1 baris sumber): **45** (menyerap 46 baris ekstra)
- Grup lintas sistem (>1 sumber): **34**
- Tim bernama sengketa (≥2 negara): **4** entri
- Pasangan kandidat mirip BELUM digabung: **7**
- Keputusan resolusi fase 3 diterapkan: **12 penggabungan terbukti**, **7 pasangan terbukti klub BERBEDA** (dicatat distinct_from, tidak akan digabung), **1 alias eksternal**.

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
- BEDA `10002` + `2837` — River Plate Argentina vs River Plate Uruguay — dua klub berbeda (negara + volume data masing-masing besar).
- BEDA `132434` + `94617` — Ourense CF vs UD Ourense — dua klub berbeda dari kota yang sama (UD bubar 2014, Ourense CF klub terpisah).
- BEDA `2079` + `28207` — San Fernando CD (Cádiz, Andalusia) vs UD San Fernando (Maspalomas, Canarias) — klub berbeda.
- BEDA `26423` + `28245` — Coria CF = Coria del Río, Andalusia (berdiri 1923) vs CD Coria = Coria, Cáceres, Extremadura (berdiri 1960) — terverifikasi web (Wikipedia kedua klub).
- BEDA `277303` + `278222` — Celoricense (entitas Campeonato de Portugal) vs SC Celoricense = Sporting Clube Celoricense, Celorico da Beira (berdiri 1948, liga distrik Guarda) — terverifikasi web (soccerzz/playmakerstats).
- BEDA `10016` + `238136` — Melilla vs Melilla CD — bukti belum cukup dan keduanya cangkang nyaris kosong (3+1 match, 0 log); dibiarkan terpisah sampai ada bukti.
- BEDA `4701` + `82` — 'VfL Bremen' (id 4701, 1 match) BUKAN Werder Bremen (id 82, pembawa 106 match) — kandidat ini artefak kunci longgar, bukan kemiripan klub.

## Contoh grup lintas sistem

- `sm:1028` Stade de Reims (France): thestats:tm_master_stade_de_reims="Stade de Reims" · sportmonks:1028="Reims"
- `sm:1079` 1. FC Union Berlin (Germany): thestats:tm_37885="1. FC Union Berlin" · sportmonks:1079="FC Union Berlin"
- `sm:1112` Stade Lavallois (France): thestats:tm_master_stade_lavallois="Stade Lavallois" · sportmonks:1112="Laval"
- `sm:238115` FC Andorra (Spain): football-data:fd_andorra="Andorra" · sportmonks:238115="FC Andorra"
- `sm:2642` SC Paderborn 07 (Germany): thestats:tm_20677="SC Paderborn 07" · sportmonks:2642="Paderborn"
- `sm:265948` Real Betis (Spain): thestats:tm_64056="Real Betis" · sportmonks:265948="Betis CF"
- `sm:266` Stade Brestois 29 (Europe): thestats:tm_40658="Stade Brestois" · sportmonks:266="Brest"
- `sm:2831` 1. FC Heidenheim (Germany): thestats:tm_44984="1. FC Heidenheim" · sportmonks:2831="FC Heidenheim"
- `sm:29` Wolverhampton Wanderers (England): thestats:tm_5104="Wolverhampton" · sportmonks:29="Wolverhampton Wanderers"
- `sm:2919` EA Guingamp (France): thestats:tm_master_ea_guingamp="EA Guingamp" · sportmonks:2919="Guingamp"
- `sm:314` Hearts (Europe): thestats:tm_51862="Heart of Midlothian" · sportmonks:314="Hearts"
- `sm:3320` 1. FC Koln (Germany): thestats:tm_20721="1. FC Köln" · sportmonks:3320="FC Köln"
- `sm:340` Club Brugge (Europe): thestats:tm_89808="Club Brugge KV" · sportmonks:340="Club Brugge"
- `sm:36` Celta Vigo (Europe): thestats:tm_20116="Celta Vigo" · sportmonks:36="Celta de Vigo"
- `sm:3958` St. Gilloise (Europe): thestats:tm_17744="Royale Union Saint-Gilloise" · sportmonks:3958="Union Saint-Gilloise"

## Kandidat mirip (keputusan fase resolusi)

- kunci "river plate": `sm:10002` River Plate  vs  `sm:2837` River Plate
- kunci "melilla": `sm:10016` Melilla  vs  `sm:238136` Melilla CD
- kunci "ourense": `sm:132434` Ourense CF  vs  `sm:94617` UD Ourense
- kunci "san fernando": `sm:2079` San Fernando CD  vs  `sm:28207` UD San Fernando
- kunci "coria": `sm:26423` Coria CF  vs  `sm:28245` CD Coria
- kunci "celoricense": `sm:277303` Celoricense  vs  `sm:278222` SC Celoricense
- kunci "werder bremen": `sm:4701` Werder Bremen  vs  `sm:82` SV Werder Bremen
